'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
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
} = require(path.join(__dirname, '..', '..', 'scripts', 'compliance', 'license-scanner.cjs'));

// ---- License Detection ----

test('detectLicenseFromDir - MIT license', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lic-'));
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT License\n\nPermission is hereby granted...');
  const licenses = detectLicenseFromDir(dir);
  assert.ok(licenses.length > 0, 'should detect at least one license');
  assert.equal(licenses[0].id, 'MIT');
});

test('detectLicenseFromDir - Apache-2.0 license', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lic-'));
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'Apache License Version 2.0, January 2004\nhttp://www.apache.org/licenses/');
  const licenses = detectLicenseFromDir(dir);
  assert.ok(licenses.length > 0);
  assert.equal(licenses[0].id, 'Apache-2.0');
});

test('detectLicenseFromDir - GPL-3.0 license', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lic-'));
  fs.writeFileSync(path.join(dir, 'COPYING'), 'GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007');
  const licenses = detectLicenseFromDir(dir);
  assert.ok(licenses.length > 0);
  assert.equal(licenses[0].id, 'GPL-3.0-only');
  assert.equal(licenses[0].gpl, true);
  assert.equal(licenses[0].strongCopyleft, true);
});

test('detectLicenseFromDir - AGPL-3.0 license', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lic-'));
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE Version 3, 19 November 2007');
  const licenses = detectLicenseFromDir(dir);
  assert.ok(licenses.length > 0);
  assert.equal(licenses[0].id, 'AGPL-3.0-only');
  assert.equal(licenses[0].strongCopyleft, true);
});

test('detectLicenseFromDir - BSD-3-Clause', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lic-'));
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'BSD 3-Clause License\n\nRedistribution and use...');
  const licenses = detectLicenseFromDir(dir);
  assert.ok(licenses.length > 0);
  assert.equal(licenses[0].id, 'BSD-3-Clause');
});

test('detectLicenseFromDir - EPL-2.0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lic-'));
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'Eclipse Public License - v 2.0');
  const licenses = detectLicenseFromDir(dir);
  assert.ok(licenses.length > 0);
  assert.equal(licenses[0].id, 'EPL-2.0');
});

test('detectLicenseFromDir - ignores NOTICE files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lic-'));
  fs.writeFileSync(path.join(dir, 'NOTICE'), 'This product includes software...');
  const licenses = detectLicenseFromDir(dir);
  assert.equal(licenses.length, 0, 'NOTICE files should not be treated as licenses');
});

test('detectLicenseFromDir - empty directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lic-'));
  const licenses = detectLicenseFromDir(dir);
  assert.equal(licenses.length, 0);
});

test('detectLicenseFromPackageJSON - string license', () => {
  const licenses = detectLicenseFromPackageJSON({ license: 'MIT' });
  assert.ok(licenses.length > 0);
  assert.equal(licenses[0].id, 'MIT');
  assert.equal(licenses[0].source, 'package.json');
});

test('detectLicenseFromPackageJSON - object license', () => {
  const licenses = detectLicenseFromPackageJSON({ license: { type: 'Apache-2.0' } });
  assert.ok(licenses.length > 0);
  assert.equal(licenses[0].id, 'Apache-2.0');
});

test('detectLicenseFromPackageJSON - null/undefined', () => {
  assert.deepEqual(detectLicenseFromPackageJSON(null), []);
  assert.deepEqual(detectLicenseFromPackageJSON(undefined), []);
  assert.deepEqual(detectLicenseFromPackageJSON({}), []);
});

// ---- Compatibility Check ----

