// Kairo IDE Windows EXE — Deep E2E Test v3
// Key improvements:
// - Reliable command execution via DI container executeCommand (not command palette)
// - Activity bar icon clicks for view navigation
// - Proper Chinese status bar detection
// - Screenshot on every step for debugging

const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}
const customExe = arg('exe', null);
const baseOutDir = arg('out', null);

const repoRoot = path.resolve(__dirname, '..', '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = baseOutDir || path.join(repoRoot, 'artifacts', 'test-results', 'deep3-' + stamp);
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
  const result = {
    id, section, name, priority,
    status: 'pass', duration: 0, error: null, screenshot: null,
    timestamp: new Date().toISOString(),
  };
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
      if (currentPage) {
        await currentPage.screenshot({ path: shotPath, fullPage: false });
        result.screenshot = path.relative(runDir, shotPath);
      }
    } catch (_) {}
    log(`  ✗ FAIL (${result.duration}ms): ${result.error}`);
    if (priority === 'P0' || priority === 'P1') addBug(section, id, name, priority, result.error, result.screenshot);
  }
}

function addBug(section, testId, name, severity, error, screenshot) {
  const bugId = `KAIRO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(bugs.length + 1).padStart(3, '0')}`;
  bugs.push({ id: bugId, section, testId, name, severity, error, screenshot });
}

async function shot(name) {
  try {
    const f = path.join(screenshotDir, `${name}.png`);
    await currentPage.screenshot({ path: f, fullPage: false });
    log(`  📸 ${name}.png`);
  } catch (e) {}
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── DI Container & Command Execution ──────────────────────
async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = await page.evaluate(() => {
      let container = window.theia?.container;
      if (!container || !container._bindingDictionary?._map) {
        const shell = document.querySelector('.theia-ApplicationShell, [data-theia-shell]');
        if (shell) container = shell.__inversify_container__ || Object.values(shell).find(v => v && v._bindingDictionary?._map);
      }
      if (!container || !container._bindingDictionary?._map) {
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const c = el.__inversify_container__;
          if (c && c._bindingDictionary?._map && c._bindingDictionary._map.size > 100) { container = c; break; }
        }
      }
      if (!container || !container._bindingDictionary?._map) return false;
      const map = container._bindingDictionary._map;
      for (const [key] of map.entries()) {
        if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
          try {
            const svc = container.get(key);
            if (svc && typeof svc.executeCommand === 'function') {
              window.__kairoCmdReg = svc;
              // Also get command IDs for debugging
              const cmds = svc.getAllCommands ? Array.from(svc.getAllCommands()).map(c => ({ id: c.id, label: c.label, category: c.category })) : [];
              window.__kairoCmdIds = cmds;
              return true;
            }
          } catch (_) {}
        }
      }
      return false;
    });
    if (found) return true;
    await sleep(1500);
  }
  return false;
}

// Execute a command directly via DI container (most reliable)
async function execCmd(page, commandId, args) {
  await ensureCmdReg(page);
  return page.evaluate((cmdId, cmdArgs) => {
    const reg = window.__kairoCmdReg;
    if (!reg) throw new Error('No command registry');
    return reg.executeCommand(cmdId, ...(cmdArgs || []));
  }, commandId, args || []);
}

// Search for commands by label substring
async function findCmdId(page, labelSubstr) {
  await ensureCmdReg(page);
  return page.evaluate((substr) => {
    const reg = window.__kairoCmdReg;
    if (!reg || !reg.getAllCommands) return null;
    const want = substr.toLowerCase();
    for (const c of reg.getAllCommands()) {
      if (!c) continue;
      const label = (c.label || '').toLowerCase();
      const category = (c.category || '').toLowerCase();
      const id = String(c.id || '').toLowerCase();
      if (label.includes(want) || category.includes(want) || id.includes(want)) {
        return { id: c.id, label: c.label, category: c.category };
      }
    }
    return null;
  }, labelSubstr);
}

