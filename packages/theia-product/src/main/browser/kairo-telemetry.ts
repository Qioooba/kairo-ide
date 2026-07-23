/**
 * Kairo 遥测框架 — P3-OBS-02
 *
 * KairoTelemetry service (default: disabled, opt-in only).
 * Events: startup, project open, build start/end, search, debug session, errors.
 *
 * All events include: timestamp, event type, anonymized session ID.
 * No personal data, no file contents, no source code.
 * Local storage only by default (no network transmission).
 * Admin can configure endpoint for enterprise telemetry collection.
 * Export to JSON for local analysis.
 * Privacy: clear disclosure of what's collected on first run.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { StorageService } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';

/** Telemetry event types. */
export type TelemetryEventType =
  | 'startup'
  | 'project.open'
  | 'project.close'
  | 'build.start'
  | 'build.end'
  | 'search.execute'
  | 'debug.session.start'
  | 'debug.session.end'
  | 'error.occurred'
  | 'ui.interaction';

/** A single telemetry event. */
export interface TelemetryEvent {
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Event type. */
  eventType: TelemetryEventType;
  /** Anonymized session ID. */
  sessionId: string;
  /** Event-specific data (no personal info, no file contents). */
  data?: Record<string, string | number | boolean>;
}

/** Telemetry configuration. */
export interface TelemetryConfig {
  /** Whether telemetry is enabled. */
  enabled: boolean;
  /** Whether the user has seen the privacy disclosure. */
  privacyAccepted: boolean;
  /** Enterprise endpoint URL (optional). */
  endpoint?: string;
  /** Maximum number of events to keep locally. */
  maxLocalEvents: number;
}

/** Telemetry statistics. */
export interface TelemetryStats {
  totalEvents: number;
  enabled: boolean;
  eventsByType: Record<string, number>;
  oldestEvent?: string;
  newestEvent?: string;
}

const TELEMETRY_CONFIG_KEY = 'kairo.telemetry.config';
const TELEMETRY_EVENTS_KEY = 'kairo.telemetry.events';
const MAX_EVENTS_DEFAULT = 10_000;

@injectable()
export class KairoTelemetry {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(StorageService) protected readonly storage!: StorageService;

  protected readonly onDidChangeConfigEmitter = new Emitter<TelemetryConfig>();
  readonly onDidChangeConfig: Event<TelemetryConfig> = this.onDidChangeConfigEmitter.event;

  protected readonly onDidRecordEventEmitter = new Emitter<TelemetryEvent>();
  readonly onDidRecordEvent: Event<TelemetryEvent> = this.onDidRecordEventEmitter.event;

  protected config: TelemetryConfig = {
    enabled: false,
    privacyAccepted: false,
    maxLocalEvents: MAX_EVENTS_DEFAULT,
  };

  protected events: TelemetryEvent[] = [];
  protected sessionId: string;

  get telemetryConfig(): Readonly<TelemetryConfig> {
    return this.config;
  }

  get isEnabled(): boolean {
    return this.config.enabled && this.config.privacyAccepted;
  }

  get eventCount(): number {
    return this.events.length;
  }

  constructor() {
    this.sessionId = this.generateSessionId();
  }

  @postConstruct()
  protected async init(): Promise<void> {
    this.logger.info('Kairo 遥测框架已初始化（默认禁用）');
    await this.loadConfig();
    await this.loadEvents();

    // Show privacy disclosure on first run if not yet accepted
    if (this.config.enabled && !this.config.privacyAccepted) {
      this.showPrivacyDisclosure();
    }
  }

  /**
   * Enable or disable telemetry.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled && !this.config.privacyAccepted) {
      this.showPrivacyDisclosure();
      return;
    }

    this.config.enabled = enabled;
    await this.persistConfig();
    this.onDidChangeConfigEmitter.fire({ ...this.config });
    this.logger.info(`遥测已${enabled ? '启用' : '禁用'}`);
  }

  /**
   * Accept the privacy disclosure.
   */
  async acceptPrivacy(): Promise<void> {
    this.config.privacyAccepted = true;
    await this.persistConfig();
    this.onDidChangeConfigEmitter.fire({ ...this.config });
  }

  /**
   * Set the enterprise telemetry endpoint.
   */
  async setEndpoint(endpoint: string | undefined): Promise<void> {
    this.config.endpoint = endpoint;
    await this.persistConfig();
    this.onDidChangeConfigEmitter.fire({ ...this.config });
  }

