use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

pub const SETTINGS_VERSION: u32 = 2;
const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "settings";

fn default_version() -> u32 {
    SETTINGS_VERSION
}

fn default_shortcuts() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("annotate".to_string(), "Ctrl+Alt+A".to_string()),
        ("annotate_no_toolbar".to_string(), "Ctrl+Alt+Shift+A".to_string()),
        ("whiteboard".to_string(), "Ctrl+Alt+W".to_string()),
        ("halo".to_string(), "Ctrl+Alt+H".to_string()),
        ("spotlight".to_string(), "Ctrl+Alt+L".to_string()),
        ("zoom".to_string(), "Ctrl+Alt+Z".to_string()),
    ])
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AnnotateCfg {
    pub favorite_colors: [String; 5],
    pub default_weight: u8,
    /// 0 = auto-erase off
    pub auto_erase_secs: u8,
    pub board_color: String,
    pub text_size: u8,
    /// Vary stroke width with tablet-pen pressure.
    pub pressure_sensitivity: bool,
}

impl Default for AnnotateCfg {
    fn default() -> Self {
        Self {
            favorite_colors: [
                "#2FB4F6".into(),
                "#EF5350".into(),
                "#5DC963".into(),
                "#FFD52E".into(),
                "#9B59E8".into(),
            ],
            default_weight: 6,
            auto_erase_secs: 0,
            board_color: "#FFFFFF".into(),
            text_size: 28,
            pressure_sensitivity: true,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CursorCfg {
    /// "ring" | "squircle" | "rhombus"
    pub shape: String,
    pub color: String,
    pub size: u16,
    /// "solid" | "dashed"
    pub border_style: String,
    pub border_width: u8,
    pub opacity: f32,
    pub pulse_on_click: bool,
    /// "always" | "clicks" | "moving"
    pub visibility: String,
}

impl Default for CursorCfg {
    fn default() -> Self {
        Self {
            shape: "ring".into(),
            color: "#F6339A".into(),
            size: 64,
            border_style: "solid".into(),
            border_width: 4,
            opacity: 0.9,
            pulse_on_click: true,
            visibility: "always".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SpotlightCfg {
    pub radius: u16,
    pub dim_opacity: f32,
    pub dim_color: String,
}

impl Default for SpotlightCfg {
    fn default() -> Self {
        Self {
            radius: 160,
            dim_opacity: 0.75,
            dim_color: "#000000".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ZoomCfg {
    pub default_level: f32,
    pub smoothing: bool,
    /// "lens" (magnifying glass following the cursor) | "monitor" (full-screen)
    pub style: String,
    /// Lens diameter in physical pixels
    pub lens_size: u16,
    /// "rounded" | "circle"
    pub shape: String,
    pub border_width: u8,
    pub border_color: String,
}

impl Default for ZoomCfg {
    fn default() -> Self {
        Self {
            default_level: 2.0,
            smoothing: true,
            style: "lens".into(),
            lens_size: 340,
            shape: "rounded".into(),
            border_width: 3,
            border_color: "#FFFFFF".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WhiteboardCfg {
    /// "resume" (reopen the last board) | "new" (blank board every time)
    pub on_open: String,
    pub default_background: String,
}

impl Default for WhiteboardCfg {
    fn default() -> Self {
        Self {
            on_open: "resume".into(),
            default_background: "#FFFFFF".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_version")]
    pub settings_version: u32,
    pub launch_at_login: bool,
    pub halo_on_launch: bool,
    pub disable_gpu_compositing: bool,
    /// Show a live pointer-event readout on the overlay (tablet troubleshooting).
    pub input_diagnostics: bool,
    pub annotate: AnnotateCfg,
    pub whiteboard: WhiteboardCfg,
    pub cursor: CursorCfg,
    pub spotlight: SpotlightCfg,
    pub zoom: ZoomCfg,
    #[serde(default = "default_shortcuts")]
    pub shortcuts: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            settings_version: SETTINGS_VERSION,
            launch_at_login: false,
            halo_on_launch: false,
            disable_gpu_compositing: false,
            input_diagnostics: false,
            annotate: AnnotateCfg::default(),
            whiteboard: WhiteboardCfg::default(),
            cursor: CursorCfg::default(),
            spotlight: SpotlightCfg::default(),
            zoom: ZoomCfg::default(),
            shortcuts: default_shortcuts(),
        }
    }
}

pub struct SettingsHandle(pub Mutex<Settings>);

fn valid_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn sanitize_color(value: &mut String, default: &str) {
    if !valid_hex_color(value) {
        *value = default.into();
    }
}

fn sanitize_enum(value: &mut String, allowed: &[&str], default: &str) {
    if !allowed.contains(&value.as_str()) {
        *value = default.into();
    }
}

fn sanitize_f32(value: &mut f32, default: f32) {
    if !value.is_finite() {
        *value = default;
    }
}

/// A global accelerator is accepted only if the plugin can parse it AND it
/// carries a real modifier (Ctrl/Alt/Win). A bare or Shift-only key would be
/// stolen system-wide and shadow normal typing in every app; standalone
/// F-keys are the one conventional exception.
fn valid_accelerator(accel: &str) -> bool {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    let Ok(shortcut) = Shortcut::from_str(accel) else {
        return false;
    };
    if shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return true;
    }
    matches!(
        shortcut.key,
        Code::F1
            | Code::F2
            | Code::F3
            | Code::F4
            | Code::F5
            | Code::F6
            | Code::F7
            | Code::F8
            | Code::F9
            | Code::F10
            | Code::F11
            | Code::F12
    )
}

/// Reject malformed values at the trust boundary — both IPC payloads from the
/// webviews and the on-disk settings file — so they can never persist or
/// reach native code / the global-shortcut registry.
pub fn sanitize(s: &mut Settings) {
    let d = Settings::default();
    for (color, default) in s
        .annotate
        .favorite_colors
        .iter_mut()
        .zip(d.annotate.favorite_colors.iter())
    {
        if !valid_hex_color(color) {
            color.clone_from(default);
        }
    }
    sanitize_color(&mut s.annotate.board_color, &d.annotate.board_color);
    sanitize_color(
        &mut s.whiteboard.default_background,
        &d.whiteboard.default_background,
    );
    sanitize_color(&mut s.cursor.color, &d.cursor.color);
    sanitize_color(&mut s.spotlight.dim_color, &d.spotlight.dim_color);
    sanitize_color(&mut s.zoom.border_color, &d.zoom.border_color);
    sanitize_enum(&mut s.cursor.shape, &["ring", "squircle", "rhombus"], "ring");
    sanitize_enum(&mut s.cursor.border_style, &["solid", "dashed"], "solid");
    sanitize_enum(
        &mut s.cursor.visibility,
        &["always", "clicks", "moving"],
        "always",
    );
    sanitize_enum(&mut s.zoom.style, &["lens", "monitor"], "lens");
    sanitize_enum(&mut s.zoom.shape, &["rounded", "circle"], "rounded");
    sanitize_enum(&mut s.whiteboard.on_open, &["resume", "new"], "resume");
    sanitize_f32(&mut s.cursor.opacity, d.cursor.opacity);
    sanitize_f32(&mut s.spotlight.dim_opacity, d.spotlight.dim_opacity);
    sanitize_f32(&mut s.zoom.default_level, d.zoom.default_level);
    // Shortcuts: only known actions survive (the map cannot grow unboundedly),
    // and an unparseable or hijack-prone accelerator falls back to that
    // action's default binding. Empty string = deliberately unbound.
    let defaults = default_shortcuts();
    let mut clean = BTreeMap::new();
    for (action, default_accel) in &defaults {
        let accel = s
            .shortcuts
            .get(action)
            .cloned()
            .unwrap_or_else(|| default_accel.clone());
        let accel = if accel.is_empty() || valid_accelerator(&accel) {
            accel
        } else {
            default_accel.clone()
        };
        clean.insert(action.clone(), accel);
    }
    s.shortcuts = clean;
}

pub fn load(app: &AppHandle) -> Settings {
    match app.store(STORE_FILE) {
        Ok(store) => match store.get(STORE_KEY) {
            None => {
                let settings = Settings::default();
                store.set(STORE_KEY, serde_json::to_value(&settings).unwrap());
                let _ = store.save();
                settings
            }
            Some(value) => match serde_json::from_value::<Settings>(value) {
                Ok(mut settings) => {
                    // v1 -> v2: the whiteboard background moved from the
                    // annotate section to its own config.
                    if settings.settings_version < 2 {
                        settings.whiteboard.default_background =
                            settings.annotate.board_color.clone();
                        settings.settings_version = SETTINGS_VERSION;
                    }
                    // A hand-edited (or maliciously written) settings file
                    // must never crash-loop the app at launch.
                    sanitize(&mut settings);
                    // Write back so newly-added keys are persisted immediately.
                    store.set(STORE_KEY, serde_json::to_value(&settings).unwrap());
                    let _ = store.save();
                    settings
                }
                Err(e) => {
                    // Use defaults in memory but DO NOT overwrite the stored
                    // file — a parse bug must never destroy user settings.
                    eprintln!("[penlight] settings parse failed, using defaults (file kept): {e}");
                    Settings::default()
                }
            },
        },
        Err(e) => {
            eprintln!("[penlight] failed to open settings store: {e}");
            Settings::default()
        }
    }
}

pub fn save_now(app: &AppHandle) {
    let settings = {
        let handle = app.state::<SettingsHandle>();
        let guard = handle.0.lock().unwrap();
        guard.clone()
    };
    persist(app, &settings);
}

fn persist(app: &AppHandle, settings: &Settings) {
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(STORE_KEY, serde_json::to_value(settings).unwrap());
        // Explicit save: the plugin's debounced auto-save can lose a write on
        // a crash right after a change.
        if let Err(e) = store.save() {
            eprintln!("[penlight] failed to save settings: {e}");
        }
    }
}

pub fn update(app: &AppHandle, mut new_settings: Settings) {
    new_settings.settings_version = SETTINGS_VERSION;
    // Sanitize BEFORE the persist below: a malformed value must never reach
    // disk, native code, or the global-shortcut registry.
    sanitize(&mut new_settings);
    let launch_at_login = new_settings.launch_at_login;
    let shortcuts_changed = {
        let handle = app.state::<SettingsHandle>();
        let mut guard = handle.0.lock().unwrap();
        let changed = guard.shortcuts != new_settings.shortcuts;
        *guard = new_settings.clone();
        changed
    };
    persist(app, &new_settings);
    sync_autostart(app, launch_at_login);
    // Only touch the global-shortcut plugin when bindings actually changed —
    // every touch transiently unregisters all hotkeys, and callers may be on
    // a deferred session-key thread.
    if shortcuts_changed {
        crate::hotkeys::reregister(app);
    }
    crate::native::sync_settings(app);
    let _ = app.emit("settings-changed", &new_settings);
}

fn sync_autostart(app: &AppHandle, enable: bool) {
    use tauri_plugin_autostart::ManagerExt;
    // MSIX virtualizes the Run key, so writing it would look like it worked and
    // silently do nothing. The packaged build starts with Windows through the
    // manifest's StartupTask, which the user enables in Windows Settings.
    if crate::win32::is_packaged() {
        return;
    }
    let autolaunch = app.autolaunch();
    let result = if enable {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    if let Err(e) = result {
        eprintln!("[penlight] autostart update failed: {e}");
    }
}
