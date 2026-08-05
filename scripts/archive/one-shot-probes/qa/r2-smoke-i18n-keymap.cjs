/**
 * Round-2 focused smoke: Search Everywhere i18n + Ctrl+Alt+H Call Hierarchy
 * vs SVN History, plus agent-config endpoint sanity.
 *
 *   node scripts/test/qa/r2-smoke-i18n-keymap.cjs --url http://127.0.0.1:3005
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  repoRoot,
  arg,
  ensureDir,
  sleep,
  log,
  shot,
  clearOverlays,
  launchBrowser,
  gotoApp,
  openQuickFile,
  focusEditor,
  waitAgent,
  statusBarText,
} = require('./_helpers.cjs');

const argv = process.argv.slice(2);
const baseUrl = arg(argv, 'url', 'http://127.0.0.1:3005');
const outDir = path.join(repoRoot, 'artifacts', 'qa', 'fix');
ensureDir(outDir);
ensureDir(path.join(outDir, 'shots'));

(async () => {
  const results = [];
  const { browser, page } = await launchBrowser({ headless: true });
  // page already has viewport from helper

  try {
    await gotoApp(page, baseUrl);

    // Agent config endpoint
    const cfg = await page.evaluate(async () => {
      try {
        const r = await fetch('/kairo-agent-config.json', { cache: 'no-store' });
        if (!r.ok) return { ok: false, status: r.status };
        return { ok: true, ...(await r.json()) };
      } catch (e) {
        return { ok: false, err: String(e) };
      }
    });
    const agentBar = await waitAgent(page, 20_000);
    results.push({
      id: 'r2.cfg',
      ok: !!(cfg.ok && cfg.agentUrl && /1810\d/.test(cfg.agentUrl)),
      detail: `cfg=${JSON.stringify(cfg)} barAgent=${agentBar.ok} bar=${(agentBar.bar || '').slice(0, 80)}`,
    });

    // Search Everywhere categories — must not show raw keys
    await clearOverlays(page);
    await page.keyboard.press('Control+Shift+A').catch(() => {});
    await sleep(400);
    await page.keyboard.press('Shift+Shift').catch(() => {});
    await sleep(400);
    // Prefer command
    await page.keyboard.press('Control+Shift+P');
    await sleep(600);
    const qi = page.locator('.quick-input-widget input').first();
    if (await qi.count()) {
      await qi.fill('Search Everywhere');
      await sleep(500);
      await page.keyboard.press('Enter');
      await sleep(1000);
    }
    // Also try Shift+Shift via double shift is flaky — use Ctrl+N / palette label
    await page.keyboard.press('Control+N').catch(() => {});
    await sleep(800);

    let seText = await page.evaluate(() => {
      const root =
        document.querySelector('[data-testid="search-everywhere"], .kairo-search-everywhere, .search-everywhere') ||
        document.body;
      return (root.innerText || '').slice(0, 4000);
    });
    // Open via known command id if needed
    if (!/全部|All|文件|Files|类型|Types/.test(seText)) {
      await page.evaluate(async () => {
        const reg = window.__kairoCmdReg;
        if (reg && typeof reg.executeCommand === 'function') {
          await reg.executeCommand('kairo.search.everywhere');
        }
      }).catch(() => {});
      await sleep(1200);
      seText = await page.evaluate(() => (document.body.innerText || '').slice(0, 5000));
    }
    const leaked = /widget\.search\.everywhere\.category\.(all|files|types|symbols|actions)/.test(seText);
    const hasLabels = /全部|文件|类型|符号|操作|All|Files|Types|Symbols|Actions/.test(seText);
    await shot(page, outDir, 'r2-search-everywhere-i18n');
    results.push({
      id: 'r2.i18n',
      ok: !leaked && hasLabels,
      detail: `leaked=${leaked} hasLabels=${hasLabels} snippet=${seText.replace(/\s+/g, ' ').slice(0, 160)}`,
    });

    // Ctrl+Alt+H with Java editor
    await clearOverlays(page);
    await openQuickFile(page, 'HelloWorld.java');
    await focusEditor(page);
    await sleep(500);
    await page.keyboard.press('Control+Alt+H');
    await sleep(1200);
    const chordUi = await page.evaluate(() => {
      const text = (document.body.innerText || '').slice(0, 8000);
      return {
        callHierarchy: /Call Hierarchy|调用层次|调用层级|Incoming Calls|传入调用/i.test(text),
        svnHistory: /SVN History|SVN 历史|Show History/i.test(text),
        text: text.replace(/\s+/g, ' ').slice(0, 200),
      };
    });
    await shot(page, outDir, 'r2-ctrl-alt-h');
    // Pass if Call Hierarchy visible OR SVN History not exclusively shown
    const chordOk = chordUi.callHierarchy || !chordUi.svnHistory;
    results.push({
      id: 'r2.cah',
      ok: chordOk,
      detail: `callH=${chordUi.callHierarchy} svnH=${chordUi.svnHistory} text=${chordUi.text}`,
    });

    const bar = await statusBarText(page);
    results.push({ id: 'r2.bar', ok: true, detail: bar.slice(0, 120) });
  } catch (e) {
    results.push({ id: 'r2.error', ok: false, detail: String(e && e.message ? e.message : e) });
  } finally {
    await browser.close().catch(() => {});
  }

  const summary = {
    round: 2,
    baseUrl,
    results,
    pass: results.filter((r) => r.ok).length,
    fail: results.filter((r) => !r.ok).length,
  };
  fs.writeFileSync(path.join(outDir, 'r2-smoke.json'), JSON.stringify(summary, null, 2));
  log(`r2 smoke pass=${summary.pass} fail=${summary.fail}`);
  for (const r of results) {
    log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id} — ${r.detail}`);
  }
  process.exit(summary.fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
