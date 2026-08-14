//! The presenter thread: one native composition window spanning the virtual
//! screen (inset 1px per edge), hosting the cursor halo and spotlight visuals.
//! Input comes from a WH_MOUSE_LL hook whose callback is constant-time (store
//! atomics + PostMessage); a GetCursorPos watchdog covers silent hook removal
//! and UIPI (elevated foreground windows). WinRT calls never run inside the
//! hook callback.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicIsize, AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};

use windows::core::{w, Result};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::WinRT::{
    CreateDispatcherQueueController, DispatcherQueueOptions, DQTAT_COM_ASTA, DQTYPE_THREAD_CURRENT,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, CreateWindowExW, DefWindowProcW, DispatchMessageW, GetCursorPos,
    GetMessageW, GetSystemMetrics, LoadCursorW, PostMessageW, RegisterClassW,
    SetLayeredWindowAttributes, SetTimer, SetWindowPos, SetWindowsHookExW, ShowWindow,
    TranslateMessage, UnhookWindowsHookEx, HHOOK, HWND_TOPMOST, IDC_ARROW, LWA_ALPHA, MSG,
    MSLLHOOKSTRUCT, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE,
    WH_MOUSE_LL, WM_APP, WM_DISPLAYCHANGE, WM_LBUTTONDOWN, WM_MOUSEMOVE, WM_RBUTTONDOWN,
    WM_TIMER, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOOLWINDOW,
    WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

use super::composition::Tree;
use super::{HaloVisibility, PresenterConfig};

const WM_APP_INPUT: u32 = WM_APP + 1;
const WM_APP_SYNC: u32 = WM_APP + 2;
const TIMER_TICK: usize = 1;
const TIMER_TOPMOST: usize = 2;

static CONFIG: RwLock<Option<PresenterConfig>> = RwLock::new(None);
static PRESENTER_HWND: AtomicIsize = AtomicIsize::new(0);
static CURSOR_PACKED: AtomicI64 = AtomicI64::new(0);
static LAST_HOOK_MS: AtomicU64 = AtomicU64::new(0);
static LAST_MOVE_MS: AtomicU64 = AtomicU64::new(0);
static INPUT_PENDING: AtomicBool = AtomicBool::new(false);
/// (left_button, x, y) — button-down events only, drained on the window thread.
static BUTTON_EVENTS: Mutex<Vec<(bool, i32, i32)>> = Mutex::new(Vec::new());

fn pack(x: i32, y: i32) -> i64 {
    ((x as i64) << 32) | ((y as u32) as i64)
}

fn unpack(v: i64) -> (i32, i32) {
    ((v >> 32) as i32, (v & 0xFFFF_FFFF) as u32 as i32)
}

struct ThreadState {
    hwnd: HWND,
    tree: Tree,
    hook: Option<HHOOK>,
    dpi_cache: HashMap<isize, f32>,
    config: PresenterConfig,
    origin: (i32, i32),
    visible: bool,
    halo_shown: bool,
    last_reinstall_ms: u64,
}

thread_local! {
    static STATE: RefCell<Option<ThreadState>> = const { RefCell::new(None) };
}

pub fn spawn() {
    std::thread::Builder::new()
        .name("penlight-presenter".into())
        .spawn(|| {
            if let Err(e) = run() {
                eprintln!("[penlight] presenter thread failed: {e}");
            }
        })
        .expect("failed to spawn presenter thread");
}

/// The presenter window handle (0 until the thread has created it).
pub(super) fn hwnd() -> isize {
    PRESENTER_HWND.load(Ordering::Acquire)
}

/// Wake the presenter to re-derive the halo position (used by the zoom thread
/// while the zoom level animates under a stationary cursor).
pub(super) fn poke() {
    let hwnd = PRESENTER_HWND.load(Ordering::Acquire);
    if hwnd != 0 {
        unsafe {
            let _ = PostMessageW(Some(HWND(hwnd as _)), WM_APP_INPUT, WPARAM(0), LPARAM(0));
        }
    }
}

pub fn update(config: PresenterConfig) {
    *CONFIG.write().unwrap() = Some(config);
    let hwnd = PRESENTER_HWND.load(Ordering::Acquire);
    if hwnd != 0 {
        unsafe {
            let _ = PostMessageW(
                Some(HWND(hwnd as _)),
                WM_APP_SYNC,
                WPARAM(0),
                LPARAM(0),
            );
        }
    }
}

fn virtual_screen() -> (i32, i32, i32, i32) {
    unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    }
}

