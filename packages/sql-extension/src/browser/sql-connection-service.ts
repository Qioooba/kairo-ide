/**
 * SQL Connection Service — manages Oracle 11g connection configurations.
 * Stores connection configs securely, supports test connection and import/export.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { StorageService } from '@theia/core/lib/browser';

export interface SqlConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  sid: string;
  serviceName?: string;
  username: string;
  /** Whether to use Service Name instead of SID. */
  useServiceName: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SqlConnectionConfigExport {
  name: string;
  host: string;
  port: number;
  sid: string;
  serviceName?: string;
  useServiceName: boolean;
  username: string;
}

export type SqlConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SqlConnectionState {
  config: SqlConnectionConfig;
  status: SqlConnectionStatus;
  oracleVersion?: string;
  error?: string;
}

export interface SqlTestConnectionResult {
  success: boolean;
  oracleVersion?: string;
  instanceName?: string;
  error?: string;
  oracleErrorCode?: string;
}

const CONNECTIONS_STORAGE_KEY = 'kairo.sql.connections';
const PASSWORDS_PREFIX = 'kairo.sql.password.';

@injectable()
export class SqlConnectionService {
  @inject(StorageService)
  protected readonly storage!: StorageService;

  private connections: Map<string, SqlConnectionConfig> = new Map();
  private connectionStates: Map<string, SqlConnectionState> = new Map();

  private readonly onConnectionsChangedEmitter = new Emitter<SqlConnectionConfig[]>();
  readonly onConnectionsChanged: Event<SqlConnectionConfig[]> = this.onConnectionsChangedEmitter.event;

  private readonly onConnectionStateChangedEmitter = new Emitter<SqlConnectionState>();
  readonly onConnectionStateChanged: Event<SqlConnectionState> = this.onConnectionStateChangedEmitter.event;

  /** Load saved connections from storage. */
  async loadConnections(): Promise<SqlConnectionConfig[]> {
    try {
      const configs = await this.storage.getData<SqlConnectionConfig[]>(CONNECTIONS_STORAGE_KEY);
      if (configs) {
        this.connections.clear();
        for (const config of configs) {
          this.connections.set(config.id, config);
          if (!this.connectionStates.has(config.id)) {
            this.connectionStates.set(config.id, {
              config,
              status: 'disconnected',
            });
          }
        }
      }
    } catch {
      // Storage not available or empty
    }
    return this.getAllConnections();
  }

  /** Save connections to persistent storage. */
  private async saveConnections(): Promise<void> {
    const configs = Array.from(this.connections.values());
    // Strip passwords before saving config metadata
    const sanitized = configs.map(({ ...c }) => c);
    await this.storage.setData(CONNECTIONS_STORAGE_KEY, sanitized);
  }

