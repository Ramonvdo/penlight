import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { normalizeHex } from "../shared/color";
import { api, onAnnotateClear, onSettingsChanged, onStateChanged } from "../shared/ipc";
import type { BoardFile, Settings, Snapshot } from "../shared/types";
import { initBoardPanel } from "./board-panel";
import { AutoEraser } from "./engine/autoerase";
import { CameraController } from "./engine/camera";
import type { Item } from "./engine/display-list";
import { seedIds } from "./engine/display-list";
import type { Doc } from "./engine/document";
import { newBoardDoc, newScreenDoc } from "./engine/document";
import { GestureController } from "./engine/input";
import { Renderer } from "./engine/renderer";
import { TextTool } from "./engine/text-tool";
import { installKeys } from "./keys";

const committedCanvas = document.getElementById("committed") as HTMLCanvasElement;
const activeCanvas = document.getElementById("active") as HTMLCanvasElement;
const boardEl = document.getElementById("board") as HTMLDivElement;
const textHost = document.getElementById("text-editor-host") as HTMLDivElement;

const myLabel = getCurrentWebviewWindow().label;

let snapshot: Snapshot = {
  annotating: false,
  whiteboard: false,
  boardHost: null,
  toolbarVisible: true,
  interactive: false,
  haloOn: false,
  spotlightOn: false,
  zoomOn: false,
  tool: "freehand",
  colorIndex: 0,
  weight: 6,
};

const FALLBACK_SETTINGS: Settings = {
  settingsVersion: 2,
  launchAtLogin: false,
  haloOnLaunch: false,
  disableGpuCompositing: false,
  annotate: {
    favoriteColors: ["#2FB4F6", "#EF5350", "#5DC963", "#FFD52E", "#9B59E8"],
    defaultWeight: 6,
    autoEraseSecs: 0,
    boardColor: "#FFFFFF",
    textSize: 28,
  },
  whiteboard: { onOpen: "resume", defaultBackground: "#FFFFFF" },
  cursor: {
    shape: "ring",
    color: "#F6339A",
    size: 64,
    borderStyle: "solid",
    borderWidth: 4,
    opacity: 0.9,
    pulseOnClick: true,
    visibility: "always",
  },
  spotlight: { radius: 160, dimOpacity: 0.75, dimColor: "#000000" },
  zoom: {
    defaultLevel: 2,
    smoothing: true,
    style: "lens",
    lensSize: 340,
    shape: "rounded",
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  shortcuts: {},
};

let settings: Settings = FALLBACK_SETTINGS;

// ---------------------------------------------------------------- documents

interface LoadedBoard {
  doc: Doc;
  board: BoardFile;
}

const annotationDoc = newScreenDoc();
const boardCache = new Map<string, LoadedBoard>();
let active: Doc = annotationDoc;
let currentBoard: BoardFile | null = null;
let isHost = false;
let boardLoadToken = 0;

const renderer = new Renderer(committedCanvas, activeCanvas, () => redraw());
const redraw = () => renderer.redrawCommitted(active.list.items, active.camera);

// ---- corrupt/hostile board-file guard --------------------------------------
// Board JSON comes from disk and is NOT trusted: every item is deep-validated
// and REBUILT from known fields, so NaN coordinates, absurd sizes, prototype
// noise, or unknown properties never reach the renderer or round-trip back to
// disk. One bad item is dropped; the rest of the board still loads.

const SHAPE_KINDS = ["arrow", "line", "rect", "ellipse"] as const;
const MAX_TEXT_CHARS = 10_000;

function sanitizePoint(raw: unknown): { x: number; y: number; p: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as { x?: unknown; y?: unknown; p?: unknown };
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const pressure = Number.isFinite(p.p) ? Math.min(Math.max(p.p as number, 0), 1) : 0.5;
  return { x: p.x as number, y: p.y as number, p: pressure };
}

function sanitizeColor(raw: unknown): Item["color"] {
  if (typeof raw === "object" && raw !== null) {
    const c = raw as { flat?: unknown; gradient?: unknown };
    if (typeof c.flat === "string") return { flat: c.flat.slice(0, 32) };
    if (
      Array.isArray(c.gradient) &&
      typeof c.gradient[0] === "string" &&
      typeof c.gradient[1] === "string"
    ) {
      return { gradient: [c.gradient[0].slice(0, 32), c.gradient[1].slice(0, 32)] };
    }
  }
  return { flat: "#2FB4F6" };
}

function sanitizeItems(raw: unknown[]): Item[] {
  const out: Item[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null) continue;
    const item = value as Record<string, unknown>;
    if (!Number.isFinite(item.id)) continue;
    const id = Math.trunc(item.id as number);
    const color = sanitizeColor(item.color);
    const weight = Number.isFinite(item.weight)
      ? Math.min(Math.max(item.weight as number, 1), 200)
      : 6;
    if (item.kind === "stroke" && Array.isArray(item.points)) {
      const points = item.points
        .map(sanitizePoint)
        .filter((p): p is NonNullable<typeof p> => p !== null);
      if (points.length === 0) continue;
      out.push({
        kind: "stroke",
        id,
        points,
        color,
        weight,
        highlighter: item.highlighter === true,
      });
    } else if (
      item.kind === "shape" &&
      SHAPE_KINDS.includes(item.shape as (typeof SHAPE_KINDS)[number])
    ) {
      const a = sanitizePoint(item.a);
      const b = sanitizePoint(item.b);
      if (!a || !b) continue;
      out.push({
        kind: "shape",
        id,
        shape: item.shape as (typeof SHAPE_KINDS)[number],
        a,
        b,
        color,
        weight,
        filled: item.filled === true,
      });
    } else if (
      item.kind === "text" &&
      typeof item.text === "string" &&
      Number.isFinite(item.x) &&
      Number.isFinite(item.y)
    ) {
      out.push({
        kind: "text",
        id,
        x: item.x as number,
        y: item.y as number,
        text: item.text.slice(0, MAX_TEXT_CHARS),
        color,
        size: Number.isFinite(item.size)
          ? Math.min(Math.max(item.size as number, 4), 400)
          : 28,
      });
    }
  }
  return out;
}

