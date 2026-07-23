#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(__dirname, 'run-with-timeout.cjs');
const BASELINE_FILE = path.join(ROOT, 'baseline.json');
const isWindows = process.platform === 'win32';
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';
const go = isWindows ? 'go.exe' : 'go';

// --- CLI args ---
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] || '') : undefined;
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) {
  console.error('[baseline] ERROR: --output requires a path');
  process.exit(2);
}

// --- Helpers ---

function plain(command, args, cwd = ROOT, timeout = 10_000) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, windowsHide: true });
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function gate(id, seconds, command, args, cwd = ROOT) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [RUNNER, String(seconds), command, ...args], {
    cwd, encoding: 'utf8', timeout: (seconds + 10) * 1_000, windowsHide: true
  });
  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  return {
    id,
    command: [command, ...args],
    timeoutSeconds: seconds,
    elapsedMs: Date.now() - started,
    exitCode: result.status,
    ok: result.status === 0,
    outputTail: combined.slice(-20_000)
  };
}

/**
 * Measure time for a command to complete. Returns elapsedMs on success, null on failure.
 */
function timed(command, args, cwd = ROOT, timeout = 120_000) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, windowsHide: true });
  const elapsed = Date.now() - started;
  if (result.status !== 0) return null;
  return { elapsedMs: elapsed, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

/**
 * Measure memory usage of the current Node process (RSS).
 */
function measureMemory() {
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / (1024 * 1024));
  const heapUsedMB = Math.round(mem.heapUsed / (1024 * 1024));
  const heapTotalMB = Math.round(mem.heapTotal / (1024 * 1024));
  return { rssMB, heapUsedMB, heapTotalMB, rssBytes: mem.rss };
}

/**
 * Spawn a long-running process and collect memory samples over time.
 * Returns { peakRSS_MB, steadyStateRSS_MB, samples }.
 */
function measureProcessMemory(command, args, cwd = ROOT, sampleIntervalMs = 500, maxDurationMs = 120_000) {
  return new Promise((resolve) => {
    const samples = [];
    let peak = 0;
    let interval;
    let settled = false;
    const start = Date.now();

    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    interval = setInterval(() => {
      try {
        // Attempt to read child process memory via OS-specific means
        const pid = child.pid;
        if (!pid) return;

        let rssKB = 0;
        try {
          if (process.platform === 'linux') {
            // Linux: read /proc/[pid]/stat, field 24 is rss (pages)
            const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
            const parts = stat.split(' ');
            const rssIndex = 23; // 0-based index for field 24
            if (parts.length > rssIndex) {
              rssKB = (parseInt(parts[rssIndex], 10) * 4096) / 1024;
            }
          } else if (process.platform === 'darwin') {
            // macOS: use ps
            const psResult = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 });
            if (psResult.status === 0) {
              rssKB = parseInt(psResult.stdout.trim(), 10);
            }
          }
        } catch {
          // Memory sampling is best-effort
        }

        if (rssKB > 0) {
          const rssMB = Math.round(rssKB / 1024);
          samples.push({ ts: Date.now() - start, rssMB });
          if (rssMB > peak) peak = rssMB;
        }
      } catch {
        // Best-effort sampling
      }
    }, sampleIntervalMs);

    const timer = setTimeout(() => {
      clearInterval(interval);
      try { child.kill('SIGTERM'); } catch {}
      settled = true;
      const steadySamples = samples.slice(-10);
      const steadyAvg = steadySamples.length > 0
        ? Math.round(steadySamples.reduce((s, v) => s + v.rssMB, 0) / steadySamples.length)
        : 0;
      resolve({
        peakRSS_MB: peak,
        steadyStateRSS_MB: steadyAvg,
        samples,
        stdout: stdout.slice(-5000),
        stderr: stderr.slice(-5000),
        timedOut: true
      });
    }, maxDurationMs);

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timer);
      const steadySamples = samples.slice(-10);
      const steadyAvg = steadySamples.length > 0
        ? Math.round(steadySamples.reduce((s, v) => s + v.rssMB, 0) / steadySamples.length)
        : 0;
      resolve({
        exitCode: code,
        peakRSS_MB: peak,
        steadyStateRSS_MB: steadyAvg,
        samples,
        stdout: stdout.slice(-5000),
        stderr: stderr.slice(-5000),
        timedOut: false
      });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timer);
      resolve({
        error: err.message,
        peakRSS_MB: peak,
        steadyStateRSS_MB: 0,
        samples: [],
        timedOut: false
      });
    });
  });
}

