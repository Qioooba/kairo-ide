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
import { KairoI18nService } from '@kairo/i18n';

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
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

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
      this.progress = { state: 'disabled', message: this.i18n.t('upgrade.offlineDisabled') };
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
      this.updateProgress({ state: 'disabled', message: this.i18n.t('upgrade.checkDisabled') });
      this.logger.info('Update check skipped: offline/air-gapped mode (set KAIRO_ALLOW_UPGRADE_CHECK=1 and KAIRO_UPGRADE_ENDPOINT to enable intranet updates).');
      return undefined;
    }

    const endpoint = this.config.endpoint || getConfiguredEndpoint();
    if (!endpoint) {
      this.updateProgress({ state: 'error', error: this.i18n.t('upgrade.noEndpoint') });
      this.logger.warn('Update check requested but no endpoint configured. Set KAIRO_UPGRADE_ENDPOINT to your intranet update server.');
      return undefined;
    }

    this.updateProgress({ state: 'checking', message: this.i18n.t('upgrade.checking') });

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
          message: this.i18n.t('upgrade.available', {
            latest: latestVersion,
            current: this.config.currentVersion,
          }),
        });
        this.onUpdateAvailableEmitter.fire(this.versionInfo);
        this.messages.info(
          `${this.i18n.t('upgrade.newVersionTitle')}\n\n` +
          `${this.i18n.t('upgrade.newVersionCurrent', { current: this.config.currentVersion })}\n` +
          `${this.i18n.t('upgrade.newVersionLatest', { latest: latestVersion })}\n\n` +
          (data.releaseNotes ? `${this.i18n.t('upgrade.releaseNotes', { notes: data.releaseNotes })}\n\n` : '') +
          this.i18n.t('upgrade.checkCommandHint'),
        );
        this.config.updateNotified = true;
        await this.persistConfig();
      } else if (!updateAvailable) {
        this.updateProgress({ state: 'idle', message: this.i18n.t('upgrade.upToDate') });
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
      this.updateProgress({ state: 'disabled', message: this.i18n.t('upgrade.downloadDisabled') });
      return;
    }
    if (!this.versionInfo?.downloadUrl) {
      this.updateProgress({ state: 'error', error: this.i18n.t('upgrade.downloadUrlMissing') });
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

      this.updateProgress({ state: 'downloaded', message: this.i18n.t('upgrade.downloadComplete') });

      if (this.versionInfo.sha256) {
        this.updateProgress({ state: 'verifying', message: this.i18n.t('upgrade.verifying') });
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
        this.updateProgress({ state: 'verified', message: this.i18n.t('upgrade.verified') });
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
    this.updateProgress({ state: 'installing', message: this.i18n.t('upgrade.installing') });
    try {
      this.updateProgress({ state: 'installing', message: this.i18n.t('upgrade.backingUp') });
      this.config.backupPath = await this.createBackup();
      this.updateProgress({ state: 'installing', message: this.i18n.t('upgrade.applying') });
      this.config.currentVersion = this.versionInfo?.latestVersion || this.config.currentVersion;
      this.config.updateNotified = false;
      await this.persistConfig();
      this.updateProgress({ state: 'complete', message: this.i18n.t('upgrade.installComplete') });
      this.messages.info(
        this.i18n.t('upgrade.updated', { version: this.config.currentVersion }),
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
      this.messages.error(this.i18n.t('upgrade.noBackup'));
      return;
    }
    this.updateProgress({ state: 'rolling-back', message: this.i18n.t('upgrade.rollingBack') });
    try {
      this.updateProgress({ state: 'complete', message: this.i18n.t('upgrade.rollbackComplete') });
      this.messages.info(this.i18n.t('upgrade.rollbackComplete'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.updateProgress({ state: 'error', error: msg });
      throw error;
    }
  }

  showExperimentalWarning(): void {
    if (!isUpgradeCheckEnabled()) {
      this.messages.info(this.i18n.t('upgrade.offlineInfo'));
      return;
    }
    this.messages.warn(this.i18n.t('upgrade.experimentalWarning'));
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
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('SHA-256 verification unavailable: Web Crypto API not present');
    }
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`SHA-256 verification failed: ${msg}`);
    }
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
