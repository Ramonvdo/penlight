import type { TabCtx, TabView } from "../ui";
import { collector, color, h, hexToRgba, row, section, slider } from "../ui";

export function spotlightTab(ctx: TabCtx): TabView {
  const { use, refreshAll } = collector();
  const s = ctx.settings;

  const preview = h("div", "spot-preview");
  const dim = h("div", "spot-dim");
  preview.append(dim);

  const paintDim = (): void => {
    const sp = s().spotlight;
    const r = Math.max(16, Math.round(sp.radius * 0.3));
    dim.style.background =
      `radial-gradient(circle at 50% 46%, transparent ${r - 1}px, ` +
      `${hexToRgba(sp.dimColor, sp.dimOpacity)} ${r}px)`;
  };
  paintDim();

  const root = h("div", "tab");
  root.append(
    h("h1", "tab-title", "Spotlight"),
    section("Preview", [preview]),
    section("Spotlight", [
      row(
        "Radius",
        null,
        use(
          slider({
            min: 60,
            max: 400,
            step: 1,
            get: () => s().spotlight.radius,
            set: (v) => {
              s().spotlight.radius = v;
              paintDim();
              ctx.commitDebounced();
            },
            format: (v) => `${v} px`,
          }),
        ),
      ),
      row(
        "Dim opacity",
        "How dark the screen gets outside the spotlight.",
        use(
          slider({
            min: 0.2,
            max: 0.95,
            step: 0.05,
            get: () => s().spotlight.dimOpacity,
            set: (v) => {
              s().spotlight.dimOpacity = v;
              paintDim();
              ctx.commitDebounced();
            },
            format: (v) => `${Math.round(v * 100)}%`,
          }),
        ),
      ),
      row(
        "Dim color",
        null,
        use(
          color(
            () => s().spotlight.dimColor,
            (v) => {
              s().spotlight.dimColor = v;
              paintDim();
              ctx.commitDebounced();
            },
            "Dim color",
          ),
        ),
      ),
    ]),
  );
  return {
    el: root,
    refresh: () => {
      refreshAll();
      paintDim();
    },
  };
}
