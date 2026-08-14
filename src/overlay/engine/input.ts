import type { Settings, Snapshot } from "../../shared/types";
import type { Color, Item, Pt, ShapeKind } from "./display-list";
import { newId } from "./display-list";
import { worldFromScreen } from "./camera";
import type { Doc } from "./document";
import { eraseHit } from "./eraser";
import type { Renderer } from "./renderer";
import { drawItem } from "./renderer";

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

/**
 * Pointer pipeline: pointerrawupdate (fallback pointermove) + coalesced events
 * collect every input point; the active layer renders at most once per rAF.
 * Input is never dropped — only preview frames are.
 */
export class GestureController {
  private drawing = false;
  private pointerId = -1;
  private points: Pt[] = [];
  private startPt: Pt | null = null;
  private lastPt: Pt | null = null;
  private shift = false;
  private alt = false;
  private ctrlAtStart = false;
  private gradient: [string, string] = ["#ff0080", "#7928ca"];
  private rafId = 0;
  private erased: Item[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
    private ctx: EngineContext,
  ) {
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    // pointerrawupdate is not in TS's DOM lib yet; Reflect.has avoids the
    // `in`-operator narrowing HTMLCanvasElement to never.
    const moveEvent = Reflect.has(canvas, "onpointerrawupdate")
      ? "pointerrawupdate"
      : "pointermove";
    (canvas as HTMLElement).addEventListener(moveEvent as "pointermove", (e) =>
      this.onMove(e),
    );
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointercancel", () => this.cancel());
    // Live preview reacts to Shift/Alt changing mid-gesture.
    window.addEventListener("keydown", (e) => this.modifiers(e));
    window.addEventListener("keyup", (e) => this.modifiers(e));
  }

  private modifiers(e: KeyboardEvent): void {
    this.shift = e.shiftKey;
    this.alt = e.altKey;
    if (this.drawing) this.requestPreview();
  }

  /** Points are stored in WORLD coordinates when the doc has a camera. */
  private toPt(e: { clientX: number; clientY: number; pointerType?: string; pressure?: number }): Pt {
    const p =
      e.pointerType === "mouse" || !e.pressure || e.pressure === 0 ? 0.5 : e.pressure;
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
    const snap = this.ctx.snapshot();
    if (!snap.annotating || snap.interactive) return;
    if (e.button !== 0) return;
    if (snap.tool === "text") {
      this.ctx.textClick(e.clientX, e.clientY);
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;
    this.drawing = true;
    this.shift = e.shiftKey;
    this.alt = e.altKey;
    this.ctrlAtStart = e.ctrlKey;
    this.erased = [];
    const pt = this.toPt(e);
    if (snap.colorIndex === 5) {
      const h = Math.floor(Math.random() * 360);
      this.gradient = [`hsl(${h} 90% 60%)`, `hsl(${(h + 70) % 360} 90% 55%)`];
    }
    if (snap.tool === "eraser") {
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
    // Lost pointerup (capture stolen, device removed): finish rather than
    // drawing forever from hover moves.
    if ((e.buttons & 1) === 0) {
      this.finish(e);
      return;
    }
    this.shift = e.shiftKey;
    this.alt = e.altKey;
    const snap = this.ctx.snapshot();
    const events = e.getCoalescedEvents?.() ?? [];
    const all = events.length > 0 ? events : [e];
    if (snap.tool === "eraser") {
      for (const ev of all) {
        const p = this.toPt(ev);
        this.eraseAt(p.x, p.y);
      }
      return;
    }
    if (snap.tool === "freehand" || snap.tool === "highlighter") {
      for (const ev of all) this.points.push(this.toPt(ev));
    } else {
      this.lastPt = this.toPt(e);
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
    const snap = this.ctx.snapshot();
    const doc = this.ctx.doc();
    if (snap.tool === "eraser") {
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
    const tool = this.ctx.snapshot().tool;
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
    if (snap.tool === "freehand" || snap.tool === "highlighter") {
      if (this.points.length < 2) return null;
      return {
        kind: "stroke",
        id: newId(),
        points: [...this.points],
        color: this.color(),
        weight: snap.weight,
        highlighter: snap.tool === "highlighter",
        expiresAt: this.expiry(),
      };
    }
    const shape = SHAPE_TOOLS[snap.tool];
    if (!shape || !this.startPt) return null;
    const b = this.constrained();
    if (!b) return null;
    if (Math.hypot(b.x - this.startPt.x, b.y - this.startPt.y) < 3) return null;
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
