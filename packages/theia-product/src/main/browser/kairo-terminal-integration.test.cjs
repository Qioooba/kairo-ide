// Terminal integration test for Kairo IDE.
//
// Verifies that @theia/terminal dependency is properly declared
// in theia-product package.json, and that terminal-related
// configuration is valid.
//
// Run with:
//   node --test src/main/browser/kairo-terminal-integration.test.cjs

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// ------------------------------------------------------------------
// package.json dependency check
// ------------------------------------------------------------------

test('@theia/terminal is declared as a dependency', () => {
  const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  assert.ok('@theia/terminal' in pkg.dependencies, '@theia/terminal must be in dependencies');
  assert.equal(pkg.dependencies['@theia/terminal'], '1.73.1');
});

test('@theia/terminal version matches other Theia packages', () => {
  const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const theiaVersion = pkg.dependencies['@theia/terminal'];
  assert.equal(theiaVersion, '1.73.1');
  // Verify core Theia packages use the same version
  const corePackages = ['@theia/core', '@theia/editor', '@theia/filesystem', '@theia/monaco'];
  for (const pkgName of corePackages) {
    assert.equal(pkg.dependencies[pkgName], theiaVersion,
      `${pkgName} must match @theia/terminal version ${theiaVersion}`);
  }
});

// ------------------------------------------------------------------
// Terminal-related Theia packages
// ------------------------------------------------------------------

test('all required terminal ecosystem packages are present', () => {
  const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  // @theia/terminal is the core terminal package
  assert.ok('@theia/terminal' in pkg.dependencies);

  // @theia/variable-resolver is needed for terminal variable resolution
  assert.ok('@theia/variable-resolver' in pkg.dependencies);
});

// ------------------------------------------------------------------
// Scripts verification
// ------------------------------------------------------------------

test('package.json has valid scripts', () => {
  const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  assert.equal(typeof pkg.scripts, 'object');
  assert.equal(typeof pkg.scripts.build, 'string');
  assert.equal(typeof pkg.scripts.test, 'string');
});

// ------------------------------------------------------------------
// Theia extensions declaration
// ------------------------------------------------------------------

test('theiaExtensions has frontend and backend entries', () => {
  const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  assert.ok(Array.isArray(pkg.theiaExtensions));
  assert.ok(pkg.theiaExtensions.length >= 1);
  assert.equal(typeof pkg.theiaExtensions[0].frontend, 'string');
  assert.equal(typeof pkg.theiaExtensions[0].backend, 'string');
});

// ------------------------------------------------------------------
// Monorepo dependency consistency
// ------------------------------------------------------------------

test('workspace dependencies are properly declared', () => {
  const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const workspaceDeps = [
    '@kairo/build-extension',
    '@kairo/config-schema',
    '@kairo/java-extension',
    '@kairo/jsp-extension',
    '@kairo/project-extension',
    '@kairo/protocol',
    '@kairo/runtime-extension',
    '@kairo/search-extension',
    '@kairo/tomcat-extension',
    '@kairo/ui-kit',
  ];
  for (const dep of workspaceDeps) {
    assert.ok(dep in pkg.dependencies, `${dep} must be declared as dependency`);
    assert.equal(pkg.dependencies[dep], 'workspace:*');
  }
});