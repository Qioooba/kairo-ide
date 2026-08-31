/** Shared helpers for the chapter-18 search specs. */
import { Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { laneWorkspace } from './helpers';

// Keep fixtures under the lane workspace so Windows and sandboxed agents can
// resolve them without relying on a Unix-only /tmp path.
export const W2 = process.env.KAIRO_SEARCH_ROOT || path.join(laneWorkspace('A'), 'kairo-w2search', 'ws');
export const IS_MAC = process.platform === 'darwin';
export const SEARCH_CENTER_SHORTCUT = IS_MAC ? 'Meta+Shift+F' : 'Control+Shift+F';
export const REPLACE_SHORTCUT = IS_MAC ? 'Meta+Shift+R' : 'Control+Shift+R';
export const FIND_FILE_SHORTCUT = IS_MAC ? 'Meta+Shift+O' : 'Control+Shift+N';
export const FIND_CLASS_SHORTCUT = IS_MAC ? 'Meta+O' : 'Control+N';
export const FIND_SYMBOL_SHORTCUT = IS_MAC ? 'Meta+Alt+O' : 'Control+Alt+Shift+N';
export const FIND_ACTION_SHORTCUT = IS_MAC ? 'Meta+Shift+A' : 'Control+Shift+A';

/**
 * Materialize the search fixture on demand.  Earlier runs relied on an
 * untracked `/tmp/kairo-w2search` directory left by a previous probe, which
 * made a clean Windows checkout fail with missing Util.java/flagsample.txt
 * before the product was even exercised.  Keep the fixture portable and
 * deterministic while allowing individual tests to mutate/reset their files.
 */
export function ensureSearchFixture(): void {
  fs.mkdirSync(path.join(W2, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.mkdirSync(path.join(W2, 'replace'), { recursive: true });
  const files: Record<string, string> = {
    'src/Util.java': [
      'package com.example;',
      '',
      'public class Util {',
      '    public String value() { return "util"; }',
      '}',
      '',
    ].join('\n'),
    'src/main/java/com/example/Greeter.java': [
      'package com.example;',
      '',
      'public class Greeter {',
      '    public String greet(String name) { return "Hello " + name; }',
      '}',
      '',
    ].join('\n'),
    'src/main/java/com/example/TestHolder.java': [
      'package com.example;',
      '',
      'public class TestHolder {',
      '    String value = "class";',
      '}',
      '',
    ].join('\n'),
    'readme.txt': 'This class is a plain-text fixture for search scope tests.\n',
    // Three substring matches for `tok` when whole-word mode is off
    // (AlphaToken, BetaToken, and the standalone `tok`).  The same two
    // `*Token` values plus the literal `T.KEN` produce three wildcard-regex
    // matches when the `.*` toggle is enabled.
    'flagsample.txt': 'AlphaToken BetaToken tok end T.KEN\n',
    'replace/alpha.txt': 'alpha line with foo token\nfoo appears twice: foo foo\nno target on this line\n',
    'replace/beta.txt': 'beta starts with foo\nplain middle line\nending foo\n',
    'deepsignal.txt': 'zebraunique\n',
    'node_modules/pkg/deep.js': 'const ignored = "zebraunique";\n',
    '.git/hidden.txt': 'zebraunique\n',
    'streaming.txt': Array.from({ length: 140 }, (_, i) => `streaming line ${i} contains e\n`).join(''),
  };
  const immutableFixtures = new Set(['flagsample.txt', 'deepsignal.txt', 'streaming.txt']);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(W2, relative);
    // These probes are never mutated by the specs. Re-seed them on every run
    // so an interrupted/debug session cannot change expected counts.
    if (immutableFixtures.has(relative) || !fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  const fakeClass = path.join(W2, 'WebRoot', 'WEB-INF', 'lib', 'FakeFixture.class');
  if (!fs.existsSync(fakeClass)) {
    fs.mkdirSync(path.dirname(fakeClass), { recursive: true });
    fs.writeFileSync(fakeClass, Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00]));
  }
  const huge = path.join(W2, 'replace', 'huge.txt');
  if (!fs.existsSync(huge)) {
    // Keep the file just above the replacement safety limit while avoiding a
    // multi-hundred-megabyte repository fixture.  The query occurs exactly
    // twice so the oversized-file refusal path is unambiguous.
    const padding = 'padding line for oversized replacement safety test\n';
    const repeats = Math.ceil((5 * 1024 * 1024 + 1024) / Buffer.byteLength(padding));
    fs.writeFileSync(huge, `${'zebra at start\n'}${padding.repeat(repeats)}zebra at end\n`);
  }
}

/** openIde pinned to an arbitrary workspace root (URL fragment binding). */
export async function openIdeAt(page: Page, root: string): Promise<void> {
  ensureSearchFixture();
  await page.goto(`/#${encodeURI(root)}`, { waitUntil: 'domcontentloaded' });
  const trust = page.getByRole('button', { name: /Yes, I trust|是，我信任|trust the authors$/i }).first();
  try { await trust.click({ timeout: 15_000 }); } catch { /* none */ }
  await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
}
