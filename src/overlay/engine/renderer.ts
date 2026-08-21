import { worldFromScreen } from "./camera";
import type { Item, ShapeItem, Pt } from "./display-list";
import type { Camera } from "./document";
import { strokeOutline } from "./stroke";

/** Extra world-space margin so thick strokes/arrowheads at the edge survive culling. */
const CULL_MARGIN = 60;

/**
 * Two stacked canvases: #committed is redrawn only when the display list
 * changes (commit/undo/erase/resize); #active is cleared and redrawn once per
 * rAF while a gesture is live.
 */
export class Renderer {
  readonly cctx: CanvasRenderingContext2D;
  readonly actx: CanvasRenderingContext2D;
  desynchronized = false;

  constructor(
    private committed: HTMLCanvasElement,
    private active: HTMLCanvasElement,
    onResize?: () => void,
  ) {
    const opts: CanvasRenderingContext2DSettings = { desynchronized: true, alpha: true };
    this.cctx = committed.getContext("2d", opts)!;
    this.actx = active.getContext("2d", opts)!;
    this.desynchronized = this.actx.getContextAttributes?.().desynchronized ?? false;
    this.resize();
    // Resizing a canvas wipes its contents — the owner must replay the
    // display list afterwards.
    window.addEventListener("resize", () => {
      this.resize();
      onResize?.();
    });
  }

  private sizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize(): void {
    this.sizeCanvas(this.committed, this.cctx);
    this.sizeCanvas(this.active, this.actx);
  }

  /** Apply the camera (or identity) on top of the devicePixelRatio scale. */
  private applyCamera(ctx: CanvasRenderingContext2D, camera: Camera | null | undefined): void {
    const dpr = window.devicePixelRatio || 1;
    if (camera) {
      const z = camera.zoom;
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * z * camera.scrollX, dpr * z * camera.scrollY);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  redrawCommitted(items: Item[], camera?: Camera | null): void {
    const dpr = window.devicePixelRatio || 1;
    this.cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this.applyCamera(this.cctx, camera);
    if (camera) {
      // Excalidraw-style culling: viewport corners to world once, then AABB.
      const tl = worldFromScreen(camera, 0, 0);
      const br = worldFromScreen(camera, window.innerWidth, window.innerHeight);
      for (const item of items) {
        const [x0, y0, x1, y1] = itemBounds(item);
        if (
          x1 >= tl.x - CULL_MARGIN &&
          x0 <= br.x + CULL_MARGIN &&
          y1 >= tl.y - CULL_MARGIN &&
          y0 <= br.y + CULL_MARGIN
        ) {
          drawItem(this.cctx, item);
        }
      }
    } else {
      for (const item of items) {
        drawItem(this.cctx, item);
      }
    }
  }

  clearActive(): void {
    const dpr = window.devicePixelRatio || 1;
    this.actx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.actx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  drawActive(draw: (ctx: CanvasRenderingContext2D) => void, camera?: Camera | null): void {
    this.clearActive();
    this.applyCamera(this.actx, camera);
    draw(this.actx);
  }
}

export function itemBounds(item: Item): [number, number, number, number] {
  if (item.kind === "stroke") {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of item.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return [x0, y0, x1, y1];
  }
  if (item.kind === "shape") {
    return [
      Math.min(item.a.x, item.b.x),
      Math.min(item.a.y, item.b.y),
      Math.max(item.a.x, item.b.x),
      Math.max(item.a.y, item.b.y),
    ];
  }
  return [item.x, item.y - item.size, item.x + item.text.length * item.size * 0.6, item.y];
}

function makePaint(
  ctx: CanvasRenderingContext2D,
  item: Item,
): string | CanvasGradient {
  const c = item.color;
  if (c.gradient) {
    const [x0, y0, x1, y1] = itemBounds(item);
    const g = ctx.createLinearGradient(x0, y0, Math.max(x1, x0 + 1), Math.max(y1, y0 + 1));
    g.addColorStop(0, c.gradient[0]);
    g.addColorStop(1, c.gradient[1]);
    return g;
  }
  return c.flat ?? "#ffffff";
}

export function drawItem(ctx: CanvasRenderingContext2D, item: Item): void {
  ctx.save();
  // try/finally: one item that throws (e.g. a malformed one from a corrupt
  // board file) must neither blank the rest of the redraw nor leak its
  // saved canvas state into the next item.
  try {
    const paint = makePaint(ctx, item);
    if (item.kind === "stroke") {
      if (item.highlighter) ctx.globalAlpha = 0.45;
      ctx.fillStyle = paint;
      ctx.fill(strokeOutline(item));
    } else if (item.kind === "shape") {
      drawShape(ctx, item, paint);
    } else {
      ctx.fillStyle = paint;
      ctx.font = `600 ${item.size}px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = "alphabetic";
      const lines = item.text.split("\n");
      lines.forEach((line, i) => {
        ctx.fillText(line, item.x, item.y + i * item.size * 1.25);
      });
    }
  } catch (e) {
    console.error("drawItem failed for item", item.id, e);
  } finally {
    ctx.restore();
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  item: ShapeItem,
  paint: string | CanvasGradient,
): void {
  ctx.strokeStyle = paint;
  ctx.fillStyle = paint;
  ctx.lineWidth = item.weight;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const { a, b } = item;
  switch (item.shape) {
    case "line": {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    }
    case "arrow": {
      drawArrow(ctx, a, b, item.weight);
      break;
    }
    case "rect": {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      if (item.filled) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case "ellipse": {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
      if (item.filled) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.restore();
      }
      ctx.stroke();
      break;
    }
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, weight: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(14, weight * 3.5);
  // The shaft stops short of the tip so the head stays crisp.
  const ex = b.x - Math.cos(angle) * head * 0.6;
  const ey = b.y - Math.sin(angle) * head * 0.6;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle - 0.45), b.y - head * Math.sin(angle - 0.45));
  ctx.lineTo(b.x - head * Math.cos(angle + 0.45), b.y - head * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}
