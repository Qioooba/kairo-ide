import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { SvnService } from './svn-service';
import { SvnLogEntry } from './svn-types';

interface SvnHistoryProps {
  svnService: SvnService;
  targetPath?: string;
}

const SvnHistoryComponent: React.FC<SvnHistoryProps> = ({ svnService, targetPath: initialTargetPath }) => {
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
      `}</style>
    </div>
  );
};

@injectable()
export class SvnHistoryWidget extends ReactWidget {
  static readonly ID = 'kairo-svn-history-view';

  @inject(SvnService) protected readonly svnService!: SvnService;

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

  protected render(): React.ReactNode {
    return React.createElement(SvnHistoryComponent, { svnService: this.svnService, targetPath: this.targetPath });
  }
}
