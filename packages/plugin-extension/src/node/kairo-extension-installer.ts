/**
 * Kairo Extension Installer — handles .vsix file validation, extraction,
 * and registration of VS Code extensions into the local extensions directory.
 *
 * A .vsix file is a ZIP archive containing:
 *   - extension/package.json   (the extension manifest)
 *   - extension/               (all extension files)
 *   - [Content_Types].xml
 *   - extension.vsixmanifest
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import * as semver from 'semver';
import {
  KairoExtension,
  ExtensionManifest,
  InstallResult,
  InstallErrorCode,
  KAIRO_EXTENSIONS_DIR_NAME,
  KAIRO_EXTENSIONS_SUBDIR,
  KAIRO_EXTENSIONS_MANIFEST,
} from '../common/kairo-extension-model';
import { isAllowlisted, getAllowlistEntry } from './kairo-allowlist';

/** Roughly maps to the VS Code API surface that Theia 1.73.1 supports */
const SUPPORTED_ENGINE_VERSION = '^1.73.0';

/** Unix symlink mode bits in ZIP external attributes (upper 16 bits). */
const ZIP_S_IFLNK = 0xa000;

function getExtensionsRoot(): string {
  return path.join(os.homedir(), KAIRO_EXTENSIONS_DIR_NAME, KAIRO_EXTENSIONS_SUBDIR);
}

function getManifestPath(): string {
  return path.join(os.homedir(), KAIRO_EXTENSIONS_DIR_NAME, KAIRO_EXTENSIONS_MANIFEST);
}

function ensureDirs(): void {
  const dir = getExtensionsRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Resolve a ZIP entry path under targetDir, rejecting Zip Slip /
 * absolute paths / null bytes. Exported for unit tests.
 */
export function resolveSafeZipEntryPath(targetDir: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\0')) {
    throw new Error(`Invalid zip entry path: ${relativePath}`);
  }
  // Reject absolute paths (POSIX and Windows) before join/resolve.
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith('\\\\')) {
    throw new Error(`Zip entry uses absolute path: ${relativePath}`);
  }
  const resolvedTarget = path.resolve(targetDir);
  const resolved = path.resolve(targetDir, relativePath);
  const targetPrefix = resolvedTarget.endsWith(path.sep) ? resolvedTarget : resolvedTarget + path.sep;
  if (resolved !== resolvedTarget && !resolved.startsWith(targetPrefix)) {
    throw new Error(`Zip Slip rejected: ${relativePath}`);
  }
  return resolved;
}

function isZipSymlinkEntry(entry: AdmZip.IZipEntry): boolean {
  // adm-zip stores Unix mode in the high 16 bits of attr when present.
  const mode = (entry.attr >>> 16) & 0xffff;
  return (mode & ZIP_S_IFLNK) === ZIP_S_IFLNK;
}

/**
 * Parse a package.json from a VS Code extension and validate required fields.
 */
interface VsCodePackageJson {
  name: string;
  publisher: string;
  version: string;
  displayName?: string;
  description?: string;
  icon?: string;
  categories?: string[];
  activationEvents?: string[];
  engines?: { vscode?: string };
  contributes?: Record<string, unknown>;
}

function parseExtensionManifest(raw: string): VsCodePackageJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid package.json: not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid package.json: not an object');
  }
  const pkg = parsed as Record<string, unknown>;
  if (typeof pkg.name !== 'string' || !pkg.name) {
    throw new Error('Invalid package.json: missing "name"');
  }
  if (typeof pkg.publisher !== 'string' || !pkg.publisher) {
    throw new Error('Invalid package.json: missing "publisher"');
  }
  if (typeof pkg.version !== 'string' || !pkg.version) {
    throw new Error('Invalid package.json: missing "version"');
  }
  return pkg as unknown as VsCodePackageJson;
}

/**
 * Install an extension from a .vsix file.
 *
 * Steps:
 * 1. Validate the .vsix is a valid ZIP
 * 2. Read extension/package.json from the ZIP
 * 3. Validate required fields (name, publisher, version)
 * 4. Check against the allowlist (strict — non-allowlisted rejected)
 * 5. Check if already installed
 * 6. Extract to ~/.kairo/extensions/<publisher>.<name>-<version>/
 * 7. Update the extensions manifest
 */
