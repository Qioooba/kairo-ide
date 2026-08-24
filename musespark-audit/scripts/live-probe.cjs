/**
 * MuseSpark Live Probe — 活体前端加载诊断
 * 打开 18301，等待前端 shell，记录 console 错误与 DOM 结构
 */
'use strict';
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 200)); });
  page.on('pageerror', err => errors.push(`PAGEERROR: ${err.message.slice(0, 300)}`));

  console.log('goto...');
  await page.goto('http://127.0.0.1:18301', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 等待任意 theia 标记
  for (const sel of ['#theia-app-shell', '.theia-shell', '#theia-main-content-panel', '.lm-Widget', 'body *']) {
    try { await page.waitForSelector(sel, { state: 'attached', timeout: 8000 }); console.log('FOUND:', sel); break; } catch { console.log('miss:', sel); }
  }
  await new Promise(r => setTimeout(r, 15000));
  const html = await page.evaluate(() => ({
    bodyChildren: document.body.children.length,
    hasAppShell: !!document.getElementById('theia-app-shell'),
    hasShell: document.querySelectorAll('.theia-shell').length,
    hasMain: document.querySelectorAll('#theia-main-content-panel').length,
    preload: document.querySelectorAll('.theia-preload').length,
    bodyClass: document.body.className.slice(0, 100),
    firstDivs: Array.from(document.body.children).slice(0, 5).map(c => `${c.tagName}.${c.className}`.slice(0, 80)),
  }));
  console.log('DOM:', JSON.stringify(html, null, 2));
  console.log('CONSOLE ERRORS (first 10):');
  errors.slice(0, 10).forEach(e => console.log(' -', e));
  await page.screenshot({ path: 'musespark-audit/screenshots/fullpage/00-live-probe.png' });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
