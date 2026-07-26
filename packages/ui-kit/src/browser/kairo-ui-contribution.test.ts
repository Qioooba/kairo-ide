// Kairo UI Contribution — source-level contract tests.
//
// The KairoUiContribution class imports @lumino/domutils which
// requires a browser `document` global, so we cannot import the
// class directly in a Node.js test. Instead we verify the source
// code contract by reading the TypeScript source.
//
// Run with:
//   pnpm --filter @kairo/ui-kit test

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'kairo-ui-contribution.ts'), 'utf8');

// ---- Class structure ----

test('KairoUiContribution is an exported class', () => {
  assert.match(source, /export class KairoUiContribution/);
});

test('KairoUiContribution implements FrontendApplicationContribution', () => {
  assert.match(source, /implements FrontendApplicationContribution/);
});

test('KairoUiContribution has onStart method', () => {
  assert.match(source, /onStart\(\): void/);
});

test('KairoUiContribution has onStop method', () => {
  assert.match(source, /onStop\(\): void/);
});

test('KairoUiContribution has a default export', () => {
  assert.match(source, /export default KairoUiContribution/);
});

test('KairoUiContribution is injectable', () => {
  assert.match(source, /@injectable\(\)/);
});

// ---- Constructor dependencies ----

test('KairoUiContribution constructor injects CommandService', () => {
  assert.match(source, /@inject\(CommandService\)/);
});

test('KairoUiContribution constructor injects WorkspaceService', () => {
  assert.match(source, /@inject\(WorkspaceService\)/);
});

// ---- Lifecycle logic ----

test('KairoUiContribution.onStart calls maybeOpenExplorerOnTrust', () => {
  assert.match(source, /this\.maybeOpenExplorerOnTrust\(\)/);
});

test('KairoUiContribution.onStop disposes onWorkspaceChangedDisposable', () => {
  assert.match(source, /this\.onWorkspaceChangedDisposable\?\.dispose\(\)/);
});

test('KairoUiContribution.onStop clears timers', () => {
  assert.match(source, /clearTimeout\(this\.explorerTimer\)/);
  assert.match(source, /clearTimeout\(this\.workspaceTimer\)/);
});

test('KairoUiContribution uses setTimeout for delayed explorer open', () => {
  assert.match(source, /setTimeout\(tryOpen, 1500\)/);
});

test('KairoUiContribution handles workspace changed event', () => {
  assert.match(source, /onWorkspaceChanged/);
});

test('KairoUiContribution checks workspace trust before opening explorer', () => {
  assert.match(source, /isTrusted/);
});

test('KairoUiContribution executes workbench.view.explorer command', () => {
  assert.match(source, /workbench\.view\.explorer/);
});

test('KairoUiContribution catches command execution errors', () => {
  assert.match(source, /\.catch\(/);
});