import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { KairoI18nService } from '@kairo/i18n';
import { SvnStore, SvnChangesState } from './svn-store';
import { SvnService } from './svn-service';
import { SvnFileStatus, SvnStatusEntry } from '../common/svn-types';

const CMD_COMMIT = 'svn.commit';
const CMD_UPDATE = 'svn.update';
const CMD_RESOLVE = 'svn.resolve';

function statusIconClass(status: SvnFileStatus): string {
  switch (status) {
    case SvnFileStatus.Modified: return 'codicon-edit';
    case SvnFileStatus.Added: return 'codicon-add';
    case SvnFileStatus.Deleted: return 'codicon-trash';
    case SvnFileStatus.Conflict: return 'codicon-warning';
    case SvnFileStatus.Missing: return 'codicon-circle-slash';
    case SvnFileStatus.Unversioned: return 'codicon-question';
    case SvnFileStatus.Ignored: return 'codicon-eye-closed';
    case SvnFileStatus.Replaced: return 'codicon-refresh';
    case SvnFileStatus.Locked: return 'codicon-lock';
    case SvnFileStatus.Switched: return 'codicon-repo';
    case SvnFileStatus.External: return 'codicon-link';
    case SvnFileStatus.Obstructed: return 'codicon-error';
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
  svnService: SvnService;
  commands: CommandService;
  i18n: KairoI18nService;
}

interface FileItemProps {
  entry: SvnStatusEntry;
  selected: boolean;
  onToggle: (path: string) => void;
  onClick: (entry: SvnStatusEntry) => void;
  i18n: KairoI18nService;
}

const FileItem: React.FC<FileItemProps> = ({ entry, selected, onToggle, onClick, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const iconClass = statusIconClass(entry.status);
  const lockTitle = entry.isLocked
    ? t('widget.svn.changes.lockedBy', { owner: entry.lockOwner || t('common.unknown') })
    : undefined;
  return (
    <li
      className={`kairo-svn-file-item ${selected ? 'kairo-svn-file-selected' : ''}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(entry.path)}
        className="kairo-svn-file-checkbox"
      />
      <span className={`kairo-svn-status-badge ${statusClass(entry.status)} ${iconClass ? `codicon ${iconClass}` : ''}`} aria-hidden="true" />
      <span
        className="kairo-svn-file-name"
        onClick={() => onClick(entry)}
        title={entry.path}
      >
        {entry.path}
        {entry.isLocked && (
          <span className="kairo-svn-lock-indicator codicon codicon-lock" title={lockTitle} />
        )}
      </span>
    </li>
  );
};

interface FileSectionProps {
  title: string;
  files: SvnStatusEntry[];
  selectedFiles: Set<string>;
  onToggle: (path: string) => void;
  onFileClick: (entry: SvnStatusEntry) => void;
  actionLabel?: string;
  onAction?: () => void;
  emptyText?: string;
  i18n: KairoI18nService;
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
  i18n,
}) => {
  // Show the section when it has files OR an empty-state hint.
  // (Previously `!actionLabel` hid e.g. "No conflicts" entirely,
  // leaving a large blank body when the working copy is clean.)
  if (files.length === 0 && !emptyText) {
    return null;
  }
  return (
    <div className="kairo-widget-section">
      <div className="kairo-section-header">
        <span className="kairo-section-title">{title}</span>
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
              i18n={i18n}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const SvnChangesComponent: React.FC<SvnChangesProps> = ({ store, svnService, commands, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [state, setState] = React.useState<SvnChangesState>(store.getState());
  const [incoming, setIncoming] = React.useState<SvnStatusEntry[]>([]);
  const [incomingLoading, setIncomingLoading] = React.useState(false);
  const [tab, setTab] = React.useState<'local' | 'incoming'>('local');

  React.useEffect(() => {
    const sub = store.onDidChange(s => setState({ ...s, selectedFiles: new Set(s.selectedFiles) }));
    return () => sub.dispose();
  }, [store]);

  const loadIncoming = React.useCallback(async () => {
    if (!svnService.getActiveWcRoot()) {
      setIncoming([]);
      return;
    }
    setIncomingLoading(true);
    try {
      setIncoming(await svnService.getIncomingStatus());
    } catch {
      setIncoming([]);
    } finally {
      setIncomingLoading(false);
    }
  }, [svnService]);

  React.useEffect(() => {
    if (tab === 'incoming') void loadIncoming();
  }, [tab, loadIncoming, state.revision]);

  const handleRefresh = () => {
    void store.refresh();
    if (tab === 'incoming') void loadIncoming();
  };
  const handleCommit = () => { void commands.executeCommand(CMD_COMMIT); };
  const handleUpdate = () => { void commands.executeCommand(CMD_UPDATE); };
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
    if (toRevert.length > 0 && confirm(t('widget.svn.changes.revertConfirm', { count: toRevert.length }))) {
      await store.revertFiles(toRevert);
    }
  };
  const handleResolveConflicts = () => {
    void commands.executeCommand(CMD_RESOLVE);
  };
  const handleFileClick = (entry: SvnStatusEntry) => {
    store.requestDiff(entry.path);
  };
  const toggleFile = (path: string) => store.toggleFileSelection(path);

  const commitRef = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => {
    const sub = store.onFocusCommit(() => {
      commitRef.current?.focus();
    });
    return () => sub.dispose();
  }, [store]);

  const totalChanges = store.getTotalChanges();
  const canCommit = state.selectedFiles.size > 0 && state.commitMessage.trim().length > 0 && !state.isCommitting;
  const changelistNames = Object.keys(state.changelists || {}).sort();

  return (
    <div className="kairo-widget kairo-svn-changes-view" data-testid="svn-changes-view">
      <div className="kairo-widget-header" data-testid="svn-changes-header">
        <span className="kairo-widget-title">{t('widget.svn.changes.title')}</span>
        {state.available && state.branchName && (
          <span className="kairo-svn-branch" data-testid="svn-branch">
            {state.branchName}
            {state.revision > 0 && ` @ r${state.revision}`}
          </span>
        )}
      </div>

      <div className="kairo-widget-toolbar" data-testid="svn-changes-toolbar">
        <button className={`theia-button ${tab === 'local' ? 'main' : 'secondary'}`} onClick={() => setTab('local')}>
          {t('widget.svn.changes.tabLocal')}
        </button>
        <button className={`theia-button ${tab === 'incoming' ? 'main' : 'secondary'}`} onClick={() => setTab('incoming')}>
          {t('widget.svn.changes.tabIncoming')}{incoming.length > 0 ? ` (${incoming.length})` : ''}
        </button>
        <button
          className="theia-button"
          onClick={handleRefresh}
          disabled={state.loading || !state.available}
          aria-label={t('widget.svn.changes.refresh')}
        >
          <span className={`codicon ${state.loading || incomingLoading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} aria-hidden="true" />
          {state.loading ? t('widget.svn.changes.refreshing') : t('widget.svn.changes.refresh')}
        </button>
        <button
          className="theia-button"
          onClick={handleUpdate}
          disabled={!state.available}
          aria-label={t('widget.svn.changes.update')}
        >
          <span className="codicon codicon-cloud-download" aria-hidden="true" />
          {t('widget.svn.changes.update')}
        </button>
        <button
          className="theia-button primary"
          onClick={handleCommit}
          disabled={!state.available || totalChanges === 0}
        >
          <span className="codicon codicon-check" aria-hidden="true" />
          {t('widget.svn.changes.commit')}
        </button>
        {tab === 'local' && (
          <>
            <button className="theia-button secondary" onClick={handleSelectAll} disabled={totalChanges === 0}>
              {t('widget.svn.changes.selectAll')}
            </button>
            <button className="theia-button secondary" onClick={handleDeselectAll} disabled={state.selectedFiles.size === 0}>
              {t('widget.svn.changes.deselect')}
            </button>
          </>
        )}
      </div>

      {!state.available && (
        <div className="kairo-error-banner" role="alert">
          <span className="codicon codicon-warning" aria-hidden="true" />
          {t('widget.svn.changes.svnNotDetected')}
        </div>
      )}

      {state.error && (
        <div className="kairo-error-banner" role="alert" data-testid="svn-error">
          <span className="codicon codicon-warning" aria-hidden="true" />
          {state.error}
        </div>
      )}

      {state.conflictedFiles.length > 0 && (
        <div className="kairo-error-banner" role="alert">
          <span className="codicon codicon-warning" aria-hidden="true" />
          {t('widget.svn.changes.conflictsBanner', { count: state.conflictedFiles.length })}
          <button className="theia-button secondary" style={{ marginLeft: 8 }} onClick={handleResolveConflicts}>
            {t('widget.svn.changes.resolve')}
          </button>
        </div>
      )}

      {state.available && tab === 'incoming' && (
        <div className="kairo-widget-body">
          <FileSection
            title={t('widget.svn.changes.incomingTitle', { count: incoming.length })}
            files={incoming}
            selectedFiles={new Set()}
            onToggle={() => { /* incoming is read-only selection */ }}
            onFileClick={handleFileClick}
            emptyText={incomingLoading ? t('widget.svn.changes.checkingServer') : t('widget.svn.changes.noIncoming')}
            i18n={i18n}
          />
          <div style={{ padding: '8px 12px' }}>
            <button className="theia-button primary" onClick={handleUpdate} disabled={incoming.length === 0 && !incomingLoading}>
              {t('widget.svn.changes.updateProject')}
            </button>
          </div>
        </div>
      )}

      {state.available && tab === 'local' && (
        <div className="kairo-widget-body">
          <FileSection
            title={t('widget.svn.changes.conflictsTitle', { count: state.conflictedFiles.length })}
            files={state.conflictedFiles}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
            actionLabel={state.conflictedFiles.length > 0 ? t('widget.svn.changes.resolve') : undefined}
            onAction={handleResolveConflicts}
            emptyText={t('widget.svn.changes.noConflicts')}
            i18n={i18n}
          />

          {changelistNames.map(name => (
            <FileSection
              key={name}
              title={`${name} (${state.changelists[name].length})`}
              files={state.changelists[name]}
              selectedFiles={state.selectedFiles}
              onToggle={toggleFile}
              onFileClick={handleFileClick}
              actionLabel={state.selectedFiles.size > 0 ? t('widget.svn.changes.revert') : undefined}
              onAction={handleRevertSelected}
              i18n={i18n}
            />
          ))}

          <FileSection
            title={t('widget.svn.changes.defaultChangelistTitle', { count: state.modifiedFiles.length + state.addedFiles.length + state.deletedFiles.length + state.replacedFiles.length + state.missingFiles.length })}
            files={[...state.modifiedFiles, ...state.addedFiles, ...state.deletedFiles, ...state.replacedFiles, ...state.missingFiles]}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
            actionLabel={state.selectedFiles.size > 0 ? t('widget.svn.changes.revert') : undefined}
            onAction={handleRevertSelected}
            i18n={i18n}
          />

          <FileSection
            title={t('widget.svn.changes.unversionedFilesTitle', { count: state.unversionedFiles.length })}
            files={state.unversionedFiles}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
            actionLabel={state.selectedFiles.size > 0 && state.unversionedFiles.some(u => state.selectedFiles.has(u.path)) ? t('widget.svn.changes.add') : undefined}
            onAction={handleAddSelected}
            i18n={i18n}
          />

          <FileSection
            title={t('widget.svn.changes.ignoredFilesTitle', { count: state.ignoredFiles.length })}
            files={state.ignoredFiles}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
            i18n={i18n}
          />

          <FileSection
            title={t('widget.svn.changes.lockedFilesTitle', { count: state.lockedFiles.length })}
            files={state.lockedFiles}
            selectedFiles={state.selectedFiles}
            onToggle={toggleFile}
            onFileClick={handleFileClick}
            i18n={i18n}
          />

          <div className="kairo-svn-commit-section">
            <div className="kairo-section-header">
              <span className="kairo-section-title">{t('widget.svn.changes.commitMessageTitle')}</span>
              <span className="kairo-svn-commit-hint">{t('widget.svn.changes.quickCommitHint')}</span>
            </div>
            <textarea
              ref={commitRef}
              className="kairo-svn-commit-message"
              placeholder={t('widget.svn.changes.commitMessagePlaceholder')}
              value={state.commitMessage}
              onChange={e => store.setCommitMessage(e.target.value)}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canCommit) {
                  void store.commitSelected().catch(() => { /* state error */ });
                }
              }}
              disabled={state.isCommitting}
            />
            <div className="kairo-svn-commit-actions">
              <span className="kairo-svn-selected-count">
                {t('widget.svn.changes.selectedCount', { count: state.selectedFiles.size })}
              </span>
              <div className="kairo-svn-commit-buttons">
                <button
                  className="theia-button secondary"
                  onClick={handleRevertSelected}
                  disabled={state.selectedFiles.size === 0 || state.isCommitting}
                >
                  <span className="codicon codicon-discard" aria-hidden="true" />
                  {t('widget.svn.changes.revert')}
                </button>
                <button
                  className="theia-button secondary"
                  onClick={handleCommit}
                  disabled={!state.available}
                >
                  {t('widget.svn.changes.commitDialog')}
                </button>
                <button
                  className="theia-button primary"
                  onClick={() => { void store.commitSelected().catch(() => { /* */ }); }}
                  disabled={!canCommit}
                  aria-label={t('widget.svn.changes.commit')}
                >
                  <span className={`codicon ${state.isCommitting ? 'codicon-loading codicon-modifier-spin' : 'codicon-check'}`} aria-hidden="true" />
                  {state.isCommitting ? t('widget.svn.changes.committing') : t('widget.svn.changes.commit')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

@injectable()
export class SvnChangesWidget extends ReactWidget {
  static readonly ID = 'kairo-svn-changes-view';

  @inject(SvnStore) protected readonly store!: SvnStore;
  @inject(SvnService) protected readonly svnService!: SvnService;
  @inject(CommandService) protected readonly commands!: CommandService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  constructor() {
    super();
    this.id = SvnChangesWidget.ID;
    this.title.iconClass = 'codicon codicon-source-control';
    this.title.closable = true;
    this.addClass('kairo-widget');
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
  }

  protected updateTitle(): void {
    this.title.label = this.i18n.t('widget.svn.changes.title' as any);
    this.title.caption = this.i18n.t('widget.svn.changes.caption' as any);
  }

  protected render(): React.ReactNode {
    return React.createElement(SvnChangesComponent, {
      store: this.store,
      svnService: this.svnService,
      commands: this.commands,
      i18n: this.i18n,
    });
  }
}
