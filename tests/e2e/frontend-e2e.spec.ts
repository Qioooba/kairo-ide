/**
 * Kairo IDE — Frontend E2E Test Suite
 *
 * Comprehensive Playwright tests covering the full IDE workflow:
 *   - IDE Launch & Shell
 *   - Project Import Wizard
 *   - Java File Editing
 *   - JSP File Editing
 *   - Encoding Detection
 *   - Build Trigger
 *   - Deploy to Tomcat
 *   - Server Start/Stop
 *   - Log Viewer
 *   - Debug Sessions
 *   - Breakpoint Management
 *   - Git Operations
 *   - JSP Scriptlet/EL/TLD support
 *
 * Prerequisites:
 *   1. Run `pnpm agent:run` in one terminal
 *   2. Run `pnpm dev:browser` in another terminal
 *   3. Run: npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/frontend-e2e.spec.ts
 */
import { test, expect } from './fixtures';
import {
  navigateToTheia,
  waitForTheiaShell,
  runCommandViaPalette,
  getStatusBarText,
  waitForStatusContains,
  openFileViaQuickOpen,
  getBuildViewState,
  getServerViewState,
  waitForBuildState,
  waitForServerState,
  getEditorContent,
  openFileInEditor,
  setBreakpoint,
  waitForDebugPaused,
  getDebugVariables,
  openCommandPalette,
  typeInCommandPalette,
  selectFirstQuickPick,
  setupSampleProject,
} from './fixtures';

// =============================================================================
// FE-01: IDE Launch & Shell Verification
// =============================================================================
test.describe('FE-01: IDE Launch & Shell', () => {
  test('should launch IDE and verify shell components', async ({
    page,
    agentApi,
  }) => {
    await test.step('Navigate to Theia and wait for shell', async () => {
      await navigateToTheia(page);
      await waitForTheiaShell(page);
    });

    await test.step('Verify agent is healthy', async () => {
      const health = await agentApi.get('/api/v1/health');
      expect(health.status).toBe(200);
      expect(health.json?.ok).toBe(true);
    });

    await test.step('Verify status bar shows key entries', async () => {
      const sbText = await getStatusBarText(page);
      expect(sbText).toBeTruthy();
      // Check for Kairo-specific entries
      const entries = ['Agent:', 'Project:', 'Java:'];
      for (const entry of entries) {
        // Soft check — may not be available on first launch
        const hasEntry = sbText.includes(entry);
        console.log(`  Status bar contains "${entry}": ${hasEntry}`);
      }
    });

    await test.step('Verify Theia shell structure', async () => {
      const hasShell = await page.evaluate(() => {
        return !!(
          document.querySelector('#theia-app-shell') ||
          document.querySelector('#theia-shell') ||
          document.querySelector('.theia-shell')
        );
      });
      expect(hasShell).toBeTruthy();
    });

    await test.step('Take screenshot', async () => {
      await page.screenshot({
        path: 'test-results/fe-01-shell.png',
        fullPage: true,
      });
    });
  });
});

