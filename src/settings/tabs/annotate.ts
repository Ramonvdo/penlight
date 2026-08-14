import type { TabCtx, TabView } from "../ui";
import { collector, color, h, row, section, select, slider } from "../ui";

const AUTO_ERASE_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "1", label: "1s" },
  { value: "2", label: "2s" },
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
  { value: "10", label: "10s" },
];

export function annotateTab(ctx: TabCtx): TabView {
  const { use, refreshAll } = collector();
  const s = ctx.settings;

  const swatches = h("div", "swatch-row");
  for (let i = 0; i < 5; i++) {
    swatches.append(
      use(
        color(
          () => s().annotate.favoriteColors[i],
          (v) => {
            s().annotate.favoriteColors[i] = v;
            ctx.commitDebounced();
          },
          `Favorite color ${i + 1}`,
        ),
      ),
    );
  }

  const root = h("div", "tab");
  root.append(
    h("h1", "tab-title", "Annotate"),
    section("Drawing", [
      row("Favorite colors", "The palette shown in the annotation toolbar.", swatches),
      row(
        "Default line weight",
        null,
        use(
          slider({
            min: 1,
            max: 24,
            step: 1,
            get: () => s().annotate.defaultWeight,
            set: (v) => {
              s().annotate.defaultWeight = v;
              ctx.commitDebounced();
            },
            format: (v) => `${v} px`,
          }),
        ),
      ),
      row(
        "Auto-erase delay",
        "Drawings fade away on their own after this delay.",
        use(
          select(
            AUTO_ERASE_OPTIONS,
            () => String(s().annotate.autoEraseSecs),
            (v) => {
              s().annotate.autoEraseSecs = Number(v);
              ctx.commit();
            },
          ),
        ),
      ),
    ]),
    section("Whiteboard", [
      row(
        "When opening the whiteboard",
        "Resume your last board, or start a fresh one every time.",
        use(
          select(
            [
              { value: "resume", label: "Resume last board" },
              { value: "new", label: "Always start a new board" },
            ],
            () => s().whiteboard.onOpen,
            (v) => {
              s().whiteboard.onOpen = v as "resume" | "new";
              ctx.commit();
            },
          ),
        ),
      ),
      row(
        "Board color",
        "Background for new boards.",
        use(
          color(
            () => s().whiteboard.defaultBackground,
            (v) => {
              s().whiteboard.defaultBackground = v;
              ctx.commitDebounced();
            },
            "Board color",
          ),
        ),
      ),
    ]),
    section("Text", [
      row(
        "Text size",
        null,
        use(
          slider({
            min: 16,
            max: 64,
            step: 1,
            get: () => s().annotate.textSize,
            set: (v) => {
              s().annotate.textSize = v;
              ctx.commitDebounced();
            },
            format: (v) => `${v} px`,
          }),
        ),
      ),
    ]),
  );
  return { el: root, refresh: refreshAll };
}
