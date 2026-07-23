// Regression test for KAIRO-RC-WEB-237.
// mapBuildResult must tolerate null summary / null diagnostics —
// the agent emits both for builds that never ran a compiler; the
// unguarded access used to crash the BuildStore bootstrap and
// leave the Build view idle forever.
'use strict';

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

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');


const { test } = require('node:test');
const assert = require('node:assert');
const { BuildStore, mapBuildResult } = require('../../lib/browser/build-store');

test('mapBuildResult tolerates null summary and null diagnostics (KAIRO-RC-WEB-237)', () => {
  const wire = {
    id: 'build-1',
    state: 'failure',
    startedAt: '2026-07-21T00:00:00Z',
    finishedAt: '2026-07-21T00:00:05Z',
    summary: null,
    diagnostics: null,
  };
  const r = mapBuildResult(wire, 'ws-1');
  assert.strictEqual(r.id, 'build-1');
  assert.strictEqual(r.state, 'failed');
  assert.strictEqual(r.summary, '');
  assert.deepStrictEqual(r.diagnostics, []);
});

test('mapBuildResult maps state aliases and hint severity', () => {
  const wire = {
    id: 'build-2',
    state: 'success',
    startedAt: 't0',
    finishedAt: 't1',
    summary: { errors: 0, warnings: 1 },
    diagnostics: [{ file: 'A.java', line: 3, column: 5, severity: 'hint', message: 'm' }],
  };
  const r = mapBuildResult(wire, 'ws-1');
  assert.strictEqual(r.state, 'succeeded');
  assert.strictEqual(r.summary, '0 errors, 1 warnings');
  assert.strictEqual(r.diagnostics[0].severity, 'info');
});

test('cancelBuild calls DELETE once and stores cancelled end time', async () => {
  const calls = [];
  let resolveRequest;
  const store = new BuildStore();
  store.runtime = {
    request: (endpoint, payload, options) => {
      calls.push({ endpoint, payload, options });
      return new Promise(resolve => { resolveRequest = resolve; });
    },
  };
  store.workspaceContext = { context: { workspaceId: 'ws-1' } };
  store.setBuilds([{ id: 'build-3', workspaceId: 'ws-1', projectId: 'p1', state: 'running', startTime: 't0' }]);

  const first = store.cancelBuild('build-3');
  const second = store.cancelBuild('build-3');
  assert.strictEqual(calls.length, 1);
  resolveRequest({
    id: 'build-3', state: 'cancelled', startedAt: 't0', finishedAt: 't1',
    diagnostics: [], output: '', summary: { errors: 0, warnings: 0, filesCompiled: 0 },
  });
  const [result, duplicateResult] = await Promise.all([first, second]);
  assert.deepStrictEqual(duplicateResult, result);
  assert.strictEqual(calls[0].endpoint, 'DELETE /api/v1/builds/{buildId}');
  assert.deepStrictEqual(calls[0].options.pathParams, { buildId: 'build-3' });
  assert.strictEqual(result.state, 'cancelled');
  assert.strictEqual(result.endTime, 't1');
  assert.strictEqual(store.getLatestBuild().state, 'cancelled');
});

test('teardown', () => { disableJSDOM(); });
