//! The zoom thread. Two styles:
//! - "lens" (default): a magnifying-glass window (circle or rounded square)
//!   that follows the cursor, magnifying the area underneath — Presentify's
//!   zoom. The lens is a real window in the desktop composition, so OBS
//!   Display Capture records it.
//! - "monitor": ZoomIt-LiveZoom-style full-monitor magnification.
//!
//! The system cursor is hidden while zoomed; the presenter halo doubles as
//! the visible (and recordable) cursor. MagSetFullscreenTransform is never
//! used — it is applied post-composition and invisible to capture.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::RwLock;

use windows::core::{w, Result, BOOL};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateEllipticRgn, CreateRoundRectRgn, GetMonitorInfoW, InvalidateRect, MonitorFromPoint,
    SetWindowRgn, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
use windows::Win32::UI::Magnification::{
    MagInitialize, MagSetWindowFilterList, MagSetWindowSource, MagSetWindowTransform,
    MagShowSystemCursor, MAGTRANSFORM, MW_FILTERMODE_EXCLUDE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW,
    KillTimer, PostMessageW, RegisterClassW, SetLayeredWindowAttributes, SetTimer, SetWindowPos,
    TranslateMessage, HWND_MESSAGE, HWND_TOPMOST, LWA_ALPHA, MSG, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WM_APP, WM_DISPLAYCHANGE, WM_ERASEBKGND, WM_TIMER,
    WNDCLASSW, WS_CHILD, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
    WS_POPUP, WS_VISIBLE,
};

use super::{presenter, ZoomTransform, ZOOM_STATE};

const WM_APP_SYNC: u32 = WM_APP + 11;
const WM_APP_SHUTDOWN: u32 = WM_APP + 12;
const TIMER_TICK: usize = 1;
const TICK_MS: u32 = 20;
const ZOOM_STEP_IN: f32 = 1.1;
const ZOOM_STEP_OUT: f32 = 0.8;

#[derive(Clone)]
pub struct ZoomConfig {
    pub on: bool,
    pub target: f32,
    pub smoothing: bool,
    pub lens: bool,
    pub lens_size: u16,
    pub circle: bool,
}

impl Default for ZoomConfig {
    fn default() -> Self {
        Self {
            on: false,
            target: 2.0,
            smoothing: true,
            lens: true,
            lens_size: 340,
            circle: false,
        }
    }
}

static CONFIG: RwLock<Option<ZoomConfig>> = RwLock::new(None);
static ZOOM_HWND: AtomicIsize = AtomicIsize::new(0);
static LENS_ACTIVE: AtomicBool = AtomicBool::new(false);

struct Lens {
    host: HWND,
    mag: HWND,
    /// Monitor bounds captured at creation (monitor mode only; lens mode
    /// re-derives the monitor under the cursor every tick).
    mon: RECT,
    is_lens: bool,
    lens_size: i32,
    circle: bool,
}

struct ZoomState {
    msg_hwnd: HWND,
    lens: Option<Lens>,
    level: f32,
    target: f32,
    closing: bool,
    timer_running: bool,
}

thread_local! {
    static STATE: RefCell<Option<ZoomState>> = const { RefCell::new(None) };
}

pub fn spawn() {
    std::thread::Builder::new()
        .name("penlight-zoom".into())
        .spawn(|| {
            if let Err(e) = run() {
                eprintln!("[penlight] zoom thread failed: {e}");
            }
        })
        .expect("failed to spawn zoom thread");
}

pub fn update(config: ZoomConfig) {
    *CONFIG.write().unwrap() = Some(config);
    post(WM_APP_SYNC);
}