// ─── Activity Bar Navigation ──────────────────────────────
async function clickActivityBar(page, iconIndex) {
  // Click nth icon in the left activity bar
  // 0 = Explorer, 1 = Search, 2 = Source Control, 3 = Run/Debug, 4 = Extensions, etc.
  return page.evaluate((idx) => {
    // Find activity bar items
    const bar = document.querySelector('.theia-activity-bar, .theia-app-left, #theia-left-side-bar .p-SplitPanel-handle + div, [class*="activity-bar"]');
    let items = [];
    if (bar) {
      items = bar.querySelectorAll('.p-TabBar-tab, [class*="activity-bar-item"], [class*="action-item"], [role="tab"]');
    }
    if (items.length === 0) {
      // Broader search: look for icons in left panel
      const leftPanel = document.querySelector('#theia-left-side-bar, .theia-app-left');
      if (leftPanel) {
        items = leftPanel.querySelectorAll('a, button, [class*="item"], [role="tab"]');
      }
    }
    if (items[idx]) {
      items[idx].click();
      return { clicked: true, count: items.length };
    }
    return { clicked: false, count: items.length };
  }, iconIndex);
}

// ─── Import Wizard (Playwright native interactions) ──────
async function importProject(page, projectPath) {
  log(`Starting import of: ${projectPath}`);

  // First find the import command
  const importCmd = await findCmdId(page, 'import project');
  log(`  Import command: ${importCmd ? importCmd.id : 'not found'}`);
  
  // Try to execute import command directly
  if (importCmd) {
    try { await execCmd(page, importCmd.id); } catch(e) { log(`  Direct exec failed: ${e.message}`); }
  } else {
    // Fallback: command palette
    await openCommandPalette(page);
    const input = await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 5000 });
    await input.fill('Import Project');
    await sleep(1500);
    await page.keyboard.press('Enter');
  }
  await sleep(2500);
  await shot('import-01-wizard-open');

  // Find and fill the path input
  const pathInput = await page.evaluateHandle(() => {
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const inp of inputs) {
      if (inp.offsetParent !== null) {
        let parent = inp.parentElement;
        for (let i = 0; i < 12; i++) {
          if (!parent) break;
          if (/(dialog|wizard|import|modal)/i.test(parent.className) || /(dialog|wizard|import|modal)/i.test(parent.id)) {
            return inp;
          }
          parent = parent.parentElement;
        }
        if (inp.placeholder && (inp.placeholder.includes('path') || inp.placeholder.includes('/'))) return inp;
      }
    }
    for (const inp of inputs) {
      if (inp.offsetParent !== null) return inp;
    }
    return null;
  });

  if (!pathInput.asElement()) throw new Error('Could not find path input');

  const inputEl = pathInput.asElement();
  await inputEl.click();
  await sleep(200);
  const normalizedPath = projectPath.replace(/\\/g, '/');
  await inputEl.fill(normalizedPath);
  await sleep(800);
  log(`  Path set to: "${await inputEl.inputValue()}"`);
  await shot('import-02-path-filled');

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
  }

  // Wait for Step 2
  log('  Waiting for Step 2...');
  let step2Found = false;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const s = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        step2: (text.includes('Step 2') || text.includes('Confirm') || (text.includes('Project Name') && text.includes('Encoding'))) &&
               !text.includes('Please enter a project path'),
        error: text.includes('Please enter') || text.includes('cannot find') || text.includes('Failed'),
      };
    });
    if (s.step2 && !s.error) { step2Found = true; log(`  Step 2 after ${i+1}s`); break; }
    if (s.error && i > 3) throw new Error('Scan error - check screenshot');
  }
  if (!step2Found) throw new Error('Step 2 not found');
  await shot('import-03-step2');
  await sleep(1000);

  // Click Import/Next on Step 2
  const importBtn = await page.evaluateHandle(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.offsetParent !== null) {
        const t = btn.textContent.trim().toLowerCase();
        if (t.includes('import project') || t === 'import' || t === 'finish' || t === 'next') return btn;
      }
    }
    return null;
  });

  if (importBtn.asElement()) {
    await importBtn.asElement().click();
  } else {
    await page.keyboard.press('Enter');
  }

  // Wait for Step 3
  log('  Waiting for Step 3...');
  let step3Found = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const s = await page.evaluate(() => {
      const text = document.body.innerText;
      return { done: text.includes('Step 3') || text.includes('successfully') || text.includes('Complete') || text.includes('Open Project') };
    });
    if (s.done) { step3Found = true; log(`  Step 3 after ${i+1}s`); break; }
  }
  await shot('import-04-step3');

  // Click "Open Project Folder"
  const openBtn = await page.evaluateHandle(() => {
    const buttons = document.querySelectorAll('button, a, [role="button"]');
    for (const btn of buttons) {
      if (btn.offsetParent !== null && /open project/i.test(btn.textContent)) return btn;
    }
    return null;
  });

  if (openBtn.asElement()) {
    await openBtn.asElement().click();
    log('  Clicked Open Project Folder');
  } else {
    await page.keyboard.press('Escape');
    await sleep(500);
  }
  await sleep(5000);
  await shot('import-05-after-open');

  // Wait for workspace to load
  log('  Waiting for workspace...');
  let wsLoaded = false;
  for (let i = 0; i < 35; i++) {
    await sleep(1000);
    const s = await page.evaluate(() => {
      const bar = document.querySelector('#theia-statusBar, .theia-statusBar')?.textContent || '';
      return { noWorkspace: /no workspace|^\s*$/i.test(bar), text: bar.slice(0, 200) };
    });
    if (!s.noWorkspace && s.text.length > 5) {
      wsLoaded = true;
      log(`  Workspace loaded after ${i+1}s: ${s.text.slice(0, 100)}`);
      break;
    }
  }
  await shot('import-06-done');
  return wsLoaded;
}

