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

const { mapBuildResult } = require('../../lib/browser/build-store');

// ---- mapBuildResult --------------------------------------------------------

test('mapBuildResult maps success state to succeeded', () => {
  const b = {
    id: 'b1',
    state: 'success',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    diagnostics: [],
    output: '',
    summary: { errors: 0, warnings: 0, filesCompiled: 5 },
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.id, 'b1');
  assert.strictEqual(result.state, 'succeeded');
  assert.strictEqual(result.workspaceId, 'ws-1');
});

test('mapBuildResult maps failure state to failed', () => {
  const b = {
    id: 'b2',
    state: 'failure',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [{ file: 'src/Main.java', line: 10, column: 5, severity: 'error', message: 'compilation error' }],
    output: '',
    summary: { errors: 1, warnings: 0, filesCompiled: 0 },
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.state, 'failed');
  assert.strictEqual(result.summary, '1 errors, 0 warnings');
  assert.strictEqual(result.diagnostics.length, 1);
  assert.strictEqual(result.diagnostics[0].file, 'src/Main.java');
  assert.strictEqual(result.diagnostics[0].severity, 'error');
});

test('mapBuildResult maps queued state to pending', () => {
  const b = {
    id: 'b3',
    state: 'queued',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [],
    output: '',
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.state, 'pending');
});

test('mapBuildResult maps running state to running', () => {
  const b = {
    id: 'b4',
    state: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [],
    output: '',
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.state, 'running');
});

test('mapBuildResult maps cancelled state to cancelled', () => {
  const b = {
    id: 'b5',
    state: 'cancelled',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:10Z',
    diagnostics: [],
    output: '',
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.state, 'cancelled');
});

test('mapBuildResult: null summary uses error message', () => {
  const b = {
    id: 'b6',
    state: 'failure',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [],
    output: '',
    error: 'Build failed: missing classpath',
    summary: null,
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.summary, 'Build failed: missing classpath');
});

test('mapBuildResult: null diagnostics becomes empty array', () => {
  const b = {
    id: 'b7',
    state: 'success',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: null,
    output: '',
    summary: { errors: 0, warnings: 0, filesCompiled: 0 },
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.deepStrictEqual(result.diagnostics, []);
});

test('mapBuildResult: hint severity maps to info', () => {
  const b = {
    id: 'b8',
    state: 'success',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [{ file: 'src/Main.java', line: 1, column: 1, severity: 'hint', message: 'unused import' }],
    output: '',
    summary: { errors: 0, warnings: 0, filesCompiled: 5 },
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.diagnostics[0].severity, 'info');
});

test('mapBuildResult: undefined summary uses empty string', () => {
  const b = {
    id: 'b9',
    state: 'success',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [],
    output: '',
    summary: undefined,
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.summary, '');
});

test('mapBuildResult: warning severity maps correctly', () => {
  const b = {
    id: 'b10',
    state: 'success',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [{ file: 'src/Main.java', line: 5, column: 3, severity: 'warning', message: 'unchecked cast' }],
    output: '',
    summary: { errors: 0, warnings: 1, filesCompiled: 5 },
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.diagnostics[0].severity, 'warning');
});

test('mapBuildResult: summary formats correctly', () => {
  const b = {
    id: 'b11',
    state: 'failure',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [],
    output: '',
    summary: { errors: 3, warnings: 2, filesCompiled: 10 },
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.summary, '3 errors, 2 warnings');
});

test('mapBuildResult: startTime and endTime are preserved', () => {
  const b = {
    id: 'b12',
    state: 'success',
    startedAt: '2026-06-15T10:30:00Z',
    finishedAt: '2026-06-15T10:31:30Z',
    diagnostics: [],
    output: '',
    summary: { errors: 0, warnings: 0, filesCompiled: 5 },
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.startTime, '2026-06-15T10:30:00Z');
  assert.strictEqual(result.endTime, '2026-06-15T10:31:30Z');
});

test('mapBuildResult: projectId is extracted when present', () => {
  const b = {
    id: 'b13',
    state: 'success',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [],
    output: '',
    summary: { errors: 0, warnings: 0, filesCompiled: 0 },
  };
  (b).projectId = 'proj-1';
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.projectId, 'proj-1');
});

test('mapBuildResult: projectId defaults to empty string', () => {
  const b = {
    id: 'b14',
    state: 'success',
    startedAt: '2026-01-01T00:00:00Z',
    diagnostics: [],
    output: '',
    summary: undefined,
  };
  const result = mapBuildResult(b, 'ws-1');
  assert.strictEqual(result.projectId, '');
});

test('teardown', () => { disableJSDOM(); });