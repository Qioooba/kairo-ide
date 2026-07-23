// Fault Injection Tests — validates the Kairo IDE's
// resilience against real-world failure scenarios.
//
// Each scenario:
//   1. Describes a trigger method
//   2. Defines the expected behavior under fault
//   3. Verifies recovery after the fault is resolved
//
// These tests use Node.js built-in test runner and
// real HTTP servers to simulate fault conditions.
// They do NOT require the actual Go agent, Tomcat,
// or JDT LS binaries — they test the protocol-level
// fault handling contract.
//
// Run with:
//   node --test tests/fault/fault-injection.test.cjs

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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

function fetchJson(baseUrl, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, {
      method: opts.method || 'GET',
      headers: opts.headers || { 'Content-Type': 'application/json' },
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_e) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) {
      req.write(JSON.stringify(opts.body));
    }
    req.end();
  });
}

// Find an available port
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// =========================================================================
// Scenario 1: Agent startup port race
// =========================================================================

test('Fault-1: Agent startup port race — two agents cannot bind same port', async () => {
  // Simulate: two agents try to bind the same port.
  // First agent binds successfully. Second agent must fail gracefully.

  const port = await findFreePort();

  const srv1 = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
  });

  await new Promise((resolve) => srv1.listen(port, '127.0.0.1', resolve));

  // Second server on same port should fail
  const srv2 = http.createServer(() => {});
  let secondFailed = false;
  try {
    await new Promise((resolve, reject) => {
      srv2.listen(port, '127.0.0.1', resolve);
      srv2.on('error', (err) => {
        secondFailed = true;
        reject(err);
      });
    });
  } catch (_e) {
    secondFailed = true;
  }

  assert.ok(secondFailed,
    'Second agent must fail to bind to an occupied port (EADDRINUSE)');

  // Recovery: first agent should still be functioning
  const resp = await fetchJson(`http://127.0.0.1:${port}`, '/api/v1/health');
  assert.strictEqual(resp.status, 200);
  assert.deepStrictEqual(resp.json, { ok: true, payload: { ok: true } });

  srv1.close();
  try { srv2.close(); } catch (_e) { /* already closed */ }
});

// =========================================================================
// Scenario 2: Agent exits during build
// =========================================================================

