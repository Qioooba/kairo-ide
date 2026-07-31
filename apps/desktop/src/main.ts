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

import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, session, shell } from 'electron';
import { spawn, ChildProcess, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { findFreePort } from '@kairo/protocol';
import { randomBytes } from 'crypto';
import { detectJDK17Plus, showJDKSetupDialog } from './jdk-check';

let agentProcess: ChildProcess | null = null;
let agentPort: number = 0;
let agentSecret: string = '';
let agentStartedByUs = false; // true if we spawned the agent, false if reused
let theiaProcess: ChildProcess | null = null;
let theiaPort: number = 0;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// ── Headless (browser-only) mode ─────────────────────────────
// Activated in two ways:
//   1. Kairo-Server.exe  — renamed copy of Kairo.exe, auto-headless
//   2. Kairo.exe --headless — explicit CLI flag
// In headless mode, Kairo starts the Go Runtime Agent and Theia
// backend but does NOT open an Electron window. The IDE is
// accessible via http://127.0.0.1:<port> in any browser.
const serverExeName = path.basename(process.execPath, '.exe').toLowerCase();
const isHeadless = serverExeName === 'kairo-server' || process.argv.includes('--headless');

// Track child process exit codes for diagnostics.
const childExitCodes: Map<string, { code: number | null; signal: string | null }> = new Map();

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
    // Try <repo>/artifacts/desktop-main.log first (dev mode).
    // In packaged builds, __dirname is inside the ASAR archive so
    // the relative path resolve fails — we defer to
    // ensureFileLogger() which runs after app 'ready' and can
    // use app.getPath('userData').
    const repoCandidate = path.join(__dirname, '..', '..', '..', 'artifacts', 'desktop-main.log');
    try {
      const dir = path.dirname(repoCandidate);
      // Test that the directory actually exists on disk (not inside ASAR).
      if (fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        mainLogPath = repoCandidate;
      }
    } catch { /* not a dev build */ }
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

/**
 * Called after app 'ready' to set up the log file path when
 * initFileLogger could not determine it (packaged builds).
 * Uses app.getPath('userData') which is only available after
 * the app is ready.
 */
function ensureFileLogger(): void {
  if (mainLogPath) {
    return; // Already configured (dev mode or env var).
  }
  try {
    const userDataLogDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(userDataLogDir, { recursive: true });
    mainLogPath = path.join(userDataLogDir, 'desktop-main.log');
  } catch {
    mainLogPath = undefined;
  }
}

// ─── Startup Validation ──────────────────────────────────────

/**
 * Validates the runtime environment before launching child processes.
 * Returns an array of warning messages (non-fatal) or throws on fatal errors.
 */
function validateStartup(): string[] {
  const warnings: string[] = [];

  // 1. Node.js version check — Electron 39 ships Node 22, we require >= 20.10
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (isNaN(nodeMajor) || nodeMajor < 20) {
    throw new Error(
      `Unsupported Node.js version: ${process.versions.node}. ` +
      `Kairo IDE requires Node.js >= 20.10.0.`
    );
  }

  // 2. Platform check
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    throw new Error(`Unsupported platform: ${process.platform}.`);
  }

  // 3. Architecture check (warn on 32-bit)
  if (process.arch === 'ia32') {
    warnings.push('32-bit architecture detected; Kairo IDE is optimized for 64-bit.');
  }

  // 4. Validate agent path if explicitly set
  if (process.env.KAIRO_AGENT_PATH) {
    if (!fs.existsSync(process.env.KAIRO_AGENT_PATH)) {
      throw new Error(
        `KAIRO_AGENT_PATH is set but the binary does not exist: ${process.env.KAIRO_AGENT_PATH}`
      );
    }
  }

  // 5. Validate data directory writability
  const userDataPath = app.getPath('userData');
  try {
    fs.accessSync(userDataPath, fs.constants.W_OK);
  } catch {
    warnings.push(`User data directory is not writable: ${userDataPath}`);
  }

  return warnings;
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
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', binaryName);
  }

  // Dev mode: fall back to the monorepo-local Go build output.
  const devDir = path.resolve(__dirname, '..', '..', '..', 'runtime-agent', 'bin');
  const candidates = process.platform === 'win32'
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
    `(pnpm --filter @kairo/desktop prebuild) or set KAIRO_AGENT_PATH to the binary location.`
  );
}

