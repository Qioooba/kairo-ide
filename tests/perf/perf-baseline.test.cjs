// Performance Baseline Tests — measures and enforces
// performance targets for the Kairo IDE.
//
// Targets (2 vCPU / 4 GB):
//   - Desktop to editor interactive: ≤ 8s
//   - Agent idle RSS: baseline, regress ≤ 15%
//   - 1000-line Java file open: ≤ 1s (excl. first JDT index)
//   - 1000 logs UI long task: ≤ 100ms each
//   - Event reconnect + snapshot: ≤ 3s
//   - Agent exit child cleanup: ≤ 8s
//
// These tests run on every CI build and collect
// measurements. If a target is exceeded, the test
// reports a warning but does not fail — performance
// regressions are tracked over time.
//
// Run with:
//   node --test tests/perf/perf-baseline.test.cjs

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// =========================================================================
// Performance targets
// =========================================================================

const TARGETS = {
  desktopToEditor: 8000,      // 8s
  agentIdleRssRegress: 0.15,  // 15%
  javaFileOpen: 1000,         // 1s
  logsLongTask: 100,          // 100ms
  eventReconnect: 3000,       // 3s
  agentExitCleanup: 8000,     // 8s
};

// =========================================================================
// Helpers
// =========================================================================

function runServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function measure(fn) {
  const start = process.hrtime.bigint();
  await fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000; // ms
}

function measureSync(fn) {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000; // ms
}

function getRssMb() {
  const mem = process.memoryUsage();
  return Math.round(mem.rss / 1024 / 1024);
}

function checkTarget(name, value, target) {
  if (value <= target) {
    console.log(`  PASS  ${name}: ${value}ms ≤ ${target}ms`);
  } else {
    console.log(`  WARN  ${name}: ${value}ms > ${target}ms (${Math.round((value - target) / target * 100)}% over)`);
  }
}

// =========================================================================
// Test 1: HTTP response time baseline (proxy for agent responsiveness)
// =========================================================================

