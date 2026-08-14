import type { CursorCfg } from "../../shared/types";
import type { TabCtx, TabView } from "../ui";
import { collector, color, h, hexToRgba, row, section, select, slider, toggle } from "../ui";

const RADIUS_BY_SHAPE: Record<CursorCfg["shape"], string> = {
  ring: "50%",
  squircle: "30%",
  rhombus: "12%",
};

export function cursorTab(ctx: TabCtx): TabView {
  const { use, refreshAll } = collector();
  const s = ctx.settings;

  const preview = h("div", "cursor-preview");
  preview.title = "Click to preview the pulse";
  const halo = h("div", "cursor-halo");
  preview.append(halo);

  const paintHalo = (): void => {
    const c = s().cursor;
    const scale = Math.min(1, 104 / c.size);
    halo.style.width = `${c.size}px`;
    halo.style.height = `${c.size}px`;
    halo.style.border = `${c.borderWidth}px ${c.borderStyle} ${c.color}`;
    halo.style.opacity = String(c.opacity);
    halo.style.borderRadius = RADIUS_BY_SHAPE[c.shape];
    halo.style.transform = `${c.shape === "rhombus" ? "rotate(45deg) " : ""}scale(${scale})`;
    halo.style.setProperty("--pulse-color", hexToRgba(c.color, 0.55));
  };
  paintHalo();

  preview.addEventListener("pointerdown", () => {
    if (!s().cursor.pulseOnClick) return;
    halo.classList.remove("pulse");
    void halo.offsetWidth; // restart the animation
    halo.classList.add("pulse");
  });

  const root = h("div", "tab");
  root.append(
    h("h1", "tab-title", "Cursor highlight"),
    section("Preview", [preview]),
    section("Appearance", [
      row(
        "Shape",
        null,
        use(
          select(
            [
              { value: "ring", label: "Ring" },
              { value: "squircle", label: "Squircle" },
              { value: "rhombus", label: "Rhombus" },
            ],
            () => s().cursor.shape,
            (v) => {
              s().cursor.shape = v as CursorCfg["shape"];
              paintHalo();
              ctx.commit();
            },
          ),
        ),
      ),
      row(
        "Color",
        null,
        use(
          color(
            () => s().cursor.color,
            (v) => {
              s().cursor.color = v;
              paintHalo();
              ctx.commitDebounced();
            },
            "Halo color",
          ),
        ),
      ),
      row(
        "Size",
        null,
        use(
          slider({
            min: 24,
            max: 200,
            step: 1,
            get: () => s().cursor.size,
            set: (v) => {
              s().cursor.size = v;
              paintHalo();
              ctx.commitDebounced();
            },
            format: (v) => `${v} px`,
          }),
        ),
      ),
      row(
        "Border style",
        null,
        use(
          select(
            [
              { value: "solid", label: "Solid" },
              { value: "dashed", label: "Dashed" },
            ],
            () => s().cursor.borderStyle,
            (v) => {
              s().cursor.borderStyle = v as CursorCfg["borderStyle"];
              paintHalo();
              ctx.commit();
            },
          ),
        ),
      ),
      row(
        "Border width",
        null,
        use(
          slider({
            min: 1,
            max: 12,
            step: 1,
            get: () => s().cursor.borderWidth,
            set: (v) => {
              s().cursor.borderWidth = v;
              paintHalo();
              ctx.commitDebounced();
            },
            format: (v) => `${v} px`,
          }),
        ),
      ),
      row(
        "Opacity",
        null,
        use(
          slider({
            min: 0.1,
            max: 1,
            step: 0.05,
            get: () => s().cursor.opacity,
            set: (v) => {
              s().cursor.opacity = v;
              paintHalo();
              ctx.commitDebounced();
            },
            format: (v) => `${Math.round(v * 100)}%`,
          }),
        ),
      ),
    ]),
    section("Behavior", [
      row(
        "Pulse on click",
        "Play a short ripple around the halo whenever you click.",
        use(
          toggle(
            () => s().cursor.pulseOnClick,
            (v) => {
              s().cursor.pulseOnClick = v;
              ctx.commit();
            },
          ),
        ),
      ),
      row(
        "Visibility",
        null,
        use(
          select(
            [
              { value: "always", label: "Always" },
              { value: "clicks", label: "Only on clicks" },
              { value: "moving", label: "Only when moving" },
            ],
            () => s().cursor.visibility,
            (v) => {
              s().cursor.visibility = v as CursorCfg["visibility"];
              ctx.commit();
            },
          ),
        ),
      ),
    ]),
  );
  return {
    el: root,
    refresh: () => {
      refreshAll();
      paintHalo();
    },
  };
}
