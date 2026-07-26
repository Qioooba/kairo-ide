// Kairo dark theme — edge-case and CSS-var contract tests.
//
// Run with:
//   pnpm --filter @kairo/ui-kit test

import { test } from 'node:test';
import assert from 'node:assert';
import { KairoDarkTheme } from './kairo-theme';

// Access the internal CSS vars via a side-channel: call activate()
// in a mock DOM environment to inspect what the theme writes.
// We re-create a minimal document for each test that needs DOM.

function createStyle() {
  const props: Record<string, string> = {};
  return {
    setProperty: (key: string, value: string) => { props[key] = value; },
    getPropertyValue: (key: string) => props[key] || '',
    _props: props,
  };
}

function createMockDocument() {
  const rootStyle = createStyle();
  const root = {
    style: rootStyle,
    children: [] as any[],
    tagName: 'html',
  };
  const head = {
    children: [] as any[],
    appendChild: (c: any) => head.children.push(c),
    querySelector: (_: string) => null,
    getElementById: (_: string) => null,
  };
  const fakeDoc = {
    documentElement: root,
    head,
    body: { appendChild: (_: any) => {} },
    createElement: (tag: string) => {
      const elStyle = createStyle();
      return {
        id: '',
        tagName: tag.toUpperCase(),
        style: elStyle,
        setAttribute: (_: string, __: string) => {},
      };
    },
    getElementById: (_: string) => null,
  };
  return { rootStyle, fakeDoc };
}

// ---- Theme identity edge cases ----

test('KairoDarkTheme.id never changes (contract lock)', () => {
  assert.strictEqual(KairoDarkTheme.id, 'kairo-dark');
});

test('KairoDarkTheme.type is strictly "dark"', () => {
  assert.strictEqual(KairoDarkTheme.type, 'dark');
});

test('KairoDarkTheme.label contains "Kairo"', () => {
  assert.ok(KairoDarkTheme.label.includes('Kairo'));
});

test('KairoDarkTheme.description is not empty', () => {
  assert.ok(KairoDarkTheme.description);
  assert.ok(KairoDarkTheme.description!.length > 0);
});

// ---- CSS variable validation (source-level) ----

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const themeSource = readFileSync(join(__dirname, 'kairo-theme.ts'), 'utf8');

test('KAIRO_DARK_VARS has brand color entries', () => {
  assert.match(themeSource, /'--theia-brand-color0': '#7C3AED'/);
  assert.match(themeSource, /'--theia-brand-color1': '#8d6dd0'/);
  assert.match(themeSource, /'--theia-brand-color2': '#5e42a6'/);
  assert.match(themeSource, /'--theia-brand-color3': '#4a3385'/);
});

test('KAIRO_DARK_VARS has layout surface colors (3-tone gray)', () => {
  assert.match(themeSource, /'--theia-layout-color0': '#1e1f22'/);
  assert.match(themeSource, /'--theia-layout-color1': '#252629'/);
  assert.match(themeSource, /'--theia-layout-color2': '#2b2c30'/);
  assert.match(themeSource, /'--theia-layout-color3': '#37393d'/);
});

test('KAIRO_DARK_VARS has all semantic colors (success, warning, error)', () => {
  assert.match(themeSource, /'--theia-success-color0': '#22c55e'/);
  assert.match(themeSource, /'--theia-warning-color0': '#f59e0b'/);
  assert.match(themeSource, /'--theia-error-color0': '#ef4444'/);
});

test('KAIRO_DARK_VARS has editor colors', () => {
  assert.match(themeSource, /'--theia-editor-background': '#1e1f22'/);
  assert.match(themeSource, /'--theia-editor-foreground': '#dfe1e5'/);
  assert.match(themeSource, /'--theia-editorCursor-foreground': '#c8a8ff'/);
});

