/**
 * Kairo IDE — desktop main process.
 *
 * On launch, this:
 *   1. Starts the Go Runtime Agent with `--port 0` (OS ephemeral bind)
 *      and a local auth secret — agent writes the real port to
 *      agent-state.json (avoids findFreePort TOCTOU).
 *   2. Starts the Theia backend as a child process, passing
 *      the agent URL via environment variables. The session secret
 *      is passed to the Theia backend only in headless mode (served
 *      via /kairo-agent-secret); the Electron window path relies on
 *      preload getSecret instead.
 *   3. Opens an Electron BrowserWindow pointing at the local
 *      Theia app. The preload script exposes the agent config
 *      via contextBridge before the page loads.
 *   4. Tears down the agent and Theia backend on quit.
 *
 * The agent is the security boundary; the BrowserWindow uses
 * contextIsolation with a preload script.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, safeStorage, screen, session, shell } from 'electron';
import { spawn, ChildProcess, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { randomBytes } from 'crypto';
import { detectHostJDK, JDT_LS_MIN_JDK_MAJOR, applyHostJDKEnv, showJDKSetupDialog, savePersistedJDKHome, getPersistedJDKConfigPath, loadPersistedJDKHome } from './jdk-check';
import {
  parseTheiaListenPort,
  readTheiaPortFromEnv,
  readTheiaPortFromStateFile,
  theiaPortDiscoverTimeoutMessage,
  writeTheiaStateFile,
} from './theia-port-discover';
import {
  detectTomcatHome,
  applyTomcatEnv,
  savePersistedTomcatHome,
  getPersistedTomcatConfigPath,
  showTomcatSetupDialog,
} from './tomcat-check';
import { ChildLifecycle } from './child-lifecycle';
import {
  parseAgentStateJson,
  resolveAgentSecretFromEnv,
} from './agent-state';

let agentProcess: ChildProcess | null = null;
let agentPort: number = 0;
let agentSecret: string = '';
/** true if we spawned the agent, false if reused — mirrored on childLifecycle. */
let agentStartedByUs = false;
let agentDataDir: string = '';
let agentBundledDir: string | undefined;
let agentRespawning = false;
let theiaProcess: ChildProcess | null = null;
let theiaPort: number = 0;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let quitCleanupStarted = false;

/** DK-P2-2/P2-3: single ProcessManager-backed lifecycle for agent/theia. */
const childLifecycle = new ChildLifecycle((msg) => flog(msg));

function setAgentStartedByUs(value: boolean): void {
  agentStartedByUs = value;
  childLifecycle.agentStartedByUs = value;
}

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
  const customSecret = process.env.KAIRO_LOCAL_SECRET?.trim();
  if (customSecret) {
    if (customSecret.length >= 32) {
      return customSecret;
    }
    console.warn(
      `[Kairo Security] Provided KAIRO_LOCAL_SECRET is too weak (${customSecret.length} chars, required >= 32 chars). Falling back to secure CSPRNG random secret.`
    );
  }
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

/** GET with optional headers; resolves on response (body drained). */
function httpGet(
  url: string,
  opts: { timeoutMs?: number; headers?: http.OutgoingHttpHeaders } = {},
): Promise<{ statusCode: number }> {
  const timeoutMs = opts.timeoutMs ?? 400;
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs, headers: opts.headers }, (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode ?? 0 });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

/**
 * Try to discover a running agent via the state file written by the
 * Go runtime. Port/pid come from agent-state.json; the session secret
 * must come from KAIRO_LOCAL_SECRET in the desktop parent env (never
 * from the state file).
 */
