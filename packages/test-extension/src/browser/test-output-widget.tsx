import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
import { TestStore, TestRun, TestMethodResult, TestStatus } from './test-store';

function statusIconClass(status: TestStatus): string {
    switch (status) {
        case 'idle': return 'codicon codicon-circle-outline';
        case 'running': return 'codicon codicon-sync codicon-modifier-spin';
        case 'passed': return 'codicon codicon-check';
        case 'failed': return 'codicon codicon-error';
        case 'skipped': return 'codicon codicon-circle-slash';
        case 'error': return 'codicon codicon-warning';
    }
}

function statusColorClass(status: TestStatus): string {
    return `kairo-test-status-${status}`;
}

function runStateIconClass(state: TestRun['state']): string {
    switch (state) {
        case 'running': return 'codicon codicon-sync codicon-modifier-spin';
        case 'succeeded': return 'codicon codicon-check';
        case 'failed': return 'codicon codicon-error';
        case 'cancelled': return 'codicon codicon-circle-slash';
        default: return 'codicon codicon-circle-outline';
    }
}

interface TestOutputProps {
    store: TestStore;
    i18n: KairoI18nService;
}

interface TestMethodRowProps {
    result: TestMethodResult;
    index: number;
    i18n: KairoI18nService;
}

/** Single test method result row. */
const TestMethodRow: React.FC<TestMethodRowProps> = ({ result, index, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [expanded, setExpanded] = React.useState(result.status === 'failed' || result.status === 'error');

    return (
        <div className="kairo-test-method-result" data-testid={`test-result-${index}`}>
            <div
                className="kairo-test-method-header"
                onClick={() => setExpanded(!expanded)}
                role="button"
                aria-expanded={expanded}
            >
                <span className={`kairo-test-status ${statusColorClass(result.status)}`} aria-label={t(`widget.test.output.status.${result.status}` as any)}>
                    <span className={statusIconClass(result.status)} aria-hidden="true" />
                </span>
                <span className="kairo-test-method-name">{result.testId}</span>
                <span className="kairo-test-method-duration">{formatDuration(result.durationMs)}</span>
            </div>
            {expanded && (
                <div className="kairo-test-method-detail">
                    {result.failureMessage && (
                        <div className="kairo-test-assertion-failure" data-testid={`test-assertion-${index}`} role="alert">
                            <div className="kairo-test-failure-label">{t('widget.test.output.assertionFailure')}</div>
                            <pre className="kairo-test-failure-message">{result.failureMessage}</pre>
                        </div>
                    )}
                    {result.stackTrace && result.stackTrace.length > 0 && (
                        <div className="kairo-test-stacktrace" data-testid={`test-stack-${index}`}>
                            <div className="kairo-test-stacktrace-label">{t('widget.test.output.stackTrace')}</div>
                            <pre className="kairo-test-stacktrace-lines">{result.stackTrace.join('\n')}</pre>
                        </div>
                    )}
                    {result.output && (
                        <div className="kairo-test-output-lines" data-testid={`test-output-${index}`}>
                            <div className="kairo-test-output-label">{t('widget.test.output.output')}</div>
                            <pre className="kairo-test-output-text">{result.output}</pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const TestOutputComponent: React.FC<TestOutputProps> = ({ store, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
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

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    const selectedRun = runs.find(r => r.id === selectedRunId) || runs[runs.length - 1];

    if (runs.length === 0) {
        return (
            <div className="kairo-widget" data-testid="test-output-view">
                <div className="kairo-widget-header">
                    <span className="kairo-widget-title">{t('widget.test.output.title')}</span>
                </div>
                <div className="kairo-empty-state" data-testid="test-output-empty">
                    <span className="kairo-empty-state-glyph codicon codicon-beaker" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.test.output.emptyStateTitle')}</h3>
                    <p className="kairo-empty-state-reason">{t('widget.test.output.emptyStateReason')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="kairo-widget" data-testid="test-output-view">
            <div className="kairo-widget-header">
                <span className="kairo-widget-title">{t('widget.test.output.title')}</span>
                {selectedRun && (
                    <span className={`kairo-test-run-state ${selectedRun.state}`} data-testid="test-run-state">
                        <span className={runStateIconClass(selectedRun.state)} aria-hidden="true" />
                        {' '}
                        {t(`widget.test.output.runState.${selectedRun.state}` as any)}
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
                        aria-label={t('widget.test.output.selectRunAria')}
                    >
                        {runs.map(r => (
                            <option key={r.id} value={r.id}>
                                {t('widget.test.output.runOption', {
                                    scope: r.scope,
                                    target: r.target || t('widget.test.output.targetAll'),
                                    startTime: r.startTime,
                                })}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {selectedRun && (
                <div className="kairo-test-output-content" data-testid="test-run-detail">
                    <div className="kairo-test-run-summary" data-testid="test-run-header">
                        <div className="kairo-test-run-info">
                            <span>{t('widget.test.output.label.scope', { scope: selectedRun.scope })}</span>
                            <span>{t('widget.test.output.label.target', { target: selectedRun.target || t('widget.test.output.targetAll') })}</span>
                            <span>{t('widget.test.output.label.started', { startTime: selectedRun.startTime })}</span>
                            {selectedRun.endTime && <span>{t('widget.test.output.label.ended', { endTime: selectedRun.endTime })}</span>}
                        </div>
                        <div className="kairo-test-run-counts">
                            <span className="kairo-test-count kairo-test-status-passed" data-testid="test-passed-count">
                                {t('widget.test.output.summary.passed', { count: selectedRun.passedCount })}
                            </span>
                            {selectedRun.failedCount > 0 && (
                                <span className="kairo-test-count kairo-test-status-failed" data-testid="test-failed-count">
                                    {t('widget.test.output.summary.failed', { count: selectedRun.failedCount })}
                                </span>
                            )}
                            {selectedRun.skippedCount > 0 && (
                                <span className="kairo-test-count kairo-test-status-skipped" data-testid="test-skipped-count">
                                    {t('widget.test.output.summary.skipped', { count: selectedRun.skippedCount })}
                                </span>
                            )}
                            {selectedRun.errorCount > 0 && (
                                <span className="kairo-test-count kairo-test-status-error" data-testid="test-error-count">
                                    {t('widget.test.output.summary.errors', { count: selectedRun.errorCount })}
                                </span>
                            )}
                        </div>
                    </div>

                    {selectedRun.results.length > 0 && (
                        <div className="kairo-test-results-list" data-testid="test-results-list">
                            <div className="kairo-section-title">{t('widget.test.output.testResults')}</div>
                            {selectedRun.results.map((result, i) => (
                                <TestMethodRow key={i} result={result} index={i} i18n={i18n} />
                            ))}
                        </div>
                    )}

                    {selectedRun.output && (
                        <div className="kairo-test-raw-output" data-testid="test-raw-output">
                            <div className="kairo-section-title">{t('widget.test.output.rawOutput')}</div>
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
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    @postConstruct()
    protected init(): void {
        this.id = TestOutputWidget.ID;
        this.title.label = this.i18n.t('widget.test.output.title' as any);
        this.title.caption = this.i18n.t('widget.test.output.caption' as any);
        this.addClass('kairo-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(TestOutputComponent, {
            store: this.testStore,
            i18n: this.i18n,
        });
    }
}
