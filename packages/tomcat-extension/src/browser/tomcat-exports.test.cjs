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

test('KairoServerService is exported', () => {
  assert.strictEqual(typeof tomcat.KairoServerService, 'function');
});

test('bindTomcatExtension is exported', () => {
  assert.strictEqual(typeof tomcat.bindTomcatExtension, 'function');
});

test('ServerStore is exported', () => {
  assert.strictEqual(typeof tomcat.ServerStore, 'function');
});

test('ServerViewWidget is exported', () => {
  assert.strictEqual(typeof tomcat.ServerViewWidget, 'function');
});

test('LogViewerWidget is exported', () => {
  assert.strictEqual(typeof tomcat.LogViewerWidget, 'function');
});

test('teardown', () => { disableJSDOM(); });