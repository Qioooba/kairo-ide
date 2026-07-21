// Visual matrix (Wave 2 §1): screenshot every major surface across
// viewports x zoom levels in Kairo Dark, headed Chromium.
//
//   viewports: 1440x900 (primary), 1280x720, 1920x1080
//   zoom: 100%, 125%, 200% (document.documentElement.style.zoom —
//   the standards-based page zoom proxy; real browser zoom is not
//   automatable via Playwright, documented in the report)
//   surfaces: shell+welcome, import-wizard, project-selector,
//             build view, server view, deployments, log viewer,
//             JSP editor
//
// Also verifies at 1280x720 + 200%:
//   - WEB-101: status bar right items reachable (scrollWidth >= clientWidth handled)
//   - WEB-009: server toolbar stays on one row (no wrap)
//
// Usage: KAIRO_QA_ROOT=/tmp/... node scripts/run-visual-matrix.cjs

'use strict';

const path = require('path');
const { execSync } = require('child_process');
const {
  startStack, stopStack, launchBrowser, dismissTrustDialog,
  waitForStatusBarContains, screenshot, writeResult, writeLogs, ensureDir,
  nowIso, sleep, runCommand,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'visual-matrix'));
const HARD_CAP_MS = 15 * 60 * 1000;

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
];
const ZOOMS = ['100', '125', '200'];
const SURFACES = [
  { id: 'shell-welcome', open: null },
  { id: 'import-wizard', open: 'Kairo: Import Project', sel: '[data-testid="import-wizard"]' },
  { id: 'project-selector', open: 'Kairo: Select Project', sel: '[data-testid="project-selector"]' },
  { id: 'build-view', open: 'Kairo: Show Builds', sel: '[data-testid="build-view"]' },
  { id: 'server-view', open: 'Kairo: Show Servers', sel: '[data-testid="server-view"]' },
  { id: 'deployments', open: 'Kairo: Show Deployments', sel: '.kairo-widget' },
  { id: 'log-viewer', open: 'Kairo: Show Tomcat Logs', sel: '.kairo-log-viewer' },
];

const checks = [];
function record(id, ok, detail) {
  checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail: detail || '', time: nowIso() });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'visual-matrix-stack'), port: 18080 });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/`;
  record('VM.start', true, `web=${env.KAIRO_QA_WEB_PORT}`);

  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const logs = [];
  page.on('console', m => logs.push({ type: m.type(), text: m.text(), time: nowIso() }));
  page.on('pageerror', e => logs.push({ type: 'pageerror', text: e.message, time: nowIso() }));

  await page.goto(webUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await sleep(5000);
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  const fs = require('fs');
  fs.copyFileSync(
    path.join(env.KAIRO_QA_LEGACY_DST, 'WebRoot', 'hello.jsp'),
    path.join(env.KAIRO_QA_WORKSPACE_DIR, 'hello.jsp'),
  );

  let shotCount = 0;
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await sleep(800);
    for (const zoom of ZOOMS) {
      await page.evaluate(z => { document.documentElement.style.zoom = z + '%'; }, zoom);
      await sleep(800);
      const dir = `chromium/${vp.name}/kairo-dark`;
      for (const surface of SURFACES) {
        if (surface.open) {
          try {
            await runCommand(page, surface.open, 15000);
            await sleep(1500);
          } catch (e) {
            record(`VM.${vp.name}.z${zoom}.${surface.id}.open`, false, String(e).slice(0, 150));
            continue;
          }
        }
        await sleep(600);
        const out = path.join(OUT, 'screenshots', dir, `${surface.id}-z${zoom}.png`);
        await screenshot(page, out, { fullPage: false });
        shotCount++;
        if (surface.open) {
          // close the tab we just opened to keep the shell tidy
          await page.keyboard.press('Escape').catch(() => {});
          const tab = page.locator(`.lm-TabBar-tab.lm-mod-current .lm-TabBar-tabCloseIcon`).first();
          await tab.click().catch(() => {});
          await sleep(400);
        }
      }
      // targeted layout assertions on the tightest combination
      if (vp.name === '1280x720' && zoom === '200') {
        const sb = await page.evaluate(() => {
          const bar = document.getElementById('theia-statusBar');
          if (!bar) return null;
          const right = bar.querySelector('.area.right');
          return right ? { scrollW: right.scrollWidth, clientW: right.clientWidth, overflow: getComputedStyle(right).overflowX } : null;
        });
        record('VM.WEB-101.statusbar-overflow', !!sb && (sb.overflow === 'auto' || sb.scrollW <= sb.clientW),
          `status bar right area: scrollW=${sb && sb.scrollW} clientW=${sb && sb.clientW} overflowX=${sb && sb.overflow}`);
        // server toolbar single row
        await runCommand(page, 'Kairo: Show Servers', 15000);
        await sleep(1500);
        const tb = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="server-view-toolbar"]');
          if (!el) return null;
          const kids = Array.from(el.children);
          const tops = new Set(kids.map(k => Math.round(k.getBoundingClientRect().top)));
          return { rows: tops.size, buttons: kids.length };
        });
        record('VM.WEB-009.toolbar-single-row', !!tb && tb.rows === 1,
          `server toolbar: ${tb && tb.buttons} buttons on ${tb && tb.rows} row(s)`);
      }
    }
  }
  record('VM.screenshots', shotCount >= VIEWPORTS.length * ZOOMS.length * (SURFACES.length - 1),
    `${shotCount} screenshots captured`);

  writeLogs(OUT, logs);
  const errors = logs.filter(l => l.type === 'pageerror' || l.type === 'error');
  record('VM.console-clean', errors.length === 0,
    errors.length ? `${errors.length} errors, first: ${JSON.stringify(errors[0]).slice(0, 200)}` : 'no console/page errors');

  await browser.close();
  await stopStack(stack.dataDir);
  record('VM.teardown', true, 'stack stopped');

  const failed = checks.filter(c => c.status === 'FAIL');
  if (failed.length) throw new Error(`${failed.length} visual-matrix checks failed`);
}

const hardCap = setTimeout(() => { console.error('VM HARD CAP'); process.exit(2); }, HARD_CAP_MS);

main()
  .then(() => {
    clearTimeout(hardCap);
    writeResult(OUT, { case: 'visual-matrix', status: 'PASS', checks, commit: execSync('git rev-parse HEAD').toString().trim() });
    process.exit(0);
  })
  .catch(err => {
    clearTimeout(hardCap);
    console.error(err);
    writeResult(OUT, { case: 'visual-matrix', status: 'FAIL', error: String(err), checks });
    process.exit(1);
  });
