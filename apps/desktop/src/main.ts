/**
 * Kairo IDE — desktop main process.
 *
 * On launch, this:
 *   1. Finds a free port and generates a local auth secret.
 *   2. Starts the Go Runtime Agent as a child process with
 *      dynamic port and secret.
 *   3. Starts the Theia backend as a child process, passing
 *      the agent URL and secret via environment variables.
 *   4. Opens an Electron BrowserWindow pointing at the local
 *      Theia app. The preload script exposes the agent config
 *      via contextBridge before the page loads.
 *   5. Tears down the agent and Theia backend on quit.
 *
 * The agent is the security boundary; the BrowserWindow uses
 * contextIsolation with a preload script.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { findFreePort } from '@kairo/protocol';
import { randomBytes } from 'crypto';

let agentProcess: ChildProcess | null = null;
let agentPort: number = 0;
let agentSecret: string = '';
let theiaProcess: ChildProcess | null = null;
let theiaPort: number = 0;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// ─── Secret Generation ────────────────────────────────────────

function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

// ─── Agent Lifecycle ──────────────────────────────────────────

function resolveAgentPath(): string {
  // Allow operators to override the binary location (e.g. local dev or
  // custom install layouts). When unset, fall back to the packaged
  // extraResources location (or monorepo-local Go build output in dev).
  if (process.env.KAIRO_AGENT_PATH) {
    return process.env.KAIRO_AGENT_PATH;
  }

  const binaryName = process.platform === 'win32' ? 'kairo-runtime.exe' : 'kairo-runtime';

  // Packaged build: extraResources puts the binary at <resourcesPath>/bin/.
  // process.resourcesPath in this mode points to the install dir's resources
  // folder, which is NOT inside the Electron install tree.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', binaryName);
  }

  // Dev mode: process.resourcesPath points inside the Electron install
  // tree (node_modules/.pnpm/electron@*/.../resources), so the packaged
  // layout does not exist. Fall back to the monorepo-local Go build
  // output, which the desktop package's prebuild script produces.
  // apps/desktop/lib/main.js → ../../runtime-agent/bin/kairo-runtime[.exe]
  const devDir = path.resolve(__dirname, '..', '..', '..', 'runtime-agent', 'bin');
  const candidates = process.platform === 'win32'
    // Go on Windows usually writes `kairo-runtime.exe`, but `go build -o
    // bin/kairo-runtime` in some toolchains (e.g. cross-compile, mingw)
    // drops the suffix. Try both.
    ? [binaryName, binaryName.replace(/\.exe$/i, '')]
    : [binaryName];
  for (const name of candidates) {
    const devPath = path.join(devDir, name);
    if (fs.existsSync(devPath)) {
      return devPath;
    }
  }

  throw new Error(
    `Cannot locate kairo-runtime binary in dev mode. Searched in: ${devDir} ` +
    `(candidates: ${candidates.join(', ')}). Either run the desktop prebuild ` +
    `(pnpm --filter @kairo/desktop build) or set KAIRO_AGENT_PATH to the binary location.`
  );
}

async function startAgent(dataDir: string): Promise<{ port: number; secret: string }> {
  const port = await findFreePort();
  const secret = generateSecret();
  const agentPath = resolveAgentPath();

  console.log(`[kairo] Starting agent: ${agentPath} --port ${port}`);

  agentProcess = spawn(agentPath, [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--data-dir', dataDir,
    '--log-level', 'info',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      KAIRO_DESKTOP: '1',
      KAIRO_LOCAL_SECRET: secret,
    },
  });

  agentProcess.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(`[agent] ${data}`);
  });

  agentProcess.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(`[agent] ${data}`);
  });

  agentProcess.on('error', (err: Error) => {
    console.error(`[kairo] Agent process error: ${err.message}`);
    // Don't throw in event handler — the Promise will reject via health check
  });

  agentProcess.on('exit', (code: number | null, signal: string | null) => {
    if (!isQuitting) {
      console.error(`[kairo] Agent exited unexpectedly with code ${code}, signal ${signal}`);
    }
    agentProcess = null;
  });

  // Wait for health check
  const healthURL = `http://127.0.0.1:${port}/api/v1/health`;
  const startTime = Date.now();
  const timeout = 15_000;

  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (!agentProcess) {
        reject(new Error('Agent process died before health check'));
        return;
      }
      const req = http.get(healthURL, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          retryOrReject(new Error(`Health check returned status ${res.statusCode}`));
        }
      });
      req.on('error', (err: Error) => {
        retryOrReject(err);
      });
      req.setTimeout(2_000, () => {
        req.destroy();
        retryOrReject(new Error('Health check request timed out'));
      });
    };

    const retryOrReject = (err: Error) => {
      if (Date.now() - startTime > timeout) {
        reject(new Error('Agent health check timed out after ' + timeout + 'ms: ' + err.message));
        return;
      }
      setTimeout(check, 300);
    };

    check();
  });

  agentPort = port;
  agentSecret = secret;
  console.log(`[kairo] Agent healthy on port ${port}`);
  return { port, secret };
}

function stopAgent(): void {
  if (agentProcess && !agentProcess.killed) {
    console.log('[kairo] Stopping agent...');
    agentProcess.kill('SIGTERM');
    setTimeout(() => {
      if (agentProcess && !agentProcess.killed) {
        agentProcess.kill('SIGKILL');
      }
    }, 5_000);
  }
}

