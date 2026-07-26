/**
 * 性能仪表盘 Widget — P3-OBS-07
 *
 * KairoPerfDashboardWidget: React 组件展示冷启动指标、内存使用、
 * 搜索平均时间、补全平均时间、JDT LS 状态，以及"运行性能测试"按钮。
 */

import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { JavaLanguageClient } from '@kairo/java-extension';
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
}

const PerfDashboard: React.FC<PerfDashboardProps> = ({
  coldStartTimer,
  searchTimer,
  memoryTracker,
  languageClient,
  logger,
  messages,
}) => {
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
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | undefined>();

  React.useEffect(() => {
    // Load history, handling localStorage errors
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
        // Check if memory API is available (non-Chrome browsers may not have it)
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
      // 简单基准测试：测量 1000 次简单对象创建的耗时
      let count = 0;
      for (let i = 0; i < 100000; i++) {
        const obj = { a: i, b: String(i), c: [i] };
        count += obj.a;
      }
      void count;
      const elapsed = performance.now() - start;
      const result = `基准测试完成: ${elapsed.toFixed(1)}ms (100000 次迭代)`;
      setBenchmarkResult(result);
      console.log(`[Perf] ${result}`);
      logger.info(`[Perf] ${result}`);
      messages.info(result);
    } catch (err) {
      const msg = `基准测试失败: ${String(err)}`;
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
      messages.info('性能历史已清除');
      logger.info('[Perf] History cleared by user');
    } catch (err) {
      const msg = `清除历史失败: ${String(err)}`;
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

  const lsStateLabel = (state: JdtLsState): string => {
    switch (state) {
      case 'uninitialized': return '未初始化';
      case 'starting': return '启动中...';
      case 'initializing': return '初始化中...';
      case 'ready': return '已连接';
      case 'stopping': return '停止中...';
      case 'stopped': return '已停止';
      case 'crashed': return '已崩溃';
      case 'failed': return '失败';
      default: return state;
    }
  };

  const lsStateColor = (state: JdtLsState): string => {
    switch (state) {
      case 'ready': return '#4caf50';
      case 'starting':
      case 'initializing': return '#ff9800';
      case 'crashed':
      case 'failed': return '#f44336';
      default: return '#9e9e9e';
    }
  };

  const last5 = history.slice(-5).reverse();

  return (
    <div className="kairo-perf-dashboard" style={{ padding: '16px', overflowY: 'auto', height: '100%' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600 }}>
        性能仪表盘
      </h2>

      {/* Loading skeleton */}
      {initialLoading && (
        <div role="status" aria-label="Loading performance data" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '24px', height: '24px',
            border: '3px solid var(--theia-dropdown-border)',
            borderTopColor: 'var(--theia-focusBorder)',
            borderRadius: '50%',
            animation: 'kairo-spin 0.8s linear infinite',
          }} />
          <p style={{ color: 'var(--theia-descriptionForeground)', fontSize: '13px', margin: 0 }}>
            Loading performance metrics...
          </p>
          <div style={{ width: '80%', maxWidth: '400px' }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{
                height: '12px',
                backgroundColor: 'var(--theia-dropdown-border)',
                borderRadius: '3px',
                marginBottom: '8px',
                opacity: 0.5 - i * 0.12,
                width: `${85 - i * 12}%`,
              }} />
            ))}
          </div>
          <style>{`@keyframes kairo-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {!initialLoading && (
      <>

      {/* 冷启动历史 */}
      <section style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--theia-foreground)' }}>
            冷启动历史（最近 5 次）
          </h3>
          {last5.length > 0 && (
            <button
              type="button"
              className="theia-button secondary"
              onClick={clearHistory}
              style={{ fontSize: '11px', padding: '2px 8px' }}
              data-testid="perf-clear-history"
            >
              清除历史
            </button>
          )}
        </div>
        {last5.length === 0 ? (
          <p style={{ color: 'var(--theia-descriptionForeground)', fontSize: '12px' }}>
            暂无数据
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={thStyle}>总耗时</th>
                <th style={thStyle}>布局就绪</th>
                <th style={thStyle}>首次补全</th>
              </tr>
            </thead>
            <tbody>
              {last5.map((m, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{formatMs(m.totalColdStartMs)}</td>
                  <td style={tdStyle}>
                    {m.layoutReadyTime > 0
                      ? formatMs(m.layoutReadyTime - m.appStartTime)
                      : '—'}
                  </td>
                  <td style={tdStyle}>
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

      {/* 当前性能指标 */}
      <section style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--theia-foreground)' }}>
          当前指标
        </h3>
        {!memoryAvailable && (
          <p style={{ fontSize: '11px', color: '#ff9800', marginBottom: '8px' }}>
            ⚠ 内存信息不可用（当前浏览器不支持 performance.memory API）
          </p>
        )}
        {lsError && (
          <p style={{ fontSize: '11px', color: '#f44336', marginBottom: '8px' }}>
            ⚠ JDT 语言服务器未连接，代码补全和搜索功能可能不可用
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
          <MetricCard label="JS 堆内存" value={memoryAvailable ? formatMB(heapMB) : '不可用'} />
          <MetricCard label="总内存" value={memoryAvailable ? formatMB(totalMB) : '不可用'} />
          <MetricCard label="峰值内存" value={memoryAvailable ? formatMB(peakMB) : '不可用'} />
          <MetricCard label="平均搜索时间" value={searchCount > 0 ? formatMs(avgSearchMs) : '—'} />
          <MetricCard
            label="JDT LS 状态"
            value={lsStateLabel(lsState)}
            valueColor={lsStateColor(lsState)}
          />
          <MetricCard label="搜索次数" value={String(searchCount)} />
        </div>
      </section>

      {/* 运行基准测试 */}
      <section style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--theia-foreground)' }}>
          基准测试
        </h3>
        <button
          type="button"
          className="theia-button"
          onClick={runBenchmark}
          disabled={benchmarkRunning}
          data-testid="perf-run-benchmark"
        >
          {benchmarkRunning ? '运行中...' : '运行性能测试'}
        </button>
        {benchmarkResult && (
          <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--theia-foreground)' }}>
            {benchmarkResult}
          </p>
        )}
      </section>
      </>
      )}
    </div>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: string;
  valueColor?: string;
}> = ({ label, value, valueColor }) => (
  <div
    style={{
      padding: '8px',
      background: 'var(--theia-editor-background)',
      borderRadius: '4px',
      border: '1px solid var(--theia-dropdown-border)',
    }}
  >
    <div style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px', marginBottom: '4px' }}>
      {label}
    </div>
    <div
      style={{
        fontSize: '14px',
        fontWeight: 600,
        color: valueColor ?? 'var(--theia-foreground)',
      }}
    >
      {value}
    </div>
  </div>
);

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: '1px solid var(--theia-dropdown-border)',
  color: 'var(--theia-descriptionForeground)',
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid var(--theia-dropdown-border)',
};

@injectable()
export class KairoPerfDashboardWidget extends ReactWidget {
  static readonly ID = KAIRO_PERF_FACTORY_ID;

  @inject(KairoColdStartTimer) protected readonly coldStartTimer!: KairoColdStartTimer;
  @inject(KairoSearchTimer) protected readonly searchTimer!: KairoSearchTimer;
  @inject(KairoMemoryTracker) protected readonly memoryTracker!: KairoMemoryTracker;
  @inject(JavaLanguageClient) protected readonly languageClient!: JavaLanguageClient;
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;

  constructor() {
    super();
    this.id = KAIRO_PERF_FACTORY_ID;
    this.title.label = 'Performance';
    this.title.caption = 'Kairo Performance Dashboard';
    this.title.iconClass = 'codicon codicon-dashboard';
    this.title.closable = true;
  }

  render(): React.ReactNode {
    return React.createElement(PerfDashboard, {
      coldStartTimer: this.coldStartTimer,
      searchTimer: this.searchTimer,
      memoryTracker: this.memoryTracker,
      languageClient: this.languageClient,
      logger: this.logger,
      messages: this.messages,
    });
  }
}