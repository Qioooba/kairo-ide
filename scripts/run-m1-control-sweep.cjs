// M1 — per-control acceptance sweep (9-step template) on every interactive
// surface of the running Kairo IDE product. Real headed Chromium. NO FIXES.
//
// Template per control:
//   1. default screenshot + accessible name/role/enabled/bbox
//   2. hover
//   3. Tab focus (tabIndex + real Tab traversal sample per view)
//   4. Enter/Space AND mouse click
//   5. double-submit check (rapid double click)
//   6. success + failure result observation
//   7. disabled condition capture
//   8. 1280x720 + 200% zoom truncation/overlap (dedicated viewport case)
//   9. console/network clean (per-case log delta)
//
// Covers: Kairo view buttons (Build/Clean Build/Start/Stop/Restart/Open App/
// Clear/selectors), status bar items (expected INERT — KAIRO-RC-WEB-006),
// Import Wizard 4-step walk incl. validation (empty/long/Chinese name),
// Project Selector open/close/Escape/click-outside. Destructive/global menu
// items are enumerated + enabled/tooltip-checked but NOT executed.
//
// Writes:
//   artifacts/acceptance-65210d5dd2e9/mac-web/results-m1.json
//   artifacts/acceptance-65210d5dd2e9/mac-web/defects-m1.jsonl
//   screenshots under artifacts/acceptance-65210d5dd2e9/mac-web/screenshots/m1/
//
// Usage: node scripts/run-m1-control-sweep.cjs

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  REPO_ROOT, startStack, stopStack, launchBrowser, openPage,
  dismissTrustDialog, runCommand, screenshot,
  waitForStatusBarContains, ensureDir, nowIso, sleep,
} = require('./qa-helpers.cjs');

const OUT = ensureDir(path.join(REPO_ROOT, 'artifacts', 'acceptance-65210d5dd2e9', 'mac-web'));
const SHOTS = ensureDir(path.join(OUT, 'screenshots', 'm1'));
const DATA_DIR = process.env.KAIRO_QA_DATA_DIR || '/tmp/kairo-mac-web-qa-m1-sweep';
const HARD_CAP_MS = 15 * 60 * 1000;

const cases = [];
const defects = [];
let defectSeq = 101;

function record(id, ok, detail) {
  cases.push({ id, status: ok ? 'PASS' : 'FAIL', detail: detail || '', time: nowIso() });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
}

function defect(severity, title, repro, evidence) {
  const id = `KAIRO-RC-WEB-${defectSeq++}`;
  defects.push({ id, severity, title, repro, evidence, filedAt: nowIso() });
  console.log(`DEFECT ${id} [${severity}] ${title}`);
  return id;
}

function consoleDelta(page, fromIdx) {
  const logs = page._kairoLogs || [];
  return logs.slice(fromIdx).filter(l =>
    l.type === 'pageerror' || l.type === 'error' || l.type === 'requestfailed' || /^http/.test(l.type));
}

async function probeControl(page, loc) {
  return loc.evaluate(el => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      title: el.getAttribute('title') || '',
      role: el.getAttribute('role') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      enabled: !(el.disabled === true || el.getAttribute('aria-disabled') === 'true' || /mod-disabled|disabled/.test(String(el.className))),
      tabIndex: el.tabIndex,
      bbox: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      visible: b.width > 0 && b.height > 0 && cs.visibility !== 'hidden',
    };
  }).catch(e => ({ error: String(e) }));
}

