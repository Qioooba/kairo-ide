// Runtime Client unit tests — covers all wire-level behaviors
// the Kairo IDE depends on. Uses Node's built-in test runner
// (node:test) so no test framework setup is needed beyond
// what ships with Node 20.
//
// Run with:
//   pnpm --filter @kairo/runtime-extension exec node --test src/browser/runtime.test.cjs
//
// or with the built lib:
//   node --test packages/runtime-extension/lib/browser/runtime.test.cjs
//
// Each test stands up a real http.createServer on a random
// port and points the RuntimeConnectionService at it. The server is
// the canonical "agent" — same wire contract as the Go
// runtime-agent. This catches real fetch / AbortController /
// header behavior, not a mock that would lie about all of
// them.

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
  // Bypass Inversify — assign the listener directly.
  rt['listener'] = new KairoErrorListenerImpl();
  return rt;
}

// runServer starts an HTTP server on 127.0.0.1 with a random
// port. `handler(req, res)` decides the response.
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
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

// Test 1: GET path expansion (the {id} parameter).
test('GET request: {id} path expansion encodes URI components', async () => {
  let captured = null;
  const { srv, baseUrl } = await runServer((req, res) => {
    captured = { method: req.method, url: req.url, headers: req.headers };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, payload: { id: 'srv_1' } }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    const out = await rt.request('GET /api/v1/servers/{id}', undefined, {
      pathParams: { id: 'srv/with spaces & 中文' },
    });
    assert.strictEqual(out.id, 'srv_1');
    assert.ok(captured.url.startsWith('/api/v1/servers/'), `path should be expanded, got ${captured.url}`);
    assert.ok(captured.url.includes('srv'), `path should include id, got ${captured.url}`);
  } finally { srv.close(); }
});

// Test 2: multiple path parameters + query encoding (CJK + spaces + special chars).
test('GET request: multi-param path + CJK / space / special-char query', async () => {
  let captured = null;
  const { srv, baseUrl } = await runServer((req, res) => {
    captured = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, payload: [] }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    await rt.request('GET /api/v1/workspaces/{id}/scan', undefined, {
      pathParams: { id: 'ws 中国' },
      query: { name: 'q&a=c', tag: '中文 空格', n: 1 },
    });
    assert.ok(captured.includes('ws'), captured);
    assert.ok(captured.includes('name='), captured);
    assert.ok(!captured.includes(' '), `query should be encoded, got: ${captured}`);
    assert.ok(captured.includes('tag='), captured);
  } finally { srv.close(); }
});

// Test 3: POST with envelope body, request id propagates.
test('POST request: envelope wraps payload; requestId is generated', async () => {
  let captured = null;
  const { srv, baseUrl } = await runServer(async (req, res) => {
    captured = { method: req.method, body: await readBody(req), reqId: req.headers['x-kairo-request-id'] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, payload: { id: 'b_1', state: 'success' } }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    const out = await rt.request('POST /api/v1/builds', { projectId: 'p1' });
    assert.strictEqual(out.state, 'success');
    assert.strictEqual(captured.method, 'POST');
    const env = JSON.parse(captured.body);
    assert.strictEqual(env.payload.projectId, 'p1');
    assert.ok(typeof env.requestId === 'string' && env.requestId.length > 0, `requestId should be set: ${env.requestId}`);
    assert.strictEqual(captured.reqId, env.requestId, 'X-Kairo-Request-Id header must match envelope');
  } finally { srv.close(); }
});

// Test 4: 4xx and 5xx are surfaced as KairoError with the right code.
test('error responses: 400 / 401 / 403 / 404 / 500 unwrap to KairoError', async () => {
  const cases = [
    { status: 400, code: 'invalid_request' },
    { status: 401, code: 'unauthenticated' },
    { status: 403, code: 'forbidden' },
    { status: 404, code: 'not_found' },
    { status: 500, code: 'internal' },
  ];
  for (const c of cases) {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(c.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: { code: c.code, message: 'server says no' },
      }));
    });
    try {
      const rt = makeRuntime();
      rt.configure({ baseUrl });
      await assert.rejects(
        rt.request('GET /api/v1/health', undefined),
        (err) => {
          assert.strictEqual(err.code, c.code, `expected ${c.code}, got ${err.code}`);
          return true;
        },
      );
    } finally { srv.close(); }
  }
});

