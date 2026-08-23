// SPDX-License-Identifier: Apache-2.0
// Branch / Tag · Switch · Merge · Checkout · Import · Export dialogs
import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { MessageService } from '@theia/core/lib/common/message-service';
import { KairoI18nService } from '@kairo/i18n';
import { SvnService } from './svn-service';
import { SvnStore } from './svn-store';
import './svn-dialogs.css';

export interface SvnOpsDialogDeps {
  svnService: SvnService;
  svnStore: SvnStore;
  messageService: MessageService;
  i18n: KairoI18nService;
}

function joinUrl(base: string, ...parts: string[]): string {
  let out = base.replace(/\/+$/, '');
  for (const p of parts) {
    const seg = p.replace(/^\/+|\/+$/g, '');
    if (seg) out += '/' + seg;
  }
  return out;
}

function Segmented(props: {
  value: string;
  options: Array<{ id: string; label: string; icon?: string }>;
  onChange: (id: string) => void;
}): React.ReactNode {
  return (
    <div className="kairo-svn-dlg-segmented" role="tablist">
      {props.options.map(o => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={props.value === o.id}
          className={`kairo-svn-dlg-seg ${props.value === o.id ? 'active' : ''}`}
          onClick={() => props.onChange(o.id)}
        >
          {o.icon && <span className={`codicon ${o.icon}`} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PreviewCard(props: { title: string; lines: Array<{ label: string; value: string }> }): React.ReactNode {
  return (
    <div className="kairo-svn-dlg-preview">
      <div className="kairo-svn-dlg-preview-title">{props.title}</div>
      {props.lines.map(l => (
        <div key={l.label} className="kairo-svn-dlg-preview-row">
          <span className="lbl">{l.label}</span>
          <span className="val" title={l.value}>{l.value || '—'}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Branch / Tag ───────────────────────────────────────────────────────────

interface BranchState {
  kind: 'branches' | 'tags';
  name: string;
  message: string;
  sourceUrl: string;
  reposRoot: string;
  busy: boolean;
  error?: string;
  result?: 'ok';
}

export class SvnBranchTagDialog extends ReactDialog<'ok' | undefined> {
  protected readonly deps: SvnOpsDialogDeps;
  protected state: BranchState;

  constructor(deps: SvnOpsDialogDeps) {
    super({ title: deps.i18n.t('widget.svn.dialog.branchTag.title'), maxWidth: 640 } as DialogProps);
    this.deps = deps;
    this.addClass('kairo-svn-dlg');
    this.id = 'kairo-svn-branch-tag-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
    const info = deps.svnStore.getState().wcInfo;
    const kind: 'branches' | 'tags' = 'branches';
    const name = '';
    this.state = {
      kind,
      name,
      message: '',
      sourceUrl: info?.url || '',
      reposRoot: info?.reposRootUrl || '',
      busy: false,
    };
  }

  get value(): 'ok' | undefined { return this.state.result; }

  protected setState(patch: Partial<BranchState>): void {
    this.state = { ...this.state, ...patch };
    if (patch.kind !== undefined || patch.name !== undefined) {
      const kind = patch.kind ?? this.state.kind;
      const name = patch.name ?? this.state.name;
      if (!this.state.message || this.state.message.startsWith('Create ') || this.state.message.startsWith('创建')) {
        if (name) {
          const key = kind === 'tags' ? 'widget.svn.dialog.branchTag.defaultTagMessage' : 'widget.svn.dialog.branchTag.defaultBranchMessage';
          this.state.message = this.deps.i18n.t(key as any, { name } as any);
        } else {
          this.state.message = '';
        }
      }
    }
    this.update();
  }

  protected destUrl(): string {
    const s = this.state;
    if (!s.reposRoot || !s.name.trim()) return '';
    return joinUrl(s.reposRoot, s.kind, s.name.trim());
  }

  protected async submit(): Promise<void> {
    const dest = this.destUrl();
    if (!this.state.sourceUrl || !dest) {
      this.setState({ error: this.deps.i18n.t('widget.svn.dialog.branchTag.repositoryUrlAndNameRequired') });
      return;
    }
    if (!this.state.message.trim()) {
      this.setState({ error: this.deps.i18n.t('widget.svn.dialog.branchTag.commitMessageRequired') });
      return;
    }
    this.setState({ busy: true, error: undefined });
    try {
      const r = await this.deps.svnService.copy(this.state.sourceUrl, dest, {
        message: this.state.message.trim(),
        parents: true,
      });
      this.deps.messageService.info(this.deps.i18n.t('widget.svn.dialog.branchTag.created' as any, { dest, rev: r.revision } as any));
      this.state = { ...this.state, busy: false, result: 'ok' };
      this.accept();
    } catch (e) {
      this.setState({ busy: false, error: (e as Error).message || String(e) });
    }
  }

  protected render(): React.ReactNode {
    const s = this.state;
    const t = this.deps.i18n.t.bind(this.deps.i18n);
    const dest = this.destUrl();
    return (
      <div className="kairo-svn-dlg-shell compact">
        <div className="kairo-svn-dlg-form">
          <Segmented
            value={s.kind}
            onChange={id => this.setState({ kind: id as 'branches' | 'tags' })}
            options={[
              { id: 'branches', label: t('widget.svn.dialog.branchTag.branch'), icon: 'codicon-git-branch' },
              { id: 'tags', label: t('widget.svn.dialog.branchTag.tag'), icon: 'codicon-tag' },
            ]}
          />
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.branchTag.name')}</label>
            <input
              className="theia-input"
              autoFocus
              placeholder={t('widget.svn.dialog.branchTag.namePlaceholder')}
              value={s.name}
              onChange={e => this.setState({ name: e.target.value, error: undefined })}
              onKeyDown={e => { if (e.key === 'Enter' && !s.busy) void this.submit(); }}
            />
          </div>
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.branchTag.commitMessage')}</label>
            <textarea
              className="kairo-svn-dlg-message"
              style={{ minHeight: 64 }}
              value={s.message}
              onChange={e => this.setState({ message: e.target.value })}
            />
          </div>
          <PreviewCard
            title={t('widget.svn.dialog.branchTag.copyPreview')}
            lines={[
              { label: t('widget.svn.dialog.branchTag.from'), value: s.sourceUrl },
              { label: t('widget.svn.dialog.branchTag.to'), value: dest },
            ]}
          />
          {s.error && <div className="kairo-svn-dlg-error" role="alert">{s.error}</div>}
          <p className="kairo-svn-dlg-hint">
            {t('widget.svn.dialog.branchTag.hint')}
          </p>
        </div>
        <div className="kairo-svn-dlg-footer">
          <button className="theia-button secondary" disabled={s.busy} onClick={() => this.close()}>{t('widget.svn.dialog.cancel')}</button>
          <span className="spacer" />
          <button className="theia-button main" disabled={s.busy || !dest} onClick={() => void this.submit()}>
            {s.busy
              ? t('widget.svn.dialog.branchTag.creating')
              : s.kind === 'tags'
                ? t('widget.svn.dialog.branchTag.createTag')
                : t('widget.svn.dialog.branchTag.createBranch')}
          </button>
        </div>
      </div>
    );
  }
}

// ─── Switch ─────────────────────────────────────────────────────────────────

interface SwitchState {
  url: string;
  revision: string;
  force: boolean;
  suggestions: string[];
  busy: boolean;
  error?: string;
  result?: 'ok';
}

export class SvnSwitchDialog extends ReactDialog<'ok' | undefined> {
  protected readonly deps: SvnOpsDialogDeps;
  protected state: SwitchState;

  constructor(deps: SvnOpsDialogDeps) {
    super({ title: deps.i18n.t('widget.svn.dialog.switch.title'), maxWidth: 640 } as DialogProps);
    this.deps = deps;
    this.addClass('kairo-svn-dlg');
    this.id = 'kairo-svn-switch-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
    const info = deps.svnStore.getState().wcInfo;
    const root = info?.reposRootUrl || '';
    const suggestions = root
      ? [joinUrl(root, 'trunk'), joinUrl(root, 'branches'), joinUrl(root, 'tags')]
      : [];
    this.state = {
      url: info?.url || '',
      revision: '',
      force: false,
      suggestions,
      busy: false,
    };
  }

  get value(): 'ok' | undefined { return this.state.result; }

  protected setState(patch: Partial<SwitchState>): void {
    this.state = { ...this.state, ...patch };
    this.update();
  }

  protected async submit(): Promise<void> {
    if (!this.state.url.trim()) {
      this.setState({ error: this.deps.i18n.t('widget.svn.dialog.switch.targetUrlRequired') });
      return;
    }
    this.setState({ busy: true, error: undefined });
    try {
      const rev = this.state.revision.trim() ? parseInt(this.state.revision, 10) : undefined;
      await this.deps.svnService.switch(this.state.url.trim(), {
        revision: rev && !Number.isNaN(rev) ? rev : undefined,
        force: this.state.force,
      });
      await this.deps.svnStore.refresh();
      this.deps.messageService.info(this.deps.i18n.t('widget.svn.dialog.switch.switchedTo' as any, { url: this.state.url.trim() } as any));
      this.state = { ...this.state, busy: false, result: 'ok' };
      this.accept();
    } catch (e) {
      this.setState({ busy: false, error: (e as Error).message || String(e) });
    }
  }

  protected render(): React.ReactNode {
    const s = this.state;
    const t = this.deps.i18n.t.bind(this.deps.i18n);
    const current = this.deps.svnStore.getState().wcInfo?.url || '';
    return (
      <div className="kairo-svn-dlg-shell compact">
        <div className="kairo-svn-dlg-form">
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.switch.switchToUrl')}</label>
            <input
              className="theia-input"
              autoFocus
              value={s.url}
              onChange={e => this.setState({ url: e.target.value, error: undefined })}
              placeholder="file:///…/branches/feature-x"
            />
          </div>
          {s.suggestions.length > 0 && (
            <div className="kairo-svn-dlg-chips">
              {s.suggestions.map(u => (
                <button key={u} type="button" className="kairo-svn-dlg-chip" onClick={() => this.setState({ url: u })}>
                  {u.split('/').slice(-2).join('/')}
                </button>
              ))}
            </div>
          )}
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.switch.revision')}</label>
            <input
              className="theia-input"
              value={s.revision}
              placeholder="HEAD"
              onChange={e => this.setState({ revision: e.target.value })}
            />
          </div>
          <label className="kairo-svn-dlg-check">
            <input type="checkbox" checked={s.force} onChange={e => this.setState({ force: e.target.checked })} />
            {t('widget.svn.dialog.switch.force')}
          </label>
          <PreviewCard
            title={t('widget.svn.dialog.switch.preview')}
            lines={[
              { label: t('widget.svn.dialog.switch.current'), value: current },
              { label: t('widget.svn.dialog.switch.target'), value: s.url },
            ]}
          />
          {s.error && <div className="kairo-svn-dlg-error" role="alert">{s.error}</div>}
        </div>
        <div className="kairo-svn-dlg-footer">
          <button className="theia-button secondary" disabled={s.busy} onClick={() => this.close()}>{t('widget.svn.dialog.cancel')}</button>
          <span className="spacer" />
          <button className="theia-button main" disabled={s.busy || !s.url.trim()} onClick={() => void this.submit()}>
            {s.busy ? '…' : t('widget.svn.dialog.switch.action')}
          </button>
        </div>
      </div>
    );
  }
}

// ─── Merge ──────────────────────────────────────────────────────────────────

interface MergeState {
  sourceUrl: string;
  revisionRange: string;
  mode: 'merge' | 'dry' | 'record';
  force: boolean;
  busy: boolean;
  error?: string;
  summary?: string;
  result?: 'ok';
}

export class SvnMergeDialog extends ReactDialog<'ok' | undefined> {
  protected readonly deps: SvnOpsDialogDeps;
  protected state: MergeState;

  constructor(deps: SvnOpsDialogDeps) {
    super({ title: deps.i18n.t('widget.svn.dialog.merge.title'), maxWidth: 680 } as DialogProps);
    this.deps = deps;
    this.addClass('kairo-svn-dlg');
    this.id = 'kairo-svn-merge-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
    const root = deps.svnStore.getState().wcInfo?.reposRootUrl || '';
    this.state = {
      sourceUrl: root ? joinUrl(root, 'branches') + '/' : '',
      revisionRange: '',
      mode: 'merge',
      force: false,
      busy: false,
    };
  }

  get value(): 'ok' | undefined { return this.state.result; }

  protected setState(patch: Partial<MergeState>): void {
    this.state = { ...this.state, ...patch };
    this.update();
  }

  protected async submit(): Promise<void> {
    if (!this.state.sourceUrl.trim()) {
      this.setState({ error: this.deps.i18n.t('widget.svn.dialog.merge.sourceUrlRequired') });
      return;
    }
    this.setState({ busy: true, error: undefined, summary: undefined });
    try {
      await this.deps.svnService.merge(
        this.state.sourceUrl.trim(),
        this.state.revisionRange.trim() || undefined,
        {
          dryRun: this.state.mode === 'dry',
          recordOnly: this.state.mode === 'record',
          force: this.state.force,
        },
      );
      await this.deps.svnStore.refresh();
      const msg = this.state.mode === 'dry'
        ? this.deps.i18n.t('widget.svn.dialog.merge.dryRunCompleted')
        : this.state.mode === 'record'
          ? this.deps.i18n.t('widget.svn.dialog.merge.recordOnlyCompleted')
          : this.deps.i18n.t('widget.svn.dialog.merge.mergeApplied');
      this.deps.messageService.info(msg);
      if (this.state.mode === 'dry') {
        this.setState({ busy: false, summary: msg });
      } else {
        this.state = { ...this.state, busy: false, result: 'ok' };
        this.accept();
      }
    } catch (e) {
      this.setState({ busy: false, error: (e as Error).message || String(e) });
    }
  }

  protected render(): React.ReactNode {
    const s = this.state;
    const t = this.deps.i18n.t.bind(this.deps.i18n);
    const target = this.deps.svnStore.getState().wcInfo?.url || '';
    return (
      <div className="kairo-svn-dlg-shell compact">
        <div className="kairo-svn-dlg-form">
          <Segmented
            value={s.mode}
            onChange={id => this.setState({ mode: id as MergeState['mode'] })}
            options={[
              { id: 'merge', label: t('widget.svn.dialog.merge.merge'), icon: 'codicon-git-merge' },
              { id: 'dry', label: t('widget.svn.dialog.merge.dryRun'), icon: 'codicon-eye' },
              { id: 'record', label: t('widget.svn.dialog.merge.recordOnly'), icon: 'codicon-record' },
            ]}
          />
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.merge.sourceUrl')}</label>
            <input
              className="theia-input"
              autoFocus
              value={s.sourceUrl}
              onChange={e => this.setState({ sourceUrl: e.target.value, error: undefined })}
              placeholder="…/branches/feature-x"
            />
          </div>
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.merge.revisionRange')}</label>
            <input
              className="theia-input"
              value={s.revisionRange}
              placeholder={t('widget.svn.dialog.merge.revisionRangePlaceholder')}
              onChange={e => this.setState({ revisionRange: e.target.value })}
            />
          </div>
          <label className="kairo-svn-dlg-check">
            <input type="checkbox" checked={s.force} onChange={e => this.setState({ force: e.target.checked })} />
            {t('widget.svn.dialog.merge.force')}
          </label>
          <PreviewCard
            title={t('widget.svn.dialog.merge.mergeInto')}
            lines={[
              { label: t('widget.svn.dialog.merge.workingCopy'), value: target },
              { label: t('widget.svn.dialog.merge.source'), value: s.sourceUrl },
              { label: t('widget.svn.dialog.merge.range'), value: s.revisionRange || '(automatic)' },
            ]}
          />
          {s.summary && <div className="kairo-svn-dlg-success">{s.summary}</div>}
          {s.error && <div className="kairo-svn-dlg-error" role="alert">{s.error}</div>}
          <p className="kairo-svn-dlg-hint">
            {t('widget.svn.dialog.merge.hint')}
          </p>
        </div>
        <div className="kairo-svn-dlg-footer">
          <button className="theia-button secondary" disabled={s.busy} onClick={() => this.close()}>{t('widget.svn.dialog.cancel')}</button>
          <span className="spacer" />
          <button className="theia-button main" disabled={s.busy || !s.sourceUrl.trim()} onClick={() => void this.submit()}>
            {s.busy
              ? t('widget.svn.dialog.merge.running')
              : s.mode === 'dry'
                ? t('widget.svn.dialog.merge.dryRun')
                : s.mode === 'record'
                  ? t('widget.svn.dialog.merge.recordOnly')
                  : t('widget.svn.dialog.merge.merge')}
          </button>
        </div>
      </div>
    );
  }
}

// ─── Checkout ───────────────────────────────────────────────────────────────

interface CheckoutState {
  url: string;
  path: string;
  revision: string;
  username: string;
  password: string;
  busy: boolean;
  error?: string;
  result?: 'ok';
}

export class SvnCheckoutDialog extends ReactDialog<'ok' | undefined> {
  protected readonly deps: SvnOpsDialogDeps;
  protected state: CheckoutState;

  constructor(deps: SvnOpsDialogDeps, initialUrl = '') {
    super({ title: deps.i18n.t('widget.svn.dialog.checkout.title'), maxWidth: 640 } as DialogProps);
    this.deps = deps;
    this.addClass('kairo-svn-dlg');
    this.id = 'kairo-svn-checkout-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
    this.state = {
      url: initialUrl,
      path: '',
      revision: '',
      username: '',
      password: '',
      busy: false,
    };
  }

  get value(): 'ok' | undefined { return this.state.result; }

  protected setState(patch: Partial<CheckoutState>): void {
    this.state = { ...this.state, ...patch };
    this.update();
  }

  protected async submit(): Promise<void> {
    if (!this.state.url.trim() || !this.state.path.trim()) {
      this.setState({ error: this.deps.i18n.t('widget.svn.dialog.checkout.repositoryUrlAndLocalPathRequired') });
      return;
    }
    this.setState({ busy: true, error: undefined });
    try {
      const rev = this.state.revision.trim() ? parseInt(this.state.revision, 10) : undefined;
      await this.deps.svnService.checkout(this.state.url.trim(), this.state.path.trim(), {
        revision: rev && !Number.isNaN(rev) ? rev : undefined,
        username: this.state.username || undefined,
        password: this.state.password || undefined,
      });
      this.deps.svnService.setActiveWcRoot(this.state.path.trim());
      this.deps.messageService.info(this.deps.i18n.t('widget.svn.dialog.checkout.checkedOutTo' as any, { path: this.state.path.trim() } as any));
      this.state = { ...this.state, busy: false, result: 'ok' };
      this.accept();
    } catch (e) {
      this.setState({ busy: false, error: (e as Error).message || String(e) });
    }
  }

  protected render(): React.ReactNode {
    const s = this.state;
    const t = this.deps.i18n.t.bind(this.deps.i18n);
    return (
      <div className="kairo-svn-dlg-shell compact">
        <div className="kairo-svn-dlg-form">
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.checkout.repositoryUrl')}</label>
            <input
              className="theia-input"
              autoFocus
              value={s.url}
              placeholder="svn://host/repo/trunk  or  https://…  or  file:///…"
              onChange={e => this.setState({ url: e.target.value, error: undefined })}
            />
          </div>
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.checkout.localPath')}</label>
            <input
              className="theia-input"
              value={s.path}
              placeholder="G:\\work\\my-project"
              onChange={e => this.setState({ path: e.target.value, error: undefined })}
            />
          </div>
          <div className="kairo-svn-dlg-field-row">
            <div className="kairo-svn-dlg-field">
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.checkout.revision')}</label>
              <input className="theia-input" value={s.revision} placeholder="HEAD" onChange={e => this.setState({ revision: e.target.value })} />
            </div>
            <div className="kairo-svn-dlg-field">
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.checkout.username')}</label>
              <input className="theia-input" value={s.username} onChange={e => this.setState({ username: e.target.value })} />
            </div>
            <div className="kairo-svn-dlg-field">
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.checkout.password')}</label>
              <input className="theia-input" type="password" value={s.password} onChange={e => this.setState({ password: e.target.value })} />
            </div>
          </div>
          <PreviewCard
            title={t('widget.svn.dialog.checkout.preview')}
            lines={[
              { label: t('widget.svn.dialog.info.url'), value: s.url },
              { label: t('widget.svn.dialog.checkout.localPath'), value: s.path },
            ]}
          />
          {s.error && <div className="kairo-svn-dlg-error" role="alert">{s.error}</div>}
        </div>
        <div className="kairo-svn-dlg-footer">
          <button className="theia-button secondary" disabled={s.busy} onClick={() => this.close()}>{t('widget.svn.dialog.cancel')}</button>
          <span className="spacer" />
          <button className="theia-button main" disabled={s.busy || !s.url.trim() || !s.path.trim()} onClick={() => void this.submit()}>
            {s.busy ? '…' : t('widget.svn.dialog.checkout.preview')}
          </button>
        </div>
      </div>
    );
  }
}

// ─── Import / Export ────────────────────────────────────────────────────────

type IoMode = 'import' | 'export';

interface IoState {
  mode: IoMode;
  localPath: string;
  repoUrl: string;
  message: string;
  revision: string;
  force: boolean;
  busy: boolean;
  error?: string;
  result?: 'ok';
}

export class SvnImportExportDialog extends ReactDialog<'ok' | undefined> {
  protected readonly deps: SvnOpsDialogDeps;
  protected state: IoState;

  constructor(deps: SvnOpsDialogDeps, mode: IoMode = 'import') {
    super({
      title: deps.i18n.t(mode === 'import' ? 'widget.svn.dialog.importExport.importTitle' : 'widget.svn.dialog.importExport.exportTitle'),
      maxWidth: 640,
    } as DialogProps);
    this.deps = deps;
    this.addClass('kairo-svn-dlg');
    this.id = 'kairo-svn-io-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
    const info = deps.svnStore.getState().wcInfo;
    this.state = {
      mode,
      localPath: mode === 'export' ? '' : '',
      repoUrl: info?.url || info?.reposRootUrl || '',
      message: mode === 'import' ? deps.i18n.t('widget.svn.dialog.importExport.initialImportMessage') : '',
      revision: '',
      force: true,
      busy: false,
    };
  }

  get value(): 'ok' | undefined { return this.state.result; }

  protected setState(patch: Partial<IoState>): void {
    this.state = { ...this.state, ...patch };
    this.update();
  }

  protected async submit(): Promise<void> {
    const s = this.state;
    if (s.mode === 'import') {
      if (!s.localPath.trim() || !s.repoUrl.trim()) {
        this.setState({ error: this.deps.i18n.t('widget.svn.dialog.importExport.localPathAndRepositoryUrlRequired') });
        return;
      }
      this.setState({ busy: true, error: undefined });
      try {
        const fallbackImport = this.deps.i18n.t('widget.svn.dialog.importExport.import');
        const r = await this.deps.svnService.importFile(s.localPath.trim(), s.repoUrl.trim(), s.message || fallbackImport);
        this.deps.messageService.info(this.deps.i18n.t('widget.svn.dialog.importExport.importedAt' as any, { rev: r.revision } as any));
        this.state = { ...this.state, busy: false, result: 'ok' };
        this.accept();
      } catch (e) {
        this.setState({ busy: false, error: (e as Error).message || String(e) });
      }
    } else {
      if (!s.repoUrl.trim() || !s.localPath.trim()) {
        this.setState({ error: this.deps.i18n.t('widget.svn.dialog.importExport.sourceAndDestinationRequired') });
        return;
      }
      this.setState({ busy: true, error: undefined });
      try {
        const rev = s.revision.trim() ? parseInt(s.revision, 10) : undefined;
        await this.deps.svnService.export(s.repoUrl.trim(), s.localPath.trim(), {
          revision: rev && !Number.isNaN(rev) ? rev : undefined,
          force: s.force,
        });
        this.deps.messageService.info(this.deps.i18n.t('widget.svn.dialog.importExport.exportedTo' as any, { path: s.localPath.trim() } as any));
        this.state = { ...this.state, busy: false, result: 'ok' };
        this.accept();
      } catch (e) {
        this.setState({ busy: false, error: (e as Error).message || String(e) });
      }
    }
  }

  protected render(): React.ReactNode {
    const s = this.state;
    const t = this.deps.i18n.t.bind(this.deps.i18n);
    return (
      <div className="kairo-svn-dlg-shell compact">
        <div className="kairo-svn-dlg-form">
          <Segmented
            value={s.mode}
            onChange={id => this.setState({ mode: id as IoMode })}
            options={[
              { id: 'import', label: t('widget.svn.dialog.importExport.import'), icon: 'codicon-cloud-upload' },
              { id: 'export', label: t('widget.svn.dialog.importExport.export'), icon: 'codicon-cloud-download' },
            ]}
          />
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{s.mode === 'import' ? t('widget.svn.dialog.importExport.localFolder') : t('widget.svn.dialog.importExport.destinationFolder')}</label>
            <input className="theia-input" value={s.localPath} onChange={e => this.setState({ localPath: e.target.value, error: undefined })} />
          </div>
          <div className="kairo-svn-dlg-field">
            <label className="kairo-svn-dlg-label">{s.mode === 'import' ? t('widget.svn.dialog.importExport.targetRepositoryUrl') : t('widget.svn.dialog.importExport.sourceUrlOrWcPath')}</label>
            <input className="theia-input" value={s.repoUrl} onChange={e => this.setState({ repoUrl: e.target.value, error: undefined })} />
          </div>
          {s.mode === 'import' ? (
            <div className="kairo-svn-dlg-field">
              <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.importExport.commitMessage')}</label>
              <textarea className="kairo-svn-dlg-message" style={{ minHeight: 56 }} value={s.message} onChange={e => this.setState({ message: e.target.value })} />
            </div>
          ) : (
            <>
              <div className="kairo-svn-dlg-field">
                <label className="kairo-svn-dlg-label">{t('widget.svn.dialog.importExport.revision')}</label>
                <input className="theia-input" value={s.revision} placeholder="HEAD" onChange={e => this.setState({ revision: e.target.value })} />
              </div>
              <label className="kairo-svn-dlg-check">
                <input type="checkbox" checked={s.force} onChange={e => this.setState({ force: e.target.checked })} />
                {t('widget.svn.dialog.importExport.overwriteExisting')}
              </label>
            </>
          )}
          {s.error && <div className="kairo-svn-dlg-error" role="alert">{s.error}</div>}
        </div>
        <div className="kairo-svn-dlg-footer">
          <button className="theia-button secondary" disabled={s.busy} onClick={() => this.close()}>{t('widget.svn.dialog.cancel')}</button>
          <span className="spacer" />
          <button className="theia-button main" disabled={s.busy} onClick={() => void this.submit()}>
            {s.busy ? t('widget.svn.dialog.importExport.working') : s.mode === 'import' ? t('widget.svn.dialog.importExport.import') : t('widget.svn.dialog.importExport.export')}
          </button>
        </div>
      </div>
    );
  }
}
