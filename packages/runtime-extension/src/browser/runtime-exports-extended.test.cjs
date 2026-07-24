'use strict';

// CSS extension hook must be set up BEFORE any @theia/core module is loaded.
const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

// Set up JSDOM so @lumino/domutils has access to `navigator`.
const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();

// JSDOM does not expose DragEvent as a global; @lumino/dragdrop needs it.
if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {};
}

// Theia requires FrontendApplicationConfigProvider to be set before
// any browser module is loaded.
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', '..', 'lib', 'browser', 'index.js');

describe('Runtime Extension — Runtime Connection Service Exports', () => {
  it('exports RuntimeConnectionService', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.RuntimeConnectionService, 'function', 'RuntimeConnectionService should be exported');
  });

  it('exports KAIRO_WS_SUBPROTOCOL', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.KAIRO_WS_SUBPROTOCOL, 'string', 'KAIRO_WS_SUBPROTOCOL should be exported');
    assert.equal(mod.KAIRO_WS_SUBPROTOCOL, 'kairo-secret-v1');
  });
});

describe('Runtime Extension — Error Handling Exports', () => {
  it('exports KairoError', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.KairoError, 'function', 'KairoError should be exported');
  });

  it('exports normaliseThrown', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.normaliseThrown, 'function', 'normaliseThrown should be exported');
  });

  it('exports unwrapResponse', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.unwrapResponse, 'function', 'unwrapResponse should be exported');
  });

  it('exports FALLBACK_ERROR_CODE', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.FALLBACK_ERROR_CODE, 'string', 'FALLBACK_ERROR_CODE should be exported');
  });
});

describe('Runtime Extension — KairoRuntime Exports', () => {
  it('exports KairoRuntime as an Inversify injection token (Symbol)', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.KairoRuntime, 'symbol', 'KairoRuntime should be an injection token (Symbol)');
  });

  it('exports KairoErrorListener as an Inversify injection token (Symbol)', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.KairoErrorListener, 'symbol', 'KairoErrorListener should be an injection token (Symbol)');
  });

  it('exports KairoErrorListenerImpl', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.KairoErrorListenerImpl, 'function', 'KairoErrorListenerImpl should be exported');
  });
});

describe('Runtime Extension — Workspace Context Exports', () => {
  it('exports WorkspaceContextService', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.WorkspaceContextService, 'function', 'WorkspaceContextService should be exported');
  });
});

describe('Runtime Extension — KairoError Construction', () => {
  it('KairoError creates instances with correct properties', () => {
    const { KairoError } = require(indexPath);
    const err = new KairoError({ message: 'Something went wrong', code: 'timeout', retryable: true, httpStatus: 504 });
    assert.ok(err instanceof Error);
    assert.equal(err.code, 'timeout');
    assert.equal(err.retryable, true);
    assert.equal(err.httpStatus, 504);
    assert.match(err.message, /Something went wrong/);
  });

  it('KairoError defaults retryable to false', () => {
    const { KairoError } = require(indexPath);
    const err = new KairoError({ message: 'Boom', code: 'internal' });
    assert.equal(err.retryable, false);
  });
});

describe('Runtime Extension — normaliseThrown Function', () => {
  it('normaliseThrown wraps plain errors into KairoError', () => {
    const { normaliseThrown, KairoError } = require(indexPath);
    const result = normaliseThrown(new Error('raw error'));
    assert.ok(result instanceof KairoError);
    assert.equal(result.code, 'internal');
  });

  it('normaliseThrown passes through existing KairoError', () => {
    const { normaliseThrown, KairoError } = require(indexPath);
    const original = new KairoError('original', { code: 'timeout', retryable: true });
    const result = normaliseThrown(original);
    assert.strictEqual(result, original);
  });

  it('normaliseThrown wraps non-Error thrown values', () => {
    const { normaliseThrown, KairoError } = require(indexPath);
    const result = normaliseThrown('string error');
    assert.ok(result instanceof KairoError);
    assert.equal(result.code, 'internal');
    // non-Error values use the fallback message, not the original value
    assert.match(result.message, /Runtime client failed/);
  });
});

describe('Runtime Extension — EventStream Export', () => {
  it('exports EventStream', () => {
    const mod = require(indexPath);
    assert.equal(typeof mod.EventStream, 'function', 'EventStream should be exported');
  });
});