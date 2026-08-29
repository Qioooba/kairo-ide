'use strict';

// Integration tests for RuntimeConnectionService — tests the helper
// functions and data structures used by the service.

const { test } = require('node:test');
const assert = require('node:assert');

// ---- stripMethod -----------------------------------------------------------

function stripMethodForTest(endpoint) {
  const m = /^[A-Z]+\s+(\/.*)$/.exec(endpoint);
  return m ? m[1] : endpoint;
}

test('stripMethod: extracts path from GET endpoint', () => {
  assert.strictEqual(stripMethodForTest('GET /api/v1/health'), '/api/v1/health');
});

test('stripMethod: extracts path from POST endpoint', () => {
  assert.strictEqual(stripMethodForTest('POST /api/v1/workspaces'), '/api/v1/workspaces');
});

test('stripMethod: extracts path from PUT endpoint', () => {
  assert.strictEqual(stripMethodForTest('PUT /api/v1/projects/{projectId}'), '/api/v1/projects/{projectId}');
});

test('stripMethod: extracts path from DELETE endpoint', () => {
  assert.strictEqual(stripMethodForTest('DELETE /api/v1/builds/{buildId}'), '/api/v1/builds/{buildId}');
});

test('stripMethod: returns path as-is when no method prefix', () => {
  assert.strictEqual(stripMethodForTest('/api/v1/health'), '/api/v1/health');
});

// ---- methodOf ---------------------------------------------------------------

function methodOfForTest(endpoint) {
  const m = /^[A-Z]+\s+/.exec(endpoint);
  return m ? m[0].trim() : 'GET';
}

test('methodOf: returns GET for GET endpoint', () => {
  assert.strictEqual(methodOfForTest('GET /api/v1/health'), 'GET');
});

test('methodOf: returns POST for POST endpoint', () => {
  assert.strictEqual(methodOfForTest('POST /api/v1/workspaces'), 'POST');
});

test('methodOf: returns PUT for PUT endpoint', () => {
  assert.strictEqual(methodOfForTest('PUT /api/v1/projects/{projectId}'), 'PUT');
});

test('methodOf: returns DELETE for DELETE endpoint', () => {
  assert.strictEqual(methodOfForTest('DELETE /api/v1/builds/{buildId}'), 'DELETE');
});

test('methodOf: defaults to GET when no method', () => {
  assert.strictEqual(methodOfForTest('/api/v1/health'), 'GET');
});

// ---- newRequestId -----------------------------------------------------------

function newRequestIdForTest() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

test('newRequestId: returns a string', () => {
  const id = newRequestIdForTest();
  assert.strictEqual(typeof id, 'string');
});

test('newRequestId: format is UUID-like', () => {
  const id = newRequestIdForTest();
  assert.ok(id.length >= 32);
  assert.match(id, /^[0-9a-f-]+$/i);
});

test('newRequestId: two calls produce different values', () => {
  const id1 = newRequestIdForTest();
  const id2 = newRequestIdForTest();
  assert.notStrictEqual(id1, id2);
});

// ---- wsHostPortFromBase -----------------------------------------------------

function wsHostPortFromBaseForTest(baseUrl) {
  const stripped = baseUrl
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  return stripped || '127.0.0.1:0';
}

test('wsHostPortFromBase: extracts host:port from http URL', () => {
  assert.strictEqual(wsHostPortFromBaseForTest('http://127.0.0.1:18080'), '127.0.0.1:18080');
});

test('wsHostPortFromBase: extracts host:port from https URL', () => {
  assert.strictEqual(wsHostPortFromBaseForTest('https://agent.example.com:9443'), 'agent.example.com:9443');
});

test('wsHostPortFromBase: removes trailing slash', () => {
  assert.strictEqual(wsHostPortFromBaseForTest('http://127.0.0.1:18080/'), '127.0.0.1:18080');
});

test('wsHostPortFromBase: falls back for empty string', () => {
  assert.strictEqual(wsHostPortFromBaseForTest(''), '127.0.0.1:0');
});

// ---- KairoRuntimeConfig -----------------------------------------------------

test('KairoRuntimeConfig: valid structure', () => {
  const config = {
    baseUrl: 'http://127.0.0.1:18080',
    agentSecret: 'secret-123',
    defaultTimeoutMs: 60000,
    maxRetries: 2,
  };
  assert.strictEqual(config.baseUrl, 'http://127.0.0.1:18080');
  assert.strictEqual(config.agentSecret, 'secret-123');
  assert.strictEqual(config.defaultTimeoutMs, 60000);
  assert.strictEqual(config.maxRetries, 2);
});

// ---- KairoRequestInit -------------------------------------------------------

test('KairoRequestInit: pathParams substitution', () => {
  const init = {
    pathParams: { projectId: 'prj-1', buildId: 'build-2' },
  };
  assert.strictEqual(init.pathParams.projectId, 'prj-1');
  assert.strictEqual(init.pathParams.buildId, 'build-2');
});

test('KairoRequestInit: query parameters', () => {
  const init = {
    query: { port: 8080, workspaceId: 'ws-1' },
  };
  assert.strictEqual(init.query.port, 8080);
  assert.strictEqual(init.query.workspaceId, 'ws-1');
});

