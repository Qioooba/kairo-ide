// SPDX-License-Identifier: Apache-2.0
import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { MessageService } from '@theia/core/lib/common/message-service';
import { KairoI18nService } from '@kairo/i18n';
import { SvnService } from './svn-service';
import { SvnStore } from './svn-store';
import { SvnFileStatus, SvnStatusEntry, getStatusLabel } from './svn-types';
import './svn-dialogs.css';

export interface SvnCommitDialogProps {
  svnService: SvnService;
  svnStore: SvnStore;
  messageService: MessageService;
  i18n: KairoI18nService;
}

interface CommitState {
  files: SvnStatusEntry[];
  selected: Set<string>;
  activePath?: string;
  message: string;
  keepLocks: boolean;
  loadingDiff: boolean;
  diffLines: Array<{ text: string; kind: 'add' | 'del' | 'hunk' | 'ctx' }>;
  committing: boolean;
  error?: string;
  result?: 'committed';
}

function statusLetter(status: SvnFileStatus): string {
  switch (status) {
    case SvnFileStatus.Modified: return 'M';
    case SvnFileStatus.Added: return 'A';
    case SvnFileStatus.Deleted: return 'D';
    case SvnFileStatus.Conflict: return 'C';
    case SvnFileStatus.Replaced: return 'R';
    case SvnFileStatus.Unversioned: return '?';
    case SvnFileStatus.Missing: return '!';
    default: return 'M';
  }
}

function parseUnifiedDiff(diff: string): Array<{ text: string; kind: 'add' | 'del' | 'hunk' | 'ctx' }> {
  if (!diff.trim()) return [];
  return diff.split(/\r?\n/).map(line => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('Index:') || line.startsWith('===')) {
      return { text: line, kind: 'hunk' as const };
    }
    if (line.startsWith('@@')) return { text: line, kind: 'hunk' as const };
    if (line.startsWith('+')) return { text: line, kind: 'add' as const };
    if (line.startsWith('-')) return { text: line, kind: 'del' as const };
    return { text: line, kind: 'ctx' as const };
  });
}

function collectCommitFiles(store: SvnStore): SvnStatusEntry[] {
  const s = store.getState();
  const fromDefault = [
    ...s.modifiedFiles,
    ...s.addedFiles,
    ...s.deletedFiles,
    ...s.replacedFiles,
    ...s.missingFiles,
    ...s.unversionedFiles,
  ];
  const fromCl = Object.values(s.changelists).flat();
  const seen = new Set<string>();
  const out: SvnStatusEntry[] = [];
  for (const f of [...fromDefault, ...fromCl]) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    out.push(f);
  }
  return out;
}

export class SvnCommitDialog extends ReactDialog<'committed' | undefined> {
  protected readonly svnService: SvnService;
  protected readonly svnStore: SvnStore;
  protected readonly messageService: MessageService;
  protected readonly i18n: KairoI18nService;
  protected state: CommitState;

  constructor(props: SvnCommitDialogProps) {
    super({
      title: props.i18n.t('widget.svn.dialog.commit.title'),
      maxWidth: 1120,
    } as DialogProps);
    this.svnService = props.svnService;
    this.svnStore = props.svnStore;
    this.messageService = props.messageService;
    this.i18n = props.i18n;
    this.addClass('kairo-svn-dlg');
    this.addClass('kairo-svn-commit-dialog');
    this.id = 'kairo-svn-commit-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');

