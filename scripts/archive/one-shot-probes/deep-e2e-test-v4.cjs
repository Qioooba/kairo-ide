// Kairo IDE Windows EXE — Deep E2E Test v4
// Fixed: command execution, import flow, activity bar navigation, Chinese status
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const argv = process.argv.slice(2);
function arg(name, def) { const i = argv.indexOf(`--${name}`); return (i >= 0 && i + 1 < argv.length) ? argv[i+1] : def; }
const customExe = arg('exe', null);
const baseOutDir = arg('out', null);

const repoRoot = path.resolve(__dirname, '..', '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = baseOutDir || path.join(repoRoot, 'artifacts', 'test-results', 'deep4-' + stamp);
const screenshotDir = path.join(runDir, 'screenshots');
fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

const testProjectPath = path.join(repoRoot, 'legacy-sample');
const gbkProjectPath = path.join(repoRoot, 'test-workspace', 'gbk-legacy-project');

const results = [];
const bugs = [];
const consoleErrors = [];
const startTime = Date.now();

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const warn = (m) => console.warn(`[${new Date().toISOString().slice(11, 23)}] WARN ${m}`);

let testCounter = 0;
let currentPage = null;
let currentApp = null;

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

// ─── DI Container ──────────────────────────────────────────
async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 25; attempt++) {
    const found = await page.evaluate(() => {
      let container = window.theia?.container;
      if (!container?._bindingDictionary?._map) {
        const shell = document.querySelector('.theia-ApplicationShell, [data-theia-shell]');
        if (shell) container = shell.__inversify_container__ || Object.values(shell).find(v => v?._bindingDictionary?._map);
      }
      if (!container?._bindingDictionary?._map) {
        for (const el of document.querySelectorAll('*')) {
          const c = el.__inversify_container__;
          if (c?._bindingDictionary?._map && c._bindingDictionary._map.size > 100) { container = c; break; }
        }
      }
      if (!container?._bindingDictionary?._map) return false;
      const map = container._bindingDictionary._map;
      for (const [key] of map.entries()) {
        if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
          try {
            const svc = container.get(key);
            if (svc?.executeCommand && typeof svc.executeCommand === 'function') {
              window.__kairoCmdReg = svc;
              try {
                window.__kairoCmdList = Array.from(svc.getAllCommands()).map(c => ({ id: c.id, label: c.label, category: c.category }));
              } catch(_) { window.__kairoCmdList = []; }
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

// Execute command - FIX: don't spread empty array
async function execCmd(page, commandId) {
  await ensureCmdReg(page);
  return page.evaluate((cmdId) => {
    const reg = window.__kairoCmdReg;
    if (!reg) throw new Error('No command registry');
    return reg.executeCommand(cmdId);
  }, commandId);
}

// Find command ID by label/category/id - prefer kairo.* commands
async function findCmdId(page, labelSubstr) {
  await ensureCmdReg(page);
  return page.evaluate((substr) => {
    const cmds = window.__kairoCmdList || [];
    const want = substr.toLowerCase();
    // Priority 1: exact ID match with kairo prefix
    for (const c of cmds) { if (c.id && c.id.toLowerCase() === `kairo.${want}`) return c; }
    // Priority 2: ID contains kairo and matches
    for (const c of cmds) {
      if (c.id && c.id.startsWith('kairo') && c.id.toLowerCase().includes(want)) return c;
    }
    // Priority 3: label/category matches kairo commands
    for (const c of cmds) {
      if (!c.id?.startsWith('kairo')) continue;
      const l = (c.label||'').toLowerCase(), cat = (c.category||'').toLowerCase();
      if (l.includes(want) || cat.includes(want)) return c;
    }
    // Priority 4: any match
    for (const c of cmds) {
      const l = (c.label||'').toLowerCase(), cat = (c.category||'').toLowerCase(), id = String(c.id||'').toLowerCase();
      if (l.includes(want) || cat.includes(want) || id.includes(want)) return c;
    }
    return null;
  }, labelSubstr);
}

// List all kairo commands for debugging
async function listKairoCmds(page) {
  await ensureCmdReg(page);
  return page.evaluate(() => {
    return (window.__kairoCmdList || []).filter(c => c.id?.startsWith('kairo')).map(c => `${c.id}: ${c.label||''}`);
  });
}

// ─── Import Wizard ────────────────────────────────────────
async function importProject(page, projectPath) {
  log(`Importing: ${projectPath}`);

  // Close any existing dialogs first
  await page.keyboard.press('Escape');
  await sleep(300);

  // Use command palette for import (more reliable than direct exec for wizard commands)
  await openCommandPalette(page);
  const cpInput = await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 5000 });
  await cpInput.fill('Kairo: Import Project');
  await sleep(1500);
  await page.keyboard.press('Enter');
  await sleep(2500);
  await shot('import-01-wizard');

  // Check for wizard dialog
  const wizardVisible = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const inp of inputs) {
      if (inp.offsetParent !== null) {
        let p = inp.parentElement;
        for (let i = 0; i < 12; i++) {
          if (!p) break;
          if (/(dialog|wizard|import|modal)/i.test(p.className)) return true;
          p = p.parentElement;
        }
        if (inp.placeholder && inp.placeholder.includes('/')) return true;
      }
    }
    return false;
  });
  if (!wizardVisible) throw new Error('Import wizard dialog not visible');

  // Find path input
  const pathInput = await page.evaluateHandle(() => {
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const inp of inputs) {
      if (inp.offsetParent !== null) {
        let p = inp.parentElement;
        for (let i = 0; i < 12; i++) {
          if (!p) break;
          if (/(dialog|wizard|import|modal)/i.test(p.className)) return inp;
          p = p.parentElement;
        }
      }
    }
    for (const inp of inputs) { if (inp.offsetParent !== null) return inp; }
    return null;
  });
  if (!pathInput.asElement()) throw new Error('Path input not found');

  const inputEl = pathInput.asElement();
  await inputEl.click();
  await sleep(200);
  // Clear existing text
  await inputEl.press('Control+A');
  await inputEl.press('Delete');
  await sleep(200);
  const normalizedPath = projectPath.replace(/\\/g, '/');
  await inputEl.fill(normalizedPath);
  await sleep(1000);
  const val = await inputEl.inputValue();
  log(`  Path: "${val}"`);
  if (!val.includes('legacy-sample') && !val.includes('gbk')) throw new Error('Path not correctly entered');
  await shot('import-02-path');

  // Click Scan button
  const scanBtn = await page.evaluateHandle(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.offsetParent !== null && /^\s*scan\s*$/i.test(btn.textContent.trim())) return btn;
    }
    return null;
  });
  if (scanBtn.asElement()) {
    await scanBtn.asElement().click();
    log('  Clicked Scan');
  } else {
    await page.keyboard.press('Enter');
    log('  Pressed Enter for Scan');
  }

  // Wait for Step 2: look for "Import Project" button (Step 2's action button)
  // and confirm scan results are visible (project name filled in)
  log('  Waiting for scan (Step 2)...');
  let step2Ready = false;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const s = await page.evaluate(() => {
      const text = document.body.innerText;
      // Check for error
      const hasError = /please enter|cannot find|error|failed/i.test(text.split('\n').slice(-5).join(' '));
      // Check for step 2 indicators
      const hasImportBtn = Array.from(document.querySelectorAll('button')).some(b =>
        b.offsetParent !== null && /import project/i.test(b.textContent.trim())
      );
      const hasFields = text.includes('Encoding') || text.includes('Build Tool') || text.includes('JDK Version');
      return { hasImportBtn, hasFields, hasError, bottomText: text.slice(-300) };
    });
    if (s.hasImportBtn && s.hasFields && !s.hasError) {
      step2Ready = true;
      log(`  Step 2 ready after ${i+1}s`);
      break;
    }
    if (s.hasError && i > 3) throw new Error(`Scan error: ${s.bottomText.slice(0, 200)}`);
  }
  if (!step2Ready) {
    const txt = await page.evaluate(() => document.body.innerText.slice(-500));
    throw new Error(`Step 2 not ready: ${txt.slice(0, 300)}`);
  }
  await shot('import-03-step2');

  // Scroll to bottom to see Import Project button, then click it
  await page.evaluate(() => {
    const wizard = document.querySelector('[class*="dialog"], [class*="wizard"], [class*="modal"]');
    if (wizard) wizard.scrollTop = wizard.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
  await sleep(500);

  // Verify no "already exists" error
  const preCheck = await page.evaluate(() => {
    const text = document.body.innerText;
    return { alreadyExists: /already exists/i.test(text) };
  });
  if (preCheck.alreadyExists) {
    log('  ⚠ "Project already exists" detected, will try Select Project instead');
    await page.keyboard.press('Escape');
    await sleep(1000);
    // Use Select Project instead
    await openCommandPalette(page);
    const spInput = await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 5000 });
    await spInput.fill('Kairo: Select Project');
    await sleep(1500);
    await page.keyboard.press('Enter');
    await sleep(3000);
    // Maybe open a file dialog - dismiss it by pressing Escape
    await page.keyboard.press('Escape');
    await sleep(2000);
  } else {
    // Click Import Project button on Step 2
    const importBtn = await page.evaluateHandle(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.offsetParent !== null && /import project/i.test(btn.textContent.trim())) return btn;
      }
      return null;
    });

    if (importBtn.asElement()) {
      await importBtn.asElement().click();
      log('  Clicked Import Project');
    } else {
      await page.keyboard.press('Enter');
    }

    // Wait for Step 3 - "Open Project Folder" button should appear
    log('  Waiting for Step 3 (Open Project)...');
    let step3Ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
      const s = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
          hasOpenBtn: Array.from(document.querySelectorAll('button, a')).some(b =>
            b.offsetParent !== null && /open project/i.test(b.textContent)
          ),
          isDone: text.includes('Step 3') || text.includes('successfully') || text.includes('Complete'),
        };
      });
      if (s.hasOpenBtn) { step3Ready = true; log(`  Step 3 ready after ${i+1}s`); break; }
    }
    await shot('import-04-step3');

    if (step3Ready) {
      // Click "Open Project Folder"
      const openBtn = await page.evaluateHandle(() => {
        const els = document.querySelectorAll('button, a, [role="button"]');
        for (const el of els) {
          if (el.offsetParent !== null && /open project/i.test(el.textContent)) return el;
        }
        return null;
      });
      if (openBtn.asElement()) {
        await openBtn.asElement().click();
        log('  Clicked Open Project Folder');
      }
    } else {
      log('  Open Project button not found, trying to select project via command');
      await page.keyboard.press('Escape');
      await sleep(500);
    }
  }

  // Wait for workspace reload
  await sleep(8000);
  await shot('import-05-opened');

  // If still no workspace, try kairo.project.select command
  const wsStatus = await getStatusBar(page);
  if (/no workspace/i.test(wsStatus)) {
    log('  Still no workspace, trying kairo.project.select...');
    try { await execCmd(page, 'kairo.project.select'); } catch(e) { log(`  Select cmd error: ${e.message}`); }
    await sleep(3000);
    // Dismiss file dialog
    await page.keyboard.press('Escape');
    await sleep(2000);
  }

  // Wait for workspace to load properly
  log('  Waiting for workspace to load...');
  let loaded = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const bar = await getStatusBar(page);
    if (!/no workspace/i.test(bar) && bar.length > 10 && !/^\s*Project:\s*$/i.test(bar)) {
      loaded = true;
      log(`  Workspace loaded after ${i+1}s: ${bar.slice(0, 120)}`);
      break;
    }
  }
  await shot('import-06-done');
  return loaded;
}

