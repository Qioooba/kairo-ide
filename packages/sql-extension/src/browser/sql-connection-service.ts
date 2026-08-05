/**
 * SQL Connection Service — manages Oracle 11g connection configurations.
 *
 * Connection metadata (host/port/user) is persisted via StorageService.
 * Passwords are held in-memory and, when Electron safeStorage is available
 * via window.kairoIPC, persisted as OS-keychain ciphertext. Plaintext
 * password persistence is never used.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { StorageService } from '@theia/core/lib/browser';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';

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

/** Persisted shape when Electron safeStorage encrypts the password. */
interface EncryptedPasswordBlob {
  v: 1;
  enc: string;
}

interface KairoSafeStorageIPC {
  isSafeStorageAvailable?: () => Promise<boolean>;
  encryptString?: (plaintext: string) => Promise<string>;
  decryptString?: (ciphertextB64: string) => Promise<string>;
}

function getSafeStorageIPC(): KairoSafeStorageIPC | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as unknown as { kairoIPC?: KairoSafeStorageIPC }).kairoIPC;
}

@injectable()
export class SqlConnectionService {
  @inject(StorageService)
  protected readonly storage!: StorageService;

  @inject(RuntimeConnectionService)
  protected readonly runtime!: RuntimeConnectionService;

  private connections: Map<string, SqlConnectionConfig> = new Map();
  private connectionStates: Map<string, SqlConnectionState> = new Map();
  /** Session password cache — never written to disk as plaintext. */
  private readonly passwordCache = new Map<string, string>();

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
          // Warm cache from encrypted storage when available; purge legacy plaintext.
          await this.hydratePassword(config.id);
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
    const id = `conn-${crypto.randomUUID()}`;
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
    const cached = this.passwordCache.get(config.id);
    if (cached !== undefined) {
      return cached;
    }
    return this.hydratePassword(config.id);
  }

  private passwordStorageKey(id: string): string {
    return `${PASSWORDS_PREFIX}${id}`;
  }

  private async hydratePassword(id: string): Promise<string | undefined> {
    try {
      const stored = await this.storage.getData<string | EncryptedPasswordBlob>(this.passwordStorageKey(id));
      if (stored === undefined || stored === null) {
        return undefined;
      }
      // Legacy plaintext string — migrate into memory and remove from disk.
      if (typeof stored === 'string') {
        this.passwordCache.set(id, stored);
        await this.persistPassword(id, stored);
        return stored;
      }
      if (typeof stored === 'object' && stored.v === 1 && typeof stored.enc === 'string') {
        const ipc = getSafeStorageIPC();
        if (!ipc?.decryptString) {
          return undefined;
        }
        const plain = await ipc.decryptString(stored.enc);
        this.passwordCache.set(id, plain);
        return plain;
      }
    } catch {
      // Ignore storage/decrypt errors
    }
    return undefined;
  }

  private async persistPassword(id: string, password: string): Promise<void> {
    const key = this.passwordStorageKey(id);
    const ipc = getSafeStorageIPC();
    try {
      const available = ipc?.isSafeStorageAvailable ? await ipc.isSafeStorageAvailable() : false;
      if (available && ipc?.encryptString) {
        const enc = await ipc.encryptString(password);
        const blob: EncryptedPasswordBlob = { v: 1, enc };
        await this.storage.setData(key, blob);
        return;
      }
    } catch {
      // Fall through to memory-only
    }
    // No OS encryption: keep in memory only and remove any prior disk copy.
    await this.removePasswordFromStorage(key);
  }

  private async removePasswordFromStorage(key: string): Promise<void> {
    try {
      // LocalStorageService deletes the key when data is undefined (VC-P0-4).
      await this.storage.setData(key, undefined as unknown as string);
    } catch {
      // Ignore deletion errors
    }
  }

  private async savePassword(config: SqlConnectionConfig, password: string): Promise<void> {
    this.passwordCache.set(config.id, password);
    await this.persistPassword(config.id, password);
  }

  private async deletePassword(config: SqlConnectionConfig): Promise<void> {
    this.passwordCache.delete(config.id);
    await this.removePasswordFromStorage(this.passwordStorageKey(config.id));
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
      const payload = await this.runtime.request(
        'POST /api/v1/sql/test-connection',
        {
          host: config.host,
          port: config.port,
          sid: config.sid,
          serviceName: config.serviceName,
          useServiceName: config.useServiceName,
          username: config.username,
          password,
        },
        { noRetry: true },
      );
      return {
        success: true,
        oracleVersion: payload.oracleVersion,
        instanceName: payload.instanceName,
      };
    } catch (err: unknown) {
      if (err instanceof KairoError) {
        const details = (err.details && typeof err.details === 'object')
          ? err.details as { oracleErrorCode?: string }
          : undefined;
        return {
          success: false,
          error: err.message,
          oracleErrorCode: details?.oracleErrorCode,
        };
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  private updateConnectionState(id: string, status: SqlConnectionStatus, oracleVersion?: string, error?: string): void {
    const config = this.connections.get(id);
    if (!config) return;
    const state: SqlConnectionState = { config, status, oracleVersion, error };
    this.connectionStates.set(id, state);
    this.onConnectionStateChangedEmitter.fire(state);
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

  /** Import connection configs (without passwords).
   * VC-P1-8: skip entries that would be created with an empty password
   * unless the caller explicitly opts in via `allowEmptyPassword`. */
  async importConnections(
    configs: SqlConnectionConfigExport[],
    opts: { allowEmptyPassword?: boolean; passwords?: Record<string, string> } = {},
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;
    for (const config of configs) {
      const password = opts.passwords?.[config.name ?? config.host] ?? opts.passwords?.[config.host] ?? '';
      if (!password && !opts.allowEmptyPassword) {
        skipped++;
        continue;
      }
      await this.addConnection(config, password);
      imported++;
    }
    return { imported, skipped };
  }
}
