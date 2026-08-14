use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::{native, overlay, toolbar, tray};

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Freehand,
    Highlighter,
    Arrow,
    Line,
    Rect,
    Ellipse,
    Text,
    Eraser,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub annotating: bool,
    pub whiteboard: bool,
    /// Overlay window label hosting the whiteboard (one board = one view).
    pub board_host: Option<String>,
    pub toolbar_visible: bool,
    pub interactive: bool,
    pub halo_on: bool,
    pub spotlight_on: bool,
    pub zoom_on: bool,
    pub tool: Tool,
    pub color_index: u8,
    pub weight: u8,
}

pub struct State {
    pub annotating: bool,
    pub whiteboard: bool,
    pub board_host: Option<String>,
    pub toolbar_visible: bool,
    pub interactive: bool,
    pub halo_on: bool,
    pub spotlight_on: bool,
    pub zoom_on: bool,
    pub tool: Tool,
    pub color_index: u8,
    pub weight: u8,
}

impl Default for State {
    fn default() -> Self {
        Self {
            annotating: false,
            whiteboard: false,
            board_host: None,
            toolbar_visible: true,
            interactive: false,
            halo_on: false,
            spotlight_on: false,
            zoom_on: false,
            tool: Tool::Freehand,
            color_index: 0,
            weight: 6,
        }
    }
}

impl State {
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            annotating: self.annotating,
            whiteboard: self.whiteboard,
            board_host: self.board_host.clone(),
            toolbar_visible: self.toolbar_visible,
            interactive: self.interactive,
            halo_on: self.halo_on,
            spotlight_on: self.spotlight_on,
            zoom_on: self.zoom_on,
            tool: self.tool,
            color_index: self.color_index,
            weight: self.weight,
        }
    }
}

#[derive(Default)]
pub struct StateHandle(pub Mutex<State>);

pub enum Transition {
    AnnotateToggle { with_toolbar: bool },
    AnnotateExit,
    WhiteboardToggle,
    HaloToggle,
    SpotlightToggle,
    ZoomToggle,
    SetTool(Tool),
    SetColor(u8),
    SetWeight(u8),
    SetInteractive(bool),
}

/// Every state change in the app routes through here: mutate, then perform
/// window side-effects, then notify native threads, tray, and webviews.
pub fn apply(app: &AppHandle, t: Transition) {
    let handle = app.state::<StateHandle>();
    let mut s = handle.0.lock().unwrap();
    let was_annotating = s.annotating;
    let was_interactive = s.interactive;
    match t {
        Transition::AnnotateToggle { with_toolbar } => {
            if s.annotating {
                s.annotating = false;
                s.whiteboard = false;
                s.board_host = None;
                s.interactive = false;
            } else {
                s.annotating = true;
                s.toolbar_visible = with_toolbar;
            }
        }
        Transition::AnnotateExit => {
            s.annotating = false;
            s.whiteboard = false;
            s.board_host = None;
            s.interactive = false;
        }
        Transition::WhiteboardToggle => {
            if s.annotating {
                s.whiteboard = !s.whiteboard;
            } else {
                s.annotating = true;
                s.whiteboard = true;
                s.toolbar_visible = true;
            }
            s.board_host = if s.whiteboard {
                // The board opens on the monitor under the cursor.
                crate::monitors::overlay_under_cursor(app)
                    .or_else(|| overlay::overlay_windows(app).first().map(|w| w.label().to_string()))
            } else {
                None
            };
            // An opaque board combined with click-through overlays would send
            // clicks into invisible apps underneath — never compose the two.
            s.interactive = false;
        }
        Transition::HaloToggle => s.halo_on = !s.halo_on,
        Transition::SpotlightToggle => s.spotlight_on = !s.spotlight_on,
        Transition::ZoomToggle => s.zoom_on = !s.zoom_on,
        Transition::SetTool(tool) => s.tool = tool,
        Transition::SetColor(i) => s.color_index = i.min(5),
        Transition::SetWeight(w) => s.weight = w.clamp(1, 24),
        Transition::SetInteractive(v) => s.interactive = v,
    }
    let snap = s.snapshot();
    drop(s);

    if snap.annotating != was_annotating {
        if snap.annotating {
            overlay::enter_annotate(app);
        } else {
            overlay::exit_annotate(app);
        }
    }
    if snap.annotating && snap.interactive != was_interactive {
        overlay::set_interactive(app, snap.interactive);
    }
    toolbar::set_visible(app, snap.annotating && snap.toolbar_visible);
    native::sync(app, &snap);
    crate::hotkeys::sync_session(
        app,
        snap.halo_on || snap.spotlight_on || snap.zoom_on,
        snap.zoom_on,
    );
    tray::sync(app, &snap);
    let _ = app.emit("state-changed", &snap);
}
