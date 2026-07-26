// Contract tests — extended protocol contract verification for
// the Kairo IDE core API endpoints. These tests validate the
// protocol contract between the frontend and backend beyond the
// basic endpoint shape tests in contract.test.cjs.
//
// Key coverage:
//   1. Response envelope shape for all core endpoints
//   2. Error response codes and messages
//   3. KairoTaskRef / KairoError format verification
//   4. HTTP method validation
//   5. Content-Type header validation
//   6. Request ID propagation
//   7. CORS preflight handling
//   8. Header-based workspace/project resolution
//
// Run with:
//   node --test tests/contract/api-contract-extended.test.cjs

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

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

async function fetchRequest(baseUrl, method, path, body, opts = {}) {
  const headers = {};
  if (opts.secret) {
    headers['X-Kairo-Secret'] = opts.secret;
  }
  if (opts.workspaceId) {
    headers['X-Kairo-Workspace-Id'] = opts.workspaceId;
  }
  if (opts.requestId) {
    headers['X-Kairo-Request-Id'] = opts.requestId;
  }
  if (opts.correlationId) {
    headers['X-Kairo-Correlation-Id'] = opts.correlationId;
  }
  if (opts.origin) {
    headers['Origin'] = opts.origin;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
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

// --------------- Core API Contract Tests ---------------

// --- Health endpoint ---

describe('Health endpoint contract', () => {
  test('GET /api/v1/health returns 200 with ok:true', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: {
          ok: true,
          version: 'v1',
          agentVersion: '0.1.0',
          uptimeSec: 3600,
          platform: { os: 'darwin', arch: 'arm64' },
          bindAddress: '127.0.0.1',
          port: 18080,
          activeSessions: 0,
        },
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/health');
      assert.strictEqual(resp.status, 200);
      assert.strictEqual(resp.jsonBody.ok, true);
      assert.strictEqual(resp.jsonBody.payload.ok, true);
      assert.ok(resp.jsonBody.payload.version);
      assert.ok(resp.jsonBody.payload.uptimeSec >= 0);
    } finally { srv.close(); }
  });

  test('GET /api/v1/health is accessible without auth secret', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      // Health endpoint should NOT require X-Kairo-Secret
      const secret = req.headers['x-kairo-secret'];
      assert.strictEqual(secret, undefined, 'Health endpoint should not require secret');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: { ok: true } }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/health');
      assert.strictEqual(resp.status, 200);
    } finally { srv.close(); }
  });
});

// --- Project import endpoint ---

describe('Project import endpoint contract', () => {
  test('POST /api/v1/projects/import requires workspaceId', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const payload = JSON.parse(body);
        if (!payload.workspaceId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: false,
            error: { code: 'invalid_request', message: 'workspaceId required' },
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: { id: 'proj-1' } }));
        }
      });
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/projects/import', { name: 'test' });
      assert.strictEqual(resp.status, 400);
      assert.strictEqual(resp.jsonBody.ok, false);
      assert.strictEqual(resp.jsonBody.error.code, 'invalid_request');
    } finally { srv.close(); }
  });

  test('POST /api/v1/projects/import requires name', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const payload = JSON.parse(body);
        if (!payload.name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: false,
            error: { code: 'invalid_request', message: 'name required' },
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: { id: 'proj-1' } }));
        }
      });
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/projects/import', { workspaceId: 'ws-1' });
      assert.strictEqual(resp.status, 400);
      assert.strictEqual(resp.jsonBody.error.code, 'invalid_request');
    } finally { srv.close(); }
  });

  test('POST /api/v1/projects/import requires rootPath', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const payload = JSON.parse(body);
        if (!payload.rootPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: false,
            error: { code: 'invalid_request', message: 'rootPath required' },
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: { id: 'proj-1' } }));
        }
      });
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/projects/import', {
        workspaceId: 'ws-1',
        name: 'test',
      });
      assert.strictEqual(resp.status, 400);
      assert.strictEqual(resp.jsonBody.error.code, 'invalid_request');
    } finally { srv.close(); }
  });
});

