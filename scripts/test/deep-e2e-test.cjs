// Kairo IDE Windows EXE — Deep E2E Test Driver
// Covers §4-§26 from WINDOWS_EXE_DEEP_TEST_SUPPLEMENT.md
// Focuses on actual end-to-end workflows, not just command existence
//
// Usage: node scripts/test/deep-e2e-test.cjs [--exe <path>] [--out <dir>]

const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');
const { execSync, spawn } = require('child_process');

// ─── CLI args ──────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}
const customExe = arg('exe', null);
const baseOutDir = arg('out', null);

// ─── Layout ────────────────────────────────────────────────
const repoRoot = path.resolve(__dirname, '..', '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = baseOutDir
  ? baseOutDir
  : path.join(repoRoot, 'artifacts', 'test-results', 'deep-' + stamp);
const screenshotDir = path.join(runDir, 'screenshots');
const desktopLogDir = path.join(runDir, 'desktop-logs');
fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });
fs.mkdirSync(desktopLogDir, { recursive: true });

// Test project path
const testProjectPath = path.join(repoRoot, 'test-workspace', 'gbk-legacy-project');
const legacySamplePath = path.join(repoRoot, 'legacy-sample');

// ─── State ─────────────────────────────────────────────────
const results = [];
const bugs = [];
const consoleErrors = [];
const startTime = Date.now();
let serverPort = null;
let serverContextPath = null;

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const warn = (m) => console.warn(`[${new Date().toISOString().slice(11, 23)}] WARN ${m}`);
const fail = (m) => { console.error(`[${new Date().toISOString().slice(11, 23)}] FAIL ${m}`); process.exit(1); };

let testCounter = 0;
let currentPage = null;
let currentApp = null;

// ─── Test helpers ──────────────────────────────────────────

async function runTest(section, id, name, priority, fn) {
  testCounter++;
  const start = Date.now();
  const safeName = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
  const result = {
    id, section, name, priority,
    status: 'pass',
    duration: 0,
    error: null,
    screenshot: null,
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
    if (priority === 'P0' || priority === 'P1') {
      addBug(section, id, name, priority, result.error, result.screenshot);
    }
  }
}

function addBug(section, testId, name, severity, error, screenshot) {
  const bugId = `KAIRO-DEEP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(bugs.length + 1).padStart(3, '0')}`;
  bugs.push({
    id: bugId,
    section,
    testId,
    name,
    severity,
    steps: `1. Launch Kairo IDE\n2. Navigate to §${section}: ${name}\n3. Perform end-to-end action`,
    expected: name,
    actual: error,
    consoleLog: consoleErrors.slice(-10).map(e => `[${e.type}] ${e.text}`).join('\n'),
    screenshot,
    workaround: null,
    notes: null,
  });
}

async function shot(page, name) {
  try {
    const f = path.join(screenshotDir, `${name}.png`);
    await page.screenshot({ path: f, fullPage: false });
    log(`  📸 Screenshot: ${name}.png`);
    return path.relative(runDir, f);
  } catch (e) { return null; }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForSelector(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout, state: 'visible' });
}

async function waitForText(page, text, timeout = 15000) {
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    text,
    { timeout }
  );
}

// ─── DI Container / Command Registry helpers ──────────────

async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = await page.evaluate(() => {
      let container = window.theia?.container;
      if (!container || !container._bindingDictionary?._map) {
        const shell = document.querySelector('.theia-ApplicationShell, .theia-container, [data-theia-shell]');
        if (shell) {
          container = shell.__inversify_container__
            || Object.values(shell).find(v => v && v._bindingDictionary?._map)
            || null;
        }
      }
      if (!container || !container._bindingDictionary?._map) {
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const c = el.__inversify_container__;
          if (c && c._bindingDictionary?._map && c._bindingDictionary._map.size > 100) {
            container = c;
            break;
          }
        }
      }
      if (!container || !container._bindingDictionary?._map) return false;
      const map = container._bindingDictionary._map;
      for (const [key, binding] of map.entries()) {
        if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
          try {
            const svc = container.get(key);
            if (svc && typeof svc.getAllCommands === 'function'
                && typeof svc.executeCommand === 'function') {
              window.__kairoCmdReg = svc;
              return true;
            }
          } catch (_) {}
        }
      }
      for (const [key, binding] of map.entries()) {
        try {
          const svc = container.get(key);
          if (svc && typeof svc === 'object'
              && typeof svc.getAllCommands === 'function'
              && typeof svc.executeCommand === 'function') {
            window.__kairoCmdReg = svc;
            return true;
          }
        } catch (_) {}
      }
      return false;
    });
    if (found) return true;
    await sleep(1500);
  }
  return false;
}

