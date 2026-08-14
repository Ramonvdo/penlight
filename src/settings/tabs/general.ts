import type { TabCtx, TabView } from "../ui";
import { collector, h, row, section, toggle } from "../ui";

export function generalTab(ctx: TabCtx): TabView {
  const { use, refreshAll } = collector();
  const s = ctx.settings;

  const root = h("div", "tab");
  root.append(
    h("h1", "tab-title", "General"),
    section("Startup", [
      row(
        "Launch at login",
        "Start Penlight automatically when you sign in to Windows.",
        use(
          toggle(
            () => s().launchAtLogin,
            (v) => {
              s().launchAtLogin = v;
              ctx.commit();
            },
          ),
        ),
      ),
      row(
        "Cursor highlight on launch",
        "Turn the halo on as soon as Penlight starts.",
        use(
          toggle(
            () => s().haloOnLaunch,
            (v) => {
              s().haloOnLaunch = v;
              ctx.commit();
            },
          ),
        ),
      ),
    ]),
    section("Advanced", [
      row(
        "Disable GPU compositing",
        "Workaround for flicker on some Intel GPUs; needs restart.",
        use(
          toggle(
            () => s().disableGpuCompositing,
            (v) => {
              s().disableGpuCompositing = v;
              ctx.commit();
            },
          ),
        ),
      ),
    ]),
  );
  return { el: root, refresh: refreshAll };
}
