#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const WINDOWS_TASKKILL_WATCHDOG_MS = 5_000;

function armWindowsTaskkillWatchdog(taskkill, child, exit, delayMs = WINDOWS_TASKKILL_WATCHDOG_MS) {
  let settled = false;
  let watchdog;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    exit(124);
  };
  taskkill.once('error', () => {
    try { child.kill('SIGKILL'); } catch {}
    finish();
  });
  taskkill.once('exit', finish);
  watchdog = setTimeout(() => {
    console.error(`[timeout] taskkill exceeded ${delayMs}ms; forcing runner shutdown`);
    try { taskkill.kill('SIGKILL'); } catch {}
    try { child.kill('SIGKILL'); } catch {}
    finish();
  }, delayMs);
  return watchdog;
}

function usage(message) {
  if (message) console.error(`[timeout] ERROR: ${message}`);
  console.error('usage: run-with-timeout.cjs <seconds:1..300> <command> [args...]');
  process.exit(2);
}

function main(argv = process.argv, platform = process.platform) {
const seconds = Number(argv[2]);
const command = argv[3];
const args = argv.slice(4);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300 || !command) {
  usage('timeout must be an integer from 1 to 300 seconds and command is required');
}

const isWindows = platform === 'win32';
// On POSIX, a detached child becomes leader of a new process group. Killing
// that group prevents pnpm/go grandchildren from surviving a timed-out gate.
const child = spawn(command, args, {
  stdio: 'inherit', shell: false, windowsHide: true, detached: !isWindows
});
let timedOut = false;

function killPosixGroup(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(`[timeout] cannot send ${signal} to process group ${child.pid}: ${error.message}`);
  }
}

const timer = setTimeout(() => {
  timedOut = true;
  console.error(`[timeout] ${command} exceeded ${seconds}s; terminating process ${child.pid}`);
  if (isWindows) {
    const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    armWindowsTaskkillWatchdog(taskkill, child, code => process.exit(code));
  } else {
    killPosixGroup('SIGTERM');
    // Keep the runner alive for the grace period even when the direct child
    // exits first; a stubborn grandchild still belongs to the same group.
    setTimeout(() => {
      killPosixGroup('SIGKILL');
      process.exit(124);
    }, 1_000);
  }
}, seconds * 1_000);

child.on('error', error => {
  clearTimeout(timer);
  console.error(`[timeout] failed to start ${command}: ${error.message}`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (timedOut) return;
  if (signal) {
    console.error(`[timeout] ${command} terminated by ${signal}`);
    process.exit(128);
  }
  process.exit(code === null ? 1 : code);
});
}

if (require.main === module) main();

module.exports = { WINDOWS_TASKKILL_WATCHDOG_MS, armWindowsTaskkillWatchdog };
