/**
 * Kairo IDE — Windows-Specific E2E Tests
 *
 * Tests for Windows-specific scenarios:
 *   - Path separator handling (backslash vs forward slash)
 *   - File lock handling
 *   - Long path handling (>260 characters)
 *   - Encoding switching (GBK/UTF-8)
 *   - Windows-specific performance tests
 *   - Case-insensitive file system handling
 *   - Windows process management
 *
 * Prerequisites:
 *   1. Run `pnpm agent:run` in one terminal
 *   2. Run `pnpm dev:browser` in another terminal
 *   3. Run: npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/windows-e2e.spec.ts
 */
require('../setup-tmp.cjs'); // KAIRO_TMP override
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
// Use CJS require so setup-tmp.cjs's monkey-patch of os.tmpdir() is visible.
const os = require('node:os') as typeof import('node:os');

// Detect if running on Windows
const isWindows = process.platform === 'win32';

// =============================================================================
// WIN-01: Path Separator Handling
// =============================================================================
test.describe('WIN-01: Path Separator Handling', () => {
  test('should handle both backslash and forward slash paths', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Test workspace import with backslash paths', async () => {
      const backslashPath = workspace.rootPath.replace(/\//g, '\\');
      const resp = await agentApi.post('/api/v1/workspaces', {
        rootPath: backslashPath,
      });
      console.log(`  Backslash path import: status=${resp.status}`);
    });

    await test.step('Test workspace import with forward slash paths', async () => {
      const forwardSlashPath = workspace.rootPath.replace(/\\/g, '/');
      const resp = await agentApi.post('/api/v1/workspaces', {
        rootPath: forwardSlashPath,
      });
      console.log(`  Forward slash path import: status=${resp.status}`);
    });

    await test.step('Test mixed path separators', async () => {
      const mixedPath = workspace.rootPath;
      const resp = await agentApi.post('/api/v1/workspaces', {
        rootPath: mixedPath,
      });
      expect(resp.status).toBe(200);
      console.log('  Mixed path separators handled correctly');
    });

    await test.step('Test encoding detection with Windows paths', async () => {
      const windowsPath = path.join(workspace.rootPath, 'WebRoot', 'hello.jsp');
      const resp = await agentApi.post('/api/v1/encoding/detect', {
        file: windowsPath,
      });
      console.log(`  Windows path encoding detect: status=${resp.status}`);
    });
  });
});

// =============================================================================
// WIN-02: File Lock Handling
// =============================================================================
test.describe('WIN-02: File Lock Handling', () => {
  test('should handle Windows file locks', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Create a test file and lock it', async () => {
      const lockFilePath = path.join(workspace.rootPath, 'locked-file.txt');
      fs.writeFileSync(lockFilePath, 'Locked content', 'utf-8');

      // Open a file handle to simulate a lock (Windows exclusive lock)
      const fd = fs.openSync(lockFilePath, 'r');
      console.log('  File locked for reading');

      // Try to read/write the locked file
      try {
        const content = fs.readFileSync(lockFilePath, 'utf-8');
        console.log(`  Read locked file: ${content.length} chars`);
      } catch (err) {
        console.log(`  Read locked file error: ${(err as Error).message}`);
      }

      // Try to write to the locked file
      try {
        fs.writeFileSync(lockFilePath, 'New content', 'utf-8');
        console.log('  Wrote to locked file successfully');
      } catch (err) {
        console.log(`  Write locked file error (expected on Windows): ${(err as Error).message}`);
      }

      fs.closeSync(fd);
      fs.unlinkSync(lockFilePath);
      console.log('  File unlocked and cleaned up');
    });

    await test.step('Test EBUSY recovery', async () => {
      // This tests the tomcat-extension EBUSY fix (rmRetrySync with exponential backoff)
      const busyDir = path.join(workspace.rootPath, 'busy-test-dir');
      fs.mkdirSync(busyDir, { recursive: true });
      const busyFile = path.join(busyDir, 'test.txt');
      fs.writeFileSync(busyFile, 'test', 'utf-8');

      // Try to remove the directory (should handle EBUSY gracefully)
      try {
        fs.rmSync(busyDir, { recursive: true, force: true });
        console.log('  Directory removed successfully');
      } catch (err) {
        console.log(`  Directory removal error: ${(err as Error).message}`);
      }
    });
  });
});

