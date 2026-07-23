import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { GitStore, GitChangesState } from './git-store';
import { GitFileStatus } from './git-service';

function statusIcon(status: string): string {
    switch (status) {
        case 'M': return 'M';
        case 'A': return 'A';
        case 'D': return 'D';
        case 'R': return 'R';
        case 'C': return 'C';
        case '?': return 'U';
        default: return '?';
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
}

const GitChangesComponent: React.FC<GitChangesProps> = ({ store }) => {
    const [state, setState] = React.useState<GitChangesState>(store.getState());
    const [selectedStaged, setSelectedStaged] = React.useState<Set<string>>(new Set());
    const [selectedUnstaged, setSelectedUnstaged] = React.useState<Set<string>>(new Set());

    React.useEffect(() => {
        const sub = store.onDidChange(s => setState({ ...s }));
        return () => sub.dispose();
    }, [store]);

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
            return <p className="kairo-empty">No changes</p>;
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
                        <span className={`kairo-git-status-badge ${statusClass(f.status)}`}>
                            {statusIcon(f.status)}
                        </span>
                        <span
                            className="kairo-git-file-name"
                            onClick={() => handleFileClick(f)}
                            title="Click to view diff"
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
                <span className="kairo-widget-title">Git Changes</span>
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
                    aria-label="Refresh git status"
                >
                    {state.loading ? 'Refreshing…' : 'Refresh'}
                </button>
                <button
                    className="theia-button"
                    onClick={handleStageAll}
                    disabled={state.loading || state.unstagedChanges.length === 0}
                    aria-label="Stage all changes"
                >
                    Stage All
                </button>
                <button
                    className="theia-button secondary"
                    onClick={handleUnstageAll}
                    disabled={state.loading || state.stagedChanges.length === 0}
                    aria-label="Unstage all changes"
                >
                    Unstage All
                </button>
            </div>

            {state.error && (
                <div className="theia-error" role="alert" data-testid="git-error">
                    {state.error}
                </div>
            )}

            <div className="kairo-widget-section" data-testid="git-staged-section">
                <div className="kairo-section-header">
                    <span className="kairo-section-title">Staged Changes</span>
                    {selectedStaged.size > 0 && (
                        <button
                            className="theia-button secondary kairo-git-stage-btn"
                            onClick={handleUnstageSelected}
                            aria-label="Unstage selected"
                        >
                            Unstage Selected
                        </button>
                    )}
                </div>
                {renderFileList(state.stagedChanges, selectedStaged, toggleStaged)}
            </div>

            <div className="kairo-widget-section" data-testid="git-unstaged-section">
                <div className="kairo-section-header">
                    <span className="kairo-section-title">Changes</span>
                    {selectedUnstaged.size > 0 && (
                        <button
                            className="theia-button kairo-git-stage-btn"
                            onClick={handleStageSelected}
                            aria-label="Stage selected"
                        >
                            Stage Selected
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

    constructor() {
        super();
        this.id = GitChangesWidget.ID;
        this.title.label = 'Git Changes';
        this.title.caption = 'Git Changes View';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(GitChangesComponent, { store: this.store });
    }
}