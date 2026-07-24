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

const enc = require('../../lib/browser/index');

test('KairoProjectEncodingContribution is exported', () => {
  assert.strictEqual(typeof enc.KairoProjectEncodingContribution, 'function');
});

test('KairoSafeEncodingService is exported', () => {
  assert.strictEqual(typeof enc.KairoSafeEncodingService, 'function');
});

test('UnrepresentableEncodingError is exported', () => {
  assert.strictEqual(typeof enc.UnrepresentableEncodingError, 'function');
});

test('KairoEncodingRegistry is exported', () => {
  assert.strictEqual(typeof enc.KairoEncodingRegistry, 'function');
});

test('KairoFileService is exported', () => {
  assert.strictEqual(typeof enc.KairoFileService, 'function');
});

test('isEncodingRefusal is exported', () => {
  assert.strictEqual(typeof enc.isEncodingRefusal, 'function');
});

test('KairoEncodingTabDecorator is exported', () => {
  assert.strictEqual(typeof enc.KairoEncodingTabDecorator, 'function');
});

test('teardown', () => { disableJSDOM(); });