function verifyAgentBinary(agentPath: string): void {
  if (!fs.existsSync(agentPath)) {
    throw new Error(`Agent binary not found: ${agentPath}`);
  }

  // Verify it's a regular file (not a directory or symlink to nowhere).
  const stat = fs.statSync(agentPath);
  if (!stat.isFile()) {
    throw new Error(`Agent path is not a regular file: ${agentPath}`);
  }

  // Verify it's executable (Unix: check mode bits; Windows: .exe extension
  // is handled by spawn, but we still check the file exists).
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(agentPath, fs.constants.X_OK);
    } catch {
      throw new Error(`Agent binary is not executable: ${agentPath}. Run: chmod +x ${agentPath}`);
    }
  }

  // Quick version check: spawn with --version (if supported) to verify the
  // binary is a valid kairo-runtime. We accept any exit 0 here.
  try {
    const result = require('child_process').spawnSync(agentPath, ['--help'], {
      timeout: 5_000,
      encoding: 'utf-8',
    });
    // A valid binary should not crash; we accept exit 0, 1, or 2.
    if (result.error) {
      throw new Error(`Agent binary failed to start: ${result.error.message}`);
    }
    if (result.status !== null && result.status > 2) {
      throw new Error(`Agent binary exited with unexpected code ${result.status}`);
    }
    console.log(`[kairo] Agent binary verified: ${agentPath}`);
  } catch (err: any) {
    if (err.message && err.message.startsWith('Agent binary')) throw err;
    // spawnSync itself threw (e.g. ENOENT on missing shell)
    throw new Error(`Cannot verify agent binary: ${err.message}`);
  }
}

// ─── Agent State File Discovery ───────────────────────────────

interface AgentStateFile {
  port: number;
  secret: string;
  pid: number;
  bindAddress: string;
  startedAt: string;
}

/**
 * Try to discover a running agent via the state file written by the
 * Go runtime. Returns the agent URL and secret if found and healthy.
 */
async function tryReuseAgent(dataDir: string): Promise<{ port: number; secret: string } | null> {
  const statePath = path.join(dataDir, 'agent-state.json');
  if (!fs.existsSync(statePath)) {
    return null;
  }

  let state: AgentStateFile;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    console.warn('[kairo] agent state file corrupted, ignoring');
    return null;
  }

  if (!state.port || state.port <= 0) {
    return null;
  }

  // Verify the agent is still alive via health check.
  const healthURL = `http://127.0.0.1:${state.port}/api/v1/health`;
  try {
    await new Promise<void>((resolve, reject) => {
      const req = http.get(healthURL, { timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`status ${res.statusCode}`));
        }
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    console.log(`[kairo] reusing existing agent on port ${state.port} (pid ${state.pid})`);
    return { port: state.port, secret: state.secret };
  } catch {
    console.log(`[kairo] agent state file found but agent is not healthy, will start a new one`);
    // Clean up stale state file.
    try { fs.unlinkSync(statePath); } catch { /* ignore */ }
    return null;
  }
}

async function startAgent(dataDir: string, bundledDir?: string): Promise<{ port: number; secret: string }> {
  const port = await findFreePort();
  const secret = generateSecret();
  const agentPath = resolveAgentPath();

  // Verify the binary before spawning.
  verifyAgentBinary(agentPath);

  const args = [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--secret', secret,
    '--data-dir', dataDir,
    '--log-level', 'info',
  ];
  if (bundledDir) {
    args.push('--bundled-dir', bundledDir);
  }

  console.log(`[kairo] Starting agent: ${agentPath} ${args.join(' ')}`);

  // Collect stdout/stderr for health-check failure diagnostics.
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  agentProcess = spawn(agentPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      KAIRO_DESKTOP: '1',
    },
  });

  agentProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString('utf-8');
    stdoutChunks.push(text);
    process.stdout.write(`[agent] ${text}`);
  });

  agentProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString('utf-8');
    stderrChunks.push(text);
    process.stderr.write(`[agent] ${text}`);
  });

  agentProcess.on('error', (err: Error) => {
    console.error(`[kairo] Agent process error: ${err.message}`);
  });

  agentProcess.on('exit', (code: number | null, signal: string | null) => {
    childExitCodes.set('agent', { code, signal });
    if (!isQuitting) {
      console.error(`[kairo] Agent exited unexpectedly with code ${code}, signal ${signal}`);
    } else {
      console.log(`[kairo] Agent exited with code ${code}, signal ${signal}`);
    }
    agentProcess = null;
  });

  // Wait for health check
  const healthURL = `http://127.0.0.1:${port}/api/v1/health`;
  const startTime = Date.now();
  const timeout = 15_000;

  try {
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
  } catch (err: any) {
    // Collect diagnostics before killing the process.
    const stdout = stdoutChunks.join('').slice(-4096);
    const stderr = stderrChunks.join('').slice(-4096);
    console.error(`[kairo] Agent health check failed. stdout (last 4KB):\n${stdout}`);
    console.error(`[kairo] Agent health check failed. stderr (last 4KB):\n${stderr}`);

    // Stop the child process.
    if (agentProcess && !agentProcess.killed) {
      agentProcess.kill('SIGTERM');
      setTimeout(() => {
        if (agentProcess && !agentProcess.killed) {
          agentProcess.kill('SIGKILL');
        }
      }, 3_000);
    }
    agentProcess = null;

    throw new Error(
      `Failed to start the Kairo Runtime Agent.\n\n` +
      `The agent process did not become healthy within ${timeout / 1000}s.\n\n` +
      `Details: ${err.message}\n\n` +
      `Last stderr output:\n${stderr.slice(-1024) || '(none)'}`
    );
  }

  agentPort = port;
  agentSecret = secret;
  console.log(`[kairo] Agent healthy on port ${port}`);
  return { port, secret };
}

