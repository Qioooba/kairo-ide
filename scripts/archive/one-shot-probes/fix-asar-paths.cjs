#!/usr/bin/env node
/**
 * Fix the asar paths: the @electron/asar package on Windows uses
 * `path.relative()` which produces backslash-separated paths, but
 * the asar format spec requires forward slashes. Electron itself
 * happens to handle backslashes OK for the main entry, but asar's
 * JS API (`extractFile`, `listPackage`) and some Node code paths
 * (e.g. `require('@kairo/protocol/package.json')` or any code
 * that does `fs.readFile('apps/desktop/...')` after the path
 * has been `path.join`'d on Windows) fail with ENOENT.
 *
 * The fix: rewrite the asar header JSON in place, replacing
 * every `\` with `/` in the path keys.
 *
 * asar file layout (as implemented by @electron/asar v3):
 *   1. sizePickle (8 bytes total):
 *      - 4 bytes header (uint32 = payload size = 4)
 *      - 4 bytes payload (uint32 = size of headerPickle in bytes)
 *   2. headerPickle (headerPickleSize bytes total):
 *      - 4 bytes header (uint32 = payload size = JSON byte length)
 *      - payload: the JSON string
 *   3. file content blocks (concatenated, offsets referenced from header)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const asarPath = process.argv[2] || path.join(__dirname, '..', '..', 'dist', 'win-unpacked', 'resources', 'app.asar');
if (!fs.existsSync(asarPath)) {
  console.error('[fix-asar-paths] asar not found:', asarPath);
  process.exit(1);
}

const buf = fs.readFileSync(asarPath);

// Step 1: read size pickle (8 bytes)
const sizePickleHeader = buf.readUInt32LE(0);
if (sizePickleHeader !== 4) {
  console.error('[fix-asar-paths] unexpected size pickle payload size:', sizePickleHeader);
  process.exit(2);
}
const headerPickleSize = buf.readUInt32LE(4);

// Step 2: read header pickle (headerPickleSize bytes starting at offset 8).
// The header pickle layout is:
//   bytes 0-3   : payload size (uint32 LE) = 4 + align(jsonLen, 4)
//   bytes 4-7   : json string length (uint32 LE, written by writeString)
//   bytes 8..8+jsonLen : the JSON string
const headerPickleStart = 8;
const headerPickleEnd = headerPickleStart + headerPickleSize;
const headerPickle = buf.slice(headerPickleStart, headerPickleEnd);
const headerJsonByteLen = headerPickle.readUInt32LE(4); // json string length
const headerJsonStart = 8; // 4 (headerPickle payload size) + 4 (json len prefix)
const headerJsonEnd = headerJsonStart + headerJsonByteLen;

const headerJson = headerPickle.slice(headerJsonStart, headerJsonEnd).toString('utf8');
const header = JSON.parse(headerJson);

let rewritten = 0;
function fixKeys(node) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(fixKeys); return; }
  for (const k of Object.keys(node)) {
    if (k.includes('\\')) {
      const newK = k.replace(/\\/g, '/');
      node[newK] = node[k];
      delete node[k];
      rewritten++;
    }
    fixKeys(node[k]);
  }
}
fixKeys(header);

const newHeaderJson = JSON.stringify(header);
const newHeaderJsonBytes = Buffer.byteLength(newHeaderJson, 'utf8');
if (newHeaderJsonBytes !== headerJsonByteLen) {
  console.error('[fix-asar-paths] header JSON size changed:', headerJsonByteLen, '->', newHeaderJsonBytes, '— refusing to rewrite.');
  process.exit(3);
}

// Rewrite: keep the size pickle and the 4-byte payload-size + 4-byte json-len
// prefix in the header pickle, then overwrite the JSON bytes in place.
const newHeaderJsonBuf = Buffer.from(newHeaderJson, 'utf8');
newHeaderJsonBuf.copy(buf, headerPickleStart + headerJsonStart);

fs.writeFileSync(asarPath, buf);
console.log(`[fix-asar-paths] rewrote ${rewritten} path keys in ${asarPath} (headerPickleSize=${headerPickleSize}, jsonBytes=${headerJsonByteLen})`);
