use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::state::{self, Snapshot, Transition};

pub struct TrayMenu {
    pub annotate: CheckMenuItem<Wry>,
    pub whiteboard: CheckMenuItem<Wry>,
    pub halo: CheckMenuItem<Wry>,
    pub spotlight: CheckMenuItem<Wry>,
    pub zoom: CheckMenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let annotate = CheckMenuItem::with_id(
        app,
        "annotate",
        "Annotate screen",
        true,
        false,
        None::<&str>,
    )?;
    let whiteboard =
        CheckMenuItem::with_id(app, "whiteboard", "Whiteboard", true, false, None::<&str>)?;
    let halo = CheckMenuItem::with_id(
        app,
        "halo",
        "Cursor highlight",
        true,
        false,
        None::<&str>,
    )?;
    let spotlight =
        CheckMenuItem::with_id(app, "spotlight", "Spotlight", true, false, None::<&str>)?;
    let zoom = CheckMenuItem::with_id(app, "zoom", "Zoom", true, false, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Penlight", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    let items: Vec<&dyn IsMenuItem<Wry>> = vec![
        &annotate,
        &whiteboard,
        &sep1,
        &halo,
        &spotlight,
        &zoom,
        &sep2,
        &settings_item,
        &sep3,
        &quit,
    ];
    let menu = Menu::with_items(app, &items)?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Penlight")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "annotate" => state::apply(app, Transition::AnnotateToggle { with_toolbar: true }),
            "whiteboard" => state::apply(app, Transition::WhiteboardToggle),
            "halo" => state::apply(app, Transition::HaloToggle),
            "spotlight" => state::apply(app, Transition::SpotlightToggle),
            "zoom" => state::apply(app, Transition::ZoomToggle),
            "settings" => crate::toolbar::show_settings(app),
            "quit" => {
                crate::settings::save_now(app);
                // Restore the system cursor if a zoom lens is up — a hidden
                // cursor would outlive the process.
                crate::native::shutdown();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                state::apply(
                    tray.app_handle(),
                    Transition::AnnotateToggle { with_toolbar: true },
                );
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayMenu {
        annotate,
        whiteboard,
        halo,
        spotlight,
        zoom,
    });
    Ok(())
}

pub fn sync(app: &AppHandle, snap: &Snapshot) {
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let _ = menu.annotate.set_checked(snap.annotating);
        let _ = menu.whiteboard.set_checked(snap.whiteboard);
        let _ = menu.halo.set_checked(snap.halo_on);
        let _ = menu.spotlight.set_checked(snap.spotlight_on);
        let _ = menu.zoom.set_checked(snap.zoom_on);
    }
}