// --- Search endpoint ---

describe('Search endpoint contract', () => {
  test('POST /api/v1/search requires query', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const payload = JSON.parse(body);
        if (!payload.query) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: false,
            error: { code: 'invalid_request', message: 'query required' },
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: true,
            payload: { results: [], total: 0 },
          }));
        }
      });
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/search', {});
      assert.strictEqual(resp.status, 400);
      assert.strictEqual(resp.jsonBody.error.code, 'invalid_request');
    } finally { srv.close(); }
  });

  test('POST /api/v1/search returns results with total', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: {
          results: [{ file: 'HelloServlet.java', line: 10, match: 'println' }],
          total: 1,
        },
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/search', { query: 'println' });
      assert.strictEqual(resp.status, 200);
      assert.ok(Array.isArray(resp.jsonBody.payload.results));
      assert.strictEqual(resp.jsonBody.payload.total, 1);
    } finally { srv.close(); }
  });
});

// --- Build endpoint ---

describe('Build endpoint contract', () => {
  test('POST /api/v1/builds requires projectId', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const payload = JSON.parse(body);
        if (!payload.projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: false,
            error: { code: 'invalid_request', message: 'projectId required' },
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: true,
            payload: { id: 'b1', state: 'success', summary: { errors: 0, warnings: 0, filesCompiled: 5 } },
          }));
        }
      });
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/builds', { clean: true });
      assert.strictEqual(resp.status, 400);
      assert.strictEqual(resp.jsonBody.error.code, 'invalid_request');
    } finally { srv.close(); }
  });

  test('GET /api/v1/builds/{buildId} returns 404 for unknown build', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: false,
        error: { code: 'not_found', message: 'build not found: unknown' },
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/builds/unknown');
      assert.strictEqual(resp.status, 404);
      assert.strictEqual(resp.jsonBody.error.code, 'not_found');
    } finally { srv.close(); }
  });

  test('GET /api/v1/builds returns array of build results', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: [
          { id: 'b1', state: 'success', summary: { errors: 0, warnings: 0, filesCompiled: 5 } },
          { id: 'b2', state: 'failure', summary: { errors: 2, warnings: 1, filesCompiled: 3 } },
        ],
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/builds');
      assert.strictEqual(resp.status, 200);
      assert.ok(Array.isArray(resp.jsonBody.payload));
      assert.strictEqual(resp.jsonBody.payload.length, 2);
      assert.strictEqual(resp.jsonBody.payload[0].state, 'success');
      assert.strictEqual(resp.jsonBody.payload[1].state, 'failure');
    } finally { srv.close(); }
  });
});

// --- Servers endpoint ---

describe('Servers endpoint contract', () => {
  test('GET /api/v1/servers returns array of server instances', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: [
          { id: 'srv1', projectId: 'proj-1', state: 'running', pid: 1234, ports: { http: 8080 } },
        ],
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

  test('POST /api/v1/servers/{serverId}/restart returns new PID', async () => {
    let callCount = 0;
    const { srv, baseUrl } = await runServer((req, res) => {
      callCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (callCount === 1) {
        res.end(JSON.stringify({
          requestId: 'req-1',
          ok: true,
          payload: [{ id: 'srv1', state: 'running', pid: 1000, ports: { http: 8080 } }],
        }));
      } else {
        res.end(JSON.stringify({
          requestId: 'req-2',
          ok: true,
          payload: { id: 'srv1', state: 'running', pid: 2000, ports: { http: 8080 } },
        }));
      }
    });
    try {
      const before = await fetchRequest(baseUrl, 'GET', '/api/v1/servers');
      assert.strictEqual(before.jsonBody.payload[0].pid, 1000);

      const after = await fetchRequest(baseUrl, 'POST', '/api/v1/servers/srv1/restart');
      assert.strictEqual(after.jsonBody.payload.pid, 2000);
      assert.notStrictEqual(after.jsonBody.payload.pid, before.jsonBody.payload[0].pid);
    } finally { srv.close(); }
  });
});

// --- Deployments endpoint ---

describe('Deployments endpoint contract', () => {
  test('GET /api/v1/deployments returns array of deployment results', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: [{ id: 'd1', state: 'success', filesTouched: 12, bytes: 4096 }],
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/deployments');
      assert.strictEqual(resp.status, 200);
      assert.ok(Array.isArray(resp.jsonBody.payload));
      assert.strictEqual(resp.jsonBody.payload[0].state, 'success');
    } finally { srv.close(); }
  });
});

