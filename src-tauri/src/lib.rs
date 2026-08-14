mod boards;
mod commands;
mod hotkeys;
mod monitors;
mod native;
mod overlay;
mod settings;
mod state;
mod toolbar;
mod tray;
mod win32;

use tauri::{Manager, RunEvent};

pub fn run() {
    tauri::Builder::default()
        // single-instance must be the first plugin registered
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            toolbar::show_settings(app);
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let loaded = settings::load(app.handle());
            let halo_on_launch = loaded.halo_on_launch;
            let default_weight = loaded.annotate.default_weight;
            app.manage(settings::SettingsHandle(std::sync::Mutex::new(loaded)));
            app.manage(boards::BoardsHandle::default());
            let state_handle = state::StateHandle::default();
            // The configured default line weight drives the initial state.
            state_handle.0.lock().unwrap().weight = default_weight.clamp(1, 24);
            app.manage(state_handle);
            native::init(app.handle());
            overlay::create_all(app.handle())?;
            toolbar::create_toolbar(app.handle())?;
            tray::create(app.handle())?;
            hotkeys::register_all(app.handle());
            // Display-change fallback poll (M3's native thread adds
            // WM_DISPLAYCHANGE as the primary signal).
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || monitors::check_changed(&h));
            });
            if halo_on_launch {
                state::apply(app.handle(), state::Transition::HaloToggle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::get_settings,
            commands::update_settings,
            commands::annotate_toggle,
            commands::annotate_exit,
            commands::whiteboard_toggle,
            commands::halo_toggle,
            commands::spotlight_toggle,
            commands::zoom_toggle,
            commands::set_tool,
            commands::set_color,
            commands::set_weight,
            commands::set_interactive,
            commands::open_settings,
            commands::board_create,
            commands::board_load,
            commands::board_save,
            commands::board_last,
            commands::board_list,
            commands::board_rename,
            commands::board_delete,
            commands::board_panel_toggle,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Penlight")
        .run(|_app, event| {
            if let RunEvent::ExitRequested { api, code, .. } = event {
                // Tray-only app: survive the last window closing, but let an
                // explicit app.exit(code) through.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
