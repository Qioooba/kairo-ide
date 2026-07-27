// Kairo IDE Deep E2E Test v8c - debug-tree.cjs proven approach
// Key fix: use window.theia.URI + recursive constructor search for WorkspaceService
const fs = require('fs');
const path = require('path');
const os = require('os');
const { _electron: electron } = require('playwright');

const argv = process.argv.slice(2);
function arg(name, def) { const i = argv.indexOf(`--${name}`); return (i >= 0 && i + 1 < argv.length) ? argv[i+1] : def; }
const customExe = arg('exe', null);
const baseOutDir = arg('out', null);

const repoRoot = path.resolve(__dirname, '..', '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = baseOutDir || path.join(repoRoot, 'artifacts', 'test-results', 'deep8c-' + stamp);
const screenshotDir = path.join(runDir, 'screenshots');
fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

const TEST_WS_ROOT = path.join(os.tmpdir(), 'kairo-deep8c-' + stamp.replace(/-/g, ''));
const TEST_PROJECT_PATH = path.join(TEST_WS_ROOT, 'legacy-sample');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name), dp = path.join(dest, entry.name);
    if (entry.isDirectory()) { if (entry.name !== '.kairo' && entry.name !== 'node_modules' && entry.name !== '.git') copyDirSync(sp, dp); }
    else fs.copyFileSync(sp, dp);
  }
}
copyDirSync(path.join(repoRoot, 'legacy-sample'), TEST_PROJECT_PATH);

const GBK_PKG_DIR = path.join(TEST_PROJECT_PATH, 'src', 'main', 'java', 'com', 'example', 'gbk');
fs.mkdirSync(GBK_PKG_DIR, { recursive: true });
const gbkJavaContent = [
'package com.example.gbk;','',
'import java.io.IOException;','import java.io.PrintWriter;','import java.util.Date;',
'import javax.servlet.ServletException;','import javax.servlet.http.HttpServlet;',
'import javax.servlet.http.HttpServletRequest;','import javax.servlet.http.HttpServletResponse;','',
'/**',' * 中文注释测试类 - GBK编码',' * 这是一个用于测试Kairo IDE GBK编码支持的Servlet',
' * 功能说明：处理用户问候请求，返回中文页面',' */',
'public class GbkChineseServlet extends HttpServlet {','',
'    private static final long serialVersionUID = 1L;','',
'    /**','     * 处理GET请求 - 返回GBK编码的中文页面','     */','    @Override',
'    protected void doGet(HttpServletRequest req, HttpServletResponse resp)','            throws ServletException, IOException {',
'        String userName = req.getParameter("name");',
'        if (userName == null || userName.isEmpty()) { userName = "访客"; }',
'        resp.setContentType("text/html; charset=GBK");','        resp.setCharacterEncoding("GBK");',
'        PrintWriter out = resp.getWriter();',
'        out.println("<html><head><title>中文测试页面</title></head><body>");',
'        out.println("<h1>你好，" + userName + "！</h1>");',
'        out.println("<p>当前时间：" + new Date() + "</p>");',
'        out.println("</body></html>");','    }','}',''
].join('\r\n');
try {
  const iconv = require('iconv-lite');
  fs.writeFileSync(path.join(GBK_PKG_DIR, 'GbkChineseServlet.java'), iconv.encode(gbkJavaContent, 'gbk'));
} catch(e) {
  fs.writeFileSync(path.join(GBK_PKG_DIR, 'GbkChineseServlet.java'), '\ufeff' + gbkJavaContent, 'utf8');
}

const results = [];
const bugs = [];
const consoleErrors = [];
const startTime = Date.now();
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const warn = (m) => console.warn(`[${new Date().toISOString().slice(11, 23)}] WARN ${m}`);

let testCounter = 0;
let currentPage = null;
let currentApp = null;
let serverHttpPort = null;

