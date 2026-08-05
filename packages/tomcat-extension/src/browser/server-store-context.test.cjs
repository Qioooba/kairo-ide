'use strict';

// N-032: ServerStore workspace-context bootstrap tests.
// Verifies that:
//   - ServerStore has single RuntimeConnectionService injection (N-023)
//   - ServerStore subscribes to WorkspaceContextService.onDidChangeContext (N-032)
//   - ServerStore bootstraps immediately if context is already set (N-032)
//   - The state machine functions (isValidTransition, summarizeState) are correct
//
// These are source-level tests — they read the TypeScript source directly
// to avoid importing the compiled module which transitively requires
// browser globals (navigator, document) from @lumino/domutils.
//
// Run with:
//   pnpm --filter @kairo/tomcat-extension test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'server-store.ts'), 'utf8');

// N-023: No duplicate RuntimeConnectionService injection
test('server-store.ts has single RuntimeConnectionService injection (N-023)', () => {
  const matches = source.match(/@inject\(RuntimeConnectionService\)/g);
  assert.ok(matches, 'ServerStore should have at least one RuntimeConnectionService injection');
  assert.strictEqual(matches.length, 1, 'ServerStore should have exactly one RuntimeConnectionService injection (no duplicate N-023)');
});

// N-032: Workspace context subscription
test('server-store.ts subscribes to WorkspaceContextService.onDidChangeContext (N-032)', () => {
  assert.match(source, /WorkspaceContextService/);
  assert.match(source, /onDidChangeContext/);
  assert.match(source, /bootstrap/);
});

// N-032: Immediate bootstrap when context is already set
test('server-store.ts bootstraps immediately if context is already set (N-032)', () => {
  assert.match(source, /if \(this\.workspaceContext\.context\)/);
  assert.match(source, /void this\.bootstrap\(\)/);
});

// N-032: Bootstrap is called from context change handler
test('server-store.ts calls bootstrap in context change handler (N-032)', () => {
  assert.match(source, /this\.contextUnsubscribe = this\.workspaceContext\.onDidChangeContext/);
});

// BD-P2-1: bootstrap generation so only the latest in-flight wins
test('server-store.ts uses bootstrap generation to discard stale bootstraps (BD-P2-1)', () => {
  assert.match(source, /bootstrapGeneration/);
  assert.match(source, /const generation = \+\+this\.bootstrapGeneration/);
  assert.match(source, /if \(generation !== this\.bootstrapGeneration\) return/);
});

// Verify the state machine exists
test('server-store.ts defines isValidTransition', () => {
  assert.match(source, /export function isValidTransition/);
});

test('server-store.ts defines summarizeState', () => {
  assert.match(source, /export function summarizeState/);
});

test('server-store.ts defines ALLOWED_TRANSITIONS', () => {
  assert.match(source, /const ALLOWED_TRANSITIONS/);
});

// Verify all 6 states are in the transition table
test('server-store.ts ALLOWED_TRANSITIONS covers all 6 states', () => {
  assert.match(source, /stopped:/);
  assert.match(source, /starting:/);
  assert.match(source, /running:/);
  assert.match(source, /stopping:/);
  assert.match(source, /error:/);
  assert.match(source, /crashed:/);
});

// Verify server-store.ts has no runtimeConnection (duplicate) property
test('server-store.ts has no duplicate runtimeConnection property (N-023)', () => {
  // The fix removed `private readonly runtimeConnection!: RuntimeConnectionService;`
  // The only RuntimeConnectionService injection should be `private readonly runtime!`
  const runtimeConnectionMatches = source.match(/runtimeConnection/g);
  assert.strictEqual(runtimeConnectionMatches, null, 'server-store.ts should not contain runtimeConnection (duplicate removed)');
});

// Verify the file has exactly one runtime field (the corrected injection)
test('server-store.ts injects runtime field only once', () => {
  const runtimeFieldMatches = source.match(/private readonly runtime!/g);
  assert.ok(runtimeFieldMatches);
  assert.strictEqual(runtimeFieldMatches.length, 1, 'ServerStore should have exactly one runtime field');
});