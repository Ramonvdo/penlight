export interface Pt {
  x: number;
  y: number;
  /** pressure 0..1; 0.5 for mouse */
  p: number;
}

export interface Color {
  flat?: string;
  gradient?: [string, string];
}

export interface StrokeItem {
  kind: "stroke";
  id: number;
  points: Pt[];
  color: Color;
  weight: number;
  highlighter: boolean;
  expiresAt?: number;
}

export type ShapeKind = "arrow" | "line" | "rect" | "ellipse";

export interface ShapeItem {
  kind: "shape";
  id: number;
  shape: ShapeKind;
  a: Pt;
  b: Pt;
  color: Color;
  weight: number;
  filled: boolean;
  expiresAt?: number;
}

export interface TextItem {
  kind: "text";
  id: number;
  x: number;
  y: number;
  text: string;
  color: Color;
  size: number;
  expiresAt?: number;
}

export type Item = StrokeItem | ShapeItem | TextItem;

let nextId = 1;
export function newId(): number {
  return nextId++;
}

/**
 * After loading a persisted board, bump the id counter past every loaded id —
 * otherwise a new item could collide with a loaded one and eraser/undo would
 * hit two items at once.
 */
export function seedIds(min: number): void {
  if (min > nextId) nextId = min;
}

/** The annotation model: an ordered display list, never a bitmap. */
export class DisplayList {
  items: Item[] = [];

  add(item: Item): void {
    this.items.push(item);
  }

  remove(ids: Set<number>): Item[] {
    const removed = this.items.filter((i) => ids.has(i.id));
    this.items = this.items.filter((i) => !ids.has(i.id));
    return removed;
  }

  clear(): Item[] {
    const old = this.items;
    this.items = [];
    return old;
  }

  restore(items: Item[]): void {
    this.items.push(...items);
    this.items.sort((a, b) => a.id - b.id);
  }
}
