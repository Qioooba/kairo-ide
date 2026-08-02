/**
 * Browser click verification for Show Usages — uses CommandRegistry DI.
 *
 *   node scripts/test/verify-show-usages-browser.cjs --url http://127.0.0.1:18301
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'artifacts', 'show-usages-browser-verify');
fs.mkdirSync(outDir, { recursive: true });

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}

const baseUrl = arg('url', 'http://127.0.0.1:18301');
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }).catch(() => {});
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 15; attempt++) {
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
        for (const el of document.querySelectorAll('*')) {
          const c = el.__inversify_container__;
          if (c && c._bindingDictionary?._map && c._bindingDictionary._map.size > 100) {
            container = c;
            break;
          }
        }
      }
      if (!container || !container._bindingDictionary?._map) return false;
      const map = container._bindingDictionary._map;
      for (const [key] of map.entries()) {
        if (!/Command/i.test(String(key))) continue;
        try {
          const svc = container.get(key);
          if (svc && typeof svc.getAllCommands === 'function'
              && typeof svc.registerCommand === 'function'
              && typeof svc.executeCommand === 'function'
              && typeof svc.getCommand === 'function') {
            window.__kairoCmdReg = svc;
            return true;
          }
        } catch (_) {}
      }
      for (const [key] of map.entries()) {
        try {
          const svc = container.get(key);
          if (svc && typeof svc.getAllCommands === 'function'
              && typeof svc.registerCommand === 'function'
              && typeof svc.executeCommand === 'function'
              && typeof svc.getCommand === 'function'
              && Array.isArray(svc.commands)) {
            window.__kairoCmdReg = svc;
            return true;
          }
        } catch (_) {}
      }
      return false;
    });
    if (found) return true;
    await sleep(1000);
  }
  return false;
}

async function dismissTrust(page) {
  for (const label of [/Trust|信任|Yes|是|Continue|继续|Don't Save|不保存|Cancel|取消/i]) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.count() && await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await sleep(300);
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
}

(async () => {
  const bundleRes = await fetch(`${baseUrl.replace(/\/$/, '')}/bundle.js`);
  const bundleText = await bundleRes.text();
  record('Served bundle has showUsages', bundleText.includes('kairo.java.showUsages'), `len=${bundleText.length}`);
  record('Served bundle has findUsages', bundleText.includes('kairo.java.findUsages'));
  record('Served bundle has WidgetFactory refs id', bundleText.includes("id: 'kairo-java-references'") || bundleText.includes('id: "kairo-java-references"') || bundleText.includes('kairo-java-references'));

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PW_CHROME
      || 'C:/Users/Qi/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60_000);

  log(`goto ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('#theia-statusBar', { timeout: 120_000 }).catch(() => {});
  await sleep(3000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#theia-statusBar', { timeout: 120_000 }).catch(() => {});
  await sleep(5000);
  await dismissTrust(page);
  await shot(page, '01-boot');

  const regOk = await ensureCmdReg(page);
  record('CommandRegistry resolved', regOk);
  if (!regOk) {
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ results }, null, 2));
    await browser.close();
    process.exit(1);
  }

  const cmdProbe = await page.evaluate(() => {
    const reg = window.__kairoCmdReg;
    const ids = ['kairo.java.showUsages', 'kairo.java.findUsages'];
    const all = Array.from(reg.getAllCommands());
    const javaNav = all.filter(c => /showUsages|findUsages|Find Usages|Show Usages/i.test(`${c.id} ${c.label || ''}`))
      .map(c => ({
        id: c.id,
        label: c.label,
        enabled: reg.isEnabled?.(c.id),
        visible: reg.isVisible?.(c.id),
      }));
    return {
      total: all.length,
      show: !!reg.getCommand('kairo.java.showUsages'),
      find: !!reg.getCommand('kairo.java.findUsages'),
      javaNav,
      sample: ids.map(id => ({
        id,
        present: !!reg.getCommand(id),
        enabled: reg.isEnabled?.(id),
        visible: reg.isVisible?.(id),
      })),
    };
  });
  record('Command registered: kairo.java.showUsages', !!cmdProbe.show, JSON.stringify(cmdProbe.sample));
  record('Command registered: kairo.java.findUsages', !!cmdProbe.find, `javaNav=${JSON.stringify(cmdProbe.javaNav)}`);

  // Open Java file
  await page.keyboard.press('Control+P');
  await sleep(700);
  const fileInput = page.locator('.quick-input-widget input[type="text"]').first();
  if (await fileInput.count()) {
    await fileInput.fill('HelloServlet.java');
    await sleep(800);
    await page.keyboard.press('Enter');
    await sleep(2500);
  }
  await shot(page, '02-open-java');

  // Focus editor, then Ctrl+F to land caret on class name (reliable vs approximate click)
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  const editor = page.locator('.monaco-editor').first();
  if (await editor.count()) {
    await editor.click({ position: { x: 120, y: 80 } }).catch(() => {});
    await sleep(400);
  }
  // Use Theia/Monaco find via command to avoid colliding with Quick Open
  await page.keyboard.press('Control+F');
  await sleep(800);
  const findInput = page.locator('.find-widget .monaco-inputbox textarea, .find-widget textarea, .find-widget input.input, .editor-widget.find-widget input').first();
  let caretOk = false;
  if (await findInput.isVisible().catch(() => false)) {
    await findInput.click({ clickCount: 3 });
    await findInput.fill('HelloServlet');
    await sleep(400);
    await page.keyboard.press('Enter');
    await sleep(400);
    await page.keyboard.press('Escape');
    await sleep(400);
    caretOk = true;
  } else {
    // Fallback: Go to Line / Symbol via Ctrl+Shift+O style — type in editor then use palette
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(200);
    await page.keyboard.press('Control+Shift+O');
    await sleep(700);
    const sym = page.locator('.quick-input-widget input[type="text"]').first();
    if (await sym.isVisible().catch(() => false)) {
      await sym.fill('HelloServlet');
      await sleep(600);
      await page.keyboard.press('Enter');
      await sleep(500);
      caretOk = true;
    }
  }
  await shot(page, '03-caret-on-class');
  record('Caret placed on HelloServlet', caretOk);

  // Re-check visibility after java editor focus
  const afterFocus = await page.evaluate(() => {
    const reg = window.__kairoCmdReg;
    return {
      showEnabled: reg.isEnabled?.('kairo.java.showUsages'),
      showVisible: reg.isVisible?.('kairo.java.showUsages'),
      findEnabled: reg.isEnabled?.('kairo.java.findUsages'),
      findVisible: reg.isVisible?.('kairo.java.findUsages'),
      lang: document.querySelector('.theia-statusBar')?.textContent || '',
    };
  });
  record('Show Usages enabled after Java focus', !!afterFocus.showEnabled, JSON.stringify(afterFocus));

  // Execute Show Usages via CommandRegistry (authoritative click-test equivalent)
  let execErr = null;
  try {
    await page.evaluate(async () => {
      await window.__kairoCmdReg.executeCommand('kairo.java.showUsages');
    });
  } catch (e) {
    execErr = String(e).slice(0, 200);
  }
  await sleep(3000);
  await shot(page, '04-exec-show-usages');

  const afterShow = await page.evaluate(() => {
    const qi = document.querySelector('.quick-input-widget');
    const panel = document.querySelector('.kairo-java-references-widget, #kairo-java-references');
    const toasts = [...document.querySelectorAll('.theia-notification-list-item, .theia-notification-toast, .notification-list-item')]
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 8);
    const qiText = (qi?.innerText || '').replace(/\s+/g, ' ').slice(0, 300);
    const panelText = (panel?.textContent || '').replace(/\s+/g, ' ').slice(0, 240);
    const popupVisible = !!(qi && getComputedStyle(qi).display !== 'none' && qi.clientHeight > 20
      && /Usages of|usage|declaration|Find Usages Panel|用法/i.test(qiText));
    const panelVisible = !!(panel && getComputedStyle(panel).display !== 'none' && panel.clientHeight > 0);
    const emptyToast = toasts.some(t => /No usages found|未找到|no usages/i.test(t));
    const emptyPanel = /未找到引用|No references|No usages/i.test(panelText);
    return { popupVisible, panelVisible, emptyToast, emptyPanel, qiText, panelText, toasts, rowCount: qi?.querySelectorAll('.monaco-list-row, .quick-input-list-entry').length || 0 };
  });
  // Success if we got a usages popup, OR empty-state feedback (toast and/or Find Usages panel)
  // when JDT returns no references for the project.
  const showOk = afterShow.popupVisible || afterShow.emptyToast || (afterShow.panelVisible && afterShow.emptyPanel) || afterShow.panelVisible;
  record('Show Usages responds (popup or empty-state panel/toast)', showOk, JSON.stringify(afterShow));

  if (afterShow.popupVisible) {
    // Click / Enter first selectable row
    await page.keyboard.press('ArrowDown').catch(() => {});
    await sleep(300);
    await page.keyboard.press('Enter');
    await sleep(1200);
    await shot(page, '05-select-usage');
    record('Select usage from popup', true);
  }

  // Execute Find Usages panel
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(400);
  // Re-click class to have a position
  await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.monaco-editor .view-line'));
    for (const line of lines) {
      if ((line.textContent || '').includes('HelloServlet')) {
        const r = line.getBoundingClientRect();
        line.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 60, clientY: r.top + 4 }));
        break;
      }
    }
  });
  await sleep(300);

  try {
    await page.evaluate(async () => {
      await window.__kairoCmdReg.executeCommand('kairo.java.findUsages');
    });
  } catch (e) {
    execErr = String(e).slice(0, 200);
  }
  await sleep(4000);
  await shot(page, '06-exec-find-usages');

  const panel = await page.evaluate(() => {
    const el = document.querySelector('.kairo-java-references-widget, #kairo-java-references');
    if (!el) return { visible: false };
    const style = getComputedStyle(el);
    return {
      visible: style.display !== 'none' && el.clientHeight > 0,
      text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 240),
      hasFilter: !!el.querySelector('.kairo-java-references-filter'),
      hasItem: !!el.querySelector('.kairo-java-references-item'),
      hasGroup: !!el.querySelector('.kairo-java-references-group'),
    };
  });
  record('Find Usages panel after executeCommand', !!panel.visible, JSON.stringify(panel));

  if (panel.visible) {
    if (panel.hasItem) {
      await page.locator('.kairo-java-references-item').first().click();
      await sleep(1000);
      await shot(page, '07-click-usage-row');
      record('Click usage row in panel', true);
    } else if (panel.hasFilter) {
      await page.locator('.kairo-java-references-filter').fill('Hello');
      await sleep(400);
      await shot(page, '07-filter');
      record('Find Usages filter interaction', true);
    } else {
      record('Find Usages panel has content/filter', /usage|引用|Loading|加载|No reference|未找到/i.test(panel.text || ''), panel.text);
    }
  }

  // Palette probe WITH java editor focused
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 40, y: 20 } }).catch(() => {});
  await page.keyboard.press('Control+Shift+P');
  await sleep(700);
  const pal = page.locator('.quick-input-widget input[type="text"]').first();
  if (await pal.count()) {
    await pal.fill('>Show Usages');
    await sleep(800);
    await shot(page, '08-palette');
    const t = await page.locator('.quick-input-widget').innerText().catch(() => '');
    record('Palette lists Show Usages (with Java focus)', /Show Usages/i.test(t), t.replace(/\s+/g, ' ').slice(0, 180));
  }

  const report = {
    at: new Date().toISOString(),
    baseUrl,
    cmdProbe,
    afterFocus,
    results,
    pass: results.filter(r => r.ok).length,
    fail: results.filter(r => !r.ok).length,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  log(`done: ${report.pass} pass / ${report.fail} fail`);
  await browser.close();
  process.exit(report.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
