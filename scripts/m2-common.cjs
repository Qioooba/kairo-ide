// Shared glue for M2 (WEB-FLOW-01..06) release-blocking QA drivers.
// Artifacts live in the worktree under artifacts/acceptance-65210d5dd2e9/mac-web/.
// No product logic here — evidence plumbing only.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO_ROOT, ensureDir, nowIso } = require('./qa-helpers.cjs');

const ACCEPTANCE_ROOT = path.join(REPO_ROOT, 'artifacts', 'acceptance-65210d5dd2e9', 'mac-web');
const RESULTS_FILE = path.join(ACCEPTANCE_ROOT, 'results-m2.json');
const DEFECTS_FILE = path.join(ACCEPTANCE_ROOT, 'defects-m2.jsonl');

function flowDirs(flowId) {
  const shots = ensureDir(path.join(ACCEPTANCE_ROOT, 'screenshots', 'm2', flowId));
  const logs = ensureDir(path.join(ACCEPTANCE_ROOT, 'logs', flowId));
  const flow = ensureDir(path.join(ACCEPTANCE_ROOT, 'flows', flowId));
  return { shots, logs, flow };
}

/** Read-modify-write the aggregate results-m2.json. */
function recordFlowResult(flowId, entry) {
  ensureDir(ACCEPTANCE_ROOT);
  let all = {};
  if (fs.existsSync(RESULTS_FILE)) {
    try { all = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch (_e) { all = {}; }
  }
  all[flowId] = { ...entry, recordedAt: nowIso() };
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(all, null, 2));
  return RESULTS_FILE;
}

let defectCounter = null;
function nextDefectId() {
  if (defectCounter === null) {
    defectCounter = 200;
    if (fs.existsSync(DEFECTS_FILE)) {
      for (const line of fs.readFileSync(DEFECTS_FILE, 'utf8').split(/\r?\n/)) {
        const m = line.match(/KAIRO-RC-WEB-(\d+)/);
        if (m) defectCounter = Math.max(defectCounter, parseInt(m[1], 10));
      }
    }
  }
  defectCounter += 1;
  return `KAIRO-RC-WEB-${defectCounter}`;
}

function appendDefect(defect) {
  ensureDir(ACCEPTANCE_ROOT);
  const entry = { id: nextDefectId(), status: 'OPEN', filedAt: nowIso(), source: 'M2', ...defect };
  fs.appendFileSync(DEFECTS_FILE, JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * Mission rule: agent must run on port 18080 (frontend hard default).
 * If the port is busy, only kairo-runtime processes from prior QA runs may be
 * killed; anything else -> throw (STOP and report).
 */
function ensurePort18080() {
  let pids = '';
  try {
    pids = execFileSync('lsof', ['-ti', 'tcp:18080'], { encoding: 'utf8' }).trim();
  } catch (_e) {
    return; // free
  }
  if (!pids) return;
  for (const pid of pids.split(/\s+/)) {
    let cmd = '';
    try { cmd = execFileSync('ps', ['-p', pid, '-o', 'comm='], { encoding: 'utf8' }).trim(); } catch (_e) { /* gone */ }
    if (/kairo-runtime/.test(cmd)) {
      process.kill(parseInt(pid, 10), 'SIGKILL');
      console.log(`[m2] killed leftover kairo-runtime pid ${pid} on :18080`);
    } else {
      throw new Error(`Port 18080 owned by non-QA process pid=${pid} cmd=${cmd} — STOP and report`);
    }
  }
}

/**
 * Console/page-error gate. whitelist: array of (logEntry) => boolean predicates,
 * each justified in `whitelistNotes`. Returns { ok, errors }.
 */
function consoleGate(logs, whitelist = []) {
  const errors = logs.filter(l =>
    (l.type === 'pageerror' || l.type === 'error' || l.type === 'requestfailed' || /^http/.test(l.type)) &&
    !whitelist.some(fn => fn(l)));
  return { ok: errors.length === 0, errors };
}

/** Predicates for known-benign noise, each with written justification. */
const WL = {
  // Theia probes optional backends on load; 404 for missing optional resources
  // is expected product behavior in a minimal QA workspace.
  favicon: l => /^http/.test(l.type) && /favicon\.ico/.test(l.url || ''),
  // WS reconnect noise to the agent during a DELIBERATE kill window.
  agentKillWs: l => l.type === 'error' && /WebSocket/.test(l.text) && /18080/.test(l.text) && /ERR_CONNECTION_REFUSED/.test(l.text),
};

/**
 * Drive Theia's server-side FileDialog widget (UI-only, no native picker):
 * the dialog opens at the Theia workspace root; we click "up" `upCount`
 * times, select the folder row named `folderName`, and confirm with the
 * dialog's Open button.
 */
async function selectFolderInTheiaFileDialog(page, folderName, { upCount = 1, timeoutMs = 30000 } = {}) {
  const dialog = page.locator('#theia-dialog-shell .dialogBlock').last();
  await dialog.waitFor({ state: 'visible', timeout: timeoutMs });
  for (let i = 0; i < upCount; i++) {
    await dialog.locator('.theia-NavigationUp').click();
    await new Promise(r => setTimeout(r, 800));
  }
  const row = dialog.locator('.theia-TreeNode', { hasText: folderName }).first();
  await row.waitFor({ state: 'visible', timeout: timeoutMs });
  await row.click();
  await new Promise(r => setTimeout(r, 500));
  const openBtn = dialog.locator('.dialogControl button', { hasText: /^Open$/ }).first();
  await openBtn.waitFor({ state: 'visible', timeout: timeoutMs });
  await openBtn.click();
  await page.locator('#theia-dialog-shell .dialogBlock').waitFor({ state: 'hidden', timeout: timeoutMs });
}

module.exports = {
  ACCEPTANCE_ROOT,
  RESULTS_FILE,
  DEFECTS_FILE,
  flowDirs,
  recordFlowResult,
  appendDefect,
  ensurePort18080,
  consoleGate,
  selectFolderInTheiaFileDialog,
  WL,
};