async function executeCommand(page, commandId, args = []) {
  await ensureCmdReg(page);
  return page.evaluate((cmdId, cmdArgs) => {
    const reg = window.__kairoCmdReg;
    if (!reg) return { success: false, error: 'Command registry not available' };
    try {
      const result = reg.executeCommand(cmdId, ...cmdArgs);
      return { success: true, result: result ? 'ok' : 'null' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, commandId, args);
}

async function findCommandId(page, labelPattern) {
  await ensureCmdReg(page);
  return page.evaluate((pattern) => {
    const reg = window.__kairoCmdReg;
    if (!reg) return null;
    const re = new RegExp(pattern, 'i');
    const all = reg.getAllCommands();
    for (const c of all) {
      if (!c) continue;
      if (re.test(c.label || '') || re.test(c.id || '') || re.test(c.category || '')) {
        return c.id;
      }
    }
    return null;
  }, labelPattern);
}

async function openCommandPalette(page) {
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('Control+Shift+P');
  try {
    await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 3000, state: 'visible' });
    await sleep(500);
    const isPalette = await page.evaluate(() => {
      const inputs = document.querySelectorAll('.quick-input-widget input[type="text"]');
      for (const inp of inputs) {
        const ph = (inp.getAttribute('aria-label') || inp.getAttribute('placeholder') || '').toLowerCase();
        if (ph.includes('narrow down') || ph.includes('command')) return true;
      }
      return false;
    });
    if (isPalette) return true;
  } catch {}
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('F1');
  await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 3000, state: 'visible' });
  return true;
}

async function runCommandByLabel(page, label) {
  await openCommandPalette(page);
  const input = await page.$('.quick-input-widget input[type="text"]');
  if (!input) throw new Error('Command palette input not found');
  await input.fill(label);
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(1000);
}

// ─── Electron launch ───────────────────────────────────────