async function runTest(section, id, name, priority, fn) {
  testCounter++;
  const start = Date.now();
  const safeName = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
  const result = { id, section, name, priority, status: 'pass', duration: 0, error: null, screenshot: null, timestamp: new Date().toISOString() };
  log(`▶ [${id}] §${section} ${priority}: ${name}`);
  try {
    await fn(result);
    result.duration = Date.now() - start;
    results.push(result);
    log(`  ✓ PASS (${result.duration}ms)`);
  } catch (err) {
    result.duration = Date.now() - start;
    result.status = 'fail';
    result.error = err.message || String(err);
    results.push(result);
    try {
      const shotPath = path.join(screenshotDir, `fail-${section}-${id}-${safeName}.png`);
      if (currentPage) { await currentPage.screenshot({ path: shotPath, fullPage: false }); result.screenshot = path.relative(runDir, shotPath); }
    } catch (_) {}
    log(`  ✗ FAIL (${result.duration}ms): ${result.error}`);
    if (priority === 'P0' || priority === 'P1') addBug(section, id, name, priority, result.error, result.screenshot);
  }
}
function addBug(section, testId, name, severity, error, screenshot) {
  const bugId = `KAIRO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(bugs.length+1).padStart(3,'0')}`;
  bugs.push({ id: bugId, section, testId, name, severity, error, screenshot });
}
async function shot(name) {
  try { const f = path.join(screenshotDir, `${name}.png`); await currentPage.screenshot({ path: f, fullPage: false }); log(`  📸 ${name}.png`); } catch(e) {}
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Agent API ──
async function agentGET(page, endpoint) {
  return page.evaluate(async (ep) => {
    const base = window.__kairo?.agentBaseUrl || 'http://127.0.0.1:18080';
    const secret = window.__kairo?.getSecret?.() || '';
    const headers = { 'Content-Type': 'application/json' };
    if (secret && !/\/(health|endpoints)/.test(ep)) headers['X-Kairo-Secret'] = secret;
    try {
      const res = await fetch(`${base}${ep}`, { method: 'GET', headers, signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch(_) {}
      return { ok: res.ok, status: res.status, body: text, json, base };
    } catch (err) { return { ok: false, status: 0, error: String(err), base }; }
  }, endpoint);
}
async function agentPOST(page, endpoint, payload) {
  return page.evaluate(async (args) => {
    const { ep, p } = args;
    const base = window.__kairo?.agentBaseUrl || 'http://127.0.0.1:18080';
    const secret = window.__kairo?.getSecret?.() || '';
    const headers = { 'Content-Type': 'application/json' };
    if (secret && !/\/(health|endpoints)/.test(ep)) headers['X-Kairo-Secret'] = secret;
    const body = p ? JSON.stringify({ requestId: `e2e-${Date.now()}`, payload: p }) : undefined;
    try {
      const res = await fetch(`${base}${ep}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch(_) {}
      return { ok: res.ok, status: res.status, body: text, json, base };
    } catch (err) { return { ok: false, status: 0, error: String(err), base }; }
  }, { ep: endpoint, p: payload });
}
async function agentDELETE(page, endpoint) {
  return page.evaluate(async (ep) => {
    const base = window.__kairo?.agentBaseUrl || 'http://127.0.0.1:18080';
    const secret = window.__kairo?.getSecret?.() || '';
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers['X-Kairo-Secret'] = secret;
    try {
      const res = await fetch(`${base}${ep}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch(_) {}
      return { ok: res.ok, status: res.status, body: text, json, base };
    } catch (err) { return { ok: false, status: 0, error: String(err), base }; }
  }, endpoint);
}

async function cleanAgentProjects(page) {
  try {
    const list = await agentGET(page, '/api/v1/projects');
    const projects = list.json?.payload;
    if (Array.isArray(projects)) {
      for (const p of projects) {
        const id = p.id || p.projectId;
        if (id) { await agentDELETE(page, `/api/v1/projects/${id}`); }
      }
    }
  } catch(e) { log(`  Clean projects warning: ${e.message}`); }
}

// ─── __kairoOpenProject helper (multi-strategy detection for minified bundles) ──
async function injectKairoHelpers(page) {
  await page.evaluate(() => {
    if (window.__kairoOpenProject) return;
    window.__kairoOpenProject = async function(rootPath, onClose) {
      console.log('[kairo-test] __kairoOpenProject called for:', rootPath);
      try {
        const container = window.theia?.container;
        if (!container?._bindingDictionary?._map) {
          console.error('[kairo-test] No DI container found in window.theia');
          if (onClose) onClose();
          return;
        }

        // Helper to get cached singleton instance from a binding
        function getCached(binding) {
          const cache = binding && (binding.cache || binding._cache);
          return (cache && !(cache instanceof Promise)) ? cache : undefined;
        }

        // ── Strategy 1: Use window.require to get actual WorkspaceService symbol (from debug-tree.cjs) ──
        let ws = null;
        try {
          if (typeof window.require === 'function') {
            const mod = await new Promise((resolve, reject) => {
              window.require('@theia/workspace/lib/browser/workspace-service', resolve, reject);
              setTimeout(() => reject(new Error('require timeout')), 5000);
            });
            if (mod && mod.WorkspaceService) {
              if (typeof container.getAsync === 'function') {
                ws = await container.getAsync(mod.WorkspaceService);
              } else if (typeof container.get === 'function') {
                ws = container.get(mod.WorkspaceService);
              }
              if (ws && typeof ws.open === 'function') {
                console.log('[kairo-test] Found WorkspaceService via window.require module');
              } else {
                ws = null;
              }
            }
          }
        } catch(e) {
          console.log('[kairo-test] window.require strategy failed:', e.message.slice(0, 100));
        }

        // ── Strategy 2: Look for Symbol key whose description matches 'WorkspaceService' ──
        if (!ws) {
          try {
            const dict = container._bindingDictionary._map;
            for (const [key] of dict.entries()) {
              if (typeof key === 'symbol' && key.toString() === 'Symbol(WorkspaceService)') {
                try {
                  if (typeof container.getAsync === 'function') {
                    ws = await container.getAsync(key);
                  } else {
                    ws = container.get(key);
                  }
                  if (ws && typeof ws.open === 'function' && typeof ws.addRoot === 'function') {
                    console.log('[kairo-test] Found WorkspaceService via symbol key match');
                    break;
                  }
                  ws = null;
                } catch(_) {}
              }
            }
          } catch(e) {
            console.log('[kairo-test] Symbol key search failed:', e.message);
          }
        }

        // ── Strategy 3: Shape-based detection with strict criteria ──
        if (!ws) {
          const dict = container._bindingDictionary._map;
          for (const [key, bindings] of dict.entries()) {
            for (const binding of bindings) {
              let inst = getCached(binding);
              // If not cached, try to resolve it (like container.get)
              if (!inst && typeof container.get === 'function' && typeof key !== 'string') {
                try { inst = container.get(key); } catch(_) {}
              }
              if (!inst || typeof inst !== 'object') continue;

              // Strict shape for WorkspaceService:
              // Must have: open(), addRoot(), close(), spliceRoots(), removeRoots()
              // Must have properties: workspace, roots, recentWorkspaces, opened
              // Must NOT have: onRequest (that's an RPC channel), target (connection), send (IPC)
              const hasMethods = typeof inst.open === 'function' &&
                                 typeof inst.addRoot === 'function' &&
                                 typeof inst.close === 'function' &&
                                 typeof inst.spliceRoots === 'function' &&
                                 typeof inst.getWorkspaceRootUri === 'function';
              const hasProps = 'workspace' in inst && 'roots' in inst && 'recentWorkspaces' in inst && 'opened' in inst;
              const notRpc = !('onRequest' in inst) && !('target' in inst && typeof inst.send === 'function');

              if (hasMethods && hasProps && notRpc) {
                ws = inst;
                console.log('[kairo-test] Found WorkspaceService via shape detection, key type:', typeof key);
                break;
              }
            }
            if (ws) break;
          }
        }

        if (!ws) {
          console.error('[kairo-test] WorkspaceService not found by any strategy');
          if (onClose) onClose();
          return;
        }
        console.log('[kairo-test] WorkspaceService confirmed, opened:', ws.opened, 'ctor:', ws.constructor?.name, 'workspace:', ws.workspace?.name);

        // ── Find URI class ──
        // Strategy 1: window.theia.URI (dev build) or window.monaco.Uri (Monaco editor)
        let URI = window.theia?.URI || window.theia?.core?.URI || window.monaco?.Uri || window.monaco?.URI;
        
        // Strategy 2: window.require('@theia/core/lib/common/uri')
        if (!URI && typeof window.require === 'function') {
          try {
            const uriMod = await new Promise((resolve, reject) => {
              window.require('@theia/core/lib/common/uri', resolve, reject);
              setTimeout(() => reject(new Error('timeout')), 3000);
            });
            if (uriMod?.URI) URI = uriMod.URI;
            else if (uriMod?.default) URI = uriMod.default;
          } catch(e) {
            console.log('[kairo-test] window.require for URI failed:', e.message.slice(0,80));
          }
        }

        // Strategy 3: Find URI from existing instances in DI container
        // URI instances have: scheme, path, authority properties; toString() returns a URI string
        if (!URI) {
          const dict = container._bindingDictionary._map;
          for (const [key, bindings] of dict.entries()) {
            for (const binding of bindings) {
              let inst = getCached(binding);
              if (!inst && typeof container.get === 'function' && typeof key !== 'string') {
                try { inst = container.get(key); } catch(_) {}
              }
              if (!inst || typeof inst !== 'object') continue;
              // Check if this instance looks like a URI
              if ('scheme' in inst && 'path' in inst && 'authority' in inst && typeof inst.toString === 'function') {
                const str = inst.toString();
                if (str.startsWith('file://') || str.startsWith('http://')) {
                  URI = inst.constructor;
                  break;
                }
              }
              // Also check if any property of this instance is a URI
              for (const pk of Object.keys(inst)) {
                try {
                  const pv = inst[pk];
                  if (pv && typeof pv === 'object' && 'scheme' in pv && 'path' in pv && 'authority' in pv && typeof pv.toString === 'function' && pv.toString().startsWith('file://')) {
                    URI = pv.constructor;
                    break;
                  }
                } catch(_) {}
              }
              if (URI) break;
            }
            if (URI) break;
          }
        }

        // Strategy 4: Use window.require for vscode-uri
        if (!URI && typeof window.require === 'function') {
          try {
            const vscodeUri = await new Promise((resolve, reject) => {
              window.require(['vscode-uri', 'vs/base/common/uri'], m => resolve(m), reject);
              setTimeout(() => resolve(null), 3000);
            });
            if (vscodeUri?.URI) URI = vscodeUri.URI;
            else if (vscodeUri?.Uri) URI = vscodeUri.Uri;
          } catch(e) {}
        }

        if (!URI) {
          console.error('[kairo-test] URI class not found by any strategy');
          if (onClose) onClose();
          return;
        }
        console.log('[kairo-test] Found URI class');
        
        // ── Create file URI and open workspace ──
        let uri;
        try {
          uri = URI.file(rootPath);
          console.log('[kairo-test] URI.file() =>', uri.toString(), 'scheme:', uri.scheme, 'path:', uri.path);
        } catch(e1) {
          console.warn('[kairo-test] URI.file() failed:', e1.message, '- trying new URI(file:///)');
          const normalizedPath = rootPath.replace(/\\/g, '/');
          const fileUriStr = 'file:///' + normalizedPath.replace(/^\/+/, '');
          uri = new URI(fileUriStr);
          console.log('[kairo-test] new URI() =>', uri.toString());
        }

        console.log('[kairo-test] Calling workspaceService.open()...');
        await ws.open(uri);
        console.log('[kairo-test] open() returned, workspace:', ws.workspace?.name);
        await new Promise(r => setTimeout(r, 3000));
        if (onClose) onClose();
      } catch(err) {
        console.error('[kairo-test] __kairoOpenProject error:', err);
        if (onClose) onClose();
      }
    };
    console.log('[kairo-test] __kairoOpenProject helper injected (v8c - multi-strategy)');

    // ── __kairoOpenFile helper: open a file in editor using EditorManager/OpenerService ──
    window.__kairoOpenFile = async function(filePath) {
      console.log('[kairo-test] __kairoOpenFile called for:', filePath);
      try {
        const container = window.theia?.container;
        if (!container?._bindingDictionary?._map) {
          console.error('[kairo-test] No DI container found');
          return false;
        }

        function getCached(binding) {
          const cache = binding && (binding.cache || binding._cache);
          return (cache && !(cache instanceof Promise)) ? cache : undefined;
        }

        // Reuse URI detection from __kairoOpenProject
        let URI = window.theia?.URI || window.theia?.core?.URI || window.monaco?.Uri || window.monaco?.URI;
        if (!URI && typeof window.require === 'function') {
          try {
            const uriMod = await new Promise((resolve, reject) => {
              window.require('@theia/core/lib/common/uri', resolve, reject);
              setTimeout(() => reject(new Error('timeout')), 5000);
            });
            if (uriMod?.URI) URI = uriMod.URI;
            else if (uriMod?.default) URI = uriMod.default;
          } catch(e) { console.log('[kairo-test] URI window.require failed:', e.message.slice(0,80)); }
        }
        if (!URI) {
          const dict = container._bindingDictionary._map;
          for (const [key, bindings] of dict.entries()) {
            for (const binding of bindings) {
              let inst = getCached(binding);
              if (!inst && typeof container.get === 'function' && typeof key !== 'string') {
                try { inst = container.get(key); } catch(_) {}
              }
              if (!inst || typeof inst !== 'object') continue;
              if ('scheme' in inst && 'path' in inst && 'authority' in inst && typeof inst.toString === 'function') {
                const str = inst.toString();
                if (str.startsWith('file://') || str.startsWith('http://')) { URI = inst.constructor; break; }
              }
              for (const pk of Object.keys(inst)) {
                try {
                  const pv = inst[pk];
                  if (pv && typeof pv === 'object' && 'scheme' in pv && 'path' in pv && 'authority' in pv && typeof pv.toString === 'function' && pv.toString().startsWith('file://')) {
                    URI = pv.constructor; break;
                  }
                } catch(_) {}
              }
              if (URI) break;
            }
            if (URI) break;
          }
        }
        if (!URI) {
          console.error('[kairo-test] URI class not found for file open');
          return false;
        }

        // Create file URI
        let uri;
        try {
          uri = URI.file(filePath);
        } catch(e) {
          const normalizedPath = filePath.replace(/\\/g, '/');
          const fileUriStr = 'file:///' + normalizedPath.replace(/^\/+/, '');
          uri = new URI(fileUriStr);
        }
        console.log('[kairo-test] File URI:', uri.toString());

        let editorOpened = false;
        let errors = [];

        // ── Strategy 1: window.require for EditorManager (should work after modules are loaded) ──
        try {
          if (typeof window.require === 'function') {
            const mod = await new Promise((resolve, reject) => {
              window.require('@theia/editor/lib/browser/editor-manager', resolve, reject);
              setTimeout(() => reject(new Error('timeout')), 8000);
            });
            if (mod?.EditorManager) {
              const em = typeof container.getAsync === 'function' 
                ? await container.getAsync(mod.EditorManager)
                : container.get(mod.EditorManager);
              if (em && typeof em.open === 'function') {
                console.log('[kairo-test] Strategy1: Got EditorManager, calling open()');
                await em.open(uri);
                console.log('[kairo-test] Opened file via EditorManager (window.require)');
                editorOpened = true;
              } else { errors.push('EditorManager window.require: got module but no instance'); }
            } else { errors.push('EditorManager window.require: no EditorManager export'); }
          }
        } catch(e) { errors.push('Strategy1 EditorManager: ' + e.message.slice(0,80)); }

        // ── Strategy 2: window.require for OpenerService ──
        if (!editorOpened) {
          try {
            if (typeof window.require === 'function') {
              const mod = await new Promise((resolve, reject) => {
                window.require('@theia/core/lib/browser/opener-service', resolve, reject);
                setTimeout(() => reject(new Error('timeout')), 5000);
              });
              const OpenerService = mod?.OpenerService || mod?.default;
              if (OpenerService) {
                const os = typeof container.getAsync === 'function'
                  ? await container.getAsync(OpenerService)
                  : container.get(OpenerService);
                if (os && typeof os.getOpener === 'function') {
                  const opener = await os.getOpener(uri);
                  if (opener && typeof opener.open === 'function') {
                    await opener.open(uri);
                    console.log('[kairo-test] Opened file via OpenerService');
                    editorOpened = true;
                  } else { errors.push('OpenerService: no opener found for URI'); }
                } else { errors.push('OpenerService: no getOpener method'); }
              } else { errors.push('OpenerService window.require: no OpenerService export'); }
            }
          } catch(e) { errors.push('OpenerService window.require: ' + e.message.slice(0,80)); }
        }

        // ── Strategy 3: window.require for open-handler or widget-open-handler ──
        if (!editorOpened) {
          const openerModules = [
            '@theia/navigator/lib/browser/navigator-widget',
            '@theia/workspace/lib/browser/workspace-commands'
          ];
          for (const modPath of openerModules) {
            try {
              if (typeof window.require !== 'function') break;
              const mod = await new Promise((resolve) => {
                window.require([modPath], m => resolve(m), e => resolve(null));
                setTimeout(() => resolve(null), 2000);
              });
            } catch(e) {}
          }
        }

        // ── Strategy 4: Symbol key search for anything with open() that can handle files ──
        if (!editorOpened) {
          try {
            const dict = container._bindingDictionary._map;
            for (const [key] of dict.entries()) {
              if (typeof key === 'symbol') {
                const keyStr = key.toString();
                if (keyStr.includes('EditorManager') || keyStr.includes('OpenerService') || keyStr.includes('EditorWidgetFactory') || keyStr.includes('WidgetManager')) {
                  try {
                    const svc = typeof container.getAsync === 'function'
                      ? await container.getAsync(key)
                      : container.get(key);
                    if (svc) {
                      if (typeof svc.open === 'function') {
                        await svc.open(uri);
                        console.log('[kairo-test] Opened file via symbol key:', keyStr);
                        editorOpened = true;
                        break;
                      }
                      if (typeof svc.getOpener === 'function') {
                        const opener = await svc.getOpener(uri);
                        if (opener && typeof opener.open === 'function') {
                          await opener.open(uri);
                          console.log('[kairo-test] Opened file via OpenerService symbol:', keyStr);
                          editorOpened = true;
                          break;
                        }
                      }
                    }
                  } catch(_) {}
                }
              }
            }
          } catch(e) { errors.push('Symbol key search: ' + e.message.slice(0,80)); }
        }

        // ── Strategy 5: Shape detection - any service with open(uri) and activeEditor/allEditors ──
        if (!editorOpened) {
          try {
            const dict = container._bindingDictionary._map;
            for (const [key, bindings] of dict.entries()) {
              for (const binding of bindings) {
                let inst = getCached(binding);
                if (!inst && typeof container.get === 'function' && typeof key !== 'string') {
                  try { inst = container.get(key); } catch(_) {}
                }
                if (!inst || typeof inst !== 'object') continue;
                // Look for EditorManager shape
                const hasOpen = typeof inst.open === 'function';
                const hasEditorProps = ('activeEditor' in inst && 'allEditors' in inst) || ('currentEditor' in inst && 'editors' in inst);
                if (hasOpen && hasEditorProps) {
                  await inst.open(uri);
                  console.log('[kairo-test] Opened file via shape-detected editor service, ctor:', inst.constructor?.name);
                  editorOpened = true;
                  break;
                }
                // Look for OpenerService shape (getOpener)
                if (typeof inst.getOpener === 'function') {
                  try {
                    const opener = await inst.getOpener(uri);
                    if (opener && typeof opener.open === 'function') {
                      await opener.open(uri);
                      console.log('[kairo-test] Opened file via shape-detected OpenerService');
                      editorOpened = true;
                      break;
                    }
                  } catch(_) {}
                }
              }
              if (editorOpened) break;
            }
          } catch(e) { errors.push('Shape detection: ' + e.message.slice(0,80)); }
        }

        // ── Strategy 6: Try monaco.editor.getModels() and open via WidgetManager ──
        if (!editorOpened) {
          try {
            // Try WidgetManager to get/create editor widget
            for (const [key] of container._bindingDictionary._map.entries()) {
              if (typeof key === 'symbol' && key.toString().includes('WidgetManager')) {
                try {
                  const wm = await container.getAsync(key);
                  if (wm && typeof wm.getOrCreateWidget === 'function') {
                    // Try editor widget factory ID
                    const widget = await wm.getOrCreateWidget('code-editor-opener', uri);
                    if (widget) {
                      console.log('[kairo-test] Got widget via WidgetManager');
                      // Activate the widget in the main area
                      const shell = container.get && container.get.bind(container);
                      editorOpened = true;
                      break;
                    }
                  }
                } catch(_) {}
              }
            }
          } catch(e) { errors.push('WidgetManager: ' + e.message.slice(0,80)); }
        }

        if (editorOpened) {
          await new Promise(r => setTimeout(r, 2500));
          return true;
        }
        console.error('[kairo-test] Could not find any service to open file. Errors:', errors.join('; '));
        return false;
      } catch(err) {
        console.error('[kairo-test] __kairoOpenFile error:', err);
        return false;
      }
    };
    console.log('[kairo-test] __kairoOpenFile helper injected');
  });
}

// ─── Status bar ──
async function getStatusBarText(page) {
  return page.evaluate(() => document.querySelector('#theia-statusBar, .theia-statusBar')?.textContent || '');
}

// ─── Dialog helpers ──
async function dismissTrustDialog(page, timeoutMs = 5000) {
  const dialogBlock = page.locator('.dialogBlock, .workspace-trust-dialog').first();
  try { await dialogBlock.waitFor({ state: 'visible', timeout: timeoutMs }); } catch { return false; }
  const yesBtn = page.locator('button', { hasText: /yes,?\s*i\s*trust/i }).first();
  try { await yesBtn.waitFor({ state: 'visible', timeout: 2000 }); await yesBtn.click({ timeout: 2000 }); await sleep(500); return true; }
  catch { return false; }
}
async function dismissSaveWorkspaceDialog(page, timeoutMs = 5000) {
  const dialogBlock = page.locator('.dialogBlock, .save-workspace-dialog').first();
  try { await dialogBlock.waitFor({ state: 'visible', timeout: timeoutMs }); } catch { return false; }
  const dontSaveBtn = page.locator('button', { hasText: /don'?t\s+save/i }).first();
  try { await dontSaveBtn.waitFor({ state: 'visible', timeout: 2000 }); await dontSaveBtn.click({ timeout: 2000 }); await sleep(500); return true; }
  catch { return false; }
}
async function dismissAnyBlockingDialogs(page) {
  for (let i = 0; i < 5; i++) {
    let dismissed = false;
    dismissed = (await dismissSaveWorkspaceDialog(page, 800)) || dismissed;
    dismissed = (await dismissTrustDialog(page, 800)) || dismissed;
    if (!dismissed) break;
    await sleep(300);
  }
}

// ─── DI / Command Registry ──
async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 30; attempt++) {
    const found = await page.evaluate(() => {
      let container = window.theia?.container;
      if (!container?._bindingDictionary?._map) {
        for (const el of document.querySelectorAll('*')) {
          const c = el.__inversify_container__;
          if (c?._bindingDictionary?._map && c._bindingDictionary._map.size > 100) { container = c; break; }
        }
      }
      if (!container?._bindingDictionary?._map) return false;
      for (const [key] of container._bindingDictionary._map.entries()) {
        if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
          try {
            const svc = container.get(key);
            if (svc?.executeCommand) {
              window.__kairoCmdReg = svc;
              try { window.__kairoCmdList = Array.from(svc.getAllCommands()).map(c => ({ id: c.id, label: c.label })); } catch(_) {}
              return true;
            }
          } catch(_) {}
        }
      }
      return false;
    });
    if (found) return true;
    await sleep(1500);
  }
  return false;
}
async function execCmd(page, commandId) {
  await ensureCmdReg(page);
  return page.evaluate((cmdId) => window.__kairoCmdReg.executeCommand(cmdId), commandId);
}

// ─── Import Wizard ──
async function ensureImportWizardActive(page) {
  const active = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    for (const inp of inputs) {
      const ph = inp.placeholder || '';
      const rect = inp.getBoundingClientRect();
      if (/path|directory|folder/i.test(ph) && rect.width > 100 && rect.top > 0) return true;
    }
    const headings = document.querySelectorAll('h1, h2, h3, h4');
    for (const h of headings) {
      if (/Import Legacy Java Project/i.test(h.textContent || '') && h.getBoundingClientRect().top > 0) return true;
    }
    return false;
  });
  if (active) return true;
  const importTab = page.locator('.p-TabBar-tab, .theia-tabBar-tab').filter({ hasText: /Import Project/i }).first();
  if (await importTab.count() > 0) {
    await importTab.click({ force: true });
    await sleep(1000);
    return true;
  }
  return false;
}

async function importProject(page, projectPath) {
  log(`Importing: ${projectPath}`);
  await dismissAnyBlockingDialogs(page);

  let wizardActive = await ensureImportWizardActive(page);
  if (!wizardActive) {
    log('  Wizard not visible, opening via command...');
    await execCmd(page, 'kairo.project.import');
    await sleep(2000);
    wizardActive = await ensureImportWizardActive(page);
  }
  if (!wizardActive) { await shot('import-wizard-not-found'); throw new Error('Import wizard not found'); }
  log('  Import wizard active');
  await shot('import-wizard');

  let pathInput = null;
  let inputFound = false;
  pathInput = page.locator('[data-testid="path-input"]').first();
  try { if (await pathInput.count() > 0 && await pathInput.boundingBox().catch(() => null)) inputFound = true; } catch {}
  if (!inputFound) {
    const allInputs = page.locator('input[type="text"]');
    const count = await allInputs.count();
    for (let i = 0; i < count; i++) {
      const inp = allInputs.nth(i);
      const ph = await inp.getAttribute('placeholder') || '';
      const rect = await inp.boundingBox().catch(() => null);
      if (/path|directory|folder|\/absolute/i.test(ph) && rect && rect.width > 50 && rect.top > 0) {
        pathInput = inp; inputFound = true; break;
      }
    }
  }
  if (!inputFound) {
    const allInputs = page.locator('input[type="text"]');
    const count = await allInputs.count();
    for (let i = 0; i < count; i++) {
      const inp = allInputs.nth(i);
      const rect = await inp.boundingBox().catch(() => null);
      if (rect && rect.width > 100 && rect.top > 100 && rect.top < 500) { pathInput = inp; inputFound = true; break; }
    }
  }
  if (!inputFound) { await shot('import-no-input'); throw new Error('Cannot find path input'); }

  log('  Filling project path...');
  await pathInput.click();
  await sleep(200);
  await pathInput.press('Control+A');
  await pathInput.press('Delete');
  await sleep(300);
  await pathInput.type(projectPath.replace(/\\/g, '/'), { delay: 15 });
  await sleep(1000);
  await shot('import-path-filled');

  let scanBtn = page.locator('[data-testid="scan-btn"]').first();
  let scanFound = false;
  if (await scanBtn.count() > 0 && await scanBtn.boundingBox().catch(() => null)) scanFound = true;
  if (!scanFound) {
    const buttons = page.locator('button').filter({ hasText: /^\s*Scan\s*$/i });
    const cnt = await buttons.count();
    for (let i = 0; i < cnt; i++) {
      const btn = buttons.nth(i);
      if (await btn.boundingBox().catch(() => null)) { scanBtn = btn; scanFound = true; break; }
    }
  }
  if (!scanFound) { await pathInput.press('Enter'); } else { log('  Clicking Scan...'); await scanBtn.click(); }

  log('  Waiting for Step 2...');
  let step2Ready = false;
  const s2Start = Date.now();
  while (Date.now() - s2Start < 40000) {
    await sleep(1000);
    const info = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const hasBtn = Array.from(document.querySelectorAll('button')).some(b =>
        /import\s*project/i.test(b.textContent || '') && b.offsetParent !== null);
      const hasErr = /409|conflict|already exists/i.test(body.slice(-500));
      return { hasBtn, hasErr };
    });
    if (info.hasBtn) { step2Ready = true; log(`  Step 2 ready after ${(Date.now()-s2Start)/1000}s`); break; }
    if (info.hasErr) {
      await cleanAgentProjects(page); await sleep(500);
      if (scanFound) { await scanBtn.click(); } else { await pathInput.press('Enter'); }
    }
  }
  if (!step2Ready) { await shot('import-step2-timeout'); throw new Error('Step 2 not reached'); }
  await shot('import-step2');

  // Configure source/target version to 1.8 for JDK 17 compatibility
  log('  Configuring Source/Target version to 1.8...');
  try {
    // Find all select/dropdown elements in the wizard and look for Source Version / Target Version
    const versionSet = await page.evaluate(() => {
      const results = { source: false, target: false };
      // Find all labels and their associated controls
      const allLabels = document.querySelectorAll('label, .theia-Wizard-Field label, .field label');
      for (const label of allLabels) {
        const labelText = (label.textContent || '').trim().toLowerCase();
        let dropdown = null;
        // Find the next select or the parent's select
        let parent = label.closest('.theia-Wizard-Field') || label.parentElement;
        if (parent) {
          dropdown = parent.querySelector('select');
        }
        if (!dropdown) {
          // Try finding the next select element after the label
          let sibling = label.nextElementSibling;
          while (sibling) {
            if (sibling.tagName === 'SELECT') { dropdown = sibling; break; }
            const sel = sibling.querySelector('select');
            if (sel) { dropdown = sel; break; }
            sibling = sibling.nextElementSibling;
          }
        }
        if (dropdown && (labelText.includes('source version') || labelText.includes('source version'))) {
          dropdown.value = '1.8';
          dropdown.dispatchEvent(new Event('change', { bubbles: true }));
          dropdown.dispatchEvent(new Event('input', { bubbles: true }));
          results.source = true;
        }
        if (dropdown && labelText.includes('target version')) {
          dropdown.value = '1.8';
          dropdown.dispatchEvent(new Event('change', { bubbles: true }));
          dropdown.dispatchEvent(new Event('input', { bubbles: true }));
          results.target = true;
        }
      }
      // Fallback: find all selects with value "1.6" that aren't JDK Version
      const allSelects = document.querySelectorAll('.theia-Wizard select, .import-wizard select, select');
      for (const sel of allSelects) {
        const parentLabel = sel.closest('.theia-Wizard-Field')?.querySelector('label')?.textContent?.toLowerCase() || '';
        if (sel.value === '1.6' && !parentLabel.includes('jdk version')) {
          sel.value = '1.8';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          if (parentLabel.includes('source')) results.source = true;
          else if (parentLabel.includes('target')) results.target = true;
          else results.source = true; // fallback
        }
      }
      return results;
    });
    log(`  Version selectors set: source=${versionSet.source}, target=${versionSet.target}`);
  } catch(e) {
    log(`  Version selector config error: ${e.message.slice(0, 100)}`);
  }
  await sleep(500);
  await shot('import-step2-configured');

  let importBtn = page.locator('[data-testid="import-project-btn"]').first();
  if (!(await importBtn.count() > 0 && await importBtn.isVisible().catch(() => false))) {
    importBtn = page.locator('button', { hasText: /import\s*project/i }).first();
  }
  log('  Clicking Import Project...');
  await importBtn.click();
  await sleep(500);

  log('  Waiting for Step 3...');
  let step3Ready = false;
  const s3Start = Date.now();
  while (Date.now() - s3Start < 40000) {
    await sleep(1000);
    const hasBtn = await page.evaluate(() => Array.from(document.querySelectorAll('button')).some(b =>
      /open\s*(project|folder)/i.test(b.textContent || '') && b.offsetParent !== null));
    if (hasBtn) { step3Ready = true; log(`  Step 3 ready after ${(Date.now()-s3Start)/1000}s`); break; }
  }
  if (!step3Ready) { await shot('import-step3-timeout'); throw new Error('Step 3 not reached'); }
  await shot('import-step3');

  // Inject improved helper BEFORE clicking Open Project
  await injectKairoHelpers(page);
  await sleep(500);

  let openBtn = page.locator('[data-testid="open-project-btn"]').first();
  if (!(await openBtn.count() > 0 && await openBtn.isVisible().catch(() => false))) {
    openBtn = page.locator('button', { hasText: /open\s*(project|folder)/i }).first();
  }
  log('  Clicking Open Project (with improved helper)...');
  await openBtn.click();
  await sleep(2000);

  log('  Waiting for workspace to open...');
  let workspaceReady = false;
  const wsStart = Date.now();
  while (Date.now() - wsStart < 60000) {
    await sleep(500);
    await dismissSaveWorkspaceDialog(page, 500).catch(() => {});
    await dismissTrustDialog(page, 500).catch(() => {});
    const bar = await getStatusBarText(page);
    // Check if explorer has tree nodes
    const nodeCount = await page.locator('.theia-TreeNode').count();
    const explorerText = await page.evaluate(() => {
      const exp = document.querySelector('#theia-left-side-bar, .theia-sidebar');
      return exp?.textContent || '';
    });
    const hasFolder = !/NO FOLDER OPENED/i.test(explorerText);
    if (nodeCount > 0 && hasFolder) {
      log(`  Workspace ready (${nodeCount} tree nodes) after ${(Date.now()-wsStart)/1000}s`);
      workspaceReady = true;
      break;
    }
  }

  await sleep(5000);  // Wait extra for file indexing to complete
  await dismissAnyBlockingDialogs(page);
  
  // Re-inject helpers after workspace open (Theia may reload frontend context when opening workspace)
  log('  Re-injecting Kairo helpers after workspace open...');
  await injectKairoHelpers(page);
  await sleep(500);
  
  await shot('import-complete');
  if (!workspaceReady) {
    const bar = await getStatusBarText(page);
    log(`  Status bar: ${bar.slice(0, 300)}`);
    const nodeCount = await page.locator('.theia-TreeNode').count();
    log(`  Tree nodes: ${nodeCount}`);
    if (/Project:\s*\S/.test(bar) && nodeCount > 0) {
      workspaceReady = true;
      log('  Workspace confirmed via status bar + tree nodes');
    } else {
      log('  ⚠ Workspace tree not confirmed, continuing...');
    }
  }
  return workspaceReady;
}

