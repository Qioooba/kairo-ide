import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { QuickInputService } from '@theia/core/lib/browser/quick-input/quick-input-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { SvnService } from './svn-service';
import { SvnLogEntry } from './svn-types';

interface SvnHistoryProps {
  svnService: SvnService;
  clipboardService: ClipboardService;
  messageService: MessageService;
  quickInputService: QuickInputService;
  workspaceService: WorkspaceService;
  i18n: KairoI18nService;
  targetPath?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: SvnLogEntry;
}

function actionIconClass(action: string): string {
  switch (action) {
    case 'A': return 'codicon-add';
    case 'D': return 'codicon-trash';
    case 'M': return 'codicon-edit';
    case 'R': return 'codicon-refresh';
    default: return 'codicon-question';
  }
}

function actionClass(action: string): string {
  switch (action) {
    case 'A': return 'kairo-svn-history-action-added';
    case 'D': return 'kairo-svn-history-action-deleted';
    case 'M': return 'kairo-svn-history-action-modified';
    case 'R': return 'kairo-svn-history-action-replaced';
    default: return '';
  }
}

const SvnHistoryComponent: React.FC<SvnHistoryProps> = ({
  svnService,
  clipboardService,
  messageService,
  quickInputService,
  workspaceService,
  i18n,
  targetPath: initialTargetPath,
}) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [entries, setEntries] = React.useState<SvnLogEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedRevision, setSelectedRevision] = React.useState<number | null>(null);
  const [targetPath, setTargetPath] = React.useState<string>(initialTargetPath || '');
  const [filterAuthor, setFilterAuthor] = React.useState('');
  const [filterMessage, setFilterMessage] = React.useState('');

  React.useEffect(() => {
    if (initialTargetPath) {
      setTargetPath(initialTargetPath);
    }
  }, [initialTargetPath]);
  const [expandedEntry, setExpandedEntry] = React.useState<number | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const contextMenuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (contextMenu && contextMenuRef.current) {
      contextMenuRef.current.style.left = `${contextMenu.x}px`;
      contextMenuRef.current.style.top = `${contextMenu.y}px`;
    }
  }, [contextMenu]);

  // Close the right-click menu when the user clicks anywhere else or
  // presses Escape.
  React.useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const loadHistory = React.useCallback(async () => {
    setLoading(true);
    try {
      const log = await svnService.getLog(targetPath || undefined, {
        limit: 100,
        author: filterAuthor || undefined,
        searchMessage: filterMessage || undefined,
      });
      setEntries(log);
    } catch (e) {
      console.error('Failed to load SVN history:', e);
    } finally {
      setLoading(false);
    }
  }, [svnService, targetPath, filterAuthor, filterMessage]);

  React.useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const formatDate = React.useCallback((date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return date.toLocaleTimeString();
    if (days === 1) return t('widget.svn.history.yesterday');
    if (days < 7) return t('widget.svn.history.daysAgo', { count: days });
    return date.toLocaleDateString();
  }, [t]);

  const toggleExpand = (rev: number) => {
    setExpandedEntry(expandedEntry === rev ? null : rev);
  };

  // ---- Right-click actions on a log entry ---------------------------------

  const handleContextMenu = (e: React.MouseEvent, entry: SvnLogEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedRevision(entry.revision);
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const findPreviousRevision = (entry: SvnLogEntry): number | undefined => {
    const idx = entries.findIndex(e => e.revision === entry.revision);
    if (idx < 0 || idx >= entries.length - 1) return undefined;
    return entries[idx + 1].revision;
  };

  const compareWithPrevious = (entry: SvnLogEntry) => {
    const prev = findPreviousRevision(entry);
    if (!prev) {
      messageService.warn(t('widget.svn.history.noPreviousRevision'));
      return;
    }
    if (!targetPath) {
      messageService.warn(t('widget.svn.history.noFilePathBound'));
      return;
    }
    svnService.requestDiff(targetPath, prev, entry.revision);
  };

  const compareWithWorking = (entry: SvnLogEntry) => {
    if (!targetPath) {
      messageService.warn(t('widget.svn.history.noFilePathBound'));
      return;
    }
    svnService.requestDiff(targetPath, entry.revision, 'WORKING');
  };

  const getRevision = async (entry: SvnLogEntry) => {
    if (!targetPath) {
      messageService.warn(t('widget.svn.history.noFilePathBound'));
      return;
    }
    const base = targetPath.split(/[\\/]/).pop() || 'file';
    const outName = `${base}.r${entry.revision}`;
    const wcRoot = svnService.getActiveWcRoot();
    if (!wcRoot) {
      messageService.warn(t('widget.svn.history.noActiveWorkingCopy'));
      return;
    }
    const outDir = `${wcRoot}/.svn-kairo-export`;
    try {
      const { URI } = await import('@theia/core/lib/common/uri');
      const { FileService } = await import('@theia/filesystem/lib/browser/file-service');
      // Best-effort mkdir
      try {
        await (workspaceService as any).root; // touch workspaceService to satisfy linter
      } catch { /* ignore */ }
      const fileService = (window as any).theiaFileService;
      if (fileService) {
        try {
          await fileService.create(new URI('file://' + outDir), { fromString: '' });
        } catch { /* may already exist */ }
      }
      const outPath = `${outDir}/${outName}`;
      await svnService.exportAtRevision(targetPath, entry.revision, outPath);
      messageService.info(t('widget.svn.history.exportedTo', { path: outPath }));
    } catch (e) {
      messageService.error(t('widget.svn.history.exportFailed', { message: (e as Error).message }));
    }
  };

  const revertToThis = async (entry: SvnLogEntry) => {
    if (!targetPath) {
      messageService.warn(t('widget.svn.history.noFilePathBound'));
      return;
    }
    if (!confirm(t('widget.svn.history.revertConfirm', { path: targetPath, rev: entry.revision }))) return;
    try {
      await svnService.revertToRevision(targetPath, entry.revision);
      messageService.info(t('widget.svn.history.revertedTo', { rev: entry.revision }));
    } catch (e) {
      messageService.error(t('widget.svn.history.revertFailed', { message: (e as Error).message }));
    }
  };

  const copyRevision = async (entry: SvnLogEntry) => {
    try {
      await clipboardService.writeText(String(entry.revision));
      messageService.info(t('widget.svn.history.copiedRevision', { rev: entry.revision }));
    } catch (e) {
      messageService.error(t('widget.svn.history.copyFailed', { message: (e as Error).message }));
    }
  };

  const showChangeList = (entry: SvnLogEntry) => {
    setExpandedEntry(expandedEntry === entry.revision ? null : entry.revision);
  };

  const selectedEntry = entries.find(e => e.revision === selectedRevision);

  return (
    <div className="kairo-widget kairo-svn-history" data-testid="svn-history-view">
      <div className="kairo-widget-header">
        <span className="kairo-widget-title">{t('widget.svn.history.title')}</span>
        {targetPath && <span className="kairo-svn-history-path">{targetPath}</span>}
      </div>

      <div className="kairo-widget-toolbar">
        <input
          type="text"
          placeholder={t('widget.svn.history.filterAuthorPlaceholder')}
          value={filterAuthor}
          onChange={e => setFilterAuthor(e.target.value)}
          className="theia-input kairo-svn-filter-input"
          onKeyDown={e => e.key === 'Enter' && loadHistory()}
        />
        <input
          type="text"
          placeholder={t('widget.svn.history.filterMessagePlaceholder')}
          value={filterMessage}
          onChange={e => setFilterMessage(e.target.value)}
          className="theia-input kairo-svn-filter-input"
          onKeyDown={e => e.key === 'Enter' && loadHistory()}
        />
        <button
          className="theia-button"
          onClick={loadHistory}
          disabled={loading}
        >
          <span className={`codicon ${loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} aria-hidden="true" />
          {loading ? t('widget.svn.history.loading') : t('widget.svn.history.refresh')}
        </button>
      </div>

      <div className="kairo-widget-body kairo-svn-history-body">
        <div className="kairo-svn-history-list">
          {loading && entries.length === 0 && (
            <p className="kairo-empty-state">{t('widget.svn.history.loading')}</p>
          )}
          {!loading && entries.length === 0 && (
            <p className="kairo-empty-state">{t('widget.svn.history.empty')}</p>
          )}
          {entries.map(entry => (
            <div
              key={entry.revision}
              className={`kairo-svn-log-entry ${selectedRevision === entry.revision ? 'selected' : ''}`}
              onClick={() => setSelectedRevision(entry.revision)}
              onContextMenu={e => handleContextMenu(e, entry)}
            >
              <div className="kairo-svn-log-header" onClick={e => { e.stopPropagation(); toggleExpand(entry.revision); }}>
                <span className={`kairo-svn-log-expand codicon ${expandedEntry === entry.revision ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                <span className="kairo-svn-log-rev">r{entry.revision}</span>
                <span className="kairo-svn-log-author">{entry.author}</span>
                <span className="kairo-svn-log-date" title={entry.date.toLocaleString()}>{formatDate(entry.date)}</span>
              </div>
              <div className="kairo-svn-log-message" title={entry.message}>
                {entry.message || t('widget.svn.history.noMessage')}
              </div>
              {expandedEntry === entry.revision && entry.changedPaths.length > 0 && (
                <div className="kairo-svn-log-changes">
                  <div className="kairo-svn-changes-title">{t('widget.svn.history.changedPaths')}</div>
                  <ul className="kairo-svn-changes-list">
                    {entry.changedPaths.map((cp, idx) => (
                      <li key={idx} className="kairo-svn-change-item">
                        <span className={`kairo-svn-change-action ${actionClass(cp.action)} codicon ${actionIconClass(cp.action)}`} aria-hidden="true" />
                        <span className="kairo-svn-change-path">{cp.path}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>

        {selectedEntry && (
          <div className="kairo-svn-history-detail">
            <div className="kairo-section-header">
              <span className="kairo-section-title">{t('widget.svn.history.revisionTitle', { rev: selectedEntry.revision })}</span>
            </div>
            <div className="kairo-svn-detail-content">
              <p><strong>{t('widget.svn.history.authorLabel')}</strong> {selectedEntry.author}</p>
              <p><strong>{t('widget.svn.history.dateLabel')}</strong> {selectedEntry.date.toLocaleString()}</p>
              <p><strong>{t('widget.svn.history.messageLabel')}</strong></p>
              <pre className="kairo-svn-detail-message">{selectedEntry.message || t('widget.svn.history.noMessage')}</pre>
            </div>
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="kairo-svn-context-menu"
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="kairo-svn-context-menu-header">
            r{contextMenu.entry.revision} | {contextMenu.entry.author}
          </div>
          <button className="kairo-svn-context-menu-item" onClick={() => { compareWithPrevious(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-diff" aria-hidden="true" />
            {t('widget.svn.history.compareWithPrevious')}
          </button>
          <button className="kairo-svn-context-menu-item" onClick={() => { compareWithWorking(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-diff" aria-hidden="true" />
            {t('widget.svn.history.compareWithWorkingCopy')}
          </button>
          <div className="kairo-svn-context-menu-sep" />
          <button className="kairo-svn-context-menu-item" onClick={() => { showChangeList(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-list-unordered" aria-hidden="true" />
            {t('widget.svn.history.showChangedPaths')}
          </button>
          <button className="kairo-svn-context-menu-item" onClick={() => { getRevision(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-cloud-download" aria-hidden="true" />
            {t('widget.svn.history.exportRevision', { rev: contextMenu.entry.revision })}
          </button>
          <div className="kairo-svn-context-menu-sep" />
          <button className="kairo-svn-context-menu-item" onClick={() => { revertToThis(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-discard" aria-hidden="true" />
            {t('widget.svn.history.revertToRevision', { rev: contextMenu.entry.revision })}
          </button>
          <button className="kairo-svn-context-menu-item" onClick={() => { copyRevision(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-copy" aria-hidden="true" />
            {t('widget.svn.history.copyRevision')}
          </button>
        </div>
      )}
    </div>
  );
};

@injectable()
export class SvnHistoryWidget extends ReactWidget {
  static readonly ID = 'kairo-svn-history-view';

  @inject(SvnService) protected readonly svnService!: SvnService;
  @inject(ClipboardService) protected readonly clipboardService!: ClipboardService;
  @inject(MessageService) protected readonly messageService!: MessageService;
  @inject(QuickInputService) protected readonly quickInputService!: QuickInputService;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected targetPath: string = '';

  constructor() {
    super();
    this.id = SvnHistoryWidget.ID;
    this.title.iconClass = 'codicon codicon-history';
    this.title.closable = true;
    this.addClass('kairo-widget');
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
  }

  protected updateTitle(): void {
    this.title.caption = this.i18n.t('widget.svn.history.caption' as any);
    if (!this.targetPath) {
      this.title.label = this.i18n.t('widget.svn.history.title' as any);
    } else {
      const name = this.targetPath.split(/[\\/]/).pop() || this.targetPath;
      this.title.label = this.i18n.t('widget.svn.history.titleWithPath' as any, { name });
    }
  }

  setTargetPath(path: string): void {
    this.targetPath = path;
    this.updateTitle();
    this.update();
  }

  /**
   * Clear the current history target. Called when the active SVN working
   * copy changes so the widget does not display stale content from
   * the previous project.
   */
  reset(): void {
    this.targetPath = '';
    this.updateTitle();
    this.update();
  }

  protected render(): React.ReactNode {
    return React.createElement(SvnHistoryComponent, {
      svnService: this.svnService,
      clipboardService: this.clipboardService,
      messageService: this.messageService,
      quickInputService: this.quickInputService,
      workspaceService: this.workspaceService,
      i18n: this.i18n,
      targetPath: this.targetPath,
    });
  }
}
