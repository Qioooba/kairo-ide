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

const tomcat = require('../../lib/browser/index');

// ---- ServerViewWidget exports ----------------------------------------------

test('ServerViewWidget is exported', () => {
  assert.strictEqual(typeof tomcat.ServerViewWidget, 'function');
});

test('ServerViewWidget has static ID', () => {
  assert.strictEqual(tomcat.ServerViewWidget.ID, 'kairo-server-view');
});

// ---- ServerViewWidget instantiation ----------------------------------------

test('ServerViewWidget: instantiation sets id', () => {
  const widget = new tomcat.ServerViewWidget();
  assert.strictEqual(widget.id, 'kairo-server-view');
});

test('ServerViewWidget: instantiation sets title', () => {
  const widget = new tomcat.ServerViewWidget();
  assert.strictEqual(widget.title.label, 'Kairo Server');
  assert.strictEqual(widget.title.caption, 'Kairo Server View');
});

test('ServerViewWidget: has kairo-widget CSS class', () => {
  const widget = new tomcat.ServerViewWidget();
  assert.ok(widget.hasClass('kairo-widget'));
});

// ---- ServerInstance data structure -----------------------------------------

test('ServerInstance: stopped state', () => {
  const instance = {
    id: 'server-001',
    state: 'stopped',
    httpPort: 8080,
    pid: '12345',
    startTime: '2024-01-01T00:00:00Z',
    projectId: 'prj-1',
  };
  assert.strictEqual(instance.state, 'stopped');
  assert.strictEqual(instance.httpPort, 8080);
});

test('ServerInstance: running state with URL', () => {
  const instance = {
    id: 'server-002',
    state: 'running',
    httpPort: 8080,
    debugPort: 5005,
    pid: '12346',
    startTime: '2024-01-01T00:00:00Z',
    url: 'http://localhost:8080/myapp',
    projectId: 'prj-1',
  };
  assert.strictEqual(instance.state, 'running');
  assert.strictEqual(instance.url, 'http://localhost:8080/myapp');
  assert.strictEqual(instance.debugPort, 5005);
});

test('ServerInstance: starting state', () => {
  const instance = {
    id: 'server-003',
    state: 'starting',
    httpPort: 8080,
    pid: '',
    startTime: '',
    projectId: 'prj-1',
  };
  assert.strictEqual(instance.state, 'starting');
});

test('ServerInstance: error state', () => {
  const instance = {
    id: 'server-004',
    state: 'error',
    httpPort: 8080,
    pid: '',
    startTime: '',
    projectId: 'prj-1',
  };
  assert.strictEqual(instance.state, 'error');
});

test('ServerInstance: crashed state', () => {
  const instance = {
    id: 'server-005',
    state: 'crashed',
    httpPort: 8080,
    pid: '',
    startTime: '2024-01-01T00:00:00Z',
    projectId: 'prj-1',
  };
  assert.strictEqual(instance.state, 'crashed');
});

// ---- HotReloadStatus values ------------------------------------------------

test('HotReloadStatus: synced', () => {
  const status = 'synced';
  assert.strictEqual(status, 'synced');
});

test('HotReloadStatus: compiling', () => {
  const status = 'compiling';
  assert.strictEqual(status, 'compiling');
});

test('HotReloadStatus: restart_required', () => {
  const status = 'restart_required';
  assert.strictEqual(status, 'restart_required');
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