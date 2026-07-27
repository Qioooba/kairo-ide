/**
 * Tests for JDK detection logic.
 *
 * Run with:
 *   npx ts-node --require source-map-support/register --test apps/desktop/src/jdk-check.test.ts
 *   or: pnpm --filter @kairo/desktop test:jdk
 */

import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseMajorVersion, probeJavaVersion, detectJDK17Plus } from './jdk-check';

// ─── parseMajorVersion ──────────────────────────────────────────

describe('parseMajorVersion', () => {
  it('parses JDK 17 version string', () => {
    assert.strictEqual(parseMajorVersion('17.0.9'), 17);
  });

  it('parses JDK 21 version string', () => {
    assert.strictEqual(parseMajorVersion('21.0.1'), 21);
  });

  it('parses JDK 23 version string', () => {
    assert.strictEqual(parseMajorVersion('23.0.2'), 23);
  });

  it('parses JDK 24 single-number version', () => {
    assert.strictEqual(parseMajorVersion('24'), 24);
  });

  it('parses JDK 25 early-access version', () => {
    assert.strictEqual(parseMajorVersion('25-ea'), 25);
  });

  it('parses JDK 1.8 legacy version as 8', () => {
    assert.strictEqual(parseMajorVersion('1.8.0_391'), 8);
  });

  it('parses JDK 1.6 legacy version as 6', () => {
    assert.strictEqual(parseMajorVersion('1.6.0_45'), 6);
  });

  it('parses JDK 1.7 legacy version as 7', () => {
    assert.strictEqual(parseMajorVersion('1.7.0_80'), 7);
  });

  it('returns 0 for empty string', () => {
    assert.strictEqual(parseMajorVersion(''), 0);
  });

  it('returns 0 for unparseable string', () => {
    assert.strictEqual(parseMajorVersion('not-a-version'), 0);
  });
});

// ─── probeJavaVersion ───────────────────────────────────────────

describe('probeJavaVersion', () => {
  it('returns found=false for non-existent path', () => {
    const result = probeJavaVersion('/nonexistent/path/to/java');
    assert.strictEqual(result.found, false);
  });

  it('returns found=false for a directory path', () => {
    const result = probeJavaVersion(__dirname);
    assert.strictEqual(result.found, false);
  });

  // If java is on PATH, verify it can be probed.
  it('can probe real java on PATH (if available)', () => {
    const isWin = process.platform === 'win32';
    const javaExe = isWin ? 'java.exe' : 'java';
    let javaPath: string | undefined;
    try {
      const { execSync } = require('child_process');
      const result = isWin
        ? execSync('where java', { encoding: 'utf-8', timeout: 5_000 }).trim().split(/\r?\n/)[0]
        : execSync('which java', { encoding: 'utf-8', timeout: 5_000 }).trim();
      if (result) javaPath = result.trim();
    } catch {
      // java not on PATH — skip this test.
    }

    if (!javaPath) {
      // Skip: no java on PATH.
      return;
    }

    const result = probeJavaVersion(javaPath);
    // Should find a version string; major can be anything.
    assert.strictEqual(typeof result.version, 'string');
    assert.ok((result.version?.length ?? 0) > 0, 'version string should not be empty');
    assert.strictEqual(typeof result.major, 'number');
    assert.ok((result.major ?? 0) > 0, 'major version should be > 0');
    assert.strictEqual(typeof result.javaHome, 'string');
    assert.strictEqual(typeof result.javaPath, 'string');
    // found should be true if major >= 17, false otherwise.
    if ((result.major ?? 0) >= 17) {
      assert.strictEqual(result.found, true);
    } else {
      assert.strictEqual(result.found, false);
    }
  });
});

// ─── detectJDK17Plus ────────────────────────────────────────────

describe('detectJDK17Plus', () => {
  it('returns a result (found or not)', () => {
    const result = detectJDK17Plus();
    assert.strictEqual(typeof result.found, 'boolean');
  });

  it('includes searchedPaths array', () => {
    const result = detectJDK17Plus();
    assert.ok(Array.isArray(result.searchedPaths));
    assert.ok(result.searchedPaths!.length > 0, 'should have searched at least some paths');
  });

  it('detects JDK via KAIRO_JDK_HOME if set to a valid JDK 17+', () => {
    const isWin = process.platform === 'win32';
    const javaExe = isWin ? 'java.exe' : 'java';
    let javaPath: string | undefined;
    try {
      const { execSync } = require('child_process');
      const result = isWin
        ? execSync('where java', { encoding: 'utf-8', timeout: 5_000 }).trim().split(/\r?\n/)[0]
        : execSync('which java', { encoding: 'utf-8', timeout: 5_000 }).trim();
      if (result) javaPath = result.trim();
    } catch { /* no java */ }

    if (!javaPath) return; // Skip if no java available.

    const probe = probeJavaVersion(javaPath);
    if (!probe.found || !probe.javaHome) return; // Skip if not JDK 17+.

    // Set KAIRO_JDK_HOME and verify detection picks it up.
    const prevHome = process.env.KAIRO_JDK_HOME;
    try {
      process.env.KAIRO_JDK_HOME = probe.javaHome;
      const result = detectJDK17Plus();
      assert.strictEqual(result.found, true);
      assert.strictEqual(result.major, probe.major);
    } finally {
      if (prevHome !== undefined) {
        process.env.KAIRO_JDK_HOME = prevHome;
      } else {
        delete process.env.KAIRO_JDK_HOME;
      }
    }
  });

  it('detects JDK via JAVA_HOME if set to a valid JDK 17+', () => {
    const isWin = process.platform === 'win32';
    const javaExe = isWin ? 'java.exe' : 'java';
    let javaPath: string | undefined;
    try {
      const { execSync } = require('child_process');
      const result = isWin
        ? execSync('where java', { encoding: 'utf-8', timeout: 5_000 }).trim().split(/\r?\n/)[0]
        : execSync('which java', { encoding: 'utf-8', timeout: 5_000 }).trim();
      if (result) javaPath = result.trim();
    } catch { /* no java */ }

    if (!javaPath) return;

    const probe = probeJavaVersion(javaPath);
    if (!probe.found || !probe.javaHome) return;

    // Set JAVA_HOME and verify detection.
    const prevHome = process.env.JAVA_HOME;
    const prevKairo = process.env.KAIRO_JDK_HOME;
    // Ensure KAIRO_JDK_HOME is not set so it falls through to JAVA_HOME.
    delete process.env.KAIRO_JDK_HOME;
    try {
      process.env.JAVA_HOME = probe.javaHome;
      const result = detectJDK17Plus();
      assert.strictEqual(result.found, true);
    } finally {
      if (prevHome !== undefined) {
        process.env.JAVA_HOME = prevHome;
      } else {
        delete process.env.JAVA_HOME;
      }
      if (prevKairo !== undefined) {
        process.env.KAIRO_JDK_HOME = prevKairo;
      } else {
        delete process.env.KAIRO_JDK_HOME;
      }
    }
  });
});