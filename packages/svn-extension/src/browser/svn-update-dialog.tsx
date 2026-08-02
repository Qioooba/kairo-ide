// SPDX-License-Identifier: Apache-2.0
import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { MessageService } from '@theia/core/lib/common/message-service';
import { KairoI18nService } from '@kairo/i18n';
import { SvnService } from './svn-service';
import { SvnStore } from './svn-store';
import './svn-dialogs.css';

export interface SvnUpdateDialogProps {
  svnService: SvnService;
  svnStore: SvnStore;
  messageService: MessageService;
  i18n: KairoI18nService;
}

type UpdatePhase = 'options' | 'running' | 'done' | 'error';

interface UpdateState {
  phase: UpdatePhase;
  depth: 'infinity' | 'immediates' | 'files' | 'empty';
  accept: 'postpone' | 'mine-full' | 'theirs-full' | 'working';
  revision: string;
  resultRevision?: number;
  updatedFiles?: number;
  incomingPreview: Array<{ path: string; status: string }>;
  loadingIncoming: boolean;
  error?: string;
  result?: 'updated';
}

export class SvnUpdateDialog extends ReactDialog<'updated' | undefined> {
  protected readonly svnService: SvnService;
  protected readonly svnStore: SvnStore;
  protected readonly messageService: MessageService;
  protected readonly i18n: KairoI18nService;
  protected state: UpdateState;

  constructor(props: SvnUpdateDialogProps) {
    super({ title: props.i18n.t('widget.svn.dialog.update.title'), maxWidth: 640 } as DialogProps);
    this.svnService = props.svnService;
    this.svnStore = props.svnStore;
    this.messageService = props.messageService;
    this.i18n = props.i18n;
    this.addClass('kairo-svn-dlg');
    this.addClass('kairo-svn-update-dialog');
    this.id = 'kairo-svn-update-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
    this.state = {
      phase: 'options',
      depth: 'infinity',
      accept: 'postpone',
      revision: '',
      incomingPreview: [],
      loadingIncoming: true,
    };
  }

  get value(): 'updated' | undefined {
    return this.state.result;
  }

