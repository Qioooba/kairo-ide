/**
 * Kairo Extensions Widget — React-based view for managing installed VS Code extensions.
 *
 * Phase 3 improvements:
 *   - Split layout: extension list + detail panel
 *   - Compatibility report integration
 *   - Keyboard navigation
 *   - Rich detail view with compatibility scores
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common';
import { KairoI18nService } from '@kairo/i18n';
import { KairoExtensionService, KairoExtension, CompatibilityReport } from '../common/kairo-extension-protocol';

interface ExtensionsWidgetState {
  extensions: KairoExtension[];
  loading: boolean;
  error: string | null;
  extensionsDir: string;
  selectedExtension: KairoExtension | null;
  compatibilityReport: CompatibilityReport | null;
  reportLoading: boolean;
  filter: 'all' | 'enabled' | 'disabled' | 'verified' | 'unverified';
  searchQuery: string;
}

@injectable()
export class KairoExtensionsWidget extends ReactWidget {
  @inject(KairoExtensionService)
  private readonly extensionService!: KairoExtensionService;

  @inject(MessageService)
  private readonly messageService!: MessageService;

  @inject(KairoI18nService)
  private readonly i18n!: KairoI18nService;

  private state: ExtensionsWidgetState = {
    extensions: [],
    loading: true,
    error: null,
    extensionsDir: '',
    selectedExtension: null,
    compatibilityReport: null,
    reportLoading: false,
    filter: 'all',
    searchQuery: '',
  };

  @postConstruct()
  protected init(): void {
    this.id = 'kairo-extensions';
    this.title.label = this.i18n.t('widget.extensions.title');
    this.title.caption = this.i18n.t('widget.extensions.caption');
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-extensions';
    this.update();
    this.refresh();
  }

  private async refresh(): Promise<void> {
    this.state.loading = true;
    this.state.error = null;
    this.update();
    try {
      const [extensions, extensionsDir] = await Promise.all([
        this.extensionService.getInstalledExtensions(),
        this.extensionService.getExtensionsDir(),
      ]);
      this.state.extensions = extensions;
      this.state.extensionsDir = extensionsDir;
      this.state.loading = false;
    } catch (e: any) {
      this.state.error = e.message || this.i18n.t('widget.extensions.error');
      this.state.loading = false;
    }
    this.update();
  }

  private filteredExtensions(): KairoExtension[] {
    let list = this.state.extensions;

    switch (this.state.filter) {
      case 'enabled': list = list.filter(e => e.enabled); break;
      case 'disabled': list = list.filter(e => !e.enabled); break;
      case 'verified': list = list.filter(e => e.verified); break;
      case 'unverified': list = list.filter(e => !e.verified); break;
    }

    if (this.state.searchQuery) {
      const q = this.state.searchQuery.toLowerCase();
      list = list.filter(e =>
        e.displayName.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    }

    return list;
  }

  render(): React.ReactNode {
    const filtered = this.filteredExtensions();
    const hasSelection = this.state.selectedExtension !== null;

    return (
      <div className="kairo-extensions-container">
        {/* Header */}
        <div className="kairo-extensions-header">
          <div className="kairo-extensions-header-row">
            <h3 className="kairo-extensions-header-title">{this.i18n.t('widget.extensions.header')}</h3>
            <div className="kairo-extensions-actions">
              <button className="theia-button secondary" title={this.i18n.t('widget.extensions.installFromVsix')}
                onClick={() => this.handleInstallFromVsix()}>
                {this.i18n.t('widget.extensions.installFromVsix')}
              </button>
              <button className="theia-button secondary" title={this.i18n.t('widget.extensions.reloadWindow')}
                onClick={() => this.handleReload()}>
                {this.i18n.t('widget.extensions.reload')}
              </button>
            </div>
          </div>
          <div className="kairo-extensions-filter-row">
            <input type="text" placeholder={this.i18n.t('widget.extensions.filterPlaceholder')} value={this.state.searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { this.state.searchQuery = e.target.value; this.update(); }} />
            <select value={this.state.filter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { this.state.filter = e.target.value as ExtensionsWidgetState['filter']; this.update(); }}>
              <option value="all">{this.i18n.t('widget.extensions.filterAll')}</option>
              <option value="enabled">{this.i18n.t('widget.extensions.filterEnabled')}</option>
              <option value="disabled">{this.i18n.t('widget.extensions.filterDisabled')}</option>
              <option value="verified">{this.i18n.t('widget.extensions.filterVerified')}</option>
              <option value="unverified">{this.i18n.t('widget.extensions.filterUnverified')}</option>
            </select>
          </div>
        </div>

        {/* Content: Split layout */}
        <div className="kairo-extensions-content">
          {/* Extension List (left panel) */}
          <div className={`kairo-extensions-list ${hasSelection ? 'kairo-extensions-list-with-detail' : 'kairo-extensions-list-full'}`}>
            {this.state.loading && (
              <div className="kairo-extensions-loading">
                {this.i18n.t('widget.extensions.loading')}
              </div>
            )}
            {this.state.error && (
              <div className="kairo-extensions-error">
                {this.state.error}
              </div>
            )}
            {!this.state.loading && !this.state.error && filtered.length === 0 && (
              this.state.extensions.length === 0 ? (
                <div className="kairo-empty-state">
                  <span className="kairo-empty-state-glyph codicon codicon-extensions" aria-hidden="true" />
                  <h3 className="kairo-empty-state-title">{this.i18n.t('widget.extensions.emptyNoInstalled')}</h3>
                  <p className="kairo-empty-state-reason">{this.i18n.t('widget.extensions.emptyInstallPrompt')}</p>
                  <div className="kairo-empty-state-action">
                    <button className="theia-button main" onClick={() => this.handleInstallFromVsix()}>
                      {this.i18n.t('widget.extensions.installFromVsix')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="kairo-empty">{this.i18n.t('widget.extensions.emptyNoMatch')}</p>
              )
            )}
            {!this.state.loading && filtered.map(ext => (
              <ExtensionCard key={ext.id} extension={ext}
                selected={this.state.selectedExtension?.id === ext.id}
                onEnable={() => this.handleEnable(ext)}
                onDisable={() => this.handleDisable(ext)}
                onUninstall={() => this.handleUninstall(ext)}
                onSelect={() => this.handleSelect(ext)}
                i18n={this.i18n} />
            ))}
          </div>

          {/* Detail Panel (right panel) */}
          {hasSelection && this.state.selectedExtension && (
            <ExtensionDetail
              extension={this.state.selectedExtension}
              report={this.state.compatibilityReport}
              reportLoading={this.state.reportLoading}
              onEnable={() => this.handleEnable(this.state.selectedExtension!)}
              onDisable={() => this.handleDisable(this.state.selectedExtension!)}
              onUninstall={() => this.handleUninstall(this.state.selectedExtension!)}
              onClose={() => { this.state.selectedExtension = null; this.state.compatibilityReport = null; this.update(); }}
              i18n={this.i18n}
            />
          )}
        </div>

        {/* Footer */}
        <div className="kairo-extensions-footer">
          <span>{this.i18n.t('widget.extensions.installedCount', { count: this.state.extensions.length })}</span>
          <span title={this.state.extensionsDir} className="kairo-extensions-footer-path">
            {this.state.extensionsDir}
          </span>
        </div>
      </div>
    );
  }

  private async handleSelect(ext: KairoExtension): Promise<void> {
    if (this.state.selectedExtension?.id === ext.id) {
      this.state.selectedExtension = null;
      this.state.compatibilityReport = null;
    } else {
      this.state.selectedExtension = ext;
      this.state.compatibilityReport = null;
      this.state.reportLoading = true;
      this.update();
      try {
        const report = await this.extensionService.getCompatibilityReport(ext.id);
        this.state.compatibilityReport = report;
      } catch {
        // Report not available
      }
      this.state.reportLoading = false;
    }
    this.update();
  }

  private async handleInstallFromVsix(): Promise<void> {
    const path = prompt(this.i18n.t('widget.extensions.toast.installPrompt'));
    if (!path) return;
    try {
      const result = await this.extensionService.installFromVsix(path);
      if (result.success) {
        this.messageService.info(this.i18n.t('widget.extensions.toast.installed', { name: result.extension.displayName }));
        await this.refresh();
      } else {
        this.messageService.error(result.error);
      }
    } catch (e: any) {
      this.messageService.error(this.i18n.t('widget.extensions.toast.installFailed', { message: e.message }));
    }
  }

  private async handleEnable(ext: KairoExtension): Promise<void> {
    try {
      await this.extensionService.enableExtension(ext.id);
      this.messageService.info(this.i18n.t('widget.extensions.toast.enabled', { name: ext.displayName }));
      await this.refresh();
    } catch (e: any) {
      this.messageService.error(this.i18n.t('widget.extensions.toast.actionFailed', { message: e.message }));
    }
  }

  private async handleDisable(ext: KairoExtension): Promise<void> {
    try {
      await this.extensionService.disableExtension(ext.id);
      this.messageService.info(this.i18n.t('widget.extensions.toast.disabled', { name: ext.displayName }));
      await this.refresh();
    } catch (e: any) {
      this.messageService.error(this.i18n.t('widget.extensions.toast.actionFailed', { message: e.message }));
    }
  }

  private async handleUninstall(ext: KairoExtension): Promise<void> {
    if (!confirm(this.i18n.t('widget.extensions.toast.uninstallConfirm', { name: ext.displayName }))) return;
    try {
      await this.extensionService.uninstallExtension(ext.id);
      if (this.state.selectedExtension?.id === ext.id) {
        this.state.selectedExtension = null;
        this.state.compatibilityReport = null;
      }
      this.messageService.info(this.i18n.t('widget.extensions.toast.uninstalled', { name: ext.displayName }));
      await this.refresh();
    } catch (e: any) {
      this.messageService.error(this.i18n.t('widget.extensions.toast.actionFailed', { message: e.message }));
    }
  }

  private handleReload(): void {
    this.messageService.info(this.i18n.t('widget.extensions.toast.reloading'));
    setTimeout(() => window.location.reload(), 500);
  }
}