/// Called on app quit: force-destroy the lens NOW so MagShowSystemCursor is
/// restored before the process dies (a hidden system cursor outlives us).
pub fn shutdown() {
    if !LENS_ACTIVE.load(Ordering::Acquire) {
        return;
    }
    post(WM_APP_SHUTDOWN);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(400);
    while LENS_ACTIVE.load(Ordering::Acquire) && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

fn post(msg: u32) {
    let hwnd = ZOOM_HWND.load(Ordering::Acquire);
    if hwnd != 0 {
        unsafe {
            let _ = PostMessageW(Some(HWND(hwnd as _)), msg, WPARAM(0), LPARAM(0));
        }
    }
}

fn run() -> Result<()> {
    unsafe {
        if !MagInitialize().as_bool() {
            eprintln!("[penlight] MagInitialize failed; zoom unavailable");
            return Ok(());
        }
        let instance = GetModuleHandleW(None)?;
        let class_name = w!("PenlightZoom");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            ..Default::default()
        };
        RegisterClassW(&wc);

        let msg_hwnd = CreateWindowExW(
            Default::default(),
            class_name,
            w!("Penlight zoom"),
            Default::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance.into()),
            None,
        )?;

        STATE.with(|s| {
            *s.borrow_mut() = Some(ZoomState {
                msg_hwnd,
                lens: None,
                level: 1.0,
                target: 2.0,
                closing: false,
                timer_running: false,
            });
        });
        ZOOM_HWND.store(msg_hwnd.0 as isize, Ordering::Release);
        // A config may have arrived before the window existed.
        let _ = PostMessageW(Some(msg_hwnd), WM_APP_SYNC, WPARAM(0), LPARAM(0));

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_APP_SYNC => {
            with_state(sync);
            LRESULT(0)
        }
        WM_APP_SHUTDOWN => {
            with_state(destroy_lens);
            LRESULT(0)
        }
        WM_TIMER if wparam.0 == TIMER_TICK => {
            with_state(tick);
            LRESULT(0)
        }
        WM_DISPLAYCHANGE => {
            // Recreate against the new display topology if active.
            with_state(|state| {
                if state.lens.is_some() {
                    destroy_lens(state);
                    sync(state);
                }
            });
            LRESULT(0)
        }
        WM_ERASEBKGND => {
            // The magnifier child covers the whole host; the border/glass
            // chrome is drawn by the presenter's composition layer above.
            LRESULT(1)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

fn with_state(f: impl FnOnce(&mut ZoomState)) {
    STATE.with(|s| {
        // try_borrow_mut, not borrow_mut: this wndproc also serves the lens
        // host window (same class), so a message dispatched synchronously
        // mid-handler (e.g. by DestroyWindow inside destroy_lens) re-enters
        // here. A second borrow would panic — and panic = abort, with the
        // system cursor possibly still hidden. Re-entrant messages are
        // safely dropped instead.
        if let Ok(mut guard) = s.try_borrow_mut() {
            if let Some(state) = guard.as_mut() {
                f(state);
            }
        }
    });
}

fn current_config() -> ZoomConfig {
    CONFIG.read().unwrap().clone().unwrap_or_default()
}

fn sync(state: &mut ZoomState) {
    let config = current_config();
    if config.on {
        state.target = config.target.clamp(1.25, 32.0);
        state.closing = false;
        // Size/shape/style changed live (settings or session keys): recreate.
        if let Some(existing) = state.lens.as_ref() {
            let want_size = i32::from(config.lens_size).clamp(120, 800);
            if existing.is_lens != config.lens
                || (config.lens
                    && (existing.lens_size != want_size || existing.circle != config.circle))
            {
                destroy_lens(state);
            }
        }
        if state.lens.is_none() {
            match create_lens(&config) {
                Ok(lens) => {
                    state.lens = Some(lens);
                    state.level = if config.lens { state.target } else { 1.0 };
                    LENS_ACTIVE.store(true, Ordering::Release);
                    if !config.lens {
                        // Monitor mode: the magnified content shifts away
                        // from the real cursor position — hide it and let the
                        // halo take over. Lens mode keeps the real cursor
                        // (the glass center IS the cursor position).
                        unsafe {
                            let _ = MagShowSystemCursor(false);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[penlight] failed to create zoom lens: {e}");
                    return;
                }
            }
        }
        if !state.timer_running {
            unsafe {
                SetTimer(Some(state.msg_hwnd), TIMER_TICK, TICK_MS, None);
            }
            state.timer_running = true;
        }
    } else if let Some(lens) = state.lens.as_ref() {
        if lens.is_lens {
            // A hand-held glass just pops away — no animation, no cursor gap.
            destroy_lens(state);
        } else {
            // Monitor mode animates back to 1x; restore the system cursor at
            // the START of the animation so there is never a cursor-less gap
            // (the halo hides immediately when zoom_on flips off).
            state.closing = true;
            state.target = 1.0;
            unsafe {
                let _ = MagShowSystemCursor(true);
            }
        }
    }
}

fn create_lens(config: &ZoomConfig) -> Result<Lens> {
    unsafe {
        let mut pt = POINT::default();
        let _ = GetCursorPos(&mut pt);
        let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            // Display topology in flux (hotplug/sleep): skip this activation
            // rather than build a lens against a zeroed monitor rect.
            return Err(windows::core::Error::from_thread());
        }
        let mon = info.rcMonitor;

        let instance = GetModuleHandleW(None)?;
        let is_lens = config.lens;
        let lens_size = i32::from(config.lens_size).clamp(120, 800);
        let (x, y, w_px, h_px) = if is_lens {
            (pt.x - lens_size / 2, pt.y - lens_size / 2, lens_size, lens_size)
        } else {
            (mon.left, mon.top, mon.right - mon.left, mon.bottom - mon.top)
        };

        let host = CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST,
            w!("PenlightZoom"),
            w!("Penlight lens"),
            WS_POPUP | WS_VISIBLE,
            x,
            y,
            w_px,
            h_px,
            None,
            None,
            Some(instance.into()),
            None,
        )?;
        SetLayeredWindowAttributes(host, COLORREF(0), 255, LWA_ALPHA)?;
        let _ = EnableWindow(host, false);

        if is_lens {
            // Clip to a circle or rounded square (region ownership passes to
            // the window on SetWindowRgn).
            let region = if config.circle {
                CreateEllipticRgn(0, 0, w_px, h_px)
            } else {
                let r = w_px / 5;
                CreateRoundRectRgn(0, 0, w_px, h_px, r, r)
            };
            let _ = SetWindowRgn(host, Some(region), true);
        }

        let mag = CreateWindowExW(
            Default::default(),
            w!("Magnifier"),
            w!("MagnifierWindow"),
            WS_CHILD | WS_VISIBLE,
            0,
            0,
            w_px,
            h_px,
            Some(host),
            None,
            Some(instance.into()),
            None,
        )?;

        // Exclude only ourselves and the presenter (halo) from the source:
        // annotations and the toolbar should magnify like any screen content.
        let mut excluded: Vec<HWND> = vec![host];
        let presenter_hwnd = presenter::hwnd();
        if presenter_hwnd != 0 {
            excluded.push(HWND(presenter_hwnd as _));
        }
        let _ = MagSetWindowFilterList(
            mag,
            MW_FILTERMODE_EXCLUDE,
            excluded.len() as i32,
            excluded.as_mut_ptr(),
        );

        if config.smoothing {
            // GetModuleHandleW, not LoadLibraryW by relative name: the DLL is
            // guaranteed already loaded (MagInitialize succeeded), and a bare
            // LoadLibraryW would walk the DLL search path. The export is
            // undocumented but stable since Win7 (used by ZoomIt); signature
            // (HWND, BOOL) -> BOOL per community documentation of magnification.dll.
            if let Ok(lib) = GetModuleHandleW(w!("magnification.dll")) {
                if let Some(proc) =
                    GetProcAddress(lib, windows::core::s!("MagSetLensUseBitmapSmoothing"))
                {
                    let set_smoothing: extern "system" fn(HWND, BOOL) -> BOOL =
                        std::mem::transmute(proc);
                    let _ = set_smoothing(mag, BOOL(1));
                }
            }
        }

        Ok(Lens {
            host,
            mag,
            mon,
            is_lens,
            lens_size,
            circle: config.circle,
        })
    }
}

fn destroy_lens(state: &mut ZoomState) {
    if let Some(lens) = state.lens.take() {
        unsafe {
            let _ = MagShowSystemCursor(true);
            let _ = DestroyWindow(lens.host);
        }
    }
    *ZOOM_STATE.write().unwrap() = None;
    if state.timer_running {
        unsafe {
            let _ = KillTimer(Some(state.msg_hwnd), TIMER_TICK);
        }
        state.timer_running = false;
    }
    state.level = 1.0;
    state.closing = false;
    LENS_ACTIVE.store(false, Ordering::Release);
    presenter::poke();
}

fn tick(state: &mut ZoomState) {
    let Some(lens) = state.lens.as_ref() else {
        if state.timer_running {
            unsafe {
                let _ = KillTimer(Some(state.msg_hwnd), TIMER_TICK);
            }
            state.timer_running = false;
        }
        return;
    };

    // Multiplicative interpolation toward the target (ZoomIt's constants).
    if state.level < state.target {
        state.level = (state.level * ZOOM_STEP_IN).min(state.target);
    } else if state.level > state.target {
        state.level = (state.level * ZOOM_STEP_OUT).max(state.target);
    }
    if state.closing && state.level <= 1.02 {
        destroy_lens(state);
        return;
    }

    let mut pt = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut pt);
    }

    if lens.is_lens {
        tick_lens(lens, pt, state.level);
    } else {
        tick_monitor(lens, pt, state.level);
    }

    unsafe {
        // Reclaim topmost, then put the presenter back above the lens so the
        // halo-cursor stays visible.
        let _ = SetWindowPos(
            lens.host,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
        let presenter_hwnd = presenter::hwnd();
        if presenter_hwnd != 0 {
            let _ = SetWindowPos(
                HWND(presenter_hwnd as _),
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
        let _ = InvalidateRect(Some(lens.mag), None, false);
    }
}

/// Lens mode: move the glass with the cursor; magnify the area underneath.
fn tick_lens(lens: &Lens, pt: POINT, level: f32) {
    unsafe {
        // Clamp the source to the monitor currently under the cursor.
        let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return; // topology in flux — skip this tick
        }
        let mon = info.rcMonitor;
        let mon_w = (mon.right - mon.left) as f32;
        let mon_h = (mon.bottom - mon.top) as f32;
        if mon_w <= 0.0 || mon_h <= 0.0 {
            return;
        }

        // Cap the source at the monitor size: on a monitor smaller than the
        // lens the naive `right - src` would drop below `left` and
        // f32::clamp panics when min > max (panic = abort).
        let src = (lens.lens_size as f32 / level).min(mon_w).min(mon_h);
        let src_x = (pt.x as f32 - src / 2.0).clamp(mon.left as f32, mon.right as f32 - src);
        let src_y = (pt.y as f32 - src / 2.0).clamp(mon.top as f32, mon.bottom as f32 - src);

        let mut transform = MAGTRANSFORM::default();
        transform.v[0] = level;
        transform.v[4] = level;
        transform.v[8] = 1.0;
        let _ = MagSetWindowTransform(lens.mag, &mut transform);
        let _ = MagSetWindowSource(
            lens.mag,
            RECT {
                left: src_x as i32,
                top: src_y as i32,
                right: (src_x + src) as i32,
                bottom: (src_y + src) as i32,
            },
        );

        let _ = SetWindowPos(
            lens.host,
            None,
            pt.x - lens.lens_size / 2,
            pt.y - lens.lens_size / 2,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
        );
    }
    // Cursor-centered source ⇒ magnified cursor position = real position:
    // the halo needs no remapping in lens mode.
    *ZOOM_STATE.write().unwrap() = None;
}

/// Monitor mode: ZoomIt LiveZoom — full-monitor magnification.
fn tick_monitor(lens: &Lens, pt: POINT, level: f32) {
    let mon = lens.mon;
    let mon_w = (mon.right - mon.left) as f32;
    let mon_h = (mon.bottom - mon.top) as f32;
    if mon_w <= 0.0 || mon_h <= 0.0 || level < 1.0 {
        return; // degenerate rect would invert the clamp bounds below
    }
    let src_w = mon_w / level;
    let src_h = mon_h / level;
    let src_x = (pt.x as f32 - src_w / 2.0).clamp(mon.left as f32, mon.right as f32 - src_w);
    let src_y = (pt.y as f32 - src_h / 2.0).clamp(mon.top as f32, mon.bottom as f32 - src_h);

    unsafe {
        let mut transform = MAGTRANSFORM::default();
        transform.v[0] = level;
        transform.v[4] = level;
        transform.v[8] = 1.0;
        let _ = MagSetWindowTransform(lens.mag, &mut transform);
        let _ = MagSetWindowSource(
            lens.mag,
            RECT {
                left: src_x as i32,
                top: src_y as i32,
                right: (src_x + src_w) as i32,
                bottom: (src_y + src_h) as i32,
            },
        );
    }
    *ZOOM_STATE.write().unwrap() = Some(ZoomTransform {
        mon_x: mon.left,
        mon_y: mon.top,
        mon_w: (mon.right - mon.left),
        mon_h: (mon.bottom - mon.top),
        src_x,
        src_y,
        zoom: level,
    });
    presenter::poke();
}
