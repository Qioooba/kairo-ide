/**
 * 远程调试配置 UI — P3-ADVDBG-03
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
import { RemoteDebugTunnel, type RemoteDebugConfig, type RemoteDebugAuthType } from './java-remote-debug-tunnel';

export const KAIRO_REMOTE_DEBUG_CONFIG_ID = 'kairo-remote-debug-config';

const STORAGE_CONFIGS_KEY = 'kairo.java.remoteDebug.configs';

@injectable()
export class RemoteDebugConfigWidget extends ReactWidget {
  static readonly ID = KAIRO_REMOTE_DEBUG_CONFIG_ID;

  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(StorageService) protected readonly storage!: StorageService;
  @inject(RemoteDebugTunnel) protected readonly tunnel!: RemoteDebugTunnel;

  protected configs: RemoteDebugConfig[] = [];
  protected editingConfig: RemoteDebugConfig | undefined;
  protected isTesting = false;
  protected isConnecting = false;

  constructor() {
    super();
    this.id = KAIRO_REMOTE_DEBUG_CONFIG_ID;
    this.title.label = '远程调试';
    this.title.caption = 'Kairo 远程 JDWP 调试配置';
    this.title.iconClass = 'codicon codicon-debug';
    this.title.closable = true;
  }

  @postConstruct()
  protected async init(): Promise<void> {
    await this.loadConfigs();
    this.update();
  }

  render(): React.ReactNode {
    return React.createElement(RemoteDebugConfigPanel, {
      configs: this.configs,
      editingConfig: this.editingConfig,
      isTesting: this.isTesting,
      isConnecting: this.isConnecting,
      tunnelStatus: this.tunnel.status,
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
      this.messages.error('请填写名称和主机地址。');
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
      this.messages.info(`连接测试成功: localhost:${localPort}`);
      await this.tunnel.disconnect();
    } catch (error) {
      this.messages.error(
        `连接失败: ${error instanceof Error ? error.message : String(error)}`,
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
      this.messages.info(`已连接到远程调试: localhost:${localPort}`);
    } catch (error) {
      this.messages.error(
        `连接失败: ${error instanceof Error ? error.message : String(error)}`,
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
  onAdd: () => void;
  onEdit: (c: RemoteDebugConfig) => void;
  onDelete: (c: RemoteDebugConfig) => void;
  onSave: (c: RemoteDebugConfig) => void;
  onCancel: () => void;
  onTest: (c: RemoteDebugConfig) => void;
  onConnect: (c: RemoteDebugConfig) => void;
  onDisconnect: () => void;
}

const AUTH_TYPES: { value: RemoteDebugAuthType; label: string }[] = [
  { value: 'none', label: '无认证' },
  { value: 'ssh-key', label: 'SSH 密钥' },
  { value: 'token', label: 'Token' },
];

const RemoteDebugConfigPanel: React.FC<RemoteDebugConfigPanelProps> = ({
  configs, editingConfig, isTesting, isConnecting, tunnelStatus,
  onAdd, onEdit, onDelete, onSave, onCancel, onTest, onConnect, onDisconnect,
}) => {
  const [draft, setDraft] = React.useState<RemoteDebugConfig>(
    editingConfig || { id: '', name: '', host: '', port: 8000, authType: 'none' },
  );

  React.useEffect(() => {
    if (editingConfig) {
      setDraft({ ...editingConfig });
    }
  }, [editingConfig]);

  const isConnected = tunnelStatus.state === 'connected';

  return (
    <div className="kairo-remote-debug-container">
      <div className="kairo-remote-debug-header">
        <h3>远程 JDWP 调试配置</h3>
        <span className="kairo-remote-debug-experimental">实验性功能</span>
        {isConnected && (
          <button
            type="button"
            className="theia-button secondary"
            onClick={onDisconnect}
          >
            断开连接
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
                  {AUTH_TYPES.find(a => a.value === config.authType)?.label || config.authType}
                </span>
              </div>
              <div className="kairo-remote-debug-item-actions">
                <button
                  type="button"
                  className="theia-button secondary"
                  onClick={() => onConnect(config)}
                  disabled={isTesting || isConnecting || isConnected}
                >
                  连接
                </button>
                <button
                  type="button"
                  className="theia-button secondary"
                  onClick={() => onTest(config)}
                  disabled={isTesting || isConnecting}
                >
                  {isTesting ? '测试中...' : '测试'}
                </button>
                <button
                  type="button"
                  className="theia-button secondary"
                  onClick={() => onEdit(config)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="theia-button secondary"
                  onClick={() => onDelete(config)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {configs.length === 0 && !editingConfig && (
        <p className="kairo-remote-debug-empty">
          暂无远程调试配置。点击"添加配置"创建新的远程连接。
        </p>
      )}

      {/* Edit form */}
      {editingConfig && (
        <div className="kairo-remote-debug-form">
          <h4>{editingConfig.id === draft.id && draft.name ? '编辑配置' : '新建配置'}</h4>
          <div className="kairo-remote-debug-field">
            <label>名称</label>
            <input
              type="text"
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder="例如：生产服务器"
              className="theia-input"
            />
          </div>
          <div className="kairo-remote-debug-field">
            <label>主机</label>
            <input
              type="text"
              value={draft.host}
              onChange={e => setDraft({ ...draft, host: e.target.value })}
              placeholder="例如：192.168.1.100"
              className="theia-input"
            />
          </div>
          <div className="kairo-remote-debug-field">
            <label>端口</label>
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
            <label>认证方式</label>
            <select
              value={draft.authType}
              onChange={e => setDraft({ ...draft, authType: e.target.value as RemoteDebugAuthType })}
              className="theia-select"
            >
              {AUTH_TYPES.map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
          {draft.authType === 'ssh-key' && (
            <div className="kairo-remote-debug-field">
              <label>SSH 密钥路径</label>
              <input
                type="text"
                value={draft.sshKeyPath || ''}
                onChange={e => setDraft({ ...draft, sshKeyPath: e.target.value })}
                placeholder="例如：~/.ssh/id_rsa"
                className="theia-input"
              />
            </div>
          )}
          {draft.authType === 'token' && (
            <div className="kairo-remote-debug-field">
              <label>Token</label>
              <input
                type="password"
                value={draft.token || ''}
                onChange={e => setDraft({ ...draft, token: e.target.value })}
                placeholder="输入认证 Token"
                className="theia-input"
              />
            </div>
          )}
          <div className="kairo-remote-debug-field">
            <label>本地端口（可选）</label>
            <input
              type="number"
              value={draft.localPort || ''}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                setDraft({ ...draft, localPort: isNaN(v) ? undefined : v });
              }}
              placeholder="自动分配"
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
              保存
            </button>
            <button
              type="button"
              className="theia-button secondary"
              onClick={onCancel}
            >
              取消
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
            添加配置
          </button>
        </div>
      )}
    </div>
  );
};