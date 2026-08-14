import { api } from "../shared/ipc";
import { WEIGHT_STEPS } from "../shared/types";

export interface KeyContext {
  undo(): void;
  redo(): void;
  clearAll(): void;
  weight(): number;
  interactive(): boolean;
  boardPanel(): void;
}

function stepWeight(current: number, dir: 1 | -1): number {
  let idx = WEIGHT_STEPS.findIndex((w) => w >= current);
  if (idx === -1) idx = WEIGHT_STEPS.length - 1;
  const next = Math.max(0, Math.min(WEIGHT_STEPS.length - 1, idx + dir));
  return WEIGHT_STEPS[next];
}

/** In-mode single-key shortcuts, captured while the overlay has focus. */
export function installKeys(ctx: KeyContext): void {
  window.addEventListener("keydown", (e) => {
    // The text editor handles its own keys (and stops propagation); this
    // guard covers any other editable target (incl. the board rename input).
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
      return;
    }
    if (e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        ctx.undo();
        return;
      }
      if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        ctx.redo();
        return;
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case "f":
        void api.setTool("freehand");
        break;
      case "h":
        void api.setTool("highlighter");
        break;
      case "a":
        void api.setTool("arrow");
        break;
      case "l":
        void api.setTool("line");
        break;
      case "r":
        void api.setTool("rect");
        break;
      case "c":
        void api.setTool("ellipse");
        break;
      case "t":
        void api.setTool("text");
        break;
      case "e":
        void api.setTool("eraser");
        break;
      case "w":
        void api.whiteboardToggle();
        break;
      case "b":
        ctx.boardPanel();
        break;
      case "i":
        void api.setInteractive(!ctx.interactive());
        break;
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
        void api.setColor(Number(e.key) - 1);
        break;
      case "6":
        void api.setColor(5);
        break;
      case "[":
        void api.setWeight(stepWeight(ctx.weight(), -1));
        break;
      case "]":
        void api.setWeight(stepWeight(ctx.weight(), 1));
        break;
      case "backspace":
      case "delete":
        ctx.clearAll();
        break;
      case "escape":
        void api.annotateExit();
        break;
    }
  });
}
