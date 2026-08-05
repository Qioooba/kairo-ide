/**
 * Diagnose why Show Usages / references returns empty in a live Theia session.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'show-usages-browser-verify');
fs.mkdirSync(outDir, { recursive: true });
const url = process.argv[2] || 'http://127.0.0.1:18301';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ensureCmdReg(page) {
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(() => {
      let container = window.theia?.container;
      if (!container?._bindingDictionary?._map) {
        for (const el of document.querySelectorAll('*')) {
          const c = el.__inversify_container__;
          if (c?._bindingDictionary?._map?.size > 100) { container = c; break; }
        }
      }
      if (!container?._bindingDictionary?._map) return false;
      for (const [key] of container._bindingDictionary._map.entries()) {
        try {
          const svc = container.get(key);
          if (svc?.getAllCommands && svc?.executeCommand && svc?.getCommand && svc?.registerCommand) {
            window.__kairoCmdReg = svc;
            return true;
          }
        } catch {}
      }
      return false;
    });
    if (ok) return true;
    await sleep(1000);
  }
  return false;
}

async function resolveService(page, predSrc) {
  return page.evaluate((pred) => {
    let container = window.theia?.container;
    if (!container?._bindingDictionary?._map) {
      for (const el of document.querySelectorAll('*')) {
        const c = el.__inversify_container__;
        if (c?._bindingDictionary?._map?.size > 100) { container = c; break; }
      }
    }
    if (!container?._bindingDictionary?._map) return { ok: false, reason: 'no-container' };
    const fn = eval(`(${pred})`);
    for (const [key] of container._bindingDictionary._map.entries()) {
      try {
        const svc = container.get(key);
        if (fn(svc, String(key))) {
          window.__diagSvc = svc;
          return { ok: true, key: String(key) };
        }
      } catch {}
    }
    return { ok: false, reason: 'not-found' };
  }, predSrc);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PW_CHROME
      || 'C:/Users/Qi/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#theia-statusBar', { timeout: 120000 });
  await sleep(3000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#theia-statusBar', { timeout: 120000 });
  await sleep(5000);

  const regOk = await ensureCmdReg(page);
  console.log('cmdReg', regOk);

  // Find JavaLanguageClient
  const clientHit = await resolveService(page, `s => s && typeof s.references === 'function' && typeof s.definition === 'function' && typeof s.getState === 'function'`);
  console.log('javaClient', clientHit);

  // Open file
  await page.keyboard.press('Control+P');
  await sleep(800);
  await page.locator('.quick-input-widget input[type="text"]').first().fill('HelloServlet.java');
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(3000);

  // Focus class name via Monaco model API
  const pos = await page.evaluate(() => {
    const monaco = window.monaco;
    if (!monaco?.editor) return { ok: false, reason: 'no-monaco' };
    const editors = monaco.editor.getEditors?.() || monaco.editor.getModels?.() && [];
    // Prefer standalone editors
    const list = typeof monaco.editor.getEditors === 'function'
      ? monaco.editor.getEditors()
      : [];
    let editor = list[0];
    if (!editor) {
      // fallback: get focused
      editor = monaco.editor.getFocusedCodeEditor?.();
    }
    const models = monaco.editor.getModels();
    const model = models.find(m => /HelloServlet\.java$/i.test(m.uri?.toString?.() || '')) || models[0];
    if (!model) return { ok: false, reason: 'no-model', modelCount: models.length };
    const lineCount = model.getLineCount();
    let line = 0, col = 0, word = '';
    for (let i = 1; i <= lineCount; i++) {
      const text = model.getLineContent(i);
      const m = text.match(/class\s+(HelloServlet)\b/);
      if (m) {
        line = i;
        col = text.indexOf(m[1]) + 1;
        word = m[1];
        break;
      }
    }
    if (!line) {
      for (let i = 1; i <= lineCount; i++) {
        const text = model.getLineContent(i);
        const idx = text.indexOf('HelloServlet');
        if (idx >= 0) { line = i; col = idx + 1; word = 'HelloServlet'; break; }
      }
    }
    if (editor && line) {
      editor.setPosition({ lineNumber: line, column: col + 2 });
      editor.revealLineInCenter(line);
      editor.focus();
    }
    return {
      ok: !!line,
      uri: model.uri.toString(),
      line,
      col,
      word,
      lineText: line ? model.getLineContent(line) : '',
      editorCount: list.length,
      modelCount: models.length,
    };
  });
  console.log('position', JSON.stringify(pos));

  // Wait for LS ready
  const state = await page.evaluate(async () => {
    const c = window.__diagSvc;
    if (!c) return { noClient: true };
    const out = {};
    try { out.state = c.getState?.() ?? c.state; } catch (e) { out.stateErr = String(e); }
    try { out.isReady = c.isReady?.(); } catch {}
    try { out.backend = !!(c.backend || c.rpcProxy); } catch {}
    return out;
  });
  console.log('lsState', JSON.stringify(state));

  // Direct references call
  const refs = await page.evaluate(async (p) => {
    const c = window.__diagSvc;
    if (!c) return { error: 'no-client' };
    const t0 = Date.now();
    try {
      const result = await c.references({
        uri: p.uri,
        line: p.line - 1,
        character: p.col - 1,
        includeDeclaration: true,
      });
      return { ms: Date.now() - t0, count: Array.isArray(result) ? result.length : -1, sample: (result || []).slice(0, 5) };
    } catch (e) {
      return { ms: Date.now() - t0, error: String(e) };
    }
  }, pos);
  console.log('references', JSON.stringify(refs, null, 2));

  // Also definition
  const def = await page.evaluate(async (p) => {
    const c = window.__diagSvc;
    try {
      const result = await c.definition({ uri: p.uri, line: p.line - 1, character: p.col - 1 });
      return { result };
    } catch (e) {
      return { error: String(e) };
    }
  }, pos);
  console.log('definition', JSON.stringify(def, null, 2));

  // Execute show usages and capture notifications
  await page.evaluate(async () => {
    await window.__kairoCmdReg.executeCommand('kairo.java.showUsages');
  });
  await sleep(6000);
  await page.screenshot({ path: path.join(outDir, 'diag-show.png'), fullPage: true });

  const ui = await page.evaluate(() => {
    const toasts = [...document.querySelectorAll('.theia-notification-list-item, .notification-list-item, .theia-notification-toast')]
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240));
    const qi = document.querySelector('.quick-input-widget');
    const panel = document.querySelector('.kairo-java-references-widget, #kairo-java-references');
    return {
      toasts: toasts.filter(Boolean).slice(0, 8),
      qi: qi ? {
        visible: getComputedStyle(qi).display !== 'none' && qi.clientHeight > 20,
        text: (qi.innerText || '').replace(/\s+/g, ' ').slice(0, 240),
      } : null,
      panel: panel ? {
        visible: getComputedStyle(panel).display !== 'none' && panel.clientHeight > 0,
        text: (panel.textContent || '').replace(/\s+/g, ' ').slice(0, 240),
      } : null,
    };
  });
  console.log('ui', JSON.stringify(ui, null, 2));

  // Find usages panel
  await page.evaluate(async () => {
    await window.__kairoCmdReg.executeCommand('kairo.java.findUsages');
  });
  await sleep(5000);
  await page.screenshot({ path: path.join(outDir, 'diag-find.png'), fullPage: true });
  const panel2 = await page.evaluate(() => {
    const panel = document.querySelector('.kairo-java-references-widget, #kairo-java-references');
    return panel ? {
      visible: getComputedStyle(panel).display !== 'none' && panel.clientHeight > 0,
      text: (panel.textContent || '').replace(/\s+/g, ' ').slice(0, 300),
    } : null;
  });
  console.log('panel2', JSON.stringify(panel2));
  console.log('consoleLogs', logs.filter(l => /java|jdt|reference|usage|rpc|error/i.test(l)).slice(-30));

  fs.writeFileSync(path.join(outDir, 'diag-report.json'), JSON.stringify({ pos, state, refs, def, ui, panel2, logs: logs.slice(-50) }, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(2); });
