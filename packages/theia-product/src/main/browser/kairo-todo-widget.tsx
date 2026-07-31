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
import { KairoI18nService } from '@kairo/i18n';

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
  i18n: KairoI18nService;
}

const markerClass = (marker: TodoMarker): string => {
  switch (marker) {
    case 'FIXME': return 'kairo-todo-entry-marker-fixme';
    case 'XXX': return 'kairo-todo-entry-marker-xxx';
    default: return 'kairo-todo-entry-marker-todo';
  }
};

const TodoView: React.FC<TodoViewProps> = ({
  fileGroups,
  busy,
  error,
  onRefresh,
  openerService,
  i18n,
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
    <div className="kairo-todo-widget">
      {/* Header */}
      <div className="kairo-todo-header">
        <span className="kairo-todo-title">{i18n.t('widget.todo.header')}</span>
        <span className="kairo-todo-count">
          {i18n.t('widget.todo.count', { count: totalCount })}
        </span>
        <div className="kairo-todo-actions">
          <button className="theia-button secondary" disabled={busy} onClick={onRefresh}>
            <span className={`codicon ${busy ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} aria-hidden="true" />
            {busy ? i18n.t('widget.todo.scanning') : i18n.t('widget.todo.refresh')}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="kairo-todo-body">
        {error && (
          <div className="kairo-todo-error">
            {error}
          </div>
        )}
        {!error && !busy && fileGroups.length === 0 && (
          <div className="kairo-empty-state">
            <span className="kairo-empty-state-glyph codicon codicon-checklist" aria-hidden="true" />
            <h3 className="kairo-empty-state-title">{i18n.t('widget.todo.empty')}</h3>
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
              >
                <span className="kairo-todo-file-chevron">
                  {isExpanded ? '▼' : '▶'}
                </span>
                <span className="codicon codicon-file kairo-todo-file-icon" />
                <span className="kairo-todo-file-name">
                  {group.label}
                </span>
                <span className="kairo-todo-file-count">
                  {group.entries.length}
                </span>
              </div>

              {/* Entries */}
              {isExpanded && group.entries.map((entry, i) => (
                <div
                  key={`${entry.line}-${i}`}
                  className="kairo-todo-entry"
                  onClick={() => handleClick(entry)}
                >
                  <span className="kairo-todo-entry-line">
                    {entry.line}
                  </span>
                  <span className={`kairo-todo-entry-marker ${markerClass(entry.marker)}`}>
                    {i18n.t(`widget.todo.marker.${entry.marker}`)}
                  </span>
                  <span className="kairo-todo-entry-text">
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

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  protected fileGroups: FileGroup[] = [];
  protected busy = false;
  protected error: string | null = null;

  @postConstruct()
  protected init(): void {
    this.id = KairoTodoWidget.ID;
    this.title.label = this.i18n.t('widget.todo.title');
    this.title.caption = this.i18n.t('widget.todo.caption');
    this.title.iconClass = 'codicon codicon-checklist';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.update()));
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
      i18n: this.i18n,
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
          this.error = this.i18n.t('widget.todo.timeout');
          this.busy = false;
          this.update();
          this.searchService.cancel(searchId);
        }
      }, 30_000);
    } catch (err) {
      this.error = this.i18n.t('widget.todo.error', { message: (err as Error).message ?? 'Search failed.' });
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