async function tryReuseAgent(
  dataDir: string,
): Promise<{ port: number; secret: string; pid: number } | null> {
  const statePath = path.join(dataDir, 'agent-state.json');
  if (!fs.existsSync(statePath)) {
    return null;
  }

  let state: ReturnType<typeof parseAgentStateJson>;
  try {
    state = parseAgentStateJson(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    console.warn('[kairo] agent state file corrupted, ignoring');
    return null;
  }

  if (!state) {
    return null;
  }

  const secret = resolveAgentSecretFromEnv();
  if (!secret) {
    console.log(
      '[kairo] agent state file found but KAIRO_LOCAL_SECRET is unset — cannot reuse without auth secret',
    );
    return null;
  }

  // If the host JDK was configured/changed after this agent started,
  // do not reuse — the old process still has stale JAVA/KAIRO_* env.
  const expectedHome = (process.env.KAIRO_JDK_HOME || loadPersistedJDKHome() || '').trim();
  if (expectedHome) {
    const markerPath = path.join(dataDir, 'agent-jdk-home.txt');
    let agentHome = '';
    try {
      agentHome = fs.readFileSync(markerPath, 'utf-8').trim();
    } catch { /* missing marker = pre-fix agent */ }
    const norm = (p: string) => path.normalize(p).toLowerCase();
    if (!agentHome || norm(agentHome) !== norm(expectedHome)) {
      console.log('[kairo] host JDK changed since agent start — not reusing stale agent');
      try {
        if (state.pid > 0) {
          if (process.platform === 'win32') {
            exec(`taskkill /T /PID ${state.pid} /F`, { timeout: 5_000 }, () => { /* ignore */ });
          } else {
            try { process.kill(state.pid, 'SIGTERM'); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
      try { fs.unlinkSync(statePath); } catch { /* ignore */ }
      return null;
    }
  }

  const base = `http://127.0.0.1:${state.port}`;
  try {
    const health = await httpGet(`${base}/api/v1/health`);
    if (health.statusCode !== 200) {
      throw new Error(`health status ${health.statusCode}`);
    }
    const auth = await httpGet(`${base}/api/v1/toolchains`, {
      headers: { 'X-Kairo-Secret': secret },
    });
    if (auth.statusCode !== 200) {
      console.log(
        `[kairo] agent on port ${state.port} rejected KAIRO_LOCAL_SECRET — not reusing`,
      );
      return null;
    }
    console.log(`[kairo] reusing existing agent on port ${state.port} (pid ${state.pid})`);
    return { port: state.port, secret, pid: state.pid };
  } catch {
    console.log(`[kairo] agent state file found but agent is not healthy, will start a new one`);
    // Clean up stale state file.
    try { fs.unlinkSync(statePath); } catch { /* ignore */ }
    return null;
  }
}

/** Shared agent process env (DK-P1-1): start + respawn must agree. */
function buildAgentEnv(secret: string, dataDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KAIRO_DESKTOP: '1',
    KAIRO_LOCAL_SECRET: secret,
    KAIRO_DATA_DIR: dataDir,
  };
  const jdk = getPersistedJDKConfigPath();
  if (jdk) env.KAIRO_JDK_CONFIG = jdk;
  const tomcat = getPersistedTomcatConfigPath();
  if (tomcat) env.KAIRO_TOMCAT_CONFIG = tomcat;
  return env;
}

/** Poll agent-state.json until the agent reports a bound port (DK-P1-2). */
async function waitForAgentPort(dataDir: string, timeoutMs: number): Promise<number> {
  const statePath = path.join(dataDir, 'agent-state.json');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!agentProcess) {
      throw new Error('Agent process died before writing agent-state.json');
    }
    try {
      if (fs.existsSync(statePath)) {
        const state = parseAgentStateJson(fs.readFileSync(statePath, 'utf-8'));
        if (state && state.port > 0) {
          return state.port;
        }
      }
    } catch {
      // partial write — retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Agent did not write a bound port to agent-state.json within ${timeoutMs}ms`);
}

async function startAgent(
  dataDir: string,
  bundledDir?: string,
): Promise<{ port: number; secret: string; ready: Promise<void> }> {
  agentDataDir = dataDir;
  agentBundledDir = bundledDir;
  childLifecycle.agentStatePath = path.join(dataDir, 'agent-state.json');
  const secret = generateSecret();
  const agentPath = resolveAgentPath();

  // Verify the binary before spawning.
  verifyAgentBinary(agentPath);

  // DK-P1-2: agent binds :0 and writes the real port to agent-state.json.
  // Avoids the findFreePort → spawn TOCTOU window.
  const statePath = path.join(dataDir, 'agent-state.json');
  try { fs.unlinkSync(statePath); } catch { /* ignore missing */ }

  // Pass the session secret via env (KAIRO_LOCAL_SECRET), never as a
  // CLI flag — process listings (tasklist /v, Get-CimInstance) would
  // otherwise expose the hex secret to any local user.
  const args = [
    '--bind', '127.0.0.1',
    '--port', '0',
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
    env: buildAgentEnv(secret, dataDir),
  });
  childLifecycle.register('agent', agentProcess);

  // Record which host JDK this agent process was started with so
  // tryReuseAgent can invalidate reuse after the user switches JDK.
  try {
    fs.writeFileSync(
      path.join(dataDir, 'agent-jdk-home.txt'),
      process.env.KAIRO_JDK_HOME || '',
      'utf-8',
    );
  } catch (err) {
    console.warn('[kairo] Failed to write agent-jdk-home marker:', err);
  }

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
    // Auto-respawn on the same port/secret so the renderer can reconnect
    // (Round 10 scenario C: kill agent → reconnect must recover).
    if (!isQuitting && agentStartedByUs && agentDataDir && agentPort && agentSecret && !agentRespawning) {
      agentRespawning = true;
      const respawnPort = agentPort;
      const respawnSecret = agentSecret;
      const respawnDataDir = agentDataDir;
      const respawnBundled = agentBundledDir;
      setTimeout(() => {
        void (async () => {
          try {
            console.log(`[kairo] Respawning agent on port ${respawnPort}…`);
            const agentPath = resolveAgentPath();
            verifyAgentBinary(agentPath);
            const args = [
              '--bind', '127.0.0.1',
              '--port', String(respawnPort),
              '--data-dir', respawnDataDir,
              '--log-level', 'info',
            ];
            if (respawnBundled) args.push('--bundled-dir', respawnBundled);
            agentProcess = spawn(agentPath, args, {
              stdio: ['ignore', 'pipe', 'pipe'],
              // DK-P1-1: preserve JDK/Tomcat config env on respawn.
              env: buildAgentEnv(respawnSecret, respawnDataDir),
            });
            childLifecycle.register('agent', agentProcess);
            agentProcess.stdout?.on('data', (data: Buffer) => {
              process.stdout.write(`[agent] ${data.toString('utf-8')}`);
            });
            agentProcess.stderr?.on('data', (data: Buffer) => {
              process.stderr.write(`[agent] ${data.toString('utf-8')}`);
            });
            agentProcess.on('exit', (c, s) => {
              childExitCodes.set('agent', { code: c, signal: s });
              agentProcess = null;
              if (!isQuitting) {
                console.error(`[kairo] Respawned agent exited code=${c} signal=${s}`);
              }
            });
            // Brief health wait. Agent writes agent-state.json itself (0600).
            const healthURL = `http://127.0.0.1:${respawnPort}/api/v1/health`;
            for (let i = 0; i < 40; i++) {
              try {
                await new Promise<void>((resolve, reject) => {
                  const req = http.get(healthURL, (res) => {
                    res.resume();
                    res.statusCode === 200 ? resolve() : reject(new Error(String(res.statusCode)));
                  });
                  req.on('error', reject);
                  req.setTimeout(1000, () => {
                    req.destroy();
                    reject(new Error('timeout'));
                  });
                });
                console.log(`[kairo] Agent respawned healthy on port ${respawnPort}`);
                return;
              } catch {
                await new Promise((r) => setTimeout(r, 250));
              }
            }
            console.error('[kairo] Agent respawn health check failed');
          } catch (err: any) {
            console.error(`[kairo] Agent respawn failed: ${err?.message || err}`);
          } finally {
            agentRespawning = false;
          }
        })();
      }, 800);
    }
  });

  agentSecret = secret;

  // Discover the OS-assigned port before returning so Theia can start in
  // parallel with the health check (still no findFreePort TOCTOU).
  const portDiscover = waitForAgentPort(dataDir, 15_000).then((port) => {
    agentPort = port;
    console.log(`[kairo] Agent bound port ${port}`);
    return port;
  });

  const ready = (async () => {
    const port = await portDiscover;
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
          setTimeout(check, 100);
        };

        check();
      });
    } catch (err: any) {
      const stdout = stdoutChunks.join('').slice(-4096);
      const stderr = stderrChunks.join('').slice(-4096);
      console.error(`[kairo] Agent health check failed. stdout (last 4KB):\n${stdout}`);
      console.error(`[kairo] Agent health check failed. stderr (last 4KB):\n${stderr}`);

      // DK-P2-2: await ProcessManager escalation instead of fire-and-forget
      // kill + immediately nulling the ref (which skipped SIGKILL before).
      try {
        await childLifecycle.manager.shutdownOne('agent', {
          termTimeoutMs: 3_000,
          killTimeoutMs: 3_000,
        });
      } catch { /* best-effort */ }
      agentProcess = null;

      throw new Error(
        `Failed to start the Kairo Runtime Agent.\n\n` +
        `The agent process did not become healthy within ${timeout / 1000}s.\n\n` +
        `Details: ${err.message}\n\n` +
        `Last stderr output:\n${stderr.slice(-1024) || '(none)'}`
      );
    }
    console.log(`[kairo] Agent healthy on port ${port}`);
  })();

  const port = await portDiscover;
  return { port, secret, ready };
}

