// KairoSearchService — contract test (CJS variant).
//
// The TS source imports `@theia/core/shared/inversify`, which
// transitively pulls in @lumino/domutils and needs a DOM
// environment. We set up Theia's JSDOM helper before loading
// the production code (from the compiled `lib/`), then
// exercise the service through a stub
// RuntimeConnectionService.
//
// Run with:
//   pnpm --filter @kairo/search-extension test
//   (or)  node --require source-map-support/register --test src/browser/search-service.test.cjs

'use strict';

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();

// jsdom doesn't include DragEvent — patch it so Lumino's dragdrop loads
if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}

// Theia browser modules require CSS files — stub them out
const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

// Theia requires FrontendApplicationConfigProvider to be set before
// any browser module is loaded.
const { FrontendApplicationConfigProvider } =
  require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

const { test } = require('node:test');
const assert = require('node:assert');

const { KairoSearchService, KairoSearchCancelledError } =
  require('../../lib/browser/search-service');

// ---- Stub RuntimeConnectionService ----------------------------------------

class StubRuntime {
  constructor() {
    this.calls = [];
  }

  async request(endpoint, payload, opts) {
    return new Promise((resolve, reject) => {
      const entry = {
        endpoint,
        payload,
        signal: (opts && opts.signal) || new AbortController().signal,
        resolve,
        reject,
      };
      this.calls.push(entry);
      const sig = opts && opts.signal;
      if (sig) {
        sig.addEventListener('abort', () => {
          const err = new DOMException('aborted', 'AbortError');
          reject(err);
        });
      }
    });
  }

  resolveAll(value) {
    for (const c of this.calls) c.resolve(value);
    // Do NOT clear this.calls — tests want to inspect what was
    // sent (endpoint, payload) AFTER the response comes back.
  }
}

function makeService() {
  const rt = new StubRuntime();
  const svc = new KairoSearchService();
  // TypeScript's class-field declaration
  // (`runtime; current;` in the compiled output) creates OWN
  // properties on every instance with value `undefined`, which
  // shadow anything we set on the prototype. The @inject
  // decorator at DI time would overwrite this own property with
  // a value pulled from the container; we are not using a
  // container, so we just assign to the own property directly.
  svc.runtime = rt;
  return { svc, rt };
}

const emptyResponse = {
  query: '',
  totalMatches: 0,
  truncated: false,
  matches: [],
  elapsedMs: 0,
  erroredFiles: [],
};

// ---- Behaviour tests ------------------------------------------------------

test('search() forwards query and defaults to the workspace endpoint', async () => {
  const { svc, rt } = makeService();
  const p = svc.search({ workspaceId: 'ws-1', query: 'foo' });
  rt.resolveAll({ ...emptyResponse, query: 'foo' });
  const r = await p;

  assert.strictEqual(rt.calls.length, 1);
  assert.strictEqual(rt.calls[0].endpoint, 'POST /api/v1/search');
  assert.strictEqual(rt.calls[0].payload.workspaceId, 'ws-1');
  assert.strictEqual(rt.calls[0].payload.query, 'foo');
  assert.strictEqual(rt.calls[0].payload.isRegex, false);
  assert.strictEqual(rt.calls[0].payload.caseSensitive, false);
  assert.strictEqual(rt.calls[0].payload.wholeWord, false);
  assert.strictEqual(r.query, 'foo');
});

test('search() propagates isRegex / caseSensitive / wholeWord options', async () => {
  const { svc, rt } = makeService();
  const p = svc.search({
    workspaceId: 'ws-1',
    query: 'TODO',
    isRegex: true,
    caseSensitive: true,
    wholeWord: true,
    include: ['*.ts'],
    exclude: ['node_modules/**'],
  });
  rt.resolveAll(emptyResponse);
  await p;

  const sent = rt.calls[0].payload;
  assert.strictEqual(sent.isRegex, true);
  assert.strictEqual(sent.caseSensitive, true);
  assert.strictEqual(sent.wholeWord, true);
  assert.deepStrictEqual(sent.include, ['*.ts']);
  assert.deepStrictEqual(sent.exclude, ['node_modules/**']);
});

test('search() aborts the previous in-flight request on a new call', async () => {
  const { svc, rt } = makeService();
  // First call: never resolved within the test.
  const p1 = svc.search({ workspaceId: 'ws-1', query: 'a' });
  // Second call: should abort p1.
  const p2 = svc.search({ workspaceId: 'ws-1', query: 'ab' });
  rt.resolveAll(emptyResponse);

  // p1 must reject with KairoSearchCancelledError, NOT a raw AbortError.
  await assert.rejects(p1, (err) => {
    assert.ok(err instanceof KairoSearchCancelledError,
      `expected KairoSearchCancelledError, got ${err}`);
    return true;
  });
  await p2; // second call resolves cleanly
});

test('cancel() aborts the current in-flight request', async () => {
  const { svc } = makeService();
  const p = svc.search({ workspaceId: 'ws-1', query: 'foo' });
  // Manually cancel mid-flight (do NOT resolveAll — the request
  // must still be in-flight so that cancel() has something to abort).
  svc.cancel();
  await assert.rejects(p, (err) => {
    assert.ok(err instanceof KairoSearchCancelledError,
      `expected KairoSearchCancelledError, got ${err}`);
    return true;
  });
});

test('KairoSearchCancelledError has a stable name + message', () => {
  // The UI uses `err.name` to suppress the error toast; this
  // guarantees that name stays 'KairoSearchCancelledError' even
  // if someone refactors the constructor.
  const e = new KairoSearchCancelledError();
  assert.strictEqual(e.name, 'KairoSearchCancelledError');
  assert.strictEqual(e.message, 'search cancelled');
  assert.ok(e instanceof Error);
});

test('non-abort errors from the runtime are NOT converted to KairoSearchCancelledError', async () => {
  // A real network failure (e.g. 500) must propagate untouched
  // so the UI can show a real error toast.
  const { svc } = makeService();
  const rt = svc.runtime;
  // Override .request to reject with a non-abort error.
  rt.request = async () => { throw new Error('network down'); };

  await assert.rejects(
    svc.search({ workspaceId: 'ws-1', query: 'x' }),
    (err) => {
      assert.ok(!(err instanceof KairoSearchCancelledError),
        'should not be KairoSearchCancelledError');
      assert.strictEqual(err.message, 'network down');
      return true;
    },
  );
});

test('search() forwards previewReplace when supplied', async () => {
  const { svc, rt } = makeService();
  const p = svc.search({
    workspaceId: 'ws-1',
    query: 'foo',
    previewReplace: 'bar',
  });
  rt.resolveAll(emptyResponse);
  await p;
  assert.strictEqual(rt.calls[0].payload.previewReplace, 'bar');
});
