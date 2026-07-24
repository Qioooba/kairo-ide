'use strict';

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

const { BuildStore, mapBuildResult } = require('../../lib/browser/build-store');

// ============================================================================
// mapBuildResult Extended Tests
// ============================================================================

describe('mapBuildResult — Extended', () => {
  it('handles queued state', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'queued', startedAt: 't0',
      summary: null, diagnostics: null,
    }, 'ws-1');
    assert.strictEqual(r.state, 'pending');
  });

  it('handles running state', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'running', startedAt: 't0',
      summary: null, diagnostics: null,
    }, 'ws-1');
    assert.strictEqual(r.state, 'running');
  });

  it('handles success state', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'success', startedAt: 't0', finishedAt: 't1',
      summary: { errors: 0, warnings: 0 }, diagnostics: [],
    }, 'ws-1');
    assert.strictEqual(r.state, 'succeeded');
  });

  it('handles failure state', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'failure', startedAt: 't0', finishedAt: 't1',
      summary: { errors: 3, warnings: 5 }, diagnostics: [],
    }, 'ws-1');
    assert.strictEqual(r.state, 'failed');
    assert.strictEqual(r.summary, '3 errors, 5 warnings');
  });

  it('handles summary with missing errors/warnings', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'success', startedAt: 't0',
      summary: {}, diagnostics: [],
    }, 'ws-1');
    assert.strictEqual(r.summary, '0 errors, 0 warnings');
  });

  it('handles undefined summary', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'success', startedAt: 't0',
      summary: undefined, diagnostics: [],
    }, 'ws-1');
    assert.strictEqual(r.summary, '');
  });

  it('handles build error field', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'failure', startedAt: 't0', finishedAt: 't1',
      summary: null, error: 'compilation failed', diagnostics: [],
    }, 'ws-1');
    assert.strictEqual(r.summary, 'compilation failed');
  });

  it('handles diagnostics with warning severity', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'success', startedAt: 't0', finishedAt: 't1',
      summary: { errors: 0, warnings: 1 },
      diagnostics: [{ file: 'A.java', line: 1, column: 1, severity: 'warning', message: 'w' }],
    }, 'ws-1');
    assert.strictEqual(r.diagnostics[0].severity, 'warning');
  });

  it('handles diagnostics with error severity', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'failure', startedAt: 't0', finishedAt: 't1',
      summary: { errors: 1, warnings: 0 },
      diagnostics: [{ file: 'A.java', line: 1, column: 1, severity: 'error', message: 'e' }],
    }, 'ws-1');
    assert.strictEqual(r.diagnostics[0].severity, 'error');
  });

  it('handles diagnostics with info severity', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'success', startedAt: 't0', finishedAt: 't1',
      summary: { errors: 0, warnings: 0 },
      diagnostics: [{ file: 'A.java', line: 1, column: 1, severity: 'info', message: 'i' }],
    }, 'ws-1');
    assert.strictEqual(r.diagnostics[0].severity, 'info');
  });

  it('extracts projectId from build result', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'success', startedAt: 't0', finishedAt: 't1',
      projectId: 'proj-1', summary: null, diagnostics: [],
    }, 'ws-1');
    assert.strictEqual(r.projectId, 'proj-1');
  });

  it('defaults projectId to empty string', () => {
    const r = mapBuildResult({
      id: 'b1', state: 'success', startedAt: 't0', finishedAt: 't1',
      summary: null, diagnostics: [],
    }, 'ws-1');
    assert.strictEqual(r.projectId, '');
  });
});

// ============================================================================
// BuildStore — State Management
// ============================================================================

