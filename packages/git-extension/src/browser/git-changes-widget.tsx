import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
import { GitStore, GitChangesState } from './git-store';
import { GitFileStatus } from './git-service';

function statusIconClass(status: string): string {
    switch (status) {
        case 'M': return 'codicon-diff-modified';
        case 'A': return 'codicon-diff-added';
        case 'D': return 'codicon-diff-removed';
        case 'R': return 'codicon-diff-renamed';
        case 'C': return 'codicon-diff';
        case '?': return 'codicon-file';
        default: return 'codicon-question';
    }
}

function statusClass(status: string): string {
    switch (status) {
        case 'M': return 'kairo-git-status-modified';
        case 'A': return 'kairo-git-status-added';
        case 'D': return 'kairo-git-status-deleted';
        case '?': return 'kairo-git-status-untracked';
        case 'R': return 'kairo-git-status-renamed';
        default: return '';
    }
}

interface GitChangesProps {
    store: GitStore;
    i18n: KairoI18nService;
}

const GitChangesComponent: React.FC<GitChangesProps> = ({ store, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const [state, setState] = React.useState<GitChangesState>(store.getState());
    const [selectedStaged, setSelectedStaged] = React.useState<Set<string>>(new Set());
    const [selectedUnstaged, setSelectedUnstaged] = React.useState<Set<string>>(new Set());

    React.useEffect(() => {
        const sub = store.onDidChange(s => setState({ ...s }));
        return () => sub.dispose();
    }, [store]);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    const handleRefresh = () => store.refresh();
    const handleStageAll = () => store.stageAll();
    const handleUnstageAll = () => store.unstageAll();

    const handleStageSelected = async () => {
        if (selectedUnstaged.size === 0) return;
        await store.stageFiles(Array.from(selectedUnstaged));
        setSelectedUnstaged(new Set());
    };

    const handleUnstageSelected = async () => {
        if (selectedStaged.size === 0) return;
        await store.unstageFiles(Array.from(selectedStaged));
        setSelectedStaged(new Set());
    };

    const handleFileClick = (file: GitFileStatus) => {
        store.requestDiff(file.path, file.staged);
    };

    const toggleStaged = (filePath: string) => {
        const next = new Set(selectedStaged);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        setSelectedStaged(next);
    };

    const toggleUnstaged = (filePath: string) => {
        const next = new Set(selectedUnstaged);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        setSelectedUnstaged(next);
    };

    const renderFileList = (files: GitFileStatus[], selected: Set<string>, onToggle: (f: string) => void) => {
        if (files.length === 0) {
            return (
                <div className="kairo-empty-state compact">
                    <span className="kairo-empty-state-glyph codicon codicon-check" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.git.changes.noChanges')}</h3>
                </div>
            );
        }
        return (
            <ul className="kairo-git-file-list">
                {files.map(f => (
                    <li
                        key={f.path}
                        className={`kairo-git-file-item ${selected.has(f.path) ? 'kairo-git-file-selected' : ''}`}
                    >
                        <input
                            type="checkbox"
                            checked={selected.has(f.path)}
                            onChange={() => onToggle(f.path)}
                            className="kairo-git-file-checkbox"
                        />
                        <span className={`kairo-git-status-badge ${statusClass(f.status)}`} aria-hidden="true">
                            <span className={`codicon ${statusIconClass(f.status)}`} />
                        </span>
                        <span
                            className="kairo-git-file-name"
                            onClick={() => handleFileClick(f)}
                            title={t('widget.git.changes.viewDiffTooltip')}
                        >
                            {f.path}
                            {f.origPath && <span className="kairo-git-old-name"> ({f.origPath})</span>}
                        </span>
                    </li>
                ))}
            </ul>
        );
    };

    return (
        <div className="kairo-widget" data-testid="git-changes-view">
            <div className="kairo-widget-header" data-testid="git-changes-header">
                <span className="kairo-widget-title">{t('widget.git.changes.title')}</span>
                {state.branch && (
                    <span className="kairo-git-branch" data-testid="git-branch">
                        {state.branch}
                        {state.ahead > 0 && ` +${state.ahead}`}
                        {state.behind > 0 && ` -${state.behind}`}
                    </span>
                )}
            </div>

            <div className="kairo-widget-toolbar" data-testid="git-changes-toolbar">
                <button
                    className="theia-button"
                    onClick={handleRefresh}
                    disabled={state.loading}
                    aria-label={t('widget.git.changes.refreshButtonAria')}
                >
                    {state.loading ? t('widget.git.changes.refreshing') : t('widget.git.changes.refreshButton')}
                </button>
                <button
                    className="theia-button"
                    onClick={handleStageAll}
                    disabled={state.loading || state.unstagedChanges.length === 0}
                    aria-label={t('widget.git.changes.stageAllButtonAria')}
                >
                    {t('widget.git.changes.stageAllButton')}
                </button>
                <button
                    className="theia-button secondary"
                    onClick={handleUnstageAll}
                    disabled={state.loading || state.stagedChanges.length === 0}
                    aria-label={t('widget.git.changes.unstageAllButtonAria')}
                >
                    {t('widget.git.changes.unstageAllButton')}
                </button>
            </div>

            {state.error && (
                <div className="kairo-error-banner" role="alert" data-testid="git-error">
                    <span className="codicon codicon-error" aria-hidden="true" />
                    <span>{state.error}</span>
                </div>
            )}

            <div className="kairo-widget-section" data-testid="git-staged-section">
                <div className="kairo-section-header">
                    <span className="kairo-section-title">{t('widget.git.changes.stagedTitle')}</span>
                    {selectedStaged.size > 0 && (
                        <button
                            className="theia-button secondary kairo-git-stage-btn"
                            onClick={handleUnstageSelected}
                            aria-label={t('widget.git.changes.unstageSelectedButtonAria')}
                        >
                            {t('widget.git.changes.unstageSelectedButton')}
                        </button>
                    )}
                </div>
                {renderFileList(state.stagedChanges, selectedStaged, toggleStaged)}
            </div>

            <div className="kairo-widget-section" data-testid="git-unstaged-section">
                <div className="kairo-section-header">
                    <span className="kairo-section-title">{t('widget.git.changes.unstagedTitle')}</span>
                    {selectedUnstaged.size > 0 && (
                        <button
                            className="theia-button kairo-git-stage-btn"
                            onClick={handleStageSelected}
                            aria-label={t('widget.git.changes.stageSelectedButtonAria')}
                        >
                            {t('widget.git.changes.stageSelectedButton')}
                        </button>
                    )}
                </div>
                {renderFileList(state.unstagedChanges, selectedUnstaged, toggleUnstaged)}
            </div>
        </div>
    );
};

@injectable()
export class GitChangesWidget extends ReactWidget {
    static readonly ID = 'kairo-git-changes-view';

    @inject(GitStore) protected readonly store!: GitStore;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = GitChangesWidget.ID;
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
        this.title.label = this.i18n.t('widget.git.changes.title' as any);
        this.title.caption = this.i18n.t('widget.git.changes.caption' as any);
    }

    protected render(): React.ReactNode {
        return React.createElement(GitChangesComponent, {
            store: this.store,
            i18n: this.i18n,
        });
    }
}
