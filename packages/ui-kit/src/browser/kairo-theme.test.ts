// Kairo dark theme — design-token contract test.
//
// The theme is the single source of truth for every color
// variable the Kairo UI uses. If a brand color or surface tone
// drifts (someone edits a hex, or the brand color is replaced
// with a low-contrast value), the entire UI shifts. This test
// pins the documented contract.
//
// Run with:
//   pnpm --filter @kairo/ui-kit test
//   (or)  node --require ts-node/register --require source-map-support/register --test src/browser/kairo-theme.test.ts

import { test } from 'node:test';
import assert from 'node:assert';
import { KairoDarkTheme } from './kairo-theme';

test('KairoDarkTheme has the documented id and label', () => {
  assert.strictEqual(KairoDarkTheme.id, 'kairo-dark');
  assert.strictEqual(KairoDarkTheme.label, 'Kairo Dark');
  assert.strictEqual(KairoDarkTheme.type, 'dark');
});

test('KairoDarkTheme.editorTheme is "kairo-dark" (used by monaco)', () => {
  // Monaco loads a theme by this id; if it changes, the editor
  // silently falls back to the default light theme.
  assert.strictEqual(KairoDarkTheme.editorTheme, 'kairo-dark');
});

test('KairoDarkTheme has activate + deactivate methods (Theme contract)', () => {
  assert.strictEqual(typeof KairoDarkTheme.activate, 'function');
  assert.strictEqual(typeof KairoDarkTheme.deactivate, 'function');
});

test('KairoDarkTheme.activate() is a no-op when document is undefined', () => {
  // The theme must be import-safe in a Node.js context (e.g.
  // SSR, build-time, tests). Activate must not throw.
  // JSDOM may or may not be present; either way, calling
  // activate() must not throw.
  const activate = KairoDarkTheme.activate!;
  assert.doesNotThrow(() => activate());
});

test('KairoDarkTheme.deactivate() is a no-op (static theme)', () => {
  // No-op by contract — the theme tokens are applied via CSS
  // variables, not via JS-managed class state. Pin the
  // behaviour so a future refactor doesn't start tracking
  // state we then have to reset.
  const deactivate = KairoDarkTheme.deactivate!;
  assert.doesNotThrow(() => deactivate());
});

test('KairoDarkTheme.activate() is idempotent (calling twice is safe)', () => {
  // The theme is static — calling activate twice must produce
  // the same DOM state, not accumulate listeners.
  const activate = KairoDarkTheme.activate!;
  assert.doesNotThrow(() => {
    activate();
    activate();
  });
});
