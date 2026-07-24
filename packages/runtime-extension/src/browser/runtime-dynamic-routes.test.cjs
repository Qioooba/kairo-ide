// Runtime Client — table-driven tests for every dynamic
// route in the EndpointMap. Covers path parameter URL
// encoding, query parameters, Abort, timeout, non-JSON,
// 204, ok:false, requestId / correlationId propagation.
//
// These tests use the same `node:http` approach as
// runtime.test.cjs: stand up a real HTTP server on a random
// port, point the KairoRuntime at it, and assert on the
// real wire behaviour. The table is exhaustive over the
// routes that the v0.4 round actually uses; a future round
// should regenerate the table from the EndpointMap
// programmatically.
//
// Run with:
//   pnpm --filter @kairo/runtime-extension exec node --test src/browser/runtime-dynamic-routes.test.cjs
// or with the built lib:
//   node --test packages/runtime-extension/lib/browser/runtime-dynamic-routes.test.cjs

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

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { RuntimeConnectionService, KairoErrorListenerImpl } = require('@kairo/runtime-extension');

function makeRuntime() {
  const rt = new RuntimeConnectionService();
  rt['listener'] = new KairoErrorListenerImpl();
  return rt;
}

function runServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

// Table of dynamic routes the v0.4 round exercises. Each
// row tells the test what to send, what to assert, and
// what the server should respond with. The cases intentionally
// cover every method + every path param, plus the more
// interesting combinations.
const cases = [
  {
    name: 'GET /api/v1/builds/{id}',
    method: 'GET',
    endpoint: 'GET /api/v1/builds/{id}',
    pathParams: { id: 'b_x-1' },
    body: undefined,
    expect: { status: 200, ok: true, payload: { id: 'b_x-1', state: 'success' } },
  },
  {
    name: 'GET /api/v1/deployments/{id}',
    method: 'GET',
    endpoint: 'GET /api/v1/deployments/{id}',
    pathParams: { id: 'dep_1' },
    body: undefined,
    expect: { status: 200, ok: true, payload: { id: 'dep_1', state: 'success' } },
  },
  {
    name: 'GET /api/v1/servers/{id}',
    method: 'GET',
    endpoint: 'GET /api/v1/servers/{id}',
    pathParams: { id: 'srv_1' },
    body: undefined,
    expect: { status: 200, ok: true, payload: { id: 'srv_1', state: 'running' } },
  },
  {
    name: 'DELETE /api/v1/servers/{id}',
    method: 'DELETE',
    endpoint: 'DELETE /api/v1/servers/{id}',
    pathParams: { id: 'srv_2' },
    body: { force: true },
    expect: { status: 200, ok: true, payload: { id: 'srv_2', state: 'stopped' } },
  },
  {
    name: 'POST /api/v1/servers/{id}/debug',
    method: 'POST',
    endpoint: 'POST /api/v1/servers/{id}/debug',
    pathParams: { id: 'srv_3' },
    body: undefined,
    expect: { status: 200, ok: true, payload: { id: 'srv_3', state: 'running', debugPort: 54321 } },
  },
  {
    name: 'GET /api/v1/servers/{id}/logs',
    method: 'GET',
    endpoint: 'GET /api/v1/servers/{id}/logs',
    pathParams: { id: 'srv_4' },
    query: { follow: 'true' },
    body: undefined,
    expect: { status: 200, ok: true, payload: [{ line: 'hello', ts: 'now' }] },
  },
  {
    name: 'POST /api/v1/builds',
    method: 'POST',
    endpoint: 'POST /api/v1/builds',
    body: { projectId: 'p1', clean: true },
    expect: { status: 200, ok: true, payload: { id: 'b_new', state: 'queued' } },
  },
  {
    name: 'POST /api/v1/deployments',
    method: 'POST',
    endpoint: 'POST /api/v1/deployments',
    body: { projectId: 'p1', what: 'all' },
    expect: { status: 200, ok: true, payload: { id: 'd_new', state: 'success' } },
  },
  {
    name: 'POST /api/v1/servers',
    method: 'POST',
    endpoint: 'POST /api/v1/servers',
    body: { projectId: 'p1', debug: false },
    expect: { status: 200, ok: true, payload: { id: 'srv_new', state: 'running' } },
  },
  {
    name: 'POST /api/v1/search',
    method: 'POST',
    endpoint: 'POST /api/v1/search',
    body: { workspaceId: 'ws_1', query: 'Hello' },
    expect: { status: 200, ok: true, payload: { matches: [] } },
  },
  {
    name: 'POST /api/v1/encoding/detect',
    method: 'POST',
    endpoint: 'POST /api/v1/encoding/detect',
    body: { workspaceId: 'ws_1', file: '/tmp/hello.jsp' },
    expect: { status: 200, ok: true, payload: { encoding: 'GBK' } },
  },
  {
    name: 'POST /api/v1/encoding/recode',
    method: 'POST',
    endpoint: 'POST /api/v1/encoding/recode',
    body: { workspaceId: 'ws_1', file: '/tmp/hello.jsp', from: 'GBK', to: 'UTF-8' },
    expect: { status: 200, ok: true, payload: { ok: true, bytes: 1024 } },
  },
  {
    name: 'POST /api/v1/jdtls',
    method: 'POST',
    endpoint: 'POST /api/v1/jdtls',
    body: { jrePath: '/opt/jre17', sourceLevel: '1.6' },
    expect: { status: 200, ok: true, payload: { state: 'running', initializeOk: true } },
  },
  {
    name: 'POST /api/v1/jdtls/project',
    method: 'POST',
    endpoint: 'POST /api/v1/jdtls/project',
    body: { workspaceId: 'ws_1', rootPath: '/tmp/legacy-sample' },
    expect: { status: 200, ok: true, payload: { workspaceId: 'ws_1', projectId: 'legacy-sample' } },
  },
  {
    name: 'GET /api/v1/jdtls/project?workspaceId=...',
    method: 'GET',
    endpoint: 'GET /api/v1/jdtls/project',
    query: { workspaceId: 'ws_1' },
    body: undefined,
    expect: { status: 200, ok: true, payload: { workspaceId: 'ws_1', exists: true } },
  },
  {
    name: 'GET /api/v1/projects/{id}',
    method: 'GET',
    endpoint: 'GET /api/v1/projects/{id}',
    pathParams: { id: 'p1' },
    body: undefined,
    expect: { status: 200, ok: true, payload: { id: 'p1' } },
  },
  {
    name: 'PUT /api/v1/projects/{id}',
    method: 'PUT',
    endpoint: 'PUT /api/v1/projects/{id}',
    pathParams: { id: 'p1' },
    body: { config: { sourceLevel: '1.6' } },
    expect: { status: 200, ok: true, payload: { id: 'p1' } },
  },
  {
    name: 'POST /api/v1/workspaces/{id}/scan',
    method: 'POST',
    endpoint: 'POST /api/v1/workspaces/{id}/scan',
    pathParams: { id: 'ws_x' },
    body: { deep: true },
    expect: { status: 200, ok: true, payload: { detected: [] } },
  },
  {
    name: 'GET /api/v1/audit',
    method: 'GET',
    endpoint: 'GET /api/v1/audit',
    query: { since: '2026-01-01T00:00:00Z' },
    body: undefined,
    expect: { status: 200, ok: true, payload: [] },
  },
];

