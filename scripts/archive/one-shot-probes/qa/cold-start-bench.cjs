/**
 * R10.1 cold-start benchmark — 3 cold launches, median coldStartMs.
 *   node scripts/test/qa/cold-start-bench.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  repoRoot,
  ensureDir,
  sleep,
  log,
  makeRecorder,
  shot,
  launchDesktop,
  statusBarText,
} = require('./_helpers.cjs');

const outDir = path.join(repoRoot, 'artifacts', 'qa', 'round-10', 'final', 'cold-start');
ensureDir(outDir);
const ROUND = Number(process.env.KAIRO_QA_ROUND || 10);
const rec = makeRecorder({ agent: 'COLD-START', instance: 'D-FINAL', outDir, round: ROUND });
const times = [];

(async () => {
  const startedAt = new Date().toISOString();
  for (let i = 1; i <= 3; i++) {
    const ud = path.join(outDir, `userdata-${i}`);
    if (fs.existsSync(ud)) fs.rmSync(ud, { recursive: true, force: true });
    ensureDir(ud);
    // launchDesktop uses outDir/userdata — temporarily swap via env not supported;
    // use dedicated out subdir per run
    const runDir = path.join(outDir, `run-${i}`);
    if (fs.existsSync(runDir)) fs.rmSync(runDir, { recursive: true, force: true });
    ensureDir(runDir);
    ensureDir(path.join(runDir, 'workspace'));
    const t0 = Date.now();
    let app;
    let page;
    try {
      // settleMs=0: metric is to #theia-statusBar only (no post-ready sleep).
      ({ app, page } = await launchDesktop({ outDir: runDir, workspaceArg: false, settleMs: 0 }));
      const ms = Date.now() - t0;
      times.push(ms);
      const bar = await statusBarText(page);
      await shot(page, outDir, `cold-${i}`);
      rec.recordCase({
        id: `R10.1.${i}`,
        name: `Cold start #${i}`,
        status: 'pass',
        durationMs: ms,
        detail: `coldStartMs=${ms} bar=${bar.slice(0, 80)}`,
        shots: [`cold-${i}.jpg`],
      });
      log(`cold#${i}=${ms}ms`);
      await app.close().catch(() => {});
      await sleep(2000);
    } catch (e) {
      times.push(-1);
      rec.recordCase({
        id: `R10.1.${i}`,
        name: `Cold start #${i}`,
        status: 'fail',
        durationMs: Date.now() - t0,
        detail: String(e.message || e),
        shots: [],
      });
      if (app) await app.close().catch(() => {});
    }
  }
  const valid = times.filter((t) => t > 0).sort((a, b) => a - b);
  const median = valid.length ? valid[Math.floor(valid.length / 2)] : -1;
  const pass = median > 0 && median < 10_000;
  rec.recordCase({
    id: 'R10.1',
    name: 'Cold start median <10s',
    status: pass ? 'pass' : 'fail',
    durationMs: median,
    detail: `times=${JSON.stringify(times)} median=${median} target=10000`,
    shots: [],
  });
  rec.writeReport({
    agent: 'COLD-START',
    instance: 'D-FINAL',
    round: ROUND,
    startedAt,
    finishedAt: new Date().toISOString(),
    metrics: { coldStartTimesMs: times, coldStartMedianMs: median },
  });
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
