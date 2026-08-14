//! Board persistence: one JSON file per whiteboard in app-data `boards/`.
//! Rust owns the files; the frontend owns the item schema (`items` is opaque
//! serde_json::Value here so item evolution never needs a Rust change).
//! Corruption policy follows settings::load: a file that fails to parse is
//! surfaced as an error and NEVER overwritten or deleted.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const LAST_STORE: &str = "boards.json";
const LAST_KEY: &str = "lastBoardId";

/// Serializes all board filesystem operations.
#[derive(Default)]
pub struct BoardsHandle(pub Mutex<()>);

fn default_board_version() -> u32 {
    1
}

fn default_background() -> String {
    "#FFFFFF".into()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraState {
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub zoom: f64,
}

impl Default for CameraState {
    fn default() -> Self {
        Self {
            scroll_x: 0.0,
            scroll_y: 0.0,
            zoom: 1.0,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardFile {
    #[serde(default = "default_board_version")]
    pub board_version: u32,
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default = "default_background")]
    pub background: String,
    #[serde(default)]
    pub camera: CameraState,
    #[serde(default)]
    pub items: Vec<Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardMeta {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub updated_at: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn valid_id(id: &str) -> bool {
    // The mandatory "board-" prefix (every generated id has it) structurally
    // rules out Windows reserved device basenames (CON, NUL, COM1, ...).
    id.len() <= 64
        && id.starts_with("board-")
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Board names come from the webview unchecked; the UI caps them at 60 chars
/// but the IPC boundary must enforce its own ceiling.
const MAX_NAME_CHARS: usize = 200;

fn clamp_name(name: String) -> String {
    if name.chars().count() <= MAX_NAME_CHARS {
        name
    } else {
        name.chars().take(MAX_NAME_CHARS).collect()
    }
}

fn boards_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("boards");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create boards dir: {e}"))?;
    Ok(dir)
}

fn board_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid board id".into());
    }
    Ok(boards_dir(app)?.join(format!("{id}.json")))
}

/// Atomic-ish write: full content to a .tmp sibling, fsync, then rename over
/// the target (Rust's fs::rename replaces on Windows via
/// MOVEFILE_REPLACE_EXISTING). The sync_all before the rename matters: without
/// it a crash can promote a tmp file whose contents were still in the OS
/// cache, leaving the target truncated — the corruption this module promises
/// never to cause.
fn write_board(path: &PathBuf, board: &BoardFile) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(board).map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("write failed: {e}"))?;
    file.write_all(&json).map_err(|e| format!("write failed: {e}"))?;
    file.sync_all().map_err(|e| format!("sync failed: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|e| format!("rename failed: {e}"))
}

fn set_last(app: &AppHandle, id: &str) {
    if let Ok(store) = app.store(LAST_STORE) {
        store.set(LAST_KEY, Value::String(id.to_string()));
        let _ = store.save();
    }
}

pub fn last(app: &AppHandle) -> Option<String> {
    let store = app.store(LAST_STORE).ok()?;
    store.get(LAST_KEY).and_then(|v| v.as_str().map(String::from))
}

pub fn create(app: &AppHandle, name: Option<String>, background: String) -> Result<BoardFile, String> {
    let handle = app.state::<BoardsHandle>();
    let _guard = handle.0.lock().unwrap();
    let dir = boards_dir(app)?;
    let now = now_ms();
    let mut id = format!("board-{now}");
    let mut bump = 0u32;
    while dir.join(format!("{id}.json")).exists() {
        bump += 1;
        id = format!("board-{now}-{bump}");
    }
    let board = BoardFile {
        board_version: 1,
        id: id.clone(),
        name: clamp_name(name.unwrap_or_else(|| "Untitled board".into())),
        created_at: now,
        updated_at: now,
        background,
        camera: CameraState::default(),
        items: Vec::new(),
    };
    write_board(&dir.join(format!("{id}.json")), &board)?;
    set_last(app, &id);
    Ok(board)
}

/// Read + parse without taking the lock (callers hold it).
fn read_board(app: &AppHandle, id: &str) -> Result<BoardFile, String> {
    let path = board_path(app, id)?;
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("cannot read board: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| {
        // File is left untouched on disk — never destroy user data.
        eprintln!("[penlight] board {id} failed to parse (file kept): {e}");
        format!("board file is corrupt: {e}")
    })
}

pub fn load(app: &AppHandle, id: &str) -> Result<BoardFile, String> {
    let handle = app.state::<BoardsHandle>();
    let _guard = handle.0.lock().unwrap();
    let board = read_board(app, id)?;
    set_last(app, id);
    Ok(board)
}

pub fn save(app: &AppHandle, mut board: BoardFile) -> Result<(), String> {
    let handle = app.state::<BoardsHandle>();
    let _guard = handle.0.lock().unwrap();
    let path = board_path(app, &board.id)?;
    // A late autosave of a just-deleted board must fail harmlessly instead of
    // resurrecting it: only board_create brings files into existence.
    if !path.exists() {
        return Err("board no longer exists".into());
    }
    board.board_version = 1;
    board.updated_at = now_ms();
    write_board(&path, &board)
}

pub fn list(app: &AppHandle) -> Vec<BoardMeta> {
    let handle = app.state::<BoardsHandle>();
    let _guard = handle.0.lock().unwrap();
    let Ok(dir) = boards_dir(app) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut boards: Vec<BoardMeta> = entries
        .flatten()
        .filter(|e| {
            let path = e.path();
            // Sweep tmp files stranded by an interrupted write; the target
            // file (previous complete version) is still intact next to them.
            if path.extension().map(|x| x == "tmp").unwrap_or(false) {
                let _ = std::fs::remove_file(&path);
                return false;
            }
            path.extension().map(|x| x == "json").unwrap_or(false)
        })
        .filter_map(|e| {
            let raw = std::fs::read_to_string(e.path()).ok()?;
            // Unparseable files are skipped, never deleted.
            let board: BoardFile = serde_json::from_str(&raw).ok()?;
            Some(BoardMeta {
                id: board.id,
                name: board.name,
                created_at: board.created_at,
                updated_at: board.updated_at,
            })
        })
        .collect();
    boards.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    boards
}

pub fn rename(app: &AppHandle, id: &str, name: String) -> Result<(), String> {
    let handle = app.state::<BoardsHandle>();
    let _guard = handle.0.lock().unwrap();
    let mut board = read_board(app, id)?;
    board.name = clamp_name(name);
    board.updated_at = now_ms();
    write_board(&board_path(app, id)?, &board)
}

pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    let handle = app.state::<BoardsHandle>();
    let _guard = handle.0.lock().unwrap();
    let path = board_path(app, id)?;
    std::fs::remove_file(&path).map_err(|e| format!("delete failed: {e}"))
}
