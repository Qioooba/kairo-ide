/**
 * HotSwap history widget — P3-ADVDBG-01
 *
 * A small widget showing the last 5 HotSwap attempts with
 * status icons:
 *   - codicon-check: success
 *   - codicon-error: failed
 *   - codicon-sync codicon-modifier-spin: in progress
 *
 * Click on an entry to show details.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
import { ClassHotSwapProbe, type HotSwapEntry } from './java-hotswap-probe';

export const KAIRO_HOTSWAP_WIDGET_ID = 'kairo-hotswap-widget';

@injectable()
export class HotSwapWidget extends ReactWidget {
  static readonly ID = KAIRO_HOTSWAP_WIDGET_ID;

  @inject(ClassHotSwapProbe) protected readonly hotSwapProbe!: ClassHotSwapProbe;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected entries: HotSwapEntry[] = [];
  protected selectedEntry: HotSwapEntry | undefined;

  constructor() {
    super();
    this.id = KAIRO_HOTSWAP_WIDGET_ID;
    this.title.iconClass = 'codicon codicon-debug-restart';
    this.title.closable = true;
    this.addClass('kairo-widget kairo-java-hotswap-widget');
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    this.entries = [...this.hotSwapProbe.swapHistory];
    this.hotSwapProbe.onDidSwap(_entry => {
      this.entries = [...this.hotSwapProbe.swapHistory];
      this.update();
    });
  }

  protected updateTitle(): void {
    this.title.label = this.t('widget.java.hotswap.title');
    this.title.caption = this.t('widget.java.hotswap.caption');
  }

  protected t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key as any, params);
  }

  render(): React.ReactNode {
    return React.createElement(HotSwapHistory, {
      entries: this.entries,
      selectedEntry: this.selectedEntry,
      onSelect: (entry: HotSwapEntry) => {
        this.selectedEntry = entry;
        this.update();
      },
      i18n: this.i18n,
    });
  }
}

interface HotSwapHistoryProps {
  entries: HotSwapEntry[];
  selectedEntry: HotSwapEntry | undefined;
  onSelect: (entry: HotSwapEntry) => void;
  i18n: KairoI18nService;
}

const HotSwapHistory: React.FC<HotSwapHistoryProps> = ({
  entries, selectedEntry, onSelect, i18n,
}) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const locale = i18n.getCurrentLanguage();

  const statusIconClass = (status: HotSwapEntry['status']): string => {
    switch (status) {
      case 'success': return 'codicon codicon-check kairo-java-hotswap-status-success';
      case 'failed': return 'codicon codicon-error kairo-java-hotswap-status-failed';
      case 'in-progress': return 'codicon codicon-sync codicon-modifier-spin kairo-java-hotswap-status-pending';
    }
  };

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDuration = (ms?: number): string => {
    if (ms === undefined) return '';
    if (ms < 1000) return t('widget.java.hotswap.durationMs', { ms });
    return t('widget.java.hotswap.durationSec', { sec: (ms / 1000).toFixed(1) });
  };

  const statusLabel = (status: HotSwapEntry['status']): string => {
    switch (status) {
      case 'success': return t('widget.java.hotswap.status.success');
      case 'failed': return t('widget.java.hotswap.status.failed');
      case 'in-progress': return t('widget.java.hotswap.status.inProgress');
    }
  };

  if (entries.length === 0) {
    return (
      <div className="kairo-widget-body kairo-empty-state kairo-java-hotswap-empty">
        <div className="kairo-empty-state-glyph">
          <span className="codicon codicon-debug-restart" aria-hidden="true" />
        </div>
        <p className="kairo-empty-state-title">{t('widget.java.hotswap.empty.title')}</p>
        <p className="kairo-empty-state-reason kairo-java-hotswap-hint">{t('widget.java.hotswap.empty.hint')}</p>
      </div>
    );
  }

  return (
    <div className="kairo-widget-body kairo-java-hotswap-content">
      <div className="kairo-java-hotswap-list" role="list" aria-label={t('widget.java.hotswap.historyAriaLabel')}>
        {entries.map(entry => (
          <div
            key={entry.id}
            className={`kairo-java-hotswap-entry ${selectedEntry?.id === entry.id ? 'selected' : ''}`}
            role="listitem"
            onClick={() => onSelect(entry)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                onSelect(entry);
              }
            }}
            tabIndex={0}
          >
            <span
              className={`kairo-java-hotswap-status ${statusIconClass(entry.status)}`}
              title={statusLabel(entry.status)}
              aria-hidden="true"
            />
            <span className="kairo-java-hotswap-file">{entry.fileName}</span>
            <span className="kairo-java-hotswap-time">{formatTime(entry.timestamp)}</span>
            {entry.durationMs !== undefined && (
              <span className="kairo-java-hotswap-duration">{formatDuration(entry.durationMs)}</span>
            )}
          </div>
        ))}
      </div>
      {selectedEntry && (
        <div className="kairo-java-hotswap-detail">
          <h4>{t('widget.java.hotswap.detail.title')}</h4>
          <dl>
            <dt>{t('widget.java.hotswap.detail.file')}</dt>
            <dd>{selectedEntry.fileName}</dd>
            <dt>{t('widget.java.hotswap.detail.status')}</dt>
            <dd>
              <span className={statusIconClass(selectedEntry.status)} aria-hidden="true" />
              {' '}{statusLabel(selectedEntry.status)}
            </dd>
            <dt>{t('widget.java.hotswap.detail.time')}</dt>
            <dd>{new Date(selectedEntry.timestamp).toLocaleString(locale)}</dd>
            {selectedEntry.durationMs !== undefined && (
              <>
                <dt>{t('widget.java.hotswap.detail.duration')}</dt>
                <dd>{formatDuration(selectedEntry.durationMs)}</dd>
              </>
            )}
            {selectedEntry.message && (
              <>
                <dt>{t('widget.java.hotswap.detail.message')}</dt>
                <dd>{selectedEntry.message}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
};
