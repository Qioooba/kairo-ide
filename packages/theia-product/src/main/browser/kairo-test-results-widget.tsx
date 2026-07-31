import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KAIRO_TESTS_FACTORY_ID } from './kairo-factory-ids';
import { JavaJUnitRunner, type JUnitTestResult, type JUnitTestRun } from '@kairo/java-extension';
import { KairoI18nService } from '@kairo/i18n';

/** Filter type for test results. */
type TestStatusFilter = 'all' | 'passed' | 'failed' | 'skipped' | 'error';

/** Group test results by class name for tree display. */
interface TestClassGroup {
  className: string;
  results: JUnitTestResult[];
}

function groupByClass(results: JUnitTestResult[]): TestClassGroup[] {
  const map = new Map<string, JUnitTestResult[]>();
  for (const r of results) {
    const existing = map.get(r.className) || [];
    existing.push(r);
    map.set(r.className, existing);
  }
  return Array.from(map.entries()).map(([className, results]) => ({ className, results }));
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusIconClass(status: JUnitTestResult['status']): string {
  switch (status) {
    case 'passed': return 'codicon codicon-pass';
    case 'failed': return 'codicon codicon-error';
    case 'skipped': return 'codicon codicon-circle-slash';
    case 'error': return 'codicon codicon-warning';
    default: return 'codicon codicon-question';
  }
}

function statusClass(status: JUnitTestResult['status']): string {
  return `kairo-test-status-${status}`;
}

function runStateIconClass(state: JUnitTestRun['state']): string {
  switch (state) {
    case 'running': return 'codicon codicon-sync codicon-modifier-spin';
    case 'succeeded': return 'codicon codicon-check';
    case 'failed': return 'codicon codicon-error';
    default: return 'codicon codicon-circle-outline';
  }
}

/** Count number of failed tests (including errors) in a run. */
function countFailedAndErrors(run: JUnitTestRun): number {
  return run.failedCount + run.errorCount;
}

interface TestMethodRowProps {
  result: JUnitTestResult;
  i18n: KairoI18nService;
}

/** Single test method result row. */
const TestMethodRow: React.FC<TestMethodRowProps> = ({ result, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [expanded, setExpanded] = React.useState(result.status === 'failed' || result.status === 'error');

  return (
    <div className="kairo-test-method-result">
      <div
        className="kairo-test-method-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }}
      >
        <span className={`kairo-test-status ${statusClass(result.status)}`}>
          <span className={statusIconClass(result.status)} aria-hidden="true" />
        </span>
        <span className="kairo-test-method-name">{result.methodName}</span>
        <span className="kairo-test-method-duration">{formatDuration(result.durationMs)}</span>
      </div>
      {expanded && (
        <div className="kairo-test-method-detail">
          {result.failureMessage && (
            <div className="kairo-test-failure" role="alert">
              <div className="kairo-test-failure-label">{t('widget.tests.failureLabel')}</div>
              <pre className="kairo-test-failure-message">{result.failureMessage}</pre>
            </div>
          )}
          {result.stackTrace && result.stackTrace.length > 0 && (
            <div className="kairo-test-stacktrace">
              <div className="kairo-test-stacktrace-label">{t('widget.tests.stackTraceLabel')}</div>
              <pre className="kairo-test-stacktrace-lines">{result.stackTrace.join('\n')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface TestClassGroupProps {
  group: TestClassGroup;
  i18n: KairoI18nService;
}

/** Test class group header with collapsible method list. */
const TestClassGroup: React.FC<TestClassGroupProps> = ({ group, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [expanded, setExpanded] = React.useState(true);
  const passedCount = group.results.filter(r => r.status === 'passed').length;
  const failedCount = group.results.filter(r => r.status === 'failed').length;
  const skippedCount = group.results.filter(r => r.status === 'skipped').length;
  const errorCount = group.results.filter(r => r.status === 'error').length;

  return (
    <div className="kairo-test-class-group">
      <div
        className="kairo-test-class-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }}
      >
        <span className="kairo-test-expand-icon"><span className={`codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" /></span>
        <span className="kairo-test-class-name">{group.className}</span>
        <span className="kairo-test-class-counts">
          {passedCount > 0 && <span className="kairo-badge kairo-badge-success">{t('widget.tests.summary.passed', { count: passedCount })}</span>}
          {failedCount > 0 && <span className="kairo-badge kairo-badge-error">{t('widget.tests.summary.failed', { count: failedCount })}</span>}
          {errorCount > 0 && <span className="kairo-badge kairo-badge-error">{t('widget.tests.summary.error', { count: errorCount })}</span>}
          {skippedCount > 0 && <span className="kairo-badge kairo-badge-warning">{t('widget.tests.summary.skipped', { count: skippedCount })}</span>}
        </span>
      </div>
      {expanded && (
        <div className="kairo-test-class-methods">
          {group.results.map((result, i) => (
            <TestMethodRow key={`${result.testId}-${i}`} result={result} i18n={i18n} />
          ))}
        </div>
      )}
    </div>
  );
};

interface TestResultsViewProps {
  runner: JavaJUnitRunner;
  i18n: KairoI18nService;
}

const TestResultsView: React.FC<TestResultsViewProps> = ({ runner, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [latestRun, setLatestRun] = React.useState<JUnitTestRun | null>(null);
  const [pastRuns, setPastRuns] = React.useState<JUnitTestRun[]>([]);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<TestStatusFilter>('all');
  const [rerunningFailed, setRerunningFailed] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);

  React.useEffect(() => {
    const sub = runner.onDidCompleteRun((run: JUnitTestRun) => {
      setPastRuns(prev => [run, ...prev].slice(0, 20));
      setLatestRun(run);
      setSelectedRunId(run.id);
      setRerunningFailed(false);
      setLoading(false);
      setError(null);
    });
    return () => {
      sub.dispose();
    };
  }, [runner]);

  const selectedRun = pastRuns.find(r => r.id === selectedRunId) || latestRun;

  /** Filter results by status, then group by class. */
  const getFilteredResults = (): JUnitTestResult[] => {
    if (!selectedRun) return [];
    if (statusFilter === 'all') return selectedRun.results;
    return selectedRun.results.filter(r => r.status === statusFilter);
  };

  /** Rerun all failed tests from the selected run. */
  const handleRerunFailed = async () => {
    if (!selectedRun) return;
    const failedResults = selectedRun.results.filter(r => r.status === 'failed' || r.status === 'error');
    if (failedResults.length === 0) return;

    setRerunningFailed(true);
    setError(null);
    setLoading(true);
    // Collect unique class names and run them
    const uniqueClasses = [...new Set(failedResults.map(r => r.className))];
    try {
      for (const className of uniqueClasses) {
        const failedMethods = failedResults
          .filter(r => r.className === className)
          .map(r => r.methodName)
          .filter((m): m is string => !!m);
        if (failedMethods.length > 0) {
          // Run each failed method individually
          for (const method of failedMethods) {
            await runner.runTest(className, method);
          }
        } else {
          await runner.runTest(className);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('widget.tests.errorTitle'));
    }
    setRerunningFailed(false);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="kairo-widget" role="status" aria-busy="true">
        <div className="kairo-widget-header">
          <span className="kairo-widget-title">{t('widget.tests.title')}</span>
        </div>
        <div className="kairo-widget-body">
          <div className="kairo-empty-state">
            <span className="kairo-empty-state-glyph codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            <h3 className="kairo-empty-state-title">{rerunningFailed ? t('widget.tests.rerunningFailed') : t('widget.tests.loading')}</h3>
          </div>
        </div>
      </div>
    );
  }

  if (error && !selectedRun) {
    return (
      <div className="kairo-widget" role="alert" aria-live="assertive">
        <div className="kairo-widget-header">
          <span className="kairo-widget-title">{t('widget.tests.title')}</span>
        </div>
        <div className="kairo-widget-body">
          <div className="kairo-error-banner" role="alert">
            <span className="codicon codicon-warning" aria-hidden="true" />
            <div>
              <strong>{t('widget.tests.errorTitle')}</strong>
              <p className="kairo-error-banner-detail">{error}</p>
            </div>
            <button className="theia-button secondary" onClick={() => setError(null)}>{t('widget.tests.dismiss')}</button>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedRun) {
    return (
      <div className="kairo-widget">
        <div className="kairo-widget-header">
          <span className="kairo-widget-title">{t('widget.tests.title')}</span>
        </div>
        <div className="kairo-widget-body">
          <div className="kairo-empty-state">
            <span className="kairo-empty-state-glyph codicon codicon-beaker" aria-hidden="true" />
            <h3 className="kairo-empty-state-title">{t('widget.tests.emptyStateTitle')}</h3>
            <p className="kairo-empty-state-reason">{t('widget.tests.emptyStateReason')}</p>
          </div>
        </div>
      </div>
    );
  }

  const filteredResults = getFilteredResults();
  const groups = groupByClass(filteredResults);

  return (
    <div className="kairo-widget">
      <div className="kairo-widget-header">
        <span className="kairo-widget-title">{t('widget.tests.title')}</span>
        <span className={`kairo-test-run-state ${selectedRun.state}`}>
          <span className={runStateIconClass(selectedRun.state)} aria-hidden="true" />
          {t(`widget.tests.runState.${selectedRun.state}` as any)}
        </span>
      </div>

      {error && (
        <div className="kairo-error-banner" role="alert" aria-live="assertive">
          <span className="codicon codicon-warning" aria-hidden="true" />
          <span>{error}</span>
          <button className="theia-button secondary" onClick={() => setError(null)}>{t('widget.tests.dismiss')}</button>
        </div>
      )}

      {pastRuns.length > 1 && (
        <div className="kairo-widget-toolbar">
          <select
            className="theia-select kairo-toolbar-select"
            value={selectedRunId ?? ''}
            onChange={e => setSelectedRunId(e.target.value)}
            aria-label={t('widget.tests.selectRun')}
          >
            {pastRuns.map(r => (
              <option key={r.id} value={r.id}>
                {r.startTime} — {t('widget.tests.summary.passed', { count: r.passedCount })} / {t('widget.tests.summary.failed', { count: r.failedCount })} / {t('widget.tests.summary.skipped', { count: r.skippedCount })} / {t('widget.tests.summary.error', { count: r.errorCount })}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Summary */}
      <div className="kairo-test-run-summary">
        <div className="kairo-test-run-counts">
          <span className="kairo-badge kairo-badge-success" title={t('widget.tests.runState.passed')}>
            {t('widget.tests.summary.passed', { count: selectedRun.passedCount })}
          </span>
          {selectedRun.failedCount > 0 && (
            <span className="kairo-badge kairo-badge-error" title={t('widget.tests.runState.failed')}>
              {t('widget.tests.summary.failed', { count: selectedRun.failedCount })}
            </span>
          )}
          {selectedRun.skippedCount > 0 && (
            <span className="kairo-badge kairo-badge-warning" title={t('widget.tests.runState.skipped')}>
              {t('widget.tests.summary.skipped', { count: selectedRun.skippedCount })}
            </span>
          )}
          {selectedRun.errorCount > 0 && (
            <span className="kairo-badge kairo-badge-error" title={t('widget.tests.runState.error')}>
              {t('widget.tests.summary.error', { count: selectedRun.errorCount })}
            </span>
          )}
        </div>
        <div className="kairo-test-run-time">
          {t('widget.tests.summary.total', { count: selectedRun.totalCount })}
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="kairo-widget-toolbar">
        <label className="kairo-toolbar-field">
          <span className="kairo-toolbar-field-label">{t('widget.tests.filter.label')}:</span>
          <select
            className="theia-select kairo-toolbar-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as TestStatusFilter)}
            aria-label={t('widget.tests.filter.label')}
          >
            <option value="all">{t('widget.tests.filter.all', { count: selectedRun.totalCount })}</option>
            <option value="passed">{t('widget.tests.filter.passed', { count: selectedRun.passedCount })}</option>
            <option value="failed">{t('widget.tests.filter.failed', { count: selectedRun.failedCount })}</option>
            <option value="skipped">{t('widget.tests.filter.skipped', { count: selectedRun.skippedCount })}</option>
            <option value="error">{t('widget.tests.filter.error', { count: selectedRun.errorCount })}</option>
          </select>
        </label>
        {countFailedAndErrors(selectedRun) > 0 && (
          <button
            className="theia-button secondary"
            onClick={handleRerunFailed}
            disabled={rerunningFailed}
            title={t('widget.tests.rerunFailedAria')}
            aria-label={t('widget.tests.rerunFailedAria')}
          >
            <span className={`codicon ${rerunningFailed ? 'codicon-sync codicon-modifier-spin' : 'codicon-run-below'}`} aria-hidden="true" />
            {rerunningFailed ? t('widget.tests.rerunning') : t('widget.tests.rerunFailed', { count: countFailedAndErrors(selectedRun) })}
          </button>
        )}
      </div>

      {/* Test tree */}
      <div className="kairo-test-tree">
        {groups.length > 0 ? (
          groups.map(group => (
            <TestClassGroup key={group.className} group={group} i18n={i18n} />
          ))
        ) : (
          <div className="kairo-empty-state compact">
            <span className="kairo-empty-state-glyph codicon codicon-search" aria-hidden="true" />
            <h3 className="kairo-empty-state-title">{t('widget.tests.noFilterMatch')}</h3>
          </div>
        )}
      </div>

      {/* Raw output */}
      {selectedRun.output && (
        <details className="kairo-test-raw-output">
          <summary className="kairo-test-raw-output-summary">{t('widget.tests.rawOutput')}</summary>
          <pre className="kairo-test-output-pre">{selectedRun.output}</pre>
        </details>
      )}
    </div>
  );
};

@injectable()
export class KairoTestResultsWidget extends ReactWidget {
  static readonly ID = KAIRO_TESTS_FACTORY_ID;

  @inject(JavaJUnitRunner) protected readonly runner!: JavaJUnitRunner;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  @postConstruct()
  protected init(): void {
    this.id = KAIRO_TESTS_FACTORY_ID;
    this.title.label = this.i18n.t('widget.tests.title');
    this.title.caption = this.i18n.t('widget.tests.caption');
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.update();
  }

  protected render(): React.ReactNode {
    return <TestResultsView runner={this.runner} i18n={this.i18n} />;
  }
}
