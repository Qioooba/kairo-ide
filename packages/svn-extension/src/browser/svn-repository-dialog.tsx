// SPDX-License-Identifier: Apache-2.0
import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { KairoI18nService } from '@kairo/i18n';
import { SvnService } from './svn-service';
import { RepoEntry } from './svn-types';
import './svn-dialogs.css';

export interface SvnRepositoryDialogProps {
  svnService: SvnService;
  messageService: MessageService;
  clipboardService: ClipboardService;
  i18n: KairoI18nService;
  initialUrl?: string;
}

type Panel = 'browse' | 'mkdir' | 'checkout';

interface RepoState {
  url: string;
  entries: RepoEntry[];
  selected?: RepoEntry;
  loading: boolean;
  error?: string;
  stack: string[];
  panel: Panel;
  mkdirName: string;
  mkdirMessage: string;
  checkoutPath: string;
  busy: boolean;
}

export class SvnRepositoryDialog extends ReactDialog<void> {
  protected readonly svnService: SvnService;
  protected readonly messageService: MessageService;
  protected readonly clipboardService: ClipboardService;
  protected readonly i18n: KairoI18nService;
  protected state: RepoState;

  constructor(props: SvnRepositoryDialogProps) {
    super({ title: props.i18n.t('widget.svn.dialog.browse.title'), maxWidth: 820 } as DialogProps);
    this.svnService = props.svnService;
    this.messageService = props.messageService;
    this.clipboardService = props.clipboardService;
    this.i18n = props.i18n;
    this.addClass('kairo-svn-dlg');
    this.addClass('kairo-svn-repository-dialog');
    this.id = 'kairo-svn-repository-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
    const url = props.initialUrl || '';
    this.state = {
      url,
      entries: [],
      loading: false,
      stack: url ? [url] : [],
      panel: 'browse',
      mkdirName: '',
      mkdirMessage: 'Create directory',
      checkoutPath: '',
      busy: false,
    };
  }

  get value(): undefined {
    return undefined;
  }

  protected setState(patch: Partial<RepoState>): void {
    this.state = { ...this.state, ...patch };
    this.update();
  }

  protected override onAfterAttach(msg: import('@theia/core/shared/@lumino/messaging').Message): void {
    super.onAfterAttach(msg);
    if (this.state.url) void this.load(this.state.url);
  }

  protected async load(url: string): Promise<void> {
    this.setState({ loading: true, error: undefined, url, selected: undefined, panel: 'browse' });
    try {
      const entries = await this.svnService.listRepository(url);
      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      this.setState({ loading: false, entries });
    } catch (e) {
      this.setState({ loading: false, entries: [], error: (e as Error).message || String(e) });
    }
  }

  protected joinUrl(base: string, name: string): string {
    return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
  }

  protected currentSelectionUrl(): string {
    const entry = this.state.selected;
    if (entry && entry.kind === 'dir') return this.joinUrl(this.state.url, entry.name);
    return this.state.url;
  }

  protected async openEntry(entry: RepoEntry): Promise<void> {
    if (entry.kind !== 'dir') {
      this.setState({ selected: entry });
      return;
    }
    const next = this.joinUrl(this.state.url, entry.name);
    this.setState({ stack: [...this.state.stack, next] });
    await this.load(next);
  }

  protected async goUp(): Promise<void> {
    if (this.state.stack.length <= 1) return;
    const stack = this.state.stack.slice(0, -1);
    const url = stack[stack.length - 1];
    this.setState({ stack });
    await this.load(url);
  }

  protected async doMkdir(): Promise<void> {
    const name = this.state.mkdirName.trim();
    if (!name) {
      this.setState({ error: 'Directory name is required.' });
      return;
    }
    this.setState({ busy: true, error: undefined });
    try {
      await this.svnService.mkdir(this.joinUrl(this.state.url, name), this.state.mkdirMessage || `Create ${name}`, true);
      this.messageService.info(`Created ${name}`);
      this.setState({ busy: false, mkdirName: '', panel: 'browse' });
      await this.load(this.state.url);
    } catch (e) {
      this.setState({ busy: false, error: (e as Error).message || String(e) });
    }
  }

  protected async doCheckout(): Promise<void> {
    const path = this.state.checkoutPath.trim();
    if (!path) {
      this.setState({ error: 'Local path is required.' });
      return;
    }
    const url = this.currentSelectionUrl();
    this.setState({ busy: true, error: undefined });
    try {
      await this.svnService.checkout(url, path);
      this.messageService.info(`Checked out ${url}`);
      this.svnService.setActiveWcRoot(path);
      this.state = { ...this.state, busy: false };
      this.close();
    } catch (e) {
      this.setState({ busy: false, error: (e as Error).message || String(e) });
    }
  }