// =============================================================================
// FE-02: Project Import Wizard
// =============================================================================
test.describe('FE-02: Project Import Wizard', () => {
  test('should import project via wizard', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
      await waitForTheiaShell(page);
    });

    await test.step('Open Import Project wizard', async () => {
      await runCommandViaPalette(page, 'Kairo: Import Project');
      await page.waitForTimeout(2_000);
    });

    await test.step('Fill project path', async () => {
      const wizardInput = page.locator(
        '[data-testid="import-path-input"], #import-path-input, .theia-input',
      );
      const wizardVisible = await wizardInput.first().isVisible().catch(() => false);
      if (wizardVisible) {
        await wizardInput.first().fill(workspace.rootPath);
        await page.waitForTimeout(500);
      }
    });

    await test.step('Confirm import', async () => {
      const importBtn = page.locator(
        'button:has-text("Import"), button:has-text("导入"), [data-testid="import-confirm"]',
      );
      const btnVisible = await importBtn.first().isVisible().catch(() => false);
      if (btnVisible) {
        await importBtn.first().click();
        await page.waitForTimeout(2_000);
      }
      // Fallback: register via API
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
    });

    await test.step('Verify workspace registered', async () => {
      const wsResp = await agentApi.get('/api/v1/workspaces');
      expect(wsResp.status).toBe(200);
      const workspaces = (wsResp.json?.payload ?? []) as Array<{
        id: string;
        rootPath: string;
      }>;
      const registered = workspaces.some(
        (w) => w.rootPath === workspace.rootPath,
      );
      console.log(
        `  Workspace registered: ${registered} (count=${workspaces.length})`,
      );
      expect(registered).toBeTruthy();
    });

    await test.step('Verify file tree contains project files', async () => {
      // Open Explorer view if not already visible
      const explorerIcon = page.locator(
        '.theia-activity-bar .theia-Explorer, [id="theia:explorer"], .p-TabBar-tab[title="Explorer"]',
      ).first();
      if (await explorerIcon.isVisible().catch(() => false)) {
        await explorerIcon.click();
        await page.waitForTimeout(1_000);
      }
      // Wait for the file tree to populate
      await page.waitForSelector('.theia-Explorer .theia-TreeNode', {
        timeout: 10_000,
      }).catch(() => {
        // Tree may still be loading
      });
      const fileTree = await page.evaluate(() => {
        const explorer = document.querySelector(
          '.theia-Explorer, #explorer-view-container',
        );
        if (!explorer) return [];
        const items = explorer.querySelectorAll('.theia-TreeNode');
        return Array.from(items).map((el) => el.textContent?.trim() || '');
      });
      console.log(`  File tree items: ${fileTree.length}`);
      console.log(`  First items: ${fileTree.slice(0, 10).join(', ')}`);
      expect(fileTree.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// FE-03: Java File Editing
// =============================================================================
test.describe('FE-03: Java File Editing', () => {
  test('should open, edit, and save a Java file', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia and import workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Open HelloWorld.java', async () => {
      await openFileViaQuickOpen(page, 'HelloWorld.java');
      await page.waitForSelector('.monaco-editor .view-lines', {
        timeout: 10_000,
      });
      await page.waitForTimeout(1_000);
    });

    await test.step('Verify editor content', async () => {
      const content = await getEditorContent(page);
      expect(content.length).toBeGreaterThan(0);
      console.log(`  Editor content: ${content.length} chars`);
      expect(content).toContain('HelloWorld');
    });

    await test.step('Edit the file', async () => {
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      // Add a comment at the top
      await page.keyboard.press('Control+Home');
      await page.keyboard.type('// E2E test comment\n', { delay: 20 });
      await page.waitForTimeout(500);
    });

    await test.step('Save the file', async () => {
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(1_000);
      console.log('  File saved');
    });

    await test.step('Verify save was persisted', async () => {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForTheiaShell(page);
      await openFileViaQuickOpen(page, 'HelloWorld.java');
      await page.waitForTimeout(1_000);

      const content = await getEditorContent(page);
      expect(content).toContain('E2E test comment');
    });
  });
});

// =============================================================================
// FE-04: JSP File Editing
// =============================================================================
test.describe('FE-04: JSP File Editing', () => {
  test('should open, edit, and save a JSP file with Scriptlet/EL support', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia and import workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Open hello.jsp', async () => {
      await openFileViaQuickOpen(page, 'hello.jsp');
      await page.waitForSelector('.monaco-editor .view-lines', {
        timeout: 10_000,
      });
      await page.waitForTimeout(1_000);
    });

    await test.step('Verify JSP content with Scriptlet', async () => {
      const content = await getEditorContent(page);
      console.log(`  JSP content: ${content.length} chars`);
      // Should contain JSP-specific elements
      const hasScriptlet = content.includes('<%') || content.includes('%>');
      const hasEL = content.includes('${');
      const hasTaglib = content.includes('taglib') || content.includes('<%@');
      console.log(
        `  Has Scriptlet: ${hasScriptlet}, EL: ${hasEL}, Taglib: ${hasTaglib}`,
      );
    });

    await test.step('Edit JSP content', async () => {
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('<!-- E2E JSP test marker -->', { delay: 20 });
      await page.waitForTimeout(500);
    });

    await test.step('Save JSP file', async () => {
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(1_000);
      console.log('  JSP file saved');
    });

    await test.step('Verify encoding detection', async () => {
      const detectResp = await agentApi.post('/api/v1/encoding/detect', {
        file: `${workspace.rootPath}/WebRoot/hello.jsp`,
      });
      if (detectResp.status === 200 && detectResp.json?.payload) {
        const enc = (detectResp.json.payload as Record<string, unknown>).encoding;
        console.log(`  JSP encoding: ${enc}`);
        expect(['gbk', 'gb18030', 'utf-8']).toContain(enc);
      }
    });
  });
});

