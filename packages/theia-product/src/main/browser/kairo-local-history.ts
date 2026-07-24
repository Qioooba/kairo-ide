/**
 * Kairo Local History — editor snapshot management.
 *
 * P2-GIT-03: Auto-saves editor snapshots before each save operation,
 * stores them in .kairo/local-history/, limits to 50 snapshots per file,
 * and provides a timeline view with diff comparison and restore.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  Widget,
  WidgetManager,
  FrontendApplicationContribution,
  ApplicationShell,
} from '@theia/core/lib/browser';
import {
  Command,
  CommandRegistry,
  CommandContribution,
  MessageService,
  URI,
  DisposableCollection,
  Emitter,
  Event,
} from '@theia/core/lib/common';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AbstractDialog, ConfirmDialogProps } from '@theia/core/lib/browser/dialogs';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { KairoSaveableService } from './kairo-saveable-service';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Snapshot {
  id: string;
  filePath: string;
  timestamp: number;
  size: number;
}

/* ------------------------------------------------------------------ */
/*  Commands                                                            */
/* ------------------------------------------------------------------ */

export namespace LocalHistoryCommands {
  export const SHOW_HISTORY: Command = {
    id: 'kairo.localHistory.show',
    label: 'Kairo: Show Local History',
  };
  export const RESTORE_SNAPSHOT: Command = {
    id: 'kairo.localHistory.restore',
    label: 'Kairo: Restore Snapshot',
  };
  export const COMPARE_SNAPSHOT: Command = {
    id: 'kairo.localHistory.compare',
    label: 'Kairo: Compare with Current',
  };
}

/* ------------------------------------------------------------------ */
/*  LocalHistoryService — snapshot file I/O                             */
/* ------------------------------------------------------------------ */

const MAX_SNAPSHOTS = 50;
const HISTORY_DIR = '.kairo/local-history';

@injectable()
export class LocalHistoryService {
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;

  protected readonly onDidSaveSnapshotEmitter = new Emitter<URI>();
  readonly onDidSaveSnapshot: Event<URI> = this.onDidSaveSnapshotEmitter.event;

  /** Save a snapshot of the file content before a save operation. */
  async saveSnapshot(uri: URI, content: string): Promise<void> {
    try {
      const historyDir = await this.ensureHistoryDir(uri);
      const timestamp = Date.now();
      const snapshotId = `snapshot-${timestamp}-${this.sanitizePath(uri.path.toString())}`;
      const snapshotUri = historyDir.resolve(snapshotId);

      await this.fileService.write(
        snapshotUri,
        content,
        { encoding: 'utf-8' },
      );

      await this.cleanup(uri);
      this.onDidSaveSnapshotEmitter.fire(uri);
    } catch (err) {
      console.warn('[kairo] local-history: failed to save snapshot', err);
    }
  }

  /** Get all snapshots for a file, sorted by timestamp descending. */
  async getSnapshots(uri: URI): Promise<Snapshot[]> {
    try {
      const historyDir = await this.getHistoryDir(uri);
      if (!historyDir) return [];

      const resolved = await this.fileService.resolve(historyDir);
      if (!resolved || !resolved.children) return [];

      const filePrefix = this.sanitizePath(uri.path.toString());
      const snapshots: Snapshot[] = [];

      for (const child of resolved.children) {
        if (!child.isFile || !child.name.startsWith('snapshot-')) continue;
        // Filter by file path prefix embedded in the snapshot name
        if (!child.name.includes(filePrefix)) continue;

        const parts = child.name.split('-');
        const ts = parseInt(parts[1] || '0', 10);

        snapshots.push({
          id: child.name,
          filePath: uri.path.toString(),
          timestamp: ts,
          size: child.size ?? 0,
        });
      }

      snapshots.sort((a, b) => b.timestamp - a.timestamp);
      return snapshots;
    } catch (err) {
      console.warn('[kairo] local-history: failed to list snapshots', err);
      return [];
    }
  }

