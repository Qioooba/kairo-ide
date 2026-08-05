#!/usr/bin/env node
/**
 * Patch @electron/asar to fix the Windows path-separator bug.
 *
 * Bug: `searchNodeFromDirectory` does `p.split(path.sep)`. On
 * Windows, `path.sep` is `\` but `path.dirname()` preserves the
 * separator of the input — so for the input
 * `'apps/desktop/package.json'` (forward slashes, as Electron
 * normalises to) the dirname comes back as
 * `'apps/desktop'` and the split returns a single element,
 * causing the lookup to fail with
 *   "apps/desktop/package.json" was not found in this archive.
 *
 * This used to work on older versions of @electron/asar because
 * `path.dirname` returned backslashes on Windows regardless of
 * input. Node 22.16+ changed that behaviour: dirname now keeps the
 * input's separator.
 *
 * Fix: split the directory by BOTH '/' and '\' so we always
 *      descend through the path components.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  '..',
  'node_modules',
  '.pnpm',
  '@electron+asar@3.4.1',
  'node_modules',
  '@electron',
  'asar',
  'lib',
  'filesystem.js',
);

if (!fs.existsSync(target)) {
  console.error('[patch-asar-fs] cannot find', target);
  process.exit(1);
}

let src = fs.readFileSync(target, 'utf8');

const before = `    searchNodeFromDirectory(p) {
        let json = this.header;
        const dirs = p.split(path.sep);
        for (const dir of dirs) {`;

const after = `    searchNodeFromDirectory(p) {
        let json = this.header;
        // KAIRO-FIX-WIN: split by both / and \ so asar lookups work
        // when the input path uses forward slashes (the case on
        // Windows when Electron normalises via path.posix) but
        // path.sep is '\\'.
        const dirs = p.split(/[\\\\/]+/).filter(Boolean);
        for (const dir of dirs) {`;

if (!src.includes(before)) {
  console.error('[patch-asar-fs] cannot locate searchNodeFromDirectory in', target);
  process.exit(2);
}
if (src.includes('KAIRO-FIX-WIN')) {
  console.log('[patch-asar-fs] already patched');
  process.exit(0);
}

src = src.replace(before, after);
fs.writeFileSync(target, src, 'utf8');
console.log('[patch-asar-fs] patched', target);