describe('BuildStore — State Management', () => {
  let store;

  beforeEach(() => {
    store = new BuildStore();
  });

  it('getBuilds returns empty array initially', () => {
    assert.deepStrictEqual(store.getBuilds(), []);
  });

  it('getLatestBuild returns undefined initially', () => {
    assert.strictEqual(store.getLatestBuild(), undefined);
  });

  it('addBuild appends a build', () => {
    const build = { id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' };
    store.addBuild(build);
    assert.strictEqual(store.getBuilds().length, 1);
    assert.strictEqual(store.getLatestBuild().id, 'b1');
  });

  it('setBuilds replaces all builds', () => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    const newBuilds = [
      { id: 'b2', workspaceId: 'ws-1', projectId: 'p2', state: 'succeeded', startTime: 't1' },
      { id: 'b3', workspaceId: 'ws-1', projectId: 'p3', state: 'failed', startTime: 't2' },
    ];
    store.setBuilds(newBuilds);
    assert.strictEqual(store.getBuilds().length, 2);
    assert.strictEqual(store.getLatestBuild().id, 'b3');
  });

  it('updateBuild modifies an existing build', () => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    store.updateBuild('b1', { state: 'succeeded', endTime: 't1' });
    const build = store.getLatestBuild();
    assert.strictEqual(build.state, 'succeeded');
    assert.strictEqual(build.endTime, 't1');
    assert.strictEqual(build.id, 'b1');
  });

  it('updateBuild does nothing for unknown id', () => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    store.updateBuild('unknown', { state: 'succeeded' });
    assert.strictEqual(store.getLatestBuild().state, 'running');
  });

  it('clearHistory removes all builds', () => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    store.addBuild({ id: 'b2', workspaceId: 'ws-1', projectId: 'p2', state: 'succeeded', startTime: 't1' });
    store.clearHistory();
    assert.deepStrictEqual(store.getBuilds(), []);
    assert.strictEqual(store.getLatestBuild(), undefined);
  });

  it('getBuilds returns a copy, not reference', () => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    const builds = store.getBuilds();
    builds.push({ id: 'b2', workspaceId: 'ws-1', projectId: 'p2', state: 'succeeded', startTime: 't1' });
    assert.strictEqual(store.getBuilds().length, 1);
  });

  it('addBuild emits onDidChange', (_, done) => {
    store.onDidChange(builds => {
      assert.strictEqual(builds.length, 1);
      assert.strictEqual(builds[0].id, 'b1');
      done();
    });
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
  });

  it('setBuilds emits onDidChange', (_, done) => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    store.onDidChange(builds => {
      assert.strictEqual(builds.length, 2);
      done();
    });
    store.setBuilds([
      { id: 'b2', workspaceId: 'ws-1', projectId: 'p2', state: 'succeeded', startTime: 't1' },
      { id: 'b3', workspaceId: 'ws-1', projectId: 'p3', state: 'failed', startTime: 't2' },
    ]);
  });

  it('updateBuild emits onDidChange', (_, done) => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    store.onDidChange(builds => {
      assert.strictEqual(builds[0].state, 'succeeded');
      done();
    });
    store.updateBuild('b1', { state: 'succeeded' });
  });

  it('clearHistory emits onDidChange with empty array', (_, done) => {
    store.addBuild({ id: 'b1', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' });
    store.onDidChange(builds => {
      assert.deepStrictEqual(builds, []);
      done();
    });
    store.clearHistory();
  });
});

// ============================================================================
// BuildStore — Connection State
// ============================================================================

describe('BuildStore — Connection State', () => {
  let store;

  beforeEach(() => {
    store = new BuildStore();
  });

  it('getConnectionState returns loading initially', () => {
    assert.strictEqual(store.getConnectionState(), 'loading');
  });

  it('setConnectionState changes state', () => {
    store.setConnectionState('connected');
    assert.strictEqual(store.getConnectionState(), 'connected');
  });

  it('setConnectionState ignores duplicate', () => {
    store.setConnectionState('connected');
    let fired = false;
    store.onConnectionStateChange(() => { fired = true; });
    store.setConnectionState('connected'); // same value, should not fire
    assert.strictEqual(fired, false);
  });

  it('setConnectionState emits on change', (_, done) => {
    store.onConnectionStateChange(state => {
      assert.strictEqual(state, 'disconnected');
      done();
    });
    store.setConnectionState('disconnected');
  });

  it('setConnectionState handles all valid states', () => {
    const states = ['loading', 'connected', 'disconnected', 'empty'];
    for (const s of states) {
      store.setConnectionState(s);
      assert.strictEqual(store.getConnectionState(), s);
    }
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