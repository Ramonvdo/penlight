use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct MonitorRect {
    pub label: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Default)]
pub struct MonitorMap(pub Mutex<Vec<MonitorRect>>);

pub fn set(app: &AppHandle, rects: Vec<MonitorRect>) {
    if let Some(map) = app.try_state::<MonitorMap>() {
        *map.0.lock().unwrap() = rects;
    } else {
        app.manage(MonitorMap(Mutex::new(rects)));
    }
}

/// Poll-based display-change detection (the native presenter thread will take
/// over with WM_DISPLAYCHANGE in M3; this stays as a fallback).
pub fn check_changed(app: &AppHandle) {
    let Ok(current) = app.available_monitors() else {
        return;
    };
    let mut cur: Vec<(i32, i32, u32, u32)> = current
        .iter()
        .map(|m| {
            let p = m.position();
            let s = m.size();
            (p.x, p.y, s.width, s.height)
        })
        .collect();
    cur.sort_unstable();
    let stored = {
        let Some(map) = app.try_state::<MonitorMap>() else {
            return;
        };
        let rects = map.0.lock().unwrap();
        let mut v: Vec<(i32, i32, u32, u32)> =
            rects.iter().map(|r| (r.x, r.y, r.w, r.h)).collect();
        v.sort_unstable();
        v
    };
    if cur != stored {
        eprintln!("[penlight] display configuration changed; rebuilding overlays");
        crate::overlay::rebuild(app);
        crate::toolbar::reposition(app);
    }
}

/// Label of the overlay window on the monitor currently under the cursor.
pub fn overlay_under_cursor(app: &AppHandle) -> Option<String> {
    let pos = app.cursor_position().ok()?;
    let map = app.try_state::<MonitorMap>()?;
    let rects = map.0.lock().unwrap();
    rects
        .iter()
        .find(|r| {
            (pos.x as i32) >= r.x
                && (pos.x as i32) < r.x + r.w as i32
                && (pos.y as i32) >= r.y
                && (pos.y as i32) < r.y + r.h as i32
        })
        .map(|r| r.label.clone())
}