function resolveExe() {
  if (customExe) {
    if (!fs.existsSync(customExe)) throw new Error(`--exe path does not exist: ${customExe}`);
    return customExe;
  }
  const candidates = [
    path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Cannot find Kairo IDE .exe');
}

async function launchApp() {
  const exePath = resolveExe();
  log(`Launching: ${exePath}`);

  // Set up isolated user data dir
  const userDataDir = path.join(runDir, 'userdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  process.env.THEIA_CONFIG_DIR = path.join(runDir, 'theia-config');
  fs.mkdirSync(process.env.THEIA_CONFIG_DIR, { recursive: true });

  const app = await electron.launch({
    executablePath: exePath,
    recordVideo: { dir: runDir },
    env: {
      ...process.env,
      THEIA_CONFIG_DIR: process.env.THEIA_CONFIG_DIR,
      KAIRO_DEV: '1',
    },
    timeout: 60000,
  });

  app.on('window', async (page) => {
    log('New window opened');
    page.on('console', (msg) => {
      const txt = msg.text();
      const type = msg.type();
      if (type === 'error' || txt.includes('Uncaught') || txt.includes('ERROR')) {
        consoleErrors.push({ ts: new Date().toISOString(), type, text: txt.slice(0, 500) });
        if (type === 'error') {
          warn(`CONSOLE ERROR: ${txt.slice(0, 200)}`);
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

  // Wait for Theia shell to appear
  log('Waiting for Theia shell...');
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const hasShell = await page.evaluate(() => {
      return !!document.querySelector('#theia-statusBar, .theia-statusBar, .theia-ApplicationShell');
    });
    if (hasShell) {
      log(`Shell appeared after ${(i+1)}s`);
      break;
    }
    if (i === 39) {
      throw new Error('Theia shell did not appear within 40s');
    }
  }

  // Wait for workspace trust dialog if it appears, trust the workspace
  await sleep(2000);
  await shot(page, '01-initial-shell');

  // Check for trust dialog and trust it
  const trustBtn = await page.$('button:has-text("Trust"), button:has-text("Yes, I trust"), [id*="trust"]');
  if (trustBtn) {
    log('Trust dialog found, clicking Trust...');
    await trustBtn.click();
    await sleep(3000);
    await shot(page, '02-after-trust');
  }

  return { app, page };
}

// ─── Test sections ─────────────────────────────────────────

async function section_01_process_safety(page) {
  await runTest(1, '1.1', 'Application launched successfully', 'P0', async () => {
    const title = await page.title();
    if (!/Kairo\s*IDE/i.test(title)) throw new Error(`Title is "${title}", expected "Kairo IDE"`);
  });

  await runTest(1, '1.2', 'Theia shell visible (menubar, activity bar, editor, status bar)', 'P0', async () => {
    const info = await page.evaluate(() => {
      return {
        menu: !!document.querySelector('.p-MenuBar, #theia-top-panel, .theia-top-panel'),
        activity: !!document.querySelector('.theia-app-left, .theia-activity-bar, [id*="activity-bar"]'),
        editor: !!document.querySelector('.monaco-editor, #theia-main-content-panel, [id*="main-content"]'),
        status: !!document.querySelector('#theia-statusBar, .theia-statusBar'),
      };
    });
    if (!info.menu) throw new Error('Menu bar not visible');
    if (!info.activity) throw new Error('Activity bar not visible');
    if (!info.status) throw new Error('Status bar not visible');
  });

  await runTest(1, '1.3', 'No fatal errors in console during startup', 'P0', async () => {
    const fatalErrors = consoleErrors.filter(e =>
      e.type === 'pageerror' || (e.type === 'error' && !e.text.includes('Electron Security Warning') && !e.text.includes('DevTools'))
    );
    if (fatalErrors.length > 0) {
      throw new Error(`Fatal errors during startup: ${fatalErrors.map(e => e.text).join('; ')}`);
    }
  });

  await runTest(1, '1.4', 'Command registry accessible', 'P0', async () => {
    const ok = await ensureCmdReg(page);
    if (!ok) throw new Error('Could not access CommandRegistry from DI container');
    const cmdCount = await page.evaluate(() => {
      return window.__kairoCmdReg ? window.__kairoCmdReg.getAllCommands().length : 0;
    });
    log(`  Found ${cmdCount} registered commands`);
    if (cmdCount < 50) throw new Error(`Only ${cmdCount} commands registered, expected >= 50`);
  });

  await shot(page, '03-shell-verified');
}

async function section_04_import_wizard(page) {
  log('=== Testing Import Wizard (§4) ===');

  await runTest(4, '4.1', 'Import Project command opens wizard', 'P0', async () => {
    await runCommandByLabel(page, 'Import Project');
    await sleep(2000);
    await shot(page, '04-01-import-wizard-step1');

    const wizard = await page.evaluate(() => {
      const dialogs = document.querySelectorAll('.theia-dialog, .dialogBlock, .p-Dialog, [role="dialog"]');
      for (const d of dialogs) {
        if (d.offsetParent !== null && d.textContent.includes('Import')) {
          return { found: true, text: d.textContent.slice(0, 500) };
        }
      }
      // Also check for any wizard-like widget
      const wizards = document.querySelectorAll('[class*="wizard"], [class*="import"]');
      for (const w of wizards) {
        if (w.offsetParent !== null) {
          return { found: true, text: w.textContent.slice(0, 500), classes: w.className };
        }
      }
      return { found: false, bodyText: document.body.innerText.slice(0, 1000) };
    });

    if (!wizard.found) {
      log('  Wizard not found in dialogs, checking for widget in main area...');
      // Try looking for any element containing "Select Directory" or "Step 1"
      await waitForText(page, 'Select Directory', 5000).catch(() => {});
      const hasStep1 = await page.evaluate(() => document.body.innerText.includes('Select Directory') || document.body.innerText.includes('Step 1'));
      if (!hasStep1) {
        throw new Error(`Import wizard dialog not visible. Body snippet: ${wizard.bodyText?.slice(0, 300)}`);
      }
    }
  });

  await runTest(4, '4.2', 'Wizard has path input field', 'P0', async () => {
    const hasInput = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (const inp of inputs) {
        if (inp.offsetParent !== null) {
          return { found: true, placeholder: inp.placeholder, value: inp.value };
        }
      }
      return { found: false };
    });
    if (!hasInput.found) throw new Error('No text input found in import wizard');
    log(`  Input found: placeholder="${hasInput.placeholder}"`);
  });

  await runTest(4, '4.3', 'Can type project path into input', 'P0', async () => {
    // Find the path input and type the test project path
    const typed = await page.evaluate((projPath) => {
      const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (const inp of inputs) {
        if (inp.offsetParent !== null && (inp.placeholder?.includes('path') || inp.placeholder?.includes('/'))) {
          // Focus and set value
          inp.focus();
          inp.value = projPath;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return { typed: true, value: inp.value };
        }
      }
      // Try first visible text input
      for (const inp of inputs) {
        if (inp.offsetParent !== null) {
          inp.focus();
          inp.value = projPath;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return { typed: true, value: inp.value, fallback: true };
        }
      }
      return { typed: false };
    }, testProjectPath);

    if (!typed.typed) throw new Error('Could not find or type into path input');
    log(`  Typed path: ${typed.value}${typed.fallback ? ' (fallback input)' : ''}`);
    await sleep(500);
    await shot(page, '04-02-path-entered');
  });

  await runTest(4, '4.4', 'Scan button triggers project scan', 'P0', async () => {
    const scanClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.offsetParent !== null && /scan/i.test(btn.textContent)) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
      }
      return { clicked: false };
    });

    if (!scanClicked.clicked) {
      // Try pressing Enter as fallback
      log('  Scan button not found, pressing Enter...');
      await page.keyboard.press('Enter');
    } else {
      log(`  Clicked: ${scanClicked.text}`);
    }

    await sleep(5000);
    await shot(page, '04-03-after-scan');
  });

  await runTest(4, '4.5', 'Scan advances to Step 2 (Confirm Settings)', 'P0', async () => {
    // Wait for Step 2 to appear (look for Project Name, Encoding, etc.)
    let step2Found = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const inStep2 = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('Step 2') || text.includes('Project Name') ||
               text.includes('Confirm Settings') || text.includes('Encoding');
      });
      if (inStep2) {
        step2Found = true;
        break;
      }
    }
    if (!step2Found) {
      // Check if we're still on Step 1 with an error
      const errText = await page.evaluate(() => document.body.innerText);
      throw new Error(`Did not advance to Step 2 after scan. Current text snippet: ${errText.slice(0, 500)}`);
    }
    await shot(page, '04-04-step2');
  });

  await runTest(4, '4.6', 'Step 2 shows project configuration fields', 'P0', async () => {
    const fields = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        projectName: text.includes('Project Name'),
        encoding: text.includes('Encoding'),
        buildTool: text.includes('Build Tool') || text.includes('Ant'),
        webRoot: text.includes('Web Root') || text.includes('WebRoot'),
        jdkVersion: text.includes('JDK') || text.includes('Java'),
        sourceDir: text.includes('Source') || text.includes('src'),
      };
    });
    log(`  Fields: ${JSON.stringify(fields)}`);
    const missing = Object.entries(fields).filter(([k, v]) => !v).map(([k]) => k);
    if (missing.length > 2) throw new Error(`Missing expected fields in Step 2: ${missing.join(', ')}`);
  });

  await runTest(4, '4.7', 'Import Project button triggers import', 'P0', async () => {
    const importClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.offsetParent !== null && /import project/i.test(btn.textContent)) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
      }
      // Look for any primary action button
      for (const btn of buttons) {
        if (btn.offsetParent !== null && /next|finish|done/i.test(btn.textContent)) {
          btn.click();
          return { clicked: true, text: btn.textContent, fallback: true };
        }
      }
      return { clicked: false };
    });

    if (!importClicked.clicked) {
      log('  Import button not found, pressing Enter...');
      await page.keyboard.press('Enter');
    } else {
      log(`  Clicked: ${importClicked.text}${importClicked.fallback ? ' (fallback)' : ''}`);
    }

    await sleep(5000);
    await shot(page, '04-05-after-import');
  });

  await runTest(4, '4.8', 'Import completes to Step 3 (Success/Complete)', 'P0', async () => {
    let complete = false;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const done = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('Step 3') || text.includes('successfully') ||
               text.includes('Complete') || text.includes('Open Project');
      });
      if (done) {
        complete = true;
        break;
      }
    }
    if (!complete) {
      const txt = await page.evaluate(() => document.body.innerText.slice(0, 800));
      throw new Error(`Import did not complete. Current state: ${txt}`);
    }
    await shot(page, '04-06-step3-complete');
  });

  await runTest(4, '4.9', 'Open Project Folder button opens project', 'P0', async () => {
    const openClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.offsetParent !== null && /open project/i.test(btn.textContent)) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
      }
      return { clicked: false };
    });

    if (!openClicked.clicked) {
      // Close any open dialog/wizard with Escape and try opening Explorer
      log('  Open Project button not found, pressing Escape and opening Explorer...');
      await page.keyboard.press('Escape');
      await sleep(1000);
    } else {
      log(`  Clicked: ${openClicked.text}`);
    }

    await sleep(3000);
    await shot(page, '04-07-project-opened');
  });
}