async function stopAgent(): Promise<void> {
  // DK-P2-1: ChildLifecycle stops reused agents by default unless
  // KAIRO_KEEP_REUSED_AGENT=1 (with kairo-runtime cmdline verify).
  console.log('[kairo] Stopping agent...');
  await childLifecycle.stopAgent();
  agentProcess = null;
}

// ─── Theia Backend ────────────────────────────────────────────

async function startTheiaBackend(): Promise<number> {
  // Theia backend entry, copied from apps/browser/lib/backend/main.js
  // into apps/desktop/lib/backend/main.js by copy-browser-artifacts.js.
  const theiaEntry = path.join(__dirname, 'backend', 'main.js');

  // Port discovery (DK-P2-5): prefer THEIA_PORT / theia-state.json when
  // present; otherwise scrape known Theia listen log lines. Log scrape
  // remains the fallback because this bundle entry ignores THEIA_PORT
  // and CLI --port and only announces the ephemeral bind via stdout —
  // see theia-port-discover.ts module header.
  console.log(`[kairo] Starting Theia backend: ${theiaEntry}`);

  // Electron window: preload owns getSecret — do not pass the session
  // secret into the Theia child (avoids HTML embedding). Headless:
  // browser clients fetch secret via /kairo-agent-secret, so pass it
  // to the backend env only (never embedded in HTML).
  const theiaEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // Run Electron as plain Node.js so the Theia backend can use
    // require() / CommonJS without the Chromium runtime overhead.
    ELECTRON_RUN_AS_NODE: '1',
    KAIRO_DESKTOP: '1',
    KAIRO_AGENT_URL: `http://127.0.0.1:${agentPort}`,
    // If the operator passes a workspace path, Theia reads it
    // from THEIA_DEFAULT_FOLDER and opens it on startup. This
    // makes "Kairo IDE" show files when the user has never opened
    // a project before (e.g. on a fresh install with no userData).
    ...(process.env.KAIRO_OPEN_FOLDER
      ? { THEIA_DEFAULT_FOLDER: process.env.KAIRO_OPEN_FOLDER }
      : {}),
  };
  if (isHeadless) {
    theiaEnv.KAIRO_HEADLESS = '1';
    theiaEnv.KAIRO_AGENT_SECRET = agentSecret;
    delete theiaEnv.KAIRO_AGENT_SECRET_VIA_PRELOAD;
  } else {
    theiaEnv.KAIRO_AGENT_SECRET_VIA_PRELOAD = '1';
    // Clear any inherited secret so the backend cannot inject it.
    theiaEnv.KAIRO_AGENT_SECRET = '';
  }

  theiaProcess = spawn(process.execPath, [theiaEntry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: theiaEnv,
  });
  childLifecycle.register('theia', theiaProcess);

  // Capture stdout/stderr. Patterns live in theia-port-discover.ts.
  let logBuffer = '';
  let logPort: number | undefined;
  const dataDir = process.env.KAIRO_DATA_DIR
    || path.join(app.getPath('userData'), 'kairo-data');
  const theiaStatePath = path.join(dataDir, 'theia-state.json');

  /** Ordered candidates: env → state file → log (stable signals first). */
  const collectCandidates = (): number[] => {
    const ports: number[] = [];
    const add = (p: number | undefined) => {
      if (p !== undefined && !ports.includes(p)) ports.push(p);
    };
    add(readTheiaPortFromEnv(theiaEnv));
    add(readTheiaPortFromStateFile(theiaStatePath));
    if (logPort === undefined) {
      logPort = parseTheiaListenPort(logBuffer);
    }
    add(logPort);
    return ports;
  };

  const collectData = (data: Buffer) => {
    const text = data.toString('utf8');
    logBuffer += text;
    if (logBuffer.length > 512_000) {
      logBuffer = logBuffer.slice(-256_000);
    }
    process.stdout.write(`[theia] ${text}`);
    if (logPort === undefined) {
      logPort = parseTheiaListenPort(logBuffer);
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

  // Wait for Theia to be ready: try each candidate port until one
  // answers HTTP. Stale THEIA_PORT from a parent env may fail while
  // the real log-discovered port succeeds.
  const startTime = Date.now();
  const timeout = 45_000;
  let readyPort: number | undefined;

  await new Promise<void>((resolve, reject) => {
    let candidateIndex = 0;

    const check = () => {
      if (!theiaProcess) {
        reject(new Error('Theia process died before becoming ready'));
        return;
      }
      const candidates = collectCandidates();
      if (candidates.length === 0) {
        retryOrReject(new Error('Waiting for Theia listen port'));
        return;
      }
      if (candidateIndex >= candidates.length) {
        candidateIndex = 0;
      }
      const port = candidates[candidateIndex];
      candidateIndex += 1;
      const healthURL = `http://127.0.0.1:${port}`;
      const req = http.get(healthURL, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          readyPort = port;
          resolve();
        } else {
          retryOrReject(new Error(`Theia returned status ${res.statusCode} on port ${port}`));
        }
      });
      req.on('error', () => {
        retryOrReject(new Error(`Theia not ready yet on port ${port}`));
      });
      req.setTimeout(3_000, () => {
        req.destroy();
        retryOrReject(new Error(`Theia health check timed out on port ${port}`));
      });
    };

    const retryOrReject = (err: Error) => {
      if (Date.now() - startTime > timeout) {
        reject(new Error(theiaPortDiscoverTimeoutMessage(timeout, err.message)));
        return;
      }
      setTimeout(check, 80);
    };

    check();
  });

  theiaPort = readyPort!;
  // DK-P2-5: persist discovered port/pid so resolvePreferredTheiaPort
  // can prefer theia-state.json on restart/reuse (kept separate from
  // agent-state.json).
  const theiaPid = theiaProcess?.pid;
  if (theiaPid && theiaPid > 0) {
    try {
      writeTheiaStateFile(theiaStatePath, { port: theiaPort, pid: theiaPid });
      console.log(`[kairo] theia state written to ${theiaStatePath} (port=${theiaPort}, pid=${theiaPid})`);
    } catch (err: any) {
      console.warn(`[kairo] failed to write theia-state.json: ${err?.message || err}`);
    }
  }
  console.log(`[kairo] Theia backend ready on port ${theiaPort}`);
  return theiaPort;
}

