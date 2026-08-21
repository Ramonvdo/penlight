import { getStroke } from "perfect-freehand";
import type { StrokeItem } from "./display-list";

/**
 * Excalidraw's freedraw tuning (packages/element/src/shape.ts). Pen and touch
 * report far more precise positions than a mouse, so they get much less
 * streamlining — i.e. less lag between the tip and the ink.
 */
export const STREAMLINE_MOUSE = 0.5;
export const STREAMLINE_PRECISE = 0.2;
export const THINNING_PRESSURE = 0.6;
export const THINNING_UNIFORM = 0;
const SMOOTHING = 0.5;

/** easeOutSine — perfect-freehand's linear default reads flatter. */
const easeOutSine = (t: number): number => Math.sin((t * Math.PI) / 2);

/**
 * Options used before strokes carried their own. The ABSENCE of `streamline`
 * is the version tag: strokes saved by an older build replay exactly as they
 * were captured, so upgrading never restyles an existing whiteboard.
 * Invariant: never write `streamline` without also writing the other two.
 */
const LEGACY_THINNING = 0.55;
const LEGACY_STREAMLINE = 0.35;

/**
 * Convert a stroke into a filled outline path via perfect-freehand.
 * A single filled Path2D keeps alpha uniform, which matters for the
 * semi-transparent highlighter (overlapping segments must not double up).
 */
export function strokeOutline(item: StrokeItem): Path2D {
  const { points, weight, highlighter } = item;
  const size = highlighter ? weight * 3 : weight;
  const input = points.map((p) => [p.x, p.y, p.p]);
  const outline =
    item.streamline === undefined
      ? getStroke(input, {
          size,
          thinning: highlighter ? THINNING_UNIFORM : LEGACY_THINNING,
          smoothing: SMOOTHING,
          streamline: LEGACY_STREAMLINE,
          simulatePressure: points.every((p) => p.p === 0.5),
          last: true,
        })
      : getStroke(input, {
          size,
          thinning: highlighter ? THINNING_UNIFORM : (item.thinning ?? THINNING_PRESSURE),
          smoothing: SMOOTHING,
          streamline: item.streamline,
          easing: easeOutSine,
          simulatePressure: item.simulatePressure ?? true,
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
