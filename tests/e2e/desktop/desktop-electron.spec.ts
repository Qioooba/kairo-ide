import { _electron as electron, ElectronApplication, expect, Page, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const desktopRoot = path.join(repoRoot, 'apps', 'desktop');
const mainEntry = path.join(desktopRoot, 'lib', 'main.js');
const agentPath = path.join(repoRoot, 'runtime-agent', 'bin', 'kairo-runtime.exe');

let app: ElectronApplication;
let page: Page;
let testRoot: string;

test.beforeAll(async () => {
  expect(fs.existsSync(mainEntry), `desktop main is missing: ${mainEntry}`).toBe(true);
  expect(fs.existsSync(agentPath), `runtime agent is missing: ${agentPath}`).toBe(true);

  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-desktop-e2e-'));
  const workspace = path.join(testRoot, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });

  app = await electron.launch({
    args: [mainEntry],
    cwd: desktopRoot,
    env: {
      ...process.env,
      KAIRO_AGENT_PATH: agentPath,
      KAIRO_DATA_DIR: path.join(testRoot, 'agent-data'),
      THEIA_CONFIG_DIR: path.join(testRoot, 'theia-config'),
      KAIRO_OPEN_FOLDER: workspace,
      KAIRO_DESKTOP_LOG_FILE: path.join(testRoot, 'desktop-main.log'),
      KAIRO_LOCAL_SECRET: `desktop-e2e-${process.pid}-${Date.now()}`,
      KAIRO_NO_DEVTOOLS: '1',
      KAIRO_KEEP_REUSED_AGENT: '0',
    },
    timeout: 120_000,
  });

  page = await app.firstWindow({ timeout: 120_000 });
  await page.locator('#theia-app-shell').waitFor({ state: 'visible', timeout: 120_000 });
});

test.afterAll(async () => {
  if (app) {
    await app.close().catch(() => undefined);
  }
  if (testRoot) {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

test('desktop launches the real Electron workbench on a loopback backend', async () => {
  expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?/);
  await expect(page).toHaveTitle(/Kairo IDE/i);
  await expect(page.locator('#theia-statusBar')).toBeVisible();
});

test('BrowserWindow enforces the desktop security boundary', async () => {
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map(window => {
      const preferences = window.webContents.getLastWebPreferences();
      const [minWidth, minHeight] = window.getMinimumSize();
      return {
        contextIsolation: preferences.contextIsolation,
        sandbox: preferences.sandbox,
        nodeIntegration: preferences.nodeIntegration,
        minWidth,
        minHeight,
      };
    }),
  );
  expect(windows).toHaveLength(1);
  expect(windows[0]).toMatchObject({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  });
  expect(windows[0].minWidth).toBeGreaterThanOrEqual(960);
  expect(windows[0].minHeight).toBeGreaterThanOrEqual(600);
});

test('preload exposes only the scoped Kairo API and connects to the spawned agent', async () => {
  const result = await page.evaluate(async () => {
    const host = window as typeof window & {
      __kairo?: { agentBaseUrl: string; getSecret: () => string; productVersion: string };
      require?: unknown;
      process?: unknown;
    };
    if (!host.__kairo) {
      throw new Error('window.__kairo is missing');
    }
    const response = await fetch(`${host.__kairo.agentBaseUrl}/api/v1/health`, {
      headers: { 'X-Kairo-Secret': host.__kairo.getSecret() },
    });
    return {
      status: response.status,
      agentBaseUrl: host.__kairo.agentBaseUrl,
      productVersion: host.__kairo.productVersion,
      hasRequire: typeof host.require !== 'undefined',
      hasProcess: typeof host.process !== 'undefined',
    };
  });

  expect(result.status).toBe(200);
  expect(result.agentBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(result.productVersion).toBeTruthy();
  expect(result.hasRequire).toBe(false);
  expect(result.hasProcess).toBe(false);
});

test('native desktop menu contains the expected product commands', async () => {
  const labels = await app.evaluate(({ Menu }) => {
    const visit = (items: Electron.MenuItem[], out: string[]): void => {
      for (const item of items) {
        if (item.label) out.push(item.label.replace(/&/g, ''));
        if (item.submenu) visit(item.submenu.items, out);
      }
    };
    const out: string[] = [];
    const menu = Menu.getApplicationMenu();
    if (menu) visit(menu.items, out);
    return out;
  });

  expect(labels).toEqual(expect.arrayContaining([
    'File',
    'Edit',
    'View',
    'Help',
    'Open Folder...',
    'About Kairo IDE',
  ]));
});
