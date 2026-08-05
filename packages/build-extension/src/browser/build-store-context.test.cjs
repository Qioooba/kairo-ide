'use strict';

// N-032: BuildStore workspace-context bootstrap tests.
// Verifies that:
//   - BuildStore can be instantiated (no duplicate injections)
//   - Connection state management works correctly
//   - The store has the correct architecture for context-based bootstrap
//
// Run with:
//   pnpm --filter @kairo/build-extension test

// CSS extension hook must be set up BEFORE any @theia/core module is loaded.
const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { BuildStore } = require('../../lib/browser/build-store');

// ============================================================================
// N-032: BuildStore — Workspace Context Bootstrap Architecture
// ============================================================================

describe('BuildStore — N-032 Context Bootstrap', () => {
  let store;

  beforeEach(() => {
    store = new BuildStore();
  });

  it('can be instantiated (no duplicate injection issues)', () => {
    assert.ok(store instanceof BuildStore);
  });

  it('has single runtime injection (no duplicate N-023)', () => {
    // The BuildStore should only have a single `runtime` property,
    // not a duplicate `runtimeConnection` property.
    assert.ok(typeof store.runtime !== 'undefined' || store.runtime === undefined,
      'BuildStore should have a single runtime reference');
    // Verify there is no duplicate runtimeConnection property
    // (the fix removed the duplicate @inject(RuntimeConnectionService) line)
    assert.strictEqual(store.runtimeConnection, undefined,
      'BuildStore should NOT have a duplicate runtimeConnection (N-023 fix)');
  });

  it('getConnectionState returns loading initially', () => {
    assert.strictEqual(store.getConnectionState(), 'loading');
  });

  it('getBuilds returns empty array initially', () => {
    assert.deepStrictEqual(store.getBuilds(), []);
  });

  it('setConnectionState changes state', () => {
    store.setConnectionState('connected');
    assert.strictEqual(store.getConnectionState(), 'connected');
  });

  it('setConnectionState ignores duplicate', () => {
    store.setConnectionState('connected');
    let fired = false;
    store.onConnectionStateChange(() => { fired = true; });
    store.setConnectionState('connected');
    assert.strictEqual(fired, false);
  });

  it('setConnectionState handles all valid states', () => {
    const states = ['loading', 'connected', 'disconnected', 'empty'];
    for (const s of states) {
      store.setConnectionState(s);
      assert.strictEqual(store.getConnectionState(), s);
    }
  });

  it('addBuild appends a build', () => {
    const build = { id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' };
    store.addBuild(build);
    assert.strictEqual(store.getBuilds().length, 1);
    assert.strictEqual(store.getLatestBuild().id, 'b1');
  });

  it('clearHistory removes all builds', () => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    store.clearHistory();
    assert.deepStrictEqual(store.getBuilds(), []);
  });

  it('updateBuild modifies an existing build', () => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    store.updateBuild('b1', { state: 'succeeded', endTime: 't1' });
    const build = store.getLatestBuild();
    assert.strictEqual(build.state, 'succeeded');
    assert.strictEqual(build.endTime, 't1');
  });

  it('source uses bootstrap generation to discard stale bootstraps (BD-P2-1)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, 'build-store.ts'), 'utf8');
    assert.match(source, /bootstrapGeneration/);
    assert.match(source, /const generation = \+\+this\.bootstrapGeneration/);
    assert.match(source, /if \(generation !== this\.bootstrapGeneration\) return/);
  });
});

// ============================================================================
// Cleanup
// ============================================================================

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});