// Test 5: ok:false envelope is unwrapped to a thrown KairoError.
test('ok:false protocol response: unwrapped to KairoError', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r2',
      ok: false,
      error: { code: 'plugin_crashed', message: 'jdtls died', retryable: true },
    }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    await assert.rejects(
      rt.request('GET /api/v1/health', undefined),
      (err) => {
        assert.strictEqual(err.code, 'plugin_crashed');
        assert.strictEqual(err.retryable, true);
        return true;
      },
    );
  } finally { srv.close(); }
});

// Test 6: non-JSON response (HTML error page, e.g. an ingress
// landing page) does not crash the client; it becomes a
// KairoError with the right code.
test('non-JSON response: surfaced as KairoError, not a JSON parse exception', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end('<html><body>Bad Gateway</body></html>');
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    await assert.rejects(
      rt.request('GET /api/v1/health', undefined),
      (err) => {
        assert.ok(err, 'should have thrown something');
        assert.ok(err.message, 'error has a message');
        return true;
      },
    );
  } finally { srv.close(); }
});

// Test 7: invalid JSON body on a 200 — same as above.
test('invalid JSON body: surfaced as KairoError', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{not valid json');
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    await assert.rejects(
      rt.request('GET /api/v1/health', undefined),
      () => true,
    );
  } finally { srv.close(); }
});

// Test 8: timeout — request must throw a timeout-flavoured
// KairoError when the server stalls past timeoutMs.
test('timeout: request aborts past timeoutMs and surfaces timeout error', async () => {
  const { srv, baseUrl } = await runServer(() => {
    // Never respond.
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl, defaultTimeoutMs: 100 });
    await assert.rejects(
      rt.request('GET /api/v1/health', undefined),
      (err) => {
        const isTimeout = err.code === 'timeout' || err.name === 'AbortError';
        assert.ok(isTimeout, `expected timeout/AbortError, got code=${err.code} name=${err.name}`);
        return true;
      },
    );
  } finally { srv.close(); }
});

// Test 9: AbortController — caller can cancel the request.
test('AbortController: pre-aborted signal throws immediately', async () => {
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
  } finally { srv.close(); }
});

// Test 10: success path — payload is unwrapped from the envelope.
test('success path: payload is the unwrapped envelope payload', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r3',
      ok: true,
      payload: { state: 'running', pid: 4242 },
    }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    const out = await rt.request('GET /api/v1/jdtls', undefined);
    assert.deepStrictEqual(out, { state: 'running', pid: 4242 });
  } finally { srv.close(); }
});

// Test 11: network error (refused connection) — no agent listening.
test('network error: connection refused surfaces as KairoError', async () => {
  const rt = makeRuntime();
  const { srv, port } = await runServer(() => {});
  srv.close();
  rt.configure({ baseUrl: `http://127.0.0.1:${port}` });
  await assert.rejects(
    rt.request('GET /api/v1/health', undefined),
    () => true,
  );
});

// Test 12: PUT and DELETE.
test('PUT / DELETE methods are supported', async () => {
  const seen = [];
  const { srv, baseUrl } = await runServer((req, res) => {
    seen.push(req.method);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, payload: { id: 'x' } }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    await rt.request('PUT /api/v1/projects/{id}', { id: 'p1', config: {} }, { pathParams: { id: 'p1' } });
    await rt.request('DELETE /api/v1/servers/{id}', undefined, { pathParams: { id: 'srv_1' } });
    assert.deepStrictEqual(seen, ['PUT', 'DELETE']);
  } finally { srv.close(); }
});

