/**
 * Kairo Debug Configuration Service — persistence and management of
 * Java debug launch/attach configurations.
 *
 * Stores debug configurations in the workspace, supports CRUD operations,
 * and provides reasonable defaults for Java debug sessions.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import {
  type KairoJavaAttachTarget,
} from '../common/kairo-java-debug';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface KairoDebugConfig {
  /** Unique identifier for this configuration */
  id: string;
  /** User-friendly name */
  name: string;
  /** Configuration type: attach or launch */
  type: 'attach' | 'launch';
  /** Hostname for JDWP connection (attach mode) */
  host?: string;
  /** JDWP port */
  port?: number;
  /** Server ID for runtime-managed attach */
  serverId?: string;
  /** Project ID for runtime-managed attach */
  projectId?: string;
  /** Project root path */
  projectRoot?: string;
  /** Timeout in ms for attach */
  timeout?: number;
  /** Whether this is the default configuration */
  isDefault?: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  updatedAt: number;
}

export interface DebugConfigState {
  configs: KairoDebugConfig[];
  activeConfigId: string | undefined;
  busy: boolean;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/*  Service                                                             */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugConfigService {
  @inject(FileService)
  protected readonly fileService!: FileService;

  protected state: DebugConfigState = {
    configs: [],
    activeConfigId: undefined,
    busy: false,
    error: null,
  };

  protected readonly onStateChangeEmitter = new Emitter<DebugConfigState>();
  readonly onDidStateChange: Event<DebugConfigState> = this.onStateChangeEmitter.event;

  protected static nextId = 0;

  get currentState(): Readonly<DebugConfigState> {
    return this.state;
  }

  get activeConfig(): KairoDebugConfig | undefined {
    return this.state.configs.find(c => c.id === this.state.activeConfigId);
  }

  @postConstruct()
  protected init(): void {
    // Load persisted configs on startup
    this.loadConfigs().catch(() => { /* silently ignore — defaults will be used */ });
  }

  /**
   * Get all debug configurations.
   */
  getConfigs(): KairoDebugConfig[] {
    return this.state.configs;
  }

  /**
   * Get the active debug configuration.
   */
  getActiveConfig(): KairoDebugConfig | undefined {
    return this.activeConfig;
  }

  /**
   * Set the active configuration by ID.
   */
  setActiveConfig(id: string): void {
    const config = this.state.configs.find(c => c.id === id);
    if (!config) {
      this.setState({ activeConfigId: undefined, error: `Configuration ${id} not found` });
      return;
    }
    this.setState({ activeConfigId: id, error: null });
    this.persistConfigs().catch(() => { /* silently ignore */ });
  }

  /**
   * Create a new debug configuration.
   */
  createConfig(partial: Partial<Omit<KairoDebugConfig, 'id' | 'createdAt' | 'updatedAt'>>): KairoDebugConfig {
    const id = `kairo-debug-config-${++KairoDebugConfigService.nextId}`;
    const now = Date.now();
    const config: KairoDebugConfig = {
      id,
      name: partial.name ?? `Debug Config ${KairoDebugConfigService.nextId}`,
      type: partial.type ?? 'attach',
      host: partial.host ?? '127.0.0.1',
      port: partial.port ?? 5005,
      serverId: partial.serverId,
      projectId: partial.projectId,
      projectRoot: partial.projectRoot,
      timeout: partial.timeout ?? 30000,
      isDefault: partial.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };

    const configs = [...this.state.configs, config];
    this.setState({ configs, error: null });
    this.persistConfigs().catch(() => { /* silently ignore */ });
    return config;
  }

  /**
   * Update an existing debug configuration.
   */
  updateConfig(id: string, partial: Partial<Omit<KairoDebugConfig, 'id' | 'createdAt'>>): KairoDebugConfig | undefined {
    const index = this.state.configs.findIndex(c => c.id === id);
    if (index === -1) {
      this.setState({ error: `Configuration ${id} not found` });
      return undefined;
    }

    const configs = [...this.state.configs];
    configs[index] = {
      ...configs[index],
      ...partial,
      updatedAt: Date.now(),
    };
    this.setState({ configs, error: null });
    this.persistConfigs().catch(() => { /* silently ignore */ });
    return configs[index];
  }

  /**
   * Delete a debug configuration by ID.
   */
  deleteConfig(id: string): boolean {
    const index = this.state.configs.findIndex(c => c.id === id);
    if (index === -1) {
      this.setState({ error: `Configuration ${id} not found` });
      return false;
    }

    const configs = this.state.configs.filter(c => c.id !== id);
    const activeConfigId = this.state.activeConfigId === id ? undefined : this.state.activeConfigId;
    this.setState({ configs, activeConfigId, error: null });
    this.persistConfigs().catch(() => { /* silently ignore */ });
    return true;
  }

  /**
   * Create a default attach configuration for a given server.
   */
  createDefaultAttachConfig(target: KairoJavaAttachTarget): KairoDebugConfig {
    return this.createConfig({
      name: `Attach to ${target.projectName} (${target.serverId})`,
      type: 'attach',
      host: '127.0.0.1',
      port: target.port,
      serverId: target.serverId,
      projectId: target.projectId,
      projectRoot: target.projectRoot,
      isDefault: true,
    });
  }

  /**
   * Convert a KairoDebugConfig to a KairoJavaAttachTarget.
   */
  toAttachTarget(config: KairoDebugConfig): KairoJavaAttachTarget {
    return {
      serverId: config.serverId ?? '',
      projectId: config.projectId ?? '',
      projectName: config.name,
      projectRoot: config.projectRoot ?? '',
      port: config.port ?? 5005,
    };
  }

  /**
   * Get the storage URI for config persistence.
   */
  protected getStorageUri(): string {
    return '.kairo/debug-configs.json';
  }

  /**
   * Load persisted configurations from workspace storage.
   */
  protected async loadConfigs(): Promise<void> {
    try {
      const uri = new URI(this.getStorageUri());
      if (!(await this.fileService.exists(uri))) {
        return;
      }
      const content = await this.fileService.readFile(uri);
      const raw = JSON.parse(content.value.toString());
      const configs: KairoDebugConfig[] = Array.isArray(raw) ? raw : [];
      const activeConfigId = configs.find(c => c.isDefault)?.id ?? configs[0]?.id;
      this.setState({ configs, activeConfigId, error: null });
    } catch {
      // No persisted configs — use empty defaults
    }
  }

  /**
   * Persist configurations to workspace storage.
   */
  protected async persistConfigs(): Promise<void> {
    try {
      const uri = new URI(this.getStorageUri());
      const content = JSON.stringify(this.state.configs, null, 2);
      await this.fileService.writeFile(uri, BinaryBuffer.fromString(content));
    } catch {
      // Silently ignore persistence errors — configs are still in memory
    }
  }

  protected setState(partial: Partial<DebugConfigState>): void {
    this.state = { ...this.state, ...partial };
    this.onStateChangeEmitter.fire(this.state);
  }
}