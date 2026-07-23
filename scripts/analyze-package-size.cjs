#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 30_000;

// --- Helpers ---

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getDirSize(dir) {
  try {
    const result = spawnSync('du', ['-sk', dir], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    const match = (result.stdout || '').match(/^(\d+)/);
    return match ? parseInt(match[1]) * 1024 : 0;
  } catch {
    return 0;
  }
}

function getFileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

// --- Main ---

function main() {
  const startTime = Date.now();
  const overallTimer = setTimeout(() => {
    console.error('[analyze-size] TIMEOUT: exceeded 30s');
    process.exit(124);
  }, TIMEOUT_MS);

  const report = {
    generatedAt: new Date().toISOString(),
    packages: [],
    top10: [],
    total: {},
    largeFiles: [],
    summary: {}
  };

  // --- TypeScript packages ---
  const packagesDir = path.join(ROOT, 'packages');
  if (fs.existsSync(packagesDir)) {
    const entries = fs.readdirSync(packagesDir);
    for (const entry of entries) {
      const pkgPath = path.join(packagesDir, entry);
      if (!fs.statSync(pkgPath).isDirectory()) continue;

      const pkgJsonPath = path.join(pkgPath, 'package.json');
      let pkgName = entry;
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        pkgName = pkgJson.name || entry;
      } catch {}

      const size = getDirSize(pkgPath);
      const srcDir = path.join(pkgPath, 'src');
      const srcSize = fs.existsSync(srcDir) ? getDirSize(srcDir) : 0;
      const libDir = path.join(pkgPath, 'lib');
      const libSize = fs.existsSync(libDir) ? getDirSize(libDir) : 0;

      // Count source files in package
      let srcFiles = 0;
      let testFiles = 0;
      try {
        const srcResult = spawnSync('find', [pkgPath, '-type', 'f', '-name', '*.ts', '-o', '-name', '*.tsx', '-o', '-name', '*.cjs', '-o', '-name', '*.mjs'], { encoding: 'utf8', timeout: 10_000 });
        srcFiles = (srcResult.stdout || '').split('\n').filter(Boolean).length;
        const testResult = spawnSync('find', [pkgPath, '-type', 'f', '-name', '*.test.cjs', '-o', '-name', '*.test.ts', '-o', '-name', '*.test.tsx'], { encoding: 'utf8', timeout: 10_000 });
        testFiles = (testResult.stdout || '').split('\n').filter(Boolean).length;
      } catch {}

      report.packages.push({
        name: entry,
        npmName: pkgName,
        totalBytes: size,
        totalFormatted: formatSize(size),
        srcBytes: srcSize,
        srcFormatted: formatSize(srcSize),
        libBytes: libSize,
        libFormatted: formatSize(libSize),
        srcFiles,
        testFiles
      });
    }
  }

  // --- Go packages ---
  const goPackagesDir = path.join(ROOT, 'runtime-agent', 'internal');
  const goPackages = [];
  if (fs.existsSync(goPackagesDir)) {
    const entries = fs.readdirSync(goPackagesDir);
    for (const entry of entries) {
      const pkgPath = path.join(goPackagesDir, entry);
      if (!fs.statSync(pkgPath).isDirectory()) continue;

      const size = getDirSize(pkgPath);
      let goFiles = 0;
      let goTestFiles = 0;
      try {
        const goResult = spawnSync('find', [pkgPath, '-name', '*.go', '-not', '-name', '*_test.go'], { encoding: 'utf8', timeout: 10_000 });
        goFiles = (goResult.stdout || '').split('\n').filter(Boolean).length;
        const testResult = spawnSync('find', [pkgPath, '-name', '*_test.go'], { encoding: 'utf8', timeout: 10_000 });
        goTestFiles = (testResult.stdout || '').split('\n').filter(Boolean).length;
      } catch {}

      goPackages.push({
        name: `internal/${entry}`,
        totalBytes: size,
        totalFormatted: formatSize(size),
        goFiles,
        testFiles: goTestFiles
      });
    }
  }

  // Also include cmd and test directories
  for (const subDir of ['cmd', 'test']) {
    const subPath = path.join(ROOT, 'runtime-agent', subDir);
    if (fs.existsSync(subPath)) {
      const size = getDirSize(subPath);
      goPackages.push({
        name: subDir,
        totalBytes: size,
        totalFormatted: formatSize(size),
        goFiles: 0,
        testFiles: 0
      });
    }
  }

  report.goPackages = goPackages;

  // --- Sort and top 10 ---
  const allPackages = [
    ...report.packages.map(p => ({ name: p.name, type: 'ts', bytes: p.totalBytes, formatted: p.totalFormatted })),
    ...goPackages.map(p => ({ name: p.name, type: 'go', bytes: p.totalBytes, formatted: p.totalFormatted }))
  ];
  allPackages.sort((a, b) => b.bytes - a.bytes);
  report.top10 = allPackages.slice(0, 10);

  // --- Totals ---
  const tsTotal = report.packages.reduce((s, p) => s + p.totalBytes, 0);
  const goTotal = goPackages.reduce((s, p) => s + p.totalBytes, 0);
  const nodeModulesSize = getDirSize(path.join(ROOT, 'node_modules'));
  const goBinarySize = getFileSize(path.join(ROOT, 'runtime-agent', 'bin', 'kairo-runtime'));

  report.total = {
    tsPackagesBytes: tsTotal,
    tsPackagesFormatted: formatSize(tsTotal),
    tsPackageCount: report.packages.length,
    goPackagesBytes: goTotal,
    goPackagesFormatted: formatSize(goTotal),
    goPackageCount: goPackages.length,
    nodeModulesBytes: nodeModulesSize,
    nodeModulesFormatted: formatSize(nodeModulesSize),
    goBinaryBytes: goBinarySize,
    goBinaryFormatted: formatSize(goBinarySize),
    grandTotalBytes: tsTotal + goTotal + nodeModulesSize + goBinarySize,
    grandTotalFormatted: formatSize(tsTotal + goTotal + nodeModulesSize + goBinarySize)
  };

  // --- Large files check ---
  const LARGE_FILE_THRESHOLD = 500 * 1024; // 500KB
  try {
    const findResult = spawnSync('find', [
      ROOT, '-type', 'f',
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.git/*',
      '-not', '-path', '*/lib/*',
      '-size', `+${Math.floor(LARGE_FILE_THRESHOLD / 1024)}k`,
      '-exec', 'ls', '-lh', '{}', ';'
    ], { encoding: 'utf8', timeout: 15_000 });
    const lines = (findResult.stdout || '').split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const sizeStr = parts[4];
        const filePath = parts.slice(8).join(' ');
        // Parse size like "1.2M" or "500K"
        let bytes = 0;
        if (sizeStr.endsWith('G')) bytes = parseFloat(sizeStr) * 1024 * 1024 * 1024;
        else if (sizeStr.endsWith('M')) bytes = parseFloat(sizeStr) * 1024 * 1024;
        else if (sizeStr.endsWith('K')) bytes = parseFloat(sizeStr) * 1024;
        else bytes = parseInt(sizeStr);

        if (bytes >= LARGE_FILE_THRESHOLD) {
          report.largeFiles.push({
            path: filePath.replace(ROOT + '/', ''),
            size: sizeStr,
            bytes: Math.round(bytes)
          });
        }
      }
    }
    report.largeFiles.sort((a, b) => b.bytes - a.bytes);
  } catch {}

  // --- Summary ---
  report.summary = {
    totalPackages: report.packages.length + goPackages.length,
    largestPackage: report.top10.length > 0 ? report.top10[0] : null,
    hasLargeFiles: report.largeFiles.length > 0,
    largeFileCount: report.largeFiles.length,
    elapsedMs: Date.now() - startTime
  };

  clearTimeout(overallTimer);

  const serialized = JSON.stringify(report, null, 2);
  console.log(serialized);

  // Summary to stderr
  console.error(`\n[analyze-size] Summary:`);
  console.error(`  TS packages: ${report.packages.length} (${formatSize(tsTotal)})`);
  console.error(`  Go packages: ${goPackages.length} (${formatSize(goTotal)})`);
  console.error(`  node_modules: ${formatSize(nodeModulesSize)}`);
  console.error(`  Go binary: ${formatSize(goBinarySize)}`);
  console.error(`  Grand total: ${formatSize(tsTotal + goTotal + nodeModulesSize + goBinarySize)}`);
  console.error(`  Large files (>500KB): ${report.largeFiles.length}`);
  console.error(`  Top 3 largest packages:`);
  for (const pkg of report.top10.slice(0, 3)) {
    console.error(`    ${pkg.name} [${pkg.type}]: ${pkg.formatted}`);
  }
}

try {
  main();
} catch (err) {
  console.error('[analyze-size] FATAL:', err);
  process.exit(2);
}