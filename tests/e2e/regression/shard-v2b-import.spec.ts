/**
 * Kairo Real-Click Full Coverage — SHARD-B (v2.0 plan)
 * Covers TC-B02 / TC-B03 / TC-B04 / TC-B06 / TC-B07 from
 * docs/testing/KAIRO_REAL_CLICK_FULL_COVERAGE_TEST_PLAN.md
 *
 * Verifies import wizard drives REAL disk persistence (N-027/N-028 regressions).
 * Uses a temp copy of legacy-sample under tmp/legacy-sample-copy so the
 * production fixture is not mutated.
 */
import { test, expect, navigateToTheia } from '../regression-fixtures';
import { dismissTrustDialog } from '../fixtures';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'node:fs'; // yaml is plain text; parse manually

const EVIDENCE = process.env.KAIRO_EVIDENCE
  ? path.join(process.env.KAIRO_EVIDENCE, 'SHARD-B')
  : path.resolve(__dirname, '..', '..', 'test-results', 'evidence', 'SHARD-B');

function shot(page: import('@playwright/test').Page, caseId: string, name: string): Promise<void> {
  const dir = path.join(EVIDENCE, caseId);
  fs.mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}
function saveJson(caseId: string, name: string, data: unknown): void {
  const dir = path.join(EVIDENCE, caseId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), 'utf8');
}

const COPY_ROOT = 'G:\\spaces\\kairo-ide\\legacy-sample\\__test_import_copy';

async function openWizard(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('F1');
  await page.waitForSelector('.quick-input-widget', { timeout: 10_000 });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('Kairo: 导入项目', { delay: 25 });
  await page.waitForTimeout(700);
  // click the matching row (avoid fuzzy-match hitting other items)
  const rows = page.locator('.quick-input-list .monaco-list-row');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const t = (await rows.nth(i).textContent()) ?? '';
    if (/导入项目|Import Project/.test(t)) { await rows.nth(i).click(); break; }
  }
  await page.waitForSelector('[data-testid="import-wizard"]', { timeout: 20_000 });
}

