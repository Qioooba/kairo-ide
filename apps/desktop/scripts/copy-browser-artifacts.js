#!/usr/bin/env node
/*
 * copy-browser-artifacts.js
 *
 * Copies the Theia browser app's compiled frontend and backend into
 * apps/desktop/lib/{frontend,backend} so that electron-builder picks
 * them up when packaging the Electron app.
 *
 * Run automatically via the `prebuild` and `prestart` scripts in
 * apps/desktop/package.json. Can also be invoked directly:
 *
 *   node apps/desktop/scripts/copy-browser-artifacts.js
 *   node apps/desktop/scripts/copy-browser-artifacts.js --dry-run
 *   node apps/desktop/scripts/copy-browser-artifacts.js --strict
 *
 * Layout after copy:
 *   apps/desktop/lib/frontend/  <- apps/browser/lib/frontend/
 *   apps/desktop/lib/backend/   <- apps/browser/lib/backend/
 *   apps/desktop/lib/prebuilds/ <- apps/browser/lib/prebuilds/  (node-pty conpty natives)
 *
 * Source paths that do not exist (e.g. before `pnpm --filter @kairo/browser build`)
 * are skipped with a warning so the dev loop doesn't fail on partial state.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');

const SCRIPT_DIR = __dirname;
const DESKTOP_PKG_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(DESKTOP_PKG_DIR, '..', '..');

const BROWSER_FRONTEND_SRC = path.join(REPO_ROOT, 'apps', 'browser', 'lib', 'frontend');
const BROWSER_BACKEND_SRC = path.join(REPO_ROOT, 'apps', 'browser', 'lib', 'backend');
const BROWSER_PREBUILDS_SRC = path.join(REPO_ROOT, 'apps', 'browser', 'lib', 'prebuilds');
const DESKTOP_FRONTEND_DST = path.join(DESKTOP_PKG_DIR, 'lib', 'frontend');
const DESKTOP_BACKEND_DST = path.join(DESKTOP_PKG_DIR, 'lib', 'backend');
const DESKTOP_PREBUILDS_DST = path.join(DESKTOP_PKG_DIR, 'lib', 'prebuilds');

function log(msg) {
  console.log(`[copy-browser-artifacts] ${msg}`);
}

function copyRecursive(src, dst) {
  if (!fs.existsSync(src)) {
    log(`WARN source missing, skipping: ${src}`);
    return { copied: 0, skipped: true };
  }

  if (DRY_RUN) {
    log(`DRY-RUN mkdir -p ${dst}`);
  } else {
    fs.mkdirSync(dst, { recursive: true });
  }

  let count = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      const sub = copyRecursive(s, d);
      count += sub.copied;
    } else if (entry.isFile()) {
      if (DRY_RUN) {
        log(`DRY-RUN cp ${s} -> ${d}`);
      } else {
        fs.copyFileSync(s, d);
        log(`cp ${s} -> ${d}`);
      }
      count += 1;
    }
  }
  return { copied: count, skipped: false };
}

function main() {
  const mode = DRY_RUN ? 'dry-run' : 'copy';
  log(`mode=${mode}`);
  log(`repo root: ${REPO_ROOT}`);

  if (STRICT) {
    for (const source of [BROWSER_FRONTEND_SRC, BROWSER_BACKEND_SRC]) {
      if (!fs.existsSync(source) || fs.readdirSync(source).length === 0) {
        throw new Error(`strict mode requires a non-empty browser build output: ${source}`);
      }
    }
    // node-pty ConPTY natives: required for Windows terminal in packaged builds.
    const conptyMarker = path.join(BROWSER_PREBUILDS_SRC, 'win32-x64', 'conpty.node');
    if (process.platform === 'win32' && !fs.existsSync(conptyMarker)) {
      throw new Error(`strict mode requires node-pty prebuilds: ${conptyMarker}`);
    }
    if (!DRY_RUN) {
      fs.rmSync(DESKTOP_FRONTEND_DST, { recursive: true, force: true });
      fs.rmSync(DESKTOP_BACKEND_DST, { recursive: true, force: true });
      fs.rmSync(DESKTOP_PREBUILDS_DST, { recursive: true, force: true });
    }
  }

  log(`frontend: ${BROWSER_FRONTEND_SRC} -> ${DESKTOP_FRONTEND_DST}`);
  const fe = copyRecursive(BROWSER_FRONTEND_SRC, DESKTOP_FRONTEND_DST);

  log(`backend:  ${BROWSER_BACKEND_SRC} -> ${DESKTOP_BACKEND_DST}`);
  const be = copyRecursive(BROWSER_BACKEND_SRC, DESKTOP_BACKEND_DST);

  log(`prebuilds: ${BROWSER_PREBUILDS_SRC} -> ${DESKTOP_PREBUILDS_DST}`);
  const pb = copyRecursive(BROWSER_PREBUILDS_SRC, DESKTOP_PREBUILDS_DST);

  const total = fe.copied + be.copied + pb.copied;
  if (fe.skipped && be.skipped) {
    log(`no browser artifacts found; nothing copied. Build @kairo/browser first.`);
  } else {
    log(`done (${total} files${DRY_RUN ? ' would be' : ''} ${DRY_RUN ? 'copied' : 'copied'})`);
    if (pb.skipped) {
      log(`WARN prebuilds missing — Windows terminal (node-pty/conpty) may fail in packaged builds`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`[copy-browser-artifacts] FAILED: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
