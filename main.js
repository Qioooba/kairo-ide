"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
const protocol_1 = require("@kairo/protocol");
const crypto_1 = require("crypto");
let agentProcess = null;
let agentPort = 0;
let agentSecret = '';
let theiaProcess = null;
let theiaPort = 0;
let mainWindow = null;
let isQuitting = false;
// Track child process exit codes for diagnostics.
const childExitCodes = new Map();
// File-based logger. Electron on Windows detaches from the parent's
// stdout when launched as a GUI app, which makes `pnpm start | tee`
// unreliable for debugging. This mirrors every console.log/warn/error
// to artifacts/desktop-main.log so we can post-mortem the launch.
let mainLogPath;
function flog(...args) {
    const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    if (mainLogPath) {
        try {
            fs.appendFileSync(mainLogPath, text + '\n');
        }
        catch { /* log dir gone; just skip */ }
    }
}
function initFileLogger() {
    if (process.env.KAIRO_DESKTOP_LOG_FILE) {
        mainLogPath = process.env.KAIRO_DESKTOP_LOG_FILE;
    }
    else {
        // Default to <repo>/artifacts/desktop-main.log when present,
        // otherwise a temp path. Falling back to a temp path is fine
        // because the only caller passing nothing is the packaged
        // build, where the OS log facility takes over.
        const candidate = path.join(__dirname, '..', '..', '..', 'artifacts', 'desktop-main.log');
        try {
            fs.mkdirSync(path.dirname(candidate), { recursive: true });
            mainLogPath = candidate;
        }
        catch {
            mainLogPath = undefined;
        }
    }
    // Mirror console to file for the lifetime of the main process.
    const wrap = (orig) => (...args) => {
        orig.apply(console, args);
        flog(...args);
    };
    console.log = wrap(console.log);
    console.warn = wrap(console.warn);
    console.error = wrap(console.error);
    console.info = wrap(console.info);
}
// ─── Startup Validation ──────────────────────────────────────
/**
 * Validates the runtime environment before launching child processes.
 * Returns an array of warning messages (non-fatal) or throws on fatal errors.
 */
