import type { TabCtx, TabView } from "../ui";
import { h, row, section, textButton } from "../ui";

const DEFAULTS: Record<string, string> = {
  annotate: "Ctrl+Alt+A",
  annotate_no_toolbar: "Ctrl+Alt+Shift+A",
  whiteboard: "Ctrl+Alt+W",
  halo: "Ctrl+Alt+H",
  spotlight: "Ctrl+Alt+L",
  zoom: "Ctrl+Alt+Z",
};

const ROWS: ReadonlyArray<readonly [string, string]> = [
  ["annotate", "Annotate screen"],
  ["annotate_no_toolbar", "Annotate without toolbar"],
  ["whiteboard", "Whiteboard"],
  ["halo", "Cursor highlight"],
  ["spotlight", "Spotlight"],
  ["zoom", "Zoom"],
];

/** Letter, digit, or F-key from a keydown; null for modifiers and anything else. */
function mainKeyFrom(e: KeyboardEvent): string | null {
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return null;
}

export function shortcutsTab(ctx: TabCtx): TabView {
  const refreshers: Array<() => void> = [];
  const s = ctx.settings;

  const makeRecorder = (key: string): HTMLElement => {
    const wrap = h("div", "shortcut-cell");
    const field = h("button", "shortcut-field");
    field.type = "button";
    let recording = false;

    const display = (): void => {
      const v = s().shortcuts[key] ?? "";
      field.classList.remove("recording");
      field.classList.toggle("is-disabled", v === "");
      field.replaceChildren();
      if (v === "") {
        field.append(h("span", "shortcut-none", "Disabled"));
      } else {
        for (const part of v.split("+")) field.append(h("kbd", "key", part));
      }
    };

    const apply = (v: string): void => {
      s().shortcuts[key] = v;
      ctx.commit();
    };

    const stop = (): void => {
      if (!recording) return;
      recording = false;
      window.removeEventListener("keydown", onKey, true);
      display();
    };

    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        stop();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        apply("");
        stop();
        return;
      }
      const main = mainKeyFrom(e);
      if (main === null) return; // bare modifier or unsupported key: keep listening
      if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
        field.replaceChildren(h("span", "shortcut-hint", "Add Ctrl, Alt or Shift"));
        return;
      }
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      parts.push(main);
      apply(parts.join("+"));
      stop();
    };

    field.addEventListener("click", () => {
      if (recording) return;
      recording = true;
      field.classList.add("recording");
      field.classList.remove("is-disabled");
      field.replaceChildren(h("span", "shortcut-hint", "Press shortcut…"));
      window.addEventListener("keydown", onKey, true);
    });
    field.addEventListener("blur", stop);

    const reset = textButton("Reset", () => {
      stop();
      apply(DEFAULTS[key] ?? "");
      display();
    });
    reset.classList.add("shortcut-reset");
    reset.title = `Restore ${DEFAULTS[key] ?? "default"}`;

    wrap.append(field, reset);
    refreshers.push(() => {
      if (!recording) display();
    });
    display();
    return wrap;
  };

  const root = h("div", "tab");
  root.append(
    h("h1", "tab-title", "Shortcuts"),
    section(
      "Global shortcuts",
      ROWS.map(([key, label]) => row(label, null, makeRecorder(key))),
      "Changes apply immediately. While recording, press Escape to cancel or Backspace to disable the shortcut.",
    ),
  );
  return {
    el: root,
    refresh: () => {
      for (const fn of refreshers) fn();
    },
  };
}
