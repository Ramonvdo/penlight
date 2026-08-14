# Changelog

All notable changes to Penlight are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-08-14

First release.

### Added

**Annotation**
- Draw over any app: freehand pen, highlighter, arrows, lines, rectangles,
  ellipses, and click-to-place text — smoothed with perfect-freehand, rendered
  from a display list (never a frozen bitmap), so everything underneath keeps
  playing.
- 5 favorite colors plus random gradient strokes, adjustable line weight,
  unlimited undo/redo, optional auto-erase per stroke (hold Ctrl to invert),
  Shift to constrain shapes, Alt to fill.
- Interactive mode: keep ink on screen while clicking through to the apps
  underneath. Per-tool cursors — the pen cursor is an ink preview: a dot in
  the current color at the current line weight.

**Whiteboard**
- Persistent boards: one JSON file per board in app-data, atomic autosaved
  writes, corrupt files surfaced but never overwritten or deleted.
- Infinite canvas with Excalidraw-style navigation: wheel pan
  (Shift = horizontal), Ctrl+wheel zoom-at-cursor (0.1–30×), space/middle-drag
  panning, Ctrl+0 reset, viewport culling.
- Board library panel: create, rename, two-step delete, and switch boards
  (`B` while on the whiteboard); resume-last-board or always-new behavior.

**Cursor tools**
- Cursor halo (ring, squircle, or rhombus) with left/right-click pulse
  animations — a pure-native composition thread moving visuals at vsync,
  ~0% idle CPU (PowerToys Mouse Highlighter pattern).
- Spotlight: dim everything except a soft circle following the cursor.
- Session hotkeys while a cursor feature is active: Ctrl+Alt+−/= resizes the
  halo or spotlight, Ctrl+Alt+,/. adjusts zoom level.

**Zoom**
- Live magnifier lens following the cursor (rounded square or circle), built
  on the ZoomIt LiveZoom architecture with glass chrome drawn on the
  composition layer. Full-monitor magnification available as an option.
- The zoomed view is part of the desktop composition, so it **shows up in OBS
  Display Capture** — the fullscreen Magnification API (invisible to capture)
  is deliberately never used.

**App**
- Tray-only footprint; every feature on a rebindable global hotkey
  (Ctrl+Alt defaults). Six-tab settings window with live halo/spotlight
  previews and click-to-record shortcut fields.
- Multi-monitor and mixed-DPI aware: one overlay per monitor at physical
  pixels, display-change rebuilds, per-monitor DPI cache.
- Start-at-login option, single-instance guard, ~1 MB per-user NSIS installer
  (no admin required).

### Fixed (pre-release hardening)

- Global-shortcut self-deadlock: handlers re-entering the plugin froze the
  event loop; all hotkey dispatch now defers to a spawned thread.
- Release-build CSP blocked all IPC (missing `ipc.localhost` allowance).
- Toolbar lost clicks after tapping an overlay (z-order re-raise on overlay
  focus); toolbar repositioned after display changes.
- Settings survived: parse errors no longer overwrite the file with defaults;
  session-key read-modify-write races fixed; zoom lifecycle races
  (config-before-window, display changes, cursor restore on quit) fixed.

### Security

- Settings and board files are validated at the trust boundary: malformed
  colors/enums/accelerators are rejected before they persist or reach native
  code, board ids are structurally confined to the boards directory, and
  board items are deep-validated and rebuilt on load so a corrupt or hostile
  file cannot crash the overlay.
- Hardened release pipeline: GitHub Actions pinned to commit SHAs, checkout
  credentials not persisted, and a `SHA256SUMS.txt` attached to every release
  for download verification.

[0.1.0]: https://github.com/Ramonvdo/penlight/releases/tag/v0.1.0
