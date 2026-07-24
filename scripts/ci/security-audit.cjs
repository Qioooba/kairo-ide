#!/usr/bin/env node
'use strict';

/**
 * Kairo IDE — Security Audit Script
 *
 * Runs npm audit for all packages, categorizes vulnerabilities by severity,
 * and generates a JSON report. Exits with non-zero if critical or high
 * severity vulnerabilities are found.
 *
 * Usage:
 *   node scripts/ci/security-audit.cjs
 *   node scripts/ci/security-audit.cjs --allow-low
 *   node scripts/ci/security-audit.cjs --output security-audit.json
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const outputPath = getArg('--output') || path.join(ROOT, 'security-audit.json');
const allowLow = args.includes('--allow-low');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function runCmd(cmd, cwd = ROOT, timeout = 120_000) {
  try {
    const result = execSync(cmd, { cwd, encoding: 'utf8', timeout, stdio: 'pipe' });
    return { ok: true, stdout: result, stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
      error: err.message,
    };
  }
}

function parseNpmAudit(stdout) {
  const vulnerabilities = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    info: 0,
    total: 0,
    details: [],
  };

  // Try to parse JSON output first
  try {
    const json = JSON.parse(stdout);
    if (json.vulnerabilities) {
      for (const [name, vuln] of Object.entries(json.vulnerabilities)) {
        const severity = vuln.severity || 'unknown';
        vulnerabilities[severity] = (vulnerabilities[severity] || 0) + (vuln.via ? vuln.via.length : 1);
        vulnerabilities.total++;
        vulnerabilities.details.push({
          name,
          severity,
          range: vuln.range || '',
          via: Array.isArray(vuln.via) ? vuln.via.map(v => typeof v === 'string' ? v : v.title || v.name || 'unknown') : [String(vuln.via)],
          fixAvailable: vuln.fixAvailable || false,
        });
      }
    }
    return vulnerabilities;
  } catch {
    // Not JSON, try text parsing
  }

  // Text-based fallback parsing
  const lines = stdout.split('\n');
  for (const line of lines) {
    if (line.includes('critical')) {
      const match = line.match(/(\d+)\s+critical/);
      if (match) vulnerabilities.critical = parseInt(match[1]);
    }
    if (line.includes('high')) {
      const match = line.match(/(\d+)\s+high/);
      if (match) vulnerabilities.high = parseInt(match[1]);
    }
    if (line.includes('moderate')) {
      const match = line.match(/(\d+)\s+moderate/);
      if (match) vulnerabilities.moderate = parseInt(match[1]);
    }
    if (line.includes('low')) {
      const match = line.match(/(\d+)\s+low/);
      if (match) vulnerabilities.low = parseInt(match[1]);
    }
  }
  vulnerabilities.total = vulnerabilities.critical + vulnerabilities.high + vulnerabilities.moderate + vulnerabilities.low + vulnerabilities.info;
  return vulnerabilities;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('[security-audit] Kairo IDE Security Audit');
console.log(`[security-audit] Root: ${ROOT}`);
console.log('');

// Run npm audit
console.log('[security-audit] Running npm audit...');
const result = runCmd('pnpm audit --json 2>&1 || true');

let vulnerabilities = null;
if (result.ok) {
  vulnerabilities = parseNpmAudit(result.stdout);
} else {
  // npm audit exits with non-zero when vulnerabilities are found
  const combined = (result.stdout + '\n' + result.stderr).trim();
  if (combined) {
    vulnerabilities = parseNpmAudit(combined);
  }
}

if (!vulnerabilities) {
  console.log('[security-audit] No vulnerabilities found or npm audit not available');
  vulnerabilities = {
    critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0, details: [],
  };
}

// ---------------------------------------------------------------------------
// Categorize and report
// ---------------------------------------------------------------------------
console.log('');
console.log('=== Vulnerability Summary ===');
console.log(`  Critical: ${vulnerabilities.critical}`);
console.log(`  High:     ${vulnerabilities.high}`);
console.log(`  Moderate: ${vulnerabilities.moderate}`);
console.log(`  Low:      ${vulnerabilities.low}`);
console.log(`  Info:     ${vulnerabilities.info}`);
console.log(`  Total:    ${vulnerabilities.total}`);

// List details for critical and high
const criticalHigh = vulnerabilities.details.filter(d => d.severity === 'critical' || d.severity === 'high');
if (criticalHigh.length > 0) {
  console.log('');
  console.log('=== Critical/High Vulnerability Details ===');
  for (const v of criticalHigh) {
    console.log(`  [${v.severity.toUpperCase()}] ${v.name} (${v.range})`);
    console.log(`    Via: ${v.via.join(', ')}`);
    console.log(`    Fix available: ${v.fixAvailable}`);
  }
}

// ---------------------------------------------------------------------------
// Generate report
// ---------------------------------------------------------------------------
const report = {
  timestamp: new Date().toISOString(),
  project: 'kairo-ide',
  vulnerabilities,
  result: {
    critical: vulnerabilities.critical,
    high: vulnerabilities.high,
    moderate: vulnerabilities.moderate,
    low: vulnerabilities.low,
    total: vulnerabilities.total,
  },
};

const reportDir = path.dirname(outputPath);
if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(`\n[security-audit] Report written to ${outputPath}`);

// Also write npm-audit-report.json
const npmAuditPath = path.join(ROOT, 'npm-audit-report.json');
fs.writeFileSync(npmAuditPath, JSON.stringify(report, null, 2) + '\n');
console.log(`[security-audit] npm audit report written to ${npmAuditPath}`);

// ---------------------------------------------------------------------------
// Exit code
// ---------------------------------------------------------------------------
const minSeverity = allowLow ? 'low' : 'moderate';
let hasBlocking = false;

if (vulnerabilities.critical > 0) {
  console.log('\n[security-audit] FAILED: critical vulnerabilities found');
  hasBlocking = true;
}
if (vulnerabilities.high > 0) {
  console.log('[security-audit] FAILED: high vulnerabilities found');
  hasBlocking = true;
}
if (!allowLow && vulnerabilities.moderate > 0) {
  console.log('[security-audit] FAILED: moderate vulnerabilities found (use --allow-low to permit)');
  hasBlocking = true;
}

if (hasBlocking) {
  process.exit(1);
}

console.log('\n[security-audit] PASSED: no blocking vulnerabilities');
process.exit(0);