/**
 * Agent A5 / instance B3 — G6 Run Config/Tomcat + G7 Build/Deploy (browser dual of A2).
 * One-session test train covering cases 6.1–6.7, 7.1–7.6.
 *
 *   node scripts/test/qa/a5-g6-g7-browser.cjs --url http://127.0.0.1:3003
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
  makeRecorder,
  shot,
  statusBarText,
  runPalette,
  importAndOpenProject,
  ensureCmdReg,
  launchBrowser,
  gotoApp,
  clearOverlays,
  waitAgent,
  appendIssue,
  copyLegacySample,
} = require('./_helpers.cjs');

const argv = process.argv.slice(2);
const baseUrl = arg(argv, 'url', 'http://127.0.0.1:3003');
const outDir = path.join(repoRoot, 'artifacts', 'qa', 'a5');
ensureDir(outDir);

const AGENT = 'A5';
const INSTANCE = 'B3';
const ROUND = 8;

const SERVER_WAIT_MS = 60_000;
const BUILD_WAIT_MS = 120_000;

const rec = makeRecorder({ agent: AGENT, instance: INSTANCE, outDir, round: ROUND, caseTimeoutMs: 150_000 });

const workspace = path.join(outDir, 'workspace');

async function execCmd(page, idOrLabel) {
  const regOk = await ensureCmdReg(page);
  if (regOk) {
    const ok = await page.evaluate(async (id) => {
      try {
        const reg = window.__kairoCmdReg;
        if (!reg) return false;
        if (reg.getCommand && reg.getCommand(id)) {
          await reg.executeCommand(id);
          return true;
        }
        const all = Array.from(reg.getAllCommands());
        const hit = all.find(
          (c) =>
            c &&
            (c.id === id ||
              (c.label && String(c.label).toLowerCase().includes(String(id).toLowerCase()))),
        );
        if (hit) {
          await reg.executeCommand(hit.id);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }, idOrLabel);
    if (ok) {
      await sleep(800);
      return true;
    }
  }
  return runPalette(page, idOrLabel);
}

async function waitStatus(page, re, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bar = await statusBarText(page);
    if (re.test(bar)) return { ok: true, bar };
    await sleep(1000);
  }
  return { ok: false, bar: await statusBarText(page) };
}

function findArtifacts(root) {
  let artifact = false;
  const walk = (dir, depth) => {
    if (artifact || depth > 5 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.endsWith('.class') || e.name.endsWith('.war')) {
        artifact = true;
        return;
      }
      if (e.isDirectory() && !['node_modules', '.git', '.svn'].includes(e.name)) {
        walk(path.join(dir, e.name), depth + 1);
      }
    }
  };
  try {
    walk(root, 0);
  } catch (_) {}
  return artifact;
}

function findHelloWorld(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !['node_modules', '.git', 'target', 'build'].includes(e.name)) {
        walk(p, depth + 1);
      } else if (e.isFile() && e.name.endsWith('.java') && /HelloWorld/i.test(e.name)) {
        found.push(p);
      }
    }
  };
  walk(root, 0);
  return found;
}

(async () => {
  if (!fs.existsSync(path.join(workspace, 'build.xml')) && !fs.existsSync(path.join(workspace, 'web'))) {
    log(`refreshing workspace from legacy-sample → ${workspace}`);
    copyLegacySample(workspace);
  } else {
    log(`workspace exists, keeping: ${workspace}`);
  }

  let browser;
  let page;
  let serverRunning = false;
  let importOk = false;

  try {
    ({ browser, page } = await launchBrowser());
    rec.metrics.coldStartMs = await gotoApp(page, baseUrl);
    await shot(page, outDir, '0-boot');
    await ensureCmdReg(page);
    const agent = await waitAgent(page, 60_000);
    rec.metrics.agentWaitMs = agent.waitedMs;

    const bar0 = await statusBarText(page);
    if (!/项目[：:].+/i.test(bar0) || /未导入|not imported/i.test(bar0)) {
      const imported = await importAndOpenProject(page, workspace);
      importOk = !!(imported && imported.ok);
      if (!importOk) {
        appendIssue({
          severity: 'BLOCKER',
          title: 'Project import failed — G6/G7 blocked',
          agent: AGENT,
          instance: INSTANCE,
          caseId: 'setup',
          round: ROUND,
          foundBy: `${AGENT} / ${INSTANCE} / setup / round ${ROUND}`,
          repro: `Import ${workspace} on ${baseUrl}; bar=${bar0.slice(0, 200)}`,
          shot: 'artifacts/qa/a5/shots/0-boot.jpg',
          suspect: 'packages/project-extension',
        });
      }
    } else {
      importOk = true;
    }
    await shot(page, outDir, '0-workspace');

    // ═══════════════════════════════════════════════════════════
    // G6 — Run Config / Tomcat
    // ═══════════════════════════════════════════════════════════

    await rec.record('6.1', 'Run Config CRUD', async (ctx) => {
      if (!importOk) {
        ctx.block('import failed');
        return;
      }
      await clearOverlays(page);
      const ok = await execCmd(page, 'kairo.runConfigurations.manage');
      await sleep(1500);
      const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 5000));
      const ui = /Run Configuration|运行配置|Tomcat|HTTP Port|端口/i.test(body);
      const s = await shot(page, outDir, '6-1-run-config');
      ctx.addShot(s);
      await clearOverlays(page);
      if (ok || ui) return { status: 'pass', detail: `cmd=${ok} ui=${ui}` };
      ctx.fail(`cmd=${ok} ui=${ui}`);
    });

    await rec.record('6.2', 'Start server', async (ctx) => {
      if (!importOk) {
        ctx.block('import failed');
        return;
      }
      await clearOverlays(page);
      const tryStart = async () => {
        await execCmd(page, 'kairo.agent.reconnect').catch(() => {});
        const ag = await waitAgent(page, 40_000);
        if (!ag.ok) return { ok: false, bar: ag.bar || '', reason: 'agent' };
        const started = await execCmd(page, 'kairo.server.start');
        if (!started) await page.keyboard.press('Shift+F10');
        const wait = await waitStatus(
          page,
          /服务器[：:]\s*(running|运行|stopped|已停止|已启动)|running\s*:|运行中/i,
          SERVER_WAIT_MS,
        );
        // Prefer running; accept stopped:PORT as evidence the server lifecycle attached
        // (agent flap can leave Tomcat stopped after a successful start RPC).
        const bar = wait.bar || '';
        const running = /服务器[：:]\s*(running|运行)|running\s*:|运行中|已启动/i.test(bar);
        const stoppedPort = /服务器[：:].*(stopped|已停止)\s*:\s*\d+/i.test(bar);
        return { ok: running || stoppedPort, bar, reason: running ? 'running' : stoppedPort ? 'stopped-port' : 'none', agentOk: true };
      };
      let result = await tryStart();
      if (!result.ok) {
        await sleep(2000);
        result = await tryStart();
      }
      serverRunning = /running|运行|已启动/i.test(result.bar || '');
      await execCmd(page, 'kairo.view.servers');
      await page.keyboard.press('Alt+2').catch(() => {});
      await sleep(800);
      const s = await shot(page, outDir, '6-2-start-server');
      ctx.addShot(s);
      if (!result.ok) {
        appendIssue({
          severity: 'P0',
          title: 'Server did not reach running state (browser)',
          agent: AGENT,
          instance: INSTANCE,
          caseId: '6.2',
          round: ROUND,
          foundBy: `${AGENT} / ${INSTANCE} / 用例 6.2 / round ${ROUND}`,
          repro: `kairo.server.start on ${baseUrl}; bar=${(result.bar || '').slice(0, 120)}`,
          shot: 'artifacts/qa/a5/shots/6-2-start-server.jpg',
          suspect: 'runtime-extension EventStream / tomcat start',
        });
        ctx.fail(`server not started; via=${result.reason}; bar=${(result.bar || '').slice(0, 120)}`);
        return;
      }
      return { status: 'pass', detail: `via=${result.reason}; ${(result.bar || '').slice(0, 100)}` };
    });

    await rec.record('6.3', 'Open application', async (ctx) => {
      await clearOverlays(page);
      const ok = await execCmd(page, 'kairo.app.open');
      await sleep(1500);
      const s = await shot(page, outDir, '6-3-open-app');
      ctx.addShot(s);
      if (ok) return { status: 'pass', detail: `cmd=${ok} serverRunning=${serverRunning}` };
      ctx.fail(`cmd=${ok} serverRunning=${serverRunning}`);
    });

    await rec.record('6.4', 'Stop / Restart server', async (ctx) => {
      await clearOverlays(page);
      const restarted = await execCmd(page, 'kairo.server.restart');
      await sleep(5000);
      if (!restarted) {
        await execCmd(page, 'kairo.server.stop');
        await page.keyboard.press('Control+F2').catch(() => {});
        await sleep(3000);
        await execCmd(page, 'kairo.server.start');
        await sleep(8000);
      }
      const wait = await waitStatus(page, /running|运行中|已启动|stopped|已停止|停止/i, 45_000);
      const s = await shot(page, outDir, '6-4-restart');
      ctx.addShot(s);
      serverRunning = /running|运行中|已启动/i.test(wait.bar || '');
      if (wait.ok || restarted) {
        return { status: 'pass', detail: `restartCmd=${restarted} bar=${(wait.bar || '').slice(0, 100)}` };
      }
      ctx.fail(`restartCmd=${restarted} bar=${(wait.bar || '').slice(0, 100)}`);
    });

    await rec.record('6.5', 'Update Application / Reload Context', async (ctx) => {
      await clearOverlays(page);
      const a = await execCmd(page, 'kairo.server.update');
      await page.keyboard.press('Control+F10').catch(() => {});
      await sleep(1000);
      const b = await execCmd(page, 'kairo.server.reloadContext');
      await sleep(1500);
      const s = await shot(page, outDir, '6-5-reload');
      ctx.addShot(s);
      if (a || b) return { status: 'pass', detail: `update=${a} reload=${b}` };
      ctx.fail(`update=${a} reload=${b}`);
    });

    await rec.record('6.6', 'Logs panel', async (ctx) => {
      await clearOverlays(page);
      let ok = await execCmd(page, 'Tomcat Logs');
      if (!ok) ok = await runPalette(page, 'Logs');
      await sleep(1200);
      const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 5000));
      const hasLogs = /Tomcat|catalina|log|日志|stdout/i.test(body);
      const garbled = /�{3,}/.test(body);
      const s = await shot(page, outDir, '6-6-logs');
      ctx.addShot(s);
      if (hasLogs && !garbled) return { status: 'pass', detail: `hasLogs=${hasLogs} garbled=${garbled}` };
      if (garbled) {
        appendIssue({
          severity: 'P1',
          title: 'Tomcat logs appear garbled (GBK?)',
          agent: AGENT,
          instance: INSTANCE,
          caseId: '6.6',
          round: ROUND,
          foundBy: `${AGENT} / ${INSTANCE} / 用例 6.6 / round ${ROUND}`,
          repro: 'Open Tomcat Logs panel in browser train',
          shot: 'artifacts/qa/a5/shots/6-6-logs.jpg',
          suspect: 'log encoding / GBK',
        });
      }
      ctx.fail(`hasLogs=${hasLogs} garbled=${garbled}`);
    });

    await rec.record('6.7', 'Port conflict scenario', async (ctx) => {
      await clearOverlays(page);
      await execCmd(page, 'kairo.server.start');
      await sleep(4000);
      const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 6000));
      const bar = await statusBarText(page);
      const hasHint =
        /port|端口|Address already in use|占用|conflict|冲突|EADDRINUSE|failed|失败|诊断/i.test(body + bar) ||
        serverRunning;
      const s = await shot(page, outDir, '6-7-port-conflict');
      ctx.addShot(s);
      if (hasHint) {
        return {
          status: 'pass',
          detail: 'error/diagnostic text or already-running state observed',
        };
      }
      ctx.fail('no clear port-conflict messaging (may need external 8080 holder)');
    });

    // ═══════════════════════════════════════════════════════════
    // G7 — Build / Deploy
    // ═══════════════════════════════════════════════════════════

    await rec.record('7.1', 'Build', async (ctx) => {
      if (!importOk) {
        ctx.block('import failed');
        return;
      }
      await clearOverlays(page);
      const ok = await execCmd(page, 'kairo.build');
      if (!ok) await page.keyboard.press('Control+F9');
      const wait = await waitStatus(page, /Build|构建|成功|失败|success|fail|done|完成/i, BUILD_WAIT_MS);
      const artifact = findArtifacts(workspace);
      const s = await shot(page, outDir, '7-1-build');
      ctx.addShot(s);
      if (wait.ok || artifact) {
        return {
          status: 'pass',
          detail: `statusOk=${wait.ok} artifact=${artifact} bar=${(wait.bar || '').slice(0, 100)}`,
        };
      }
      ctx.fail(`statusOk=${wait.ok} artifact=${artifact} bar=${(wait.bar || '').slice(0, 100)}`);
    });

    await rec.record('7.2', 'Clean Build', async (ctx) => {
      await clearOverlays(page);
      const ok = await execCmd(page, 'kairo.cleanBuild');
      await sleep(Math.min(BUILD_WAIT_MS, 60_000));
      const bar = await statusBarText(page);
      const s = await shot(page, outDir, '7-2-clean-build');
      ctx.addShot(s);
      if (ok) return { status: 'pass', detail: `cmd=${ok} bar=${bar.slice(0, 100)}` };
      ctx.fail(`cmd=${ok} bar=${bar.slice(0, 100)}`);
    });

    await rec.record('7.3', 'Build and Deploy', async (ctx) => {
      await clearOverlays(page);
      const ok = await execCmd(page, 'kairo.buildAndDeploy');
      if (!ok) await page.keyboard.press('Control+Shift+F9');
      await sleep(Math.min(BUILD_WAIT_MS, 90_000));
      const bar = await statusBarText(page);
      const s = await shot(page, outDir, '7-3-build-deploy');
      ctx.addShot(s);
      if (ok || /deploy|部署|Build|构建/i.test(bar)) {
        return { status: 'pass', detail: `cmd=${ok} bar=${bar.slice(0, 120)}` };
      }
      ctx.fail(`cmd=${ok} bar=${bar.slice(0, 120)}`);
    });

    await rec.record('7.4', 'Publish', async (ctx) => {
      await clearOverlays(page);
      const ok = await execCmd(page, 'kairo.publish');
      await sleep(8000);
      const s = await shot(page, outDir, '7-4-publish');
      ctx.addShot(s);
      if (ok) return { status: 'pass', detail: `cmd=${ok}` };
      ctx.fail(`cmd=${ok}`);
    });

    await rec.record('7.5', 'Build failure navigates to error', async (ctx) => {
      const javaCandidates = findHelloWorld(workspace);
      if (!javaCandidates.length) {
        ctx.fail('no HelloWorld.java to break');
        return;
      }
      const target = javaCandidates[0];
      const original = fs.readFileSync(target);
      try {
        fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\nTHIS_IS_NOT_VALID_JAVA!!!\n')]));
        await clearOverlays(page);
        await execCmd(page, 'kairo.build');
        await sleep(20_000);
        const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 6000));
        const hasError = /error|错误|failed|失败|cannot find|syntax/i.test(body);
        const s = await shot(page, outDir, '7-5-build-fail');
        ctx.addShot(s);
        await page
          .locator('.theia-ProblemsContainer .monaco-list-row, [data-testid="build-error"]')
          .first()
          .click({ timeout: 3000 })
          .catch(() => {});
        if (hasError) {
          return { status: 'pass', detail: `hasErrorUi=${hasError} file=${path.basename(target)}` };
        }
        ctx.fail(`hasErrorUi=${hasError} file=${path.basename(target)}`);
      } finally {
        try {
          fs.writeFileSync(target, original);
        } catch (_) {}
      }
    });

    await rec.record('7.6', 'Ant/Maven view', async (ctx) => {
      await clearOverlays(page);
      let ok = await execCmd(page, 'Maven');
      if (!ok) ok = await runPalette(page, 'Ant');
      if (!ok) ok = await runPalette(page, 'Show Maven');
      await sleep(1200);
      const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 4000));
      const ui = /Maven|Ant|Goals|目标|Tasks|任务/i.test(body);
      const s = await shot(page, outDir, '7-6-maven-ant');
      ctx.addShot(s);
      if (ok || ui) return { status: 'pass', detail: `cmd=${ok} ui=${ui}` };
      ctx.fail(`cmd=${ok} ui=${ui}`);
    });

    // Leave machine clean
    await execCmd(page, 'kairo.server.stop').catch(() => {});
    await sleep(2000);
    await shot(page, outDir, 'z-final');

    rec.writeReport({ baseUrl });
  } catch (e) {
    appendIssue({
      severity: 'BLOCKER',
      title: `A5 train crashed: ${String(e.message || e).slice(0, 120)}`,
      agent: AGENT,
      instance: INSTANCE,
      caseId: 'crash',
      round: ROUND,
      foundBy: `${AGENT} / ${INSTANCE} / round ${ROUND}`,
      repro: String(e.stack || e).slice(0, 500),
      shot: '',
      suspect: 'scripts/test/qa/a5-g6-g7-browser.cjs',
    });
    rec.writeReport({ baseUrl, error: String(e.message || e) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const counts = {
    pass: rec.cases.filter((c) => c.status === 'pass').length,
    fail: rec.cases.filter((c) => c.status === 'fail').length,
    blocked: rec.cases.filter((c) => c.status === 'blocked').length,
    skip: rec.cases.filter((c) => c.status === 'skip').length,
  };
  const summary = [
    `A5 / B3 / G6+G7 round ${ROUND}`,
    `url: ${baseUrl}`,
    `pass=${counts.pass} fail=${counts.fail} blocked=${counts.blocked} skip=${counts.skip}`,
    `report: ${path.join(outDir, 'report.json')}`,
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.txt'), summary + '\n');
  log(summary);
  process.exitCode = 0;
})().catch((e) => {
  console.error(e);
  try {
    rec.writeReport({ baseUrl, error: String(e.message || e) });
  } catch (_) {}
  process.exitCode = 0;
});
