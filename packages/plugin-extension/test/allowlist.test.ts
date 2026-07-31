/**
 * Allowlist unit tests.
 *
 * Run: node --require ts-node/register --test test/allowlist.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import {
  loadAllowlist,
  saveAllowlist,
  isAllowlisted,
  getAllowlistEntry,
  addToAllowlist,
  removeFromAllowlist,
} from '../src/node/kairo-allowlist';
import { DEFAULT_ALLOWLIST, KAIRO_EXTENSIONS_DIR_NAME, KAIRO_ALLOWLIST_FILE } from '../src/common/kairo-extension-model';

describe('Allowlist', () => {
  let originalAllowlist: string | null = null;
  const allowlistPath = path.join(os.homedir(), KAIRO_EXTENSIONS_DIR_NAME, KAIRO_ALLOWLIST_FILE);

  before(() => {
    if (fs.existsSync(allowlistPath)) {
      originalAllowlist = fs.readFileSync(allowlistPath, 'utf-8');
    }
    // Ensure clean state
    try { fs.unlinkSync(allowlistPath); } catch { /* ok */ }
  });

  after(() => {
    if (originalAllowlist) {
      fs.writeFileSync(allowlistPath, originalAllowlist, 'utf-8');
    } else {
      try { fs.unlinkSync(allowlistPath); } catch { /* ok */ }
    }
  });

  it('loads default allowlist when file does not exist', () => {
    const allowlist = loadAllowlist();
    assert.strictEqual(allowlist.schemaVersion, 1);
    assert.ok(allowlist.entries.length >= 9, `should have at least 9 default entries, got ${allowlist.entries.length}`);
  });

  it('saves and reloads allowlist', () => {
    const allowlist = loadAllowlist();
    // Add a custom entry
    const newEntry = { id: 'test.custom-ext', reason: 'Test extension' };
    addToAllowlist(newEntry);

    // Reload and verify
    const reloaded = loadAllowlist();
    const entry = reloaded.entries.find(e => e.id === 'test.custom-ext');
    assert.ok(entry, 'custom entry should persist');
    assert.strictEqual(entry!.reason, 'Test extension');

    // Clean up
    removeFromAllowlist('test.custom-ext');
  });

  it('checks allowlist membership', () => {
    assert.strictEqual(isAllowlisted('redhat.java'), true, 'redhat.java should be allowed');
    assert.strictEqual(isAllowlisted('EditorConfig.EditorConfig'), true, 'EditorConfig should be allowed');
    assert.strictEqual(isAllowlisted('SonarSource.sonarlint-vscode'), true, 'SonarLint should be allowed');
    assert.strictEqual(isAllowlisted('unknown.ext'), false, 'unknown should not be allowed');
  });

  it('gets allowlist entry details', () => {
    const entry = getAllowlistEntry('redhat.java');
    assert.ok(entry, 'redhat.java should have an entry');
    assert.strictEqual(entry!.id, 'redhat.java');
    assert.ok(entry!.reason.length > 0, 'should have a reason');
    assert.ok(entry!.notes, 'should have notes');
  });

  it('adds and removes entries', () => {
    addToAllowlist({ id: 'temp.add-test', reason: 'Temporary' });
    assert.strictEqual(isAllowlisted('temp.add-test'), true);

    removeFromAllowlist('temp.add-test');
    assert.strictEqual(isAllowlisted('temp.add-test'), false);
  });

  it('handles corrupted allowlist gracefully', () => {
    fs.writeFileSync(allowlistPath, 'not valid json', 'utf-8');
    const allowlist = loadAllowlist();
    // Should fall back to defaults
    assert.strictEqual(allowlist.schemaVersion, 1);
    assert.ok(allowlist.entries.length >= 9);
  });
});