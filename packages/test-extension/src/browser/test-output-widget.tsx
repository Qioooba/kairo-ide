import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { TestStore, TestRun, TestMethodResult } from './test-store';

interface TestOutputProps {
    store: TestStore;
}

/** Single test method result row. */
const TestMethodRow: React.FC<{ result: TestMethodResult; index: number }> = ({ result, index }) => {
    const [expanded, setExpanded] = React.useState(result.status === 'failed' || result.status === 'error');

    return (
        <div className="kairo-test-method-result" data-testid={`test-result-${index}`}>
            <div
                className="kairo-test-method-header"
                onClick={() => setExpanded(!expanded)}
                role="button"
                aria-expanded={expanded}
            >
                <span className={`kairo-test-status ${result.status === 'passed' ? 'kairo-test-passed' : result.status === 'failed' ? 'kairo-test-failed' : result.status === 'skipped' ? 'kairo-test-skipped' : 'kairo-test-error'}`}>
                    {result.status === 'passed' ? '\u2713' : result.status === 'failed' ? '\u2717' : result.status === 'skipped' ? '\u29B8' : '\u26A0'}
                </span>
                <span className="kairo-test-method-name">{result.testId}</span>
                <span className="kairo-test-method-duration">{formatDuration(result.durationMs)}</span>
            </div>
            {expanded && (
                <div className="kairo-test-method-detail">
                    {result.failureMessage && (
                        <div className="kairo-test-assertion-failure" data-testid={`test-assertion-${index}`} role="alert">
                            <div className="kairo-test-failure-label">Assertion Failure:</div>
                            <pre className="kairo-test-failure-message">{result.failureMessage}</pre>
                        </div>
                    )}
                    {result.stackTrace && result.stackTrace.length > 0 && (
                        <div className="kairo-test-stacktrace" data-testid={`test-stack-${index}`}>
                            <div className="kairo-test-stacktrace-label">Stack Trace:</div>
                            <pre className="kairo-test-stacktrace-lines">{result.stackTrace.join('\n')}</pre>
                        </div>
                    )}
                    {result.output && (
                        <div className="kairo-test-output-lines" data-testid={`test-output-${index}`}>
                            <div className="kairo-test-output-label">Output:</div>
                            <pre className="kairo-test-output-text">{result.output}</pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const TestOutputComponent: React.FC<TestOutputProps> = ({ store }) => {
    const [runs, setRuns] = React.useState<TestRun[]>(store.getRuns());
    const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);

    React.useEffect(() => {
        const sub = store.onDidChangeRuns(r => {
            setRuns([...r]);
            if (r.length > 0 && !selectedRunId) {
                setSelectedRunId(r[r.length - 1].id);
            }
        });
        return () => sub.dispose();
    }, [store, selectedRunId]);

    const selectedRun = runs.find(r => r.id === selectedRunId) || runs[runs.length - 1];

    if (runs.length === 0) {
        return (
            <div className="kairo-widget" data-testid="test-output-view">
                <div className="kairo-widget-header">
                    <span className="kairo-widget-title">Test Output</span>
                </div>
                <p className="kairo-empty" data-testid="test-output-empty">
                    No test runs yet. Run tests from the Test Explorer.
                </p>
            </div>
        );
    }

    return (
        <div className="kairo-widget" data-testid="test-output-view">
            <div className="kairo-widget-header">
                <span className="kairo-widget-title">Test Output</span>
                {selectedRun && (
                    <span className="kairo-test-run-state" data-testid="test-run-state">
                        {selectedRun.state === 'running' ? '\u25D0' : selectedRun.state === 'succeeded' ? '\u2713' : selectedRun.state === 'failed' ? '\u2717' : ''}{' '}
                        {selectedRun.state}
                    </span>
                )}
            </div>

            {runs.length > 1 && (
                <div className="kairo-widget-toolbar" data-testid="test-output-toolbar">
                    <select
                        className="theia-select"
                        value={selectedRunId ?? ''}
                        onChange={e => setSelectedRunId(e.target.value)}
                        data-testid="test-run-selector"
                        aria-label="Select test run"
                    >
                        {runs.map(r => (
                            <option key={r.id} value={r.id}>
                                [{r.scope}] {r.target} — {r.startTime}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {selectedRun && (
                <div className="kairo-test-output-content" data-testid="test-run-detail">
                    <div className="kairo-test-run-summary" data-testid="test-run-header">
                        <div className="kairo-test-run-info">
                            <span>Scope: {selectedRun.scope}</span>
                            <span>Target: {selectedRun.target || '(all)'}</span>
                            <span>Started: {selectedRun.startTime}</span>
                            {selectedRun.endTime && <span>Ended: {selectedRun.endTime}</span>}
                        </div>
                        <div className="kairo-test-run-counts">
                            <span className="kairo-test-count kairo-test-passed" data-testid="test-passed-count">
                                {selectedRun.passedCount} passed
                            </span>
                            {selectedRun.failedCount > 0 && (
                                <span className="kairo-test-count kairo-test-failed" data-testid="test-failed-count">
                                    {selectedRun.failedCount} failed
                                </span>
                            )}
                            {selectedRun.skippedCount > 0 && (
                                <span className="kairo-test-count kairo-test-skipped" data-testid="test-skipped-count">
                                    {selectedRun.skippedCount} skipped
                                </span>
                            )}
                            {selectedRun.errorCount > 0 && (
                                <span className="kairo-test-count kairo-test-error" data-testid="test-error-count">
                                    {selectedRun.errorCount} errors
                                </span>
                            )}
                        </div>
                    </div>

                    {selectedRun.results.length > 0 && (
                        <div className="kairo-test-results-list" data-testid="test-results-list">
                            <div className="kairo-section-title">Test Results</div>
                            {selectedRun.results.map((result, i) => (
                                <TestMethodRow key={i} result={result} index={i} />
                            ))}
                        </div>
                    )}

                    {selectedRun.output && (
                        <div className="kairo-test-raw-output" data-testid="test-raw-output">
                            <div className="kairo-section-title">Raw Output</div>
                            <pre className="kairo-test-output-pre">{selectedRun.output}</pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

function formatDuration(ms: number): string {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

@injectable()
export class TestOutputWidget extends ReactWidget {
    static readonly ID = 'kairo-test-output';

    @inject(TestStore) protected readonly testStore!: TestStore;

    constructor() {
        super();
        this.id = TestOutputWidget.ID;
        this.title.label = 'Test Output';
        this.title.caption = 'Kairo Test Output';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(TestOutputComponent, {
            store: this.testStore,
        });
    }
}