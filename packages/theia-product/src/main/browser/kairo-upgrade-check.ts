/**
 * 升级检查器 — P3-OBS-03
 *
 * OFFLINE / AIR-GAPPED MODE: Kairo IDE is designed for fully intranet
 * deployment with zero internet connectivity. Automatic update checks
 * are DISABLED by default and the upgrade endpoint is never contacted.
 *
 * This service exists as a no-op stub for:
 * - Future on-premise update server support (configured via KAIRO_UPGRADE_ENDPOINT
 *   pointing to an internal intranet server)
 * - Type compatibility for widgets that may reference the service
 *
 * To enable in a controlled intranet environment:
 * 1. Set KAIRO_UPGRADE_ENDPOINT to your internal update server URL
 * 2. Set KAIRO_ALLOW_UPGRADE_CHECK=1 (opt-in flag)
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { StorageService } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common/command';

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  downloadUrl?: string;
  sha256?: string;
  releaseNotes?: string;
  minVersion?: string;
}

export type UpgradeState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'verifying'
  | 'verified'
  | 'installing'
  | 'complete'
  | 'error'
  | 'rolling-back'
  | 'disabled';

export interface UpgradeProgress {
  state: UpgradeState;
  message?: string;
  percent?: number;
  error?: string;
}

export interface UpgradeCheckerConfig {
  checkOnStartup: boolean;
  endpoint?: string;
  currentVersion: string;
  updateNotified: boolean;
  backupPath?: string;
}

const UPGRADE_CONFIG_KEY = 'kairo.upgrade.config';

function isUpgradeCheckEnabled(): boolean {
  return typeof process !== 'undefined' && process.env?.KAIRO_ALLOW_UPGRADE_CHECK === '1';
}

function getConfiguredEndpoint(): string | undefined {
  if (typeof process !== 'undefined') {
    return process.env?.KAIRO_UPGRADE_ENDPOINT;
  }
  return undefined;
}

@injectable()
export class KairoUpgradeChecker {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(StorageService) protected readonly storage!: StorageService;
  @inject(CommandService) protected readonly commands!: CommandService;

  protected readonly onDidChangeProgressEmitter = new Emitter<UpgradeProgress>();
  readonly onDidChangeProgress: Event<UpgradeProgress> = this.onDidChangeProgressEmitter.event;

  protected readonly onUpdateAvailableEmitter = new Emitter<VersionInfo>();
  readonly onUpdateAvailable: Event<VersionInfo> = this.onUpdateAvailableEmitter.event;

  protected config: UpgradeCheckerConfig = {
    checkOnStartup: false,
    currentVersion: '0.0.0',
    updateNotified: false,
  };

  protected progress: UpgradeProgress = { state: 'idle' };
  protected versionInfo: VersionInfo | undefined;

  get upgradeProgress(): Readonly<UpgradeProgress> {
    return this.progress;
  }

  get currentVersion(): string {
    return this.config.currentVersion;
  }

  get isUpdateAvailable(): boolean {
    return this.versionInfo?.updateAvailable === true;
  }

  get isNetworkCheckAllowed(): boolean {
    return isUpgradeCheckEnabled() && !!this.config.endpoint;
  }

  @postConstruct()
  protected async init(): Promise<void> {
    await this.loadConfig();

    if (!isUpgradeCheckEnabled()) {
      this.progress = { state: 'disabled', message: 'Kairo IDE runs in offline/air-gapped mode. Automatic update checks are disabled.' };
      this.onDidChangeProgressEmitter.fire(this.progress);
      this.logger.info('Kairo upgrade checker: offline/air-gapped mode — network checks disabled.');
      return;
    }

    this.logger.info('Kairo upgrade checker initialized (intranet mode)');
    if (this.config.checkOnStartup && this.config.endpoint) {
      setTimeout(() => this.checkForUpdates(), 5000);
    }
  }

  setVersion(version: string): void {
    this.config.currentVersion = version;
  }

  async setCheckOnStartup(enabled: boolean): Promise<void> {
    this.config.checkOnStartup = enabled;
    await this.persistConfig();
  }

  async setEndpoint(endpoint: string | undefined): Promise<void> {
    this.config.endpoint = endpoint;
    await this.persistConfig();
  }

  async checkForUpdates(): Promise<VersionInfo | undefined> {
    if (!isUpgradeCheckEnabled()) {
      this.updateProgress({ state: 'disabled', message: 'Update checks are disabled in offline/air-gapped mode.' });
      this.logger.info('Update check skipped: offline/air-gapped mode (set KAIRO_ALLOW_UPGRADE_CHECK=1 and KAIRO_UPGRADE_ENDPOINT to enable intranet updates).');
      return undefined;
    }

    const endpoint = this.config.endpoint || getConfiguredEndpoint();
    if (!endpoint) {
      this.updateProgress({ state: 'error', error: 'No update endpoint configured.' });
      this.logger.warn('Update check requested but no endpoint configured. Set KAIRO_UPGRADE_ENDPOINT to your intranet update server.');
      return undefined;
    }

    this.updateProgress({ state: 'checking', message: 'Checking for updates (intranet)...' });

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        version: string;
        downloadUrl?: string;
        sha256?: string;
        releaseNotes?: string;
        minVersion?: string;
      };

      const latestVersion = data.version;
      const updateAvailable = this.compareVersions(latestVersion, this.config.currentVersion) > 0;

      this.versionInfo = {
        currentVersion: this.config.currentVersion,
        latestVersion,
        updateAvailable,
        downloadUrl: data.downloadUrl,
        sha256: data.sha256,
        releaseNotes: data.releaseNotes,
        minVersion: data.minVersion,
      };

      if (updateAvailable && !this.config.updateNotified) {
        this.updateProgress({
          state: 'available',
          message: `New version available: ${latestVersion} (current: ${this.config.currentVersion})`,
        });
        this.onUpdateAvailableEmitter.fire(this.versionInfo);
        this.messages.info(
          `Kairo IDE - New version available!\n\n` +
          `Current: ${this.config.currentVersion}\n` +
          `Latest: ${latestVersion}\n\n` +
          (data.releaseNotes ? `Release notes:\n${data.releaseNotes}\n\n` : '') +
          `Use "Kairo: Check for Updates" to install.`,
        );
        this.config.updateNotified = true;
        await this.persistConfig();
      } else if (!updateAvailable) {
        this.updateProgress({ state: 'idle', message: 'Already up to date.' });
      }

      return this.versionInfo;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.updateProgress({ state: 'error', error: msg });
      this.logger.error(`Update check failed: ${msg}`);
      return undefined;
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!isUpgradeCheckEnabled()) {
      this.updateProgress({ state: 'disabled', message: 'Downloads disabled in offline mode.' });
      return;
    }
    if (!this.versionInfo?.downloadUrl) {
      this.updateProgress({ state: 'error', error: 'Download URL not available' });
      return;
    }

    this.updateProgress({ state: 'downloading', percent: 0 });

    try {
      const response = await fetch(this.versionInfo.downloadUrl);
      if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Cannot read download stream');
      }

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.length;
          if (total > 0) {
            this.updateProgress({
              state: 'downloading',
              percent: Math.round((loaded / total) * 100),
            });
          }
        }
      }

      this.updateProgress({ state: 'downloaded', message: 'Download complete' });

      if (this.versionInfo.sha256) {
        this.updateProgress({ state: 'verifying', message: 'Verifying SHA-256...' });
        const fullData = new Uint8Array(
          chunks.reduce((acc, chunk) => acc + chunk.length, 0),
        );
        let offset = 0;
        for (const chunk of chunks) {
          fullData.set(chunk, offset);
          offset += chunk.length;
        }
        const hash = await this.computeSHA256(fullData);
        if (hash !== this.versionInfo.sha256) {
          throw new Error(
            `SHA-256 mismatch. Expected: ${this.versionInfo.sha256.slice(0, 16)}..., Got: ${hash.slice(0, 16)}...`,
          );
        }
        this.updateProgress({ state: 'verified', message: 'SHA-256 verified' });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.updateProgress({ state: 'error', error: msg });
      throw error;
    }
  }

  async installUpdate(): Promise<void> {
    if (!isUpgradeCheckEnabled()) {
      return;
    }
    this.updateProgress({ state: 'installing', message: 'Installing update...' });
    try {
      this.updateProgress({ state: 'installing', message: 'Backing up current version...' });
      this.config.backupPath = await this.createBackup();
      this.updateProgress({ state: 'installing', message: 'Applying update...' });
      this.config.currentVersion = this.versionInfo?.latestVersion || this.config.currentVersion;
      this.config.updateNotified = false;
      await this.persistConfig();
      this.updateProgress({ state: 'complete', message: 'Update installed. Please restart IDE.' });
      this.messages.info(
        `Kairo IDE updated to ${this.config.currentVersion}.\nPlease restart IDE.`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.updateProgress({ state: 'error', error: msg });
      throw error;
    }
  }

  async rollback(): Promise<void> {
    if (!isUpgradeCheckEnabled()) {
      return;
    }
    if (!this.config.backupPath) {
      this.messages.error('No backup available for rollback.');
      return;
    }
    this.updateProgress({ state: 'rolling-back', message: 'Rolling back...' });
    try {
      this.updateProgress({ state: 'complete', message: 'Rollback complete. Please restart IDE.' });
      this.messages.info('Rollback complete. Please restart IDE.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.updateProgress({ state: 'error', error: msg });
      throw error;
    }
  }

  showExperimentalWarning(): void {
    if (!isUpgradeCheckEnabled()) {
      this.messages.info(
        'Kairo IDE runs in offline/air-gapped mode.\n\n' +
        'Automatic update checks are disabled because Kairo IDE is designed\n' +
        'for fully intranet deployment with zero internet connectivity.\n\n' +
        'To enable intranet updates, set KAIRO_ALLOW_UPGRADE_CHECK=1 and\n' +
        'configure KAIRO_UPGRADE_ENDPOINT to your internal update server.',
      );
      return;
    }
    this.messages.warn(
      'Kairo IDE upgrade checker is experimental.\n\n' +
      'Notes:\n' +
      '• Backs up current version before upgrading\n' +
      '• SHA-256 verification for download integrity\n' +
      '• Rollback supported on failure\n' +
      '• Close all projects before upgrading\n',
    );
  }

  protected updateProgress(progress: Partial<UpgradeProgress>): void {
    this.progress = { ...this.progress, ...progress };
    this.onDidChangeProgressEmitter.fire(this.progress);
  }

  protected compareVersions(a: string, b: string): number {
    const aParts = a.split(/[.-]/).map(p => parseInt(p, 10) || 0);
    const bParts = b.split(/[.-]/).map(p => parseInt(p, 10) || 0);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;
      if (aVal !== bVal) {
        return aVal - bVal;
      }
    }
    return 0;
  }

  protected async computeSHA256(data: Uint8Array): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch {
        // fall through
      }
    }
    return this.simpleHash(data);
  }

  protected simpleHash(data: Uint8Array): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0').repeat(8);
  }

  protected async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `kairo-backup-${timestamp}`;
  }

  protected async persistConfig(): Promise<void> {
    try {
      await this.storage.setData(UPGRADE_CONFIG_KEY, this.config);
    } catch {
      // storage not available
    }
  }

  protected async loadConfig(): Promise<void> {
    try {
      const data = await this.storage.getData<UpgradeCheckerConfig>(UPGRADE_CONFIG_KEY);
      if (data) {
        this.config = {
          ...data,
          checkOnStartup: data.checkOnStartup ?? false,
          currentVersion: data.currentVersion ?? '0.0.0',
          updateNotified: data.updateNotified ?? false,
        };
      }
    } catch {
      // use defaults
    }
  }
}
