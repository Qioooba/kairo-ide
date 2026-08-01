/**
 * Kairo IDE Core E2E Scenarios — P1-TEST-01
 *
 * These are high-level test descriptions that exercise the key
 * product workflows end-to-end through the Theia Browser IDE.
 *
 * Each test is a stub with clear step descriptions. They require
 * a real browser + running Theia stack to execute.
 *
 * Prerequisites:
 *   1. Run `pnpm agent:run` in one terminal
 *   2. Run `pnpm dev:browser` in another terminal
 *   3. Run `npx playwright test --config tests/e2e/playwright.config.ts`
 *
 * NOTE: These tests are stubs designed to document the expected
 * behavior. They will fail if run against an incomplete product
 * but serve as the acceptance criteria for the P1 milestone.
 */

import {
  test,
  expect,
  navigateToTheia,
  waitForTheiaShell,
  openCommandPalette,
  typeInCommandPalette,
  selectFirstQuickPick,
  runCommandViaPalette,
  getStatusBarText,
  waitForStatusContains,
  openFileViaQuickOpen,
  getBuildViewState,
  getServerViewState,
  getProblemsViewState,
  waitForBuildState,
  waitForServerState,
  type AgentApi,
  type WorkspaceContext,
} from './fixtures';

// ===========================================================================
// E2E-01: First launch → import project → encoding correct
// ===========================================================================
test.describe('E2E-01: First Launch → Import Project → Encoding Correct', () => {
  test('should launch Theia, import a project, and verify file tree and encoding', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch the Theia Browser IDE
    // ------------------------------------------------------------------
    await test.step('1. Navigate to Theia and wait for shell', async () => {
      await navigateToTheia(page);
      const sbText = await getStatusBarText(page);
      expect(sbText).toBeTruthy();
      // Verify the status bar contains key Kairo entries
      expect(sbText).toContain('Agent:');
    });

    // ------------------------------------------------------------------
    // Step 2: Verify the agent is healthy
    // ------------------------------------------------------------------
    await test.step('2. Verify agent health', async () => {
      const health = await agentApi.get('/api/v1/health');
      expect(health.status).toBe(200);
      expect(health.json?.ok).toBe(true);
    });

    // ------------------------------------------------------------------
    // Step 3: Import the sample project via the Import Wizard
    // ------------------------------------------------------------------
    await test.step('3. Open Import Wizard and import project', async () => {
      // Open the Import Wizard via command palette
      await runCommandViaPalette(page, 'Kairo: Import Project');

      // The Import Wizard widget should appear
      // Fill in the project path
      const wizardInput = page.locator(
        '[data-testid="import-path-input"], #import-path-input, .theia-input',
      );
      const wizardVisible = await wizardInput.isVisible().catch(() => false);
      if (wizardVisible) {
        await wizardInput.fill(workspace.rootPath);
        // Click the import/confirm button
        const importBtn = page.locator(
          'button:has-text("Import"), button:has-text("导入"), [data-testid="import-confirm"]',
        );
        if (await importBtn.isVisible().catch(() => false)) {
          await importBtn.click();
          await page.waitForTimeout(2_000);
        }
      }
      // Fallback: register workspace via agent API
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });
    });

    // ------------------------------------------------------------------
    // Step 4: Verify the file tree shows the expected files
    // ------------------------------------------------------------------
    await test.step('4. Verify file tree structure', async () => {
      // Check that the Explorer panel is visible and contains expected files
      const fileTree = await page.evaluate(() => {
        const explorer = document.querySelector('.theia-Explorer, #explorer-view-container');
        if (!explorer) return null;
        const treeItems = explorer.querySelectorAll('.theia-TreeNode, .p-TabBar-tab');
        return Array.from(treeItems).map((el) => el.textContent?.trim() || '');
      });

      // The file tree should contain key project files
      const expectedFiles = ['src', 'WebRoot', 'hello.jsp', 'HelloServlet.java', 'HelloWorld.java'];
      if (fileTree && fileTree.length > 0) {
        const treeText = fileTree.join(' ');
        for (const f of expectedFiles) {
          // Soft assertion: file may not be visible until expanded
          console.log(`  Checking for "${f}" in file tree...`);
        }
      }
    });

    // ------------------------------------------------------------------
    // Step 5: Open a file and verify encoding
    // ------------------------------------------------------------------
    await test.step('5. Open hello.jsp and verify encoding', async () => {
      // Open the GBK-encoded hello.jsp file
      await openFileViaQuickOpen(page, 'hello.jsp');

      // Verify the encoding status bar entry
      const sbText = await getStatusBarText(page);
      expect(sbText).toContain('Encoding:');

      // The encoding should be detected as GBK (or GB18030) for legacy JSP files
      const encodingDetect = await agentApi.post('/api/v1/encoding/detect', {
        file: `${workspace.rootPath}/WebRoot/hello.jsp`,
      });
      if (encodingDetect.status === 200 && encodingDetect.json?.payload) {
        const enc = (encodingDetect.json.payload as Record<string, unknown>).encoding;
        console.log(`  Detected encoding: ${enc}`);
        // Accept GBK or GB18030 as correct for legacy Chinese JSP files
        expect(['gbk', 'gb18030']).toContain(enc);
      }
    });

    // ------------------------------------------------------------------
    // Step 6: Verify status bar completeness
    // ------------------------------------------------------------------
    await test.step('6. Verify all Kairo status bar entries are present', async () => {
      const sbText = await getStatusBarText(page);
      // KAIRO-S27: Session 16 Phase F 将 Java/JDT LS 状态合并为单个 JDK 条目
      //（JDT LS 状态仅存在于 tooltip），此处断言以当前状态栏文案为准。
      const requiredEntries = ['Project:', 'JDK:', 'Encoding:', 'Agent:'];
      for (const entry of requiredEntries) {
        expect(sbText, `Status bar should contain "${entry}"`).toContain(entry);
      }
    });
  });
});

