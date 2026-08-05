import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
import { GitStore, GitChangesState } from './git-store';
import { GitPreCommitChecker, PreCommitCheckSummary, PreCommitCheckResult } from './git-precommit-check';
import { GitCommitTemplateService, CommitTemplate, CommitSuggestion } from './git-commit-template';

interface GitCommitProps {
    store: GitStore;
    preCommitChecker: GitPreCommitChecker;
    templateService: GitCommitTemplateService;
    i18n: KairoI18nService;
}

const GitCommitComponent: React.FC<GitCommitProps> = ({ store, preCommitChecker, templateService, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const [state, setState] = React.useState<GitChangesState>(store.getState());
    const [message, setMessage] = React.useState<string>('');
    const [amend, setAmend] = React.useState<boolean>(false);
    const [signoff, setSignoff] = React.useState<boolean>(false);
    const [noVerify, setNoVerify] = React.useState<boolean>(false);
    const [committing, setCommitting] = React.useState<boolean>(false);
    const [commitResult, setCommitResult] = React.useState<string>('');
    const [commitResultType, setCommitResultType] = React.useState<'success' | 'error' | 'warning'>('success');

    // Pre-commit check state
    const [runBuild, setRunBuild] = React.useState<boolean>(false);
    const [runTests, setRunTests] = React.useState<boolean>(false);
    const [runLint, setRunLint] = React.useState<boolean>(true);
    const [checkSummary, setCheckSummary] = React.useState<PreCommitCheckSummary>({
        status: 'idle',
        results: [],
        hasFailures: false,
    });
    const [showCheckDetails, setShowCheckDetails] = React.useState<boolean>(false);

    // Template state
    const [templates, setTemplates] = React.useState<CommitTemplate[]>(templateService.getTemplates());
    const [selectedTemplateIdx, setSelectedTemplateIdx] = React.useState<number>(0);
    const [suggestions, setSuggestions] = React.useState<CommitSuggestion[]>([]);
    const [showSuggestions, setShowSuggestions] = React.useState<boolean>(false);

    // Amend warning
    const [amendWarning, setAmendWarning] = React.useState<string>('');

    // Initialize
    React.useEffect(() => {
        // Load preferences
        preCommitChecker.loadPreferences();
        const config = preCommitChecker.getConfig();
        setRunBuild(config.runBuild);
        setRunTests(config.runTests);
        setRunLint(config.runLint);

        // Load template preferences
        templateService.loadTemplatePreferences();
        const loaded = templateService.getTemplates();
        setTemplates(loaded);
        const selected = templateService.getSelectedTemplate?.();
        setSelectedTemplateIdx(selected ? Math.max(0, loaded.indexOf(selected)) : 0);

        // Load suggestions
        templateService.loadRecentCommits().then(s => setSuggestions(s));

        // Listen to store changes
        const sub = store.onDidChange(s => {
            setState({ ...s });
            if (s.stagedChanges.length === 0 && s.unstagedChanges.length === 0) {
                setCommitResult('');
            }
        });
        return () => sub.dispose();
    }, [store, preCommitChecker, templateService]);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    const handleRunBuildChange = (checked: boolean) => {
        setRunBuild(checked);
        preCommitChecker.setConfig({ runBuild: checked });
    };

    const handleRunTestsChange = (checked: boolean) => {
        setRunTests(checked);
        preCommitChecker.setConfig({ runTests: checked });
    };

    const handleRunLintChange = (checked: boolean) => {
        setRunLint(checked);
        preCommitChecker.setConfig({ runLint: checked });
    };

    const handleAmendChange = async (checked: boolean) => {
        setAmend(checked);
        setAmendWarning('');
        if (checked) {
            try {
                // Check if last commit is pushed by checking remote status
                if (state.ahead === 0) {
                    setAmendWarning(t('widget.git.commit.amendWarning'));
                }
            } catch {
                // Ignore
            }
        }
    };

    // Check if checks are enabled
    const checksEnabled = runBuild || runTests || runLint;
    const checksRunning = checkSummary.status === 'running';
    const checksFailed = checkSummary.hasFailures;
    const checksCompleted = checkSummary.status === 'completed';

    const handleTemplateSelect = async (idx: number) => {
        setSelectedTemplateIdx(idx);
        templateService.selectTemplate(idx);
        const template = templates[idx];
        if (template && !message.trim()) {
            const generated = await templateService.generateMessage(
                template.name,
                '',
                '',
            );
            setMessage(generated);
        }
    };

    const handleSuggestionClick = (suggestion: CommitSuggestion) => {
        setMessage(suggestion.message);
        setShowSuggestions(false);
    };

    const handleCommit = async (skipChecks: boolean = false) => {
        if (!message.trim() || committing) return;
        if (checksRunning) return;

        // Run pre-commit checks if enabled and not skipping
        if (!skipChecks && checksEnabled) {
            setCommitting(true);
            setCommitResult('');
            setCommitResultType('success');
            const summary = await preCommitChecker.runChecks();
            setCheckSummary(summary);
            setCommitting(false);

            if (summary.hasFailures) {
                setCommitResult(t('widget.git.commit.preCommitFailed'));
                setCommitResultType('warning');
                return;
            }
        }

        // Execute commit
        setCommitting(true);
        setCommitResult('');
        setCommitResultType('success');
        try {
            const result = await store.commit(message.trim(), { amend, signoff, noVerify });
            setCommitResult(t('widget.git.commit.successWithHash', { hash: result.hash }));
            setCommitResultType('success');
            setMessage('');
            setAmend(false);
            setSignoff(false);
            setNoVerify(false);
            setAmendWarning('');
            preCommitChecker.reset();
            setCheckSummary({
                status: 'idle',
                results: [],
                hasFailures: false,
            });
            templateService.recordCommit(message.trim());
        } catch (err) {
            setCommitResult(err instanceof Error ? err.message : String(err));
            setCommitResultType('error');
        } finally {
            setCommitting(false);
        }
    };

    const handleCommitAnyway = () => {
        setCommitResult('');
        setCommitResultType('success');
        handleCommit(true);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleCommit(false);
        }
    };

    const stagedCount = state.stagedChanges.length;
    const canCommit = stagedCount > 0 && message.trim().length > 0 && !committing && !checksRunning;

    // Message stats
    const stats = templateService.getMessageStats(message);
    const bodyWarnings = stats.bodyLines.filter(l => l.exceedsLimit);

    const renderCheckStatusIcon = (result: PreCommitCheckResult) => {
        switch (result.status) {
            case 'passed': return <span className="kairo-precommit-status-icon codicon codicon-check" aria-hidden="true" />;
            case 'failed': return <span className="kairo-precommit-status-icon codicon codicon-error" aria-hidden="true" />;
            case 'timed_out': return <span className="kairo-precommit-status-icon codicon codicon-clock" aria-hidden="true" />;
            case 'error': return <span className="kairo-precommit-status-icon codicon codicon-warning" aria-hidden="true" />;
            case 'skipped': return <span className="kairo-precommit-status-icon codicon codicon-circle-slash" aria-hidden="true" />;
            default: return null;
        }
    };

    const checkTypeLabel = (type: string): string => {
        switch (type) {
            case 'build': return t('widget.git.commit.checkType.build');
            case 'test': return t('widget.git.commit.checkType.test');
            case 'lint': return t('widget.git.commit.checkType.lint');
            default: return type;
        }
    };

    const runningCheckLabel = (check: string | undefined): string => {
        if (!check) return t('widget.git.commit.checkType.checking');
        return checkTypeLabel(check);
    };

    const renderCheckResult = (result: PreCommitCheckResult) => {
        return (
            <div key={result.type} className={`kairo-precommit-result kairo-precommit-result-${result.status}`}>
                {renderCheckStatusIcon(result)}
                <span className="kairo-precommit-result-label">{checkTypeLabel(result.type)}</span>
                <span className="kairo-precommit-result-message">{result.message}</span>
            </div>
        );
    };

    return (
        <div className="kairo-widget" data-testid="git-commit-view">
            <div className="kairo-widget-header" data-testid="git-commit-header">
                <span className="kairo-widget-title">{t('widget.git.commit.title')}</span>
                {stagedCount > 0 && (
                    <span className="kairo-git-staged-count">
                        {stagedCount === 1
                            ? t('widget.git.commit.stagedCountSingular', { count: stagedCount })
                            : t('widget.git.commit.stagedCountPlural', { count: stagedCount })}
                    </span>
                )}
            </div>

            <div className="kairo-widget-section" data-testid="git-commit-form">
                {/* Template Selector */}
                <div className="kairo-git-commit-template">
                    <select
                        className="kairo-git-template-select"
                        value={selectedTemplateIdx}
                        onChange={e => handleTemplateSelect(parseInt(e.target.value, 10))}
                        disabled={committing}
                        data-testid="git-template-select"
                    >
                        {templates.map((tmpl, i) => (
                            <option key={tmpl.name} value={i}>{tmpl.name} - {tmpl.description}</option>
                        ))}
                    </select>
                </div>

                {/* Commit Message */}
                <textarea
                    className="kairo-git-commit-input"
                    data-testid="git-commit-message"
                    placeholder={t('widget.git.commit.placeholder')}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setShowSuggestions(suggestions.length > 0)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    rows={4}
                    disabled={committing}
                />

                {/* Character count and warnings */}
                <div className="kairo-git-commit-meta">
                    <span className="kairo-git-commit-char-count">{t('widget.git.commit.charCount', { count: stats.charCount })}</span>
                    {bodyWarnings.length > 0 && (
                        <span
                            className="kairo-git-commit-warning"
                            title={bodyWarnings.map(w =>
                                t('widget.git.commit.bodyWarningTooltip', { line: w.line, length: w.length })
                            ).join('\n')}
                        >
                            {t('widget.git.commit.bodyWarningText', { count: bodyWarnings.length })}
                        </span>
                    )}
                </div>

                {/* Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                    <div className="kairo-git-suggestions" data-testid="git-suggestions">
                        <div className="kairo-git-suggestions-header">{t('widget.git.commit.suggestionsTitle')}</div>
                        {suggestions.slice(0, 8).map((s, i) => (
                            <div
                                key={i}
                                className="kairo-git-suggestion-item"
                                onMouseDown={() => handleSuggestionClick(s)}
                            >
                                <span className="kairo-git-suggestion-msg">{s.message}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pre-commit Check Options */}
                <div className="kairo-git-commit-options" data-testid="git-precommit-options">
                    <div className="kairo-git-commit-options-title">{t('widget.git.commit.preCommitChecksTitle')}</div>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={runBuild}
                            onChange={e => handleRunBuildChange(e.target.checked)}
                            disabled={committing || checksRunning}
                            data-testid="git-precommit-build"
                        />
                        {t('widget.git.commit.runBuildLabel')}
                    </label>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={runTests}
                            onChange={e => handleRunTestsChange(e.target.checked)}
                            disabled={committing || checksRunning}
                            data-testid="git-precommit-test"
                        />
                        {t('widget.git.commit.runTestsLabel')}
                    </label>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={runLint}
                            onChange={e => handleRunLintChange(e.target.checked)}
                            disabled={committing || checksRunning}
                            data-testid="git-precommit-lint"
                        />
                        {t('widget.git.commit.runLintLabel')}
                    </label>
                </div>

                {/* Commit Options */}
                <div className="kairo-git-commit-options" data-testid="git-commit-options">
                    <div className="kairo-git-commit-options-title">{t('widget.git.commit.commitOptionsTitle')}</div>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={amend}
                            onChange={e => handleAmendChange(e.target.checked)}
                            disabled={committing || checksRunning || stagedCount === 0}
                            data-testid="git-amend-checkbox"
                        />
                        {t('widget.git.commit.amendLabel')}
                    </label>
                    {amendWarning && (
                        <div className="kairo-git-amend-warning" data-testid="git-amend-warning">
                            {amendWarning}
                        </div>
                    )}
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={signoff}
                            onChange={e => setSignoff(e.target.checked)}
                            disabled={committing || checksRunning}
                            data-testid="git-signoff-checkbox"
                        />
                        {t('widget.git.commit.signoffLabel')}
                    </label>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={noVerify}
                            onChange={e => setNoVerify(e.target.checked)}
                            disabled={committing || checksRunning}
                            data-testid="git-noverify-checkbox"
                        />
                        {t('widget.git.commit.noVerifyLabel')}
                    </label>
                </div>

                {/* Pre-commit Check Progress */}
                {checksRunning && (
                    <div className="kairo-precommit-progress" data-testid="git-precommit-progress">
                        <span className="kairo-precommit-spinner codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                        <span>{t('widget.git.commit.preCommitProgress', { check: runningCheckLabel(checkSummary.runningCheck) })}</span>
                    </div>
                )}

                {/* Pre-commit Check Summary */}
                {checksCompleted && checkSummary.results.length > 0 && (
                    <div className="kairo-precommit-summary" data-testid="git-precommit-summary">
                        <div
                            className="kairo-precommit-summary-header"
                            onClick={() => setShowCheckDetails(!showCheckDetails)}
                        >
                            <span className={`kairo-precommit-summary-status ${checkSummary.hasFailures ? 'kairo-precommit-failed' : 'kairo-precommit-passed'}`}>
                                {checkSummary.hasFailures ? t('widget.git.commit.checkStatusFailed') : t('widget.git.commit.checkStatusPassed')}
                            </span>
                            <span className={`kairo-precommit-toggle codicon ${showCheckDetails ? 'codicon-chevron-up' : 'codicon-chevron-down'}`} aria-hidden="true" />
                        </div>
                        {showCheckDetails && (
                            <div className="kairo-precommit-details">
                                {checkSummary.results.map(renderCheckResult)}
                            </div>
                        )}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="kairo-git-commit-actions">
                    <button
                        className="theia-button primary"
                        data-testid="git-commit-button"
                        onClick={() => handleCommit(false)}
                        disabled={!canCommit}
                        aria-label={t('widget.git.commit.commitButtonAria')}
                    >
                        {committing ? t('widget.git.commit.committing') : checksRunning ? t('widget.git.commit.checking') : t('widget.git.commit.commitButton')}
                    </button>

                    {checksEnabled && !checksRunning && (
                        <button
                            className="theia-button secondary"
                            data-testid="git-skip-checks-commit"
                            onClick={() => handleCommit(true)}
                            disabled={!stagedCount || !message.trim() || committing}
                            aria-label={t('widget.git.commit.skipChecksButtonAria')}
                        >
                            {t('widget.git.commit.skipChecksButton')}
                        </button>
                    )}

                    {checksFailed && !checksRunning && (
                        <button
                            className="theia-button kairo-warning-button"
                            data-testid="git-commit-anyway"
                            onClick={handleCommitAnyway}
                            disabled={!stagedCount || !message.trim() || committing}
                            aria-label={t('widget.git.commit.forceCommitButtonAria')}
                        >
                            {t('widget.git.commit.forceCommitButton')}
                        </button>
                    )}

                    <span className="kairo-git-commit-hint">
                        {committing ? '' : checksRunning ? '' : t('widget.git.commit.commitHint')}
                    </span>
                </div>

                {/* Commit Result */}
                {commitResult && (
                    <div
                        className={commitResultType === 'success' ? 'kairo-commit-result-success' :
                            commitResultType === 'warning' ? 'kairo-commit-result-warning' : 'kairo-commit-result-error'}
                        role="alert"
                        data-testid="git-commit-result"
                    >
                        {commitResult}
                    </div>
                )}
            </div>

            {stagedCount === 0 && (
                <div className="kairo-empty-state" data-testid="git-commit-empty">
                    <span className="kairo-empty-state-glyph codicon codicon-git-commit" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.git.commit.emptyStateTitle')}</h3>
                    <p className="kairo-empty-state-reason">{t('widget.git.commit.emptyStateReason')}</p>
                </div>
            )}
        </div>
    );
};

@injectable()
export class GitCommitWidget extends ReactWidget {
    static readonly ID = 'kairo-git-commit-view';

    @inject(GitStore) protected readonly store!: GitStore;
    @inject(GitPreCommitChecker) protected readonly preCommitChecker!: GitPreCommitChecker;
    @inject(GitCommitTemplateService) protected readonly templateService!: GitCommitTemplateService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = GitCommitWidget.ID;
        this.title.label = '';
        this.title.caption = '';
        this.addClass('kairo-widget');
    }

    @postConstruct()
    protected init(): void {
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.git.commit.title' as any);
        this.title.caption = this.i18n.t('widget.git.commit.caption' as any);
    }

    protected render(): React.ReactNode {
        return React.createElement(GitCommitComponent, {
            store: this.store,
            preCommitChecker: this.preCommitChecker,
            templateService: this.templateService,
            i18n: this.i18n,
        });
    }
}