function setActiveDoc(doc: Doc): void {
  if (active === doc) return;
  gesture.cancelActive();
  textTool.commit();
  active = doc;
  renderer.clearActive();
  applyBoardChrome();
  redraw();
}

function applyBoardChrome(): void {
  const showBoard = isHost && snapshot.whiteboard;
  boardEl.hidden = !showBoard;
  if (showBoard) {
    // normalizeHex: the board file on disk is not trusted — an arbitrary
    // string must not reach CSS.
    boardEl.style.background = normalizeHex(
      active.kind === "board" && currentBoard
        ? currentBoard.background
        : settings.whiteboard.defaultBackground,
    );
  }
}

// ---------------------------------------------------------------- autosave

let dirtyTimer: number | undefined;
let saveChain: Promise<void> = Promise.resolve();

function markDirty(): void {
  if (active.kind !== "board") return;
  window.clearTimeout(dirtyTimer);
  dirtyTimer = window.setTimeout(() => {
    dirtyTimer = undefined;
    persistBoard();
  }, 500);
}

function persistBoard(): void {
  if (!currentBoard) return;
  const board = currentBoard;
  const entry = boardCache.get(board.id);
  if (!entry) return;
  const payload: BoardFile = {
    ...board,
    camera: entry.doc.camera ?? { scrollX: 0, scrollY: 0, zoom: 1 },
    items: entry.doc.list.items,
  };
  saveChain = saveChain.then(() =>
    api.boardSave(payload).catch((e: unknown) => {
      // e.g. the board was deleted meanwhile — never fatal.
      console.error("board save failed", e);
    }),
  );
}

