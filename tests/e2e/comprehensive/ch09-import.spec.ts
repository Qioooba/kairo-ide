/**
 * Chapter 9 — Project Import Wizard, 3 steps (docs/COMPREHENSIVE_TEST_DOCUMENT.md).
 * Browser column: TC-IMP-001…008 (007 N/A), 011…016, 021…023, 031…034.
 *
 * Every case uses its own project copy under /tmp/kairo-w1b and registers it
 * as a backend workspace first (mirrors "user opened the folder"), so the
 * wizard's detect call is sandbox-authorized. Bindings are purged afterwards.
 */
import { expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  agentJson, cleanupTmp, importViaApi, kairoStatusEntry, makeCopy, openIdeAt,
  purgeCatalog, registerWorkspace, runCommand, startAgent, stopAgent,
  test, TMP_ROOT, trustAcceptButton,
} from './helpers-ch810';

test.describe.configure({ mode: 'serial' });

/** Open the IDE rooted at `dir` and bring up the import wizard. */
async function openWizard(page: import('@playwright/test').Page, dir?: string): Promise<void> {
  await openIdeAt(page, dir);
  // When the target dir already has an active project (e.g. TC-IMP-023
  // duplicate-root case), Welcome is auto-closed and the Welcome|Import
  // tab never appears — waiting for it would time out. Just wait for the
  // shell to settle instead.
  await page.waitForTimeout(1500);
  // If the Welcome tab is up, use its primary CTA; otherwise palette.
  const cta = page.locator('#kairo-welcome').getByTestId('welcome-import');
  if (await cta.count()) {
    try {
      await cta.waitFor({ state: 'visible', timeout: 8_000 });
      await cta.click();
      await page.getByTestId('wizard-title').waitFor({ timeout: 20_000 });
      return;
    } catch { /* Welcome not actually visible — fall through to palette */ }
  }
  await runCommand(page, 'Import Project');
  await page.getByTestId('wizard-title').waitFor({ timeout: 20_000 });
}

function trackDetect(page: import('@playwright/test').Page): () => number {
  let count = 0;
  page.on('request', r => {
    if (r.url().includes('/api/v1/projects/detect') && r.method() === 'POST') count++;
  });
  return () => count;
}

