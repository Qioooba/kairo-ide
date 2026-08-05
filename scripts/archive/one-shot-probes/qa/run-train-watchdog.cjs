/**
 * Round 10 train runner with 45min watchdog.
 * Usage:
 *   node scripts/test/qa/run-train-watchdog.cjs --script a1-g1-g2-desktop.cjs --out artifacts/qa/round-10/loop-1/a1
 * Env: KAIRO_QA_ROUND, KAIRO_QA_CASE_FILTER, KAIRO_QA_CASE_TIMEOUT_MS, KAIRO_QA_TRAIN_TIMEOUT_MS (default 45min)
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}

const scriptRel = arg('script');
if (!scriptRel) {
  console.error('missing --script');
  process.exit(2);
}
const scriptPath = path.isAbsolute(scriptRel)
  ? scriptRel
  : path.join(repoRoot, 'scripts', 'test', 'qa', scriptRel);
const outCopy = arg('out', null);
const trainTimeoutMs = Number(process.env.KAIRO_QA_TRAIN_TIMEOUT_MS || arg('timeoutMs', 45 * 60 * 1000));
const label = path.basename(scriptPath, '.cjs');

const env = {
  ...process.env,
  KAIRO_QA_ROUND: process.env.KAIRO_QA_ROUND || '10',
  KAIRO_QA_CASE_TIMEOUT_MS: process.env.KAIRO_QA_CASE_TIMEOUT_MS || '90000',
};
// Explicitly unset filter unless provided
if (!('KAIRO_QA_CASE_FILTER' in process.env) && !arg('filter', null)) {
  delete env.KAIRO_QA_CASE_FILTER;
}
if (arg('filter', null)) env.KAIRO_QA_CASE_FILTER = arg('filter');

const logDir = outCopy ? path.resolve(outCopy) : path.join(repoRoot, 'artifacts', 'qa', 'round-10', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, `${label}.log`);
const logFd = fs.openSync(logPath, 'w');

console.log(`[watchdog] start ${label} timeout=${trainTimeoutMs}ms log=${logPath}`);
const child = spawn(process.execPath, [scriptPath, ...argv.filter((_, i, a) => {
  // pass through unknown args after --
  return false;
})], {
  cwd: repoRoot,
  env,
  stdio: ['ignore', logFd, logFd],
  windowsHide: true,
});

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`[watchdog] TIMEOUT ${label} after ${trainTimeoutMs}ms — killing tree`);
  try {
    spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
  } catch (_) {
    try { child.kill(); } catch (__) {}
  }
}, trainTimeoutMs);

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  try { fs.closeSync(logFd); } catch (_) {}
  const exitCode = timedOut ? 124 : (code == null ? 1 : code);
  console.log(`[watchdog] end ${label} exit=${exitCode} timedOut=${timedOut} signal=${signal || ''}`);

  // Copy report.json if --out given
  if (outCopy) {
    // Guess agent out dirs from script name
    const guesses = [];
    if (/^a1/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'a1'));
    if (/^a2/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'a2'));
    if (/^a3/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'a3'));
    if (/^a4/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'a4'));
    if (/^a5/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'a5'));
    if (/^a6/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'a6'));
    if (/^a7/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'a7'));
    if (/^a8/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'a8'));
    if (/g3-desktop/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'ship-smoke', 'g3-desktop'));
    if (/scenario-a/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'round-10', 'final', 'scenario-a'));
    if (/scenario-b/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'round-10', 'final', 'scenario-b'));
    if (/scenario-c/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'round-10', 'final', 'scenario-c'));
    if (/ship-s/.test(label)) guesses.push(path.join(repoRoot, 'artifacts', 'qa', 'ship-smoke'));
    for (const g of guesses) {
      const report = path.join(g, 'report.json');
      if (fs.existsSync(report)) {
        fs.mkdirSync(outCopy, { recursive: true });
        fs.copyFileSync(report, path.join(outCopy, 'report.json'));
        console.log(`[watchdog] copied report → ${path.join(outCopy, 'report.json')}`);
      }
    }
  }
  process.exit(exitCode);
});