test('checkCompatibility - MIT is compatible with Apache-2.0', () => {
  const results = checkCompatibility([{ id: 'MIT', name: 'MIT' }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'compatible');
});

test('checkCompatibility - AGPL-3.0 is incompatible with Apache-2.0', () => {
  const results = checkCompatibility([{ id: 'AGPL-3.0-only', name: 'AGPL-3.0-only' }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'incompatible');
});

test('checkCompatibility - GPL-3.0 is conditional with Apache-2.0', () => {
  const results = checkCompatibility([{ id: 'GPL-3.0-only', name: 'GPL-3.0-only' }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'conditional');
});

test('checkCompatibility - unknown license', () => {
  const results = checkCompatibility([{ id: 'UNKNOWN-LICENSE', name: 'UNKNOWN-LICENSE' }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'unknown');
});

// ---- Bundled Dependencies ----

test('scanBundledDependencies - returns expected bundled deps', () => {
  const components = scanBundledDependencies();
  assert.equal(components.length, BUNDLED_DEPENDENCIES.length);
  const names = components.map(c => c.name);
  assert.ok(names.includes('Apache Tomcat'));
  assert.ok(names.includes('Eclipse JDT Language Server'));
  assert.ok(names.includes('Kairo Runtime Agent'));
});

test('scanBundledDependencies - all have compatible licenses', () => {
  const components = scanBundledDependencies();
  for (const comp of components) {
    assert.ok(comp._compat, `component ${comp.name} should have _compat`);
    for (const c of comp._compat) {
      assert.notEqual(c.status, 'incompatible', `${comp.name} license ${c.license} should not be incompatible`);
    }
  }
});

// ---- SPDX Report Generation ----

test('generateSPDXReport - valid structure', () => {
  const bundled = scanBundledDependencies();
  const report = generateSPDXReport([], [], bundled);
  assert.equal(report.spdxVersion, 'SPDX-2.3');
  assert.equal(report.dataLicense, 'CC0-1.0');
  assert.ok(Array.isArray(report.packages));
  assert.equal(report.packages.length, bundled.length);
  assert.ok(report.packages[0].SPDXID);
  assert.ok(report.packages[0].licenseConcluded);
});

// ---- Summary Generation ----

test('generateSummary - empty components', () => {
  const summary = generateSummary([], [], []);
  assert.equal(summary.summary.totalComponents, 0);
  assert.equal(summary.summary.compatibilityIssues, 0);
});

test('generateSummary - with bundled components', () => {
  const bundled = scanBundledDependencies();
  const summary = generateSummary([], [], bundled);
  assert.equal(summary.summary.totalComponents, bundled.length);
  assert.ok(summary.summary.licenseDistribution);
  assert.ok(Array.isArray(summary.recommendations));
});

test('generateSummary - includes recommendations', () => {
  const bundled = scanBundledDependencies();
  const summary = generateSummary([], [], bundled);
  assert.ok(summary.recommendations.length > 0);
  const hasBestPractice = summary.recommendations.some(r => r.category === 'best-practice');
  assert.ok(hasBestPractice, 'should include best practice recommendation');
});

// ---- SPDX License IDs ----

test('SPDX_LICENSE_IDS - contains common licenses', () => {
  assert.ok(SPDX_LICENSE_IDS.has('MIT'));
  assert.ok(SPDX_LICENSE_IDS.has('Apache-2.0'));
  assert.ok(SPDX_LICENSE_IDS.has('GPL-3.0-only'));
  assert.ok(SPDX_LICENSE_IDS.has('EPL-2.0'));
  assert.ok(SPDX_LICENSE_IDS.has('MPL-2.0'));
});

// ---- License Compatibility Matrix ----

test('LICENSE_COMPATIBILITY - has Apache-2.0 entries', () => {
  const apache = LICENSE_COMPATIBILITY['Apache-2.0'];
  assert.ok(apache, 'should have Apache-2.0 row');
  assert.equal(apache['MIT'], 'compatible');
  assert.equal(apache['AGPL-3.0-only'], 'incompatible');
  assert.equal(apache['GPL-3.0-only'], 'conditional');
});

// ---- Go Module Scanning ----

test('scanGoModules - parses go.mod dependencies', () => {
  const components = scanGoModules();
  // Should find at least gorilla/websocket, golang.org/x/text, gopkg.in/yaml.v3
  assert.ok(components.length >= 3, `expected at least 3 Go deps, got ${components.length}`);
  const names = components.map(c => c.name);
  assert.ok(names.some(n => n.includes('gorilla/websocket')), 'should include gorilla/websocket');
  assert.ok(names.some(n => n.includes('golang.org/x/text')), 'should include golang.org/x/text');
  assert.ok(names.some(n => n.includes('yaml.v3')), 'should include yaml.v3');
});

test('scanGoModules - all components have purl', () => {
  const components = scanGoModules();
  for (const comp of components) {
    assert.ok(comp.purl, `component ${comp.name} should have purl`);
    assert.ok(comp.purl.startsWith('pkg:golang/'), `purl should start with pkg:golang/: ${comp.purl}`);
  }
});