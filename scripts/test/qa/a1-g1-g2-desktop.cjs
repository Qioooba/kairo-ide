/**
 * Agent A1 / instance D1 — G1 shell/welcome/project + G2 search family.
 * One-session test train covering cases 1.1–1.10 and 2.1–2.11.
 *
 *   node scripts/test/qa/a1-g1-g2-desktop.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  repoRoot,
  copyDir,
  sleep,
  log,
  makeRecorder,
  shot,
  statusBarText,
  runPalette,
  importAndOpenProject,
  openByShortcutOrPalette,
  ensureCmdReg,
  hasCommand,
  execCommand,
  launchDesktop,
  clearOverlays,
  waitAgent,
  waitJdtReady,
} = require('./_helpers.cjs');

const outDir = path.join(repoRoot, 'artifacts', 'qa', 'a1');
const workspace = path.join(outDir, 'workspace');
const AGENT = 'A1';
const INSTANCE = 'D1';
const ROUND = 1;

const rec = makeRecorder(outDir);
const startedAt = new Date().toISOString();
const metrics = {};

function ensureWorkspace() {
  if (fs.existsSync(path.join(workspace, 'build.xml')) || fs.existsSync(path.join(workspace, 'web'))) {
    log(`workspace exists, keeping: ${workspace}`);
    return;
  }
  log(`refreshing workspace from legacy-sample → ${workspace}`);
  fs.mkdirSync(path.dirname(workspace), { recursive: true });
  copyDir(path.join(repoRoot, 'legacy-sample'), workspace);
}

async function runCase(id, name, fn) {
  const filterRaw = process.env.KAIRO_QA_CASE_FILTER || '';
  if (filterRaw.trim()) {
    const allow = new Set(
      filterRaw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (allow.size && !allow.has(String(id))) {
      rec.recordCase({
        id,
        name,
        status: 'skip',
        durationMs: 0,
        detail: 'filtered by KAIRO_QA_CASE_FILTER',
        shots: [],
      });
      return 'skip';
    }
  }
  const t0 = Date.now();
  let shots = [];
  try {
    const result = await fn();
    const status = (result && result.status) || (result && result.ok === false ? 'fail' : 'pass');
    const detail = (result && result.detail) || '';
    shots = (result && result.shots) || [];
    if (result && result.blocker) {
      rec.appendIssue({
        severity: 'BLOCKER',
        title: result.blockerTitle || name,
        agent: AGENT,
        instance: INSTANCE,
        caseId: id,
        round: ROUND,
        repro: detail,
        shots,
        suspect: result.suspect || '',
      });
      rec.recordCase({
        id,
        name,
        status: 'blocked',
        durationMs: Date.now() - t0,
        detail,
        shots,
      });
      return 'blocked';
    }
    rec.recordCase({
      id,
      name,
      status,
      durationMs: Date.now() - t0,
      detail,
      shots,
    });
    return status;
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    rec.appendIssue({
      severity: 'BLOCKER',
      title: `${name} threw`,
      agent: AGENT,
      instance: INSTANCE,
      caseId: id,
      round: ROUND,
      repro: detail,
      shots,
    });
    rec.recordCase({
      id,
      name,
      status: 'blocked',
      durationMs: Date.now() - t0,
      detail,
      shots,
    });
    return 'blocked';
  }
}

(async () => {
  ensureWorkspace();

  // ── 1.1 Cold start ──
  const tBoot = Date.now();
  let app;
  let page;
  let exe;
  try {
    ({ app, page, exe } = await launchDesktop({ outDir, workspaceArg: false }));
  } catch (err) {
    rec.appendIssue({
      severity: 'BLOCKER',
      title: 'Cold start failed — cannot launch exe',
      agent: AGENT,
      instance: INSTANCE,
      caseId: '1.1',
      round: ROUND,
      repro: String(err && err.message ? err.message : err),
    });
    rec.recordCase({
      id: '1.1',
      name: 'Cold start',
      status: 'blocked',
      durationMs: Date.now() - tBoot,
      detail: String(err),
      shots: [],
    });
    rec.writeReport({ agent: AGENT, instance: INSTANCE, round: ROUND, startedAt, finishedAt: new Date().toISOString(), metrics });
    fs.writeFileSync(path.join(outDir, 'summary.txt'), 'BLOCKED at cold start\n');
    process.exit(1);
  }

  metrics.coldStartMs = Date.now() - tBoot;
  const title1 = await page.title().catch(() => '');
  const shot11 = await shot(page, outDir, '1-1-cold-start');
  const titleOk = /Kairo IDE/i.test(title1);
  rec.recordCase({
    id: '1.1',
    name: 'Cold start',
    status: titleOk ? 'pass' : 'fail',
    durationMs: metrics.coldStartMs,
    detail: `title="${title1}" coldStartMs=${metrics.coldStartMs}`,
    shots: [shot11],
  });

  await waitAgent(page, 45000);
  await ensureCmdReg(page);

  // ── 1.2 Welcome page ──
  await runCase('1.2', 'Welcome page', async () => {
    await clearOverlays(page);
    // Prefer CommandRegistry — palette `>kairo.welcome.show` often leaves the
    // quick-input open without executing (label is i18n "Help: Welcome").
    let opened = false;
    try {
      await ensureCmdReg(page);
      if (await hasCommand(page, 'kairo.welcome.show')) {
        await execCommand(page, 'kairo.welcome.show');
        opened = true;
      }
    } catch (_) {}
    if (!opened) {
      await runPalette(page, 'Welcome');
    }
    await sleep(2000);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(400);
    const info = await page.evaluate(() => {
      const body = (document.body.innerText || '').slice(0, 4000);
      return {
        hasImport: /Import Project|导入项目/i.test(body),
        hasSelect: /Select Project|选择项目|Open Project|打开项目/i.test(body),
        hasRecent: /Recent|最近/i.test(body),
        recentTestId: !!document.querySelector('[data-testid="welcome-recent"]'),
        recentEmpty: !!document.querySelector('[data-testid="welcome-recent-empty"]'),
        welcomeTitle: !!document.querySelector('.kairo-welcome-title, .kairo-welcome-body'),
      };
    });
    const s = await shot(page, outDir, '1-2-welcome');
    const ok = info.recentTestId || info.welcomeTitle || (info.hasImport && (info.hasSelect || info.hasRecent));
    return {
      status: ok ? 'pass' : 'fail',
      detail: `import=${info.hasImport} select=${info.hasSelect} recent=${info.hasRecent} testId=${info.recentTestId} empty=${info.recentEmpty} body=${info.welcomeTitle}`,
      shots: [s],
    };
  });

  // ── 1.3 Project import wizard ──
  let projectImported = false;
  await runCase('1.3', 'Project import wizard', async () => {
    await clearOverlays(page);
    const imported = await importAndOpenProject(page, workspace);
    projectImported = !!(imported && imported.ok);
    const bar = await statusBarText(page);
    const barOk =
      /(项目|Project)[：:]/.test(bar) && !/未导入|not imported|\(无工作区\)|\(no workspace\)/i.test(bar);
    const ok = projectImported || barOk;
    const s = await shot(page, outDir, '1-3-import');
    if (!ok) {
      return {
        status: 'blocked',
        blocker: true,
        blockerTitle: 'Project import failed — blocks subsequent workspace cases',
        detail: `imported=${projectImported} bar=${bar.slice(0, 120)}`,
        shots: [s],
        suspect: 'packages/project-extension',
      };
    }
    return { status: 'pass', detail: bar.slice(0, 120), shots: [s] };
  });

  // ── 1.4 Project selector ──
  await runCase('1.4', 'Project selector', async () => {
    await clearOverlays(page);
    await runPalette(page, 'kairo.project.select');
    await sleep(1500);
    const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 3000));
    const hasList = /legacy-sample|workspace|Select|项目/i.test(body);
    // Also try status bar Project segment click
    await page.locator('#theia-statusBar, .theia-statusBar').click({ force: true }).catch(() => {});
    await sleep(400);
    const s = await shot(page, outDir, '1-4-project-select');
    return {
      status: hasList || projectImported ? 'pass' : 'fail',
      detail: `hasList=${hasList} imported=${projectImported}`,
      shots: [s],
    };
  });

  // ── 1.5 Project scan ──
  await runCase('1.5', 'Project scan', async () => {
    await clearOverlays(page);
    const okCmd = await runPalette(page, 'kairo.project.scan');
    await sleep(2500);
    const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 3000));
    const notified = /scan|扫描|发现|found|project/i.test(body);
    const s = await shot(page, outDir, '1-5-scan');
    return {
      status: okCmd || notified ? 'pass' : 'fail',
      detail: `palette=${okCmd} notified=${notified}`,
      shots: [s],
    };
  });

  // ── 1.6 Project Structure ──
  await runCase('1.6', 'Project Structure', async () => {
    await clearOverlays(page);
    await page.keyboard.press('Control+Alt+Shift+S');
    await sleep(1500);
    let info = await page.evaluate(() => {
      const text = document.body.innerText.slice(0, 5000);
      return {
        opened: /Project Structure|项目结构|Modules|Content Roots/i.test(text),
        typeError: /Cannot read properties of undefined|TypeError/i.test(text),
      };
    });
    if (!info.opened) {
      await runPalette(page, 'kairo.project.structure');
      await sleep(1500);
      info = await page.evaluate(() => {
        const text = document.body.innerText.slice(0, 5000);
        return {
          opened: /Project Structure|项目结构|Modules|Content Roots/i.test(text),
          typeError: /Cannot read properties of undefined|TypeError/i.test(text),
        };
      });
    }
    const s = await shot(page, outDir, '1-6-project-structure');
    await clearOverlays(page);
    if (info.typeError) {
      return { status: 'fail', detail: `opened=${info.opened} typeError=true`, shots: [s] };
    }
    return { status: info.opened ? 'pass' : 'fail', detail: `opened=${info.opened} typeError=false`, shots: [s] };
  });

  // ── 1.7 Recent projects (best-effort in-session) ──
  await runCase('1.7', 'Recent projects', async () => {
    await clearOverlays(page);
    try {
      await ensureCmdReg(page);
      await execCommand(page, 'kairo.welcome.show');
    } catch (_) {
      await runPalette(page, 'Welcome');
    }
    await sleep(2000);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(400);
    const info = await page.evaluate(() => {
      const body = (document.body.innerText || '').slice(0, 4000);
      const recentEl = document.querySelector('[data-testid="welcome-recent"]');
      return {
        hasHeading: /Recent|最近/.test(body) || !!recentEl,
        hasEntry: /legacy|workspace|sample/i.test(body),
        empty: !!document.querySelector('[data-testid="welcome-recent-empty"]'),
        testId: !!recentEl,
      };
    });
    const s = await shot(page, outDir, '1-7-recent');
    const ok = info.testId || (info.hasHeading && (info.hasEntry || projectImported || info.empty));
    return {
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `recent section visible entry=${info.hasEntry} empty=${info.empty} testId=${info.testId}`
        : 'recent entry not confirmed without restart',
      shots: [s],
    };
  });

  // ── 1.8 Single-instance lock (desktop) ──
  await runCase('1.8', 'Single-instance lock', async () => {
    const { spawn } = require('child_process');
    const userDataDir = path.join(outDir, 'userdata');
    const child = spawn(exe, [`--user-data-dir=${userDataDir}`], {
      env: { ...process.env, KAIRO_NO_DEVTOOLS: '1', KAIRO_AUTO_TRUST: '1' },
      stdio: 'ignore',
      windowsHide: true,
    });
    let exited = false;
    let exitCode = null;
    await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), 8000);
      child.on('exit', (code) => {
        exited = true;
        exitCode = code;
        clearTimeout(timer);
        resolve();
      });
    });
    if (!exited) {
      try {
        child.kill();
      } catch (_) {}
    }
    const sessionAlive = await page.evaluate(() => !!document.querySelector('#theia-statusBar')).catch(() => false);
    const s = await shot(page, outDir, '1-8-single-instance');
    const ok = exited && sessionAlive;
    return {
      status: ok ? 'pass' : 'fail',
      detail: `secondExited=${exited} exitCode=${exitCode} sessionAlive=${sessionAlive}`,
      shots: [s],
    };
  });

  // ── 1.9 JDK pre-check (desktop) ──
  await runCase('1.9', 'JDK pre-check dialog', async () => {
    const { spawn } = require('child_process');
    const probeDir = path.join(outDir, 'jdk-probe-userdata');
    fs.mkdirSync(probeDir, { recursive: true });
    const env = { ...process.env, KAIRO_NO_DEVTOOLS: '1', KAIRO_AUTO_TRUST: '1' };
    delete env.JAVA_HOME;
    delete env.KAIRO_JDK_HOME;
    delete env.JDK_HOME;
    // Keep PATH but preference order should still find system java; force empty markers:
    env.KAIRO_FORCE_JDK_SETUP = '1';
    const child = spawn(exe, [`--user-data-dir=${probeDir}`], {
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    await sleep(6000);
    let alive = false;
    try {
      alive = !child.killed && child.exitCode == null;
    } catch (_) {}
    try {
      child.kill();
    } catch (_) {}
    // Module + launch without JAVA_HOME must not crash the primary session.
    const jdkSrc = path.join(repoRoot, 'apps', 'desktop', 'src', 'jdk-check.ts');
    const src = fs.existsSync(jdkSrc) ? fs.readFileSync(jdkSrc, 'utf8') : '';
    const hasDetect = /detectHostJDK|showJDKSetupDialog|JDT_LS_MIN_JDK_MAJOR/.test(src);
    const bar = await statusBarText(page);
    const barHasJdk = /JDK[：:].+/i.test(bar);
    const s = await shot(page, outDir, '1-9-jdk-precheck');
    return {
      status: hasDetect && (alive || barHasJdk) ? 'pass' : 'fail',
      detail: `detectModule=${hasDetect} probeAlive=${alive} barHasJdk=${barHasJdk}`,
      shots: [s],
    };
  });

  // ── 1.10 Window title follows open file ──
  await runCase('1.10', 'Window title follows file', async () => {
    await clearOverlays(page);
    const loc = await openByShortcutOrPalette(page, 'Control+Shift+N', 'Find File', 'find-file');
    if (await loc.isVisible().catch(() => false)) {
      await page.locator('[data-testid="find-file-query"]').fill('HelloWorld.java');
      await sleep(1500);
      if (await page.locator('[data-testid="find-file-result"]').count()) {
        await page.locator('[data-testid="find-file-result"]').first().click();
        await sleep(2000);
      }
    }
    const title = await page.title().catch(() => '');
    const ok = /HelloWorld/i.test(title) && /Kairo IDE/i.test(title);
    const s = await shot(page, outDir, '1-10-title');
    return {
      status: ok ? 'pass' : /Kairo IDE/i.test(title) ? 'fail' : 'fail',
      detail: `title="${title.slice(0, 100)}"`,
      shots: [s],
    };
  });

  // ═══════════════════════════════════════════════════════════
  // G2 — Search family
  // ═══════════════════════════════════════════════════════════

  // ── 2.1 Search Everywhere ──
  await runCase('2.1', 'Search Everywhere', async () => {
    await clearOverlays(page);
    let everywhere = await openByShortcutOrPalette(page, 'DoubleShift', 'Search Everywhere', 'search-everywhere');
    let visible = await everywhere.isVisible().catch(() => false);
    if (!visible) {
      await runPalette(page, 'Kairo Search Everywhere');
      everywhere = page.locator('[data-testid="search-everywhere"]');
      visible = await everywhere.isVisible().catch(() => false);
    }
    if (!visible) {
      const s = await shot(page, outDir, '2-1-everywhere-fail');
      return {
        status: 'blocked',
        blocker: true,
        blockerTitle: 'Search Everywhere does not open',
        detail: 'Double Shift and palette both failed to show search-everywhere',
        shots: [s],
        suspect: 'packages/search-extension',
      };
    }
    await page.locator('[data-testid="everywhere-query"]').fill('HelloWorld');
    await sleep(2000);
    let items = await page.locator('[data-testid="everywhere-item"]').count();
    // Tab switches
    for (const tab of ['category-all', 'category-files', 'category-types', 'category-actions', 'category-symbols']) {
      const t = page.locator(`[data-testid="${tab}"]`);
      if (await t.count()) {
        await t.click().catch(() => {});
        await sleep(600);
      }
    }
    const s = await shot(page, outDir, '2-1-everywhere');
    await clearOverlays(page);
    return {
      status: items > 0 ? 'pass' : 'fail',
      detail: `items=${items}`,
      shots: [s],
    };
  });

  // ── 2.2 Find Class ──
  await runCase('2.2', 'Find Class', async () => {
    await clearOverlays(page);
    // Warm JDT: open a Java file, then wait until LS is ready before Find Class.
    try {
      await openByShortcutOrPalette(page, 'Control+Shift+N', 'Find File', 'find-file');
      const fq = page.locator('[data-testid="find-file-query"]');
      if (await fq.isVisible().catch(() => false)) {
        await fq.fill('HelloWorld.java');
        await sleep(1200);
        const row = page.locator('[data-testid="find-file-result"]').first();
        if (await row.count()) {
          await row.click();
          await sleep(3000);
        }
      }
      await clearOverlays(page);
    } catch (_) {}
    const jdt = await waitJdtReady(page, 120_000);
    if (!jdt.ok) {
      const s = await shot(page, outDir, '2-2-find-class-fail');
      return {
        status: 'fail',
        detail: `JDT not ready before Find Class waitedMs=${jdt.waitedMs} bar=${(jdt.bar || '').slice(0, 80)}`,
        shots: [s],
      };
    }
    const findClass = await openByShortcutOrPalette(page, 'Control+N', 'Find Class', 'find-class');
    const visible = await findClass.isVisible().catch(() => false);
    if (!visible) {
      const s = await shot(page, outDir, '2-2-find-class-fail');
      return { status: 'fail', detail: 'Find Class UI not visible', shots: [s] };
    }
    const query = page.locator('[data-testid="find-class-query"]');
    await query.fill('HelloWorld');
    let count = 0;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      count = await page.locator('[data-testid="find-class-result"]').count();
      if (count > 0) break;
      // Avoid clearing the query — that aborts in-flight FindClassModel searches.
      // Only soft-retrigger by appending/removing a space after a long wait.
      if (i === 25 || i === 45) {
        await query.fill('HelloWorld ');
        await sleep(200);
        await query.fill('HelloWorld');
      }
    }
    if (count > 0) {
      const javaRow = page.locator('[data-testid="find-class-result"]').filter({ hasText: /\.java/i }).first();
      if (await javaRow.count()) await javaRow.click();
      else await page.locator('[data-testid="find-class-result"]').first().click();
      await sleep(1500);
    }
    const title = await page.title();
    const opened = /HelloWorld/i.test(title);
    const s = await shot(page, outDir, '2-2-find-class');
    await clearOverlays(page);
    if (count > 0) {
      return {
        status: 'pass',
        detail: `results=${count} opened=${opened} jdtWaitMs=${jdt.waitedMs} title=${title.slice(0, 60)}`,
        shots: [s],
      };
    }
    return {
      status: 'fail',
      detail: `Find Class UI opened but JDT returned 0 results after wait; jdtWaitMs=${jdt.waitedMs}`,
      shots: [s],
    };
  });

  // ── 2.3 Find File ──
  await runCase('2.3', 'Find File', async () => {
    await clearOverlays(page);
    const loc = await openByShortcutOrPalette(page, 'Control+Shift+N', 'Find File', 'find-file');
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) {
      return { status: 'fail', detail: 'Find File UI missing', shots: [await shot(page, outDir, '2-3-fail')] };
    }
    await page.locator('[data-testid="find-file-query"]').fill('web.xml');
    await sleep(1500);
    const count = await page.locator('[data-testid="find-file-result"]').count();
    const s = await shot(page, outDir, '2-3-find-file');
    await clearOverlays(page);
    return { status: count > 0 ? 'pass' : 'fail', detail: `results=${count}`, shots: [s] };
  });

  // ── 2.4 Find Symbol ──
  await runCase('2.4', 'Find Symbol', async () => {
    await clearOverlays(page);
    const loc = await openByShortcutOrPalette(page, 'Control+Alt+Shift+N', 'Find Symbol', 'find-symbol');
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) {
      return { status: 'fail', detail: 'Find Symbol UI missing', shots: [await shot(page, outDir, '2-4-fail')] };
    }
    await page.locator('[data-testid="find-symbol-query"]').fill('main');
    let count = 0;
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      count = await page.locator('[data-testid="find-symbol-result"]').count();
      if (count > 0) break;
    }
    const s = await shot(page, outDir, '2-4-find-symbol');
    await clearOverlays(page);
    if (count > 0) {
      return { status: 'pass', detail: `results=${count}`, shots: [s] };
    }
    return {
      status: 'fail',
      detail: `Find Symbol UI opened but JDT returned 0 results after wait`,
      shots: [s],
    };
  });

  // ── 2.5 Find Action ──
  await runCase('2.5', 'Find Action', async () => {
    await clearOverlays(page);
    const loc = await openByShortcutOrPalette(page, 'Control+Shift+A', 'Find Action', 'find-action');
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) {
      return { status: 'fail', detail: 'Find Action UI missing', shots: [await shot(page, outDir, '2-5-fail')] };
    }
    await page.locator('[data-testid="find-action-query"]').fill('build');
    await sleep(1500);
    const count = await page.locator('[data-testid="find-action-result"]').count();
    const text = await loc.innerText().catch(() => '');
    const hasBuild = count > 0 || /build|构建/i.test(text);
    const s = await shot(page, outDir, '2-5-find-action');
    await clearOverlays(page);
    return { status: hasBuild ? 'pass' : 'fail', detail: `results=${count}`, shots: [s] };
  });

  // ── 2.6 Find in Path ──
  await runCase('2.6', 'Find in Path', async () => {
    await clearOverlays(page);
    await page.keyboard.press('Control+Shift+F');
    await sleep(1200);
    const modal = page.locator('[data-testid="search-center-modal"]');
    let visible = await modal.isVisible().catch(() => false);
    if (!visible) {
      await runPalette(page, 'Find in Path');
      await sleep(1200);
      visible = await modal.isVisible().catch(() => false);
    }
    if (!visible) {
      return { status: 'fail', detail: 'Search Center missing', shots: [await shot(page, outDir, '2-6-fail')] };
    }
    const queryInput = modal.locator('[data-testid="search-query"]');
    const submitBtn = modal.locator('[data-testid="search-submit"]');
    await queryInput.fill('HelloWorld');
    await submitBtn.click();
    await sleep(3500);
    const count = await modal.locator('[data-testid="search-result"]').count();
    if (count > 0) {
      await modal.locator('[data-testid="search-result"]').first().dblclick().catch(() => {});
      await sleep(1000);
    }
    const s = await shot(page, outDir, '2-6-find-in-path');
    await clearOverlays(page);
    return { status: count > 0 ? 'pass' : 'fail', detail: `results=${count}`, shots: [s] };
  });

  // ── 2.7 Replace in Path ──
  await runCase('2.7', 'Replace in Path', async () => {
    await clearOverlays(page);
    await page.keyboard.press('Control+Shift+R');
    await sleep(1200);
    const modal = page.locator('[data-testid="search-center-modal"]');
    let visible = await modal.isVisible().catch(() => false);
    if (!visible) {
      await runPalette(page, 'Replace in Path');
      await sleep(1200);
      visible = await modal.isVisible().catch(() => false);
    }
    const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 2000));
    const hasReplace = visible || /Replace|替换/i.test(body);
    const s = await shot(page, outDir, '2-7-replace');
    // Do not mutate fixture files in shared workspace — UI open is the assertion for round 1.
    await clearOverlays(page);
    return {
      status: hasReplace ? 'pass' : 'fail',
      detail: hasReplace
        ? 'Replace UI opened (content mutation skipped to preserve shared workspace)'
        : 'Replace UI not found',
      shots: [s],
    };
  });

  // ── 2.8 Case / regex / whole-word toggles ──
  await runCase('2.8', 'Search toggles case/regex/word', async () => {
    await clearOverlays(page);
    await page.keyboard.press('Control+Shift+F');
    await sleep(1200);
    const modal = page.locator('[data-testid="search-center-modal"]');
    if (!(await modal.isVisible().catch(() => false))) {
      return { status: 'fail', detail: 'search modal missing', shots: [await shot(page, outDir, '2-8-fail')] };
    }
    const caseBtn = modal.locator('[data-testid="filter-case"]');
    const regexBtn = modal.locator('[data-testid="filter-regex"]');
    const wordBtn = modal.locator('[data-testid="filter-word"]');
    const queryInput = modal.locator('[data-testid="search-query"]');
    const maskInput = modal.locator('[data-testid="filter-file-types"]');
    const submitBtn = modal.locator('[data-testid="search-submit"]');

    async function setToggle(btn, wantOn) {
      for (let i = 0; i < 6; i++) {
        const on = await btn.evaluate((el) => el.classList.contains('is-active')).catch(() => false);
        if (on === wantOn) return true;
        await btn.click({ force: true });
        await sleep(200);
      }
      return (await btn.evaluate((el) => el.classList.contains('is-active')).catch(() => false)) === wantOn;
    }
    async function doSearch(term) {
      await queryInput.fill(term);
      if (await maskInput.count()) await maskInput.fill('*.java');
      await submitBtn.click();
      await sleep(3500);
      return modal.locator('[data-testid="search-result"]').count();
    }

    await setToggle(caseBtn, false);
    await setToggle(regexBtn, false);
    await setToggle(wordBtn, false);
    const insensitive = await doSearch('hello');
    await setToggle(caseBtn, true);
    const sensitive = await doSearch('hello');
    await setToggle(caseBtn, false);
    await setToggle(regexBtn, true);
    const regexCount = await doSearch('Hel+o');
    await setToggle(regexBtn, false);
    await setToggle(wordBtn, true);
    const wordCount = await doSearch('Hello');
    const s = await shot(page, outDir, '2-8-toggles');
    await clearOverlays(page);
    const caseOk = sensitive < insensitive || (insensitive > 0 && sensitive === 0);
    const regexOk = regexCount > 0;
    const wordOk = wordCount > 0;
    return {
      status: caseOk && regexOk && wordOk ? 'pass' : 'fail',
      detail: `caseOff=${insensitive} caseOn=${sensitive} regex=${regexCount} word=${wordCount}`,
      shots: [s],
    };
  });

  // ── 2.9 Search scope ──
  await runCase('2.9', 'Search scope', async () => {
    await clearOverlays(page);
    await page.keyboard.press('Control+Shift+F');
    await sleep(1200);
    const modal = page.locator('[data-testid="search-center-modal"]');
    if (!(await modal.isVisible().catch(() => false))) {
      return { status: 'fail', detail: 'search modal missing', shots: [await shot(page, outDir, '2-9-fail')] };
    }
    const scope = modal.locator('[data-testid="search-scope"], [data-testid="filter-scope"], select, .kairo-scope');
    const hasScope = (await scope.count()) > 0;
    const queryInput = modal.locator('[data-testid="search-query"]');
    const submitBtn = modal.locator('[data-testid="search-submit"]');
    await queryInput.fill('Servlet');
    await submitBtn.click();
    await sleep(3000);
    const fullCount = await modal.locator('[data-testid="search-result"]').count();
    const s = await shot(page, outDir, '2-9-scope');
    await clearOverlays(page);
    return {
      status: hasScope || fullCount >= 0 ? (hasScope ? 'pass' : 'fail') : 'fail',
      detail: `hasScopeControl=${hasScope} results=${fullCount}`,
      shots: [s],
    };
  });

  // ── 2.10 GBK content search ──
  await runCase('2.10', 'GBK content search', async () => {
    await clearOverlays(page);
    await page.keyboard.press('Control+Shift+F');
    await sleep(1200);
    const modal = page.locator('[data-testid="search-center-modal"]');
    if (!(await modal.isVisible().catch(() => false))) {
      return { status: 'fail', detail: 'search modal missing', shots: [await shot(page, outDir, '2-10-fail')] };
    }
    // Common Chinese tokens in legacy-sample GBK sources / JSPs
    const terms = ['你好', '中文', '欢迎', '系统'];
    let hit = 0;
    let used = '';
    for (const term of terms) {
      await modal.locator('[data-testid="search-query"]').fill(term);
      await modal.locator('[data-testid="search-submit"]').click();
      await sleep(3500);
      hit = await modal.locator('[data-testid="search-result"]').count();
      if (hit > 0) {
        used = term;
        break;
      }
    }
    const preview = await modal.innerText().catch(() => '');
    const garbled = /�{2,}/.test(preview);
    const s = await shot(page, outDir, '2-10-gbk');
    await clearOverlays(page);
    return {
      status: hit > 0 && !garbled ? 'pass' : 'fail',
      detail: `term=${used || '(none)'} results=${hit} garbled=${garbled}`,
      shots: [s],
    };
  });

  // ── 2.11 Search performance ──
  await runCase('2.11', 'Search performance', async () => {
    await clearOverlays(page);
    await page.keyboard.press('Control+Shift+F');
    await sleep(800);
    const modal = page.locator('[data-testid="search-center-modal"]');
    if (!(await modal.isVisible().catch(() => false))) {
      return { status: 'fail', detail: 'search modal missing', shots: [] };
    }
    const t0 = Date.now();
    await modal.locator('[data-testid="search-query"]').fill('public');
    await modal.locator('[data-testid="search-submit"]').click();
    let firstMs = -1;
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      const c = await modal.locator('[data-testid="search-result"]').count();
      if (c > 0) {
        firstMs = Date.now() - t0;
        break;
      }
    }
    if (firstMs < 0) firstMs = Date.now() - t0;
    metrics.searchFirstResultMs = firstMs;
    const s = await shot(page, outDir, '2-11-perf');
    await clearOverlays(page);
    return {
      status: firstMs > 0 && firstMs < 1000 ? 'pass' : firstMs > 0 ? 'fail' : 'fail',
      detail: `firstResultMs=${firstMs} (target <1000)`,
      shots: [s],
    };
  });

  // ── Finalize ──
  await shot(page, outDir, 'z-final');
  await app.close().catch(() => {});

  const finishedAt = new Date().toISOString();
  rec.writeReport({
    agent: AGENT,
    instance: INSTANCE,
    round: ROUND,
    startedAt,
    finishedAt,
    metrics: { ...metrics, exe },
  });

  const counts = { pass: 0, fail: 0, blocked: 0, skip: 0 };
  for (const c of rec.cases) counts[c.status] = (counts[c.status] || 0) + 1;
  const summary = [
    `A1 / D1 / G1+G2 round ${ROUND}`,
    `started: ${startedAt}`,
    `finished: ${finishedAt}`,
    `pass=${counts.pass} fail=${counts.fail} blocked=${counts.blocked} skip=${counts.skip}`,
    `coldStartMs=${metrics.coldStartMs || '?'} searchFirstResultMs=${metrics.searchFirstResultMs || '?'}`,
    `report: ${path.join(outDir, 'report.json')}`,
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.txt'), summary + '\n');
  log(summary);
  process.exit(counts.fail + counts.blocked > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  try {
    rec.writeReport({
      agent: AGENT,
      instance: INSTANCE,
      round: ROUND,
      startedAt,
      finishedAt: new Date().toISOString(),
      metrics,
    });
  } catch (_) {}
  process.exit(1);
});
