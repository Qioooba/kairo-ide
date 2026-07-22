// Probe: do Kairo palette commands actually open their widgets? (keyboard-flow FAILs)
'use strict';
const path = require('path');
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog,
  waitForStatusBarContains, ensureDir, sleep,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa.SOUdxO';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'probe-palette-commands'));

const CASES = [
  { query: 'Kairo: Import Project', widgetHint: 'import' },
  { query: 'Kairo: Select Project', widgetHint: 'selector' },
  { query: 'Kairo: Show Builds', widgetHint: 'build' },
  { query: 'Kairo: Show Servers', widgetHint: 'server' },
];

async function main() {
  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'probe-palette-stack'), port: 19090, webPort: 13900, skipBuild: true });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/?kairoAgent=${encodeURIComponent('http://127.0.0.1:19090')}`;
  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  let failed = 0;
  for (const c of CASES) {
    // open palette, check the command is listed
    await page.keyboard.press('F1');
    await sleep(800);
    await page.keyboard.type(c.query);
    await sleep(800);
    const items = await page.locator('.monaco-list-row').allTextContents().catch(() => []);
    const matched = items.some(t => t.includes(c.query.replace(/^Kairo: /, '')) || t.includes(c.query));
    await page.screenshot({ path: path.join(OUT, `palette-${c.widgetHint}.png`) });
    await page.keyboard.press('Enter');
    await sleep(2500);
    // widget visible anywhere in shell?
    const widgetVisible = await page.evaluate((hint) => {
      const shells = document.querySelectorAll('#theia-app-shell [id], #theia-app-shell [class]');
      for (const el of shells) {
        const id = (el.id || '').toLowerCase();
        if (id.includes(`kairo-${hint}`) || id.includes(`kairo-${hint}-view`) || id.includes(`kairo-${hint}-widget`)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { ok: true, id: el.id };
        }
      }
      // also accept tab titles
      const tabs = [...document.querySelectorAll('.p-TabBar-tabLabel')].map(t => t.textContent || '');
      return { ok: false, tabs };
    }, c.widgetHint);
    const focusTag = await page.evaluate(() => document.activeElement?.tagName);
    const ok = matched && widgetVisible.ok;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.query} — paletteMatch=${matched} widget=${JSON.stringify(widgetVisible)} focus=${focusTag}`);
    if (!ok) failed++;
    await page.screenshot({ path: path.join(OUT, `after-${c.widgetHint}.png`) });
    // close whatever opened
    await page.keyboard.press('Escape');
    await page.keyboard.down('Meta'); await page.keyboard.press('w'); await page.keyboard.up('Meta');
    await sleep(600);
  }

  await browser.close();
  await stopStack(stack.dataDir);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