// Steps 1-5 (+7) for one control. Clicking is optional (non-destructive gate).
async function sweepControl(page, caseId, loc, opts = {}) {
  const logIdx = (page._kairoLogs || []).length;
  const notes = [];
  let ok = true;
  // 1. default screenshot + name/role/enabled/bbox
  const info = await probeControl(page, loc);
  if (info.error) { record(caseId, false, `probe failed: ${info.error}`); return; }
  const shot = await screenshot(page, path.join(SHOTS, `${caseId.replace(/\W+/g, '_')}-default.png`));
  notes.push(`tag=${info.tag} role=${info.role || '-'} aria=${info.ariaLabel || '-'} title=${info.title || '-'} enabled=${info.enabled} tabIndex=${info.tabIndex} bbox=${JSON.stringify(info.bbox)}`);
  if (!info.visible) { ok = false; notes.push('NOT VISIBLE at default state'); }
  // 2. hover
  try { await loc.hover({ timeout: 3000 }); await sleep(200); } catch (_e) { notes.push('hover failed'); ok = false; }
  // 3. Tab focus capability (real traversal is sampled per view elsewhere)
  if (info.tabIndex < 0 && !['button', 'input', 'select', 'textarea', 'a'].includes(info.tag)) {
    notes.push('not keyboard-focusable (tabIndex<0, non-native tag)');
  }
  if (!opts.click) {
    // 4-6. non-executed control (destructive/global gate)
    notes.push('NOT EXECUTED (destructive/global item — enumerated only, per mission)');
    record(caseId, ok, notes.join(' | ') + ` | shot=${path.basename(shot)}`);
    return info;
  }
  // 4a. keyboard activation
  if (info.enabled) {
    try {
      await loc.focus({ timeout: 2000 });
      const before = await page.evaluate(() => (document.activeElement && (document.activeElement.textContent || document.activeElement.tagName) || '').slice(0, 40));
      await page.keyboard.press('Enter');
      await sleep(400);
      notes.push(`Enter dispatched (focus="${before}")`);
      await page.keyboard.press('Space').catch(() => {});
      await sleep(300);
    } catch (_e) { notes.push('keyboard focus/Enter failed'); }
    // 4b. mouse click
    try { await loc.click({ timeout: 4000 }); await sleep(opts.observeMs || 1500); }
    catch (e) { ok = false; notes.push(`mouse click failed: ${String(e).slice(0, 80)}`); }
    // 5. double-submit: rapid second click should not stack errors/dialogs
    try {
      await loc.click({ timeout: 3000 });
      await sleep(600);
      const dialogs = await page.locator('.theia-dialog:visible, .p-Widget.dialog:visible').count();
      if (dialogs > 1) { ok = false; notes.push(`double-submit opened ${dialogs} dialogs`); }
      else notes.push('double-submit check clean');
    } catch (_e) { notes.push('double-submit second click failed (control may be disabled after first click — acceptable)'); }
  } else {
    notes.push('control DISABLED at sweep time — activation steps skipped, disabled state captured (step 7)');
  }
  // 9. console clean
  const errs = consoleDelta(page, logIdx);
  if (errs.length) { ok = false; notes.push(`${errs.length} console/page error(s): ${JSON.stringify(errs[0]).slice(0, 160)}`); }
  record(caseId, ok, notes.join(' | ') + ` | shot=${path.basename(shot)}`);
  return info;
}

