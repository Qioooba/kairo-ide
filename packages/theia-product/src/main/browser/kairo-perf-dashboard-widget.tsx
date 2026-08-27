/**
 * Performance dashboard widget — P3-OBS-07
 *
 * KairoPerfDashboardWidget: React component that displays cold-start metrics,
 * memory usage, average search/completion times, JDT LS state, and a
 * "Run performance test" button. All UI text is localized via KairoI18nService.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { JavaLanguageClient } from '@kairo/java-extension';
import { KairoI18nService } from '@kairo/i18n';
import { KairoColdStartTimer, ColdStartMetrics } from './kairo-cold-start-timer';
import { KairoSearchTimer } from './kairo-search-timer';
import { KairoMemoryTracker } from './kairo-memory-tracker';
import type { JdtLsState } from '@kairo/java-extension';

export const KAIRO_PERF_FACTORY_ID = 'kairo-perf-dashboard';

interface PerfDashboardProps {
  coldStartTimer: KairoColdStartTimer;
  searchTimer: KairoSearchTimer;
  memoryTracker: KairoMemoryTracker;
  languageClient: JavaLanguageClient;
  logger: ILogger;
  messages: MessageService;
  i18n: KairoI18nService;
}

const PerfDashboard: React.FC<PerfDashboardProps> = ({
  coldStartTimer,
  searchTimer,
  memoryTracker,
  languageClient,
  logger,
  messages,
  i18n,
}) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  const [history, setHistory] = React.useState<ColdStartMetrics[]>([]);
  const [heapMB, setHeapMB] = React.useState(0);
  const [totalMB, setTotalMB] = React.useState(0);
  const [peakMB, setPeakMB] = React.useState(0);
  const [avgSearchMs, setAvgSearchMs] = React.useState(0);
  const [searchCount, setSearchCount] = React.useState(0);
  const [lsState, setLsState] = React.useState<JdtLsState>('uninitialized');
  const [benchmarkRunning, setBenchmarkRunning] = React.useState(false);
  const [benchmarkResult, setBenchmarkResult] = React.useState<string | undefined>();
  const [memoryAvailable, setMemoryAvailable] = React.useState(true);
  const [lsError, setLsError] = React.useState(false);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);

  React.useEffect(() => {
    try {
      setHistory(coldStartTimer.getHistory());
    } catch (err) {
      logger.warn(`[Perf] Failed to load cold start history: ${String(err)}`);
      setHistory([]);
    }

    const refresh = () => {
      try {
        const heap = memoryTracker.getCurrentHeapMB();
        const total = memoryTracker.getCurrentTotalMB();
        const peak = memoryTracker.getPeakHeapMB();
        setMemoryAvailable(heap > 0 || total > 0);
        setHeapMB(heap);
        setTotalMB(total);
        setPeakMB(peak);
      } catch (err) {
        logger.warn(`[Perf] Failed to read memory metrics: ${String(err)}`);
        setMemoryAvailable(false);
      }

      try {
        setAvgSearchMs(searchTimer.getAverageSearchTime());
        setSearchCount(searchTimer.getTotalSearches());
      } catch (err) {
        logger.warn(`[Perf] Failed to read search metrics: ${String(err)}`);
      }

      try {
        const state = languageClient.state();
        setLsState(state);
        setLsError(state === 'crashed' || state === 'failed');
      } catch (err) {
        logger.warn(`[Perf] Failed to read JDT LS state: ${String(err)}`);
        setLsError(true);
      }

      setInitialLoading(false);
    };

    refresh();
    intervalRef.current = setInterval(refresh, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [coldStartTimer, searchTimer, memoryTracker, languageClient, logger]);

  const runBenchmark = async () => {
    setBenchmarkRunning(true);
    setBenchmarkResult(undefined);
    const start = performance.now();

    try {
      let count = 0;
      for (let i = 0; i < 100000; i++) {
        const obj = { a: i, b: String(i), c: [i] };
        count += obj.a;
      }
      void count;
      const elapsed = performance.now() - start;
      const result = t('widget.perf.benchmarkComplete', { elapsed: elapsed.toFixed(1), iterations: 100000 });
      setBenchmarkResult(result);
      logger.info(`[Perf] ${result}`);
      messages.info(result);
    } catch (err) {
      const msg = t('widget.perf.benchmarkFailed', { message: String(err) });
      setBenchmarkResult(msg);
      messages.error(msg);
      logger.error(`[Perf] Benchmark failed: ${String(err)}`);
    } finally {
      setBenchmarkRunning(false);
    }
  };

  const clearHistory = () => {
    try {
      coldStartTimer.clearHistory();
      setHistory([]);
      const msg = t('widget.perf.historyCleared');
      messages.info(msg);
      logger.info('[Perf] History cleared by user');
    } catch (err) {
      const msg = t('widget.perf.clearHistoryFailed', { message: String(err) });
      messages.error(msg);
      logger.error(`[Perf] Failed to clear history: ${String(err)}`);
    }
  };

  const formatMs = (ms: number): string => {
    if (ms <= 0) return '—';
    return `${ms.toFixed(0)}ms`;
  };

  const formatMB = (mb: number): string => {
    if (mb <= 0) return 'N/A';
    return `${mb.toFixed(1)} MB`;
  };

  const lsStateLabel = (state: JdtLsState): string => t(`widget.perf.lsState.${state}` as any, undefined) ?? state;

  const lsStateColor = (state: JdtLsState): string => {
    switch (state) {
      case 'ready': return 'var(--kairo-success, #10B981)';
      case 'starting':
      case 'initializing': return 'var(--kairo-warning, #F59E0B)';
      case 'crashed':
      case 'failed': return 'var(--kairo-error, #EF4444)';
      default: return 'var(--kairo-text-secondary, #a0a0a0)';
    }
  };

  const last5 = history.slice(-5).reverse();

  return (
    <div className="kairo-widget kairo-perf-dashboard">
      <div className="kairo-widget-header">
        <span className="kairo-widget-title">{t('widget.perf.title')}</span>
      </div>

      <div className="kairo-widget-body">
        {initialLoading && (
          <div className="kairo-empty-state" role="status" aria-label={t('widget.perf.loading')}>
            <span className="kairo-empty-state-glyph codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            <h3 className="kairo-empty-state-title">{t('widget.perf.loading')}</h3>
          </div>
        )}

        {!initialLoading && (
          <>
            <section className="kairo-perf-section">
              <div className="kairo-perf-section-header">
                <h3 className="kairo-perf-section-title">
                  {t('widget.perf.coldStartHistory', { count: 5 })}
                </h3>
                {last5.length > 0 && (
                  <button
                    type="button"
                    className="theia-button secondary"
                    onClick={clearHistory}
                    data-testid="perf-clear-history"
                  >
                    {t('widget.perf.clearHistory')}
                  </button>
                )}
              </div>
              {last5.length === 0 ? (
                <div className="kairo-empty-state compact">
                  <span className="kairo-empty-state-glyph codicon codicon-history" aria-hidden="true" />
                  <h3 className="kairo-empty-state-title">{t('widget.perf.noData')}</h3>
                </div>
              ) : (
                <table className="kairo-table kairo-perf-table">
                  <thead>
                    <tr>
                      <th>{t('widget.perf.totalDuration')}</th>
                      <th>{t('widget.perf.layoutReady')}</th>
                      <th>{t('widget.perf.firstCompletion')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {last5.map((m, i) => (
                      <tr key={i}>
                        <td>{formatMs(m.totalColdStartMs)}</td>
                        <td>
                          {m.layoutReadyTime > 0
                            ? formatMs(m.layoutReadyTime - m.appStartTime)
                            : '—'}
                        </td>
                        <td>
                          {m.firstJavaCompletionTime !== undefined
                            ? formatMs(m.firstJavaCompletionTime)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="kairo-perf-section">
              <h3 className="kairo-perf-section-title">
                {t('widget.perf.currentMetrics')}
              </h3>
              {!memoryAvailable && (
                <div className="kairo-error-banner" role="alert">
                  <span className="codicon codicon-warning" aria-hidden="true" />
                  <span>{t('widget.perf.memoryUnavailable')}</span>
                </div>
              )}
              {lsError && (
                <div className="kairo-error-banner" role="alert">
                  <span className="codicon codicon-warning" aria-hidden="true" />
                  <span>{t('widget.perf.lsNotConnected')}</span>
                </div>
              )}
              <div className="kairo-perf-card-grid">
                <MetricCard label={t('widget.perf.jsHeapMemory')} value={memoryAvailable ? formatMB(heapMB) : t('common.unknown')} />
                <MetricCard label={t('widget.perf.totalMemory')} value={memoryAvailable ? formatMB(totalMB) : t('common.unknown')} />
                <MetricCard label={t('widget.perf.peakMemory')} value={memoryAvailable ? formatMB(peakMB) : t('common.unknown')} />
                <MetricCard label={t('widget.perf.averageSearchTime')} value={searchCount > 0 ? formatMs(avgSearchMs) : '—'} />
                <MetricCard
                  label={t('widget.perf.lsStatus')}
                  value={lsStateLabel(lsState)}
                  valueColor={lsStateColor(lsState)}
                />
                <MetricCard label={t('widget.perf.searchCount')} value={String(searchCount)} />
              </div>
            </section>

            <section className="kairo-perf-section">
              <h3 className="kairo-perf-section-title">
                {t('widget.perf.benchmark')}
              </h3>
              <button
                type="button"
                className="theia-button main"
                onClick={runBenchmark}
                disabled={benchmarkRunning}
                data-testid="perf-run-benchmark"
              >
                <span className={`codicon ${benchmarkRunning ? 'codicon-sync codicon-modifier-spin' : 'codicon-play'}`} aria-hidden="true" />
                {benchmarkRunning ? t('widget.perf.benchmarkRunning') : t('widget.perf.runBenchmark')}
              </button>
              {benchmarkResult && (
                <p className="kairo-perf-hint">{benchmarkResult}</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: string;
  valueColor?: string;
}> = ({ label, value, valueColor }) => (
  <div className="kairo-perf-card">
    <div className="kairo-perf-card-label">{label}</div>
    <div className="kairo-perf-card-value" style={{ color: valueColor ?? 'var(--kairo-text, #e0e0e0)' }}>
      {value}
    </div>
  </div>
);

@injectable()
export class KairoPerfDashboardWidget extends ReactWidget {
  static readonly ID = KAIRO_PERF_FACTORY_ID;

  @inject(KairoColdStartTimer) protected readonly coldStartTimer!: KairoColdStartTimer;
  @inject(KairoSearchTimer) protected readonly searchTimer!: KairoSearchTimer;
  @inject(KairoMemoryTracker) protected readonly memoryTracker!: KairoMemoryTracker;
  @inject(JavaLanguageClient) protected readonly languageClient!: JavaLanguageClient;
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  constructor() {
    super();
    this.id = KAIRO_PERF_FACTORY_ID;
    this.title.label = 'Performance';
    this.title.caption = 'Kairo Performance Dashboard';
    this.title.iconClass = 'codicon codicon-dashboard';
    this.title.closable = true;
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
  }

  protected updateTitle(): void {
    this.title.label = this.i18n.t('widget.perf.title');
    this.title.caption = this.i18n.t('widget.perf.caption');
  }

  render(): React.ReactNode {
    return React.createElement(PerfDashboard, {
      coldStartTimer: this.coldStartTimer,
      searchTimer: this.searchTimer,
      memoryTracker: this.memoryTracker,
      languageClient: this.languageClient,
      logger: this.logger,
      messages: this.messages,
      i18n: this.i18n,
    });
  }
}
