#!/usr/bin/env node
'use strict';

/**
 * Kairo IDE — Coverage Threshold Check
 *
 * Reads Go coverage text report and TypeScript coverage JSON,
 * verifies thresholds are met, and exits with non-zero if any
 * threshold is missed.
 *
 * Usage:
 *   node scripts/ci/coverage-check.cjs --go-coverage coverage/go/coverage.txt --go-threshold 60 --ts-threshold 50
 *   node scripts/ci/coverage-check.cjs --ts-coverage coverage/typescript/coverage.json --ts-threshold 50
 */

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const goCoveragePath = getArg('--go-coverage');
const tsCoveragePath = getArg('--ts-coverage');
const goThreshold = parseFloat(getArg('--go-threshold') || '60');
const tsThreshold = parseFloat(getArg('--ts-threshold') || '50');

// ---------------------------------------------------------------------------
// Go coverage parser
// ---------------------------------------------------------------------------
function parseGoCoverage(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.log('[coverage-check] Go coverage file not found:', filePath);
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const totalLine = content.split('\n').find(l => l.startsWith('total:'));
  if (!totalLine) {
    console.log('[coverage-check] No "total:" line in Go coverage report');
    return null;
  }
  const match = totalLine.match(/([\d.]+)%/);
  if (!match) {
    console.log('[coverage-check] Could not parse coverage percentage from:', totalLine.trim());
    return null;
  }
  return parseFloat(match[1]);
}

// ---------------------------------------------------------------------------
// TypeScript coverage parser
// ---------------------------------------------------------------------------
function parseTSCoverage(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.log('[coverage-check] TS coverage file not found:', filePath);
    return null;
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return data.estimatedCoverage || data.coverage || null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const results = [];
let hasFailure = false;

// Check Go coverage
if (goCoveragePath) {
  const goCov = parseGoCoverage(goCoveragePath);
  if (goCov !== null) {
    const passed = goCov >= goThreshold;
    results.push({ component: 'Go', coverage: goCov, threshold: goThreshold, passed });
    console.log(`[coverage-check] Go coverage: ${goCov}% (threshold: ${goThreshold}%) — ${passed ? 'PASSED' : 'FAILED'}`);
    if (!passed) hasFailure = true;
  } else {
    results.push({ component: 'Go', coverage: null, threshold: goThreshold, passed: false, skipped: true });
    console.log(`[coverage-check] Go coverage: NOT AVAILABLE — SKIPPED`);
  }
}

// Check TypeScript coverage
if (tsCoveragePath) {
  const tsCov = parseTSCoverage(tsCoveragePath);
  if (tsCov !== null) {
    const passed = tsCov >= tsThreshold;
    results.push({ component: 'TypeScript', coverage: tsCov, threshold: tsThreshold, passed });
    console.log(`[coverage-check] TS coverage: ${tsCov}% (threshold: ${tsThreshold}%) — ${passed ? 'PASSED' : 'FAILED'}`);
    if (!passed) hasFailure = true;
  } else {
    results.push({ component: 'TypeScript', coverage: null, threshold: tsThreshold, passed: false, skipped: true });
    console.log(`[coverage-check] TS coverage: NOT AVAILABLE — SKIPPED`);
  }
}

// If no coverage checks were performed, search for auto-detected paths
if (results.length === 0) {
  const ROOT = path.resolve(__dirname, '..', '..');
  const autoGoPath = path.join(ROOT, 'coverage', 'go', 'coverage.txt');
  const autoTSPath = path.join(ROOT, 'coverage', 'typescript', 'coverage.json');

  if (fs.existsSync(autoGoPath)) {
    const goCov = parseGoCoverage(autoGoPath);
    if (goCov !== null) {
      const passed = goCov >= goThreshold;
      results.push({ component: 'Go', coverage: goCov, threshold: goThreshold, passed });
      console.log(`[coverage-check] Go coverage (auto): ${goCov}% (threshold: ${goThreshold}%) — ${passed ? 'PASSED' : 'FAILED'}`);
      if (!passed) hasFailure = true;
    }
  }

  if (fs.existsSync(autoTSPath)) {
    const tsCov = parseTSCoverage(autoTSPath);
    if (tsCov !== null) {
      const passed = tsCov >= tsThreshold;
      results.push({ component: 'TypeScript', coverage: tsCov, threshold: tsThreshold, passed });
      console.log(`[coverage-check] TS coverage (auto): ${tsCov}% (threshold: ${tsThreshold}%) — ${passed ? 'PASSED' : 'FAILED'}`);
      if (!passed) hasFailure = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log('=== Coverage Check Summary ===');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => r.passed === false && !r.skipped).length;
const skipped = results.filter(r => r.skipped).length;
console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`);

if (hasFailure) {
  console.log('RESULT: FAILED — coverage thresholds not met');
  process.exit(1);
}

console.log('RESULT: PASSED');
process.exit(0);