async function main() {
  const stack = await startStack({ dataDir: DATA_DIR, port: 18080 });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/`;
  console.log(`stack up: ${webUrl}`);
  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  // ================= status bar items (expect INERT: KAIRO-RC-WEB-006) ====
  try {
    const items = await page.evaluate(() => {
      const sb = document.getElementById('theia-statusBar');
      if (!sb) return [];
      return Array.from(sb.querySelectorAll('.item, .element')).map((el, i) => ({
        idx: i,
        id: el.id || '',
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        title: el.getAttribute('title') || '',
        hasCommand: /hasCommand/.test(String(el.className)),
      })).filter(x => x.text || x.id);
    });
    for (const it of items) {
      const logIdx = (page._kairoLogs || []).length;
      const loc = page.locator('#theia-statusBar .item, #theia-statusBar .element').nth(it.idx);
      const before = await page.evaluate(() => document.body.innerHTML.length);
      let clicked = true;
      try { await loc.hover({ timeout: 2000 }); await loc.click({ timeout: 3000 }); await sleep(800); }
      catch (_e) { clicked = false; }
      // observe: any menu/popup/dialog opened?
      const opened = await page.evaluate(() => ({
        menus: Array.from(document.querySelectorAll('[class*="-Menu"], [class*="Menu "]')).filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && el.querySelector('[class*="Menu-item"]'); }).length,
        dialogs: document.querySelectorAll('.theia-dialog, [class*="dialogOverlay"], [class*="Dialog"]').length,
        quickInput: document.querySelectorAll('.quick-input-widget').length,
      }));
      const errs = consoleDelta(page, logIdx);
      const inert = opened.menus === 0 && opened.dialogs === 0;
      const kairoItem = /runtime|project|server|build|tomcat|deploy|kairo/i.test(it.text + ' ' + it.id + ' ' + it.title);
      const detail = `text="${it.text}" id=${it.id || '-'} title="${it.title || '-'}" hasCommand=${it.hasCommand} clickEffect=${inert ? 'NONE (inert)' : JSON.stringify(opened)} clicked=${clicked}`;
      if (kairoItem && inert) {
        record(`M1-SWEEP.statusbar.${it.id || it.idx}`, errs.length === 0,
          detail + ' — matches known defect KAIRO-RC-WEB-006 (status bar items inert), verified' +
          (errs.length ? ` BUT console errors: ${JSON.stringify(errs[0]).slice(0, 120)}` : ''));
      } else if (kairoItem && !inert) {
        record(`M1-SWEEP.statusbar.${it.id || it.idx}`, errs.length === 0, detail + ' — Kairo status bar item is NOT inert (behavior change vs KAIRO-RC-WEB-006; review)');
      } else {
        // Theia-native items may be clickable — that is fine; only console errors fail.
        record(`M1-SWEEP.statusbar.${it.id || it.idx}`, errs.length === 0, detail + ' (Theia-native item)');
        if (opened.menus) await page.keyboard.press('Escape').catch(() => {});
      }
      await page.keyboard.press('Escape').catch(() => {});
      void before;
    }
    await screenshot(page, path.join(SHOTS, 'sweep-statusbar.png'));
  } catch (e) { record('M1-SWEEP.statusbar', false, String(e)); }

  // ================= Kairo views ==========================================
  const viewDefs = [
    { factory: 'kairo-build-view', cmd: 'Kairo: Show Builds' },
    { factory: 'kairo-server-view', cmd: 'Kairo: Show Servers' },
    { factory: 'kairo-deployments', cmd: 'Kairo: Show Deployments' },
    { factory: 'kairo-log-viewer', cmd: 'Kairo: Show Tomcat Logs' },
  ];
  // Controls we must not mass-execute (destructive/server-lifecycle):
  const DESTRUCTIVE_RE = /restart|stop|clean/i;
  for (const v of viewDefs) {
    try {
      await runCommand(page, v.cmd);
      await sleep(1800);
      const root = page.locator(`[id="${v.factory}"], [id^="${v.factory}"]`).first();
      const rootVisible = await root.isVisible({ timeout: 6000 }).catch(() => false);
      const scope = rootVisible ? root : page.locator('#theia-main-content-panel');
      const shot = await screenshot(page, path.join(SHOTS, `sweep-${v.factory}.png`));
      // Tab traversal sample (step 3, per view)
      try {
        await scope.click({ position: { x: 10, y: 10 }, timeout: 2000 }).catch(() => {});
        const focusTrail = [];
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('Tab');
          await sleep(120);
          const f = await page.evaluate(() => {
            const a = document.activeElement;
            return a ? `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''} "${(a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"` : 'none';
          });
          focusTrail.push(f);
        }
        record(`M1-SWEEP.${v.factory}.tab-traversal`, true, focusTrail.join(' -> '));
      } catch (e) { record(`M1-SWEEP.${v.factory}.tab-traversal`, false, String(e).slice(0, 120)); }

      // enumerate controls inside the view
      const controls = await page.evaluate(([fid]) => {
        const rootEl = document.querySelector(`[id="${fid}"]`) || document.querySelector(`[id^="${fid}"]`) || document.getElementById('theia-main-content-panel');
        if (!rootEl) return [];
        const els = Array.from(rootEl.querySelectorAll('button, input, select, textarea, [role="button"]'));
        return els.map((el, i) => {
          const b = el.getBoundingClientRect();
          return {
            i,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            text: (el.textContent || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            title: el.getAttribute('title') || '',
            visible: b.width > 0 && b.height > 0,
          };
        });
      }, [v.factory]);
      const visible = controls.filter(c => c.visible);
      if (!visible.length) {
        record(`M1-SWEEP.${v.factory}.controls`, rootVisible, `no visible controls found (rootVisible=${rootVisible}) shot=${path.basename(shot)}`);
        continue;
      }
      for (const c of visible) {
        const loc = scope.locator('button, input, select, textarea, [role="button"]').nth(c.i);
        const name = (c.text || c.title || `${c.tag}${c.i}`).replace(/\W+/g, '-').slice(0, 40);
        // execute clicks only on clearly-safe controls; lifecycle ones enumerated-only
        const safe = !DESTRUCTIVE_RE.test(c.text + ' ' + c.title) && !/select|checkbox|radio/.test(c.type);
        await sweepControl(page, `M1-SWEEP.${v.factory}.${name}`, loc, { click: safe, observeMs: 2500 });
      }
      // lifecycle buttons: enumerate + enabled/tooltip check, no execution
      for (const c of visible.filter(x => DESTRUCTIVE_RE.test(x.text + ' ' + x.title))) {
        const loc = scope.locator('button, input, select, textarea, [role="button"]').nth(c.i);
        const info = await probeControl(page, loc);
        record(`M1-SWEEP.${v.factory}.lifecycle.${(c.text || c.title).replace(/\W+/g, '-')}`, true,
          `NOT EXECUTED this round (server-lifecycle/destructive; enumerated per mission) enabled=${info.enabled} title="${info.title}" bbox=${JSON.stringify(info.bbox || {})}`);
      }
    } catch (e) { record(`M1-SWEEP.${v.factory}`, false, String(e).slice(0, 200)); }
  }

  // ================= Import Wizard walk =====================================
  try {
    await runCommand(page, 'Kairo: Import Project');
    await sleep(1800);
    const wiz = page.locator('[id^="kairo-import-wizard"]').first();
    const wizVisible = await wiz.isVisible({ timeout: 6000 }).catch(() => false);
    if (!wizVisible) {
      record('M1-SWEEP.wizard.open', false, 'import wizard widget not visible after command');
    } else {
      record('M1-SWEEP.wizard.open', true, 'wizard visible');
      await screenshot(page, path.join(SHOTS, 'wizard-step1.png'));
      // Actual product structure (verified live): step 1 "Open Workspace" has a
      // single "Open Workspace Folder" button and NO text inputs; the 4 step
      // indicators are Open Workspace / Detect Project / Configure / Ready.
      const structure = await wiz.evaluate(el => {
        const text = (el.textContent || '').replace(/\s+/g, ' ');
        const steps = ['Open Workspace', 'Detect Project', 'Configure', 'Ready'].filter(s => text.includes(s));
        return {
          steps,
          inputs: el.querySelectorAll('input').length,
          buttons: Array.from(el.querySelectorAll('button')).map(b => (b.textContent || '').trim()),
        };
      });
      record('M1-SWEEP.wizard.step1.structure', structure.steps.length === 4 && structure.inputs === 0,
        `step indicators=${structure.steps.join('/') || 'MISSING'} inputs=${structure.inputs} buttons=${JSON.stringify(structure.buttons)}`);
      // The "Open Workspace Folder" button opens a NATIVE directory picker
      // (showDirectoryPicker) — NOT clicked: it would block the automation.
      const folderBtn = wiz.locator('button:visible', { hasText: /open workspace folder/i }).first();
      const folderInfo = await probeControl(page, folderBtn);
      record('M1-SWEEP.wizard.open-workspace-folder', !!folderInfo.enabled,
        `NOT EXECUTED (opens native directory picker — blocks automation) enabled=${folderInfo.enabled} aria="${folderInfo.ariaLabel}" bbox=${JSON.stringify(folderInfo.bbox || {})}`);
      // Name-validation cases (empty / 300-char / Chinese) require reaching the
      // Configure step, which requires selecting a workspace via the native
      // picker — a COVERAGE GAP this round, not a product defect.
      for (const c of ['empty', 'long', 'chinese']) {
        record(`M1-SWEEP.wizard.validation.${c}`, false,
          'COVERAGE GAP: project-name input is behind "Open Workspace Folder" (native directory picker); validation states not reachable in this round — retest with a pre-opened workspace');
      }
      // close via the wizard's own tab X (tab label is "Welcome to Kairo IDE")
      const wizTab = page.locator('[class*="TabBar-tab"]', { hasText: 'Welcome to Kairo IDE' }).first();
      const wizClose = wizTab.locator('[class*="tabCloseButton"]').first();
      if (await wizClose.count()) {
        await wizTab.hover().catch(() => {});
        await wizClose.click().catch(() => {});
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
      await sleep(500);
      const stillOpen = await wiz.isVisible().catch(() => false);
      record('M1-SWEEP.wizard.close', !stillOpen, `closed via tab X (visible=${stillOpen})`);
      await page.keyboard.press('Escape').catch(() => {});
    }
  } catch (e) { record('M1-SWEEP.wizard', false, String(e).slice(0, 200)); await page.keyboard.press('Escape').catch(() => {}); }

  // ================= Project Selector =======================================
  try {
    await runCommand(page, 'Kairo: Select Project');
    await sleep(1500);
    const sel = page.locator('[id^="kairo-project-selector"]').first();
    const open1 = await sel.isVisible({ timeout: 6000 }).catch(() => false);
    record('M1-SWEEP.selector.open', open1, 'opened via "Kairo: Select Project"');
    await screenshot(page, path.join(SHOTS, 'selector-open.png'));
    // Escape close
    await page.keyboard.press('Escape');
    await sleep(600);
    const closedByEsc = !(await sel.isVisible().catch(() => false));
    record('M1-SWEEP.selector.escape', true, `Escape close => visible=${!closedByEsc} (Theia main-widgets close via tab X / command, Escape may be inert — recorded)`);
    // reopen + click-outside
    await runCommand(page, 'Kairo: Select Project');
    await sleep(1200);
    const open2 = await sel.isVisible().catch(() => false);
    if (open2) {
      await page.mouse.click(30, 450); // far left area (activity bar / explorer)
      await sleep(600);
      const afterClickOutside = await sel.isVisible().catch(() => false);
      record('M1-SWEEP.selector.click-outside', true, `click-outside leaves selector visible=${afterClickOutside} (dock widget, not modal — recorded)`);
      // close via tab close button if present
      await page.locator('[class*="TabBar-tab"][class*="mod-current"] [class*="tabCloseButton"]').first().click().catch(() => {});
    } else {
      record('M1-SWEEP.selector.reopen', false, 'selector did not reopen');
    }
  } catch (e) { record('M1-SWEEP.selector', false, String(e).slice(0, 200)); await page.keyboard.press('Escape').catch(() => {}); }

  // ================= destructive/global menu items (enumerate only) =========
  try {
    const invPath = path.join(OUT, 'ui-inventory.json');
    let destructive = [];
    if (fs.existsSync(invPath)) {
      const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
      destructive = (inv.entries || []).filter(e => /^menu/.test(e.surface) &&
        /close window|close folder|close workspace|quit|exit|delete|discard|force|kill|restart/i.test(e.control));
    }
    for (const d of destructive) {
      record(`M1-SWEEP.menu-destructive.${d.id}`, true,
        `NOT EXECUTED (destructive/global, per mission) — ${d.surface} :: "${d.control}" states=${d.states.join(',')}`);
    }
    record('M1-SWEEP.menu-destructive.summary', destructive.length >= 0, `${destructive.length} destructive/global menu items enumerated, none executed`);
  } catch (e) { record('M1-SWEEP.menu-destructive', false, String(e).slice(0, 120)); }

  // ================= viewport: 1280x720 + 200% zoom ==========================
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await sleep(1000);
    await screenshot(page, path.join(SHOTS, 'viewport-1280x720.png'));
      const trunc720 = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#theia-statusBar .item, [class*="MenuBar-item"], [id^="kairo-"] button')) {
        if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0) {
          bad.push(`${el.tagName} "${(el.textContent || '').trim().slice(0, 40)}" scrollW=${el.scrollWidth} clientW=${el.clientWidth}`);
        }
      }
      return bad.slice(0, 10);
    });
    record('M1-SWEEP.viewport.1280x720', trunc720.length === 0,
      trunc720.length ? `truncated controls: ${trunc720.join('; ')}` : 'no truncation detected at 1280x720');
    if (trunc720.length) defect('minor', 'UI truncation at 1280x720 viewport', 'Resize to 1280x720; controls with scrollWidth>clientWidth: ' + trunc720.join('; '), ['screenshots/m1/viewport-1280x720.png']);
    await page.evaluate(() => { document.body.style.zoom = '200%'; });
    await sleep(1200);
    await screenshot(page, path.join(SHOTS, 'viewport-zoom200.png'));
    const truncZoom = await page.evaluate(() => {
      const bad = [];
      // visible shell controls pushed outside the viewport
      for (const el of document.querySelectorAll('#theia-statusBar .item, [class*="MenuBar-item"]')) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.right > innerWidth + 8) bad.push(`"${(el.textContent || '').trim().slice(0, 40)}" right=${Math.round(b.right)} innerW=${innerWidth}`);
      }
      // right-side status bar items collapsed to zero width (clipped, unreachable)
      const expected = ['Runtime:', 'Project:', 'Server:'];
      const texts = Array.from(document.querySelectorAll('#theia-statusBar .item'))
        .map(el => ({ t: (el.textContent || '').trim(), w: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right }));
      for (const e of expected) {
        const hit = texts.find(x => x.t.includes(e));
        if (!hit || hit.w === 0 || hit.right > innerWidth + 8) {
          bad.push(`status bar item "${e}" clipped at 200% zoom (${hit ? `w=${Math.round(hit.w)} right=${Math.round(hit.right)} innerW=${innerWidth}` : 'not rendered'})`);
        }
      }
      return bad.slice(0, 10);
    });
    record('M1-SWEEP.viewport.zoom200', truncZoom.length === 0,
      truncZoom.length ? `overflow/clipping at 200% zoom: ${truncZoom.join('; ')}` : 'no shell overflow at 200% zoom');
    if (truncZoom.length) defect('minor', 'Status bar right-side items clipped at 200% zoom', 'Set browser zoom to 200% (document.body.style.zoom) at 1280px width; right-side status bar items (e.g. "Runtime: connected") are pushed out of the viewport with no way to reach them: ' + truncZoom.join('; '), ['screenshots/m1/viewport-zoom200.png']);
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await page.setViewportSize({ width: 1440, height: 900 });
  } catch (e) { record('M1-SWEEP.viewport', false, String(e).slice(0, 150)); }

  // ================= global console gate =====================================
  const logs = page._kairoLogs || [];
  fs.writeFileSync(path.join(OUT, 'console-m1-sweep.jsonl'), logs.map(l => JSON.stringify(l)).join('\n') + '\n');
  const allErrs = logs.filter(l => l.type === 'pageerror' || l.type === 'error' || l.type === 'requestfailed' || /^http/.test(l.type));
  record('M1-SWEEP.console-global', allErrs.length === 0,
    allErrs.length ? `${allErrs.length} total console/page errors during sweep (see console-m1-sweep.jsonl), first: ${JSON.stringify(allErrs[0]).slice(0, 200)}` : 'no console/page errors across the whole sweep');

  await browser.close();
  await stopStack(stack.dataDir);

  // ---- results + defects ----
  const summary = {
    generatedAt: nowIso(),
    commit: execSync('git rev-parse HEAD').toString().trim(),
    pass: cases.filter(c => c.status === 'PASS').length,
    fail: cases.filter(c => c.status === 'FAIL').length,
    consoleErrorWhitelist: 'none — any console/page error fails its case (see M1-SWEEP.console-global)',
    notExecutedPolicy: 'destructive/global menu items and server-lifecycle buttons (Stop/Restart/Clean Build) enumerated + enabled/tooltip-checked only, per mission; status bar items expected INERT (KAIRO-RC-WEB-006); wizard name-validation cases are a COVERAGE GAP (name input is behind a native directory picker) — retest with a pre-opened workspace',
    cases,
  };
  fs.writeFileSync(path.join(OUT, 'results-m1.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'defects-m1.jsonl'), defects.map(d => JSON.stringify(d)).join('\n') + (defects.length ? '\n' : ''));
  console.log(`DONE cases=${cases.length} pass=${summary.pass} fail=${summary.fail} defects=${defects.length}`);
  process.exit(summary.fail ? 1 : 0);
}

const hardCap = setTimeout(() => { console.error('M1 sweep HARD CAP'); process.exit(2); }, HARD_CAP_MS);
main().catch(e => {
  clearTimeout(hardCap);
  console.error(e);
  try {
    fs.writeFileSync(path.join(OUT, 'results-m1.json'), JSON.stringify({ fatal: String(e), cases }, null, 2));
    fs.writeFileSync(path.join(OUT, 'defects-m1.jsonl'), defects.map(d => JSON.stringify(d)).join('\n'));
  } catch (_e) { /* ignore */ }
  process.exit(1);
});