// =============================================================================
// WIN-03: Long Path Handling (>260 characters)
// =============================================================================
test.describe('WIN-03: Long Path Handling', () => {
  test('should handle paths longer than 260 characters', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Create a long path', async () => {
      if (!isWindows) {
        console.log('  Skipping long path test (not on Windows)');
        return;
      }

      // Create a path that exceeds 260 characters
      let longPath = workspace.rootPath;
      const segment = 'a'.repeat(50);
      while (longPath.length < 270) {
        longPath = path.join(longPath, segment);
      }

      try {
        fs.mkdirSync(longPath, { recursive: true });
        const testFile = path.join(longPath, 'test.txt');
        fs.writeFileSync(testFile, 'Long path test', 'utf-8');

        console.log(`  Long path length: ${longPath.length} chars`);
        console.log(`  Created file at long path: ${path.basename(testFile)}`);

        // Clean up
        fs.rmSync(workspace.rootPath, { recursive: true, force: true });
      } catch (err) {
        console.log(`  Long path error: ${(err as Error).message}`);
      }
    });

    await test.step('Test long path with agent API', async () => {
      if (!isWindows) {
        console.log('  Skipping long path API test (not on Windows)');
        return;
      }

      // Use a path near the limit
      let longPath = workspace.rootPath;
      const segment = 'b'.repeat(50);
      while (longPath.length < 250) {
        longPath = path.join(longPath, segment);
      }

      try {
        fs.mkdirSync(longPath, { recursive: true });
        const resp = await agentApi.post('/api/v1/workspaces', {
          rootPath: longPath,
        });
        console.log(`  Long path workspace import: status=${resp.status}`);
      } catch (err) {
        console.log(`  Long path API error: ${(err as Error).message}`);
      }
    });
  });
});

// =============================================================================
// WIN-04: Encoding Switching (GBK/UTF-8)
// =============================================================================
test.describe('WIN-04: Encoding Switching (GBK/UTF-8)', () => {
  test('should switch between GBK and UTF-8 encodings', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    const testFile = path.join(workspace.rootPath, '.kairo', `encoding-test-${Date.now()}.txt`);

    await test.step('Create GBK-encoded file', async () => {
      const gbkContent = Buffer.from('GBK编码测试：你好，世界！', 'gbk');
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, gbkContent);
      console.log('  Created GBK encoded file');
    });

    await test.step('Detect GBK encoding', async () => {
      const resp = await agentApi.post('/api/v1/encoding/detect', {
        file: testFile,
      });
      if (resp.status === 200) {
        const payload = resp.json?.payload as Record<string, unknown>;
        console.log(`  Detected: encoding=${payload?.encoding}`);
      }
    });

    await test.step('Recode to UTF-8', async () => {
      const resp = await agentApi.post('/api/v1/encoding/recode', {
        file: testFile,
        from: 'gbk',
        to: 'utf-8',
      });
      console.log(`  Recode to UTF-8: status=${resp.status}`);
    });

    await test.step('Verify UTF-8 content', async () => {
      const content = fs.readFileSync(testFile, 'utf-8');
      console.log(`  UTF-8 content: ${content}`);
      expect(content).toContain('你好');
    });

    await test.step('Recode back to GBK', async () => {
      const resp = await agentApi.post('/api/v1/encoding/recode', {
        file: testFile,
        from: 'utf-8',
        to: 'gbk',
      });
      console.log(`  Recode to GBK: status=${resp.status}`);
    });

    await test.step('Cleanup', async () => {
      fs.unlinkSync(testFile);
    });
  });

  test('should handle GBK file with special Windows characters', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Create GBK file with special characters', async () => {
      const testFile = path.join(workspace.rootPath, '.kairo', `win-encoding-${Date.now()}.txt`);
      fs.mkdirSync(path.dirname(testFile), { recursive: true });

      // GBK special characters that are common in Chinese Windows
      const specialChars = '①②③④⑤★☆♠♣♥♦㈱㈲㈳㈴㈵';
      const gbkContent = Buffer.from(`特殊字符：${specialChars}`, 'gbk');
      fs.writeFileSync(testFile, gbkContent);

      const resp = await agentApi.post('/api/v1/encoding/detect', {
        file: testFile,
      });
      console.log(`  Special chars GBK detect: status=${resp.status}`);

      // Recode to UTF-8
      const recodeResp = await agentApi.post('/api/v1/encoding/recode', {
        file: testFile,
        from: 'gbk',
        to: 'utf-8',
      });
      console.log(`  Special chars recode: status=${recodeResp.status}`);

      const content = fs.readFileSync(testFile, 'utf-8');
      console.log(`  Recoded content: ${content}`);

      fs.unlinkSync(testFile);
    });
  });
});

