#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// ---- helpers ----

function shasum(data) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function collectPackageFiles(dir) {
  const results = [];
  const entries = [];
  try { entries.push(...fs.readdirSync(dir, { withFileTypes: true })); } catch { return results; }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      results.push(...collectPackageFiles(full));
    } else if (entry.isFile() && entry.name === 'package.json') {
      results.push(full);
    }
  }
  return results;
}

// ---- license detection ----

const LICENSE_FILE_NAMES = /^(LICENSE|LICENCE|COPYING|NOTICE)(\.[a-z]+)?$/i;
const GPL_PATTERNS = [
  /GNU GENERAL PUBLIC LICENSE/i,
  /GNU AFFERO GENERAL PUBLIC LICENSE/i,
  /GNU LESSER GENERAL PUBLIC LICENSE/i,
  /\bGPL\b/i,
  /\bAGPL\b/i,
  /\bLGPL\b/i
];

const LICENSE_ALIASES = {
  'MIT': 'MIT',
  'Apache-2.0': 'Apache-2.0',
  'Apache 2.0': 'Apache-2.0',
  'ISC': 'ISC',
  'BSD-2-Clause': 'BSD-2-Clause',
  'BSD-3-Clause': 'BSD-3-Clause',
  'BSD': 'BSD-3-Clause',
  'EPL-2.0': 'EPL-2.0',
  'EPL-1.0': 'EPL-1.0',
  'MPL-2.0': 'MPL-2.0',
  'Unlicense': 'Unlicense',
  'CC0-1.0': 'CC0-1.0',
  '0BSD': '0BSD',
  'BlueOak-1.0.0': 'BlueOak-1.0.0'
};

function detectLicenseFromDir(pkgDir) {
  let entries;
  try { entries = fs.readdirSync(pkgDir, { withFileTypes: true }); } catch { return []; }

  const licenses = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!LICENSE_FILE_NAMES.test(entry.name)) continue;
    const filePath = path.join(pkgDir, entry.name);
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }

    const firstLine = content.split('\n')[0] || '';
    const header = content.slice(0, 500);

    if (entry.name.toUpperCase().startsWith('NOTICE')) continue; // NOTICE is not a license

    let detected = null;
    let isGPL = false;

    for (const pattern of GPL_PATTERNS) {
      if (pattern.test(header)) {
        isGPL = true;
        break;
      }
    }

    for (const [keyword, spdx] of Object.entries(LICENSE_ALIASES)) {
      if (header.includes(keyword)) {
        detected = spdx;
        break;
      }
    }

    if (!detected) {
      if (header.includes('Mozilla Public License')) detected = 'MPL-2.0';
      else if (header.includes('Creative Commons')) detected = 'CC-BY-4.0';
      else if (header.includes('Public Domain')) detected = 'Unlicense';
      else if (firstLine.includes('Copyright') && firstLine.includes('MIT')) detected = 'MIT';
      else if (firstLine.includes('Copyright') && firstLine.includes('BSD')) detected = 'BSD-3-Clause';
      else if (firstLine.includes('Copyright') && firstLine.includes('Apache')) detected = 'Apache-2.0';
    }

    if (detected) {
      licenses.push({
        id: detected,
        name: detected,
        source: path.relative(pkgDir, filePath),
        gpl: isGPL || detected === 'GPL-2.0-only' || detected === 'GPL-3.0-only' || detected === 'AGPL-3.0-only'
      });
    }
  }

  return licenses;
}

// ---- CycloneDX SBOM ----