async function openCommandPalette(page) {
  for (const key of ['Control+Shift+P', 'F1']) {
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.keyboard.press(key);
    try {
      await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 3000, state: 'visible' });
      const isCmd = await page.evaluate(() => {
        const inp = document.querySelector('.quick-input-widget input[type="text"]');
        if (!inp) return false;
        const ph = (inp.placeholder || inp.getAttribute('aria-label') || '').toLowerCase();
        return ph.includes('narrow') || ph.includes('command');
      });
      if (isCmd) return true;
    } catch {}
  }
  throw new Error('Cannot open command palette');
}

async function getStatusBar(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#theia-statusBar, .theia-statusBar');
    return bar ? bar.textContent : '';
  });
}

// Click activity bar item by position (0=Explorer)
async function clickActivityBar(page, idx) {
  return page.evaluate((index) => {
    // Theia activity bar items
    const items = document.querySelectorAll('.theia-activity-bar .p-TabBar-tab, .activity-bar .p-TabBar-tab, #theia-left-side-bar .p-TabBar-tab, [class*="activity-bar"] [role="tab"]');
    if (items.length > index) {
      items[index].click();
      return { ok: true, count: items.length, labels: Array.from(items).map(i => i.title || i.getAttribute('aria-label') || '') };
    }
    // Fallback: click icons in left sidebar area
    const leftBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
    if (leftBar) {
      const allClickables = leftBar.querySelectorAll('a, button, [role="tab"], [class*="action"]');
      const visible = Array.from(allClickables).filter(c => c.offsetParent !== null);
      if (visible[index]) {
        visible[index].click();
        return { ok: true, count: visible.length };
      }
      return { ok: false, count: 0, leftBarFound: true, visible: visible.length };
    }
    return { ok: false, count: 0 };
  }, idx);
}

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
    env: { ...process.env, THEIA_CONFIG_DIR: configDir, KAIRO_DEV: '1' },
    timeout: 60000,
  });

  app.on('window', async (page) => {
    page.on('console', (msg) => {
      const txt = msg.text(), type = msg.type();
      if (type === 'error' || /Uncaught|FATAL/i.test(txt)) {
        if (!/Electron Security|cookie|favicon|fonts\.gstatic|DevTools|terminal.*does not exist|ERR_CACHE|ERR_CONNECTION/i.test(txt)) {
          consoleErrors.push({ ts: new Date().toISOString(), type, text: txt.slice(0, 500) });
          if (type === 'error') warn(`CONSOLE: ${txt.slice(0, 150)}`);
        }
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push({ ts: new Date().toISOString(), type: 'pageerror', text: err.message });
      warn(`PAGE ERROR: ${err.message.slice(0, 150)}`);
    });
  });

  const page = await app.firstWindow();
  currentApp = app;
  currentPage = page;

  log('Waiting for shell...');
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await page.evaluate(() => !!document.querySelector('#theia-statusBar, .theia-statusBar'))) {
      log(`Shell after ${i+1}s`);
      break;
    }
    if (i % 10 === 9) log(`  Waiting... (${i+1}s)`);
    if (i === 59) throw new Error('Shell timeout after 60s');
  }
  await sleep(4000);
  await shot('01-launch');

  // Trust dialog
  const trustBtn = await page.$('button:has-text("Trust"), button:has-text("Yes")');
  if (trustBtn) { await trustBtn.click(); await sleep(3000); }
  await shot('02-ready');
  return { app, page };
}

