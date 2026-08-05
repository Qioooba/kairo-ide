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
import { KairoI18nService } from '@kairo/i18n';

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
        // Exact suffix match: snapshot-<ts>-<sanitizedPath> (TP-P2-15).
        // includes() wrongly matched Foo.java inside FooBar.java paths.
        if (!child.name.endsWith(`-${filePrefix}`)) continue;

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
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected snapshots: Snapshot[] = [];
  protected currentUri: URI | undefined;
  protected toDispose = new DisposableCollection();

  constructor() {
    super();
    this.id = LocalHistoryWidget.ID;
    this.addClass('kairo-widget');
  }

  @postConstruct()
  protected init(): void {
    this.applyLocalizedStrings();
    this.toDispose.push(
      this.i18n.onDidChangeLanguage(() => {
        this.applyLocalizedStrings();
        if (this.currentUri) {
          void this.refresh();
        } else {
          this.renderEmpty();
        }
      }),
    );
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
    } else {
      this.renderEmpty();
    }
  }

  protected applyLocalizedStrings(): void {
    this.title.label = this.i18n.t('widget.localHistory.title');
    this.title.caption = this.i18n.t('widget.localHistory.caption');
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
    this.node.replaceChildren();
    const body = document.createElement('div');
    body.className = 'kairo-widget-body';
    const p = document.createElement('p');
    p.textContent = this.i18n.t('widget.localHistory.emptyNoFile');
    body.appendChild(p);
    this.node.appendChild(body);
  }

  protected render(): void {
    this.node.replaceChildren();
    const body = document.createElement('div');
    body.className = 'kairo-widget-body';

    if (this.snapshots.length === 0) {
      const p = document.createElement('p');
      p.textContent = this.i18n.t('widget.localHistory.emptyNoSnapshots');
      body.appendChild(p);
      this.node.appendChild(body);
      return;
    }

    const table = document.createElement('table');
    table.className = 'kairo-deployments-table';
    table.setAttribute('aria-label', this.i18n.t('widget.localHistory.tableAriaLabel'));

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of [
      this.i18n.t('widget.localHistory.columnTimestamp'),
      this.i18n.t('widget.localHistory.columnSize'),
      this.i18n.t('widget.localHistory.columnActions'),
    ]) {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const s of this.snapshots) {
      const tr = document.createElement('tr');

      const tdTime = document.createElement('td');
      tdTime.textContent = new Date(s.timestamp).toLocaleString();
      tr.appendChild(tdTime);

      const tdSize = document.createElement('td');
      tdSize.textContent = this.formatSize(s.size);
      tr.appendChild(tdSize);

      const tdActions = document.createElement('td');
      const compareBtn = document.createElement('button');
      compareBtn.className = 'theia-button secondary';
      compareBtn.textContent = this.i18n.t('widget.localHistory.actionDiff');
      compareBtn.addEventListener('click', () => void this.handleCompare(s.id));
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'theia-button secondary';
      restoreBtn.textContent = this.i18n.t('widget.localHistory.actionRestore');
      restoreBtn.addEventListener('click', () => void this.handleRestore(s.id));
      tdActions.appendChild(compareBtn);
      tdActions.appendChild(document.createTextNode(' '));
      tdActions.appendChild(restoreBtn);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);
    this.node.appendChild(body);
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
      this.messages.error(this.i18n.t('widget.localHistory.compareFailed', { msg: (err as Error).message }));
    }
  }

  protected async handleRestore(snapshotId: string): Promise<void> {
    if (!this.currentUri) return;
    const snap = this.snapshots.find(s => s.id === snapshotId);
    const timeStr = snap ? new Date(snap.timestamp).toLocaleString() : 'unknown';

    const dialog = new RestoreConfirmDialog(
      this.i18n.t('widget.localHistory.restoreConfirm', {
        name: this.currentUri.displayName,
        time: timeStr,
      }),
    );
    const result = await dialog.open();
    if (result) {
      try {
        await this.historyService.restoreSnapshot(this.currentUri, snapshotId);
        this.messages.info(this.i18n.t('widget.localHistory.restored', { name: this.currentUri.displayName, time: timeStr }));
        // Reopen the file to show restored content
        await this.editorManager.open(this.currentUri, { mode: 'activate' });
      } catch (err) {
        this.messages.error(this.i18n.t('widget.localHistory.restoreFailed', { msg: (err as Error).message }));
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
    container.style.backgroundColor = 'var(--theia-editor-background)';
    container.style.color = 'var(--theia-editor-foreground)';

    if (diffLines.length === 0) {
      container.textContent = this.i18n.t('widget.localHistory.noDifferences');
    } else {
      for (const line of diffLines) {
        const row = document.createElement('div');
        row.textContent = line;
        if (line.startsWith('- ')) {
          row.style.color = 'var(--theia-errorForeground)';
          row.style.background = 'var(--theia-diffEditor-removedTextBackground)';
        } else if (line.startsWith('+ ')) {
          row.style.color = 'var(--theia-debugConsole-infoForeground, var(--theia-terminal-ansiGreen))';
          row.style.background = 'var(--theia-diffEditor-insertedTextBackground)';
        }
        container.appendChild(row);
      }
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
          this.messages.error(this.i18n.t('widget.localHistory.openFailed', { msg: (err as Error).message }));
        }
        return undefined;
      },
    });
    // Palette / QA IDs: open the same timeline (compare/restore happen from the widget).
    registry.registerCommand(LocalHistoryCommands.COMPARE_SNAPSHOT, {
      execute: () => registry.executeCommand(LocalHistoryCommands.SHOW_HISTORY.id),
    });
    registry.registerCommand(LocalHistoryCommands.RESTORE_SNAPSHOT, {
      execute: () => registry.executeCommand(LocalHistoryCommands.SHOW_HISTORY.id),
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