  /** Get the content of a specific snapshot. */
  async getSnapshotContent(uri: URI, snapshotId: string): Promise<string> {
    const historyDir = await this.getHistoryDir(uri);
    if (!historyDir) throw new Error('No history directory found');

    const snapshotUri = historyDir.resolve(snapshotId);
    const content = await this.fileService.read(snapshotUri, { encoding: 'utf-8' });
    return content.value;
  }

  /** Restore the file to a snapshot. */
  async restoreSnapshot(uri: URI, snapshotId: string): Promise<void> {
    const content = await this.getSnapshotContent(uri, snapshotId);
    await this.fileService.write(uri, content, { encoding: 'utf-8' });
  }

  /** Get the current file content. */
  async getCurrentContent(uri: URI): Promise<string> {
    const content = await this.fileService.read(uri, { encoding: 'utf-8' });
    return content.value;
  }

  /** Delete a specific snapshot. */
  async deleteSnapshot(uri: URI, snapshotId: string): Promise<void> {
    const historyDir = await this.getHistoryDir(uri);
    if (!historyDir) return;

    const snapshotUri = historyDir.resolve(snapshotId);
    try {
      await this.fileService.delete(snapshotUri);
    } catch {
      // Already deleted or not found
    }
  }

  /** Limit to MAX_SNAPSHOTS per file, removing oldest. */
  protected async cleanup(uri: URI): Promise<void> {
    const snapshots = await this.getSnapshots(uri);
    if (snapshots.length <= MAX_SNAPSHOTS) return;

    const toDelete = snapshots.slice(MAX_SNAPSHOTS);
    for (const snap of toDelete) {
      await this.deleteSnapshot(uri, snap.id);
    }
  }

  protected async ensureHistoryDir(_uri: URI): Promise<URI> {
    const wsRoot = await this.getWorkspaceRoot();
    const historyDir = wsRoot.resolve(HISTORY_DIR);
    try {
      await this.fileService.createFolder(historyDir);
    } catch {
      // Already exists
    }
    return historyDir;
  }

  protected async getHistoryDir(_uri: URI): Promise<URI | undefined> {
    const wsRoot = await this.getWorkspaceRoot();
    if (!wsRoot) return undefined;
    const historyDir = wsRoot.resolve(HISTORY_DIR);
    try {
      await this.fileService.resolve(historyDir);
      return historyDir;
    } catch {
      return undefined;
    }
  }

  protected async getWorkspaceRoot(): Promise<URI> {
    const roots = this.workspaceService.tryGetRoots();
    if (roots.length > 0) return roots[0].resource;
    throw new Error('No workspace root found');
  }

  protected sanitizePath(path: string): string {
    return path.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }
}

/* ------------------------------------------------------------------ */
/*  Restore confirmation dialog                                         */
/* ------------------------------------------------------------------ */

class RestoreConfirmDialog extends AbstractDialog<boolean> {
  protected readonly props: ConfirmDialogProps;

  constructor(msg: string) {
    const props: ConfirmDialogProps = {
      title: 'Restore Snapshot',
      msg,
      ok: 'Restore',
      cancel: 'Cancel',
    };
    super(props);
    this.props = props;
    this.appendMessage();
  }

  protected appendMessage(): void {
    const node = document.createElement('div');
    const msg = this.props.msg;
    node.textContent = typeof msg === 'string' ? msg : '';
    node.style.marginBottom = '12px';
    node.style.color = 'var(--theia-warningForeground, #e0a800)';
    this.contentNode.appendChild(node);
  }

  protected override onCloseRequest(msg: Message): void {
    if (this.resolve) {
      this.resolve(false);
      this.resolve = undefined;
    }
    super.onCloseRequest(msg);
  }