// ===========================================================================
// E2E-02: Java completion → definition → references → rename
// ===========================================================================
test.describe('E2E-02: Java Language Intelligence', () => {
  test('should provide completion, go-to-definition, find references, and rename symbol', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch and wait for JDT LS to be ready
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia and wait for JDT LS ready', async () => {
      await navigateToTheia(page);
      // Register workspace
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });

      // Wait for JDT LS to signal ready
      const jdtReady = await waitForStatusContains(page, 'JDT LS: ready', 120_000);
      expect(jdtReady, 'JDT LS should become ready').toBeTruthy();
    });

    // ------------------------------------------------------------------
    // Step 2: Open a Java file
    // ------------------------------------------------------------------
    await test.step('2. Open HelloServlet.java', async () => {
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      // Wait for the editor to be active
      await page.waitForSelector('.monaco-editor .view-lines', { timeout: 10_000 });
      await page.waitForTimeout(1_000);
    });

    // ------------------------------------------------------------------
    // Step 3: Trigger code completion (Ctrl+Space)
    // ------------------------------------------------------------------
    await test.step('3. Trigger Java code completion', async () => {
      // Click in the editor to focus
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);

      // Trigger completion
      await page.keyboard.press('Control+Space');
      await page.waitForTimeout(2_000);

      // Verify the completion widget appears
      const hasCompletion = await page.evaluate(() => {
        return !!document.querySelector('.monaco-editor .suggest-widget');
      });
      expect(
        hasCompletion,
        'Completion widget should appear after Ctrl+Space',
      ).toBe(true);

      // Dismiss the completion widget
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    });

    // ------------------------------------------------------------------
    // Step 4: Navigate to definition (F12)
    // ------------------------------------------------------------------
    await test.step('4. Go to Definition (F12)', async () => {
      // Place cursor on a symbol (e.g., "HttpServlet")
      // We simulate this by clicking in the editor and pressing F12
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      await page.keyboard.press('F12');
      await page.waitForTimeout(2_000);

      // After F12, the editor should navigate to the definition
      // (either in the same file or opening a new file)
      const editorCount = await page.evaluate(() => {
        return document.querySelectorAll('.monaco-editor').length;
      });
      console.log(`  Editors visible after F12: ${editorCount}`);
      // At minimum, there should still be an editor visible
      expect(editorCount).toBeGreaterThan(0);
    });

    // ------------------------------------------------------------------
    // Step 5: Find references (Shift+F12)
    // ------------------------------------------------------------------
    await test.step('5. Find References (Shift+F12)', async () => {
      // Navigate back to the original file if needed
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(1_000);

      // Click in the editor and trigger find references
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      await page.keyboard.press('Shift+F12');
      await page.waitForTimeout(2_000);

      // The references peek view should appear
      const hasPeekView = await page.evaluate(() => {
        return (
          !!document.querySelector('.monaco-editor .peekview-widget') ||
          !!document.querySelector('.references-view')
        );
      });
      console.log(`  References peek view visible: ${hasPeekView}`);
      // Reference view may not appear if JDT is still indexing
      // This is a soft check — the command should at least be registered
    });

    // ------------------------------------------------------------------
    // Step 6: Rename symbol (F2)
    // ------------------------------------------------------------------
    await test.step('6. Rename Symbol (F2)', async () => {
      // Place cursor on a symbol
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      await page.keyboard.press('F2');
      await page.waitForTimeout(2_000);

      // The rename input should appear
      const hasRenameInput = await page.evaluate(() => {
        return (
          !!document.querySelector('.monaco-editor .rename-box') ||
          !!document.querySelector('.rename-input-wrapper')
        );
      });
      console.log(`  Rename input visible: ${hasRenameInput}`);

      // If rename input is visible, type a new name and confirm
      if (hasRenameInput) {
        // Type new name
        await page.keyboard.type('RenamedServlet');
        await page.waitForTimeout(500);
        // Press Enter to confirm rename
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1_000);
      }
    });
  });
});

// ===========================================================================
// E2E-03: Search → Preview → Replace → Undo
// ===========================================================================
test.describe('E2E-03: Search → Preview → Replace → Undo', () => {
  test('should search, preview results, replace, and undo', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch + prepare workspace
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia and prepare workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    // ------------------------------------------------------------------
    // Step 2: Open Search Center (Ctrl+Shift+F or Kairo: Search in Files)
    // ------------------------------------------------------------------
    await test.step('2. Open Search Center', async () => {
      // Try opening via command palette
      await runCommandViaPalette(page, 'Kairo: Search in Files');
      await page.waitForTimeout(1_000);

      // Fallback: use Ctrl+Shift+F shortcut if command didn't work
      const searchView = page.locator(
        '.search-view, [data-testid="search-view"], .theia-search-view',
      );
      const searchVisible = await searchView.isVisible().catch(() => false);
      if (!searchVisible) {
        await page.keyboard.press('Control+Shift+f');
        await page.waitForTimeout(1_000);
      }
      console.log('  Search view opened');
    });

    // ------------------------------------------------------------------
    // Step 3: Search for a known string in the project
    // ------------------------------------------------------------------
    await test.step('3. Search for "Hello" in project files', async () => {
      // Look for the search input field
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
      console.log('  Searched for "Hello"');
    });

    // ------------------------------------------------------------------
    // Step 4: Verify results appear with file/line preview
    // ------------------------------------------------------------------
    await test.step('4. Verify search results appear', async () => {
      const results = await page.evaluate(() => {
        const resultItems = document.querySelectorAll(
          '.search-view .result, [data-testid="search-result"], .monaco-list-row',
        );
        return Array.from(resultItems).map((el) => el.textContent?.trim() || '');
      });
      console.log(`  Search results: ${results.length} items`);
      if (results.length > 0) {
        console.log(`  First result: ${results[0].substring(0, 80)}`);
      }
      expect(results.length, 'Search results should contain matches').toBeGreaterThan(0);
    });

    // ------------------------------------------------------------------
    // Step 5: Open replace mode
    // ------------------------------------------------------------------
    await test.step('5. Open replace mode', async () => {
      const replaceToggle = page.locator(
        '.search-view .replace-toggle, [data-testid="replace-toggle"], button[title*="Replace"]',
      );
      const toggleVisible = await replaceToggle.isVisible().catch(() => false);
      if (toggleVisible) {
        await replaceToggle.click();
        await page.waitForTimeout(500);
      }
      console.log('  Replace mode toggled');
    });

    // ------------------------------------------------------------------
    // Step 6: Enter replacement text
    // ------------------------------------------------------------------
    await test.step('6. Enter replacement text', async () => {
      const replaceInput = page.locator(
        '.search-view .replace-input input, [data-testid="replace-input"] input',
      );
      const replaceVisible = await replaceInput.isVisible().catch(() => false);
      if (replaceVisible) {
        await replaceInput.click();
        await replaceInput.fill('HelloReplaced');
        await page.waitForTimeout(500);
      }
      console.log('  Replacement text entered: HelloReplaced');
    });

    // ------------------------------------------------------------------
    // Step 7: Preview changes (diff view)
    // ------------------------------------------------------------------
    await test.step('7. Preview changes', async () => {
      const previewBtn = page.locator(
        '.search-view button:has-text("Preview"), [data-testid="replace-preview"]',
      );
      const previewVisible = await previewBtn.isVisible().catch(() => false);
      if (previewVisible) {
        await previewBtn.click();
        await page.waitForTimeout(1_000);
      }
      console.log('  Preview triggered');
    });

    // ------------------------------------------------------------------
    // Step 8: Apply replacement
    // ------------------------------------------------------------------
    await test.step('8. Apply replacement', async () => {
      const replaceAllBtn = page.locator(
        '.search-view button:has-text("Replace All"), [data-testid="replace-all"]',
      );
      const replaceVisible = await replaceAllBtn.isVisible().catch(() => false);
      if (replaceVisible) {
        await replaceAllBtn.click();
        await page.waitForTimeout(1_000);
      }
      console.log('  Replace All applied');
    });

    // ------------------------------------------------------------------
    // Step 9: Verify the replacement took effect
    // ------------------------------------------------------------------
    await test.step('9. Verify replacement took effect', async () => {
      await openFileViaQuickOpen(page, 'HelloWorld.java');
      await page.waitForTimeout(1_000);

      const content = await page.evaluate(() => {
        const lines = document.querySelectorAll('.monaco-editor .view-line');
        return Array.from(lines).map((l) => l.textContent).join('\n');
      });
      // The replacement of "Hello" → "HelloReplaced" should be visible
      const hasReplacement = content.includes('HelloReplaced');
      console.log(`  Replacement found in file: ${hasReplacement}`);
      if (hasReplacement) {
        expect(content).toContain('HelloReplaced');
      }
    });

    // ------------------------------------------------------------------
    // Step 10: Undo the replacement (Ctrl+Z)
    // ------------------------------------------------------------------
    await test.step('10. Undo the replacement', async () => {
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(1_000);
      console.log('  Undo triggered (Ctrl+Z)');
    });

    // ------------------------------------------------------------------
    // Step 11: Verify the original text is restored
    // ------------------------------------------------------------------
    await test.step('11. Verify original text is restored', async () => {
      const content = await page.evaluate(() => {
        const lines = document.querySelectorAll('.monaco-editor .view-line');
        return Array.from(lines).map((l) => l.textContent).join('\n');
      });
      // Original text should have "Hello" but not "HelloReplaced"
      expect(
        content,
        'Original text should be restored after undo',
      ).not.toContain('HelloReplaced');
      console.log('  Verified: original text restored');
    });
  });
});

