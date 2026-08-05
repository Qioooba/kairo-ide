/**
 * Kairo 遥测框架 — P3-OBS-02
 *
 * OFFLINE / AIR-GAPPED MODE: Kairo IDE is designed for fully intranet
 * deployment with zero internet connectivity. Telemetry network
 * transmission is DISABLED by default. Events are stored locally only.
 *
 * To enable enterprise telemetry collection on your intranet:
 * 1. Set KAIRO_ALLOW_TELEMETRY=1 (explicit opt-in)
 * 2. Configure KAIRO_TELEMETRY_ENDPOINT to your internal telemetry server
 * 3. User must accept the privacy disclosure in settings
 *
 * All events include: timestamp, event type, anonymized session ID.
 * No personal data, no file contents, no source code.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { StorageService } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';

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

export interface TelemetryEvent {
  timestamp: string;
  eventType: TelemetryEventType;
  sessionId: string;
  data?: Record<string, string | number | boolean>;
}

export interface TelemetryConfig {
  enabled: boolean;
  privacyAccepted: boolean;
  endpoint?: string;
  maxLocalEvents: number;
}

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

function isTelemetryNetworkAllowed(): boolean {
  return typeof process !== 'undefined' && process.env?.KAIRO_ALLOW_TELEMETRY === '1';
}

function getConfiguredTelemetryEndpoint(): string | undefined {
  if (typeof process !== 'undefined') {
    return process.env?.KAIRO_TELEMETRY_ENDPOINT;
  }
  return undefined;
}

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

  get isNetworkTransmissionEnabled(): boolean {
    return this.isEnabled && isTelemetryNetworkAllowed() && !!(this.config.endpoint || getConfiguredTelemetryEndpoint());
  }

  get eventCount(): number {
    return this.events.length;
  }

  constructor() {
    this.sessionId = this.generateSessionId();
  }

  @postConstruct()
  protected async init(): Promise<void> {
    await this.loadConfig();
    await this.loadEvents();

    const envEndpoint = getConfiguredTelemetryEndpoint();
    if (envEndpoint) {
      this.config.endpoint = envEndpoint;
    }

    if (!isTelemetryNetworkAllowed() && this.config.endpoint) {
      this.logger.info('Kairo telemetry: endpoint configured but KAIRO_ALLOW_TELEMETRY is not set. Events will be stored locally only, no network transmission.');
    }

    this.logger.info('Kairo telemetry framework initialized (default: disabled, local-only)');

    if (this.config.enabled && !this.config.privacyAccepted) {
      this.showPrivacyDisclosure();
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled && !this.config.privacyAccepted) {
      this.showPrivacyDisclosure();
      return;
    }

    this.config.enabled = enabled;
    await this.persistConfig();
    this.onDidChangeConfigEmitter.fire({ ...this.config });
    this.logger.info(`Telemetry ${enabled ? 'enabled' : 'disabled'}`);
  }

  async acceptPrivacy(): Promise<void> {
    this.config.privacyAccepted = true;
    await this.persistConfig();
    this.onDidChangeConfigEmitter.fire({ ...this.config });
  }

  async setEndpoint(endpoint: string | undefined): Promise<void> {
    this.config.endpoint = endpoint;
    await this.persistConfig();
    this.onDidChangeConfigEmitter.fire({ ...this.config });
  }

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

    if (this.events.length > this.config.maxLocalEvents) {
      this.events = this.events.slice(
        this.events.length - this.config.maxLocalEvents,
      );
    }

    this.onDidRecordEventEmitter.fire(event);

    if (this.events.length % 50 === 0) {
      await this.persistEvents();
    }

    if (this.isNetworkTransmissionEnabled) {
      const targetEndpoint = this.config.endpoint || getConfiguredTelemetryEndpoint();
      if (targetEndpoint) {
        this.sendToEndpoint(event, targetEndpoint).catch(err => {
          this.logger.warn(`Telemetry endpoint send failed: ${err}`);
        });
      }
    }
  }

  getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

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

  exportToJSON(): string {
    return JSON.stringify(
      {
        exportTime: new Date().toISOString(),
        sessionId: this.sessionId,
        config: {
          enabled: this.config.enabled,
          networkTransmissionEnabled: this.isNetworkTransmissionEnabled,
          endpointConfigured: !!this.config.endpoint,
        },
        totalEvents: this.events.length,
        events: this.events,
      },
      null,
      2,
    );
  }

  async clearEvents(): Promise<void> {
    this.events = [];
    await this.persistEvents();
    this.logger.info('Telemetry data cleared');
  }

  showPrivacyDisclosure(): void {
    const offlineNote = !isTelemetryNetworkAllowed()
      ? '\n\nNote: Kairo IDE runs in offline/air-gapped mode. Network telemetry transmission is disabled. Events are stored locally only. To enable intranet telemetry, set KAIRO_ALLOW_TELEMETRY=1 and configure KAIRO_TELEMETRY_ENDPOINT.'
      : '';

    this.messages.warn(
      'Kairo IDE Telemetry (disabled by default)\n\n' +
      'Collected data:\n' +
      '• IDE startup time\n' +
      '• Project open/close events\n' +
      '• Build start/end events\n' +
      '• Search operations\n' +
      '• Debug session events\n' +
      '• Error events\n\n' +
      'NOT collected:\n' +
      '• Personal information\n' +
      '• File contents\n' +
      '• Source code\n' +
      '• Project paths\n' +
      '• Environment variables\n\n' +
      'Data is stored locally by default and never transmitted unless an enterprise endpoint is explicitly configured.' +
      offlineNote,
    );
  }

  protected generateSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `s_${crypto.randomUUID()}`;
    }
    // Extremely old environments without Web Crypto — still avoid Math.random alone.
    const timestamp = Date.now().toString(36);
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    }
    const suffix = Array.from(bytes, b => (b % 36).toString(36)).join('');
    return `s_${timestamp}_${suffix}`;
  }

  protected async sendToEndpoint(event: TelemetryEvent, endpoint: string): Promise<void> {
    if (!endpoint || !isTelemetryNetworkAllowed()) return;

    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (error) {
      this.logger.warn(
        `Telemetry send failed: ${error instanceof Error ? error.message : String(error)}`,
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