fn run() -> Result<()> {
    unsafe {
        let options = DispatcherQueueOptions {
            dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            apartmentType: DQTAT_COM_ASTA,
        };
        let _controller = CreateDispatcherQueueController(options)?;

        let instance = GetModuleHandleW(None)?;
        let class_name = w!("PenlightPresenter");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            hCursor: LoadCursorW(None, IDC_ARROW)?,
            ..Default::default()
        };
        RegisterClassW(&wc);

        // Inset 1px per edge: a transparent window exactly filling the screen
        // glitches Win11 taskbar transparency (PowerToys workaround).
        let (vx, vy, vw, vh) = virtual_screen();
        let hwnd = CreateWindowExW(
            WS_EX_TRANSPARENT
                | WS_EX_LAYERED
                | WS_EX_NOREDIRECTIONBITMAP
                | WS_EX_TOOLWINDOW
                | WS_EX_TOPMOST,
            class_name,
            w!("Penlight presenter"),
            WS_POPUP,
            vx + 1,
            vy + 1,
            vw - 2,
            vh - 2,
            None,
            None,
            Some(instance.into()),
            None,
        )?;
        SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA)?;

        let tree = Tree::new(hwnd, (vw - 2) as f32, (vh - 2) as f32)?;
        let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0).ok();

        STATE.with(|s| {
            *s.borrow_mut() = Some(ThreadState {
                hwnd,
                tree,
                hook,
                dpi_cache: HashMap::new(),
                config: default_config(),
                origin: (vx + 1, vy + 1),
                visible: false,
                halo_shown: true,
                last_reinstall_ms: 0,
            });
        });
        PRESENTER_HWND.store(hwnd.0 as isize, Ordering::Release);

        SetTimer(Some(hwnd), TIMER_TICK, 250, None);
        SetTimer(Some(hwnd), TIMER_TOPMOST, 2000, None);

        // A config may have arrived before the window existed.
        let _ = PostMessageW(Some(hwnd), WM_APP_SYNC, WPARAM(0), LPARAM(0));

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}

