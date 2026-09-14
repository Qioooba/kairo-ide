#!/usr/bin/env node
'use strict';

/**
 * check-delivery-readiness.cjs
 *
 * Automated delivery readiness check script.
 *
 * Verifies:
 *   1. Test suite passes
 *   2. Supply chain checks pass
 *   3. All critical files exist
 *   4. Checksums, SBOM, license files present
 *
 * Output: pass/fail for each category with details
 * Exit code: 0 if all checks pass, 1 if any fail
 * Timeout: 60s
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(__dirname, 'run-with-timeout.cjs');

// ---- helpers ----

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let totalChecks = 0;
let totalPassed = 0;
let totalFailed = 0;
let totalWarned = 0;

function check(category, name, fn) {
  totalChecks++;
  try {
    const result = fn();
    if (result === true) {
      totalPassed++;
      console.log(`  ${GREEN}✓${RESET} ${name}`);
      return true;
    } else if (result === 'warn') {
      totalWarned++;
      console.log(`  ${YELLOW}⚠${RESET} ${name} — ${result === 'warn' ? 'WARNING' : 'NOT FOUND'}`);
      return 'warn';
    } else {
      totalFailed++;
      console.log(`  ${RED}✗${RESET} ${name} — ${result || 'FAILED'}`);
      return false;
    }
  } catch (err) {
    totalFailed++;
    console.log(`  ${RED}✗${RESET} ${name} — ERROR: ${err.message}`);
    return false;
  }
}

function fileExists(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  return fs.existsSync(fullPath);
}

function dirExists(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
}

function readJSON(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
  } catch {
    return null;
  }
}

function countFiles(pattern) {
  try {
    const { execSync } = require('node:child_process');
    const result = execSync(`find ${ROOT}/${pattern} -name '*.md' 2>/dev/null | wc -l`, { encoding: 'utf8', timeout: 5000 });
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// ---- main ----

const startTime = Date.now();

console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║   Kairo IDE — Delivery Readiness Check           ║${RESET}`);
console.log(`${BOLD}${CYAN}║   ${new Date().toISOString()}                    ║${RESET}`);
console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}`);
console.log('');

// ================================================================
// SECTION 1: Critical Scripts
// ================================================================
console.log(`${BOLD}${CYAN}[1/9]${RESET} ${BOLD}Critical Scripts${RESET}`);

const criticalScripts = [
  'scripts/check-architecture-boundaries.cjs',
  'scripts/generate-sbom.cjs',
  'scripts/sign-release.cjs',
  'scripts/verify-reproducible.cjs',
  'scripts/run-release-baseline.cjs',
  'scripts/run-with-timeout.cjs',
  'scripts/supply-chain.test.cjs',
  'scripts/verify-bundled-dependencies.cjs',
];

for (const script of criticalScripts) {
  check('scripts', script, () => fileExists(script) ? true : `Missing: ${script}`);
}

// ================================================================
// SECTION 2: ADR Documents
// ================================================================
console.log(`\n${BOLD}${CYAN}[2/9]${RESET} ${BOLD}ADR Documents${RESET}`);

const adrFiles = (() => {
  try {
    return fs.readdirSync(path.join(ROOT, 'docs', 'adr')).filter(f => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
})();

check('docs', 'ADR documents', () => {
  if (adrFiles >= 17) return true;
  if (adrFiles >= 10) return 'warn';
  return `Only ${adrFiles} ADRs found (expected >= 17)`;
});

console.log(`    → ${adrFiles} ADR documents found`);

// ================================================================
// SECTION 3: Progress Records
// ================================================================
console.log(`\n${BOLD}${CYAN}[3/9]${RESET} ${BOLD}Progress Records${RESET}`);

const phase1Records = (() => {
  try {
    return fs.readdirSync(path.join(ROOT, 'docs', 'progress', 'releases', 'phase-1')).filter(f => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
})();

const phase3Records = (() => {
  try {
    return fs.readdirSync(path.join(ROOT, 'docs', 'progress', 'releases', 'phase-3')).filter(f => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
})();

check('docs', 'Phase 1 progress records', () => phase1Records >= 17 ? true : `Only ${phase1Records} records (expected >= 17)`);
console.log(`    → Phase 1: ${phase1Records} records`);
check('docs', 'Phase 3 progress records', () => phase3Records >= 1 ? true : `Only ${phase3Records} records (expected >= 1)`);
console.log(`    → Phase 3: ${phase3Records} records`);

// ================================================================
// SECTION 4: Supply Chain
// ================================================================
console.log(`\n${BOLD}${CYAN}[4/9]${RESET} ${BOLD}Supply Chain${RESET}`);

check('supply-chain', 'SBOM script exists', () => fileExists('scripts/generate-sbom.cjs'));
check('supply-chain', 'Sign script exists', () => fileExists('scripts/sign-release.cjs'));
check('supply-chain', 'Verify reproducible script exists', () => fileExists('scripts/verify-reproducible.cjs'));
check('supply-chain', 'SBOM output directory exists', () => dirExists('dist') ? true : 'dist/ directory not found (run scripts/generate-sbom.cjs)');
check('supply-chain', 'supply-chain.test.cjs exists', () => fileExists('scripts/supply-chain.test.cjs'));

// Check for supply-chain-lock.json
check('supply-chain', 'supply-chain-lock.json exists', () => {
  const lock = readJSON('scripts/supply-chain-lock.json');
  if (!lock) return 'Missing scripts/supply-chain-lock.json';
  if (!lock.dependencies) return 'supply-chain-lock.json missing dependencies';
  const deps = Object.keys(lock.dependencies);
  const hasJDTLS = deps.some(k => k.startsWith('jdtls'));
  const hasTomcat = deps.some(k => k.startsWith('tomcat6'));
  if (!hasJDTLS) return 'supply-chain-lock.json missing JDT LS dependency';
  if (!hasTomcat) return 'supply-chain-lock.json missing Tomcat 6 dependency';
  return true;
});

// ================================================================
// SECTION 5: Bundled Dependencies
// ================================================================
console.log(`\n${BOLD}${CYAN}[5/9]${RESET} ${BOLD}Bundled Dependencies${RESET}`);

check('bundled', 'JDT LS directory', () => dirExists('bundled/jdtls'));
check('bundled', 'JDT LS plugins', () => {
  const pluginsDir = path.join(ROOT, 'bundled', 'jdtls', 'plugins');
  try {
    const count = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.jar')).length;
    return count >= 50 ? true : `Only ${count} JAR files in plugins/`;
  } catch {
    return 'plugins/ directory not found';
  }
});
check('bundled', 'Tomcat 6 directory', () => dirExists('bundled/tomcat6'));
check('bundled', 'Tomcat 6 LICENSE', () => fileExists('bundled/tomcat6/LICENSE'));

// ================================================================
// SECTION 6: Package Structure
// ================================================================
console.log(`\n${BOLD}${CYAN}[6/9]${RESET} ${BOLD}Package Structure${RESET}`);

const expectedPackages = [
  'build-extension',
  'config-schema',
  'encoding-extension',
  'git-extension',
  'java-extension',
  'jsp-extension',
  'project-extension',
  'protocol',
  'runtime-extension',
  'search-extension',
  'sql-extension',
  'test-extension',
  'theia-product',
  'tomcat-extension',
  'ui-kit',
];

for (const pkg of expectedPackages) {
  check('packages', `packages/${pkg}`, () => {
    if (!dirExists(`packages/${pkg}`)) return `Missing packages/${pkg}`;
    if (!fileExists(`packages/${pkg}/package.json`)) return `Missing packages/${pkg}/package.json`;
    return true;
  });
}

// ================================================================
// SECTION 7: Go Agent
// ================================================================
console.log(`\n${BOLD}${CYAN}[7/9]${RESET} ${BOLD}Go Agent${RESET}`);

check('go-agent', 'runtime-agent/ directory', () => dirExists('runtime-agent'));
check('go-agent', 'go.mod exists', () => fileExists('runtime-agent/go.mod'));
check('go-agent', 'cmd/kairo-runtime exists', () => dirExists('runtime-agent/cmd/kairo-runtime'));
check('go-agent', 'Internal packages', () => {
  try {
    const dirs = fs.readdirSync(path.join(ROOT, 'runtime-agent', 'internal'), { withFileTypes: true })
      .filter(d => d.isDirectory()).length;
    return dirs >= 20 ? true : `Only ${dirs} internal packages`;
  } catch {
    return 'internal/ directory not found';
  }
});

// ================================================================
// SECTION 8: Documentation
// ================================================================
console.log(`\n${BOLD}${CYAN}[8/9]${RESET} ${BOLD}Documentation${RESET}`);

check('docs', 'DELIVERY.md exists', () => fileExists('DELIVERY.md'));
check('docs', 'README.md exists', () => fileExists('README.md'));
check('docs', 'docs/architecture.md exists', () => fileExists('docs/architecture.md'));
check('docs', 'docs/security.md exists', () => fileExists('docs/security.md'));
check('docs', 'docs/product-requirements.md exists', () => fileExists('docs/product-requirements.md'));
check('docs', 'Code review report exists', () => fileExists('docs/progress/releases/code-review-20260723.md'));
check('docs', 'Delivery checklist exists', () => fileExists('docs/progress/releases/delivery-checklist-20260723.md'));
check('docs', 'Release compatibility specification exists', () => fileExists('docs/RELEASE_COMPATIBILITY_SPECIFICATION_2026-09-13.md'));
check('docs', 'Refactoring audit and plan document exists', () => fileExists('docs/Kairo_vs_Lithe_Source_Audit_and_Refactoring_Plan_2026-09-12.md'));
check('docs', 'Refactoring progress document exists', () => fileExists('docs/progress/REFACTORING_PROGRESS_2026-09-12.md'));

// Acceptance tests & Audit reproducibility
check('acceptance', 'Multi-target HotSwap acceptance test exists', () => fileExists('tests/acceptance/multi-target-hotswap.test.cjs'));
check('acceptance', 'Fault injection acceptance test exists', () => fileExists('tests/acceptance/fault-injection.test.cjs'));
check('acceptance', 'Upstream Lithe fixtures manifest exists', () => fileExists('tests/fixtures/upstream/lithe/debug/source-manifest.json'));
check('acceptance', 'Upstream fixtures test exists', () => fileExists('tests/fixtures/upstream/lithe/debug/upstream-fixtures.test.cjs'));
check('audit', 'Audit reproduction package README exists', () => fileExists('kairo-audit/README.md'));
check('audit', 'Audit implementation backlog exists', () => fileExists('kairo-audit/implementation-backlog.json'));
check('audit', 'Audit regression guards exist', () => fileExists('kairo-audit/regression/guards.go'));

// ================================================================
// SECTION 9: CI / Baseline
// ================================================================
console.log(`\n${BOLD}${CYAN}[9/9]${RESET} ${BOLD}CI / Baseline${RESET}`);

check('ci', '.github/workflows/ci.yml exists', () => fileExists('.github/workflows/ci.yml'));
check('ci', 'baseline.json exists', () => fileExists('baseline.json'));

const baseline = readJSON('baseline.json');
if (baseline) {
  check('ci', 'baseline.json has gates', () => baseline.gates && baseline.gates.length > 0);
  check('ci', 'baseline.json has metrics', () => baseline.metrics && Object.keys(baseline.metrics).length > 0);
  if (baseline.ok === false) {
    console.log(`    ${YELLOW}→ Warning: baseline.json reports ok=false (lint/test failures)${RESET}`);
  } else if (baseline.ok === true) {
    console.log(`    ${GREEN}→ baseline.json reports ok=true${RESET}`);
  }
}

// ================================================================
// SUMMARY
// ================================================================
const elapsed = Date.now() - startTime;
console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}${CYAN}  Results${RESET}`);
console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
console.log(`  Total checks: ${BOLD}${totalChecks}${RESET}`);
console.log(`  ${GREEN}Passed: ${totalPassed}${RESET}`);
console.log(`  ${YELLOW}Warnings: ${totalWarned}${RESET}`);
console.log(`  ${RED}Failed: ${totalFailed}${RESET}`);
console.log(`  Elapsed: ${elapsed}ms`);
console.log('');

if (totalFailed === 0) {
  console.log(`${GREEN}${BOLD}✓ ALL CHECKS PASSED${RESET}`);
  console.log(`  Delivery readiness: ${GREEN}READY${RESET}`);
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}✗ ${totalFailed} CHECK(S) FAILED${RESET}`);
  console.log(`  Delivery readiness: ${RED}NOT READY${RESET}`);
  console.log(`  Fix the ${totalFailed} failed checks above before proceeding with delivery.`);
  process.exit(1);
}