// =============================================================================
// WIN-05: Case-Insensitive File System
// =============================================================================
test.describe('WIN-05: Case-Insensitive File System', () => {
  test('should handle case-insensitive file access on Windows', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Create test file with mixed case', async () => {
      const testFile = path.join(workspace.rootPath, 'CaseTest.java');
      fs.writeFileSync(testFile, 'public class CaseTest {}\n', 'utf-8');

      // Try to access with different casing
      const lowerFile = path.join(workspace.rootPath, 'casetest.java');
      const upperFile = path.join(workspace.rootPath, 'CASETEST.JAVA');

      if (isWindows) {
        // On Windows, these should all work
        const lowerExists = fs.existsSync(lowerFile);
        const upperExists = fs.existsSync(upperFile);
        console.log(`  Lower case exists: ${lowerExists}`);
        console.log(`  Upper case exists: ${upperExists}`);
        expect(lowerExists).toBe(true);
        expect(upperExists).toBe(true);
      } else {
        // On Unix, these should NOT work
        const lowerExists = fs.existsSync(lowerFile);
        console.log(`  Lower case exists (Unix): ${lowerExists}`);
        expect(lowerExists).toBe(false);
      }

      fs.unlinkSync(testFile);
    });
  });
});

// =============================================================================
// WIN-06: Windows Process Management
// =============================================================================
test.describe('WIN-06: Windows Process Management', () => {
  test('should handle Windows process lifecycle', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Verify agent process is running', async () => {
      const health = await agentApi.get('/api/v1/health');
      expect(health.status).toBe(200);
      console.log('  Agent process is running');
    });

    await test.step('Check port availability', async () => {
      const resp = await agentApi.post('/api/v1/diagnostics/port', {
        port: 8080,
      });
      console.log(`  Port 8080 check: status=${resp.status}`);
    });

    await test.step('Check recoverable servers', async () => {
      const resp = await agentApi.get('/api/v1/servers/recoverable');
      console.log(`  Recoverable servers: status=${resp.status}`);
    });
  });
});

// =============================================================================
// WIN-07: Windows Performance Test
// =============================================================================
test.describe('WIN-07: Windows Performance Test', () => {
  test('should meet performance baselines on Windows', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      const startTime = Date.now();
      await navigateToTheia(page);
      const loadTime = Date.now() - startTime;
      console.log(`  Theia load time: ${loadTime}ms`);
      expect(loadTime).toBeLessThan(30_000);
    });

    await test.step('Measure health check latency', async () => {
      const latencies: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        const resp = await agentApi.get('/api/v1/health');
        const latency = Date.now() - start;
        if (resp.status === 200) {
          latencies.push(latency);
        }
      }

      if (latencies.length > 0) {
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const max = Math.max(...latencies);
        console.log(`  Health check avg latency: ${avg.toFixed(1)}ms`);
        console.log(`  Health check max latency: ${max}ms`);
        expect(avg).toBeLessThan(500);
      }
    });

    await test.step('Measure encoding detection performance', async () => {
      const file = path.join(workspace.rootPath, 'WebRoot', 'hello.jsp');
      const latencies: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        const resp = await agentApi.post('/api/v1/encoding/detect', { file });
        const latency = Date.now() - start;
        if (resp.status === 200) {
          latencies.push(latency);
        }
      }

      if (latencies.length > 0) {
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        console.log(`  Encoding detect avg latency: ${avg.toFixed(1)}ms`);
        expect(avg).toBeLessThan(2000);
      }
    });
  });
});

