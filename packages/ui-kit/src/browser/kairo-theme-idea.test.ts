// Kairo IDEA theme — contract test for IntelliJ IDEA-style syntax highlighting theme.
//
// Run with:
//   pnpm --filter @kairo/ui-kit test

import { test } from 'node:test';
import assert from 'node:assert';
import { KairoIDEATheme } from './kairo-theme-idea';

test('KairoIDEATheme has the documented id and label', () => {
  assert.strictEqual(KairoIDEATheme.id, 'kairo-idea-dark');
  assert.strictEqual(KairoIDEATheme.label, 'Kairo IDEA Dark');
  assert.strictEqual(KairoIDEATheme.type, 'dark');
});

test('KairoIDEATheme.editorTheme is "kairo-idea-dark" (used by monaco)', () => {
  assert.strictEqual(KairoIDEATheme.editorTheme, 'kairo-idea-dark');
});

test('KairoIDEATheme.description mentions IntelliJ IDEA', () => {
  assert.ok(KairoIDEATheme.description);
  assert.ok(KairoIDEATheme.description.includes('IntelliJ IDEA'));
});

test('KairoIDEATheme has all required Theme properties', () => {
  assert.ok('id' in KairoIDEATheme);
  assert.ok('type' in KairoIDEATheme);
  assert.ok('label' in KairoIDEATheme);
  assert.ok('editorTheme' in KairoIDEATheme);
  assert.ok('activate' in KairoIDEATheme);
  assert.ok('deactivate' in KairoIDEATheme);
});

test('KairoIDEATheme.activate is a function', () => {
  assert.strictEqual(typeof KairoIDEATheme.activate, 'function');
});

test('KairoIDEATheme.deactivate is a function', () => {
  assert.strictEqual(typeof KairoIDEATheme.deactivate, 'function');
});

test('KairoIDEATheme.activate does not throw when called with no args', () => {
  assert.doesNotThrow(() => KairoIDEATheme.activate!());
});

test('KairoIDEATheme.activate can be called multiple times', () => {
  const activate = KairoIDEATheme.activate!;
  assert.doesNotThrow(() => {
    activate();
    activate();
    activate();
  });
});

test('KairoIDEATheme.deactivate does not throw', () => {
  assert.doesNotThrow(() => KairoIDEATheme.deactivate!());
});

test('KairoIDEATheme has no extra unexpected properties', () => {
  const keys = Object.keys(KairoIDEATheme);
  const expected = ['id', 'type', 'label', 'description', 'editorTheme', 'activate', 'deactivate'];
  for (const key of keys) {
    assert.ok(expected.includes(key), `unexpected property: ${key}`);
  }
});

test('KairoIDEATheme does not conflict with KairoDarkTheme id', () => {
  const { KairoDarkTheme } = require('./kairo-theme');
  assert.notStrictEqual(KairoIDEATheme.id, KairoDarkTheme.id);
});

test('KairoIDEATheme does not conflict with KairoDarkTheme editorTheme', () => {
  const { KairoDarkTheme } = require('./kairo-theme');
  assert.notStrictEqual(KairoIDEATheme.editorTheme, KairoDarkTheme.editorTheme);
});