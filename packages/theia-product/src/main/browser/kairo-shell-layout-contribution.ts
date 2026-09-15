/**
 * Keep the Theia application shell filling the window so the status bar
 * stays at the true bottom — especially on high-DPI / 2K displays where
 * mismatched shell geometry leaves empty space under the status bar
 * (looking like it sits mid-window) and can interfere with split sashes.
 *
 * UI-18: the px intervention below is a last-resort guard, not the layout
 * owner. Lumino remains the geometry authority: we only write styles when
 * a >2px gap is actually measured, observe the host size (ResizeObserver)
 * in addition to window resizes, and clean everything up on stop.
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';

@injectable()
export class KairoShellLayoutContribution implements FrontendApplicationContribution {
  protected resizeHandler?: () => void;
  protected resizeRaf?: number;
  protected settleTimers: number[] = [];
  protected hostObserver?: ResizeObserver;
  protected visibilityHandler?: () => void;

  onStart(app: FrontendApplication): void {
    const sync = () => this.ensureShellFillsWindow(app);
    requestAnimationFrame(sync);
    // Continuous window dragging fires resize faster than frames; coalescing
    // to one geometry pass per animation frame avoids layout thrashing
    // (read clientHeight/Width → write style → Lumino update per event).
    this.resizeHandler = () => {
      if (this.resizeRaf !== undefined) {
        return;
      }
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = undefined;
        sync();
      });
    };
    window.addEventListener('resize', this.resizeHandler);
    // Observe the shell's host element directly: DPI changes, cross-monitor
    // moves and layout restores can change host size without a window
    // resize event. Guarded — only measures, never writes per callback.
    const shellNode = app.shell?.node;
    const host = shellNode?.parentElement;
    if (host && typeof ResizeObserver !== 'undefined') {
      this.hostObserver = new ResizeObserver(() => this.resizeHandler?.());
      this.hostObserver.observe(host);
    }
    // Re-sync when the window becomes visible again (restore from minimize,
    // virtual-desktop switch) — hidden documents report zero sizes, so the
    // guard inside ensureShellFillsWindow skips while hidden.
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    // Settle passes after Theia finishes restoring layout. Two short passes
    // preserve the original high-DPI fix intent (500/2000ms); both are
    // tracked and cleared on stop.
    this.settleTimers.push(window.setTimeout(sync, 500));
    this.settleTimers.push(window.setTimeout(sync, 2000));
  }

  onStop(): void {
    if (this.resizeRaf !== undefined) {
      cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = undefined;
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = undefined;
    }
    for (const timer of this.settleTimers) {
      window.clearTimeout(timer);
    }
    this.settleTimers = [];
    this.hostObserver?.disconnect();
    this.hostObserver = undefined;
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = undefined;
    }
  }

  protected ensureShellFillsWindow(app: FrontendApplication): void {
    const shellNode = app.shell?.node;
    if (!shellNode) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    const parent = shellNode.parentElement;
    const targetH = parent?.clientHeight || window.innerHeight;
    const targetW = parent?.clientWidth || window.innerWidth;
    if (!Number.isFinite(targetH) || !Number.isFinite(targetW) || targetH <= 0 || targetW <= 0) {
      return;
    }
    // Lumino uses absolute geometry; force the shell to match the viewport
    // when DPI/zoom leaves a gap below the status bar.
    if (
      Math.abs(shellNode.clientHeight - targetH) > 2
      || Math.abs(shellNode.clientWidth - targetW) > 2
    ) {
      shellNode.style.position = 'absolute';
      shellNode.style.top = '0';
      shellNode.style.left = '0';
      shellNode.style.right = '0';
      shellNode.style.bottom = '0';
      shellNode.style.height = `${targetH}px`;
      shellNode.style.width = `${targetW}px`;
      try {
        app.shell.update();
      } catch {
        // ignore
      }
    }
  }
}
