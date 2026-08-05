import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { SearchEverywhereWidget } from './search-everywhere-widget';
import { openBodyOverlay } from './open-body-overlay';

export class DoubleShiftDetector {
  protected lastShift = 0;
  constructor(protected readonly thresholdMs = 400) {}
  accept(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'>, now = Date.now()): boolean {
    if (event.key !== 'Shift' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) { this.lastShift = 0; return false; }
    const matched = this.lastShift > 0 && now - this.lastShift <= this.thresholdMs;
    this.lastShift = matched ? 0 : now;
    return matched;
  }
}

@injectable()
export class SearchEverywhereContribution extends AbstractViewContribution<SearchEverywhereWidget> {
  protected readonly detector = new DoubleShiftDetector();
  protected readonly keydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    if (this.detector.accept(event)) {
      event.preventDefault();
      void this.openView({ activate: true });
    }
  };
  constructor() {
    super({
      widgetId: SearchEverywhereWidget.ID,
      widgetName: 'Kairo Search Everywhere',
      defaultWidgetOptions: { area: 'main' },
      toggleCommandId: 'kairo.search.everywhere',
    });
  }

  override async openView(_args?: Partial<{ activate: boolean; reveal: boolean }>): Promise<SearchEverywhereWidget> {
    return openBodyOverlay(this.widgetManager, SearchEverywhereWidget.ID) as Promise<SearchEverywhereWidget>;
  }

  onStart(_app: FrontendApplication): void { window.addEventListener('keydown', this.keydown, true); }
  onStop(): void { window.removeEventListener('keydown', this.keydown, true); }
}