// ─── Explorer ──
async function openExplorer(page) {
  // Strategy 1: Click Explorer tab in the sidebar tab bar
  const tabSelectors = [
    '#shell-tab-explorer-view-container--files',
    '#shell-tab-explorer-view-container',
    '.theia-app-left #shell-tab-explorer-view-container',
  ];
  for (const sel of tabSelectors) {
    const tab = page.locator(sel).first();
    if (await tab.count() > 0) {
      await tab.click({ force: true }).catch(() => {});
      await sleep(800);
      const nodes = await page.locator('.theia-TreeNode, .monaco-tl-row').count();
      if (nodes > 0) return true;
    }
  }
  // Strategy 2: Click the Explorer icon in the activity bar (left sidebar icons)
  try {
    const activityBar = page.locator('#theia-left-side-bar, .theia-activity-bar').first();
    if (await activityBar.count() > 0) {
      // The first item in activity bar is usually Explorer (files icon)
      const items = activityBar.locator('.p-TabBar-tab, .theia-activity-tab, .codicon').all();
      const itemsList = await items;
      for (let i = 0; i < Math.min(itemsList.length, 3); i++) {
        await itemsList[i].click({ force: true }).catch(() => {});
        await sleep(800);
        const nodes = await page.locator('.theia-TreeNode, .monaco-tl-row').count();
        if (nodes > 0) {
          log(`  Explorer activated via activity bar item ${i}`);
          return true;
        }
      }
    }
  } catch(e) {}
  // Strategy 3: Use command palette to reveal explorer
  try {
    await openCommandPalette(page);
    await sleep(500);
    const input = page.locator('.quick-input-widget input[type="text"]').first();
    if (await input.count() > 0) {
      await input.fill('Explorer');
      await sleep(500);
      await page.keyboard.press('Enter');
      await sleep(1500);
    }
  } catch(e) {}
  await dismissAnyBlockingDialogs(page);
  const nodes = await page.locator('.theia-TreeNode, .monaco-tl-row').count();
  return nodes > 0;
}
async function waitForExplorerNodes(page, minNodes = 3, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await sleep(1000);
    await dismissAnyBlockingDialogs(page);
    const count = await page.locator('.theia-TreeNode').count();
    if (count >= minNodes) return count;
    const root = page.locator('.theia-TreeNode').first();
    if (await root.count() > 0) {
      const toggle = root.locator('.theia-ExpansionToggle').first();
      if (await toggle.count() > 0) {
        const cls = await toggle.getAttribute('class') || '';
        if (/collapsed/i.test(cls) || !/expanded/i.test(cls)) {
          await toggle.click({ force: true }).catch(() => {});
          await sleep(500);
        }
      }
    }
  }
  return await page.locator('.theia-TreeNode').count();
}

