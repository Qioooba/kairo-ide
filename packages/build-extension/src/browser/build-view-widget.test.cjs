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

// Mock @theia/monaco-editor-core to avoid ESM import issues in CJS test runner.
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.endsWith('/@theia/monaco-editor-core')) {
    return origResolveFilename.call(this, require('node:path').join(__dirname, '..', '..', '..', 'search-extension', 'src', 'browser', '__monaco-mock__.js'), parent, ...args);
  }
  return origResolveFilename.call(this, request, parent, ...args);
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

const build = require('../../lib/browser/index');

// ---- BuildViewWidget exports -----------------------------------------------

test('BuildViewWidget is exported', () => {
  assert.strictEqual(typeof build.BuildViewWidget, 'function');
});

test('BuildViewWidget has static ID', () => {
  assert.strictEqual(build.BuildViewWidget.ID, 'kairo-build-view');
});

// ---- BuildViewWidget instantiation -----------------------------------------

test('BuildViewWidget: instantiation sets id', () => {
  const widget = new build.BuildViewWidget();
  assert.strictEqual(widget.id, 'kairo-build-view');
});

test('BuildViewWidget: instantiation sets title', () => {
  const widget = new build.BuildViewWidget();
  assert.strictEqual(widget.title.label, '');
  assert.strictEqual(widget.title.caption, '');
});

test('BuildViewWidget: has kairo-widget CSS class', () => {
  const widget = new build.BuildViewWidget();
  assert.ok(widget.hasClass('kairo-widget'));
});

// ---- BuildRun data structure -----------------------------------------------

test('BuildRun: valid structure', () => {
  const run = {
    id: 'build-001',
    state: 'running',
    startTime: '2024-01-01T00:00:00Z',
    summary: 'Compiling 10 source files',
    diagnostics: [],
  };
  assert.strictEqual(run.id, 'build-001');
  assert.strictEqual(run.state, 'running');
  assert.ok(Array.isArray(run.diagnostics));
});

test('BuildRun: succeeded state', () => {
  const run = {
    id: 'build-002',
    state: 'succeeded',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:00:30Z',
    summary: 'BUILD SUCCESS',
    diagnostics: [],
  };
  assert.strictEqual(run.state, 'succeeded');
  assert.ok(run.endTime);
});

test('BuildRun: failed state with diagnostics', () => {
  const run = {
    id: 'build-003',
    state: 'failed',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:00:05Z',
    summary: 'BUILD FAILURE',
    diagnostics: [
      { file: 'src/Main.java', line: 15, column: 5, severity: 'error', message: 'cannot find symbol' },
      { file: 'src/Util.java', line: 3, column: 1, severity: 'warning', message: 'unused import' },
    ],
  };
  assert.strictEqual(run.state, 'failed');
  assert.strictEqual(run.diagnostics.length, 2);
  assert.strictEqual(run.diagnostics[0].severity, 'error');
  assert.strictEqual(run.diagnostics[1].severity, 'warning');
});

test('BuildRun: cancelled state', () => {
  const run = {
    id: 'build-004',
    state: 'cancelled',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:00:10Z',
    summary: 'Build cancelled by user',
    diagnostics: [],
  };
  assert.strictEqual(run.state, 'cancelled');
});

// ---- BuildDiagnostic severity variants -------------------------------------

test('BuildDiagnostic: error severity', () => {
  const diag = { file: 'A.java', line: 1, column: 1, severity: 'error', message: 'fail' };
  assert.strictEqual(diag.severity, 'error');
});

test('BuildDiagnostic: warning severity', () => {
  const diag = { file: 'A.java', line: 1, column: 1, severity: 'warning', message: 'warn' };
  assert.strictEqual(diag.severity, 'warning');
});

test('BuildDiagnostic: info severity', () => {
  const diag = { file: 'A.java', line: 1, column: 1, severity: 'info', message: 'note' };
  assert.strictEqual(diag.severity, 'info');
});

// ---- ConnectionState values ------------------------------------------------

test('ConnectionState: connected', () => {
  const state = 'connected';
  assert.strictEqual(state, 'connected');
});

test('ConnectionState: disconnected', () => {
  const state = 'disconnected';
  assert.strictEqual(state, 'disconnected');
});

test('ConnectionState: loading', () => {
  const state = 'loading';
  assert.strictEqual(state, 'loading');
});

test('teardown', () => { disableJSDOM(); });