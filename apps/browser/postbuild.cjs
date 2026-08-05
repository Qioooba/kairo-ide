// Post-build step for @kairo/browser: copy static web assets into the
// generated frontend dir that the Theia backend serves at /.
// Currently: favicon.ico (browsers auto-request /favicon.ico; without
// this the console logs a 404 on every load — KAIRO-RC-WEB-016).
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const assets = ['favicon.ico'];
const srcDir = path.join(__dirname, 'resources');
const outDir = path.join(__dirname, 'lib', 'frontend');

let exitCode = 0;
/** Set once a required patch applied or was confirmed already present. */
const patchState = {
  inversify: false,
  applicationError: false,
  drivelist: false
};

function fail(message) {
  console.error(`[postbuild] FATAL: ${message}`);
  exitCode = 1;
}

for (const asset of assets) {
  const src = path.join(srcDir, asset);
  const dst = path.join(outDir, asset);
  if (!fs.existsSync(src)) {
    console.error(`[postbuild] MISSING asset: ${src}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`[postbuild] ${asset} -> ${path.relative(__dirname, dst)}`);
}

function patchFile(filePath, patches, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} target not found: ${filePath}`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  let missed = 0;
  for (const { from, to } of patches) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      changed = true;
    } else if (!content.includes(to)) {
      missed += 1;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[postbuild] ${label} patched successfully`);
  } else if (missed > 0) {
    fail(`${label}: ${missed} pattern(s) not found (minifier rename or upstream change?)`);
  } else {
    console.log(`[postbuild] ${label} already patched`);
  }
}

function patchInversify(filePath, { required = true } = {}) {
  if (!fs.existsSync(filePath)) {
    if (required) fail(`inversify patch: target not found: ${filePath}`);
    else console.warn('[postbuild] inversify patch: target not found:', filePath);
    return;
  }
  // The minifier renames ERRORS_MSGS to arbitrary short names (Fr, BAo, etc.)
  // so we use a regex that matches any variable name. We do NOT require a
  // trailing semicolon because terser may strip them.
  // IMPORTANT: Replace with plain `return` (returns undefined), NOT `return n`.
  // When a class already has PARAM_TYPES metadata, the injectable() decorator
  // should return undefined to tell reflect-metadata's DecorateConstructor to
  // keep the original target. Returning a non-constructor value causes
  // DecorateConstructor to throw TypeError.
  const injectableRegex = /throw new Error\((\w+)\.DUPLICATED_INJECTABLE_DECORATOR\)/g;
  let content = fs.readFileSync(filePath, 'utf8');
  const patchedCount = (content.match(injectableRegex) || []).length;
  if (patchedCount > 0) {
    const newContent = content.replace(injectableRegex, 'return');
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`[postbuild] inversify patch: ${patchedCount} occurrence(s) fixed`);
    if (required) patchState.inversify = true;
    return;
  }
  // Already patched: constant still present, throw site gone.
  if (content.includes('DUPLICATED_INJECTABLE_DECORATOR') || (required && patchState.inversify)) {
    console.log('[postbuild] inversify patch: already patched');
    if (required) patchState.inversify = true;
    return;
  }
  if (required) {
    fail('inversify patch: DUPLICATED_INJECTABLE_DECORATOR pattern missing (bundle shape changed?)');
  } else {
    console.log('[postbuild] inversify patch: no occurrences found (optional target)');
  }
}

const frontendBundle = path.join(outDir, 'bundle.js');

// ── Phase 1: Patch the esbuild output ──────────────────────
patchInversify(frontendBundle);

function patchApplicationError(filePath, { required = true } = {}) {
  if (!fs.existsSync(filePath)) {
    if (required) fail(`ApplicationError patch: target not found: ${filePath}`);
    else console.warn('[postbuild] ApplicationError patch: target not found:', filePath);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  // The minifier renames `code` to arbitrary short names (s, n, etc.)
  // and may change quote style. We use a regex that matches any
  // variable name and any quote style (single or double).
  const appErrRegex = /throw new Error\(`An application error for '\$\{(\w+)\}' code is already declared`\)/g;
  const appErrMarker = 'An application error for \'${';
  const patchedCount = (content.match(appErrRegex) || []).length;
  if (patchedCount > 0) {
    // Replace the throw with a simple return to silently ignore duplicate
    // ApplicationError code declarations. The first declaration is already
    // in the Set and will be used by all callers.
    const newContent = content.replace(appErrRegex, 'return');
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`[postbuild] ApplicationError patch: ${patchedCount} occurrence(s) fixed`);
    if (required) patchState.applicationError = true;
    return;
  }
  // Leftover marker with no regex hit → minifier/upstream drift (must fail).
  if (content.includes(appErrMarker) || (/already declared/.test(content) && /application error for/i.test(content))) {
    fail('ApplicationError patch: error string present but throw pattern did not match');
    return;
  }
  // Re-entry after a successful patch removes the template entirely.
  if (required && patchState.applicationError) {
    console.log('[postbuild] ApplicationError patch: already patched');
    return;
  }
  if (required) {
    fail('ApplicationError patch: throw pattern not found (bundle shape changed?)');
  } else {
    console.log('[postbuild] ApplicationError patch: no occurrences found (optional target)');
  }
}

patchApplicationError(frontendBundle);

// Also patch secondary-window.js — Theia loads this dynamically when
// opening secondary windows and it contains the same unpatched
// ApplicationError.declare throw. If left unpatched, the secondary
// window module's declare() call throws on code '1' because the
// primary bundle already registered it in the same JS runtime.
const secondaryWindow = path.join(outDir, 'secondary-window.js');
patchInversify(secondaryWindow, { required: false });
patchApplicationError(secondaryWindow, { required: false });

// ── Phase 2: Run terser for whitespace/syntax minification ─
// DISABLED: terser minification corrupts InversifyJS DI bindings by
// renaming service identifiers, causing "No matching bindings found"
// errors at runtime. The esbuild bundle is already tree-shaken and
// reasonably sized; terser's marginal size reduction is not worth
// the runtime failures it introduces.
// See: https://github.com/inversify/InversifyJS/issues/1510
const SKIP_TERSER = true;
if (!SKIP_TERSER && (fs.existsSync(terserBin) || fs.existsSync(terserBin + '.cmd'))) {
  const terserCmd = process.platform === 'win32' ? `"${terserBin}.cmd"` : `"${terserBin}"`;
  const terserArgs = `"${frontendBundle}" -o "${frontendBundle}" -c passes=2 --ecma 2020 --comments false`;
  const cmd = `${terserCmd} ${terserArgs}`;
  console.log(`[postbuild] running terser: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: __dirname, timeout: 300000 });
    console.log('[postbuild] terser completed successfully');
  } catch (err) {
    console.error('[postbuild] terser failed:', err.message);
    process.exit(1);
  }
} else {
  console.log('[postbuild] terser SKIPPED (disabled or not found)');
}

