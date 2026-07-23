#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// ---- helpers ----

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = fs.readSync(fd, buf, 0, buf.length, null);
      if (bytes === 0) break;
      hash.update(buf.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function collectFileMap(dir) {
  const map = new Map();
  const entries = [];
  try { entries.push(...fs.readdirSync(dir, { withFileTypes: true })); } catch { return map; }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      const subMap = collectFileMap(full);
      for (const [rel, hash] of subMap) {
        map.set(rel, hash);
      }
    } else if (entry.isFile()) {
      const rel = path.relative(dir, full);
      const hash = sha256File(full);
      map.set(rel, hash);
    }
  }
  return map;
}

// ---- comparison ----

function compareBuilds(dirA, dirB) {
  const labelA = path.relative(ROOT, dirA);
  const labelB = path.relative(ROOT, dirB);

  if (!fs.existsSync(dirA)) {
    console.error(`[repro] build A does not exist: ${labelA}`);
    return { ok: false, error: `build A missing: ${labelA}` };
  }
  if (!fs.existsSync(dirB)) {
    console.error(`[repro] build B does not exist: ${labelB}`);
    return { ok: false, error: `build B missing: ${labelB}` };
  }

  console.log(`[repro] scanning ${labelA} ...`);
  const mapA = collectFileMap(dirA);
  console.log(`[repro] scanning ${labelB} ...`);
  const mapB = collectFileMap(dirB);

  const identical = [];
  const different = [];
  const onlyA = [];
  const onlyB = [];

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const key of allKeys.sort()) {
    const hashA = mapA.get(key);
    const hashB = mapB.get(key);

    if (hashA === undefined) {
      onlyB.push(key);
    } else if (hashB === undefined) {
      onlyA.push(key);
    } else if (hashA === hashB) {
      identical.push(key);
    } else {
      different.push({ file: key, hashA, hashB });
    }
  }

  const totalA = mapA.size;
  const totalB = mapB.size;
  const ok = different.length === 0 && onlyA.length === 0 && onlyB.length === 0;

  return {
    ok,
    stats: { totalA, totalB, identical: identical.length, different: different.length, onlyA: onlyA.length, onlyB: onlyB.length },
    identical,
    different,
    onlyA,
    onlyB
  };
}

// ---- main ----

function main() {
  const dirA = option('--build-a');
  const dirB = option('--build-b');

  if (!dirA || !dirB) {
    console.error('usage: verify-reproducible.cjs --build-a <path> --build-b <path>');
    console.error('  compares two build directories to verify reproducible builds');
    process.exit(2);
  }

  const resolvedA = path.resolve(dirA);
  const resolvedB = path.resolve(dirB);

  const result = compareBuilds(resolvedA, resolvedB);

  if (result.error) {
    process.exit(1);
  }

  const { stats } = result;
  console.log(`\n[repro] comparison results:`);
  console.log(`  Build A: ${stats.totalA} files`);
  console.log(`  Build B: ${stats.totalB} files`);
  console.log(`  Identical: ${stats.identical}`);
  console.log(`  Different: ${stats.different}`);
  console.log(`  Only in A: ${stats.onlyA}`);
  console.log(`  Only in B: ${stats.onlyB}`);

  if (result.different.length > 0) {
    console.log(`\n[repro] files with different content:`);
    for (const d of result.different.slice(0, 20)) {
      console.log(`  ${d.file}`);
      console.log(`    A: ${d.hashA}`);
      console.log(`    B: ${d.hashB}`);
    }
    if (result.different.length > 20) {
      console.log(`  ... and ${result.different.length - 20} more`);
    }
  }

  if (result.onlyA.length > 0) {
    console.log(`\n[repro] files only in build A (${result.onlyA.length}):`);
    for (const f of result.onlyA.slice(0, 10)) {
      console.log(`  ${f}`);
    }
    if (result.onlyA.length > 10) {
      console.log(`  ... and ${result.onlyA.length - 10} more`);
    }
  }

  if (result.onlyB.length > 0) {
    console.log(`\n[repro] files only in build B (${result.onlyB.length}):`);
    for (const f of result.onlyB.slice(0, 10)) {
      console.log(`  ${f}`);
    }
    if (result.onlyB.length > 10) {
      console.log(`  ... and ${result.onlyB.length - 10} more`);
    }
  }

  if (result.ok) {
    console.log('\n[repro] PASS: builds are identical');
    process.exit(0);
  } else {
    console.log('\n[repro] FAIL: builds are not identical');
    process.exit(1);
  }
}

main();