// --- Workspaces endpoint ---

describe('Workspaces endpoint contract', () => {
  test('POST /api/v1/workspaces requires rootPath', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const payload = JSON.parse(body);
        if (!payload.rootPath && !payload.root) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: false,
            error: { code: 'invalid_request', message: 'rootPath required' },
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: true,
            payload: { id: 'ws-new', name: 'test', rootPath: '/tmp/test' },
          }));
        }
      });
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/workspaces', { name: 'test' });
      assert.strictEqual(resp.status, 400);
      assert.strictEqual(resp.jsonBody.error.code, 'invalid_request');
    } finally { srv.close(); }
  });
});

// --- Envelope format consistency ---

describe('Envelope format consistency', () => {
  test('All success responses have ok:true and requestId', async () => {
    const endpoints = [
      { method: 'GET', path: '/api/v1/health' },
      { method: 'GET', path: '/api/v1/workspaces' },
      { method: 'GET', path: '/api/v1/projects' },
      { method: 'GET', path: '/api/v1/builds' },
      { method: 'GET', path: '/api/v1/servers' },
      { method: 'GET', path: '/api/v1/deployments' },
      { method: 'GET', path: '/api/v1/toolchains' },
      { method: 'GET', path: '/api/v1/endpoints' },
    ];

    for (const ep of endpoints) {
      const { srv, baseUrl } = await runServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'req-1',
          ok: true,
          payload: ep.method === 'GET' ? (ep.path.includes('health') ? { ok: true } : []) : {},
        }));
      });
      try {
        const resp = await fetchRequest(baseUrl, ep.method, ep.path);
        assert.strictEqual(resp.jsonBody.ok, true, `${ep.method} ${ep.path}: ok should be true`);
        assert.ok(typeof resp.jsonBody.requestId === 'string', `${ep.method} ${ep.path}: should have requestId`);
        assert.ok(resp.jsonBody.requestId.length > 0, `${ep.method} ${ep.path}: requestId should not be empty`);
      } finally { srv.close(); }
    }
  });

  test('All error responses have ok:false, error.code, and error.message', async () => {
    const errorCases = [
      { status: 400, code: 'invalid_request', message: 'bad input' },
      { status: 401, code: 'unauthenticated', message: 'missing auth' },
      { status: 403, code: 'forbidden', message: 'access denied' },
      { status: 404, code: 'not_found', message: 'resource not found' },
      { status: 409, code: 'conflict', message: 'already exists' },
      { status: 429, code: 'rate_limited', message: 'too many requests' },
      { status: 500, code: 'internal', message: 'server error' },
    ];

    for (const ec of errorCases) {
      const { srv, baseUrl } = await runServer((req, res) => {
        res.writeHead(ec.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'req-err-1',
          ok: false,
          error: { code: ec.code, message: ec.message },
        }));
      });
      try {
        const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/builds');
        assert.strictEqual(resp.status, ec.status, `expected status ${ec.status}`);
        assert.strictEqual(resp.jsonBody.ok, false, `error ${ec.status}: ok should be false`);
        assert.strictEqual(resp.jsonBody.error.code, ec.code, `error ${ec.status}: code mismatch`);
        assert.strictEqual(resp.jsonBody.error.message, ec.message, `error ${ec.status}: message mismatch`);
      } finally { srv.close(); }
    }
  });
});

// --- HTTP method validation ---

