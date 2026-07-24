#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 120_000;
const isWindows = process.platform === 'win32';

// --- CLI args ---
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] || '') : undefined;
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) {
  console.error('[perf-benchmark] ERROR: --output requires a path');
  process.exit(2);
}

const compareIndex = process.argv.indexOf('--compare');
const comparePath = compareIndex >= 0 ? process.argv[compareIndex + 1] : path.join(ROOT, 'baseline.json');

// --- Helpers ---

function run(command, args, cwd = ROOT, timeout = TIMEOUT_MS) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  const elapsed = Date.now() - started;
  return {
    ok: result.status === 0,
    exitCode: result.status,
    elapsedMs: elapsed,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// --- Tests ---

function measureSupplyChainTests() {
  console.error('[perf] supply-chain tests...');
  const result = run(process.execPath, ['--test', 'scripts/supply-chain.test.cjs']);
  const match = result.stdout.match(/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);
  return {
    total: match ? parseInt(match[1]) : 0,
    pass: match ? parseInt(match[2]) : 0,
    fail: match ? parseInt(match[3]) : 0,
    elapsedMs: result.elapsedMs,
    ok: result.ok && (match ? parseInt(match[3]) === 0 : false)
  };
}

function measureGoTests() {
  console.error('[perf] go tests...');
  const result = run('go', ['test', '-count=1', '-timeout', '120s', '-v', './...'], path.join(ROOT, 'runtime-agent'), 120_000);
  const packages = [];
  const lines = result.stdout.split('\n');
  for (const line of lines) {
    let pkgMatch = line.match(/^(--- (PASS|FAIL):\s+(\S+))/);
    if (pkgMatch) {
      // Individual test case
      continue;
    }
    pkgMatch = line.match(/^(ok|FAIL)\s+(\S+)\s+([\d.]+)s/);
    if (pkgMatch) {
      packages.push({
        name: pkgMatch[2].replace('github.com/Qioooba/kairo-ide/runtime-agent/', ''),
        ok: pkgMatch[1] === 'ok',
        elapsedMs: Math.round(parseFloat(pkgMatch[3]) * 1000)
      });
    }
    const noTestMatch = line.match(/^\?\s+(\S+)\s+\[no test files\]/);
    if (noTestMatch) {
      packages.push({
        name: noTestMatch[1].replace('github.com/Qioooba/kairo-ide/runtime-agent/', ''),
        ok: true,
        elapsedMs: 0,
        noTests: true
      });
    }
  }
  const passed = packages.filter(p => p.ok).length;
  const failed = packages.filter(p => !p.ok && !p.noTests).length;
  const totalElapsed = packages.reduce((s, p) => s + p.elapsedMs, 0);
  return {
    packagesTotal: packages.length,
    packagesPass: passed,
    packagesFail: failed,
    totalElapsedMs: totalElapsed,
    ok: failed === 0,
    packages
  };
}

function measureFrontendTests() {
  console.error('[perf] frontend tests...');
  // Run tests but parse output for package-level results
  const result = run('pnpm', ['test'], ROOT, 120_000);
  const packages = [];
  const lines = result.stdout.split('\n');
  const pkgTestMap = new Map();

  for (const line of lines) {
    const pkgMatch = line.match(/^packages\/([^/]+)\s+test:\s+ℹ\s+tests\s+(\d+)/);
    if (pkgMatch) {
      const name = pkgMatch[1];
      if (!pkgTestMap.has(name)) pkgTestMap.set(name, {});
      pkgTestMap.get(name).total = parseInt(pkgMatch[2]);
    }
    const passMatch = line.match(/^packages\/([^/]+)\s+test:\s+ℹ\s+pass\s+(\d+)/);
    if (passMatch) {
      const name = passMatch[1];
      if (!pkgTestMap.has(name)) pkgTestMap.set(name, {});
      pkgTestMap.get(name).pass = parseInt(passMatch[2]);
    }
    const failMatch = line.match(/^packages\/([^/]+)\s+test:\s+ℹ\s+fail\s+(\d+)/);
    if (failMatch) {
      const name = failMatch[1];
      if (!pkgTestMap.has(name)) pkgTestMap.set(name, {});
      pkgTestMap.get(name).fail = parseInt(failMatch[2]);
    }
    const durationMatch = line.match(/^packages\/([^/]+)\s+test:\s+ℹ\s+duration_ms\s+([\d.]+)/);
    if (durationMatch) {
      const name = durationMatch[1];
      if (!pkgTestMap.has(name)) pkgTestMap.set(name, {});
      pkgTestMap.get(name).elapsedMs = Math.round(parseFloat(durationMatch[2]));
    }
  }

  for (const [name, data] of pkgTestMap) {
    packages.push({
      name,
      total: data.total || 0,
      pass: data.pass || 0,
      fail: data.fail || 0,
      elapsedMs: data.elapsedMs || 0,
      ok: (data.fail || 0) === 0
    });
  }

  const totalPass = packages.reduce((s, p) => s + p.pass, 0);
  const totalFail = packages.reduce((s, p) => s + p.fail, 0);
  const totalTests = totalPass + totalFail;

  return {
    totalTests,
    totalPass,
    totalFail,
    totalElapsedMs: result.elapsedMs,
    packagesWithTests: packages.length,
    ok: totalFail === 0,
    packages
  };
}

// --- Lines of Code ---

function countLines() {
  console.error('[perf] counting lines of code...');

  if (isWindows) {
    // PowerShell fallback for Windows — no WSL/bash required
    const psCount = (includes, basePaths) => {
      const r = run('powershell', ['-NoProfile', '-Command',
        `(Get-ChildItem -Path ${basePaths} -Recurse -File -Include ${includes} -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules|\\\\\\\\.git\\\\' } | Measure-Object -Line).Lines`
      ], ROOT, 30_000);
      const m = r.stdout.match(/(\d+)/);
      return m ? parseInt(m[1]) : 0;
    };
    const psFileCount = (includes, basePaths) => {
      const r = run('powershell', ['-NoProfile', '-Command',
        `(Get-ChildItem -Path ${basePaths} -Recurse -File -Include ${includes} -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules|\\\\\\\\.git\\\\' } | Measure-Object).Count`
      ], ROOT, 10_000);
      const m = r.stdout.match(/(\d+)/);
      return m ? parseInt(m[1]) : 0;
    };

    const totalLines = psCount("'*.ts','*.tsx','*.go'", "packages,runtime-agent");
    const goLines = psCount("'*.go'", "runtime-agent");
    const tsLines = psCount("'*.ts','*.tsx'", "packages");
    const testLines = psCount("'*.test.cjs','*.test.ts','*_test.go'", "packages,runtime-agent");
    const goFiles = psFileCount("'*.go'", "runtime-agent");
    const tsFiles = psFileCount("'*.ts','*.tsx'", "packages");
    const testFiles = psFileCount("'*.test.cjs','*.test.ts','*_test.go'", "packages,runtime-agent");

    return {
      totalLines,
      go: { files: goFiles, lines: goLines },
      typescript: { files: tsFiles, lines: tsLines },
      tests: { files: testFiles, lines: testLines }
    };
  }

  // Unix path: use find + xargs + wc
  const result = run('sh', ['-c', "find packages runtime-agent -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.go' \\) -not -path '*/node_modules/*' -not -path '*/.git/*' | xargs wc -l 2>/dev/null | tail -1"], ROOT, 30_000);
  const totalMatch = result.stdout.match(/(\d+)\s+total/);
  const totalLines = totalMatch ? parseInt(totalMatch[1]) : 0;

  const goResult = run('sh', ['-c', "find runtime-agent -name '*.go' -not -path '*/node_modules/*' | xargs wc -l 2>/dev/null | tail -1"], ROOT, 15_000);
  const goMatch = goResult.stdout.match(/(\d+)\s+total/);
  const goLines = goMatch ? parseInt(goMatch[1]) : 0;

  const tsResult = run('sh', ['-c', "find packages -name '*.ts' -o -name '*.tsx' | grep -v node_modules | xargs wc -l 2>/dev/null | tail -1"], ROOT, 15_000);
  const tsMatch = tsResult.stdout.match(/(\d+)\s+total/);
  const tsLines = tsMatch ? parseInt(tsMatch[1]) : 0;

  const testLinesResult = run('sh', ['-c', "find packages runtime-agent -type f \\( -name '*.test.cjs' -o -name '*.test.ts' -o -name '*_test.go' \\) -not -path '*/node_modules/*' | xargs wc -l 2>/dev/null | tail -1"], ROOT, 15_000);
  const testMatch = testLinesResult.stdout.match(/(\d+)\s+total/);
  const testLines = testMatch ? parseInt(testMatch[1]) : 0;

  const goFileCount = run('sh', ['-c', "find runtime-agent -name '*.go' -not -path '*/node_modules/*' | wc -l"], ROOT, 10_000);
  const tsFileCount = run('sh', ['-c', "find packages -name '*.ts' -o -name '*.tsx' | grep -v node_modules | wc -l"], ROOT, 10_000);
  const testFileCount = run('sh', ['-c', "find packages runtime-agent -type f \\( -name '*.test.cjs' -o -name '*.test.ts' -o -name '*_test.go' \\) -not -path '*/node_modules/*' | wc -l"], ROOT, 10_000);

  return {
    totalLines,
    go: { files: parseInt(goFileCount.stdout) || 0, lines: goLines },
    typescript: { files: parseInt(tsFileCount.stdout) || 0, lines: tsLines },
    tests: { files: parseInt(testFileCount.stdout) || 0, lines: testLines }
  };
}

// --- Bundle Sizes ---

function measureSize(dir) {
  try {
    if (isWindows) {
      // PowerShell fallback for Windows — no WSL/bash required
      const result = run('powershell', ['-NoProfile', '-Command',
        `(Get-ChildItem -Path '${dir}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`
      ], ROOT, 30_000);
      const match = result.stdout.match(/(\d+)/);
      return match ? parseInt(match[1]) : 0;
    }
    const result = run('du', ['-sk', dir], ROOT, 30_000);
    const match = result.stdout.match(/^(\d+)/);
    return match ? parseInt(match[1]) * 1024 : 0;
  } catch {
    return 0;
  }
}

function measureSizes() {
  console.error('[perf] measuring sizes...');

  const nodeModulesSize = measureSize(path.join(ROOT, 'node_modules'));

  let goBinarySize = 0;
  const goBinaryPath = path.join(ROOT, 'runtime-agent', 'bin', 'kairo-runtime');
  try {
    goBinarySize = fs.statSync(goBinaryPath).size;
  } catch {
    // binary may not exist
  }

  // Package-level sizes
  const packagesDir = path.join(ROOT, 'packages');
  const packageSizes = [];
  if (fs.existsSync(packagesDir)) {
    const entries = fs.readdirSync(packagesDir);
    for (const entry of entries) {
      const pkgPath = path.join(packagesDir, entry);
      if (fs.statSync(pkgPath).isDirectory()) {
        const size = measureSize(pkgPath);
        packageSizes.push({ name: entry, bytes: size });
      }
    }
  }
  packageSizes.sort((a, b) => b.bytes - a.bytes);

  // Go package sizes
  const goPackagesDir = path.join(ROOT, 'runtime-agent', 'internal');
  const goPackageSizes = [];
  if (fs.existsSync(goPackagesDir)) {
    const entries = fs.readdirSync(goPackagesDir);
    for (const entry of entries) {
      const pkgPath = path.join(goPackagesDir, entry);
      if (fs.statSync(pkgPath).isDirectory()) {
        const size = measureSize(pkgPath);
        goPackageSizes.push({ name: `internal/${entry}`, bytes: size });
      }
    }
  }
  goPackageSizes.sort((a, b) => b.bytes - a.bytes);

  return {
    nodeModulesBytes: nodeModulesSize,
    nodeModulesFormatted: formatSize(nodeModulesSize),
    goBinaryBytes: goBinarySize,
    goBinaryFormatted: formatSize(goBinarySize),
    tsPackages: packageSizes,
    goPackages: goPackageSizes
  };
}

// --- Comparison ---

function loadBaseline(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    console.error(`[perf] WARNING: could not load baseline from ${filePath}`);
  }
  return null;
}