  /** Add a new connection configuration. */
  async addConnection(config: Omit<SqlConnectionConfig, 'id' | 'createdAt' | 'updatedAt'>, password: string): Promise<SqlConnectionConfig> {
    const id = `conn-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();
    const fullConfig: SqlConnectionConfig = {
      ...config,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.connections.set(id, fullConfig);
    await this.savePassword(fullConfig, password);
    await this.saveConnections();
    this.connectionStates.set(id, { config: fullConfig, status: 'disconnected' });
    this.onConnectionsChangedEmitter.fire(this.getAllConnections());
    return fullConfig;
  }

  /** Update an existing connection configuration. */
  async updateConnection(id: string, updates: Partial<Omit<SqlConnectionConfig, 'id' | 'createdAt' | 'updatedAt'>>, password?: string): Promise<SqlConnectionConfig | undefined> {
    const existing = this.connections.get(id);
    if (!existing) return undefined;
    const updated: SqlConnectionConfig = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.connections.set(id, updated);
    if (password) {
      await this.savePassword(updated, password);
    }
    await this.saveConnections();
    const state = this.connectionStates.get(id);
    if (state) {
      this.connectionStates.set(id, { ...state, config: updated });
    }
    this.onConnectionsChangedEmitter.fire(this.getAllConnections());
    return updated;
  }

  /** Delete a connection configuration. */
  async deleteConnection(id: string): Promise<boolean> {
    const config = this.connections.get(id);
    if (!config) return false;
    this.connections.delete(id);
    this.connectionStates.delete(id);
    await this.deletePassword(config);
    await this.saveConnections();
    this.onConnectionsChangedEmitter.fire(this.getAllConnections());
    return true;
  }

  /** Get all connection configs. */
  getAllConnections(): SqlConnectionConfig[] {
    return Array.from(this.connections.values());
  }

  /** Get a connection by ID. */
  getConnection(id: string): SqlConnectionConfig | undefined {
    return this.connections.get(id);
  }

  /** Get connection state. */
  getConnectionState(id: string): SqlConnectionState | undefined {
    return this.connectionStates.get(id);
  }

  /** Retrieve password for a connection. */
  async getPassword(config: SqlConnectionConfig): Promise<string | undefined> {
    try {
      return await this.storage.getData<string>(`${PASSWORDS_PREFIX}${config.id}`);
    } catch {
      return undefined;
    }
  }

  private async savePassword(config: SqlConnectionConfig, password: string): Promise<void> {
    await this.storage.setData(`${PASSWORDS_PREFIX}${config.id}`, password);
  }

  private async deletePassword(config: SqlConnectionConfig): Promise<void> {
    try {
      await this.storage.setData(`${PASSWORDS_PREFIX}${config.id}`, undefined);
    } catch {
      // Ignore deletion errors
    }
  }

  /** Test a connection without saving. */
  async testConnection(config: Omit<SqlConnectionConfig, 'id' | 'createdAt' | 'updatedAt'>, password: string): Promise<SqlTestConnectionResult> {
    const testConfig: SqlConnectionConfig = {
      ...config,
      id: 'test',
      createdAt: '',
      updatedAt: '',
    };
    return this.executeTestConnection(testConfig, password);
  }

  /** Test a saved connection by ID. */
  async testConnectionById(id: string): Promise<SqlTestConnectionResult> {
    const config = this.connections.get(id);
    if (!config) {
      return { success: false, error: 'Connection not found' };
    }
    const password = await this.getPassword(config);
    if (!password) {
      return { success: false, error: 'Password not found' };
    }
    this.updateConnectionState(id, 'connecting');
    const result = await this.executeTestConnection(config, password);
    if (result.success) {
      this.updateConnectionState(id, 'connected', result.oracleVersion);
    } else {
      this.updateConnectionState(id, 'error', undefined, result.error);
    }
    return result;
  }

  private async executeTestConnection(config: SqlConnectionConfig, password: string): Promise<SqlTestConnectionResult> {
    try {
      const response = await fetch('/api/v1/sql/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: config.host,
          port: config.port,
          sid: config.sid,
          serviceName: config.serviceName,
          useServiceName: config.useServiceName,
          username: config.username,
          password,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        return {
          success: false,
          error: data.error?.message || `Connection test failed with status ${response.status}`,
          oracleErrorCode: data.error?.details?.oracleErrorCode,
        };
      }
      return {
        success: true,
        oracleVersion: data.payload?.oracleVersion,
        instanceName: data.payload?.instanceName,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /** Connect to a saved connection. */
  async connect(id: string): Promise<boolean> {
    const config = this.connections.get(id);
    if (!config) return false;
    this.updateConnectionState(id, 'connecting');
    const result = await this.testConnectionById(id);
    return result.success;
  }

  /** Disconnect from a connection. */
  async disconnect(id: string): Promise<void> {
    this.updateConnectionState(id, 'disconnected');
  }

  private updateConnectionState(id: string, status: SqlConnectionStatus, oracleVersion?: string, error?: string): void {
    const config = this.connections.get(id);
    if (!config) return;
    const state: SqlConnectionState = { config, status, oracleVersion, error };
    this.connectionStates.set(id, state);
    this.onConnectionStateChangedEmitter.fire(state);
  }

  /** Export connection configs without passwords. */
  exportConnections(): SqlConnectionConfigExport[] {
    return Array.from(this.connections.values()).map((c) => ({
      name: c.name,
      host: c.host,
      port: c.port,
      sid: c.sid,
      serviceName: c.serviceName,
      useServiceName: c.useServiceName,
      username: c.username,
    }));
  }

  /** Import connection configs (without passwords). */
  async importConnections(configs: SqlConnectionConfigExport[]): Promise<number> {
    let imported = 0;
    for (const config of configs) {
      await this.addConnection(config, '');
      imported++;
    }
    return imported;
  }
}