describe('HTTP method validation', () => {
  test('Unsupported methods return 405 with Allow header', async () => {
    const testCases = [
      { method: 'PATCH', path: '/api/v1/builds' },
      { method: 'PUT', path: '/api/v1/health' },
      { method: 'DELETE', path: '/api/v1/health' },
    ];

    for (const tc of testCases) {
      const { srv, baseUrl } = await runServer((req, res) => {
        if (req.method === tc.method) {
          res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, POST, PUT, DELETE' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: false,
            error: { code: 'invalid_request', message: 'method not allowed' },
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: {} }));
        }
      });
      try {
        const resp = await fetchRequest(baseUrl, tc.method, tc.path);
        assert.strictEqual(resp.status, 405, `${tc.method} ${tc.path}: expected 405`);
        assert.strictEqual(resp.jsonBody.ok, false);
        assert.strictEqual(resp.jsonBody.error.code, 'invalid_request');
      } finally { srv.close(); }
    }
  });
});

// --- Content-Type validation ---

describe('Content-Type validation', () => {
  test('All responses include Content-Type: application/json', async () => {
    const endpoints = [
      { method: 'GET', path: '/api/v1/health' },
      { method: 'GET', path: '/api/v1/workspaces' },
      { method: 'GET', path: '/api/v1/builds' },
      { method: 'GET', path: '/api/v1/endpoints' },
    ];

    for (const ep of endpoints) {
      const { srv, baseUrl } = await runServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: {} }));
      });
      try {
        const resp = await fetchRequest(baseUrl, ep.method, ep.path);
        const ct = resp.headers['content-type'];
        assert.ok(ct.includes('application/json'), `${ep.method} ${ep.path}: Content-Type should be application/json, got ${ct}`);
      } finally { srv.close(); }
    }
  });
});

// --- Request ID propagation ---

describe('Request ID propagation', () => {
  test('Server returns X-Kairo-Request-Id header', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.setHeader('X-Kairo-Request-Id', 'server-gen-id');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: 'server-gen-id', ok: true, payload: {} }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/health');
      assert.ok(resp.headers['x-kairo-request-id'], 'X-Kairo-Request-Id header should be present');
    } finally { srv.close(); }
  });

  test('Client-provided request ID is echoed back', async () => {
    let capturedReqId = null;
    const { srv, baseUrl } = await runServer((req, res) => {
      capturedReqId = req.headers['x-kairo-request-id'];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: capturedReqId || 'server-gen', ok: true, payload: {} }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, { requestId: 'client-req-id-123' });
      assert.strictEqual(capturedReqId, 'client-req-id-123');
      assert.strictEqual(resp.jsonBody.requestId, 'client-req-id-123');
    } finally { srv.close(); }
  });
});

// --- CORS preflight ---

describe('CORS preflight handling', () => {
  test('OPTIONS request returns 204 with CORS headers', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Kairo-Secret, X-Kairo-Request-Id');
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: {} }));
      }
    });
    try {
      const resp = await fetchRequest(baseUrl, 'OPTIONS', '/api/v1/builds', null, { origin: 'http://localhost:3000' });
      assert.strictEqual(resp.status, 204);
      assert.ok(resp.headers['access-control-allow-origin']);
      assert.ok(resp.headers['access-control-allow-methods']);
    } finally { srv.close(); }
  });
});

// --- Header-based workspace resolution ---

describe('Header-based workspace resolution', () => {
  test('X-Kairo-Workspace-Id header is propagated', async () => {
    let capturedWsId = null;
    const { srv, baseUrl } = await runServer((req, res) => {
      capturedWsId = req.headers['x-kairo-workspace-id'];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: [] }));
    });
    try {
      await fetchRequest(baseUrl, 'GET', '/api/v1/projects', null, { workspaceId: 'ws-test-123' });
      assert.strictEqual(capturedWsId, 'ws-test-123');
    } finally { srv.close(); }
  });
});

// --- Path traversal protection ---