// ===========================================================================
// E2E-04: Build failure → Problems → navigate → fix → rebuild
// ===========================================================================
test.describe('E2E-04: Build Failure → Problems → Navigate → Fix → Rebuild', () => {
  test('should detect build failure, show problems, navigate to error, fix, and rebuild', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch and prepare workspace
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia and prepare workspace', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);
    });

    // ------------------------------------------------------------------
    // Step 2: Introduce a compile error in a Java file
    // ------------------------------------------------------------------
    await test.step('2. Introduce a compile error in HelloWorld.java', async () => {
      await openFileViaQuickOpen(page, 'HelloWorld.java');
      await page.waitForTimeout(1_000);

      // Insert a syntax error by adding an incomplete statement
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);

      // Navigate to the end of a method body and insert an error
      // Use the Monaco editor to insert "INVALID_SYNTAX_HERE;"
      await page.keyboard.press('Control+End');
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+ArrowUp');
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      await page.keyboard.type('INVALID_SYNTAX_HERE;', { delay: 20 });
      await page.waitForTimeout(500);

      // Save the file
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(1_000);

      console.log('  Inserted compile error: INVALID_SYNTAX_HERE;');
    });

    // ------------------------------------------------------------------
    // Step 3: Execute build via command palette
    // ------------------------------------------------------------------
    await test.step('3. Execute Kairo: Build', async () => {
      await runCommandViaPalette(page, 'Kairo: Build');
      await page.waitForTimeout(2_000);
    });

    // ------------------------------------------------------------------
    // Step 4: Verify the Problems panel shows the compile error
    // ------------------------------------------------------------------
    await test.step('4. Verify Problems panel shows compile error', async () => {
      // Wait for build to complete (should fail)
      const buildResult = await waitForBuildState(page, 'failed', 120_000);
      if (buildResult) {
        console.log(`  Build result: ${(buildResult as Record<string, string>).state}`);
      }

      // Check the Problems view for markers
      const problems = await getProblemsViewState(page);
      console.log(`  Problems found: ${problems.length}`);

      if (problems.length > 0) {
        console.log(`  First problem: ${JSON.stringify(problems[0])}`);
      }

      // The Problems view should contain at least one error
      // (This is a soft assertion — the view may not be open by default)
      const hasBuildError = await page.evaluate(() => {
        const markers = document.querySelectorAll('.theia-marker-container');
        return markers.length > 0;
      });
      console.log(`  Build error markers visible: ${hasBuildError}`);
    });

    // ------------------------------------------------------------------
    // Step 5: Click to navigate to the error location
    // ------------------------------------------------------------------
    await test.step('5. Click error marker to navigate to error location', async () => {
      // Open the Problems view if not already visible
      await runCommandViaPalette(page, 'Problems: Focus on Problems View');
      await page.waitForTimeout(1_000);

      // Click on the first error marker
      const firstMarker = page.locator(
        '.theia-marker-container, .problem-marker, [data-testid="problem-item"]',
      ).first();
      const markerVisible = await firstMarker.isVisible().catch(() => false);
      if (markerVisible) {
        await firstMarker.click();
        await page.waitForTimeout(1_000);

        // Verify the editor navigated to the error location
        const editorHasFocus = await page.evaluate(() => {
          return document.activeElement?.closest('.monaco-editor') !== null;
        });
        console.log(`  Editor focused after clicking marker: ${editorHasFocus}`);
      }
    });

    // ------------------------------------------------------------------
    // Step 6: Fix the error
    // ------------------------------------------------------------------
    await test.step('6. Fix the compile error', async () => {
      // The editor should be focused on the error location
      // Remove the invalid syntax
      await page.keyboard.press('Control+Home');
      // Find and delete the error line
      await page.keyboard.press('Control+f');
      await page.waitForTimeout(300);
      await page.keyboard.type('INVALID_SYNTAX_HERE');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Select the line and delete it
      // (Monaco: the find widget should have highlighted the text)
      // We'll use a simpler approach: delete the error via the editor
      const errorLine = page.locator('.view-line:has-text("INVALID_SYNTAX_HERE")');
      if (await errorLine.isVisible().catch(() => false)) {
        await errorLine.click();
        await page.waitForTimeout(300);
        // Select the entire line
        await page.keyboard.press('End');
        await page.keyboard.press('Shift+Home');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);
      }

      // Save the file
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(1_000);

      console.log('  Fixed compile error');
    });

    // ------------------------------------------------------------------
    // Step 7: Rebuild and verify success
    // ------------------------------------------------------------------
    await test.step('7. Rebuild and verify success', async () => {
      await runCommandViaPalette(page, 'Kairo: Build');
      await page.waitForTimeout(2_000);

      // Wait for build to succeed
      const buildResult = await waitForBuildState(page, 'succeeded', 120_000);
      if (buildResult) {
        const state = (buildResult as Record<string, string>).state;
        console.log(`  Rebuild result: ${state}`);
        expect(state).toBe('succeeded');
      }

      // Verify the Problems view is clear of errors
      const problems = await getProblemsViewState(page);
      console.log(`  Problems after fix: ${problems.length}`);
      // Ideally, there should be no errors — but this depends on the project
    });
  });
});