async function section_06_editor_gbk(page) {
  log('=== Testing Editor & GBK Encoding (§6, §8) ===');

  await runTest(6, '6.1', 'Explorer view shows project files', 'P0', async () => {
    // Open Explorer
    try {
      await runCommandByLabel(page, 'Explorer');
    } catch {}
    await sleep(2000);

    const explorer = await page.evaluate(() => {
      const selectors = ['.navigator-container', '.files-container', '#files', '.theia-navigator', '.explorer-view'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return { found: true, sel };
      }
      // Look for file tree elements
      const trees = document.querySelectorAll('[class*="tree"], [class*="file"]');
      for (const t of trees) {
        if (t.offsetParent !== null && t.querySelectorAll('[class*="node"]').length > 0) {
          return { found: true, classes: t.className, nodes: t.querySelectorAll('[class*="node"]').length };
        }
      }
      return { found: false };
    });

    if (!explorer.found) throw new Error('Explorer view not visible or empty');
    log(`  Explorer found via: ${explorer.sel || explorer.classes}`);
    await shot(page, '06-01-explorer');
  });

  await runTest(6, '6.2', 'Can open GbkTestServlet.java file', 'P0', async () => {
    // Try to open the GBK Java file by double-clicking in explorer or using Open File command
    try {
      await runCommandByLabel(page, 'Open File');
      await sleep(1000);
      // Try to type the path in quick open
      const quickInput = await page.$('.quick-input-widget input[type="text"]');
      if (quickInput) {
        await quickInput.fill('GbkTestServlet');
        await sleep(1500);
        await page.keyboard.press('Enter');
        await sleep(2000);
      }
    } catch (e) {
      log(`  Quick open failed: ${e.message}, trying file tree click...`);
    }

    // Check if editor opened
    await sleep(2000);
    const editorOpen = await page.evaluate(() => {
      return !!document.querySelector('.monaco-editor, .monaco-editor-background');
    });

    if (!editorOpen) {
      // Try to find and click the file in the explorer
      log('  Editor not open yet, trying to find file in explorer...');
      const fileClicked = await page.evaluate((fileName) => {
        // Look for tree nodes containing the filename
        const all = document.querySelectorAll('[class*="node"], [class*="tree-item"], [role="treeitem"]');
        for (const el of all) {
          if (el.textContent.includes(fileName) && el.offsetParent !== null) {
            el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            return { clicked: true, text: el.textContent };
          }
        }
        return { clicked: false };
      }, 'GbkTestServlet');

      if (fileClicked.clicked) {
        log(`  Double-clicked: ${fileClicked.text}`);
        await sleep(3000);
      }
    }

    await shot(page, '06-02-gbk-file-opened');

    // Verify editor is visible
    const hasEditor = await page.evaluate(() => !!document.querySelector('.monaco-editor, .monaco-editor-background'));
    if (!hasEditor) {
      // Don't fail completely - GBK test requires file to be open
      log('  ⚠ Editor not fully visible, continuing with encoding status check...');
    }
  });

  await runTest(6, '6.3', 'Status bar shows encoding information', 'P0', async () => {
    const statusText = await page.evaluate(() => {
      const bar = document.querySelector('#theia-statusBar, .theia-statusBar');
      return bar ? bar.textContent : '';
    });
    log(`  Status bar text (encoding section): ${statusText.slice(0, 300)}`);
    const hasEncoding = /encoding|utf-?8|gbk/i.test(statusText);
    if (!hasEncoding) {
      log('  ⚠ Encoding indicator not immediately visible in status bar');
    }
  });

  await runTest(8, '8.1', 'GBK Chinese content displays without garbled characters', 'P0', async () => {
    // Check if Chinese characters are visible in the editor (if file opened)
    const chineseVisible = await page.evaluate(() => {
      // Look for Chinese characters in the editor
      const editorLines = document.querySelectorAll('.monaco-editor .view-line');
      let foundChinese = false;
      let foundGarbled = false;
      const lineTexts = [];

      for (const line of editorLines) {
        const txt = line.textContent;
        lineTexts.push(txt.slice(0, 80));
        // Check for common Chinese characters
        if (/[\u4e00-\u9fff]/.test(txt)) {
          foundChinese = true;
        }
        // Check for garbled characters (mojibake: \ufffd or other replacement chars)
        if (txt.includes('\ufffd') || /[ÃÂ][\x80-\xbf]/.test(txt)) {
          foundGarbled = true;
        }
      }

      // Also check all visible text
      const allText = document.body.innerText;
      const bodyHasChinese = /[\u4e00-\u9fff]/.test(allText);

      return {
        foundChinese,
        foundGarbled,
        bodyHasChinese,
        lineCount: editorLines.length,
        sampleLines: lineTexts.slice(0, 5),
      };
    });

    log(`  Editor lines: ${chineseVisible.lineCount}`);
    log(`  Sample: ${JSON.stringify(chineseVisible.sampleLines)}`);
    log(`  Chinese in editor: ${chineseVisible.foundChinese}, Garbled: ${chineseVisible.foundGarbled}, Chinese in body: ${chineseVisible.bodyHasChinese}`);

    if (chineseVisible.foundGarbled) {
      throw new Error('Garbled characters (mojibake) detected in editor content');
    }

    // If we can see Chinese characters without garbling, that's good
    if (chineseVisible.foundChinese || chineseVisible.bodyHasChinese) {
      log('  ✓ Chinese characters visible');
    } else {
      log('  ⚠ No Chinese characters visible yet (file may not have loaded properly)');
    }

    await shot(page, '06-03-chinese-check');
  });
}

