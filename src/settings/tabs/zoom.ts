import type { TabCtx, TabView } from "../ui";
import { collector, color, h, row, section, select, slider, toggle } from "../ui";

export function zoomTab(ctx: TabCtx): TabView {
  const { use, refreshAll } = collector();
  const s = ctx.settings;

  const root = h("div", "tab");
  root.append(
    h("h1", "tab-title", "Zoom"),
    section("Zoom", [
      row(
        "Style",
        "Lens follows your cursor like a magnifying glass; Monitor magnifies the whole screen (ZoomIt-style).",
        use(
          select(
            [
              { value: "lens", label: "Lens" },
              { value: "monitor", label: "Monitor" },
            ],
            () => s().zoom.style,
            (v) => {
              s().zoom.style = v as "lens" | "monitor";
              ctx.commit();
            },
          ),
        ),
      ),
      row(
        "Default zoom level",
        "Magnification applied when zoom is turned on (Ctrl+Alt+, / . while zoomed).",
        use(
          slider({
            min: 1.5,
            max: 8,
            step: 0.5,
            get: () => s().zoom.defaultLevel,
            set: (v) => {
              s().zoom.defaultLevel = v;
              ctx.commitDebounced();
            },
            format: (v) => `${v.toFixed(1)}x`,
          }),
        ),
      ),
      row(
        "Smoothing",
        "Bilinear smoothing of the magnified image.",
        use(
          toggle(
            () => s().zoom.smoothing,
            (v) => {
              s().zoom.smoothing = v;
              ctx.commit();
            },
          ),
        ),
      ),
    ]),
    section("Lens", [
      row(
        "Lens size",
        "Diameter of the glass (Ctrl+Alt+- / = while zoomed).",
        use(
          slider({
            min: 200,
            max: 600,
            step: 20,
            get: () => s().zoom.lensSize,
            set: (v) => {
              s().zoom.lensSize = v;
              ctx.commitDebounced();
            },
            format: (v) => `${v}px`,
          }),
        ),
      ),
      row(
        "Lens shape",
        null,
        use(
          select(
            [
              { value: "rounded", label: "Rounded square" },
              { value: "circle", label: "Circle" },
            ],
            () => s().zoom.shape,
            (v) => {
              s().zoom.shape = v as "rounded" | "circle";
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
            min: 0,
            max: 10,
            step: 1,
            get: () => s().zoom.borderWidth,
            set: (v) => {
              s().zoom.borderWidth = v;
              ctx.commitDebounced();
            },
            format: (v) => `${v}px`,
          }),
        ),
      ),
      row(
        "Border color",
        null,
        use(
          color(
            () => s().zoom.borderColor,
            (v) => {
              s().zoom.borderColor = v;
              ctx.commitDebounced();
            },
          ),
        ),
      ),
    ]),
  );
  return { el: root, refresh: refreshAll };
}