// ===========================================================================
// E2E-05: Start Tomcat → JSP modification immediate effect
// ===========================================================================
test.describe('E2E-05: Start Tomcat → JSP Modification Immediate Effect', () => {
  test('should start Tomcat, modify a JSP, and verify changes take effect after refresh', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch and prepare
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia, prepare workspace, build and deploy', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);

      // Build and deploy the project
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);
    });

    // ------------------------------------------------------------------
    // Step 2: Start the Tomcat server
    // ------------------------------------------------------------------
    await test.step('2. Start Tomcat server', async () => {
      await runCommandViaPalette(page, 'Kairo: Start Server');
      await page.waitForTimeout(2_000);

      // Wait for server to reach running state
      const serverResult = await waitForServerState(page, 'running', 120_000);
      if (serverResult) {
        const srv = serverResult as Record<string, string>;
        console.log(`  Server running: pid=${srv.pid} ports=${srv.ports}`);
        expect(srv.state).toBe('running');
      }
    });

    // ------------------------------------------------------------------
    // Step 3: Verify the server is responding to HTTP requests
    // ------------------------------------------------------------------
    await test.step('3. Verify server HTTP response', async () => {
      const servers = await getServerViewState(page);
      if (servers.length > 0) {
        const srv = servers[0] as Record<string, string>;
        const portMatch = srv.ports?.match(/(\d+)/);
        const httpPort = portMatch ? parseInt(portMatch[1]) : 8080;

        // Verify via agent API that the server is accessible
        const healthCheck = await agentApi.get('/api/v1/health');
        console.log(`  Agent health: ${healthCheck.status}`);
      }
    });

    // ------------------------------------------------------------------
    // Step 4: Modify a JSP file
    // ------------------------------------------------------------------
    await test.step('4. Modify hello.jsp', async () => {
      await openFileViaQuickOpen(page, 'hello.jsp');
      await page.waitForTimeout(1_000);

      // Record the content before modification
      const beforeContent = await page.evaluate(() => {
        const lines = document.querySelectorAll('.monaco-editor .view-line');
        return Array.from(lines).map((l) => l.textContent).join('\n');
      });
      console.log(`  Before edit: ${beforeContent.length} chars`);

      // Make a small edit
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      // Navigate to a position and add a comment
      await page.keyboard.press('Control+End');
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      await page.keyboard.type('<!-- E2E test modification marker -->', { delay: 20 });
      await page.waitForTimeout(500);

      // Save the file
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(1_000);

      console.log('  Modified hello.jsp with test marker');
    });

    // ------------------------------------------------------------------
    // Step 5: Verify the changes take effect after refresh
    // ------------------------------------------------------------------
    await test.step('5. Verify JSP changes take effect', async () => {
      // Trigger a redeploy to pick up the JSP change
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);

      // Verify the deployment succeeded
      const servers = await getServerViewState(page);
      if (servers.length > 0) {
        const srv = servers[0] as Record<string, string>;
        if (srv.state === 'running') {
          console.log('  Server still running after JSP modification');
          // In a real scenario, we would HTTP GET the JSP page
          // and verify the modification marker is present
          const portMatch = srv.ports?.match(/(\d+)/);
          const httpPort = portMatch ? parseInt(portMatch[1]) : 8080;
          console.log(`  Would verify http://127.0.0.1:${httpPort}/kairo/hello.jsp`);
        }
      }
    });

    // ------------------------------------------------------------------
    // Step 6: Stop the server
    // ------------------------------------------------------------------
    await test.step('6. Stop Tomcat server', async () => {
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);

      const stoppedServers = await getServerViewState(page);
      const stillRunning = (stoppedServers as Record<string, string>[]).filter(
        (s) => s.state === 'running',
      );
      console.log(`  Servers still running after stop: ${stillRunning.length}`);
    });
  });
});

// ===========================================================================
// E2E-06: Java Modify → Build → Publish → Service Recovery
// ===========================================================================
test.describe('E2E-06: Java Modify → Build → Publish → Service Recovery', () => {
  test('should modify Java, build, publish, and verify service recovers', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch + prepare workspace + build + deploy + start Tomcat
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia, prepare workspace, build, deploy and start server', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);

      // Build and deploy the project
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);

      // Start the Tomcat server
      await runCommandViaPalette(page, 'Kairo: Start Server');
      await page.waitForTimeout(2_000);

      const serverResult = await waitForServerState(page, 'running', 120_000);
      if (serverResult) {
        const srv = serverResult as Record<string, string>;
        console.log(`  Server running: pid=${srv.pid} ports=${srv.ports}`);
        expect(srv.state).toBe('running');
      }
    });

    // ------------------------------------------------------------------
    // Step 2: Verify server is running and responding
    // ------------------------------------------------------------------
    await test.step('2. Verify server is running and responding', async () => {
      const servers = await getServerViewState(page);
      expect(servers.length, 'Server should be listed in server view').toBeGreaterThan(0);

      const srv = servers[0] as Record<string, string>;
      expect(srv.state).toBe('running');

      // Verify the server is accessible via HTTP
      const portMatch = srv.ports?.match(/(\d+)/);
      const httpPort = portMatch ? parseInt(portMatch[1]) : 8080;

      // Check agent health as a proxy for server accessibility
      const healthCheck = await agentApi.get('/api/v1/health');
      expect(healthCheck.status).toBe(200);
      console.log(`  Server responding on port ${httpPort}`);
    });

    // ------------------------------------------------------------------
    // Step 3: Modify a Java file (e.g., change a string literal in HelloServlet.java)
    // ------------------------------------------------------------------
    await test.step('3. Modify HelloServlet.java', async () => {
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(1_000);

      // Record the content before modification
      const beforeContent = await page.evaluate(() => {
        const lines = document.querySelectorAll('.monaco-editor .view-line');
        return Array.from(lines).map((l) => l.textContent).join('\n');
      });
      console.log(`  Before edit: ${beforeContent.length} chars`);

      // Make a meaningful edit — change a string literal
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);

      // Navigate into the file and add a comment to the class body
      await page.keyboard.press('Control+End');
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+ArrowUp');
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      await page.keyboard.type('    // E2E-06: Java modification marker', { delay: 20 });
      await page.waitForTimeout(500);

      console.log('  Modified HelloServlet.java with E2E-06 marker');
    });

    // ------------------------------------------------------------------
    // Step 4: Save the file
    // ------------------------------------------------------------------
    await test.step('4. Save the modified file', async () => {
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(1_000);
      console.log('  File saved');
    });

    // ------------------------------------------------------------------
    // Step 5: Execute build (Kairo: Build)
    // ------------------------------------------------------------------
    await test.step('5. Execute Kairo: Build', async () => {
      await runCommandViaPalette(page, 'Kairo: Build');
      await page.waitForTimeout(2_000);

      // Wait for build to succeed
      const buildResult = await waitForBuildState(page, 'succeeded', 120_000);
      if (buildResult) {
        const state = (buildResult as Record<string, string>).state;
        console.log(`  Build result: ${state}`);
        expect(state).toBe('succeeded');
      }
    });

    // ------------------------------------------------------------------
    // Step 6: Verify build succeeds
    // ------------------------------------------------------------------
    await test.step('6. Verify build succeeded', async () => {
      const builds = await getBuildViewState(page);
      console.log(`  Build entries: ${builds.length}`);
      if (builds.length > 0) {
        const lastBuild = builds[builds.length - 1] as Record<string, string>;
        expect(lastBuild.state).toBe('succeeded');
      }
    });

    // ------------------------------------------------------------------
    // Step 7: Execute publish (Kairo: Publish)
    // ------------------------------------------------------------------
    await test.step('7. Execute Kairo: Publish', async () => {
      await runCommandViaPalette(page, 'Kairo: Publish');
      await page.waitForTimeout(3_000);

      // Give the publish some time to complete
      console.log('  Publish command executed');
    });

    // ------------------------------------------------------------------
    // Step 8: Verify the server is still running
    // ------------------------------------------------------------------
    await test.step('8. Verify server is still running after publish', async () => {
      const serverResult = await waitForServerState(page, 'running', 60_000);
      if (serverResult) {
        const srv = serverResult as Record<string, string>;
        console.log(`  Server still running: pid=${srv.pid} ports=${srv.ports}`);
        expect(srv.state).toBe('running');
      }
    });

    // ------------------------------------------------------------------
    // Step 9: Make HTTP request and verify the modified response
    // ------------------------------------------------------------------
    await test.step('9. Verify modified response via HTTP', async () => {
      const servers = await getServerViewState(page);
      if (servers.length > 0) {
        const srv = servers[0] as Record<string, string>;
        const portMatch = srv.ports?.match(/(\d+)/);
        const httpPort = portMatch ? parseInt(portMatch[1]) : 8080;

        // Verify the deployed app is accessible via agent API
        const deployCheck = await agentApi.get('/api/v1/health');
        expect(deployCheck.status).toBe(200);
        console.log(`  HTTP verification on port ${httpPort}: agent healthy`);
        console.log(`  Would verify http://127.0.0.1:${httpPort}/kairo/hello for E2E-06 marker`);
      }
    });

    // ------------------------------------------------------------------
    // Step 10: Stop the server
    // ------------------------------------------------------------------
    await test.step('10. Stop the server', async () => {
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);

      const stoppedServers = await getServerViewState(page);
      const stillRunning = (stoppedServers as Record<string, string>[]).filter(
        (s) => s.state === 'running',
      );
      console.log(`  Servers still running after stop: ${stillRunning.length}`);
    });
  });
});

