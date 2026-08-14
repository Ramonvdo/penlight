use tauri::{AppHandle, Manager};

use crate::settings::{Settings, SettingsHandle};
use crate::state::{self, Snapshot, StateHandle, Tool, Transition};

#[tauri::command]
pub fn get_snapshot(app: AppHandle) -> Snapshot {
    app.state::<StateHandle>().0.lock().unwrap().snapshot()
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    app.state::<SettingsHandle>().0.lock().unwrap().clone()
}

#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Settings) {
    crate::settings::update(&app, settings);
}

#[tauri::command]
pub fn annotate_toggle(app: AppHandle, with_toolbar: Option<bool>) {
    state::apply(
        &app,
        Transition::AnnotateToggle {
            with_toolbar: with_toolbar.unwrap_or(true),
        },
    );
}

#[tauri::command]
pub fn annotate_exit(app: AppHandle) {
    state::apply(&app, Transition::AnnotateExit);
}

#[tauri::command]
pub fn whiteboard_toggle(app: AppHandle) {
    state::apply(&app, Transition::WhiteboardToggle);
}

#[tauri::command]
pub fn halo_toggle(app: AppHandle) {
    state::apply(&app, Transition::HaloToggle);
}

#[tauri::command]
pub fn spotlight_toggle(app: AppHandle) {
    state::apply(&app, Transition::SpotlightToggle);
}

#[tauri::command]
pub fn zoom_toggle(app: AppHandle) {
    state::apply(&app, Transition::ZoomToggle);
}

#[tauri::command]
pub fn set_tool(app: AppHandle, tool: Tool) {
    state::apply(&app, Transition::SetTool(tool));
}

#[tauri::command]
pub fn set_color(app: AppHandle, index: u8) {
    state::apply(&app, Transition::SetColor(index));
}

#[tauri::command]
pub fn set_weight(app: AppHandle, weight: u8) {
    state::apply(&app, Transition::SetWeight(weight));
}

#[tauri::command]
pub fn set_interactive(app: AppHandle, on: bool) {
    state::apply(&app, Transition::SetInteractive(on));
}

#[tauri::command]
pub fn open_settings(app: AppHandle) {
    crate::toolbar::show_settings(&app);
}

#[tauri::command]
pub fn board_create(app: AppHandle, name: Option<String>) -> Result<crate::boards::BoardFile, String> {
    let background = {
        let handle = app.state::<SettingsHandle>();
        let guard = handle.0.lock().unwrap();
        guard.whiteboard.default_background.clone()
    };
    crate::boards::create(&app, name, background)
}

#[tauri::command]
pub fn board_load(app: AppHandle, id: String) -> Result<crate::boards::BoardFile, String> {
    crate::boards::load(&app, &id)
}

#[tauri::command]
pub fn board_save(app: AppHandle, board: crate::boards::BoardFile) -> Result<(), String> {
    crate::boards::save(&app, board)
}

#[tauri::command]
pub fn board_last(app: AppHandle) -> Option<String> {
    crate::boards::last(&app)
}

#[tauri::command]
pub fn board_list(app: AppHandle) -> Vec<crate::boards::BoardMeta> {
    crate::boards::list(&app)
}

#[tauri::command]
pub fn board_rename(app: AppHandle, id: String, name: String) -> Result<(), String> {
    crate::boards::rename(&app, &id, name)
}

#[tauri::command]
pub fn board_delete(app: AppHandle, id: String) -> Result<(), String> {
    crate::boards::delete(&app, &id)
}

#[tauri::command]
pub fn board_panel_toggle(app: AppHandle) {
    use tauri::Emitter;
    let _ = app.emit("board-panel-toggle", ());
}