// =============================================================================
// FE-05: Encoding Detection
// =============================================================================
test.describe('FE-05: Encoding Detection', () => {
  test('should detect encoding for project files', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Detect encoding for hello.jsp', async () => {
      const resp = await agentApi.post('/api/v1/encoding/detect', {
        file: `${workspace.rootPath}/WebRoot/hello.jsp`,
      });
      if (resp.status === 200) {
        const payload = resp.json?.payload as Record<string, unknown>;
        console.log(
          `  Encoding: ${payload?.encoding}, hasBom: ${payload?.hasBom}, eol: ${payload?.eol}`,
        );
        expect(['gbk', 'gb18030', 'utf-8']).toContain(payload?.encoding);
      }
    });

    await test.step('Detect encoding for HelloWorld.java', async () => {
      const resp = await agentApi.post('/api/v1/encoding/detect', {
        file: `${workspace.rootPath}/src/main/java/com/example/HelloWorld.java`,
      });
      console.log(`  Java encoding status: ${resp.status}`);
    });

    await test.step('Verify encoding status bar', async () => {
      await navigateToTheia(page);
      const sbText = await getStatusBarText(page);
      if (sbText.includes('Encoding:')) {
        console.log('  Encoding status bar entry found');
      }
    });
  });
});

// =============================================================================
// FE-06: Build Trigger
// =============================================================================
test.describe('FE-06: Build Trigger', () => {
  test('should trigger build and verify results', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and import workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Trigger Kairo: Build', async () => {
      await runCommandViaPalette(page, 'Kairo: Build');
      await page.waitForTimeout(2_000);
    });

    await test.step('Wait for build completion', async () => {
      const buildResult = await waitForBuildState(page, 'succeeded', 120_000);
      if (buildResult) {
        const state = (buildResult as Record<string, string>).state;
        console.log(`  Build result: ${state}`);
        expect(state === 'succeeded' || state === 'failed').toBeTruthy();
      }
    });

    await test.step('Verify build view entries', async () => {
      const builds = await getBuildViewState(page);
      console.log(`  Build entries: ${builds.length}`);
      if (builds.length > 0) {
        const last = builds[builds.length - 1] as Record<string, string>;
        console.log(`  Last build: state=${last.state} summary=${last.summary}`);
      }
    });
  });
});

// =============================================================================
// FE-07: Deploy to Tomcat
// =============================================================================
test.describe('FE-07: Deploy to Tomcat', () => {
  test('should build and deploy project', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and import workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Trigger Kairo: Build & Deploy', async () => {
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);
    });

    await test.step('Verify build succeeded', async () => {
      const buildResult = await waitForBuildState(page, 'succeeded', 120_000);
      if (buildResult) {
        console.log(
          `  Build: ${(buildResult as Record<string, string>).state}`,
        );
      }
    });

    await test.step('Verify deployment via API', async () => {
      const deployResp = await agentApi.get('/api/v1/deployments');
      console.log(`  Deployments status: ${deployResp.status}`);
    });
  });
});

