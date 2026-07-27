#!/usr/bin/env node
// Helper to launch the packaged Kairo IDE.exe with proper env and log
// the output. Used for debugging startup issues without going through
// the full Playwright flow.
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..', '..');
const exe = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
const logFile = path.join(repoRoot, 'artifacts', 'e2e-windows', 'desktop-main.log');
const userData = path.join(repoRoot, 'artifacts', 'e2e-windows', 'userdata');

if (!fs.existsSync(exe)) {
  console.error('exe not found:', exe);
  process.exit(1);
}

fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.mkdirSync(userData, { recursive: true });

// Truncate the log file so we see only this run.
fs.writeFileSync(logFile, '');

const env = {
  ...process.env,
  KAIRO_DESKTOP_LOG_FILE: logFile,
  KAIRO_DEV: '1',
  KAIRO_NO_DEVTOOLS: '0',
};

const args = [
  `--user-data-dir=${userData}`,
  '--remote-debugging-port=9223',
];

console.log('Launching:', exe);
console.log('Args:', args);
console.log('Log file:', logFile);
console.log('User data dir:', userData);

const child = spawn(exe, args, { env, stdio: 'inherit' });

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  console.log('Got SIGINT, killing Kairo IDE...');
  child.kill();
  process.exit(0);
});

child.on('exit', (code, signal) => {
  console.log(`Kairo IDE exited with code=${code} signal=${signal}`);
  process.exit(code || 0);
});