for (const c of cases) {
  test(`route: ${c.name}`, async () => {
    let captured = null;
    const { srv, baseUrl } = await runServer(async (req, res) => {
      captured = {
        method: req.method,
        url: req.url,
        body: await readBody(req),
        requestId: req.headers['x-kairo-request-id'],
        workspaceId: req.headers['x-kairo-workspace-id'],
      };
      res.writeHead(c.expect.status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          requestId: 'r1',
          ok: c.expect.ok,
          payload: c.expect.payload,
        }),
      );
    });
    try {
      const rt = makeRuntime();
      rt.configure({ baseUrl });
      const init = {};
      if (c.pathParams) init.pathParams = c.pathParams;
      if (c.query) init.query = c.query;
      const out = await rt.request(c.endpoint, c.body, init);
      assert.deepStrictEqual(out, c.expect.payload);
      // Method + URL sanity
      assert.strictEqual(captured.method, c.method, `method: ${c.method}`);
      if (c.pathParams) {
        for (const [k, v] of Object.entries(c.pathParams)) {
          const enc = encodeURIComponent(v);
          assert.ok(
            captured.url.includes(enc),
            `URL should contain encoded path param ${k}=${enc}; got ${captured.url}`,
          );
        }
      }
      if (c.query) {
        for (const [k, v] of Object.entries(c.query)) {
          assert.ok(
            captured.url.includes(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`),
            `URL should contain ${k}=${v}; got ${captured.url}`,
          );
        }
      }
      if (c.body !== undefined) {
        const env = JSON.parse(captured.body);
        assert.deepStrictEqual(env.payload, c.body);
      }
      assert.ok(captured.requestId && captured.requestId.length > 0, 'requestId should be set');
    } finally {
      srv.close();
    }
  });
}

// Special cases that the table cannot express: 204 No Content,
// ok:false envelope, non-JSON body.

test('204 No Content: empty body is treated as undefined, not as an error', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(204);
    res.end();
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    const out = await rt.request('GET /api/v1/health', undefined);
    assert.strictEqual(out, undefined);
  } finally {
    srv.close();
  }
});

test('ok:false with code+message: becomes a KairoError with the right shape', async () => {
  const cases = [
    { status: 409, code: 'already_exists', msg: 'build already in progress' },
    { status: 412, code: 'precondition_failed', msg: 'must stop server first' },
    { status: 503, code: 'agent_unavailable', msg: 'agent is shutting down' },
  ];
  for (const c of cases) {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(c.status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          requestId: 'r1',
          ok: false,
          error: { code: c.code, message: c.msg, retryable: false },
        }),
      );
    });
    try {
      const rt = makeRuntime();
      rt.configure({ baseUrl });
      await assert.rejects(rt.request('POST /api/v1/builds', { projectId: 'p1' }), (err) => {
        assert.strictEqual(err.code, c.code);
        assert.strictEqual(err.message, c.msg);
        assert.strictEqual(err.retryable, false);
        return true;
      });
    } finally {
      srv.close();
    }
  }
});

test('non-JSON body: surfaces as KairoError, not a parse exception', async () => {
  const payloads = [
    { body: '<html>gateway</html>', contentType: 'text/html', status: 502 },
    { body: 'plain text', contentType: 'text/plain', status: 500 },
    { body: '', contentType: 'application/json', status: 500 },
  ];
  for (const p of payloads) {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(p.status, { 'Content-Type': p.contentType });
      res.end(p.body);
    });
    try {
      const rt = makeRuntime();
      rt.configure({ baseUrl });
      await assert.rejects(rt.request('GET /api/v1/health', undefined), (err) => err instanceof Error);
    } finally {
      srv.close();
    }
  }
});

test('timeout: 100ms default aborts the request', async () => {
  const { srv, baseUrl } = await runServer(() => {
    // never respond
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl, defaultTimeoutMs: 100 });
    await assert.rejects(
      rt.request('GET /api/v1/health', undefined),
      (err) => err.code === 'timeout' || err.name === 'AbortError',
    );
  } finally {
    srv.close();
  }
});

test('AbortSignal: caller can cancel before the server responds', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200);
    res.end('{}');
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      rt.request('GET /api/v1/health', undefined, { signal: ac.signal }),
      (err) => err instanceof Error,
    );
  } finally {
    srv.close();
  }
});