function killProcessTree(proc: ChildProcess | null, signal: NodeJS.Signals): void {
  if (!proc || proc.killed || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      // Windows: taskkill /T /PID kills the process and all its children.
      exec(`taskkill /T /PID ${proc.pid} /F`, { timeout: 5_000 }, (err) => {
        if (err) console.error(`[kairo] taskkill error: ${err.message}`);
      });
    } else {
      // Unix: negative PID sends signal to the entire process group.
      try {
        process.kill(-proc.pid, signal);
      } catch {
        // Fallback: kill just the parent.
        proc.kill(signal);
      }
    }
  } catch (err: any) {
    console.error(`[kairo] killProcessTree error: ${err.message}`);
  }
}

function stopAgent(): void {
  if (!agentStartedByUs) {
    console.log('[kairo] agent was reused, not stopping it');
    return;
  }
  if (agentProcess && !agentProcess.killed) {
    console.log('[kairo] Stopping agent...');
    killProcessTree(agentProcess, 'SIGTERM');
    setTimeout(() => {
      if (agentProcess && !agentProcess.killed) {
        killProcessTree(agentProcess, 'SIGKILL');
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
    childExitCodes.set('theia', { code, signal });
    if (!isQuitting) {
      console.error(`[kairo] Theia backend exited unexpectedly with code ${code}, signal ${signal}`);
    } else {
      console.log(`[kairo] Theia backend exited with code ${code}, signal ${signal}`);
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
    killProcessTree(theiaProcess, 'SIGTERM');
    setTimeout(() => {
      if (theiaProcess && !theiaProcess.killed) {
        killProcessTree(theiaProcess, 'SIGKILL');
      }
    }, 5_000);
  }
}

// ─── IPC ──────────────────────────────────────────────────────

// Handle renderer ready signal.
ipcMain.on('renderer-ready', () => {
  console.log('[kairo] renderer process is ready');
});

// Handle renderer error forwarding from preload script.
ipcMain.on('renderer-error', (_event, info: { message: string; filename?: string; lineno?: number; colno?: number; type: string }) => {
  flog(`[renderer:${info.type}] ${info.message}${info.filename ? ` (${info.filename}:${info.lineno}:${info.colno})` : ''}`);
});

// Toggle DevTools from renderer command (Help > Toggle Developer Tools).
ipcMain.on('toggle-devtools', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.toggleDevTools();
  }
});

// Send menu actions to the renderer process.
function sendMenuAction(action: string): void {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', action);
  }
}

// ─── Native Menu ──────────────────────────────────────────────

function buildMenuTemplate(): MenuItemConstructorOptions[] {
  const action = (commandId: string) => ({
    click: () => sendMenuAction(commandId),
  });

  return [
    // ── File ───────────────────────────────────────────────────
    {
      label: 'File',
      submenu: [
        { label: 'New Text File', ...action('workbench.action.files.newUntitledFile') },
        { label: 'New File...', ...action('workbench.action.files.pickNewFile') },
        { type: 'separator' },
        { label: 'Open File...', ...action('core.open') },
        { label: 'Open Folder...', ...action('workspace:open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', ...action('core.save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', ...action('file.saveAs') },
        { label: 'Save All', ...action('core.saveAll') },
        { type: 'separator' },
        { label: 'Import Kairo Project...', ...action('kairo.project.import') },
        { label: 'Select Kairo Project...', ...action('kairo.project.select') },
        { label: 'Run Configurations...', ...action('kairo.runConfigurations.manage') },
        { type: 'separator' },
        { label: 'Preferences', ...action('preferences:open') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', ...action('core.close.tab') },
        { label: 'Close All Tabs', ...action('core.close.all.tabs') },
        { type: 'separator' },
        { label: 'Exit', accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4', role: 'quit' },
      ],
    },

    // ── Edit ───────────────────────────────────────────────────
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', ...action('core.undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', ...action('core.redo') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', ...action('core.cut') },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', ...action('core.copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', ...action('core.paste') },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', ...action('core.find') },
        { label: 'Replace', accelerator: 'CmdOrCtrl+H', ...action('core.replace') },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', ...action('core.selectAll') },
      ],
    },

    // ── Selection ──────────────────────────────────────────────
    {
      label: 'Selection',
      submenu: [
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', ...action('core.selectAll') },
        { label: 'Expand Selection', ...action('editor.action.smartSelect.expand') },
        { label: 'Shrink Selection', ...action('editor.action.smartSelect.shrink') },
      ],
    },

    // ── View ───────────────────────────────────────────────────
    {
      label: 'View',
      submenu: [
        { label: 'Explorer', ...action('workbench.view.explorer') },
        { label: 'Search', ...action('workbench.view.search') },
        { label: 'Source Control', ...action('workbench.view.scm') },
        { label: 'Debug', ...action('workbench.view.debug') },
        { label: 'Terminal', ...action('workbench.view.terminal') },
        { label: 'Problems', ...action('workbench.view.problems') },
        { type: 'separator' },
        { label: 'Kairo Servers', ...action('kairo.view.servers') },
        { label: 'Kairo Builds', ...action('kairo.view.builds') },
        { label: 'Kairo Deployments', ...action('kairo.view.deployments') },
        { label: 'Tomcat Logs', ...action('kairo.view.logs') },
        { label: 'Maven', ...action('kairo.view.maven') },
        { label: 'TODO / FIXME', ...action('kairo.view.todo') },
        { label: 'Test Results', ...action('kairo.view.tests') },
        { label: 'SQL Console', ...action('kairo.view.sqlConsole') },
        { label: 'Remote Development', ...action('kairo.view.remote') },
        { label: 'Performance Dashboard', ...action('kairo.view.perf') },
        { type: 'separator' },
        {
          label: 'Appearance',
          submenu: [
            { label: 'Toggle Bottom Panel', ...action('core.toggle.bottom.panel') },
            { label: 'Toggle Status Bar', ...action('workbench.action.toggleStatusbarVisibility') },
            { label: 'Toggle Menu Bar', ...action('window.menuBarVisibility') },
            { label: 'Toggle Maximized', ...action('core.toggleMaximized') },
          ],
        },
      ],
    },

    // ── Go ─────────────────────────────────────────────────────
    {
      label: 'Go',
      submenu: [
        { label: 'Back', ...action('workbench.action.navigateBack') },
        { label: 'Forward', ...action('workbench.action.navigateForward') },
        { type: 'separator' },
        { label: 'Go to File...', accelerator: 'CmdOrCtrl+P', ...action('workbench.action.quickOpen') },
        { label: 'Go to Line...', ...action('workbench.action.gotoLine') },
        { label: 'Go to Symbol...', ...action('workbench.action.gotoSymbol') },
      ],
    },

    // ── Terminal ───────────────────────────────────────────────
    {
      label: 'Terminal',
      submenu: [
        { label: 'New Terminal', ...action('terminal:new') },
        { label: 'Toggle Terminal', ...action('kairo.terminal.toggle') },
      ],
    },

    // ── Kairo ──────────────────────────────────────────────────
    {
      label: 'Kairo',
      submenu: [
        { label: 'Import Kairo Project...', ...action('kairo.project.import') },
        { label: 'Select Kairo Project...', ...action('kairo.project.select') },
        { label: 'Scan Workspace', ...action('kairo.project.scan') },
        { label: 'Run Configurations...', ...action('kairo.runConfigurations.manage') },
        { type: 'separator' },
        {
          label: 'Build & Run',
          submenu: [
            { label: 'Build', ...action('kairo.build') },
            { label: 'Clean Build', ...action('kairo.cleanBuild') },
            { label: 'Build & Deploy', ...action('kairo.buildAndDeploy') },
            { label: 'Publish', ...action('kairo.publish') },
            { type: 'separator' },
            { label: 'Start Server', ...action('kairo.server.start') },
            { label: 'Start Server (Debug)', ...action('kairo.server.debug') },
            { label: 'Stop Server', ...action('kairo.server.stop') },
            { label: 'Restart Server', ...action('kairo.server.restart') },
            { type: 'separator' },
            { label: 'Open Application', ...action('kairo.app.open') },
            { label: 'Check Java Debug Adapter', ...action('kairo.debug.checkAdapter') },
          ],
        },
        {
          label: 'View',
          submenu: [
            { label: 'Servers', ...action('kairo.view.servers') },
            { label: 'Builds', ...action('kairo.view.builds') },
            { label: 'Deployments', ...action('kairo.view.deployments') },
            { label: 'Tomcat Logs', ...action('kairo.view.logs') },
            { label: 'Maven', ...action('kairo.view.maven') },
            { label: 'TODO / FIXME', ...action('kairo.view.todo') },
            { label: 'Test Results', ...action('kairo.view.tests') },
            { label: 'SQL Console', ...action('kairo.view.sqlConsole') },
            { label: 'Remote Development', ...action('kairo.view.remote') },
            { label: 'Performance Dashboard', ...action('kairo.view.perf') },
          ],
        },
        {
          label: 'Debug',
          submenu: [
            { label: 'Open Debug View', ...action('kairo.debug.openView') },
            { label: 'Open Debug Console', ...action('kairo.debug.openConsole') },
            { label: 'Variables', ...action('kairo.debug.view.variables') },
            { label: 'Call Stack', ...action('kairo.debug.view.callstack') },
            { label: 'Breakpoints', ...action('kairo.debug.view.breakpoints') },
            { label: 'Watch', ...action('kairo.debug.view.watch') },
            { label: 'Debug Toolbar', ...action('kairo.debug.view.toolbar') },
            { label: 'Debug Diagnostics', ...action('kairo:open-debug-diagnostics') },
          ],
        },
        {
          label: 'Window',
          submenu: [
            { label: 'Toggle Terminal', ...action('kairo.terminal.toggle') },
            { label: 'Keyboard Shortcuts', ...action('kairo.keymap.open') },
            { label: 'Switch JDK', ...action('kairo.jdk.switch') },
            { label: 'Reconnect Runtime Agent', ...action('kairo.agent.reconnect') },
          ],
        },
      ],
    },

    // ── Help ───────────────────────────────────────────────────
    {
      label: 'Help',
      submenu: [
        { label: 'Welcome', ...action('kairo.welcome.show') },
        { label: 'Toggle Developer Tools', ...action('kairo.devtools.toggle') },
        { label: 'Debug Diagnostics', ...action('kairo:open-debug-diagnostics') },
        { type: 'separator' },
        { label: 'About', ...action('core.about') },
      ],
    },
  ];
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
      sandbox: true,
    },
  });

  // Auto-open DevTools only in unpackaged (dev) runs so the user
  // can see the renderer's actual console / network / errors. In
  // packaged production builds, DevTools must stay closed unless
  // the operator explicitly opts in via KAIRO_DEV=1. Set
  // KAIRO_NO_DEVTOOLS=1 to opt out even in dev.
  if (!app.isPackaged && !process.env.KAIRO_NO_DEVTOOLS) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    flog('[kairo] DevTools auto-opened (unpackaged dev build; set KAIRO_NO_DEVTOOLS=1 to disable)');
  }

  // Force the OS window title to "Kairo IDE" regardless of what the
  // Theia HTML / runtime sets. Theia 1.73 ships an index.html with
  // <title>Eclipse Theia</title> and a few Theia widgets call
  // document.title = ... at runtime, so the BrowserWindow `title:`
  // option alone is overwritten as soon as the page loads. We
  // preventDefault() on every update and re-assert the product name.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle('Kairo IDE');
    }
  });

  // Mirror the renderer's console + load events to the file log
  // so we can post-mortem frontend issues (workspace-context
  // init, runtime-connection failures, unhandled promise
  // rejections) without DevTools being open.
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const lvl = ['DEBUG', 'LOG', 'WARN', 'ERROR'][level] || `L${level}`;
    flog(`[renderer:${lvl}] ${message} (${sourceId}:${line})`);
  });

  // Track page load lifecycle events for debugging startup hangs.
  mainWindow.webContents.on('did-start-loading', () => {
    flog('[renderer] did-start-loading');
  });
  mainWindow.webContents.on('did-stop-loading', () => {
    flog('[renderer] did-stop-loading');
  });
  mainWindow.webContents.on('dom-ready', () => {
    flog('[renderer] dom-ready');
  });
  mainWindow.webContents.on('did-finish-load', () => {
    flog('[renderer] did-finish-load');
    // Auto-accept the Workspace Trust dialog in packaged desktop builds.
    // The dialog blocks the entire UI until the user clicks, which is
    // problematic for automated testing and first-run scenarios in an
    // intranet-only product. We inject a one-shot MutationObserver
    // that detects the trust dialog and clicks "Yes" automatically.
    if (app.isPackaged || process.env.KAIRO_AUTO_TRUST === '1') {
      mainWindow?.webContents.executeJavaScript(`
        (function autoTrust() {
          const observer = new MutationObserver(() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
              if (b.textContent && b.textContent.includes('trust the authors') && !b.textContent.includes("don't")) {
                b.click();
                observer.disconnect();
                return;
              }
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          // Also check immediately in case the dialog is already rendered.
          const existing = document.querySelectorAll('button');
          for (const b of existing) {
            if (b.textContent && b.textContent.includes('trust the authors') && !b.textContent.includes("don't")) {
              b.click();
              observer.disconnect();
              return;
            }
          }
          // Safety: stop observing after 30 seconds regardless.
          setTimeout(() => observer.disconnect(), 30000);
        })();
      `).catch((err: Error) => {
        flog(`[kairo] auto-trust injection error: ${err.message}`);
      });
    }
  });
  mainWindow.webContents.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
    flog(`[renderer] did-start-navigation: url=${url} inPlace=${isInPlace} mainFrame=${isMainFrame}`);
  });
  mainWindow.webContents.on('did-navigate', (_e, url, httpCode) => {
    flog(`[renderer] did-navigate: url=${url} httpCode=${httpCode}`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    flog(`[renderer] did-fail-load: code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('did-fail-provisional-load', (_e, code, desc, url) => {
    flog(`[renderer] did-fail-provisional-load: code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    flog(`[renderer] render-process-gone: ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, err) => {
    flog(`[renderer] preload-error: path=${preloadPath} err=${err.message}`);
  });

  // OFFLINE / AIR-GAPPED POLICY: Kairo IDE is designed for fully
  // intranet deployment. By default we REFUSE to open any external
  // http/https URL with the system shell. Operators can opt in to
  // allow external links (for documentation, bug trackers, etc.) by
  // setting KAIRO_ALLOW_EXTERNAL_LINKS=1; even then, we still block
  // non-http(s) schemes (file://, intent://, etc.) to prevent the
  // renderer from launching arbitrary local applications.
  const allowExternalLinks = process.env.KAIRO_ALLOW_EXTERNAL_LINKS === '1';
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        console.warn('[kairo] refusing to open URL with non-http(s) scheme:', u.protocol);
        return { action: 'deny' };
      }
      if (!allowExternalLinks) {
        console.warn(`[kairo] refusing to open external URL (set KAIRO_ALLOW_EXTERNAL_LINKS=1 to allow): ${url}`);
        return { action: 'deny' };
      }
      shell.openExternal(url);
    } catch {
      console.warn('[kairo] refusing to open malformed URL:', url);
    }
    return { action: 'deny' };
  });

  // Also intercept navigation: if a link inside the app tries to
  // navigate the main frame to an external URL, block it. This is
  // a defense-in-depth measure — the CSP already restricts
  // connect-src, but navigating the top frame to http://evil.com
  // would replace the IDE entirely.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
        event.preventDefault();
        console.warn(`[kairo] blocked top-frame navigation to non-local URL: ${url}`);
      }
    } catch {
      event.preventDefault();
      console.warn('[kairo] blocked top-frame navigation to malformed URL:', url);
    }
  });

  // Config is injected BEFORE the page loads via the preload script.
  // No executeJavaScript — avoids the race condition.
  await mainWindow.loadURL(`http://127.0.0.1:${theiaPort}`);

  // Set the native application menu to match the browser version's
  // comprehensive menu layout. The menu actions are sent to the
  // renderer via IPC, where the preload script forwards them to
  // the Theia command registry.
  const menu = Menu.buildFromTemplate(buildMenuTemplate());
  Menu.setApplicationMenu(menu);
  flog('[kairo] native application menu set');

  // Handle the close event to force-close the window even when the
  // renderer's beforeunload handler (Theia's DefaultWindowService)
  // tries to prevent it. Without this, the close button on Windows
  // has no effect because Theia collects unload vetoes from
  // contributions that call event.preventDefault().
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      isQuitting = true;
      // destroy() bypasses the renderer's beforeunload handler and
      // guarantees the window is closed. It does NOT re-emit the
      // 'close' event, so we won't recurse.
      mainWindow?.destroy();
    }
  });

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

// ── CSP ────────────────────────────────────────────────────
// MUST be registered BEFORE the app 'ready' event. The default
// session is created before 'ready' fires, so registering
// 'session-created' inside the ready handler would miss the
// default session. We also explicitly set the CSP on the
// default session in the ready handler as a safety net.
function setupCSP(session: Electron.Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    // Theia 1.73 ships with ajv-generated validators that use
    // `new Function` for JSON schema compile. Without
    // 'unsafe-eval' the very first schema validate throws
    // EvalError and the frontend hangs in the splash. The
    // AJV library is a core Theia dependency used for plugin
    // manifest validation, preference schema checks, and
    // extension contribution validation — it cannot be
    // avoided in production builds. We therefore always
    // allow 'unsafe-eval' so the frontend can initialize.
    const scriptSrcExtra = " 'unsafe-eval'";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'",
          `script-src 'self' 'unsafe-inline'${scriptSrcExtra}`,
          "style-src 'self' 'unsafe-inline'",
          "connect-src 'self' data: http://127.0.0.1:* ws://127.0.0.1:*",
          "img-src 'self' data:",
          "font-src 'self' data:",
        ].join('; '),
      },
    });
  });
  flog('[kairo] CSP configured for session');
}

