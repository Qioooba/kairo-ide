/**
 * Extension Scanner unit tests.
 *
 * Run: node --require ts-node/register --test test/extension-scanner.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { scanInstalledExtensions, getExtensionsDir } from '../src/node/kairo-extension-scanner';
import { loadExtensionManifest, saveExtensionManifest } from '../src/node/kairo-extension-installer';
import { KAIRO_EXTENSIONS_DIR_NAME, KAIRO_EXTENSIONS_MANIFEST } from '../src/common/kairo-extension-model';

describe('Extension Scanner', () => {
  let originalManifest: string | null = null;
  const manifestPath = path.join(os.homedir(), KAIRO_EXTENSIONS_DIR_NAME, KAIRO_EXTENSIONS_MANIFEST);

  before(() => {
    if (fs.existsSync(manifestPath)) {
      originalManifest = fs.readFileSync(manifestPath, 'utf-8');
    }
  });

  after(() => {
    if (originalManifest) {
      saveExtensionManifest(JSON.parse(originalManifest));
    } else {
      try { fs.unlinkSync(manifestPath); } catch { /* ok */ }
    }
  });

  it('returns empty list when no extensions installed', () => {
    // Clear manifest
    saveExtensionManifest({ schemaVersion: 1, extensions: {} });
    const extensions = scanInstalledExtensions();
    assert.strictEqual(extensions.length, 0);
  });

  it('scans extensions with mock manifest entries', () => {
    const mockManifest = {
      schemaVersion: 1 as const,
      extensions: {
        'test.mock-ext': {
          id: 'test.mock-ext',
          version: '2.0.0',
          enabled: true,
          installedAt: '2026-07-30T00:00:00.000Z',
          allowlisted: false,
          verified: false,
        },
        'test.mock-disabled': {
          id: 'test.mock-disabled',
          version: '1.5.0',
          enabled: false,
          installedAt: '2026-07-29T00:00:00.000Z',
          allowlisted: true,
          verified: true,
        },
      },
    };
    saveExtensionManifest(mockManifest);

    const extensions = scanInstalledExtensions();
    assert.strictEqual(extensions.length, 2);

    const enabled = extensions.find(e => e.id === 'test.mock-ext');
    const disabled = extensions.find(e => e.id === 'test.mock-disabled');

    assert.ok(enabled, 'mock-ext should be found');
    assert.strictEqual(enabled!.enabled, true);
    assert.strictEqual(enabled!.version, '2.0.0');
    assert.strictEqual(enabled!.allowlisted, false);

    assert.ok(disabled, 'mock-disabled should be found');
    assert.strictEqual(disabled!.enabled, false);
    assert.strictEqual(disabled!.version, '1.5.0');
    assert.strictEqual(disabled!.allowlisted, true);
    assert.strictEqual(disabled!.verified, true);
  });

  it('getExtensionsDir returns valid path', () => {
    const dir = getExtensionsDir();
    assert.ok(dir.includes(KAIRO_EXTENSIONS_DIR_NAME));
    assert.ok(fs.existsSync(dir), 'extensions directory should exist');
  });
});