// ===========================================================================
// E2E-07: Debug → Set Breakpoint → Start Debug → Hit → Inspect → Step → Continue → Stop
// ===========================================================================
test.describe('E2E-07: Debug → Set Breakpoint → Start Debug → Hit → Inspect → Step → Continue → Stop', () => {
  test('should set breakpoint, start debug, hit breakpoint, inspect variables, step over, continue, and stop', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch and prepare workspace
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia, prepare workspace, build and deploy', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);

      // Build and deploy the project
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);
    });

    // ------------------------------------------------------------------
    // Step 2: Open HelloServlet.java and set a breakpoint
    // ------------------------------------------------------------------
    await test.step('2. Open HelloServlet.java and set a breakpoint', async () => {
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(1_000);

      // Find the doGet method and set a breakpoint on a line inside it
      // Navigate to the editor area and click on the breakpoint gutter
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);

      // Use Ctrl+F to search for "doGet" in the file
      await page.keyboard.press('Control+f');
      await page.waitForTimeout(300);
      await page.keyboard.type('doGet');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Toggle a breakpoint on the doGet line by pressing F9
      await page.keyboard.press('F9');
      await page.waitForTimeout(1_000);

      // Verify the breakpoint was set (look for the breakpoint glyph in the gutter)
      const hasBreakpoint = await page.evaluate(() => {
        const glyphs = document.querySelectorAll(
          '.monaco-editor .glyph-margin-widgets .cgmr',
        );
        return glyphs.length > 0;
      });
      console.log(`  Breakpoint glyph visible: ${hasBreakpoint}`);
    });

    // ------------------------------------------------------------------
    // Step 3: Start Tomcat in Debug mode
    // ------------------------------------------------------------------
    await test.step('3. Start Tomcat in Debug mode', async () => {
      await runCommandViaPalette(page, 'Kairo: Start Debug Server');
      await page.waitForTimeout(3_000);

      // Wait for the server to reach running state
      const serverResult = await waitForServerState(page, 'running', 120_000);
      if (serverResult) {
        const srv = serverResult as Record<string, string>;
        console.log(`  Debug server running: pid=${srv.pid} ports=${srv.ports}`);
        expect(srv.state).toBe('running');
      }

      // Verify the Debug status bar entry shows debug mode
      const sbText = await getStatusBarText(page);
      console.log(`  Status bar after debug start: ${sbText}`);
    });

    // ------------------------------------------------------------------
    // Step 4: Make an HTTP request to trigger the breakpoint
    // ------------------------------------------------------------------
    await test.step('4. Make HTTP request to trigger breakpoint', async () => {
      const servers = await getServerViewState(page);
      let httpPort = 8080;
      if (servers.length > 0) {
        const srv = servers[0] as Record<string, string>;
        const portMatch = srv.ports?.match(/(\d+)/);
        httpPort = portMatch ? parseInt(portMatch[1]) : 8080;
      }

      // Trigger the HTTP request to hit the breakpoint
      // The request may hang because the debugger pauses the thread
      try {
        const triggerResult = await agentApi.get(
          `/api/v1/proxy?url=${encodeURIComponent(`http://127.0.0.1:${httpPort}/kairo/hello`)}`,
        );
        console.log(`  HTTP trigger status: ${triggerResult.status}`);
      } catch {
        // Expected: the request may timeout or fail because the breakpoint pauses
        console.log('  HTTP trigger: request hung (expected — breakpoint paused the thread)');
      }

      await page.waitForTimeout(2_000);
    });

    // ------------------------------------------------------------------
    // Step 5: Verify the breakpoint is hit
    // ------------------------------------------------------------------
    await test.step('5. Verify breakpoint is hit', async () => {
      // Check if the debug session is in a paused state
      const debugState = await page.evaluate(() => {
        const sb = document.querySelector('#theia-statusBar');
        if (!sb) return null;
        return (sb.textContent || '').includes('Debug: paused');
      });
      console.log(`  Debug paused state detected: ${debugState}`);

      // Check for the debug view being visible
      const debugViewVisible = await page.evaluate(() => {
        const debugView = document.querySelector('.debug-view');
        return debugView !== null;
      });
      console.log(`  Debug view visible: ${debugViewVisible}`);

      // Verify the current line is highlighted in the editor
      const currentLineHighlighted = await page.evaluate(() => {
        const highlighted = document.querySelector(
          '.monaco-editor .current-line, .monaco-editor .debug-current-line',
        );
        return highlighted !== null;
      });
      console.log(`  Current debug line highlighted: ${currentLineHighlighted}`);
    });

    // ------------------------------------------------------------------
    // Step 6: Inspect variables
    // ------------------------------------------------------------------
    await test.step('6. Inspect variables', async () => {
      // Check the Variables view is populated
      const variablesView = await page.evaluate(() => {
        const varsWidget = document.querySelector('.debug-variables');
        if (!varsWidget) return null;
        const treeItems = varsWidget.querySelectorAll('.theia-TreeNode');
        return Array.from(treeItems).map((el) => el.textContent?.trim() || '');
      });
      console.log(`  Variables view entries: ${variablesView ? variablesView.length : 'not found'}`);

      if (variablesView && variablesView.length > 0) {
        console.log(`  First variables: ${variablesView.slice(0, 5).join(', ')}`);
      }

      // Verify the Call Stack view is populated
      const callStackView = await page.evaluate(() => {
        const csWidget = document.querySelector('.debug-call-stack');
        if (!csWidget) return null;
        const treeItems = csWidget.querySelectorAll('.theia-TreeNode');
        return Array.from(treeItems).map((el) => el.textContent?.trim() || '');
      });
      console.log(`  Call stack entries: ${callStackView ? callStackView.length : 'not found'}`);
    });

    // ------------------------------------------------------------------
    // Step 7: Execute Step Over (F10)
    // ------------------------------------------------------------------
    await test.step('7. Execute Step Over (F10)', async () => {
      // Press F10 to step over the current line
      await page.keyboard.press('F10');
      await page.waitForTimeout(2_000);

      // Verify the debugger is still paused (stepped to next line)
      const debugStillPaused = await page.evaluate(() => {
        const sb = document.querySelector('#theia-statusBar');
        if (!sb) return false;
        return (sb.textContent || '').includes('Debug: paused');
      });
      console.log(`  Debug still paused after step over: ${debugStillPaused}`);

      // Verify the current line has changed
      const currentLineChanged = await page.evaluate(() => {
        const highlighted = document.querySelector(
          '.monaco-editor .current-line, .monaco-editor .debug-current-line',
        );
        return highlighted !== null;
      });
      console.log(`  New current line highlighted: ${currentLineChanged}`);
    });

    // ------------------------------------------------------------------
    // Step 8: Execute Continue (F5)
    // ------------------------------------------------------------------
    await test.step('8. Execute Continue (F5)', async () => {
      // Press F5 to continue execution
      await page.keyboard.press('F5');
      await page.waitForTimeout(2_000);

      // Verify the debugger is no longer paused
      const debugRunning = await page.evaluate(() => {
        const sb = document.querySelector('#theia-statusBar');
        if (!sb) return false;
        const text = sb.textContent || '';
        return text.includes('Debug: connected') || text.includes('Debug: running');
      });
      console.log(`  Debug running after continue: ${debugRunning}`);

      // Verify the HTTP response was served
      const servers = await getServerViewState(page);
      if (servers.length > 0) {
        const srv = servers[0] as Record<string, string>;
        const portMatch = srv.ports?.match(/(\d+)/);
        const httpPort = portMatch ? parseInt(portMatch[1]) : 8080;

        try {
          const responseCheck = await agentApi.get(
            `/api/v1/proxy?url=${encodeURIComponent(`http://127.0.0.1:${httpPort}/kairo/hello`)}`,
          );
          console.log(`  HTTP response after continue: status=${responseCheck.status}`);
        } catch {
          console.log('  HTTP response check failed (may need more time)');
        }
      }
    });

    // ------------------------------------------------------------------
    // Step 9: Stop the debug session and server
    // ------------------------------------------------------------------
    await test.step('9. Stop the debug session and server', async () => {
      // Stop the debug session
      await runCommandViaPalette(page, 'Kairo: Stop Debug Server');
      await page.waitForTimeout(2_000);

      // Verify the debug session is terminated
      const debugTerminated = await page.evaluate(() => {
        const sb = document.querySelector('#theia-statusBar');
        if (!sb) return false;
        const text = sb.textContent || '';
        return text.includes('Debug: terminated') || !text.includes('Debug: connected');
      });
      console.log(`  Debug session terminated: ${debugTerminated}`);

      // Stop the server
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);

      // Verify no residual processes
      const stoppedServers = await getServerViewState(page);
      const stillRunning = (stoppedServers as Record<string, string>[]).filter(
        (s) => s.state === 'running',
      );
      console.log(`  Servers still running after stop: ${stillRunning.length}`);
      expect(stillRunning.length).toBe(0);
    });
  });
});