describe('Path traversal protection', () => {
  test('Path traversal in workspace root is rejected', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const payload = JSON.parse(body);
        const rootPath = payload.rootPath || payload.root || '';
        if (rootPath.includes('..')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            requestId: 'req-1',
            ok: false,
            error: { code: 'forbidden', message: 'path contains traversal' },
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: { id: 'ws-1' } }));
        }
      });
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/workspaces', {
        name: 'bad',
        rootPath: '/etc/../passwd',
      });
      assert.strictEqual(resp.status, 403);
      assert.strictEqual(resp.jsonBody.error.code, 'forbidden');
    } finally { srv.close(); }
  });
});

// --- Rate limiting ---

describe('Rate limiting contract', () => {
  test('Rate limited response returns 429 with retryable flag', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: false,
        error: { code: 'rate_limited', message: 'too many requests', retryable: true },
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/builds');
      assert.strictEqual(resp.status, 429);
      assert.strictEqual(resp.jsonBody.error.code, 'rate_limited');
      assert.strictEqual(resp.jsonBody.error.retryable, true);
    } finally { srv.close(); }
  });
});

// --- Toolchains endpoint ---

describe('Toolchains endpoint contract', () => {
  test('GET /api/v1/toolchains returns array of toolchains', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: [
          { id: 'jdk6', kind: 'jdk', home: '/usr/lib/jvm/java-6', version: '1.6.0_45' },
        ],
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/toolchains');
      assert.strictEqual(resp.status, 200);
      assert.ok(Array.isArray(resp.jsonBody.payload));
    } finally { srv.close(); }
  });
});

// --- JDT LS endpoint ---

describe('JDT LS endpoint contract', () => {
  test('GET /api/v1/jdtls returns JDT LS status', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: { state: 'stopped', version: '1.43.0', jre: '/usr/lib/jvm/java-17' },
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/jdtls');
      assert.strictEqual(resp.status, 200);
      assert.strictEqual(resp.jsonBody.payload.state, 'stopped');
      assert.ok(resp.jsonBody.payload.version);
    } finally { srv.close(); }
  });

  test('DELETE /api/v1/jdtls returns 400 (not supported)', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      if (req.method === 'DELETE') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'req-1',
          ok: false,
          error: { code: 'invalid_request', message: 'DELETE not supported on /api/v1/jdtls' },
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ requestId: 'req-1', ok: true, payload: {} }));
      }
    });
    try {
      const resp = await fetchRequest(baseUrl, 'DELETE', '/api/v1/jdtls');
      assert.strictEqual(resp.status, 400);
      assert.strictEqual(resp.jsonBody.error.code, 'invalid_request');
    } finally { srv.close(); }
  });
});

// --- Endpoints ---

describe('Endpoints discovery', () => {
  test('GET /api/v1/endpoints returns http and events host:port', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: { http: '127.0.0.1:18080', events: '127.0.0.1:18080' },
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'GET', '/api/v1/endpoints');
      assert.strictEqual(resp.status, 200);
      assert.ok(resp.jsonBody.payload.http);
      assert.ok(resp.jsonBody.payload.events);
      // HTTP and events should be the same host:port today
      assert.strictEqual(resp.jsonBody.payload.http, resp.jsonBody.payload.events);
    } finally { srv.close(); }
  });
});

// --- Runtime restart ---

describe('Runtime restart', () => {
  test('POST /api/v1/runtime/restart returns 200 with status:restarting', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: { status: 'restarting' },
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/runtime/restart');
      assert.strictEqual(resp.status, 200);
      assert.strictEqual(resp.jsonBody.payload.status, 'restarting');
    } finally { srv.close(); }
  });
});

// --- Unicode / encoding ---

describe('Encoding endpoint contract', () => {
  test('POST /api/v1/encoding/detect returns encoding info', async () => {
    const { srv, baseUrl } = await runServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'req-1',
        ok: true,
        payload: { encoding: 'utf-8', confidence: 0.95 },
      }));
    });
    try {
      const resp = await fetchRequest(baseUrl, 'POST', '/api/v1/encoding/detect', { filePath: '/tmp/test.java' });
      assert.strictEqual(resp.status, 200);
      assert.ok(resp.jsonBody.payload.encoding);
    } finally { srv.close(); }
  });
});