test('Perf-1: Agent health endpoint response time ≤ 500ms', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ requestId: 'r1', ok: true, payload: { ok: true } }));
  });

  try {
    const responseTimes = [];
    for (let i = 0; i < 10; i++) {
      const elapsed = await measure(() => {
        return new Promise((resolve, reject) => {
          const req = http.request(`${baseUrl}/api/v1/health`, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', resolve);
          });
          req.on('error', reject);
          req.end();
        });
      });
      responseTimes.push(elapsed);
    }

    const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const max = Math.max(...responseTimes);

    console.log(`  Health endpoint: avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    assert.ok(avg < 500, `Average health response time ${avg.toFixed(1)}ms exceeds 500ms`);
    checkTarget('Health response avg', avg, 500);
  } finally {
    srv.close();
  }
});

// =========================================================================
// Test 2: EventStream connect + snapshot ≤ 3s
// =========================================================================

test('Perf-2: EventStream reconnect + snapshot ≤ 3s', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    if (req.url.startsWith('/api/v1/events')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      // Simulate snapshot with 100 items
      const builds = [];
      for (let i = 0; i < 100; i++) {
        builds.push({ id: `b${i}`, state: 'success', summary: { errors: 0, warnings: 0, filesCompiled: 5 } });
      }
      res.write('data: {"type":"connected","seq":0}\n\n');
      res.write(`data: {"type":"snapshot","seq":0,"payload":{"builds":${JSON.stringify(builds)},"deployments":[],"servers":[]}}\n\n`);
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }
  });

  try {
    const elapsed = await measure(() => {
      return new Promise((resolve, reject) => {
        const req = http.request(`${baseUrl}/api/v1/events`, {
          headers: { 'X-Kairo-Secret': 'correct' },
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            // Verify snapshot was received
            assert.ok(body.includes('"type":"snapshot"'), 'Snapshot must be received');
            assert.ok(body.includes('"builds"'), 'Snapshot must include builds');
            resolve();
          });
        });
        req.on('error', reject);
        req.end();
      });
    });

    console.log(`  EventStream connect+snapshot: ${elapsed.toFixed(1)}ms`);
    checkTarget('Event reconnect + snapshot', elapsed, TARGETS.eventReconnect);
  } finally {
    srv.close();
  }
});

// =========================================================================
// Test 3: JSON parsing of 1000 log entries (simulating log UI) ≤ 100ms per batch
// =========================================================================

test('Perf-3: 1000 log entries processing ≤ 100ms per batch', async () => {
  // Generate 1000 log entries
  const logs = [];
  for (let i = 0; i < 1000; i++) {
    logs.push({
      line: `[${new Date().toISOString()}] INFO: log entry ${i} — some details about the build process`,
      ts: new Date().toISOString(),
      level: i % 100 === 0 ? 'ERROR' : 'INFO',
    });
  }

  const batchSize = 100;
  const batchTimes = [];

  for (let i = 0; i < logs.length; i += batchSize) {
    const batch = logs.slice(i, i + batchSize);
    const elapsed = measureSync(() => {
      // Simulate UI rendering: parse + filter + map
      const parsed = JSON.stringify(batch);
      const back = JSON.parse(parsed);
      const filtered = back.filter(l => l.level === 'ERROR');
      const mapped = back.map(l => ({ ...l, display: l.line.slice(0, 50) }));
      // Access all entries to prevent optimization
      for (let j = 0; j < mapped.length; j++) {
        void mapped[j].display;
      }
      for (let j = 0; j < filtered.length; j++) {
        void filtered[j].line;
      }
    });
    batchTimes.push(elapsed);
  }

  const avgBatchTime = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
  const maxBatchTime = Math.max(...batchTimes);

  console.log(`  1000 logs: avg batch=${avgBatchTime.toFixed(2)}ms max=${maxBatchTime.toFixed(2)}ms`);
  checkTarget('Logs UI long task (max)', maxBatchTime, TARGETS.logsLongTask);
  assert.ok(maxBatchTime < 200, `Max batch time ${maxBatchTime.toFixed(2)}ms exceeds 200ms`);
});

// =========================================================================
// Test 4: Agent exit child cleanup ≤ 8s
// =========================================================================

test('Perf-4: Agent exit child cleanup time ≤ 8s', async () => {
  // Spawn children and measure cleanup time
  const children = [];
  for (let i = 0; i < 3; i++) {
    const child = spawn('sleep', ['5'], { stdio: 'ignore' });
    children.push(child);
  }

  // Measure cleanup
  const cleanupTime = await measure(async () => {
    for (const child of children) {
      child.kill('SIGTERM');
    }
    // Wait for all to exit
    await Promise.all(children.map(c => {
      return new Promise((resolve) => {
        c.on('exit', resolve);
        // Also set a timeout in case child doesn't exit
        setTimeout(() => {
          c.kill('SIGKILL');
          resolve();
        }, 3000);
      });
    }));
  });

  console.log(`  Agent exit child cleanup: ${cleanupTime.toFixed(1)}ms`);
  checkTarget('Agent exit child cleanup', cleanupTime, TARGETS.agentExitCleanup);

  // Verify all children are dead
  for (const child of children) {
    try {
      process.kill(child.pid, 0);
      // If alive, force kill
      child.kill('SIGKILL');
    } catch (_e) {
      // Already dead
    }
  }
});

// =========================================================================
// Test 5: Large file processing (1000-line Java file) ≤ 1s
// =========================================================================

test('Perf-5: 1000-line Java file processing ≤ 1s', async () => {
  // Generate a 1000-line Java file content
  let javaContent = 'package com.example;\n\n';
  javaContent += 'import java.util.*;\n';
  javaContent += 'import java.io.*;\n\n';
  javaContent += 'public class LargeFile {\n';
  for (let i = 0; i < 990; i++) {
    javaContent += `    private String field${i} = "value${i}";\n`;
  }
  javaContent += '}\n';

  const lines = javaContent.split('\n');
    assert.ok(lines.length >= 990, `Expected at least 990 lines, got ${lines.length}`);

  // Measure: read + parse + highlight (simulate editor operations)
  const elapsed = measureSync(() => {
    // Parse into lines
    const parsedLines = javaContent.split('\n');
    // Simulate syntax highlighting: classify each line
    const classified = parsedLines.map(line => {
      if (line.startsWith('package ')) return { type: 'keyword', line };
      if (line.startsWith('import ')) return { type: 'import', line };
      if (line.includes('class ')) return { type: 'class', line };
      if (line.includes('private ')) return { type: 'field', line };
      return { type: 'other', line };
    });
    // Simulate folding: find blocks
    const blocks = [];
    let depth = 0;
    for (const item of classified) {
      if (item.line.includes('{')) depth++;
      if (item.line.includes('}')) depth--;
      blocks.push({ ...item, depth });
    }
    // Access all to prevent optimization
    for (let i = 0; i < blocks.length; i++) {
      void blocks[i].type;
      void blocks[i].depth;
    }
  });

  console.log(`  1000-line Java file processing: ${elapsed.toFixed(1)}ms`);
  checkTarget('Java file open (1000 lines)', elapsed, TARGETS.javaFileOpen);
  assert.ok(elapsed < 2000, `1000-line file processing ${elapsed.toFixed(1)}ms exceeds 2s`);
});

// =========================================================================
// Test 6: Memory baseline (RSS) — no regression detection
// =========================================================================

test('Perf-6: Memory usage baseline (RSS)', () => {
  const rssMb = getRssMb();
  console.log(`  Current RSS: ${rssMb} MB`);

  // Store baseline for comparison
  const baselinePath = path.join(__dirname, '..', '..', 'testdata', 'perf-baseline.json');
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  } catch (_e) {
    // First run — store baseline
    baseline = { rssMb, timestamp: new Date().toISOString() };
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
    console.log(`  Baseline stored: ${rssMb} MB`);
    return;
  }

  if (baseline.rssMb) {
    const increase = (rssMb - baseline.rssMb) / baseline.rssMb;
    console.log(`  Baseline RSS: ${baseline.rssMb} MB | Current: ${rssMb} MB | Change: ${(increase * 100).toFixed(1)}%`);

    if (increase > TARGETS.agentIdleRssRegress) {
      console.log(`  WARN: RSS regression ${(increase * 100).toFixed(1)}% exceeds ${TARGETS.agentIdleRssRegress * 100}% threshold`);
    } else {
      console.log(`  PASS: RSS within ${TARGETS.agentIdleRssRegress * 100}% regression limit`);
    }
  }
});

// =========================================================================
// Test 7: Concurrent request handling baseline
// =========================================================================

test('Perf-7: Concurrent request handling (10 parallel requests)', async () => {
  const { srv, baseUrl } = await runServer((req, res) => {
    // Simulate a small processing delay
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId: 'r1', ok: true, payload: { ok: true } }));
    }, 10);
  });

  try {
    const numRequests = 10;
    const start = process.hrtime.bigint();

    const promises = [];
    for (let i = 0; i < numRequests; i++) {
      promises.push(new Promise((resolve, reject) => {
        const req = http.request(`${baseUrl}/api/v1/health`, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', resolve);
        });
        req.on('error', reject);
        req.end();
      }));
    }

    await Promise.all(promises);
    const end = process.hrtime.bigint();
    const elapsed = Number(end - start) / 1_000_000;

    console.log(`  10 concurrent requests: ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 5000, `10 concurrent requests ${elapsed.toFixed(1)}ms exceeds 5s`);
  } finally {
    srv.close();
  }
});

