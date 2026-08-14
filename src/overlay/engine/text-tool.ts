import type { Settings, Snapshot } from "../../shared/types";
import { worldFromScreen } from "./camera";
import { newId, type TextItem } from "./display-list";
import type { Doc } from "./document";

/**
 * Click places a contenteditable editor; Enter/Escape/click-away commits it as
 * a display-list text item. While typing, editor keydown stops propagation so
 * single-key tool shortcuts don't fire.
 */
export class TextTool {
  private editor: HTMLDivElement | null = null;
  private pos = { x: 0, y: 0 };

  constructor(
    private host: HTMLElement,
    private ctx: { snapshot(): Snapshot; settings(): Settings; doc(): Doc },
    private onCommitted: () => void,
  ) {}

  isEditing(): boolean {
    return this.editor !== null;
  }

  begin(x: number, y: number): void {
    if (this.editor) {
      // Clicking elsewhere commits the current editor first.
      this.commit();
      return;
    }
    const snap = this.ctx.snapshot();
    const settings = this.ctx.settings();
    const cam = this.ctx.doc().camera;
    const zoom = cam?.zoom ?? 1;
    const size = settings.annotate.textSize;
    const colors = settings.annotate.favoriteColors;
    const color =
      snap.colorIndex === 5 ? colors[0] : colors[Math.min(snap.colorIndex, colors.length - 1)];
    const div = document.createElement("div");
    div.contentEditable = "true";
    div.className = "text-editor";
    // The editor lives in screen space; the committed item stores world coords.
    div.style.left = `${x}px`;
    div.style.top = `${y - size * zoom}px`;
    div.style.fontSize = `${size * zoom}px`;
    div.style.color = color;
    div.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.commit();
      } else if (e.key === "Escape") {
        this.commit();
      }
    });
    this.host.append(div);
    this.pos = cam ? worldFromScreen(cam, x, y) : { x, y };
    this.editor = div;
    requestAnimationFrame(() => div.focus());
  }

  commit(): void {
    const div = this.editor;
    if (!div) return;
    this.editor = null;
    const text = div.innerText.replace(/ /g, " ").trimEnd();
    if (text.trim().length > 0) {
      const settings = this.ctx.settings();
      const doc = this.ctx.doc();
      const secs = doc.kind === "board" ? 0 : settings.annotate.autoEraseSecs;
      const item: TextItem = {
        kind: "text",
        id: newId(),
        x: this.pos.x,
        y: this.pos.y,
        text,
        color: { flat: div.style.color },
        size: settings.annotate.textSize,
        expiresAt: secs > 0 ? Date.now() + secs * 1000 : undefined,
      };
      doc.list.add(item);
      doc.undo.push({ type: "add", item });
      this.onCommitted();
    }
    div.remove();
  }

  cancel(): void {
    this.editor?.remove();
    this.editor = null;
  }
}