fn default_config() -> PresenterConfig {
    PresenterConfig {
        halo_on: false,
        spotlight_on: false,
        shape: super::HaloShape::Ring,
        color: (246, 51, 154),
        size: 64.0,
        border_width: 4.0,
        dashed: false,
        opacity: 0.9,
        pulse_on_click: true,
        visibility: HaloVisibility::Always,
        spot_radius: 160.0,
        spot_dim: 0.75,
        spot_color: (0, 0, 0),
        lens_active: false,
        lens_size: 340.0,
        lens_circle: false,
        lens_border_width: 3.0,
        lens_border_color: (255, 255, 255),
    }
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let data = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let now = GetTickCount64();
        CURSOR_PACKED.store(pack(data.pt.x, data.pt.y), Ordering::Relaxed);
        LAST_HOOK_MS.store(now, Ordering::Relaxed);
        let msg = wparam.0 as u32;
        if msg == WM_MOUSEMOVE {
            LAST_MOVE_MS.store(now, Ordering::Relaxed);
        } else if msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN {
            if let Ok(mut events) = BUTTON_EVENTS.lock() {
                if events.len() < 64 {
                    events.push((msg == WM_LBUTTONDOWN, data.pt.x, data.pt.y));
                }
            }
        }
        if !INPUT_PENDING.swap(true, Ordering::AcqRel) {
            let hwnd = PRESENTER_HWND.load(Ordering::Acquire);
            if hwnd != 0 {
                let _ = PostMessageW(Some(HWND(hwnd as _)), WM_APP_INPUT, WPARAM(0), LPARAM(0));
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_APP_INPUT => {
            INPUT_PENDING.store(false, Ordering::Release);
            with_state(|state| handle_input(state));
            LRESULT(0)
        }
        WM_APP_SYNC => {
            with_state(|state| apply_config(state));
            LRESULT(0)
        }
        WM_TIMER => {
            match wparam.0 {
                TIMER_TICK => with_state(|state| tick(state)),
                TIMER_TOPMOST => with_state(|state| {
                    if state.visible {
                        reassert_topmost(state.hwnd);
                    }
                }),
                _ => {}
            }
            LRESULT(0)
        }
        WM_DISPLAYCHANGE => {
            with_state(|state| respan(state));
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn with_state(f: impl FnOnce(&mut ThreadState)) {
    STATE.with(|s| {
        if let Some(state) = s.borrow_mut().as_mut() {
            f(state);
        }
    });
}

fn reassert_topmost(hwnd: HWND) {
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

fn dpi_scale_at(state: &mut ThreadState, x: i32, y: i32) -> f32 {
    let monitor = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST) };
    let key = monitor.0 as isize;
    if let Some(scale) = state.dpi_cache.get(&key) {
        return *scale;
    }
    let mut dpi_x = 96u32;
    let mut dpi_y = 96u32;
    let scale = unsafe {
        if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y).is_ok() {
            dpi_x as f32 / 96.0
        } else {
            1.0
        }
    };
    state.dpi_cache.insert(key, scale);
    scale
}

/// While a zoom lens is active, place visuals where the MAGNIFIED cursor
/// appears rather than at the physical cursor position.
fn map_zoom(x: i32, y: i32) -> (f32, f32) {
    if let Some(z) = *super::ZOOM_STATE.read().unwrap() {
        if x >= z.mon_x && x < z.mon_x + z.mon_w && y >= z.mon_y && y < z.mon_y + z.mon_h {
            return (
                z.mon_x as f32 + (x as f32 - z.src_x) * z.zoom,
                z.mon_y as f32 + (y as f32 - z.src_y) * z.zoom,
            );
        }
    }
    (x as f32, y as f32)
}

fn handle_input(state: &mut ThreadState) {
    let (x, y) = unpack(CURSOR_PACKED.load(Ordering::Relaxed));
    let scale = dpi_scale_at(state, x, y);
    let (mx, my) = map_zoom(x, y);
    let lx = mx - state.origin.0 as f32;
    let ly = my - state.origin.1 as f32;

    if state.config.visibility == HaloVisibility::Moving && !state.halo_shown {
        state.halo_shown = true;
        let _ = state.tree.animate_halo_opacity(1.0);
    }
    let _ = state.tree.set_cursor(lx, ly, scale);

    let events: Vec<(bool, i32, i32)> = match BUTTON_EVENTS.lock() {
        Ok(mut guard) => guard.drain(..).collect(),
        Err(_) => Vec::new(),
    };
    if state.config.pulse_on_click && (state.config.halo_on || state.config.spotlight_on) {
        let now = unsafe { GetTickCount64() };
        for (left, bx, by) in events {
            let scale = dpi_scale_at(state, bx, by);
            let (mbx, mby) = map_zoom(bx, by);
            let px = mbx - state.origin.0 as f32;
            let py = mby - state.origin.1 as f32;
            let _ = state.tree.pulse(left, px, py, scale, now);
        }
    }
}

fn apply_config(state: &mut ThreadState) {
    let Some(config) = CONFIG.read().unwrap().clone() else {
        return;
    };
    state.config = config.clone();
    if let Err(e) = state.tree.apply(&config) {
        eprintln!("[penlight] presenter apply failed: {e}");
    }
    let want_visible = config.halo_on || config.spotlight_on || config.lens_active;
    if want_visible != state.visible {
        state.visible = want_visible;
        unsafe {
            let _ = ShowWindow(
                state.hwnd,
                if want_visible { SW_SHOWNOACTIVATE } else { SW_HIDE },
            );
        }
    }
    if want_visible {
        reassert_topmost(state.hwnd);
        state.halo_shown = config.visibility != HaloVisibility::Clicks;
        // Snap the visuals to the current cursor position immediately.
        let mut pt = POINT::default();
        if unsafe { GetCursorPos(&mut pt) }.is_ok() {
            CURSOR_PACKED.store(pack(pt.x, pt.y), Ordering::Relaxed);
            handle_input(state);
        }
    }
    state.dpi_cache.clear();
}

fn tick(state: &mut ThreadState) {
    let now = unsafe { GetTickCount64() };
    state.tree.cleanup_pulses(now);
    if !state.visible {
        return;
    }

    // Watchdog: the LL hook can be silently removed (callback budget) or muted
    // by UIPI while an elevated window is foreground; fall back to polling.
    let last_hook = LAST_HOOK_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last_hook) > 600 {
        let mut pt = POINT::default();
        if unsafe { GetCursorPos(&mut pt) }.is_ok() {
            let packed = pack(pt.x, pt.y);
            if packed != CURSOR_PACKED.load(Ordering::Relaxed) {
                CURSOR_PACKED.store(packed, Ordering::Relaxed);
                LAST_MOVE_MS.store(now, Ordering::Relaxed);
                handle_input(state);
            }
        }
        // Periodically try to re-install the hook.
        if now.saturating_sub(state.last_reinstall_ms) > 5000 {
            state.last_reinstall_ms = now;
            unsafe {
                if let Some(hook) = state.hook.take() {
                    let _ = UnhookWindowsHookEx(hook);
                }
                state.hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0).ok();
            }
        }
    }

    // "Only when moving": fade out after ~1.5s idle.
    if state.config.visibility == HaloVisibility::Moving && state.halo_shown {
        let last_move = LAST_MOVE_MS.load(Ordering::Relaxed);
        if now.saturating_sub(last_move) > 1500 {
            state.halo_shown = false;
            let _ = state.tree.animate_halo_opacity(0.0);
        }
    }
}

fn respan(state: &mut ThreadState) {
    let (vx, vy, vw, vh) = virtual_screen();
    state.origin = (vx + 1, vy + 1);
    state.dpi_cache.clear();
    unsafe {
        let _ = SetWindowPos(
            state.hwnd,
            Some(HWND_TOPMOST),
            vx + 1,
            vy + 1,
            vw - 2,
            vh - 2,
            SWP_NOACTIVATE,
        );
    }
    let _ = state.tree.resize((vw - 2) as f32, (vh - 2) as f32);
}
