/**
 * HotSwap history widget — P3-ADVDBG-01
 *
 * A small widget showing the last 5 HotSwap attempts with
 * status icons:
 *   - ✓ green checkmark: success
 *   - ✗ red X: failed
 *   - ⏳ yellow clock: in progress
 *
 * Click on an entry to show details.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ClassHotSwapProbe, type HotSwapEntry } from './java-hotswap-probe';

export const KAIRO_HOTSWAP_WIDGET_ID = 'kairo-hotswap-widget';

@injectable()
export class HotSwapWidget extends ReactWidget {
  static readonly ID = KAIRO_HOTSWAP_WIDGET_ID;

  @inject(ClassHotSwapProbe) protected readonly hotSwapProbe!: ClassHotSwapProbe;

  protected entries: HotSwapEntry[] = [];
  protected selectedEntry: HotSwapEntry | undefined;

  constructor() {
    super();
    this.id = KAIRO_HOTSWAP_WIDGET_ID;
    this.title.label = 'HotSwap';
    this.title.caption = 'Kairo HotSwap 历史';
    this.title.iconClass = 'codicon codicon-debug-restart';
    this.title.closable = true;
    this.addClass('kairo-hotswap-widget');
  }

  @postConstruct()
  protected init(): void {
    this.entries = [...this.hotSwapProbe.swapHistory];
    this.hotSwapProbe.onDidSwap(_entry => {
      this.entries = [...this.hotSwapProbe.swapHistory];
      this.update();
    });
  }

  render(): React.ReactNode {
    return React.createElement(HotSwapHistory, {
      entries: this.entries,
      selectedEntry: this.selectedEntry,
      onSelect: (entry: HotSwapEntry) => {
        this.selectedEntry = entry;
        this.update();
      },
    });
  }
}

interface HotSwapHistoryProps {
  entries: HotSwapEntry[];
  selectedEntry: HotSwapEntry | undefined;
  onSelect: (entry: HotSwapEntry) => void;
}

const statusIcon = (status: HotSwapEntry['status']): string => {
  switch (status) {
    case 'success': return '✓';
    case 'failed': return '✗';
    case 'in-progress': return '⏳';
  }
};

const statusColor = (status: HotSwapEntry['status']): string => {
  switch (status) {
    case 'success': return '#4caf50';
    case 'failed': return '#f44336';
    case 'in-progress': return '#ff9800';
  }
};

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatDuration = (ms?: number): string => {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const statusLabel = (status: HotSwapEntry['status']): string => {
  switch (status) {
    case 'success': return '成功';
    case 'failed': return '失败';
    case 'in-progress': return '处理中';
  }
};

const HotSwapHistory: React.FC<HotSwapHistoryProps> = ({
  entries, selectedEntry, onSelect,
}) => {
  if (entries.length === 0) {
    return (
      <div className="kairo-hotswap-empty">
        <p>暂无 HotSwap 记录。</p>
        <p className="kairo-hotswap-hint">在调试期间保存 Java 文件以触发 HotSwap。</p>
      </div>
    );
  }

  return (
    <div className="kairo-hotswap-content">
      <div className="kairo-hotswap-list" role="list" aria-label="HotSwap 历史">
        {entries.map(entry => (
          <div
            key={entry.id}
            className={`kairo-hotswap-entry ${selectedEntry?.id === entry.id ? 'selected' : ''}`}
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
              className="kairo-hotswap-status"
              style={{ color: statusColor(entry.status) }}
              title={statusLabel(entry.status)}
            >
              {statusIcon(entry.status)}
            </span>
            <span className="kairo-hotswap-file">{entry.fileName}</span>
            <span className="kairo-hotswap-time">{formatTime(entry.timestamp)}</span>
            {entry.durationMs !== undefined && (
              <span className="kairo-hotswap-duration">{formatDuration(entry.durationMs)}</span>
            )}
          </div>
        ))}
      </div>
      {selectedEntry && (
        <div className="kairo-hotswap-detail">
          <h4>HotSwap 详情</h4>
          <dl>
            <dt>文件</dt>
            <dd>{selectedEntry.fileName}</dd>
            <dt>状态</dt>
            <dd style={{ color: statusColor(selectedEntry.status) }}>
              {statusIcon(selectedEntry.status)} {statusLabel(selectedEntry.status)}
            </dd>
            <dt>时间</dt>
            <dd>{new Date(selectedEntry.timestamp).toLocaleString('zh-CN')}</dd>
            {selectedEntry.durationMs !== undefined && (
              <>
                <dt>耗时</dt>
                <dd>{formatDuration(selectedEntry.durationMs)}</dd>
              </>
            )}
            {selectedEntry.message && (
              <>
                <dt>消息</dt>
                <dd>{selectedEntry.message}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
};