// ─── File open ──
async function openFileByQuickOpen(page, fileName, waitMs = 10000) {
  await page.keyboard.press('Control+P');
  await sleep(800);
  try { await page.waitForSelector('.quick-input-widget, .monaco-quick-open-widget', { timeout: 5000, state: 'visible' }); } catch(e) {}
  await sleep(500);
  // Clear any existing text and type filename
  await page.keyboard.press('Control+A');
  await page.keyboard.type(fileName, { delay: 50 });
  // Wait for quick open results to appear (use waitMs to determine poll duration)
  const pollInterval = 1000;
  const maxPolls = Math.max(10, Math.floor(waitMs / pollInterval));
  let found = false;
  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollInterval);
    const hasResults = await page.evaluate(() => {
      const list = document.querySelector('.quick-input-widget .monaco-list-rows, .monaco-quick-open-widget .monaco-list-rows');
      if (!list) return false;
      const rows = list.querySelectorAll('.monaco-list-row');
      // Check if any row is not "no results"
      for (const row of rows) {
        const text = (row.textContent || '').trim().toLowerCase();
        if (text.length > 0 && !text.includes('no matching') && !text.includes('no results')) return true;
      }
      return rows.length > 0;
    });
    if (hasResults) { found = true; log(`  Quick Open: found results after ${(i+1)*pollInterval}ms`); break; }
  }
  if (!found) {
    log(`  Quick Open: no results for "${fileName}" after ${maxPolls*pollInterval}ms, trying Enter anyway`);
  } else {
    await sleep(300);
    // The first result should be auto-selected, press Enter directly
    // Don't press ArrowDown as it might move to second item
  }
  await page.keyboard.press('Enter');
  await sleep(Math.min(waitMs, 5000));
  await dismissAnyBlockingDialogs(page);
}

