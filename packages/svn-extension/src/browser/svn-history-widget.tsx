import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
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
  targetPath?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: SvnLogEntry;
}

const SvnHistoryComponent: React.FC<SvnHistoryProps> = ({
  svnService,
  clipboardService,
  messageService,
  quickInputService,
  workspaceService,
  targetPath: initialTargetPath,
}) => {
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

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return date.toLocaleTimeString();
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  const toggleExpand = (rev: number) => {
    setExpandedEntry(expandedEntry === rev ? null : rev);
  };

  const getActionLabel = (action: string): { label: string; color: string } => {
    switch (action) {
      case 'A': return { label: 'A', color: 'var(--theia-gitDecoration-addedResourceForeground)' };
      case 'D': return { label: 'D', color: 'var(--theia-gitDecoration-deletedResourceForeground)' };
      case 'M': return { label: 'M', color: 'var(--theia-gitDecoration-modifiedResourceForeground)' };
      case 'R': return { label: 'R', color: 'var(--theia-textLink-foreground)' };
      default: return { label: action, color: 'var(--theia-descriptionForeground)' };
    }
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
      messageService.warn('No previous revision available');
      return;
    }
    if (!targetPath) {
      messageService.warn('No file path is bound to this history view');
      return;
    }
    svnService.requestDiff(targetPath, prev, entry.revision);
  };

  const compareWithWorking = (entry: SvnLogEntry) => {
    if (!targetPath) {
      messageService.warn('No file path is bound to this history view');
      return;
    }
    svnService.requestDiff(targetPath, entry.revision, 'WORKING');
  };

  const getRevision = async (entry: SvnLogEntry) => {
    if (!targetPath) {
      messageService.warn('No file path is bound to this history view');
      return;
    }
    const base = targetPath.split(/[\\/]/).pop() || 'file';
    const outName = `${base}.r${entry.revision}`;
    const wcRoot = svnService.getActiveWcRoot();
    if (!wcRoot) {
      messageService.warn('No active SVN working copy');
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
      messageService.info(`Exported to ${outPath}`);
    } catch (e) {
      messageService.error(`Export failed: ${(e as Error).message}`);
    }
  };

  const revertToThis = async (entry: SvnLogEntry) => {
    if (!targetPath) {
      messageService.warn('No file path is bound to this history view');
      return;
    }
    if (!confirm(`Revert ${targetPath} to r${entry.revision}?`)) return;
    try {
      await svnService.revertToRevision(targetPath, entry.revision);
      messageService.info(`Reverted to r${entry.revision}`);
    } catch (e) {
      messageService.error(`Revert failed: ${(e as Error).message}`);
    }
  };

  const copyRevision = async (entry: SvnLogEntry) => {
    try {
      await clipboardService.writeText(String(entry.revision));
      messageService.info(`Copied r${entry.revision}`);
    } catch (e) {
      messageService.error(`Copy failed: ${(e as Error).message}`);
    }
  };

  const showChangeList = (entry: SvnLogEntry) => {
    setExpandedEntry(expandedEntry === entry.revision ? null : entry.revision);
  };

  const selectedEntry = entries.find(e => e.revision === selectedRevision);

  return (
    <div className="kairo-widget kairo-svn-history" data-testid="svn-history-view">
      <div className="kairo-widget-header">
        <span className="kairo-widget-title">SVN History</span>
        {targetPath && <span className="kairo-svn-history-path">{targetPath}</span>}
      </div>

      <div className="kairo-widget-toolbar">
        <input
          type="text"
          placeholder="Filter by author..."
          value={filterAuthor}
          onChange={e => setFilterAuthor(e.target.value)}
          className="kairo-svn-filter-input"
          onKeyDown={e => e.key === 'Enter' && loadHistory()}
        />
        <input
          type="text"
          placeholder="Search message..."
          value={filterMessage}
          onChange={e => setFilterMessage(e.target.value)}
          className="kairo-svn-filter-input"
          onKeyDown={e => e.key === 'Enter' && loadHistory()}
        />
        <button
          className="theia-button"
          onClick={loadHistory}
          disabled={loading}
        >
          {loading ? 'Loading…' : '⟳ Refresh'}
        </button>
      </div>

      <div className="kairo-svn-history-list">
        {loading && entries.length === 0 && (
          <p className="kairo-empty">Loading history...</p>
        )}
        {!loading && entries.length === 0 && (
          <p className="kairo-empty">No history entries found</p>
        )}
        {entries.map(entry => (
          <div
            key={entry.revision}
            className={`kairo-svn-log-entry ${selectedRevision === entry.revision ? 'selected' : ''}`}
            onClick={() => setSelectedRevision(entry.revision)}
            onContextMenu={e => handleContextMenu(e, entry)}
          >
            <div className="kairo-svn-log-header" onClick={e => { e.stopPropagation(); toggleExpand(entry.revision); }}>
              <span className="kairo-svn-log-expand">{expandedEntry === entry.revision ? '▼' : '▶'}</span>
              <span className="kairo-svn-log-rev">r{entry.revision}</span>
              <span className="kairo-svn-log-author">{entry.author}</span>
              <span className="kairo-svn-log-date" title={entry.date.toLocaleString()}>{formatDate(entry.date)}</span>
            </div>
            <div className="kairo-svn-log-message" title={entry.message}>
              {entry.message || '(no message)'}
            </div>
            {expandedEntry === entry.revision && entry.changedPaths.length > 0 && (
              <div className="kairo-svn-log-changes">
                <div className="kairo-svn-changes-title">Changed paths:</div>
                <ul className="kairo-svn-changes-list">
                  {entry.changedPaths.map((cp, idx) => {
                    const action = getActionLabel(cp.action);
                    return (
                      <li key={idx} className="kairo-svn-change-item">
                        <span className="kairo-svn-change-action" style={{ color: action.color }}>
                          {action.label}
                        </span>
                        <span className="kairo-svn-change-path">{cp.path}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          className="kairo-svn-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="kairo-svn-context-menu-header">
            r{contextMenu.entry.revision} · {contextMenu.entry.author}
          </div>
          <button className="kairo-svn-context-menu-item" onClick={() => { compareWithPrevious(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-diff" /> Compare with previous
          </button>
          <button className="kairo-svn-context-menu-item" onClick={() => { compareWithWorking(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-diff" /> Compare with working copy
          </button>
          <div className="kairo-svn-context-menu-sep" />
          <button className="kairo-svn-context-menu-item" onClick={() => { showChangeList(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-list-unordered" /> Show changed paths
          </button>
          <button className="kairo-svn-context-menu-item" onClick={() => { getRevision(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-cloud-download" /> Get (export r{contextMenu.entry.revision})
          </button>
          <div className="kairo-svn-context-menu-sep" />
          <button className="kairo-svn-context-menu-item" onClick={() => { revertToThis(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-discard" /> Revert file to r{contextMenu.entry.revision}
          </button>
          <button className="kairo-svn-context-menu-item" onClick={() => { copyRevision(contextMenu.entry); setContextMenu(null); }}>
            <span className="codicon codicon-copy" /> Copy revision number
          </button>
        </div>
      )}

      {selectedEntry && (
        <div className="kairo-svn-history-detail">
          <div className="kairo-section-header">
            <span className="kairo-section-title">Revision r{selectedEntry.revision}</span>
          </div>
          <div className="kairo-svn-detail-content">
            <p><strong>Author:</strong> {selectedEntry.author}</p>
            <p><strong>Date:</strong> {selectedEntry.date.toLocaleString()}</p>
            <p><strong>Message:</strong></p>
            <pre className="kairo-svn-detail-message">{selectedEntry.message || '(no message)'}</pre>
          </div>
        </div>
      )}

      <style>{`
        .kairo-svn-history {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .kairo-svn-history-path {
          font-size: 12px;
          color: var(--theia-descriptionForeground);
          margin-left: auto;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 200px;
        }
        .kairo-svn-filter-input {
          flex: 1;
          min-width: 100px;
          padding: 4px 8px;
          background: var(--theia-input-background);
          color: var(--theia-input-foreground);
          border: 1px solid var(--theia-input-border);
          border-radius: 3px;
          font-size: 12px;
        }
        .kairo-svn-filter-input:focus {
          outline: none;
          border-color: var(--theia-focusBorder);
        }
        .kairo-svn-history-list {
          flex: 1;
          overflow-y: auto;
          border-top: 1px solid var(--theia-sideBarSectionHeader-border);
        }
        .kairo-svn-log-entry {
          padding: 6px 8px;
          border-bottom: 1px solid var(--theia-tree-inactiveIndentGuidesStroke);
          cursor: pointer;
          font-size: 12px;
        }
        .kairo-svn-log-entry:hover {
          background: var(--theia-list-hoverBackground);
        }
        .kairo-svn-log-entry.selected {
          background: var(--theia-list-activeSelectionBackground);
          color: var(--theia-list-activeSelectionForeground);
        }
        .kairo-svn-log-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 2px;
        }
        .kairo-svn-log-expand {
          font-size: 10px;
          width: 14px;
          text-align: center;
        }
        .kairo-svn-log-rev {
          font-weight: bold;
          color: var(--theia-textLink-foreground);
          min-width: 50px;
        }
        .kairo-svn-log-author {
          min-width: 80px;
          color: var(--theia-descriptionForeground);
        }
        .kairo-svn-log-date {
          color: var(--theia-descriptionForeground);
          font-size: 11px;
        }
        .kairo-svn-log-message {
          margin-left: 22px;
          color: var(--theia-foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .kairo-svn-log-changes {
          margin-top: 6px;
          margin-left: 22px;
          padding: 6px;
          background: var(--theia-editor-background);
          border-radius: 3px;
        }
        .kairo-svn-changes-title {
          font-weight: 600;
          margin-bottom: 4px;
          font-size: 11px;
          text-transform: uppercase;
          color: var(--theia-descriptionForeground);
        }
        .kairo-svn-changes-list {
          list-style: none;
          padding: 0;
          margin: 0;
          max-height: 200px;
          overflow-y: auto;
        }
        .kairo-svn-change-item {
          display: flex;
          gap: 6px;
          padding: 2px 0;
          font-family: monospace;
          font-size: 11px;
        }
        .kairo-svn-change-action {
          font-weight: bold;
          width: 16px;
          text-align: center;
        }
        .kairo-svn-change-path {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .kairo-svn-history-detail {
          border-top: 1px solid var(--theia-sideBarSectionHeader-border);
          max-height: 200px;
          overflow-y: auto;
        }
        .kairo-svn-detail-content {
          padding: 8px;
          font-size: 12px;
        }
        .kairo-svn-detail-content p {
          margin: 4px 0;
        }
        .kairo-svn-detail-message {
          background: var(--theia-editor-background);
          padding: 8px;
          border-radius: 3px;
          white-space: pre-wrap;
          word-break: break-word;
          font-family: monospace;
          font-size: 11px;
          max-height: 100px;
          overflow-y: auto;
        }
        .kairo-svn-context-menu {
          position: fixed;
          z-index: 10000;
          min-width: 260px;
          background: var(--theia-menu-background, var(--theia-editorWidget-background));
          color: var(--theia-menu-foreground, var(--theia-foreground));
          border: 1px solid var(--theia-menu-border, var(--theia-dropdown-border));
          border-radius: 4px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
          padding: 4px 0;
          font-size: 12px;
        }
        .kairo-svn-context-menu-header {
          padding: 4px 12px;
          font-size: 11px;
          color: var(--theia-descriptionForeground);
          border-bottom: 1px solid var(--theia-menu-border, var(--theia-dropdown-border));
          margin-bottom: 4px;
        }
        .kairo-svn-context-menu-item {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 4px 12px;
          background: transparent;
          color: inherit;
          border: 0;
          text-align: left;
          cursor: pointer;
          font-size: 12px;
        }
        .kairo-svn-context-menu-item:hover {
          background: var(--theia-menu-selectionBackground, var(--theia-list-hoverBackground));
          color: var(--theia-menu-selectionForeground, var(--theia-list-activeSelectionForeground));
        }
        .kairo-svn-context-menu-sep {
          height: 1px;
          background: var(--theia-menu-border, var(--theia-dropdown-border));
          margin: 4px 0;
        }
      `}</style>
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

  protected targetPath: string = '';

  constructor() {
    super();
    this.id = SvnHistoryWidget.ID;
    this.title.label = 'SVN History';
    this.title.caption = 'SVN History View';
    this.title.iconClass = 'codicon codicon-history';
    this.title.closable = true;
    this.addClass('kairo-widget');
  }

  setTargetPath(path: string): void {
    this.targetPath = path;
    this.title.label = `SVN History: ${path.split('/').pop() || path}`;
    this.update();
  }

  /**
   * Clear the current history target. Called when the active SVN working
   * copy changes so the widget does not display stale content from
   * the previous project.
   */
  reset(): void {
    this.targetPath = '';
    this.title.label = 'SVN History';
    this.update();
  }

  protected render(): React.ReactNode {
    return React.createElement(SvnHistoryComponent, {
      svnService: this.svnService,
      clipboardService: this.clipboardService,
      messageService: this.messageService,
      quickInputService: this.quickInputService,
      workspaceService: this.workspaceService,
      targetPath: this.targetPath,
    });
  }
}
