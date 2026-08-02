// SPDX-License-Identifier: Apache-2.0
import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { KairoI18nService } from '@kairo/i18n';
import { SvnService } from './svn-service';
import { SvnStore } from './svn-store';
import { SvnResolveChoice, SvnStatusEntry } from './svn-types';
import './svn-dialogs.css';

export interface SvnConflictDialogProps {
  svnService: SvnService;
  svnStore: SvnStore;
  messageService: MessageService;
  fileService: FileService;
  i18n: KairoI18nService;
  /** Prefill with a specific conflicted path when opened from context. */
  initialPath?: string;
}

interface ConflictState {
  files: SvnStatusEntry[];
  activePath?: string;
  theirs: string;
  mine: string;
  merged: string;
  loading: boolean;
  resolving: boolean;
  error?: string;
  result?: 'resolved';
}

export class SvnConflictDialog extends ReactDialog<'resolved' | undefined> {
  protected readonly svnService: SvnService;
  protected readonly svnStore: SvnStore;
  protected readonly messageService: MessageService;
  protected readonly fileService: FileService;
  protected readonly i18n: KairoI18nService;
  protected state: ConflictState;

  constructor(props: SvnConflictDialogProps) {
    super({ title: props.i18n.t('widget.svn.dialog.conflict.title'), maxWidth: 1180 } as DialogProps);
    this.svnService = props.svnService;
    this.svnStore = props.svnStore;
    this.messageService = props.messageService;
    this.fileService = props.fileService;
    this.i18n = props.i18n;
    this.addClass('kairo-svn-dlg');
    this.addClass('kairo-svn-conflict-dialog');
    this.id = 'kairo-svn-conflict-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');

