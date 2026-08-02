// SPDX-License-Identifier: Apache-2.0
import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { KairoI18nService } from '@kairo/i18n';
import { SvnStore } from './svn-store';
import { SvnService } from './svn-service';
import './svn-dialogs.css';

export class SvnInfoDialog extends ReactDialog<void> {
  protected readonly svnStore: SvnStore;
  protected readonly svnService: SvnService;
  protected readonly clipboard: ClipboardService;
  protected readonly messages: MessageService;
  protected readonly i18n: KairoI18nService;

  constructor(props: {
    svnStore: SvnStore;
    svnService: SvnService;
    clipboardService: ClipboardService;
    messageService: MessageService;
    i18n: KairoI18nService;
  }) {
    super({ title: props.i18n.t('widget.svn.dialog.info.title'), maxWidth: 560 } as DialogProps);
    this.svnStore = props.svnStore;
    this.svnService = props.svnService;
    this.clipboard = props.clipboardService;
    this.messages = props.messageService;
    this.i18n = props.i18n;
    this.addClass('kairo-svn-dlg');
    this.id = 'kairo-svn-info-dialog';
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
  }

  get value(): undefined { return undefined; }

  protected render(): React.ReactNode {
    const t = this.i18n.t.bind(this.i18n);
    const info = this.svnStore.getState().wcInfo;
    const install = this.svnService.getSvnInstallation();
    const root = this.svnService.getActiveWcRoot() || '';
    const rows = info ? [
      { label: t('widget.svn.dialog.info.url'), value: info.url },
      { label: t('widget.svn.dialog.info.root'), value: info.reposRootUrl },
      { label: t('widget.svn.dialog.info.revision'), value: `r${info.revision}` },
      { label: t('widget.svn.dialog.info.lastChanged'), value: `r${info.lastChangedRev} by ${info.lastChangedAuthor}` },
      { label: t('widget.svn.dialog.info.lastDate'), value: String(info.lastChangedDate) },
      { label: t('widget.svn.dialog.info.uuid'), value: info.reposUuid },
      { label: t('widget.svn.dialog.info.wcPath'), value: root || info.wcRoot },
      { label: t('widget.svn.dialog.info.depth'), value: info.depth || 'infinity' },
      { label: t('widget.svn.dialog.info.svnClient'), value: install ? `${install.version} (${install.path})` : t('widget.svn.dialog.info.notDetected') },
    ] : [
      { label: t('widget.svn.dialog.info.status'), value: t('widget.svn.dialog.info.noInfo') },
    ];

    return (
      <div className="kairo-svn-dlg-shell compact" style={{ minHeight: 320 }}>
        <div className="kairo-svn-dlg-form">
          <div className="kairo-svn-dlg-preview">
            <div className="kairo-svn-dlg-preview-title">{t('widget.svn.dialog.info.section')}</div>
            {rows.map(r => (
              <div key={r.label} className="kairo-svn-dlg-preview-row">
                <span className="lbl">{r.label}</span>
                <span className="val" title={r.value}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="kairo-svn-dlg-footer">
          <button
            className="theia-button secondary"
            disabled={!info?.url}
            onClick={() => {
              if (info?.url) {
                void this.clipboard.writeText(info.url);
                this.messages.info(t('widget.svn.dialog.urlCopied'));
              }
            }}
          >
            {t('widget.svn.dialog.copyUrl')}
          </button>
          <span className="spacer" />
          <button className="theia-button main" onClick={() => this.close()}>{t('widget.svn.dialog.close')}</button>
        </div>
      </div>
    );
  }
}
