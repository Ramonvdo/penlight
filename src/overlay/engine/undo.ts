import type { DisplayList, Item } from "./display-list";

export type Op =
  | { type: "add"; item: Item }
  | { type: "remove"; items: Item[] }
  | { type: "clear"; items: Item[] };

/** Unlimited undo/redo over display-list operations. */
export class UndoStack {
  private undoOps: Op[] = [];
  private redoOps: Op[] = [];

  push(op: Op): void {
    this.undoOps.push(op);
    this.redoOps = [];
  }

  undo(list: DisplayList): boolean {
    const op = this.undoOps.pop();
    if (!op) return false;
    if (op.type === "add") {
      list.remove(new Set([op.item.id]));
    } else {
      list.restore(op.items);
    }
    this.redoOps.push(op);
    return true;
  }

  redo(list: DisplayList): boolean {
    const op = this.redoOps.pop();
    if (!op) return false;
    if (op.type === "add") {
      list.restore([op.item]);
    } else {
      list.remove(new Set(op.items.map((i) => i.id)));
    }
    this.undoOps.push(op);
    return true;
  }

  /** Auto-erased items vanish from history so undo can't resurrect them. */
  dropItems(ids: Set<number>): void {
    const filterOps = (ops: Op[]) =>
      ops
        .map((op): Op | null => {
          if (op.type === "add") {
            return ids.has(op.item.id) ? null : op;
          }
          const kept = op.items.filter((i) => !ids.has(i.id));
          if (kept.length === 0) return null;
          return { ...op, items: kept };
        })
        .filter((op): op is Op => op !== null);
    this.undoOps = filterOps(this.undoOps);
    this.redoOps = filterOps(this.redoOps);
  }

  reset(): void {
    this.undoOps = [];
    this.redoOps = [];
  }
}