  protected render(): React.ReactNode {
    const s = this.state;
    const t = this.i18n.t.bind(this.i18n);
    return (
      <div className="kairo-svn-dlg-shell" style={{ minHeight: 520, width: 'min(820px, 92vw)' }}>
        <div className="kairo-svn-dlg-repo-path">
          <button className="theia-button secondary" disabled={s.stack.length <= 1 || s.loading} onClick={() => void this.goUp()} title={t('widget.svn.dialog.browse.up')}>
            <span className="codicon codicon-arrow-up" />
          </button>
          <input
            value={s.url}
            onChange={e => this.setState({ url: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                this.setState({ stack: [s.url] });
                void this.load(s.url);
              }
            }}
            spellCheck={false}
            placeholder={t('widget.svn.dialog.browse.emptyUrlHint')}
          />
          <button className="theia-button secondary" disabled={s.loading || !s.url} onClick={() => {
            this.setState({ stack: [s.url] });
            void this.load(s.url);
          }}>
            <span className="codicon codicon-refresh" />
          </button>
        </div>

        {s.error && <div className="kairo-svn-dlg-error" role="alert">{s.error}</div>}

        {s.panel === 'mkdir' && (
          <div className="kairo-svn-dlg-form" style={{ flex: '0 0 auto' }}>
            <div className="kairo-svn-dlg-field">
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.browse.newFolder')}</label>
              <input className="theia-input" autoFocus value={s.mkdirName} onChange={e => this.setState({ mkdirName: e.target.value })} />
            </div>
            <div className="kairo-svn-dlg-field">
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.branchTag.commitMessage')}</label>
              <input className="theia-input" value={s.mkdirMessage} onChange={e => this.setState({ mkdirMessage: e.target.value })} />
            </div>
            <div className="kairo-svn-dlg-footer" style={{ padding: 0 }}>
              <button className="theia-button secondary" onClick={() => this.setState({ panel: 'browse', error: undefined })}>{t('widget.svn.dialog.cancel')}</button>
              <span className="spacer" />
              <button className="theia-button main" disabled={s.busy} onClick={() => void this.doMkdir()}>
                {s.busy ? t('widget.svn.dialog.branchTag.creating') : t('widget.svn.dialog.browse.newFolder')}
              </button>
            </div>
          </div>
        )}

        {s.panel === 'checkout' && (
          <div className="kairo-svn-dlg-form" style={{ flex: '0 0 auto' }}>
            <div className="kairo-svn-dlg-field">
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.checkout.repositoryUrl')}</label>
              <input className="theia-input" readOnly value={this.currentSelectionUrl()} />
            </div>
            <div className="kairo-svn-dlg-field">
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.browse.localPath')}</label>
              <input className="theia-input" autoFocus value={s.checkoutPath} onChange={e => this.setState({ checkoutPath: e.target.value })} placeholder="G:\\work\\project" />
            </div>
            <div className="kairo-svn-dlg-footer" style={{ padding: 0 }}>
              <button className="theia-button secondary" onClick={() => this.setState({ panel: 'browse', error: undefined })}>{t('widget.svn.dialog.cancel')}</button>
              <span className="spacer" />
              <button className="theia-button main" disabled={s.busy} onClick={() => void this.doCheckout()}>
                {s.busy ? '…' : t('widget.svn.dialog.browse.checkout')}
              </button>
            </div>
          </div>
        )}

        {s.panel === 'browse' && (s.loading ? (
          <div className="kairo-svn-dlg-progress">
            <span className="codicon codicon-loading codicon-modifier-spin" />
            <div>{t('widget.svn.dialog.update.checkingServer')}</div>
          </div>
        ) : (
          <ul className="kairo-svn-dlg-repo-list">
            {s.entries.map(e => (
              <li
                key={e.name}
                className={`kairo-svn-dlg-repo-item ${s.selected?.name === e.name ? 'selected' : ''}`}
                onClick={() => this.setState({ selected: e })}
                onDoubleClick={() => void this.openEntry(e)}
              >
                <span className={`codicon ${e.kind === 'dir' ? 'codicon-folder' : 'codicon-file'}`} />
                <span className="kairo-svn-dlg-file-name">{e.name}{e.kind === 'dir' ? '/' : ''}</span>
                <span className="kairo-svn-dlg-repo-meta">
                  {e.lastChangedRevision ? `r${e.lastChangedRevision}` : ''}
                  {e.lastChangedAuthor ? ` · ${e.lastChangedAuthor}` : ''}
                </span>
              </li>
            ))}
            {!s.url && s.entries.length === 0 && !s.error && (
              <li className="kairo-svn-dlg-diff-empty">
                <span className="codicon codicon-repo" />
                <span>{t('widget.svn.dialog.browse.emptyUrlHint')}</span>
              </li>
            )}
            {s.url && s.entries.length === 0 && !s.error && (
              <li className="kairo-svn-dlg-diff-empty">
                <span className="codicon codicon-folder-opened" />
                <span>—</span>
              </li>
            )}
          </ul>
        ))}

        {s.panel === 'browse' && (
          <div className="kairo-svn-dlg-footer">
            <button className="theia-button secondary" onClick={() => this.setState({ panel: 'mkdir', error: undefined })} disabled={!s.url}>
              {t('widget.svn.dialog.browse.newFolder')}
            </button>
            <button
              className="theia-button secondary"
              onClick={() => {
                void this.clipboardService.writeText(this.currentSelectionUrl());
                this.messageService.info(t('widget.svn.dialog.urlCopied'));
              }}
              disabled={!s.url}
            >
              {t('widget.svn.dialog.copyUrl')}
            </button>
            <span className="spacer" />
            <button className="theia-button secondary" onClick={() => this.close()}>{t('widget.svn.dialog.close')}</button>
            <button className="theia-button main" onClick={() => this.setState({ panel: 'checkout', error: undefined })} disabled={!s.url}>
              {t('widget.svn.dialog.browse.checkout')}
            </button>
          </div>
        )}
      </div>
    );
  }
}
