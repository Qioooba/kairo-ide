// Kairo dark theme — extended contract test for design tokens.
//
// Run with:
//   pnpm --filter @kairo/ui-kit test
//   (or)  node --require ts-node/register --require source-map-support/register --test src/browser/kairo-theme-extended.test.ts

import { test } from 'node:test';
import assert from 'node:assert';
import { KairoDarkTheme } from './kairo-theme';

test('KairoDarkTheme.type is "dark"', () => {
  assert.strictEqual(KairoDarkTheme.type, 'dark');
});

test('KairoDarkTheme.description is set', () => {
  assert.ok(KairoDarkTheme.description);
  assert.ok(KairoDarkTheme.description.includes('dark'));
});

test('KairoDarkTheme has all required Theme properties', () => {
  assert.ok('id' in KairoDarkTheme);
  assert.ok('type' in KairoDarkTheme);
  assert.ok('label' in KairoDarkTheme);
  assert.ok('editorTheme' in KairoDarkTheme);
  assert.ok('activate' in KairoDarkTheme);
  assert.ok('deactivate' in KairoDarkTheme);
});

test('KairoDarkTheme.id is a non-empty string', () => {
  assert.strictEqual(typeof KairoDarkTheme.id, 'string');
  assert.ok(KairoDarkTheme.id.length > 0);
});

test('KairoDarkTheme.label is a non-empty string', () => {
  assert.strictEqual(typeof KairoDarkTheme.label, 'string');
  assert.ok(KairoDarkTheme.label.length > 0);
});

test('KairoDarkTheme.editorTheme matches id', () => {
  assert.strictEqual(KairoDarkTheme.editorTheme, KairoDarkTheme.id);
});

test('KairoDarkTheme.activate is a function', () => {
  assert.strictEqual(typeof KairoDarkTheme.activate, 'function');
});

test('KairoDarkTheme.deactivate is a function', () => {
  assert.strictEqual(typeof KairoDarkTheme.deactivate, 'function');
});

test('KairoDarkTheme.activate does not throw when called with no args', () => {
  assert.doesNotThrow(() => KairoDarkTheme.activate!());
});

test('KairoDarkTheme.activate can be called multiple times', () => {
  const activate = KairoDarkTheme.activate!;
  assert.doesNotThrow(() => {
    activate();
    activate();
    activate();
  });
});

test('KairoDarkTheme.deactivate does not throw', () => {
  assert.doesNotThrow(() => KairoDarkTheme.deactivate!());
});

test('KairoDarkTheme has no extra unexpected properties', () => {
  const keys = Object.keys(KairoDarkTheme);
  const expected = ['id', 'type', 'label', 'description', 'editorTheme', 'activate', 'deactivate'];
  for (const key of keys) {
    assert.ok(expected.includes(key), `unexpected property: ${key}`);
  }
});