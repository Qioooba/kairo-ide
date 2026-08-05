/**
 * Build report.json from run.log when a train hung before writeReport.
 * Usage: node scripts/test/qa/finalize-from-log.cjs --agent a5 [--force]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--')) return argv[i + 1];
  if (i >= 0 && (argv[i + 1] == null || String(argv[i + 1]).startsWith('--'))) return true;
  return def;
}

const meta = {
  a3: {
    agent: 'A3', instance: 'B1',
    expected: ['3.1','3.2','3.3','3.4','3.5','3.6','3.7','3.8','3.9','3.10','3.11','3.12','3.13','3.14','3.15','3.16','3.17'],
  },
  a4: {
    agent: 'A4', instance: 'B2',
    expected: ['4.1','4.2','4.3','4.4','4.5','4.6','4.7','4.8','4.9','4.10','4.11'],
  },
  a5: {
    agent: 'A5', instance: 'B3',
    expected: ['6.1','6.2','6.3','6.4','6.5','6.6','6.7','7.1','7.2','7.3','7.4','7.5','7.6'],
  },
  a6: {
    agent: 'A6', instance: 'B4',
    expected: ['8.1','8.2','8.3','8.4','8.5','8.6','8.7'],
  },
  a7: {
    agent: 'A7', instance: 'B5',
    expected: ['9.1','9.2','9.3','9.4','9.5','9.6','9.7','9.8','9.9'],
  },
};

const id = String(arg('agent', '')).toLowerCase();
if (!meta[id]) {
  console.error('Usage: --agent a3|a4|a5|a6|a7 [--force]');
  process.exit(1);
}

const outDir = path.join(repoRoot, 'artifacts', 'qa', id);
const logPath = path.join(outDir, 'run.log');
const reportPath = path.join(outDir, 'report.json');
if (fs.existsSync(reportPath) && !arg('force', false)) {
  console.log(`skip ${id}: report exists (pass --force)`);
  process.exit(0);
}

function readLogText(logPath) {
  const buf = fs.readFileSync(logPath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // rare BE — swap
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }
  return buf.toString('utf8');
}

const text = readLogText(logPath);
// Status + id; detail separator may be em-dash, ?, replacement char, or " - "
const re = /\[(\d{2}:\d{2}:\d{2})\]\s+(PASS|FAIL|SKIP|BLOCKED)\s+(\d+\.\d+)\s+(.+)$/gm;
const cases = [];
const seen = new Set();
let m;
while ((m = re.exec(text))) {
  const statusMap = { PASS: 'pass', FAIL: 'fail', SKIP: 'skip', BLOCKED: 'blocked' };
  const status = statusMap[m[2]];
  const caseId = m[3];
  if (seen.has(caseId)) continue;
  seen.add(caseId);
  let rest = (m[4] || '').trim();
  // Strip PowerShell/tee mojibake separators: —, –, -, ?, �?
  let name = rest;
  let detail = '';
  const sep = rest.match(/\s+(?:\u2014|\u2013|\uFFFD\?|\?|—|–|-)\s+/);
  if (sep && sep.index != null) {
    name = rest.slice(0, sep.index).trim();
    detail = rest.slice(sep.index + sep[0].length).trim();
  }
  const shotsDir = path.join(outDir, 'shots');
  let shotGuess = [];
  if (fs.existsSync(shotsDir)) {
    const prefix = caseId.replace('.', '-');
    shotGuess = fs.readdirSync(shotsDir).filter((f) => f.startsWith(prefix)).slice(0, 3);
  }
  cases.push({
    id: caseId,
    name: name || caseId,
    status,
    durationMs: 0,
    detail,
    shots: shotGuess,
  });
}

for (const eid of meta[id].expected) {
  if (seen.has(eid)) continue;
  cases.push({
    id: eid,
    name: `Case ${eid} (not reached — train hung)`,
    status: 'skip',
    durationMs: 0,
    detail: 'Train hung before this case; finalized from run.log',
    shots: [],
  });
}
cases.sort((a, b) => {
  const [a1, a2] = a.id.split('.').map(Number);
  const [b1, b2] = b.id.split('.').map(Number);
  return a1 - b1 || a2 - b2;
});

const report = {
  agent: meta[id].agent,
  instance: meta[id].instance,
  round: 1,
  startedAt: null,
  finishedAt: new Date().toISOString(),
  cases,
  metrics: {},
  summary: {
    pass: cases.filter((c) => c.status === 'pass').length,
    fail: cases.filter((c) => c.status === 'fail').length,
    blocked: cases.filter((c) => c.status === 'blocked').length,
    skip: cases.filter((c) => c.status === 'skip').length,
  },
  note: 'Finalized from run.log after train hang',
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const summary = [
  `${report.agent} / ${report.instance} (finalized)`,
  `pass=${report.summary.pass} fail=${report.summary.fail} blocked=${report.summary.blocked} skip=${report.summary.skip}`,
  `parsed=${seen.size} expected=${meta[id].expected.length}`,
  `report: ${reportPath}`,
].join('\n');
fs.writeFileSync(path.join(outDir, 'summary.txt'), summary + '\n');
console.log(summary);
