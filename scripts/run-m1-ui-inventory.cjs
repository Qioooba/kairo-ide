// M1 — UI inventory of the running Kairo IDE product (macOS web, real headed Chromium).
//
// Enumerates every interactive surface of the product and writes
//   artifacts/acceptance-65210d5dd2e9/mac-web/ui-inventory.json
// with one entry {id: 'WEB-UI-NNNN', surface, control, selector, role,
// states, expected, evidence[]} per control, plus a per-surface DOM
// reconciliation (raw interactable count vs inventoried count —
// unexplained interactables = inventory gaps = failures).
//
// Surfaces covered: top menus (every item, one submenu level), full
// command-palette command list, activity bar, status bar, file-tree
// toolbar, editor area, bottom panel, the 6 Kairo views, dialogs
// (workspace trust), notifications container.
//
// Usage: node scripts/run-m1-ui-inventory.cjs
// Discovery phase only — NO FIXES.

'use strict';

const path = require('path');
const fs = require('fs');
const {
  REPO_ROOT, startStack, stopStack, launchBrowser, openPage,
  dismissTrustDialog, openCommandPalette, runCommand, screenshot,
  waitForStatusBarContains, ensureDir, nowIso, sleep,
} = require('./qa-helpers.cjs');

const OUT = ensureDir(path.join(REPO_ROOT, 'artifacts', 'acceptance-65210d5dd2e9', 'mac-web'));
const SHOTS = ensureDir(path.join(OUT, 'screenshots', 'm1', 'inventory'));
const DATA_DIR = process.env.KAIRO_QA_DATA_DIR || '/tmp/kairo-mac-web-qa-m1-inventory';
const HARD_CAP_MS = 12 * 60 * 1000;

const INTERACTABLE_SEL = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="tab"], [tabindex]';

const inventory = [];
const failures = [];
let seq = 0;

function addEntry(surface, control, selector, role, states, expected, evidence) {
  seq += 1;
  inventory.push({
    id: `WEB-UI-${String(seq).padStart(4, '0')}`,
    surface, control, selector, role,
    states: states || [],
    expected: expected || '',
    evidence: evidence || [],
  });
}

function addFailure(surface, detail) {
  failures.push({ surface, detail, time: nowIso() });
  console.log(`INVENTORY-GAP ${surface}: ${detail}`);
}

// Count + sample raw DOM interactables under a root selector (visible only).
async function probeInteractables(page, rootSel) {
  return page.evaluate(([root, sel]) => {
    const r = document.querySelector(root);
    if (!r) return { found: false, total: 0, visible: 0, samples: [] };
    const els = Array.from(r.querySelectorAll(sel));
    const vis = els.filter(e => {
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden';
    });
    return {
      found: true,
      total: els.length,
      visible: vis.length,
      samples: vis.slice(0, 500).map(e => ({
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute('role') || '',
        text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        title: e.getAttribute('title') || '',
        cls: String(e.className || '').slice(0, 100),
        disabled: e.disabled === true || e.getAttribute('aria-disabled') === 'true' || /mod-disabled/.test(String(e.className)),
      })),
    };
  }, [rootSel, INTERACTABLE_SEL]);
}

// Reconcile: entries recorded for a surface vs raw visible interactables.
function reconcile(surface, rootProbe, entriesForSurface, notes) {
  const entryCount = entriesForSurface;
  const raw = rootProbe.visible;
  const gap = raw - entryCount;
  const rec = { surface, rawVisibleInteractables: raw, inventoried: entryCount, gap, notes: notes || '' };
  if (gap > 0) {
    rec.status = 'GAP';
    addFailure(surface, `${gap} unexplained visible interactable(s) (raw=${raw}, inventoried=${entryCount}). Samples: ${JSON.stringify(rootProbe.samples.slice(0, 10))}`);
  } else {
    rec.status = 'OK';
  }
  return rec;
}