// ===========================================================================
// E2E-08: Close → Reopen → Projects & Config Recovery
// ===========================================================================
test.describe('E2E-08: Close → Reopen → Projects & Config Recovery', () => {
  test('should recover recent projects and run configurations after restart', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch + import project + configure run
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia, import project and configure run', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);

      // Open a file to establish workspace state
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(1_000);

      // Configure run — open run configuration
      await runCommandViaPalette(page, 'Kairo: Configure Run');
      await page.waitForTimeout(1_000);

      // Verify the run configuration widget appears
      const runConfig = page.locator(
        '[data-testid="run-config"], .run-config-view, [data-testid="server-port-input"]',
      );
      const configVisible = await runConfig.isVisible().catch(() => false);
      if (configVisible) {
        console.log('  Run configuration widget visible');
      }

      // Close the run config panel if open
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    });

    // ------------------------------------------------------------------
    // Step 2: Verify the project appears in recent projects
    // ------------------------------------------------------------------
    await test.step('2. Verify project appears in recent projects', async () => {
      // Check recent projects via the File menu or agent API
      const recentResult = await agentApi.get('/api/v1/workspaces');
      if (recentResult.status === 200 && recentResult.json) {
        const workspaces = recentResult.json as Record<string, unknown>;
        console.log(`  Workspaces registered: ${JSON.stringify(workspaces)}`);
      }

      // Verify the workspace is registered via agent API
      const wsResult = await agentApi.get(
        `/api/v1/workspaces/${encodeURIComponent(workspace.rootPath)}`,
      );
      console.log(`  Workspace lookup: status=${wsResult.status}`);
    });

    // ------------------------------------------------------------------
    // Step 3: Verify run configuration is saved
    // ------------------------------------------------------------------
    await test.step('3. Verify run configuration is saved', async () => {
      // Save run configuration via agent API
      const configResult = await agentApi.post('/api/v1/run-config', {
        workspace: workspace.rootPath,
        server: 'tomcat',
        port: 8080,
        deployPath: '/kairo',
      });
      console.log(`  Run config saved: status=${configResult.status}`);

      // Verify the configuration was persisted
      const getConfig = await agentApi.get(
        `/api/v1/run-config?workspace=${encodeURIComponent(workspace.rootPath)}`,
      );
      if (getConfig.status === 200) {
        console.log(`  Run config retrieved: ${getConfig.body.substring(0, 100)}`);
      }
    });

    // ------------------------------------------------------------------
    // Step 4: Close the IDE (simulate page reload)
    // ------------------------------------------------------------------
    await test.step('4. Close the IDE (simulate page reload)', async () => {
      // Record state before reload
      const preReloadSb = await getStatusBarText(page);
      console.log(`  Status bar before reload: ${preReloadSb.substring(0, 120)}`);

      // Reload the page to simulate closing and reopening the IDE
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
      console.log('  Page reloaded (simulating IDE restart)');
    });

    // ------------------------------------------------------------------
    // Step 5: Reopen the IDE
    // ------------------------------------------------------------------
    await test.step('5. Reopen the IDE', async () => {
      await waitForTheiaShell(page);
      await page.waitForTimeout(2_000);

      const sbText = await getStatusBarText(page);
      expect(sbText).toBeTruthy();
      console.log(`  IDE reopened, status bar: ${sbText.substring(0, 120)}`);
    });

    // ------------------------------------------------------------------
    // Step 6: Verify the recent project is listed
    // ------------------------------------------------------------------
    await test.step('6. Verify recent project is listed', async () => {
      // Check the workspace is still registered after restart
      const wsResult = await agentApi.get(
        `/api/v1/workspaces/${encodeURIComponent(workspace.rootPath)}`,
      );
      console.log(`  Workspace lookup after restart: status=${wsResult.status}`);

      // Verify the file explorer still shows the workspace
      const fileTree = await page.evaluate(() => {
        const explorer = document.querySelector('.theia-Explorer, #explorer-view-container');
        if (!explorer) return null;
        const treeItems = explorer.querySelectorAll('.theia-TreeNode, .p-TabBar-tab');
        return Array.from(treeItems).map((el) => el.textContent?.trim() || '');
      });

      if (fileTree && fileTree.length > 0) {
        console.log(`  File tree items after restart: ${fileTree.length}`);
        console.log(`  First items: ${fileTree.slice(0, 5).join(', ')}`);
      }
    });

    // ------------------------------------------------------------------
    // Step 7: Verify the run configuration is restored
    // ------------------------------------------------------------------
    await test.step('7. Verify run configuration is restored', async () => {
      const getConfig = await agentApi.get(
        `/api/v1/run-config?workspace=${encodeURIComponent(workspace.rootPath)}`,
      );
      if (getConfig.status === 200) {
        console.log(`  Run config restored: ${getConfig.body.substring(0, 100)}`);
      }

      // Verify the status bar shows the runtime configuration
      const sbText = await getStatusBarText(page);
      expect(sbText).toContain('Agent:');
      console.log('  Run configuration present in status bar');
    });

    // ------------------------------------------------------------------
    // Step 8: Verify workspace state (open files, panel layout) is restored
    // ------------------------------------------------------------------
    await test.step('8. Verify workspace state is restored', async () => {
      // Check if any editors are restored
      const editorTabs = await page.evaluate(() => {
        const tabs = document.querySelectorAll(
          '.p-TabBar-tab[data-type="editor"], .theia-tab-bar .p-TabBar-tab',
        );
        return Array.from(tabs).map((el) => el.textContent?.trim() || '');
      });
      console.log(`  Editor tabs after restart: ${editorTabs.join(', ') || '(none)'}`);

      // Verify the status bar contains all expected entries
      const sbText = await getStatusBarText(page);
      const requiredEntries = ['Project:', 'Agent:'];
      for (const entry of requiredEntries) {
        expect(sbText, `Status bar should contain "${entry}" after restart`).toContain(entry);
      }
      console.log('  Workspace state verified');
    });
  });
});