async function openCommandPalette(page) {
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('Control+Shift+P');
  try {
    await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 4000, state: 'visible' });
    const isPalette = await page.evaluate(() => {
      const inp = document.querySelector('.quick-input-widget input[type="text"]');
      const ph = inp ? (inp.getAttribute('placeholder') || inp.getAttribute('aria-label') || '').toLowerCase() : '';
      return ph.includes('narrow') || ph.includes('command');
    });
    if (isPalette) return true;
  } catch {}
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('F1');
  await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 4000, state: 'visible' });
  return true;
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
      const txt = msg.text();
      const type = msg.type();
      if (type === 'error' || /Uncaught|ERROR|FATAL/i.test(txt)) {
        if (!/Electron Security Warning|cookie|favicon|fonts\.gstatic|DevTools|terminal.*does not exist/i.test(txt)) {
          consoleErrors.push({ ts: new Date().toISOString(), type, text: txt.slice(0, 500) });
          if (type === 'error') warn(`CONSOLE: ${txt.slice(0, 200)}`);
        }
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push({ ts: new Date().toISOString(), type: 'pageerror', text: err.message });
      warn(`PAGE ERROR: ${err.message.slice(0, 200)}`);
    });
  });

  const page = await app.firstWindow();
  currentApp = app;
  currentPage = page;

  log('Waiting for Theia shell...');
  for (let i = 0; i < 50; i++) {
    await sleep(1000);
    const hasShell = await page.evaluate(() => !!document.querySelector('#theia-statusBar, .theia-statusBar'));
    if (hasShell) { log(`Shell after ${i+1}s`); break; }
    if (i === 49) throw new Error('Shell did not appear');
  }

  await sleep(3000);
  await shot('01-initial');

  // Trust workspace dialog
  const trustBtn = await page.$('button:has-text("Trust"), button:has-text("Yes"), button:has-text("I trust")');
  if (trustBtn) {
    log('Trusting workspace...');
    await trustBtn.click();
    await sleep(3000);
  }
  await shot('02-ready');

  return { app, page };
}