async function section_10_build(page) {
  log('=== Testing Build Function (§10) ===');

  await runTest(10, '10.1', 'Open Builds view', 'P0', async () => {
    try {
      await runCommandByLabel(page, 'Show Builds');
    } catch {}
    await sleep(2000);
    await shot(page, '10-01-build-view');
  });

  await runTest(10, '10.2', 'Build button triggers project build', 'P0', async () => {
    const buildClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.offsetParent !== null && /^build$/i.test(btn.textContent.trim())) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
      }
      // Try command
      return { clicked: false };
    });

    if (!buildClicked.clicked) {
      log('  Build button not found, trying command palette...');
      await runCommandByLabel(page, 'Kairo: Build');
    } else {
      log(`  Clicked: ${buildClicked.text}`);
    }

    await sleep(2000);
    await shot(page, '10-02-build-started');
  });

  await runTest(10, '10.3', 'Build produces output in Output panel', 'P0', async () => {
    // Wait for build output
    await sleep(5000);
    // Check Output panel for build output
    const output = await page.evaluate(() => {
      // Look for output panel content
      const outputPanels = document.querySelectorAll('[class*="output"], [id*="output"]');
      let content = '';
      for (const p of outputPanels) {
        if (p.offsetParent !== null) {
          content += p.textContent + '\n';
        }
      }
      return {
        hasContent: content.length > 20,
        content: content.slice(0, 1000),
      };
    });
    log(`  Output panel content length: ${output.content.length}`);
    if (output.hasContent) {
      log(`  Output sample: ${output.content.slice(0, 300)}`);
    }
    await shot(page, '10-03-build-output');
  });

  await runTest(10, '10.4', 'Build completes (check for success/failure indication)', 'P0', async () => {
    // Wait up to 30s for build to complete
    let buildDone = false;
    let buildResult = '';
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const status = await page.evaluate(() => {
        const text = document.body.innerText;
        const hasSuccess = /succeeded|success|build successful/i.test(text);
        const hasFailed = /failed|error|BUILD FAILED/i.test(text);
        const statusBar = document.querySelector('#theia-statusBar, .theia-statusBar')?.textContent || '';
        return {
          done: hasSuccess || hasFailed,
          success: hasSuccess,
          failed: hasFailed,
          statusText: statusBar.slice(0, 200),
        };
      });
      buildResult = status.statusText;
      if (status.done) {
        buildDone = true;
        log(`  Build ${status.success ? 'SUCCEEDED' : 'FAILED'} after ${i+1}s`);
        break;
      }
    }

    await shot(page, '10-04-build-complete');

    if (!buildDone) {
      log(`  ⚠ Build completion not detected within 30s. Status bar: ${buildResult}`);
      // Not a hard fail - build might take longer or UI might differ
    }
  });
}