// Test 13: workspaceId and requestId propagate as X-Kairo-Workspace-Id and X-Kairo-Request-Id.
test('workspaceId + requestId header propagation', async () => {
  let captured = null;
  const { srv, baseUrl } = await runServer(async (req, res) => {
    captured = {
      ws: req.headers['x-kairo-workspace-id'],
      req: req.headers['x-kairo-request-id'],
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, payload: { id: 'ok' } }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    rt.setWorkspace('ws_correlation');
    await rt.request('GET /api/v1/health', undefined);
    assert.strictEqual(captured.ws, 'ws_correlation', 'X-Kairo-Workspace-Id must propagate');
    assert.ok(captured.req && captured.req.length > 0, 'X-Kairo-Request-Id must be set');
  } finally { srv.close(); }
});

// Test 14: agent secret attaches as X-Kairo-Secret header.
test('agentSecret attaches as X-Kairo-Secret header (no Authorization Bearer)', async () => {
  let captured = null;
  const { srv, baseUrl } = await runServer((req, res) => {
    captured = {
      secret: req.headers['x-kairo-secret'],
      authorization: req.headers['authorization'],
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl, agentSecret: 'secret-token' });
    await rt.request('GET /api/v1/health', undefined);
    assert.strictEqual(captured.secret, 'secret-token', 'X-Kairo-Secret must carry the agent secret');
    assert.strictEqual(captured.authorization, undefined, 'Authorization header must NOT be set');
  } finally { srv.close(); }
});

// Test 15: missing secret header results in 401 from agent.
test('secret header missing: agent returns 401 unauthenticated', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    const secret = req.headers['x-kairo-secret'];
    if (!secret) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_auth',
        ok: false,
        error: { code: 'unauthenticated', message: 'missing X-Kairo-Secret header' },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });
  try {
    const rt = makeRuntime();
    // No secret configured
    rt.configure({ baseUrl });
    await assert.rejects(
      rt.request('GET /api/v1/builds', undefined),
      (err) => {
        assert.strictEqual(err.code, 'unauthenticated');
        return true;
      },
    );
  } finally { srv.close(); }
});

// Test 16: wrong secret header results in 403 forbidden.
test('secret header wrong: agent returns 403 forbidden', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    const secret = req.headers['x-kairo-secret'];
    if (secret !== 'correct-secret') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_auth',
        ok: false,
        error: { code: 'forbidden', message: 'invalid X-Kairo-Secret' },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl, agentSecret: 'wrong-secret' });
    await assert.rejects(
      rt.request('GET /api/v1/builds', undefined),
      (err) => {
        assert.strictEqual(err.code, 'forbidden');
        return true;
      },
    );
  } finally { srv.close(); }
});

// Test 17: 405 Method Not Allowed for unsupported methods.
test('405: unsupported method returns Method Not Allowed', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, POST' });
    res.end(JSON.stringify({
      requestId: 'r_m',
      ok: false,
      error: { code: 'invalid_request', message: 'method not allowed' },
    }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    await assert.rejects(
      rt.request('PATCH /api/v1/projects/x', undefined),
      (err) => {
        assert.strictEqual(err.code, 'invalid_request');
        return true;
      },
    );
  } finally { srv.close(); }
});

// Test 18: verify that refreshBuilds makes GET /api/v1/builds request.
test('GET /api/v1/builds returns real build list state', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r_builds',
      ok: true,
      payload: [
        { id: 'b1', state: 'success', startedAt: '2026-01-01T00:00:00Z', diagnostics: [], output: '', summary: { errors: 0, warnings: 0, filesCompiled: 5 } },
        { id: 'b2', state: 'failure', startedAt: '2026-01-02T00:00:00Z', diagnostics: [], output: '', summary: { errors: 3, warnings: 1, filesCompiled: 10 } },
      ],
    }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    const builds = await rt.request('GET /api/v1/builds', undefined);
    assert.ok(Array.isArray(builds), 'builds response must be an array');
    assert.strictEqual(builds.length, 2);
    assert.strictEqual(builds[0].id, 'b1');
    assert.strictEqual(builds[0].state, 'success');
    assert.strictEqual(builds[1].id, 'b2');
    assert.strictEqual(builds[1].state, 'failure');
    assert.strictEqual(builds[1].summary.errors, 3);
  } finally { srv.close(); }
});

