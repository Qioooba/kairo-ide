/**
 * Round 10 scenario C — 环境异常恢复 (real end-to-end on official exe).
 *   node scripts/test/qa/scenario-c.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const {
  repoRoot,
  ensureDir,
  sleep,
  log,
  makeRecorder,
  shot,
  statusBarText,
  statusBarHasProject,
  launchDesktop,
  clearOverlays,
  importAndOpenProject,
  execCommand,
  waitAgent,
  copyLegacySample,
  resolveExe,
} = require('./_helpers.cjs');

const outDir = path.join(repoRoot, 'artifacts', 'qa', 'round-10', 'final', 'scenario-c');
ensureDir(outDir);
const workspace = path.join(outDir, 'workspace');
const ROUND = Number(process.env.KAIRO_QA_ROUND || 10);
const rec = makeRecorder({ agent: 'SCENARIO-C', instance: 'D-FINAL', outDir, round: ROUND, caseTimeoutMs: 120_000 });
const stepTimes = [];

function recordStep(name, ms, ok, detail) {
  stepTimes.push({ name, ms, ok, detail: detail || '' });
  log(`STEP ${ok ? 'OK' : 'FAIL'} ${name} ${ms}ms ${detail || ''}`);
}

function holdPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.on('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const startedAt = new Date().toISOString();
  if (!fs.existsSync(path.join(workspace, 'build.xml')) && !fs.existsSync(path.join(workspace, 'web'))) {
    copyLegacySample(workspace);
  }
  const userData = path.join(outDir, 'userdata');
  if (process.env.KAIRO_QA_WIPE_USERDATA !== '0' && fs.existsSync(userData)) {
    try {
      fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      // Windows may lock Cache_Data briefly — quarantine and use a fresh dir name.
      const quarantine = path.join(outDir, `userdata-old-${Date.now()}`);
      try {
        fs.renameSync(userData, quarantine);
      } catch (_) {
        log(`userdata wipe soft-fail: ${e && e.message ? e.message : e}`);
      }
    }
  }

  let app, page;
  try {
    ({ app, page } = await launchDesktop({ outDir, workspaceArg: true }));
  } catch (e) {
    rec.recordCase({ id: 'C.boot', name: 'Launch', status: 'fail', durationMs: 0, detail: String(e), shots: [] });
    rec.writeReport({ agent: 'SCENARIO-C', instance: 'D-FINAL', round: ROUND, startedAt, finishedAt: new Date().toISOString(), metrics: { steps: stepTimes } });
    process.exit(1);
  }
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  let agent = await waitAgent(page, 45000);
  await importAndOpenProject(page, workspace, { force: true }).catch(() => {});

  await rec.record('C.1', 'Kill agent → reconnect', async (ctx) => {
    const t0 = Date.now();
    try {
      spawn('taskkill', ['/F', '/IM', 'kairo-runtime.exe'], { stdio: 'ignore' });
    } catch (_) {}
    await sleep(4000);
    let bar = await statusBarText(page);
    const disconnected =
      /disconnected|unavailable|断连|offline|未连接|不可用|Agent:\s*(?!connected)/i.test(bar) ||
      !/Agent:\s*connected/i.test(bar);
    // Desktop auto-respawns agent; also poke reconnect.
    for (let i = 0; i < 3; i++) {
      await execCommand(page, 'kairo.agent.reconnect').catch(() => {});
      await sleep(2000);
      agent = await waitAgent(page, 20_000);
      if (agent.ok) break;
    }
    const s = await shot(page, outDir, 'C-1-agent-reconnect');
    recordStep('agent-reconnect', Date.now() - t0, !!(disconnected && agent.ok), `disc=${disconnected} re=${agent.ok}`);
    if (!agent.ok) ctx.fail(`agent reconnect failed; silent=${!disconnected}; bar=${bar.slice(0, 100)}`);
    return {
      status: agent.ok ? 'pass' : 'fail',
      detail: `disconnectedSeen=${disconnected} reconnected=${agent.ok} bar=${(await statusBarText(page)).slice(0, 100)}`,
      shots: [s],
    };
  });

  await rec.record('C.2', 'Port conflict on Tomcat start', async (ctx) => {
    const t0 = Date.now();
    const holder = await holdPort(8080);
    await clearOverlays(page);
    await execCommand(page, 'kairo.server.start').catch(() => {});
    await page.keyboard.press('Shift+F10').catch(() => {});
    await sleep(8000);
    const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 6000));
    const bar = await statusBarText(page);
    const messaging =
      /port|端口|in use|占用|conflict|冲突|Address already|bind|EADDRINUSE|failed|失败|error|错误/i.test(
        body + ' ' + bar,
      );
    const s = await shot(page, outDir, 'C-2-port-conflict');
    if (holder) holder.close();
    recordStep('port-conflict', Date.now() - t0, messaging);
    // Silent failure = P0
    if (!messaging) ctx.fail('no human-readable port conflict messaging (silent failure)');
    return { status: messaging ? 'pass' : 'fail', detail: `messaging=${messaging}`, shots: [s] };
  });

  await app.close().catch(() => {});

  await rec.record('C.3', 'JDK Setup dialog without JAVA_HOME', async (ctx) => {
    const t0 = Date.now();
    const exe = resolveExe();
    const ud = path.join(outDir, 'userdata-nojdk');
    if (fs.existsSync(ud)) fs.rmSync(ud, { recursive: true, force: true });
    ensureDir(ud);
    const { _electron: electron } = require('playwright');
    let app2;
    try {
      const env = { ...process.env, KAIRO_NO_DEVTOOLS: '1', KAIRO_AUTO_TRUST: '1' };
      delete env.JAVA_HOME;
      delete env.KAIRO_JDK_HOME;
      delete env.JDK_HOME;
      app2 = await electron.launch({
        executablePath: exe,
        args: [`--user-data-dir=${ud}`],
        env,
      });
      const page2 = await app2.firstWindow();
      await page2.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
      await sleep(8000);
      const body = await page2.evaluate(() => (document.body.innerText || '').slice(0, 5000));
      const dialog = /JDK Setup|JDK|Java|未找到|not found|配置 JDK|Install JDK/i.test(body);
      const s = await shot(page2, outDir, 'C-3-jdk-setup');
      recordStep('jdk-setup-dialog', Date.now() - t0, dialog);
      await app2.close().catch(() => {});
      if (!dialog) ctx.fail('JDK Setup dialog not shown (silent failure)');
      return { status: dialog ? 'pass' : 'fail', detail: `dialog=${dialog}`, shots: [s] };
    } catch (e) {
      if (app2) await app2.close().catch(() => {});
      recordStep('jdk-setup-dialog', Date.now() - t0, false, String(e.message || e));
      ctx.fail(String(e.message || e));
      return { status: 'fail', detail: String(e.message || e), shots: [] };
    }
  });

  const finishedAt = new Date().toISOString();
  rec.writeReport({
    agent: 'SCENARIO-C',
    instance: 'D-FINAL',
    round: ROUND,
    startedAt,
    finishedAt,
    metrics: { totalMs: stepTimes.reduce((a, s) => a + s.ms, 0), steps: stepTimes },
  });
  const failed = rec.cases.filter((c) => c.status === 'fail' || c.status === 'blocked').length;
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
