// Shared UI bootstrap for M2 flows 03-06: import the legacy-sample copy via
// the Import Wizard and open it as the Theia workspace. UI-only operations.
// Extracted from run-web-flow-02.cjs so each flow driver stays focused on its
// own assertions. Import itself is asserted by WEB-FLOW-01; here it is setup.

const {
  runCommand, waitForSelectorVisible, waitForStatusBarContains, dismissTrustDialog, sleep,
} = require('./qa-helpers.cjs');
const { selectFolderInTheiaFileDialog } = require('./m2-common.cjs');

/** Run the Import Wizard end-to-end with the given project name/options. */
async function importProjectViaWizard(page, legacyDst, { name, sourceLevel = '1.6', encoding = 'GBK', buildTool = 'ant' }) {
  await runCommand(page, 'Kairo: Import Project', 20000);
  await waitForSelectorVisible(page, '[data-testid="import-wizard"]', 20000);
  await page.locator('[data-testid="open-workspace-btn"]').click();
  await selectFolderInTheiaFileDialog(page, 'legacy-sample', { upCount: 1 });
  await page.locator('[data-testid="continue-to-configure"], [data-testid="create-new-config"]').first()
    .waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('[data-testid="continue-to-configure"], [data-testid="create-new-config"]').first().click();
  await waitForSelectorVisible(page, '[data-testid="step-content-3"]', 20000);
  await page.locator('[data-testid="input-project-name"]').fill(name);
  await page.locator('[data-testid="select-source-level"]').selectOption(sourceLevel);
  await page.locator('[data-testid="select-encoding"]').selectOption(encoding);
  await page.locator('[data-testid="select-build-tool"]').selectOption(buildTool);
  await page.locator('[data-testid="save-config-btn"]').click();
  await page.locator('[data-testid="import-wizard"]').waitFor({ state: 'hidden', timeout: 60000 });
  await waitForStatusBarContains(page, name, 60000);
}

/**
 * Open the imported project folder as the Theia workspace via the File menu
 * ("File" -> "Open..."), then the Theia FileDialog widget. Theia opens a
 * folder workspace in a NEW browser tab (WorkspaceService.openNewWindow),
 * so we follow the popup page. Menu driving is used because the command
 * palette proved flaky for "File: Open..." (the quick input reverted to
 * file-search mode). Returns the NEW page.
 */
async function openProjectAsWorkspace(page) {
  await page.locator('.lm-MenuBar-item', { hasText: 'File' }).first().click();
  await sleep(600);
  const menu = page.locator('.lm-Menu').first();
  await menu.waitFor({ state: 'visible', timeout: 10000 });
  const popupPromise = page.context().waitForEvent('page', { timeout: 60000 }).catch(() => null);
  await menu.getByText('Open...', { exact: true }).first().click();
  await selectFolderInTheiaFileDialog(page, 'legacy-sample', { upCount: 1 });
  const popup = await popupPromise;
  const target = popup || page; // popup blocked -> Theia falls back to reload in place
  await target.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  await sleep(8000);
  await dismissTrustDialog(target, 5000).catch(() => false);
  await waitForStatusBarContains(target, 'Runtime: connected', 90000);
  // carry the log buffer over so the console gate covers the new tab,
  // and attach the same listeners (popup pages get none from openPage)
  if (popup && page._kairoLogs) {
    const logs = page._kairoLogs;
    popup._kairoLogs = logs;
    popup.on('console', msg => logs.push({ type: msg.type(), text: msg.text(), url: (msg.location() || {}).url || '', time: new Date().toISOString() }));
    popup.on('pageerror', err => logs.push({ type: 'pageerror', text: err.message, time: new Date().toISOString() }));
    popup.on('requestfailed', req => logs.push({ type: 'requestfailed', text: `${req.failure()?.errorText || ''}`, url: req.url(), time: new Date().toISOString() }));
    popup.on('response', res => { if (res.status() >= 400) logs.push({ type: 'http' + res.status(), text: `HTTP ${res.status()}`, url: res.url(), time: new Date().toISOString() }); });
  }
  return target;
}

/** Open a file via Theia Quick Open (Meta+P, type name, Enter). */
async function quickOpenFile(page, fileName, timeoutMs = 20000) {
  await page.keyboard.press('Meta+P');
  const widget = page.locator('.quick-input-widget');
  await widget.waitFor({ state: 'visible', timeout: timeoutMs });
  const input = page.locator('.quick-input-widget .quick-input-box input');
  await input.fill('');
  await input.type(fileName, { delay: 25 });
  await sleep(900);
  const row = page.locator('.quick-input-widget .monaco-list .monaco-list-row').first();
  await row.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.keyboard.press('Enter');
  await sleep(800);
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: timeoutMs });
}

/** Visible text of the active monaco editor (view-lines). */
async function editorText(page) {
  return (await page.locator('.monaco-editor .view-lines').first().textContent()) || '';
}

/** Close the current tab; if a save-confirm dialog appears, click "Don't Save". */
async function closeCurrentTabDiscarding(page) {
  const close = page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabCloseIcon').first();
  await close.click().catch(() => {});
  await sleep(600);
  const dialog = page.locator('#theia-dialog-shell .dialogBlock');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.locator('button', { hasText: /Don'?t Save/i }).first().click().catch(() => {});
    await sleep(500);
  }
}

/** Expand the primary side bar's Explorer panel ONLY if it is collapsed. */
async function ensureExplorerExpanded(page) {
  const collapsed = await page.evaluate(() => {
    const left = document.getElementById('theia-left-content-panel');
    return left ? left.className.includes('theia-mod-collapsed') : false;
  });
  if (collapsed) {
    await page.locator('[aria-label="Explorer"]').first().click().catch(() => {});
    await sleep(1500);
  }
}

module.exports = {
  importProjectViaWizard,
  openProjectAsWorkspace,
  quickOpenFile,
  editorText,
  closeCurrentTabDiscarding,
  ensureExplorerExpanded,
};