function compareMetrics(current, baseline) {
  if (!baseline) return null;

  const comparisons = [];
  const keys = [
    { key: 'goLines', label: 'Go Lines of Code', path: 'sizes.goLines', unit: 'lines' },
    { key: 'tsLines', label: 'TS Lines of Code', path: 'sizes.tsLines', unit: 'lines' },
    { key: 'totalLines', label: 'Total Lines of Code', path: 'sizes.totalLines', unit: 'lines' },
    { key: 'nodeModulesGB', label: 'node_modules Size', path: 'sizes.nodeModulesGB', unit: 'GB' },
    { key: 'goBinaryMB', label: 'Go Binary Size', path: 'sizes.goBinaryMB', unit: 'MB' },
    { key: 'supplyChainElapsed', label: 'Supply Chain Test Time', path: 'tests.supplyChain.elapsedMs', unit: 'ms' },
    { key: 'goTestElapsed', label: 'Go Test Time', path: 'tests.go.totalElapsedMs', unit: 'ms' },
    { key: 'frontendTestElapsed', label: 'Frontend Test Time', path: 'tests.frontend.totalElapsedMs', unit: 'ms' },
  ];

  for (const { key, label, path: bp, unit } of keys) {
    const prev = getNestedValue(baseline, bp);
    const curr = getNestedValue(current, bp);
    if (prev == null || curr == null || prev === 0) continue;

    const pctChange = ((curr - prev) / prev) * 100;
    const isRegression = Math.abs(pctChange) > 10;

    comparisons.push({
      metric: key,
      label,
      previous: prev,
      current: curr,
      pctChange: Math.round(pctChange * 100) / 100,
      unit,
      regression: isRegression
    });
  }

  return comparisons;
}

