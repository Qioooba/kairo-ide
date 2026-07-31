/**
 * Kairo Extension Scanner — discovers installed extensions and
 * builds the KairoExtension[] list from the manifest and on-disk state.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  KairoExtension,
  KAIRO_EXTENSIONS_DIR_NAME,
  KAIRO_EXTENSIONS_SUBDIR,
} from '../common/kairo-extension-model';
import { loadExtensionManifest } from './kairo-extension-installer';

function getExtensionsRoot(): string {
  return path.join(os.homedir(), KAIRO_EXTENSIONS_DIR_NAME, KAIRO_EXTENSIONS_SUBDIR);
}

/**
 * Scan all installed extensions and return their current state.
 * Combines the manifest (metadata) with on-disk inspection.
 */
export function scanInstalledExtensions(): KairoExtension[] {
  const manifest = loadExtensionManifest();
  const extensionsRoot = getExtensionsRoot();
  const result: KairoExtension[] = [];

  for (const [extensionId, entry] of Object.entries(manifest.extensions)) {
    const extensionDir = path.join(extensionsRoot, `${extensionId}-${entry.version}`);
    const packageJsonPath = path.join(extensionDir, 'package.json');

    let pkg: Record<string, unknown> | null = null;
    try {
      if (fs.existsSync(packageJsonPath)) {
        pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      }
    } catch {
      // Extension directory may be missing — still show it with manifest data
    }

    const kairoExt: KairoExtension = {
      id: extensionId,
      publisher: (pkg?.publisher as string) || extensionId.split('.')[0] || 'unknown',
      name: (pkg?.name as string) || extensionId.split('.').slice(1).join('.') || extensionId,
      version: entry.version,
      displayName: (pkg?.displayName as string) || (pkg?.name as string) || extensionId,
      description: (pkg?.description as string) || '',
      icon: pkg?.icon as string | undefined,
      extensionPath: extensionDir,
      enabled: entry.enabled,
      installedAt: entry.installedAt,
      categories: Array.isArray(pkg?.categories) ? (pkg!.categories as string[]) : [],
      activationEvents: Array.isArray(pkg?.activationEvents)
        ? (pkg!.activationEvents as string[])
        : ['*'],
      engineVersion: (pkg?.engines as Record<string, string> | undefined)?.vscode,
      allowlisted: entry.allowlisted,
      verified: entry.verified,
    };

    result.push(kairoExt);
  }

  return result;
}

/**
 * Get a single extension by id.
 */
export function getExtension(extensionId: string): KairoExtension | undefined {
  return scanInstalledExtensions().find(ext => ext.id === extensionId);
}

/**
 * Get the extensions directory path.
 */
export function getExtensionsDir(): string {
  const dir = getExtensionsRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}