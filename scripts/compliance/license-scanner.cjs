#!/usr/bin/env node
'use strict';

/**
 * License Scanner for Kairo IDE
 * Scans npm dependencies, Go modules, and bundled dependencies for licenses.
 * Generates SPDX-format reports and license compatibility analysis.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const COMPLIANCE_DIR = path.join(DIST, 'compliance');

// ---- SPDX License IDs ----
const SPDX_LICENSE_IDS = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'GPL-2.0-only',
  'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'LGPL-2.1-only',
  'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'AGPL-3.0-only',
  'AGPL-3.0-or-later', 'EPL-1.0', 'EPL-2.0', 'MPL-2.0', 'CDDL-1.0',
  'CDDL-1.1', 'Unlicense', 'CC0-1.0', '0BSD', 'BlueOak-1.0.0', 'BSL-1.0',
  'Artistic-2.0', 'WTFPL', 'Zlib', 'PostgreSQL', 'NCSA', 'MS-PL', 'MS-RL',
  'EUPL-1.1', 'EUPL-1.2', 'OSL-3.0', 'AFL-3.0', 'CECILL-2.1'
]);

// ---- License Compatibility Matrix ----
// Rows: project license, Columns: dependency license
// 'compatible', 'conditional', 'incompatible'
const LICENSE_COMPATIBILITY = {
  'Apache-2.0': {
    'MIT': 'compatible',
    'BSD-2-Clause': 'compatible',
    'BSD-3-Clause': 'compatible',
    'ISC': 'compatible',
    'Apache-2.0': 'compatible',
    'EPL-1.0': 'compatible',
    'EPL-2.0': 'compatible',
    'MPL-2.0': 'compatible',
    'CDDL-1.0': 'compatible',
    'CDDL-1.1': 'compatible',
    'Unlicense': 'compatible',
    'CC0-1.0': 'compatible',
    '0BSD': 'compatible',
    'BlueOak-1.0.0': 'compatible',
    'BSL-1.0': 'compatible',
    'Artistic-2.0': 'compatible',
    'WTFPL': 'compatible',
    'Zlib': 'compatible',
    'PostgreSQL': 'compatible',
    'NCSA': 'compatible',
    'MS-PL': 'compatible',
    'MS-RL': 'compatible',
    'LGPL-2.1-only': 'conditional',
    'LGPL-2.1-or-later': 'conditional',
    'LGPL-3.0-only': 'conditional',
    'LGPL-3.0-or-later': 'conditional',
    'GPL-2.0-only': 'conditional',
    'GPL-2.0-or-later': 'conditional',
    'GPL-3.0-only': 'conditional',
    'GPL-3.0-or-later': 'conditional',
    'AGPL-3.0-only': 'incompatible',
    'AGPL-3.0-or-later': 'incompatible',
    'EUPL-1.1': 'conditional',
    'EUPL-1.2': 'conditional',
    'OSL-3.0': 'incompatible',
    'AFL-3.0': 'incompatible',
    'CECILL-2.1': 'conditional'
  }
};

// Project license (from package.json)
const PROJECT_LICENSE = 'Apache-2.0';

// ---- Helpers ----

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function shasum(data) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

// ---- License Detection ----

const LICENSE_FILE_NAMES = /^(LICENSE|LICENCE|COPYING)(\.[a-z0-9]+)?$/i;
const NOTICE_FILE_NAMES = /^NOTICE(\.[a-z0-9]+)?$/i;

const LICENSE_PATTERNS = [
  { pattern: /MIT|MIT License/i, spdx: 'MIT' },
  { pattern: /Apache License.*Version 2\.0|Apache-2\.0/i, spdx: 'Apache-2.0' },
  { pattern: /BSD 2-Clause|BSD-2-Clause|"Simplified BSD License"/i, spdx: 'BSD-2-Clause' },
  { pattern: /BSD 3-Clause|BSD-3-Clause|"New BSD License"|"Revised BSD"/i, spdx: 'BSD-3-Clause' },
  { pattern: /ISC License|ISC/i, spdx: 'ISC' },
  { pattern: /GNU GENERAL PUBLIC LICENSE.*Version 3|GPL-3\.0/i, spdx: 'GPL-3.0-only' },
  { pattern: /GNU GENERAL PUBLIC LICENSE.*Version 2|GPL-2\.0/i, spdx: 'GPL-2.0-only' },
  { pattern: /GNU LESSER GENERAL PUBLIC LICENSE.*Version 3|LGPL-3\.0/i, spdx: 'LGPL-3.0-only' },
  { pattern: /GNU LESSER GENERAL PUBLIC LICENSE.*Version 2\.1|LGPL-2\.1/i, spdx: 'LGPL-2.1-only' },
  { pattern: /GNU AFFERO GENERAL PUBLIC LICENSE.*Version 3|AGPL-3\.0/i, spdx: 'AGPL-3.0-only' },
  { pattern: /Eclipse Public License.*v?\s*2\.0|EPL-2\.0/i, spdx: 'EPL-2.0' },
  { pattern: /Eclipse Public License.*v?\s*1\.0|EPL-1\.0/i, spdx: 'EPL-1.0' },
  { pattern: /Mozilla Public License.*Version 2\.0|MPL-2\.0/i, spdx: 'MPL-2.0' },
  { pattern: /CDDL-1\.0|COMMON DEVELOPMENT AND DISTRIBUTION LICENSE/i, spdx: 'CDDL-1.0' },
  { pattern: /CDDL-1\.1/i, spdx: 'CDDL-1.1' },
  { pattern: /CC0|Creative Commons Zero|Public Domain Dedication/i, spdx: 'CC0-1.0' },
  { pattern: /Unlicense/i, spdx: 'Unlicense' },
  { pattern: /Blue Oak Model License/i, spdx: 'BlueOak-1.0.0' },
  { pattern: /Boost Software License/i, spdx: 'BSL-1.0' },
  { pattern: /Artistic License.*2\.0/i, spdx: 'Artistic-2.0' },
  { pattern: /WTFPL|Do What The Fuck/i, spdx: 'WTFPL' },
  { pattern: /zlib\/libpng license|zlib License/i, spdx: 'Zlib' },
  { pattern: /PostgreSQL License/i, spdx: 'PostgreSQL' },
  { pattern: /University of Illinois\/NCSA/i, spdx: 'NCSA' },
  { pattern: /Microsoft Public License|MS-PL/i, spdx: 'MS-PL' },
  { pattern: /Microsoft Reciprocal License|MS-RL/i, spdx: 'MS-RL' },
  { pattern: /European Union Public License.*1\.1|EUPL-1\.1/i, spdx: 'EUPL-1.1' },
  { pattern: /European Union Public License.*1\.2|EUPL-1\.2/i, spdx: 'EUPL-1.2' },
  { pattern: /Open Software License.*3\.0|OSL-3\.0/i, spdx: 'OSL-3.0' },
  { pattern: /Academic Free License.*3\.0|AFL-3\.0/i, spdx: 'AFL-3.0' },
  { pattern: /CeCILL Free Software License.*2\.1|CECILL-2\.1/i, spdx: 'CECILL-2.1' }
];

function detectLicenseFromDir(pkgDir) {
  const licenses = [];
  let entries;
  try { entries = fs.readdirSync(pkgDir, { withFileTypes: true }); } catch { return licenses; }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (NOTICE_FILE_NAMES.test(entry.name)) continue;
    if (!LICENSE_FILE_NAMES.test(entry.name)) continue;

    const filePath = path.join(pkgDir, entry.name);
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }

    const header = content.slice(0, 1000);

    for (const { pattern, spdx } of LICENSE_PATTERNS) {
      if (pattern.test(header)) {
        const isGPL = spdx.startsWith('GPL-') || spdx.startsWith('AGPL-') || spdx.startsWith('LGPL-');
        const isStrongCopyleft = spdx.startsWith('GPL-') || spdx.startsWith('AGPL-');
        licenses.push({
          id: spdx,
          name: spdx,
          source: path.relative(pkgDir, filePath),
          gpl: isGPL,
          strongCopyleft: isStrongCopyleft
        });
        break;
      }
    }
  }

  return licenses;
}

function detectLicenseFromPackageJSON(pkg) {
  if (!pkg || !pkg.license) return [];
  const licenseField = pkg.license;
  if (typeof licenseField === 'string') {
    const cleaned = licenseField.replace(/[()]/g, '').trim();
    if (SPDX_LICENSE_IDS.has(cleaned)) {
      return [{ id: cleaned, name: cleaned, source: 'package.json', gpl: cleaned.startsWith('GPL-') || cleaned.startsWith('AGPL-'), strongCopyleft: cleaned.startsWith('GPL-') || cleaned.startsWith('AGPL-') }];
    }
    // Try to match against known patterns
    for (const { pattern, spdx } of LICENSE_PATTERNS) {
      if (pattern.test(cleaned)) {
        return [{ id: spdx, name: spdx, source: 'package.json', gpl: spdx.startsWith('GPL-') || spdx.startsWith('AGPL-'), strongCopyleft: spdx.startsWith('GPL-') || spdx.startsWith('AGPL-') }];
      }
    }
  }
  if (typeof licenseField === 'object' && licenseField.type) {
    const t = licenseField.type;
    if (SPDX_LICENSE_IDS.has(t)) {
      return [{ id: t, name: t, source: 'package.json', gpl: t.startsWith('GPL-') || t.startsWith('AGPL-'), strongCopyleft: t.startsWith('GPL-') || t.startsWith('AGPL-') }];
    }
  }
  return [];
}

// ---- npm dependency scanning ----

function scanNpmDependencies() {
  const components = [];
  const seen = new Set();
  const nodeModules = path.join(ROOT, 'node_modules');

  if (!fs.existsSync(nodeModules)) {
    console.warn('[license-scanner] node_modules not found, skipping npm scan');
    return components;
  }

  // Collect all package.json files from workspace packages
  const packageDirs = [];
  for (const ws of ['packages', 'apps']) {
    const wsDir = path.join(ROOT, ws);
    if (!fs.existsSync(wsDir)) continue;
    collectPackageJSONs(wsDir, packageDirs);
  }

  const allDeps = new Map();
  for (const pkgFile of packageDirs) {
    const pkg = readJSON(pkgFile);
    if (!pkg || !pkg.name) continue;
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const [name, version] of Object.entries(deps)) {
      if (!allDeps.has(name)) {
        allDeps.set(name, { version, name });
      }
    }
  }

  for (const [depName, depInfo] of allDeps) {
    const key = `${depName}@${depInfo.version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const depDir = path.join(nodeModules, ...depName.split('/'));
    const depPkg = readJSON(path.join(depDir, 'package.json'));

    let licenses = detectLicenseFromDir(depDir);
    if (licenses.length === 0 && depPkg) {
      licenses = detectLicenseFromPackageJSON(depPkg);
    }

    const resolvedLicenses = licenses.length > 0
      ? licenses
      : [{ id: 'NOASSERTION', name: 'NOASSERTION', source: 'none', gpl: false, strongCopyleft: false }];

    const component = {
      type: 'library',
      'bom-ref': shasum(key),
      name: depName,
      version: depPkg?.version || depInfo.version,
      purl: `pkg:npm/${depName}@${depPkg?.version || depInfo.version}`,
      licenses: resolvedLicenses.map(l => ({
        license: { id: l.id, name: l.name }
      })),
      _compat: checkCompatibility(resolvedLicenses)
    };

    if (resolvedLicenses.some(l => l.strongCopyleft)) {
      component.properties = [
        { name: 'kairo:license:warning', value: 'Strong copyleft license detected' }
      ];
    }

    components.push(component);
  }

  return components;
}

function collectPackageJSONs(dir, results) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      collectPackageJSONs(full, results);
    } else if (entry.isFile() && entry.name === 'package.json') {
      results.push(full);
    }
  }
}

// ---- Go module scanning ----

function scanGoModules() {
  const components = [];
  const goModPath = path.join(ROOT, 'runtime-agent', 'go.mod');
  const goSumPath = path.join(ROOT, 'runtime-agent', 'go.sum');

  if (!fs.existsSync(goModPath)) {
    console.warn('[license-scanner] go.mod not found, skipping Go scan');
    return components;
  }

  // Parse go.mod for dependencies
  const goModContent = fs.readFileSync(goModPath, 'utf8');
  const requireBlock = goModContent.match(/require\s*\(([\s\S]*?)\)/);
  if (!requireBlock && !goModContent.match(/require\s+(\S+)\s+(\S+)/g)) {
    return components;
  }

  const deps = [];
  // Multi-line require block
  if (requireBlock) {
    const lines = requireBlock[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        deps.push({ name: parts[0], version: parts[1] });
      }
    }
  }
  // Single-line require statements
  const singleLineMatches = goModContent.matchAll(/require\s+(\S+)\s+(\S+)/g);
  for (const match of singleLineMatches) {
    const name = match[1];
    if (!deps.some(d => d.name === name)) {
      deps.push({ name, version: match[2] });
    }
  }

  // Try to get license info from Go module cache or use known licenses
  const gopath = process.env.GOPATH || path.join(require('node:os').homedir(), 'go');
  const modCache = path.join(gopath, 'pkg', 'mod');

  for (const dep of deps) {
    const key = `${dep.name}@${dep.version}`;
    const cacheDir = path.join(modCache, ...dep.name.replace(/[A-Z]/g, c => '!' + c.toLowerCase()).split('/'), `@v`);
    let licenses = [];

    // Try to find license in module cache
    if (fs.existsSync(cacheDir)) {
      const zipFile = path.join(cacheDir, `${dep.version}.zip`);
      // For simplicity, check known Go module licenses
      const knownLicenses = {
        'github.com/gorilla/websocket': 'BSD-2-Clause',
        'golang.org/x/text': 'BSD-3-Clause',
        'gopkg.in/yaml.v3': 'MIT'
      };

      if (knownLicenses[dep.name]) {
        licenses = [{ id: knownLicenses[dep.name], name: knownLicenses[dep.name], source: 'known', gpl: false, strongCopyleft: false }];
      }
    }

    if (licenses.length === 0) {
      licenses = [{ id: 'NOASSERTION', name: 'NOASSERTION', source: 'none', gpl: false, strongCopyleft: false }];
    }

    components.push({
      type: 'library',
      'bom-ref': shasum(key),
      name: dep.name,
      version: dep.version,
      purl: `pkg:golang/${dep.name}@${dep.version}`,
      licenses: licenses.map(l => ({
        license: { id: l.id, name: l.name }
      })),
      _compat: checkCompatibility(licenses)
    });
  }

  return components;
}

// ---- Bundled dependencies scanning ----

const BUNDLED_DEPENDENCIES = [
  {
    name: 'Apache Tomcat',
    version: '6.0.53',
    license: 'Apache-2.0',
    purl: 'pkg:generic/apache-tomcat@6.0.53',
    type: 'application'
  },
  {
    name: 'Eclipse JDT Language Server',
    version: '1.43.0',
    license: 'EPL-2.0',
    purl: 'pkg:generic/eclipse-jdt-ls@1.43.0',
    type: 'application'
  },
  {
    name: 'Kairo Runtime Agent',
    version: '0.1.0',
    license: 'Apache-2.0',
    purl: 'pkg:generic/kairo-runtime@0.1.0',
    type: 'application'
  }
];

function scanBundledDependencies() {
  const components = [];
  const bundledDir = path.join(ROOT, 'bundled');

  for (const dep of BUNDLED_DEPENDENCIES) {
    const licenses = [{ id: dep.license, name: dep.license, source: 'bundled', gpl: false, strongCopyleft: false }];

    // Verify bundled license files exist
    if (dep.name === 'Apache Tomcat' && fs.existsSync(bundledDir)) {
      const tomcatLicense = path.join(bundledDir, 'tomcat6', 'LICENSE');
      if (fs.existsSync(tomcatLicense)) {
        licenses[0].source = 'bundled/tomcat6/LICENSE';
      }
    }

    components.push({
      type: dep.type,
      'bom-ref': shasum(`${dep.name}@${dep.version}`),
      name: dep.name,
      version: dep.version,
      purl: dep.purl,
      licenses: licenses.map(l => ({
        license: { id: l.id, name: l.name }
      })),
      _compat: checkCompatibility(licenses)
    });
  }

  return components;
}

// ---- Compatibility Check ----

function checkCompatibility(licenses) {
  const matrix = LICENSE_COMPATIBILITY[PROJECT_LICENSE] || {};
  const results = [];
  for (const lic of licenses) {
    const status = matrix[lic.id] || 'unknown';
    results.push({
      license: lic.id,
      status: status,
      message: status === 'compatible' ? `Compatible with ${PROJECT_LICENSE}`
        : status === 'conditional' ? `Conditionally compatible with ${PROJECT_LICENSE} — requires review`
        : status === 'incompatible' ? `INCOMPATIBLE with ${PROJECT_LICENSE} — requires legal review`
        : `Compatibility unknown with ${PROJECT_LICENSE}`
    });
  }
  return results;
}

// ---- SPDX Report Generation ----

function generateSPDXReport(npmComponents, goComponents, bundledComponents) {
  const allComponents = [...npmComponents, ...goComponents, ...bundledComponents];
  const rootPkg = readJSON(path.join(ROOT, 'package.json'));

  const spdx = {
    SPDXID: 'SPDXRef-DOCUMENT',
    spdxVersion: 'SPDX-2.3',
    name: `${rootPkg?.name || 'kairo-ide'}-${rootPkg?.version || '0.1.0'}`,
    dataLicense: 'CC0-1.0',
    documentNamespace: `https://kairo.dev/spdx/${rootPkg?.name || 'kairo-ide'}-${rootPkg?.version || '0.1.0'}-${crypto.randomUUID()}`,
    creationInfo: {
      created: new Date().toISOString(),
      creators: ['Tool: kairo-license-scanner', 'Organization: Kairo IDE'],
      licenseListVersion: '3.21'
    },
    packages: allComponents.map((c, i) => ({
      SPDXID: `SPDXRef-${i}`,
      name: c.name,
      versionInfo: c.version,
      licenseConcluded: c.licenses.map(l => l.license.id).join(' AND '),
      licenseDeclared: c.licenses.map(l => l.license.id).join(' AND '),
      downloadLocation: c.purl,
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: c.purl
        }
      ]
    })),
    hasExtractedLicensingInfos: []
  };

  return spdx;
}

// ---- Summary Report ----

function generateSummary(npmComponents, goComponents, bundledComponents) {
  const allComponents = [...npmComponents, ...goComponents, ...bundledComponents];

  const licenseCounts = {};
  const compatibilityIssues = [];
  const gplDependencies = [];
  const unknownLicenses = [];

  for (const comp of allComponents) {
    for (const lic of comp.licenses) {
      const id = lic.license.id;
      licenseCounts[id] = (licenseCounts[id] || 0) + 1;
    }

    if (comp._compat) {
      for (const c of comp._compat) {
        if (c.status === 'incompatible' || c.status === 'conditional') {
          compatibilityIssues.push({
            component: comp.name,
            version: comp.version,
            license: c.license,
            status: c.status,
            message: c.message
          });
        }
      }
    }

    for (const lic of comp.licenses) {
      if (lic.license.id === 'NOASSERTION') {
        unknownLicenses.push({ component: comp.name, version: comp.version });
      }
    }

    // Check for GPL in original license data
    if (comp.properties && comp.properties.some(p => p.name === 'kairo:license:warning')) {
      gplDependencies.push({
        component: comp.name,
        version: comp.version,
        licenses: comp.licenses.map(l => l.license.id).join(', ')
      });
    }
  }

  return {
    project: 'kairo-ide',
    projectLicense: PROJECT_LICENSE,
    generatedAt: new Date().toISOString(),
    summary: {
      totalComponents: allComponents.length,
      npmComponents: npmComponents.length,
      goComponents: goComponents.length,
      bundledComponents: bundledComponents.length,
      licenseDistribution: licenseCounts,
      gplDependencies: gplDependencies.length,
      compatibilityIssues: compatibilityIssues.length,
      unknownLicenses: unknownLicenses.length
    },
    compatibilityIssues,
    gplDependencies,
    unknownLicenses,
    recommendations: generateRecommendations(allComponents, compatibilityIssues, gplDependencies, unknownLicenses)
  };
}

function generateRecommendations(allComponents, compatibilityIssues, gplDependencies, unknownLicenses) {
  const recommendations = [];

  if (gplDependencies.length > 0) {
    recommendations.push({
      severity: 'high',
      category: 'copyleft',
      message: `Found ${gplDependencies.length} GPL/strong-copyleft dependencies. Review if they are used at runtime or only as build tools.`,
      action: 'Replace GPL dependencies with permissive alternatives, or ensure they are only used as development tools.'
    });
  }

  if (compatibilityIssues.length > 0) {
    const incompatible = compatibilityIssues.filter(i => i.status === 'incompatible');
    const conditional = compatibilityIssues.filter(i => i.status === 'conditional');
    if (incompatible.length > 0) {
      recommendations.push({
        severity: 'critical',
        category: 'license-compatibility',
        message: `Found ${incompatible.length} incompatible licenses. These cannot be distributed with ${PROJECT_LICENSE}-licensed project.`,
        action: 'Remove or replace incompatible dependencies immediately.'
      });
    }
    if (conditional.length > 0) {
      recommendations.push({
        severity: 'medium',
        category: 'license-compatibility',
        message: `Found ${conditional.length} conditionally compatible licenses. Legal review required.`,
        action: 'Consult legal counsel regarding conditional compatibility.'
      });
    }
  }

  if (unknownLicenses.length > 0) {
    recommendations.push({
      severity: 'medium',
      category: 'unknown-license',
      message: `Found ${unknownLicenses.length} dependencies with unknown licenses. These must be resolved before release.`,
      action: 'Investigate and document licenses for unknown dependencies.'
    });
  }

  recommendations.push({
    severity: 'low',
    category: 'best-practice',
    message: 'Maintain an up-to-date SBOM for all releases.',
    action: 'Run license-scanner.cjs as part of CI/CD pipeline.'
  });

  return recommendations;
}

// ---- Main ----

function main() {
  fs.mkdirSync(COMPLIANCE_DIR, { recursive: true });

  console.log('[license-scanner] Scanning npm dependencies...');
  const npmComponents = scanNpmDependencies();
  console.log(`[license-scanner] Found ${npmComponents.length} npm dependencies`);

  console.log('[license-scanner] Scanning Go dependencies...');
  const goComponents = scanGoModules();
  console.log(`[license-scanner] Found ${goComponents.length} Go dependencies`);

  console.log('[license-scanner] Scanning bundled dependencies...');
  const bundledComponents = scanBundledDependencies();
  console.log(`[license-scanner] Found ${bundledComponents.length} bundled dependencies`);

  // Generate SPDX report
  const spdxReport = generateSPDXReport(npmComponents, goComponents, bundledComponents);
  const spdxPath = path.join(COMPLIANCE_DIR, 'spdx-report.json');
  fs.writeFileSync(spdxPath, JSON.stringify(spdxReport, null, 2));
  console.log(`[license-scanner] SPDX report written to ${path.relative(ROOT, spdxPath)}`);

  // Generate summary report
  const summary = generateSummary(npmComponents, goComponents, bundledComponents);
  const summaryPath = path.join(COMPLIANCE_DIR, 'license-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[license-scanner] Summary written to ${path.relative(ROOT, summaryPath)}`);

  // Print summary to console
  console.log('\n=== License Scan Summary ===');
  console.log(`Total components: ${summary.summary.totalComponents}`);
  console.log(`  npm: ${summary.summary.npmComponents}`);
  console.log(`  Go:  ${summary.summary.goComponents}`);
  console.log(`  Bundled: ${summary.summary.bundledComponents}`);
  console.log(`\nLicense distribution:`);
  for (const [license, count] of Object.entries(summary.summary.licenseDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${license}: ${count}`);
  }
  console.log(`\nIssues:`);
  console.log(`  GPL/Copyleft: ${summary.summary.gplDependencies}`);
  console.log(`  Compatibility: ${summary.summary.compatibilityIssues}`);
  console.log(`  Unknown: ${summary.summary.unknownLicenses}`);

  if (summary.recommendations.length > 0) {
    console.log(`\nRecommendations:`);
    for (const rec of summary.recommendations) {
      console.log(`  [${rec.severity.toUpperCase()}] ${rec.message}`);
    }
  }

  // Exit with non-zero if there are critical issues
  const hasCritical = summary.recommendations.some(r => r.severity === 'critical');
  if (hasCritical) {
    console.error('\n[license-scanner] CRITICAL issues found. Please resolve before release.');
    process.exit(1);
  }

  console.log('\n[license-scanner] Scan complete.');
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
  scanNpmDependencies,
  scanGoModules,
  scanBundledDependencies,
  generateSPDXReport,
  generateSummary,
  checkCompatibility,
  detectLicenseFromDir,
  detectLicenseFromPackageJSON,
  LICENSE_COMPATIBILITY,
  SPDX_LICENSE_IDS,
  BUNDLED_DEPENDENCIES
};