async function stopTheiaBackend(): Promise<void> {
  console.log('[kairo] Stopping Theia backend...');
  await childLifecycle.stopTheia();
  theiaProcess = null;
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

/** Native host-JDK picker for menu / status-bar "Switch JDK". */
ipcMain.handle('kairo:switch-host-jdk', async () => {
  const choice = await showJDKSetupDialog({ found: false, searchedPaths: [] });
  if (choice !== 'continue') {
    return choice;
  }
  const jdk = detectHostJDK(agentBundledDir);
  if (!jdk.found) {
    return 'continue';
  }
  applyHostJDKEnv(jdk);
  savePersistedJDKHome(jdk);
  try {
    const src = getPersistedJDKConfigPath();
    if (src && agentDataDir) {
      fs.copyFileSync(src, path.join(agentDataDir, 'host-jdk.json'));
    }
    if (src) process.env.KAIRO_JDK_CONFIG = src;
    if (agentDataDir) {
      // Clear marker so tryReuseAgent won't keep a stale agent.
      fs.writeFileSync(path.join(agentDataDir, 'agent-jdk-home.txt'), '', 'utf-8');
    }
  } catch (err) {
    console.warn('[kairo] Failed to sync JDK after switch:', err);
  }
  if (agentStartedByUs && agentDataDir) {
    await stopAgent();
    try {
      await startAgent(agentDataDir, agentBundledDir);
    } catch (err) {
      console.error('[kairo] Failed to respawn agent after JDK switch:', err);
    }
  }
  return 'continue';
});

/** Native Tomcat 6 picker (Tools / Kairo menu). */
async function configureTomcatHome(): Promise<'continue' | 'quit'> {
  const choice = await showTomcatSetupDialog();
  if (choice !== 'continue') {
    return choice;
  }
  const home = detectTomcatHome(agentBundledDir);
  if (!home) {
    return 'continue';
  }
  applyTomcatEnv(home);
  savePersistedTomcatHome(home);
  try {
    const src = getPersistedTomcatConfigPath();
    if (src && agentDataDir) {
      fs.copyFileSync(src, path.join(agentDataDir, 'host-tomcat.json'));
    }
    if (src) process.env.KAIRO_TOMCAT_CONFIG = src;
  } catch (err) {
    console.warn('[kairo] Failed to sync Tomcat after switch:', err);
  }
  if (agentStartedByUs && agentDataDir) {
    await stopAgent();
    try {
      await startAgent(agentDataDir, agentBundledDir);
    } catch (err) {
      console.error('[kairo] Failed to respawn agent after Tomcat switch:', err);
    }
  }
  return 'continue';
}

ipcMain.handle('kairo:switch-tomcat', () => configureTomcatHome());

// OS keychain-backed encryption for sensitive renderer data (SQL passwords).
ipcMain.handle('kairo:safe-storage-available', () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
});
ipcMain.handle('kairo:safe-storage-encrypt', (_event, plaintext: string) => {
  if (typeof plaintext !== 'string') {
    throw new Error('plaintext must be a string');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available');
  }
  return safeStorage.encryptString(plaintext).toString('base64');
});
ipcMain.handle('kairo:safe-storage-decrypt', (_event, ciphertextB64: string) => {
  if (typeof ciphertextB64 !== 'string') {
    throw new Error('ciphertext must be a string');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available');
  }
  return safeStorage.decryptString(Buffer.from(ciphertextB64, 'base64'));
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
        // NOTE: Theia disables `workspace:open` on Windows/Electron
        // (isEnabled: isOSX || !isElectron). Use `workspace:openFolder`
        // which is always enabled and opens the native directory dialog.
        { label: 'Open Folder...', ...action('workspace:openFolder') },
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
        { label: 'Close Tab', accelerator: process.platform === 'darwin' ? 'Cmd+W' : 'Ctrl+F4', ...action('core.close.tab') },
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
        // IDEA: Replace = Ctrl/Cmd+R (NOT Ctrl+H — that is Type Hierarchy)
        { label: 'Replace', accelerator: 'CmdOrCtrl+R', ...action('core.replace') },
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
        // IDEA: Go to File = Ctrl+Shift+N / Cmd+Shift+O (NOT Ctrl+P — that is Parameter Info)
        { label: 'Go to File...', accelerator: process.platform === 'darwin' ? 'Cmd+Shift+O' : 'Ctrl+Shift+N', ...action('kairo.find.file') },
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
            { label: 'Configure Tomcat...', click: () => { void configureTomcatHome(); } },
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
        { label: 'About Kairo IDE', ...action('core.about') },
      ],
    },
  ];
}