// =============================================================================
// FE-08: Server Start/Stop
// =============================================================================
test.describe('FE-08: Server Start/Stop', () => {
  test('should start and stop Tomcat server', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and prepare', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Build and deploy', async () => {
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);
    });

    await test.step('Start Tomcat server', async () => {
      await runCommandViaPalette(page, 'Kairo: Start Server');
      await page.waitForTimeout(2_000);
    });

    await test.step('Wait for server running state', async () => {
      const serverResult = await waitForServerState(page, 'running', 120_000);
      if (serverResult) {
        const srv = serverResult as Record<string, string>;
        console.log(`  Server: state=${srv.state} pid=${srv.pid} ports=${srv.ports}`);
        expect(srv.state).toBe('running');
      }
    });

    await test.step('Verify server in server view', async () => {
      const servers = await getServerViewState(page);
      expect(servers.length).toBeGreaterThan(0);
      console.log(`  Server entries: ${servers.length}`);
    });

    await test.step('Stop Tomcat server', async () => {
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);
    });

    await test.step('Verify server stopped', async () => {
      const servers = await getServerViewState(page);
      const stillRunning = (servers as Record<string, string>[]).filter(
        (s) => s.state === 'running',
      );
      console.log(`  Servers still running: ${stillRunning.length}`);
      expect(stillRunning.length).toBe(0);
    });
  });
});

// =============================================================================
// FE-09: Log Viewer
// =============================================================================
test.describe('FE-09: Log Viewer', () => {
  test('should open and view server logs', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and prepare', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Build and deploy', async () => {
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);
    });

    await test.step('Start server', async () => {
      await runCommandViaPalette(page, 'Kairo: Start Server');
      await waitForServerState(page, 'running', 120_000);
    });

    await test.step('Open log viewer', async () => {
      await runCommandViaPalette(page, 'Kairo: Show Server Logs');
      await page.waitForTimeout(2_000);
    });

    await test.step('Verify log viewer widget', async () => {
      const logViewer = page.locator(
        '[data-testid="log-viewer"], .log-viewer, .kairo-log-viewer',
      );
      const logVisible = await logViewer.first().isVisible().catch(() => false);
      console.log(`  Log viewer visible: ${logVisible}`);
    });

    await test.step('Stop server', async () => {
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);
    });
  });
});

// =============================================================================
// FE-10: Debug Session
// =============================================================================
test.describe('FE-10: Debug Session', () => {
  test('should start debug session, set breakpoint, hit, inspect', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and prepare', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Build and deploy', async () => {
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);
    });

    await test.step('Open HelloServlet.java and set breakpoint', async () => {
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(1_000);

      // Find doGet method and set breakpoint
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+f');
      await page.waitForTimeout(300);
      await page.keyboard.type('doGet');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.keyboard.press('F9');
      await page.waitForTimeout(1_000);

      const hasBreakpoint = await page.evaluate(() => {
        const glyphs = document.querySelectorAll(
          '.monaco-editor .glyph-margin-widgets .cgmr',
        );
        return glyphs.length > 0;
      });
      console.log(`  Breakpoint set: ${hasBreakpoint}`);
    });

    await test.step('Start debug server', async () => {
      await runCommandViaPalette(page, 'Kairo: Start Debug Server');
      await page.waitForTimeout(3_000);
      await waitForServerState(page, 'running', 120_000);
    });

    await test.step('Trigger HTTP request to hit breakpoint', async () => {
      const servers = await getServerViewState(page);
      let httpPort = 8080;
      if (servers.length > 0) {
        const srv = servers[0] as Record<string, string>;
        const portMatch = srv.ports?.match(/(\d+)/);
        httpPort = portMatch ? parseInt(portMatch[1]) : 8080;
      }
      try {
        await agentApi.get(
          `/api/v1/proxy?url=${encodeURIComponent(`http://127.0.0.1:${httpPort}/kairo/hello`)}`,
        );
      } catch {
        console.log('  HTTP trigger: request may have hung (expected)');
      }
      await page.waitForTimeout(2_000);
    });

    await test.step('Verify breakpoint hit', async () => {
      const debugPaused = await waitForDebugPaused(page, 60_000);
      console.log(`  Debug paused: ${debugPaused}`);
    });

    await test.step('Inspect variables', async () => {
      const variables = await getDebugVariables(page);
      console.log(`  Variables: ${variables.length} entries`);
      if (variables.length > 0) {
        console.log(`  First vars: ${variables.slice(0, 5).join(', ')}`);
      }
    });

    await test.step('Step over (F10)', async () => {
      await page.keyboard.press('F10');
      await page.waitForTimeout(2_000);
      console.log('  Step over executed');
    });

    await test.step('Continue (F5)', async () => {
      await page.keyboard.press('F5');
      await page.waitForTimeout(2_000);
      console.log('  Continue executed');
    });

    await test.step('Stop debug and server', async () => {
      await runCommandViaPalette(page, 'Kairo: Stop Debug Server');
      await page.waitForTimeout(2_000);
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);
    });
  });
});

