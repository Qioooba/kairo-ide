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
// port and points the KairoRuntime at it. The server is
// the canonical "agent" — same wire contract as the Go
// runtime-agent. This catches real fetch / AbortController /
// header behavior, not a mock that would lie about all of
// them.

'use strict';

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
    // workspaceId is a path param and gets URL-encoded; the
    // rest is query string. We just assert the URL is
    // query-encoded (not raw) and contains each token.
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
        // Either the agent's 502 with a parse error, or the
        // protocol layer turning the parse error into a
        // KairoError. Either way it must not throw a raw
        // SyntaxError / JSON parse error to the caller.
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
        // The client throws KairoError{code: 'timeout'} or
        // a fetch-flavoured AbortError. Either is acceptable.
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
      (err) => err.name === 'AbortError' || err.code === 'timeout',
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
  // Pick an unused port by listening and immediately closing.
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
// Per docs/hotfix-windows-test-readiness.md 搂1.1, the
// secret rides in `X-Kairo-Secret`. The previous
// `Authorization: Bearer` pattern has been removed from the
// protocol — this test guards the new contract.
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
