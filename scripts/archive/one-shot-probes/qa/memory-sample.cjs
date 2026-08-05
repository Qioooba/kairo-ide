/**
 * Sample RSS for Kairo / java / kairo-runtime processes (OPT-003).
 *   node scripts/test/qa/memory-sample.cjs [label]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { repoRoot, ensureDir } = require('./_helpers.cjs');

const label = process.argv[2] || new Date().toISOString();
const outDir = path.join(repoRoot, 'artifacts', 'qa', 'metrics');
ensureDir(outDir);
const outFile = path.join(outDir, 'memory-latest.txt');

function sampleWindows() {
  const script = [
    "Get-Process -ErrorAction SilentlyContinue |",
    "  Where-Object { $_.ProcessName -match 'Kairo|java|kairo-runtime|electron' } |",
    "  Select-Object ProcessName, Id, @{n='RSS_MB';e={[math]::Round($_.WorkingSet64/1MB,1)}} |",
    "  Sort-Object RSS_MB -Descending |",
    "  Format-Table -AutoSize | Out-String -Width 200",
  ].join(' ');
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: 20000, windowsHide: true },
  );
  if (r.error) return `error: ${r.error.message}\n`;
  return (r.stdout || '') + (r.stderr || '');
}

const body =
  `# memory-sample ${label}\n` +
  `# platform=${process.platform} time=${new Date().toISOString()}\n` +
  (process.platform === 'win32' ? sampleWindows() : 'unsupported platform\n');

fs.writeFileSync(outFile, body, 'utf8');
fs.writeFileSync(path.join(outDir, `memory-${Date.now()}.txt`), body, 'utf8');
console.log(`[memory-sample] wrote ${outFile}`);
console.log(body);