    const files = collectCommitFiles(this.svnStore);
    const selected = new Set(this.svnStore.getState().selectedFiles);
    // Respect Changes-view deselect-all: do not auto-select everything again.
    if (selected.size === 0 && !this.svnStore.shouldSuppressAutoSelect) {
      for (const f of files) {
        if (f.status !== SvnFileStatus.Unversioned) selected.add(f.path);
      }
    }
    this.state = {
      files,
      selected,
      activePath: files[0]?.path,
      message: this.svnStore.getState().commitMessage || '',
      keepLocks: false,
      loadingDiff: false,
      diffLines: [],
      committing: false,
    };
  }

  get value(): 'committed' | undefined {
    return this.state.result;
  }

  protected setState(patch: Partial<CommitState>): void {
    this.state = { ...this.state, ...patch };
    this.update();
  }

  protected override onAfterAttach(msg: import('@theia/core/shared/@lumino/messaging').Message): void {
    super.onAfterAttach(msg);
    if (this.state.activePath) {
      void this.loadDiff(this.state.activePath);
    }
  }

  protected async loadDiff(path: string): Promise<void> {
    this.setState({ loadingDiff: true, activePath: path });
    try {
      if (this.state.files.find(f => f.path === path)?.status === SvnFileStatus.Unversioned) {
        this.setState({
          loadingDiff: false,
          diffLines: [{ text: this.i18n.t('widget.svn.dialog.commit.unversionedHint'), kind: 'hunk' }],
        });
        return;
      }
      const diff = await this.svnService.getDiff(path);
      this.setState({ loadingDiff: false, diffLines: parseUnifiedDiff(diff) });
    } catch (e) {
      this.setState({
        loadingDiff: false,
        diffLines: [{ text: (e as Error).message || this.i18n.t('widget.svn.dialog.commit.loadDiffFailed'), kind: 'del' }],
      });
    }
  }

  protected toggle(path: string): void {
    const selected = new Set(this.state.selected);
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    this.setState({ selected });
  }

  protected selectAll(on: boolean): void {
    const selected = new Set<string>();
    if (on) {
      for (const f of this.state.files) selected.add(f.path);
    }
    this.setState({ selected });
  }

  protected groupFiles(): Array<{ title: string; files: SvnStatusEntry[] }> {
    const byCl = new Map<string, SvnStatusEntry[]>();
    const def: SvnStatusEntry[] = [];
    for (const f of this.state.files) {
      if (f.changelist) {
        if (!byCl.has(f.changelist)) byCl.set(f.changelist, []);
        byCl.get(f.changelist)!.push(f);
      } else {
        def.push(f);
      }
    }
    const groups: Array<{ title: string; files: SvnStatusEntry[] }> = [];
    for (const [name, files] of [...byCl.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      groups.push({ title: name, files });
    }
    if (def.length) groups.push({ title: this.i18n.t('widget.svn.dialog.commit.defaultGroup'), files: def });
    return groups;
  }

  protected async doCommit(): Promise<void> {
    const paths = Array.from(this.state.selected);
    if (paths.length === 0) {
      this.setState({ error: this.i18n.t('widget.svn.dialog.commit.selectAtLeastOne') });
      return;
    }
    if (!this.state.message.trim()) {
      this.setState({ error: this.i18n.t('widget.svn.dialog.commit.messageRequired') });
      return;
    }
    this.setState({ committing: true, error: undefined });
    this.svnStore.setCommitMessage(this.state.message);
    try {
      const unversioned = paths.filter(p =>
        this.state.files.some(f => f.path === p && f.status === SvnFileStatus.Unversioned),
      );
      if (unversioned.length) await this.svnService.add(unversioned);
      const info = await this.svnService.commit(paths, this.state.message, {
        keepLocks: this.state.keepLocks,
      });
      this.messageService.info(this.i18n.t('widget.svn.dialog.commit.committedRevision', { rev: String(info.revision) }));
      this.state = { ...this.state, committing: false, result: 'committed' };
      this.accept();
    } catch (e) {
      this.setState({ committing: false, error: (e as Error).message || String(e) });
    }
  }

  protected render(): React.ReactNode {
    const s = this.state;
    const t = this.i18n.t.bind(this.i18n);
    const groups = this.groupFiles();
    const charCount = s.message.length;
    const subjectLen = (s.message.split('\n')[0] || '').length;

    return (
      <div className="kairo-svn-dlg-shell">
        <div className="kairo-svn-dlg-main">
          <div className="kairo-svn-dlg-pane files">
            <div className="kairo-svn-dlg-pane-header">
              {t('widget.svn.dialog.commit.files')}
              <span className="count">{s.selected.size}/{s.files.length}</span>
            </div>
            <div className="kairo-svn-dlg-toolbar">
              <button className="theia-button secondary" onClick={() => this.selectAll(true)}>{t('widget.svn.dialog.commit.selectAll')}</button>
              <button className="theia-button secondary" onClick={() => this.selectAll(false)}>{t('widget.svn.dialog.commit.none')}</button>
            </div>
            <ul className="kairo-svn-dlg-file-list">
              {groups.map(g => (
                <React.Fragment key={g.title}>
                  <li className="kairo-svn-dlg-file-group">{g.title}</li>
                  {g.files.map(f => (
                    <li
                      key={f.path}
                      role="option"
                      aria-selected={s.activePath === f.path}
                      tabIndex={0}
                      className={`kairo-svn-dlg-file-item ${s.activePath === f.path ? 'active' : ''}`}
                      onClick={() => void this.loadDiff(f.path)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void this.loadDiff(f.path); } }}
                    >
                      <input
                        type="checkbox"
                        aria-label={f.path}
                        checked={s.selected.has(f.path)}
                        onChange={e => { e.stopPropagation(); this.toggle(f.path); }}
                        onClick={e => e.stopPropagation()}
                      />
                      <span className={`kairo-svn-dlg-badge ${statusLetter(f.status)}`} title={getStatusLabel(f.status)}>
                        {statusLetter(f.status)}
                      </span>
                      <span className="kairo-svn-dlg-file-name" title={f.path}>{f.path}</span>
                    </li>
                  ))}
                </React.Fragment>
              ))}
              {s.files.length === 0 && (
                <li className="kairo-svn-dlg-diff-empty">
                  <span className="codicon codicon-check" />
                  <span>{t('widget.svn.dialog.commit.treeClean')}</span>
                </li>
              )}
            </ul>
          </div>
          <div className="kairo-svn-dlg-pane diff">
            <div className="kairo-svn-dlg-pane-header">
              {t('widget.svn.dialog.commit.diffPreview')}
              {s.activePath && <span className="count">{s.activePath}</span>}
            </div>
            {s.loadingDiff ? (
              <div className="kairo-svn-dlg-diff-empty">
                <span className="codicon codicon-loading codicon-modifier-spin" />
                <span>{t('widget.svn.dialog.commit.loadingDiff')}</span>
              </div>
            ) : s.diffLines.length === 0 ? (
              <div className="kairo-svn-dlg-diff-empty">
                <span className="codicon codicon-diff" />
                <span>{t('widget.svn.dialog.commit.selectFile')}</span>
              </div>
            ) : (
              <pre className="kairo-svn-dlg-diff">
                {s.diffLines.map((line, i) => (
                  <span key={i} className={`kairo-svn-dlg-diff-line ${line.kind}`}>{line.text || ' '}</span>
                ))}
              </pre>
            )}
          </div>
        </div>

        <div className="kairo-svn-dlg-bottom">
          {s.error && <div className="kairo-svn-dlg-error" role="alert">{s.error}</div>}
          <div className="kairo-svn-dlg-message-row">
            <div>
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.commit.message')}</label>
              <textarea
                className="kairo-svn-dlg-message"
                placeholder={t('widget.svn.dialog.commit.messagePlaceholder')}
                value={s.message}
                disabled={s.committing}
                onChange={e => this.setState({ message: e.target.value, error: undefined })}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !s.committing) {
                    void this.doCommit();
                  }
                }}
                autoFocus
              />
              <div className="kairo-svn-dlg-meta">
                <span>{t('widget.svn.dialog.commit.fileCount', { count: s.selected.size })}</span>
                <span className={subjectLen > 72 ? 'chars warn' : 'chars'}>
                  {t('widget.svn.dialog.commit.subjectMeta', { subject: subjectLen, chars: charCount })}
                </span>
                <span>{t('widget.svn.dialog.commit.ctrlEnter')}</span>
              </div>
            </div>
            <div>
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.commit.beforeCommit')}</label>
              <div className="kairo-svn-dlg-options">
                <label className="kairo-svn-dlg-check">
                  <input
                    type="checkbox"
                    checked={s.keepLocks}
                    onChange={e => this.setState({ keepLocks: e.target.checked })}
                  />
                  {t('widget.svn.dialog.commit.keepLocks')}
                </label>
                <p className="kairo-svn-dlg-hint">
                  {t('widget.svn.dialog.commit.hint')}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="kairo-svn-dlg-footer">
          <button className="theia-button secondary" disabled={s.committing} onClick={() => this.close()}>
            {t('widget.svn.dialog.cancel')}
          </button>
          <span className="spacer" />
          <button
            className="theia-button main"
            disabled={s.committing || s.selected.size === 0 || !s.message.trim()}
            onClick={() => void this.doCommit()}
          >
            {s.committing
              ? t('widget.svn.dialog.commit.committing')
              : t('widget.svn.dialog.commit.commitN', { count: s.selected.size })}
          </button>
        </div>
      </div>
    );
  }
}