  /**
   * Record a telemetry event.
   */
  async recordEvent(
    eventType: TelemetryEventType,
    data?: Record<string, string | number | boolean>,
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const event: TelemetryEvent = {
      timestamp: new Date().toISOString(),
      eventType,
      sessionId: this.sessionId,
      data,
    };

    this.events.push(event);

    // Trim if exceeding max
    if (this.events.length > this.config.maxLocalEvents) {
      this.events = this.events.slice(
        this.events.length - this.config.maxLocalEvents,
      );
    }

    this.onDidRecordEventEmitter.fire(event);

    // Persist periodically (every 50 events)
    if (this.events.length % 50 === 0) {
      await this.persistEvents();
    }

    // Send to enterprise endpoint if configured
    if (this.config.endpoint) {
      this.sendToEndpoint(event).catch(err => {
        this.logger.warn(`遥测端点发送失败: ${err}`);
      });
    }
  }

  /**
   * Get all recorded events.
   */
  getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  /**
   * Get telemetry statistics.
   */
  getStats(): TelemetryStats {
    const eventsByType: Record<string, number> = {};
    for (const event of this.events) {
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      enabled: this.isEnabled,
      eventsByType,
      oldestEvent: this.events[0]?.timestamp,
      newestEvent: this.events[this.events.length - 1]?.timestamp,
    };
  }

  /**
   * Export all events as JSON.
   */
  exportToJSON(): string {
    return JSON.stringify(
      {
        exportTime: new Date().toISOString(),
        sessionId: this.sessionId,
        config: { enabled: this.config.enabled, endpoint: this.config.endpoint },
        totalEvents: this.events.length,
        events: this.events,
      },
      null,
      2,
    );
  }

  /**
   * Clear all collected events.
   */
  async clearEvents(): Promise<void> {
    this.events = [];
    await this.persistEvents();
    this.logger.info('遥测数据已清除');
  }

  /**
   * Show the privacy disclosure to the user.
   */
  showPrivacyDisclosure(): void {
    this.messages.warn(
      'Kairo IDE 遥测数据收集 (默认禁用)\n\n' +
      '遥测收集以下信息：\n' +
      '• IDE 启动时间\n' +
      '• 项目打开/关闭事件\n' +
      '• 构建开始/结束事件\n' +
      '• 搜索操作\n' +
      '• 调试会话事件\n' +
      '• 错误事件\n\n' +
      '不收集以下信息：\n' +
      '• 个人身份信息\n' +
      '• 文件内容\n' +
      '• 源代码\n' +
      '• 项目路径\n' +
      '• 环境变量\n\n' +
      '数据默认仅存储在本地，不会发送到任何服务器。\n' +
      '管理员可以配置企业遥测端点进行数据收集。\n\n' +
      '此功能默认关闭，需要手动启用。',
    );
  }

  // ── Internal ──────────────────────────────────────────────────

  protected generateSessionId(): string {
    // Anonymized session ID — not derived from any personal data
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 's_';
    const timestamp = Date.now().toString(36);
    id += timestamp + '_';
    for (let i = 0; i < 8; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  protected async sendToEndpoint(event: TelemetryEvent): Promise<void> {
    if (!this.config.endpoint) return;

    try {
      await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (error) {
      this.logger.warn(
        `遥测发送失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  protected async persistConfig(): Promise<void> {
    try {
      await this.storage.setData(TELEMETRY_CONFIG_KEY, this.config);
    } catch {
      // Storage not available
    }
  }

  protected async loadConfig(): Promise<void> {
    try {
      const data = await this.storage.getData<TelemetryConfig>(TELEMETRY_CONFIG_KEY);
      if (data) {
        this.config = {
          ...data,
          enabled: data.enabled ?? false,
          privacyAccepted: data.privacyAccepted ?? false,
          maxLocalEvents: data.maxLocalEvents ?? MAX_EVENTS_DEFAULT,
        };
      }
    } catch {
      this.config = {
        enabled: false,
        privacyAccepted: false,
        maxLocalEvents: MAX_EVENTS_DEFAULT,
      };
    }
  }

  protected async persistEvents(): Promise<void> {
    try {
      await this.storage.setData(TELEMETRY_EVENTS_KEY, this.events);
    } catch {
      // Storage not available
    }
  }

  protected async loadEvents(): Promise<void> {
    try {
      const data = await this.storage.getData<TelemetryEvent[]>(TELEMETRY_EVENTS_KEY);
      if (data && Array.isArray(data)) {
        this.events = data;
      }
    } catch {
      this.events = [];
    }
  }
}