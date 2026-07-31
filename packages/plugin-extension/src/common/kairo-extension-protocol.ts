/**
 * Kairo Extension Protocol — RPC interface between the frontend
 * Extensions View and the backend extension manager.
 *
 * Uses Theia's JsonRpcServer pattern so the frontend can call
 * backend methods over the existing Theia RPC channel.
 */

import { KairoExtension, InstallResult } from './kairo-extension-model';

export { KairoExtension, InstallResult };

/**
 * Compatibility report for an extension (generated server-side).
 */
export interface CompatibilityReport {
  readonly extensionId: string;
  readonly score: number;
  readonly assessment: 'compatible' | 'partial' | 'incompatible' | 'unknown';
  readonly categoryIssues: string[];
  readonly engineIssues: string[];
  readonly conflicts: ConflictInfo[];
  readonly recommendations: string[];
}

export interface ConflictInfo {
  readonly kairoFeature: string;
  readonly recommendation: string;
}

/**
 * The backend service that manages extension lifecycle.
 * The frontend calls these methods via RPC proxy.
 */
export const KairoExtensionService = Symbol('KairoExtensionService');
export interface KairoExtensionService {
  /**
   * Get all installed extensions with their current status.
   */
  getInstalledExtensions(): Promise<KairoExtension[]>;

  /**
   * Install an extension from a local .vsix file path.
   * The file is validated, allowlist-checked, extracted, and registered.
   */
  installFromVsix(vsixPath: string): Promise<InstallResult>;

  /**
   * Uninstall an extension by id. Removes its directory and manifest entry.
   */
  uninstallExtension(extensionId: string): Promise<void>;

  /**
   * Enable an installed extension. It will be loaded on next restart.
   */
  enableExtension(extensionId: string): Promise<void>;

  /**
   * Disable an installed extension. It will be unloaded on next restart.
   */
  disableExtension(extensionId: string): Promise<void>;

  /**
   * Get the path to the extensions directory.
   */
  getExtensionsDir(): Promise<string>;

  /**
   * Reload the extension host (request restart).
   * Returns true if the IDE should prompt for restart.
   */
  requestReload(): Promise<void>;

  /**
   * Generate a compatibility report for a specific extension.
   */
  getCompatibilityReport(extensionId: string): Promise<CompatibilityReport>;
}

/**
 * Frontend event: fired when extensions change (install/uninstall/enable/disable).
 */
export interface ExtensionChangeEvent {
  readonly type: 'installed' | 'uninstalled' | 'enabled' | 'disabled';
  readonly extensionId: string;
  readonly extension?: KairoExtension;
}

export const KairoExtensionClient = Symbol('KairoExtensionClient');
export interface KairoExtensionClient {
  onDidChangeExtensions(event: ExtensionChangeEvent): void;
}