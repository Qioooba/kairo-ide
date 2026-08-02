/**
 * Official win-unpacked [S] smoke + G3 desktop spot-check orchestrator.
 * Runs filtered case IDs from existing train scripts against resolveExe()
 * (prefers apps/desktop/dist/win-unpacked/Kairo.exe).
 *
 *   node scripts/test/qa/ship-s-smoke.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { repoRoot, ensureDir, resolveExe, log } = require('./_helpers.cjs');

const outDir = path.join(repoRoot, 'artifacts', 'qa', 'ship-smoke');
ensureDir(outDir);
ensureDir(path.join(outDir, 'shots'));

const S_DESKTOP_A1 = '1.1,1.2,1.3,2.1,2.2,2.5,2.6';
const S_DESKTOP_A2 = '5.1,5.2,5.5,6.1,6.2,6.3,7.1,7.3,7.5';

const exe = resolveExe();
log(`ship-s-smoke exe=${exe}`);
if (!/win-unpacked/i.test(exe)) {
  log('WARNING: exe is not win-unpacked — set path or rebuild');
}

function runNode(script, envExtra = {}) {
  const env = {
    ...process.env,
    ...envExtra,
    KAIRO_QA_ALLOW_AGENT_RECONNECT: '1',
  };
  log(`run ${path.basename(script)} filter=${env.KAIRO_QA_CASE_FILTER || '(all)'}`);
  const r = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: 45 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const logPath = path.join(outDir, `${path.basename(script, '.cjs')}.log`);
  fs.writeFileSync(
    logPath,
    `exit=${r.status}\n\n--- stdout ---\n${r.stdout || ''}\n\n--- stderr ---\n${r.stderr || ''}\n`,
  );
  log(`finished ${path.basename(script)} exit=${r.status} log=${logPath}`);
  return r.status || 0;
}

const a1 = path.join(repoRoot, 'scripts', 'test', 'qa', 'a1-g1-g2-desktop.cjs');
const a2 = path.join(repoRoot, 'scripts', 'test', 'qa', 'a2-g5-g6-g7-desktop.cjs');
const g3 = path.join(repoRoot, 'scripts', 'test', 'qa', 'g3-desktop-s-spot.cjs');

const code1 = runNode(a1, { KAIRO_QA_CASE_FILTER: S_DESKTOP_A1 });
const code2 = runNode(a2, { KAIRO_QA_CASE_FILTER: S_DESKTOP_A2 });
const code3 = runNode(g3, {});

function loadCases(agentDir) {
  const p = path.join(repoRoot, 'artifacts', 'qa', agentDir, 'report.json');
  if (!fs.existsSync(p)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(j.cases) ? j.cases : [];
  } catch {
    return [];
  }
}

const g3Cases = loadCases(path.join('ship-smoke', 'g3-desktop'));
const cases = [
  ...loadCases('a1').filter((c) => String(S_DESKTOP_A1).split(',').includes(String(c.id))),
  ...loadCases('a2').filter((c) => String(S_DESKTOP_A2).split(',').includes(String(c.id))),
  ...g3Cases,
];

const report = {
  agent: 'SHIP-S',
  instance: 'win-unpacked',
  round: 9,
  exe,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  cases,
  summary: {
    pass: cases.filter((c) => c.status === 'pass').length,
    fail: cases.filter((c) => c.status === 'fail').length,
    blocked: cases.filter((c) => c.status === 'blocked').length,
    skip: cases.filter((c) => c.status === 'skip').length,
  },
  exitCodes: { a1: code1, a2: code2, g3: code3 },
};

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
log(
  `ship-smoke report → ${path.join(outDir, 'report.json')} (${report.summary.pass} pass / ${report.summary.fail} fail / ${report.summary.skip} skip)`,
);

process.exit(report.summary.fail > 0 || code1 !== 0 || code2 !== 0 || code3 !== 0 ? 1 : 0);
