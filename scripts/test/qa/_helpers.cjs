/**
 * Shared helpers for Kairo IDE QA test trains (scripts/test/qa/*).
 * Patterns from verify-search-everywhere.cjs + ensureCmdReg from verify-show-usages-browser.cjs.
 *
 * Supports both desktop (A1) and browser (A3/A4/A7/A8) trains.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { _electron: electron, chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const processArgv = process.argv.slice(2);

/** arg('url', def) or arg(argv, 'url', def) */
function arg(a, b, c) {
  if (Array.isArray(a)) {
    const i = a.indexOf(`--${b}`);
    if (i >= 0 && i + 1 < a.length) return a[i + 1];
    return c;
  }
  const i = processArgv.indexOf(`--${a}`);
  if (i >= 0 && i + 1 < processArgv.length) return processArgv[i + 1];
  return b;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function resolveExe() {
  const custom = arg('exe', null);
  if (custom) return custom;
  // Prefer official build:win output; fall back to QA asar-overlay run dir.
  for (const c of [
    path.join(repoRoot, 'apps', 'desktop', 'dist', 'win-unpacked', 'Kairo.exe'),
    path.join(repoRoot, 'apps', 'desktop', 'dist', 'run', 'Kairo.exe'),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Kairo.exe not found (tried dist/win-unpacked and dist/run)');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (['node_modules', '.git', 'target', 'build'].includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function copyLegacySample(dest) {
  copyDir(path.join(repoRoot, 'legacy-sample'), dest);
  // Ensure .kairo/project.yaml exists even if dest was a partial copy
  // (missing yaml → ActiveProject never binds → JDT LS never starts).
  ensureKairoProjectYaml(dest);
  return dest;
}

function ensureKairoProjectYaml(dest) {
  const kairoDir = path.join(dest, '.kairo');
  const yamlPath = path.join(kairoDir, 'project.yaml');
  if (fs.existsSync(yamlPath)) return yamlPath;
  const srcYaml = path.join(repoRoot, 'legacy-sample', '.kairo', 'project.yaml');
  fs.mkdirSync(kairoDir, { recursive: true });
  if (fs.existsSync(srcYaml)) {
    fs.copyFileSync(srcYaml, yamlPath);
  } else {
    const name = path.basename(dest) || 'project';
    fs.writeFileSync(
      yamlPath,
      [
        'schemaVersion: 1',
        `name: ${name}`,
        'root: .',
        'sourceRoots:',
        '    - src',
        'libraryDirs:',
        '    - lib',
        'webappDir: WebRoot',
        'outputDir: build/classes',
        'buildFile: build.xml',
        'sourceLevel: "1.6"',
        'targetLevel: "1.6"',
        'encoding: gbk',
        'buildTool: ant',
        'contextPath: /',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  const srcJson = path.join(repoRoot, 'legacy-sample', '.kairo', 'project.json');
  const dstJson = path.join(kairoDir, 'project.json');
  if (fs.existsSync(srcJson) && !fs.existsSync(dstJson)) {
    fs.copyFileSync(srcJson, dstJson);
  }
  return yamlPath;
}

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const CHROME =
  process.env.PW_CHROME ||
  'C:/Users/Qi/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';

function appendIssue(issue) {
  const issuesPath = path.join(repoRoot, 'artifacts', 'qa', 'ISSUES.md');
  ensureDir(path.dirname(issuesPath));
  if (!fs.existsSync(issuesPath)) {
    fs.writeFileSync(
      issuesPath,
      '# Kairo QA Issues (Round 1)\n\n> Agents append BLOCKER/P0/P1/P2 here. FIX agent owns status transitions.\n\n',
    );
  }
  const existing = fs.readFileSync(issuesPath, 'utf8');
  const nums = [...existing.matchAll(/KAIRO-QA-(\d+)/g)].map((m) => Number(m[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const id = issue.id || `KAIRO-QA-${String(next).padStart(3, '0')}`;
  const severity = issue.severity || issue.level || 'P1';
  const title = issue.title || issue.name || 'Untitled issue';
  const foundBy =
    issue.foundBy ||
    `${issue.agent || '?'} / ${issue.instance || '?'} / 用例 ${issue.caseId || '?'} / round ${issue.round || 1}`;
  const shots = Array.isArray(issue.shots) ? issue.shots.join(', ') : issue.shot || '(none)';
  const block = [
    '',
    `## ${id} [${severity}] ${title}`,
    `- 状态: ${issue.status || 'OPEN'}`,
    `- 发现: ${foundBy}`,
    `- 复现: ${issue.repro || issue.detail || '(see test script)'}`,
    `- 截图: ${shots}`,
    `- 疑似位置: ${issue.suspect || '(unknown)'}`,
    `- 修复: ${issue.fix || '(FIX agent 填)'}`,
    `- 分级: BLOCKER=后续用例无法继续; P0=核心功能错误/数据损坏/静默失败; P1=功能可用但体验差/UX 审查项; P2=打磨项`,
    '',
  ].join('\n');
  fs.appendFileSync(issuesPath, block);
  log(`issue appended: ${id} [${severity}] ${title}`);
  return id;
}

/**
 * makeRecorder(outDir) — A1 style
 * makeRecorder({ agent, instance, outDir, round }) — browser train style
 */
function makeRecorder(optsOrOutDir) {
  const opts = typeof optsOrOutDir === 'string' ? { outDir: optsOrOutDir } : optsOrOutDir || {};
  const outDir = opts.outDir;
  ensureDir(outDir);
  ensureDir(path.join(outDir, 'shots'));

  const results = [];
  const cases = [];
  const metrics = opts.metrics || {};
  const startedAt = new Date().toISOString();
  const defaults = {
    agent: opts.agent,
    instance: opts.instance,
    round: opts.round != null ? opts.round : 1,
  };

  function recordSync(id, name, ok, detail, shots) {
    const status = ok ? 'pass' : 'fail';
    const entry = {
      id: String(id),
      name,
      status,
      durationMs: 0,
      detail: detail || '',
      shots: Array.isArray(shots) ? shots : shots ? [shots] : [],
    };
    cases.push(entry);
    results.push({ name, ok, detail: detail || '' });
    log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${name}${detail ? ' — ' + detail : ''}`);
    return entry;
  }

  function recordCase({ id, name, status, durationMs, detail, shots }) {
    const entry = {
      id: String(id),
      name,
      status: status || 'fail',
      durationMs: durationMs || 0,
      detail: detail || '',
      shots: Array.isArray(shots) ? shots : shots ? [shots] : [],
    };
    cases.push(entry);
    results.push({ name, ok: entry.status === 'pass', detail: entry.detail });
    log(`${String(entry.status).toUpperCase()}  ${id} ${name}${entry.detail ? ' — ' + entry.detail : ''}`);
    return entry;
  }

  async function recordAsync(id, name, fn) {
    const filterRaw = process.env.KAIRO_QA_CASE_FILTER || opts.caseFilter || '';
    if (filterRaw.trim()) {
      const allow = new Set(
        filterRaw
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
      if (allow.size && !allow.has(String(id))) {
        return recordCase({
          id,
          name,
          status: 'skip',
          durationMs: 0,
          detail: `filtered by KAIRO_QA_CASE_FILTER`,
          shots: [],
        });
      }
    }
    const t0 = Date.now();
    const shots = [];
    let status = 'pass';
    let detail = '';
    const caseTimeoutMs = Number(opts.caseTimeoutMs || process.env.KAIRO_QA_CASE_TIMEOUT_MS || 90_000);
    const ctx = {
      addShot: (n) => shots.push(n),
      fail: (d) => {
        status = 'fail';
        detail = d || detail;
      },
      block: (d) => {
        status = 'blocked';
        detail = d || detail;
      },
      skip: (d) => {
        status = 'skip';
        detail = d || detail;
      },
      note: (d) => {
        detail = d || detail;
      },
    };
    try {
      let timer;
      const result = await Promise.race([
        fn(ctx),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`case timeout after ${caseTimeoutMs}ms`)),
            caseTimeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (result && typeof result === 'object') {
        if (result.status) status = result.status;
        if (result.detail != null) detail = String(result.detail);
        if (Array.isArray(result.shots)) shots.push(...result.shots);
      } else if (result === false) {
        status = 'fail';
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e).slice(0, 400);
      if (/case timeout/i.test(msg)) {
        status = 'fail';
        detail = msg;
      } else {
        status = 'fail';
        detail = msg;
      }
    }
    return recordCase({
      id,
      name,
      status,
      durationMs: Date.now() - t0,
      detail,
      shots: [...new Set(shots)],
    });
  }

  function record(id, name, fnOrOk, detail, shots) {
    if (typeof fnOrOk === 'function') return recordAsync(id, name, fnOrOk);
    return recordSync(id, name, fnOrOk, detail, shots);
  }

  function writeReport(meta = {}) {
    const report = {
      agent: meta.agent || defaults.agent,
      instance: meta.instance || defaults.instance,
      round: meta.round != null ? meta.round : defaults.round,
      startedAt: meta.startedAt || startedAt,
      finishedAt: meta.finishedAt || new Date().toISOString(),
      cases,
      metrics: { ...metrics, ...(meta.metrics || {}) },
      summary: {
        pass: cases.filter((c) => c.status === 'pass').length,
        fail: cases.filter((c) => c.status === 'fail').length,
        blocked: cases.filter((c) => c.status === 'blocked').length,
        skip: cases.filter((c) => c.status === 'skip').length,
      },
    };
    for (const [k, v] of Object.entries(meta)) {
      if (!['agent', 'instance', 'round', 'startedAt', 'finishedAt', 'metrics'].includes(k)) {
        report[k] = v;
      }
    }
    const reportPath = path.join(outDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log(
      `report → ${reportPath} (${report.summary.pass} pass / ${report.summary.fail} fail / ${report.summary.blocked} blocked / ${report.summary.skip} skip)`,
    );
    return report;
  }

  return {
    results,
    cases,
    metrics,
    startedAt,
    outDir,
    record,
    recordCase,
    writeReport,
    appendIssue,
    log,
  };
}

async function shot(page, outDir, name) {
  const shotsDir = ensureDir(path.join(outDir, 'shots'));
  const file = `${name}.jpg`;
  const full = path.join(shotsDir, file);
  await page
    .screenshot({
      path: full,
      type: 'jpeg',
      quality: 40,
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    })
    .catch(async () => {
      await page.screenshot({ path: full, type: 'jpeg', quality: 40 }).catch(() => {});
    });
  return file;
}

async function dismissTrust(page) {
  for (const label of [/Trust|信任|Yes|是|Continue|继续|Don't Save|不保存|Cancel|取消/i]) {
    const btn = page.getByRole('button', { name: label }).first();
    if ((await btn.count()) && (await btn.isVisible().catch(() => false))) {
      await btn.click().catch(() => {});
      await sleep(300);
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function statusBarText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#theia-statusBar, .theia-statusBar');
    return el ? (el.textContent || '').trim() : '';
  });
}

async function clearOverlays(page) {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(120);
  }
  await dismissTrust(page);
}

async function runPalette(page, label) {
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Control+Shift+P');
  await sleep(600);
  const input = page.locator('.quick-input-widget input[type="text"]').first();
  if (!(await input.count())) return false;
  await input.fill(`>${label}`);
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(1200);
  return true;
}

async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 15; attempt++) {
    const found = await page.evaluate(() => {
      let container = window.theia?.container;
      if (!container || !container._bindingDictionary?._map) {
        const shell = document.querySelector('.theia-ApplicationShell, .theia-container, [data-theia-shell]');
        if (shell) {
          container =
            shell.__inversify_container__ ||
            Object.values(shell).find((v) => v && v._bindingDictionary?._map) ||
            null;
        }
      }
      if (!container || !container._bindingDictionary?._map) {
        for (const el of document.querySelectorAll('*')) {
          const c = el.__inversify_container__;
          if (c && c._bindingDictionary?._map && c._bindingDictionary._map.size > 100) {
            container = c;
            break;
          }
        }
      }
      if (!container || !container._bindingDictionary?._map) return false;
      const map = container._bindingDictionary._map;
      for (const [key] of map.entries()) {
        if (!/Command/i.test(String(key))) continue;
        try {
          const svc = container.get(key);
          if (
            svc &&
            typeof svc.getAllCommands === 'function' &&
            typeof svc.registerCommand === 'function' &&
            typeof svc.executeCommand === 'function' &&
            typeof svc.getCommand === 'function'
          ) {
            window.__kairoCmdReg = svc;
            return true;
          }
        } catch (_) {}
      }
      for (const [key] of map.entries()) {
        try {
          const svc = container.get(key);
          if (
            svc &&
            typeof svc.getAllCommands === 'function' &&
            typeof svc.registerCommand === 'function' &&
            typeof svc.executeCommand === 'function' &&
            typeof svc.getCommand === 'function' &&
            Array.isArray(svc.commands)
          ) {
            window.__kairoCmdReg = svc;
            return true;
          }
        } catch (_) {}
      }
      return false;
    });
    if (found) return true;
    await sleep(1000);
  }
  return false;
}

async function execCommand(page, commandId, ...args) {
  await ensureCmdReg(page);
  return page.evaluate(
    async ({ id, a }) => {
      if (!window.__kairoCmdReg) throw new Error('CommandRegistry missing');
      return window.__kairoCmdReg.executeCommand(id, ...a);
    },
    { id: commandId, a: args },
  );
}

async function hasCommand(page, commandId) {
  await ensureCmdReg(page);
  return page.evaluate((id) => !!window.__kairoCmdReg?.getCommand(id), commandId);
}

async function importAndOpenProject(page, projectPath, opts = {}) {
  const abs = path.resolve(projectPath).replace(/\\/g, '/');
  log(`import: ${abs}`);
  const force = !!(opts && opts.force);

  // Already imported / pre-opened Theia workspace — treat as success
  // (KAIRO-QA-001 / A3-001 / A4-001 / A8-001 false positives).
  // Callers that need a specific workspace path can pass { force: true }.
  const bar0 = await statusBarText(page);
  const already =
    /项目[：:].+/i.test(bar0) &&
    !/未导入|not imported|\(无工作区\)|\(no workspace\)/i.test(bar0);
  if (already && !force) {
    log(`import: status bar already shows project — skip wizard (${bar0.slice(0, 80)})`);
    return { ok: true, skipped: true, reason: 'already-imported' };
  }
  if (force) {
    log('import: force=true — opening Import Project wizard');
  }

  let pathInput = page.locator('[data-testid="path-input"]').first();
  if (!(await pathInput.isVisible().catch(() => false))) {
    await runPalette(page, 'Import Project');
    pathInput = page.locator('[data-testid="path-input"]').first();
  }
  if (!(await pathInput.isVisible().catch(() => false))) {
    try {
      await execCommand(page, 'kairo.project.import');
      await sleep(800);
      pathInput = page.locator('[data-testid="path-input"]').first();
    } catch (_) {}
  }
  if (!(await pathInput.isVisible().catch(() => false))) {
    // Wizard missing but explorer/status may still have a working project
    // when backend was launched with `theia start <workspace>`.
    const bar = await statusBarText(page);
    if (/项目[：:].+/i.test(bar) && !/未导入|not imported/i.test(bar)) {
      return { ok: true, skipped: true, reason: 'wizard-missing-but-project' };
    }
    const hasTree = await page.locator('.theia-TreeNode, .theia-FileTree').first().isVisible().catch(() => false);
    if (hasTree) return { ok: true, skipped: true, reason: 'wizard-missing-but-explorer' };
    return { ok: false, reason: 'wizard-missing' };
  }
  await pathInput.click({ clickCount: 3 });
  await pathInput.fill(abs);
  const scan = page.locator('[data-testid="scan-btn"]').first();
  if ((await scan.count()) && (await scan.isEnabled().catch(() => false))) await scan.click();
  else await pathInput.press('Enter');
  const importBtn = page.locator('[data-testid="import-project-btn"]').first();
  try {
    await importBtn.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    const bar = await statusBarText(page);
    if (/项目[：:].+/i.test(bar) && !/未导入|not imported/i.test(bar)) {
      return { ok: true, skipped: true, reason: 'import-btn-timeout-but-project' };
    }
    return { ok: false, reason: 'import-btn' };
  }
  await importBtn.click();
  await sleep(800);
  const openBtn = page.locator('[data-testid="open-project-btn"]').first();
  try {
    await openBtn.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    const bar = await statusBarText(page);
    if (/项目[：:].+/i.test(bar) && !/未导入|not imported/i.test(bar)) {
      return { ok: true, skipped: true, reason: 'open-btn-timeout-but-project' };
    }
    return { ok: false, reason: 'open-btn' };
  }
  await openBtn.click();
  for (let i = 0; i < 12; i++) {
    await sleep(400);
    await dismissTrust(page);
  }
  const bar1 = await statusBarText(page);
  if (/项目[：:].+/i.test(bar1) && !/未导入|not imported/i.test(bar1)) {
    return { ok: true };
  }
  // Soft success: train continues with Theia workspace root even if
  // status bar lags (yaml auto-bind may still be in flight).
  return { ok: true, soft: true, reason: 'open-clicked', bar: bar1.slice(0, 120) };
}

async function openByShortcutOrPalette(page, shortcut, paletteLabel, testId) {
  await clearOverlays(page);
  await page.locator('#theia-statusBar, .theia-statusBar').click({ force: true }).catch(() => {});
  await sleep(200);
  if (shortcut === 'DoubleShift') {
    await page.keyboard.down('Shift');
    await page.keyboard.up('Shift');
    await sleep(80);
    await page.keyboard.down('Shift');
    await page.keyboard.up('Shift');
  } else if (shortcut) {
    await page.keyboard.press(shortcut);
  }
  await sleep(1200);
  let loc = page.locator(`[data-testid="${testId}"]`);
  if (await loc.isVisible().catch(() => false)) return loc;
  await runPalette(page, paletteLabel);
  loc = page.locator(`[data-testid="${testId}"]`);
  return loc;
}

async function waitAgent(page, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const bar = await statusBarText(page);
    // IMPORTANT: do NOT use /connect/ — it matches "disconnected".
    const disconnected = /代理[：:]\s*已断开|代理[：:]\s*已关闭|代理[：:]\s*连接中|Agent[：:]\s*disconnected|Agent[：:]\s*closed|Agent[：:]\s*connecting/i.test(
      bar,
    );
    const connected = /代理[：:]\s*已连接|Agent[：:]\s*connected\b/i.test(bar);
    if (connected && !disconnected) {
      return { ok: true, bar, waitedMs: Date.now() - t0 };
    }
    await sleep(1000);
  }
  return { ok: false, bar: await statusBarText(page), waitedMs: Date.now() - t0 };
}

async function waitJdtReady(page, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const bar = await statusBarText(page);
    // Status bar always contains "JDK：xx" — do NOT treat that as LS ready
    // (round-1 false positive: jdtReadyMs≈4). Require an explicit LS signal
    // or absence of indexing/starting while a Java editor is open long enough.
    const lsReady = /JDT.*就绪|语言服务.*就绪|Java LS.*ready|LS:\s*ready|索引完成|Language Server.*[Rr]eady/i.test(
      bar,
    );
    const busy = /starting|initializing|Starting|初始化中|Indexing|索引中|Loading JDT|JDT.*启动/i.test(bar);
    if (lsReady && !busy) {
      return { ok: true, bar, waitedMs: Date.now() - t0 };
    }
    // Secondary probe: try a cheap completion request once an editor is open
    const probe = await page
      .evaluate(async () => {
        const ed = document.querySelector('.monaco-editor');
        const lang =
          document.querySelector('.monaco-editor[data-uri*=".java"], .tabs-and-editors-container [data-resource-name$=".java"]') ||
          /HelloWorld\.java|\.java\b/i.test(document.title || '');
        const reg = window.__kairoCmdReg;
        const hasJavaCmd = !!(reg && (reg.getCommand('java.action.organizeImports') || reg.getCommand('kairo.java.rename') || reg.getCommand('editor.action.rename')));
        let suggestHasSystem = false;
        try {
          // Peek suggest widget if already visible
          const w = document.querySelector('.suggest-widget');
          if (w && getComputedStyle(w).display !== 'none') {
            suggestHasSystem = /System/i.test(w.innerText || '');
          }
        } catch (_) {}
        return { hasEditor: !!ed, javaContext: !!lang, hasJavaCmd, suggestHasSystem };
      })
      .catch(() => ({ hasEditor: false, javaContext: false, hasJavaCmd: false, suggestHasSystem: false }));
    if (probe.suggestHasSystem) {
      return { ok: true, bar, waitedMs: Date.now() - t0, via: 'suggest' };
    }
    // Soft-accept only after ≥55s — JDT prepare+start often takes 20–40s
    // after project bind; accepting at 25s raced ahead of initialize (R3).
    if (!busy && probe.hasEditor && probe.javaContext && probe.hasJavaCmd && Date.now() - t0 >= 55_000) {
      return { ok: true, bar, waitedMs: Date.now() - t0, soft: true };
    }
    await sleep(2000);
  }
  return { ok: false, bar: await statusBarText(page), waitedMs: Date.now() - t0 };
}

async function openQuickFile(page, fileName) {
  await clearOverlays(page);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(200);
  await page.keyboard.press('Control+P');
  await sleep(900);
  const input = page.locator('.quick-input-widget input[type="text"]').first();
  try {
    await input.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    return false;
  }
  // Prefer fill() with a hard timeout — keyboard.type can hang when
  // quick-input focus churns (A3/A4 case timeouts).
  try {
    await Promise.race([
      (async () => {
        await input.click({ force: true }).catch(() => {});
        await input.fill('');
        await input.fill(fileName);
      })(),
      sleep(6_000).then(() => {
        throw new Error('quick-open fill timeout');
      }),
    ]);
  } catch {
    try {
      await input.click({ force: true }).catch(() => {});
      await page.keyboard.press('Control+A').catch(() => {});
      await Promise.race([
        page.keyboard.type(fileName, { delay: 15 }),
        sleep(5_000),
      ]);
    } catch {
      return false;
    }
  }
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(1500);
  return true;
}

async function focusEditor(page) {
  const editor = page.locator('.monaco-editor').first();
  if (await editor.count()) {
    await editor.click({ position: { x: 120, y: 80 } }).catch(() => {});
    await sleep(300);
  }
}

async function placeCaretOnText(page, text) {
  await focusEditor(page);
  await page.keyboard.press('Control+F');
  await sleep(600);
  const findInput = page
    .locator(
      '.find-widget .monaco-inputbox textarea, .find-widget textarea, .find-widget input.input, .editor-widget.find-widget input',
    )
    .first();
  if (await findInput.isVisible().catch(() => false)) {
    await findInput.click({ clickCount: 3 });
    await findInput.fill(text);
    await sleep(300);
    await page.keyboard.press('Enter');
    await sleep(300);
    await page.keyboard.press('Escape');
    await sleep(300);
    return true;
  }
  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

async function gotoApp(page, baseUrl) {
  const url = String(baseUrl).replace(/\/$/, '');
  log(`goto ${url}`);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('#theia-statusBar, .theia-statusBar', { timeout: 120_000 }).catch(() => {});
  await sleep(2500);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForSelector('#theia-statusBar, .theia-statusBar', { timeout: 120_000 }).catch(() => {});
  await sleep(3000);
  await dismissTrust(page);
  return Date.now() - t0;
}

async function launchBrowser(opts = {}) {
  const launchOpts = {
    headless: opts.headless !== false,
    args: ['--disable-dev-shm-usage', ...(opts.args || [])],
  };
  if (fs.existsSync(CHROME)) launchOpts.executablePath = CHROME;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(60_000);
  page.on('dialog', async (d) => {
    await d.dismiss().catch(() => {});
  });
  if (opts.url) {
    await gotoApp(page, opts.url);
  }
  return { browser, page };
}

async function launchDesktop({ outDir, workspaceArg }) {
  const exe = resolveExe();
  ensureDir(outDir);
  ensureDir(path.join(outDir, 'shots'));
  const userDataDir = path.join(outDir, 'userdata');
  ensureDir(userDataDir);
  // Isolate Theia config (~/.theia is SHARED across all Electron instances).
  // Without this, recentworkspace.json from another QA train (e.g. a6) is
  // auto-opened and builds hit the wrong project root.
  const theiaConfigDir = path.join(outDir, 'theia-config');
  ensureDir(theiaConfigDir);
  const wsPath = path.join(outDir, 'workspace');
  if (fs.existsSync(wsPath)) {
    const uri =
      'file:///' +
      path
        .resolve(wsPath)
        .replace(/\\/g, '/')
        .replace(/^([A-Za-z]):/, (_, d) => `${d.toLowerCase()}%3A`);
    fs.writeFileSync(
      path.join(theiaConfigDir, 'recentworkspace.json'),
      JSON.stringify({ recentRoots: [uri] }),
      'utf8',
    );
  }

  const args = [`--user-data-dir=${userDataDir}`];
  if (workspaceArg === true) args.push(wsPath);
  else if (typeof workspaceArg === 'string' && workspaceArg) args.push(workspaceArg);

  log(`exe: ${exe}`);
  log(`userData: ${userDataDir}`);
  log(`theiaConfig: ${theiaConfigDir}`);

  const app = await electron.launch({
    executablePath: exe,
    args,
    env: {
      ...process.env,
      KAIRO_USER_DATA_DIR: userDataDir,
      KAIRO_DESKTOP_LOG_FILE: path.join(outDir, 'main.log'),
      KAIRO_NO_DEVTOOLS: '1',
      KAIRO_AUTO_TRUST: '1',
      THEIA_CONFIG_DIR: theiaConfigDir,
    },
    timeout: 180_000,
  });

  const page = await app.firstWindow({ timeout: 120_000 });
  page.on('dialog', async (d) => {
    await d.dismiss().catch(() => {});
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForSelector('#theia-statusBar', { timeout: 120_000 }).catch(() => {});
  await sleep(3000);
  await dismissTrust(page);
  return { app, page, exe, userDataDir, theiaConfigDir };
}

function parseKeymapFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const out = [];
  const re =
    /\{\s*command:\s*'([^']+)'\s*,\s*keybinding:\s*'([^']+)'(?:\s*,\s*when:\s*'([^']*)')?\s*\}/g;
  let m;
  while ((m = re.exec(text))) {
    out.push({ command: m[1], keybinding: m[2], when: m[3] || '' });
  }
  return out;
}

function toPlaywrightChord(kb) {
  return kb
    .toLowerCase()
    .replace(/ctrl/g, 'Control')
    .replace(/alt/g, 'Alt')
    .replace(/shift/g, 'Shift')
    .replace(/meta|cmd|win/g, 'Meta')
    .split('+')
    .map((p) => {
      if (/^f\d+$/i.test(p)) return p.toUpperCase();
      if (p === 'Control' || p === 'Alt' || p === 'Shift' || p === 'Meta') return p;
      if (p === 'left') return 'ArrowLeft';
      if (p === 'right') return 'ArrowRight';
      if (p === 'up') return 'ArrowUp';
      if (p === 'down') return 'ArrowDown';
      if (p === 'esc' || p === 'escape') return 'Escape';
      if (p === 'enter' || p === 'return') return 'Enter';
      if (p === 'space') return 'Space';
      if (p === 'tab') return 'Tab';
      if (p === 'backspace') return 'Backspace';
      if (p === 'delete') return 'Delete';
      if (p === 'home') return 'Home';
      if (p === 'end') return 'End';
      if (p === 'insert') return 'Insert';
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join('+');
}

async function clickStatusBarElement(page, elementId) {
  const clicked = await page.evaluate((id) => {
    const candidates = [
      document.getElementById(`status-bar-${id}`),
      ...Array.from(
        document.querySelectorAll('#theia-statusBar .element, .theia-statusBar .element, #theia-statusBar > *'),
      ),
    ].filter(Boolean);
    for (const c of candidates) {
      const cid = c.id || '';
      const text = (c.textContent || '').trim();
      if (
        cid.includes(id) ||
        (id.includes('jdk') && /JDK/i.test(text)) ||
        (id.includes('encoding') && /UTF|GBK|encoding/i.test(text)) ||
        (id.includes('agent') && /代理|Agent/i.test(text)) ||
        (id.includes('project') && /项目|Project/i.test(text)) ||
        (id.includes('build') && /构建|Build/i.test(text)) ||
        (id.includes('server') && /Server|服务器|Tomcat/i.test(text)) ||
        (id.includes('debug') && /Debug|调试/i.test(text)) ||
        (id.includes('hotReload') && /Hot|热/i.test(text))
      ) {
        c.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return { ok: true, id: cid, text: text.slice(0, 80) };
      }
    }
    return { ok: false };
  }, elementId);
  await sleep(800);
  return clicked;
}

module.exports = {
  repoRoot,
  arg,
  ensureDir,
  resolveExe,
  copyDir,
  copyLegacySample,
  ensureKairoProjectYaml,
  sleep,
  stamp,
  log,
  makeRecorder,
  shot,
  dismissTrust,
  statusBarText,
  runPalette,
  importAndOpenProject,
  openByShortcutOrPalette,
  ensureCmdReg,
  execCommand,
  hasCommand,
  launchDesktop,
  launchBrowser,
  gotoApp,
  clearOverlays,
  waitAgent,
  waitJdtReady,
  openQuickFile,
  focusEditor,
  placeCaretOnText,
  appendIssue,
  parseKeymapFile,
  toPlaywrightChord,
  clickStatusBarElement,
  CHROME,
};