// Register session-created BEFORE 'ready' to catch the default session.
app.on('session-created', (session) => {
  setupCSP(session);
});

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
    // Set the app version so the preload script can expose it.
    process.env.KAIRO_APP_VERSION = app.getVersion();

    // Now that the app is ready we can use app.getPath('userData')
    // to set up the log file for packaged builds.
    ensureFileLogger();

    // Run startup validation before launching child processes.
    const warnings = validateStartup();
    for (const w of warnings) {
      console.warn(`[kairo] startup warning: ${w}`);
    }

    // ── JDK 17+ pre-check ─────────────────────────────────────
    // In packaged builds, bundled resources (tomcat6, jdtls) live
    // under process.resourcesPath/bundled/. The Go agent also
    // checks bundled/jdk17/ for a pre-extracted JDK.
    const bundledDir = app.isPackaged
      ? path.join(process.resourcesPath, 'bundled')
      : undefined;

    const jdkResult = detectJDK17Plus(bundledDir);
    if (jdkResult.found) {
      console.log(`[kairo] JDK ${jdkResult.version} detected at ${jdkResult.javaPath}`);
      if (!process.env.KAIRO_JDK_HOME && jdkResult.javaHome) {
        process.env.KAIRO_JDK_HOME = jdkResult.javaHome;
      }
    } else {
      console.warn('[kairo] No JDK 17+ detected, showing setup dialog');
      const userChoice = await showJDKSetupDialog(jdkResult);
      if (userChoice === 'quit') {
        app.quit();
        return;
      }
      // Re-detect after user may have set KAIRO_JDK_HOME.
      const retry = detectJDK17Plus(bundledDir);
      if (retry.found) {
        console.log(`[kairo] JDK ${retry.version} configured at ${retry.javaPath}`);
      } else {
        console.warn('[kairo] Proceeding without JDK 17+ — Java language features will be limited');
      }
    }

    // Set CSP on the default session as a safety net (the
    // 'session-created' listener above should already have caught
    // it, but this guarantees the default session is covered).
    setupCSP(session.defaultSession);

    try {
      const dataDir = path.join(app.getPath('userData'), 'kairo-data');
      fs.mkdirSync(dataDir, { recursive: true });

      // Try to reuse an existing agent first. If one is already
      // running (e.g. started by a previous Desktop session or by
      // the browser launcher), connect to it instead of starting a
      // duplicate. This enables the "Desktop + Browser sharing the
      // same agent" workflow.
      const reused = await tryReuseAgent(dataDir);
      let port: number;
      let secret: string;
      if (reused) {
        port = reused.port;
        secret = reused.secret;
        agentStartedByUs = false;
      } else {
        // Start Go Agent
        const result = await startAgent(dataDir, bundledDir);
        port = result.port;
        secret = result.secret;
        agentStartedByUs = true;
      }
      agentPort = port;
      agentSecret = secret;

      // Start Theia Backend
      await startTheiaBackend();

      if (isHeadless) {
        // Headless mode: agent + backend only, no Electron window.
        // The IDE is accessible via browser at the Theia backend URL.
        console.log('');
        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║   Kairo IDE — Headless (Browser) Mode                   ║');
        console.log('╠══════════════════════════════════════════════════════════╣');
        console.log(`║   Theia:    http://127.0.0.1:${theiaPort}`.padEnd(58) + '║');
        console.log(`║   Agent:    http://127.0.0.1:${agentPort}`.padEnd(58) + '║');
        console.log('║                                                          ║');
        console.log('║   Open the Theia URL in any browser to use the IDE.      ║');
        console.log('║   Press Ctrl+C to stop all services.                     ║');
        console.log('╚══════════════════════════════════════════════════════════╝');
        console.log('');

        // Keep the process alive. The agent and Theia backend are
        // child processes that will exit when this process exits.
        // We use a simple interval to keep Node.js event loop alive.
        // On Ctrl+C, the 'before-quit' handler will tear them down.
        setInterval(() => {
          // Heartbeat: check child processes are still alive.
          if (agentProcess?.killed && theiaProcess?.killed) {
            console.log('[kairo] All child processes exited, quitting.');
            app.quit();
          }
        }, 5000).unref();
      } else {
        // Create window — config is passed via env to preload
        createWindow();
      }

    } catch (err: any) {
      console.error('[kairo] Failed to start:', err);
      dialog.showErrorBox('Kairo IDE Error',
        `Failed to start Kairo IDE:\n${err.message}\n\nPlease check the console for details.`);
      stopTheiaBackend();
      stopAgent();
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    isQuitting = true;

    // Log child process exit codes for diagnostics.
    flog(`[kairo] shutdown initiated; child exit codes: ${JSON.stringify([...childExitCodes.entries()])}`);

    // Detect zombie processes: if a child process is still alive after
    // a previous stop attempt, force-kill it.
    if (agentProcess && !agentProcess.killed) {
      flog('[kairo] zombie agent detected; force-killing before quit');
      killProcessTree(agentProcess, 'SIGKILL');
    }
    if (theiaProcess && !theiaProcess.killed) {
      flog('[kairo] zombie theia detected; force-killing before quit');
      killProcessTree(theiaProcess, 'SIGKILL');
    }

    // Wait for child processes to exit cleanly before quitting.
    // Electron will wait for this event handler to complete.
    stopTheiaBackend();
    stopAgent();

    // WM_CLOSE / app.quit() can stall for ~15s on Windows when a
    // child process (Theia, the Go agent, or a hung renderer)
    // refuses to release its stdio pipes. Without a hard timeout
    // the user sees the window vanish but the tray icon — and
    // sometimes the whole process tree — linger. After 5s we
    // bypass any in-flight cleanup and force-exit the process.
    // During a clean shutdown the event loop is already gone
    // before this fires, so the timer is a safe no-op.
    setTimeout(() => {
      flog('[kairo] quit timeout reached; forcing app.exit(0)');
      app.exit(0);
    }, 5_000);
  });

  app.on('window-all-closed', () => {
    // In headless mode, there is no window — don't quit.
    if (isHeadless) return;
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // In headless mode, don't create a window on activate.
    if (isHeadless) return;
    if (mainWindow === null) {
      createWindow();
    }
  });
}

// Best-effort cleanup on process exit
process.on('exit', (code) => {
  flog(`[kairo] main process exiting with code ${code}; child exit codes: ${JSON.stringify([...childExitCodes.entries()])}`);
  if (agentProcess && !agentProcess.killed) {
    try { agentProcess.kill('SIGKILL'); } catch { /* already gone */ }
  }
  if (theiaProcess && !theiaProcess.killed) {
    try { theiaProcess.kill('SIGKILL'); } catch { /* already gone */ }
  }
});