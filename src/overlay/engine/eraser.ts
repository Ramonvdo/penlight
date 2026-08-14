import type { Item, Pt } from "./display-list";

/** Screen-feel pad in px; divided by zoom so it stays constant on screen. */
const PAD = 6;

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  let t = 0;
  if (lengthSq > 0) {
    t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSq));
  }
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function hits(item: Item, x: number, y: number, zoom: number): boolean {
  const pad = PAD / zoom;
  if (item.kind === "stroke") {
    const threshold = item.weight / 2 + pad + (item.highlighter ? item.weight : 0);
    const pts = item.points;
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(x, y, pts[i - 1], pts[i]) <= threshold) return true;
    }
    return pts.length === 1 && Math.hypot(x - pts[0].x, y - pts[0].y) <= threshold;
  }
  if (item.kind === "shape") {
    const threshold = item.weight / 2 + pad;
    const { a, b } = item;
    switch (item.shape) {
      case "line":
      case "arrow":
        return distToSegment(x, y, a, b) <= threshold;
      case "rect": {
        const x0 = Math.min(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x, b.x);
        const y1 = Math.max(a.y, b.y);
        if (item.filled && x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
        const corners: Pt[] = [
          { x: x0, y: y0, p: 0 },
          { x: x1, y: y0, p: 0 },
          { x: x1, y: y1, p: 0 },
          { x: x0, y: y1, p: 0 },
        ];
        for (let i = 0; i < 4; i++) {
          if (distToSegment(x, y, corners[i], corners[(i + 1) % 4]) <= threshold) return true;
        }
        return false;
      }
      case "ellipse": {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const rx = Math.max(Math.abs(b.x - a.x) / 2, 1);
        const ry = Math.max(Math.abs(b.y - a.y) / 2, 1);
        const norm = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (item.filled && norm <= 1) return true;
        // Distance from the outline in normalized space, scaled back roughly.
        return Math.abs(norm - 1) * Math.min(rx, ry) <= threshold;
      }
    }
  }
  // text: generous bounding box
  const w = Math.max(item.text.length * item.size * 0.6, item.size);
  const lines = item.text.split("\n").length;
  return (
    x >= item.x - pad &&
    x <= item.x + w + pad &&
    y >= item.y - item.size - pad &&
    y <= item.y + (lines - 1) * item.size * 1.25 + pad
  );
}

/** Topmost item under the WORLD point, or null. */
export function eraseHit(items: Item[], x: number, y: number, zoom = 1): Item | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (hits(items[i], x, y, zoom)) return items[i];
  }
  return null;
}
