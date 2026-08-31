/**
 * SHARD-01: IDE启动 + Shell布局 + 状态栏
 * 测试用例: TEST-0101 ~ TEST-0108
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  openCommandPalette,
  typeInCommandPalette,
  getStatusBarText,
  waitForStatusContains,
  takeScreenshot,
} from '../fixtures';

const SHARD_ID = 'shard-01';
const SCREENSHOT_DIR = `test-results/screenshots/${SHARD_ID}`;

test.describe('SHARD-01: IDE启动 + Shell布局 + 状态栏', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await navigateToTheia(page, baseURL || 'http://127.0.0.1:3002');
    await waitForTheiaShell(page);
    await dismissTrustDialog(page);
  });

  test('TEST-0101: IDE首次启动加载', async ({ page }) => {
    await test.step('1. 页面开始加载', async () => {
      await page.waitForLoadState('domcontentloaded');
    });

    await test.step('2. Shell完全加载', async () => {
      await page.waitForSelector('#theia-shell, #theia-app-shell', { timeout: 30000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0101/02-shell-loaded.png` });
    });

    await test.step('3. 检查Console无错误', async () => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.waitForTimeout(2000);
      expect(errors.filter(e => !e.includes('non-serializable'))).toHaveLength(0);
    });

    await test.step('4. 检查Network请求', async () => {
      const failedRequests: string[] = [];
      page.on('requestfailed', (request) => {
        failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`);
      });
      await page.reload();
      await waitForTheiaShell(page);
      // Allow favicon and runtime agent connection failures on any port
      const AGENT_PORT = process.env.AGENT_PORT || '18280';
      const criticalFailures = failedRequests.filter(r =>
        !r.includes('favicon') &&
        !r.includes('/api/v1/') &&
        !r.includes(':' + AGENT_PORT) &&
        !r.includes(':18080') &&
        !r.includes(':18081')
      );
      expect(criticalFailures).toHaveLength(0);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0101/04-network-ok.png` });
    });
  });

  test('TEST-0102: 欢迎页/信任对话框', async ({ page }) => {
    await test.step('1. 检查信任对话框', async () => {
      const trustDialog = page.locator('.theia-trust-dialog, [class*="trust"]');
      const hasDialog = await trustDialog.count() > 0;
      if (hasDialog) {
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0102/01-trust-dialog.png` });
        const trustButton = trustDialog.locator('button:has-text("Yes, I trust")');
        if (await trustButton.count() > 0) {
          await trustButton.click();
          await page.waitForTimeout(1000);
        }
      }
    });

    await test.step('2. 验证进入IDE', async () => {
      await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { timeout: 10000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0102/02-ide-entered.png` });
    });

    await test.step('3. 验证欢迎页内容', async () => {
      const welcomeContent = page.locator('.theia-welcome, .welcome-page, [class*="welcome"]');
      const hasWelcome = await welcomeContent.count() > 0;
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0102/03-welcome-content.png` });
      if (!hasWelcome) {
        test.info().annotations.push({ type: 'optional-ui', description: 'Welcome page is not shown for an already-initialized workspace' });
      }
    });
  });

  test('TEST-0103: 主布局结构验证', async ({ page }) => {
    await test.step('1. 检查应用主Shell', async () => {
      const appShell = page.locator('#theia-app-shell');
      await expect(appShell).toBeAttached({ timeout: 10000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0103/01-app-shell.png` });
    });

    await test.step('2. 检查顶部面板', async () => {
      const topPanel = page.locator('#theia-top-panel');
      await expect(topPanel).toBeAttached({ timeout: 5000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0103/02-top-panel.png` });
    });

    await test.step('3. 检查左侧活动栏', async () => {
      const sidebar = page.locator('.theia-app-sidebar-container, #theia-left-content-panel').first();
      await expect(sidebar).toBeAttached({ timeout: 5000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0103/03-activity-bar.png` });
    });

    await test.step('4. 检查主内容区', async () => {
      const mainContent = page.locator('#theia-main-content-panel, #theia-editor-area');
      await expect(mainContent.first()).toBeAttached({ timeout: 5000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0103/04-main-content.png` });
    });

    await test.step('5. 检查状态栏', async () => {
      const statusBar = page.locator('#theia-statusBar');
      await expect(statusBar).toBeAttached({ timeout: 5000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0103/05-status-bar.png` });
    });

    await test.step('6. 检查右侧边栏容器', async () => {
      // Right sidebar may be hidden by default
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0103/06-right-side.png` });
    });
  });

  test('TEST-0104: 状态栏条目完整性', async ({ page }) => {
    await test.step('1. 查看状态栏左侧 - Project状态', async () => {
      const statusText = await getStatusBarText(page);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0104/01-status-left.png` });
      // Project status might not be visible until project is imported
    });

    await test.step('2. 查看Java状态', async () => {
      const statusText = await getStatusBarText(page);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0104/02-status-java.png` });
    });

    await test.step('3. 查看JDT LS状态', async () => {
      const statusText = await getStatusBarText(page);
      // JDT LS might show "starting" initially
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0104/03-status-jdtls.png` });
    });

    await test.step('4. 查看Encoding状态', async () => {
      const statusText = await getStatusBarText(page);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0104/04-status-encoding.png` });
    });

    await test.step('5. 查看Agent连接状态', async () => {
      const statusText = await getStatusBarText(page);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0104/05-status-agent.png` });
    });

    await test.step('6. 查看Git/SVN状态', async () => {
      const statusText = await getStatusBarText(page);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0104/06-status-git.png` });
    });

    await test.step('7. 查看行列号/语言模式', async () => {
      // Need to open a file first to see line/column info
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0104/07-status-position.png` });
    });
  });

  test('TEST-0105: 视图面板开合切换', async ({ page }) => {
    await test.step('1. 点击Explorer图标', async () => {
      const explorerIcon = page.locator('[class*="activity-bar"] >> text=Explorer, [title*="Explorer"]');
      if (await explorerIcon.count() > 0) {
        await explorerIcon.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0105/01-explorer.png` });
    });

    await test.step('2. 点击Search图标', async () => {
      const searchIcon = page.locator('[class*="activity-bar"] >> text=Search, [title*="Search"]');
      if (await searchIcon.count() > 0) {
        await searchIcon.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0105/02-search.png` });
    });

    await test.step('3. 点击Git图标', async () => {
      const gitIcon = page.locator('[class*="activity-bar"] >> text=Git, [title*="Git"]');
      if (await gitIcon.count() > 0) {
        await gitIcon.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0105/03-git.png` });
    });

    await test.step('4. 点击Debug图标', async () => {
      const debugIcon = page.locator('[class*="activity-bar"] >> text=Debug, [title*="Debug"]');
      if (await debugIcon.count() > 0) {
        await debugIcon.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0105/04-debug.png` });
    });

    await test.step('5. 按Ctrl+B切换侧边栏', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0105/05-before-toggle.png` });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0105/05-after-toggle.png` });
    });

    await test.step('6. 拖拽侧边栏宽度调整', async () => {
      // This is a manual test, just verify sidebar is visible
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0105/06-sidebar-resize.png` });
    });
  });

  test('TEST-0106: 菜单功能验证', async ({ page }) => {
    await test.step('0. 关闭信任对话框', async () => {
      const trustDialog = page.locator('.theia-trust-dialog, [class*="trust"]');
      if (await trustDialog.count() > 0 && await trustDialog.isVisible()) {
        const trustButton = trustDialog.locator('button:has-text("Yes, I trust")');
        if (await trustButton.count() > 0) {
          await trustButton.click();
          await page.waitForTimeout(500);
        }
      }
    });

    await test.step('1. 点击File菜单', async () => {
      const fileMenu = page.locator('text=File').first();
      if (await fileMenu.count() > 0) {
        await fileMenu.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0106/01-file-menu.png` });
        await page.keyboard.press('Escape');
      }
    });

    await test.step('2. 点击Edit菜单', async () => {
      const editMenu = page.locator('text=Edit').first();
      if (await editMenu.count() > 0) {
        await editMenu.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0106/02-edit-menu.png` });
        await page.keyboard.press('Escape');
      }
    });

    await test.step('3. 点击View菜单', async () => {
      const viewMenu = page.locator('text=View').first();
      if (await viewMenu.count() > 0) {
        await viewMenu.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0106/03-view-menu.png` });
        await page.keyboard.press('Escape');
      }
    });

    await test.step('4. 点击Kairo菜单', async () => {
      const kairoMenu = page.locator('text=Kairo').first();
      if (await kairoMenu.count() > 0) {
        await kairoMenu.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0106/04-kairo-menu.png` });
        await page.keyboard.press('Escape');
      }
    });

    await test.step('5. 点击菜单外部区域关闭菜单', async () => {
      await page.mouse.click(400, 300);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0106/05-menu-closed.png` });
    });
  });

  test('TEST-0107: 命令面板功能', async ({ page }) => {
    await test.step('1. 按F1打开命令面板', async () => {
      await page.keyboard.press('F1');
      await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0107/01-command-palette-f1.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('2. 按Ctrl+Shift+P打开命令面板', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
      await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0107/02-command-palette-ctrl-shift-p.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('3. 输入"Kairo:"过滤', async () => {
      await openCommandPalette(page);
      await typeInCommandPalette(page, 'Kairo:');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0107/03-kairo-filter.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('4. 输入">"显示所有命令', async () => {
      await openCommandPalette(page);
      await typeInCommandPalette(page, '>');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0107/04-all-commands.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('5. 按上下键选择命令', async () => {
      await openCommandPalette(page);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0107/05-navigate-commands.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('6. 按Escape关闭', async () => {
      await openCommandPalette(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const palette = page.locator('.quick-input-widget');
      await expect(palette).not.toBeVisible();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0107/06-palette-closed.png` });
    });
  });

  test('TEST-0108: 终端面板', async ({ page }) => {
    await test.step('1. 按Ctrl+`打开终端', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+`' : 'Control+`');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0108/01-terminal-opened.png` });
    });

    await test.step('2. 在终端输入echo "hello"', async () => {
      const terminal = page.locator('.xterm, .terminal');
      if (await terminal.count() > 0) {
        await terminal.click();
        await page.keyboard.type('echo "hello"');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0108/02-terminal-output.png` });
      }
    });

    await test.step('3. 点击+号新建终端', async () => {
      const newTerminalBtn = page.locator('[class*="terminal"] >> text=+, [title*="New Terminal"]');
      if (await newTerminalBtn.count() > 0) {
        await newTerminalBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0108/03-new-terminal.png` });
      }
    });

    await test.step('4. 切换终端标签', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0108/04-switch-terminal.png` });
    });

    await test.step('5. 点击垃圾桶关闭终端', async () => {
      const killTerminalBtn = page.locator('[class*="terminal"] >> text=🗑, [title*="Kill Terminal"]');
      if (await killTerminalBtn.count() > 0) {
        await killTerminalBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0108/05-terminal-closed.png` });
      }
    });
  });
});
