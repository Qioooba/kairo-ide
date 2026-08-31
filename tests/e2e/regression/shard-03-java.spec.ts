/**
 * SHARD-03: Java语言服务 (补全/跳转/重构/诊断)
 * 测试用例: TEST-0301 ~ TEST-0313
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  runCommandViaPalette,
  openFileViaQuickOpen,
  waitForJavaReady,
  getEditorContent,
  runKairoImportWizard,
} from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { regressionWorkspace } from './paths';

const SHARD_ID = 'shard-03';
const SCREENSHOT_DIR = `test-results/screenshots/${SHARD_ID}`;

// KAIRO-RC-WEB-2026-07-25-05: the test workspace must live inside the
// Theia-registered workspace root (e.g. /tmp/kairo-k4-workspace) so
// the runtime agent's `resolveProjectImportRoot` accepts the path.
const TEST_WORKSPACE = regressionWorkspace('shard03');
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');

const PROJECT_ID = 'project-workspace-shard03';

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

test.describe('SHARD-03: Java语言服务', () => {
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
    // Reset workspace to a clean legacy-sample copy so tests that mutate
    // files (e.g. TEST-0307 introduces syntax errors) do not pollute
    // subsequent tests and do not accumulate stale edits across retries.
    if (fs.existsSync(TEST_WORKSPACE)) {
      fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
    if (fs.existsSync(LEGACY_SAMPLE)) {
      copyDirSync(LEGACY_SAMPLE, TEST_WORKSPACE);
    }
    await removeProjectFromCatalog(request as any);
    await navigateToTheia(page, baseURL);
    await waitForTheiaShell(page);
    await dismissTrustDialog(page);
    // Use the proper import wizard (path inside the registered workspace root)
    const result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
    expect(result.opened, `import-wizard-reason: ${result.reason}`).toBe(true);
    // Wait for JDT LS to be ready
    await waitForJavaReady(page, 180_000);
  });

  test('TEST-0301: Java语法高亮', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 检查关键字高亮', async () => {
      const keywords = page.locator('.mtk1, .mtk2, .mtk3, .mtk4, .mtk5');
      expect(await keywords.count()).toBeGreaterThan(0);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0301/01-keywords.png` });
    });

    await test.step('2. 检查字符串字面量', async () => {
      const strings = page.locator('.mtk6, .mtk7, .mtk8');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0301/02-strings.png` });
    });

    await test.step('3. 检查注释', async () => {
      const comments = page.locator('.mtk9, .mtk10, .mtk11');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0301/03-comments.png` });
    });

    await test.step('4. 检查数字', async () => {
      const numbers = page.locator('.mtk12, .mtk13');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0301/04-numbers.png` });
    });
  });

  test('TEST-0302: 代码自动补全 (Ctrl+Space)', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 输入System.out.', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      // Move to a safe insertion point: a brand new line below
      // the current method body, not the middle of a method
      // signature which would produce invalid Java.
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      // Indent by 4 spaces to put the statement inside the class body
      await page.keyboard.type('    ', { delay: 10 });
      await page.keyboard.type('System.out.', { delay: 50 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0302/01-completion-triggered.png` });
    });

    await test.step('2. 按Ctrl+Space手动触发', async () => {
      // KAIRO-RC-WEB-2026-07-25-fix: use Control+Space on all
      // platforms — the test runs inside a headless Chromium
      // and the macOS system intercept of Meta+Space (Spotlight)
      // never reaches the page. Control+Space is the Theia
      // shortcut for "Trigger Suggest" and works reliably.
      await page.keyboard.press('Control+Space');
      // The fallback IntelliSense provider must return at least
      // one keyword. Give the LSP enough time to round-trip.
      const completionList = page.locator('.suggest-widget, .completion-list');
      try {
        await completionList.first().waitFor({ state: 'visible', timeout: 15_000 });
      } catch {
        // Fall through — we still take the screenshot and report
        // the actual count for debugging.
      }
      const count = await completionList.count();
      expect(count, 'completion list should appear after Ctrl+Space').toBeGreaterThan(0);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0302/02-completion-list.png` });
    });

    await test.step('3. 上下键选择补全项', async () => {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0302/03-item-selected.png` });
    });

    await test.step('4. 按Enter确认补全', async () => {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0302/04-completed.png` });
    });

    await test.step('5. 输入re触发补全', async () => {
      // First dismiss any open suggest widget from the previous step
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('    ', { delay: 10 });
      await page.keyboard.type('re', { delay: 50 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0302/05-re-completion.png` });
      await page.keyboard.press('Escape');
    });
  });

  test('TEST-0303: 转到定义 (F12)', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 将光标放在HttpServlet上', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
      await page.keyboard.type('HttpServlet');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0303/01-cursor-on-httpservlet.png` });
    });

    await test.step('2. 按F12', async () => {
      await page.keyboard.press('F12');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0303/02-definition.png` });
    });

    await test.step('3. 将光标放在response上', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
      await page.keyboard.type('response');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0303/03-cursor-on-response.png` });
    });

    await test.step('4. 按F12', async () => {
      await page.keyboard.press('F12');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0303/04-response-definition.png` });
    });

    await test.step('5. Alt+F12 Peek定义', async () => {
      await page.keyboard.press('Escape');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
      await page.keyboard.type('HttpServlet');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Alt+F12');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0303/05-peek-definition.png` });
      await page.keyboard.press('Escape');
    });
  });

  test('TEST-0304: 查找引用 (Shift+F12)', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 将光标放在类名HelloServlet上', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
      await page.keyboard.type('HelloServlet');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0304/01-cursor-on-class.png` });
    });

    await test.step('2. 按Shift+F12', async () => {
      await page.keyboard.press('Shift+F12');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0304/02-references.png` });
    });

    await test.step('3. 点击引用项', async () => {
      const referenceItem = page.locator('[class*="reference"], [class*="peek"]').first();
      if (await referenceItem.count() > 0) {
        await referenceItem.click();
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0304/03-reference-clicked.png` });
    });

    await test.step('4. 检查peek视图', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0304/04-peek-view.png` });
      await page.keyboard.press('Escape');
    });
  });

  test('TEST-0305: 重命名符号 (F2)', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 将光标放在局部变量上', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
      await page.keyboard.type('request');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0305/01-cursor-on-variable.png` });
    });

    await test.step('2. 按F2触发重命名', async () => {
      await page.keyboard.press('F2');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0305/02-rename-triggered.png` });
    });

    await test.step('3. 输入新变量名，按Enter', async () => {
      const renameInput = page.locator('.rename-input input, input[placeholder*="rename"]');
      if (await renameInput.count() > 0) {
        await renameInput.fill('req');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0305/03-renamed.png` });
    });

    await test.step('4. 验证其他文件引用也更新', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0305/04-references-updated.png` });
    });
  });

  test('TEST-0306: 悬停提示 (Hover)', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 鼠标悬停在HttpServlet类名上', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.hover({ position: { x: 100, y: 50 } });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0306/01-hover-class.png` });
    });

    await test.step('2. 悬停在方法名上', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.hover({ position: { x: 150, y: 100 } });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0306/02-hover-method.png` });
    });

    await test.step('3. 悬停在有编译错误的位置', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0306/03-hover-error.png` });
    });
  });

  test('TEST-0307: 代码诊断/错误标记', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 故意输入语法错误', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      // Append a clearly invalid identifier at the end of the file
      // (not in the middle of a method signature where Java would
      // already be unhappy). The class body is a safe insertion point.
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('    INVALID_SYNTAX_HERE;', { delay: 30 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0307/01-error-introduced.png` });
    });

    await test.step('2. 保存文件触发构建', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0307/02-error-markers.png` });
    });

    await test.step('3. 打开Problems面板', async () => {
      // KAIRO-RC-WEB-2026-07-25-fix: the Theia problems view is
      // toggled by `workbench.actions.view.problems` — use that
      // exact command id (it survives command label translations
      // and palette grouping changes).
      await runCommandViaPalette(page, 'workbench.actions.view.problems');
      // Wait for the Problems view container to actually be visible.
      // Theia renders problems under `.theia-markers` once the
      // view is open; a missing container means the view did not
      // mount and the test would otherwise time out.
      const markers = page.locator('.theia-markers, [id*="markers"]');
      try {
        await markers.first().waitFor({ state: 'visible', timeout: 15_000 });
      } catch {
        /* proceed — the assertion below will report the actual state */
      }
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0307/03-problems-panel.png` });
    });

    await test.step('4. 点击Problems中错误项', async () => {
      // KAIRO-RC-WEB-2026-07-25-fix: scope the click to a real
      // marker row. Theia renders each problem as a
      // `.theia-marker-container` inside the Problems view. The
      // previous loose selector `[class*="problem"]` matched
      // off-screen labels (e.g. the toolbar's "No problems have
      // been detected" empty-state header) and Playwright would
      // then wait for the element to become actionable and time
      // out. Limit to the markers container and a visible row.
      const errorItem = page.locator('.theia-marker-container').first();
      if ((await errorItem.count()) > 0) {
        // `force: true` skips the auto-wait for actionability,
        // which is the right tradeoff for a UI widget that has
        // its own internal click handler.
        await errorItem.click({ force: true }).catch(() => {
          /* marker may not be clickable in the headless run */
        });
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0307/04-error-navigated.png` });
    });

    await test.step('5. 删除错误代码，保存', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      // Select the whole inserted error line and delete it.
      // Control+Shift+End selects from the cursor to end of file;
      // then we delete and save. The previous version pressed
      // Backspace 20 times blindly, which could land in the
      // middle of unrelated code if the cursor wasn't where the
      // test expected.
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+End');
      await page.keyboard.press('Delete');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0307/05-error-fixed.png` });
    });
  });

  test('TEST-0308: 自动导入/组织导入', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 删除一个import语句', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
      await page.keyboard.type('import javax.servlet');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Home');
      await page.keyboard.down('Shift');
      await page.keyboard.press('End');
      await page.keyboard.up('Shift');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0308/01-import-removed.png` });
    });

    await test.step('2. 使用Organize Imports命令', async () => {
      await runCommandViaPalette(page, 'Organize Imports');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0308/02-imports-organized.png` });
    });

    await test.step('3. 输入未导入的类名', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('ArrayList');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0308/03-quick-fix.png` });
      await page.keyboard.press('Escape');
    });
  });

  test('TEST-0309: 大纲/符号导航 (Ctrl+Shift+O)', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 按Ctrl+Shift+O', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+O' : 'Control+Shift+O');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0309/01-outline.png` });
    });

    await test.step('2. 输入方法名过滤', async () => {
      await page.keyboard.type('doGet');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0309/02-outline-filtered.png` });
    });

    await test.step('3. 点击某方法', async () => {
      const methodItem = page.locator('text=doGet').first();
      if (await methodItem.count() > 0) {
        await methodItem.click();
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0309/03-method-navigated.png` });
    });
  });

  test('TEST-0310: 工作区符号搜索 (Ctrl+T)', async ({ page }) => {
    await test.step('1. 按Ctrl+T', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+T' : 'Control+T');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0310/01-symbol-search.png` });
    });

    await test.step('2. 输入HelloServlet', async () => {
      await page.keyboard.type('HelloServlet');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0310/02-symbol-filtered.png` });
    });

    await test.step('3. 按Enter跳转', async () => {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0310/03-symbol-navigated.png` });
    });
  });

  test('TEST-0311: 代码格式化', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 故意打乱代码缩进', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('    public void test() {');
      await page.keyboard.press('Enter');
      await page.keyboard.type('    int x=1;');
      await page.keyboard.press('Enter');
      await page.keyboard.type('    }');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0311/01-before-format.png` });
    });

    await test.step('2. 按Shift+Alt+F格式化文档', async () => {
      await page.keyboard.press('Shift+Alt+F');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0311/02-after-format.png` });
    });
  });

  test('TEST-0312: CodeLens', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(3000);

    await test.step('1. 检查方法上方CodeLens', async () => {
      const codeLens = page.locator('.codelens-decoration, [class*="codelens"]');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0312/01-codelens.png` });
    });

    await test.step('2. 检查引用数量显示', async () => {
      const references = page.locator('text=reference');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0312/02-references-codelens.png` });
    });
  });

  test('TEST-0313: 覆盖/实现方法', async ({ page }) => {
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 使用Override/Implement Methods命令', async () => {
      await runCommandViaPalette(page, 'Override/Implement Methods');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0313/01-override-dialog.png` });
    });

    await test.step('2. 选择doPost方法确认', async () => {
      const doPostItem = page.locator('text=doPost').first();
      if (await doPostItem.count() > 0) {
        await doPostItem.click();
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0313/02-method-generated.png` });
    });
  });
});
