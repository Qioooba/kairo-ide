/**
 * Kairo Allowlist — validates whether an extension is approved for installation.
 *
 * In v1, we use a curated allowlist rather than an open marketplace.
 * The allowlist is loaded from ~/.kairo/allowlist.json and can be
 * pre-populated with known-good extensions.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Allowlist, AllowlistEntry, DEFAULT_ALLOWLIST, KAIRO_EXTENSIONS_DIR_NAME, KAIRO_ALLOWLIST_FILE } from '../common/kairo-extension-model';

function getAllowlistPath(): string {
  return path.join(os.homedir(), KAIRO_EXTENSIONS_DIR_NAME, KAIRO_ALLOWLIST_FILE);
}

function ensureAllowlistDir(): void {
  const dir = path.join(os.homedir(), KAIRO_EXTENSIONS_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load the allowlist from disk. If the file does not exist,
 * creates it with the default entries.
 */
export function loadAllowlist(): Allowlist {
  const allowlistPath = getAllowlistPath();
  ensureAllowlistDir();

  if (!fs.existsSync(allowlistPath)) {
    saveAllowlist(DEFAULT_ALLOWLIST, { bootstrap: true });
    return DEFAULT_ALLOWLIST;
  }

  try {
    const raw = fs.readFileSync(allowlistPath, 'utf-8');
    const parsed = JSON.parse(raw) as Allowlist;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error('Invalid allowlist format');
    }
    return parsed;
  } catch {
    // Corrupt file: rewrite defaults only when mutation is explicitly allowed.
    if (process.env.KAIRO_ALLOWLIST_MUTABLE === '1') {
      saveAllowlist(DEFAULT_ALLOWLIST, { bootstrap: true });
      return DEFAULT_ALLOWLIST;
    }
    return DEFAULT_ALLOWLIST;
  }
}

/**
 * Save the allowlist to disk.
 * Requires KAIRO_ALLOWLIST_MUTABLE=1 unless options.bootstrap is set for
 * first-time default materialization (VC-P3-7).
 */
export function saveAllowlist(allowlist: Allowlist, options?: { bootstrap?: boolean }): void {
  if (!options?.bootstrap) {
    assertAllowlistMutable();
  }
  const allowlistPath = getAllowlistPath();
  ensureAllowlistDir();
  fs.writeFileSync(allowlistPath, JSON.stringify(allowlist, null, 2), 'utf-8');
}

/**
 * Check if an extension (by publisher.name id) is on the allowlist.
 */
export function isAllowlisted(extensionId: string): boolean {
  const allowlist = loadAllowlist();
  return allowlist.entries.some(entry => entry.id === extensionId);
}

/**
 * Get the allowlist entry for an extension, or undefined if not found.
 */
export function getAllowlistEntry(extensionId: string): AllowlistEntry | undefined {
  const allowlist = loadAllowlist();
  return allowlist.entries.find(entry => entry.id === extensionId);
}

/**
 * Add an entry to the allowlist.
 * Requires KAIRO_ALLOWLIST_MUTABLE=1 so packaged installs cannot rewrite
 * the trust root via this API (VC-P3-7). Tests set the env var.
 */
export function addToAllowlist(entry: AllowlistEntry): void {
  assertAllowlistMutable();
  const allowlist = loadAllowlist();
  const existing = allowlist.entries.findIndex(e => e.id === entry.id);
  if (existing >= 0) {
    const newEntries = [...allowlist.entries];
    newEntries[existing] = entry;
    saveAllowlist({ ...allowlist, entries: newEntries });
  } else {
    saveAllowlist({ ...allowlist, entries: [...allowlist.entries, entry] });
  }
}

/**
 * Remove an entry from the allowlist.
 * Requires KAIRO_ALLOWLIST_MUTABLE=1 (see addToAllowlist).
 */
export function removeFromAllowlist(extensionId: string): void {
  assertAllowlistMutable();
  const allowlist = loadAllowlist();
  const newEntries = allowlist.entries.filter(e => e.id !== extensionId);
  saveAllowlist({ ...allowlist, entries: newEntries });
}

function assertAllowlistMutable(): void {
  if (process.env.KAIRO_ALLOWLIST_MUTABLE === '1') {
    return;
  }
  throw new Error(
    'Allowlist mutation disabled. Set KAIRO_ALLOWLIST_MUTABLE=1 to enable add/remove.',
  );
}