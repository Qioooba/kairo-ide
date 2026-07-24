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

const testExt = {
  TestStore: require('../../lib/browser/test-store').TestStore,
  TestRunner: require('../../lib/browser/test-runner').TestRunner,
  TestTreeWidget: require('../../lib/browser/test-tree-widget').TestTreeWidget,
};

test('TestStore is exported', () => {
  assert.strictEqual(typeof testExt.TestStore, 'function');
});

test('TestRunner is exported', () => {
  assert.strictEqual(typeof testExt.TestRunner, 'function');
});

test('TestTreeWidget is exported', () => {
  assert.strictEqual(typeof testExt.TestTreeWidget, 'function');
});

test('teardown', () => { disableJSDOM(); });