export function installFromVsix(vsixPath: string): InstallResult {
  // 1. Validate file exists
  if (!fs.existsSync(vsixPath)) {
    return { success: false, error: `File not found: ${vsixPath}`, errorCode: InstallErrorCode.INVALID_VSIX };
  }
  if (!vsixPath.toLowerCase().endsWith('.vsix')) {
    return { success: false, error: 'File must have .vsix extension', errorCode: InstallErrorCode.INVALID_VSIX };
  }

  // 2. Open as ZIP
  let zip: AdmZip;
  try {
    zip = new AdmZip(vsixPath);
  } catch {
    return { success: false, error: 'Failed to open .vsix file as ZIP archive', errorCode: InstallErrorCode.INVALID_VSIX };
  }

  // 3. Read extension/package.json
  const packageJsonEntry = zip.getEntry('extension/package.json');
  if (!packageJsonEntry) {
    return { success: false, error: 'Missing extension/package.json in .vsix', errorCode: InstallErrorCode.MISSING_MANIFEST };
  }

  let pkg: VsCodePackageJson;
  try {
    const raw = packageJsonEntry.getData().toString('utf-8');
    pkg = parseExtensionManifest(raw);
  } catch (e: any) {
    return { success: false, error: e.message || 'Failed to parse package.json', errorCode: InstallErrorCode.MISSING_MANIFEST };
  }

  const extensionId = `${pkg.publisher}.${pkg.name}`;

  // 4. Check engine compatibility
  if (pkg.engines?.vscode) {
    const engineReq = pkg.engines.vscode;
    // Theia advertises as VS Code engine version 1.73.x
    if (!semver.satisfies('1.73.1', engineReq)) {
      return {
        success: false,
        error: `Extension requires VS Code ${engineReq}, but Kairo supports ${SUPPORTED_ENGINE_VERSION}. Installation may succeed but the extension may not work correctly.`,
        errorCode: InstallErrorCode.ENGINE_NOT_SUPPORTED,
      };
    }
  }

  // 5. Strict allowlist — unsigned non-allowlisted extensions are refused (VC-P0-2).
  // Signature/hash PKI is not wired; the allowlist is the gate.
  const allowlisted = isAllowlisted(extensionId);
  if (!allowlisted) {
    return {
      success: false,
      error: `Extension "${extensionId}" is not on the allowlist.`,
      errorCode: InstallErrorCode.NOT_ALLOWLISTED,
    };
  }
  const allowlistEntry = getAllowlistEntry(extensionId);
  if (allowlistEntry?.verifiedVersionRange && !semver.satisfies(pkg.version, allowlistEntry.verifiedVersionRange)) {
    return {
      success: false,
      error: `Extension "${extensionId}" version ${pkg.version} is outside the allowlisted range ${allowlistEntry.verifiedVersionRange}.`,
      errorCode: InstallErrorCode.NOT_ALLOWLISTED,
    };
  }
  if (allowlistEntry?.sha256) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(vsixPath)).digest('hex');
    if (digest.toLowerCase() !== allowlistEntry.sha256.toLowerCase()) {
      return {
        success: false,
        error: `Extension "${extensionId}" .vsix SHA-256 mismatch (expected ${allowlistEntry.sha256}, got ${digest}).`,
        errorCode: InstallErrorCode.NOT_ALLOWLISTED,
      };
    }
  }

  // 6. Check if already installed
  ensureDirs();
  const targetDir = path.join(getExtensionsRoot(), `${extensionId}-${pkg.version}`);
  if (fs.existsSync(targetDir)) {
    return { success: false, error: `Extension "${extensionId}" version ${pkg.version} is already installed`, errorCode: InstallErrorCode.ALREADY_INSTALLED };
  }

  // 7. Extract the extension/ directory contents (Zip Slip–safe)
  try {
    const entries = zip.getEntries();
    for (const entry of entries) {
      const entryName = entry.entryName.replace(/\\/g, '/');
      // Only extract files under extension/
      if (!entryName.startsWith('extension/')) {
        continue;
      }
      if (isZipSymlinkEntry(entry)) {
        throw new Error(`Symlink zip entries are not allowed: ${entryName}`);
      }
      // Skip the extension/ prefix
      const relativePath = entryName.substring('extension/'.length);
      if (!relativePath) {
        continue;
      }
      // Directory markers end with /
      if (relativePath.endsWith('/') || entry.isDirectory) {
        const dirRel = relativePath.replace(/\/$/, '');
        if (dirRel) {
          fs.mkdirSync(resolveSafeZipEntryPath(targetDir, dirRel), { recursive: true });
        }
        continue;
      }
      const targetPath = resolveSafeZipEntryPath(targetDir, relativePath);
      const dir = path.dirname(targetPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(targetPath, entry.getData());
    }
  } catch (e: any) {
    // Clean up on failure
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch { /* best effort */ }
    return { success: false, error: `Failed to extract extension: ${e.message}`, errorCode: InstallErrorCode.FS_ERROR };
  }

  // 8. Update manifest
  const manifest = loadExtensionManifest();
  manifest.extensions[extensionId] = {
    id: extensionId,
    version: pkg.version,
    enabled: true,
    installedAt: new Date().toISOString(),
    allowlisted: true,
    verified: !!allowlistEntry,
  };
  saveExtensionManifest(manifest);

  // 9. Build KairoExtension result
  const extension: KairoExtension = {
    id: extensionId,
    publisher: pkg.publisher,
    name: pkg.name,
    version: pkg.version,
    displayName: pkg.displayName || pkg.name,
    description: pkg.description || '',
    icon: pkg.icon,
    extensionPath: targetDir,
    enabled: true,
    installedAt: manifest.extensions[extensionId].installedAt,
    categories: pkg.categories || [],
    activationEvents: pkg.activationEvents || ['*'],
    engineVersion: pkg.engines?.vscode,
    allowlisted: true,
    verified: !!allowlistEntry,
  };

  return { success: true, extension };
}

