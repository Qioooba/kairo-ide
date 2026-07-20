// WEB-FLOW-01 — 首次导入（First Import）
//
// 通过真实 UI 完成：冷启动 → 打开 Import Wizard → 选择 legacy-sample →
// 检测/扫描 → 配置校验（空名称/超长/中文/选项） → 保存 → 验证状态栏与磁盘配置。
//
// Usage:
//   node scripts/run-web-flow-01.cjs [--use-existing DATA_DIR]
//   KAIRO_QA_DATA_DIR can also point to an existing stack.

const fs = require('fs');
const path = require('path');
const {
  ensureDir, startStack, stopStack, loadEnv, launchBrowser, openPage,
  dismissTrustDialog, runCommand, screenshot, waitForSelectorVisible,
  waitForText, waitForStatusBarContains, agentGet,
  writeResult, writeLogs, sleep,
} = require('./qa-helpers.cjs');

const LONG_NAME = 'a'.repeat(101);
const CHINESE_NAME = '中文遗产项目';

async function main() {
  const args = process.argv.slice(2);
  let useExisting = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--use-existing' && args[i + 1]) {
      useExisting = args[i + 1];
      i++;
    }
  }

  const runId = `web-flow-01-${Date.now()}`;
  const artifactsRoot = path.resolve('/tmp', 'kairo-mac-web-qa-m2-flow01', runId);
  ensureDir(artifactsRoot);

  const result = {
    flow: 'WEB-FLOW-01',
    runId,
    startedAt: new Date().toISOString(),
    status: 'RUNNING',
    steps: [],
    screenshots: {},
    errors: [],
  };

  let stackInfo = null;
  let browser = null;
  let page = null;

  function logStep(name, detail) {
    const entry = { name, time: new Date().toISOString(), detail };
    result.steps.push(entry);
    console.log(`[${entry.time}] ${name}`, detail || '');
  }

  function logError(msg) {
    result.errors.push({ time: new Date().toISOString(), message: msg });
    console.error(`  ERROR  ${msg}`);
  }

  try {
    // ------------------------------------------------------------------
    // 1. 启动 QA stack（或复用已有）
    // ------------------------------------------------------------------
    if (useExisting) {
      stackInfo = { dataDir: useExisting, env: loadEnv(useExisting) };
      logStep('USE_EXISTING_STACK', { dataDir: useExisting });
    } else {
      logStep('START_STACK');
      stackInfo = await startStack({ skipBuild: true });
      logStep('STACK_READY', { dataDir: stackInfo.dataDir, webPort: stackInfo.env.KAIRO_QA_WEB_PORT });
    }

    const env = stackInfo.env;
    const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT || 3000}/`;
    const legacyDst = env.KAIRO_QA_LEGACY_DST;
    if (!legacyDst || !fs.existsSync(legacyDst)) {
      throw new Error(`legacy-sample copy missing: ${legacyDst}`);
    }

    // ------------------------------------------------------------------
    // 2. 打开浏览器
    // ------------------------------------------------------------------
    logStep('LAUNCH_BROWSER');
    browser = await launchBrowser({ slowMo: 40 });
    page = await openPage(browser, webUrl);
    logStep('PAGE_LOADED', { url: webUrl });

    await screenshot(page, path.join(artifactsRoot, '01-initial.png'));

    // ------------------------------------------------------------------
    // 3. 处理 Workspace Trust 对话框
    // ------------------------------------------------------------------
    const trusted = await dismissTrustDialog(page);
    logStep('TRUST_DIALOG', { dismissed: trusted });

    // ------------------------------------------------------------------
    // 4. 等待 workbench shell 就绪（无 workspace 状态）
    // ------------------------------------------------------------------
    const initialStatus = await waitForStatusBarContains(page, 'Project: (no workspace)', 60000);
    logStep('SHELL_READY', { statusBar: initialStatus.slice(0, 200) });
    await screenshot(page, path.join(artifactsRoot, '02-shell-ready.png'));

    // ------------------------------------------------------------------
    // 5. 打开命令面板并执行 "Kairo: Import Project"
    // ------------------------------------------------------------------
    logStep('OPEN_IMPORT_WIZARD');
    await runCommand(page, 'Kairo: Import Project', 20000);

    const wizard = await waitForSelectorVisible(page, '[data-testid="import-wizard"]', 20000);
    logStep('WIZARD_VISIBLE');
    await screenshot(page, path.join(artifactsRoot, '03-wizard-open.png'));

    // ------------------------------------------------------------------
    // 6. 选择 workspace 目录
    // ------------------------------------------------------------------
    logStep('SELECT_WORKSPACE', { path: legacyDst });

    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 30000 });
    await page.locator('[data-testid="open-workspace-btn"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(legacyDst);

    // 等待扫描或 detect 结果出现
    await sleep(3000);
    const step2 = page.locator('[data-testid="step-content-2"]');
    await step2.waitFor({ state: 'visible', timeout: 30000 });
    await screenshot(page, path.join(artifactsRoot, '04-detect-result.png'));
    logStep('DETECT_RESULT_VISIBLE');

    // 无论是 Continue 还是 Create New Configuration，都进入配置页
    const continueBtn = page.locator('[data-testid="continue-to-configure"], [data-testid="create-new-config"]').first();
    await continueBtn.waitFor({ state: 'visible', timeout: 10000 });
    await continueBtn.click();

    const step3 = await waitForSelectorVisible(page, '[data-testid="step-content-3"]', 20000);
    logStep('CONFIG_FORM_VISIBLE');
    await screenshot(page, path.join(artifactsRoot, '05-config-form.png'));

    // ------------------------------------------------------------------
    // 7. 表单校验
    // ------------------------------------------------------------------
    const nameInput = page.locator('[data-testid="input-project-name"]');
    const saveBtn = page.locator('[data-testid="save-config-btn"]');

    // 7a. 空名称
    logStep('VALIDATE_EMPTY_NAME');
    await nameInput.fill('');
    await saveBtn.click();
    await waitForText(page, '[data-testid="save-error"]', 'empty', 10000);
    await screenshot(page, path.join(artifactsRoot, '06-error-empty-name.png'));

    // 7b. 超长名称
    logStep('VALIDATE_LONG_NAME');
    await nameInput.fill(LONG_NAME);
    await saveBtn.click();
    await waitForText(page, '[data-testid="save-error"]', '100', 10000);
    await screenshot(page, path.join(artifactsRoot, '07-error-long-name.png'));

    // 7c. 中文名称 + 切换 Source Level / Encoding / Build Tool
    logStep('SET_CHINESE_NAME_AND_OPTIONS');
    await nameInput.fill(CHINESE_NAME);

    await page.locator('[data-testid="select-source-level"]').selectOption('1.8');
    await page.locator('[data-testid="select-encoding"]').selectOption('UTF-8');
    await page.locator('[data-testid="select-build-tool"]').selectOption('javac');
    await screenshot(page, path.join(artifactsRoot, '08-options-set.png'));

    // ------------------------------------------------------------------
    // 8. 保存配置
    // ------------------------------------------------------------------
    logStep('SAVE_CONFIGURATION');
    await saveBtn.click();

    // 等待 wizard 关闭
    await page.locator('[data-testid="import-wizard"]').waitFor({ state: 'hidden', timeout: 30000 });
    logStep('WIZARD_CLOSED');
    await screenshot(page, path.join(artifactsRoot, '09-after-save.png'));

    // ------------------------------------------------------------------
    // 9. 验证状态栏/selector 更新
    // ------------------------------------------------------------------
    const afterStatus = await waitForStatusBarContains(page, CHINESE_NAME, 60000);
    logStep('STATUS_BAR_UPDATED', { statusBar: afterStatus.slice(0, 300) });
    await screenshot(page, path.join(artifactsRoot, '10-statusbar-project.png'));

    // 验证 Runtime 已连接
    const runtimeStatus = await waitForStatusBarContains(page, 'Runtime: connected', 30000);
    logStep('RUNTIME_CONNECTED', { statusBar: runtimeStatus.slice(0, 200) });

    // 验证 Project Selector 可打开并包含项目
    logStep('OPEN_PROJECT_SELECTOR');
    const selectorTrigger = page.locator('[data-testid="project-selector-trigger"]').first();
    if (await selectorTrigger.isVisible().catch(() => false)) {
      await selectorTrigger.click();
      await sleep(1000);
      await screenshot(page, path.join(artifactsRoot, '11-project-selector.png'));
      await page.keyboard.press('Escape');
    } else {
      logStep('NO_SELECTOR_TRIGGER', { note: 'project selector trigger not found; status bar only' });
    }

    // ------------------------------------------------------------------
    // 10. API 交叉验证磁盘配置
    // ------------------------------------------------------------------
    logStep('VERIFY_DISK_CONFIG');
    const projectsRes = await agentGet(env, '/api/v1/projects', 10000);
    result.apiCheck = {
      endpoint: '/api/v1/projects',
      ok: projectsRes.ok,
      status: projectsRes.status,
      payload: projectsRes.json,
    };
    if (!projectsRes.ok) {
      throw new Error(`Agent projects endpoint failed: ${projectsRes.status} ${projectsRes.error || projectsRes.text}`);
    }
    const payload = projectsRes.json?.payload || projectsRes.json || [];
    const projects = Array.isArray(payload) ? payload : [payload];
    const found = projects.find(p => p.name === CHINESE_NAME || p.id?.includes('project-'));
    if (!found) {
      throw new Error(`Project not found in agent response: ${JSON.stringify(projectsRes.json)}`);
    }
    logStep('DISK_CONFIG_VERIFIED', { projectId: found.id, name: found.name, encoding: found.encoding });

    // ------------------------------------------------------------------
    // 11. 停止 stack（仅当本脚本启动时）
    // ------------------------------------------------------------------
    result.status = 'PASS';
    logStep('FLOW_PASS');
  } catch (err) {
    result.status = 'FAIL';
    logError(err.message);
    logStep('FLOW_FAIL', { error: err.message });
    if (page) {
      await screenshot(page, path.join(artifactsRoot, '99-fail.png')).catch(() => {});
    }
    throw err;
  } finally {
    if (page) {
      await screenshot(page, path.join(artifactsRoot, 'final.png')).catch(() => {});
      writeLogs(artifactsRoot, page._kairoLogs || []);
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    result.finishedAt = new Date().toISOString();

    if (stackInfo && !useExisting) {
      logStep('STOP_STACK');
      const stopRes = await stopStack(stackInfo.dataDir);
      result.stopResult = stopRes;
    }

    writeResult(artifactsRoot, result);
    console.log(`\nArtifacts: ${artifactsRoot}`);
    console.log(`Result: ${result.status}`);
    if (result.errors.length) {
      console.log('Errors:', result.errors.map(e => e.message).join('; '));
    }
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
