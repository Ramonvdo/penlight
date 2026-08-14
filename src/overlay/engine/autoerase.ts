import type { DisplayList } from "./display-list";
import type { UndoStack } from "./undo";

/** Sweeps expired (auto-erase) items out of the display list. */
export class AutoEraser {
  private timer: number;

  constructor(
    private list: DisplayList,
    private undo: UndoStack,
    private onChange: () => void,
  ) {
    this.timer = window.setInterval(() => this.sweep(), 250);
  }

  sweep(): void {
    const now = Date.now();
    const expired = this.list.items.filter((i) => i.expiresAt !== undefined && i.expiresAt <= now);
    if (expired.length === 0) return;
    const ids = new Set(expired.map((i) => i.id));
    this.list.remove(ids);
    this.undo.dropItems(ids);
    this.onChange();
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }
}
