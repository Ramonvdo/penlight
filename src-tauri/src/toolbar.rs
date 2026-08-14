use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const TOOLBAR_W: f64 = 680.0;
const TOOLBAR_H: f64 = 92.0;

/// The floating pill toolbar. Non-focusable so clicking it never steals
/// keyboard focus from the annotation overlay.
pub fn create_toolbar(app: &AppHandle) -> tauri::Result<()> {
    let mut builder =
        WebviewWindowBuilder::new(app, "toolbar", WebviewUrl::App("toolbar.html".into()));
    if let Some(args) = crate::overlay::browser_args(app) {
        builder = builder.additional_browser_args(&args);
    }
    let window = builder
        .title("Penlight")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .inner_size(TOOLBAR_W, TOOLBAR_H)
        .visible(false)
        .build()?;

    let _ = window;
    reposition(app);
    Ok(())
}

/// Bottom-center of the primary monitor. Called at creation and again after
/// display changes (a hidden window keeps stale coordinates of a monitor that
/// may no longer exist).
pub fn reposition(app: &AppHandle) {
    let Some(window) = app.get_webview_window("toolbar") else {
        return;
    };
    if let Ok(Some(primary)) = app.primary_monitor() {
        let scale = primary.scale_factor();
        let pos = primary.position();
        let size = primary.size();
        let px = pos.x + ((size.width as f64 - TOOLBAR_W * scale) / 2.0) as i32;
        let py = pos.y + (size.height as f64 - (TOOLBAR_H + 64.0) * scale) as i32;
        let _ = window.set_position(PhysicalPosition::new(px, py));
    }
}

/// Re-assert the toolbar above a just-raised overlay (both live in the
/// HWND_TOPMOST band; most recently asserted wins).
pub fn raise(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("toolbar") {
        if w.is_visible().unwrap_or(false) {
            crate::win32::reassert_topmost(&w);
        }
    }
}

pub fn set_visible(app: &AppHandle, visible: bool) {
    if let Some(w) = app.get_webview_window("toolbar") {
        if visible {
            let _ = w.show();
            crate::win32::reassert_topmost(&w);
        } else {
            let _ = w.hide();
        }
    }
}

pub fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Penlight Settings")
        .inner_size(760.0, 540.0)
        .min_inner_size(640.0, 480.0)
        .center()
        .build();
    match built {
        Ok(w) => {
            let _ = w.show();
            // Windows quirk: a window shown from a tray menu may need an
            // explicit focus call.
            let _ = w.set_focus();
        }
        Err(e) => eprintln!("[penlight] failed to open settings window: {e}"),
    }
}