async function flushSave(): Promise<void> {
  if (dirtyTimer !== undefined) {
    window.clearTimeout(dirtyTimer);
    dirtyTimer = undefined;
    persistBoard();
  }
  await saveChain;
}

// ------------------------------------------------------------- board loading

async function enterBoard(): Promise<void> {
  const token = ++boardLoadToken;
  let board: BoardFile | null = null;
  if (settings.whiteboard.onOpen === "new") {
    board = await api.boardCreate().catch(() => null);
  } else {
    const last = await api.boardLast().catch(() => null);
    if (last) {
      const cached = boardCache.get(last);
      if (cached) {
        // "Stays in memory": quick W-off/W-on skips the disk round-trip.
        if (token !== boardLoadToken) return;
        currentBoard = cached.board;
        setActiveDoc(cached.doc);
        return;
      }
      board = await api.boardLoad(last).catch(() => null);
    }
    if (!board) board = await api.boardCreate().catch(() => null);
  }
  if (token !== boardLoadToken) return;
  if (!board) {
    console.error("could not load or create a board; whiteboard stays blank");
    return;
  }
  let entry = boardCache.get(board.id);
  if (!entry) {
    const doc = newBoardDoc(board.id, {
      scrollX: board.camera?.scrollX ?? 0,
      scrollY: board.camera?.scrollY ?? 0,
      zoom: board.camera?.zoom ?? 1,
    });
    const items = sanitizeItems(board.items ?? []);
    doc.list.items = items;
    seedIds(items.reduce((m, i) => Math.max(m, i.id), 0) + 1);
    entry = { doc, board };
    boardCache.set(board.id, entry);
  } else {
    // Keep in-memory items (they are >= disk state); refresh metadata only.
    entry.board = { ...board, items: entry.doc.list.items };
  }
  currentBoard = entry.board;
  setActiveDoc(entry.doc);
}

/** Used by the board panel to switch/create boards explicitly. */
async function openBoard(board: BoardFile): Promise<void> {
  const token = ++boardLoadToken;
  await flushSave();
  if (token !== boardLoadToken) return;
  let entry = boardCache.get(board.id);
  if (!entry) {
    const doc = newBoardDoc(board.id, {
      scrollX: board.camera?.scrollX ?? 0,
      scrollY: board.camera?.scrollY ?? 0,
      zoom: board.camera?.zoom ?? 1,
    });
    const items = sanitizeItems(board.items ?? []);
    doc.list.items = items;
    seedIds(items.reduce((m, i) => Math.max(m, i.id), 0) + 1);
    entry = { doc, board };
    boardCache.set(board.id, entry);
  }
  currentBoard = entry.board;
  setActiveDoc(entry.doc);
}

function activeBoardId(): string | null {
  return active.kind === "board" ? (active.boardId ?? null) : null;
}

function forgetBoard(id: string): void {
  boardCache.delete(id);
  window.clearTimeout(dirtyTimer);
  dirtyTimer = undefined;
  if (currentBoard?.id === id) currentBoard = null;
}

const boardPanel = initBoardPanel({
  isHost: () => isHost,
  activeBoardId,
  openBoard,
  forgetBoard,
});

// ------------------------------------------------------------------ engine

const textTool = new TextTool(
  textHost,
  { snapshot: () => snapshot, settings: () => settings, doc: () => active },
  () => {
    redraw();
    markDirty();
  },
);

const gesture = new GestureController(activeCanvas, renderer, {
  snapshot: () => snapshot,
  settings: () => settings,
  doc: () => active,
  committed: () => {
    redraw();
    markDirty();
  },
  textClick: (x, y) => textTool.begin(x, y),
  isPanning: () => camera.isPanning(),
});

let cameraRaf = 0;
const camera = new CameraController(activeCanvas, {
  doc: () => active,
  changed: () => {
    markDirty();
    if (cameraRaf) return;
    cameraRaf = requestAnimationFrame(() => {
      cameraRaf = 0;
      redraw();
    });
  },
  gestureStart: () => {
    gesture.cancelActive();
    textTool.commit();
  },
});