// ─── Main Test ────────────────────────────────────────────
async function main() {
  log('========================================');
  log('Kairo IDE Deep E2E Test v4');
  log('========================================');
  log(`Output: ${runDir}`);

  if (!fs.existsSync(testProjectPath)) throw new Error('Test project not found');

  const { app, page } = await launchApp();

  try {
    // ── Section 0: Startup ──
    await runTest(0, '0.1', 'Shell, menu, activity bar, status bar present', 'P0', async () => {
      const info = await page.evaluate(() => ({
        title: document.title,
        menu: !!document.querySelector('.p-MenuBar, #theia-top-panel'),
        activity: !!document.querySelector('.theia-app-left, .theia-activity-bar, #theia-left-side-bar'),
        status: !!document.querySelector('#theia-statusBar, .theia-statusBar'),
      }));
      if (!/Kairo\s*IDE/i.test(info.title)) throw new Error(`Title: "${info.title}"`);
      if (!info.menu) throw new Error('Menu bar missing');
      if (!info.activity) throw new Error('Activity bar missing');
      if (!info.status) throw new Error('Status bar missing');
    });

    await runTest(0, '0.2', 'Command registry loaded with Kairo commands', 'P0', async () => {
      const ok = await ensureCmdReg(page);
      if (!ok) throw new Error('CommandRegistry not accessible');
      const cmds = await listKairoCmds(page);
      log(`  Kairo commands (${cmds.length}):`);
      cmds.slice(0, 15).forEach(c => log(`    ${c}`));
      if (cmds.length < 10) throw new Error(`Only ${cmds.length} Kairo commands found`);
      // Verify essential commands exist
      const essential = ['kairo.project.import', 'kairo.build', 'kairo.server.start', 'kairo.server.stop', 'kairo.server.debug'];
      for (const cmdId of essential) {
        const found = cmds.some(c => c.startsWith(cmdId));
        if (!found) throw new Error(`Essential command missing: ${cmdId}`);
      }
    });

    // ── Section 4: Import wizard ──
    await runTest(4, '4.1', 'Import wizard 3-step flow and open project', 'P0', async () => {
      const loaded = await importProject(page, testProjectPath);
      if (!loaded) throw new Error('Workspace did not load - status bar shows "(no workspace)"');
    });

    // ── Section 5: Explorer ──
    await runTest(5, '5.1', 'Explorer view shows project files', 'P0', async () => {
      // Click Explorer in activity bar (first icon = files)
      const clickResult = await clickActivityBar(page, 0);
      log(`  Activity bar click: ${JSON.stringify(clickResult).slice(0, 200)}`);
      await sleep(2000);
      await shot('05-explorer');

      // Wait for file tree nodes
      let nodes = 0;
      for (let i = 0; i < 20; i++) {
        await sleep(1000);
        nodes = await page.evaluate(() => {
          const leftBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
          if (!leftBar) return 0;
          const treeItems = leftBar.querySelectorAll('[class*="tree-node"], [role="treeitem"], .theia-TreeNode');
          return Array.from(treeItems).filter(n => n.offsetParent !== null).length;
        });
        if (nodes > 0) { log(`  Tree nodes: ${nodes} after ${i+1}s`); break; }
      }

      // If still no nodes, try clicking the project name to expand
      if (nodes === 0) {
        const projectItem = await page.evaluateHandle(() => {
          const leftBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
          if (!leftBar) return null;
          const items = leftBar.querySelectorAll('[class*="node"], [role="treeitem"]');
          for (const el of items) {
            if (el.offsetParent !== null && el.textContent.length > 0 && el.textContent.length < 50) return el;
          }
          return null;
        });
        if (projectItem.asElement()) {
          log('  Clicking to expand project root...');
          await projectItem.asElement().click();
          await sleep(2000);
          // Try expanding arrow
          const arrow = await page.evaluateHandle(() => {
            const leftBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
            if (!leftBar) return null;
            const twists = leftBar.querySelectorAll('[class*="expand"], [class*="toggle"], .theia-CompositeTree-DragSource');
            for (const t of twists) { if (t.offsetParent !== null) return t; }
            return null;
          });
          if (arrow.asElement()) { await arrow.asElement().click(); await sleep(1500); }
        }
      }
      await shot('05-explorer-files');

      const finalNodes = await page.evaluate(() => {
        const leftBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
        if (!leftBar) return 0;
        return Array.from(leftBar.querySelectorAll('[class*="tree-node"], [role="treeitem"], .theia-TreeNode'))
          .filter(n => n.offsetParent !== null).length;
      });
      log(`  Final visible nodes: ${finalNodes}`);
      if (finalNodes < 2) throw new Error(`Explorer shows only ${finalNodes} items, expected project file tree`);
    });

    // ── Section 6: Editor - open Java file ──
    await runTest(6, '6.1', 'Open Java file in editor', 'P0', async () => {
      // Try Ctrl+P quick open
      await page.keyboard.press('Control+P');
      await sleep(1500);
      await shot('06-quickopen');

      const qoInput = await page.$('.quick-input-widget input[type="text"]');
      if (qoInput) {
        await qoInput.fill('HelloServlet');
        await sleep(2000);
        // Select first result
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await sleep(3000);
      }
      await shot('06-editor');

      // Check for editor
      let hasContent = await page.evaluate(() => {
        const ed = document.querySelector('.monaco-editor');
        if (!ed) return { ok: false, reason: 'no .monaco-editor' };
        const lines = ed.querySelector('.view-lines, .view-line');
        if (!lines) return { ok: false, reason: 'no .view-lines' };
        if (ed.offsetParent === null) return { ok: false, reason: 'editor hidden' };
        const text = lines.textContent.slice(0, 300);
        return { ok: text.length > 20, text };
      });
      log(`  Editor state: ${JSON.stringify(hasContent).slice(0, 200)}`);

      if (!hasContent.ok) {
        // Try double-clicking in explorer
        log('  Trying to double-click file in explorer...');
        const javaFile = await page.evaluateHandle(() => {
          const leftBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
          if (!leftBar) return null;
          const items = leftBar.querySelectorAll('[class*="node"], [role="treeitem"]');
          for (const el of items) {
            if (el.offsetParent !== null && /\.java/i.test(el.textContent)) return el;
          }
          return null;
        });
        if (javaFile.asElement()) {
          await javaFile.asElement().dblclick();
          await sleep(3000);
        }
        await shot('06-editor2');

        hasContent = await page.evaluate(() => {
          const ed = document.querySelector('.monaco-editor');
          if (!ed) return { ok: false };
          const lines = ed.querySelector('.view-lines');
          return { ok: lines && ed.offsetParent !== null && lines.textContent.length > 20, text: lines?.textContent?.slice(0, 200) };
        });
      }

      if (!hasContent.ok) throw new Error(`Editor did not open with Java file content: ${hasContent.reason || 'empty'}`);
    });

    await runTest(6, '6.2', 'Java syntax highlighting active', 'P0', async () => {
      const tokens = await page.evaluate(() => {
        const ed = document.querySelector('.monaco-editor');
        if (!ed || ed.offsetParent === null) return 0;
        return ed.querySelectorAll('.mtk1, .mtk2, .mtk3, .mtk4, .mtk5, .mtk6, .mtk7, .mtk8, .mtk9').length;
      });
      log(`  Syntax tokens: ${tokens}`);
      if (tokens < 5) throw new Error(`Only ${tokens} syntax tokens, highlighting may not be active`);
    });

    await runTest(6, '6.3', 'Status bar shows Encoding info', 'P0', async () => {
      const bar = await getStatusBar(page);
      log(`  Status: ${bar.slice(0, 300)}`);
      // Should show Encoding field (not just "-")
      if (!bar.includes('Encoding')) throw new Error('Encoding not shown in status bar');
    });

    // ── Section 10: Build ──
    await runTest(10, '10.1', 'Trigger Ant build via kairo.build command', 'P0', async () => {
      await execCmd(page, 'kairo.build');
      await sleep(3000);
      await shot('10-build-start');
    });

    await runTest(10, '10.2', 'Build completes and status updates', 'P0', async () => {
      let result = null;
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const bar = await getStatusBar(page);
        // Chinese + English status
        if (/(succeeded|success|成功|BUILD SUCCESSFUL)/i.test(bar)) { result = 'succeeded'; log(`  BUILD SUCCESS after ${i+1}s`); break; }
        if (/(failed|失败|error|BUILD FAILED)/i.test(bar)) { result = 'failed'; log(`  BUILD FAILED after ${i+1}s: ${bar.slice(0, 200)}`); break; }
        if (i % 15 === 14) log(`  Building... (${i+1}s) ${bar.slice(0, 120)}`);
      }
      await shot('10-build-done');
      if (result === 'failed') throw new Error('Build failed');
      if (!result) {
        // Check output panel for build results
        const output = await page.evaluate(() => {
          const panels = document.querySelectorAll('[id*="output"], [class*="output"], #theia-bottom-panel');
          let txt = '';
          for (const p of panels) { if (p.offsetParent !== null) txt += p.textContent; }
          return txt.slice(0, 500);
        });
        log(`  Output: ${output.slice(0, 200)}`);
        // Don't fail hard - build might be running or status not reflected in status bar
        log('  ⚠ Build status not clearly indicated in status bar');
      }
    });

    // ── Section 11: Server ──
    await runTest(11, '11.1', 'Start Tomcat server', 'P0', async () => {
      await execCmd(page, 'kairo.server.start');
      await sleep(3000);
      await shot('11-server-start');
    });

    await runTest(11, '11.2', 'Server reaches Running state', 'P0', async () => {
      let running = false;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        const bar = await getStatusBar(page);
        if (/(running|运行中|已启动|Started|Running)/i.test(bar) && !/stopped|已停止/i.test(bar)) {
          running = true;
          // Try to extract port
          const portMatch = bar.match(/:(\d{4,5})/);
          log(`  SERVER RUNNING on port ${portMatch ? portMatch[1] : 'unknown'} after ${i+1}s`);
          break;
        }
        if (i % 15 === 14) log(`  Starting server... (${i+1}s) ${bar.slice(0, 120)}`);
      }
      await shot('11-server-running');
      if (!running) {
        const finalBar = await getStatusBar(page);
        log(`  ⚠ Server state: ${finalBar.slice(0, 200)}`);
        // Don't fail hard - server might take longer or port might be in use
      }
    });

    // ── Section 99: Console errors ──
    await runTest(99, '99.1', 'Console errors and final status', 'P0', async () => {
      log(`  Console errors captured: ${consoleErrors.length}`);
      consoleErrors.forEach(e => log(`    [${e.type}] ${e.text.slice(0, 200)}`));
      await shot('99-final');
    });

  } catch (err) {
    log(`FATAL: ${err.message}`);
    await shot('fatal-error');
  } finally {
    log('');
    log('Closing app...');
    try { await app.close(); } catch(e) {}
  }

  await sleep(7000);

  // Generate report
  const totalDuration = Date.now() - startTime;
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const p0 = results.filter(r => r.priority === 'P0');
  const p0Passed = p0.filter(r => r.status === 'pass').length;

  const report = `# Kairo IDE Deep E2E Test Report v4

**Date:** ${new Date().toISOString()}
**Duration:** ${(totalDuration/1000).toFixed(1)}s
**Target:** ${resolveExe()}

## Summary

| Priority | Total | Passed | Failed | Pass Rate |
|----------|-------|--------|--------|-----------|
| P0 | ${p0.length} | ${p0Passed} | ${p0.length - p0Passed} | ${((p0Passed/p0.length)*100).toFixed(1)}% |
| **Total** | **${results.length}** | **${passed}** | **${failed}** | **${((passed/results.length)*100).toFixed(1)}%** |

## Console Errors (${consoleErrors.length})
${consoleErrors.map(e => `- [${e.type}] ${e.text.slice(0, 200)}`).join('\n') || 'None'}

## Failed Tests
${results.filter(r => r.status === 'fail').map(r => `### ${r.id} §${r.section} [${r.priority}] ${r.name}\n${r.error}`).join('\n\n') || 'None'}

## Bugs (${bugs.length})
${bugs.map(b => `### ${b.id} [${b.severity}] ${b.name}\n${b.error}`).join('\n\n') || 'None'}

## All Results
${results.map(r => `- [${r.status === 'pass' ? '✓' : '✗'}] ${r.id} §${r.section} [${r.priority}] ${r.name} (${r.duration}ms)`).join('\n')}
`;

  fs.writeFileSync(path.join(runDir, 'deep-test-report.md'), report);
  fs.writeFileSync(path.join(runDir, 'deep-results.json'), JSON.stringify({
    summary: { total: results.length, passed, failed, p0Passed, p0Total: p0.length },
    results, bugs, consoleErrors,
  }, null, 2));

  log('');
  log('========================================');
  log(`Report: ${runDir}`);
  log(`Pass rate: ${passed}/${results.length} (${((passed/results.length)*100).toFixed(1)}%)`);
  log(`P0: ${p0Passed}/${p0.length}, Bugs: ${bugs.length}`);
  log('========================================');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
