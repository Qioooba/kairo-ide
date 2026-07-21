// Regression test for KAIRO-RC-WEB-020.
//
// The status bar passes `editor.document.uri` — a Monaco Uri,
// not a Theia URI instance — into KairoEncodingServiceImpl.
// EncodingRegistry then crashed with
// "e.isEqualOrParent is not a function" on every editor open.
// The service must coerce uri-likes at the boundary.
//
// Needs jsdom because encoding-service transitively imports
// @theia/filesystem (Lumino DOM code). Run via the package's
// `pnpm test` (loads the css loader hooks).

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

const { KairoEncodingServiceImpl } = require('../../lib/browser/encoding-service');

test('getEncodingFor tolerates a Monaco-style Uri lacking Theia URI methods (KAIRO-RC-WEB-020)', () => {
  const svc = Object.create(KairoEncodingServiceImpl.prototype);
  svc.cache = new Map();
  svc.encodingRegistry = {
    getEncodingForResource: u => {
      if (typeof u.isEqualOrParent !== 'function') {
        throw new TypeError('e.isEqualOrParent is not a function');
      }
      return 'gbk';
    },
  };
  const monacoStyleUri = {
    scheme: 'file',
    path: '/tmp/hello.jsp',
    toString: () => 'file:///tmp/hello.jsp',
  };
  assert.strictEqual(svc.getEncodingFor(monacoStyleUri), 'gbk');
});

test('setEncodingFor coerces Monaco-style Uri before registerOverride (KAIRO-RC-WEB-020)', () => {
  const svc = Object.create(KairoEncodingServiceImpl.prototype);
  svc.cache = new Map();
  const overrides = [];
  svc.encodingRegistry = {
    getEncodingForResource: () => 'utf-8',
    registerOverride: o => {
      if (typeof o.parent.isEqualOrParent !== 'function') {
        throw new TypeError('e.isEqualOrParent is not a function');
      }
      overrides.push(o);
    },
  };
  const monacoStyleUri = {
    scheme: 'file',
    path: '/tmp/hello.jsp',
    toString: () => 'file:///tmp/hello.jsp',
  };
  const result = svc.setEncodingFor(monacoStyleUri, 'gbk');
  assert.strictEqual(result.encoding, 'gbk');
  assert.strictEqual(overrides.length, 1);
  assert.strictEqual(overrides[0].parent.toString(), 'file:///tmp/hello.jsp');
});

test('teardown', () => {
  disableJSDOM();
});

test('applyProjectEncoding registers a folder-level override with normalized encoding (KAIRO-RC-WEB-206)', () => {
  const svc = Object.create(KairoEncodingServiceImpl.prototype);
  svc.cache = new Map();
  const overrides = [];
  svc.encodingRegistry = {
    registerOverride: o => overrides.push(o),
  };
  const monacoStyleUri = {
    scheme: 'file',
    path: '/tmp/legacy-sample',
    toString: () => 'file:///tmp/legacy-sample',
  };
  svc.applyProjectEncoding(monacoStyleUri, 'GBK');
  assert.strictEqual(overrides.length, 1);
  assert.strictEqual(overrides[0].encoding, 'gbk', 'encoding normalized');
  assert.strictEqual(typeof overrides[0].parent.isEqualOrParent, 'function', 'parent coerced to a real Theia URI');
  assert.strictEqual(overrides[0].parent.toString(), 'file:///tmp/legacy-sample');
});
