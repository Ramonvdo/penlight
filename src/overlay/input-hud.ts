/**
 * Opt-in pointer-event readout (Settings → General → Input diagnostics).
 *
 * Drawing tablets fail in ways that are invisible from the app's side: the
 * question is always "is WebView2 even delivering pen events here?". This
 * answers it on screen, without devtools, on an overlay window that has no
 * address bar. Completely inert while disabled — no listeners attached.
 */
export class InputHud {
  private el: HTMLDivElement | null = null;
  private enabled = false;
  private count = 0;
  private windowStart = 0;
  private rate = 0;
  private last = "";
  private rafId = 0;

  private readonly onPointer = (e: PointerEvent): void => {
    const coalesced = e.getCoalescedEvents?.().length ?? 0;
    this.last =
      `${e.type.replace("pointer", "")} · ${e.pointerType || "?"}` +
      ` · id ${e.pointerId}` +
      `\npressure ${e.pressure.toFixed(3)} · button ${e.button} · buttons ${e.buttons}` +
      `\ncoalesced ${coalesced} · tilt ${e.tiltX ?? 0}/${e.tiltY ?? 0}`;
    const now = performance.now();
    if (this.windowStart === 0) this.windowStart = now;
    this.count++;
    if (now - this.windowStart >= 500) {
      this.rate = Math.round((this.count * 1000) / (now - this.windowStart));
      this.count = 0;
      this.windowStart = now;
    }
    this.schedule();
  };

  private schedule(): void {
    if (this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (this.el) this.el.textContent = `${this.last}\n${this.rate} events/sec`;
    });
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      const el = document.createElement("div");
      el.id = "input-hud";
      el.textContent = "waiting for pointer input…";
      document.body.append(el);
      this.el = el;
      // Capture phase: report what arrives even if a handler stops propagation.
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        window.addEventListener(type, this.onPointer as EventListener, true);
      }
    } else {
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        window.removeEventListener(type, this.onPointer as EventListener, true);
      }
      if (this.rafId !== 0) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      this.el?.remove();
      this.el = null;
    }
  }
}
