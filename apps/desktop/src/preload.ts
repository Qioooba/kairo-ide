/**
 * Kairo IDE — preload script.
 *
 * Runs in a privileged context before the renderer process loads.
 * Exposes only the minimal, safe API surface via contextBridge.
 *
 * Security guarantees:
 *   - No Node.js / Electron API surface leaks to the renderer.
 *   - Config is read from env vars set by the main process
 *     BEFORE the renderer starts — no race condition.
 *   - All IPC is channel-scoped; the renderer cannot reach
 *     arbitrary IPC channels.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Read config from environment variables set by main process.
// These are set BEFORE the renderer process starts, so no
// race condition (unlike executeJavaScript injection).
const agentUrl = process.env.KAIRO_AGENT_URL || 'http://127.0.0.1:18080';
const agentSecret = process.env.KAIRO_AGENT_SECRET || '';

// Expose a safe, typed API to the renderer process.
contextBridge.exposeInMainWorld('kairoConfig', {
    agentUrl,
    agentSecret,
    platform: process.platform,
    appVersion: process.env.KAIRO_APP_VERSION || '0.1.0',
    // Feature flags. The frontend module reads these so the
    // user can selectively disable the Kairo extensions and
    // fall back to the vanilla Theia shell for debugging.
    noKairoFrontend: process.env.KAIRO_NO_KAIRO_FRONTEND === '1',
});

// Expose safe IPC channels. Only the channels listed here are
// accessible from the renderer; all other IPC channels are
// blocked by contextIsolation.
contextBridge.exposeInMainWorld('kairoIPC', {
    onMenuAction: (callback: (action: string) => void) => {
        ipcRenderer.on('menu-action', (_event, action: string) => callback(action));
    },
    sendReady: () => {
        ipcRenderer.send('renderer-ready');
    },
});

// Also expose KAIRO_RUNTIME_BASE_URL globally so the frontend
// reads it without an extra /api/v1/endpoints round-trip. The
// product-bindings.ts reads window.KAIRO_RUNTIME_BASE_URL to
// configure RuntimeConnectionService.
contextBridge.exposeInMainWorld('KAIRO_RUNTIME_BASE_URL', agentUrl);

// Backward compatibility: also expose the runtime URL for the
// browser-mode path in runtime-connection-service.ts, which reads
// globalThis.__KAIRO_DEFAULT_RUNTIME_URL__ at init.
// contextBridge.exposeInMainWorld makes the value available as
// window.__KAIRO_DEFAULT_RUNTIME_URL__ (=== globalThis in the
// renderer's isolated world), which is the correct contract.
contextBridge.exposeInMainWorld('__KAIRO_DEFAULT_RUNTIME_URL__', agentUrl);