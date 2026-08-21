import type { Settings, Snapshot } from "../../shared/types";
import type { Color, Item, Pt, ShapeKind } from "./display-list";
import { newId } from "./display-list";
import { worldFromScreen } from "./camera";
import type { Doc } from "./document";
import { eraseHit } from "./eraser";
import type { Renderer } from "./renderer";
import { drawItem } from "./renderer";
import {
  STREAMLINE_MOUSE,
  STREAMLINE_PRECISE,
  THINNING_PRESSURE,
  THINNING_UNIFORM,
} from "./stroke";

interface EngineContext {
  snapshot(): Snapshot;
  settings(): Settings;
  /** The document the engine is currently drawing against. */
  doc(): Doc;
  /** Called whenever the committed display list changed. */
  committed(): void;
  /** Text-tool click at overlay coordinates. */
  textClick(x: number, y: number): void;
  /** True while space/middle-button panning owns the pointer (W2). */
  isPanning?(): boolean;
}

const CTRL_ERASE_DEFAULT_SECS = 3;
const SHAPE_TOOLS: Record<string, ShapeKind> = {
  arrow: "arrow",
  line: "line",
  rect: "rect",
  ellipse: "ellipse",
};

/** Pointer buttons we start a gesture for: main, touch, and a pen's eraser end. */
const DRAW_BUTTONS = new Set([0, -1, 5]);
const ERASER_BUTTON = 5;
/** Minimum drag before a shape is committed, in SCREEN pixels. */
const MIN_SHAPE_DRAG_PX = 3;

/**
 * Pointer pipeline: pointermove + getCoalescedEvents() collects every input
 * point the device reported between frames; the active layer renders at most
 * once per rAF. Input is never dropped — only preview frames are.
 *
 * Deliberately NOT pointerrawupdate: it bypasses normal pointer-capture
 * semantics, which broke tablet-pen strokes. Coalesced pointermove gives the
 * same sample density with reliable capture.
 */
