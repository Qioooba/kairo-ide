import { test } from '@playwright/test';
import { openIde } from './helpers';
test('debug codelens', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openIde(page);
  await page.waitForTimeout(3000);
  await page.keyboard.press('F1');
  const input = page.locator('.quick-input-widget .quick-input-box input').first();
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill('HelloWorld.java');
  await page.waitForTimeout(1500);
  const row = page.locator('.quick-input-widget .monaco-list-row', { hasText: 'HelloWorld.java' }).first();
  await row.click();
  await page.waitForTimeout(5000);
  const lenses = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.monaco-codelens-widget .codelens-decoration a, .monaco-codelens-widget .codelens-decoration'))
      .map(e => e.textContent?.trim() ?? '').filter(Boolean),
  );
  console.log('codelenses', JSON.stringify(lenses));
  const body = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('body head', body.slice(0, 200));
  await page.waitForTimeout(2000);
  const lenses2 = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.monaco-codelens-widget'))
      .map(e => e.textContent?.trim() ?? '').filter(Boolean),
  );
  console.log('codelens widgets', JSON.stringify(lenses2));
  await ctx.close();
});
