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

// File-based logger. Electron on Windows detaches from the parent's
// stdout when launched as a GUI app, which makes `pnpm start | tee`
// unreliable for debugging. This mirrors every console.log/warn/error
// to artifacts/desktop-main.log so we can post-mortem the launch.
let mainLogPath: string | undefined;
function flog(...args: unknown[]): void {
  const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  if (mainLogPath) {
    try {
      fs.appendFileSync(mainLogPath, text + '\n');
    } catch { /* log dir gone; just skip */ }
  }
}

function initFileLogger(): void {
  if (process.env.KAIRO_DESKTOP_LOG_FILE) {
    mainLogPath = process.env.KAIRO_DESKTOP_LOG_FILE;
  } else {
    // Default to <repo>/artifacts/desktop-main.log when present,
    // otherwise a temp path. Falling back to a temp path is fine
    // because the only caller passing nothing is the packaged
    // build, where the OS log facility takes over.
    const candidate = path.join(__dirname, '..', '..', '..', 'artifacts', 'desktop-main.log');
    try {
      fs.mkdirSync(path.dirname(candidate), { recursive: true });
      mainLogPath = candidate;
    } catch {
      mainLogPath = undefined;
    }
  }
  // Mirror console to file for the lifetime of the main process.
  const wrap = (orig: (...a: unknown[]) => void) => (...args: unknown[]) => {
    orig.apply(console, args);
    flog(...args);
  };
  console.log = wrap(console.log);
  console.warn = wrap(console.warn);
  console.error = wrap(console.error);
  console.info = wrap(console.info);
}

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
  // Theia backend entry, copied from apps/browser/lib/backend/main.js
  // into apps/desktop/lib/backend/main.js by copy-browser-artifacts.js.
  const theiaEntry = path.join(__dirname, 'backend', 'main.js');

  // We do NOT pre-allocate a port for Theia because the bundle
  // entry that we spawn directly does not parse theia CLI argv on
  // its own — it ignores THEIA_PORT (and any --port flag we pass)
  // and binds to a port Theia itself picks (often a random
  // ephemeral port, surfaced only via the "Theia app listening
  // on http://127.0.0.1:NNN" log line). See MILESTONES.md N-021.
  // We therefore spawn Theia, then discover the port from its
  // stdout/stderr logs, then health-check that port.
  console.log(`[kairo] Starting Theia backend: ${theiaEntry}`);

  theiaProcess = spawn(process.execPath, [theiaEntry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Run Electron as plain Node.js so the Theia backend can use
      // require() / CommonJS without the Chromium runtime overhead.
      ELECTRON_RUN_AS_NODE: '1',
      KAIRO_AGENT_URL: `http://127.0.0.1:${agentPort}`,
      KAIRO_AGENT_SECRET: agentSecret,
    },
  });

  // Capture stdout/stderr to find the port Theia picked. Theia
  // logs `... listening on http://127.0.0.1:NNNN.` (or similar)
  // once the HTTP server is up. We regex that out of either
  // stream because Theia 1.73 has historically emitted it on
  // different streams across versions.
  let discoveredPort: number | undefined;
  const portRegex = /listening on (?:https?:\/\/)?(?:[^\s/:]+):(\d{2,5})/i;
  const collectData = (data: Buffer) => {
    const text = data.toString('utf8');
    process.stdout.write(`[theia] ${text}`);
    if (discoveredPort === undefined) {
      const m = portRegex.exec(text);
      if (m) {
        const p = Number.parseInt(m[1], 10);
        if (Number.isInteger(p) && p > 0 && p < 65536) {
          discoveredPort = p;
        }
      }
    }
  };

  theiaProcess.stdout?.on('data', collectData);
  theiaProcess.stderr?.on('data', collectData);

  theiaProcess.on('error', (err: Error) => {
    console.error(`[kairo] Theia process error: ${err.message}`);
  });

  theiaProcess.on('exit', (code: number | null, signal: string | null) => {
    if (!isQuitting) {
      console.error(`[kairo] Theia backend exited unexpectedly with code ${code}, signal ${signal}`);
    }
    theiaProcess = null;
  });

  // Wait for Theia to be ready: discover port from logs, then
  // poll that port's HTTP server.
  const startTime = Date.now();
  const timeout = 45_000;

  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (!theiaProcess) {
        reject(new Error('Theia process died before becoming ready'));
        return;
      }
      if (discoveredPort === undefined) {
        retryOrReject(new Error('Waiting for Theia to log its listen port'));
        return;
      }
      const healthURL = `http://127.0.0.1:${discoveredPort}`;
      const req = http.get(healthURL, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
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

  theiaPort = discoveredPort!;
  console.log(`[kairo] Theia backend ready on port ${theiaPort}`);
  return theiaPort;
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

  // Auto-open DevTools in dev builds so the user can see the
  // renderer's actual console / network / errors. Set
  // KAIRO_NO_DEVTOOLS=1 to opt out.
  if (!process.env.KAIRO_NO_DEVTOOLS) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    flog('[kairo] DevTools auto-opened (set KAIRO_NO_DEVTOOLS=1 to disable)');
  }

  // Mirror the renderer's console + load events to the file log
  // so we can post-mortem frontend issues (workspace-context
  // init, runtime-connection failures, unhandled promise
  // rejections) without DevTools being open.
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const lvl = ['DEBUG', 'LOG', 'WARN', 'ERROR'][level] || `L${level}`;
    flog(`[renderer:${lvl}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    flog(`[renderer] did-fail-load: code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    flog(`[renderer] render-process-gone: ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, err) => {
    flog(`[renderer] preload-error: path=${preloadPath} err=${err.message}`);
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

// Init the file logger as early as possible so subsequent
// console output is captured even if Electron detaches from
// the parent's stdout.
initFileLogger();

flog(`[kairo] desktop main starting; pid=${process.pid}; electron=${process.versions.electron}; node=${process.versions.node}; platform=${process.platform}`);

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
              // Theia 1.73 ships with ajv-generated validators that
              // use `new Function` for JSON schema compile. Without
              // 'unsafe-eval' the very first schema validate throws
              // EvalError and the frontend hangs in the splash. The
              // desktop is bound to loopback, so the eval risk is
              // localised to the Theia bundle we just served.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' data: http://127.0.0.1:* ws://127.0.0.1:*",
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