export class GestureController {
  private drawing = false;
  private pointerId = -1;
  private pointerKind = "mouse";
  private eraserOverride = false;
  private simulatePressure = true;
  private streamline = STREAMLINE_MOUSE;
  private points: Pt[] = [];
  private startPt: Pt | null = null;
  private lastPt: Pt | null = null;
  private shift = false;
  private alt = false;
  private ctrlAtStart = false;
  private gradient: [string, string] = ["#ff0080", "#7928ca"];
  private rafId = 0;
  private erased: Item[] = [];
  private lastEvent: PointerEvent | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
    private ctx: EngineContext,
  ) {
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    // Only OUR pointer: a palm landing on the tablet cancels ITS pointer, and
    // discarding the pen's in-flight stroke there looks exactly like the bug
    // this whole change fixes. Commit rather than discard — the ink was real.
    canvas.addEventListener("pointercancel", (e) => {
      if (this.drawing && e.pointerId === this.pointerId) this.finish(e);
    });
    // Capture can be revoked by the browser (device removed, another window
    // takes over); finish cleanly instead of leaving a stroke half-drawn.
    canvas.addEventListener("lostpointercapture", (e) => {
      if (this.drawing && e.pointerId === this.pointerId) this.finish(e);
    });
    // Focus loss can swallow the pointerup entirely.
    window.addEventListener("blur", () => {
      if (this.drawing && this.lastEvent) this.finish(this.lastEvent);
    });
    // Live preview reacts to Shift/Alt changing mid-gesture.
    window.addEventListener("keydown", (e) => this.modifiers(e));
    window.addEventListener("keyup", (e) => this.modifiers(e));
  }

  /** The pen's eraser end erases regardless of the selected tool. */
  private tool(): Snapshot["tool"] {
    return this.eraserOverride ? "eraser" : this.ctx.snapshot().tool;
  }

  private modifiers(e: KeyboardEvent): void {
    this.shift = e.shiftKey;
    this.alt = e.altKey;
    if (this.drawing) this.requestPreview();
  }

  /**
   * Points are stored in WORLD coordinates when the doc has a camera.
   * Pressure is passed through RAW (0..1) — 0.5 is the platform's "no pressure
   * data" sentinel, and whether to trust it is decided once per stroke.
   */
  private toPt(e: { clientX: number; clientY: number; pressure?: number }): Pt {
    const p = typeof e.pressure === "number" ? e.pressure : 0.5;
    const cam = this.ctx.doc().camera;
    if (cam) {
      const w = worldFromScreen(cam, e.clientX, e.clientY);
      return { x: w.x, y: w.y, p };
    }
    return { x: e.clientX, y: e.clientY, p };
  }

  private onDown(e: PointerEvent): void {
    // A second pointer (touch/palm) must not hijack an in-progress gesture.
    if (this.drawing) return;
    if (this.ctx.isPanning?.()) return;
    // Set unconditionally, before any early return, so a rejected gesture can
    // never leave the override latched on.
    this.eraserOverride = e.button === ERASER_BUTTON;
    const snap = this.ctx.snapshot();
    if (!snap.annotating || snap.interactive) return;
    if (!DRAW_BUTTONS.has(e.button)) return;
    this.lastEvent = e;
    const tool = this.tool();
    if (tool === "text") {
      this.ctx.textClick(e.clientX, e.clientY);
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;
    this.pointerKind = e.pointerType || "mouse";
    this.drawing = true;
    this.shift = e.shiftKey;
    this.alt = e.altKey;
    this.ctrlAtStart = e.ctrlKey;
    this.erased = [];
    // Decided once per stroke, then persisted on the item so a replay (or a
    // whiteboard reloaded from disk) renders exactly as it was drawn.
    this.simulatePressure = this.pointerKind === "mouse" || e.pressure === 0.5;
    this.streamline =
      this.pointerKind === "mouse" ? STREAMLINE_MOUSE : STREAMLINE_PRECISE;
    const pt = this.toPt(e);
    if (snap.colorIndex === 5) {
      const h = Math.floor(Math.random() * 360);
      this.gradient = [`hsl(${h} 90% 60%)`, `hsl(${(h + 70) % 360} 90% 55%)`];
    }
    if (tool === "eraser") {
      this.eraseAt(pt.x, pt.y);
      return;
    }
    this.points = [pt];
    this.startPt = pt;
    this.lastPt = pt;
    this.requestPreview();
  }

  private onMove(e: PointerEvent): void {
    if (!this.drawing || e.pointerId !== this.pointerId) return;
    // Lost pointerup (capture stolen, device removed) leaves a mouse drawing
    // forever from hover moves. Pens legitimately report buttons === 0 mid
    // stroke (light pressure, lift-off, interleaved hover frames), so this
    // guard must never apply to them — it silently killed every pen stroke.
    if (this.pointerKind === "mouse" && (e.buttons & 1) === 0) {
      this.finish(e);
      return;
    }
    this.shift = e.shiftKey;
    this.alt = e.altKey;
    this.lastEvent = e;
    const tool = this.tool();
    const events = e.getCoalescedEvents?.() ?? [];
    const all = events.length > 0 ? events : [e];
    if (tool === "eraser") {
      for (const ev of all) {
        const p = this.toPt(ev);
        this.eraseAt(p.x, p.y);
      }
      return;
    }
    if (tool === "freehand" || tool === "highlighter") {
      for (const ev of all) {
        const pt = this.toPt(ev);
        // Drop exact repeats: a pen reporting ~200 Hz emits many samples that
        // differ only in pressure while the tip is still.
        const prev = this.points[this.points.length - 1];
        if (prev && prev.x === pt.x && prev.y === pt.y) continue;
        this.points.push(pt);
      }
    } else {
      // Shapes only need the freshest position.
      this.lastPt = this.toPt(all[all.length - 1]);
    }
    this.requestPreview();
  }

  private onUp(e: PointerEvent): void {
    this.finish(e);
  }

  private finish(e: PointerEvent): void {
    if (!this.drawing || e.pointerId !== this.pointerId) return;
    this.drawing = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be gone
    }
    const tool = this.tool();
    const doc = this.ctx.doc();
    this.eraserOverride = false;
    // The final position of a fast flick only exists on the up event, and a
    // tap has no move events at all — without this a pen tap draws nothing.
    // Only for a real pointerup: cancel/blur carry stale coordinates.
    if (e.type === "pointerup") {
      if (tool === "freehand" || tool === "highlighter") {
        const pt = this.toPt(e);
        const last = this.points[this.points.length - 1];
        if (!last || last.x !== pt.x || last.y !== pt.y) {
          this.points.push(pt);
        } else if (this.points.length === 1) {
          // A stroke needs two distinct points to render; nudge sub-pixel so
          // a tap still leaves a dot.
          this.points.push({ x: pt.x + 0.0001, y: pt.y + 0.0001, p: pt.p });
        }
      } else if (this.startPt) {
        this.lastPt = this.toPt(e);
      }
    }
    if (tool === "eraser") {
      if (this.erased.length > 0) {
        doc.undo.push({ type: "remove", items: this.erased });
        this.erased = [];
        this.ctx.committed();
      }
      return;
    }
    const item = this.buildItem();
    if (item) {
      doc.list.add(item);
      doc.undo.push({ type: "add", item });
    }
    this.cancelPreview();
    this.renderer.clearActive();
    this.ctx.committed();
  }

  private cancel(): void {
    this.drawing = false;
    this.eraserOverride = false;
    // Items erased before the cancel are already gone from the display list —
    // record them so undo can bring them back.
    if (this.erased.length > 0) {
      this.ctx.doc().undo.push({ type: "remove", items: this.erased });
      this.erased = [];
      this.ctx.committed();
    }
    this.cancelPreview();
    this.renderer.clearActive();
  }

  /** Abort any in-progress gesture (e.g. the tool changed mid-drag). */
  cancelActive(): void {
    if (this.drawing) this.cancel();
  }

  private eraseAt(x: number, y: number): void {
    const doc = this.ctx.doc();
    const hit = eraseHit(doc.list.items, x, y, doc.camera?.zoom ?? 1);
    if (hit) {
      doc.list.remove(new Set([hit.id]));
      this.erased.push(hit);
      this.ctx.committed();
    }
  }

  private requestPreview(): void {
    if (this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (!this.drawing) return;
      const item = this.buildItem();
      if (item) {
        this.renderer.drawActive((ctx) => drawItem(ctx, item), this.ctx.doc().camera);
      }
    });
  }

  private cancelPreview(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private color(): Color {
    const snap = this.ctx.snapshot();
    if (snap.colorIndex === 5) return { gradient: this.gradient };
    const colors = this.ctx.settings().annotate.favoriteColors;
    return { flat: colors[Math.min(snap.colorIndex, colors.length - 1)] };
  }

  /** Hold-Ctrl at gesture start inverts the auto-erase setting for this item. */
  private expiry(): number | undefined {
    // Persistent boards never auto-erase.
    if (this.ctx.doc().kind === "board") return undefined;
    const secs = this.ctx.settings().annotate.autoEraseSecs;
    const effective = this.ctrlAtStart
      ? secs > 0
        ? 0
        : CTRL_ERASE_DEFAULT_SECS
      : secs;
    return effective > 0 ? Date.now() + effective * 1000 : undefined;
  }

  private constrained(): Pt | null {
    if (!this.startPt || !this.lastPt) return this.lastPt;
    if (!this.shift) return this.lastPt;
    const a = this.startPt;
    const b = this.lastPt;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const tool = this.tool();
    if (tool === "line" || tool === "arrow") {
      const angle = Math.atan2(dy, dx);
      const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      return { x: a.x + Math.cos(snapAngle) * len, y: a.y + Math.sin(snapAngle) * len, p: b.p };
    }
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m, p: b.p };
  }

  private buildItem(): Item | null {
    const snap = this.ctx.snapshot();
    const tool = this.tool();
    if (tool === "freehand" || tool === "highlighter") {
      if (this.points.length < 2) return null;
      const highlighter = tool === "highlighter";
      return {
        kind: "stroke",
        id: newId(),
        points: [...this.points],
        color: this.color(),
        weight: snap.weight,
        highlighter,
        // Render options travel with the stroke: the committed layer re-runs
        // perfect-freehand on every redraw, so capture and replay must agree.
        streamline: this.streamline,
        simulatePressure: this.simulatePressure,
        thinning:
          highlighter || !this.ctx.settings().annotate.pressureSensitivity
            ? THINNING_UNIFORM
            : THINNING_PRESSURE,
        expiresAt: this.expiry(),
      };
    }
    const shape = SHAPE_TOOLS[tool];
    if (!shape || !this.startPt) return null;
    const b = this.constrained();
    if (!b) return null;
    // Threshold is in screen pixels: a zoomed-out board must not swallow a
    // deliberate drag, and a zoomed-in one must not commit a stray tap.
    const minDrag = MIN_SHAPE_DRAG_PX / (this.ctx.doc().camera?.zoom ?? 1);
    if (Math.hypot(b.x - this.startPt.x, b.y - this.startPt.y) < minDrag) return null;
    return {
      kind: "shape",
      id: newId(),
      shape,
      a: this.startPt,
      b,
      color: this.color(),
      weight: snap.weight,
      filled: this.alt,
      expiresAt: this.expiry(),
    };
  }
}
