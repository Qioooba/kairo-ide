// One-off probe: dump node-level axe violation targets for the shell
// and the Import Wizard against a live stack. Usage:
//   node scripts/_probe-axe-nodes.cjs http://127.0.0.1:3001
'use strict';

const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:3001';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  // dismiss trust dialog if present
  try {
    await page.locator('button', { hasText: 'Yes, I trust the authors' }).click({ timeout: 3000 });
    await page.waitForTimeout(1000);
  } catch (_e) { /* no dialog */ }

  const dump = async label => {
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    console.log(`\n===== ${label} =====`);
    for (const v of res.violations) {
      console.log(`\n[${v.impact}] ${v.id} — ${v.help}`);
      for (const n of v.nodes.slice(0, 6)) {
        console.log('  target:', JSON.stringify(n.target));
        console.log('  html  :', (n.html || '').slice(0, 220));
        console.log('  fix   :', (n.failureSummary || '').split('\n')[0]);
      }
    }
  };

  await dump('shell');
  // open import wizard via command palette (F1, real command label)
  await page.keyboard.press('F1');
  await page.waitForTimeout(500);
  await page.keyboard.type('Kairo: Import Project');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await dump('import-wizard');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