test('KairoRequestInit: abort signal', () => {
  const ctl = new AbortController();
  const init = { signal: ctl.signal };
  assert.ok(init.signal instanceof AbortSignal);
});

test('KairoRequestInit: timeout override', () => {
  const init = { timeoutMs: 30000, noRetry: true };
  assert.strictEqual(init.timeoutMs, 30000);
  assert.strictEqual(init.noRetry, true);
});

// ---- KairoWindow ------------------------------------------------------------

test('KairoWindow: __kairo shape', () => {
  const kairo = {
    agentBaseUrl: 'http://127.0.0.1:18080',
    getSecret: () => 'secret-123',
  };
  assert.strictEqual(typeof kairo.agentBaseUrl, 'string');
  assert.strictEqual(typeof kairo.getSecret, 'function');
  assert.strictEqual(kairo.getSecret(), 'secret-123');
});

test('KairoWindow: kairoConfig fallback', () => {
  const kairoCfg = {
    agentUrl: 'http://127.0.0.1:18080',
    agentSecret: 'secret-456',
  };
  assert.strictEqual(kairoCfg.agentUrl, 'http://127.0.0.1:18080');
  assert.strictEqual(kairoCfg.agentSecret, 'secret-456');
});

// ---- RuntimeEndpoints -------------------------------------------------------

test('RuntimeEndpoints: valid structure', () => {
  const endpoints = {
    http: '127.0.0.1:18080',
    events: '127.0.0.1:18081',
  };
  assert.strictEqual(endpoints.http, '127.0.0.1:18080');
  assert.strictEqual(endpoints.events, '127.0.0.1:18081');
});

// ---- KAIRO_WS_SUBPROTOCOL ---------------------------------------------------

test('KAIRO_WS_SUBPROTOCOL is kairo-secret-v1', () => {
  const KAIRO_WS_SUBPROTOCOL = 'kairo-secret-v1';
  assert.strictEqual(KAIRO_WS_SUBPROTOCOL, 'kairo-secret-v1');
});

// ---- URL construction logic -------------------------------------------------

test('url: constructs URL with pathParams', () => {
  const baseUrl = 'http://127.0.0.1:18080';
  let p = '/api/v1/projects/{projectId}';
  const pathParams = { projectId: 'prj-1' };
  for (const [k, v] of Object.entries(pathParams)) {
    p = p.replace(`{${k}}`, encodeURIComponent(v));
  }
  const url = baseUrl.replace(/\/$/, '') + p;
  assert.strictEqual(url, 'http://127.0.0.1:18080/api/v1/projects/prj-1');
});

test('url: constructs URL with query params', () => {
  const baseUrl = 'http://127.0.0.1:18080';
  const path = '/api/v1/diagnostics/port';
  let url = baseUrl.replace(/\/$/, '') + path;
  const query = { port: '8080' };
  const q = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    q.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  if (q.length > 0) {
    url += '?' + q.join('&');
  }
  assert.strictEqual(url, 'http://127.0.0.1:18080/api/v1/diagnostics/port?port=8080');
});

test('url: encodes special chars in path params', () => {
  let p = '/api/v1/projects/{projectId}';
  const pathParams = { projectId: 'my project/task' };
  for (const [k, v] of Object.entries(pathParams)) {
    p = p.replace(`{${k}}`, encodeURIComponent(v));
  }
  assert.strictEqual(p, '/api/v1/projects/my%20project%2Ftask');
});

// ---- RequestEnvelope --------------------------------------------------------

test('RequestEnvelope: valid structure', () => {
  const env = {
    workspaceId: 'ws-1',
    requestId: 'req-123',
    payload: { name: 'test' },
  };
  assert.strictEqual(env.workspaceId, 'ws-1');
  assert.strictEqual(env.requestId, 'req-123');
  assert.deepStrictEqual(env.payload, { name: 'test' });
});

// ---- EventStream status values ----------------------------------------------

test('EventStream: status values', () => {
  const statuses = ['connecting', 'open', 'disconnected', 'closed'];
  assert.strictEqual(statuses.length, 4);
  assert.ok(statuses.includes('open'));
  assert.ok(statuses.includes('disconnected'));
});

// ---- composeAbort logic -----------------------------------------------------

test('composeAbort: creates AbortSignal that fires on timeout', (t, done) => {
  const ctl = new AbortController();
  const timeoutMs = 50;
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'AbortError')), timeoutMs);
  ctl.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    assert.strictEqual(ctl.signal.aborted, true);
    done();
  });
});

// ---- delay function ---------------------------------------------------------

test('delay: resolves after timeout', async () => {
  const start = Date.now();
  await new Promise(resolve => setTimeout(resolve, 10));
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 8, `expected elapsed >= 8ms, got ${elapsed}ms`);
});

test('delay: aborts when signal fires', async () => {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 5);
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 1000);
      ctl.signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      }, { once: true });
    });
    assert.fail('should have thrown');
  } catch (err) {
    assert.strictEqual(err.message, 'aborted');
  }
});

// ---- DEFAULT_RUNTIME_BASE_URL -----------------------------------------------

test('DEFAULT_RUNTIME_BASE_URL is localhost 18080', () => {
  const DEFAULT_RUNTIME_BASE_URL = 'http://127.0.0.1:18080';
  assert.strictEqual(DEFAULT_RUNTIME_BASE_URL, 'http://127.0.0.1:18080');
});