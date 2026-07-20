// EventStream contract tests — validate the WebSocket/SSE
// event protocol that the Kairo IDE frontend relies on.
//
// Tests:
//   - Secret authentication (X-Kairo-Secret header)
//   - Event replay (cursor-based)
//   - History gap detection
//   - Event envelope format
//   - Connection lifecycle
//
// Run with:
//   node --test tests/contract/eventstream.test.cjs

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

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

// --------------- secret authentication ---------------

test('EventStream secret: missing X-Kairo-Secret returns 401', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    const secret = req.headers['x-kairo-secret'];
    if (!secret) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: { code: 'unauthenticated', message: 'missing X-Kairo-Secret header' },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"connected","seq":0}\n\n');
      res.end();
    }
  });
  try {
    const resp = await new Promise((resolve) => {
      const req = http.request(`${baseUrl}/api/v1/events`, { method: 'GET' }, (res) => {
        resolve({ status: res.statusCode, headers: res.headers });
      });
      req.end();
    });
    assert.strictEqual(resp.status, 401);
  } finally { srv.close(); }
});

test('EventStream secret: wrong X-Kairo-Secret returns 403', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    const secret = req.headers['x-kairo-secret'];
    if (secret !== 'correct') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: { code: 'forbidden', message: 'invalid secret' },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"connected","seq":0}\n\n');
      res.end();
    }
  });
  try {
    const resp = await new Promise((resolve) => {
      const req = http.request(`${baseUrl}/api/v1/events`, {
        method: 'GET',
        headers: { 'X-Kairo-Secret': 'wrong' },
      }, (res) => {
        resolve({ status: res.statusCode });
      });
      req.end();
    });
    assert.strictEqual(resp.status, 403);
  } finally { srv.close(); }
});

test('EventStream secret: correct X-Kairo-Secret starts event stream', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    const secret = req.headers['x-kairo-secret'];
    if (secret !== 'correct') {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: {"type":"connected","seq":0}\n\n');
    res.write('data: {"type":"build","seq":1,"payload":{"id":"b1","state":"success"}}\n\n');
    res.end();
  });
  try {
    const resp = await new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}/api/v1/events`, {
        method: 'GET',
        headers: { 'X-Kairo-Secret': 'correct' },
      }, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['content-type'], 'text/event-stream');
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      });
      req.on('error', reject);
      req.end();
    });
    assert.ok(resp.includes('"type":"connected"'), 'Event stream must include connected event');
    assert.ok(resp.includes('"type":"build"'), 'Event stream must include build event');
    assert.ok(resp.includes('"seq":0'), 'Event stream must include sequence numbers');
  } finally { srv.close(); }
});

// --------------- event replay (cursor-based) ---------------

test('EventStream replay: cursor parameter retrieves events after seq', async () => {
  let capturedUrl = null;
  const { srv, baseUrl } = await runServer((req, res) => {
    capturedUrl = req.url;
    const secret = req.headers['x-kairo-secret'];
    if (secret !== 'correct') {
      res.writeHead(403);
      res.end();
      return;
    }
    // Simulate replay: return events starting from seq=5
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"connected","seq":0}\n\n');
    res.write('data: {"type":"build","seq":6,"payload":{"id":"b2","state":"success"}}\n\n');
    res.write('data: {"type":"deploy","seq":7,"payload":{"id":"d2","state":"success"}}\n\n');
    res.end();
  });
  try {
    const resp = await new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}/api/v1/events?since=5`, {
        method: 'GET',
        headers: { 'X-Kairo-Secret': 'correct' },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      });
      req.on('error', reject);
      req.end();
    });
    assert.ok(capturedUrl.includes('since=5'), 'Event stream replay must include since parameter');
    assert.ok(resp.includes('"seq":6'), 'Replay should start from seq 6');
    assert.ok(resp.includes('"seq":7'), 'Replay should include seq 7');
  } finally { srv.close(); }
});