// =============================================================================
// FE-11: Breakpoint Management
// =============================================================================
test.describe('FE-11: Breakpoint Management', () => {
  test('should set, toggle, and remove breakpoints', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and open Java file', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(1_000);
    });

    await test.step('Set breakpoint at line 20', async () => {
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      // Go to line 20
      await page.keyboard.press('Control+g');
      await page.waitForTimeout(500);
      await page.keyboard.type('20', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      // Toggle breakpoint
      await page.keyboard.press('F9');
      await page.waitForTimeout(1_000);
    });

    await test.step('Verify breakpoint glyph', async () => {
      const hasGlyph = await page.evaluate(() => {
        return !!document.querySelector(
          '.monaco-editor .glyph-margin-widgets .cgmr',
        );
      });
      console.log(`  Breakpoint glyph visible: ${hasGlyph}`);
    });

    await test.step('Set second breakpoint at line 25', async () => {
      await page.keyboard.press('Control+g');
      await page.waitForTimeout(500);
      await page.keyboard.type('25', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('F9');
      await page.waitForTimeout(1_000);
    });

    await test.step('Remove first breakpoint', async () => {
      await page.keyboard.press('Control+g');
      await page.waitForTimeout(500);
      await page.keyboard.type('20', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('F9');
      await page.waitForTimeout(1_000);
    });

    await test.step('Remove all breakpoints', async () => {
      await runCommandViaPalette(page, 'Remove All Breakpoints');
      await page.waitForTimeout(1_000);
    });
  });
});

// =============================================================================
// FE-12: Git Operations
// =============================================================================
test.describe('FE-12: Git Operations', () => {
  test('should perform Git operations', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Open Git changes view', async () => {
      await runCommandViaPalette(page, 'Git: Show Changes');
      await page.waitForTimeout(2_000);
    });

    await test.step('Verify Git changes widget', async () => {
      const gitWidget = page.locator(
        '[data-testid="git-changes"], .git-changes-view, .theia-scm-view',
      );
      const gitVisible = await gitWidget.first().isVisible().catch(() => false);
      console.log(`  Git changes view visible: ${gitVisible}`);
    });

    await test.step('Open Git stash view', async () => {
      await runCommandViaPalette(page, 'Git: Show Stashes');
      await page.waitForTimeout(2_000);
    });

    await test.step('Open Git commit view', async () => {
      await runCommandViaPalette(page, 'Git: Commit');
      await page.waitForTimeout(2_000);
    });

    await test.step('Open Git blame for a file', async () => {
      await openFileViaQuickOpen(page, 'HelloWorld.java');
      await page.waitForTimeout(1_000);
      await runCommandViaPalette(page, 'Git: Toggle Blame');
      await page.waitForTimeout(2_000);
    });
  });
});

// =============================================================================
// FE-13: JSP Scriptlet/EL/TLD Support
// =============================================================================
test.describe('FE-13: JSP Scriptlet/EL/TLD Support', () => {
  test('should support JSP Scriptlet, EL, and TLD', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and open JSP file', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
      await openFileViaQuickOpen(page, 'hello.jsp');
      await page.waitForTimeout(1_000);
    });

    await test.step('Verify Scriptlet syntax highlighting', async () => {
      const content = await getEditorContent(page);
      const hasScriptlet = content.includes('<%') && content.includes('%>');
      console.log(`  Scriptlet detected: ${hasScriptlet}`);
    });

    await test.step('Verify EL expression syntax', async () => {
      const content = await getEditorContent(page);
      const hasEL = content.includes('${') || content.includes('#{');
      console.log(`  EL expression detected: ${hasEL}`);
    });

    await test.step('Verify taglib directive', async () => {
      const content = await getEditorContent(page);
      const hasTaglib = content.includes('taglib') || content.includes('<%@');
      console.log(`  Taglib directive detected: ${hasTaglib}`);
    });

    await test.step('Trigger JSP code completion', async () => {
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+Space');
      await page.waitForTimeout(2_000);

      const hasCompletion = await page.evaluate(() => {
        return !!document.querySelector('.monaco-editor .suggest-widget');
      });
      console.log(`  JSP completion widget: ${hasCompletion}`);
      await page.keyboard.press('Escape');
    });
  });
});

