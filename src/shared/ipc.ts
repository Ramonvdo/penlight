import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BoardFile, BoardMeta, Settings, Snapshot, Tool } from "./types";

export const api = {
  getSnapshot: () => invoke<Snapshot>("get_snapshot"),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (settings: Settings) => invoke<void>("update_settings", { settings }),
  annotateToggle: (withToolbar = true) => invoke<void>("annotate_toggle", { withToolbar }),
  annotateExit: () => invoke<void>("annotate_exit"),
  whiteboardToggle: () => invoke<void>("whiteboard_toggle"),
  haloToggle: () => invoke<void>("halo_toggle"),
  spotlightToggle: () => invoke<void>("spotlight_toggle"),
  zoomToggle: () => invoke<void>("zoom_toggle"),
  setTool: (tool: Tool) => invoke<void>("set_tool", { tool }),
  setColor: (index: number) => invoke<void>("set_color", { index }),
  setWeight: (weight: number) => invoke<void>("set_weight", { weight }),
  setInteractive: (on: boolean) => invoke<void>("set_interactive", { on }),
  openSettings: () => invoke<void>("open_settings"),
  boardCreate: (name?: string) => invoke<BoardFile>("board_create", { name }),
  boardLoad: (id: string) => invoke<BoardFile>("board_load", { id }),
  boardSave: (board: BoardFile) => invoke<void>("board_save", { board }),
  boardLast: () => invoke<string | null>("board_last"),
  boardList: () => invoke<BoardMeta[]>("board_list"),
  boardRename: (id: string, name: string) => invoke<void>("board_rename", { id, name }),
  boardDelete: (id: string) => invoke<void>("board_delete", { id }),
  boardPanelToggle: () => invoke<void>("board_panel_toggle"),
  isPackaged: () => invoke<boolean>("is_packaged"),
};

export function onBoardPanelToggle(cb: () => void): Promise<UnlistenFn> {
  return listen("board-panel-toggle", () => cb());
}

export function onStateChanged(cb: (s: Snapshot) => void): Promise<UnlistenFn> {
  return listen<Snapshot>("state-changed", (e) => cb(e.payload));
}

export function onSettingsChanged(cb: (s: Settings) => void): Promise<UnlistenFn> {
  return listen<Settings>("settings-changed", (e) => cb(e.payload));
}

export function onAnnotateClear(cb: () => void): Promise<UnlistenFn> {
  return listen("annotate-clear", () => cb());
}
