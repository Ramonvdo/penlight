import { normalizeHex } from "../shared/color";
import { icons } from "../shared/icons";
import { api, onSettingsChanged, onStateChanged } from "../shared/ipc";
import type { Settings, Snapshot, Tool } from "../shared/types";
import { WEIGHT_STEPS } from "../shared/types";

const root = document.getElementById("toolbar")!;

const TOOLS: { tool: Tool; icon: string; label: string; key: string }[] = [
  { tool: "freehand", icon: icons.pen, label: "Free hand", key: "F" },
  { tool: "highlighter", icon: icons.highlighter, label: "Highlighter", key: "H" },
  { tool: "arrow", icon: icons.arrow, label: "Arrow", key: "A" },
  { tool: "line", icon: icons.line, label: "Line", key: "L" },
  { tool: "rect", icon: icons.rect, label: "Rectangle", key: "R" },
  { tool: "ellipse", icon: icons.ellipse, label: "Circle", key: "C" },
  { tool: "text", icon: icons.text, label: "Text", key: "T" },
];

let snapshot: Snapshot | null = null;
let favoriteColors: string[] = ["#2FB4F6", "#EF5350", "#5DC963", "#FFD52E", "#9B59E8"];

function el(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}

function button(id: string, icon: string, title: string): HTMLButtonElement {
  const b = el(`<button id="${id}" title="${title}">${icon}</button>`) as HTMLButtonElement;
  return b;
}

function divider(): HTMLElement {
  return el(`<div class="divider"></div>`);
}

function render(): void {
  root.replaceChildren();

  const grip = el(`<div class="grip" data-tauri-drag-region>${icons.grip}</div>`);
  root.append(grip);

  for (let i = 0; i < 5; i++) {
    const dot = el(
      `<button class="dot" data-color="${i}" title="Color ${i + 1} (${i + 1})"><span></span></button>`,
    );
    dot.addEventListener("click", () => void api.setColor(i));
    root.append(dot);
  }
  const gradientDot = el(
    `<button class="dot gradient" data-color="5" title="Random gradient colors (6)"><span></span></button>`,
  );
  gradientDot.addEventListener("click", () => void api.setColor(5));
  root.append(gradientDot);

  root.append(divider());

  for (const t of TOOLS) {
    const b = button(`tool-${t.tool}`, t.icon, `${t.label} (${t.key})`);
    b.dataset.tool = t.tool;
    b.addEventListener("click", () => void api.setTool(t.tool));
    root.append(b);
  }

  root.append(divider());

  const eraser = button("tool-eraser", icons.eraser, "Eraser (E)");
  eraser.dataset.tool = "eraser";
  eraser.addEventListener("click", () => void api.setTool("eraser"));
  root.append(eraser);

  const weight = button("weight", icons.weight, "Line weight ([ / ])");
  weight.addEventListener("click", () => {
    const current = snapshot?.weight ?? 4;
    let idx = WEIGHT_STEPS.findIndex((w) => w >= current);
    if (idx === -1) idx = WEIGHT_STEPS.length - 1;
    const next = WEIGHT_STEPS[(idx + 1) % WEIGHT_STEPS.length];
    void api.setWeight(next);
  });
  root.append(weight);

  root.append(divider());

  const boards = button("boards", icons.boards, "Boards (B)");
  boards.style.display = "none";
  boards.addEventListener("click", () => void api.boardPanelToggle());
  root.append(boards);

  const interact = button("interact", icons.cursorArrow, "Interact with apps (I)");
  interact.addEventListener("click", () => void api.setInteractive(!snapshot?.interactive));
  root.append(interact);

  const close = button("close", icons.close, "Exit annotate (Esc)");
  close.classList.add("close");
  close.addEventListener("click", () => void api.annotateExit());
  root.append(close);

  applyColors();
  applyActive();
}

function applyColors(): void {
  root.querySelectorAll<HTMLElement>(".dot:not(.gradient) span").forEach((span, i) => {
    span.style.background = normalizeHex(favoriteColors[i] ?? "#ffffff");
  });
  const gradient = root.querySelector<HTMLElement>(".dot.gradient span");
  if (gradient) {
    gradient.style.background =
      "conic-gradient(#ff5f6d, #ffc371, #47e891, #3aa4ff, #b06ab3, #ff5f6d)";
  }
}

function applyActive(): void {
  if (!snapshot) return;
  const s = snapshot;
  root.querySelectorAll<HTMLElement>(".dot").forEach((dot) => {
    dot.classList.toggle("active", Number(dot.dataset.color) === s.colorIndex);
  });
  root.querySelectorAll<HTMLElement>("button[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === s.tool);
  });
  document.getElementById("interact")?.classList.toggle("active", s.interactive);
  const boards = document.getElementById("boards");
  if (boards) boards.style.display = s.whiteboard ? "" : "none";
  const weight = document.getElementById("weight");
  if (weight) weight.title = `Line weight: ${s.weight}px ([ / ])`;
}

render();

void onStateChanged((s) => {
  snapshot = s;
  applyActive();
});
void onSettingsChanged((s: Settings) => {
  favoriteColors = s.annotate.favoriteColors;
  applyColors();
});
void api.getSettings().then((s) => {
  favoriteColors = s.annotate.favoriteColors;
  applyColors();
});
void api.getSnapshot().then((s) => {
  snapshot = s;
  applyActive();
});
