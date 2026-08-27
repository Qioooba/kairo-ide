/**
 * Keep the Theia application shell filling the window so the status bar
 * stays at the true bottom — especially on high-DPI / 2K displays where
 * mismatched shell geometry leaves empty space under the status bar
 * (looking like it sits mid-window) and can interfere with split sashes.
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
    // Second pass after Theia finishes restoring layout.
    window.setTimeout(sync, 500);
    window.setTimeout(sync, 2000);
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
  }

  protected ensureShellFillsWindow(app: FrontendApplication): void {
    const shellNode = app.shell?.node;
    if (!shellNode) {
      return;
    }
    const parent = shellNode.parentElement;
    const targetH = parent?.clientHeight || window.innerHeight;
    const targetW = parent?.clientWidth || window.innerWidth;
    if (targetH <= 0 || targetW <= 0) {
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
