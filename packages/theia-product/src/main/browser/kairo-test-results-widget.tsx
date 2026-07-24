import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KAIRO_TESTS_FACTORY_ID } from './kairo-factory-ids';
import { JavaJUnitRunner, type JUnitTestResult, type JUnitTestRun } from '@kairo/java-extension';

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

function statusIcon(status: JUnitTestResult['status']): string {
  switch (status) {
    case 'passed': return '\u2713';   // ✓
    case 'failed': return '\u2717';   // ✗
    case 'skipped': return '\u2014';  // —
    case 'error': return '\u26A0';    // ⚠
    default: return '?';
  }
}

function statusClass(status: JUnitTestResult['status']): string {
  return `kairo-test-status-${status}`;
}

/** Count number of failed tests (including errors) in a run. */
function countFailedAndErrors(run: JUnitTestRun): number {
  return run.failedCount + run.errorCount;
}

/** Single test method result row. */
const TestMethodRow: React.FC<{ result: JUnitTestResult }> = ({ result }) => {
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
          {statusIcon(result.status)}
        </span>
        <span className="kairo-test-method-name">{result.methodName}</span>
        <span className="kairo-test-method-duration">{formatDuration(result.durationMs)}</span>
      </div>
      {expanded && (
        <div className="kairo-test-method-detail">
          {result.failureMessage && (
            <div className="kairo-test-failure" role="alert">
              <div className="kairo-test-failure-label">Failure:</div>
              <pre className="kairo-test-failure-message">{result.failureMessage}</pre>
            </div>
          )}
          {result.stackTrace && result.stackTrace.length > 0 && (
            <div className="kairo-test-stacktrace">
              <div className="kairo-test-stacktrace-label">Stack Trace:</div>
              <pre className="kairo-test-stacktrace-lines">{result.stackTrace.join('\n')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Test class group header with collapsible method list. */
const TestClassGroup: React.FC<{ group: TestClassGroup }> = ({ group }) => {
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
        <span className="kairo-test-expand-icon">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="kairo-test-class-name">{group.className}</span>
        <span className="kairo-test-class-counts">
          {passedCount > 0 && <span className="kairo-test-status kairo-test-status-passed">{passedCount} passed</span>}
          {failedCount > 0 && <span className="kairo-test-status kairo-test-status-failed">{failedCount} failed</span>}
          {errorCount > 0 && <span className="kairo-test-status kairo-test-status-error">{errorCount} errors</span>}
          {skippedCount > 0 && <span className="kairo-test-status kairo-test-status-skipped">{skippedCount} skipped</span>}
        </span>
      </div>
      {expanded && (
        <div className="kairo-test-class-methods">
          {group.results.map((result, i) => (
            <TestMethodRow key={`${result.testId}-${i}`} result={result} />
          ))}
        </div>
      )}
    </div>
  );
};

interface TestResultsViewProps {
  runner: JavaJUnitRunner;
}

const TestResultsView: React.FC<TestResultsViewProps> = ({ runner }) => {
  const [latestRun, setLatestRun] = React.useState<JUnitTestRun | null>(null);
  const [pastRuns, setPastRuns] = React.useState<JUnitTestRun[]>([]);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<TestStatusFilter>('all');
  const [rerunningFailed, setRerunningFailed] = React.useState(false);

  React.useEffect(() => {
    const sub = runner.onDidCompleteRun((run: JUnitTestRun) => {
      setPastRuns(prev => [run, ...prev].slice(0, 20));
      setLatestRun(run);
      setSelectedRunId(run.id);
      setRerunningFailed(false);
    });
    return () => sub.dispose();
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
    // Collect unique class names and run them
    const uniqueClasses = [...new Set(failedResults.map(r => r.className))];
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
    setRerunningFailed(false);
  };

  if (!selectedRun) {
    return (
      <div className="kairo-widget">
        <div className="kairo-widget-header">
          <span className="kairo-widget-title">Test Results</span>
        </div>
        <p className="kairo-empty">No test results yet. Run JUnit tests to see results here.</p>
      </div>
    );
  }

  const filteredResults = getFilteredResults();
  const groups = groupByClass(filteredResults);

  return (
    <div className="kairo-widget">
      <div className="kairo-widget-header">
        <span className="kairo-widget-title">Test Results</span>
        <span className="kairo-test-run-state">
          {selectedRun.state === 'running' ? '\u25D0' : selectedRun.state === 'succeeded' ? '\u2713' : selectedRun.state === 'failed' ? '\u2717' : ''}{' '}
          {selectedRun.state.toUpperCase()}
        </span>
      </div>

      {pastRuns.length > 1 && (
        <div className="kairo-widget-toolbar">
          <select
            className="theia-select"
            value={selectedRunId ?? ''}
            onChange={e => setSelectedRunId(e.target.value)}
            aria-label="Select test run"
          >
            {pastRuns.map(r => (
              <option key={r.id} value={r.id}>
                {r.startTime} — {r.passedCount}P / {r.failedCount}F / {r.skippedCount}S / {r.errorCount}E
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Summary */}
      <div className="kairo-test-run-summary">
        <div className="kairo-test-run-counts">
          <span className="kairo-test-count kairo-test-count-passed" title="Passed">
            {selectedRun.passedCount} passed
          </span>
          {selectedRun.failedCount > 0 && (
            <span className="kairo-test-count kairo-test-count-failed" title="Failed">
              {selectedRun.failedCount} failed
            </span>
          )}
          {selectedRun.skippedCount > 0 && (
            <span className="kairo-test-count kairo-test-count-skipped" title="Skipped">
              {selectedRun.skippedCount} skipped
            </span>
          )}
          {selectedRun.errorCount > 0 && (
            <span className="kairo-test-count kairo-test-count-error" title="Errors">
              {selectedRun.errorCount} errors
            </span>
          )}
        </div>
        <div className="kairo-test-run-time">
          Total: {selectedRun.totalCount} tests
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="kairo-widget-toolbar" style={{ gap: '8px', flexWrap: 'wrap' }}>
        <label className="kairo-sql-field" style={{ flexDirection: 'row', alignItems: 'center', gap: '4px' }}>
          <span className="kairo-sql-field-label">Filter:</span>
          <select
            className="theia-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as TestStatusFilter)}
            aria-label="Filter test results by status"
          >
            <option value="all">All ({selectedRun.totalCount})</option>
            <option value="passed">Passed ({selectedRun.passedCount})</option>
            <option value="failed">Failed ({selectedRun.failedCount})</option>
            <option value="skipped">Skipped ({selectedRun.skippedCount})</option>
            <option value="error">Errors ({selectedRun.errorCount})</option>
          </select>
        </label>
        {countFailedAndErrors(selectedRun) > 0 && (
          <button
            className="theia-button secondary"
            onClick={handleRerunFailed}
            disabled={rerunningFailed}
            title="Rerun all failed and error tests"
          >
            {rerunningFailed ? '\u25D0 Rerunning...' : `\u21BA Rerun Failed (${countFailedAndErrors(selectedRun)})`}
          </button>
        )}
      </div>

      {/* Test tree */}
      <div className="kairo-test-tree">
        {groups.length > 0 ? (
          groups.map(group => (
            <TestClassGroup key={group.className} group={group} />
          ))
        ) : (
          <p className="kairo-empty">No test results match the current filter.</p>
        )}
      </div>

      {/* Raw output */}
      {selectedRun.output && (
        <details className="kairo-test-raw-output">
          <summary className="kairo-test-raw-output-summary">Raw Output</summary>
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

  @postConstruct()
  protected init(): void {
    this.id = KairoTestResultsWidget.ID;
    this.title.label = 'Test Results';
    this.title.caption = 'Kairo JUnit Test Results';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.update();
  }

  protected render(): React.ReactNode {
    return <TestResultsView runner={this.runner} />;
  }
}