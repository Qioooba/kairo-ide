#!/usr/bin/env node
/*
 * build-agent.js — Kairo desktop prebuild helper.
 *
 * Replaces `go build -o bin/kairo-runtime` in the desktop package's
 * prebuild script. The reason this exists:
 *
 *   1. Go's `-o` flag does NOT auto-append `.exe` on Windows. So
 *      `go build -o bin/kairo-runtime` produces a binary literally
 *      named `kairo-runtime` — which Node's `child_process.spawn`
 *      refuses to launch on Windows (CreateProcessW returns
 *      ENOENT for extension-less executables). This breaks the
 *      dev-mode flow (N-018 in MILESTONES.md).
 *
 *   2. We want a single command that works on macOS / Linux / Windows
 *      and produces the binary name electron-builder's `extraResources`
 *      expects: `kairo-runtime.exe` on win32, `kairo-runtime` elsewhere.
 *
 *   3. We also want a stable, reproducible build with -trimpath and
 *      CGO disabled (matches the release build flags).
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeAgentDir = path.join(repoRoot, 'runtime-agent');
const binDir = path.join(runtimeAgentDir, 'bin');
const isWin = process.platform === 'win32';
const binName = isWin ? 'kairo-runtime.exe' : 'kairo-runtime';
const outPath = path.join(binDir, binName);

if (!fs.existsSync(runtimeAgentDir)) {
  console.error(`[build-agent] runtime-agent dir not found: ${runtimeAgentDir}`);
  process.exit(1);
}

fs.mkdirSync(binDir, { recursive: true });

console.log(`[build-agent] go build -trimpath -o ${outPath} ./cmd/kairo-runtime`);
const result = spawnSync(
  'go',
  ['build', '-trimpath', '-o', outPath, './cmd/kairo-runtime'],
  {
    cwd: runtimeAgentDir,
    stdio: 'inherit',
    env: { ...process.env, CGO_ENABLED: '0' },
  }
);

if (result.error) {
  console.error(`[build-agent] failed to spawn go: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[build-agent] go build exited with code ${result.status}`);
  process.exit(result.status || 1);
}
if (!fs.existsSync(outPath)) {
  console.error(`[build-agent] go build claimed success but output not found: ${outPath}`);
  process.exit(1);
}

console.log(`[build-agent] built ${outPath} (${fs.statSync(outPath).size} bytes)`);