// ─── Theia Backend ────────────────────────────────────────────

async function startTheiaBackend(): Promise<number> {
  const port = await findFreePort();

  // Theia backend entry, copied from apps/browser/lib/backend/main.js
  // into apps/desktop/lib/backend/main.js by copy-browser-artifacts.js.
  const theiaEntry = path.join(__dirname, 'backend', 'main.js');

  console.log(`[kairo] Starting Theia backend: ${theiaEntry} on port ${port}`);

  theiaProcess = spawn(process.execPath, [theiaEntry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Run Electron as plain Node.js so the Theia backend can use
      // require() / CommonJS without the Chromium runtime overhead.
      ELECTRON_RUN_AS_NODE: '1',
      // The Theia backend binds to THEIA_PORT. The value is also
      // surfaced via the runtime agent's /api/v1/endpoints response
      // (see docs/hotfix-windows-test-readiness.md §2) so the renderer
      // discovers it dynamically.
      THEIA_PORT: String(port),
      KAIRO_AGENT_URL: `http://127.0.0.1:${agentPort}`,
      KAIRO_AGENT_SECRET: agentSecret,
    },
  });

  theiaProcess.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(`[theia] ${data}`);
  });

  theiaProcess.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(`[theia] ${data}`);
  });

  theiaProcess.on('error', (err: Error) => {
    console.error(`[kairo] Theia process error: ${err.message}`);
  });

  theiaProcess.on('exit', (code: number | null, signal: string | null) => {
    if (!isQuitting) {
      console.error(`[kairo] Theia backend exited unexpectedly with code ${code}, signal ${signal}`);
    }
    theiaProcess = null;
  });

  // Wait for Theia to be ready
  const healthURL = `http://127.0.0.1:${port}`;
  const startTime = Date.now();
  const timeout = 30_000;

  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (!theiaProcess) {
        reject(new Error('Theia process died before becoming ready'));
        return;
      }
      const req = http.get(healthURL, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          retryOrReject(new Error(`Theia returned status ${res.statusCode}`));
        }
      });
      req.on('error', () => {
        retryOrReject(new Error('Theia not ready yet'));
      });
      req.setTimeout(3_000, () => {
        req.destroy();
        retryOrReject(new Error('Theia health check timed out'));
      });
    };

    const retryOrReject = (err: Error) => {
      if (Date.now() - startTime > timeout) {
        reject(new Error('Theia backend timed out after ' + timeout + 'ms: ' + err.message));
        return;
      }
      setTimeout(check, 500);
    };

    check();
  });

  theiaPort = port;
  console.log(`[kairo] Theia backend ready on port ${port}`);
  return port;
}

function stopTheiaBackend(): void {
  if (theiaProcess && !theiaProcess.killed) {
    console.log('[kairo] Stopping Theia backend...');
    theiaProcess.kill('SIGTERM');
    setTimeout(() => {
      if (theiaProcess && !theiaProcess.killed) {
        theiaProcess.kill('SIGKILL');
      }
    }, 5_000);
  }
}

// ─── IPC ──────────────────────────────────────────────────────

// Handle renderer ready signal.
ipcMain.on('renderer-ready', () => {
  console.log('[kairo] renderer process is ready');
});

// Send menu actions to the renderer process.
function sendMenuAction(action: string): void {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', action);
  }
}

// ─── Window Creation ──────────────────────────────────────────

async function createWindow(): Promise<void> {
  // Set env vars in the main process so the preload script can read them
  process.env.KAIRO_AGENT_URL = `http://127.0.0.1:${agentPort}`;
  process.env.KAIRO_AGENT_SECRET = agentSecret;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Kairo IDE',
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for preload to access Node APIs
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      } else {
        console.warn('[kairo] refusing to open URL with scheme:', u.protocol);
      }
    } catch {
      console.warn('[kairo] refusing to open malformed URL:', url);
    }
    return { action: 'deny' };
  });

  // Config is injected BEFORE the page loads via the preload script.
  // No executeJavaScript — avoids the race condition.
  await mainWindow.loadURL(`http://127.0.0.1:${theiaPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ────────────────────────────────────────────

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('ready', async () => {
    // Set CSP before creating any windows.
    app.on('session-created', (session) => {
      session.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
            ].join('; '),
          },
        });
      });
    });

    try {
      const dataDir = path.join(app.getPath('userData'), 'kairo-data');
      fs.mkdirSync(dataDir, { recursive: true });

      // Start Go Agent
      const { port, secret } = await startAgent(dataDir);

      // Start Theia Backend
      await startTheiaBackend();

      // Create window — config is passed via env to preload
      createWindow();

    } catch (err: any) {
      console.error('[kairo] Failed to start:', err);
      dialog.showErrorBox('Kairo IDE Error',
        `Failed to start Kairo IDE:\n${err.message}\n\nPlease check the console for details.`);
      stopTheiaBackend();
      stopAgent();
      app.quit();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopTheiaBackend();
    stopAgent();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    }
  });
}

// Best-effort cleanup on process exit
process.on('exit', () => {
  if (agentProcess && !agentProcess.killed) {
    try { agentProcess.kill('SIGKILL'); } catch { /* already gone */ }
  }
  if (theiaProcess && !theiaProcess.killed) {
    try { theiaProcess.kill('SIGKILL'); } catch { /* already gone */ }
  }
});