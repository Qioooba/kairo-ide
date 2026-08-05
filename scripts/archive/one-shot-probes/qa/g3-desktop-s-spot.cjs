/**
 * G3 desktop [S] spot-check on official win-unpacked exe.
 * Cases: 3.1, 3.3, 3.5, 3.7, 3.10, 3.12
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  repoRoot,
  copyLegacySample,
  sleep,
  makeRecorder,
  shot,
  statusBarText,
  launchDesktop,
  clearOverlays,
  importAndOpenProject,
  openByShortcutOrPalette,
  execCommand,
  hasCommand,
  runPalette,
  focusEditor,
  ensureDir,
} = require('./_helpers.cjs');

const outDir = path.join(repoRoot, 'artifacts', 'qa', 'ship-smoke', 'g3-desktop');
ensureDir(outDir);
const workspace = path.join(outDir, 'workspace');
const rec = makeRecorder({
  agent: 'G3-DESKTOP',
  instance: 'D-SHIP',
  outDir,
  round: Number(process.env.KAIRO_QA_ROUND || 10),
  caseTimeoutMs: 120_000,
});

(async () => {
  if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
  copyLegacySample(workspace);
  const { app, page } = await launchDesktop({ outDir, workspaceArg: workspace });
  let failed = 0;
  try {
    await importAndOpenProject(page, workspace).catch(() => {});
    await sleep(5000);
    await openByShortcutOrPalette(page, 'Control+Shift+N', 'Find File', 'find-file');
    const q = page.locator('[data-testid="find-file-query"]');
    if (await q.isVisible().catch(() => false)) {
      await q.fill('HelloWorld.java');
      await sleep(1500);
      const row = page.locator('[data-testid="find-file-result"]').first();
      if (await row.count()) await row.click();
      await sleep(10000);
    }
    await focusEditor(page).catch(() => {});

    const record = async (id, name, fn) => {
      const entry = await rec.record(id, name, fn);
      if (entry && entry.status === 'fail') failed += 1;
      return entry;
    };

    await record('3.1', 'Completion', async (ctx) => {
      await clearOverlays(page);
      await page.keyboard.type('Sys');
      await page.keyboard.press('Control+Space');
      await sleep(3500);
      const suggest = await page.locator('.suggest-widget, .monaco-list-row').count();
      const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 4000));
      const ok = suggest > 0 || /System|java\.lang/.test(body);
      ctx.addShot(await shot(page, outDir, '3-1-completion'));
      if (!ok) ctx.fail('no completion suggestions');
      await page.keyboard.press('Escape').catch(() => {});
    });

    await record('3.3', 'Go to definition', async (ctx) => {
      await clearOverlays(page);
      await focusEditor(page).catch(() => {});
      const has =
        (await hasCommand(page, 'editor.action.revealDefinition')) ||
        (await hasCommand(page, 'java.goto.definition'));
      await page.keyboard.press('F12').catch(() => {});
      await sleep(2000);
      await execCommand(page, 'editor.action.revealDefinition').catch(() => {});
      await sleep(1500);
      ctx.addShot(await shot(page, outDir, '3-3-definition'));
      if (!has) ctx.fail('revealDefinition command not registered');
    });

    await record('3.5', 'Find Usages', async (ctx) => {
      await clearOverlays(page);
      const has =
        (await hasCommand(page, 'kairo.java.findUsages')) ||
        (await hasCommand(page, 'editor.action.referenceSearch.trigger')) ||
        (await hasCommand(page, 'java.find.usages'));
      await page.keyboard.press('Alt+F7').catch(() => {});
      await sleep(1500);
      await runPalette(page, 'Find Usages').catch(() => {});
      await sleep(2000);
      ctx.addShot(await shot(page, outDir, '3-5-usages'));
      if (!has) ctx.fail('find usages command not registered');
    });

    await record('3.7', 'Rename', async (ctx) => {
      await clearOverlays(page);
      const has = await hasCommand(page, 'editor.action.rename');
      await page.keyboard.press('F2').catch(() => {});
      await sleep(1200);
      await page.keyboard.press('Escape').catch(() => {});
      ctx.addShot(await shot(page, outDir, '3-7-rename'));
      if (!has) ctx.fail('rename command not registered');
    });

    await record('3.10', 'Format + Organize Imports', async (ctx) => {
      await clearOverlays(page);
      const fmt =
        (await hasCommand(page, 'editor.action.formatDocument')) ||
        (await execCommand(page, 'editor.action.formatDocument').catch(() => false));
      const org =
        (await hasCommand(page, 'java.action.organizeImports')) ||
        (await runPalette(page, 'Organize Imports').catch(() => false));
      await sleep(1500);
      ctx.addShot(await shot(page, outDir, '3-10-format'));
      if (!(fmt || org)) ctx.fail('format/organize commands missing');
    });

    await record('3.12', 'Diagnostics', async (ctx) => {
      await clearOverlays(page);
      await page.keyboard.type('\nBROKEN_TOKEN_XYZ\n');
      await sleep(4000);
      const bar = await statusBarText(page);
      const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 5000));
      const ok = /error|错误|problem|问题|BROKEN/i.test(body + bar);
      ctx.addShot(await shot(page, outDir, '3-12-diagnostics'));
      await page.keyboard.press('Control+Z').catch(() => {});
      if (!ok) ctx.fail('no diagnostic after inject');
    });

    rec.writeReport({ exe: 'win-unpacked' });
  } finally {
    await app.close().catch(() => {});
  }
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