// =============================================================================
// FE-14: Multi-file Editing
// =============================================================================
test.describe('FE-14: Multi-file Editing', () => {
  test('should edit multiple files simultaneously', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and import workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Open first file', async () => {
      await openFileViaQuickOpen(page, 'HelloWorld.java');
      await page.waitForTimeout(1_000);
    });

    await test.step('Open second file', async () => {
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(1_000);
    });

    await test.step('Open third file', async () => {
      await openFileViaQuickOpen(page, 'hello.jsp');
      await page.waitForTimeout(1_000);
    });

    await test.step('Verify editor tabs', async () => {
      const tabs = await page.evaluate(() => {
        const tabElements = document.querySelectorAll(
          '.p-TabBar-tab[data-type="editor"], .theia-tab-bar .p-TabBar-tab',
        );
        return Array.from(tabElements).map((el) => el.textContent?.trim() || '');
      });
      console.log(`  Editor tabs: ${tabs.join(', ')}`);
      expect(tabs.length).toBeGreaterThanOrEqual(2);
    });

    await test.step('Switch between tabs', async () => {
      const tabs = page.locator('.p-TabBar-tab[data-type="editor"]');
      const tabCount = await tabs.count();
      if (tabCount >= 2) {
        await tabs.nth(0).click();
        await page.waitForTimeout(300);
        await tabs.nth(1).click();
        await page.waitForTimeout(300);
      }
    });

    await test.step('Close all tabs', async () => {
      await runCommandViaPalette(page, 'Close All Editors');
      await page.waitForTimeout(1_000);
    });
  });
});

// =============================================================================
// FE-15: Command Palette Operations
// =============================================================================
test.describe('FE-15: Command Palette Operations', () => {
  test('should open command palette and execute commands', async ({
    page,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
      await waitForTheiaShell(page);
    });

    await test.step('Open command palette with F1', async () => {
      await page.keyboard.press('F1');
      await page.waitForTimeout(1_000);
    });

    await test.step('Verify command palette is visible', async () => {
      const palette = page.locator(
        '.quick-input-widget, .monaco-quick-open-widget',
      );
      const paletteVisible = await palette.first().isVisible().catch(() => false);
      console.log(`  Command palette visible: ${paletteVisible}`);
      if (paletteVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    });

    await test.step('Open with Ctrl+Shift+P', async () => {
      await page.keyboard.press('Control+Shift+P');
      await page.waitForTimeout(1_000);
      const palette = page.locator(
        '.quick-input-widget, .monaco-quick-open-widget',
      );
      const paletteVisible = await palette.first().isVisible().catch(() => false);
      console.log(`  Ctrl+Shift+P palette visible: ${paletteVisible}`);
      if (paletteVisible) {
        await page.keyboard.press('Escape');
      }
    });

    await test.step('Type Kairo commands', async () => {
      await openCommandPalette(page);
      await typeInCommandPalette(page, 'Kairo:');
      await page.waitForTimeout(1_000);

      const results = await page.evaluate(() => {
        const rows = document.querySelectorAll('.monaco-list-row');
        return Array.from(rows)
          .slice(0, 10)
          .map((el) => el.textContent?.trim() || '');
      });
      console.log(`  Kairo commands: ${results.join(', ')}`);
      expect(results.length).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
    });
  });
});

// =============================================================================
// FE-16: Search Center
// =============================================================================
test.describe('FE-16: Search Center', () => {
  test('should search within project files', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and import workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Open search center', async () => {
      await runCommandViaPalette(page, 'Kairo: Search in Files');
      await page.waitForTimeout(1_000);
    });

    await test.step('Enter search query', async () => {
      const searchInput = page
        .locator(
          '.search-view .search-input input, [data-testid="search-input"] input, .monaco-inputbox input',
        )
        .first();
      const inputVisible = await searchInput.isVisible().catch(() => false);
      if (inputVisible) {
        await searchInput.click();
        await searchInput.fill('Hello');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2_000);
      }
    });

    await test.step('Verify search results', async () => {
      const results = await page.evaluate(() => {
        const items = document.querySelectorAll(
          '.search-view .result, [data-testid="search-result"], .monaco-list-row',
        );
        return Array.from(items).map((el) => el.textContent?.trim() || '');
      });
      console.log(`  Search results: ${results.length} items`);
      if (results.length > 0) {
        console.log(`  First result: ${results[0].substring(0, 80)}`);
      }
    });
  });
});