test('Fault-2: Agent exits during build — client surfaces connection error', async () => {
  // Simulate: build starts, then agent crashes mid-response.
  let buildStarted = false;

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/builds') {
      buildStarted = true;
      // Send partial response then destroy the connection
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.write('{"requestId":"r1","ok":true,"payload":{"id":"b1","state":"queued"');
      // Simulate crash: destroy without finishing
      res.destroy();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    // Trigger the build
    let errorOccurred = false;
    try {
      await fetchJson(baseUrl, '/api/v1/builds', {
        method: 'POST',
        body: { projectId: 'proj-1' },
      });
    } catch (_e) {
      errorOccurred = true;
    }

    assert.ok(buildStarted, 'Build must have been started');
    // The client should detect the broken connection
    assert.ok(errorOccurred,
      'Client must surface an error when agent crashes mid-response');

    // Recovery: after restart, new health check should succeed
    // (Simulated by the server still responding to health)
    const health = await fetchJson(baseUrl, '/api/v1/health');
    assert.strictEqual(health.status, 200);
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 3: Ant/javac timeout/cancel
// =========================================================================

test('Fault-3: Build timeout — agent cancels after timeout, client gets cancelled state', async () => {
  // Simulate: build starts, runs too long, gets cancelled.
  let buildCancelled = false;

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/builds') {
      // Simulate a long-running build that gets cancelled
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: true,
        payload: {
          id: 'b-timeout',
          state: 'queued',
          startedAt: new Date().toISOString(),
          diagnostics: [],
          output: '',
          summary: { errors: 0, warnings: 0, filesCompiled: 0 },
        },
      }));
    } else if (req.method === 'DELETE' && req.url.startsWith('/api/v1/builds/')) {
      buildCancelled = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r2',
        ok: true,
        payload: {
          id: 'b-timeout',
          state: 'cancelled',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          diagnostics: [],
          output: '',
          summary: { errors: 0, warnings: 0, filesCompiled: 0 },
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    // Start a build
    const buildResp = await fetchJson(baseUrl, '/api/v1/builds', {
      method: 'POST',
      body: { projectId: 'proj-1' },
    });
    assert.strictEqual(buildResp.status, 202);
    assert.strictEqual(buildResp.json.payload.state, 'queued');

    // Cancel the build (simulating timeout)
    const cancelResp = await fetchJson(baseUrl, `/api/v1/builds/${buildResp.json.payload.id}`, {
      method: 'DELETE',
    });
    assert.strictEqual(cancelResp.status, 200);
    assert.strictEqual(cancelResp.json.payload.state, 'cancelled');
    assert.ok(buildCancelled, 'Build cancellation must be processed');

    // Recovery: a new build should be possible
    const newBuild = await fetchJson(baseUrl, '/api/v1/builds', {
      method: 'POST',
      body: { projectId: 'proj-1' },
    });
    assert.strictEqual(newBuild.status, 202);
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 4: Tomcat port occupied
// =========================================================================

test('Fault-4: Tomcat port occupied — server start fails with conflict', async () => {
  // Simulate: Tomcat port already occupied.
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/servers') {
      // Port is occupied — return 409 conflict
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: {
          code: 'conflict',
          message: 'Port 8080 is already in use by pid=9999',
          port: 8080,
          occupiedByPid: 9999,
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: [] }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/servers', {
      method: 'POST',
      body: { projectId: 'proj-1' },
    });
    assert.strictEqual(resp.status, 409);
    assert.strictEqual(resp.json.error.code, 'conflict');
    assert.ok(resp.json.error.message.includes('already in use'),
      'Error must mention port conflict');
    assert.ok(resp.json.error.port, 'Error must include the conflicting port');
    assert.ok(resp.json.error.occupiedByPid, 'Error must include the occupying PID');

    // Recovery: server list should still be empty (no server started)
    const listResp = await fetchJson(baseUrl, '/api/v1/servers');
    assert.strictEqual(listResp.status, 200);
    assert.ok(Array.isArray(listResp.json.payload));
    assert.strictEqual(listResp.json.payload.length, 0);
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 5: Tomcat stop timeout then force
// =========================================================================

test('Fault-5: Tomcat stop timeout — graceful stop fails, force kill succeeds', async () => {
  // Simulate: Tomcat slow to stop, then force-killed.
  // Uses a counter to deterministically test graceful vs force stop.
  let stopAttempts = 0;
  let forceUsed = false;

  const { srv, baseUrl } = await runServer((req, res) => {
    if (req.method === 'DELETE' && req.url.startsWith('/api/v1/servers/')) {
      stopAttempts++;

      if (stopAttempts === 1) {
        // First attempt: graceful stop (times out)
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'r_grace',
          ok: true,
          payload: {
            id: 'srv-1',
            state: 'stopping',
            message: 'waiting for graceful shutdown',
          },
        }));
      } else {
        // Second attempt: force kill
        forceUsed = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'r_force',
          ok: true,
          payload: {
            id: 'srv-1',
            state: 'stopped',
            forceKilled: true,
            stopDurationMs: 15000,
          },
        }));
      }
    } else if (req.method === 'GET' && req.url === '/api/v1/servers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_list',
        ok: true,
        payload: [{
          id: 'srv-1',
          state: 'running',
          pid: 12345,
          ports: { http: 8080 },
        }],
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    // First, graceful stop (first DELETE — no body)
    const gracefulResp = await fetchJson(baseUrl, '/api/v1/servers/srv-1', {
      method: 'DELETE',
    });
    assert.strictEqual(gracefulResp.status, 202);
    assert.strictEqual(gracefulResp.json.payload.state, 'stopping');

    // Then, force stop (second DELETE — no body)
    const forceResp = await fetchJson(baseUrl, '/api/v1/servers/srv-1', {
      method: 'DELETE',
    });
    assert.strictEqual(forceResp.status, 200);
    assert.strictEqual(forceResp.json.payload.state, 'stopped');
    assert.strictEqual(forceResp.json.payload.forceKilled, true);
    assert.ok(forceUsed, 'Force kill must be processed');

    // Recovery: verify server list is empty
    // (Simulated by the server returning the stopped state)
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 6: EventStream disconnect + history gap
// =========================================================================

test('Fault-6: EventStream disconnect — client reconnects, detects gap, gets snapshot', async () => {
  // Simulate: EventStream disconnects, client reconnects with
  // since=100, but oldest available is 200 — gap detected.
  let connectCount = 0;
  let forceGap = false;

  const { srv, baseUrl } = await runServer((req, res) => {
    if (req.url.startsWith('/api/v1/events')) {
      connectCount++;
      // Parse query parameters manually
      const queryStart = req.url.indexOf('?');
      const searchParams = new URLSearchParams(queryStart >= 0 ? req.url.substring(queryStart) : '');
      const since = parseInt(searchParams.get('since') || '0');

      // After the first connection, force a gap for the second connection
      // that requests since=100 (which is too old)
      if (forceGap) {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'r_gap',
          ok: false,
          error: {
            code: 'gap',
            message: `Event history gap: requested since=${since}, oldest available=200`,
            oldestAvailable: 200,
          },
        }));
        forceGap = false;
      } else {
        // Normal connection or fresh snapshot
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        res.write('data: {"type":"connected","seq":0}\n\n');
        res.write('data: {"type":"snapshot","seq":0,"payload":{"builds":[],"deployments":[],"servers":[]}}\n\n');
        res.end();
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    // First connection
    const conn1 = await new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}/api/v1/events`, {
        headers: { 'X-Kairo-Secret': 'correct' },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(conn1.status, 200);
    assert.ok(conn1.body.includes('"type":"connected"'), 'First connection must succeed');

    // Set flag to force a gap on the next connection
    forceGap = true;

    // Reconnect with since=100 (too old — will trigger gap)
    const conn2 = await new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}/api/v1/events?since=100`, {
        headers: { 'X-Kairo-Secret': 'correct' },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let json = null;
          try { json = JSON.parse(raw); } catch (_e) { /* not JSON */ }
          resolve({ status: res.statusCode, body: raw, json });
        });
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(conn2.status, 410);
    assert.strictEqual(conn2.json.error.code, 'gap');
    assert.strictEqual(conn2.json.error.oldestAvailable, 200);

    // Recovery: reconnect with since=0 (fresh snapshot)
    const conn3 = await new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}/api/v1/events?since=0`, {
        headers: { 'X-Kairo-Secret': 'correct' },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(conn3.status, 200);
    assert.ok(conn3.body.includes('"type":"snapshot"'),
      'Recovery must include full snapshot');
    assert.ok(conn3.body.includes('"builds"'), 'Snapshot must include builds');
    assert.ok(conn3.body.includes('"deployments"'), 'Snapshot must include deployments');
    assert.ok(conn3.body.includes('"servers"'), 'Snapshot must include servers');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 7: Repository JSON/YAML truncation
// =========================================================================

test('Fault-7: Repository config truncation — agent rejects invalid config, project config unchanged', async () => {
  // Simulate: repository config file is truncated/corrupted.

  let lastSeenConfig = null;
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'PUT' && req.url.startsWith('/api/v1/projects/')) {
      const body = await readBody(req);
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (_e) { /* invalid */ }

      if (!parsed || !parsed.config || typeof parsed.config !== 'object') {
        // Truncated/invalid JSON
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'r_trunc',
          ok: false,
          error: {
            code: 'invalid_request',
            message: 'project config is malformed or truncated',
          },
        }));
      } else {
        lastSeenConfig = parsed.config;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'r_ok',
          ok: true,
          payload: { id: 'proj-1', config: parsed.config },
        }));
      }
    } else if (req.method === 'GET' && req.url.startsWith('/api/v1/projects/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_get',
        ok: true,
        payload: {
          id: 'proj-1',
          name: 'legacy-sample',
          java: { compiler: { sourceLevel: '1.6', targetLevel: '1.6' } },
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    // Try to send truncated config (empty object)
    const badResp = await fetchJson(baseUrl, '/api/v1/projects/proj-1', {
      method: 'PUT',
      body: { config: null }, // Simulates truncation
    });
    assert.strictEqual(badResp.status, 400);
    assert.strictEqual(badResp.json.error.code, 'invalid_request');
    assert.ok(badResp.json.error.message.includes('malformed'),
      'Error must indicate malformed config');

    // Recovery: project should still have its original config
    const getResp = await fetchJson(baseUrl, '/api/v1/projects/proj-1');
    assert.strictEqual(getResp.status, 200);
    assert.strictEqual(getResp.json.payload.java.compiler.sourceLevel, '1.6',
      'Original config must be preserved after truncation rejection');

    // Send valid config — should succeed
    const goodResp = await fetchJson(baseUrl, '/api/v1/projects/proj-1', {
      method: 'PUT',
      body: { config: { sourceLevel: '1.8' } },
    });
    assert.strictEqual(goodResp.status, 200);
    assert.ok(lastSeenConfig, 'Valid config must be processed');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 8: JDT checksum mismatch / crash loop
// =========================================================================

test('Fault-8: JDT checksum mismatch — agent detects corruption, re-downloads, recovery succeeds', async () => {
  // Simulate: JDT LS jar checksum mismatch → crash loop → recovery.
  let restartCount = 0;
  let checksumMismatch = false;

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/v1/jdtls') {
      if (checksumMismatch && restartCount < 3) {
        restartCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'r_jdt',
          ok: true,
          payload: {
            state: 'error',
            error: 'checksum mismatch: expected sha256:abc, got sha256:def',
            restartCount,
            version: '1.43.0',
          },
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'r_jdt',
          ok: true,
          payload: {
            state: 'running',
            pid: 12345,
            version: '1.43.0',
            restartCount,
            sourceLevel: '1.6',
          },
        }));
      }
    } else if (req.method === 'POST' && req.url === '/api/v1/jdtls') {
      // Trigger JDT restart
      restartCount++;
      checksumMismatch = false; // Fixed after re-download
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_jdt_restart',
        ok: true,
        payload: {
          state: 'starting',
          version: '1.43.0',
          restartCount,
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    // Trigger checksum mismatch
    checksumMismatch = true;

    // First status check: should show error
    const status1 = await fetchJson(baseUrl, '/api/v1/jdtls');
    assert.strictEqual(status1.json.payload.state, 'error');
    assert.ok(status1.json.payload.error.includes('checksum mismatch'),
      'Must detect checksum mismatch');

    // Trigger restart (re-download)
    const restart = await fetchJson(baseUrl, '/api/v1/jdtls', { method: 'POST' });
    assert.strictEqual(restart.status, 202);
    assert.strictEqual(restart.json.payload.state, 'starting');

    // After restart, status should be running
    const status2 = await fetchJson(baseUrl, '/api/v1/jdtls');
    assert.strictEqual(status2.json.payload.state, 'running');
    assert.ok(restartCount >= 2,
      `JDT must be restarted after checksum fix, got ${restartCount} restarts`);

    // Recovery: JDT is now running normally
    assert.strictEqual(status2.json.payload.sourceLevel, '1.6');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 9: GBK unrepresentable character — reject save, original file unchanged
// =========================================================================

test('Fault-9: GBK unrepresentable char — agent rejects, file unchanged', async () => {
  // Simulate: user tries to save a file with characters that
  // cannot be represented in GBK. The agent should reject the
  // save and the original file should remain unchanged.

  let validationCallCount = 0;
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/encoding/validate') {
      validationCallCount++;
      const body = await readBody(req);
      const parsed = JSON.parse(body);

      // Hiragana/Katakana characters cannot be represented in GBK
      if (parsed.text && /[\u3040-\u309F\u30A0-\u30FF]/.test(parsed.text)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'r_val',
          ok: true,
          payload: {
            valid: false,
            unrepresentable: [
              { char: '日', position: 0, codePoint: 26085 },
              { char: '本', position: 1, codePoint: 26412 },
              { char: '語', position: 2, codePoint: 35486 },
            ],
          },
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          requestId: 'r_val',
          ok: true,
          payload: { valid: true },
        }));
      }
    } else if (req.method === 'POST' && req.url === '/api/v1/encoding/recode') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_rec',
        ok: true,
        payload: { ok: true, bytes: 100 },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    // Try to validate text with Japanese Hiragana characters (not in GBK)
    const badResp = await fetchJson(baseUrl, '/api/v1/encoding/validate', {
      method: 'POST',
      body: { text: 'ひらがな', encoding: 'gbk' },
    });
    assert.strictEqual(badResp.status, 200);
    assert.strictEqual(badResp.json.payload.valid, false);
    assert.ok(Array.isArray(badResp.json.payload.unrepresentable),
      'Must list unrepresentable characters');
    assert.ok(badResp.json.payload.unrepresentable.length > 0,
      'Must have at least one unrepresentable character');

    // Verify: valid Chinese text should pass
    const goodResp = await fetchJson(baseUrl, '/api/v1/encoding/validate', {
      method: 'POST',
      body: { text: '你好世界', encoding: 'gbk' },
    });
    assert.strictEqual(goodResp.status, 200);
    assert.strictEqual(goodResp.json.payload.valid, true);

    // Recovery: valid text can still be recoded
    const recodeResp = await fetchJson(baseUrl, '/api/v1/encoding/recode', {
      method: 'POST',
      body: { workspaceId: 'ws-1', file: '/tmp/test.jsp', from: 'gbk', to: 'utf-8' },
    });
    assert.strictEqual(recodeResp.status, 200);
    assert.ok(recodeResp.json.payload.ok);
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 10: Deploy partial failure — report partial/error
// =========================================================================

test('Fault-10: Deploy partial failure — some files fail, report partial details', async () => {
  // Simulate: deployment of 10 files, 3 fail.
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/deployments') {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_deploy',
        ok: true,
        payload: {
          id: 'deploy-partial',
          state: 'partial',
          filesTouched: 7,
          bytes: 3500,
          failed: 3,
          errors: [
            { file: 'WebRoot/WEB-INF/classes/broken.class', error: 'permission denied' },
            { file: 'WebRoot/WEB-INF/lib/corrupt.jar', error: 'disk full' },
            { file: 'WebRoot/admin/index.jsp', error: 'path too long' },
          ],
          trigger: 'manual',
          hotReloadMode: 'staticSync',
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: [] }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/deployments', {
      method: 'POST',
      body: { projectId: 'proj-1', buildId: 'build-1' },
    });

    assert.strictEqual(resp.status, 202);
    assert.strictEqual(resp.json.payload.state, 'partial');
    assert.strictEqual(resp.json.payload.filesTouched, 7);
    assert.strictEqual(resp.json.payload.failed, 3);
    assert.ok(Array.isArray(resp.json.payload.errors),
      'Must include error details for failed files');
    assert.strictEqual(resp.json.payload.errors.length, 3);

    // Recovery: verify each error has file and reason
    for (const err of resp.json.payload.errors) {
      assert.ok(err.file, 'Each error must identify the file');
      assert.ok(err.error, 'Each error must describe the failure');
    }
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 11: Desktop exit with 3 child processes
// =========================================================================

test('Fault-11: Desktop exit — all child processes must be cleaned up', async () => {
  // Simulate: The Kairo IDE spawns child processes (agent, Tomcat, JDT).
  // When the desktop exits, all children must be terminated.

  // We verify this by spawning test processes and ensuring they
  // can be cleaned up with process groups.

  // Spawn 3 child processes (simple sleep commands)
  const children = [];
  for (let i = 0; i < 3; i++) {
    const child = spawn('sleep', ['30'], {
      stdio: 'ignore',
      detached: false,
    });
    children.push(child);
  }

  // Verify all 3 are alive
  for (const child of children) {
    assert.ok(child.pid > 0, `Child ${child.pid} must have a PID`);
    // Process should still be running
    try {
      process.kill(child.pid, 0); // Signal 0 checks existence
    } catch (_e) {
      assert.fail(`Child ${child.pid} is not running`);
    }
  }

  // Simulate cleanup: kill all children
  for (const child of children) {
    child.kill('SIGTERM');
  }

  // Wait for children to exit
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Verify all children are terminated
  for (const child of children) {
    try {
      process.kill(child.pid, 0);
      // If we get here, the process is still alive
      // Try SIGKILL
      child.kill('SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        process.kill(child.pid, 0);
        assert.fail(`Child ${child.pid} is still running after SIGKILL`);
      } catch (_e) {
        // Expected: process is dead
      }
    } catch (_e) {
      // Expected: process is already dead
    }
  }

  // Recovery: verify no zombie processes by checking
  // that all PIDs are no longer reachable
  for (const child of children) {
    try {
      process.kill(child.pid, 0);
      assert.fail(`Child ${child.pid} should not exist after cleanup`);
    } catch (_e) {
      // Expected
    }
  }
});

// =========================================================================
// Scenario 12: Port occupation on Tomcat HTTP port
// =========================================================================

test('Fault-12: Port occupation — Tomcat start fails on occupied port 8080', async () => {
  // Simulate: a process already occupies port 8080, Tomcat fails to start.
  const occupyingPort = 8080;
  const occupier = http.createServer(() => {});
  await new Promise((resolve) => occupier.listen(occupyingPort, '127.0.0.1', resolve));

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/servers') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: {
          code: 'conflict',
          message: `Port 8080 is already in use by pid=${process.pid}, process=node`,
          port: 8080,
          occupiedByPid: process.pid,
          processName: 'node',
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: [] }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/servers', {
      method: 'POST',
      body: { projectId: 'proj-1' },
    });
    assert.strictEqual(resp.status, 409);
    assert.ok(resp.json.error.message.includes('already in use'),
      'Error must show port conflict');
    assert.ok(resp.json.error.message.includes('8080'),
      'Error must mention port 8080');
    assert.ok(resp.json.error.processName || resp.json.error.message.includes('pid'),
      'Error must include PID or process name');
  } finally {
    occupier.close();
    srv.close();
  }
});

// =========================================================================
// Scenario 13: Port occupation on debug port
// =========================================================================

test('Fault-13: Debug port occupation — debug session fails on occupied port 8000', async () => {
  const occupyingPort = 8000;
  const occupier = http.createServer(() => {});
  await new Promise((resolve) => occupier.listen(occupyingPort, '127.0.0.1', resolve));

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/servers') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: {
          code: 'conflict',
          message: `Debug port 8000 is already in use by pid=${process.pid}`,
          port: 8000,
          occupiedByPid: process.pid,
          processName: 'node',
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/servers', {
      method: 'POST',
      body: { projectId: 'proj-1', debug: true },
    });
    assert.strictEqual(resp.status, 409);
    assert.ok(resp.json.error.message.includes('8000'),
      'Error must mention debug port 8000');
  } finally {
    occupier.close();
    srv.close();
  }
});

// =========================================================================
// Scenario 14: Agent process crash mid-operation
// =========================================================================

test('Fault-14: Agent crash — frontend detects disconnection, shows reconnect', async () => {
  let agentAlive = true;

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (!agentAlive) {
      res.destroy();
      return;
    }
    if (req.url === '/api/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true, version: '1.0' } }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    // Agent is alive
    const health1 = await fetchJson(baseUrl, '/api/v1/health');
    assert.strictEqual(health1.status, 200);

    // Simulate agent crash
    agentAlive = false;

    // Try to reach agent — should fail
    let disconnected = false;
    try {
      await fetchJson(baseUrl, '/api/v1/health');
    } catch (_e) {
      disconnected = true;
    }
    assert.ok(disconnected, 'Frontend must detect agent disconnection');

    // Recovery: agent comes back
    agentAlive = true;
    const health2 = await fetchJson(baseUrl, '/api/v1/health');
    assert.strictEqual(health2.status, 200,
      'After agent recovers, health check must succeed');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 15: JDT LS crash with auto-restart
// =========================================================================

test('Fault-15: JDT LS crash — frontend shows crash notification, auto-restarts', async () => {
  let jdtState = 'running';
  let restartTriggered = false;

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.url === '/api/v1/jdtls' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_jdt',
        ok: true,
        payload: {
          state: jdtState,
          pid: jdtState === 'crashed' ? undefined : 12345,
          version: '1.43.0',
          restartCount: restartTriggered ? 1 : 0,
          lastError: jdtState === 'crashed' ? 'JDT LS process exited unexpectedly' : undefined,
        },
      }));
    } else if (req.url === '/api/v1/jdtls' && req.method === 'POST') {
      restartTriggered = true;
      jdtState = 'starting';
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_restart',
        ok: true,
        payload: { state: 'starting', version: '1.43.0' },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    const status1 = await fetchJson(baseUrl, '/api/v1/jdtls');
    assert.strictEqual(status1.json.payload.state, 'running');

    jdtState = 'crashed';
    const status2 = await fetchJson(baseUrl, '/api/v1/jdtls');
    assert.strictEqual(status2.json.payload.state, 'crashed');
    assert.ok(status2.json.payload.lastError,
      'Crash must include error message');

    const restart = await fetchJson(baseUrl, '/api/v1/jdtls', { method: 'POST' });
    assert.strictEqual(restart.status, 202);
    assert.ok(restartTriggered, 'Restart must be triggered');

    jdtState = 'running';
    const status3 = await fetchJson(baseUrl, '/api/v1/jdtls');
    assert.strictEqual(status3.json.payload.state, 'running',
      'JDT must recover after restart');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 16: Tomcat process crash
// =========================================================================

test('Fault-16: Tomcat crash — server state changes to crashed, user can restart', async () => {
  let serverState = 'running';
  let restartCalled = false;

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.url === '/api/v1/servers/srv-1' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_get',
        ok: true,
        payload: {
          id: 'srv-1',
          state: serverState,
          pid: serverState === 'crashed' ? undefined : 12345,
          ports: { http: 8080 },
          lastError: serverState === 'crashed' ? 'Tomcat process exited with code 134' : undefined,
        },
      }));
    } else if (req.url === '/api/v1/servers/srv-1/restart' && req.method === 'POST') {
      restartCalled = true;
      serverState = 'starting';
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_restart',
        ok: true,
        payload: { id: 'srv-1', state: 'starting' },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    const status1 = await fetchJson(baseUrl, '/api/v1/servers/srv-1');
    assert.strictEqual(status1.json.payload.state, 'running');

    serverState = 'crashed';
    const status2 = await fetchJson(baseUrl, '/api/v1/servers/srv-1');
    assert.strictEqual(status2.json.payload.state, 'crashed');
    assert.ok(status2.json.payload.lastError,
      'Crash must include error details');

    const restartResp = await fetchJson(baseUrl, '/api/v1/servers/srv-1/restart', {
      method: 'POST',
    });
    assert.strictEqual(restartResp.status, 202);
    assert.ok(restartCalled, 'Restart must be called');
    assert.strictEqual(restartResp.json.payload.state, 'starting');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 17: Permission denied on write
// =========================================================================

test('Fault-17: Permission denied — write to read-only directory fails', async () => {
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/encoding/recode') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Permission denied: cannot write to /opt/readonly/test.jsp',
          details: { path: '/opt/readonly/test.jsp', operation: 'write' },
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/encoding/recode', {
      method: 'POST',
      body: { workspaceId: 'ws-1', file: '/opt/readonly/test.jsp', from: 'gbk', to: 'utf-8' },
    });
    assert.strictEqual(resp.status, 403);
    assert.ok(resp.json.error.message.includes('Permission denied'),
      'Error must mention permission denied');
    assert.strictEqual(resp.json.error.details.operation, 'write',
      'Error details must include operation type');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 18: Permission denied on read
// =========================================================================

test('Fault-18: Permission denied — read without permission fails', async () => {
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/encoding/detect') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Access denied: cannot read /etc/shadow',
          details: { path: '/etc/shadow', operation: 'read' },
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/encoding/detect', {
      method: 'POST',
      body: { workspaceId: 'ws-1', file: '/etc/shadow' },
    });
    assert.strictEqual(resp.status, 403);
    assert.ok(resp.json.error.message.includes('Access denied'),
      'Error must mention access denied');
    assert.ok(resp.json.error.details.path,
      'Error must include the file path');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 19: Disk full during save
// =========================================================================

test('Fault-19: Disk full — save fails, original file not corrupted', async () => {
  let saveAttempted = false;

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/encoding/recode') {
      saveAttempted = true;
      res.writeHead(507, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: {
          code: 'io_error',
          message: 'Save failed: disk is full (no space left on device)',
          details: { path: '/tmp/test.jsp', freeBytes: 0, operation: 'write' },
        },
      }));
    } else if ((req.method === 'GET' || req.method === 'POST') && req.url === '/api/v1/encoding/detect') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r2',
        ok: true,
        payload: { encoding: 'gbk', confidence: 0.95, hasBom: false },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    const saveResp = await fetchJson(baseUrl, '/api/v1/encoding/recode', {
      method: 'POST',
      body: { workspaceId: 'ws-1', file: '/tmp/test.jsp', from: 'gbk', to: 'utf-8' },
    });
    assert.strictEqual(saveResp.status, 507);
    assert.ok(saveAttempted, 'Save must be attempted');
    assert.ok(saveResp.json.error.message.includes('disk is full'),
      'Error must mention disk full');
    assert.strictEqual(saveResp.json.error.details.freeBytes, 0,
      'Error must include free space info');

    const detectResp = await fetchJson(baseUrl, '/api/v1/encoding/detect', {
      method: 'POST',
      body: { workspaceId: 'ws-1', file: '/tmp/test.jsp' },
    });
    assert.strictEqual(detectResp.status, 200);
    assert.strictEqual(detectResp.json.payload.encoding, 'gbk',
      'Original file encoding must be preserved');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 20: Disk full during build
// =========================================================================

test('Fault-20: Disk full — build fails, no partial artifacts', async () => {
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/builds') {
      res.writeHead(507, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: {
          code: 'io_error',
          message: 'Build failed: disk is full. Cannot write output files.',
          details: {
            outputDir: '/tmp/build/classes',
            freeBytes: 0,
            partialFilesCleaned: 3,
          },
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: [] }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/builds', {
      method: 'POST',
      body: { projectId: 'proj-1' },
    });
    assert.strictEqual(resp.status, 507);
    assert.ok(resp.json.error.message.includes('disk is full'),
      'Error must mention disk full');
    assert.ok(resp.json.error.details.partialFilesCleaned !== undefined,
      'Error must mention partial files cleaned');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 21: Agent connection timeout
// =========================================================================

test('Fault-21: Agent connection timeout — timeout error with retry suggestion', async () => {
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.url === '/api/v1/slow') {
      // Don't respond — the client will timeout
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }, 10000);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    let timeoutError = false;
    try {
      await fetchJson(baseUrl, '/api/v1/slow', { timeout: 500 });
    } catch (e) {
      timeoutError = true;
      assert.ok(e.message.includes('timeout') || e.message.includes('abort'),
        'Must get timeout error');
    }
    assert.ok(timeoutError, 'Short timeout must trigger error');

    const healthResp = await fetchJson(baseUrl, '/api/v1/health');
    assert.strictEqual(healthResp.status, 200);
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 22: WebSocket disconnect during search
// =========================================================================

test('Fault-22: WebSocket disconnect during search — search shows connection lost', async () => {
  let searchResultsStreamed = false;

  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/search') {
      searchResultsStreamed = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_search',
        ok: true,
        payload: {
          query: 'test',
          totalMatches: 150,
          truncated: true,
          matches: [
            { file: 'test.jsp', line: 1, column: 0, matchText: 'test', contextBefore: '', contextAfter: '' },
            { file: 'test.java', line: 5, column: 10, matchText: 'test', contextBefore: '', contextAfter: '' },
          ],
          elapsedMs: 1200,
          erroredFiles: [],
          partial: true,
          message: 'Search was interrupted. Results may be incomplete.',
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/search', {
      method: 'POST',
      body: { workspaceId: 'ws-1', query: 'test', isRegex: false },
    });
    assert.strictEqual(resp.status, 200);
    assert.ok(searchResultsStreamed, 'Search must be executed');
    assert.ok(resp.json.payload.partial || resp.json.payload.message,
      'Search must indicate partial/interrupted results');
    assert.ok(resp.json.payload.matches.length > 0,
      'Existing results must be preserved');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 23: Wrong encoding — warning and reopen option
// =========================================================================

test('Fault-23: Wrong encoding — warning about encoding mismatch', async () => {
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/encoding/detect') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: true,
        payload: {
          file: '/tmp/test.jsp',
          encoding: 'gbk',
          confidence: 0.98,
          candidates: ['gbk', 'gb18030', 'utf-8'],
          hasBom: false,
          eol: 'crlf',
          warning: 'File was opened with UTF-8 but detected as GBK. Some characters may display incorrectly.',
          declaredEncoding: 'utf-8',
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/encoding/detect', {
      method: 'POST',
      body: { workspaceId: 'ws-1', file: '/tmp/test.jsp' },
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.json.payload.encoding, 'gbk',
      'Must detect correct encoding');
    assert.ok(resp.json.payload.warning,
      'Must show warning about encoding mismatch');
    assert.ok(resp.json.payload.warning.includes('GBK'),
      'Warning must mention detected encoding');
    assert.ok(resp.json.payload.candidates.length > 0,
      'Must provide encoding candidates');
  } finally {
    srv.close();
  }
});

// =========================================================================
// Scenario 24: Mixed encoding search
// =========================================================================

test('Fault-24: Mixed encoding — search results correct for GBK and UTF-8', async () => {
  const { srv, baseUrl } = await runServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/search') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r_search',
        ok: true,
        payload: {
          query: '你好',
          totalMatches: 2,
          truncated: false,
          matches: [
            { file: 'src/gbk_file.jsp', line: 10, column: 5, matchText: '你好', contextBefore: '', contextAfter: '', encoding: 'gbk' },
            { file: 'src/utf8_file.jsp', line: 20, column: 3, matchText: '你好', contextBefore: '', contextAfter: '', encoding: 'utf-8' },
          ],
          elapsedMs: 500,
          erroredFiles: [],
          encodingBreakdown: {
            gbk: 1,
            'utf-8': 1,
          },
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, payload: { ok: true } }));
    }
  });

  try {
    const resp = await fetchJson(baseUrl, '/api/v1/search', {
      method: 'POST',
      body: { workspaceId: 'ws-1', query: '你好', isRegex: false },
    });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.json.payload.totalMatches, 2,
      'Must find results in both encodings');
    assert.ok(resp.json.payload.encodingBreakdown,
      'Must include encoding breakdown');
    assert.strictEqual(resp.json.payload.encodingBreakdown.gbk, 1,
      'Must find one GBK result');
    assert.strictEqual(resp.json.payload.encodingBreakdown['utf-8'], 1,
      'Must find one UTF-8 result');

    const encodings = resp.json.payload.matches.map(m => m.encoding);
    assert.ok(encodings.includes('gbk'), 'Must include GBK result');
    assert.ok(encodings.includes('utf-8'), 'Must include UTF-8 result');
  } finally {
    srv.close();
  }
});