use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::monitors::{self, MonitorRect};

pub const PREFIX: &str = "overlay-";

/// Labels are generation-versioned (overlay-{gen}-{i}) so a display-change
/// rebuild never races the async destruction of the previous windows.
static GENERATION: AtomicU32 = AtomicU32::new(0);

pub fn overlay_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(PREFIX))
        .map(|(_, w)| w)
        .collect()
}

/// One transparent, click-through, always-on-top overlay per monitor, sized in
/// PHYSICAL pixels. Created hidden at startup; shown when annotate mode starts.
/// Tauri's default WebView2 args, kept when we append our own (providing
/// additional_browser_args REPLACES the defaults rather than extending them).
const DEFAULT_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

pub fn browser_args(app: &AppHandle) -> Option<String> {
    let disable_gpu = {
        let handle = app.state::<crate::settings::SettingsHandle>();
        let guard = handle.0.lock().unwrap();
        guard.disable_gpu_compositing
    };
    disable_gpu.then(|| format!("{DEFAULT_BROWSER_ARGS} --disable-gpu-compositing"))
}

pub fn create_all(app: &AppHandle) -> tauri::Result<()> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst);
    let monitors_list = app.available_monitors()?;
    let extra_args = browser_args(app);
    let mut rects = Vec::new();
    for (i, m) in monitors_list.iter().enumerate() {
        let label = format!("{PREFIX}{generation}-{i}");
        let pos = *m.position();
        let size = *m.size();
        let mut builder =
            WebviewWindowBuilder::new(app, &label, WebviewUrl::App("overlay.html".into()));
        if let Some(args) = &extra_args {
            builder = builder.additional_browser_args(args);
        }
        let window = builder
                .title("Penlight overlay")
                .transparent(true)
                .decorations(false)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .closable(false)
                .visible(false)
                .build()?;
        let _ = window.set_position(PhysicalPosition::new(pos.x, pos.y));
        // Height -1px: a borderless window exactly matching the monitor trips
        // Windows' fullscreen heuristics and breaks taskbar z-order.
        let _ = window.set_size(PhysicalSize::new(size.width, size.height.saturating_sub(1)));
        let _ = window.set_ignore_cursor_events(true);
        // Clicking an overlay activates it and raises it above the toolbar
        // within the topmost band — re-raise the toolbar on every focus gain
        // so its buttons stay clickable mid-annotation.
        let focus_app = app.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(true) = event {
                crate::toolbar::raise(&focus_app);
            }
        });
        rects.push(MonitorRect {
            label,
            x: pos.x,
            y: pos.y,
            w: size.width,
            h: size.height,
        });
    }
    monitors::set(app, rects);
    Ok(())
}

/// Display configuration changed: tear down and recreate all overlays.
pub fn rebuild(app: &AppHandle) {
    crate::state::apply(app, crate::state::Transition::AnnotateExit);
    for w in overlay_windows(app) {
        let _ = w.destroy();
    }
    if let Err(e) = create_all(app) {
        eprintln!("[penlight] overlay rebuild failed: {e}");
    }
}

pub fn enter_annotate(app: &AppHandle) {
    for w in overlay_windows(app) {
        let _ = w.show();
        let _ = w.set_ignore_cursor_events(false);
        let _ = w.set_focusable(true);
        let _ = w.set_always_on_top(true);
        crate::win32::reassert_topmost(&w);
    }
    // Focus the overlay under the cursor so single-key shortcuts land there
    // (fall back to any overlay — labels are generation-versioned).
    let target = monitors::overlay_under_cursor(app)
        .and_then(|label| app.get_webview_window(&label))
        .or_else(|| overlay_windows(app).into_iter().next());
    if let Some(w) = target {
        let _ = w.set_focus();
    }
    crate::toolbar::raise(app);
}

pub fn exit_annotate(app: &AppHandle) {
    let _ = app.emit("annotate-clear", ());
    for w in overlay_windows(app) {
        let _ = w.set_ignore_cursor_events(true);
        let _ = w.set_focusable(false);
        let _ = w.hide();
    }
}

/// Interactive mode: annotations stay visible but clicks pass through to apps.
pub fn set_interactive(app: &AppHandle, interactive: bool) {
    for w in overlay_windows(app) {
        let _ = w.set_ignore_cursor_events(interactive);
    }
}
