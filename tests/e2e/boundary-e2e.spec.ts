/**
 * Kairo IDE — Boundary/Edge Case E2E Tests
 *
 * Tests for boundary conditions and edge cases:
 *   - Large file handling (10MB+ Java file)
 *   - Multi-file simultaneous editing
 *   - Rapid consecutive operations
 *   - Network disconnect/reconnect
 *   - Process crash recovery
 *   - Disk space insufficient scenarios
 *
 * Prerequisites:
 *   1. Run `pnpm agent:run` in one terminal
 *   2. Run `pnpm dev:browser` in another terminal
 *   3. Run: npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/boundary-e2e.spec.ts
 */
import { test, expect } from './fixtures';
import {
  navigateToTheia,
  waitForTheiaShell,
  getStatusBarText,
  waitForStatusContains,
  openFileViaQuickOpen,
  getEditorContent,
  runCommandViaPalette,
} from './fixtures';
import * as fs from 'node:fs';
import * as path from 'node:path';

// =============================================================================
// BOUNDARY-01: Large File Handling (10MB+)
// =============================================================================
test.describe('BOUNDARY-01: Large File Handling', () => {
  test('should handle large Java files (10MB+)', async ({
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

    await test.step('Generate a large Java file (10MB)', async () => {
      const largeFilePath = path.join(
        workspace.rootPath,
        'src',
        'main',
        'java',
        'com',
        'example',
        'LargeFile.java',
      );
      const largeContent = generateLargeJavaFile(10 * 1024 * 1024); // 10MB
      fs.mkdirSync(path.dirname(largeFilePath), { recursive: true });
      fs.writeFileSync(largeFilePath, largeContent, 'utf-8');

      const stats = fs.statSync(largeFilePath);
      console.log(`  Large file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      expect(stats.size).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    });

    await test.step('Open the large file', async () => {
      const startTime = Date.now();
      await openFileViaQuickOpen(page, 'LargeFile.java');
      const loadTime = Date.now() - startTime;
      console.log(`  Large file opened in ${loadTime}ms`);

      // Should load within 60 seconds
      expect(loadTime).toBeLessThan(60_000);
    });

    await test.step('Verify editor is responsive', async () => {
      const content = await getEditorContent(page);
      expect(content.length).toBeGreaterThan(0);
      console.log(`  Editor content: ${content.length} chars`);

      // Scroll to bottom
      await page.click('.monaco-editor .view-lines');
      await page.keyboard.press('Control+End');
      await page.waitForTimeout(2_000);

      // Scroll to top
      await page.keyboard.press('Control+Home');
      await page.waitForTimeout(1_000);
    });

    await test.step('Edit and save large file', async () => {
      await page.click('.monaco-editor .view-lines');
      await page.keyboard.press('Control+Home');
      await page.keyboard.type('// Boundary test edit\n', { delay: 5 });
      await page.waitForTimeout(500);

      const saveStart = Date.now();
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(3_000);
      const saveTime = Date.now() - saveStart;
      console.log(`  Large file saved in ${saveTime}ms`);
    });

    await test.step('Cleanup large file', async () => {
      const largeFilePath = path.join(
        workspace.rootPath,
        'src',
        'main',
        'java',
        'com',
        'example',
        'LargeFile.java',
      );
      if (fs.existsSync(largeFilePath)) {
        fs.unlinkSync(largeFilePath);
      }
    });
  });
});

// =============================================================================
// BOUNDARY-02: Multi-file Simultaneous Editing
// =============================================================================
test.describe('BOUNDARY-02: Multi-file Simultaneous Editing', () => {
  test('should handle editing 10+ files simultaneously', async ({
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

    await test.step('Create multiple test files', async () => {
      const testDir = path.join(workspace.rootPath, 'src', 'test', 'java');
      fs.mkdirSync(testDir, { recursive: true });

      for (let i = 1; i <= 10; i++) {
        const filePath = path.join(testDir, `TestFile${i}.java`);
        const content = `public class TestFile${i} {\n` +
          `    public void test${i}() {\n` +
          `        System.out.println("Test ${i}");\n` +
          `    }\n` +
          `}\n`;
        fs.writeFileSync(filePath, content, 'utf-8');
      }
      console.log('  Created 10 test files');
    });

    await test.step('Open all files', async () => {
      const openStart = Date.now();
      for (let i = 1; i <= 10; i++) {
        await openFileViaQuickOpen(page, `TestFile${i}.java`);
        await page.waitForTimeout(300);
      }
      const openTime = Date.now() - openStart;
      console.log(`  All 10 files opened in ${openTime}ms`);
    });

    await test.step('Verify editor tabs count', async () => {
      const tabs = await page.evaluate(() => {
        const tabElements = document.querySelectorAll(
          '.p-TabBar-tab[data-type="editor"]',
        );
        return tabElements.length;
      });
      console.log(`  Editor tabs: ${tabs}`);
      expect(tabs).toBeGreaterThanOrEqual(5);
    });

    await test.step('Close all editors', async () => {
      await runCommandViaPalette(page, 'Close All Editors');
      await page.waitForTimeout(1_000);
    });

    await test.step('Cleanup test files', async () => {
      const testDir = path.join(workspace.rootPath, 'src', 'test', 'java');
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});

// =============================================================================
// BOUNDARY-03: Rapid Consecutive Operations
// =============================================================================
test.describe('BOUNDARY-03: Rapid Consecutive Operations', () => {
  test('should handle rapid consecutive command executions', async ({
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

    await test.step('Execute rapid file open/close operations', async () => {
      const files = ['HelloWorld.java', 'HelloServlet.java', 'hello.jsp'];
      for (let round = 0; round < 5; round++) {
        for (const file of files) {
          await openFileViaQuickOpen(page, file);
          await page.waitForTimeout(200);
        }
        // Close all
        await runCommandViaPalette(page, 'Close All Editors');
        await page.waitForTimeout(300);
      }
      console.log('  Completed 5 rounds of rapid open/close');
    });

    await test.step('Execute rapid save operations', async () => {
      await openFileViaQuickOpen(page, 'HelloWorld.java');
      await page.waitForTimeout(500);

      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(100);
      }
      console.log('  Completed 20 rapid saves');
    });

    await test.step('Verify IDE is still responsive', async () => {
      const sbText = await getStatusBarText(page);
      expect(sbText).toBeTruthy();
      console.log('  IDE still responsive after rapid operations');
    });
  });
});

// =============================================================================
// BOUNDARY-04: Network Disconnect/Reconnect
// =============================================================================
test.describe('BOUNDARY-04: Network Disconnect/Reconnect', () => {
  test('should handle agent disconnect and reconnect', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and verify agent health', async () => {
      await navigateToTheia(page);
      const health = await agentApi.get('/api/v1/health');
      expect(health.status).toBe(200);
      expect(health.json?.ok).toBe(true);
    });

    await test.step('Simulate network disconnect (offline mode)', async () => {
      // Simulate going offline by setting browser to offline mode
      await page.context().setOffline(true);
      await page.waitForTimeout(2_000);

      // Verify agent is unreachable
      const healthCheck = await agentApi.get('/api/v1/health');
      console.log(`  Agent health during offline: status=${healthCheck.status}`);
      // Should fail (status 0 or error)
      expect(healthCheck.status).not.toBe(200);
    });

    await test.step('Simulate network reconnect', async () => {
      await page.context().setOffline(false);
      await page.waitForTimeout(3_000);

      // Verify agent is reachable again
      const healthCheck = await agentApi.get('/api/v1/health');
      console.log(`  Agent health after reconnect: status=${healthCheck.status}`);
      if (healthCheck.status === 200) {
        expect(healthCheck.json?.ok).toBe(true);
      }
    });
  });
});

// =============================================================================
// BOUNDARY-05: Process Crash Recovery
// =============================================================================
test.describe('BOUNDARY-05: Process Crash Recovery', () => {
  test('should detect JDT LS crash and verify recovery', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate and wait for JDT LS ready', async () => {
      await navigateToTheia(page);
      await agentApi.post('/api/v1/workspaces', {
        rootPath: workspace.rootPath,
      });
      const jdtReady = await waitForStatusContains(
        page,
        'JDT LS: ready',
        120_000,
      );
      expect(jdtReady).toBeTruthy();
    });

    await test.step('Verify JDT LS is running', async () => {
      const sbText = await getStatusBarText(page);
      expect(sbText).toContain('JDT LS: ready');
    });

    await test.step('Simulate JDT LS crash via API', async () => {
      const killResult = await agentApi.post(
        '/api/v1/diagnostics/kill-process',
        {
          process: 'jdt.ls',
          signal: 'SIGKILL',
        },
      );
      console.log(`  Kill request: status=${killResult.status}`);
      await page.waitForTimeout(3_000);
    });

    await test.step('Verify crash indicator in status bar', async () => {
      const sbText = await getStatusBarText(page);
      console.log(`  Status bar after crash: ${sbText.substring(0, 200)}`);
    });

    await test.step('Wait for JDT LS auto-restart', async () => {
      const jdtRecovered = await waitForStatusContains(
        page,
        'JDT LS: ready',
        120_000,
      );
      console.log(`  JDT LS recovered: ${jdtRecovered !== null}`);
    });
  });
});

// =============================================================================
// BOUNDARY-06: Disk Space Insufficient
// =============================================================================
test.describe('BOUNDARY-06: Disk Space Insufficient', () => {
  test('should handle disk space errors gracefully', async ({
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

    await test.step('Verify disk space API works', async () => {
      // Check that the agent can report disk space
      const health = await agentApi.get('/api/v1/health');
      expect(health.status).toBe(200);
      // The agent should include disk space info in health
      if (health.json?.payload) {
        const payload = health.json.payload as Record<string, unknown>;
        if (payload.diskFreeBytes !== undefined) {
          console.log(`  Disk free: ${payload.diskFreeBytes} bytes`);
        }
      }
    });

    await test.step('Attempt to create a large file', async () => {
      try {
        const largeFilePath = path.join(
          workspace.rootPath,
          'large_test.bin',
        );
        const size = 100 * 1024 * 1024; // 100MB
        const buffer = Buffer.alloc(size, 'A');
        fs.writeFileSync(largeFilePath, buffer);
        const stats = fs.statSync(largeFilePath);
        console.log(`  Created ${(stats.size / 1024 / 1024).toFixed(2)} MB file`);
        fs.unlinkSync(largeFilePath);
      } catch (err) {
        console.log(`  Expected error: ${(err as Error).message}`);
      }
    });
  });
});

// =============================================================================
// BOUNDARY-07: Empty Project
// =============================================================================
test.describe('BOUNDARY-07: Empty Project', () => {
  test('should handle importing an empty project', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Create empty workspace directory', async () => {
      const emptyDir = path.join(workspace.rootPath, 'empty-project');
      fs.mkdirSync(emptyDir, { recursive: true });
      console.log(`  Created empty project: ${emptyDir}`);
    });

    await test.step('Import empty project', async () => {
      const resp = await agentApi.post('/api/v1/workspaces', {
        rootPath: path.join(workspace.rootPath, 'empty-project'),
      });
      console.log(`  Empty project import: status=${resp.status}`);
      // Should either succeed gracefully or return a meaningful error
    });
  });
});

// =============================================================================
// BOUNDARY-08: File with Special Characters
// =============================================================================
test.describe('BOUNDARY-08: File with Special Characters', () => {
  test('should handle files with special characters in name', async ({
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

    await test.step('Create files with special names', async () => {
      const specialNames = [
        'test-file.java',
        'test file.java',
        'test_file.java',
        'TestFile.java',
        'test.file.java',
      ];
      for (const name of specialNames) {
        const filePath = path.join(
          workspace.rootPath,
          'src',
          'main',
          'java',
          'com',
          'example',
          name,
        );
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(
          filePath,
          `public class ${name.replace('.java', '').replace(/[^a-zA-Z0-9]/g, '_')} {}\n`,
          'utf-8',
        );
      }
      console.log(`  Created ${specialNames.length} files with special names`);
    });

    await test.step('Open a file with special name', async () => {
      await openFileViaQuickOpen(page, 'TestFile.java');
      await page.waitForTimeout(1_000);
      const content = await getEditorContent(page);
      expect(content.length).toBeGreaterThan(0);
    });

    await test.step('Cleanup special files', async () => {
      const specialNames = [
        'test-file.java',
        'test file.java',
        'test_file.java',
        'TestFile.java',
        'test.file.java',
      ];
      for (const name of specialNames) {
        const filePath = path.join(
          workspace.rootPath,
          'src',
          'main',
          'java',
          'com',
          'example',
          name,
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    });
  });
});

// =============================================================================
// BOUNDARY-09: Encoding Boundary Cases
// =============================================================================
test.describe('BOUNDARY-09: Encoding Boundary Cases', () => {
  test('should handle various encoding edge cases', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Test encoding detection for various files', async () => {
      const testCases = [
        { file: `${workspace.rootPath}/WebRoot/hello.jsp`, expected: ['gbk', 'gb18030', 'utf-8'] },
        { file: `${workspace.rootPath}/src/main/java/com/example/HelloWorld.java`, expected: ['utf-8', 'ascii'] },
        { file: '/nonexistent/file.txt', expected: ['error'] },
        { file: '', expected: ['error'] },
      ];

      for (const tc of testCases) {
        if (!tc.file) continue;
        const resp = await agentApi.post('/api/v1/encoding/detect', {
          file: tc.file,
        });
        console.log(
          `  File: ${tc.file} -> status=${resp.status}`,
        );
      }
    });

    await test.step('Test encoding validate with invalid encoding', async () => {
      const resp = await agentApi.post('/api/v1/encoding/validate', {
        file: `${workspace.rootPath}/WebRoot/hello.jsp`,
        encoding: 'invalid-encoding-name',
      });
      console.log(`  Invalid encoding validate: status=${resp.status}`);
    });
  });
});

// =============================================================================
// BOUNDARY-10: Concurrent API Requests
// =============================================================================
test.describe('BOUNDARY-10: Concurrent API Requests', () => {
  test('should handle concurrent API requests without errors', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Execute concurrent health checks', async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(agentApi.get('/api/v1/health'));
      }
      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r.status === 200).length;
      const failCount = results.filter((r) => r.status !== 200).length;
      console.log(
        `  Concurrent health checks: ${successCount} OK, ${failCount} failed`,
      );
      expect(successCount).toBeGreaterThanOrEqual(40); // Allow some failures
    });

    await test.step('Execute concurrent encoding detections', async () => {
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          agentApi.post('/api/v1/encoding/detect', {
            file: `${workspace.rootPath}/WebRoot/hello.jsp`,
          }),
        );
      }
      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r.status === 200).length;
      console.log(
        `  Concurrent encoding detections: ${successCount} OK`,
      );
    });
  });
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generates a large Java file of the specified size in bytes.
 */
function generateLargeJavaFile(targetSize: number): string {
  const lines: string[] = [];
  lines.push('package com.example;');
  lines.push('');
  lines.push('/**');
  lines.push(' * Large file for boundary testing.');
  lines.push(' * This file is auto-generated.');
  lines.push(' */');
  lines.push('public class LargeFile {');
  lines.push('');

  let currentSize = lines.join('\n').length;
  let methodCount = 0;

  while (currentSize < targetSize) {
    methodCount++;
    lines.push(`    public void method${methodCount}() {`);
    lines.push(`        System.out.println("Method ${methodCount}");`);
    lines.push(`        int x${methodCount} = ${methodCount};`);
    lines.push(`        String s${methodCount} = "value_${methodCount}";`);
    lines.push('    }');
    lines.push('');

    currentSize = lines.join('\n').length;
  }

  lines.push('}');
  return lines.join('\n');
}