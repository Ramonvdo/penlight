import { normalizeHex } from "../shared/color";
import type { Settings } from "../shared/types";

/** Shared context handed to every tab builder. */
export interface TabCtx {
  /** Always returns the current local Settings object (mutate it, then commit). */
  settings: () => Settings;
  /** Push the current settings to the backend immediately. */
  commit: () => void;
  /** Push after a short debounce — for sliders and color drags. */
  commitDebounced: () => void;
}

export interface TabView {
  el: HTMLElement;
  /** Re-read settings into every control (skips whichever control is being edited). */
  refresh: () => void;
}

export interface Control {
  el: HTMLElement;
  refresh: () => void;
}

/** Tiny element factory. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isBeingEdited(node: Element): boolean {
  return document.activeElement === node || node.matches(":active");
}

/** Collects control refreshers so a tab can sync everything in one call. */
export function collector(): { use: (c: Control) => HTMLElement; refreshAll: () => void } {
  const fns: Array<() => void> = [];
  return {
    use: (c) => {
      fns.push(c.refresh);
      return c.el;
    },
    refreshAll: () => {
      for (const fn of fns) fn();
    },
  };
}

/** A titled group of rows separated by hairlines (no card boxes). */
export function section(caption: string, rows: HTMLElement[], footnote?: string): HTMLElement {
  const wrap = h("section", "section");
  wrap.append(h("div", "section-caption", caption));
  const body = h("div", "rows");
  body.append(...rows);
  wrap.append(body);
  if (footnote) wrap.append(h("p", "section-footnote", footnote));
  return wrap;
}

/** Label + optional helper on the left, control on the right. */
export function row(label: string, helper: string | null, control: HTMLElement): HTMLElement {
  const r = h("div", "row");
  const text = h("div", "row-text");
  text.append(h("div", "row-label", label));
  if (helper) text.append(h("div", "row-helper", helper));
  const ctl = h("div", "row-control");
  ctl.append(control);
  r.append(text, ctl);
  return r;
}

export function toggle(get: () => boolean, set: (v: boolean) => void): Control {
  const label = h("label", "toggle");
  const input = h("input");
  input.type = "checkbox";
  input.checked = get();
  const track = h("span", "toggle-track");
  track.append(h("span", "toggle-knob"));
  label.append(input, track);
  input.addEventListener("change", () => set(input.checked));
  return {
    el: label,
    refresh: () => {
      if (!isBeingEdited(input)) input.checked = get();
    },
  };
}

export interface SliderOpts {
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  format?: (v: number) => string;
}

export function slider(o: SliderOpts): Control {
  const wrap = h("div", "slider");
  const input = h("input");
  input.type = "range";
  input.min = String(o.min);
  input.max = String(o.max);
  input.step = String(o.step);
  const value = h("span", "slider-value");
  const fmt = o.format ?? ((v: number) => String(v));
  const paint = (): void => {
    const v = Number(input.value);
    const pct = ((v - o.min) / (o.max - o.min)) * 100;
    input.style.setProperty("--fill", `${pct}%`);
    value.textContent = fmt(v);
  };
  input.value = String(o.get());
  paint();
  input.addEventListener("input", () => {
    o.set(Number(input.value));
    paint();
  });
  wrap.append(input, value);
  return {
    el: wrap,
    refresh: () => {
      if (isBeingEdited(input)) return;
      input.value = String(o.get());
      paint();
    },
  };
}

export interface SelectOption {
  value: string;
  label: string;
}

const CHEVRON_SVG =
  '<svg class="select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m6 9.5 6 6 6-6"/></svg>';

export function select(
  options: SelectOption[],
  get: () => string,
  set: (v: string) => void,
): Control {
  const wrap = h("span", "select-wrap");
  const sel = h("select");
  for (const opt of options) {
    const o = h("option", undefined, opt.label);
    o.value = opt.value;
    sel.append(o);
  }
  sel.value = get();
  sel.addEventListener("change", () => set(sel.value));
  wrap.append(sel);
  wrap.insertAdjacentHTML("beforeend", CHEVRON_SVG);
  return {
    el: wrap,
    refresh: () => {
      if (!isBeingEdited(sel)) sel.value = get();
    },
  };
}

export function color(get: () => string, set: (v: string) => void, label?: string): Control {
  const input = h("input", "color");
  input.type = "color";
  if (label) input.title = label;
  input.value = normalizeHex(get());
  input.addEventListener("input", () => set(input.value));
  return {
    el: input,
    refresh: () => {
      if (!isBeingEdited(input)) input.value = normalizeHex(get());
    },
  };
}

export function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = h("button", "text-button", label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = normalizeHex(hex);
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