    const files = this.svnStore.getState().conflictedFiles;
    const activePath = props.initialPath && files.some(f => f.path === props.initialPath)
      ? props.initialPath
      : files[0]?.path;
    this.state = {
      files,
      activePath,
      theirs: '',
      mine: '',
      merged: '',
      loading: false,
      resolving: false,
    };
  }

  get value(): 'resolved' | undefined {
    return this.state.result;
  }

  protected setState(patch: Partial<ConflictState>): void {
    this.state = { ...this.state, ...patch };
    this.update();
  }

  protected override onAfterAttach(msg: import('@theia/core/shared/@lumino/messaging').Message): void {
    super.onAfterAttach(msg);
    if (this.state.activePath) void this.loadSides(this.state.activePath);
  }

  protected absPath(rel: string): string {
    const root = this.svnService.getActiveWcRoot() || '';
    const sep = root.includes('\\') ? '\\' : '/';
    return `${root.replace(/[\\/]+$/, '')}${sep}${rel.replace(/^[\\/]+/, '')}`;
  }

  protected async readMaybe(path: string): Promise<string> {
    try {
      const uri = FileUri.create(path);
      const data = await this.fileService.read(uri);
      return data.value;
    } catch {
      return '';
    }
  }

  protected async loadSides(relPath: string): Promise<void> {
    this.setState({ loading: true, activePath: relPath, error: undefined });
    const abs = this.absPath(relPath);

    let working = await this.readMaybe(abs);
    let mine = await this.readMaybe(`${abs}.mine`);
    let theirs = '';
    let base = '';

    // Discover .rN conflict siblings from status (unversioned).
    const status = this.svnService.getCachedStatus();
    const prefix = relPath + '.';
    const revFiles: Array<{ rev: number; content: string }> = [];
    for (const e of status) {
      if (!e.path.startsWith(prefix)) continue;
      const suffix = e.path.substring(prefix.length);
      const content = await this.readMaybe(this.absPath(e.path));
      if (!content) continue;
      if (suffix === 'mine') mine = content;
      else if (/^r\d+$/.test(suffix)) {
        revFiles.push({ rev: parseInt(suffix.slice(1), 10), content });
      }
    }
    revFiles.sort((a, b) => a.rev - b.rev);
    if (revFiles.length >= 2) {
      base = revFiles[0].content;
      theirs = revFiles[revFiles.length - 1].content;
    } else if (revFiles.length === 1) {
      theirs = revFiles[0].content;
    }

    try {
      if (!theirs) theirs = await this.svnService.getFileAtRevision(relPath, 'HEAD');
    } catch { /* */ }
    try {
      if (!base) base = await this.svnService.getFileAtRevision(relPath, 'BASE');
    } catch { /* */ }
    if (!mine) mine = working;
    if (!working) working = mine;

    this.setState({
      loading: false,
      theirs: theirs || '(empty)',
      mine: mine || '(empty)',
      merged: working || mine || '',
    });
  }

  protected async acceptSide(side: 'mine' | 'theirs'): Promise<void> {
    const content = side === 'mine' ? this.state.mine : this.state.theirs;
    this.setState({ merged: content });
  }

  protected async resolveWith(choice: SvnResolveChoice, writeMerged = false): Promise<void> {
    const path = this.state.activePath;
    if (!path) return;
    this.setState({ resolving: true, error: undefined });
    try {
      if (writeMerged) {
        const uri = FileUri.create(this.absPath(path));
        await this.fileService.write(uri, this.state.merged);
        await this.svnService.resolve(path, { accept: 'working' });
      } else {
        await this.svnService.resolve(path, { accept: choice });
      }
      await this.svnStore.refresh();
      const files = this.svnStore.getState().conflictedFiles;
      if (files.length === 0) {
        this.messageService.info('All conflicts resolved');
        this.state = { ...this.state, resolving: false, files, result: 'resolved' };
        this.accept();
        return;
      }
      const next = files[0]?.path;
      this.setState({ resolving: false, files, activePath: next });
      if (next) void this.loadSides(next);
    } catch (e) {
      this.setState({ resolving: false, error: (e as Error).message || String(e) });
    }
  }

  protected render(): React.ReactNode {
    const s = this.state;
    if (s.files.length === 0) {
      return (
        <div className="kairo-svn-dlg-shell compact">
          <div className="kairo-svn-dlg-diff-empty" style={{ minHeight: 240 }}>
            <span className="codicon codicon-check" />
            <span>No conflicted files</span>
          </div>
          <div className="kairo-svn-dlg-footer">
            <span className="spacer" />
            <button className="theia-button main" onClick={() => this.close()}>Close</button>
          </div>
        </div>
      );
    }

    return (
      <div className="kairo-svn-dlg-shell">
        <div className="kairo-svn-dlg-pane-header">
          Conflicted files
          <span className="count">{s.files.length}</span>
          <select
            className="theia-select"
            style={{ marginLeft: 12, textTransform: 'none', fontWeight: 500 }}
            value={s.activePath || ''}
            onChange={e => void this.loadSides(e.target.value)}
          >
            {s.files.map(f => (
              <option key={f.path} value={f.path}>{f.path}</option>
            ))}
          </select>
        </div>

        {s.error && <div className="kairo-svn-dlg-error" role="alert">{s.error}</div>}

        {s.loading ? (
          <div className="kairo-svn-dlg-progress">
            <span className="codicon codicon-loading codicon-modifier-spin" />
            <div>Loading conflict sides…</div>
          </div>
        ) : (
          <div className="kairo-svn-dlg-tri">
            <div className="kairo-svn-dlg-tri-pane theirs">
              <div className="kairo-svn-dlg-pane-header">
                Theirs (repository)
                <button className="theia-button secondary" style={{ marginLeft: 'auto', textTransform: 'none' }} onClick={() => void this.acceptSide('theirs')}>
                  Accept →
                </button>
              </div>
              <textarea className="kairo-svn-dlg-code" readOnly value={s.theirs} />
            </div>
            <div className="kairo-svn-dlg-tri-pane merged">
              <div className="kairo-svn-dlg-pane-header">
                Result (editable)
              </div>
              <textarea
                className="kairo-svn-dlg-code"
                value={s.merged}
                onChange={e => this.setState({ merged: e.target.value })}
              />
            </div>
            <div className="kairo-svn-dlg-tri-pane mine">
              <div className="kairo-svn-dlg-pane-header">
                <button className="theia-button secondary" style={{ textTransform: 'none' }} onClick={() => void this.acceptSide('mine')}>
                  ← Accept
                </button>
                Mine (local)
              </div>
              <textarea className="kairo-svn-dlg-code" readOnly value={s.mine} />
            </div>
          </div>
        )}

        <div className="kairo-svn-dlg-footer">
          <button className="theia-button secondary" disabled={s.resolving} onClick={() => this.close()}>Cancel</button>
          <button className="theia-button secondary" disabled={s.resolving} onClick={() => void this.resolveWith('theirs-full')}>
            Accept theirs
          </button>
          <button className="theia-button secondary" disabled={s.resolving} onClick={() => void this.resolveWith('mine-full')}>
            Accept mine
          </button>
          <span className="spacer" />
          <button className="theia-button main" disabled={s.resolving || s.loading} onClick={() => void this.resolveWith('working', true)}>
            {s.resolving ? 'Resolving…' : 'Mark as resolved'}
          </button>
        </div>
      </div>
    );
  }
}
