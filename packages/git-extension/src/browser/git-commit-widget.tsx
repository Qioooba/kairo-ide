import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { GitStore, GitChangesState } from './git-store';
import { GitPreCommitChecker, PreCommitCheckSummary, PreCommitCheckResult } from './git-precommit-check';
import { GitCommitTemplateService, CommitTemplate, CommitSuggestion } from './git-commit-template';

interface GitCommitProps {
    store: GitStore;
    preCommitChecker: GitPreCommitChecker;
    templateService: GitCommitTemplateService;
}

const GitCommitComponent: React.FC<GitCommitProps> = ({ store, preCommitChecker, templateService }) => {
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
        setTemplates(templateService.getTemplates());
        setSelectedTemplateIdx(templateService.getSelectedTemplate ? 
            templates.indexOf(templateService.getSelectedTemplate()) : 0);

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
                    setAmendWarning('警告：上一个提交可能已推送，amend 将重写历史');
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
                setCommitResult('预提交检查失败，请查看下方详情。您可以修复问题后重试，或选择「强制提交」。');
                setCommitResultType('warning');
                return;
            }
        }

        // Execute commit
        setCommitting(true);
        setCommitResult('');
        setCommitResultType('success');
        try {
            const result = await store.commit(message.trim(), amend);
            setCommitResult(`提交成功: ${result.hash}`);
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
            case 'passed': return <span className="kairo-check-passed">✓</span>;
            case 'failed': return <span className="kairo-check-failed">✗</span>;
            case 'timed_out': return <span className="kairo-check-timeout">⏱</span>;
            case 'error': return <span className="kairo-check-error">!</span>;
            case 'skipped': return <span className="kairo-check-skipped">-</span>;
            default: return null;
        }
    };

    const renderCheckResult = (result: PreCommitCheckResult) => {
        const labelMap: Record<string, string> = {
            build: '构建',
            test: '测试',
            lint: '代码检查',
        };
        return (
            <div key={result.type} className={`kairo-precommit-result kairo-precommit-result-${result.status}`}>
                {renderCheckStatusIcon(result)}
                <span className="kairo-precommit-result-label">{labelMap[result.type] || result.type}</span>
                <span className="kairo-precommit-result-message">{result.message}</span>
            </div>
        );
    };

    return (
        <div className="kairo-widget" data-testid="git-commit-view">
            <div className="kairo-widget-header" data-testid="git-commit-header">
                <span className="kairo-widget-title">Commit</span>
                {stagedCount > 0 && (
                    <span className="kairo-git-staged-count">
                        {stagedCount} staged file{stagedCount !== 1 ? 's' : ''}
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
                        {templates.map((t, i) => (
                            <option key={t.name} value={i}>{t.name} - {t.description}</option>
                        ))}
                    </select>
                </div>

                {/* Commit Message */}
                <textarea
                    className="kairo-git-commit-input"
                    data-testid="git-commit-message"
                    placeholder="提交信息…"
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
                    <span className="kairo-git-commit-char-count">{stats.charCount} 字符</span>
                    {bodyWarnings.length > 0 && (
                        <span className="kairo-git-commit-warning" title={bodyWarnings.map(w =>
                            `第 ${w.line} 行 ${w.length} 字符，超过建议的 72 字符`
                        ).join('\n')}>
                            {bodyWarnings.length} 行超过长度限制
                        </span>
                    )}
                </div>

                {/* Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                    <div className="kairo-git-suggestions" data-testid="git-suggestions">
                        <div className="kairo-git-suggestions-header">最近提交</div>
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
                    <div className="kairo-git-commit-options-title">预提交检查</div>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={runBuild}
                            onChange={e => handleRunBuildChange(e.target.checked)}
                            disabled={committing || checksRunning}
                            data-testid="git-precommit-build"
                        />
                        提交前运行构建
                    </label>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={runTests}
                            onChange={e => handleRunTestsChange(e.target.checked)}
                            disabled={committing || checksRunning}
                            data-testid="git-precommit-test"
                        />
                        提交前运行测试
                    </label>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={runLint}
                            onChange={e => handleRunLintChange(e.target.checked)}
                            disabled={committing || checksRunning}
                            data-testid="git-precommit-lint"
                        />
                        检查编译错误
                    </label>
                </div>

                {/* Commit Options */}
                <div className="kairo-git-commit-options" data-testid="git-commit-options">
                    <div className="kairo-git-commit-options-title">提交选项</div>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={amend}
                            onChange={e => handleAmendChange(e.target.checked)}
                            disabled={committing || checksRunning || stagedCount === 0}
                            data-testid="git-amend-checkbox"
                        />
                        修改上一次提交 (--amend)
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
                        添加 Signed-off-by (--signoff)
                    </label>
                    <label className="kairo-git-check-label">
                        <input
                            type="checkbox"
                            checked={noVerify}
                            onChange={e => setNoVerify(e.target.checked)}
                            disabled={committing || checksRunning}
                            data-testid="git-noverify-checkbox"
                        />
                        跳过预提交钩子 (--no-verify)
                    </label>
                </div>

                {/* Pre-commit Check Progress */}
                {checksRunning && (
                    <div className="kairo-precommit-progress" data-testid="git-precommit-progress">
                        <div className="kairo-precommit-spinner" />
                        <span>正在运行预提交检查: {checkSummary.runningCheck === 'build' ? '构建' :
                            checkSummary.runningCheck === 'test' ? '测试' :
                                checkSummary.runningCheck === 'lint' ? '代码检查' : '检查中'}...</span>
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
                                {checkSummary.hasFailures ? '检查失败' : '检查全部通过'}
                            </span>
                            <span className="kairo-precommit-toggle">{showCheckDetails ? '▲' : '▼'}</span>
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
                        aria-label="提交暂存的更改"
                    >
                        {committing ? '提交中…' : checksRunning ? '检查中…' : '提交'}
                    </button>

                    {checksEnabled && !checksRunning && (
                        <button
                            className="theia-button secondary"
                            data-testid="git-skip-checks-commit"
                            onClick={() => handleCommit(true)}
                            disabled={!stagedCount || !message.trim() || committing}
                            aria-label="跳过检查并提交"
                        >
                            跳过检查并提交
                        </button>
                    )}

                    {checksFailed && !checksRunning && (
                        <button
                            className="theia-button kairo-warning-button"
                            data-testid="git-commit-anyway"
                            onClick={handleCommitAnyway}
                            disabled={!stagedCount || !message.trim() || committing}
                            aria-label="忽略检查失败，强制提交"
                        >
                            强制提交
                        </button>
                    )}

                    <span className="kairo-git-commit-hint">
                        {committing ? '' : checksRunning ? '' : 'Cmd+Enter 提交'}
                    </span>
                </div>

                {/* Commit Result */}
                {commitResult && (
                    <div
                        className={commitResultType === 'success' ? 'theia-success' :
                            commitResultType === 'warning' ? 'kairo-warning' : 'theia-error'}
                        role="alert"
                        data-testid="git-commit-result"
                    >
                        {commitResult}
                    </div>
                )}
            </div>

            {stagedCount === 0 && (
                <p className="kairo-empty" data-testid="git-commit-empty">
                    请在 Changes 视图中暂存文件以进行提交。
                </p>
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

    constructor() {
        super();
        this.id = GitCommitWidget.ID;
        this.title.label = 'Git Commit';
        this.title.caption = 'Git Commit View';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(GitCommitComponent, {
            store: this.store,
            preCommitChecker: this.preCommitChecker,
            templateService: this.templateService,
        });
    }
}