/**
 * Load previous baseline for regression detection.
 */
function loadPreviousBaseline() {
  try {
    if (fs.existsSync(BASELINE_FILE)) {
      return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Compare current metrics against previous baseline.
 * Flags regressions > 20%.
 */
function detectRegressions(current, previous) {
  if (!previous || !previous.metrics) return [];

  const regressions = [];

  const metricMap = {
    'coldStartMs': { label: 'Cold Start', direction: 'higher', unit: 'ms' },
    'buildCleanMs': { label: 'Clean Build', direction: 'higher', unit: 'ms' },
    'buildIncrementalMs': { label: 'Incremental Build', direction: 'higher', unit: 'ms' },
    'peakMemoryMB': { label: 'Peak Memory', direction: 'higher', unit: 'MB' },
    'steadyMemoryMB': { label: 'Steady Memory', direction: 'higher', unit: 'MB' },
    'searchFirstMs': { label: 'First Search', direction: 'higher', unit: 'ms' },
    'searchSubsequentMs': { label: 'Subsequent Search', direction: 'higher', unit: 'ms' },
    'javaCompletionFirstMs': { label: 'Java Completion', direction: 'higher', unit: 'ms' },
  };

  for (const [key, cfg] of Object.entries(metricMap)) {
    const prev = previous.metrics[key];
    const curr = current[key];
    if (prev == null || curr == null) continue;

    const prevVal = Number(prev);
    const currVal = Number(curr);
    if (prevVal === 0) continue;

    const pctChange = ((currVal - prevVal) / prevVal) * 100;
    const isRegression = cfg.direction === 'higher' ? pctChange > 20 : pctChange < -20;

    if (isRegression) {
      regressions.push({
        metric: key,
        label: cfg.label,
        previous: prevVal,
        current: currVal,
        pctChange: Math.round(pctChange * 100) / 100,
        threshold: 20,
        unit: cfg.unit
      });
    }
  }

  return regressions;
}

// ================================================================
// MAIN REPORT
// ================================================================

async function main() {
  const reportStart = Date.now();

  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    platform: {
      os: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memoryBytes: os.totalmem(),
      hostname: os.hostname()
    },
    toolchain: {
      node: process.version,
      pnpm: plain(pnpm, ['--version']),
      go: plain(go, ['version'])
    },
    git: {
      commit: plain('git', ['rev-parse', 'HEAD']),
      branch: plain('git', ['branch', '--show-current']),
      dirty: Boolean(plain('git', ['status', '--porcelain']))
    },
    gates: [],
    metrics: {},
    perf: {}
  };

  // ================================================================
  // SECTION 1: Existing CI Gates (保持兼容)
  // ================================================================
  console.log('[baseline] === CI Gates ===');

  report.gates.push(gate('supply-chain-tests', 30, process.execPath, ['--test', 'scripts/supply-chain.test.cjs']));
  console.log(`  supply-chain-tests: ${report.gates[report.gates.length - 1].ok ? 'PASS' : 'FAIL'}`);

  report.gates.push(gate('typescript-unit', 300, pnpm, ['test']));
  console.log(`  typescript-unit: ${report.gates[report.gates.length - 1].ok ? 'PASS' : 'FAIL'}`);

  report.gates.push(gate('typescript-lint', 120, pnpm, ['lint']));
  console.log(`  typescript-lint: ${report.gates[report.gates.length - 1].ok ? 'PASS' : 'FAIL'}`);

  report.gates.push(gate('go-unit', 300, go, ['test', '-count=1', '-timeout', '285s', './...'], path.join(ROOT, 'runtime-agent')));
  console.log(`  go-unit: ${report.gates[report.gates.length - 1].ok ? 'PASS' : 'FAIL'}`);

  report.ok = report.gates.every(item => item.ok);

  const memBefore = measureMemory();
  report.metrics.baselineMemoryRSS_MB = memBefore.rssMB;

  // ================================================================
  // SECTION 2: Build Performance
  // ================================================================
  console.log('[baseline] === Build Performance ===');

  // Clean build
  const cleanBuild = timed(pnpm, ['run', 'build'], ROOT, 300_000);
  if (cleanBuild) {
    report.metrics.buildCleanMs = cleanBuild.elapsedMs;
    console.log(`  clean-build: ${cleanBuild.elapsedMs}ms`);
  } else {
    report.metrics.buildCleanMs = null;
    console.log('  clean-build: FAILED');
  }

  // Incremental build (touch a file then rebuild)
  // Touch a non-critical source file to trigger incremental build
  const touchFile = path.join(ROOT, 'packages', 'protocol', 'src', 'index.ts');
  try {
    const now = new Date();
    fs.utimesSync(touchFile, now, now);
  } catch {
    // File may not exist, skip
  }

  const incrementalBuild = timed(pnpm, ['run', 'build'], ROOT, 300_000);
  if (incrementalBuild) {
    report.metrics.buildIncrementalMs = incrementalBuild.elapsedMs;
    console.log(`  incremental-build: ${incrementalBuild.elapsedMs}ms`);
  } else {
    report.metrics.buildIncrementalMs = null;
    console.log('  incremental-build: FAILED');
  }

  // ================================================================
  // SECTION 3: Cold Start Time (best-effort: measure pnpm dev startup)
  // ================================================================
  console.log('[baseline] === Cold Start ===');

  // For cold start, measure the time to build the product + start the dev server
  // This is a proxy measurement — actual IDE cold start requires desktop automation
  const coldStart = timed(pnpm, ['run', 'build:product'], ROOT, 120_000);
  if (coldStart) {
    report.metrics.coldStartMs = coldStart.elapsedMs;
    console.log(`  cold-start (product build): ${coldStart.elapsedMs}ms`);
  } else {
    report.metrics.coldStartMs = null;
    console.log('  cold-start: FAILED');
  }

  // Also measure the agent build time (part of cold start)
  const agentBuild = timed(go, ['build', '-o', path.join(ROOT, 'runtime-agent', 'bin', 'kairo-runtime'), './cmd/kairo-runtime'], path.join(ROOT, 'runtime-agent'), 120_000);
  if (agentBuild) {
    report.metrics.agentBuildMs = agentBuild.elapsedMs;
    console.log(`  agent-build: ${agentBuild.elapsedMs}ms`);
  }

  // ================================================================
  // SECTION 4: Search Performance (text search in source tree)
  // ================================================================
  console.log('[baseline] === Search Performance ===');

  // Use ripgrep / grep to measure search performance across the codebase
  // This is a proxy for IDE search performance
  const searchCmd = process.platform === 'win32' ? 'findstr' : 'grep';
  const searchArgs = process.platform === 'win32'
    ? ['/s', '/i', '/m', 'class', path.join(ROOT, 'packages', '*', 'src', '*.ts')]
    : ['-r', '--include=*.ts', '-l', 'class', path.join(ROOT, 'packages')];

  const firstSearch = timed(searchCmd, searchArgs, ROOT, 30_000);
  if (firstSearch) {
    report.metrics.searchFirstMs = firstSearch.elapsedMs;
    const fileCount = firstSearch.stdout.split('\n').filter(Boolean).length;
    report.metrics.searchFirstFiles = fileCount;
    console.log(`  first-search: ${firstSearch.elapsedMs}ms (${fileCount} files)`);
  } else {
    report.metrics.searchFirstMs = null;
    console.log('  first-search: FAILED');
  }

  // Subsequent search (filesystem cache warmed)
  const secondSearch = timed(searchCmd, searchArgs, ROOT, 30_000);
  if (secondSearch) {
    report.metrics.searchSubsequentMs = secondSearch.elapsedMs;
    console.log(`  subsequent-search: ${secondSearch.elapsedMs}ms`);
  } else {
    report.metrics.searchSubsequentMs = null;
    console.log('  subsequent-search: FAILED');
  }

  // ================================================================
  // SECTION 5: Java Completion Latency (best-effort: measure JDTLS build)
  // ================================================================
  console.log('[baseline] === Java Completion ===');

  // As a proxy for Java completion, measure the time to build the java-extension package
  // which includes JDTLS-related code. Actual completion latency requires a running IDE.
  const javaBuild = timed(pnpm, ['--filter', '@kairo/java-extension', 'run', 'build'], ROOT, 120_000);
  if (javaBuild) {
    report.metrics.javaCompletionFirstMs = javaBuild.elapsedMs;
    console.log(`  java-extension-build: ${javaBuild.elapsedMs}ms`);
  } else {
    report.metrics.javaCompletionFirstMs = null;
    console.log('  java-extension-build: FAILED');
  }

  // ================================================================
  // SECTION 6: Memory Measurement
  // ================================================================
  console.log('[baseline] === Memory ===');

  // Measure memory during a build operation to capture peak usage
  const memDuringBuild = await measureProcessMemory(pnpm, ['run', 'build'], ROOT, 500, 300_000);

  report.metrics.peakMemoryMB = memDuringBuild.peakRSS_MB;
  report.metrics.steadyMemoryMB = memDuringBuild.steadyStateRSS_MB;
  report.metrics.memorySamples = memDuringBuild.samples.length;
  console.log(`  peak-memory: ${memDuringBuild.peakRSS_MB}MB`);
  console.log(`  steady-memory: ${memDuringBuild.steadyStateRSS_MB}MB`);

  // Also measure baseline (idle) memory
  const memAfter = measureMemory();
  report.metrics.idleMemoryMB = memAfter.rssMB;

  // ================================================================
  // SECTION 7: CI Regression Detection
  // ================================================================
  console.log('[baseline] === Regression Detection ===');

  const previous = loadPreviousBaseline();
  if (previous) {
    console.log(`  previous baseline: ${previous.generatedAt} (commit: ${previous.git?.commit || 'unknown'})`);
    const regressions = detectRegressions(report.metrics, previous);
    report.regressions = regressions;

    if (regressions.length > 0) {
      console.log('  REGRESSIONS DETECTED:');
      for (const r of regressions) {
        console.log(`    ${r.label}: ${r.previous}${r.unit} → ${r.current}${r.unit} (${r.pctChange > 0 ? '+' : ''}${r.pctChange}%)`);
      }
    } else {
      console.log('  No regressions detected (>20% threshold)');
    }
  } else {
    console.log('  No previous baseline found — skipping regression check');
  }

  // ================================================================
  // SECTION 8: Perf Summary (compatible with perf-baseline format)
  // ================================================================
  report.perf = {
    coldStart: {
      targetMs: 8000,
      measuredMs: report.metrics.coldStartMs,
      pass: report.metrics.coldStartMs !== null && report.metrics.coldStartMs <= 8000
    },
    search: {
      targetFirstMs: 3000,
      measuredFirstMs: report.metrics.searchFirstMs,
      measuredSubsequentMs: report.metrics.searchSubsequentMs,
      pass: report.metrics.searchFirstMs !== null && report.metrics.searchFirstMs <= 3000
    },
    javaCompletion: {
      targetMs: 1500,
      measuredMs: report.metrics.javaCompletionFirstMs,
      pass: report.metrics.javaCompletionFirstMs !== null && report.metrics.javaCompletionFirstMs <= 1500
    },
    build: {
      targetIncrementalMs: 2000,
      measuredCleanMs: report.metrics.buildCleanMs,
      measuredIncrementalMs: report.metrics.buildIncrementalMs,
      pass: report.metrics.buildIncrementalMs !== null && report.metrics.buildIncrementalMs <= 2000
    },
    memory: {
      targetSteadyMB: 1228, // 1.2 GB in MB
      measuredPeakMB: report.metrics.peakMemoryMB,
      measuredSteadyMB: report.metrics.steadyMemoryMB,
      pass: report.metrics.steadyMemoryMB !== null && report.metrics.steadyMemoryMB <= 1228
    }
  };

  // Compute overall perf pass/fail
  report.perfAllPass = Object.values(report.perf).every(p => p.pass !== false);

  // ================================================================
  // OUTPUT
  // ================================================================
  report.elapsedTotalMs = Date.now() - reportStart;

  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  // Write to baseline.json (always)
  try {
    fs.writeFileSync(BASELINE_FILE, serialized);
    console.log(`[baseline] baseline written to ${BASELINE_FILE}`);
  } catch (err) {
    console.error(`[baseline] WARNING: could not write baseline.json: ${err.message}`);
  }

  // Write to --output if specified
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, serialized);
    console.log(`[baseline] report written to ${output}`);
  }

  console.log(serialized);

  // Determine exit code:
  // - CI gates must pass
  // - Regressions are reported but not failing (informational)
  // - Perf targets are informational (not hard gates)
  const exitCode = report.ok ? 0 : 1;
  console.log(`[baseline] exit code: ${exitCode}`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[baseline] FATAL:', err);
  process.exit(2);
});