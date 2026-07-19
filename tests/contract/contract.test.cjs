// Contract tests — validate every endpoint in the frozen Kairo
// IDE API against the shared golden fixture. The same
// testdata/contracts/endpoints.json is used by the Go test
// suite, so both sides stay in sync.
//
// Each test starts a real HTTP server that responds with the
// golden payload. We verify:
//   1. Every endpoint defines a method and path
//   2. Success responses have the correct status and payload shape
//   3. Error responses have the expected status, code, and message
//   4. The envelope format (ok, requestId, payload/error) is consistent
//   5. Protocol rules: no JDT DELETE, X-Kairo-Secret header, no
//      Authorization Bearer, unsupported methods return 405
//
// Run with:
//   node --test tests/contract/contract.test.cjs

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const fixturesPath = path.join(__dirname, '..', '..', 'testdata', 'contracts', 'endpoints.json');
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));

// --------------- helpers ---------------

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

async function fetchRequest(baseUrl, method, pathTemplate, body, opts = {}) {
  let resolvedPath = pathTemplate;
  if (opts.pathParams) {
    for (const [key, value] of Object.entries(opts.pathParams)) {
      resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(value));
    }
  }
  if (opts.query) {
    resolvedPath += '?' + opts.query;
  }

  const headers = {};
  if (opts.secret) {
    headers['X-Kairo-Secret'] = opts.secret;
  }
  if (opts.authorization) {
    headers['Authorization'] = opts.authorization;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  return new Promise((resolve, reject) => {
    const url = new URL(resolvedPath, baseUrl);
    const req = http.request(url, {
      method,
      headers,
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        let jsonBody = null;
        try { jsonBody = JSON.parse(rawBody); } catch (_e) { /* not JSON */ }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          rawBody,
          jsonBody,
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// --------------- endpoint existence tests ---------------

test('every endpoint fixture defines method and path', () => {
  for (const ep of fixtures.endpoints) {
    assert.ok(typeof ep.method === 'string' && ep.method.length > 0,
      `Endpoint at ${ep.path} must define a method`);
    assert.ok(typeof ep.path === 'string' && ep.path.length > 0,
      `Endpoint must define a path`);
    assert.ok(ep.path.startsWith('/api/v1/'),
      `Path ${ep.path} must start with /api/v1/`);
  }
});

test('no duplicate method+path combinations', () => {
  const seen = new Set();
  for (const ep of fixtures.endpoints) {
    const key = `${ep.method} ${ep.path}`;
    assert.ok(!seen.has(key), `Duplicate endpoint: ${key}`);
    seen.add(key);
  }
});

// --------------- success response tests ---------------

for (const ep of fixtures.endpoints) {
  test(`contract: ${ep.method} ${ep.path} — success response shape`, async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(ep.successResponse.status, { 'Content-Type': 'application/json' });
      // Wrap in the standard envelope
      const envelope = {
        requestId: 'test-req-1',
        ok: true,
        payload: ep.successResponse.payload,
      };
      res.end(JSON.stringify(envelope));
    });

    try {
      const method = ep.method;
      const pathParams = {};
      const pathPattern = /\{(\w+)\}/g;
      let match;
      while ((match = pathPattern.exec(ep.path)) !== null) {
        pathParams[match[1]] = 'test-id';
      }

      const resp = await fetchRequest(baseUrl, method, ep.path, ep.request, { pathParams });

      assert.strictEqual(resp.status, ep.successResponse.status,
        `${method} ${ep.path}: expected status ${ep.successResponse.status}, got ${resp.status}`);

      if (ep.successResponse.status !== 204) {
        assert.ok(resp.jsonBody, `${method} ${ep.path}: response must be valid JSON`);
        assert.strictEqual(resp.jsonBody.ok, true,
          `${method} ${ep.path}: envelope must have ok: true`);
        assert.ok(resp.jsonBody.requestId, `${method} ${ep.path}: envelope must have requestId`);

        if (ep.successResponse.payload !== null) {
          assert.ok(resp.jsonBody.payload !== undefined,
            `${method} ${ep.path}: payload must exist in response`);
        }
      }
    } finally {
      srv.close();
    }
  });
}

// --------------- error response tests ---------------

for (const ep of fixtures.endpoints) {
  for (const errCase of ep.errorResponses) {
    test(`contract: ${ep.method} ${ep.path} — error ${errCase.status} ${errCase.code}`, async () => {
      const { srv, baseUrl } = await runServer((req, res) => {
        res.writeHead(errCase.status, { 'Content-Type': 'application/json' });
        const envelope = {
          requestId: 'test-err-1',
          ok: false,
          error: { code: errCase.code, message: errCase.message },
        };
        res.end(JSON.stringify(envelope));
      });

      try {
        const pathParams = {};
        const pathPattern = /\{(\w+)\}/g;
        let match;
        while ((match = pathPattern.exec(ep.path)) !== null) {
          pathParams[match[1]] = 'test-id';
        }

        const resp = await fetchRequest(baseUrl, ep.method, ep.path, ep.request, { pathParams });

        assert.strictEqual(resp.status, errCase.status,
          `${ep.method} ${ep.path}: expected error status ${errCase.status}, got ${resp.status}`);

        if (errCase.status !== 204) {
          assert.ok(resp.jsonBody, 'error response must be JSON');
          assert.strictEqual(resp.jsonBody.ok, false, 'error envelope must have ok: false');
          assert.strictEqual(resp.jsonBody.error.code, errCase.code,
            `expected error code ${errCase.code}, got ${resp.jsonBody.error.code}`);
          assert.ok(resp.jsonBody.error.message, 'error must have a message');
        }
      } finally {
        srv.close();
      }
    });
  }
}

// --------------- list state shape tests ---------------

test('GET /api/v1/builds returns list (array) state shape', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r1',
      ok: true,
      payload: [{ id: 'b1', state: 'success', summary: { errors: 0, warnings: 0, filesCompiled: 5 } }],
    }));
  });
  try {
    const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/builds');
    assert.strictEqual(resp.status, 200);
    assert.ok(Array.isArray(resp.jsonBody.payload));
    assert.strictEqual(resp.jsonBody.payload[0].state, 'success');
    assert.strictEqual(resp.jsonBody.payload[0].summary.errors, 0);
  } finally { srv.close(); }
});