function getNestedValue(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return null;
    current = current[part];
  }
  return current;
}

// --- Main ---

async function main() {
  const startTime = Date.now();
  const overallTimer = setTimeout(() => {
    console.error('[perf] TIMEOUT: benchmark exceeded 120s');
    process.exit(124);
  }, TIMEOUT_MS);

  const report = {
    generatedAt: new Date().toISOString(),
    platform: {
      os: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      hostname: os.hostname()
    },
    toolchain: {
      node: process.version,
      pnpm: (run('pnpm', ['--version']).stdout || ''),
      go: (run('go', ['version']).stdout || '')
    }
  };

  // 1. Supply chain tests
  report.supplyChain = measureSupplyChainTests();

  // 2. Go tests
  report.goTests = measureGoTests();

  // 3. Frontend tests
  report.frontendTests = measureFrontendTests();

  // 4. Lines of code
  report.linesOfCode = countLines();

  // 5. Sizes
  report.sizes = measureSizes();

  // 6. Total test stats
  const totalTests = (report.supplyChain.total || 0) + (report.goTests.packagesPass || 0) + (report.frontendTests.totalTests || 0);
  const totalPass = (report.supplyChain.pass || 0) + (report.goTests.packagesPass || 0) + (report.frontendTests.totalPass || 0);
  const totalFail = (report.supplyChain.fail || 0) + (report.goTests.packagesFail || 0) + (report.frontendTests.totalFail || 0);

  report.summary = {
    totalTests,
    totalPass,
    totalFail,
    passRate: totalTests > 0 ? Math.round((totalPass / totalTests) * 10000) / 100 : 0,
    totalElapsedMs: Date.now() - startTime
  };

  // 7. Compare against baseline
  const baseline = loadBaseline(comparePath);
  if (baseline) {
    console.error(`[perf] comparing against baseline from ${baseline.generatedAt}`);
    report.comparison = compareMetrics(report, baseline);
    if (report.comparison) {
      const regressions = report.comparison.filter(c => c.regression);
      if (regressions.length > 0) {
        console.error('[perf] REGRESSIONS DETECTED (>10%):');
        for (const r of regressions) {
          console.error(`  ${r.label}: ${r.previous}${r.unit} → ${r.current}${r.unit} (${r.pctChange > 0 ? '+' : ''}${r.pctChange}%)`);
        }
      } else {
        console.error('[perf] No regressions >10% detected');
      }
    }
  } else {
    console.error('[perf] No baseline found for comparison');
  }

  clearTimeout(overallTimer);

  const serialized = JSON.stringify(report, null, 2);
  console.log(serialized);

  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${serialized}\n`);
    console.error(`[perf] report written to ${output}`);
  }
}

main().catch((err) => {
  console.error('[perf] FATAL:', err);
  process.exit(2);
});