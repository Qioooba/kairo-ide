#!/usr/bin/env node
// apps/desktop/scripts/copy-bundled.js
// Mirror the project's `bundled/` directory (populated by
// `pnpm bundled:prepare`) into `apps/desktop/bundled/` so that
// electron-builder picks it up via the `files` glob in
// `apps/desktop/package.json` and ships it inside the NSIS
// installer. Electron-builder's `files` globs cannot traverse
// above the package's own directory, so the project-root
// `bundled/` has to be copied into the desktop package's tree
// first.
//
// Behaviour:
//   * Only the supply-chain-approved runtime directory names are copied.
//   * If `bundled/` at the project root is empty or missing,
//     we log a warning and exit 0 — packaging still succeeds
//     and the runtime falls back to first-run download.
//   * If `apps/desktop/bundled/` already contains the same
//     files, we still refresh (cheap copy of a small tree).
//   * We never copy `bundled/.gitkeep` or `bundled/README.md`
//     into the installer (no value to the end user).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const src = path.join(repoRoot, 'bundled');
const dst = path.join(__dirname, '..', 'bundled');
const approvedDirectories = ['tomcat6', 'jdtls'];

if (!fs.existsSync(src)) {
  console.log(`[copy-bundled] WARN: ${src} does not exist — runtime will fall back to first-run download`);
  process.exit(0);
}

const entries = new Map(fs.readdirSync(src, { withFileTypes: true }).map(entry => [entry.name, entry]));
const realDirs = approvedDirectories
  .map(name => entries.get(name))
  .filter(entry => entry?.isDirectory());
if (realDirs.length === 0) {
  console.log(`[copy-bundled] WARN: ${src} is empty — runtime will fall back to first-run download`);
  process.exit(0);
}

fs.mkdirSync(dst, { recursive: true });
// Clean dst to avoid stale files.
for (const e of fs.readdirSync(dst, { withFileTypes: true })) {
  const p = path.join(dst, e.name);
  fs.rmSync(p, { recursive: true, force: true });
}

let copied = 0;
for (const dirent of realDirs) {
  const from = path.join(src, dirent.name);
  const to = path.join(dst, dirent.name);
  // Recursive copy via cpSync (Node 16.7+).
  fs.cpSync(from, to, { recursive: true, dereference: false });

  // Prune tomcat6: remove docs, examples, and other non-runtime files.
  // Saves ~3.8 MB from the zip package.
  if (dirent.name === 'tomcat6') {
    const tomcatDir = path.join(to, 'apache-tomcat-6.0.53');
    if (fs.existsSync(tomcatDir)) {
      const pruneDirs = [
        'webapps/docs',
        'webapps/examples',
        'webapps/host-manager',
        'webapps/manager',
      ];
      for (const prune of pruneDirs) {
        const prunePath = path.join(tomcatDir, prune);
        if (fs.existsSync(prunePath)) {
          fs.rmSync(prunePath, { recursive: true, force: true });
          console.log(`[copy-bundled] pruned: ${prune}`);
        }
      }
      // Also remove source JARs if present in lib/
      const libDir = path.join(tomcatDir, 'lib');
      if (fs.existsSync(libDir)) {
        for (const f of fs.readdirSync(libDir)) {
          if (f.endsWith('-sources.jar') || f.endsWith('-javadoc.jar')) {
            fs.rmSync(path.join(libDir, f), { force: true });
            console.log(`[copy-bundled] pruned: lib/${f}`);
          }
        }
      }
    }
  }

  copied += 1;
  console.log(`[copy-bundled] ${from} -> ${to}`);
}
console.log(`[copy-bundled] OK: ${copied} bundled dir(s) staged for packaging`);
