'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const workspace = process.env.THEIA_WORKSPACE || path.join(repoRoot, 'tmp', 'kairo-workspace');
const port = process.env.THEIA_PORT || '3000';
const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.THEIA_LOG_LEVEL || (isDevelopment ? 'debug' : undefined);
// Invoke the CLI entrypoint through the current Node binary. Calling the
// generated `.cmd` shim directly raises EINVAL on Windows unless a shell is
// involved; using Node also keeps workspace paths out of shell parsing.
const theiaEntrypoint = require.resolve('@theia/cli/bin/theia.js', { paths: [repoRoot] });

const args = ['start', workspace, '--hostname=127.0.0.1', '--port', String(port)];
if (logLevel) {
  args.push('--log-level', logLevel);
}

/** Fail before loading the full Theia backend when another instance owns the port. */
function ensurePortAvailable(value) {
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65535) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const probe = net.createConnection({ host: '127.0.0.1', port: candidate });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      probe.destroy();
      if (error) reject(error); else resolve();
    };
    probe.once('connect', () => finish(new Error(`EADDRINUSE: Theia port ${candidate} is already in use`)));
    probe.once('error', error => {
      // ECONNREFUSED means no listener exists; all other errors are real
      // preflight failures and should not be hidden by a later Theia trace.
      if (error.code === 'ECONNREFUSED') finish();
      else finish(error);
    });
    probe.setTimeout(1000, () => finish(new Error(`Unable to check Theia port ${candidate}`)));
  });
}

async function main() {
  try {
    await ensurePortAvailable(port);
  } catch (error) {
    console.error(`Failed to start Theia: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, [theiaEntrypoint, ...args], {
    stdio: 'inherit',
    windowsHide: false,
    env: process.env
  });

  let forwardingSignal = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (forwardingSignal || child.killed) {
        return;
      }
      forwardingSignal = true;
      child.kill(signal);
    });
  }

  child.once('error', error => {
    console.error(`Failed to start Theia (${theiaEntrypoint}): ${error.message}`);
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    if (signal && !forwardingSignal) {
      console.error(`Theia exited after signal ${signal}`);
    }
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

void main();