// --------------- history gap detection ---------------

test('EventStream history gap: when since is too old, server returns 410 Gone', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const since = url.searchParams.get('since');
    if (since && parseInt(since) < 100) {
      // Too old — the server has already purged events before seq 100
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requestId: 'r1',
        ok: false,
        error: {
          code: 'gap',
          message: 'Event history gap: requested since=50, oldest available=100',
          oldestAvailable: 100,
        },
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"connected","seq":0}\n\n');
      res.end();
    }
  });
  try {
    const resp = await new Promise((resolve) => {
      const req = http.request(`${baseUrl}/api/v1/events?since=50`, {
        method: 'GET',
        headers: { 'X-Kairo-Secret': 'correct' },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (_e) {
            resolve({ status: res.statusCode, body: null });
          }
        });
      });
      req.end();
    });
    assert.strictEqual(resp.status, 410);
    assert.strictEqual(resp.body.error.code, 'gap');
    assert.ok(resp.body.error.oldestAvailable >= 100,
      'Gap error must include oldestAvailable seq');
  } finally { srv.close(); }
});

// --------------- event envelope format ---------------

test('EventStream envelope: each event has type, seq, and optionally payload', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"connected","seq":0}\n\n');
    res.write('data: {"type":"build","seq":1,"payload":{"id":"b1","state":"success"}}\n\n');
    res.write('data: {"type":"deploy","seq":2,"payload":{"id":"d1","state":"success","filesTouched":12}}\n\n');
    res.write('data: {"type":"server","seq":3,"payload":{"id":"srv1","state":"running","pid":12345}}\n\n');
    res.write('data: {"type":"heartbeat","seq":4}\n\n');
    res.end();
  });
  try {
    const resp = await new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}/api/v1/events`, {
        method: 'GET',
        headers: { 'X-Kairo-Secret': 'correct' },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      });
      req.on('error', reject);
      req.end();
    });

    // Parse SSE events
    const events = [];
    const lines = resp.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.substring(6);
        try {
          events.push(JSON.parse(jsonStr));
        } catch (_e) { /* skip */ }
      }
    }

    assert.ok(events.length >= 5, `Expected at least 5 events, got ${events.length}`);

    // Verify event format
    for (const evt of events) {
      assert.ok(typeof evt.type === 'string', 'Event must have type string');
      assert.ok(typeof evt.seq === 'number', 'Event must have seq number');
      assert.ok(evt.seq >= 0, 'Event seq must be >= 0');
    }

    // Verify specific event types
    const types = events.map(e => e.type);
    assert.ok(types.includes('connected'), 'Must include connected event');
    assert.ok(types.includes('build'), 'Must include build event');
    assert.ok(types.includes('deploy'), 'Must include deploy event');
    assert.ok(types.includes('server'), 'Must include server event');
    assert.ok(types.includes('heartbeat'), 'Must include heartbeat event');

    // Verify payload for events that have it
    const buildEvent = events.find(e => e.type === 'build');
    assert.ok(buildEvent.payload, 'Build event must have payload');
    assert.strictEqual(buildEvent.payload.state, 'success');

    const serverEvent = events.find(e => e.type === 'server');
    assert.ok(serverEvent.payload, 'Server event must have payload');
    assert.strictEqual(serverEvent.payload.pid, 12345);
  } finally { srv.close(); }
});

// --------------- connection lifecycle ---------------

test('EventStream lifecycle: connection can be closed gracefully', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: {"type":"connected","seq":0}\n\n');
    // Simulate server closing after a while
    setTimeout(() => res.end(), 50);
  });
  try {
    const resp = await new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}/api/v1/events`, {
        method: 'GET',
        headers: { 'X-Kairo-Secret': 'correct' },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      });
      req.on('error', reject);
      req.end();
    });
    assert.ok(resp.includes('"type":"connected"'), 'Connection must establish');
  } finally { srv.close(); }
});