#!/usr/bin/env node
/**
 * scripts/test/rebuild-asar.cjs
 *
 * Rebuild the app.asar inside dist/win-unpacked with the correct
 * structure expected by Electron: a root `package.json` whose
 * `main` points to apps/desktop/lib/main.js, plus the compiled
 * desktop JS, the Theia frontend bundle, the Theia backend main,
 * and the bundled/ directory (tomcat6 + jdtls).
 *
 * Why this exists: the previous build packed the entire monorepo
 * into the asar without a root `package.json`, so Electron
 * could not resolve the main entry and the app hung in the
 * splash.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const repoRoot = path.resolve(__dirname, '..', '..');
const unpackedDir = path.join(repoRoot, 'dist', 'win-unpacked');
const asarPath = path.join(unpackedDir, 'resources', 'app.asar');

function rm(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function cpFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function cpDir(src, dst, opts = {}) {
  if (!fs.existsSync(src)) {
    if (opts.required) throw new Error(`Required source dir missing: ${src}`);
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) cpDir(s, d);
    else if (entry.isFile()) cpFile(s, d);
  }
}

// 1. Stage sources into a flat temp tree rooted at the desktop package
const stage = path.join(unpackedDir, 'asar-stage');
rm(stage);
fs.mkdirSync(stage, { recursive: true });

// Root package.json — Electron reads this to find the main entry.
const desktopPkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8')
);
const rootPkg = {
  name: desktopPkg.name,
  productName: desktopPkg.productName || desktopPkg.name,
  version: desktopPkg.version,
  description: desktopPkg.description,
  main: 'apps/desktop/lib/main.js',
  author: 'Kairo IDE',
  license: 'Apache-2.0',
  dependencies: desktopPkg.dependencies || {},
};
fs.writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(rootPkg, null, 2)
);

// 2. Desktop main + preload + process manager
cpDir(
  path.join(repoRoot, 'apps', 'desktop', 'lib'),
  path.join(stage, 'apps', 'desktop', 'lib')
);
// 2a. Desktop's own package.json — some code paths do
// `require('../package.json')` or `require('apps/desktop/package.json')`
// from inside the asar, and asar can't read it if it's not staged.
cpFile(
  path.join(repoRoot, 'apps', 'desktop', 'package.json'),
  path.join(stage, 'apps', 'desktop', 'package.json')
);

// 2b. Workspace deps that the desktop main process requires at runtime.
// The asar can't traverse above `apps/desktop/`, so we must explicitly
// mirror the lib/ trees of every @kairo/* dep listed in the desktop
// package.json. Node's CJS resolver finds them via
// `require('@kairo/protocol')` → `node_modules/@kairo/protocol` (which
// is a symlink to packages/protocol in dev — here we just copy the lib
// dir + package.json so the require chain works inside the asar).
const workspaceDeps = (desktopPkg.dependencies || {});
for (const depName of Object.keys(workspaceDeps)) {
  if (!depName.startsWith('@kairo/')) continue;
  const shortName = depName.replace(/^@kairo\//, '');
  // Search in packages/, then apps/
  const candidates = [
    path.join(repoRoot, 'packages', shortName),
    path.join(repoRoot, 'apps', shortName),
  ];
  const src = candidates.find(p => fs.existsSync(p));
  if (!src) {
    console.warn(`[rebuild-asar] WARN: @kairo dep not found: ${depName} (tried ${candidates.join(', ')})`);
    continue;
  }
  const dst = path.join(stage, 'node_modules', depName);
  // Copy the package's package.json (so Node finds the main entry) and
  // its compiled lib/ output.
  const pkgJsonSrc = path.join(src, 'package.json');
  if (fs.existsSync(pkgJsonSrc)) {
    fs.mkdirSync(dst, { recursive: true });
    cpFile(pkgJsonSrc, path.join(dst, 'package.json'));
  }
  // Copy the lib/ directory (compiled JS).
  const libSrc = path.join(src, 'lib');
  if (fs.existsSync(libSrc)) {
    cpDir(libSrc, path.join(dst, 'lib'));
  }
  console.log(`[rebuild-asar] staged workspace dep: ${depName} <- ${src}`);
}

// 2c. Theia node_modules — the desktop main also requires
//     `@theia/core` and `@theia/electron` for the IPC bootstrap
//     and the BackendApplication. Copy the parts we need from
//     apps/desktop/node_modules (the hoisted pnpm store).
const theiaDeps = ['@theia/core', '@theia/electron', '@theia/blueprint-backend', '@theia/blueprint-core', '@theia/blueprint'];
for (const t of theiaDeps) {
  const candidates = [
    path.join(repoRoot, 'apps', 'desktop', 'node_modules', t),
    path.join(repoRoot, 'node_modules', t),
  ];
  const src = candidates.find(p => fs.existsSync(p));
  if (!src) continue;
  const dst = path.join(stage, 'node_modules', t);
  // For Theia packages we copy package.json + the typical subdirs
  // (lib / browser / node / common / shared) plus any *.js/*.json at root.
  fs.mkdirSync(dst, { recursive: true });
  cpFile(path.join(src, 'package.json'), path.join(dst, 'package.json'));
  // Root-level entry files (some packages like @theia/electron ship
  // index.js and index.d.ts at the package root).
  for (const f of ['index.js', 'index.d.ts', 'README.md']) {
    const fSrc = path.join(src, f);
    if (fs.existsSync(fSrc) && fs.statSync(fSrc).isFile()) {
      cpFile(fSrc, path.join(dst, f));
    }
  }
  for (const sub of ['lib', 'browser', 'node', 'common', 'shared']) {
    const subSrc = path.join(src, sub);
    if (fs.existsSync(subSrc) && fs.statSync(subSrc).isDirectory()) {
      cpDir(subSrc, path.join(dst, sub));
    }
  }
  console.log(`[rebuild-asar] staged Theia dep: ${t}`);
}

// 3. Theia browser frontend (already copied into apps/desktop/lib/frontend
//    by copy-browser-artifacts.js — covered by step 2).

// 4. Bundled tomcat6 + jdtls (already copied into apps/desktop/bundled/ by
//    copy-bundled.js).
cpDir(
  path.join(repoRoot, 'apps', 'desktop', 'bundled'),
  path.join(stage, 'bundled')
);

// 5. Pack the asar (unpacked = false, no compression for speed).
// createPackage is async in @electron/asar v3 — must be awaited, otherwise
// the call returns before the file is written and the asar is silently
// missing.
(async () => {
  await asar.createPackage(stage, asarPath, { unpacked: false });
  const finalSize = fs.existsSync(asarPath) ? fs.statSync(asarPath).size : 0;
  console.log(`[rebuild-asar] wrote ${asarPath} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`);

  // 6. Make sure resources/bin/ exists with kairo-runtime.exe next to the
  //    asar. The desktop main.js spawns it from process.resourcesPath/bin/.
  const binDir = path.join(unpackedDir, 'resources', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const agentSrc = path.join(repoRoot, 'runtime-agent', 'bin', 'kairo-runtime.exe');
  if (fs.existsSync(agentSrc)) {
    cpFile(agentSrc, path.join(binDir, 'kairo-runtime.exe'));
    console.log('[rebuild-asar] copied kairo-runtime.exe to resources/bin/');
  } else {
    console.warn('[rebuild-asar] WARN: kairo-runtime.exe not found at', agentSrc);
  }

  // 7. Clean up the staging dir to save space.
  if (process.env.KEEP_ASAR_STAGE) {
    console.log('[rebuild-asar] KEEP_ASAR_STAGE set, stage left at', stage);
  } else {
    rm(stage);
  }
  console.log('[rebuild-asar] OK');
})().catch(err => {
  console.error('[rebuild-asar] FAILED:', err.stack || err.message);
  process.exit(1);
});