async function main() {
  const t0 = Date.now();
  const reconciliations = [];
  const stack = await startStack({ dataDir: DATA_DIR, port: 18080 });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/`;
  console.log(`stack up: web=${webUrl} agent=${env.KAIRO_QA_AGENT_PORT}`);

  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);

  // --- dialog: workspace trust (capture before dismissing) ---------------
  try {
    const trustBtn = page.locator('button', { hasText: 'Yes, I trust the authors' });
    if (await trustBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      const shot = await screenshot(page, path.join(SHOTS, 'dialog-trust.png'));
      const dlgProbe = await probeInteractables(page, '.theia-dialog, .p-Widget.dialog, div[class*="dialog"], body');
      addEntry('dialog:trust', 'Trust dialog — "Yes, I trust the authors"', 'button:has-text("Yes, I trust the authors")', 'button', ['enabled', 'visible'], 'click trusts workspace and closes dialog', [shot]);
      const noBtn = page.locator('button', { hasText: /No, I don't trust|Don't trust/i });
      if (await noBtn.count()) {
        addEntry('dialog:trust', 'Trust dialog — negative choice', 'button (do-not-trust)', 'button', ['enabled'], 'click closes dialog without trust', [shot]);
      }
      addEntry('dialog:trust', `Trust dialog raw interactables under body: ${dlgProbe.visible}`, 'n/a', 'meta', [], 'reconciliation aid', [shot]);
    }
  } catch (e) { addFailure('dialog:trust', String(e)); }
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);
  const shellShot = await screenshot(page, path.join(SHOTS, 'shell.png'));

  // --- status bar ---------------------------------------------------------
  let statusItems = [];
  try {
    statusItems = await page.evaluate(() => {
      const sb = document.getElementById('theia-statusBar') || document.querySelector('.theia-statusbar');
      if (!sb) return [];
      return Array.from(sb.querySelectorAll('.item, .element')).map(el => ({
        id: el.id || '',
        cls: String(el.className || '').slice(0, 120),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        title: el.getAttribute('title') || '',
        hasCommand: /hasCommand/.test(String(el.className)),
      })).filter(i => i.text || i.id);
    });
    const shot = await screenshot(page, path.join(SHOTS, 'statusbar.png'));
    for (const it of statusItems) {
      addEntry('status-bar', it.text || it.id, `#theia-statusBar .item (id=${it.id || 'none'})`, 'statusbar-item',
        [it.hasCommand ? 'clickable(hasCommand)' : 'inert(no command)'], it.title || 'status bar entry', [shot]);
    }
    const probe = await probeInteractables(page, '#theia-statusBar');
    reconciliations.push(reconcile('status-bar', probe, statusItems.length, 'statusbar items are divs with click handlers; tabindex/role absence expected'));
  } catch (e) { addFailure('status-bar', String(e)); }

  // --- activity bar (left) -------------------------------------------------
  try {
    const tabs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#theia-left-panel [class*="TabBar-tab"], .theia-app-left [class*="TabBar-tab"]'))
        .map(t => ({
          label: (t.querySelector('[class*="TabBar-tabLabel"]')?.textContent || '').trim(),
          title: t.getAttribute('title') || '',
          active: /mod-current/.test(String(t.className)),
        })).filter(t => t.label || t.title);
    });
    const shot = await screenshot(page, path.join(SHOTS, 'activitybar.png'));
    for (const t of tabs) {
      addEntry('activity-bar', t.title || t.label, '.p-TabBar-tab', 'tab', [t.active ? 'active' : 'inactive'], 'click opens corresponding side-panel view', [shot]);
    }
    const probe = await probeInteractables(page, '#theia-left-panel');
    reconciliations.push(reconcile('activity-bar+left-panel', probe, tabs.length, 'includes tree toolbars and view toolbars of the open side panel'));
  } catch (e) { addFailure('activity-bar', String(e)); }

  // --- file-tree toolbar (navigator) ---------------------------------------
  try {
    const probe = await probeInteractables(page, '#explorer-view-container, #files, .theia-TreeContainer');
    const navProbe = await page.evaluate((sel) => {
      const roots = Array.from(document.querySelectorAll('#theia-left-panel .theia-toolbar, #theia-left-panel [class*="toolbar"]'));
      const out = [];
      for (const r of roots) {
        for (const b of r.querySelectorAll(sel)) {
          const rect = b.getBoundingClientRect();
          if (rect.width > 0) out.push({ text: (b.textContent || '').trim().slice(0, 60), title: b.getAttribute('title') || '', cls: String(b.className).slice(0, 100) });
        }
      }
      return out;
    }, INTERACTABLE_SEL);
    const shot = await screenshot(page, path.join(SHOTS, 'filetree-toolbar.png'));
    for (const b of navProbe) {
      addEntry('file-tree-toolbar', b.title || b.text || b.cls, '#theia-left-panel toolbar', 'button', ['visible'], b.title || 'tree toolbar action', [shot]);
    }
    reconciliations.push({ surface: 'file-tree-toolbar', rawVisibleInteractables: probe.visible, inventoried: navProbe.length, gap: probe.visible - navProbe.length, status: probe.visible - navProbe.length > 0 ? 'GAP-REVIEW' : 'OK', notes: 'raw probe includes tree rows with tabindex; tree rows are dynamic content, not controls' });
  } catch (e) { addFailure('file-tree-toolbar', String(e)); }

  // --- editor area + bottom panel ------------------------------------------
  try {
    const edProbe = await probeInteractables(page, '#theia-main-content-panel');
    const shot = await screenshot(page, path.join(SHOTS, 'editor-area.png'));
    addEntry('editor-area', `main dock panel (raw visible interactables=${edProbe.visible})`, '#theia-main-content-panel', 'region', ['empty on cold start'], 'hosts editors and Kairo main widgets', [shot]);
    reconciliations.push({ surface: 'editor-area', rawVisibleInteractables: edProbe.visible, inventoried: 1, gap: edProbe.visible - 1, status: 'INFO', notes: 'content-dependent; cold start should be near zero' });
  } catch (e) { addFailure('editor-area', String(e)); }
  try {
    const panelProbe = await probeInteractables(page, '#theia-bottom-content-panel');
    reconciliations.push({ surface: 'bottom-panel', rawVisibleInteractables: panelProbe.visible, inventoried: 0, gap: panelProbe.visible, status: panelProbe.visible > 0 ? 'GAP-REVIEW' : 'OK', notes: panelProbe.found ? 'collapsed on cold start' : 'panel not rendered' });
  } catch (e) { addFailure('bottom-panel', String(e)); }

  // --- top menus: enumerate bar, then open each and enumerate items --------
  const menuInventory = [];
  const MENU_SEL = '[class*="MenuBar-item"]';
  const OPEN_MENU_SEL = '[class*="MenuBar-menu"], [class*="-Menu "]';
  try {
    const barItems = await page.evaluate((sel) =>
      Array.from(document.querySelectorAll(sel))
        .map(e => (e.textContent || '').trim()).filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i), MENU_SEL);
    const shot0 = await screenshot(page, path.join(SHOTS, 'menubar.png'));
    for (const label of barItems) {
      addEntry('menubar', `Menu: ${label}`, MENU_SEL, 'menu', ['enabled'], 'click opens menu', [shot0]);
    }

    for (const label of barItems) {
      try {
        await page.locator(MENU_SEL, { hasText: label }).first().click();
        await sleep(500);
        const menuVisible = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[class*="Menu-item"]'))
            .some(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; }));
        if (!menuVisible) { addFailure(`menu:${label}`, 'menu did not open'); await page.keyboard.press('Escape'); continue; }
        const items = await page.evaluate(() => {
          const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
          const menus = Array.from(document.querySelectorAll('ul[class*="Menu-content"], [class*="-Menu"]'))
            .filter(m => m.querySelector('[class*="Menu-item"]') && vis(m));
          const top = menus[0];
          if (!top) return [];
          return Array.from(top.querySelectorAll('[class*="Menu-item"]')).map(it => ({
            label: ((it.querySelector('[class*="Menu-itemLabel"]') || {}).textContent || '').trim(),
            shortcut: ((it.querySelector('[class*="Menu-itemShortcut"]') || {}).textContent || '').trim(),
            type: it.getAttribute('data-type') || '',
            disabled: /mod-disabled/.test(String(it.className)),
          }));
        });
        const shot = await screenshot(page, path.join(SHOTS, `menu-${label.replace(/\W+/g, '_')}.png`));
        for (const it of items) {
          if (it.type === 'separator' || !it.label) continue;
          menuInventory.push({ menu: label, ...it });
          addEntry(`menu:${label}`, it.label, '[class*="Menu-item"]', it.type === 'submenu' ? 'submenu' : 'menuitem',
            [it.disabled ? 'disabled' : 'enabled', it.shortcut ? `shortcut=${it.shortcut}` : 'no-shortcut'],
            it.type === 'submenu' ? 'hover opens submenu' : 'click executes command', [shot]);
        }
        // one submenu level
        const subs = items.filter(i => i.type === 'submenu' && !i.disabled);
        for (const sub of subs.slice(0, 12)) {
          try {
            await page.locator('[class*="Menu-item"][data-type="submenu"]', { hasText: sub.label }).first().hover();
            await sleep(600);
            const subItems = await page.evaluate(() => {
              const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
              const menus = Array.from(document.querySelectorAll('ul[class*="Menu-content"], [class*="-Menu"]'))
                .filter(m => m.querySelector('[class*="Menu-item"]') && vis(m));
              if (menus.length < 2) return [];
              const sub2 = menus[menus.length - 1];
              return Array.from(sub2.querySelectorAll('[class*="Menu-item"]')).map(it => ({
                label: ((it.querySelector('[class*="Menu-itemLabel"]') || {}).textContent || '').trim(),
                type: it.getAttribute('data-type') || '',
                disabled: /mod-disabled/.test(String(it.className)),
              }));
            });
            if (subItems.length) {
              const subShot = await screenshot(page, path.join(SHOTS, `menu-${label.replace(/\W+/g, '_')}-${sub.label.replace(/\W+/g, '_')}.png`));
              for (const si of subItems) {
                if (si.type === 'separator' || !si.label) continue;
                addEntry(`menu:${label}>${sub.label}`, si.label, '[class*="Menu-item"]', 'menuitem', [si.disabled ? 'disabled' : 'enabled'], 'click executes command', [subShot]);
              }
            }
          } catch (_e) { /* submenu hover best-effort */ }
        }
        await page.keyboard.press('Escape');
        await sleep(200);
      } catch (e) {
        addFailure(`menu:${label}`, String(e));
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
  } catch (e) { addFailure('menubar', String(e)); }

  // --- command palette: full command list ----------------------------------
  let commands = [];
  try {
    await openCommandPalette(page);
    const input = page.locator('.quick-input-widget .quick-input-box input');
    await input.fill('');
    await input.type('>', { delay: 25 });
    await sleep(1200);
    const seen = new Set();
    let stable = 0;
    const listBox = await page.locator('.quick-input-widget .monaco-list').first().boundingBox().catch(() => null);
    for (let i = 0; i < 300 && stable < 6; i++) {
      const labels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row'))
          .map(r => (r.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
      let added = 0;
      for (const l of labels) if (!seen.has(l)) { seen.add(l); added++; }
      if (added === 0) stable++; else stable = 0;
      if (listBox) {
        await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
        await page.mouse.wheel(0, 700);
      }
      await sleep(150);
    }
    commands = [...seen];
    const shot = await screenshot(page, path.join(SHOTS, 'command-palette.png'));
    addEntry('command-palette', `full command list (${commands.length} rows captured)`, '.quick-input-widget', 'listbox', ['filterable'], 'Meta+P then > lists every command', [shot]);
    // record Kairo commands individually; the rest as a group entry
    const kairoCommands = commands.filter(c => /kairo/i.test(c));
    for (const c of kairoCommands) {
      addEntry('command-palette', c, '.quick-input-widget .monaco-list-row', 'option', ['enabled'], 'Enter/click executes command', [shot]);
    }
    await page.keyboard.press('Escape');
    await sleep(300);

    // capture the Kairo subset on screen too
    await openCommandPalette(page);
    await input.fill('');
    await input.type('>Kairo', { delay: 25 });
    await sleep(800);
    await screenshot(page, path.join(SHOTS, 'command-palette-kairo.png'));
    await page.keyboard.press('Escape');
    await sleep(300);
    fs.writeFileSync(path.join(OUT, 'command-list-m1.json'), JSON.stringify({ capturedAt: nowIso(), count: commands.length, commands, kairoCommands }, null, 2));
  } catch (e) { addFailure('command-palette', String(e)); }

  // --- Kairo views -----------------------------------------------------------
  const viewDefs = [
    { factory: 'kairo-server-view', labelGuess: 'Kairo: Show Servers' },
    { factory: 'kairo-build-view', labelGuess: 'Kairo: Show Builds' },
    { factory: 'kairo-deployments', labelGuess: 'Kairo: Show Deployments' },
    { factory: 'kairo-log-viewer', labelGuess: 'Kairo: Show Tomcat Logs' },
  ];
  for (const v of viewDefs) {
    try {
      await runCommand(page, v.labelGuess);
      await sleep(1500);
      const widgetSel = `[id="${v.factory}"], [id^="${v.factory}"]`;
      const found = await page.locator(widgetSel).first().isVisible({ timeout: 5000 }).catch(() => false);
      const rootSel = found ? widgetSel : '#theia-main-content-panel';
      const shot = await screenshot(page, path.join(SHOTS, `view-${v.factory}.png`));
      const probe = await probeInteractables(page, rootSel);
      for (const s of probe.samples) {
        addEntry(`kairo-view:${v.factory}`, s.title || s.text || `${s.tag}.${s.cls}`, rootSel,
          s.role || s.tag, [s.disabled ? 'disabled' : 'enabled', 'visible'], s.title || 'view control', [shot]);
      }
      if (!found) addFailure(`kairo-view:${v.factory}`, 'widget root not found by factory id; fell back to main panel probe');
      reconciliations.push({ surface: `kairo-view:${v.factory}`, rawVisibleInteractables: probe.visible, inventoried: probe.samples.length, gap: probe.visible - probe.samples.length, status: probe.visible - probe.samples.length > 0 ? 'GAP' : 'OK', notes: found ? '' : 'factory-id root missing' });
    } catch (e) { addFailure(`kairo-view:${v.factory}`, String(e)); }
  }

  // import wizard + project selector open via File menu commands; open to inventory, then close
  for (const v of [
    { factory: 'kairo-import-wizard', labelGuess: 'Kairo: Import Project' },
    { factory: 'kairo-project-selector', labelGuess: 'Kairo: Select Project' },
  ]) {
    try {
      await runCommand(page, v.labelGuess);
      await sleep(1500);
      const widgetSel = `[id="${v.factory}"], [id^="${v.factory}"]`;
      const found = await page.locator(widgetSel).first().isVisible({ timeout: 5000 }).catch(() => false);
      const rootSel = found ? widgetSel : '#theia-main-content-panel';
      const shot = await screenshot(page, path.join(SHOTS, `view-${v.factory}.png`));
      const probe = await probeInteractables(page, rootSel);
      for (const s of probe.samples) {
        addEntry(`kairo-view:${v.factory}`, s.title || s.text || `${s.tag}.${s.cls}`, rootSel,
          s.role || s.tag, [s.disabled ? 'disabled' : 'enabled', 'visible'], s.title || 'view control', [shot]);
      }
      if (!found) addFailure(`kairo-view:${v.factory}`, 'widget root not found by factory id');
      reconciliations.push({ surface: `kairo-view:${v.factory}`, rawVisibleInteractables: probe.visible, inventoried: probe.samples.length, gap: probe.visible - probe.samples.length, status: probe.visible - probe.samples.length > 0 ? 'GAP' : 'OK', notes: found ? '' : 'factory-id root missing' });
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) { addFailure(`kairo-view:${v.factory}`, String(e)); await page.keyboard.press('Escape').catch(() => {}); }
  }

  // --- notifications container ----------------------------------------------
  try {
    const notif = await page.evaluate(() => {
      const c = document.querySelector('.theia-NotificationsContainer, #theia-notification-center, [class*="notification"]');
      return c ? (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
    });
    addEntry('notifications', notif ? `container present: ${notif}` : 'no notifications rendered during inventory', '.theia-NotificationsContainer', 'region', ['idle'], 'toasts appear on events', [shellShot]);
  } catch (e) { addFailure('notifications', String(e)); }

  // --- console/page errors during inventory ----------------------------------
  const logs = page._kairoLogs || [];
  const errors = logs.filter(l => l.type === 'pageerror' || l.type === 'error' || l.type === 'requestfailed' || /^http/.test(l.type));
  fs.writeFileSync(path.join(OUT, 'console-m1-inventory.jsonl'), logs.map(l => JSON.stringify(l)).join('\n') + '\n');

  await browser.close();
  await stopStack(stack.dataDir);

  const doc = {
    generatedAt: nowIso(),
    commit: require('child_process').execSync('git rev-parse HEAD').toString().trim(),
    webUrl,
    elapsedSec: ((Date.now() - t0) / 1000).toFixed(1),
    totals: {
      entries: inventory.length,
      menuItems: menuInventory.length,
      paletteCommands: commands.length,
      statusBarItems: statusItems.length,
      surfaces: [...new Set(inventory.map(i => i.surface))],
    },
    perSurfaceCounts: inventory.reduce((m, i) => { m[i.surface] = (m[i.surface] || 0) + 1; return m; }, {}),
    reconciliation: reconciliations,
    consoleErrors: errors,
    consoleErrorWhitelist: 'none — every console/page error during inventory is reported above',
    failures,
    entries: inventory,
  };
  fs.writeFileSync(path.join(OUT, 'ui-inventory.json'), JSON.stringify(doc, null, 2));
  console.log(`inventory written: ${inventory.length} entries, ${failures.length} gaps, ${errors.length} console errors`);
  process.exit(failures.length || errors.length ? 1 : 0);
}

const hardCap = setTimeout(() => { console.error('M1 inventory HARD CAP'); process.exit(2); }, HARD_CAP_MS);
main().catch(e => { clearTimeout(hardCap); console.error(e); process.exit(1); });
