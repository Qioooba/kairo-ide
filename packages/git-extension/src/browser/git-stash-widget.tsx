import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
import { GitStashService, GitStashEntry, GitStashShowResult } from './git-stash-service';

interface StashWidgetProps {
    stashService: GitStashService;
    i18n: KairoI18nService;
}

const StashComponent: React.FC<StashWidgetProps> = ({ stashService, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const [entries, setEntries] = React.useState<GitStashEntry[]>([]);
    const [loading, setLoading] = React.useState<boolean>(false);
    const [message, setMessage] = React.useState<string>('');
    const [includeUntracked, setIncludeUntracked] = React.useState<boolean>(false);
    const [stagedOnly, setStagedOnly] = React.useState<boolean>(false);
    const [selectedEntry, setSelectedEntry] = React.useState<GitStashEntry | undefined>();
    const [showResult, setShowResult] = React.useState<GitStashShowResult | undefined>();
    const [error, setError] = React.useState<string>('');

    const loadEntries = React.useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const list = await stashService.list();
            setEntries(list);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [stashService]);

    React.useEffect(() => {
        loadEntries();
        const sub = stashService.onDidChange(() => loadEntries());
        return () => sub.dispose();
    }, [stashService, loadEntries]);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    const handlePush = async () => {
        setError('');
        try {
            await stashService.push(message || undefined, includeUntracked, stagedOnly);
            setMessage('');
            setIncludeUntracked(false);
            setStagedOnly(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handlePop = async (ref?: string) => {
        setError('');
        try {
            await stashService.pop(ref);
            setSelectedEntry(undefined);
            setShowResult(undefined);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleApply = async (ref?: string) => {
        setError('');
        try {
            await stashService.apply(ref);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleDrop = async (ref?: string) => {
        if (!confirm(t('widget.git.stash.dropConfirm'))) {
            return;
        }
        setError('');
        try {
            await stashService.drop(ref);
            setSelectedEntry(undefined);
            setShowResult(undefined);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleShow = async (entry: GitStashEntry) => {
        setSelectedEntry(entry);
        setShowResult(undefined);
        setError('');
        try {
            const result = await stashService.show(entry.ref);
            setShowResult(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleClear = async () => {
        if (!confirm(t('widget.git.stash.clearConfirm'))) {
            return;
        }
        setError('');
        try {
            await stashService.clear();
            setSelectedEntry(undefined);
            setShowResult(undefined);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const formatDate = (d: Date): string => {
        return d.toLocaleString();
    };

    return (
        <div className="kairo-widget" data-testid="git-stash-view">
            <div className="kairo-widget-header" data-testid="git-stash-header">
                <span className="kairo-widget-title">{t('widget.git.stash.title')}</span>
            </div>

            {/* Stash push area */}
            <div className="kairo-widget-section" data-testid="git-stash-push-section">
                <div className="kairo-section-header">
                    <span className="kairo-section-title">{t('widget.git.stash.saveStashTitle')}</span>
                </div>
                <div className="kairo-stash-push-body">
                    <input
                        type="text"
                        className="kairo-history-search-input kairo-stash-message-input theia-input"
                        placeholder={t('widget.git.stash.messagePlaceholder')}
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                    />
                    <div className="kairo-stash-check-row">
                        <label className="kairo-stash-check-label">
                            <input
                                type="checkbox"
                                checked={includeUntracked}
                                onChange={e => setIncludeUntracked(e.target.checked)}
                            />
                            {t('widget.git.stash.includeUntracked')}
                        </label>
                        <label className="kairo-stash-check-label">
                            <input
                                type="checkbox"
                                checked={stagedOnly}
                                onChange={e => setStagedOnly(e.target.checked)}
                            />
                            {t('widget.git.stash.stagedOnly')}
                        </label>
                    </div>
                    <button
                        className="theia-button"
                        onClick={handlePush}
                        disabled={loading}
                        aria-label={t('widget.git.stash.saveButtonAria')}
                    >
                        {t('widget.git.stash.saveButton')}
                    </button>
                </div>
            </div>

            {error && (
                <div className="kairo-error-banner" role="alert" data-testid="git-stash-error">
                    <span className="codicon codicon-error" aria-hidden="true" />
                    <span>{error}</span>
                </div>
            )}

            {/* Stash list */}
            <div className="kairo-widget-section" data-testid="git-stash-list-section">
                <div className="kairo-section-header">
                    <span className="kairo-section-title">
                        {t('widget.git.stash.stashesTitle')}
                        {entries.length > 0 && t('widget.git.stash.stashesCount', { count: entries.length })}
                    </span>
                    <div className="kairo-stash-list-actions">
                        <button
                            className="theia-button secondary kairo-stash-action-btn"
                            onClick={loadEntries}
                            disabled={loading}
                            aria-label={t('widget.git.stash.refreshButtonAria')}
                        >
                            {t('widget.git.stash.refreshButton')}
                        </button>
                        {entries.length > 0 && (
                            <button
                                className="theia-button secondary kairo-stash-action-btn"
                                onClick={handleClear}
                                aria-label={t('widget.git.stash.clearAllButtonAria')}
                            >
                                {t('widget.git.stash.clearAllButton')}
                            </button>
                        )}
                    </div>
                </div>

                {loading && entries.length === 0 && (
                    <div className="kairo-loading" data-testid="git-stash-loading">
                        <span className="kairo-loading-icon codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                        <span>{t('common.loading')}</span>
                    </div>
                )}
                {!loading && entries.length === 0 && (
                    <div className="kairo-empty-state compact" data-testid="git-stash-empty">
                        <span className="kairo-empty-state-glyph codicon codicon-package" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{t('widget.git.stash.noStashes')}</h3>
                    </div>
                )}
                {entries.map(entry => (
                    <div
                        key={entry.ref}
                        data-testid={`git-stash-item-${entry.index}`}
                        className={`kairo-stash-item ${selectedEntry?.ref === entry.ref ? 'kairo-stash-item-selected' : ''}`}
                        onClick={() => handleShow(entry)}
                    >
                        <div className="kairo-stash-item-main">
                            <span className="kairo-stash-item-ref">{entry.ref}</span>
                            <span className="kairo-stash-item-hash">{entry.hash.substring(0, 7)}</span>
                        </div>
                        <div className="kairo-stash-item-message">{entry.message}</div>
                        <div className="kairo-stash-item-meta">
                            {entry.branch && t('widget.git.stash.branchLabel', { branch: entry.branch })}
                            {entry.branch && ' · '}
                            {formatDate(entry.date)}
                        </div>
                        <div className="kairo-stash-item-actions" onClick={e => e.stopPropagation()}>
                            <button
                                className="theia-button kairo-stash-action-btn"
                                onClick={() => handlePop(entry.ref)}
                                aria-label={t('widget.git.stash.popAria', { ref: entry.ref })}
                            >
                                {t('widget.git.stash.popButton')}
                            </button>
                            <button
                                className="theia-button secondary kairo-stash-action-btn"
                                onClick={() => handleApply(entry.ref)}
                                aria-label={t('widget.git.stash.applyAria', { ref: entry.ref })}
                            >
                                {t('widget.git.stash.applyButton')}
                            </button>
                            <button
                                className="theia-button secondary kairo-stash-action-btn"
                                onClick={() => handleDrop(entry.ref)}
                                aria-label={t('widget.git.stash.dropAria', { ref: entry.ref })}
                            >
                                {t('widget.git.stash.dropButton')}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Show result */}
            {showResult && (
                <div className="kairo-widget-section" data-testid="git-stash-show-section">
                    <div className="kairo-section-header">
                        <span className="kairo-section-title">{t('widget.git.stash.showTitle', { ref: selectedEntry?.ref || '' })}</span>
                    </div>
                    <div className="kairo-stash-show-content">
                        <pre className="kairo-stash-pre">
                            {showResult.stat || showResult.diff || t('widget.git.stash.noDiffContent')}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
};

@injectable()
export class GitStashWidget extends ReactWidget {
    static readonly ID = 'kairo-git-stash';

    @inject(GitStashService) protected readonly stashService!: GitStashService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = GitStashWidget.ID;
        this.title.label = '';
        this.title.caption = '';
        this.title.closable = true;
        this.addClass('kairo-widget');
    }

    @postConstruct()
    protected init(): void {
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.git.stash.title' as any);
        this.title.caption = this.i18n.t('widget.git.stash.caption' as any);
    }

    protected render(): React.ReactNode {
        return React.createElement(StashComponent, {
            stashService: this.stashService,
            i18n: this.i18n,
        });
    }
}
