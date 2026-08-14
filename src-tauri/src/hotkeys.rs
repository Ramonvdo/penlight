use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::settings::SettingsHandle;
use crate::state::{self, Transition};

const ACTIONS: &[&str] = &[
    "annotate",
    "annotate_no_toolbar",
    "whiteboard",
    "halo",
    "spotlight",
    "zoom",
];

/// Registered only while halo/spotlight/zoom is active, so the combos are
/// stolen from other apps as briefly as possible.
const SESSION_ACTIONS: &[(&str, &str)] = &[
    ("size_down", "Ctrl+Alt+Minus"),
    ("size_up", "Ctrl+Alt+Equal"),
    ("zoom_out", "Ctrl+Alt+Comma"),
    ("zoom_in", "Ctrl+Alt+Period"),
];

/// Esc exits zoom (ZoomIt parity). Registered ONLY while zoom is on — never
/// for halo/spotlight, where stealing Esc system-wide would break every app.
const ESC_ACCEL: &str = "Escape";

static SESSION_ACTIVE: AtomicBool = AtomicBool::new(false);
static ESC_ACTIVE: AtomicBool = AtomicBool::new(false);

/// DEADLOCK GUARD: the global-shortcut plugin holds its internal `shortcuts`
/// mutex for the whole duration of a handler, and handlers run inline on the
/// main thread's message pump. Any path from a handler back into the plugin
/// (register/unregister) or into blocking main-thread work must therefore be
/// deferred to a fresh thread — NOT `run_on_main_thread`, whose main-thread
/// fast path executes inline and deadlocks identically.
fn deferred<F: FnOnce(&AppHandle) + Send + 'static>(app: &AppHandle, f: F) {
    let app = app.clone();
    std::thread::spawn(move || f(&app));
}

pub fn register_all(app: &AppHandle) {
    let shortcuts = {
        let handle = app.state::<SettingsHandle>();
        let guard = handle.0.lock().unwrap();
        guard.shortcuts.clone()
    };
    for action in ACTIONS {
        let Some(accel) = shortcuts.get(*action) else {
            continue;
        };
        if accel.is_empty() {
            continue;
        }
        let action_owned = action.to_string();
        let result = app.global_shortcut().on_shortcut(
            accel.as_str(),
            move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let action = action_owned.clone();
                    deferred(app, move |app| dispatch(app, &action));
                }
            },
        );
        if let Err(e) = result {
            // AlreadyRegistered surfaces here (another app owns the combo).
            eprintln!("[penlight] could not register '{action}' = {accel}: {e}");
        }
    }
}

/// Called from settings updates — must run OUTSIDE any shortcut handler
/// (settings::update guarantees this via the deferred session dispatch).
pub fn reregister(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
    register_all(app);
    if SESSION_ACTIVE.load(Ordering::SeqCst) {
        register_session(app);
    }
    if ESC_ACTIVE.load(Ordering::SeqCst) {
        register_esc(app);
    }
}

/// Keep session shortcuts registered exactly while any cursor feature is on.
/// Runs on a deferred thread when triggered from a hotkey (see `deferred`).
pub fn sync_session(app: &AppHandle, any_active: bool, zoom_active: bool) {
    let was = SESSION_ACTIVE.swap(any_active, Ordering::SeqCst);
    if was != any_active {
        if any_active {
            register_session(app);
        } else {
            for (_, accel) in SESSION_ACTIONS {
                let _ = app.global_shortcut().unregister(*accel);
            }
        }
    }
    let esc_was = ESC_ACTIVE.swap(zoom_active, Ordering::SeqCst);
    if esc_was != zoom_active {
        if zoom_active {
            register_esc(app);
        } else {
            let _ = app.global_shortcut().unregister(ESC_ACCEL);
        }
    }
}

fn register_esc(app: &AppHandle) {
    let result = app
        .global_shortcut()
        .on_shortcut(ESC_ACCEL, move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                deferred(app, |app| {
                    let zoom_on = {
                        let handle = app.state::<crate::state::StateHandle>();
                        let guard = handle.0.lock().unwrap();
                        guard.zoom_on
                    };
                    if zoom_on {
                        state::apply(app, Transition::ZoomToggle);
                    }
                });
            }
        });
    if let Err(e) = result {
        eprintln!("[penlight] could not register Esc for zoom: {e}");
    }
}

fn register_session(app: &AppHandle) {
    for (action, accel) in SESSION_ACTIONS {
        let action_owned = action.to_string();
        let result = app
            .global_shortcut()
            .on_shortcut(*accel, move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let action = action_owned.clone();
                    deferred(app, move |app| dispatch_session(app, &action));
                }
            });
        if let Err(e) = result {
            eprintln!("[penlight] could not register session key {action} = {accel}: {e}");
        }
    }
}

fn dispatch(app: &AppHandle, action: &str) {
    match action {
        "annotate" => state::apply(app, Transition::AnnotateToggle { with_toolbar: true }),
        "annotate_no_toolbar" => {
            state::apply(app, Transition::AnnotateToggle { with_toolbar: false })
        }
        "whiteboard" => state::apply(app, Transition::WhiteboardToggle),
        "halo" => state::apply(app, Transition::HaloToggle),
        "spotlight" => state::apply(app, Transition::SpotlightToggle),
        "zoom" => state::apply(app, Transition::ZoomToggle),
        _ => {}
    }
}

fn dispatch_session(app: &AppHandle, action: &str) {
    let snap = {
        let handle = app.state::<crate::state::StateHandle>();
        let guard = handle.0.lock().unwrap();
        guard.snapshot()
    };
    // Read-modify-write atomically under the settings lock so concurrent
    // session-key presses can't clobber each other; clone for the pipeline.
    let updated = {
        let handle = app.state::<SettingsHandle>();
        let mut guard = handle.0.lock().unwrap();
        match action {
            "size_down" | "size_up" => {
                let delta_sign: i32 = if action == "size_up" { 1 } else { -1 };
                if snap.zoom_on {
                    let next = i32::from(guard.zoom.lens_size) + delta_sign * 40;
                    guard.zoom.lens_size = next.clamp(200, 600) as u16;
                } else if snap.spotlight_on {
                    let next = i32::from(guard.spotlight.radius) + delta_sign * 20;
                    guard.spotlight.radius = next.clamp(60, 400) as u16;
                } else if snap.halo_on {
                    let next = i32::from(guard.cursor.size) + delta_sign * 8;
                    guard.cursor.size = next.clamp(24, 200) as u16;
                } else {
                    return;
                }
            }
            "zoom_in" | "zoom_out" => {
                if !snap.zoom_on {
                    return;
                }
                let delta = if action == "zoom_in" { 0.5 } else { -0.5 };
                guard.zoom.default_level = (guard.zoom.default_level + delta).clamp(1.5, 8.0);
            }
            _ => return,
        }
        guard.clone()
    };
    crate::settings::update(app, updated);
}
