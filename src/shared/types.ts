export type Tool =
  | "freehand"
  | "highlighter"
  | "arrow"
  | "line"
  | "rect"
  | "ellipse"
  | "text"
  | "eraser";

export interface Snapshot {
  annotating: boolean;
  whiteboard: boolean;
  boardHost: string | null;
  toolbarVisible: boolean;
  interactive: boolean;
  haloOn: boolean;
  spotlightOn: boolean;
  zoomOn: boolean;
  tool: Tool;
  colorIndex: number;
  weight: number;
}

export interface AnnotateCfg {
  favoriteColors: [string, string, string, string, string];
  defaultWeight: number;
  autoEraseSecs: number;
  boardColor: string;
  textSize: number;
}

export interface CursorCfg {
  shape: "ring" | "squircle" | "rhombus";
  color: string;
  size: number;
  borderStyle: "solid" | "dashed";
  borderWidth: number;
  opacity: number;
  pulseOnClick: boolean;
  visibility: "always" | "clicks" | "moving";
}

export interface SpotlightCfg {
  radius: number;
  dimOpacity: number;
  dimColor: string;
}

export interface ZoomCfg {
  defaultLevel: number;
  smoothing: boolean;
  style: "lens" | "monitor";
  lensSize: number;
  shape: "rounded" | "circle";
  borderWidth: number;
  borderColor: string;
}

export interface WhiteboardCfg {
  onOpen: "resume" | "new";
  defaultBackground: string;
}

export interface Settings {
  settingsVersion: number;
  launchAtLogin: boolean;
  haloOnLaunch: boolean;
  disableGpuCompositing: boolean;
  annotate: AnnotateCfg;
  whiteboard: WhiteboardCfg;
  cursor: CursorCfg;
  spotlight: SpotlightCfg;
  zoom: ZoomCfg;
  shortcuts: Record<string, string>;
}

export interface BoardCamera {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface BoardFile {
  boardVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  background: string;
  camera: BoardCamera;
  /** Opaque to shared code; the overlay narrows via sanitizeItems(). */
  items: unknown[];
}

export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export const WEIGHT_STEPS = [1, 2, 4, 6, 8, 12, 16, 24] as const;
