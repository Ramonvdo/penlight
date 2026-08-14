import { DisplayList } from "./display-list";
import { UndoStack } from "./undo";

/**
 * Camera in Excalidraw's convention: scroll is in WORLD units, applied before
 * scaling. world = screen/zoom − scroll; screen = (world + scroll)·zoom.
 */
export interface Camera {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/**
 * The engine draws against exactly one document at a time. Screen annotation
 * is an ephemeral doc with camera = null (identity — the pre-whiteboard code
 * path, byte for byte); each whiteboard is a persistent doc with a camera.
 */
export interface Doc {
  kind: "screen" | "board";
  list: DisplayList;
  undo: UndoStack;
  camera: Camera | null;
  boardId?: string;
}

export function newScreenDoc(): Doc {
  return { kind: "screen", list: new DisplayList(), undo: new UndoStack(), camera: null };
}

export function newBoardDoc(boardId: string, camera: Camera): Doc {
  return { kind: "board", list: new DisplayList(), undo: new UndoStack(), camera, boardId };
}