/**
 * Verify a .vsix file without installing — check if it's valid and can be installed.
 */
export function verifyVsix(vsixPath: string): { valid: boolean; extensionId?: string; error?: string } {
  if (!fs.existsSync(vsixPath)) {
    return { valid: false, error: 'File not found' };
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(vsixPath);
  } catch {
    return { valid: false, error: 'Not a valid ZIP archive' };
  }

  const packageJsonEntry = zip.getEntry('extension/package.json');
  if (!packageJsonEntry) {
    return { valid: false, error: 'Missing extension/package.json' };
  }

  try {
    const raw = packageJsonEntry.getData().toString('utf-8');
    const pkg = parseExtensionManifest(raw);
    return { valid: true, extensionId: `${pkg.publisher}.${pkg.name}` };
  } catch (e: any) {
    return { valid: false, error: e.message };
  }
}

// ── Manifest persistence ──────────────────────────────────────────

export function loadExtensionManifest(): ExtensionManifest {
  const manifestPath = getManifestPath();
  if (!fs.existsSync(manifestPath)) {
    return { schemaVersion: 1, extensions: {} };
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as ExtensionManifest;
  } catch {
    return { schemaVersion: 1, extensions: {} };
  }
}

export function saveExtensionManifest(manifest: ExtensionManifest): void {
  const manifestPath = getManifestPath();
  const dir = path.dirname(manifestPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Uninstall an extension: remove its directory and manifest entry.
 */
export function uninstallExtension(extensionId: string): void {
  const manifest = loadExtensionManifest();
  const entry = manifest.extensions[extensionId];
  if (!entry) {
    throw new Error(`Extension "${extensionId}" is not installed`);
  }

  const targetDir = path.join(getExtensionsRoot(), `${extensionId}-${entry.version}`);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  delete manifest.extensions[extensionId];
  saveExtensionManifest(manifest);
}

/**
 * Update the enabled/disabled status of an extension.
 */
export function setExtensionEnabled(extensionId: string, enabled: boolean): void {
  const manifest = loadExtensionManifest();
  const entry = manifest.extensions[extensionId];
  if (!entry) {
    throw new Error(`Extension "${extensionId}" is not installed`);
  }
  entry.enabled = enabled;
  saveExtensionManifest(manifest);
}
