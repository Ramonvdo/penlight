#[cfg(windows)]
mod composition;
#[cfg(windows)]
mod presenter;
#[cfg(windows)]
mod zoom;

use std::sync::RwLock;
use tauri::{AppHandle, Manager};

use crate::settings::{Settings, SettingsHandle};
use crate::state::Snapshot;

/// Published by the zoom thread every tick; the presenter reads it to place
/// the halo where the MAGNIFIED cursor appears (the real cursor is hidden
/// while zoomed, and the halo doubles as the recording-visible cursor).
#[derive(Clone, Copy)]
pub struct ZoomTransform {
    pub mon_x: i32,
    pub mon_y: i32,
    pub mon_w: i32,
    pub mon_h: i32,
    pub src_x: f32,
    pub src_y: f32,
    pub zoom: f32,
}

pub static ZOOM_STATE: RwLock<Option<ZoomTransform>> = RwLock::new(None);

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HaloShape {
    Ring,
    Squircle,
    Rhombus,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HaloVisibility {
    Always,
    Clicks,
    Moving,
}

/// Everything the presenter thread needs, rebuilt on every state/settings
/// change and handed over through a lock + PostMessage wake.
#[derive(Clone)]
pub struct PresenterConfig {
    pub halo_on: bool,
    pub spotlight_on: bool,
    pub shape: HaloShape,
    pub color: (u8, u8, u8),
    pub size: f32,
    pub border_width: f32,
    pub dashed: bool,
    pub opacity: f32,
    pub pulse_on_click: bool,
    pub visibility: HaloVisibility,
    pub spot_radius: f32,
    pub spot_dim: f32,
    pub spot_color: (u8, u8, u8),
    /// Lens chrome (anti-aliased ring + glass sheen drawn on the composition
    /// layer above the magnifier window) — active only for lens-style zoom.
    pub lens_active: bool,
    pub lens_size: f32,
    pub lens_circle: bool,
    pub lens_border_width: f32,
    pub lens_border_color: (u8, u8, u8),
}

fn parse_hex(color: &str) -> (u8, u8, u8) {
    let hex = color.trim_start_matches('#');
    // is_ascii guarantees the byte-offset slices below land on char
    // boundaries — a multi-byte value must not panic (panic = abort here).
    if hex.len() == 6 && hex.is_ascii() {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&hex[0..2], 16),
            u8::from_str_radix(&hex[2..4], 16),
            u8::from_str_radix(&hex[4..6], 16),
        ) {
            return (r, g, b);
        }
    }
    (246, 51, 154)
}

fn build_config(settings: &Settings, snap: &Snapshot) -> PresenterConfig {
    let c = &settings.cursor;
    // Lens-style zoom keeps the real system cursor visible (the magnified
    // point under the glass center IS the cursor position), so the halo stays
    // the user's choice. Monitor-style zoom hides the system cursor and the
    // halo takes over as the visible cursor.
    let monitor_zoom = snap.zoom_on && settings.zoom.style == "monitor";
    let lens_zoom = snap.zoom_on && settings.zoom.style != "monitor";
    PresenterConfig {
        halo_on: snap.halo_on || monitor_zoom,
        spotlight_on: snap.spotlight_on,
        shape: match c.shape.as_str() {
            "squircle" => HaloShape::Squircle,
            "rhombus" => HaloShape::Rhombus,
            _ => HaloShape::Ring,
        },
        color: parse_hex(&c.color),
        size: f32::from(c.size).clamp(16.0, 400.0),
        border_width: f32::from(c.border_width).clamp(1.0, 24.0),
        dashed: c.border_style == "dashed",
        opacity: c.opacity.clamp(0.05, 1.0),
        pulse_on_click: c.pulse_on_click,
        visibility: if monitor_zoom {
            // Halo is the only cursor in monitor zoom — never hide it.
            HaloVisibility::Always
        } else {
            match c.visibility.as_str() {
                "clicks" => HaloVisibility::Clicks,
                "moving" => HaloVisibility::Moving,
                _ => HaloVisibility::Always,
            }
        },
        spot_radius: f32::from(settings.spotlight.radius).clamp(40.0, 800.0),
        spot_dim: settings.spotlight.dim_opacity.clamp(0.1, 0.98),
        spot_color: parse_hex(&settings.spotlight.dim_color),
        lens_active: lens_zoom,
        lens_size: f32::from(settings.zoom.lens_size).clamp(120.0, 800.0),
        lens_circle: settings.zoom.shape == "circle",
        lens_border_width: f32::from(settings.zoom.border_width).clamp(0.0, 12.0),
        lens_border_color: parse_hex(&settings.zoom.border_color),
    }
}

#[cfg(windows)]
pub fn init(_app: &AppHandle) {
    presenter::spawn();
    zoom::spawn();
}

#[cfg(not(windows))]
pub fn init(_app: &AppHandle) {}

/// Called from the state machine on every transition, and from settings
/// updates. Rebuilds the native config and wakes the presenter thread.
pub fn sync(app: &AppHandle, snap: &Snapshot) {
    let settings = {
        let handle = app.state::<SettingsHandle>();
        let guard = handle.0.lock().unwrap();
        guard.clone()
    };
    let config = build_config(&settings, snap);
    #[cfg(windows)]
    {
        presenter::update(config);
        zoom::update(zoom::ZoomConfig {
            on: snap.zoom_on,
            target: settings.zoom.default_level.clamp(1.25, 32.0),
            smoothing: settings.zoom.smoothing,
            lens: settings.zoom.style != "monitor",
            lens_size: settings.zoom.lens_size,
            circle: settings.zoom.shape == "circle",
        });
    }
    #[cfg(not(windows))]
    let _ = config;
}

/// App is quitting: make sure the hidden system cursor is restored.
pub fn shutdown() {
    #[cfg(windows)]
    zoom::shutdown();
}

/// Settings changed without a state transition (e.g. from the settings UI).
pub fn sync_settings(app: &AppHandle) {
    let snap = {
        let handle = app.state::<crate::state::StateHandle>();
        let guard = handle.0.lock().unwrap();
        guard.snapshot()
    };
    sync(app, &snap);
}
