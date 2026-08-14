import { api, onSettingsChanged } from "../shared/ipc";
import type { Settings } from "../shared/types";
import type { TabCtx, TabView } from "./ui";
import { h } from "./ui";
import { generalTab } from "./tabs/general";
import { annotateTab } from "./tabs/annotate";
import { cursorTab } from "./tabs/cursor";
import { spotlightTab } from "./tabs/spotlight";
import { zoomTab } from "./tabs/zoom";
import { shortcutsTab } from "./tabs/shortcuts";

const icon = (paths: string): string =>
  '<svg class="nav-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
  `aria-hidden="true">${paths}</svg>`;

const ICONS = {
  general: icon(
    '<path d="M4 7h4.6M12.4 7H20M4 17h8.6M16.4 17H20"/>' +
      '<circle cx="10.5" cy="7" r="1.9"/><circle cx="14.5" cy="17" r="1.9"/>',
  ),
  annotate: icon(
    '<path d="M4.5 19.5l1.1-3.9L16 5.2a2 2 0 0 1 2.8 2.8L8.4 18.4l-3.9 1.1z"/>' +
      '<path d="M14.2 7l2.8 2.8"/>',
  ),
  cursor: icon(
    '<circle cx="12" cy="12" r="7.2"/>' +
      '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  ),
  spotlight: icon(
    '<path d="M7.5 3.5h9V6c0 1.8-1.8 2.6-1.8 4.4v8.1a1.5 1.5 0 0 1-1.5 1.5h-2.4a1.5 1.5 0 0 1-1.5-1.5v-8.1C9.3 8.6 7.5 7.8 7.5 6V3.5z"/>' +
      '<path d="M7.5 6h9M12 11.5v1.8"/>',
  ),
  zoom: icon(
    '<circle cx="11" cy="11" r="6.4"/><path d="M15.7 15.7L20 20M8.6 11h4.8M11 8.6v4.8"/>',
  ),
  shortcuts: icon(
    '<rect x="3" y="6" width="18" height="12" rx="2"/>' +
      '<path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M6.5 12.5h.01M17 12.5h.01M8.5 15h7"/>',
  ),
};

const BRAND_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="5.2"/>' +
  '<path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6"/></svg>';

interface TabDef {
  id: string;
  label: string;
  icon: string;
  build: (ctx: TabCtx) => TabView;
}

const TABS: TabDef[] = [
  { id: "general", label: "General", icon: ICONS.general, build: generalTab },
  { id: "annotate", label: "Annotate", icon: ICONS.annotate, build: annotateTab },
  { id: "cursor", label: "Cursor", icon: ICONS.cursor, build: cursorTab },
  { id: "spotlight", label: "Spotlight", icon: ICONS.spotlight, build: spotlightTab },
  { id: "zoom", label: "Zoom", icon: ICONS.zoom, build: zoomTab },
  { id: "shortcuts", label: "Shortcuts", icon: ICONS.shortcuts, build: shortcutsTab },
];

const app = document.getElementById("app")!;
const navButtons = new Map<string, HTMLButtonElement>();

let local: Settings | null = null;
let lastSent = "";
let debounceTimer: number | undefined;
let contentEl: HTMLElement | null = null;
let activeView: TabView | null = null;
let activeId = "";

function push(): void {
  if (local === null) return;
  const clone = structuredClone(local);
  lastSent = JSON.stringify(clone);
  api.updateSettings(clone).catch((err: unknown) => {
    console.error("updateSettings failed", err);
  });
}

const ctx: TabCtx = {
  settings: () => {
    if (local === null) throw new Error("settings not loaded yet");
    return local;
  },
  commit: () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = undefined;
    push();
  },
  commitDebounced: () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = undefined;
      push();
    }, 150);
  },
};

function renderShell(): void {
  navButtons.clear();
  const shell = h("div", "shell");

  const nav = h("nav", "nav");
  const brand = h("div", "brand");
  brand.insertAdjacentHTML("beforeend", BRAND_ICON);
  brand.append(h("span", "brand-name", "Penlight"));
  nav.append(brand);

  const list = h("div", "nav-list");
  for (const tab of TABS) {
    const btn = h("button", "nav-item");
    btn.type = "button";
    btn.insertAdjacentHTML("beforeend", tab.icon);
    btn.append(h("span", undefined, tab.label));
    btn.addEventListener("click", () => selectTab(tab.id));
    navButtons.set(tab.id, btn);
    list.append(btn);
  }
  nav.append(list);

  contentEl = h("main", "content");
  shell.append(nav, contentEl);
  app.replaceChildren(shell);
}

function selectTab(id: string): void {
  const tab = TABS.find((t) => t.id === id);
  if (!tab || contentEl === null) return;
  if (activeView !== null && id === activeId) return;
  activeId = id;
  for (const [tid, btn] of navButtons) {
    btn.classList.toggle("active", tid === id);
    btn.setAttribute("aria-current", tid === id ? "page" : "false");
  }
  activeView = tab.build(ctx);
  contentEl.replaceChildren(activeView.el);
  contentEl.scrollTop = 0;
}

function renderLoadError(): void {
  const box = h("div", "boot-note");
  box.append(h("p", undefined, "Could not load settings."));
  const retry = h("button", "text-button", "Try again");
  retry.type = "button";
  retry.addEventListener("click", () => void init());
  box.append(retry);
  app.replaceChildren(box);
}

async function init(): Promise<void> {
  app.replaceChildren(h("div", "boot-note", "Loading settings…"));
  let loaded: Settings;
  try {
    loaded = await api.getSettings();
  } catch (err) {
    console.error("getSettings failed", err);
    renderLoadError();
    return;
  }
  local = loaded;
  renderShell();
  selectTab("general");

  void onSettingsChanged((incoming) => {
    // Echo of our own update: local already matches (or is newer) — keep it.
    if (JSON.stringify(incoming) === lastSent) return;
    local = incoming;
    activeView?.refresh();
  });
}

void init();