function validateStartup() {
    const warnings = [];
    // 1. Node.js version check — Electron 39 ships Node 22, we require >= 20.10
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    if (isNaN(nodeMajor) || nodeMajor < 20) {
        throw new Error(`Unsupported Node.js version: ${process.versions.node}. ` +
            `Kairo IDE requires Node.js >= 20.10.0.`);
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
            throw new Error(`KAIRO_AGENT_PATH is set but the binary does not exist: ${process.env.KAIRO_AGENT_PATH}`);
        }
    }
    // 5. Validate data directory writability
    const userDataPath = electron_1.app.getPath('userData');
    try {
        fs.accessSync(userDataPath, fs.constants.W_OK);
    }
    catch {
        warnings.push(`User data directory is not writable: ${userDataPath}`);
    }
    return warnings;
}
// ─── Secret Generation ────────────────────────────────────────
function generateSecret() {
    return (0, crypto_1.randomBytes)(32).toString('hex');
}
// ─── Agent Lifecycle ──────────────────────────────────────────
function resolveAgentPath() {
    // Allow operators to override the binary location (e.g. local dev or
    // custom install layouts). When unset, fall back to the packaged
    // extraResources location (or monorepo-local Go build output in dev).
    if (process.env.KAIRO_AGENT_PATH) {
        return process.env.KAIRO_AGENT_PATH;
    }
    const binaryName = process.platform === 'win32' ? 'kairo-runtime.exe' : 'kairo-runtime';
    // Packaged build: extraResources puts the binary at <resourcesPath>/bin/.
    if (electron_1.app.isPackaged) {
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
    throw new Error(`Cannot locate kairo-runtime binary in dev mode. Searched in: ${devDir} ` +
        `(candidates: ${candidates.join(', ')}). Either run the desktop prebuild ` +
        `(pnpm --filter @kairo/desktop prebuild) or set KAIRO_AGENT_PATH to the binary location.`);
}
function verifyAgentBinary(agentPath) {
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
        }
        catch {
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
    }
    catch (err) {
        if (err.message && err.message.startsWith('Agent binary'))
            throw err;
        // spawnSync itself threw (e.g. ENOENT on missing shell)
        throw new Error(`Cannot verify agent binary: ${err.message}`);
    }
}
async function startAgent(dataDir, bundledDir) {
    const port = await (0, protocol_1.findFreePort)();
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
    const stdoutChunks = [];
    const stderrChunks = [];
    agentProcess = (0, child_process_1.spawn)(agentPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            KAIRO_DESKTOP: '1',
        },
    });
    agentProcess.stdout?.on('data', (data) => {
        const text = data.toString('utf-8');
        stdoutChunks.push(text);
        process.stdout.write(`[agent] ${text}`);
    });
    agentProcess.stderr?.on('data', (data) => {
        const text = data.toString('utf-8');
        stderrChunks.push(text);
        process.stderr.write(`[agent] ${text}`);
    });
    agentProcess.on('error', (err) => {
        console.error(`[kairo] Agent process error: ${err.message}`);
    });
    agentProcess.on('exit', (code, signal) => {
        childExitCodes.set('agent', { code, signal });
        if (!isQuitting) {
            console.error(`[kairo] Agent exited unexpectedly with code ${code}, signal ${signal}`);
        }
        else {
            console.log(`[kairo] Agent exited with code ${code}, signal ${signal}`);
        }
        agentProcess = null;
    });
    // Wait for health check
    const healthURL = `http://127.0.0.1:${port}/api/v1/health`;
    const startTime = Date.now();
    const timeout = 15_000;
    try {
        await new Promise((resolve, reject) => {
            const check = () => {
                if (!agentProcess) {
                    reject(new Error('Agent process died before health check'));
                    return;
                }
                const req = http.get(healthURL, (res) => {
                    res.resume();
                    if (res.statusCode === 200) {
                        resolve();
                    }
                    else {
                        retryOrReject(new Error(`Health check returned status ${res.statusCode}`));
                    }
                });
                req.on('error', (err) => {
                    retryOrReject(err);
                });
                req.setTimeout(2_000, () => {
                    req.destroy();
                    retryOrReject(new Error('Health check request timed out'));
                });
            };
            const retryOrReject = (err) => {
                if (Date.now() - startTime > timeout) {
                    reject(new Error('Agent health check timed out after ' + timeout + 'ms: ' + err.message));
                    return;
                }
                setTimeout(check, 300);
            };
            check();
        });
    }
    catch (err) {
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
        throw new Error(`Failed to start the Kairo Runtime Agent.\n\n` +
            `The agent process did not become healthy within ${timeout / 1000}s.\n\n` +
            `Details: ${err.message}\n\n` +
            `Last stderr output:\n${stderr.slice(-1024) || '(none)'}`);
    }
    agentPort = port;
    agentSecret = secret;
    console.log(`[kairo] Agent healthy on port ${port}`);
    return { port, secret };
}
function killProcessTree(proc, signal) {
    if (!proc || proc.killed || !proc.pid)
        return;
    try {
        if (process.platform === 'win32') {
            // Windows: taskkill /T /PID kills the process and all its children.
            (0, child_process_1.exec)(`taskkill /T /PID ${proc.pid} /F`, { timeout: 5_000 }, (err) => {
                if (err)
                    console.error(`[kairo] taskkill error: ${err.message}`);
            });
        }
        else {
            // Unix: negative PID sends signal to the entire process group.
            try {
                process.kill(-proc.pid, signal);
            }
            catch {
                // Fallback: kill just the parent.
                proc.kill(signal);
            }
        }
    }
    catch (err) {
        console.error(`[kairo] killProcessTree error: ${err.message}`);
    }
}
function stopAgent() {
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
async function startTheiaBackend() {
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
    theiaProcess = (0, child_process_1.spawn)(process.execPath, [theiaEntry], {
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
    let discoveredPort;
    const portRegex = /listening on (?:https?:\/\/)?(?:[^\s/:]+):(\d{2,5})/i;
    const collectData = (data) => {
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
    theiaProcess.on('error', (err) => {
        console.error(`[kairo] Theia process error: ${err.message}`);
    });
    theiaProcess.on('exit', (code, signal) => {
        childExitCodes.set('theia', { code, signal });
        if (!isQuitting) {
            console.error(`[kairo] Theia backend exited unexpectedly with code ${code}, signal ${signal}`);
        }
        else {
            console.log(`[kairo] Theia backend exited with code ${code}, signal ${signal}`);
        }
        theiaProcess = null;
    });
    // Wait for Theia to be ready: discover port from logs, then
    // poll that port's HTTP server.
    const startTime = Date.now();
    const timeout = 45_000;
    await new Promise((resolve, reject) => {
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
                }
                else {
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
        const retryOrReject = (err) => {
            if (Date.now() - startTime > timeout) {
                reject(new Error('Theia backend timed out after ' + timeout + 'ms: ' + err.message));
                return;
            }
            setTimeout(check, 500);
        };
        check();
    });
    theiaPort = discoveredPort;
    console.log(`[kairo] Theia backend ready on port ${theiaPort}`);
    return theiaPort;
}
function stopTheiaBackend() {
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
electron_1.ipcMain.on('renderer-ready', () => {
    console.log('[kairo] renderer process is ready');
});
// Send menu actions to the renderer process.
function sendMenuAction(action) {
    if (mainWindow) {
        mainWindow.webContents.send('menu-action', action);
    }
}
// ─── Window Creation ──────────────────────────────────────────
async function createWindow() {
    // Set env vars in the main process so the preload script can read them
    process.env.KAIRO_AGENT_URL = `http://127.0.0.1:${agentPort}`;
    process.env.KAIRO_AGENT_SECRET = agentSecret;
    mainWindow = new electron_1.BrowserWindow({
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
    if (!electron_1.app.isPackaged && !process.env.KAIRO_NO_DEVTOOLS) {
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
                electron_1.shell.openExternal(url);
            }
            else {
                console.warn('[kairo] refusing to open URL with scheme:', u.protocol);
            }
        }
        catch {
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
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
    electron_1.app.on('ready', async () => {
        // Set the app version so the preload script can expose it.
        process.env.KAIRO_APP_VERSION = electron_1.app.getVersion();
        // Run startup validation before launching child processes.
        const warnings = validateStartup();
        for (const w of warnings) {
            console.warn(`[kairo] startup warning: ${w}`);
        }
        // Set CSP before creating any windows.
        electron_1.app.on('session-created', (session) => {
            session.webRequest.onHeadersReceived((details, callback) => {
                // Theia 1.73 ships with ajv-generated validators that use
                // `new Function` for JSON schema compile. Without
                // 'unsafe-eval' the very first schema validate throws
                // EvalError and the frontend hangs in the splash. We
                // therefore default the production CSP to the tightest
                // policy that still lets Theia load its static assets, and
                // gate 'unsafe-eval' behind KAIRO_DEV=1 so packaged builds
                // ship with a hardened policy. If the renderer ever truly
                // needs eval in production, switch the policy to add it
                // back — but record the reason in the commit message.
                const scriptSrcExtra = process.env.KAIRO_DEV === '1' ? " 'unsafe-eval'" : '';
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
        });
        try {
            const dataDir = path.join(electron_1.app.getPath('userData'), 'kairo-data');
            fs.mkdirSync(dataDir, { recursive: true });
            // In packaged builds, bundled resources (tomcat6, jdtls) live
            // under process.resourcesPath/bundled/. In dev, rely on the
            // repo-local bundled/ directory or KAIRO_BUNDLED_DIR env.
            const bundledDir = electron_1.app.isPackaged
                ? path.join(process.resourcesPath, 'bundled')
                : undefined;
            // Start Go Agent
            const { port, secret } = await startAgent(dataDir, bundledDir);
            // Start Theia Backend
            await startTheiaBackend();
            // Create window — config is passed via env to preload
            createWindow();
        }
        catch (err) {
            console.error('[kairo] Failed to start:', err);
            electron_1.dialog.showErrorBox('Kairo IDE Error', `Failed to start Kairo IDE:\n${err.message}\n\nPlease check the console for details.`);
            stopTheiaBackend();
            stopAgent();
            electron_1.app.quit();
        }
    });
    electron_1.app.on('before-quit', (event) => {
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
            electron_1.app.exit(0);
        }, 5_000);
    });
    electron_1.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            electron_1.app.quit();
        }
    });
    electron_1.app.on('activate', () => {
        if (mainWindow === null) {
            createWindow();
        }
    });
}
// Best-effort cleanup on process exit
process.on('exit', (code) => {
    flog(`[kairo] main process exiting with code ${code}; child exit codes: ${JSON.stringify([...childExitCodes.entries()])}`);
    if (agentProcess && !agentProcess.killed) {
        try {
            agentProcess.kill('SIGKILL');
        }
        catch { /* already gone */ }
    }
    if (theiaProcess && !theiaProcess.killed) {
        try {
            theiaProcess.kill('SIGKILL');
        }
        catch { /* already gone */ }
    }
});
//# sourceMappingURL=main.js.map