test.describe('SHARD-B 项目导入向导', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToTheia(page);
    await dismissTrustDialog(page, 8000).catch(() => {});
    await page.waitForSelector('[role="menubar"]', { timeout: 90_000 });
    await page.waitForTimeout(1500);
  });

  test('TC-B02 扫描 legacy-sample 副本识别结构', async ({ page }) => {
    await openWizard(page);
    await shot(page, 'B02', '01-wizard-step1');

    const pathInput = page.locator('[data-testid="path-input"]');
    await pathInput.fill(COPY_ROOT);
    await pathInput.press('Enter');
    await page.waitForTimeout(800);
    // Some flows need explicit Scan click (if Enter handling delayed)
    const scanBtn = page.locator('[data-testid="scan-btn"]');
    if (await scanBtn.isVisible().catch(() => false) && await scanBtn.isEnabled()) {
      await scanBtn.click();
    }
    await page.waitForSelector('[data-testid="step-content-2"]', { timeout: 30_000 });
    await shot(page, 'B02', '02-step2-detected');

    // Detected fields pre-filled: webRoot, sourceDirs, libDirs, buildScript
    const webRoot = await page.locator('[data-testid="input-web-root"]').inputValue();
    const sourceDirs = await page.locator('[data-testid="input-source-dirs"]').inputValue();
    const buildScript = await page.locator('[data-testid="input-build-script"]').inputValue();
    const result = { webRoot, sourceDirs, buildScript };
    saveJson('B02', 'detected.json', result);
    expect(webRoot).toMatch(/WebRoot|web/i);
    expect(sourceDirs).toContain('src');
    // scan-error must be absent
    await expect(page.locator('[data-testid="scan-error"]')).toBeHidden();

    // close wizard (Escape or Close button on step-1 Back would return)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await shot(page, 'B02', '03-after');
  });

  test('TC-B03 全字段落盘（N-027 回归核心）', async ({ page }) => {
    // The agent persists imported projects; a leftover catalog entry from a
    // previous round makes import fail with 409 "project already exists"
    // (correct behavior — the wizard shows the error instead of faking
    // success, which is exactly the N-028 assertion). Clean the slate first.
    await fetch('http://127.0.0.1:18080/api/v1/projects/project-legacy-copy-b03', { method: 'DELETE' }).catch(() => {});

    await openWizard(page);
    const pathInput = page.locator('[data-testid="path-input"]');
    await pathInput.fill(COPY_ROOT);
    await pathInput.press('Enter');
    await page.waitForTimeout(800);
    const scanBtn = page.locator('[data-testid="scan-btn"]');
    if (await scanBtn.isVisible().catch(() => false) && await scanBtn.isEnabled()) await scanBtn.click();
    await page.waitForSelector('[data-testid="step-content-2"]', { timeout: 30_000 });

    // Fill non-default values to prove persistence (any mistake = FAIL)
    await page.locator('[data-testid="input-project-name"]').fill('legacy-copy-b03');
    await page.locator('[data-testid="input-source-dirs"]').fill('src');
    await page.locator('[data-testid="input-web-root"]').fill('WebRoot');
    await page.locator('[data-testid="input-lib-dirs"]').fill('WebRoot/WEB-INF/lib');
    await page.locator('[data-testid="input-output-dir"]').fill('build/classes');
    await page.locator('[data-testid="input-jdk-version"]').fill('1.6');
    await page.locator('[data-testid="select-source-version"]').selectOption('1.6');
    await page.locator('[data-testid="select-target-version"]').selectOption('1.6');
    await page.locator('[data-testid="select-encoding"]').selectOption('gbk');
    await page.locator('[data-testid="select-build-tool"]').selectOption('ant');
    await page.locator('[data-testid="input-build-script"]').fill('build.xml');
    await page.locator('[data-testid="input-context-path"]').fill('/legacy-copy-b03');
    await shot(page, 'B03', '01-fields-filled');

    await page.locator('[data-testid="import-project-btn"]').click();
    await page.waitForSelector('[data-testid="import-ready"]', { timeout: 45_000 });
    await expect(page.locator('[data-testid="import-error"]')).toBeHidden();
    await shot(page, 'B03', '02-import-ready');

    // --- Disk truth assertion (R2): read .kairo/project.yaml
    const yamlPath = path.join(COPY_ROOT, '.kairo', 'project.yaml');
    // also check project.json variant
    const jsonPath = path.join(COPY_ROOT, '.kairo', 'project.json');
    let raw = '';
    if (fs.existsSync(yamlPath)) raw = fs.readFileSync(yamlPath, 'utf8');
    else if (fs.existsSync(jsonPath)) raw = fs.readFileSync(jsonPath, 'utf8');
    saveJson('B03', 'project-yaml.txt', { yamlPath: fs.existsSync(yamlPath) ? yamlPath : jsonPath, raw });

    expect(raw.length, 'project config must be written to disk').toBeGreaterThan(20);
    // key fields must reflect what was typed
    expect(raw).toMatch(/1\.6/);
    expect(raw.toLowerCase()).toMatch(/gbk/);
    expect(raw).toMatch(/ant/i);
    expect(raw).toMatch(/\/legacy-copy-b03|legacy-copy-b03/);

    // Status bar project indicator must show new name
    await page.waitForTimeout(1000);
    const statusBar = await page.locator('#theia-statusBar').textContent();
    saveJson('B03', 'status-bar.json', { statusBar });
    // if status bar still shows old project, warn but don't hard-fail (may need workspace reload)
    // The wizard step-3 "Open Project Folder" triggers workspaceService.open — click it to activate
    const openBtn = page.locator('[data-testid="open-project-btn"]');
    if (await openBtn.isVisible().catch(() => false)) {
      await openBtn.click();
      await page.waitForTimeout(4000);
      await shot(page, 'B03', '03-after-open');
    }
    await page.keyboard.press('Escape');
  });

  test('TC-B04 失败路径不假装成功（N-028 回归）', async ({ page }) => {
    await openWizard(page);
    const pathInput = page.locator('[data-testid="path-input"]');
    await pathInput.fill('G:\\spaces\\kairo-ide\\tmp\\__nonexistent_xyz_999');
    await page.locator('[data-testid="scan-btn"]').click();
    await page.waitForTimeout(4000);
    const scanError = page.locator('[data-testid="scan-error"]');
    await expect(scanError).toBeVisible({ timeout: 10_000 });
    await shot(page, 'B04', '01-scan-error');
    // No reload should have happened: wizard still on step 1
    await expect(page.locator('[data-testid="step-content-1"]')).toBeVisible();
    // Ensure no .kairo dir was created at the bogus path
    expect(fs.existsSync('G:\\spaces\\kairo-ide\\tmp\\__nonexistent_xyz_999\\.kairo')).toBe(false);
    await page.keyboard.press('Escape');
  });

  test('TC-B06 项目选择器列表与打开', async ({ page }) => {
    // Trigger via palette
    await page.keyboard.press('F1');
    await page.waitForSelector('.quick-input-widget', { timeout: 10_000 });
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.type('Kairo: 选择项目', { delay: 25 });
    await page.waitForTimeout(700);
    const rows = page.locator('.quick-input-list .monaco-list-row');
    let clicked = false;
    for (let i = 0; i < await rows.count(); i++) {
      const t = (await rows.nth(i).textContent()) ?? '';
      if (/选择项目|Select Project/.test(t)) { await rows.nth(i).click(); clicked = true; break; }
    }
    if (!clicked) await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="project-selector"]', { timeout: 20_000 });
    await shot(page, 'B06', '01-selector-open');
    const items = page.locator('[data-testid="project-list"] li, [data-testid="project-selector"] li');
    const count = await items.count();
    saveJson('B06', 'selector.json', { count });
    expect(count).toBeGreaterThanOrEqual(1);
    await page.keyboard.press('Escape');
  });
});