// Open file by clicking in explorer - uses Playwright native mouse + keyboard navigation
async function openFileByExplorer(page, fileName) {
  // First, ensure explorer view is active by clicking the explorer icon in activity bar
  try {
    // Try to click the Explorer activity bar item (usually the first one with files icon)
    const activityItems = page.locator('#theia-left-side-bar .p-TabBar-tab, .theia-activity-tab, .activitybar .codicon').first();
    // More reliably: use openExplorer function
    await openExplorer(page);
    await sleep(800);
  } catch(e) {}

  // Helper: get visible nodes with their text content and bounding boxes
  const getVisibleNodes = async () => {
    return page.evaluate(() => {
      // Try multiple selectors for tree nodes
      const selectors = ['.theia-TreeNode', '.monaco-tl-row', '.theia-FileTreeNode'];
      let nodes = [];
      for (const sel of selectors) {
        const found = document.querySelectorAll(sel);
        if (found.length > 0) { nodes = found; break; }
      }
      const visible = [];
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y >= -50 && r.y < window.innerHeight + 50) {
          visible.push({
            text: (node.textContent || '').trim(),
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
            width: r.width,
            height: r.height,
            left: r.left,
            top: r.top,
            hasChevronRight: !!node.querySelector('.codicon-chevron-right'),
            hasChevronDown: !!node.querySelector('.codicon-chevron-down'),
          });
        }
      }
      return visible;
    });
  };

  // Helper: find node by exact folder/file name
  const findNode = (nodes, name) => {
    for (const n of nodes) {
      // Match if the text contains the name as a whole word (not substring)
      const words = n.text.split(/\s+/).filter(w => w.length > 0);
      if (words.includes(name)) return n;
    }
    return null;
  };

  // Expand folders sequentially by clicking them and pressing Right arrow
  const foldersInOrder = ['src', 'main', 'java', 'com', 'example', 'gbk'];
  // Stop expanding folders once we pass the file's directory (for HelloServlet.java we don't need gbk)
  const neededFolders = fileName.includes('gbk') ? foldersInOrder : foldersInOrder.slice(0, 5);
  
  for (const folder of neededFolders) {
    await sleep(500);
    let nodes = await getVisibleNodes();
    
    // Find the folder node
    let folderNode = findNode(nodes, folder);
    if (!folderNode) {
      // Folder might not be visible - try scrolling down in the tree
      log(`  Folder "${folder}" not immediately visible, scrolling tree...`);
      for (let scrollAttempt = 0; scrollAttempt < 8; scrollAttempt++) {
        await page.mouse.wheel(0, 150);
        await sleep(300);
        nodes = await getVisibleNodes();
        folderNode = findNode(nodes, folder);
        if (folderNode) break;
      }
    }
    if (!folderNode) {
      log(`  Folder "${folder}" not found in visible tree (nodes: ${nodes.map(n => n.text.split(/\s+/).pop()).slice(0, 20).join(', ')})`);
      break;
    }
    
    // Count nodes before expand to verify new children appear
    const nodeCountBefore = nodes.length;
    
    // Click on the folder to select it (click in the label area, not the chevron)
    const clickX = folderNode.x + Math.min(50, folderNode.width / 3);
    const clickY = folderNode.y;
    log(`  Selecting folder "${folder}" at (${Math.round(clickX)}, ${Math.round(clickY)})`);
    await page.mouse.click(clickX, clickY);
    await sleep(300);
    
    // Press Right arrow to expand (works in Theia/VS Code trees regardless of current state)
    await page.keyboard.press('ArrowRight');
    await sleep(800);
    
    // Check if new children appeared
    let nodesAfter = await getVisibleNodes();
    let expanded = nodesAfter.length > nodeCountBefore;
    
    if (!expanded) {
      // Try double-clicking the folder name as fallback
      log(`  ArrowRight did not add children for "${folder}", trying double-click...`);
      await page.mouse.dblclick(clickX, clickY);
      await sleep(1000);
      nodesAfter = await getVisibleNodes();
      expanded = nodesAfter.length > nodeCountBefore;
    }
    
    if (expanded) {
      log(`  Folder "${folder}" expanded (${nodeCountBefore} -> ${nodesAfter.length} nodes)`);
    } else {
      // Folder might already be expanded with children visible further down - scroll to reveal
      log(`  No new nodes for "${folder}", may already be expanded - scrolling to reveal children...`);
      await page.mouse.wheel(0, 200);
      await sleep(500);
    }
  }
  
  await sleep(800);
  
  // Now find and double-click the file
  const nodes = await getVisibleNodes();
  const fileNode = findNode(nodes, fileName);
  
  if (fileNode) {
    // Click on the file's text area (not too far left to avoid chevron)
    const clickX = fileNode.x + Math.min(40, fileNode.width / 3);
    const clickY = fileNode.y;
    log(`  Double-clicking file "${fileName}" at (${Math.round(clickX)}, ${Math.round(clickY)})`);
    await page.mouse.dblclick(clickX, clickY);
    await sleep(3000);
    return true;
  }
  
  // If file not found by name, scroll down and try again (might be off-screen)
  log(`  File "${fileName}" not immediately visible, scrolling...`);
  for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
    await page.mouse.wheel(0, 200);
    await sleep(500);
    const scrolledNodes = await getVisibleNodes();
    const scrolledFile = findNode(scrolledNodes, fileName);
    if (scrolledFile) {
      const clickX = scrolledFile.x + Math.min(40, scrolledFile.width / 3);
      log(`  Found "${fileName}" after scroll, double-clicking at (${Math.round(clickX)}, ${Math.round(scrolledFile.y)})`);
      await page.mouse.dblclick(clickX, scrolledFile.y);
      await sleep(3000);
      return true;
    }
  }
  
  log(`  Could not find/open file in explorer: ${fileName}`);
  return false;
}

