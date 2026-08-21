import { api } from "../../shared/ipc";
import type { TabCtx, TabView } from "../ui";
import { collector, h, row, section, toggle } from "../ui";

export function generalTab(ctx: TabCtx): TabView {
  const { use, refreshAll } = collector();
  const s = ctx.settings;

  const launchRow = row(
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
  );
  // The Store build starts with Windows through its package manifest, which
  // only Windows itself can switch on — a toggle here would do nothing.
  void api.isPackaged().then((packaged) => {
    if (!packaged) return;
    launchRow.replaceChildren();
    const text = h("div", "row-text");
    text.append(
      h("div", "row-label", "Launch at login"),
      h(
        "div",
        "row-helper",
        "Managed by Windows for Store installs: Settings → Apps → Startup → Penlight.",
      ),
    );
    launchRow.append(text);
  });

  const root = h("div", "tab");
  root.append(
    h("h1", "tab-title", "General"),
    section("Startup", [
      launchRow,
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
      row(
        "Input diagnostics",
        "Show a live readout of pointer events while annotating — useful when a drawing tablet or stylus misbehaves.",
        use(
          toggle(
            () => s().inputDiagnostics,
            (v) => {
              s().inputDiagnostics = v;
              ctx.commit();
            },
          ),
        ),
      ),
    ]),
  );
  return { el: root, refresh: refreshAll };
}
