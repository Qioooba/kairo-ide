import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { SvnStore, SvnChangesState } from './svn-store';
import { SvnFileStatus, SvnStatusEntry, getStatusLabel } from './svn-types';

function statusIcon(status: SvnFileStatus): string {
  switch (status) {
    case SvnFileStatus.Modified: return 'M';
    case SvnFileStatus.Added: return 'A';
    case SvnFileStatus.Deleted: return 'D';
    case SvnFileStatus.Conflict: return '!';
    case SvnFileStatus.Missing: return '!';
    case SvnFileStatus.Unversioned: return '?';
    case SvnFileStatus.Ignored: return 'I';
    case SvnFileStatus.Replaced: return 'R';
    case SvnFileStatus.Obstructed: return '~';
    case SvnFileStatus.Locked: return 'L';
    case SvnFileStatus.Switched: return 'S';
    case SvnFileStatus.External: return 'X';
    default: return '';
  }
}

function statusClass(status: SvnFileStatus): string {
  switch (status) {
    case SvnFileStatus.Modified: return 'kairo-svn-status-modified';
    case SvnFileStatus.Added: return 'kairo-svn-status-added';
    case SvnFileStatus.Deleted: return 'kairo-svn-status-deleted';
    case SvnFileStatus.Unversioned: return 'kairo-svn-status-untracked';
    case SvnFileStatus.Conflict: return 'kairo-svn-status-conflict';
    case SvnFileStatus.Missing: return 'kairo-svn-status-missing';
    case SvnFileStatus.Ignored: return 'kairo-svn-status-ignored';
    case SvnFileStatus.Replaced: return 'kairo-svn-status-replaced';
    case SvnFileStatus.Locked: return 'kairo-svn-status-locked';
    default: return '';
  }
}

interface SvnChangesProps {
  store: SvnStore;
}

interface FileItemProps {
  entry: SvnStatusEntry;
  selected: boolean;
  onToggle: (path: string) => void;
  onClick: (entry: SvnStatusEntry) => void;
}

const FileItem: React.FC<FileItemProps> = ({ entry, selected, onToggle, onClick }) => (
  <li
    className={`kairo-svn-file-item ${selected ? 'kairo-svn-file-selected' : ''}`}
  >
    <input
      type="checkbox"
      checked={selected}
      onChange={() => onToggle(entry.path)}
      className="kairo-svn-file-checkbox"
    />
    <span className={`kairo-svn-status-badge ${statusClass(entry.status)}`}>
      {statusIcon(entry.status)}
    </span>
    <span
      className="kairo-svn-file-name"
      onClick={() => onClick(entry)}
      title={`${entry.path} - ${getStatusLabel(entry.status)}`}
    >
      {entry.path}
      {entry.isLocked && <span className="kairo-svn-lock-indicator" title={`Locked by ${entry.lockOwner || 'unknown'}`}>🔒</span>}
    </span>
  </li>
);

interface FileSectionProps {
  title: string;
  files: SvnStatusEntry[];
  selectedFiles: Set<string>;
  onToggle: (path: string) => void;
  onFileClick: (entry: SvnStatusEntry) => void;
  actionLabel?: string;
  onAction?: () => void;
  emptyText?: string;
}

