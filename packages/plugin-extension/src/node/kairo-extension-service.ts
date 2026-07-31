/**
 * Kairo Extension Service — backend implementation of KairoExtensionService.
 *
 * Provides the RPC-accessible methods for extension management:
 * install, uninstall, enable/disable, scan, and reload.
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  KairoExtensionService,
  KairoExtension,
  InstallResult,
  CompatibilityReport,
} from '../common/kairo-extension-protocol';
import { installFromVsix, uninstallExtension, setExtensionEnabled } from './kairo-extension-installer';
import { scanInstalledExtensions, getExtensionsDir, getExtension } from './kairo-extension-scanner';
import { generateCompatibilityReport } from './kairo-compatibility';

@injectable()
export class KairoExtensionServiceImpl implements KairoExtensionService {

  async getInstalledExtensions(): Promise<KairoExtension[]> {
    return scanInstalledExtensions();
  }

  async installFromVsix(vsixPath: string): Promise<InstallResult> {
    return installFromVsix(vsixPath);
  }

  async uninstallExtension(extensionId: string): Promise<void> {
    return uninstallExtension(extensionId);
  }

  async enableExtension(extensionId: string): Promise<void> {
    return setExtensionEnabled(extensionId, true);
  }

  async disableExtension(extensionId: string): Promise<void> {
    return setExtensionEnabled(extensionId, false);
  }

  async getExtensionsDir(): Promise<string> {
    return getExtensionsDir();
  }

  async requestReload(): Promise<void> {
    // The actual reload is triggered by the frontend via window.location.reload()
    // or Electron's app.relaunch(). This method just confirms the request.
  }

  async getCompatibilityReport(extensionId: string): Promise<CompatibilityReport> {
    const extension = getExtension(extensionId);
    if (!extension) {
      return {
        extensionId,
        score: 0,
        assessment: 'unknown',
        categoryIssues: [],
        engineIssues: ['Extension not found'],
        conflicts: [],
        recommendations: ['Install the extension first to generate a compatibility report.'],
      };
    }
    return generateCompatibilityReport(extension);
  }
}