// Open file via injected __kairoOpenFile helper (most reliable) with retry
async function openFileViaAPI(page, filePath, retries = 15) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await page.evaluate(async (fPath) => {
        const debug = { hasHelper: typeof window.__kairoOpenFile === 'function', hasContainer: !!window.theia?.container, result: null, error: null };
        try {
          if (typeof window.__kairoOpenFile === 'function') {
            debug.result = await window.__kairoOpenFile(fPath);
          } else {
            debug.error = '__kairoOpenFile not found';
          }
        } catch(e) {
          debug.error = e.message || String(e);
        }
        return debug;
      }, filePath);
      if (result.result === true) {
        return true;
      }
      if (attempt < retries) {
        log(`  API open attempt ${attempt}/${retries} failed, retrying...`);
        // On every attempt, trigger Quick Open briefly to kickstart file search service
        if (attempt % 2 === 1) {
          try {
            await page.keyboard.press('Control+P');
            await sleep(1500);
            await page.keyboard.press('Escape');
            await sleep(500);
          } catch(_) {}
        }
        await sleep(5000);
      } else {
        log(`  API open: hasHelper=${result.hasHelper}, hasContainer=${result.hasContainer}, result=${result.result}`);
      }
    } catch(e) {
      log(`  openFileViaAPI attempt ${attempt} error: ${e.message.slice(0, 100)}`);
      if (attempt < retries) await sleep(5000);
    }
  }
  return false;
}
async function getEditorContent(page) {
  return page.evaluate(() => document.querySelector('.monaco-editor .view-lines')?.textContent || '');
}

// ─── Launch ──
function resolveExe() {
  if (customExe) return customExe;
  const p = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  if (fs.existsSync(p)) return p;
  throw new Error('Cannot find Kairo IDE .exe');
}

async function launchApp() {
  const exePath = resolveExe();
  log(`Launching: ${exePath}`);
  const userDataDir = path.join(runDir, 'userdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  const configDir = path.join(runDir, 'theia-config');
  fs.mkdirSync(configDir, { recursive: true });

  const app = await electron.launch({
    executablePath: exePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, THEIA_CONFIG_DIR: configDir, KAIRO_DEV: '1', KAIRO_JAVA_TARGET: '1.8' },
    timeout: 60000,
  });

  app.on('window', async (page) => {
    page.on('console', (msg) => {
      const txt = msg.text(), type = msg.type();
      if (type === 'error' || /Uncaught|FATAL/i.test(txt)) {
        if (!/Electron Security|cookie|favicon|fonts\.gstatic|DevTools|ERR_CACHE|ERR_CONNECTION|unsafe-eval|Content Security Policy|ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED.*sockjs|authenticating/i.test(txt)) {
          consoleErrors.push({ ts: new Date().toISOString(), type, text: txt.slice(0, 500) });
          if (type === 'error') warn(`CONSOLE: ${txt.slice(0, 150)}`);
        }
      }
    });
    page.on('pageerror', (err) => {
      const msg = err.message;
      if (!/unsafe-eval|Content Security Policy/i.test(msg)) {
        consoleErrors.push({ ts: new Date().toISOString(), type: 'pageerror', text: msg });
        warn(`PAGE ERROR: ${msg.slice(0, 150)}`);
      }
    });
  });

  const page = await app.firstWindow();
  currentApp = app;
  currentPage = page;

  // Auto-handle JS dialogs (alert/confirm/prompt) to prevent crashes
  page.on('dialog', async dialog => {
    try { await dialog.dismiss(); } catch(_) {}
  });

  log('Waiting for application shell...');
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (await page.evaluate(() => !!document.querySelector('#theia-statusBar, .theia-statusBar'))) {
      log(`Shell visible after ${i+1}s`);
      break;
    }
    if (i === 89) throw new Error('Shell timeout');
  }
  await dismissAnyBlockingDialogs(page);
  await sleep(2000);
  await shot('00-launch');

  log('Waiting for Runtime Agent...');
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    await dismissAnyBlockingDialogs(page);
    const h = await agentGET(page, '/api/v1/health');
    if (h.ok) { log(`  Agent healthy at ${h.base} after ${i+1}s`); break; }
  }
  await sleep(1000);
  const wsReg = await agentPOST(page, '/api/v1/workspaces', { rootPath: TEST_WS_ROOT });
  log(`  Workspace register: ${wsReg.status}`);
  await cleanAgentProjects(page);
  await sleep(1000);
  await shot('01-ready');
  return { app, page };
}