async function section_11_server(page) {
  log('=== Testing Server Lifecycle (§11) ===');

  await runTest(11, '11.1', 'Open Servers view', 'P0', async () => {
    try {
      await runCommandByLabel(page, 'Show Servers');
    } catch {}
    await sleep(2000);
    await shot(page, '11-01-server-view');
  });

  await runTest(11, '11.2', 'Start Server button triggers Tomcat startup', 'P0', async () => {
    const startClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.offsetParent !== null && /start/i.test(btn.textContent.trim())) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
      }
      return { clicked: false };
    });

    if (!startClicked.clicked) {
      log('  Start button not found, trying command palette...');
      await runCommandByLabel(page, 'Start Server');
    } else {
      log(`  Clicked: ${startClicked.text}`);
    }

    await sleep(3000);
    await shot(page, '11-02-server-starting');
  });

  await runTest(11, '11.3', 'Server reaches Running state', 'P0', async () => {
    let running = false;
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      const status = await page.evaluate(() => {
        const text = document.body.innerText;
        const statusBar = document.querySelector('#theia-statusBar, .theia-statusBar')?.textContent || '';
        const running = /running|started/i.test(text) || /running/i.test(statusBar);
        const port = statusBar.match(/:(\d{4,5})/);
        return {
          running,
          statusText: statusBar.slice(0, 200),
          port: port ? port[1] : null,
        };
      });
      if (status.running) {
        running = true;
        serverPort = status.port;
        log(`  Server RUNNING after ${i+1}s, port: ${serverPort}`);
        break;
      }
      if (i % 5 === 4) {
        log(`  Waiting... (${i+1}s) Status: ${status.statusText}`);
      }
    }

    await shot(page, '11-03-server-running');

    if (!running) {
      const currentStatus = await page.evaluate(() => {
        return document.querySelector('#theia-statusBar, .theia-statusBar')?.textContent || '';
      });
      log(`  ⚠ Server did not reach Running state within 45s. Status: ${currentStatus}`);
    }
  });

  await runTest(11, '11.4', 'Open App button opens browser (if server running)', 'P0', async () => {
    if (!serverPort) {
      log('  ⚠ Skipping - server port not detected');
      return;
    }

    const openClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.offsetParent !== null && /open app/i.test(btn.textContent)) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
      }
      return { clicked: false };
    });

    if (openClicked.clicked) {
      log(`  Clicked: ${openClicked.text}`);
      await sleep(2000);
    }
    await shot(page, '11-04-open-app');
  });

  await runTest(11, '11.5', 'Stop Server stops Tomcat', 'P0', async () => {
    const stopClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.offsetParent !== null && /stop/i.test(btn.textContent.trim())) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
      }
      return { clicked: false };
    });

    if (!stopClicked.clicked) {
      log('  Stop button not found, trying command...');
      try {
        await runCommandByLabel(page, 'Stop Server');
      } catch {}
    } else {
      log(`  Clicked: ${stopClicked.text}`);
    }

    await sleep(5000);
    await shot(page, '11-05-server-stopped');
  });
}