// ── Phase 3: Re-apply patches after terser ──────────────────
// terser may rename variables, so we re-apply the Inversify patch.
patchInversify(frontendBundle);
// Re-apply ApplicationError patch because terser may rename vars.
patchApplicationError(frontendBundle);
// Re-apply patches on secondary-window.js as well.
patchInversify(secondaryWindow, { required: false });
patchApplicationError(secondaryWindow, { required: false });

// Theia's TerminalFrontendContribution.initializeLayout always tries to
// create a default terminal on startup. In the packaged desktop shell this
// can race the in-process backend terminal service and produces a benign
// "terminal <id> does not exist" ERROR even though later terminals work.
// Downgrade only this known startup race to WARN so cold-start logs stay
// actionable; genuine terminal failures still surface when a user opens one.
function patchTerminalInitLog(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn('[postbuild] terminal init log patch: target not found:', filePath);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  const pattern = /console\.error\(("Failed to initialize terminal in default layout"),\s*([A-Za-z_$][\w$]*)\)/g;
  const patchedCount = (content.match(pattern) || []).length;
  if (patchedCount > 0) {
    content = content.replace(pattern, 'console.warn($1, $2)');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[postbuild] terminal init log patch: ${patchedCount} occurrence(s) downgraded to warn`);
  } else {
    // Cosmetic only — do not fail the build if Theia wording drifts.
    console.log('[postbuild] terminal init log patch: no occurrences found');
  }
}

patchTerminalInitLog(frontendBundle);

const backendMain = path.join(__dirname, 'lib', 'backend', 'main.js');

// The esbuild bundle inlines the native module require as part of a
// switch-case statement. The pattern is:
//   case"drivelist":return require("drivelist/build/Release/drivelist.node")
// We replace the require() call with a stub that returns an object
// with a `list` method matching the drivelist API.
// Also accept require('drivelist') / quoted path variants from esbuild.
function patchBackendDrivelist(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`drivelist patch: target not found: ${filePath}`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  const stub = '{ list: function(cb) { cb(null, []); } }';
  const requirePatterns = [
    'require("drivelist/build/Release/drivelist.node")',
    "require('drivelist/build/Release/drivelist.node')",
    'require("drivelist")',
    "require('drivelist')"
  ];
  let hit = false;
  for (const oldRequire of requirePatterns) {
    if (content.includes(oldRequire)) {
      content = content.split(oldRequire).join(stub);
      hit = true;
    }
  }
  if (hit) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('[postbuild] drivelist native binding patched successfully');
    patchState.drivelist = true;
    return;
  }
  if (content.includes(stub) || content.includes('list: function(cb) { cb(null, []); }') || patchState.drivelist) {
    console.log('[postbuild] drivelist: already patched');
    patchState.drivelist = true;
    return;
  }
  if (!/\bdrivelist\b/.test(content)) {
    console.log('[postbuild] drivelist: not referenced in backend bundle');
    patchState.drivelist = true;
    return;
  }
  fail('drivelist: require pattern not found (esbuild emit changed?)');
}
patchBackendDrivelist(backendMain);

// DK-P3-3: required patches must have applied (or been confirmed present).
// Silent miss previously left a broken desktop shell; fail the build hard.
if (!patchState.inversify || !patchState.applicationError || !patchState.drivelist) {
  fail(
    `required patch incomplete: inversify=${patchState.inversify} `
    + `applicationError=${patchState.applicationError} drivelist=${patchState.drivelist}`
  );
}

if (exitCode !== 0) {
  process.exit(exitCode);
}
