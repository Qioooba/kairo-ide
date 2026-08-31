#!/usr/bin/env node
/** Run the complete Runtime Agent test suite on every platform. */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const flags = new Set(process.argv.slice(2));
const unknown = [...flags].filter(flag => flag !== '--race' && flag !== '--integration');
if (unknown.length > 0) {
  console.error(`[test-agent] unsupported option(s): ${unknown.join(', ')}`);
  process.exit(2);
}

const args = ['test', '-count=1'];
if (flags.has('--race')) {
  args.push('-race');
}
if (flags.has('--integration')) {
  args.push('-tags', 'integration');
}
args.push('-timeout', flags.has('--race') ? '300s' : '180s', './...');

console.log(`[test-agent] go ${args.join(' ')}`);
const result = spawnSync('go', args, {
  cwd: path.join(repoRoot, 'runtime-agent'),
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`[test-agent] failed to start go: ${result.error.message}`);
}
process.exit(result.status ?? 1);
