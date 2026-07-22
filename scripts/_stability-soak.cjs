// Stability: 30-min soak (CPU/RSS/process-count growth) + 20x agent restart orphan check.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { startStack, stopStack, launchBrowser, openPage, dismissTrustDialog, waitForStatusBarContains, ensureDir, sleep } = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa.SOUdxO';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'stability'));
const SOAK_MINUTES = Number(process.env.KAIRO_SOAK_MINUTES || 30);
const CYCLES = Number(process.env.KAIRO_SOAK_CYCLES || 20);

function ps() {
  const r = spawnSync('ps', ['-axo', 'pid,pcpu,rss,comm'], { encoding: 'utf8' });
  const rows = r.stdout.split('\n')
    .filter(l => /kairo-runtime|kairo|theia|java|jdt/i.test(l) && !/grep|_stability/.test(l))
    .map(l => l.trim().split(/\s+/))
    .filter(cols => cols.length >= 4)
    .map(([pid, pcpu, rss, ...comm]) => ({ pid, pcpu: Number(pcpu), rssMB: Math.round(Number(rss) / 1024), comm: comm.join(' ') }));
  return rows;
}

function countByKind(rows) {
  return {
    agent: rows.filter(r => r.comm.includes('kairo-runtime')).length,
    java: rows.filter(r => r.comm.includes('java')).length,
    total: rows.length,
    cpuSum: Math.round(rows.reduce((a, r) => a + r.pcpu, 0) * 10) / 10,
    rssSumMB: rows.reduce((a, r) => a + r.rssMB, 0),
  };
}

async function main() {
  const report = { startedAt: new Date().toISOString(), soakMinutes: SOAK_MINUTES, samples: [], cycles: {}, verdict: 'PASS', notes: [] };

  // Phase 1: soak with a connected browser
  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'stability-stack'), port: 19090, webPort: 13900, skipBuild: true });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/?kairoAgent=${encodeURIComponent('http://127.0.0.1:19090')}`;
  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  const baseline = countByKind(ps());
  report.samples.push({ t: 0, ...baseline });
  const iterations = Math.ceil(SOAK_MINUTES); // 1 sample per minute
  for (let i = 1; i <= iterations; i++) {
    await sleep(60 * 1000);
    const s = countByKind(ps());
    report.samples.push({ t: i, ...s });
    if (i % 5 === 0) console.log(`soak t=${i}min cpu=${s.cpuSum}% rss=${s.rssSumMB}MB procs=${s.total}`);
  }

  const last = report.samples[report.samples.length - 1];
  // verdicts: no unbounded RSS growth (>50% over baseline), no process multiplication
  if (last.total > baseline.total + 2) { report.verdict = 'FAIL'; report.notes.push(`process count grew ${baseline.total} -> ${last.total}`); }
  if (last.rssSumMB > baseline.rssSumMB * 1.5 + 512) { report.verdict = 'FAIL'; report.notes.push(`rss grew ${baseline.rssSumMB}MB -> ${last.rssSumMB}MB`); }

  await browser.close();
  await stopStack(stack.dataDir);
  await sleep(3000);

  // Phase 2: 20x agent restart — no orphans. Verdict is a PID-set diff:
  // the machine legitimately runs OTHER kairo agents (parallel QA
  // stacks), so only count PIDs that did not exist before the cycles.
  const pidsBefore = new Set(ps().map(r => r.pid));
  const cfgPath = path.join(stack.dataDir, 'agent-config.yaml');
  const agentBin = path.join(__dirname, '..', 'runtime-agent', 'bin', 'kairo-runtime');
  let cyclesOk = 0;
  for (let i = 0; i < CYCLES; i++) {
    const child = spawn(agentBin, ['--config', cfgPath], { stdio: 'ignore' });
    await sleep(1500);
    child.kill('SIGTERM');
    await sleep(800);
    if (child.exitCode === null) { child.kill('SIGKILL'); await sleep(300); }
    cyclesOk++;
  }
  await sleep(2000);
  const after = ps().filter(r => r.comm.includes('kairo-runtime') && !pidsBefore.has(r.pid));
  report.cycles = { requested: CYCLES, completed: cyclesOk, orphanAgentsAfter: after.length, orphans: after };
  if (after.length > 0) { report.verdict = 'FAIL'; report.notes.push(`${after.length} orphan kairo-runtime after ${CYCLES} cycles`); }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'stability-report.json'), JSON.stringify(report, null, 2));
  console.log(`STABILITY ${report.verdict} — notes: ${report.notes.join('; ') || 'none'}`);
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
