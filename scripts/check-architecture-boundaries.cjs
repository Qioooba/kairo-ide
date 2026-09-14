#!/usr/bin/env node
'use strict';

/**
 * check-architecture-boundaries.cjs
 *
 * Architectural Boundary Gate & Deprecated API Quarantine Enforcer (PR17 / F22).
 *
 * Enforces:
 *   Gate 1: Protocol Purity (@kairo/protocol must be pure wire-protocol contracts without extension/Theia dependencies).
 *   Gate 2: Extension Layering (no deep internal source imports like @kairo/pkg/src or cross-package relative src leaks).
 *   Gate 3: Single HTTP Gateway (no raw fetch('/api/v1/...') calls from UI extensions; must go through RuntimeConnectionService).
 *   Gate 4: Deprecated API Quarantine (zero production calls to deprecated endpoints or legacy methods like resolveJDWPEndpoint or DELETE /api/v1/jdtls).
 *   Gate 5: Go Layering (domain & infrastructure packages in runtime-agent/internal must not import internal/api).
 *   Gate 6: License Manifest & Upstream Attribution (Apache-2.0 license file and attribution intact).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let totalGates = 0;
let passedGates = 0;
let failedGates = 0;
const violations = [];

function checkGate(name, fn) {
  totalGates++;
  console.log(`${BOLD}${CYAN}[Gate ${totalGates}]${RESET} ${BOLD}${name}${RESET}`);
  try {
    const issues = fn();
    if (!issues || issues.length === 0) {
      passedGates++;
      console.log(`  ${GREEN}✓ PASSED${RESET}`);
      return true;
    } else {
      failedGates++;
      console.log(`  ${RED}✗ FAILED${RESET} (${issues.length} violation(s)):`);
      for (const issue of issues) {
        console.log(`    - ${issue}`);
        violations.push(`[${name}] ${issue}`);
      }
      return false;
    }
  } catch (err) {
    failedGates++;
    console.log(`  ${RED}✗ ERROR${RESET}: ${err.message}`);
    violations.push(`[${name}] Error: ${err.message}`);
    return false;
  }
}

function getAllFiles(dir, extensions = ['.ts', '.js', '.cjs', '.go']) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  function walk(currentDir) {
    const list = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of list) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git' && entry.name !== 'lib') {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (extensions.some(ext => entry.name.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║    Kairo IDE — Architectural Boundary Gate Enforcer      ║${RESET}`);
console.log(`${BOLD}${CYAN}║    PR17 (F22): Strict Boundary & Quarantine Verification ║${RESET}`);
console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}\n`);

// ---------------------------------------------------------------------------
// Gate 1: Protocol Purity
// ---------------------------------------------------------------------------
checkGate('Gate 1: Protocol Purity (@kairo/protocol)', () => {
  const issues = [];
  const protocolPackageJson = path.join(ROOT, 'packages', 'protocol', 'package.json');
  if (!fs.existsSync(protocolPackageJson)) {
    issues.push('Missing packages/protocol/package.json');
    return issues;
  }
  const pkg = JSON.parse(fs.readFileSync(protocolPackageJson, 'utf8'));
  const deps = Object.keys(pkg.dependencies || {});
  for (const dep of deps) {
    if (dep.startsWith('@kairo/') || dep.startsWith('@theia/')) {
      issues.push(`@kairo/protocol must NOT depend on UI/extension package: "${dep}"`);
    }
  }

  // Check imports inside packages/protocol/src
  const protocolSrcFiles = getAllFiles(path.join(ROOT, 'packages', 'protocol', 'src'), ['.ts']);
  for (const file of protocolSrcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('@theia/') || (importPath.startsWith('@kairo/') && importPath !== '@kairo/protocol')) {
        issues.push(`${path.relative(ROOT, file)}: Illegal external import in protocol: "${importPath}"`);
      }
    }
  }
  return issues;
});

// ---------------------------------------------------------------------------
// Gate 2: Extension Layering & No Deep Internal Imports
// ---------------------------------------------------------------------------
checkGate('Gate 2: Extension Layering & No Deep Internal Imports', () => {
  const issues = [];
  const packagesDir = path.join(ROOT, 'packages');
  const srcFiles = getAllFiles(packagesDir, ['.ts']).filter(f => !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'));

  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    // Check for deep imports into other packages' src directory
    // e.g. from '@kairo/java-extension/src/...'
    const deepImportRegex = /from\s+['"](@kairo\/[^/'"]+\/src\/[^'"]+)['"]/g;
    let match;
    while ((match = deepImportRegex.exec(content)) !== null) {
      issues.push(`${path.relative(ROOT, file)}: Forbidden deep import into internal source: "${match[1]}"`);
    }

    // Check for relative imports going across packages into another package's src
    // e.g. from '../../runtime-extension/src/...'
    const crossPackageSrcRegex = /from\s+['"](\.\.\/\.\.\/[^/'"]+-extension\/src\/[^'"]+)['"]/g;
    while ((match = crossPackageSrcRegex.exec(content)) !== null) {
      issues.push(`${path.relative(ROOT, file)}: Forbidden cross-package relative src import: "${match[1]}"`);
    }
  }
  return issues;
});

// ---------------------------------------------------------------------------
// Gate 3: Single HTTP Gateway to Go Runtime Agent
// ---------------------------------------------------------------------------
checkGate('Gate 3: Single HTTP Gateway (no raw fetch("/api/v1/...") in UI)', () => {
  const issues = [];
  const packagesDir = path.join(ROOT, 'packages');
  const srcFiles = getAllFiles(packagesDir, ['.ts']).filter(f => {
    const rel = path.relative(packagesDir, f);
    // Exclude runtime-connection-service.ts which is the authorized single gateway
    if (rel.includes('runtime-connection-service.ts')) return false;
    // Exclude tests
    if (rel.includes('.test.') || rel.includes('.spec.')) return false;
    return true;
  });

  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    // Check if fetch is called directly with /api/v1
    const fetchApiRegex = /fetch\s*\(\s*[`'"][^`'"]*\/api\/v1\//g;
    let match;
    while ((match = fetchApiRegex.exec(content)) !== null) {
      issues.push(`${path.relative(ROOT, file)}: Bypassed RuntimeConnectionService with raw fetch: "${match[0]}"`);
    }
  }
  return issues;
});

// ---------------------------------------------------------------------------
// Gate 4: Deprecated API Quarantine
// ---------------------------------------------------------------------------
checkGate('Gate 4: Deprecated API Quarantine', () => {
  const issues = [];

  // Check 1: resolveJDWPEndpoint (deleted in PR03, must never reappear)
  const allGoAndTs = [
    ...getAllFiles(path.join(ROOT, 'runtime-agent'), ['.go']),
    ...getAllFiles(path.join(ROOT, 'packages'), ['.ts']),
  ].filter(f => !f.includes('_test.go') && !f.includes('.test.') && !f.includes('.spec.'));

  for (const file of allGoAndTs) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('resolveJDWPEndpoint')) {
      issues.push(`${path.relative(ROOT, file)}: Call to deprecated/removed resolveJDWPEndpoint found`);
    }
    if (content.includes('DELETE /api/v1/jdtls')) {
      issues.push(`${path.relative(ROOT, file)}: Reference to forbidden DELETE /api/v1/jdtls found`);
    }
  }

  // Check 2: Deprecated JDT LS process lifecycle in Go Agent
  // Production Go code outside internal/jdtls must NOT call mgr.Start or mgr.Stop
  const prodGoFiles = getAllFiles(path.join(ROOT, 'runtime-agent', 'internal'), ['.go']).filter(f => {
    return !f.includes('_test.go') && !f.includes('internal\\jdtls\\') && !f.includes('internal/jdtls/');
  });

  for (const file of prodGoFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('.mgr.Start(') || content.includes('.mgr.Stop(')) {
      issues.push(`${path.relative(ROOT, file)}: Call to deprecated JDT LS process lifecycle method (Theia backend owns JDT LS)`);
    }
  }

  return issues;
});

// ---------------------------------------------------------------------------
// Gate 5: Go Domain Layering (Domain/Infra must NOT import internal/api)
// ---------------------------------------------------------------------------
checkGate('Gate 5: Go Domain Layering (Domain/Infra must NOT import internal/api)', () => {
  const issues = [];
  const domainDirs = [
    'internal/build',
    'internal/debug',
    'internal/search',
    'internal/encoding',
    'internal/pathpolicy',
    'internal/jdtls',
  ];

  for (const domainDir of domainDirs) {
    const fullDir = path.join(ROOT, 'runtime-agent', domainDir);
    const goFiles = getAllFiles(fullDir, ['.go']).filter(f => !f.endsWith('_test.go'));

    for (const file of goFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"')) {
        issues.push(`${path.relative(ROOT, file)}: Domain package "${domainDir}" illegally imports "internal/api"`);
      }
    }
  }
  return issues;
});

// ---------------------------------------------------------------------------
// Gate 6: License Manifest & Upstream Attribution
// ---------------------------------------------------------------------------
checkGate('Gate 6: License Manifest & Upstream Attribution', () => {
  const issues = [];
  const licenseFile = path.join(ROOT, 'LICENSE');
  if (!fs.existsSync(licenseFile)) {
    issues.push('Missing root LICENSE file');
  } else {
    const content = fs.readFileSync(licenseFile, 'utf8');
    if (!content.includes('Apache License') && !content.includes('Version 2.0')) {
      issues.push('Root LICENSE is not Apache-2.0');
    }
  }

  const noticeFile = path.join(ROOT, 'NOTICE');
  if (!fs.existsSync(noticeFile)) {
    issues.push('Missing root NOTICE file');
  }

  // Check 3: Upstream attribution and fixtures manifest
  const upstreamManifest = path.join(ROOT, 'tests', 'fixtures', 'upstream', 'lithe', 'debug', 'source-manifest.json');
  if (fs.existsSync(upstreamManifest)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(upstreamManifest, 'utf8'));
      if (!manifest.upstreamRepository || !manifest.files || !Array.isArray(manifest.files)) {
        issues.push('Invalid upstream fixtures source-manifest.json structure');
      }
      for (const relFile of manifest.files) {
        const baseName = path.basename(relFile);
        const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'upstream', 'lithe', 'debug', baseName);
        if (!fs.existsSync(fixturePath)) {
          issues.push(`Missing fixture declared in source-manifest.json: ${baseName}`);
        }
      }
    } catch (e) {
      issues.push(`Upstream manifest parse error: ${e.message}`);
    }
  }

  return issues;
});

// ---------------------------------------------------------------------------
// Summary & Exit Code
// ---------------------------------------------------------------------------
console.log(`\n${BOLD}${CYAN}══════════════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}${CYAN}  Architecture Boundary Summary${RESET}`);
console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════════════${RESET}`);
console.log(`  Total gates:  ${BOLD}${totalGates}${RESET}`);
console.log(`  Passed gates: ${GREEN}${BOLD}${passedGates}${RESET}`);
console.log(`  Failed gates: ${failedGates > 0 ? RED : GREEN}${BOLD}${failedGates}${RESET}`);

if (failedGates === 0) {
  console.log(`\n${GREEN}${BOLD}✓ ALL ARCHITECTURAL BOUNDARY GATES PASSED!${RESET}`);
  process.exit(0);
} else {
  console.log(`\n${RED}${BOLD}✗ ARCHITECTURAL BOUNDARY VIOLATION DETECTED!${RESET}`);
  console.log(`  Please resolve the violations listed above.`);
  process.exit(1);
}