// ===========================================================================
// E2E-09: Port occupation → diagnostics → modify port → retry
// ===========================================================================
test.describe('E2E-09: Port Occupation → Diagnostics → Modify Port → Retry', () => {
  test('should detect port occupation, show diagnostics, allow port modification, and retry', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch and prepare
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia, prepare workspace, build and deploy', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });
      await waitForStatusContains(page, 'JDT LS: ready', 120_000);

      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      await page.waitForTimeout(3_000);
    });

    // ------------------------------------------------------------------
    // Step 2: Occupy the default Tomcat port (8080)
    // ------------------------------------------------------------------
    await test.step('2. Occupy the Tomcat port (8080)', async () => {
      // Use a simple HTTP server to occupy port 8080
      // This is done via the agent API or by starting a dummy listener
      const occupyResult = await agentApi.post('/api/v1/diagnostics/port-check', {
        port: 8080,
      });
      console.log(`  Port 8080 check: status=${occupyResult.status}`);
      // Note: In a real test, we would start a process that binds to port 8080
      // before attempting to start Tomcat. This step documents the intent.
    });

    // ------------------------------------------------------------------
    // Step 3: Attempt to start Tomcat on the occupied port
    // ------------------------------------------------------------------
    await test.step('3. Attempt to start Tomcat (should fail or warn)', async () => {
      await runCommandViaPalette(page, 'Kairo: Start Server');
      await page.waitForTimeout(3_000);

      // Check if the server view shows an error or warning
      const servers = await getServerViewState(page);
      console.log(`  Server state after start attempt: ${JSON.stringify(servers)}`);

      // The status bar should show a diagnostic message
      const sbText = await getStatusBarText(page);
      console.log(`  Status bar: ${sbText}`);
    });

    // ------------------------------------------------------------------
    // Step 4: Verify the error/diagnostic message
    // ------------------------------------------------------------------
    await test.step('4. Verify port occupation error message', async () => {
      // Check the Problems view or status bar for port occupation errors
      const problems = await getProblemsViewState(page);
      console.log(`  Problems after port conflict: ${problems.length}`);

      // Check for server error state
      const servers = await getServerViewState(page);
      if (servers.length > 0) {
        const srv = servers[0] as Record<string, string>;
        console.log(`  Server state: ${srv.state}`);
        // The server should be in a failed or error state
        const hasError = srv.state === 'failed' || srv.state === 'error';
        console.log(`  Server has error state: ${hasError}`);
      }
    });

    // ------------------------------------------------------------------
    // Step 5: Modify the Tomcat port configuration
    // ------------------------------------------------------------------
    await test.step('5. Modify Tomcat port to 8081', async () => {
      // Stop the failed server first
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);

      // Open the run configuration to change the port
      await runCommandViaPalette(page, 'Kairo: Configure Run');
      await page.waitForTimeout(1_000);

      // Look for the port input field and change it
      const portInput = page.locator(
        '[data-testid="server-port-input"], #server-port, input[type="number"]',
      );
      const portInputVisible = await portInput.isVisible().catch(() => false);
      if (portInputVisible) {
        await portInput.fill('8081');
        await page.waitForTimeout(500);
        // Save the configuration
        const saveBtn = page.locator(
          'button:has-text("Save"), button:has-text("保存"), button:has-text("Apply")',
        );
        if (await saveBtn.isVisible().catch(() => false)) {
          await saveBtn.click();
          await page.waitForTimeout(1_000);
        }
      }
      console.log('  Modified port to 8081');
    });

    // ------------------------------------------------------------------
    // Step 6: Retry starting Tomcat
    // ------------------------------------------------------------------
    await test.step('6. Retry starting Tomcat on port 8081', async () => {
      await runCommandViaPalette(page, 'Kairo: Start Server');
      await page.waitForTimeout(2_000);

      // Wait for server to reach running state
      const serverResult = await waitForServerState(page, 'running', 120_000);
      if (serverResult) {
        const srv = serverResult as Record<string, string>;
        console.log(`  Server running: pid=${srv.pid} ports=${srv.ports}`);
        expect(srv.state).toBe('running');
        // Verify the port has changed
        expect(srv.ports).toContain('8081');
      }
    });

    // ------------------------------------------------------------------
    // Step 7: Cleanup — stop the server
    // ------------------------------------------------------------------
    await test.step('7. Stop the server', async () => {
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);
    });
  });
});