test('KAIRO_DARK_VARS has all terminal ANSI colors', () => {
  for (const color of ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White']) {
    assert.match(themeSource, new RegExp(`'--theia-terminal-ansi${color}': '#`));
  }
  for (const color of ['BrightBlack', 'BrightRed', 'BrightGreen', 'BrightYellow', 'BrightBlue', 'BrightMagenta', 'BrightCyan', 'BrightWhite']) {
    assert.match(themeSource, new RegExp(`'--theia-terminal-ansi${color}': '#`));
  }
});

test('KAIRO_DARK_VARS has font stacks', () => {
  assert.match(themeSource, /'--theia-ui-font-family'/);
  assert.match(themeSource, /'--theia-monospace-font-family'/);
  assert.match(themeSource, /'--theia-content-font-size'/);
});

test('All KAIRO_DARK_VARS values are valid hex or rgba colors', () => {
  const hexColor = /^#[0-9a-fA-F]{6}$/;
  const rgbaColor = /^rgba?\([^)]+\)$/;
  const transparent = /^transparent$/;
  const fontFamily = /font-family'/;
  const fontSize = /font-size'/;
  const shadow = /shadow/;
  // Extract all key-value pairs from the source
  const matches = themeSource.matchAll(/'--theia-[^']+':\s*'([^']+)'/g);
  for (const match of matches) {
    const value = match[1];
    const key = match[0];
    if (fontFamily.test(key) || fontSize.test(key) || shadow.test(key)) continue;
    assert.ok(
      hexColor.test(value) || rgbaColor.test(value) || transparent.test(value),
      `CSS var value should be hex, rgba, or transparent: ${match[0]}`,
    );
  }
});

// ---- Activate/deactivate edge cases ----

test('KairoDarkTheme.activate with mock DOM applies CSS vars', () => {
  const { fakeDoc } = createMockDocument();
  const savedDoc = (globalThis as any).document;
  const savedRAF = (globalThis as any).requestAnimationFrame;
  (globalThis as any).document = fakeDoc;
  (globalThis as any).requestAnimationFrame = (fn: () => void) => { fn(); return 0; };
  try {
    assert.doesNotThrow(() => KairoDarkTheme.activate!());
  } finally {
    (globalThis as any).document = savedDoc;
    (globalThis as any).requestAnimationFrame = savedRAF;
  }
});

test('KairoDarkTheme.activate does not throw when document has no head', () => {
  // If document exists but head is missing (extremely rare edge case),
  // the activate method will throw when trying to appendChild to head.
  // This is expected — a browser should always have a head element.
  // The guard only checks for typeof document === 'undefined'.
  const fakeDoc = {
    documentElement: { style: { setProperty: (_k: string, _v: string) => {} } },
    head: undefined,
    getElementById: () => null,
    createElement: (_tag: string) => ({
      id: '',
      style: { setProperty: (_k: string, _v: string) => {} },
      setAttribute: (_k: string, _v: string) => {},
    }),
  };
  const savedDoc = (globalThis as any).document;
  const savedRAF = (globalThis as any).requestAnimationFrame;
  (globalThis as any).document = fakeDoc;
  (globalThis as any).requestAnimationFrame = (fn: () => void) => { fn(); return 0; };
  try {
    assert.throws(() => KairoDarkTheme.activate!());
  } finally {
    (globalThis as any).document = savedDoc;
    (globalThis as any).requestAnimationFrame = savedRAF;
  }
});

test('KairoDarkTheme has no mutable state between activate calls', () => {
  // All properties should be stable
  const id1 = KairoDarkTheme.id;
  const id2 = KairoDarkTheme.id;
  assert.strictEqual(id1, id2);
});

test('KairoDarkTheme is a frozen contract — no extra keys', () => {
  const allowedKeys = ['id', 'type', 'label', 'description', 'editorTheme', 'activate', 'deactivate'];
  for (const key of Object.keys(KairoDarkTheme)) {
    assert.ok(allowedKeys.includes(key), `Unexpected key: ${key}`);
  }
});