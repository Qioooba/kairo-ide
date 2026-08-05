#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const WINDOWS_TASKKILL_WATCHDOG_MS = 5_000;
/** Hard ceiling so a mis-set env/arg cannot hang CI forever. */
const MAX_TIMEOUT_SECONDS = 3_600;
/** Default when CLI seconds omitted and KAIRO_TIMEOUT_MS unset (cold builds). */
const DEFAULT_TIMEOUT_SECONDS = 900;

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
  console.error(
    `usage: run-with-timeout.cjs [seconds:1..${MAX_TIMEOUT_SECONDS}] <command> [args...]\n` +
    `       or set KAIRO_TIMEOUT_MS (ms, max ${MAX_TIMEOUT_SECONDS * 1000}) and omit seconds`
  );
  process.exit(2);
}

/**
 * Resolve timeout seconds from CLI argv and/or KAIRO_TIMEOUT_MS.
 * Returns { seconds, command, args } or null if argv cannot be parsed.
 */
function resolveTimeoutArgs(argv = process.argv, env = process.env) {
  const raw = argv.slice(2);
  if (raw.length === 0) return null;

  let seconds;
  let command;
  let args;

  const firstAsNumber = Number(raw[0]);
  if (Number.isInteger(firstAsNumber) && String(firstAsNumber) === raw[0]) {
    seconds = firstAsNumber;
    command = raw[1];
    args = raw.slice(2);
  } else if (env.KAIRO_TIMEOUT_MS != null && env.KAIRO_TIMEOUT_MS !== '') {
    const ms = Number(env.KAIRO_TIMEOUT_MS);
    if (!Number.isFinite(ms) || ms < 1000) return { error: 'KAIRO_TIMEOUT_MS must be >= 1000' };
    seconds = Math.ceil(ms / 1000);
    command = raw[0];
    args = raw.slice(1);
  } else {
    seconds = DEFAULT_TIMEOUT_SECONDS;
    command = raw[0];
    args = raw.slice(1);
  }

  // CLI integer seconds win when present; KAIRO_TIMEOUT_MS is fallback when seconds are omitted.

  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMEOUT_SECONDS || !command) {
    return {
      error: `timeout must be an integer from 1 to ${MAX_TIMEOUT_SECONDS} seconds and command is required`
    };
  }
  return { seconds, command, args };
}

function main(argv = process.argv, platform = process.platform, env = process.env) {
const resolved = resolveTimeoutArgs(argv, env);
if (!resolved || resolved.error) {
  usage(resolved && resolved.error);
}
const { seconds, command, args } = resolved;

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

module.exports = {
  WINDOWS_TASKKILL_WATCHDOG_MS,
  MAX_TIMEOUT_SECONDS,
  DEFAULT_TIMEOUT_SECONDS,
  armWindowsTaskkillWatchdog,
  resolveTimeoutArgs
};