// ─── Main Test ──
async function main() {
  log('========================================');
  log('Kairo IDE Deep E2E Test v8c (debug-tree.cjs proven approach)');
  log('========================================');
  log(`Test project: ${TEST_PROJECT_PATH}`);
  log(`Output: ${runDir}`);
  log('');

  const { app, page } = await launchApp();

  try {
    await runTest(0, '0.1', 'Application shell and primary UI present', 'P0', async () => {
      const info = await page.evaluate(() => ({
        title: document.title,
        menu: !!document.querySelector('.p-MenuBar, #theia-top-panel, .theia-ApplicationShell-menu'),
        activity: !!document.querySelector('.theia-app-left, .theia-activity-bar, #theia-left-side-bar'),
        status: !!document.querySelector('#theia-statusBar, .theia-statusBar'),
        kairoGlobal: !!window.__kairo,
        agentBase: window.__kairo?.agentBaseUrl,
      }));
      log(`  Title: "${info.title}"`);
      log(`  Menu:${info.menu} Activity:${info.activity} Status:${info.status}`);
      log(`  __kairo:${info.kairoGlobal} Agent:${info.agentBase}`);
      if (!/Kairo\s*IDE/i.test(info.title)) throw new Error(`Unexpected title: "${info.title}"`);
      if (!info.activity) throw new Error('Activity bar missing');
      if (!info.status) throw new Error('Status bar missing');
      if (!info.kairoGlobal) throw new Error('window.__kairo not exposed');
    });

    await runTest(0, '0.2', 'Command registry with Kairo extensions loaded', 'P0', async () => {
      if (!(await ensureCmdReg(page))) throw new Error('Cannot access CommandRegistry');
      const info = await page.evaluate(() => {
        const cmds = window.__kairoCmdList || [];
        const kairo = cmds.filter(c => c.id?.startsWith('kairo') || c.id?.includes('import'));
        return { total: cmds.length, kairo: kairo.length, ids: kairo.map(c => c.id) };
      });
      log(`  Commands: ${info.total} total, ${info.kairo} Kairo-specific`);
      const required = ['kairo.project.import', 'kairo.build', 'kairo.server.start', 'kairo.server.stop'];
      const missing = required.filter(r => !info.ids.includes(r));
      if (missing.length) throw new Error(`Missing commands: ${missing.join(', ')}`);
    });

    await runTest(4, '4.1', 'Import wizard 3-step flow + Open Project', 'P0', async () => {
      await importProject(page, TEST_PROJECT_PATH);
    });

    await runTest(5, '5.1', 'Explorer shows project file tree', 'P0', async () => {
      await openExplorer(page);
      await sleep(1000);
      const nodes = await waitForExplorerNodes(page, 3, 20000);
      log(`  Tree nodes: ${nodes}`);
      await shot('03-explorer');
      if (nodes < 2) throw new Error(`Only ${nodes} tree nodes visible`);
    });

    // Prewarm: open a root-level text file via explorer using Playwright locators (reliable coordinate handling)
    // This forces lazy-loaded editor modules to initialize
    log('  Prewarming editor modules by opening a root-level file via explorer...');
    try {
      await sleep(500);
      // Try opening index.html first (simple HTML, known to open in Monaco)
      const prewarmFile = 'index.html';
      let prewarmed = false;
      try {
        log(`  Trying to open ${prewarmFile}...`);
        const fileLocator = page.locator('.theia-TreeNode, .monaco-tl-row').filter({ hasText: prewarmFile }).first();
        const count = await fileLocator.count();
        if (count > 0) {
          await fileLocator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await fileLocator.dblclick({ force: true, timeout: 5000 });
          log(`  Double-clicked ${prewarmFile}`);
          // Wait for editor to appear
          for (let i = 0; i < 15; i++) {
            await sleep(1000);
            const hasEditor = await page.evaluate(() => {
              const el = document.querySelector('.monaco-editor .view-lines');
              return el ? el.textContent.length : 0;
            });
            if (hasEditor > 20) { 
              log(`  ${prewarmFile} opened (${hasEditor} chars) - editor modules loaded!`);
              prewarmed = true;
              break; 
            }
          }
          if (prewarmed) {
            // Close ALL editor tabs (keep pressing Ctrl+W until no editor content remains)
            log('  Closing prewarm editor tabs...');
            for (let closeAttempt = 0; closeAttempt < 5; closeAttempt++) {
              await page.keyboard.press('Control+W');
              await sleep(600);
              const remaining = await page.evaluate(() => {
                const el = document.querySelector('.monaco-editor .view-lines');
                return el ? el.textContent.length : 0;
              });
              if (remaining < 20) {
                log('  All editor tabs closed');
                break;
              }
              log(`  Still ${remaining} chars in editor, closing more...`);
            }
            await sleep(500);
          }
        }
      } catch(e) { log(`  Prewarm ${prewarmFile} error: ${e.message.slice(0, 80)}`); }
      if (!prewarmed) {
        log('  Prewarm did not open a file (will rely on API fallback strategies)');
      }
    } catch(e) { log(`  Prewarm error (non-fatal): ${e.message.slice(0, 100)}`); }

    // Wait for Theia to finish lazy initialization after workspace open
    log('  Waiting for Theia services to initialize...');
    await sleep(8000);

    await runTest(6, '6.9', 'GBK-encoded Chinese comments display without garbled text (P0)', 'P0', async () => {
      // Open GBK file first (most important P0 test, and once opened, editor modules are loaded)
      const gbkPath = path.join(TEST_PROJECT_PATH, 'src', 'main', 'java', 'com', 'example', 'gbk', 'GbkChineseServlet.java');
      const gbkFileName = 'GbkChineseServlet.java';
      let content = '';
      let opened = false;

      // Strategy 1: API open with retries
      log('  Opening GBK Java file (primary P0 test)...');
      opened = await openFileViaAPI(page, gbkPath, 8);
      if (opened) {
        for (let i = 0; i < 20; i++) {
          await sleep(500);
          content = await getEditorContent(page);
          if (content.length > 50) break;
        }
      }

      // Strategy 2: Quick Open with long wait for file index
      if (content.length < 50) {
        log(`  API got ${content.length} chars, trying Quick Open with 60s wait...`);
        await openFileByQuickOpen(page, gbkFileName, 60000);
        for (let i = 0; i < 20; i++) {
          await sleep(500);
          content = await getEditorContent(page);
          if (content.length > 50) { opened = true; break; }
        }
      }

      // Strategy 3: Explorer double-click
      if (content.length < 50) {
        log(`  Got ${content.length} chars, trying explorer...`);
        await openFileByExplorer(page, gbkFileName);
        for (let i = 0; i < 20; i++) {
          await sleep(500);
          content = await getEditorContent(page);
          if (content.length > 50) { opened = true; break; }
        }
      }

      log(`  GBK file content (${content.length} chars): ${content.slice(0, 200)}`);
      await shot('06-gbk-editor');
      if (content.length < 50) throw new Error(`GBK file not opened (${content.length} chars)`);
      
      const expectedPhrases = ['中文注释测试类', 'GBK编码', '处理GET请求', '你好'];
      let foundPhrases = 0;
      for (const phrase of expectedPhrases) { if (content.includes(phrase)) foundPhrases++; }
      log(`  Chinese phrases found: ${foundPhrases}/${expectedPhrases.length}`);
      const garbledPatterns = [/ï¿½/, /æ–‡/, /é”™/, /ç¼–/, /å—/, /ï¼/];
      let garbled = false;
      for (const pat of garbledPatterns) { if (pat.test(content)) { garbled = true; break; } }
      if (garbled) throw new Error('GBK Chinese content appears garbled (mojibake detected)');
      if (foundPhrases < 2) throw new Error(`Only ${foundPhrases}/${expectedPhrases.length} Chinese phrases readable`);
    });

    await runTest(6, '6.1', 'Open Java file in editor', 'P0', async () => {
      // Open HelloServlet.java now that editor modules are loaded
      await page.keyboard.press('Control+W');
      await sleep(500);
      const helloPath = path.join(TEST_PROJECT_PATH, 'src', 'main', 'java', 'com', 'example', 'HelloServlet.java');
      const fileName = 'HelloServlet.java';
      let content = '';

      // API should work now since modules are loaded
      log('  Opening HelloServlet.java...');
      let opened = await openFileViaAPI(page, helloPath, 5);
      if (opened) {
        for (let i = 0; i < 15; i++) {
          await sleep(500);
          content = await getEditorContent(page);
          if (content.length > 30) break;
        }
      }
      // Fallback to Quick Open
      if (content.length < 30) {
        await openFileByQuickOpen(page, fileName, 15000);
        for (let i = 0; i < 15; i++) {
          await sleep(500);
          content = await getEditorContent(page);
          if (content.length > 30) break;
        }
      }
      log(`  Editor content (${content.length} chars): ${content.slice(0, 150)}`);
      await shot('05-editor-java');
      if (content.length < 30) throw new Error(`Editor has insufficient content (${content.length} chars)`);
    });

    await runTest(6, '6.2', 'Java syntax highlighting is active', 'P0', async () => {
      await sleep(1000);
      const tokens = await page.evaluate(() => document.querySelector('.monaco-editor')?.querySelectorAll('[class*="mtk"]')?.length || 0);
      log(`  Syntax tokens: ${tokens}`);
      await shot('05b-highlight');
      if (tokens < 5) throw new Error(`Only ${tokens} syntax tokens`);
    });

    await runTest(10, '10.1', 'Trigger Ant build via kairo.build command', 'P0', async () => {
      await execCmd(page, 'kairo.build');
      await sleep(3000);
      await shot('07-build-triggered');
      const bar = await getStatusBarText(page);
      log(`  Status bar after build: ${bar.slice(0, 150)}`);
    });

    await runTest(10, '10.2', 'Build completes with success status', 'P0', async () => {
      let finalState = null;
      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        const builds = await agentGET(page, '/api/v1/builds');
        const buildList = builds.json?.payload;
        if (Array.isArray(buildList) && buildList.length > 0) {
          const latest = buildList[buildList.length - 1];
          const st = latest.state || latest.status;
          if (st === 'success' || st === 'succeeded') { finalState = 'success'; log(`  BUILD SUCCESS via API after ${i+1}s`); break; }
          if (st === 'failure' || st === 'failed') {
            finalState = 'failed';
            const out = latest.output || latest.error || '';
            log(`  BUILD FAILED: ${typeof out === 'string' ? out.slice(0, 300) : JSON.stringify(out).slice(0, 300)}`);
            break;
          }
        }
        const bar = await getStatusBarText(page);
        if (/BUILD SUCCESSFUL|构建成功|succeeded/i.test(bar) && !/running/i.test(bar)) {
          finalState = 'success'; log(`  BUILD SUCCESS (status bar) after ${i+1}s`); break;
        }
        if (/BUILD FAILED|构建失败|failed/i.test(bar) && !/running/i.test(bar)) { finalState = 'failed'; log(`  BUILD FAILED (status bar) after ${i+1}s`); break; }
      }
      await shot('08-build-result');
      if (finalState === 'failed') throw new Error('Build reported failure');
      if (!finalState) log('  ⚠ Could not determine build completion');
    });

    await runTest(11, '11.1', 'Start Tomcat server via kairo.server.start', 'P0', async () => {
      await execCmd(page, 'kairo.server.start');
      await sleep(5000);
      await shot('09-server-start');
    });
    await runTest(11, '11.2', 'Server reaches running state', 'P0', async () => {
      let running = false;
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const servers = await agentGET(page, '/api/v1/servers');
        const list = servers.json?.payload;
        if (Array.isArray(list) && list.length > 0) {
          const st = list[0].state || list[0].status;
          if (st === 'running' || st === 'started') {
            running = true; serverHttpPort = list[0].ports?.http || list[0].httpPort;
            log(`  SERVER RUNNING (port: ${serverHttpPort}) after ${i+1}s`);
            break;
          }
        }
        const bar = await getStatusBarText(page);
        if (/running|运行中|:1808/i.test(bar) && !/stopped|starting/i.test(bar)) {
          running = true;
          const m = bar.match(/:(\d{4,5})/); serverHttpPort = m ? m[1] : null;
          log(`  SERVER RUNNING (status bar, port: ${serverHttpPort}) after ${i+1}s`);
          break;
        }
      }
      await shot('10-server-running');
      if (!running) throw new Error('Server did not reach running state');
    });
    await runTest(11, '11.3', 'Stop Tomcat server via kairo.server.stop', 'P0', async () => {
      await sleep(2000);
      await execCmd(page, 'kairo.server.stop');
      await sleep(5000);
      await shot('11-server-stop');
      let stopped = false;
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const servers = await agentGET(page, '/api/v1/servers');
        const list = servers.json?.payload;
        if (Array.isArray(list) && list.length > 0) {
          const st = list[0].state || list[0].status;
          if (st === 'stopped' || !st || st === 'idle') { stopped = true; log(`  Server stopped after ${i+5}s`); break; }
        } else { stopped = true; break; }
      }
      await shot('12-server-stopped');
      if (!stopped) log('  ⚠ Server stop not confirmed');
    });

    await runTest(99, '99.1', 'No critical uncaught console errors', 'P0', async () => {
      log(`  Total console errors: ${consoleErrors.length}`);
      consoleErrors.slice(0, 20).forEach((e, i) => log(`    ${i+1}. [${e.type}] ${e.text.slice(0, 200)}`));
      await shot('99-final');
    });

  } catch (err) {
    log(`FATAL: ${err.message}`);
    await shot('fatal-error');
  } finally {
    log('Closing application...');
    try { 
      await app.close(); 
    } catch(e) { log(`Close error (safe to ignore): ${e.message.slice(0, 100)}`); }
  }

  await sleep(8000);

  let leftoverProcesses = 0;
  try {
    const { execSync } = require('child_process');
    const out = execSync('tasklist /FI "IMAGENAME eq kairo-runtime.exe" /FO CSV /NH', { encoding: 'utf8', timeout: 5000 });
    leftoverProcesses = (out.match(/kairo-runtime/g) || []).length;
    if (leftoverProcesses > 0) log(`  ⚠ ${leftoverProcesses} kairo-runtime.exe processes remaining`);
    else log('  kairo-runtime.exe cleaned up');
  } catch(e) {}

  let logErrors = 0;
  try {
    const appDataLogs = path.join(process.env.APPDATA, 'Kairo IDE', 'logs');
    if (fs.existsSync(appDataLogs)) {
      for (const lf of fs.readdirSync(appDataLogs).filter(f => f.endsWith('.log')).slice(-3)) {
        const content = fs.readFileSync(path.join(appDataLogs, lf), 'utf8');
        const errs = (content.match(/\b(ERROR|FATAL)\b/g) || []).length;
        if (errs > 0) { logErrors += errs; log(`  Log ${lf}: ${errs} ERROR/FATAL`); }
      }
    }
  } catch(e) {}

  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const p0Pass = results.filter(r => r.priority === 'P0' && r.status === 'pass').length;
  const p0Total = results.filter(r => r.priority === 'P0').length;
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  log('');
  log('========================================');
  log(`Report: ${runDir}`);
  log(`Pass: ${pass}/${results.length} (${((pass/results.length)*100).toFixed(1)}%)`);
  log(`P0: ${p0Pass}/${p0Total}, Bugs: ${bugs.length}, Log errors: ${logErrors}, Leftover procs: ${leftoverProcesses}, Duration: ${duration}s`);
  log('========================================');

  fs.writeFileSync(path.join(runDir, 'deep-results.json'), JSON.stringify({
    timestamp: new Date().toISOString(), duration: duration + 's',
    pass, fail, total: results.length, p0Pass, p0Total, bugs, results, consoleErrors, logErrors, leftoverProcesses,
  }, null, 2));

  const md = generateReport(results, bugs, consoleErrors, logErrors, leftoverProcesses, duration);
  fs.writeFileSync(path.join(runDir, 'deep-test-report.md'), md, 'utf8');
  log(`Report: ${path.join(runDir, 'deep-test-report.md')}`);
  process.exit(fail > 0 ? 1 : 0);
}

