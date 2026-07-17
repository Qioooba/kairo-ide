/**
 * Kairo IDE — desktop main process.
 *
 * On launch, this:
 *   1. Starts the Go Runtime Agent as a child process.
 *   2. Opens an Electron BrowserWindow pointing at the local
 *      Theia app on the same port.
 *   3. Tears down the agent on quit.
 *
 * The agent is the security boundary; the BrowserWindow is
 * sandboxed.
 */

import { app, BrowserWindow, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

const KAIRO_VERSION = '0.1.0';
const RUNTIME_PORT = 18099;
const THEIA_PORT = 3000;
let runtimeProc: ChildProcess | undefined;

function runtimeBinary(): string {
  const resourcesBin = join(process.resourcesPath || '', 'bin');
  const candidates = process.platform === 'win32'
    ? [join(resourcesBin, 'kairo-runtime.exe'), join(__dirname, '..', 'bin', 'kairo-runtime.exe')]
    : [join(resourcesBin, 'kairo-runtime'), join(__dirname, '..', 'bin', 'kairo-runtime')];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Last resort: assume the dev layout has the binary in ../../runtime-agent/bin/.
  return join(__dirname, '..', '..', '..', 'runtime-agent', 'bin', 'kairo-runtime');
}

async function startRuntime(): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = runtimeBinary();
    runtimeProc = spawn(bin, [
      '--bind', '127.0.0.1',
      '--port', String(RUNTIME_PORT),
      '--log-level', 'info',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, KAIRO_DESKTOP: '1' },
    });
    runtimeProc.stdout?.on('data', (chunk) => process.stdout.write(`[runtime] ${chunk}`));
    runtimeProc.stderr?.on('data', (chunk) => process.stderr.write(`[runtime] ${chunk}`));
    runtimeProc.on('error', reject);
    runtimeProc.on('exit', (code) => {
      console.error(`[kairo] runtime exited with code ${code}`);
      runtimeProc = undefined;
    });
    // Poll /api/v1/health until the agent answers.
    const start = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/v1/health`);
        if (res.ok) return resolve();
      } catch (_) { /* not yet */ }
      if (Date.now() - start > 15_000) return reject(new Error('runtime did not start in 15s'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: `Kairo IDE ${KAIRO_VERSION}`,
    backgroundColor: '#1e1f22',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // We will eventually serve a built bundle from the
      // local theia product. For v1 we expect the user to
      // run `pnpm --filter @kairo/browser start` separately
      // and connect to it via dev tools.
      preload: undefined,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // External links open in the system browser, not inside
    // our app shell.
    shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`http://127.0.0.1:${THEIA_PORT}/`);
}

app.on('ready', async () => {
  try {
    await startRuntime();
    await createWindow();
  } catch (err) {
    console.error('failed to start kairo:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (runtimeProc) {
    runtimeProc.kill('SIGTERM');
    setTimeout(() => runtimeProc?.kill('SIGKILL'), 5_000);
  }
});