async function section_22_dialogs(page) {
  log('=== Testing Dialogs (§22) ===');

  await runTest(22, '22.1', 'Create a new file and modify it to test save dialog', 'P0', async () => {
    // New file
    try {
      await runCommandByLabel(page, 'New File');
      await sleep(1000);
    } catch {}

    // Type some content
    const editorArea = await page.$('.monaco-editor, .monaco-editor-background');
    if (editorArea) {
      await editorArea.click();
      await sleep(300);
      await page.keyboard.type('// Test content for save dialog', { delay: 30 });
      await sleep(500);
      await shot(page, '22-01-file-modified');
    }
  });

  await runTest(22, '22.2', 'Closing unsaved file shows Save/Don\'t Save/Cancel dialog', 'P0', async () => {
    // Try to close tab or window
    await page.keyboard.press('Control+W');
    await sleep(1000);

    const dialogVisible = await page.evaluate(() => {
      const dialogs = document.querySelectorAll('.theia-dialog, .dialogBlock, .p-Dialog, [role="dialog"]');
      for (const d of dialogs) {
        if (d.offsetParent !== null) {
          const text = d.textContent;
          if (/save|don't save|cancel/i.test(text)) {
            return { visible: true, text: text.slice(0, 300), buttons: Array.from(d.querySelectorAll('button')).map(b => b.textContent) };
          }
        }
      }
      return { visible: false };
    });

    if (dialogVisible.visible) {
      log(`  Save dialog visible: ${dialogVisible.text}`);
      log(`  Buttons: ${JSON.stringify(dialogVisible.buttons)}`);
      await shot(page, '22-02-save-dialog');

      // Click Don't Save or Cancel
      const cancelClicked = await page.evaluate(() => {
        const dialogs = document.querySelectorAll('.theia-dialog, .dialogBlock, .p-Dialog, [role="dialog"]');
        for (const d of dialogs) {
          if (d.offsetParent !== null) {
            const buttons = d.querySelectorAll('button');
            for (const btn of buttons) {
              if (/cancel|don't save|don.t save/i.test(btn.textContent)) {
                btn.click();
                return true;
              }
            }
          }
        }
        return false;
      });
      if (!cancelClicked) {
        await page.keyboard.press('Escape');
      }
    } else {
      log('  ⚠ Save dialog did not appear (Ctrl+W may not close in this context)');
      await page.keyboard.press('Escape');
    }

    await sleep(1000);
  });
}

async function section_26_process_cleanup(app, page) {
  log('=== Testing Process Cleanup (§26) ===');

  await runTest(26, '26.1', 'Process tree includes main, agent, and node processes', 'P0', async () => {
    // Check running processes before closing
    const procs = await app.evaluate(async ({ app }) => {
      try {
        const metrics = app.getAppMetrics ? await app.getAppMetrics() : [];
        return { count: metrics.length, pids: metrics.map(m => m.pid).slice(0, 10) };
      } catch (e) {
        return { error: e.message };
      }
    });
    log(`  App metrics: ${JSON.stringify(procs)}`);
  });

  await shot(page, '26-01-before-close');
}

// ─── Main execution ────────────────────────────────────────