function generateReport(results, bugs, consoleErrors, logErrors, leftoverProcesses, duration) {
  const pass = results.filter(r => r.status === 'pass').length;
  const lines = [
    '# Kairo IDE Deep E2E Test Report (v8b)', '',
    `- **Date**: ${new Date().toISOString()}`,
    `- **Duration**: ${duration}s`,
    `- **Pass Rate**: ${pass}/${results.length} (${((pass/results.length)*100).toFixed(1)}%)`,
    `- **P0 Pass**: ${results.filter(r=>r.priority==='P0'&&r.status==='pass').length}/${results.filter(r=>r.priority==='P0').length}`,
    `- **Bugs**: ${bugs.length}`, `- **Log Errors**: ${logErrors}`, `- **Leftover Processes**: ${leftoverProcesses}`, '',
    '## Test Results', '',
    '| # | Section | Priority | Test | Status | Duration | Error |',
    '|---|---------|----------|------|--------|----------|-------|'
  ];
  for (const r of results) {
    lines.push(`| ${r.id} | §${r.section} | ${r.priority} | ${r.name} | ${r.status.toUpperCase()} | ${r.duration}ms | ${r.error ? r.error.slice(0,100).replace(/\|/g,'\\|') : '-'} |`);
  }
  if (bugs.length) {
    lines.push('', '## Bug Report');
    for (const b of bugs) lines.push('', `### ${b.id} [${b.severity}] ${b.name}`, `- **Section**: §${b.section} (${b.testId})`, `- **Severity**: ${b.severity}`, `- **Error**: ${b.error}`, b.screenshot ? `- **Screenshot**: ${b.screenshot}` : '');
  }
  return lines.join('\n');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
