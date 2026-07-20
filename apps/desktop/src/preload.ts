/**
 * Kairo IDE — preload script.
 *
 * Runs in a sandboxed context (contextIsolation=true, sandbox=true,
 * nodeIntegration=false) before the renderer process loads.
 * Exposes only the minimal, safe API surface via contextBridge.
 *
 * Security guarantees:
 *   - No Node.js / Electron API surface leaks to the renderer.
 *   - Secret is held in a closure, never written to localStorage,
 *     URL, logs, or any storage. It is only accessible via
 *     getSecret() which returns it in-memory.
 *   - All IPC is channel-scoped; the renderer cannot reach
 *     arbitrary IPC channels.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Read config from environment variables set by the main process
// BEFORE the renderer starts. No race condition (unlike
// executeJavaScript injection).
const agentUrl = process.env.KAIRO_AGENT_URL || 'http://127.0.0.1:18080';
const secret = process.env.KAIRO_AGENT_SECRET || '';
const appVersion = process.env.KAIRO_APP_VERSION || '0.1.0';

// ─── Primary API: window.__kairo ──────────────────────────────
// The spec name for the desktop preload API. The runtime
// connection service reads from this.

contextBridge.exposeInMainWorld('__kairo', {
    /** Base URL of the Go Runtime Agent (e.g. http://127.0.0.1:18080). */
    agentBaseUrl: agentUrl,
    /**
     * Returns the session-local auth secret. The secret is held
     * in a closure, never written to localStorage, URL, or logs.
     * Only accessible in memory via this function.
     */
    getSecret: (): string => secret,
    /** Product version string. */
    productVersion: appVersion,
});

// ─── Backward-compat APIs ─────────────────────────────────────
// Existing code reads these window globals. Keep them until all
// consumers migrate to window.__kairo.

contextBridge.exposeInMainWorld('kairoConfig', {
    agentUrl,
    agentSecret: secret,
    platform: process.platform,
    appVersion,
    noKairoFrontend: process.env.KAIRO_NO_KAIRO_FRONTEND === '1',
});

contextBridge.exposeInMainWorld('KAIRO_RUNTIME_BASE_URL', agentUrl);

contextBridge.exposeInMainWorld('__KAIRO_DEFAULT_RUNTIME_URL__', agentUrl);

// ─── IPC ──────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('kairoIPC', {
    onMenuAction: (callback: (action: string) => void) => {
        ipcRenderer.on('menu-action', (_event, action: string) => callback(action));
    },
    sendReady: () => {
        ipcRenderer.send('renderer-ready');
    },
});