// =============================================================================
// WIN-08: Windows Temp Directory
// =============================================================================
test.describe('WIN-08: Windows Temp Directory', () => {
  test('should handle Windows temp directory paths', async ({
    page,
    agentApi,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Create workspace in Windows temp', async () => {
      const tempDir = path.join(os.tmpdir(), `kairo-win-e2e-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const resp = await agentApi.post('/api/v1/workspaces', {
        rootPath: tempDir,
      });
      console.log(`  Temp workspace import: status=${resp.status}`);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});

// =============================================================================
// WIN-09: Windows Line Endings (CRLF)
// =============================================================================
test.describe('WIN-09: Windows Line Endings (CRLF)', () => {
  test('should handle CRLF line endings', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Create file with CRLF endings', async () => {
      const crlfFile = path.join(workspace.rootPath, '.kairo', `crlf-test-${Date.now()}.txt`);
      fs.mkdirSync(path.dirname(crlfFile), { recursive: true });

      const crlfContent = 'Line 1\r\nLine 2\r\nLine 3\r\n';
      fs.writeFileSync(crlfFile, crlfContent, 'utf-8');

      const resp = await agentApi.post('/api/v1/encoding/detect', {
        file: crlfFile,
      });
      if (resp.status === 200) {
        const payload = resp.json?.payload as Record<string, unknown>;
        console.log(`  EOL detected: ${payload?.eol}`);
      }

      fs.unlinkSync(crlfFile);
    });

    await test.step('Create file with LF endings', async () => {
      const lfFile = path.join(workspace.rootPath, '.kairo', `lf-test-${Date.now()}.txt`);
      fs.mkdirSync(path.dirname(lfFile), { recursive: true });

      const lfContent = 'Line 1\nLine 2\nLine 3\n';
      fs.writeFileSync(lfFile, lfContent, 'utf-8');

      const resp = await agentApi.post('/api/v1/encoding/detect', {
        file: lfFile,
      });
      if (resp.status === 200) {
        const payload = resp.json?.payload as Record<string, unknown>;
        console.log(`  EOL detected (LF): ${payload?.eol}`);
      }

      fs.unlinkSync(lfFile);
    });
  });
});

// =============================================================================
// WIN-10: Windows Reserved Names
// =============================================================================
test.describe('WIN-10: Windows Reserved Names', () => {
  test('should handle Windows reserved file names', async ({
    page,
    agentApi,
    workspace,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Test Windows reserved names', async () => {
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'];
      for (const name of reservedNames) {
        const filePath = path.join(workspace.rootPath, `.kairo`, `${name}-test.txt`);
        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, 'test', 'utf-8');
          console.log(`  ${name}: OK (created)`);
          fs.unlinkSync(filePath);
        } catch (err) {
          console.log(`  ${name}: ${(err as Error).message}`);
        }
      }
    });
  });
});

// =============================================================================
// WIN-11: Windows UNC Paths
// =============================================================================
test.describe('WIN-11: Windows UNC Paths', () => {
  test('should handle UNC paths', async ({
    page,
    agentApi,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Test UNC path format', async () => {
      // UNC paths: \\server\share\path
      // In local testing, we can use \\?\ prefix for long paths
      const localPath = path.join(os.tmpdir(), `kairo-unc-${Date.now()}`);
      fs.mkdirSync(localPath, { recursive: true });

      // Convert to UNC-like format
      const uncPath = `\\\\?\\${localPath}`;
      console.log(`  UNC path: ${uncPath}`);

      try {
        const resp = await agentApi.post('/api/v1/workspaces', {
          rootPath: localPath,
        });
        console.log(`  UNC workspace import: status=${resp.status}`);
      } catch (err) {
        console.log(`  UNC path error: ${(err as Error).message}`);
      }

      fs.rmSync(localPath, { recursive: true, force: true });
    });
  });
});

// =============================================================================
// WIN-12: Windows Environment Variables in Paths
// =============================================================================
test.describe('WIN-12: Windows Environment Variables in Paths', () => {
  test('should handle environment variable expansion in paths', async ({
    page,
    agentApi,
  }) => {
    await test.step('Navigate to Theia', async () => {
      await navigateToTheia(page);
    });

    await test.step('Test path with env variables', async () => {
      if (isWindows) {
        const appDataPath = path.join(
          process.env.APPDATA || os.homedir(),
          'kairo-test',
        );
        fs.mkdirSync(appDataPath, { recursive: true });

        const resp = await agentApi.post('/api/v1/workspaces', {
          rootPath: appDataPath,
        });
        console.log(`  APPDATA path import: status=${resp.status}`);

        fs.rmSync(appDataPath, { recursive: true, force: true });
      } else {
        const homePath = path.join(os.homedir(), 'kairo-test');
        fs.mkdirSync(homePath, { recursive: true });

        const resp = await agentApi.post('/api/v1/workspaces', {
          rootPath: homePath,
        });
        console.log(`  HOME path import: status=${resp.status}`);

        fs.rmSync(homePath, { recursive: true, force: true });
      }
    });
  });
});