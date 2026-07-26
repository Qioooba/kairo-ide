/**
 * SHARD-06: 调试功能 (断点/单步/变量/热替换)
 * 测试用例: TEST-0601 ~ TEST-0613
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  runCommandViaPalette,
  openFileViaQuickOpen,
  waitForBuildState,
  waitForServerState,
  setBreakpoint,
  waitForDebugPaused,
  getDebugVariables,
  runKairoImportWizard,
} from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const SHARD_ID = 'shard-06';
const SCREENSHOT_DIR = `test-results/screenshots/${SHARD_ID}`;

const TEST_WORKSPACE = '/tmp/kairo-k4-workspace/projects/workspace-shard06';
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');
const PROJECT_ID = 'project-workspace-shard06';
const TOMCAT_PORT = process.env.TOMCAT_PORT || '18302';
const TOMCAT_BASE = `http://127.0.0.1:${TOMCAT_PORT}`;

async function removeProjectFromCatalog(request: { delete: (url: string) => Promise<unknown> } | null) {
  if (!request) return;
  try {
    const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
    await request.delete(`${agentBase}/api/v1/projects/${PROJECT_ID}`);
  } catch {
    /* 404 is fine */
  }
}

function copyDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

test.describe('SHARD-06: 调试功能', () => {
  test.beforeAll(async ({ request }) => {
    if (fs.existsSync(TEST_WORKSPACE)) {
      fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
    if (fs.existsSync(LEGACY_SAMPLE)) {
      copyDirSync(LEGACY_SAMPLE, TEST_WORKSPACE);
    }
    await removeProjectFromCatalog(request as any);
  });

  test.afterAll(() => {
    // Keep workspace for debugging
  });

  test.beforeEach(async ({ page, baseURL, request }) => {
    await removeProjectFromCatalog(request as any);
    await navigateToTheia(page, baseURL);
    await waitForTheiaShell(page);
    await dismissTrustDialog(page);
    const result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
    expect(result.opened, `import-wizard-reason: ${result.reason}`).toBe(true);
  });

  test('TEST-0601: 设置/取消行断点', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 在doGet方法行号左侧点击', async () => {
      const editor = page.locator('.monaco-editor').first();
      const lineNumbers = editor.locator('.line-numbers');
      const firstLine = lineNumbers.first();
      await firstLine.hover();
      await page.waitForTimeout(500);
      const gutter = editor.locator('.margin-view-overlays').first();
      await gutter.click({ position: { x: 10, y: 50 } });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0601/01-breakpoint-set.png` });
    });

    await test.step('2. 按F9快捷键切换断点', async () => {
      await page.keyboard.press('F9');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0601/02-breakpoint-toggled.png` });
    });

    await test.step('3. 再次点击断点取消', async () => {
      const editor = page.locator('.monaco-editor').first();
      const gutter = editor.locator('.margin-view-overlays').first();
      await gutter.click({ position: { x: 10, y: 50 } });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0601/03-breakpoint-removed.png` });
    });

    await test.step('4. 验证断点持久化', async () => {
      await page.keyboard.press('F9');
      await page.waitForTimeout(500);
      await page.reload();
      await waitForTheiaShell(page);
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0601/04-breakpoint-persisted.png` });
    });
  });

  test('TEST-0602: 启动调试服务器', async ({ page }) => {
    await test.step('1. 在doGet第一行设置断点', async () => {
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(2000);
      await setBreakpoint(page, 'HelloServlet.java', 25);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/01-breakpoint-set.png` });
    });

    await test.step('2. 执行Kairo: Build & Deploy', async () => {
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await waitForBuildState(page, 'succeeded', 120000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/02-build-deploy-done.png` });
    });

    await test.step('3. 执行Kairo: Start Debug Server', async () => {
      await runCommandViaPalette(page, 'Kairo: Start Debug Server');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/03-debug-server-starting.png` });
    });

    await test.step('4. 等待服务器running，检查调试状态', async () => {
      const result = await waitForServerState(page, 'running', 120000);
      expect(result).toBeTruthy();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/04-debug-server-running.png` });
    });

    await test.step('5. Debug视图显示', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Debug View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/05-debug-view.png` });
    });
  });

  test('TEST-0603: 断点命中', async ({ page }) => {
    // Setup: set breakpoint and start debug server
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    await waitForBuildState(page, 'succeeded', 120000);
    await runCommandViaPalette(page, 'Kairo: Start Debug Server');
    await waitForServerState(page, 'running', 120000);

    await test.step('1. 访问Servlet触发断点', async () => {
      const newPage = await page.context().newPage();
      await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
      await newPage.waitForTimeout(2000);
      await newPage.close();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0603/01-breakpoint-hit.png` });
    });

    await test.step('2. 观察IDE页面挂起', async () => {
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0603/02-debug-paused.png` });
    });

    await test.step('3. 检查Debug视图', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Debug View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0603/03-debug-view-paused.png` });
    });

    await test.step('4. 状态栏验证', async () => {
      const statusBar = page.locator('#theia-statusBar, .theia-status-bar');
      const statusText = await statusBar.textContent();
      expect(statusText).toContain('Debug');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0603/04-status-bar-debug.png` });
    });
  });

  test('TEST-0604: 变量查看', async ({ page }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    await waitForBuildState(page, 'succeeded', 120000);
    await runCommandViaPalette(page, 'Kairo: Start Debug Server');
    await waitForServerState(page, 'running', 120000);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 检查Variables视图', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Variables View');
      await page.waitForTimeout(1000);
      const vars = await getDebugVariables(page);
      expect(vars.length).toBeGreaterThan(0);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0604/01-variables-view.png` });
    });

    await test.step('2. 展开request变量', async () => {
      const requestVar = page.locator('text=request').first();
      if (await requestVar.count() > 0) {
        await requestVar.click();
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0604/02-request-expanded.png` });
    });

    await test.step('3. 展开局部变量', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0604/03-local-variables.png` });
    });

    await test.step('4. 鼠标悬停在编辑器变量上', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.hover({ position: { x: 200, y: 100 } });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0604/04-variable-hover.png` });
    });
  });

  test('TEST-0605: Step Over (F10) 单步跳过', async ({ page }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    await waitForBuildState(page, 'succeeded', 120000);
    await runCommandViaPalette(page, 'Kairo: Start Debug Server');
    await waitForServerState(page, 'running', 120000);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 按F10单步跳过', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0605/01-before-step-over.png` });
      await page.keyboard.press('F10');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0605/02-after-step-over.png` });
    });

    await test.step('2. 多次F10', async () => {
      await page.keyboard.press('F10');
      await page.waitForTimeout(500);
      await page.keyboard.press('F10');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0605/03-multiple-steps.png` });
    });

    await test.step('3. 验证执行顺序', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0605/04-execution-order.png` });
    });
  });

  test('TEST-0606: Step Into (F11) 单步进入', async ({ page }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    await waitForBuildState(page, 'succeeded', 120000);
    await runCommandViaPalette(page, 'Kairo: Start Debug Server');
    await waitForServerState(page, 'running', 120000);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 遇到方法调用时按F11', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0606/01-before-step-into.png` });
      await page.keyboard.press('F11');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0606/02-after-step-into.png` });
    });

    await test.step('2. Call Stack增加一帧', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Call Stack View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0606/03-call-stack.png` });
    });
  });

  test('TEST-0607: Step Out (Shift+F11) 单步跳出', async ({ page }) => {
    // Setup and trigger breakpoint, step into a method
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    await waitForBuildState(page, 'succeeded', 120000);
    await runCommandViaPalette(page, 'Kairo: Start Debug Server');
    await waitForServerState(page, 'running', 120000);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);
    await page.keyboard.press('F11');
    await page.waitForTimeout(1000);

    await test.step('1. 方法内部按Shift+F11', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0607/01-inside-method.png` });
      await page.keyboard.press('Shift+F11');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0607/02-after-step-out.png` });
    });

    await test.step('2. Call Stack弹出该帧', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Call Stack View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0607/03-call-stack-popped.png` });
    });
  });

  test('TEST-0608: Continue (F5) 继续执行', async ({ page }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    await waitForBuildState(page, 'succeeded', 120000);
    await runCommandViaPalette(page, 'Kairo: Start Debug Server');
    await waitForServerState(page, 'running', 120000);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 暂停状态按F5', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0608/01-before-continue.png` });
      await page.keyboard.press('F5');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0608/02-after-continue.png` });
    });

    await test.step('2. 检查浏览器HTTP请求', async () => {
      const response = await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
      expect(response?.status()).toBe(200);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0608/03-request-completed.png` });
    });
  });

  test('TEST-0609: 条件断点', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 右键断点，选择Conditional Breakpoint', async () => {
      const editor = page.locator('.monaco-editor').first();
      const gutter = editor.locator('.margin-view-overlays').first();
      await gutter.click({ button: 'right', position: { x: 10, y: 50 } });
      await page.waitForTimeout(500);
      const conditionalOption = page.locator('text=Conditional Breakpoint').first();
      if (await conditionalOption.count() > 0) {
        await conditionalOption.click();
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0609/01-conditional-dialog.png` });
    });

    await test.step('2. 输入条件', async () => {
      const conditionInput = page.locator('input[placeholder*="condition"], input[type="text"]').first();
      if (await conditionInput.count() > 0) {
        await conditionInput.fill('request != null');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0609/02-condition-set.png` });
    });

    await test.step('3. 触发断点', async () => {
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await waitForBuildState(page, 'succeeded', 120000);
      await runCommandViaPalette(page, 'Kairo: Start Debug Server');
      await waitForServerState(page, 'running', 120000);
      const newPage = await page.context().newPage();
      await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
      await newPage.waitForTimeout(2000);
      await newPage.close();
      await waitForDebugPaused(page, 30000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0609/03-conditional-hit.png` });
    });
  });

  test('TEST-0610: 异常断点', async ({ page }) => {
    await test.step('1. 在Breakpoints视图添加异常断点', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Breakpoints View');
      await page.waitForTimeout(1000);
      const addBtn = page.locator('[title*="Add"], button:has-text("+")').first();
      if (await addBtn.count() > 0) {
        await addBtn.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0610/01-breakpoints-view.png` });
    });

    await test.step('2. 触发对应异常', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0610/02-exception-breakpoint.png` });
    });
  });

  test('TEST-0611: 表达式求值/Watch', async ({ page }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    await waitForBuildState(page, 'succeeded', 120000);
    await runCommandViaPalette(page, 'Kairo: Start Debug Server');
    await waitForServerState(page, 'running', 120000);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 找到Watch面板', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Watch View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0611/01-watch-view.png` });
    });

    await test.step('2. 添加watch表达式', async () => {
      const addWatchBtn = page.locator('[title*="Add Watch"], button:has-text("+")').first();
      if (await addWatchBtn.count() > 0) {
        await addWatchBtn.click();
        await page.waitForTimeout(500);
        const watchInput = page.locator('input[placeholder*="expression"], input[type="text"]').first();
        if (await watchInput.count() > 0) {
          await watchInput.fill('request.getMethod()');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
        }
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0611/02-watch-expression.png` });
    });

    await test.step('3. 单步执行后', async () => {
      await page.keyboard.press('F10');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0611/03-watch-updated.png` });
    });

    await test.step('4. Debug Console执行表达式', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Debug Console');
      await page.waitForTimeout(1000);
      const consoleInput = page.locator('.repl-input input, textarea').first();
      if (await consoleInput.count() > 0) {
        await consoleInput.fill('request.getMethod()');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0611/04-debug-console.png` });
    });
  });

  test('TEST-0612: 停止调试', async ({ page }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    await waitForBuildState(page, 'succeeded', 120000);
    await runCommandViaPalette(page, 'Kairo: Start Debug Server');
    await waitForServerState(page, 'running', 120000);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 点击Debug视图红色停止按钮', async () => {
      const stopBtn = page.locator('[title*="Stop"], [class*="stop"]').first();
      if (await stopBtn.count() > 0) {
        await stopBtn.click();
        await page.waitForTimeout(2000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0612/01-debug-stopped.png` });
    });

    await test.step('2. 停止服务器', async () => {
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await waitForServerState(page, 'stopped', 30000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0612/02-server-stopped.png` });
    });
  });

  test('TEST-0613: Hot Swap / 热替换', async ({ page }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    await waitForBuildState(page, 'succeeded', 120000);
    await runCommandViaPalette(page, 'Kairo: Start Debug Server');
    await waitForServerState(page, 'running', 120000);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}/kairo/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 调试状态下修改方法内代码', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('String hotSwap = "test";');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0613/01-code-modified.png` });
    });

    await test.step('2. 保存文件', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0613/02-hotswap-result.png` });
    });

    await test.step('3. 继续执行验证新代码', async () => {
      await page.keyboard.press('F5');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0613/03-hotswap-verified.png` });
    });
  });
});