const FileSection: React.FC<FileSectionProps> = ({
  title,
  files,
  selectedFiles,
  onToggle,
  onFileClick,
  actionLabel,
  onAction,
  emptyText,
}) => {
  if (files.length === 0 && !actionLabel) {
    return null;
  }
  return (
    <div className="kairo-widget-section">
      <div className="kairo-section-header">
        <span className="kairo-section-title">{title} ({files.length})</span>
        {actionLabel && onAction && files.length > 0 && (
          <button
            className="theia-button secondary kairo-svn-action-btn"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        )}
      </div>
      {files.length === 0 ? (
        emptyText ? <p className="kairo-empty">{emptyText}</p> : null
      ) : (
        <ul className="kairo-svn-file-list">
          {files.map(f => (
            <FileItem
              key={f.path}
              entry={f}
              selected={selectedFiles.has(f.path)}
              onToggle={onToggle}
              onClick={onFileClick}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const SvnChangesComponent: React.FC<SvnChangesProps> = ({ store }) => {
  const [state, setState] = React.useState<SvnChangesState>(store.getState());

  React.useEffect(() => {
    const sub = store.onDidChange(s => setState({ ...s, selectedFiles: new Set(s.selectedFiles) }));
    return () => sub.dispose();
  }, [store]);

  const handleRefresh = () => store.refresh();
  const handleCommit = async () => {
    try {
      await store.commitSelected();
    } catch (_e) {
      // Error is already set in state
    }
  };
  const handleUpdate = async () => {
    try {
      await store.update();
    } catch (_e) {
      // Error is already set in state
    }
  };
  const handleSelectAll = () => store.selectAll();
  const handleDeselectAll = () => store.deselectAll();
  const handleAddSelected = async () => {
    const toAdd = Array.from(state.selectedFiles).filter(f =>
      state.unversionedFiles.some(u => u.path === f)
    );
    if (toAdd.length > 0) {
      await store.addFiles(toAdd);
    }
  };
  const handleRevertSelected = async () => {
    const toRevert = Array.from(state.selectedFiles);
    if (toRevert.length > 0 && confirm(`Revert ${toRevert.length} file(s)? Local changes will be lost.`)) {
      await store.revertFiles(toRevert);
    }
  };
  const handleFileClick = (entry: SvnStatusEntry) => {
    // Open diff view - for now just request history
    store.requestDiff(entry.path);
  };
  const toggleFile = (path: string) => store.toggleFileSelection(path);

  const totalChanges = store.getTotalChanges();
  const canCommit = state.selectedFiles.size > 0 && state.commitMessage.trim().length > 0 && !state.isCommitting;

  return (
    <div className="kairo-widget" data-testid="svn-changes-view">
      <div className="kairo-widget-header" data-testid="svn-changes-header">
        <span className="kairo-widget-title">SVN Local Changes</span>
        {state.available && state.branchName && (
          <span className="kairo-svn-branch" data-testid="svn-branch">
            {state.branchName}
            {state.revision > 0 && ` @ r${state.revision}`}
          </span>
        )}
      </div>

      <div className="kairo-widget-toolbar" data-testid="svn-changes-toolbar">
        <button
          className="theia-button"
          onClick={handleRefresh}
          disabled={state.loading || !state.available}
          aria-label="Refresh SVN status"
        >
          {state.loading ? 'Refreshing…' : '⟳ Refresh'}
        </button>
        <button
          className="theia-button"
          onClick={handleUpdate}
          disabled={state.isUpdating || !state.available}
          aria-label="Update from repository"
        >
          {state.isUpdating ? 'Updating…' : '↓ Update'}
        </button>
        <button
          className="theia-button secondary"
          onClick={handleSelectAll}
          disabled={totalChanges === 0}
        >
          Select All
        </button>
        <button
          className="theia-button secondary"
          onClick={handleDeselectAll}
          disabled={state.selectedFiles.size === 0}
        >
          Deselect
        </button>
      </div>

      {!state.available && (
        <div className="theia-warning" role="alert">
          SVN client not detected. Please install Subversion (svn command-line tool) to use version control features.
        </div>
      )}

      {state.error && (
        <div className="theia-error" role="alert" data-testid="svn-error">
          {state.error}
        </div>
      )}

      {state.conflictedFiles.length > 0 && (
        <div className="theia-error" role="alert">
          ⚠️ {state.conflictedFiles.length} conflict(s) must be resolved before committing.
        </div>
      )}

      {state.available && (
        <>
          <FileSection
            title="Conflicts"
            files={state.conflictedFiles}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
            actionLabel="Resolve"
            emptyText="No conflicts"
          />

          <FileSection
            title="Default Changelist"
            files={[...state.modifiedFiles, ...state.addedFiles, ...state.deletedFiles, ...state.replacedFiles, ...state.missingFiles]}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
            actionLabel={state.selectedFiles.size > 0 ? 'Revert' : undefined}
            onAction={handleRevertSelected}
          />

          <FileSection
            title="Unversioned Files"
            files={state.unversionedFiles}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
            actionLabel={state.selectedFiles.size > 0 && state.unversionedFiles.some(u => state.selectedFiles.has(u.path)) ? 'Add' : undefined}
            onAction={handleAddSelected}
          />

          <FileSection
            title="Ignored Files"
            files={state.ignoredFiles}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
          />

          <FileSection
            title="Locked Files"
            files={state.lockedFiles}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
          />

          <div className="kairo-svn-commit-section">
            <div className="kairo-section-header">
              <span className="kairo-section-title">Commit Message</span>
              <span className="kairo-svn-commit-hint">Ctrl+Enter to commit</span>
            </div>
            <textarea
              className="kairo-svn-commit-message"
              placeholder="Enter commit message..."
              value={state.commitMessage}
              onChange={e => store.setCommitMessage(e.target.value)}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canCommit) {
                  handleCommit();
                }
              }}
              disabled={state.isCommitting}
            />
            <div className="kairo-svn-commit-actions">
              <span className="kairo-svn-selected-count">
                {state.selectedFiles.size} file(s) selected
              </span>
              <div className="kairo-svn-commit-buttons">
                <button
                  className="theia-button secondary"
                  onClick={handleRevertSelected}
                  disabled={state.selectedFiles.size === 0 || state.isCommitting}
                >
                  ↩ Revert
                </button>
                <button
                  className="theia-button primary"
                  onClick={handleCommit}
                  disabled={!canCommit}
                  aria-label="Commit selected files"
                >
                  {state.isCommitting ? 'Committing…' : '✓ Commit'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        .kairo-svn-file-list {
          list-style: none;
          padding: 0;
          margin: 4px 0;
          max-height: 300px;
          overflow-y: auto;
        }
        .kairo-svn-file-item {
          display: flex;
          align-items: center;
          padding: 2px 8px;
          cursor: pointer;
          font-size: 13px;
          line-height: 22px;
          border-radius: 3px;
        }
        .kairo-svn-file-item:hover {
          background: var(--theia-list-hoverBackground);
        }
        .kairo-svn-file-selected {
          background: var(--theia-list-activeSelectionBackground);
          color: var(--theia-list-activeSelectionForeground);
        }
        .kairo-svn-file-checkbox {
          margin-right: 6px;
          flex-shrink: 0;
        }
        .kairo-svn-status-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          font-size: 11px;
          font-weight: bold;
          margin-right: 6px;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .kairo-svn-status-modified {
          color: var(--theia-gitDecoration-modifiedResourceForeground);
        }
        .kairo-svn-status-added {
          color: var(--theia-gitDecoration-addedResourceForeground);
        }
        .kairo-svn-status-deleted {
          color: var(--theia-gitDecoration-deletedResourceForeground);
        }
        .kairo-svn-status-untracked {
          color: var(--theia-gitDecoration-untrackedResourceForeground);
        }
        .kairo-svn-status-conflict {
          color: var(--theia-gitDecoration-conflictingResourceForeground);
          font-weight: bold;
        }
        .kairo-svn-status-missing {
          color: var(--theia-editorError-foreground);
        }
        .kairo-svn-status-ignored {
          color: var(--theia-gitDecoration-ignoredResourceForeground);
        }
        .kairo-svn-status-replaced {
          color: var(--theia-textLink-foreground);
        }
        .kairo-svn-status-locked {
          color: var(--theia-editorWarning-foreground);
        }
        .kairo-svn-file-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .kairo-svn-lock-indicator {
          margin-left: 4px;
          font-size: 10px;
        }
        .kairo-svn-branch {
          font-size: 12px;
          color: var(--theia-descriptionForeground);
          margin-left: auto;
          padding: 2px 8px;
          background: var(--theia-badge-background);
          color: var(--theia-badge-foreground);
          border-radius: 10px;
        }
        .kairo-svn-action-btn {
          font-size: 11px;
          padding: 2px 8px;
        }
        .kairo-svn-commit-section {
          padding: 8px;
          border-top: 1px solid var(--theia-sideBarSectionHeader-border);
          margin-top: 8px;
        }
        .kairo-svn-commit-hint {
          font-size: 11px;
          color: var(--theia-descriptionForeground);
        }
        .kairo-svn-commit-message {
          width: 100%;
          min-height: 80px;
          margin: 8px 0;
          padding: 8px;
          background: var(--theia-input-background);
          color: var(--theia-input-foreground);
          border: 1px solid var(--theia-input-border);
          border-radius: 3px;
          font-family: var(--theia-ui-font-family);
          font-size: 13px;
          resize: vertical;
          box-sizing: border-box;
        }
        .kairo-svn-commit-message:focus {
          outline: none;
          border-color: var(--theia-focusBorder);
        }
        .kairo-svn-commit-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .kairo-svn-selected-count {
          font-size: 12px;
          color: var(--theia-descriptionForeground);
        }
        .kairo-svn-commit-buttons {
          display: flex;
          gap: 8px;
        }
        .kairo-widget-section {
          margin: 4px 0;
        }
        .kairo-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 8px;
          background: var(--theia-sideBarSectionHeader-background);
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--theia-sideBarSectionHeader-foreground);
        }
        .kairo-widget-toolbar {
          display: flex;
          gap: 4px;
          padding: 4px 8px;
          flex-wrap: wrap;
        }
        .kairo-widget-toolbar button {
          font-size: 12px;
          padding: 4px 8px;
        }
      `}</style>
    </div>
  );
};

@injectable()
export class SvnChangesWidget extends ReactWidget {
  static readonly ID = 'kairo-svn-changes-view';

  @inject(SvnStore) protected readonly store!: SvnStore;

  constructor() {
    super();
    this.id = SvnChangesWidget.ID;
    this.title.label = 'SVN Changes';
    this.title.caption = 'SVN Local Changes View';
    this.title.iconClass = 'codicon codicon-source-control';
    this.title.closable = true;
    this.addClass('kairo-widget');
  }

  protected render(): React.ReactNode {
    return React.createElement(SvnChangesComponent, { store: this.store });
  }
}
