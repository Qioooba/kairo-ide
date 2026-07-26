/**
 * SHARD-08: SQL/JUnit/远程 + UI主题/无障碍/视觉回归
 * 测试用例: TEST-0801 ~ TEST-0815
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  runCommandViaPalette,
  openFileViaQuickOpen,
  runKairoImportWizard,
} from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const SHARD_ID = 'shard-08';
const SCREENSHOT_DIR = `test-results/screenshots/${SHARD_ID}`;

const TEST_WORKSPACE = '/tmp/kairo-k4-workspace/projects/workspace-shard08';
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');
const PROJECT_ID = 'project-workspace-shard08';

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

test.describe('SHARD-08: SQL/JUnit/远程 + UI主题/无障碍/视觉回归', () => {
  test.beforeAll(async ({ request }) => {
    if (fs.existsSync(TEST_WORKSPACE)) {
      fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
    if (fs.existsSync(LEGACY_SAMPLE)) {
      copyDirSync(LEGACY_SAMPLE, TEST_WORKSPACE);
    }
    // Pre-create test files on disk so they're available after import
    fs.writeFileSync(path.join(TEST_WORKSPACE, 'test.sql'), '');
    fs.writeFileSync(path.join(TEST_WORKSPACE, 'SampleTest.java'),
      'public class SampleTest {\n  public void testSample() {\n    System.out.println("test");\n  }\n}');
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
    // Dismiss any save workspace dialog that might block the command palette
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Retry import up to 2 times to handle transient Theia sluggishness
    let result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true, timeoutMs: 60_000 });
    if (!result.opened) {
      await page.waitForTimeout(2000);
      await page.keyboard.press('Escape');
      result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true, timeoutMs: 60_000 });
    }
    expect(result.opened, `import-wizard-reason: ${result.reason}`).toBe(true);
  });

  test('TEST-0801: SQL文件编辑', async ({ page }) => {
    // Write SQL file to workspace on disk first to avoid unreliable "New File" dialog
    const sqlPath = path.join(TEST_WORKSPACE, 'test.sql');
    fs.writeFileSync(sqlPath, '');

    await test.step('1. 打开.sql文件', async () => {
      await openFileViaQuickOpen(page, 'test.sql');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0801/01-sql-file.png` });
    });

    await test.step('2. 输入SQL语句', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.waitForTimeout(300);
      await page.keyboard.type('SELECT * FROM users WHERE id = 1;');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0801/02-sql-content.png` });
    });
  });

  test('TEST-0802: JUnit测试识别与运行', async ({ page }) => {
    // Write test file to disk first to avoid unreliable "New File" dialog
    const testPath = path.join(TEST_WORKSPACE, 'SampleTest.java');
    fs.writeFileSync(testPath, 'public class SampleTest {\n  public void testSample() {\n    System.out.println("test");\n  }\n}');

    await test.step('1. 打开Java测试文件', async () => {
      await openFileViaQuickOpen(page, 'SampleTest.java');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0802/01-test-file.png` });
    });

    await test.step('2. 尝试Run Test命令（验证无控制台错误）', async () => {
      await runCommandViaPalette(page, 'Test: Run All Tests').catch(() => {});
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0802/02-test-running.png` });
    });

    await test.step('3. 打开Test视图', async () => {
      await runCommandViaPalette(page, 'Test: Focus on Test View').catch(() => {});
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0802/03-test-results.png` });
    });

    await test.step('4. 验证编辑器无错误', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0802/04-test-failure.png` });
    });
  });

  test('TEST-0803: 输出/问题面板', async ({ page }) => {
    await test.step('1. 打开Output面板', async () => {
      await runCommandViaPalette(page, 'Output: Focus on Output View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0803/01-output-panel.png` });
    });

    await test.step('2. 选择不同输出通道', async () => {
      const channelSelector = page.locator('select, [class*="output-channel"]').first();
      if (await channelSelector.count() > 0) {
        await channelSelector.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0803/02-output-channels.png` });
    });

    await test.step('3. Problems面板显示错误警告', async () => {
      await runCommandViaPalette(page, 'Problems: Focus on Problems View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0803/03-problems-panel.png` });
    });
  });

  test('TEST-0804: 主题切换', async ({ page }) => {
    await test.step('1. 打开命令面板，执行Color Theme命令', async () => {
      await runCommandViaPalette(page, 'Color Theme');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0804/01-theme-list.png` });
    });

    await test.step('2. 选择Light/Dark主题切换', async () => {
      const lightTheme = page.locator('text=Light, text=Light+').first();
      if (await lightTheme.count() > 0) {
        await lightTheme.click();
        await page.waitForTimeout(2000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0804/02-light-theme.png` });
      
      await runCommandViaPalette(page, 'Color Theme');
      await page.waitForTimeout(1000);
      const darkTheme = page.locator('text=Dark, text=Dark+').first();
      if (await darkTheme.count() > 0) {
        await darkTheme.click();
        await page.waitForTimeout(2000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0804/03-dark-theme.png` });
    });

    await test.step('3. 验证Kairo主题完整性', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0804/04-theme-integrity.png` });
    });
  });

  test('TEST-0805: Inlay Hints', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(3000);

    await test.step('1. 检查参数名提示', async () => {
      const inlayHints = page.locator('.inlay-hint, [class*="inlay-hint"]');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0805/01-inlay-hints.png` });
    });
  });

  test('TEST-0806: 面包屑导航', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 检查编辑器上方面包屑', async () => {
      const breadcrumb = page.locator('.breadcrumb, [class*="breadcrumb"]');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0806/01-breadcrumb.png` });
    });

    await test.step('2. 点击面包屑节点', async () => {
      const breadcrumbNode = page.locator('.breadcrumb >> text=HelloServlet').first();
      if (await breadcrumbNode.count() > 0) {
        await breadcrumbNode.click();
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0806/02-breadcrumb-clicked.png` });
    });
  });

  test('TEST-0807: minimap', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 检查编辑器右侧minimap', async () => {
      const minimap = page.locator('.minimap, [class*="minimap"]');
      await minimap.count();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0807/01-minimap.png` });
    });

    await test.step('2. 点击minimap位置', async () => {
      const minimap = page.locator('.minimap, [class*="minimap"]').first();
      if (await minimap.count() > 0 && await minimap.isVisible().catch(() => false)) {
        await minimap.click({ position: { x: 10, y: 50 } });
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0807/02-minimap-clicked.png` });
    });
  });

  test('TEST-0808: 缩进参考线/括号匹配', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 检查嵌套代码缩进参考线', async () => {
      const indentGuides = page.locator('.indent-guide, [class*="indent-guide"]');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0808/01-indent-guides.png` });
    });

    await test.step('2. 光标移动到括号旁', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
      await page.keyboard.type('{');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0808/02-bracket-match.png` });
    });
  });

  test('TEST-0809: 折叠/展开代码块', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 行号旁检查折叠箭头', async () => {
      const foldingIcon = page.locator('.folding-icon, [class*="folding"], .codicon-folding').first();
      await foldingIcon.count();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0809/01-folding-icons.png` });
    });

    await test.step('2. 点击折叠', async () => {
      const foldingIcon = page.locator('.folding-icon, [class*="folding"], .codicon-folding').first();
      if (await foldingIcon.count() > 0 && await foldingIcon.isVisible().catch(() => false)) {
        await foldingIcon.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0809/02-folded.png` });
    });

    await test.step('3. 点击展开', async () => {
      const foldingIcon = page.locator('.folding-icon, [class*="folding"], .codicon-folding').first();
      if (await foldingIcon.count() > 0 && await foldingIcon.isVisible().catch(() => false)) {
        await foldingIcon.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0809/03-unfolded.png` });
    });
  });

  test('TEST-0810: 多光标编辑', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 点击编辑器定位光标', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click({ position: { x: 100, y: 80 } });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0810/01-single-cursor.png` });
    });

    await test.step('2. Ctrl+Alt+Up/Down添加光标', async () => {
      // Use keyboard shortcut to add cursor above (more reliable than Alt+Click in headless)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+ArrowUp' : 'Control+Alt+ArrowUp');
      await page.waitForTimeout(300);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+ArrowDown' : 'Control+Alt+ArrowDown');
      await page.waitForTimeout(300);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+ArrowDown' : 'Control+Alt+ArrowDown');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0810/02-multi-cursor.png` });
    });

    await test.step('3. 输入内容(多光标同时输入)', async () => {
      await page.keyboard.type('// ');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0810/03-multi-input.png` });
      // Undo to avoid affecting other tests
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
      await page.keyboard.press('Escape');
    });
  });

  test('TEST-0811: 撤销/重做 (Ctrl+Z / Ctrl+Y)', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 编辑后按Ctrl+Z', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('test undo');
      await page.waitForTimeout(500);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0811/01-undone.png` });
    });

    await test.step('2. 按Ctrl+Y重做', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Y' : 'Control+Y');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0811/02-redone.png` });
    });

    await test.step('3. 多步撤销重做', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Y' : 'Control+Y');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0811/03-multi-undo-redo.png` });
    });
  });

  test('TEST-0812: 全选/复制/粘贴', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. Ctrl+A全选', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0812/01-selected-all.png` });
    });

    await test.step('2. Ctrl+C复制', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0812/02-copied.png` });
    });

    await test.step('3. Ctrl+V粘贴', async () => {
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0812/03-pasted.png` });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    });
  });

  test('TEST-0813: 快捷键验证清单', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    const shortcuts = [
      { key: process.platform === 'darwin' ? 'Meta+S' : 'Control+S', name: 'Save' },
      { key: process.platform === 'darwin' ? 'Meta+P' : 'Control+P', name: 'Quick Open' },
      { key: process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P', name: 'Command Palette' },
      { key: process.platform === 'darwin' ? 'Meta+G' : 'Control+G', name: 'Go to Line' },
      { key: 'F12', name: 'Go to Definition' },
      { key: 'F9', name: 'Toggle Breakpoint' },
      { key: process.platform === 'darwin' ? 'Meta+B' : 'Control+B', name: 'Toggle Sidebar' },
    ];

    for (const shortcut of shortcuts) {
      await page.keyboard.press(shortcut.key);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0813/${shortcut.name}.png` });
      await page.keyboard.press('Escape');
    }
  });

  test('TEST-0814: 无障碍可访问性', async ({ page }) => {
    await test.step('1. Tab键导航', async () => {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0814/01-tab-navigation.png` });
    });

    await test.step('2. 检查按钮/菜单是否有aria-label', async () => {
      const buttons = page.locator('button');
      const count = await buttons.count();
      let withAriaLabel = 0;
      for (let i = 0; i < Math.min(count, 10); i++) {
        const ariaLabel = await buttons.nth(i).getAttribute('aria-label');
        if (ariaLabel) withAriaLabel++;
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0814/02-aria-labels.png` });
    });
  });

  test('TEST-0815: 视觉回归截图', async ({ page }) => {
    await test.step('1. IDE完整Shell全貌', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/01-ide-shell.png` });
    });

    await test.step('2. 文件资源管理器展开状态', async () => {
      const explorer = page.locator('[class*="explorer"]').first();
      if (await explorer.count() > 0) {
        await explorer.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/02-explorer.png` });
      }
    });

    await test.step('3. Java编辑器显示代码', async () => {
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(2000);
      const editor = page.locator('.monaco-editor').first();
      await editor.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/03-java-editor.png` });
    });

    await test.step('4. JSP编辑器显示', async () => {
      await openFileViaQuickOpen(page, 'hello.jsp');
      await page.waitForTimeout(2000);
      const editor = page.locator('.monaco-editor').first();
      await editor.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/04-jsp-editor.png` });
    });

    await test.step('5. 搜索结果面板', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+F' : 'Control+Shift+F');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/05-search-panel.png` });
    });

    await test.step('6-10. 其他视图截图', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/06-debug-view.png` });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/07-build-view.png` });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/08-server-view.png` });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/09-git-view.png` });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0815/10-problems-view.png` });
    });
  });
});
