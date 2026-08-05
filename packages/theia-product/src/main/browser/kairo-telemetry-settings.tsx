/**
 * Telemetry settings UI — P3-OBS-02
 *
 * Settings UI for telemetry preferences:
 *   - Toggle: Enable/Disable telemetry
 *   - View collected data
 *   - Clear collected data
 *   - Export data button
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import { KairoTelemetry, type TelemetryStats, type TelemetryEvent } from './kairo-telemetry';

export const KAIRO_TELEMETRY_SETTINGS_ID = 'kairo-telemetry-settings';

@injectable()
export class KairoTelemetrySettingsWidget extends ReactWidget {
  static readonly ID = KAIRO_TELEMETRY_SETTINGS_ID;

  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(FileDialogService) protected readonly fileDialog!: FileDialogService;
  @inject(KairoTelemetry) protected readonly telemetry!: KairoTelemetry;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected stats: TelemetryStats | undefined;
  protected showEvents = false;

  constructor() {
    super();
    this.id = KAIRO_TELEMETRY_SETTINGS_ID;
    // Leave empty until @postConstruct — avoids a Chinese flash before i18n (TP-P3-6).
    this.title.label = '';
    this.title.caption = '';
    this.title.iconClass = 'codicon codicon-graph';
    this.title.closable = true;
  }

  @postConstruct()
  protected init(): void {
    this.title.label = this.i18n.t('widget.telemetry.title');
    this.title.caption = this.i18n.t('widget.telemetry.caption');
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      this.title.label = this.i18n.t('widget.telemetry.title');
      this.title.caption = this.i18n.t('widget.telemetry.caption');
      this.update();
    }));
    this.update();
  }

  render(): React.ReactNode {
    this.stats = this.telemetry.getStats();

    return React.createElement(TelemetrySettingsPanel, {
      i18n: this.i18n,
      isEnabled: this.telemetry.isEnabled,
      privacyAccepted: this.telemetry.telemetryConfig.privacyAccepted,
      endpoint: this.telemetry.telemetryConfig.endpoint,
      stats: this.stats,
      showEvents: this.showEvents,
      events: this.showEvents ? this.telemetry.getEvents() : [],
      onToggle: async (enabled: boolean) => {
        await this.telemetry.setEnabled(enabled);
        this.update();
      },
      onAcceptPrivacy: async () => {
        await this.telemetry.acceptPrivacy();
        this.update();
      },
      onSetEndpoint: async (endpoint: string) => {
        await this.telemetry.setEndpoint(endpoint || undefined);
        this.update();
      },
      onViewEvents: () => {
        this.showEvents = !this.showEvents;
        this.update();
      },
      onClear: async () => {
        await this.telemetry.clearEvents();
        this.showEvents = false;
        this.update();
        this.messages.info(this.i18n.t('widget.telemetry.cleared'));
      },
      onExport: async () => {
        const json = this.telemetry.exportToJSON();
        const saveUri = await this.fileDialog.showSaveDialog({
          title: this.i18n.t('widget.telemetry.exportTitle'),
          filters: { [this.i18n.t('widget.telemetry.jsonFilter')]: ['json'] },
        });
        if (saveUri) {
          // Write the file via the file service
          this.messages.info(
            this.i18n.t('widget.telemetry.exportSaved', { path: saveUri.path.toString() }),
          );
          // Copy to clipboard as fallback
          try {
            await navigator.clipboard.writeText(json);
            this.messages.info(this.i18n.t('widget.telemetry.copied'));
          } catch {
            // Clipboard not available
          }
        }
      },
    });
  }
}

// ── React Component ──────────────────────────────────────────────

interface TelemetrySettingsPanelProps {
  i18n: KairoI18nService;
  isEnabled: boolean;
  privacyAccepted: boolean;
  endpoint?: string;
  stats: TelemetryStats | undefined;
  showEvents: boolean;
  events: TelemetryEvent[];
  onToggle: (enabled: boolean) => void;
  onAcceptPrivacy: () => void;
  onSetEndpoint: (endpoint: string) => void;
  onViewEvents: () => void;
  onClear: () => void;
  onExport: () => void;
}

const TelemetrySettingsPanel: React.FC<TelemetrySettingsPanelProps> = ({
  i18n, isEnabled, privacyAccepted, endpoint, stats, showEvents, events,
  onToggle, onAcceptPrivacy, onSetEndpoint, onViewEvents, onClear, onExport,
}) => {
  const [endpointDraft, setEndpointDraft] = React.useState(endpoint || '');
  const t = React.useCallback(
    (key: KairoI18nKey, params?: Record<string, string | number>) => i18n.t(key, params),
    [i18n],
  );
  const locale = i18n.getCurrentLanguage() === 'zh-CN' ? 'zh-CN' : 'en';

  return (
    <div className="kairo-telemetry-container">
      <div className="kairo-telemetry-header">
        <h3>{t('widget.telemetry.heading')}</h3>
        <p className="kairo-telemetry-description">
          {t('widget.telemetry.description')}
        </p>
      </div>

      {/* Privacy disclosure */}
      {!privacyAccepted && (
        <div className="kairo-telemetry-privacy">
          <h4>{t('widget.telemetry.privacyTitle')}</h4>
          <div className="kairo-telemetry-privacy-content">
            <p><strong>{t('widget.telemetry.collectedTitle')}</strong></p>
            <ul>
              <li>{t('widget.telemetry.collectedStartup')}</li>
              <li>{t('widget.telemetry.collectedProject')}</li>
              <li>{t('widget.telemetry.collectedBuild')}</li>
              <li>{t('widget.telemetry.collectedSearch')}</li>
              <li>{t('widget.telemetry.collectedDebug')}</li>
              <li>{t('widget.telemetry.collectedError')}</li>
            </ul>
            <p><strong>{t('widget.telemetry.notCollectedTitle')}</strong></p>
            <ul>
              <li>{t('widget.telemetry.notCollectedPii')}</li>
              <li>{t('widget.telemetry.notCollectedFileContents')}</li>
              <li>{t('widget.telemetry.notCollectedSource')}</li>
              <li>{t('widget.telemetry.notCollectedPaths')}</li>
              <li>{t('widget.telemetry.notCollectedEnv')}</li>
            </ul>
            <p>{t('widget.telemetry.localOnlyNote')}</p>
          </div>
          <button
            type="button"
            className="theia-button"
            onClick={onAcceptPrivacy}
          >
            {t('widget.telemetry.acceptPrivacy')}
          </button>
        </div>
      )}

      {/* Enable/Disable toggle */}
      <div className="kairo-telemetry-section">
        <label className="kairo-telemetry-toggle">
          <input
            type="checkbox"
            checked={isEnabled}
            disabled={!privacyAccepted}
            onChange={e => onToggle(e.target.checked)}
          />
          {t('widget.telemetry.enableToggle')}
        </label>
        {!privacyAccepted && (
          <span className="kairo-telemetry-note">
            {t('widget.telemetry.acceptPrivacyFirst')}
          </span>
        )}
      </div>

      {/* Enterprise endpoint */}
      <div className="kairo-telemetry-section">
        <h4>{t('widget.telemetry.enterpriseEndpoint')}</h4>
        <div className="kairo-telemetry-field">
          <input
            type="text"
            value={endpointDraft}
            onChange={e => setEndpointDraft(e.target.value)}
            placeholder={t('widget.telemetry.endpointPlaceholder')}
            className="theia-input"
            disabled={!isEnabled}
          />
          <button
            type="button"
            className="theia-button secondary"
            onClick={() => onSetEndpoint(endpointDraft)}
            disabled={!isEnabled}
          >
            {t('widget.telemetry.save')}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && isEnabled && (
        <div className="kairo-telemetry-section">
          <h4>{t('widget.telemetry.statsTitle')}</h4>
          <div className="kairo-telemetry-stats">
            <div className="kairo-telemetry-stat">
              <span className="stat-label">{t('widget.telemetry.totalEvents')}</span>
              <span className="stat-value">{stats.totalEvents}</span>
            </div>
            {stats.oldestEvent && (
              <div className="kairo-telemetry-stat">
                <span className="stat-label">{t('widget.telemetry.oldestEvent')}</span>
                <span className="stat-value">
                  {new Date(stats.oldestEvent).toLocaleString(locale)}
                </span>
              </div>
            )}
            {stats.newestEvent && (
              <div className="kairo-telemetry-stat">
                <span className="stat-label">{t('widget.telemetry.newestEvent')}</span>
                <span className="stat-value">
                  {new Date(stats.newestEvent).toLocaleString(locale)}
                </span>
              </div>
            )}
          </div>

          {/* Events by type */}
          {Object.keys(stats.eventsByType).length > 0 && (
            <div className="kairo-telemetry-type-stats">
              <h5>{t('widget.telemetry.byType')}</h5>
              <table className="kairo-telemetry-table">
                <thead>
                  <tr>
                    <th>{t('widget.telemetry.eventType')}</th>
                    <th>{t('widget.telemetry.count')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.eventsByType).map(([type, count]) => (
                    <tr key={type}>
                      <td>{type}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="kairo-telemetry-actions">
        <button
          type="button"
          className="theia-button secondary"
          onClick={onViewEvents}
          disabled={!isEnabled || stats?.totalEvents === 0}
        >
          {showEvents ? t('widget.telemetry.hideEvents') : t('widget.telemetry.viewEvents')}
        </button>
        <button
          type="button"
          className="theia-button secondary"
          onClick={onExport}
          disabled={!isEnabled || stats?.totalEvents === 0}
        >
          {t('widget.telemetry.exportData')}
        </button>
        <button
          type="button"
          className="theia-button secondary"
          onClick={onClear}
          disabled={!isEnabled || stats?.totalEvents === 0}
        >
          {t('widget.telemetry.clearData')}
        </button>
      </div>

      {/* Events list */}
      {showEvents && events.length > 0 && (
        <div className="kairo-telemetry-events">
          <h4>{t('widget.telemetry.eventsList', { count: Math.min(events.length, 50) })}</h4>
          <div className="kairo-telemetry-event-list">
            {events.slice(-50).reverse().map((event, idx) => (
              <div key={idx} className="kairo-telemetry-event-item">
                <span className="event-time">
                  {new Date(event.timestamp).toLocaleTimeString(locale)}
                </span>
                <span className="event-type">{event.eventType}</span>
                {event.data && (
                  <span className="event-data">
                    {JSON.stringify(event.data)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