test.describe('ch09 import wizard', () => {

  test.beforeAll(async () => {
    await purgeCatalog();
  });

  test.afterAll(async () => {
    await purgeCatalog();
    await cleanupTmp();
  });

  test('TC-IMP-001: wizard opens at Step 1 with welcome tips (4)', async ({ page }) => {
    const dir = makeCopy('imp-001');
    await registerWorkspace(dir, 'imp-001');
    await openWizard(page, dir);
    // step indicator
    await expect(page.getByTestId('step-1')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('step-2')).not.toHaveAttribute('aria-current');
    await expect(page.getByTestId('step-3')).not.toHaveAttribute('aria-current');
    // welcome area + 4 tips
    await expect(page.getByTestId('welcome-tips')).toBeVisible();
    await expect(page.locator('[data-testid="welcome-tips"] li')).toHaveCount(4);
    await expect(page.getByTestId('path-input')).toBeVisible();
  });

  test('TC-IMP-002: folder picker fills the path input and scans into Step 2', async ({ page }) => {
    const dir = makeCopy('imp-002');
    await registerWorkspace(dir, 'imp-002');
    await openWizard(page, dir);
    await page.getByTestId('browse-btn').click();
    const dlg = page.locator('.dialogOverlay', { has: page.locator('.theia-FileDialog') });
    await dlg.waitFor({ state: 'visible', timeout: 15_000 });
    // pick the workspace root row (the folder itself)
    await dlg.locator('.theia-FileDialog .theia-TreeNode').first().click();
    await dlg.locator('.dialogControl button.main').click();
    // selection triggers an automatic scan → Step 2
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    await expect(page.getByTestId('input-project-name')).toHaveValue(/imp-002|^project$/);
    // go back for a clean state in later assertions of this spec file
    await page.getByTestId('back-to-select').click();
    await expect(page.getByTestId('step-content-1')).toBeVisible();
  });

  test('TC-IMP-003: typed path + Enter scans (detectProject) and auto-fills Step 2', async ({ page }) => {
    const dir = makeCopy('imp-003');
    await registerWorkspace(dir, 'imp-003');
    await openWizard(page, dir);
    const input = page.getByTestId('path-input');
    await input.fill(dir);
    await input.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    await expect(page.getByTestId('input-project-name')).toHaveValue('imp-003');
    await expect(page.getByTestId('select-build-tool')).toHaveValue('ant');
  });

  test('TC-IMP-004: empty path validation — message shown, no request sent', async ({ page }) => {
    const dir = makeCopy('imp-004');
    await registerWorkspace(dir, 'imp-004');
    await openWizard(page, dir);
    const detectCount = trackDetect(page);
    // button is disabled without input…
    await expect(page.getByTestId('scan-btn')).toBeDisabled();
    // …and Enter with empty input shows the inline hint instead of requesting
    await page.getByTestId('path-input').fill('');
    await page.getByTestId('path-input').press('Enter');
    await expect(page.locator('[data-testid="import-wizard"] [role="alert"], [data-testid="scan-error"]'))
      .toContainText(/enter.*path|输入路径|路径/i, { timeout: 5_000 });
    expect(detectCount()).toBe(0);
    await expect(page.getByTestId('step-content-1')).toBeVisible();
  });

  test('TC-IMP-005: non-existent path shows scan-error alert and stays on Step 1', async ({ page }) => {
    const dir = makeCopy('imp-005');
    await registerWorkspace(dir, 'imp-005');
    await openWizard(page, dir);
    // must be INSIDE an authorized workspace root, otherwise the sandbox
    // answers path_forbidden instead of the not-found branch
    await page.getByTestId('path-input').fill(path.join(dir, 'does-not-exist-xyz'));
    await page.getByTestId('scan-btn').click();
    const err = page.getByTestId('scan-error');
    await err.waitFor({ timeout: 20_000 });
    await expect(err).toHaveRole('alert');
    await expect(err).toContainText(/no such file|not exist|不存在|cannot find/i);
    await expect(page.getByTestId('step-content-1')).toBeVisible();
    await expect(page.getByTestId('step-content-2')).toHaveCount(0);
  });

  test('TC-IMP-006: unauthorized path returns path_forbidden and UI blocks it', async ({ page }) => {
    const dir = makeCopy('imp-006');
    await registerWorkspace(dir, 'imp-006');
    // ensure at least one authorized root exists so the sandbox enforces
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill('/Users/qi/.ssh');
    await page.getByTestId('scan-btn').click();
    const err = page.getByTestId('scan-error');
    await err.waitFor({ timeout: 20_000 });
    await expect(err).toContainText(/forbidden|authorized|越权|禁止|outside/i);
    await expect(page.getByTestId('step-content-1')).toBeVisible();
  });

  test('TC-IMP-008: Chinese + space path imports cleanly end-to-end', async ({ page }) => {
    const dir = makeCopy('测试 项目/cn-proj');
    await registerWorkspace(dir, 'cn-proj');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.getByTestId('scan-btn').click();
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    await expect(page.getByTestId('input-project-name')).toHaveValue('cn-proj');
    // finish the import to prove no mojibake downstream
    await page.getByTestId('import-project-btn').click();
    await page.getByTestId('step-content-3').waitFor({ timeout: 30_000 });
    await expect(page.getByTestId('ready-root')).toHaveText(new RegExp('测试 项目/cn-proj$'));
    await expect(page.getByTestId('ready-name')).toHaveText('cn-proj');
  });

  test('TC-IMP-011/012: legacy-sample auto-fill and confidence badge', async ({ page }) => {
    const dir = makeCopy('imp-legacy');
    await registerWorkspace(dir, 'imp-legacy');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });

    // TC-IMP-011 — every detected field lands where the document says.
    // The bundled legacy-sample keeps its java sources under the Maven
    // layout src/main/java, so that is the correct detected source dir.
    await expect(page.getByTestId('input-project-name')).toHaveValue('imp-legacy');
    await expect(page.getByTestId('input-source-dirs')).toHaveValue('src/main/java');
    await expect(page.getByTestId('input-web-root')).toHaveValue('WebRoot');
    await expect(page.getByTestId('input-lib-dirs')).toHaveValue('lib');
    await expect(page.getByTestId('input-build-script')).toHaveValue('build.xml');
    await expect(page.getByTestId('select-build-tool')).toHaveValue('ant');
    await expect(page.getByTestId('select-encoding')).toHaveValue('gbk');   // sample is GBK per doc
    await expect(page.getByTestId('select-source-version')).toHaveValue('1.6');
    await expect(page.getByTestId('select-target-version')).toHaveValue('1.6');
    await expect(page.getByTestId('input-output-dir')).toHaveValue('build/classes');
    await expect(page.getByTestId('input-context-path')).toHaveValue('/');
    // aria-labels exist alongside testids
    await expect(page.getByTestId('input-project-name')).toHaveAttribute('aria-label', /Project name|项目名称/);

    // TC-IMP-012 — Math.round(confidence*100)% badge (0.85 → 85%)
    await expect(page.locator('.kairo-confidence')).toContainText('85%');
  });

  test('TC-IMP-012b: warnings block renders when detection has warnings', async ({ page }) => {
    // bare directory: build.xml missing → detector emits a warning
    const dir = path.join(TMP_ROOT, 'imp-warn');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'WebRoot'), { recursive: true });
    await registerWorkspace(dir, 'imp-warn');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    const warnBlock = page.getByTestId('detection-warnings');
    await expect(warnBlock).toBeVisible();
    await expect(warnBlock.locator('li').first()).toContainText(/build\.xml|javac|源目录|source/i);
  });

  test('TC-IMP-013: encoding falls back to GBK when detection has no hints; utf8 alias normalized to utf-8', async ({ page }) => {
    // hint-less project → default fallback gbk (documented default)
    const dir = path.join(TMP_ROOT, 'imp-enc-fallback');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'A.java'), 'public class A {}\n');
    await registerWorkspace(dir, 'imp-enc-fallback');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    await expect(page.getByTestId('select-encoding')).toHaveValue('gbk');

    // alias half: normalizeEncodingId maps utf8→utf-8 (shipped bundle)
    const bundle = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '..', 'apps', 'browser', 'lib', 'frontend', 'bundle.js'), 'utf8',
    );
    expect(bundle).toMatch(/case\s+"utf8":\s*return\s+"utf-8"/);
  });

  test('TC-IMP-014: empty project name blocks import with inline error, no request', async ({ page }) => {
    const dir = makeCopy('imp-014');
    await registerWorkspace(dir, 'imp-014');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });

    let importCalls = 0;
    page.on('request', r => {
      if (r.url().includes('/api/v1/projects/import') && r.method() === 'POST') importCalls++;
    });

    await page.getByTestId('input-project-name').fill('');
    await page.getByTestId('import-project-btn').click();
    await expect(page.getByTestId('import-error')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('import-error')).toContainText(/name|required|必填|名称/i);
    expect(importCalls).toBe(0);
    await expect(page.getByTestId('step-content-2')).toBeVisible();
  });

  test('TC-IMP-015: sourceDirs comma parsing trims and filters empties', async ({ page }) => {
    const dir = makeCopy('imp-015');
    await registerWorkspace(dir, 'imp-015');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });

    const payloadPromise = new Promise<any>(resolve => {
      page.on('request', r => {
        if (r.url().includes('/api/v1/projects/import') && r.method() === 'POST') {
          resolve(r.postDataJSON()?.payload ?? r.postDataJSON());
        }
      });
    });
    await page.getByTestId('input-source-dirs').fill('src, test ,');
    await page.getByTestId('import-project-btn').click();
    await page.getByTestId('step-content-3').waitFor({ timeout: 30_000 });
    const payload = await payloadPromise;
    expect(payload.sourceDirs).toEqual(['src', 'test']);
  });

  test('TC-IMP-016: Back returns to Step 1 keeping entered content', async ({ page }) => {
    const dir = makeCopy('imp-016');
    await registerWorkspace(dir, 'imp-016');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    await page.getByTestId('input-project-name').fill('renamed-proj');
    await page.getByTestId('back-to-select').click();
    await expect(page.getByTestId('step-content-1')).toBeVisible();
    await expect(page.getByTestId('path-input')).toHaveValue(dir); // content preserved
    // forward again still offers the form (focus the input first — after
    // Back() the field is filled but not focused, so Enter alone is a no-op)
    await page.getByTestId('path-input').click();
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
  });

  test('TC-IMP-021: happy-path import issues openWorkspace→import→Step3 and activates project', async ({ page }) => {
    const dir = makeCopy('imp-021');
    await registerWorkspace(dir, 'imp-021');
    await openWizard(page, dir);

    const calls: string[] = [];
    page.on('request', r => {
      const u = r.url();
      if (!u.includes('/api/v1/')) return;
      if (r.method() === 'POST' && u.endsWith('/workspaces')) calls.push('openWorkspace');
      if (r.method() === 'POST' && u.endsWith('/projects/import')) calls.push('import');
    });

    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    await page.getByTestId('import-project-btn').click();
    await page.getByTestId('step-content-3').waitFor({ timeout: 40_000 });

    // strict order: openWorkspace before projects/import
    const iw = calls.indexOf('openWorkspace');
    const im = calls.indexOf('import');
    expect(iw).toBeGreaterThanOrEqual(0);
    expect(im).toBeGreaterThan(iw);

    // setProject broadcast → status bar reflects the new active project
    const sb = kairoStatusEntry(page, 'project');
    await expect(sb).toContainText('imp-021', { timeout: 45_000 });
  });

  test('TC-IMP-031/033: summary rows (name/root/encoding) and Close has no side effects', async ({ page }) => {
    const dir = makeCopy('imp-031');
    await registerWorkspace(dir, 'imp-031');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    await page.getByTestId('select-encoding').selectOption('gbk');
    await page.getByTestId('import-project-btn').click();
    await page.getByTestId('step-content-3').waitFor({ timeout: 40_000 });

    // three-row summary matches what was filled
    // (backend normalizes /tmp → /private/tmp on macOS — compare realpaths)
    await expect(page.getByTestId('ready-name')).toHaveText('imp-031');
    await expect(page.getByTestId('ready-root')).toHaveText(fs.realpathSync(dir));
    await expect(page.getByTestId('ready-encoding')).toHaveText('gbk');

    // Close closes the wizard tab without touching workspace/project state
    await page.getByTestId('ready-close-btn').click();
    await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: /Import Project/i })).toHaveCount(0, { timeout: 15_000 });
  });

  test('TC-IMP-032: 「打开项目文件夹」 opens file:// workspace, tree renders, Welcome closed', async ({ page }) => {
    const dir = makeCopy('imp-032');
    await registerWorkspace(dir, 'imp-032');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    await page.getByTestId('import-project-btn').click();
    await page.getByTestId('step-content-3').waitFor({ timeout: 40_000 });

    await page.getByTestId('open-project-btn').click();
    try {
      const trust = trustAcceptButton(page);
      await trust.click({ timeout: 10_000 });
    } catch { /* none */ }
    await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
    // file:// URI opened → URL hash points into the project folder
    await page.waitForTimeout(4000);
    expect(new URL(page.url()).hash).toContain('imp-032');
    // navigator renders the project
    await expect(page.locator('.theia-TreeNodeSegment', { hasText: 'build.xml' }).first()).toBeVisible({ timeout: 60_000 });
    // Welcome stays closed
    await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: /Welcome/i })).toHaveCount(0, { timeout: 20_000 });
  });

  test('TC-IMP-022: agent offline during import shows import-error banner and leaves no orphan workspace', async ({ page }) => {
    const dir = makeCopy('imp-022');
    await registerWorkspace(dir, 'imp-022');
    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });

    await stopAgent();
    try {
      await page.getByTestId('import-project-btn').click();
      const err = page.getByTestId('import-error');
      await err.waitFor({ timeout: 30_000 });
      await expect(err).toHaveRole('alert');
      // document requires the errorPrefix wrapper ("Error: {message}")
      await expect(err).toContainText(/error|错误/i);
      // stuck on step 2, not advanced
      await expect(page.getByTestId('step-content-2')).toBeVisible();
      await expect(page.getByTestId('step-content-3')).toHaveCount(0);
    } finally {
      await startAgent();
    }
    // backend kept no half-created workspace for this root beyond setup binding
    const workspaces = await agentJson<{ id: string; rootPath: string }[]>('GET', '/workspaces');
    const matching = workspaces.filter(w => w.rootPath.replace(/\/+$/, '') === dir.replace(/\/+$/, ''));
    expect(matching.length).toBeLessThanOrEqual(1); // only the pre-registered one, never a duplicate
  });

  test('TC-IMP-023: duplicate root re-import resolves existing binding (conflict→match), reaches Step 3', async ({ page }) => {
    const dir = makeCopy('imp-023');
    const ws = await registerWorkspace(dir, 'imp-023');
    // first import happens through the API (as if done earlier)
    await importViaApi(ws.id, dir, 'imp-023');

    await openWizard(page, dir);
    await page.getByTestId('path-input').fill(dir);
    await page.keyboard.press('Enter');
    await page.getByTestId('step-content-2').waitFor({ timeout: 25_000 });
    await page.getByTestId('import-project-btn').click();
    // backend conflicts on the second POST; the wizard must match the
    // existing project binding and continue to Step 3 instead of dead-ending
    await page.getByTestId('step-content-3').waitFor({ timeout: 40_000 });
    await expect(page.getByTestId('ready-name')).toHaveText('imp-023');
  });
});