// ─── Window Creation ──────────────────────────────────────────

async function createWindow(): Promise<void> {
  // Set env vars in the main process so the preload script can read them
  process.env.KAIRO_AGENT_URL = `http://127.0.0.1:${agentPort}`;
  process.env.KAIRO_AGENT_SECRET = agentSecret;

  const workArea = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1600, Math.max(1280, Math.floor(workArea.width * 0.85))),
    height: Math.min(1000, Math.max(800, Math.floor(workArea.height * 0.85))),
    minWidth: 960,
    minHeight: 600,
    title: 'Kairo IDE',
    backgroundColor: '#1e1f22',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Avoid HiDPI zoom quirks that push the status bar off the true bottom.
      zoomFactor: 1,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      flog('[startup] window-shown');
    }
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
    // Workspace Trust must be an explicit user decision. Do not auto-click
    // the trust dialog (DK-P0-5) — a malicious workspace would otherwise
    // receive full trust without consent.
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

  /** Allow only the Theia frontend port on loopback; never the agent API port. */
  const isAllowedLocalFrontendUrl = (raw: string): boolean => {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return false;
      }
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
        return false;
      }
      const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
      if (!Number.isFinite(port)) {
        return false;
      }
      // Deny agent API port even when it shares loopback (DK-P0-7).
      if (agentPort > 0 && port === agentPort) {
        return false;
      }
      // Only the Theia frontend port is a valid top-frame / window.open target.
      return theiaPort > 0 && port === theiaPort;
    } catch {
      return false;
    }
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        console.warn('[kairo] refusing to open URL with non-http(s) scheme:', u.protocol);
        return { action: 'deny' };
      }
      // Allow localhost window.open only for the Theia frontend port.
      // Theia creates a new window via window.open when opening a
      // folder/workspace while workspace.preserveWindow=false.
      if (isAllowedLocalFrontendUrl(url)) {
        console.log('[kairo] allowing local window.open:', url);
        return { action: 'allow' };
      }
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        console.warn(`[kairo] refusing local window.open to non-frontend port: ${url}`);
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
  // navigate the main frame to an external URL or the agent API
  // port, block it. This is a defense-in-depth measure — the CSP
  // already restricts connect-src, but navigating the top frame to
  // http://evil.com would replace the IDE entirely.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalFrontendUrl(url)) {
      event.preventDefault();
      console.warn(`[kairo] blocked top-frame navigation to non-frontend URL: ${url}`);
    }
  });

  // DK-P2-9: also block HTTP(S) redirects that would escape the Theia
  // frontend allowlist (will-navigate alone misses Location redirects).
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedLocalFrontendUrl(url)) {
      event.preventDefault();
      console.warn(`[kairo] blocked redirect to non-frontend URL: ${url}`);
    }
  });

  // Cover subframe navigations (Theia iframes / secondary frames).
  // Non-http(s) subframe targets (about:blank, blob:, data:) are allowed;
  // http(s) must still pass the same frontend allowlist.
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    const url = details.url;
    try {
      const u = new URL(url);
      if (!details.isMainFrame && u.protocol !== 'http:' && u.protocol !== 'https:') {
        return;
      }
    } catch {
      details.preventDefault();
      console.warn(`[kairo] blocked malformed frame navigation URL: ${url}`);
      return;
    }
    if (!isAllowedLocalFrontendUrl(url)) {
      details.preventDefault();
      console.warn(`[kairo] blocked frame navigation to non-frontend URL: ${url}`);
    }
  });

  // Config is injected BEFORE the page loads via the preload script.
  // No executeJavaScript — avoids the race condition.
  const tLoad = Date.now();
  await mainWindow.loadURL(`http://127.0.0.1:${theiaPort}`);
  flog(`[startup] loadURL=${Date.now() - tLoad}ms`);

  const applyMenu = () => {
    try {
      const menu = Menu.buildFromTemplate(buildMenuTemplate());
      Menu.setApplicationMenu(menu);
      flog('[kairo] native application menu set');
    } catch (err: any) {
      flog(`[kairo] menu set failed: ${err?.message || err}`);
    }
  };
  applyMenu();
  mainWindow.webContents.once('did-finish-load', applyMenu);

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
    //
    // 'unsafe-inline' is intentionally omitted from script-src
    // (DK-P0-3). index.html only loads ./bundle.js; any needed
    // inline scripts must use a nonce/hash. style-src still
    // allows 'unsafe-inline' because Monaco/Theia inject
    // dynamic style elements extensively.
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-eval'",
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
  // DK-P2-4: second instance must not quit silently — headless prints to
  // stderr; GUI shows a brief error box (works before app 'ready').
  const msg =
    'Another instance of Kairo IDE is already running. This instance will quit.';
  console.error(`[kairo] ${msg}`);
  try {
    process.stderr.write(`[kairo] ${msg}\n`);
  } catch {
    /* ignore */
  }
  if (!isHeadless) {
    try {
      dialog.showErrorBox('Kairo IDE', msg);
    } catch {
      /* dialog unavailable — stderr already notified */
    }
  }
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

    // Isolate Theia config from the shared ~/.theia directory so each
    // --user-data-dir (QA trains, multi-profile) keeps its own
    // recentworkspace.json. Without this, Electron instances reopen the
    // globally most-recent folder and builds hit the wrong project root.
    if (!process.env.THEIA_CONFIG_DIR) {
      process.env.THEIA_CONFIG_DIR = path.join(app.getPath('userData'), 'theia-config');
    }
    try {
      fs.mkdirSync(process.env.THEIA_CONFIG_DIR, { recursive: true });
    } catch {
      /* ignore */
    }

    // Now that the app is ready we can use app.getPath('userData')
    // to set up the log file for packaged builds.
    ensureFileLogger();
    const startupT0 = Date.now();
    const phase = (name: string) => flog(`[startup] ${name}=${Date.now() - startupT0}ms`);
    phase('ready');

    const bundledDir = app.isPackaged
      ? path.join(process.resourcesPath, 'bundled')
      : undefined;
    const dataDir = path.join(app.getPath('userData'), 'kairo-data');

    // Overlap filesystem prep / validation with JDK detect (OPT-001).
    const [warnings, jdkDetected] = await Promise.all([
      Promise.resolve().then(() => {
        fs.mkdirSync(dataDir, { recursive: true });
        return validateStartup();
      }),
      Promise.resolve().then(() => detectHostJDK(bundledDir)),
    ]);
    for (const w of warnings) {
      console.warn(`[kairo] startup warning: ${w}`);
    }
    phase('jdk+prep');

    // ── Host JDK (unified) ────────────────────────────────────
    // Prefer one JDK 21+ install for both the IDE host and JDT LS.
    // Fall back to JDK 17+ when 21 is unavailable (language features
    // stay limited until a 21+ runtime is configured).
    let jdkResult = jdkDetected;
    if (jdkResult.found) {
      applyHostJDKEnv(jdkResult);
      savePersistedJDKHome(jdkResult);
      console.log(`[kairo] Host JDK ${jdkResult.version} at ${jdkResult.javaHome}`);
      if ((jdkResult.major ?? 0) < JDT_LS_MIN_JDK_MAJOR) {
        console.warn(
          `[kairo] Host JDK is below ${JDT_LS_MIN_JDK_MAJOR}; JDT LS needs JDK ${JDT_LS_MIN_JDK_MAJOR}+ — set KAIRO_JDT_LS_JRE`,
        );
      }
    } else {
      console.warn('[kairo] No JDK 17+ detected, showing setup dialog');
      const userChoice = await showJDKSetupDialog(jdkResult);
      if (userChoice === 'quit') {
        app.quit();
        return;
      }
      jdkResult = detectHostJDK(bundledDir);
      if (jdkResult.found) {
        applyHostJDKEnv(jdkResult);
        savePersistedJDKHome(jdkResult);
        console.log(`[kairo] Host JDK ${jdkResult.version} configured at ${jdkResult.javaHome}`);
      } else {
        console.warn('[kairo] Proceeding without JDK 17+ — Java language features will be limited');
      }
    }

    // Mirror host-jdk.json into the agent dataDir so Go Detect() can
    // find it even when KAIRO_JDK_HOME was not inherited (reuse edge cases).
    try {
      const src = getPersistedJDKConfigPath();
      if (src && fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dataDir, 'host-jdk.json'));
      }
      if (src) {
        process.env.KAIRO_JDK_CONFIG = src;
      }
      process.env.KAIRO_DATA_DIR = dataDir;
    } catch (err) {
      console.warn('[kairo] Failed to sync host-jdk.json into dataDir:', err);
    }

    // ── Tomcat 6 home (same persistence pattern as host JDK) ──
    let tomcatHome = detectTomcatHome(bundledDir);
    if (tomcatHome) {
      applyTomcatEnv(tomcatHome);
      savePersistedTomcatHome(tomcatHome);
      console.log(`[kairo] Tomcat 6 at ${tomcatHome}`);
    } else {
      console.warn('[kairo] No Tomcat 6 detected, showing setup dialog');
      const tomcatChoice = await showTomcatSetupDialog();
      if (tomcatChoice === 'quit') {
        app.quit();
        return;
      }
      tomcatHome = detectTomcatHome(bundledDir);
      if (tomcatHome) {
        applyTomcatEnv(tomcatHome);
        savePersistedTomcatHome(tomcatHome);
        console.log(`[kairo] Tomcat 6 configured at ${tomcatHome}`);
      } else {
        console.warn('[kairo] Proceeding without Tomcat 6 — server start will fail until configured');
      }
    }
    try {
      const tomcatCfg = getPersistedTomcatConfigPath();
      if (tomcatCfg && fs.existsSync(tomcatCfg)) {
        fs.copyFileSync(tomcatCfg, path.join(dataDir, 'host-tomcat.json'));
      }
      if (tomcatCfg) {
        process.env.KAIRO_TOMCAT_CONFIG = tomcatCfg;
      }
    } catch (err) {
      console.warn('[kairo] Failed to sync host-tomcat.json into dataDir:', err);
    }

    // Set CSP on the default session as a safety net (the
    // 'session-created' listener above should already have caught
    // it, but this guarantees the default session is covered).
    setupCSP(session.defaultSession);

    try {
      // Try to reuse an existing agent first. If one is already
      // running (e.g. started by a previous Desktop session or by
      // the browser launcher), connect to it instead of starting a
      // duplicate. This enables the "Desktop + Browser sharing the
      // same agent" workflow.
      const reused = await tryReuseAgent(dataDir);
      phase(reused ? 'agent-reuse' : 'agent-reuse-miss');
      let port: number;
      let secret: string;
      if (reused) {
        port = reused.port;
        secret = reused.secret;
        setAgentStartedByUs(false);
        agentPort = port;
        agentSecret = secret;
        agentDataDir = dataDir;
        childLifecycle.agentStatePath = path.join(dataDir, 'agent-state.json');
        // Track PID so quit can stop reused agent (opt-out: KAIRO_KEEP_REUSED_AGENT=1).
        if (reused.pid > 0) {
          childLifecycle.manager.registerByPid('agent', reused.pid);
        }
        await startTheiaBackend();
        phase('theiaReady');
      } else {
        // Start Go Agent; open window as soon as Theia is up — do not block
        // first paint on agent health (OPT-001). Agent reconnects in UI.
        const result = await startAgent(dataDir, bundledDir);
        phase('agentSpawn');
        port = result.port;
        secret = result.secret;
        setAgentStartedByUs(true);
        agentPort = port;
        agentSecret = secret;
        await Promise.all([
          result.ready.then(() => phase('agentReady')),
          startTheiaBackend().then(() => phase('theiaReady')),
        ]);
      }

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
          // DK-P1-7: after exit handlers null the refs, `?.killed` is falsey
          // forever — quit when both children are gone.
          if (!agentProcess && !theiaProcess) {
            console.log('[kairo] All child processes exited, quitting.');
            app.quit();
          }
        }, 5000).unref();
      } else {
        phase('createWindow');
        await createWindow();
        phase('windowLoaded');
      }

    } catch (err: any) {
      console.error('[kairo] Failed to start:', err);
      dialog.showErrorBox('Kairo IDE Error',
        `Failed to start Kairo IDE:\n${err.message}\n\nPlease check the console for details.`);
      await stopTheiaBackend();
      await stopAgent();
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    isQuitting = true;

    // Log child process exit codes for diagnostics.
    flog(`[kairo] shutdown initiated; child exit codes: ${JSON.stringify([...childExitCodes.entries()])}`);
    flog(`[kairo] process manager:\n${childLifecycle.manager.getDiagnostics()}`);

    // Only run cleanup once — app.exit / nested quit must not re-enter.
    if (quitCleanupStarted) {
      return;
    }
    quitCleanupStarted = true;
    event.preventDefault();

    void (async () => {
      try {
        await childLifecycle.stopOwned({
          termTimeoutMs: 2_000,
          killTimeoutMs: 2_000,
        });
      } catch (err: any) {
        flog(`[kairo] stopOwned error: ${err?.message || err}`);
      } finally {
        agentProcess = null;
        theiaProcess = null;
        // Final PID sweep for anything that survived graceful shutdown.
        childLifecycle.forceKillOwnedSync();
        app.exit(0);
      }
    })();

    // WM_CLOSE / app.quit() can stall for ~15s on Windows when a
    // child process (Theia, the Go agent, or a hung renderer)
    // refuses to release its stdio pipes. Without a hard timeout
    // the user sees the window vanish but the tray icon — and
    // sometimes the whole process tree — linger. After 5s we
    // bypass any in-flight cleanup and force-exit the process.
    setTimeout(() => {
      flog('[kairo] quit timeout reached; forcing app.exit(0)');
      childLifecycle.forceKillOwnedSync();
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
  // PID-based tree kill — works even when ChildProcess refs were nulled.
  childLifecycle.forceKillOwnedSync();
});