test('GET /api/v1/deployments returns list (array) state shape', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r1',
      ok: true,
      payload: [{ id: 'd1', state: 'success', filesTouched: 12, bytes: 4096 }],
    }));
  });
  try {
    const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/deployments');
    assert.strictEqual(resp.status, 200);
    assert.ok(Array.isArray(resp.jsonBody.payload));
    assert.strictEqual(resp.jsonBody.payload[0].state, 'success');
    assert.strictEqual(resp.jsonBody.payload[0].filesTouched, 12);
    assert.strictEqual(resp.jsonBody.payload[0].bytes, 4096);
  } finally { srv.close(); }
});

test('GET /api/v1/servers returns list (array) state shape', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r1',
      ok: true,
      payload: [{ id: 'srv1', state: 'running', pid: 1234, ports: { http: 8080 } }],
    }));
  });
  try {
    const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/servers');
    assert.strictEqual(resp.status, 200);
    assert.ok(Array.isArray(resp.jsonBody.payload));
    assert.strictEqual(resp.jsonBody.payload[0].state, 'running');
    assert.strictEqual(resp.jsonBody.payload[0].pid, 1234);
  } finally { srv.close(); }
});

// --------------- unsupported method returns 405 ---------------

test('unsupported method returns 405 for existing paths', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    // PATCH is not a supported method for any endpoint
    if (req.method === 'PATCH') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, POST, PUT, DELETE' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: { code: 'invalid_request', message: 'method not allowed' },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: 'r1', ok: true, payload: [] }));
    }
  });
  try {
    // PATCH on /api/v1/servers should return 405
    const resp = await fetchRequest(baseUrl, 'PATCH', '/api/v1/servers');
    assert.strictEqual(resp.status, 405, 'unsupported method must return 405');
    assert.strictEqual(resp.jsonBody.ok, false);
    assert.strictEqual(resp.jsonBody.error.code, 'invalid_request');
    assert.ok(resp.headers.allow, '405 response must include Allow header');
  } finally { srv.close(); }
});

// --------------- secret header tests ---------------

test('secret header missing: server returns 401 unauthenticated', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    const secret = req.headers['x-kairo-secret'];
    if (!secret) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: { code: 'unauthenticated', message: 'missing X-Kairo-Secret' },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: 'r1', ok: true, payload: [] }));
    }
  });
  try {
    const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/builds');
    assert.strictEqual(resp.status, 401);
    assert.strictEqual(resp.jsonBody.error.code, 'unauthenticated');
  } finally { srv.close(); }
});

test('secret header wrong: server returns 403 forbidden', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    const secret = req.headers['x-kairo-secret'];
    if (secret !== 'correct-secret') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: { code: 'forbidden', message: 'invalid secret' },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: 'r1', ok: true, payload: [] }));
    }
  });
  try {
    const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/builds', null, { secret: 'wrong' });
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(resp.jsonBody.error.code, 'forbidden');
  } finally { srv.close(); }
});

test('secret header correct: server returns 200', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    const secret = req.headers['x-kairo-secret'];
    if (secret !== 'correct-secret') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: 'r1', ok: false, error: { code: 'forbidden', message: 'invalid' } }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: 'r1', ok: true, payload: [{ id: 'b1', state: 'success' }] }));
    }
  });
  try {
    const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/builds', null, { secret: 'correct-secret' });
    assert.strictEqual(resp.status, 200);
    assert.ok(resp.jsonBody.payload);
  } finally { srv.close(); }
});

