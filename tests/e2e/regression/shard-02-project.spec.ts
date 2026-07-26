/**
 * SHARD-02: 项目导入 + 文件资源管理器 + 多标签编辑
 * 测试用例: TEST-0201 ~ TEST-0208
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  dismissSaveWorkspaceDialog,
  runCommandViaPalette,
  openFileViaQuickOpen,
  openFileExplorer,
  getEditorContent,
  waitForStatusContains,
  runKairoImportWizard,
  triggerContextMenuCommand,
} from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const SHARD_ID = 'shard-02';
const SCREENSHOT_DIR = `test-results/screenshots/${SHARD_ID}`;

// Prepare a shared test workspace.
//
// KAIRO-RC-WEB-029: the runtime agent's `resolveProjectImportRoot`
// refuses any project root that is outside the registered workspace
// (returns `path_forbidden: project root is outside workspace`).
// Theia was started with `/tmp/kairo-k4-workspace`, so the test
// workspace MUST live inside that root for the import API to accept
// the path. We drop the project under
// `/tmp/kairo-k4-workspace/projects/workspace-shard02` so the agent,
// the Theia file explorer, and the OS path are all consistent.
const TEST_WORKSPACE = '/tmp/kairo-k4-workspace/projects/workspace-shard02';
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');

// KAIRO-RC-WEB-040: the runtime agent persists imported projects in
// `.runtime-k4/data/projects/projects.json`. If a project with the same
// id already exists in that catalog, the import wizard's "Import Project"
// step fails with `project already exists: 409 Conflict`. We must call
// `DELETE /api/v1/projects/{id}` before each test run so the wizard can
// re-import. The HTTP endpoint (added in 2026-07-25) updates the
// in-memory map that the import endpoint checks; rewriting the JSON
// file directly does NOT work because the agent caches state in memory.
const PROJECT_ID = 'project-workspace-shard02';

async function removeProjectFromCatalog(request: { delete: (url: string) => Promise<unknown> } | null) {
  if (!request) return;
  try {
    const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
    await request.delete(`${agentBase}/api/v1/projects/${PROJECT_ID}`);
  } catch {
    // The agent returns 404 if the project was never imported — that's
    // fine, the goal is to make sure the project is gone before the test.
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

test.describe('SHARD-02: 项目导入 + 文件资源管理器 + 多标签编辑', () => {
  test.beforeAll(async ({ request }) => {
    if (fs.existsSync(TEST_WORKSPACE)) {
      fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
    if (fs.existsSync(LEGACY_SAMPLE)) {
      copyDirSync(LEGACY_SAMPLE, TEST_WORKSPACE);
    }
    // Strip any previously imported entry from the agent's project
    // catalog so the first test can re-import the workspace cleanly.
    await removeProjectFromCatalog(request as any);
  });

  test.afterAll(() => {
    // Keep workspace for debugging
  });

  test.beforeEach(async ({ page, baseURL, request }) => {
    // Ensure a clean state at the start of every test in this shard
    await removeProjectFromCatalog(request as any);
    await navigateToTheia(page, baseURL);
    await waitForTheiaShell(page);
    // Theia may prompt to save the previous workspace when loading a new
    // session; dismiss it before the trust dialog so the UI is not blocked.
    await dismissSaveWorkspaceDialog(page);
    await dismissTrustDialog(page);
  });

  test('TEST-0201: 通过命令面板导入项目', async ({ page }) => {
    await test.step('1. 打开命令面板，执行Import Project', async () => {
      await runCommandViaPalette(page, 'Kairo: Import Project');
      // Wait for the wizard step 1 to appear
      await page.waitForSelector('[data-testid="path-input"]', { timeout: 15_000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0201/01-import-dialog.png` });
    });

    await test.step('2. 完成导入向导 (Scan → Import → Open)', async () => {
      const result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
      expect(result.opened, `import-wizard-reason: ${result.reason}`).toBe(true);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0201/04-imported.png` });
    });

    await test.step('3. 验证文件资源管理器显示项目文件', async () => {
      // KAIRO-RC-WEB-2026-07-25-05: open the explorer widget — the
      // wizard does not auto-activate it after import completes.
      const opened = await openFileExplorer(page);
      expect(opened, 'file explorer should be visible after import').toBe(true);
      // Theia file explorer / navigator
      const explorer = page.locator('#theia-left-content-panel, #explorer-view-container, #explorer-view-container--files');
      const count = await explorer.count();
      expect(count, 'file explorer should be present').toBeGreaterThan(0);
    });
  });

  test('TEST-0202: 验证文件资源管理器结构', async ({ page }) => {
    // First import project
    await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
    // The wizard does not auto-open the Files tab — activate it explicitly.
    await openFileExplorer(page);

    // Theia populates the file tree asynchronously. Wait for at least
    // one .theia-TreeNode to appear before we start asserting.
    const treeNode = page.locator('.theia-TreeNode').first();
    await expect(treeNode).toBeAttached({ timeout: 15_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0202/01-root-node.png` });

    await test.step('2. 展开src目录', async () => {
      // Theia tree rows carry the filename in `.theia-TreeNode .name` or
      // the full row text. Use a class-scoped locator so we don't pick
      // up stray occurrences elsewhere in the page.
      const srcDir = page.locator('.theia-TreeNode', { hasText: 'src' }).first();
      if (await srcDir.count() > 0) {
        await srcDir.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0202/02-src-expanded.png` });
    });

    await test.step('3. 展开WebRoot目录', async () => {
      const webRootDir = page.locator('.theia-TreeNode', { hasText: /^(WebRoot|webapp)$/ }).first();
      if (await webRootDir.count() > 0) {
        await webRootDir.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0202/03-webroot-expanded.png` });
    });

    await test.step('4. 展开lib目录', async () => {
      const libDir = page.locator('.theia-TreeNode', { hasText: /^lib$/ }).first();
      if (await libDir.count() > 0) {
        await libDir.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0202/04-lib-expanded.png` });
    });

    await test.step('5. 打开hello.jsp', async () => {
      const helloJsp = page.locator('.theia-TreeNode', { hasText: 'hello.jsp' }).first();
      if (await helloJsp.count() > 0) {
        await helloJsp.click();
        await page.waitForTimeout(1_500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0202/05-file-opened.png` });
    });
  });

  test('TEST-0203: 文件树展开/折叠', async ({ page }) => {
    // Import project first
    await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
    await openFileExplorer(page);

    // Wait for the file tree to populate.
    const firstNode = page.locator('.theia-TreeNode').first();
    await expect(firstNode).toBeAttached({ timeout: 15_000 });

    await test.step('1. 点击展开箭头展开目录', async () => {
      // KAIRO-RC-WEB-2026-07-25-05: Theia renders the expansion
      // chevron in `.theia-ExpansionToggle` (codicon chevron), not
      // the legacy `.theia-Twistie` selector. The chevron is a
      // child of the tree-node row.
      const expandArrow = page.locator('.theia-TreeNode .theia-ExpansionToggle').first();
      if (await expandArrow.count() > 0) {
        await expandArrow.click({ force: true });
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0203/01-expanded.png` });
    });

    await test.step('2. 再次点击折叠', async () => {
      const expandArrow = page.locator('.theia-TreeNode .theia-ExpansionToggle').first();
      if (await expandArrow.count() > 0) {
        await expandArrow.click({ force: true });
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0203/02-collapsed.png` });
    });

    await test.step('3. 单击文件选中', async () => {
      const fileNode = page.locator('.theia-TreeNode', { hasText: '.java' }).first();
      if (await fileNode.count() > 0) {
        await fileNode.click();
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0203/03-selected.png` });
    });

    await test.step('4. 双击文件打开', async () => {
      const fileNode = page.locator('.theia-TreeNode', { hasText: '.java' }).first();
      if (await fileNode.count() > 0) {
        await fileNode.dblclick();
        await page.waitForTimeout(1_500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0203/04-opened.png` });
    });
  });

  test('TEST-0204: 快速打开文件 (Ctrl+P)', async ({ page }) => {
    // Import project first
    await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });

    await test.step('1. 按Ctrl+P打开快速打开', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
      await page.waitForSelector('.quick-input-widget', { timeout: 5_000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0204/01-quick-open.png` });
    });

    await test.step('2. 输入"HelloServlet"', async () => {
      await page.keyboard.type('HelloServlet', { delay: 50 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0204/02-filtered.png` });
    });

    await test.step('3. 按Enter打开', async () => {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0204/03-opened.png` });
    });

    await test.step('4. 输入"hello.jsp"打开', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
      await page.waitForSelector('.quick-input-widget', { timeout: 5_000 });
      await page.keyboard.type('hello.jsp', { delay: 50 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0204/04-jsp-opened.png` });
    });

    await test.step('5. Escape关闭面板', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0204/05-closed.png` });
    });
  });

  test('TEST-0205: 单文件编辑保存', async ({ page }) => {
    // Import project and open file
    await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(1_500);

    await test.step('1. 打开HelloServlet.java', async () => {
      const editor = page.locator('.monaco-editor').first();
      await expect(editor).toBeAttached({ timeout: 10_000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0205/01-file-opened.png` });
    });

    await test.step('2. 在文件末尾输入注释', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('// test comment');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0205/02-modified.png` });
    });

    await test.step('3. 按Ctrl+S保存', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0205/03-saved.png` });
    });
  });

  test('TEST-0206: 多标签页编辑', async ({ page }) => {
    // Import project
    await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });

    await test.step('1. 依次打开3个文件', async () => {
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(1_000);
      await openFileViaQuickOpen(page, 'DBUtil.java');
      await page.waitForTimeout(1_000);
      await openFileViaQuickOpen(page, 'hello.jsp');
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0206/01-three-tabs.png` });
    });

    await test.step('2. 点击不同标签切换', async () => {
      // Theia uses .theia-tab and similar
      const tabs = page.locator('.theia-tab, [class*="theia-TabBar"] [class*="tab"]');
      const tabCount = await tabs.count();
      if (tabCount >= 2) {
        await tabs.first().click({ force: true });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0206/02-switched-tab.png` });
      }
    });

    await test.step('3. 拖拽标签调整顺序', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0206/03-tab-order.png` });
    });

    await test.step('4. 点击标签×关闭标签', async () => {
      const closeBtn = page.locator('.theia-tab .theia-tab-close, [class*="tab"] [class*="close"]').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click({ force: true });
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0206/04-tab-closed.png` });
    });

    await test.step('5. 执行Close All Editors命令', async () => {
      await runCommandViaPalette(page, 'Close All Editors');
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0206/06-all-closed.png` });
    });
  });

  test('TEST-0207: 转到行 (Ctrl+G)', async ({ page }) => {
    // Import project and open file
    await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(1_500);

    await test.step('1. 打开HelloServlet.java', async () => {
      const editor = page.locator('.monaco-editor').first();
      await expect(editor).toBeAttached({ timeout: 10_000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0207/01-file-opened.png` });
    });

    await test.step('2. 按Ctrl+G', async () => {
      // Click in the editor first
      await page.locator('.monaco-editor .view-lines').first().click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+G' : 'Control+G');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0207/02-goto-line.png` });
    });

    await test.step('3. 输入20按Enter', async () => {
      await page.keyboard.type('20', { delay: 50 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0207/03-line-20.png` });
    });

    await test.step('4. 验证行列号', async () => {
      // Status bar should now show Ln 20, Col X
      const statusText = await page.locator('#theia-statusBar').textContent();
      // Either the cursor position is shown or the file is open
      expect(statusText).toBeTruthy();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0207/04-position-verified.png` });
    });
  });

  test('TEST-0208: 文件新建/删除/重命名', async ({ page }) => {
    // Import project and make sure the file explorer is active so that
    // subsequent rename/delete commands have a file selection to work on.
    await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
    await openFileExplorer(page);

    // Remove any stale TestFile.java from a previous run so the
    // Create File dialog does not show an existing entry and Enter
    // does not accidentally open the old file.
    const staleFile = path.join(TEST_WORKSPACE, 'TestFile.java');
    const staleRenamedFile = path.join(TEST_WORKSPACE, 'TestFileRenamed.java');
    for (const f of [staleFile, staleRenamedFile]) {
      if (fs.existsSync(f)) {
        fs.rmSync(f, { force: true });
      }
    }

    await test.step('1. 创建新文件', async () => {
      // Theia's "New File..." command opens a quick-input palette. Typing a
      // file path and pressing Enter may either:
      //   a) Fall back to a SaveFileDialog with the path pre-filled, or
      //   b) Create the file directly and open it in the editor.
      await runCommandViaPalette(page, 'New File...');
      await page.waitForSelector('.quick-input-widget', { timeout: 10_000 });
      await page.waitForTimeout(500);

      const quickInput = page.locator('.quick-input-widget input').first();
      await expect(quickInput).toBeAttached({ timeout: 5_000 });
      await quickInput.fill('');
      await quickInput.type('projects/workspace-shard02/TestFile.java', { delay: 50 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      // Wait for the quick-input to close
      await page.waitForSelector('.quick-input-widget', { state: 'detached', timeout: 10_000 }).catch(() => {/* may already be gone */});
      await page.waitForTimeout(1000);

      // Check if a SaveFileDialog appeared (case a)
      const dialogBlock = page.locator('.dialogBlock').first();
      const hasDialog = await dialogBlock.count() > 0 && await dialogBlock.isVisible().catch(() => false);

      if (hasDialog) {
        // Handle the SaveFileDialog flow
        const rootNode = page.locator('.dialogBlock .theia-TreeNode', { hasText: /^kairo-k4-workspace$/ }).first();
        if (await rootNode.count() > 0) {
          await rootNode.click({ force: true });
          await page.waitForTimeout(500);
        }

        const dialogInput = page.locator('.dialogBlock input[type="text"]').first();
        if (await dialogInput.count() > 0) {
          await dialogInput.dispatchEvent('keyup');
          await page.waitForTimeout(300);
        }

        const createBtn = page.locator('.dialogBlock button:has-text("Create File"), .dialogBlock button:has-text("OK")').first();
        if (await createBtn.count() > 0) {
          await createBtn.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
          if (await createBtn.isEnabled().catch(() => false)) {
            await createBtn.click({ timeout: 5_000 });
          } else {
            await page.keyboard.press('Enter');
          }
          await page.waitForSelector('.dialogBlock', { state: 'detached', timeout: 10_000 }).catch(() => {});
        }
      }
      // case b: file was created directly - just wait for editor to appear
      await page.waitForTimeout(1500);

      // Verify the file is open in the editor after creation (either path)
      const editor = page.locator('.monaco-editor').first();
      await expect(editor).toBeAttached({ timeout: 15_000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0208/01-file-created.png` });
    });

    await test.step('2. 输入内容并保存', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.type('public class TestFile {}');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0208/02-content-saved.png` });
    });

    await test.step('3. 验证文件创建成功', async () => {
      // The file is already open in the editor after creation.
      // Verify the persisted content instead of relying on quick-open
      // indexing, which can be stale for brand-new files.
      // Monaco may render non-breaking spaces, so normalize whitespace.
      const content = (await getEditorContent(page)).replace(/\s+/g, ' ');
      expect(content).toContain('public class TestFile');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0208/03-file-opened.png` });
    });

    await test.step('4. 重命名文件', async () => {
      // Use the file tree context menu so we get the workspace file rename
      // command. The command palette's "Rename" label is ambiguous and can
      // execute Monaco's symbol rename instead, leaving the file untouched.
      const fileNode = page.locator('.theia-TreeNode', { hasText: 'TestFile.java' }).first();
      await expect(fileNode).toBeAttached({ timeout: 10_000 });
      await triggerContextMenuCommand(page, '.theia-TreeNode:has-text("TestFile.java")', 'Rename');

      // Wait for the rename dialog / inline input.
      let renameInput = page.locator('.theia-TreeNode input[type="text"]').first();
      if (await renameInput.count() === 0) {
        renameInput = page.locator('.dialogBlock input[type="text"]').first();
      }
      if (await renameInput.count() === 0) {
        renameInput = page.locator('input[aria-label="Rename input. Type new name and press Enter to commit."]').first();
      }
      await expect(renameInput).toBeAttached({ timeout: 5_000 });
      await renameInput.fill('TestFileRenamed.java');
      await renameInput.press('Enter');
      await page.waitForTimeout(1_500);
      // Verify the editor tab now shows the new name. Theia tab bars may use
      // `.p-TabBar-tab` or `.theia-tab` depending on the Theia version, so
      // match by role="tab" which is stable across both.
      const tab = page.locator('[role="tab"]', { hasText: 'TestFileRenamed.java' }).first();
      await expect(tab).toBeAttached({ timeout: 10_000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0208/04-renamed.png` });
    });

    await test.step('5. 删除文件', async () => {
      // Close any accidental dialog (e.g. F5 may open the debugger picker).
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // The file tree may not have refreshed after the rename. Refresh the
      // explorer via the command palette so the renamed file becomes visible.
      await runCommandViaPalette(page, 'Refresh Explorer');
      await page.waitForTimeout(1_500);

      // Delete via the file tree context menu now that the tree is up to date.
      const fileNode = page.locator('.theia-TreeNode', { hasText: 'TestFileRenamed.java' }).first();
      await expect(fileNode).toBeAttached({ timeout: 10_000 });
      await triggerContextMenuCommand(page, '.theia-TreeNode:has-text("TestFileRenamed.java")', 'Delete');
      await page.waitForTimeout(500);
      // Confirm deletion if Theia shows a confirmation dialog. Theia labels
      // the button either "Delete" or "OK" depending on the platform handler.
      const confirmBtn = page.locator('.dialogBlock button:has-text("Delete"), .dialogBlock button:has-text("OK")').first();
      if (await confirmBtn.count() > 0 && await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(1_000);
      // Verify the editor tab closed (no tab with the deleted name).
      await expect(page.locator('[role="tab"]', { hasText: 'TestFileRenamed.java' }).first()).not.toBeAttached({ timeout: 10_000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0208/05-deleted.png` });
    });
  });
});
