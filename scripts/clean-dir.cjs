#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/clean-dir.cjs <path> [...paths]');
  process.exit(2);
}

for (const target of targets) {
  // Resolve relative to the package that invoked the script.  Refuse broad
  // roots so a malformed package script cannot erase the repository itself.
  const resolved = path.resolve(process.cwd(), target);
  const cwd = path.resolve(process.cwd());
  if (resolved === path.parse(resolved).root || resolved === cwd) {
    throw new Error(`Refusing to remove broad path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
