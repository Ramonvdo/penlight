import { getStroke } from "perfect-freehand";
import type { Pt } from "./display-list";

/**
 * Convert raw input points into a filled outline path via perfect-freehand.
 * A single filled Path2D keeps alpha uniform, which matters for the
 * semi-transparent highlighter (overlapping segments must not double up).
 */
export function strokeOutline(points: Pt[], weight: number, highlighter: boolean): Path2D {
  const input = points.map((p) => [p.x, p.y, p.p]);
  const outline = getStroke(input, {
    size: highlighter ? weight * 3 : weight,
    thinning: highlighter ? 0 : 0.55,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: points.every((p) => p.p === 0.5),
    last: true,
  });
  const path = new Path2D();
  if (outline.length > 2) {
    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      path.lineTo(outline[i][0], outline[i][1]);
    }
    path.closePath();
  }
  return path;
}