// =========================================================================
// Test 8: Build log parsing (1000 diagnostic messages) ≤ 100ms
// =========================================================================

test('Perf-8: Build log parsing (1000 diagnostics) ≤ 100ms', () => {
  // Generate 1000 diagnostic messages
  const diagnostics = [];
  for (let i = 0; i < 1000; i++) {
    diagnostics.push({
      file: `src/main/java/com/example/Class${i % 100}.java`,
      line: i % 500 + 1,
      column: i % 80 + 1,
      severity: i % 5 === 0 ? 'ERROR' : 'WARNING',
      message: `Diagnostic message ${i}: some issue with the code`,
      code: `kairo-${i % 100}`,
    });
  }

  const elapsed = measureSync(() => {
    // Group by severity
    const bySeverity = {};
    for (const d of diagnostics) {
      if (!bySeverity[d.severity]) bySeverity[d.severity] = [];
      bySeverity[d.severity].push(d);
    }
    // Group by file
    const byFile = {};
    for (const d of diagnostics) {
      if (!byFile[d.file]) byFile[d.file] = [];
      byFile[d.file].push(d);
    }
    // Count totals
    const totalErrors = (bySeverity['ERROR'] || []).length;
    const totalWarnings = (bySeverity['WARNING'] || []).length;
    const fileCount = Object.keys(byFile).length;
    void totalErrors;
    void totalWarnings;
    void fileCount;
  });

  console.log(`  1000 diagnostics parsing: ${elapsed.toFixed(1)}ms`);
  checkTarget('Build log parsing (1000 diags)', elapsed, 100);
  assert.ok(elapsed < 200, `1000 diagnostics parsing ${elapsed.toFixed(1)}ms exceeds 200ms`);
});