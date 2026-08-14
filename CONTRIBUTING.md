# Contributing to Penlight

Thanks for helping make screen annotation on Windows better. Bug reports with
monitor/DPI details are as valuable as code.

## Prerequisites

- Windows 10/11
- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs) stable, MSVC toolchain

## Development loop

```powershell
npm install
npm run tauri dev     # run with hot reload
npm run tauri build   # produce the NSIS installer (src-tauri/target/release/bundle/nsis)
```

Before opening a PR, make sure both of these pass (CI runs the same):

```powershell
npm run build                       # tsc + vite
cargo check --locked                # run inside src-tauri/
```

## Project map

```
overlay.html / toolbar.html / settings.html   Vite MPA entry points (no framework)
src/overlay/       annotation + whiteboard webview (per monitor)
  engine/          display list, stroke smoothing, camera, undo, text tool
src/toolbar/       floating toolbar webview
src/settings/      settings window (tabbed)
src/shared/        IPC wrappers, types, color helpers
src-tauri/src/     Rust: state machine, windows, tray, hotkeys, persistence
  native/          pure-native threads: composition halo/spotlight, zoom lens
```

## Conventions worth knowing

- **Rust owns all mode state.** The webviews render and report input; every
  mode transition goes through the Rust state machine, and windows are created
  from Rust. Don't add frontend-owned state that Rust needs to know about.
- **No frontend framework by design** — vanilla TypeScript keeps the overlay
  light enough to exist once per monitor.
- **Never use the fullscreen Magnification API** for zoom — it is invisible to
  OBS/screen capture. The lens window approach is deliberate.
- **Global shortcut handlers must defer work** to a spawned thread — the
  plugin holds its mutex while handlers run, and re-entering it deadlocks the
  event loop (see `hotkeys.rs`).
- Settings and board files must survive corruption: never overwrite or delete
  a file that fails to parse.
- Values crossing a trust boundary (IPC payloads, files read from disk) get
  validated at the boundary — see `settings::sanitize` and `sanitizeItems`.

## Testing

There is no automated UI test suite; changes are verified by running the app.
When you touch overlays, DPI handling, or capture behavior, please test with
OBS **Display Capture** and note your monitor setup in the PR — multi-monitor
and mixed-DPI regressions are the most common kind.

## Releases

Maintainers release by pushing a version tag; CI builds the installer and
attaches it to a draft GitHub release:

```powershell
git tag v0.2.0
git push origin v0.2.0
```
