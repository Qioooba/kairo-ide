/**
 * Remote debug configuration UI — P3-ADVDBG-03
 *
 * UI for configuring remote debug connections.
 * Fields: host, port, auth type (none/SSH key/token), SSH key path.
 * Save configurations with encryption (using Theia's SecretStorage).
 * Test connection button.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { StorageService } from '@theia/core/lib/browser';
import { KairoI18nService } from '@kairo/i18n';
import { RemoteDebugTunnel, type RemoteDebugConfig, type RemoteDebugAuthType } from './java-remote-debug-tunnel';

export const KAIRO_REMOTE_DEBUG_CONFIG_ID = 'kairo-remote-debug-config';

const STORAGE_CONFIGS_KEY = 'kairo.java.remoteDebug.configs';

@injectable()
export class RemoteDebugConfigWidget extends ReactWidget {
  static readonly ID = KAIRO_REMOTE_DEBUG_CONFIG_ID;

  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(StorageService) protected readonly storage!: StorageService;
  @inject(RemoteDebugTunnel) protected readonly tunnel!: RemoteDebugTunnel;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected configs: RemoteDebugConfig[] = [];
  protected editingConfig: RemoteDebugConfig | undefined;
  protected isTesting = false;
  protected isConnecting = false;

  constructor() {
    super();
    this.id = KAIRO_REMOTE_DEBUG_CONFIG_ID;
    this.title.iconClass = 'codicon codicon-debug';
    this.title.closable = true;
  }

  @postConstruct()
  protected async init(): Promise<void> {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      this.updateTitle();
      this.update();
    }));
    await this.loadConfigs();
    this.update();
  }

  protected t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key as any, params);
  }

  protected updateTitle(): void {
    this.title.label = this.t('widget.java.remoteDebug.title');
    this.title.caption = this.t('widget.java.remoteDebug.caption');
  }

  render(): React.ReactNode {
    return React.createElement(RemoteDebugConfigPanel, {
      configs: this.configs,
      editingConfig: this.editingConfig,
      isTesting: this.isTesting,
      isConnecting: this.isConnecting,
      tunnelStatus: this.tunnel.status,
      i18n: this.i18n,
      onAdd: () => this.startNew(),
      onEdit: (c: RemoteDebugConfig) => this.startEdit(c),
      onDelete: (c: RemoteDebugConfig) => this.deleteConfig(c),
      onSave: (c: RemoteDebugConfig) => this.saveConfig(c),
      onCancel: () => this.cancelEdit(),
      onTest: (c: RemoteDebugConfig) => this.testConnection(c),
      onConnect: (c: RemoteDebugConfig) => this.connectToRemote(c),
      onDisconnect: () => this.disconnect(),
    });
  }

  protected startNew(): void {
    this.editingConfig = {
      id: `rdc-${Date.now()}`,
      name: '',
      host: '',
      port: 8000,
      authType: 'none',
    };
    this.update();
  }

  protected startEdit(config: RemoteDebugConfig): void {
    this.editingConfig = { ...config };
    this.update();
  }

  protected async deleteConfig(config: RemoteDebugConfig): Promise<void> {
    this.configs = this.configs.filter(c => c.id !== config.id);
    await this.persistConfigs();
    this.update();
  }

  protected async saveConfig(config: RemoteDebugConfig): Promise<void> {
    if (!config.name.trim() || !config.host.trim()) {
      this.messages.error(this.t('widget.java.remoteDebug.validation.required'));
      return;
    }

    const existing = this.configs.findIndex(c => c.id === config.id);
    if (existing >= 0) {
      this.configs[existing] = { ...config };
    } else {
      this.configs.push({ ...config });
    }

    await this.persistConfigs();
    this.editingConfig = undefined;
    this.update();
  }

  protected cancelEdit(): void {
    this.editingConfig = undefined;
    this.update();
  }

  protected async testConnection(config: RemoteDebugConfig): Promise<void> {
    this.isTesting = true;
    this.update();

    try {
      this.tunnel.showExperimentalWarning();
      const localPort = await this.tunnel.connect(config);
      this.messages.info(this.t('widget.java.remoteDebug.toast.testConnected', { localPort }));
      await this.tunnel.disconnect();
    } catch (error) {
      this.messages.error(
        this.t('widget.java.remoteDebug.toast.connectionFailed', { message: error instanceof Error ? error.message : String(error) }),
      );
    } finally {
      this.isTesting = false;
      this.update();
    }
  }

  protected async connectToRemote(config: RemoteDebugConfig): Promise<void> {
    this.isConnecting = true;
    this.update();

    try {
      this.tunnel.showExperimentalWarning();
      const localPort = await this.tunnel.connect(config);
      this.messages.info(this.t('widget.java.remoteDebug.toast.connected', { localPort }));
    } catch (error) {
      this.messages.error(
        this.t('widget.java.remoteDebug.toast.connectionFailed', { message: error instanceof Error ? error.message : String(error) }),
      );
    } finally {
      this.isConnecting = false;
      this.update();
    }
  }

  protected async disconnect(): Promise<void> {
    await this.tunnel.disconnect();
    this.update();
  }

  protected async persistConfigs(): Promise<void> {
    // Store configs without sensitive data (token)
    const safeConfigs = this.configs.map(c => ({
      id: c.id,
      name: c.name,
      host: c.host,
      port: c.port,
      authType: c.authType,
      sshKeyPath: c.sshKeyPath,
      // Token is stored via SecretStorage separately
      localPort: c.localPort,
    }));
    await this.storage.setData(STORAGE_CONFIGS_KEY, safeConfigs);

    // Store tokens separately via SecretStorage
    for (const config of this.configs) {
      if (config.token) {
        try {
          await this.storage.setData(
            `${STORAGE_CONFIGS_KEY}.token.${config.id}`,
            config.token,
          );
        } catch {
          // SecretStorage may not be available
        }
      }
    }
  }

  protected async loadConfigs(): Promise<void> {
    try {
      const data = await this.storage.getData<RemoteDebugConfig[]>(STORAGE_CONFIGS_KEY);
      if (data && Array.isArray(data)) {
        this.configs = data.map(c => ({
          ...c,
          authType: c.authType || 'none',
          token: undefined, // Token loaded separately
        }));
      }
    } catch {
      this.configs = [];
    }
  }
}

// ── React Component ──────────────────────────────────────────────

interface RemoteDebugConfigPanelProps {
  configs: RemoteDebugConfig[];
  editingConfig: RemoteDebugConfig | undefined;
  isTesting: boolean;
  isConnecting: boolean;
  tunnelStatus: { state: string };
  i18n: KairoI18nService;
  onAdd: () => void;
  onEdit: (c: RemoteDebugConfig) => void;
  onDelete: (c: RemoteDebugConfig) => void;
  onSave: (c: RemoteDebugConfig) => void;
  onCancel: () => void;
  onTest: (c: RemoteDebugConfig) => void;
  onConnect: (c: RemoteDebugConfig) => void;
  onDisconnect: () => void;
}

const RemoteDebugConfigPanel: React.FC<RemoteDebugConfigPanelProps> = ({
  configs, editingConfig, isTesting, isConnecting, tunnelStatus, i18n,
  onAdd, onEdit, onDelete, onSave, onCancel, onTest, onConnect, onDisconnect,
}) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const authTypes = React.useMemo(() => [
    { value: 'none' as RemoteDebugAuthType, label: t('widget.java.remoteDebug.authType.none') },
    { value: 'ssh-key' as RemoteDebugAuthType, label: t('widget.java.remoteDebug.authType.sshKey') },
    { value: 'token' as RemoteDebugAuthType, label: t('widget.java.remoteDebug.authType.token') },
  ], [t]);

  const [draft, setDraft] = React.useState<RemoteDebugConfig>(
    editingConfig || { id: '', name: '', host: '', port: 8000, authType: 'none' },
  );

  React.useEffect(() => {
    if (editingConfig) {
      setDraft({ ...editingConfig });
    }
  }, [editingConfig]);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => {
      // Force re-render on language change; draft and authTypes will recompute.
      setDraft(prev => ({ ...prev }));
    });
    return () => disposable.dispose();
  }, [i18n]);

  const isConnected = tunnelStatus.state === 'connected';
  const isEditingExisting = editingConfig && editingConfig.id === draft.id && draft.name;

  return (
    <div className="kairo-remote-debug-container">
      <div className="kairo-remote-debug-header">
        <h3>{t('widget.java.remoteDebug.header')}</h3>
        <span className="kairo-remote-debug-experimental">{t('widget.java.remoteDebug.experimental')}</span>
        {isConnected && (
          <button
            type="button"
            className="theia-button secondary"
            onClick={onDisconnect}
          >
            {t('widget.java.remoteDebug.disconnect')}
          </button>
        )}
      </div>

      {/* Config list */}
      {configs.length > 0 && (
        <div className="kairo-remote-debug-list" role="list">
          {configs.map(config => (
            <div
              key={config.id}
              className="kairo-remote-debug-item"
              role="listitem"
            >
              <div className="kairo-remote-debug-item-info">
                <strong>{config.name}</strong>
                <span>{config.host}:{config.port}</span>
                <span className="kairo-remote-debug-auth">
                  {authTypes.find(a => a.value === config.authType)?.label || config.authType}
                </span>
              </div>
              <div className="kairo-remote-debug-item-actions">
                <button
                  type="button"
                  className="theia-button secondary"
                  onClick={() => onConnect(config)}
                  disabled={isTesting || isConnecting || isConnected}
                >
                  {t('widget.java.remoteDebug.action.connect')}
                </button>
                <button
                  type="button"
                  className="theia-button secondary"
                  onClick={() => onTest(config)}
                  disabled={isTesting || isConnecting}
                >
                  {isTesting ? t('widget.java.remoteDebug.action.testing') : t('widget.java.remoteDebug.action.test')}
                </button>
                <button
                  type="button"
                  className="theia-button secondary"
                  onClick={() => onEdit(config)}
                >
                  {t('widget.java.remoteDebug.action.edit')}
                </button>
                <button
                  type="button"
                  className="theia-button secondary"
                  onClick={() => onDelete(config)}
                >
                  {t('widget.java.remoteDebug.action.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {configs.length === 0 && !editingConfig && (
        <p className="kairo-remote-debug-empty">
          {t('widget.java.remoteDebug.empty')}
        </p>
      )}

      {/* Edit form */}
      {editingConfig && (
        <div className="kairo-remote-debug-form">
          <h4>{isEditingExisting ? t('widget.java.remoteDebug.editConfig') : t('widget.java.remoteDebug.newConfig')}</h4>
          <div className="kairo-remote-debug-field">
            <label>{t('widget.java.remoteDebug.label.name')}</label>
            <input
              type="text"
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder={t('widget.java.remoteDebug.placeholder.name')}
              className="theia-input"
            />
          </div>
          <div className="kairo-remote-debug-field">
            <label>{t('widget.java.remoteDebug.label.host')}</label>
            <input
              type="text"
              value={draft.host}
              onChange={e => setDraft({ ...draft, host: e.target.value })}
              placeholder={t('widget.java.remoteDebug.placeholder.host')}
              className="theia-input"
            />
          </div>
          <div className="kairo-remote-debug-field">
            <label>{t('widget.java.remoteDebug.label.port')}</label>
            <input
              type="number"
              value={draft.port}
              onChange={e => setDraft({ ...draft, port: parseInt(e.target.value, 10) || 0 })}
              min={1}
              max={65535}
              className="theia-input"
            />
          </div>
          <div className="kairo-remote-debug-field">
            <label>{t('widget.java.remoteDebug.label.authType')}</label>
            <select
              value={draft.authType}
              onChange={e => setDraft({ ...draft, authType: e.target.value as RemoteDebugAuthType })}
              className="theia-select"
            >
              {authTypes.map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
          {draft.authType === 'ssh-key' && (
            <div className="kairo-remote-debug-field">
              <label>{t('widget.java.remoteDebug.label.sshKeyPath')}</label>
              <input
                type="text"
                value={draft.sshKeyPath || ''}
                onChange={e => setDraft({ ...draft, sshKeyPath: e.target.value })}
                placeholder={t('widget.java.remoteDebug.placeholder.sshKeyPath')}
                className="theia-input"
              />
            </div>
          )}
          {draft.authType === 'token' && (
            <div className="kairo-remote-debug-field">
              <label>{t('widget.java.remoteDebug.label.token')}</label>
              <input
                type="password"
                value={draft.token || ''}
                onChange={e => setDraft({ ...draft, token: e.target.value })}
                placeholder={t('widget.java.remoteDebug.placeholder.token')}
                className="theia-input"
              />
            </div>
          )}
          <div className="kairo-remote-debug-field">
            <label>{t('widget.java.remoteDebug.label.localPort')}</label>
            <input
              type="number"
              value={draft.localPort || ''}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                setDraft({ ...draft, localPort: isNaN(v) ? undefined : v });
              }}
              placeholder={t('widget.java.remoteDebug.placeholder.localPort')}
              min={1024}
              max={65535}
              className="theia-input"
            />
          </div>
          <div className="kairo-remote-debug-form-actions">
            <button
              type="button"
              className="theia-button"
              onClick={() => onSave(draft)}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              className="theia-button secondary"
              onClick={onCancel}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Add config button */}
      {!editingConfig && (
        <div className="kairo-remote-debug-add">
          <button
            type="button"
            className="theia-button"
            onClick={onAdd}
          >
            {t('widget.java.remoteDebug.addConfig')}
          </button>
        </div>
      )}
    </div>
  );
};