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

const { test } = require('node:test');
const assert = require('node:assert');

const remote = require('../../lib/browser/index');

test('RemoteConnectionService is exported', () => {
  assert.strictEqual(typeof remote.RemoteConnectionService, 'function');
});

test('RemoteSandboxService is exported', () => {
  assert.strictEqual(typeof remote.RemoteSandboxService, 'function');
});

test('RemoteConnectionWidget is exported', () => {
  assert.strictEqual(typeof remote.RemoteConnectionWidget, 'function');
});

test('teardown', () => { disableJSDOM(); });