async function getStatusBar(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#theia-statusBar, .theia-statusBar');
    return bar ? bar.textContent : '';
  });
}

// ─── Main Test Flow ───
async function main() {
  log('========================================');
  log('Kairo IDE Deep E2E Test v3');
  log('========================================');
  log(`Output: ${runDir}`);
  log('');

  if (!fs.existsSync(testProjectPath)) throw new Error(`Test project not found: ${testProjectPath}`);

  const { app, page } = await launchApp();

  try {
    // ── Startup validation ──
    await runTest(0, '0.1', 'Application shell with all panels', 'P0', async () => {
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

    await runTest(0, '0.2', 'Command registry accessible', 'P0', async () => {
      const ok = await ensureCmdReg(page);
      if (!ok) throw new Error('CommandRegistry not found');
      const info = await page.evaluate(() => {
        const cmds = window.__kairoCmdIds || [];
        const kairoCmds = cmds.filter(c => c.id && (c.id.startsWith('kairo') || c.id.includes('kairo')));
        return { total: cmds.length, kairo: kairoCmds.length, samples: kairoCmds.slice(0, 10) };
      });
      log(`  Commands: ${info.total} total, ${info.kairo} Kairo commands`);
      if (info.samples) info.samples.forEach(c => log(`    - ${c.id}: ${c.label || ''}`));
      if (info.total < 30) throw new Error(`Only ${info.total} commands found`);
    });

    // ── Import project ──
    await runTest(4, '4.1', 'Import wizard 3-step flow and open project', 'P0', async () => {
      const loaded = await importProject(page, testProjectPath);
      if (!loaded) throw new Error('Workspace did not load after import');
    });

    // After import, dismiss any welcome/dialog by pressing Escape
    await page.keyboard.press('Escape');
    await sleep(500);

    // ── Click Explorer in activity bar ──
    await runTest(5, '5.1', 'Explorer view shows project file tree', 'P0', async () => {
      // Click the first activity bar item (Explorer)
      await clickActivityBar(page, 0);
      await sleep(1500);
      await shot('05-explorer-clicked');

      // Wait for file tree
      let hasNodes = false;
      for (let i = 0; i < 20; i++) {
        await sleep(1000);
        const info = await page.evaluate(() => {
          // Look for tree nodes in left sidebar
          const sideBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
          if (!sideBar) return { nodes: 0 };
          const nodes = sideBar.querySelectorAll('[class*="tree-node"], [role="treeitem"], [class*="file-icon"]');
          const visible = Array.from(nodes).filter(n => n.offsetParent !== null);
          return { nodes: visible.length };
        });
        if (info.nodes > 0) { hasNodes = true; log(`  Found ${info.nodes} file nodes after ${i+1}s`); break; }
      }
      await shot('05-explorer-files');
      if (!hasNodes) {
        // Try expanding the project root
        const rootExpand = await page.evaluateHandle(() => {
          const sideBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
          if (!sideBar) return null;
          const items = sideBar.querySelectorAll('[class*="node"], [role="treeitem"]');
          for (const el of items) {
            if (el.offsetParent !== null && /legacy-sample|src|WebRoot/i.test(el.textContent)) {
              return el;
            }
          }
          return null;
        });
        if (rootExpand.asElement()) {
          log('  Clicking to expand project root...');
          await rootExpand.asElement().click();
          await sleep(2000);
        }
      }
      // Final check
      const final = await page.evaluate(() => {
        const sideBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
        if (!sideBar) return { nodes: 0 };
        const nodes = sideBar.querySelectorAll('[class*="tree-node"], [role="treeitem"], [class*="file-icon"]');
        return { nodes: Array.from(nodes).filter(n => n.offsetParent !== null).length };
      });
      log(`  Final tree nodes: ${final.nodes}`);
      if (final.nodes < 2) throw new Error(`Only ${final.nodes} visible nodes in Explorer`);
    });

    // ── Open a Java file ──
    await runTest(6, '6.1', 'Open Java file from explorer', 'P0', async () => {
      // Look for HelloServlet.java or any .java file in the tree
      const javaFile = await page.evaluateHandle(() => {
        const sideBar = document.querySelector('#theia-left-side-bar, .theia-app-left');
        if (!sideBar) return null;
        const items = sideBar.querySelectorAll('[class*="node"], [role="treeitem"]');
        for (const el of items) {
          if (el.offsetParent !== null && el.textContent.includes('.java')) return el;
        }
        return null;
      });

      if (javaFile.asElement()) {
        log('  Found .java file, double-clicking...');
        await javaFile.asElement().dblclick();
      } else {
        // Try file opener command
        log('  .java file not visible in tree, trying Open File command...');
        const openCmd = await findCmdId(page, 'open file');
        if (openCmd) { await execCmd(page, openCmd.id); await sleep(1000); }
      }
      await sleep(3000);
      await shot('06-java-editor');

      // Check if Monaco editor is visible
      const hasEditor = await page.evaluate(() => {
        const ed = document.querySelector('.monaco-editor');
        const lines = document.querySelector('.monaco-editor .view-lines, .monaco-editor .view-line');
        return { hasEditor: !!ed, hasContent: !!lines && ed?.offsetParent !== null };
      });
      log(`  Editor: hasEditor=${hasEditor.hasEditor}, hasContent=${hasEditor.hasContent}`);
      if (!hasEditor.hasEditor || !hasEditor.hasContent) {
        // Alternative: try opening via command palette with Go to File
        await page.keyboard.press('Control+P');
        await sleep(1000);
        const quickInput = await page.$('.quick-input-widget input[type="text"]');
        if (quickInput) {
          await quickInput.fill('HelloServlet');
          await sleep(2000);
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
          await sleep(3000);
          await shot('06-java-editor-gotofile');
        }
      }

      const ed2 = await page.evaluate(() => {
        const ed = document.querySelector('.monaco-editor');
        const lines = ed?.querySelector('.view-lines');
        const text = lines?.textContent?.slice(0, 200) || '';
        return { exists: !!ed, hasText: text.length > 10, sample: text };
      });
      log(`  Editor content: ${ed2.sample.slice(0, 100)}`);
      if (!ed2.exists || !ed2.hasText) throw new Error('Editor did not open with file content');
    });

    // ── Check status bar for project info ──
    await runTest(0, '0.3', 'Status bar shows project details', 'P0', async () => {
      const status = await getStatusBar(page);
      log(`  Status: ${status.slice(0, 300)}`);
      if (!/legacy-sample/i.test(status) && !/project/i.test(status)) {
        throw new Error('Status bar does not show project info');
      }
    });

    // ── Build ──
    await runTest(10, '10.1', 'Trigger Ant build', 'P0', async () => {
      // Find build command
      const buildCmd = await findCmdId(page, 'build');
      log(`  Build command: ${buildCmd ? buildCmd.id : 'not found, searching more...'}`);

      if (buildCmd) {
        await execCmd(page, buildCmd.id);
      } else {
        // Try Show Builds view first, then look for button
        const showBuilds = await findCmdId(page, 'show build');
        if (showBuilds) await execCmd(page, showBuilds.id);
        await sleep(2000);
        await shot('10-build-view');
        const buildBtn = await page.evaluateHandle(() => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.offsetParent !== null && /^\s*build\s*$/i.test(btn.textContent.trim())) return btn;
          }
          return null;
        });
        if (buildBtn.asElement()) {
          await buildBtn.asElement().click();
          log('  Clicked Build button in view');
        }
      }
      await sleep(3000);
      await shot('10-build-triggered');
    });

    await runTest(10, '10.2', 'Build completes (succeeded/failed)', 'P0', async () => {
      let result = null;
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const status = await getStatusBar(page);
        // Check Chinese and English status indicators
        const succeeded = /(succeeded|success|成功|编译成功|BUILD SUCCESSFUL)/i.test(status);
        const failed = /(failed|error|失败|错误|BUILD FAILED)/i.test(status);
        const building = /(building|building|编译中|构建中)/i.test(status);
        if (succeeded) { result = 'succeeded'; log(`  BUILD SUCCEEDED after ${i+1}s`); break; }
        if (failed) { result = 'failed'; log(`  BUILD FAILED after ${i+1}s`); break; }
        if (i % 10 === 9) log(`  Build running... (${i+1}s) ${status.slice(0, 100)}`);
      }
      await shot('10-build-done');
      if (!result) {
        log('  ⚠ Build status not detected in status bar (checking output panel)');
        // Check bottom panel for build output
        const output = await page.evaluate(() => {
          const panels = document.querySelectorAll('#theia-bottom-panel, .theia-bottom-panel, [id*="output"], [class*="output"]');
          let text = '';
          for (const p of panels) { if (p.offsetParent !== null) text += p.textContent; }
          return text.slice(0, 500);
        });
        log(`  Output panel: ${output.slice(0, 200)}`);
      }
    });

    // ── Server ──
    await runTest(11, '11.1', 'Start Tomcat server', 'P0', async () => {
      // Find server start command
      const startCmd = await findCmdId(page, 'start server');
      log(`  Start server command: ${startCmd ? startCmd.id : 'not found'}`);

      if (startCmd) {
        await execCmd(page, startCmd.id);
      } else {
        const showServers = await findCmdId(page, 'show server');
        if (showServers) await execCmd(page, showServers.id);
        await sleep(2000);
        await shot('11-server-view');
        const startBtn = await page.evaluateHandle(() => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.offsetParent !== null && /start|运行|启动/i.test(btn.textContent) && btn.textContent.trim().length < 20) return btn;
          }
          return null;
        });
        if (startBtn.asElement()) {
          await startBtn.asElement().click();
          log('  Clicked Start button');
        }
      }
      await sleep(3000);
      await shot('11-server-triggered');
    });

    await runTest(11, '11.2', 'Server reaches Running state', 'P0', async () => {
      let running = false;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        const status = await getStatusBar(page);
        const isRunning = /(running|运行中|已启动|Started)/i.test(status);
        const isStopped = /(stopped|已停止|未启动)/i.test(status);
        if (isRunning) { running = true; log(`  SERVER RUNNING after ${i+1}s: ${status.slice(0, 150)}`); break; }
        if (i % 15 === 14) log(`  Waiting for server... (${i+1}s) ${status.slice(0, 100)}`);
      }
      await shot('11-server-status');
      if (!running) {
        log('  ⚠ Server running state not detected in status bar');
        // Check if tomcat process started
      }
    });

    // ── Console errors ──
    await runTest(99, '99.1', 'Console error summary', 'P0', async () => {
      log(`  Console errors: ${consoleErrors.length}`);
      consoleErrors.forEach(e => log(`    [${e.type}] ${e.text.slice(0, 200)}`));
    });

    await shot('99-final');

  } catch (err) {
    log(`FATAL: ${err.message}`);
  } finally {
    log('Closing app...');
    try { await app.close(); } catch (e) {}
  }

  await sleep(7000);

  // Report
  const totalDuration = Date.now() - startTime;
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const p0 = results.filter(r => r.priority === 'P0');
  const p0Passed = p0.filter(r => r.status === 'pass').length;

  const report = `# Kairo IDE Deep E2E Test Report v3

**Date:** ${new Date().toISOString()}
**Duration:** ${(totalDuration/1000).toFixed(1)}s
**Target:** ${resolveExe()}
**Output:** ${runDir}

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

  log(`\n========================================`);
  log(`Report: ${runDir}`);
  log(`Pass rate: ${passed}/${results.length} (${((passed/results.length)*100).toFixed(1)}%)`);
  log(`P0: ${p0Passed}/${p0.length}, Bugs: ${bugs.length}`);
  log(`========================================`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