new AutoEraser(annotationDoc.list, annotationDoc.undo, () => {
  if (active === annotationDoc) redraw();
});

// -------------------------------------------------------------- state sync

/** Pen/highlighter cursor: a dot in the current ink color at the current
 * line weight (an ink preview), ringed white-on-dark so it reads on any
 * background. Fed to CSS via --draw-cursor; non-drawing tools keep their
 * static cursors. */
function updateDrawCursor(): void {
  if (snapshot.tool !== "freehand" && snapshot.tool !== "highlighter") {
    document.body.style.removeProperty("--draw-cursor");
    return;
  }
  const weight = Math.min(Math.max(snapshot.weight, 1), 64);
  const d = Math.max(weight, 6); // dot tracks the line weight, floored to stay visible
  const pad = 3;
  const size = d + pad * 2;
  const c = size / 2;
  const gradient = snapshot.colorIndex === 5;
  const fill = gradient
    ? "url(#g)"
    : normalizeHex(settings.annotate.favoriteColors[snapshot.colorIndex] ?? "#2FB4F6");
  const defs = gradient
    ? "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#ff5f6d'/><stop offset='0.5' stop-color='#47e891'/>" +
      "<stop offset='1' stop-color='#3aa4ff'/></linearGradient></defs>"
    : "";
  const opacity = snapshot.tool === "highlighter" ? 0.55 : 1;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>` +
    defs +
    `<circle cx='${c}' cy='${c}' r='${d / 2 + 1.6}' fill='none' stroke='rgba(0,0,0,0.5)' stroke-width='1'/>` +
    `<circle cx='${c}' cy='${c}' r='${d / 2 + 0.9}' fill='none' stroke='white' stroke-width='1.2'/>` +
    `<circle cx='${c}' cy='${c}' r='${d / 2}' fill='${fill}' fill-opacity='${opacity}'/>` +
    `</svg>`;
  document.body.style.setProperty(
    "--draw-cursor",
    `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}, crosshair`,
  );
}

function applyState(s: Snapshot): void {
  const toolChanged = s.tool !== snapshot.tool;
  const wasHost = isHost;
  snapshot = s;
  isHost = s.whiteboard && s.boardHost === myLabel;

  if (toolChanged || !s.annotating) {
    gesture.cancelActive();
  }
  if ((toolChanged || !s.annotating) && textTool.isEditing()) {
    textTool.commit();
  }

  if (isHost && !wasHost) {
    void enterBoard();
  } else if (!isHost && wasHost) {
    boardPanel.hide();
    void flushSave();
    boardLoadToken++;
    setActiveDoc(annotationDoc);
  }

  applyBoardChrome();
  document.body.classList.toggle("interactive", s.interactive);
  document.body.dataset.tool = s.tool;
  updateDrawCursor();
}

function applySettings(s: Settings): void {
  settings = s;
  applyBoardChrome();
  updateDrawCursor();
}

installKeys({
  undo: () => {
    if (active.undo.undo(active.list)) {
      redraw();
      markDirty();
    }
  },
  redo: () => {
    if (active.undo.redo(active.list)) {
      redraw();
      markDirty();
    }
  },
  clearAll: () => {
    const items = active.list.clear();
    if (items.length > 0) active.undo.push({ type: "clear", items });
    redraw();
    markDirty();
  },
  weight: () => snapshot.weight,
  interactive: () => snapshot.interactive,
  boardPanel: () => {
    if (isHost) boardPanel.toggle();
  },
});

void onStateChanged(applyState);
void onSettingsChanged(applySettings);
void onAnnotateClear(() => {
  // Screen annotations are ephemeral; board content is never cleared here.
  if (active === annotationDoc) textTool.cancel();
  annotationDoc.list.clear();
  annotationDoc.undo.reset();
  if (active === annotationDoc) {
    redraw();
    renderer.clearActive();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) void flushSave();
});

void api.getSettings().then(applySettings);
void api.getSnapshot().then(applyState);