// ── Extension Card Component ──────────────────────────────────────

interface ExtensionCardProps {
  extension: KairoExtension;
  selected: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onUninstall: () => void;
  onSelect: () => void;
  i18n: KairoI18nService;
}

function ExtensionCard(props: ExtensionCardProps): React.ReactElement {
  const { extension, selected, i18n } = props;

  return (
    <div className={`kairo-extension-card ${selected ? 'kairo-extension-card-selected' : ''}`} onClick={props.onSelect}>
      <div className="kairo-extension-card-content">
        <div className={`kairo-extension-icon ${extension.enabled ? '' : 'kairo-extension-icon-disabled'}`}>
          {extension.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="kairo-extension-card-main">
          <div className="kairo-extension-card-title-row">
            <span className="kairo-extension-card-name">
              {extension.displayName}
            </span>
            <span className="kairo-extension-card-version">
              {extension.version}
            </span>
            {!extension.enabled && (
              <span className="kairo-badge kairo-badge-default">
                {i18n.t('widget.extensions.badge.disabled')}
              </span>
            )}
            {!extension.verified && (
              <span className="kairo-badge kairo-badge-warning">
                {i18n.t('widget.extensions.badge.unverified')}
              </span>
            )}
          </div>
          <div className="kairo-extension-card-meta">
            {extension.id}
          </div>
          <div className="kairo-extension-card-meta">
            {extension.description}
          </div>
          {extension.categories.length > 0 && (
            <div className="kairo-extension-card-title-row">
              {extension.categories.map((cat: string) => (
                <span key={cat} className="kairo-badge kairo-badge-default">
                  {cat}
                </span>
              ))}
            </div>
          )}
          <div className="kairo-extension-card-actions">
            {extension.enabled ? (
              <button className="theia-button secondary" onClick={e => { e.stopPropagation(); props.onDisable(); }}>
                {i18n.t('widget.extensions.action.disable')}
              </button>
            ) : (
              <button className="theia-button secondary" onClick={e => { e.stopPropagation(); props.onEnable(); }}>
                {i18n.t('widget.extensions.action.enable')}
              </button>
            )}
            <button className="theia-button secondary kairo-button-danger-text" onClick={e => { e.stopPropagation(); props.onUninstall(); }}>
              {i18n.t('widget.extensions.action.uninstall')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Extension Detail Panel ────────────────────────────────────────

interface ExtensionDetailProps {
  extension: KairoExtension;
  report: CompatibilityReport | null;
  reportLoading: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onUninstall: () => void;
  onClose: () => void;
  i18n: KairoI18nService;
}

function scoreClass(score: number): string {
  if (score >= 0.8) return 'kairo-extension-score-good';
  if (score >= 0.5) return 'kairo-extension-score-medium';
  return 'kairo-extension-score-poor';
}

function ExtensionDetail(props: ExtensionDetailProps): React.ReactElement {
  const { extension, report, reportLoading, i18n } = props;

  return (
    <div className="kairo-extension-detail">
      {/* Close button */}
      <div className="kairo-extension-detail-header">
        <button className="theia-button secondary" onClick={props.onClose}>
          {i18n.t('widget.extensions.detail.close')}
        </button>
      </div>

      {/* Header */}
      <div className="kairo-extension-detail-title">
        <div className={`kairo-extension-icon kairo-extension-icon-large ${extension.enabled ? '' : 'kairo-extension-icon-disabled'}`}>
          {extension.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="kairo-extension-detail-info">
          <h3>{extension.displayName}</h3>
          <p>{extension.id}</p>
          <p>{extension.description}</p>
          <div className="kairo-extension-detail-badges">
            <span>v{extension.version}</span>
            {extension.engineVersion && (
              <span>VS Code {extension.engineVersion}</span>
            )}
            {extension.enabled ? (
              <span className="kairo-badge kairo-badge-success">{i18n.t('widget.extensions.badge.enabled')}</span>
            ) : (
              <span className="kairo-badge kairo-badge-default">{i18n.t('widget.extensions.badge.disabled')}</span>
            )}
            {extension.allowlisted ? (
              <span className="kairo-badge kairo-badge-info">{i18n.t('widget.extensions.badge.verified')}</span>
            ) : (
              <span className="kairo-badge kairo-badge-warning">{i18n.t('widget.extensions.badge.unverified')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="kairo-extension-detail-actions">
        {extension.enabled ? (
          <button className="theia-button secondary" onClick={props.onDisable}>
            {i18n.t('widget.extensions.action.disable')}
          </button>
        ) : (
          <button className="theia-button secondary" onClick={props.onEnable}>
            {i18n.t('widget.extensions.action.enable')}
          </button>
        )}
        <button className="theia-button secondary kairo-button-danger-text" onClick={props.onUninstall}>
          {i18n.t('widget.extensions.action.uninstall')}
        </button>
      </div>

      {/* Compatibility Report */}
      <div className="kairo-extension-detail-section">
        <h4>{i18n.t('widget.extensions.detail.compatibility')}</h4>
        {reportLoading ? (
          <p className="kairo-extension-card-meta">{i18n.t('widget.extensions.detail.reportLoading')}</p>
        ) : report ? (
          <div>
            <div className="kairo-extension-score-row">
              <span>{i18n.t('widget.extensions.detail.score')}:</span>
              <div className="kairo-extension-score-bar">
                <div className={`kairo-extension-score-fill ${scoreClass(report.score)}`} style={{ '--kairo-extension-score': Math.round(report.score * 100) } as React.CSSProperties} />
              </div>
              <span className={scoreClass(report.score)}>
                {Math.round(report.score * 100)}%
              </span>
              <span className={`kairo-badge ${report.assessment === 'compatible' ? 'kairo-badge-success' :
                report.assessment === 'partial' ? 'kairo-badge-warning' : 'kairo-badge-error'}`}>
                {report.assessment.charAt(0).toUpperCase() + report.assessment.slice(1)}
              </span>
            </div>

            {report.conflicts.length > 0 && (
              <div className="kairo-extension-issue-list">
                <span className="kairo-extension-issue-label-error">{i18n.t('widget.extensions.detail.conflicts')}</span>
                {report.conflicts.map((c, i) => (
                  <div key={i} className="kairo-extension-issue-item">
                    <strong>{c.kairoFeature}:</strong> {c.recommendation}
                  </div>
                ))}
              </div>
            )}

            {report.engineIssues.length > 0 && (
              <div className="kairo-extension-issue-list">
                <span className="kairo-extension-issue-label-warning">{i18n.t('widget.extensions.detail.engine')}</span>
                {report.engineIssues.map((issue, i) => (
                  <div key={i} className="kairo-extension-card-meta">
                    {issue}
                  </div>
                ))}
              </div>
            )}

            {report.recommendations.length > 0 && (
              <div className="kairo-extension-issue-list">
                <span>{i18n.t('widget.extensions.detail.recommendations')}</span>
                {report.recommendations.map((rec, i) => (
                  <div key={i} className="kairo-extension-card-meta">
                    {rec}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="kairo-extension-card-meta">
            {i18n.t('widget.extensions.detail.reportUnavailable')}
          </p>
        )}
      </div>

      {/* Metadata */}
      <div className="kairo-extension-detail-section">
        <h4>{i18n.t('widget.extensions.detail.details')}</h4>
        <table className="kairo-extension-detail-table">
          <tbody>
            <DetailRow label={i18n.t('widget.extensions.detail.metadata.id')} value={extension.id} />
            <DetailRow label={i18n.t('widget.extensions.detail.metadata.publisher')} value={extension.publisher} />
            <DetailRow label={i18n.t('widget.extensions.detail.metadata.version')} value={extension.version} />
            <DetailRow label={i18n.t('widget.extensions.detail.metadata.installed')} value={new Date(extension.installedAt).toLocaleString()} />
            <DetailRow label={i18n.t('widget.extensions.detail.metadata.categories')} value={extension.categories.join(', ') || i18n.t('widget.extensions.detail.metadata.none')} />
            <DetailRow label={i18n.t('widget.extensions.detail.metadata.activation')} value={extension.activationEvents.join(', ')} />
            <DetailRow label={i18n.t('widget.extensions.detail.metadata.path')} value={extension.extensionPath} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailRow(props: { label: string; value: string }): React.ReactElement {
  return (
    <tr>
      <td>{props.label}</td>
      <td>{props.value}</td>
    </tr>
  );
}