  protected setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.update();
  }

  protected override onAfterAttach(msg: import('@theia/core/shared/@lumino/messaging').Message): void {
    super.onAfterAttach(msg);
    void this.loadIncoming();
  }

  protected async loadIncoming(): Promise<void> {
    this.setState({ loadingIncoming: true });
    try {
      const incoming = await this.svnService.getIncomingStatus();
      this.setState({
        loadingIncoming: false,
        incomingPreview: incoming.map(e => ({
          path: e.path,
          status: e.reposStatus || 'modified',
        })),
      });
    } catch {
      this.setState({ loadingIncoming: false, incomingPreview: [] });
    }
  }

  protected async doUpdate(): Promise<void> {
    this.setState({ phase: 'running', error: undefined });
    try {
      const opts: {
        revision?: number;
        depth?: 'infinity' | 'immediates' | 'files' | 'empty';
        accept?: 'postpone' | 'working' | 'mine-full' | 'theirs-full';
      } = {
        depth: this.state.depth,
        accept: this.state.accept,
      };
      if (this.state.revision.trim()) {
        const n = parseInt(this.state.revision.trim(), 10);
        if (!Number.isNaN(n)) opts.revision = n;
      }
      const result = await this.svnService.update(undefined, opts);
      await this.svnStore.refresh();
      this.messageService.info(
        this.i18n.t('widget.svn.dialog.update.updatedTo', { rev: result.revision }),
      );
      this.setState({
        phase: 'done',
        resultRevision: result.revision,
        updatedFiles: result.updatedFiles,
        result: 'updated',
      });
    } catch (e) {
      this.setState({ phase: 'error', error: (e as Error).message || String(e) });
    }
  }

  protected render(): React.ReactNode {
    const s = this.state;
    const t = this.i18n.t.bind(this.i18n);
    return (
      <div className="kairo-svn-dlg-shell compact">
        {s.phase === 'options' && (
          <>
            <div className="kairo-svn-dlg-form">
              <div className="kairo-svn-dlg-field">
                <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.update.depth')}</label>
                <select
                  className="theia-select"
                  value={s.depth}
                  onChange={e => this.setState({ depth: e.target.value as UpdateState['depth'] })}
                >
                  <option value="infinity">{t('widget.svn.dialog.update.depthInfinity')}</option>
                  <option value="immediates">{t('widget.svn.dialog.update.depthImmediates')}</option>
                  <option value="files">{t('widget.svn.dialog.update.depthFiles')}</option>
                  <option value="empty">{t('widget.svn.dialog.update.depthEmpty')}</option>
                </select>
              </div>
              <div className="kairo-svn-dlg-field">
                <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.update.conflictStrategy')}</label>
                <select
                  className="theia-select"
                  value={s.accept}
                  onChange={e => this.setState({ accept: e.target.value as UpdateState['accept'] })}
                >
                  <option value="postpone">{t('widget.svn.dialog.update.postpone')}</option>
                  <option value="mine-full">{t('widget.svn.dialog.update.acceptMine')}</option>
                  <option value="theirs-full">{t('widget.svn.dialog.update.acceptTheirs')}</option>
                  <option value="working">{t('widget.svn.dialog.update.acceptWorking')}</option>
                </select>
              </div>
              <div className="kairo-svn-dlg-field">
                <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.update.revision')}</label>
                <input
                  className="theia-input"
                  type="text"
                  placeholder="HEAD"
                  value={s.revision}
                  onChange={e => this.setState({ revision: e.target.value })}
                />
                <span className="kairo-svn-dlg-hint">{t('widget.svn.dialog.update.revisionHint')}</span>
              </div>
              <div className="kairo-svn-dlg-field">
                <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.update.incoming')}</label>
                {s.loadingIncoming ? (
                  <span className="kairo-svn-dlg-hint">
                    <span className="codicon codicon-loading codicon-modifier-spin" /> {t('widget.svn.dialog.update.checkingServer')}
                  </span>
                ) : s.incomingPreview.length === 0 ? (
                  <span className="kairo-svn-dlg-hint">{t('widget.svn.dialog.update.noIncoming')}</span>
                ) : (
                  <ul className="kairo-svn-dlg-file-list" style={{ maxHeight: 160, border: '1px solid var(--theia-dropdown-border)', borderRadius: 6 }}>
                    {s.incomingPreview.map(f => (
                      <li key={f.path} className="kairo-svn-dlg-file-item">
                        <span className="kairo-svn-dlg-badge U">U</span>
                        <span className="kairo-svn-dlg-file-name">{f.path}</span>
                        <span className="kairo-svn-dlg-repo-meta">{f.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="kairo-svn-dlg-footer">
              <button className="theia-button secondary" onClick={() => this.close()}>{t('widget.svn.dialog.cancel')}</button>
              <span className="spacer" />
              <button className="theia-button main" onClick={() => void this.doUpdate()}>
                {t('widget.svn.dialog.update.updateProject')}
              </button>
            </div>
          </>
        )}

        {s.phase === 'running' && (
          <div className="kairo-svn-dlg-progress">
            <span className="codicon codicon-loading codicon-modifier-spin" />
            <div>{t('widget.svn.dialog.update.running')}</div>
            <span className="kairo-svn-dlg-hint">{t('widget.svn.dialog.update.runningHint')}</span>
          </div>
        )}

        {s.phase === 'done' && (
          <>
            <div className="kairo-svn-dlg-summary">
              <h3>
                <span className="codicon codicon-check" /> {t('widget.svn.dialog.update.updatedTo', { rev: s.resultRevision ?? 0 })}
              </h3>
              <p className="kairo-svn-dlg-hint">
                {t('widget.svn.dialog.update.doneHint', { count: s.updatedFiles ?? 0 })}
              </p>
            </div>
            <div className="kairo-svn-dlg-footer">
              <span className="spacer" />
              <button className="theia-button main" onClick={() => this.accept()}>{t('widget.svn.dialog.done')}</button>
            </div>
          </>
        )}

        {s.phase === 'error' && (
          <>
            <div className="kairo-svn-dlg-error" role="alert">{s.error}</div>
            <div className="kairo-svn-dlg-footer">
              <button className="theia-button secondary" onClick={() => this.setState({ phase: 'options', error: undefined })}>
                {t('widget.svn.dialog.cancel')}
              </button>
              <span className="spacer" />
              <button className="theia-button main" onClick={() => void this.doUpdate()}>
                {t('widget.svn.dialog.update.updateProject')}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }
}
