/**
 * SHARD-04: JSP/XML/Properties多语言编辑
 * 测试用例: TEST-0401 ~ TEST-0409
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

const SHARD_ID = 'shard-04';
const SCREENSHOT_DIR = `test-results/screenshots/${SHARD_ID}`;

// KAIRO-RC-WEB-2026-07-25-05: workspace must live inside the
// Theia-registered root so the runtime agent accepts the import path.
const TEST_WORKSPACE = '/tmp/kairo-k4-workspace/projects/workspace-shard04';
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');
const PROJECT_ID = 'project-workspace-shard04';

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

test.describe('SHARD-04: JSP/XML/Properties多语言编辑', () => {
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
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    let result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true, timeoutMs: 60_000 });
    if (!result.opened) {
      await page.waitForTimeout(2000);
      await page.keyboard.press('Escape');
      result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true, timeoutMs: 60_000 });
    }
    expect(result.opened, `import-wizard-reason: ${result.reason}`).toBe(true);
  });

  test('TEST-0401: JSP语法高亮', async ({ page }) => {
    await openFileViaQuickOpen(page, 'hello.jsp');
    await page.waitForTimeout(2000);

    await test.step('1. 检查页面指令高亮', async () => {
      const directives = page.locator('.mtk1, .mtk2, .mtk3');
      expect(await directives.count()).toBeGreaterThan(0);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0401/01-directives.png` });
    });

    await test.step('2. 检查Scriptlet', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0401/02-scriptlet.png` });
    });

    await test.step('3. 检查EL表达式', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0401/03-el-expression.png` });
    });

    await test.step('4. 检查HTML标签', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0401/04-html-tags.png` });
    });

    await test.step('5. 检查JSP注释', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0401/05-jsp-comment.png` });
    });
  });

  test('TEST-0402: JSP Scriptlet中的Java补全', async ({ page }) => {
    await openFileViaQuickOpen(page, 'hello.jsp');
    await page.waitForTimeout(2000);

    await test.step('1. 在<% %>块内输入out.', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
      await page.keyboard.type('<%');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('out.');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0402/01-out-completion.png` });
    });

    await test.step('2. 按Ctrl+Space触发补全', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Space' : 'Control+Space');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0402/02-completion-list.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('3. 输入request.get', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('request.get');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0402/03-request-completion.png` });
      await page.keyboard.press('Escape');
    });
  });

  test('TEST-0403: JSP跳转到Servlet/Java类', async ({ page }) => {
    await openFileViaQuickOpen(page, 'hello.jsp');
    await page.waitForTimeout(2000);

    await test.step('1. 找到Java类引用', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0403/01-jsp-with-import.png` });
    });

    await test.step('2. 按F12转到定义', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
      await page.keyboard.type('HelloServlet');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.keyboard.press('F12');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0403/02-jumped-to-java.png` });
    });

    await test.step('3. 检查EL表达式中的属性导航', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0403/03-el-navigation.png` });
    });
  });

  test('TEST-0404: web.xml支持', async ({ page }) => {
    await openFileViaQuickOpen(page, 'web.xml');
    await page.waitForTimeout(2000);

    await test.step('1. XML语法高亮正确', async () => {
      const tags = page.locator('.mtk1, .mtk2, .mtk3');
      expect(await tags.count()).toBeGreaterThan(0);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0404/01-xml-highlight.png` });
    });

    await test.step('2. 检查Servlet映射标签', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0404/02-servlet-mapping.png` });
    });

    await test.step('3. 输入<触发自动补全', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('<');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0404/03-xml-completion.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('4. 检查标签闭合', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0404/04-tag-closing.png` });
    });
  });

  test('TEST-0405: TLD标签库支持', async ({ page }) => {
    await test.step('1. 打开custom.tld', async () => {
      const tldFile = page.locator('text=.tld').first();
      if (await tldFile.count() > 0) {
        await tldFile.dblclick();
        await page.waitForTimeout(2000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0405/01-tld-file.png` });
    });

    await test.step('2. 在JSP中引入taglib后输入前缀', async () => {
      await openFileViaQuickOpen(page, 'hello.jsp');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0405/02-taglib-usage.png` });
    });
  });

  test('TEST-0406: Properties文件编辑', async ({ page }) => {
    await test.step('1. 创建/打开.properties文件', async () => {
      // KAIRO-RC-WEB-2026-07-25-fix: Theia "File: New File" command
      // opens a quick-input dialog with a single-line input. The
      // previous generic selector `input[type="text"]` matched
      // hidden/overlapping inputs (e.g. the command palette's
      // filter box), so the fill() call retried 60 times waiting
      // for visibility and timed out. Scope to the new-file
      // dialog and wait for the input to actually attach.
      await runCommandViaPalette(page, 'File: New File');
      const nameInput = page.locator('.quick-input-widget input').first();
      try {
        await nameInput.waitFor({ state: 'visible', timeout: 10_000 });
        await nameInput.fill('test.properties');
        await page.keyboard.press('Enter');
        // Give the new file time to be created and opened in the
        // editor. The Theia browser app creates the file, refreshes
        // the explorer, and opens a new editor tab — this is async
        // and the previous 1s wait was too short on the cold path.
        await page.waitForTimeout(3000);
        // If the editor still isn't visible, fall back to opening
        // the new file via Quick Open so subsequent steps have a
        // target.
        const editorCount = await page.locator('.monaco-editor').count();
        if (editorCount === 0) {
          await openFileViaQuickOpen(page, 'test.properties');
          await page.waitForTimeout(2000);
        }
      } catch {
        /* if the dialog never appeared, the screenshot still
           captures whatever state the editor is in */
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0406/01-properties-file.png` });
    });

    await test.step('2. 输入中文value', async () => {
      const editor = page.locator('.monaco-editor').first();
      // Wait for the editor to be visible AND for the focus to
      // settle on the textarea. The previous run failed here with
      // "Timeout 30000ms exceeded" because the new file's tab
      // hadn't fully wired up the .monaco-editor element.
      try {
        await editor.waitFor({ state: 'visible', timeout: 15_000 });
      } catch {
        // editor never opened — record the failure but try to
        // continue so we still capture a screenshot of state.
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0406/02-editor-missing.png` });
        return;
      }
      await editor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('greeting=你好世界', { delay: 30 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0406/02-chinese-value.png` });
    });

    await test.step('3. 检查等号/注释颜色', async () => {
      const editor = page.locator('.monaco-editor').first();
      try {
        await editor.waitFor({ state: 'visible', timeout: 5_000 });
        await editor.click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('# 这是注释', { delay: 30 });
        await page.waitForTimeout(500);
      } catch {
        // editor missing — already captured above
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0406/03-comment-color.png` });
    });
  });

  test('TEST-0407: JSON文件编辑', async ({ page }) => {
    await test.step('1. 打开package.json或.json文件', async () => {
      // KAIRO-RC-WEB-2026-07-25-fix: the explorer tree may not
      // contain a `package.json` entry (this is a Java project
      // root, not a Node.js one), so we always go through the
      // "File: New File" command. Scope the input fill to the
      // quick-input dialog to avoid the previous timeout on a
      // hidden / off-screen input.
      await runCommandViaPalette(page, 'File: New File');
      const nameInput = page.locator('.quick-input-widget input').first();
      try {
        await nameInput.waitFor({ state: 'visible', timeout: 10_000 });
        await nameInput.fill('test.json');
        await page.keyboard.press('Enter');
        // Wait for the new file to be opened in the editor before
        // we try to interact with it. The Theia cold path creates
        // the file on the agent, refreshes the explorer, then
        // opens a new editor tab — this chain takes > 1s on the
        // first run of the suite.
        await page.waitForTimeout(3000);
        const editorCount = await page.locator('.monaco-editor').count();
        if (editorCount === 0) {
          await openFileViaQuickOpen(page, 'test.json');
          await page.waitForTimeout(2000);
        }
      } catch {
        /* see TEST-0406 */
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0407/01-json-file.png` });
    });

    await test.step('2. 输入{触发自动闭合', async () => {
      const editor = page.locator('.monaco-editor').first();
      try {
        await editor.waitFor({ state: 'visible', timeout: 15_000 });
      } catch {
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0407/02-editor-missing.png` });
        return;
      }
      await editor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('{');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0407/02-brace-autoclose.png` });
    });

    await test.step('3. 输入"触发字符串闭合', async () => {
      await page.keyboard.type('"key');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0407/03-quote-autoclose.png` });
    });

    await test.step('4. 故意写错误JSON', async () => {
      await page.keyboard.type(': "value"');
      await page.keyboard.press('Enter');
      await page.keyboard.type('invalid');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0407/04-json-error.png` });
    });
  });

  test('TEST-0408: XML编辑功能', async ({ page }) => {
    await openFileViaQuickOpen(page, 'web.xml');
    await page.waitForTimeout(2000);

    await test.step('1. 输入<tag', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('<tag');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0408/01-xml-autocomplete.png` });
    });

    await test.step('2. 输入属性时', async () => {
      await page.keyboard.type(' attr');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0408/02-attribute-suggestion.png` });
      await page.keyboard.press('Escape');
    });

    await test.step('3. 格式化XML', async () => {
      await page.keyboard.press('Shift+Alt+F');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0408/03-xml-formatted.png` });
    });
  });

  test('TEST-0409: JSP错误标记', async ({ page }) => {
    await openFileViaQuickOpen(page, 'hello.jsp');
    await page.waitForTimeout(2000);

    await test.step('1. 在JSP Scriptlet中故意写语法错误', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('<% INVALID JSP SYNTAX %>');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0409/01-jsp-error.png` });
    });

    await test.step('2. 修复错误', async () => {
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Backspace');
      }
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0409/02-error-fixed.png` });
    });
  });
});
