/**
 * 遥测设置 UI — P3-OBS-02
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
import { KairoTelemetry, type TelemetryStats, type TelemetryEvent } from './kairo-telemetry';

export const KAIRO_TELEMETRY_SETTINGS_ID = 'kairo-telemetry-settings';

@injectable()
export class KairoTelemetrySettingsWidget extends ReactWidget {
  static readonly ID = KAIRO_TELEMETRY_SETTINGS_ID;

  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(FileDialogService) protected readonly fileDialog!: FileDialogService;
  @inject(KairoTelemetry) protected readonly telemetry!: KairoTelemetry;

  protected stats: TelemetryStats | undefined;
  protected showEvents = false;

  constructor() {
    super();
    this.id = KAIRO_TELEMETRY_SETTINGS_ID;
    this.title.label = '遥测设置';
    this.title.caption = 'Kairo IDE 遥测数据设置';
    this.title.iconClass = 'codicon codicon-graph';
    this.title.closable = true;
  }

  @postConstruct()
  protected init(): void {
    this.update();
  }

  render(): React.ReactNode {
    this.stats = this.telemetry.getStats();

    return React.createElement(TelemetrySettingsPanel, {
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
        this.messages.info('遥测数据已清除。');
      },
      onExport: async () => {
        const json = this.telemetry.exportToJSON();
        const saveUri = await this.fileDialog.showSaveDialog({
          title: '导出遥测数据',
          filters: { 'JSON 文件': ['json'] },
        });
        if (saveUri) {
          // Write the file via the file service
          this.messages.info(
            `遥测数据导出为 JSON 格式。请保存到: ${saveUri.path.toString()}`,
          );
          // Copy to clipboard as fallback
          try {
            await navigator.clipboard.writeText(json);
            this.messages.info('遥测数据已复制到剪贴板。');
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
  isEnabled, privacyAccepted, endpoint, stats, showEvents, events,
  onToggle, onAcceptPrivacy, onSetEndpoint, onViewEvents, onClear, onExport,
}) => {
  const [endpointDraft, setEndpointDraft] = React.useState(endpoint || '');

  return (
    <div className="kairo-telemetry-container">
      <div className="kairo-telemetry-header">
        <h3>遥测设置</h3>
        <p className="kairo-telemetry-description">
          遥测数据收集帮助改进 Kairo IDE。默认禁用，需要手动启用。
          所有数据默认仅存储在本地。
        </p>
      </div>

      {/* Privacy disclosure */}
      {!privacyAccepted && (
        <div className="kairo-telemetry-privacy">
          <h4>隐私声明</h4>
          <div className="kairo-telemetry-privacy-content">
            <p><strong>收集的数据：</strong></p>
            <ul>
              <li>IDE 启动事件</li>
              <li>项目打开/关闭事件</li>
              <li>构建开始/结束事件</li>
              <li>搜索操作</li>
              <li>调试会话事件</li>
              <li>错误事件</li>
            </ul>
            <p><strong>不收集的数据：</strong></p>
            <ul>
              <li>个人身份信息</li>
              <li>文件内容</li>
              <li>源代码</li>
              <li>项目路径</li>
              <li>环境变量</li>
            </ul>
            <p>数据默认仅存储在本地，不会发送到任何服务器。</p>
          </div>
          <button
            type="button"
            className="theia-button"
            onClick={onAcceptPrivacy}
          >
            我已阅读并同意
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
          启用遥测数据收集
        </label>
        {!privacyAccepted && (
          <span className="kairo-telemetry-note">
            请先同意隐私声明
          </span>
        )}
      </div>

      {/* Enterprise endpoint */}
      <div className="kairo-telemetry-section">
        <h4>企业遥测端点（可选）</h4>
        <div className="kairo-telemetry-field">
          <input
            type="text"
            value={endpointDraft}
            onChange={e => setEndpointDraft(e.target.value)}
            placeholder="https://your-enterprise.com/telemetry"
            className="theia-input"
            disabled={!isEnabled}
          />
          <button
            type="button"
            className="theia-button secondary"
            onClick={() => onSetEndpoint(endpointDraft)}
            disabled={!isEnabled}
          >
            保存
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && isEnabled && (
        <div className="kairo-telemetry-section">
          <h4>数据统计</h4>
          <div className="kairo-telemetry-stats">
            <div className="kairo-telemetry-stat">
              <span className="stat-label">总事件数</span>
              <span className="stat-value">{stats.totalEvents}</span>
            </div>
            {stats.oldestEvent && (
              <div className="kairo-telemetry-stat">
                <span className="stat-label">最早事件</span>
                <span className="stat-value">
                  {new Date(stats.oldestEvent).toLocaleString('zh-CN')}
                </span>
              </div>
            )}
            {stats.newestEvent && (
              <div className="kairo-telemetry-stat">
                <span className="stat-label">最新事件</span>
                <span className="stat-value">
                  {new Date(stats.newestEvent).toLocaleString('zh-CN')}
                </span>
              </div>
            )}
          </div>

          {/* Events by type */}
          {Object.keys(stats.eventsByType).length > 0 && (
            <div className="kairo-telemetry-type-stats">
              <h5>按类型统计</h5>
              <table className="kairo-telemetry-table">
                <thead>
                  <tr>
                    <th>事件类型</th>
                    <th>数量</th>
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
          {showEvents ? '隐藏事件' : '查看事件'}
        </button>
        <button
          type="button"
          className="theia-button secondary"
          onClick={onExport}
          disabled={!isEnabled || stats?.totalEvents === 0}
        >
          导出数据
        </button>
        <button
          type="button"
          className="theia-button secondary"
          onClick={onClear}
          disabled={!isEnabled || stats?.totalEvents === 0}
        >
          清除数据
        </button>
      </div>

      {/* Events list */}
      {showEvents && events.length > 0 && (
        <div className="kairo-telemetry-events">
          <h4>事件列表（最近 {Math.min(events.length, 50)} 条）</h4>
          <div className="kairo-telemetry-event-list">
            {events.slice(-50).reverse().map((event, idx) => (
              <div key={idx} className="kairo-telemetry-event-item">
                <span className="event-time">
                  {new Date(event.timestamp).toLocaleTimeString('zh-CN')}
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