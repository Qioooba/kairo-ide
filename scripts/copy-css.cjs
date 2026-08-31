#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [sourceDir, targetDir] = process.argv.slice(2);
if (!sourceDir || !targetDir) {
  console.error('Usage: node scripts/copy-css.cjs <source-dir> <target-dir>');
  process.exit(2);
}
const source = path.resolve(process.cwd(), sourceDir);
const target = path.resolve(process.cwd(), targetDir);
if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
  throw new Error(`CSS source directory is missing: ${source}`);
}
const files = fs.readdirSync(source).filter(name => name.toLowerCase().endsWith('.css'));
if (files.length === 0) throw new Error(`No CSS files found in ${source}`);
fs.mkdirSync(target, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(source, file), path.join(target, file));