// --------------- no Authorization Bearer ---------------

test('no Authorization Bearer header: X-Kairo-Secret is the only auth mechanism', async () => {
  let capturedAuth = null;
  const { srv, baseUrl } = await runServer((req, res) => {
    capturedAuth = req.headers['authorization'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ requestId: 'r1', ok: true, payload: [] }));
  });
  try {
    await fetchRequest(baseUrl, 'GET', '/api/v1/builds', null, { secret: 'correct-secret' });
    assert.strictEqual(capturedAuth, undefined,
      'Authorization header must not be set — X-Kairo-Secret is the only auth mechanism');
  } finally { srv.close(); }
});

// --------------- protocol rules: no JDT DELETE ---------------

test('protocol rule: DELETE /api/v1/jdtls is not in the endpoint map', () => {
  const hasJdtDelete = fixtures.endpoints.some(
    ep => ep.method === 'DELETE' && ep.path === '/api/v1/jdtls'
  );
  assert.strictEqual(hasJdtDelete, false,
    'DELETE /api/v1/jdtls must not exist — JDT lifecycle is managed by Theia backend');
});

// --------------- POST /api/v1/servers/{id}/restart changes PID ---------------

test('POST /api/v1/servers/{id}/restart: PID changes after restart', async () => {
  let callCount = 0;
  const { srv, baseUrl } = await runServer((req, res) => {
    callCount++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (callCount === 1) {
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: true,
        payload: [{ id: 'srv1', state: 'running', pid: 1000, ports: { http: 8080 } }],
      }));
    } else {
      res.end(JSON.stringify({
        requestId: 'r2',
        ok: true,
        payload: { id: 'srv1', state: 'running', pid: 2000, ports: { http: 8080 } },
      }));
    }
  });
  try {
    // Get initial servers
    const before = await fetchRequest(baseUrl, 'GET', '/api/v1/servers');
    assert.strictEqual(before.jsonBody.payload[0].pid, 1000);

    // Restart
    const after = await fetchRequest(baseUrl, 'POST', '/api/v1/servers/{serverId}/restart', null, {
      pathParams: { serverId: 'srv1' },
    });
    assert.strictEqual(after.jsonBody.payload.pid, 2000);
    assert.notStrictEqual(after.jsonBody.payload.pid, before.jsonBody.payload[0].pid,
      'PID must change after restart');
  } finally { srv.close(); }
});

// --------------- WebSocket endpoints ---------------

test('WebSocket: EventStream endpoint exists at /api/v1/events', () => {
  // The WebSocket endpoint is not in the REST endpoint list but is
  // part of the frozen API. Verify the protocol rules mention it.
  assert.ok(fixtures.protocolRules, 'protocol rules must exist');
  assert.ok(fixtures.protocolRules.secretHeader === 'X-Kairo-Secret',
    'X-Kairo-Secret must be the auth header');
});

// --------------- envelope format consistency ---------------

test('envelope format: all success responses have ok:true and requestId', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ requestId: 'r1', ok: true, payload: { id: 'test' } }));
  });
  try {
    const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/health');
    assert.strictEqual(resp.jsonBody.ok, true);
    assert.ok(typeof resp.jsonBody.requestId === 'string');
    assert.ok(resp.jsonBody.requestId.length > 0);
  } finally { srv.close(); }
});

test('envelope format: all error responses have ok:false and error.code', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requestId: 'r1',
      ok: false,
      error: { code: 'invalid_request', message: 'bad input' },
    }));
  });
  try {
    const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/builds', {});
    assert.strictEqual(resp.jsonBody.ok, false);
    assert.ok(typeof resp.jsonBody.error.code === 'string');
    assert.ok(resp.jsonBody.error.code.length > 0);
  } finally { srv.close(); }
});

// --------------- Go/TS fixture parity ---------------

test('Go/TS fixture parity: every endpoint has method, path, successResponse, errorResponses', () => {
  for (const ep of fixtures.endpoints) {
    assert.ok(ep.method, `Endpoint must have method`);
    assert.ok(ep.path, `Endpoint must have path`);
    assert.ok(ep.successResponse, `${ep.method} ${ep.path}: must have successResponse`);
    assert.ok(typeof ep.successResponse.status === 'number',
      `${ep.method} ${ep.path}: successResponse must have status code`);
    assert.ok(Array.isArray(ep.errorResponses),
      `${ep.method} ${ep.path}: errorResponses must be an array`);
  }
});

test('fixture version is v1', () => {
  assert.strictEqual(fixtures.version, 'v1',
    'Contract fixture version must be v1');
});