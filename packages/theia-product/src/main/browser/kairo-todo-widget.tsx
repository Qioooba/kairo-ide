/**
 * Kairo TODO/FIXME widget — scans the workspace for TODO, FIXME,
 * and XXX comments and displays them in a collapsible tree.
 *
 * Uses the @theia/search-in-workspace backend (ripgrep) for fast
 * regex-based scanning. Results are grouped by file, then by
 * comment type, with line-level navigation.
 *
 * Clicking a result opens the file at the comment line.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { SearchInWorkspaceService } from '@theia/search-in-workspace/lib/browser/search-in-workspace-service';
import type { SearchInWorkspaceResult } from '@theia/search-in-workspace/lib/common/search-in-workspace-interface';
import URI from '@theia/core/lib/common/uri';

export const KAIRO_TODO_FACTORY_ID = 'kairo-todo-view';

const TODO_PATTERN = 'TODO|FIXME|XXX';
const TODO_MARKERS = ['TODO', 'FIXME', 'XXX'] as const;
type TodoMarker = typeof TODO_MARKERS[number];

interface TodoEntry {
  marker: TodoMarker;
  line: number;
  /** The full line text trimmed. */
  text: string;
  /** File URI */
  fileUri: string;
}

interface FileGroup {
  fileUri: string;
  /** Display label (relative path) */
  label: string;
  entries: TodoEntry[];
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

function relativePath(fileUri: string, root: string): string {
  if (fileUri.startsWith(root)) {
    let rel = fileUri.slice(root.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }
  return fileUri;
}

interface TodoViewProps {
  fileGroups: FileGroup[];
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  openerService: OpenerService;
}

const TodoView: React.FC<TodoViewProps> = ({
  fileGroups,
  busy,
  error,
  onRefresh,
  openerService,
}) => {
  const [expandedFiles, setExpandedFiles] = React.useState<Set<string>>(new Set());

  const toggleFile = (fileUri: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileUri)) {
        next.delete(fileUri);
      } else {
        next.add(fileUri);
      }
      return next;
    });
  };

  const handleClick = (entry: TodoEntry) => {
    const uri = new URI(entry.fileUri);
    open(openerService, uri, {
      selection: {
        start: { line: entry.line - 1, character: 0 },
        end: { line: entry.line - 1, character: 0 },
      },
    });
  };

  const totalCount = fileGroups.reduce((sum, g) => sum + g.entries.length, 0);

  return (
    <div className="kairo-todo-widget" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="kairo-widget-toolbar" style={{ padding: '6px 12px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>TODO / FIXME</span>
        <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '12px' }}>
          {totalCount} items
        </span>
        <div style={{ flex: 1 }} />
        <button className="theia-button secondary" disabled={busy} onClick={onRefresh} style={{ padding: '2px 10px', fontSize: '12px' }}>
          {busy ? 'Scanning...' : 'Refresh'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {error && (
          <div style={{ padding: '12px', color: 'var(--theia-errorForeground)', fontSize: '13px' }}>
            {error}
          </div>
        )}
        {!error && !busy && fileGroups.length === 0 && (
          <div style={{ padding: '16px 12px', color: 'var(--theia-descriptionForeground)', fontSize: '13px', textAlign: 'center' }}>
            No TODO, FIXME, or XXX comments found in the workspace.
          </div>
        )}
        {fileGroups.map(group => {
          const isExpanded = expandedFiles.has(group.fileUri);
          return (
            <div key={group.fileUri}>
              {/* File header */}
              <div
                className="kairo-todo-file-header"
                onClick={() => toggleFile(group.fileUri)}
                style={{
                  padding: '4px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '13px',
                  userSelect: 'none',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
              >
                <span style={{ display: 'inline-block', width: 16, textAlign: 'center', fontSize: '10px' }}>
                  {isExpanded ? '▼' : '▶'}
                </span>
                <span className="codicon codicon-file" style={{ fontSize: '14px' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {group.label}
                </span>
                <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                  {group.entries.length}
                </span>
              </div>

              {/* Entries */}
              {isExpanded && group.entries.map((entry, i) => (
                <div
                  key={`${entry.line}-${i}`}
                  className="kairo-todo-entry"
                  onClick={() => handleClick(entry)}
                  style={{
                    padding: '3px 12px 3px 40px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                    fontSize: '12px',
                    lineHeight: '1.4',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <span style={{
                    display: 'inline-block',
                    minWidth: 42,
                    textAlign: 'right',
                    color: 'var(--theia-descriptionForeground)',
                    fontSize: '11px',
                    fontFamily: 'var(--theia-ui-font-family)',
                    flexShrink: 0,
                  }}>
                    {entry.line}
                  </span>
                  <span style={{
                    display: 'inline-block',
                    fontWeight: 600,
                    fontSize: '10px',
                    padding: '0 4px',
                    borderRadius: 3,
                    color: entry.marker === 'FIXME' ? '#fff' : entry.marker === 'XXX' ? '#fff' : '#fff',
                    background: entry.marker === 'FIXME' ? '#d32f2f' : entry.marker === 'XXX' ? '#e65100' : '#1976d2',
                    flexShrink: 0,
                    lineHeight: '16px',
                  }}>
                    {entry.marker}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.text}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoTodoWidget extends ReactWidget {
  static readonly ID = KAIRO_TODO_FACTORY_ID;

  @inject(SearchInWorkspaceService)
  protected readonly searchService!: SearchInWorkspaceService;

  @inject(OpenerService)
  protected readonly openerService!: OpenerService;

  @inject(MessageService)
  protected readonly messages!: MessageService;

  protected fileGroups: FileGroup[] = [];
  protected busy = false;
  protected error: string | null = null;

  @postConstruct()
  protected init(): void {
    this.id = KairoTodoWidget.ID;
    this.title.label = 'TODO';
    this.title.caption = 'Kairo TODO / FIXME Viewer';
    this.title.iconClass = 'codicon codicon-checklist';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.update();
  }

  protected onAfterShow(): void {
    this.performScan();
  }

  protected render(): React.ReactNode {
    return React.createElement(TodoView, {
      fileGroups: this.fileGroups,
      busy: this.busy,
      error: this.error,
      onRefresh: () => this.performScan(),
      openerService: this.openerService,
    });
  }

  protected async performScan(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.update();

    try {
      const results: SearchInWorkspaceResult[] = [];
      let done = false;

      const searchId = await this.searchService.search(
        TODO_PATTERN,
        {
          onResult: (_searchId: number, result: SearchInWorkspaceResult) => {
            results.push(result);
          },
          onDone: (_searchId: number, error?: string) => {
            if (done) return;
            done = true;
            if (error) {
              this.error = error;
            } else {
              this.processResults(results);
            }
            this.busy = false;
            this.update();
          },
        },
        {
          useRegExp: true,
          include: ['*.java', '*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.go', '*.rs', '*.c', '*.cpp', '*.h', '*.xml', '*.html', '*.css', '*.scss', '*.md', '*.json', '*.yaml', '*.yml', '*.properties'],
          maxResults: 500,
        },
      );

      // Timeout guard: if the search somehow hangs, cancel after 30s
      setTimeout(() => {
        if (!done) {
          done = true;
          this.error = 'Search timed out.';
          this.busy = false;
          this.update();
          this.searchService.cancel(searchId);
        }
      }, 30_000);
    } catch (err) {
      this.error = (err as Error).message ?? 'Search failed.';
      this.busy = false;
      this.update();
    }
  }

  protected processResults(rawResults: SearchInWorkspaceResult[]): void {
    const groups = new Map<string, FileGroup>();

    for (const result of rawResults) {
      const fileUri = result.fileUri;
      let group = groups.get(fileUri);
      if (!group) {
        group = {
          fileUri,
          label: relativePath(fileUri, result.root),
          entries: [],
        };
        groups.set(fileUri, group);
      }

      for (const match of result.matches) {
        const lineText = typeof match.lineText === 'string'
          ? match.lineText
          : match.lineText.text;

        for (const marker of TODO_MARKERS) {
          const idx = lineText.indexOf(marker);
          if (idx !== -1) {
            group.entries.push({
              marker,
              line: match.line,
              text: lineText.trim(),
              fileUri,
            });
            break; // Only count once per line
          }
        }
      }
    }

    // Sort groups by label, then entries by line
    this.fileGroups = Array.from(groups.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(g => {
        g.entries.sort((a, b) => a.line - b.line);
        return g;
      });
  }
}