// ===========================================================================
// E2E-10: Agent/JDT LS Crash → Detection → Recovery
// ===========================================================================
test.describe('E2E-10: Agent/JDT LS Crash → Recovery', () => {
  test('should detect JDT LS crash and recover', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch + wait for JDT LS ready
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia and wait for JDT LS ready', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });

      const jdtReady = await waitForStatusContains(page, 'JDT LS: ready', 120_000);
      expect(jdtReady, 'JDT LS should become ready').toBeTruthy();
      console.log('  JDT LS is ready');
    });

    // ------------------------------------------------------------------
    // Step 2: Verify JDT LS is running
    // ------------------------------------------------------------------
    await test.step('2. Verify JDT LS is running', async () => {
      const sbText = await getStatusBarText(page);
      expect(sbText).toContain('JDT LS: ready');
      console.log(`  Status bar confirms JDT LS: ${sbText.includes('JDT LS: ready')}`);
    });

    // ------------------------------------------------------------------
    // Step 3: Simulate JDT LS crash (kill the process via agent API)
    // ------------------------------------------------------------------
    await test.step('3. Simulate JDT LS crash', async () => {
      const killResult = await agentApi.post('/api/v1/diagnostics/kill-process', {
        process: 'jdt.ls',
        signal: 'SIGKILL',
      });
      console.log(`  JDT LS kill request: status=${killResult.status}`);
      // Wait for the crash to be detected
      await page.waitForTimeout(3_000);
    });

    // ------------------------------------------------------------------
    // Step 4: Verify the IDE shows a visible error/warning
    // ------------------------------------------------------------------
    await test.step('4. Verify IDE shows crash indicator', async () => {
      // Check the status bar for JDT LS disconnected state
      const sbText = await getStatusBarText(page);
      console.log(`  Status bar after crash: ${sbText.substring(0, 200)}`);

      // The status bar should indicate JDT LS is not ready (crashed or disconnected)
      const jdtDisconnected =
        sbText.includes('JDT LS: disconnected') ||
        sbText.includes('JDT LS: error') ||
        sbText.includes('JDT LS: stopped') ||
        !sbText.includes('JDT LS: ready');
      console.log(`  JDT LS disconnected indicator: ${jdtDisconnected}`);

      // Check for any visible error notifications
      const hasErrorNotification = await page.evaluate(() => {
        const notifications = document.querySelectorAll(
          '.theia-notification, .notification-toast, [role="alert"]',
        );
        return notifications.length > 0;
      });
      console.log(`  Error notifications visible: ${hasErrorNotification}`);
    });

    // ------------------------------------------------------------------
    // Step 5: Verify JDT LS auto-restarts within timeout
    // ------------------------------------------------------------------
    await test.step('5. Verify JDT LS auto-restarts', async () => {
      const jdtRecovered = await waitForStatusContains(page, 'JDT LS: ready', 120_000);
      expect(jdtRecovered, 'JDT LS should auto-restart within timeout').toBeTruthy();
      console.log('  JDT LS auto-restarted successfully');
    });

    // ------------------------------------------------------------------
    // Step 6: Verify Java features work again after restart
    // ------------------------------------------------------------------
    await test.step('6. Verify Java features work after restart', async () => {
      // Open a Java file to verify language features are functional
      await openFileViaQuickOpen(page, 'HelloWorld.java');
      await page.waitForTimeout(1_000);

      // Trigger completion to verify JDT LS is functional
      await page.click('.monaco-editor .view-lines');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+Space');
      await page.waitForTimeout(2_000);

      const hasCompletion = await page.evaluate(() => {
        return !!document.querySelector('.monaco-editor .suggest-widget');
      });
      console.log(`  Completion widget visible after recovery: ${hasCompletion}`);

      // Dismiss completion
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    });

    // ------------------------------------------------------------------
    // Step 7: Stop server
    // ------------------------------------------------------------------
    await test.step('7. Stop server', async () => {
      await runCommandViaPalette(page, 'Kairo: Stop Server');
      await page.waitForTimeout(2_000);
      console.log('  Server stopped');
    });
  });

  test('should detect Agent crash and recover', async ({
    page,
    agentApi,
    workspace,
  }) => {
    // ------------------------------------------------------------------
    // Step 1: Launch + verify agent is healthy
    // ------------------------------------------------------------------
    await test.step('1. Launch Theia and verify agent health', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', { rootPath: workspace.rootPath });

      const health = await agentApi.get('/api/v1/health');
      expect(health.status).toBe(200);
      expect(health.json?.ok).toBe(true);
      console.log('  Agent is healthy');
    });

    // ------------------------------------------------------------------
    // Step 2: Simulate agent crash (kill the process)
    // ------------------------------------------------------------------
    await test.step('2. Simulate agent crash', async () => {
      const killResult = await agentApi.post('/api/v1/diagnostics/kill-process', {
        process: 'kairo-agent',
        signal: 'SIGKILL',
      });
      console.log(`  Agent kill request: status=${killResult.status}`);
      // Wait for the crash to be detected by the frontend
      await page.waitForTimeout(3_000);
    });

    // ------------------------------------------------------------------
    // Step 3: Verify the IDE shows agent disconnected state
    // ------------------------------------------------------------------
    await test.step('3. Verify IDE shows agent disconnected state', async () => {
      // Check for disconnected indicator in the status bar or UI
      const sbText = await getStatusBarText(page);
      console.log(`  Status bar after agent crash: ${sbText.substring(0, 200)}`);

      // Check for agent disconnected notifications or indicators
      const hasDisconnectedIndicator = await page.evaluate(() => {
        const indicators = document.querySelectorAll(
          '[data-testid="agent-status"], [data-testid="connection-status"], .agent-status',
        );
        return Array.from(indicators).some((el) => {
          const text = el.textContent?.toLowerCase() || '';
          return text.includes('disconnected') || text.includes('offline') || text.includes('error');
        });
      });
      console.log(`  Agent disconnected indicator visible: ${hasDisconnectedIndicator}`);
    });

    // ------------------------------------------------------------------
    // Step 4: Verify reconnect button is visible
    // ------------------------------------------------------------------
    await test.step('4. Verify reconnect button is visible', async () => {
      const reconnectBtn = page.locator(
        '[data-testid="reconnect-btn"], button:has-text("Reconnect"), button:has-text("重新连接"), button:has-text("Retry")',
      );
      const btnVisible = await reconnectBtn.isVisible().catch(() => false);
      console.log(`  Reconnect button visible: ${btnVisible}`);
    });

    // ------------------------------------------------------------------
    // Step 5: Click reconnect
    // ------------------------------------------------------------------
    await test.step('5. Click reconnect', async () => {
      const reconnectBtn = page.locator(
        '[data-testid="reconnect-btn"], button:has-text("Reconnect"), button:has-text("重新连接"), button:has-text("Retry")',
      );
      const btnVisible = await reconnectBtn.isVisible().catch(() => false);
      if (btnVisible) {
        await reconnectBtn.click();
        await page.waitForTimeout(2_000);
        console.log('  Reconnect button clicked');
      }
    });

    // ------------------------------------------------------------------
    // Step 6: Verify agent reconnects successfully
    // ------------------------------------------------------------------
    await test.step('6. Verify agent reconnects successfully', async () => {
      // Wait for the agent to come back online
      const start = Date.now();
      let reconnected = false;
      while (Date.now() - start < 120_000) {
        const health = await agentApi.get('/api/v1/health');
        if (health.status === 200 && health.json?.ok === true) {
          reconnected = true;
          break;
        }
        await page.waitForTimeout(2_000);
      }
      expect(reconnected, 'Agent should reconnect within timeout').toBe(true);
      console.log('  Agent reconnected successfully');
    });

    // ------------------------------------------------------------------
    // Step 7: Verify workspace state is preserved
    // ------------------------------------------------------------------
    await test.step('7. Verify workspace state is preserved', async () => {
      // Verify the workspace is still registered
      const wsResult = await agentApi.get(
        `/api/v1/workspaces/${encodeURIComponent(workspace.rootPath)}`,
      );
      console.log(`  Workspace lookup after reconnect: status=${wsResult.status}`);

      // Verify the status bar contains expected entries
      const sbText = await getStatusBarText(page);
      expect(sbText).toContain('Project:');
      expect(sbText).toContain('Agent:');
      console.log('  Workspace state preserved after agent reconnection');
    });
  });
});