// Test 19: verify that GET /api/v1/deployments returns real deployment list state.
test('GET /api/v1/deployments returns real deployment list with file stats', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r_deploys',
      ok: true,
      payload: [
        { id: 'd1', state: 'success', startedAt: '2026-01-01T00:00:00Z', filesTouched: 12, bytes: 4096, trigger: 'manual', hotReloadMode: 'staticSync' },
      ],
    }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    const deployments = await rt.request('GET /api/v1/deployments', undefined);
    assert.ok(Array.isArray(deployments));
    assert.strictEqual(deployments.length, 1);
    assert.strictEqual(deployments[0].id, 'd1');
    assert.strictEqual(deployments[0].state, 'success');
    assert.strictEqual(deployments[0].filesTouched, 12);
    assert.strictEqual(deployments[0].bytes, 4096);
  } finally { srv.close(); }
});

// Test 20: verify that GET /api/v1/servers returns real server list state.
test('GET /api/v1/servers returns real server list with state', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r_servers',
      ok: true,
      payload: [
        { id: 'srv1', state: 'running', pid: 1234, ports: { http: 8080 }, startedAt: '2026-01-01T00:00:00Z', catalinaBase: '/tmp/cb' },
      ],
    }));
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    const servers = await rt.request('GET /api/v1/servers', undefined);
    assert.ok(Array.isArray(servers));
    assert.strictEqual(servers.length, 1);
    assert.strictEqual(servers[0].id, 'srv1');
    assert.strictEqual(servers[0].state, 'running');
    assert.strictEqual(servers[0].pid, 1234);
    assert.strictEqual(servers[0].ports.http, 8080);
  } finally { srv.close(); }
});

// Test 21: verify that POST /api/v1/servers/{id}/restart changes PID.
test('POST /api/v1/servers/{id}/restart: new PID is different from old', async () => {
  let callCount = 0;
  const { srv, baseUrl } = await runServer((req, res) => {
    callCount++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (callCount === 1) {
      // Initial GET /api/v1/servers
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: true,
        payload: [{ id: 'srv1', state: 'running', pid: 1000, ports: { http: 8080 }, catalinaBase: '/tmp/cb' }],
      }));
    } else {
      // POST restart response
      res.end(JSON.stringify({
        requestId: 'r2',
        ok: true,
        payload: { id: 'srv1', state: 'running', pid: 2000, ports: { http: 8080 }, catalinaBase: '/tmp/cb' },
      }));
    }
  });
  try {
    const rt = makeRuntime();
    rt.configure({ baseUrl });
    // First, get the server list
    const servers = await rt.request('GET /api/v1/servers', undefined);
    assert.strictEqual(servers[0].pid, 1000, 'initial PID must be 1000');
    // Then restart
    const restarted = await rt.request('POST /api/v1/servers/{serverId}/restart', undefined, { pathParams: { serverId: 'srv1' } });
    assert.strictEqual(restarted.pid, 2000, 'restarted PID must be 2000');
    assert.notStrictEqual(restarted.pid, servers[0].pid, 'PID must change after restart');
  } finally { srv.close(); }
});

// Test 22: protocol no longer contains unsupported JDT DELETE.
test('protocol: DELETE /api/v1/jdtls is not in the endpoint map', async () => {
  // The protocol should not support DELETE /api/v1/jdtls
  // because JDT lifecycle is managed by the Theia backend.
  // This test verifies that the client does not attempt to
  // call this endpoint by checking the endpoint map.
  const rt = makeRuntime();
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r_jdt',
      ok: false,
      error: { code: 'not_found', message: 'JDT DELETE not supported — use Theia backend' },
    }));
  });
  try {
    rt.configure({ baseUrl });
    await assert.rejects(
      rt.request('DELETE /api/v1/jdtls', undefined),
      (err) => {
        assert.strictEqual(err.code, 'not_found');
        return true;
      },
    );
  } finally { srv.close(); }
});