function generateSBOM() {
  const rootPkg = readJSON(path.join(ROOT, 'package.json'));
  const name = rootPkg?.name || 'kairo-ide';
  const version = rootPkg?.version || '0.1.0';

  const components = [];
  const seen = new Set();

  // Collect all package.json files from packages/, apps/, and legacy-sample/
  const packageFiles = [
    ...collectPackageFiles(path.join(ROOT, 'packages')),
    ...collectPackageFiles(path.join(ROOT, 'apps'))
  ];

  const legacyPkg = readJSON(path.join(ROOT, 'legacy-sample', 'package.json'));
  if (legacyPkg) packageFiles.push(path.join(ROOT, 'legacy-sample', 'package.json'));

  for (const pkgFile of packageFiles) {
    const pkg = readJSON(pkgFile);
    if (!pkg || !pkg.name) continue;

    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const pkgDir = path.dirname(pkgFile);

    for (const [depName, depVersion] of Object.entries(allDeps)) {
      const key = `${depName}@${depVersion}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const depDir = path.join(ROOT, 'node_modules', ...depName.split('/'));
      const licenses = detectLicenseFromDir(depDir);
      const gplLicenses = licenses.filter(l => l.gpl);

      const component = {
        type: 'library',
        name: depName,
        version: depVersion,
        'bom-ref': shasum(`${depName}@${depVersion}`),
        purl: `pkg:npm/${depName}@${depVersion}`
      };

      if (licenses.length > 0) {
        component.licenses = licenses.map(l => ({ license: { id: l.id, name: l.name } }));
      }

      if (gplLicenses.length > 0) {
        component.properties = [
          { name: 'kairo:license:warning', value: 'GPL or strong-copyleft license detected' }
        ];
      }

      components.push(component);
    }
  }

  // Add bundled dependencies
  const bundled = [
    { name: 'Eclipse JDT Language Server', version: '1.43.0', license: 'EPL-2.0', purl: 'pkg:generic/eclipse-jdt-ls@1.43.0' },
    { name: 'Apache Tomcat', version: '6.0.53', license: 'Apache-2.0', purl: 'pkg:generic/apache-tomcat@6.0.53' }
  ];
  for (const b of bundled) {
    components.push({
      type: 'application',
      name: b.name,
      version: b.version,
      'bom-ref': shasum(`${b.name}@${b.version}`),
      purl: b.purl,
      licenses: [{ license: { id: b.license, name: b.license } }]
    });
  }

  // Add root project component
  const rootMetadata = {
    type: 'application',
    name: name,
    version: version,
    'bom-ref': shasum(`${name}@${version}`),
    purl: `pkg:npm/${name}@${version}`
  };

  const bom = {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: rootMetadata
    },
    components: components.sort((a, b) => a.name.localeCompare(b.name))
  };

  return bom;
}

// ---- license inventory ----

function generateLicenseInventory() {
  const inventory = {
    project: 'kairo-ide',
    generatedAt: new Date().toISOString(),
    dependencies: [],
    warnings: []
  };

  // Scan node_modules for all packages with LICENSE files
  const nodeModules = path.join(ROOT, 'node_modules');
  if (!fs.existsSync(nodeModules)) return inventory;

  const scopedDirs = [];
  try {
    for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
      if (entry.isDirectory()) scopedDirs.push(entry.name);
    }
  } catch {}

  for (const dirName of scopedDirs) {
    if (dirName.startsWith('.') || dirName === 'bin') continue; // skip .bin, .cache, .pnpm etc.
    const fullPath = path.join(nodeModules, dirName);
    // Handle scoped packages (e.g., @theia)
    if (dirName.startsWith('@')) {
      let subDirs = [];
      try { subDirs = fs.readdirSync(fullPath, { withFileTypes: true }); } catch {}
      for (const sub of subDirs) {
        if (sub.isDirectory()) {
          scanDirectory(path.join(fullPath, sub.name), `${dirName}/${sub.name}`, inventory);
        }
      }
    } else {
      scanDirectory(fullPath, dirName, inventory);
    }
  }

  // Also scan bundled licenses
  const bundledDir = path.join(ROOT, 'bundled');
  if (fs.existsSync(bundledDir)) {
    const tomcatLicense = path.join(bundledDir, 'tomcat6', 'LICENSE');
    if (fs.existsSync(tomcatLicense)) {
      inventory.dependencies.push({
        name: 'Apache Tomcat (bundled)',
        version: '6.0.53',
        license: 'Apache-2.0',
        gpl: false
      });
    }
  }

  return inventory;
}

function scanDirectory(dir, name, inventory) {
  const pkgFile = path.join(dir, 'package.json');
  const pkg = readJSON(pkgFile);
  const version = pkg?.version || 'unknown';
  const pkgLicense = pkg?.license;

  const licenses = detectLicenseFromDir(dir);
  const gplLicenses = licenses.filter(l => l.gpl);

  let licenseType = 'unknown';
  if (licenses.length > 0) {
    licenseType = licenses.map(l => l.id).join(' / ');
  } else if (pkgLicense && typeof pkgLicense === 'string') {
    licenseType = pkgLicense;
  }

  const entry = {
    name: name,
    version: version,
    license: licenseType,
    gpl: gplLicenses.length > 0
  };

  inventory.dependencies.push(entry);

  if (gplLicenses.length > 0) {
    inventory.warnings.push({
      type: 'GPL_LICENSE_DETECTED',
      dependency: name,
      version: version,
      license: licenseType,
      details: gplLicenses.map(l => `${l.id} (${l.source})`).join(', ')
    });
  }

  if (licenseType === 'unknown') {
    inventory.warnings.push({
      type: 'UNKNOWN_LICENSE',
      dependency: name,
      version: version
    });
  }
}

// ---- main ----

function main() {
  fs.mkdirSync(DIST, { recursive: true });

  const sbom = generateSBOM();
  const sbomPath = path.join(DIST, 'sbom.json');
  fs.writeFileSync(sbomPath, JSON.stringify(sbom, null, 2));
  console.log(`[sbom] written ${sbom.components.length} components to ${path.relative(ROOT, sbomPath)}`);

  const inventory = generateLicenseInventory();
  const inventoryPath = path.join(DIST, 'license-inventory.json');
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
  console.log(`[license] inventory written to ${path.relative(ROOT, inventoryPath)}`);

  if (inventory.warnings.length > 0) {
    console.log(`[license] ${inventory.warnings.length} warnings:`);
    for (const w of inventory.warnings) {
      console.log(`  - [${w.type}] ${w.dependency}@${w.version}${w.details ? ': ' + w.details : ''}`);
    }
  }
}

main();