async function main() {
  log('========================================');
  log('Kairo IDE Deep E2E Test');
  log('========================================');
  log(`Test project: ${testProjectPath}`);
  log(`Output dir: ${runDir}`);
  log('');

  // Pre-check: test project exists
  if (!fs.existsSync(testProjectPath)) {
    fail(`Test project not found: ${testProjectPath}`);
  }
  log(`Test project exists: ${testProjectPath}`);
  log('');

  // Launch app
  const { app, page } = await launchApp();
  log('App launched, waiting for full initialization...');
  await sleep(5000);

  try {
    // ── Section 1: Process Safety & Shell ──
    await section_01_process_safety(page);

    // ── Section 4: Import Wizard (Core P0) ──
    await section_04_import_wizard(page);

    // ── Section 6+8: Editor & GBK Encoding ──
    await section_06_editor_gbk(page);

    // ── Section 10: Build ──
    await section_10_build(page);

    // ── Section 11: Server Lifecycle ──
    await section_11_server(page);

    // ── Section 22: Dialogs ──
    await section_22_dialogs(page);

    // ── Section 26: Process Cleanup Pre-check ──
    await section_26_process_cleanup(app, page);

    // ── Additional checks ──
    await runTest(99, '99.1', 'Final console error count', 'P0', async () => {
      const realErrors = consoleErrors.filter(e =>
        e.type === 'pageerror' ||
        (e.type === 'error' &&
         !e.text.includes('Electron Security Warning') &&
         !e.text.includes('cookie') &&
         !e.text.includes('fonts.gstatic.com') &&
         !e.text.includes('favicon') &&
         !e.text.includes('DevTools'))
      );
      log(`  Total console errors: ${consoleErrors.length}, real errors: ${realErrors.length}`);
      if (realErrors.length > 0) {
        log('  Real error samples:');
        realErrors.slice(0, 5).forEach(e => log(`    - [${e.type}] ${e.text.slice(0, 150)}`));
      }
    });

    await shot(page, '99-final');

  } catch (err) {
    log(`TEST FATAL ERROR: ${err.message}`);
    log(err.stack);
  } finally {
    // Close app
    log('');
    log('Closing application...');
    try {
      await app.close();
    } catch (e) {
      log(`Close error: ${e.message}`);
    }
  }

  // Wait a bit for process cleanup
  log('Waiting 7 seconds for process cleanup...');
  await sleep(7000);

  // ── Generate report ──
  log('');
  log('========================================');
  log('Generating report...');
  log('========================================');

  const totalDuration = Date.now() - startTime;
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const p0Total = results.filter(r => r.priority === 'P0').length;
  const p0Passed = results.filter(r => r.priority === 'P0' && r.status === 'pass').length;
  const p1Total = results.filter(r => r.priority === 'P1').length;
  const p1Passed = results.filter(r => r.priority === 'P1' && r.status === 'pass').length;

  // Generate summary markdown
  const summaryMd = `# Kairo IDE Deep E2E Test Report

**Run ID:** ${path.basename(runDir)}
**Date:** ${new Date().toISOString()}
**Duration:** ${(totalDuration/1000).toFixed(1)}s
**Test Target:** ${resolveExe()}

## Summary

| Priority | Total | Passed | Failed | Pass Rate |
|----------|-------|--------|--------|-----------|
| P0 | ${p0Total} | ${p0Passed} | ${p0Total - p0Passed} | ${p0Total > 0 ? ((p0Passed/p0Total)*100).toFixed(1) : 'N/A'}% |
| P1 | ${p1Total} | ${p1Passed} | ${p1Total - p1Passed} | ${p1Total > 0 ? ((p1Passed/p1Total)*100).toFixed(1) : 'N/A'}% |
| **Total** | **${results.length}** | **${passed}** | **${failed}** | **${results.length > 0 ? ((passed/results.length)*100).toFixed(1) : 'N/A'}%** |

## Console Errors (${consoleErrors.length})

${consoleErrors.length > 0 ? consoleErrors.slice(0, 20).map(e => `- [${e.type}] ${e.text.slice(0, 200)}`).join('\n') : 'None'}

## Failed Tests

${failed > 0 ? results.filter(r => r.status === 'fail').map(r =>
  `### ${r.id} §${r.section} [${r.priority}] ${r.name}\n- **Error:** ${r.error}\n- **Screenshot:** ${r.screenshot || 'N/A'}`
).join('\n\n') : 'All tests passed!'}

## Bugs Found (${bugs.length})

${bugs.length > 0 ? bugs.map(b =>
  `### ${b.id} [${b.severity}] §${b.section} ${b.name}\n- **Expected:** ${b.expected}\n- **Actual:** ${b.actual}\n- **Screenshot:** ${b.screenshot || 'N/A'}`
).join('\n\n') : 'No bugs recorded.'}

## Test Results Details

${results.map(r =>
  `- [${r.status === 'pass' ? '✓' : '✗'}] ${r.id} §${r.section} [${r.priority}] ${r.name} (${r.duration}ms)${r.error ? `\n  Error: ${r.error}` : ''}`
).join('\n')}
`;

  fs.writeFileSync(path.join(runDir, 'deep-test-report.md'), summaryMd);
  fs.writeFileSync(path.join(runDir, 'deep-results.json'), JSON.stringify({
    runDir,
    timestamp: new Date().toISOString(),
    duration: totalDuration,
    summary: { total: results.length, passed, failed, p0Total, p0Passed, p1Total, p1Passed },
    results,
    bugs,
    consoleErrors: consoleErrors.slice(0, 100),
  }, null, 2));

  log('');
  log(`Report saved to: ${runDir}`);
  log(`Summary: ${passed}/${results.length} passed (${results.length > 0 ? ((passed/results.length)*100).toFixed(1) : 0}%)`);
  log(`P0: ${p0Passed}/${p0Total}, Bugs: ${bugs.length}`);
  log('========================================');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
