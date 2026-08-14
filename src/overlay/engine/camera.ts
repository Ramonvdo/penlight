import type { Camera, Doc } from "./document";

// Excalidraw's clamps; zoom is rounded to 6 decimals per step so float drift
// can't accumulate across hundreds of wheel events.
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

export function worldFromScreen(cam: Camera, x: number, y: number): { x: number; y: number } {
  return { x: x / cam.zoom - cam.scrollX, y: y / cam.zoom - cam.scrollY };
}

export function screenFromWorld(cam: Camera, x: number, y: number): { x: number; y: number } {
  return { x: (x + cam.scrollX) * cam.zoom, y: (y + cam.scrollY) * cam.zoom };
}

function normalizeZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 1e6) / 1e6));
}

/** Zoom keeping the screen point (px, py) fixed (Excalidraw getViewportForZoom). */
export function zoomAt(cam: Camera, px: number, py: number, nextZoomRaw: number): void {
  const nextZoom = normalizeZoom(nextZoomRaw);
  cam.scrollX = cam.scrollX + (px - px / cam.zoom) - (px - px / nextZoom);
  cam.scrollY = cam.scrollY + (py - py / cam.zoom) - (py - py / nextZoom);
  cam.zoom = nextZoom;
}

interface CameraCtx {
  doc(): Doc;
  /** Camera moved: schedule a redraw + autosave. */
  changed(): void;
  /** A pan/zoom gesture is starting (used to commit the text editor). */
  gestureStart(): void;
}

/**
 * Excalidraw wheel/pan semantics: plain wheel = 2-axis pan, shift+wheel =
 * horizontal, ctrl/cmd+wheel (and trackpad pinch) = zoom at cursor;
 * space-hold + left-drag or middle-mouse drag = grab panning. Active only
 * when the current document has a camera (whiteboard).
 */
export class CameraController {
  private spaceHeld = false;
  private panning = false;
  private panPointer = -1;
  private lastX = 0;
  private lastY = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private ctx: CameraCtx,
  ) {
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    // Capture phase: pan claims the pointer before the drawing gesture sees it.
    canvas.addEventListener("pointerdown", (e) => this.onDown(e), true);
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e));
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      if (!this.active()) return;
      if (e.code === "Space" && !e.repeat) {
        this.spaceHeld = true;
        document.body.classList.add("pan-ready");
        e.preventDefault();
      } else if (e.ctrlKey && e.key === "0") {
        const cam = this.cam();
        if (cam) {
          this.ctx.gestureStart();
          zoomAt(cam, window.innerWidth / 2, window.innerHeight / 2, 1);
          this.ctx.changed();
        }
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.spaceHeld = false;
        document.body.classList.remove("pan-ready");
      }
    });
    window.addEventListener("blur", () => {
      this.spaceHeld = false;
      this.endPan();
      document.body.classList.remove("pan-ready");
    });
  }

  private cam(): Camera | null {
    return this.ctx.doc().camera;
  }

  private active(): boolean {
    return this.cam() !== null;
  }

  isPanning(): boolean {
    return this.panning || (this.spaceHeld && this.active());
  }

  private onWheel(e: WheelEvent): void {
    const cam = this.cam();
    if (!cam) return;
    e.preventDefault();
    this.ctx.gestureStart();
    if (e.ctrlKey || e.metaKey) {
      // Excalidraw's zoom curve: /100 base sensitivity, delta capped at 10,
      // log10 growth past 100% damped for small trackpad deltas.
      const sign = Math.sign(e.deltaY);
      const abs = Math.abs(e.deltaY);
      const delta = abs > 10 ? 10 * sign : e.deltaY;
      let next = cam.zoom - delta / 100;
      next += Math.log10(Math.max(1, cam.zoom)) * -sign * Math.min(1, abs / 20);
      zoomAt(cam, e.clientX, e.clientY, next);
    } else if (e.shiftKey) {
      cam.scrollX -= (e.deltaY || e.deltaX) / cam.zoom;
    } else {
      cam.scrollX -= e.deltaX / cam.zoom;
      cam.scrollY -= e.deltaY / cam.zoom;
    }
    this.ctx.changed();
  }

  private onDown(e: PointerEvent): void {
    if (!this.active()) return;
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      this.panning = true;
      this.panPointer = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      document.body.classList.add("grabbing");
      this.ctx.gestureStart();
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.panning || e.pointerId !== this.panPointer) return;
    const cam = this.cam();
    if (!cam) {
      this.endPan();
      return;
    }
    cam.scrollX -= (this.lastX - e.clientX) / cam.zoom;
    cam.scrollY -= (this.lastY - e.clientY) / cam.zoom;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.ctx.changed();
  }

  private onUp(e: PointerEvent): void {
    if (this.panning && e.pointerId === this.panPointer) {
      this.endPan();
    }
  }

  private endPan(): void {
    this.panning = false;
    this.panPointer = -1;
    document.body.classList.remove("grabbing");
  }
}