  get value(): boolean {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  LocalHistoryWidget — snapshot timeline view                         */
/* ------------------------------------------------------------------ */

@injectable()
export class LocalHistoryWidget extends Widget {
  static readonly ID = 'kairo-local-history';

  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(LocalHistoryService) protected readonly historyService!: LocalHistoryService;
  @inject(MessageService) protected readonly messages!: MessageService;

  protected snapshots: Snapshot[] = [];
  protected currentUri: URI | undefined;
  protected toDispose = new DisposableCollection();

  constructor() {
    super();
    this.id = LocalHistoryWidget.ID;
    this.title.label = 'Local History';
    this.title.caption = 'Local History — View and restore file snapshots';
    this.addClass('kairo-widget');
    this.renderEmpty();
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(
      this.editorManager.onCurrentEditorChanged(widget => {
        if (widget) {
          this.setEditor(widget);
        }
      }),
    );
    this.toDispose.push(
      this.historyService.onDidSaveSnapshot(() => {
        if (this.currentUri) {
          void this.refresh();
        }
      }),
    );

    // Load current editor on init
    const current = this.editorManager.currentEditor;
    if (current) {
      this.setEditor(current);
    }
  }

  protected setEditor(widget: EditorWidget): void {
    const editor = widget.editor;
    if (!(editor instanceof MonacoEditor)) {
      this.renderEmpty();
      return;
    }
    this.currentUri = editor.uri;
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    if (!this.currentUri) {
      this.renderEmpty();
      return;
    }
    this.snapshots = await this.historyService.getSnapshots(this.currentUri);
    this.render();
  }

  protected renderEmpty(): void {
    this.node.innerHTML = `<div class="kairo-widget-body">
      <p>No history available. Open a file to view its snapshot timeline.</p>
    </div>`;
  }

  protected render(): void {
    if (this.snapshots.length === 0) {
      this.node.innerHTML = `<div class="kairo-widget-body">
        <p>No snapshots for this file yet. Save the file to create snapshots.</p>
      </div>`;
      return;
    }

    const rows = this.snapshots.map((s, _i) => {
      const date = new Date(s.timestamp);
      const timeStr = date.toLocaleString();
      const sizeStr = this.formatSize(s.size);
      return `
        <tr>
          <td>${escapeHtml(timeStr)}</td>
          <td>${sizeStr}</td>
          <td>
            <button class="theia-button secondary" data-action="compare" data-id="${s.id}">Diff</button>
            <button class="theia-button secondary" data-action="restore" data-id="${s.id}">Restore</button>
          </td>
        </tr>`;
    }).join('');

    this.node.innerHTML = `<div class="kairo-widget-body">
      <table class="kairo-deployments-table" aria-label="Local history snapshots">
        <thead><tr><th>Timestamp</th><th>Size</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

    // Attach click handlers
    this.node.querySelectorAll('button[data-action="compare"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        if (id) void this.handleCompare(id);
      });
    });
    this.node.querySelectorAll('button[data-action="restore"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        if (id) void this.handleRestore(id);
      });
    });
  }

  protected async handleCompare(snapshotId: string): Promise<void> {
    if (!this.currentUri) return;
    try {
      const [snapshotContent, currentContent] = await Promise.all([
        this.historyService.getSnapshotContent(this.currentUri, snapshotId),
        this.historyService.getCurrentContent(this.currentUri),
      ]);

      const diffLines = this.computeDiff(snapshotContent, currentContent);
      this.showDiffDialog(snapshotId, diffLines);
    } catch (err) {
      this.messages.error(`Failed to compare: ${(err as Error).message}`);
    }
  }

  protected async handleRestore(snapshotId: string): Promise<void> {
    if (!this.currentUri) return;
    const snap = this.snapshots.find(s => s.id === snapshotId);
    const timeStr = snap ? new Date(snap.timestamp).toLocaleString() : 'unknown';

    const dialog = new RestoreConfirmDialog(
      `Restore "${this.currentUri.displayName}" to snapshot from ${timeStr}?\n\nCurrent unsaved changes will be lost.`,
    );
    const result = await dialog.open();
    if (result) {
      try {
        await this.historyService.restoreSnapshot(this.currentUri, snapshotId);
        this.messages.info(`Restored "${this.currentUri.displayName}" to snapshot from ${timeStr}.`);
        // Reopen the file to show restored content
        await this.editorManager.open(this.currentUri, { mode: 'activate' });
      } catch (err) {
        this.messages.error(`Failed to restore: ${(err as Error).message}`);
      }
    }
  }

  protected computeDiff(oldContent: string, newContent: string): string[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diffLines: string[] = [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i] ?? '';
      const newLine = newLines[i] ?? '';
      if (oldLine !== newLine) {
        if (oldLine) diffLines.push(`- ${oldLine}`);
        if (newLine) diffLines.push(`+ ${newLine}`);
      }
    }

    return diffLines;
  }

  protected showDiffDialog(snapshotId: string, diffLines: string[]): void {
    const container = document.createElement('div');
    container.style.maxHeight = '400px';
    container.style.overflow = 'auto';
    container.style.fontFamily = 'monospace';
    container.style.fontSize = '12px';
    container.style.whiteSpace = 'pre-wrap';
    container.style.padding = '8px';
    container.style.backgroundColor = 'var(--theia-editor-background, #1e1e1e)';
    container.style.color = 'var(--theia-editor-foreground, #d4d4d4)';

    if (diffLines.length === 0) {
      container.textContent = 'No differences found.';
    } else {
      container.innerHTML = diffLines.map(line => {
        if (line.startsWith('- ')) {
          return `<div style="color:var(--theia-errorForeground,#f44747);background:rgba(244,71,71,0.1)">${escapeHtml(line)}</div>`;
        }
        if (line.startsWith('+ ')) {
          return `<div style="color:var(--theia-terminal-ansiGreen,#4ec9b0);background:rgba(78,201,176,0.1)">${escapeHtml(line)}</div>`;
        }
        return `<div>${escapeHtml(line)}</div>`;
      }).join('');
    }

    const dialog = new (class extends AbstractDialog<boolean> {
      constructor() {
        const props: ConfirmDialogProps = { title: `Diff: ${snapshotId}`, msg: '', ok: 'Close', cancel: undefined as unknown as string };
        super(props);
        this.contentNode.appendChild(container);
        this.acceptButton?.addEventListener('click', () => this.close());
      }
      get value(): boolean { return false; }
    })();
    dialog.open();
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  override dispose(): void {
    this.toDispose.dispose();
    super.dispose();
  }
}

/* ------------------------------------------------------------------ */
/*  LocalHistoryContribution — hooks save events, registers commands    */
/* ------------------------------------------------------------------ */

@injectable()
export class LocalHistoryContribution implements FrontendApplicationContribution, CommandContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
  @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;
  @inject(LocalHistoryService) protected readonly historyService!: LocalHistoryService;
  @inject(MessageService) protected readonly messages!: MessageService;

  protected toDispose = new DisposableCollection();

  onStart(): void {
    // Register pre-save snapshot callback
    KairoSaveableService.onBeforeSave.push((widget) => {
      void this.snapshotBeforeSave(widget);
    });
  }

  onStop(): void {
    this.toDispose.dispose();
  }

  async registerCommands(registry: CommandRegistry): Promise<void> {
    registry.registerCommand(LocalHistoryCommands.SHOW_HISTORY, {
      execute: async () => {
        try {
          const w = await this.widgetManager.getOrCreateWidget(LocalHistoryWidget.ID);
          try {
            this.shell.addWidget(w, { area: 'left' });
          } catch {
            // Already attached
          }
          this.shell.activateWidget(w.id);
          w.update();
        } catch (err) {
          this.messages.error(`Failed to open Local History: ${(err as Error).message}`);
        }
        return undefined;
      },
    });
  }

  protected async snapshotBeforeSave(widget: Widget): Promise<void> {
    // Check if the widget is an editor
    if (!(widget instanceof EditorWidget)) return;
    const editor = widget.editor as MonacoEditor;
    if (!editor || !(editor instanceof MonacoEditor)) return;

    try {
      // Read the current file content from disk (pre-save version)
      const content = await this.historyService.getCurrentContent(editor.uri);
      await this.historyService.saveSnapshot(editor.uri, content);
    } catch (_err) {
      // File may not exist yet (new file), skip
      console.debug('[kairo] local-history: skip snapshot for new file', editor.uri.displayName);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}