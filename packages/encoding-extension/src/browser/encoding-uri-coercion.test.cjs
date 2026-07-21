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

const { KairoSafeEncodingService, UnrepresentableEncodingError } = require('../../lib/browser/safe-encoding-service');

test('KairoSafeEncodingService refuses unrepresentable chars instead of corrupting bytes (KAIRO-RC-WEB-229)', () => {
  const svc = new KairoSafeEncodingService();
  const gbkText = '中文注释测试';
  const ok = svc.encode(gbkText, { encoding: 'gbk' });
  assert.ok(ok.byteLength > 0, 'GBK-representable text encodes fine');
  assert.throws(
    () => svc.encode(gbkText + ' 🔥 emoji', { encoding: 'gbk' }),
    err => err instanceof UnrepresentableEncodingError
      && err.message.includes('gbk')
      && err.message.includes('NOT modified')
      && /U\+1F525/i.test(err.message),
    'must throw with char codepoint, encoding, and no-modification note',
  );
  const utf = svc.encode('中文 🔥', { encoding: 'utf8' });
  assert.ok(utf.byteLength > 0, 'UTF-8 accepts emoji');
});

test('encodeStream validates string saves too (KAIRO-RC-WEB-229)', async () => {
  const svc = new KairoSafeEncodingService();
  await assert.rejects(
    () => svc.encodeStream('中文 🔥', { encoding: 'gbk' }),
    /not representable/,
  );
  const buf = await svc.encodeStream('中文测试', { encoding: 'gbk' });
  // KAIRO-RC-WEB-250: for non-UTF-8 the result keeps Theia's wire shape
  // (BinaryBuffer | BinaryBufferReadable) — accept either.
  const byteLength = buf.byteLength ?? (typeof buf.read === 'function' ? (buf.read()?.byteLength ?? 0) : 0);
  assert.ok(byteLength > 0);
});

test('toProjectRootUri produces a file-scheme URI for bare paths (KAIRO-RC-WEB-206)', () => {
  const { toProjectRootUri } = require('../../lib/browser/project-encoding-contribution');
  const posix = toProjectRootUri('/srv/legacy/app');
  assert.equal(posix.scheme, 'file');
  assert.equal(posix.path.toString(), '/srv/legacy/app');
  // A scheme-less URI used to be registered as the override parent and
  // never matched file:// resources, so the project encoding did nothing.
  // Note Theia's direction: a.isEqualOrParent(b) === "a is ancestor-or-equal of b".
  const fileResource = toProjectRootUri('file:///srv/legacy/app/WebRoot/hello.jsp');
  assert.ok(posix.isEqualOrParent(fileResource), 'override parent must be an ancestor of project files');
  const win = toProjectRootUri('D:\\legacy\\app');
  assert.equal(win.scheme, 'file');
});

test('KairoEncodingRegistry applies folder overrides to descendants (KAIRO-RC-WEB-206)', () => {
  const { KairoEncodingRegistry } = require('../../lib/browser/kairo-encoding-registry');
  const URI = require('@theia/core/lib/common/uri').default;
  const reg = Object.create(KairoEncodingRegistry.prototype);
  reg.encodingOverrides = [];
  reg.registerOverride({ parent: new URI('file:///srv/legacy/app'), encoding: 'gbk' });
  // A file INSIDE the folder must match (stock Theia returns undefined here).
  assert.equal(reg.getEncodingOverride(new URI('file:///srv/legacy/app/WebRoot/hello.jsp')), 'gbk');
  // The folder itself matches.
  assert.equal(reg.getEncodingOverride(new URI('file:///srv/legacy/app')), 'gbk');
  // Sibling paths must NOT match.
  assert.equal(reg.getEncodingOverride(new URI('file:///srv/legacy/other/x.jsp')), undefined);
  assert.equal(reg.getEncodingOverride(new URI('file:///srv/legacy/app2/y.jsp')), undefined);
});