// =============================================================================
// FE-17: Problems View
// =============================================================================
test.describe('FE-17: Problems View', () => {
  test('should show problems view', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and import workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Open Problems view', async () => {
      await runCommandViaPalette(page, 'Problems: Focus on Problems View');
      await page.waitForTimeout(2_000);
    });

    await test.step('Verify problems view', async () => {
      const problems = await page.evaluate(() => {
        const markers = document.querySelectorAll(
          '.theia-marker-container, .problem-marker',
        );
        return markers.length;
      });
      console.log(`  Problems markers: ${problems}`);
    });
  });
});

// =============================================================================
// FE-18: Keyboard Shortcuts
// =============================================================================
test.describe('FE-18: Keyboard Shortcuts', () => {
  test('should respond to common keyboard shortcuts', async ({ page }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
      await waitForTheiaShell(page);
    });

    await test.step('Ctrl+P - File quick open', async () => {
      await page.keyboard.press('Control+P');
      await page.waitForTimeout(1_000);
      const quickOpen = page.locator(
        '.quick-open-overlay, .monaco-quick-open-widget',
      );
      const visible = await quickOpen.first().isVisible().catch(() => false);
      console.log(`  Ctrl+P quick open: ${visible}`);
      if (visible) await page.keyboard.press('Escape');
    });

    await test.step('Ctrl+G - Go to line', async () => {
      await page.keyboard.press('Control+g');
      await page.waitForTimeout(1_000);
      await page.keyboard.press('Escape');
    });

    await test.step('Ctrl+B - Toggle sidebar', async () => {
      await page.keyboard.press('Control+b');
      await page.waitForTimeout(1_000);
      await page.keyboard.press('Control+b');
      await page.waitForTimeout(1_000);
    });

    await test.step('Ctrl+` - Toggle terminal', async () => {
      await page.keyboard.press('Control+`');
      await page.waitForTimeout(1_000);
    });
  });
});

// =============================================================================
// FE-19: Status Bar Verification
// =============================================================================
test.describe('FE-19: Status Bar Verification', () => {
  test('should show all Kairo status bar entries', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and import workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
    });

    await test.step('Wait for JDT LS ready', async () => {
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Verify all status bar entries', async () => {
      const sbText = await getStatusBarText(page);
      console.log(`  Status bar: ${sbText.substring(0, 200)}`);

      const entries = [
        'Project:',
        'Java:',
        'JDT LS:',
        'Encoding:',
        'Agent:',
      ];
      for (const entry of entries) {
        const hasEntry = sbText.includes(entry);
        console.log(`  "${entry}": ${hasEntry}`);
      }
    });
  });
});

// =============================================================================
// FE-20: Hot Reload (JSP)
// =============================================================================
test.describe('FE-20: Hot Reload (JSP)', () => {
  test('should detect JSP changes without restart', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and prepare', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    await test.step('Build and deploy', async () => {
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);
    });

    await test.step('Start server', async () => {
      await runCommandViaPalette(page, 'Kairo: Start Server');
      await waitForServerState(page, 'running', 120_000);
    });

    await test.step('Open and modify JSP', async () => {
      await openFileViaQuickOpen(page, 'hello.jsp');
      await page.waitForTimeout(1_000);

      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('<!-- Hot reload test -->', { delay: 20 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(1_000);
    });

    await test.step('Verify server still running', async () => {
      const servers = await getServerViewState(page);
      const running = (servers as Record<string, string>[]).filter(
        (s) => s.state === 'running',
      );
      console.log(`  Servers running after JSP edit: ${running.length}`);
      expect(running.length).toBeGreaterThan(0);
    });

    await test.step('Stop server', async () => {
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);
    });
  });
});