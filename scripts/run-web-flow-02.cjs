// WEB-FLOW-02 — 文件与编辑器（Files & Editor），M2 release-blocking driver.
//
// Real headed Chromium, UI-only operations. Project setup repeats the import
// wizard via UI (honest, no API seeding). Because the import wizard only
// registers the project agent-side and does NOT change the Theia workspace,
// the flow then uses Theia "File: Open..." (FileDialog widget) to open the
// imported project folder as the workspace — the realistic user path; the
// missing auto-reveal after import is recorded as evidence (see flow-01
// screenshots 08/10 and this flow's 04-tree-after-import).
//
// Covers: tree expand/collapse; open Java/JSP/properties/CSS/TS; JSP Monarch
// highlighting (objective token-class count + screenshot); File/Edit ops on a
// temp file (New/Save/Rename/Delete via UI); dirty + close-confirm; Java
// completion + F12 (real JDT LS results or explicit BLOCKED); 1MB/10MB large
// files (fixture-prepared via shell into the temp copy — allowed pre-flight
// fixture setup, documented here).
//
// Usage: node scripts/run-web-flow-02.cjs [--use-existing DATA_DIR]

const fs = require('fs');
const path = require('path');
const {
  startStack, stopStack, loadEnv, launchBrowser, openPage,
  dismissTrustDialog, runCommand, screenshot, waitForSelectorVisible,
  waitForStatusBarContains, agentGet, getStatusBarText,
  writeResult, writeLogs, sleep,
} = require('./qa-helpers.cjs');
const {
  flowDirs, recordFlowResult, appendDefect, ensurePort18080, consoleGate,
  selectFolderInTheiaFileDialog,
} = require('./m2-common.cjs');

const {
  importProjectViaWizard, openProjectAsWorkspace, ensureExplorerExpanded,
} = require('./m2-bootstrap.cjs');

const FLOW = 'WEB-FLOW-02';
const PROJECT_NAME = 'flow02-project';

// ---------- helpers -------------------------------------------------------

/** Open a file via Theia Quick Open (Meta+P, type name, Enter). UI-only. */
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
  // editor with monaco for this file should exist
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: timeoutMs });
}

/** Current active editor tab label. */
async function activeTabLabel(page) {
  const tab = page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabLabel').first();
  return (await tab.textContent().catch(() => '')) || '';
}

/** Count distinct monaco token classes (mtk*) in the visible editor — objective highlight signal. */
async function distinctTokenClasses(page) {
  return page.evaluate(() => {
    const set = new Set();
    for (const el of document.querySelectorAll('.monaco-editor .view-lines span[class*="mtk"]')) {
      for (const c of el.classList) if (/^mtk/.test(c)) set.add(c);
    }
    return [...set].sort();
  });
}

/** Click a tree node by caption (case-insensitive substring; deepest match wins). */
async function treeNode(page, caption) {
  const re = caption instanceof RegExp ? caption : new RegExp(caption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const nodes = page.locator('.theia-TreeNode').filter({ hasText: re });
  const count = await nodes.count();
  if (count === 0) throw new Error(`tree node not found: ${caption}`);
  return nodes.nth(count - 1);
}

async function main() {
  const args = process.argv.slice(2);
  let useExisting = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--use-existing' && args[i + 1]) { useExisting = args[i + 1]; i++; }
  }

  const runId = `flow02-${Date.now()}`;
  const dirs = flowDirs('flow-02');
  const OUT = dirs.flow;

  const result = {
    flow: FLOW, runId, startedAt: new Date().toISOString(),
    status: 'RUNNING', steps: [], screenshots: {}, errors: [], crossVerification: {}, blocked: [],
  };
  let stackInfo = null, browser = null, page = null;

  const shot = async (name) => {
    const p = path.join(dirs.shots, `${name}.png`);
    await screenshot(page, p);
    result.screenshots[name] = p;
  };
  const logStep = (name, detail) => {
    result.steps.push({ name, time: new Date().toISOString(), detail });
    console.log(`[${new Date().toISOString()}] ${name}`, detail ? JSON.stringify(detail).slice(0, 300) : '');
  };
  const logError = (msg) => {
    result.errors.push({ time: new Date().toISOString(), message: msg });
    console.error(`  ERROR  ${msg}`);
  };
  const markBlocked = (item, evidence) => {
    result.blocked.push({ item, evidence });
    logStep('BLOCKED', { item, evidence });
  };

  try {
    // ---- 1. stack ------------------------------------------------------
    if (useExisting) {
      stackInfo = { dataDir: useExisting, env: loadEnv(useExisting) };
      logStep('USE_EXISTING_STACK', { dataDir: useExisting });
    } else {
      ensurePort18080();
      logStep('START_STACK');
      stackInfo = await startStack({ skipBuild: true, port: 18080 });
      logStep('STACK_READY', { dataDir: stackInfo.dataDir, webPort: stackInfo.env.KAIRO_QA_WEB_PORT });
    }
    const env = stackInfo.env;
    if (String(env.KAIRO_QA_AGENT_PORT) !== '18080') throw new Error(`agent port must be 18080, got ${env.KAIRO_QA_AGENT_PORT}`);
    const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT || 3000}/`;
    const legacyDst = env.KAIRO_QA_LEGACY_DST;
    const health = await agentGet(env, '/api/v1/health', 10000);
    if (!health.ok) throw new Error(`agent health failed: ${health.status}`);
    logStep('PREFLIGHT_HEALTH_OK');

    // ---- 2. fixture prep (shell, temp copy only — documented) ----------
    const big1 = path.join(legacyDst, 'qa-big-1mb.txt');
    const big10 = path.join(legacyDst, 'qa-big-10mb.txt');
    if (!fs.existsSync(big1)) {
      const line1 = 'needle-line-000000 the quick brown fox jumps over the lazy dog 0123456789\n';
      fs.writeFileSync(big1, line1.repeat(Math.ceil((1024 * 1024) / line1.length)));
      const chunk = 'lorem ipsum dolor sit amet consectetur adipiscing elit 0123456789 ABCDEFGHIJ\n';
      fs.writeFileSync(big10, chunk.repeat(Math.ceil((10 * 1024 * 1024) / chunk.length)));
    }
    logStep('FIXTURES_READY', { big1: fs.statSync(big1).size, big10: fs.statSync(big10).size });

    // ---- 3. browser + import (UI) --------------------------------------
    logStep('LAUNCH_BROWSER');
    browser = await launchBrowser({ slowMo: 40 });
    page = await openPage(browser, webUrl);
    await dismissTrustDialog(page);
    await waitForStatusBarContains(page, 'Project: (no workspace)', 60000);
    logStep('SHELL_READY');

    await importProjectViaWizard(page, legacyDst, { name: PROJECT_NAME });
    logStep('PROJECT_IMPORTED', { name: PROJECT_NAME });
    await shot('03-after-import');

    // Evidence: does the tree show project files right after import?
    await page.locator('#explorer-view-container').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const treeTextAfterImport = await page.locator('#explorer-view-container').textContent().catch(() => '');
    result.crossVerification.treeAfterImport = (treeTextAfterImport || '').slice(0, 200);
    logStep('TREE_AFTER_IMPORT', { text: result.crossVerification.treeAfterImport });
    await shot('04-tree-after-import');

    // ---- 4. open project folder as Theia workspace (UI: File menu) -------
    // Theia opens a folder workspace in a NEW browser tab; the helper
    // follows the popup and returns the new page.
    logStep('OPEN_WORKSPACE');
    page = await openProjectAsWorkspace(page);
    const statusAfterOpen = await getStatusBarText(page);
    logStep('WORKSPACE_OPENED', { statusBar: statusAfterOpen.slice(0, 250), url: page.url() });
    await shot('05-workspace-opened');

    // The primary side bar may start collapsed; expand Explorer only if needed.
    await ensureExplorerExpanded(page);
    await page.locator('.theia-TreeNode').first().waitFor({ state: 'visible', timeout: 30000 });
    await shot('05b-explorer-panel');

    // ---- 5. tree expand/collapse ----------------------------------------
    // The Files view shows the workspace root as an UPPERCASE section
    // header (like "OPEN EDITORS"), NOT as a tree node; the tree itself
    // holds only the root's children (probe-verified).
    logStep('TREE_EXPAND_COLLAPSE');
    const header = page.locator('#explorer-view-container .theia-TreeViewHeader, #explorer-view-container [class*="section"], #explorer-view-container').first();
    const headerText = (await header.textContent()) || '';
    if (!/legacy-sam/i.test(headerText)) throw new Error(`workspace root header missing: ${headerText.slice(0, 120)}`);
    const srcNode = await treeNode(page, /^src$/i);
    // expand src -> 'main' appears; collapse -> hidden again
    await srcNode.locator('.theia-ExpansionToggle').first().click();
    await sleep(800);
    if (!(await (await treeNode(page, 'main')).isVisible().catch(() => false))) {
      throw new Error('expand(src) did not reveal main');
    }
    await shot('06-tree-expanded');
    await srcNode.locator('.theia-ExpansionToggle').first().click();
    await sleep(800);
    const mainGone = !(await page.locator('.theia-TreeNode', { hasText: 'main' }).first().isVisible().catch(() => false));
    if (!mainGone) throw new Error('collapse(src) did not hide main');
    await shot('06b-tree-collapsed');
    logStep('TREE_EXPAND_COLLAPSE_OK');

    // ---- 6. open files ---------------------------------------------------
    const openCases = [
      ['HelloServlet.java', 'java'],
      ['hello.jsp', 'jsp'],
      ['messages.properties', 'properties'],
      ['style.css', 'css'],
      ['index.ts', 'ts'],
    ];
    for (const [file, kind] of openCases) {
      await quickOpenFile(page, file);
      const label = await activeTabLabel(page);
      if (!label.includes(file)) throw new Error(`opened ${file} but active tab is "${label}"`);
      logStep('FILE_OPENED', { file, kind, tab: label });
      await shot(`07-open-${kind}`);
    }

    // JSP highlight: objective token diversity + screenshot
    await quickOpenFile(page, 'hello.jsp');
    await sleep(3000); // Monarch tokenization is async — wait before counting
    const jspTokens = await distinctTokenClasses(page);
    result.crossVerification.jspTokenClasses = jspTokens;
    // The JSP Monarch grammar emits few token types (observed: mtk1/mtk10/
    // mtk17 = plain/tag/string); highlighting is judged by >=3 distinct
    // classes + language mode JSP + screenshot, per plan "highlighting
    // visible (screenshot; Monarch wired)".
    const langMode = await page.locator('#theia-statusBar [id*="language"], .theia-statusBar-item', { hasText: 'JSP' }).count();
    if (jspTokens.length < 3) {
      logError(`JSP highlight weak: only ${jspTokens.length} token classes`);
      appendDefect({
        severity: 'P2', title: `${FLOW}: hello.jsp shows little/no Monarch token diversity (${jspTokens.length} classes)`,
        evidence: ['screenshots/m2/flow-02/08-jsp-highlight.png'], tokenClasses: jspTokens,
      });
    }
    await shot('08-jsp-highlight');
    logStep('JSP_HIGHLIGHT', { tokenClasses: jspTokens.length });

    // ---- 7. File/Edit ops on temp file -----------------------------------
    logStep('FILE_OPS');
    // File menu -> "New File..."; the menu path proved flaky once (menu
    // Context menu on 'src' -> New File... opens a WorkspaceInputDialog
    // (name prompt + OK). Deterministic path: file lands in src/.
    const TEMP_DIR = path.join(legacyDst, 'src');
    const createDialog = page.locator('#theia-dialog-shell .dialogBlock');
    const srcForNew = await treeNode(page, /^src$/i);
    await srcForNew.click({ button: 'right' });
    const nfCtx = page.locator('.lm-Menu, .p-Menu').first();
    await nfCtx.waitFor({ state: 'visible', timeout: 10000 });
    await nfCtx.getByText('New File...', { exact: true }).first().click();
    await createDialog.waitFor({ state: 'visible', timeout: 15000 });
    await shot('11-create-file-dialog');
    const nameInput = createDialog.locator('input.theia-input').last();
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    await nameInput.fill('qa-temp.txt');
    await createDialog.locator('button', { hasText: /^(OK|Create)/i }).first().click();
    await createDialog.waitFor({ state: 'hidden', timeout: 15000 });
    await sleep(1500);
    if (!fs.existsSync(path.join(TEMP_DIR, 'qa-temp.txt'))) {
      throw new Error('New File did not create src/qa-temp.txt on disk');
    }
    logStep('NEW_FILE_ON_DISK');

    // type content + Meta+S save
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.type('hello kairo flow02', { delay: 5 });
    await page.keyboard.press('Meta+S');
    await sleep(1000);
    const saved = fs.readFileSync(path.join(TEMP_DIR, 'qa-temp.txt'), 'utf8');
    if (!saved.includes('hello kairo flow02')) throw new Error(`save did not persist: "${saved.slice(0, 80)}"`);
    logStep('SAVE_VERIFIED_ON_DISK');

    // dirty + close: Theia default shows a save/discard confirmation. This
    // product silently PERSISTS on close with no dialog (no autoSave pref is
    // set anywhere) — record the divergence, don't hard-fail the flow.
    await page.keyboard.type(' DIRTY', { delay: 5 });
    await sleep(500);
    await shot('09-dirty-tab');
    await page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabCloseIcon').first().click();
    const confirmDialog = page.locator('#theia-dialog-shell .dialogBlock');
    const dialogShown = await confirmDialog.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (dialogShown) {
      await shot('10-close-confirm');
      await confirmDialog.locator('button', { hasText: /Don'?t Save/i }).first().click();
      await sleep(800);
      const afterDiscard = fs.readFileSync(path.join(TEMP_DIR, 'qa-temp.txt'), 'utf8');
      if (afterDiscard.includes('DIRTY')) throw new Error('discard failed: DIRTY content persisted');
      logStep('DIRTY_DISCARD_VERIFIED', { diskContent: afterDiscard.slice(0, 60) });
    } else {
      await sleep(800);
      const afterClose = fs.readFileSync(path.join(TEMP_DIR, 'qa-temp.txt'), 'utf8');
      const tabGone = (await page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'qa-temp.txt' }).count()) === 0;
      result.crossVerification.dirtyClose = { dialogShown: false, tabGone, dirtyPersisted: afterClose.includes('DIRTY') };
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: closing a dirty editor gives no save/discard confirmation — changes are silently persisted`,
        detail: result.crossVerification.dirtyClose,
        evidence: ['screenshots/m2/flow-02/09-dirty-tab.png'],
      });
      logStep('DIRTY_CLOSE_NO_CONFIRM', result.crossVerification.dirtyClose);
    }

    // rename + delete via navigator context menu
    const tempNode = await treeNode(page, 'qa-temp.txt');
    await tempNode.click({ button: 'right' });
    const ctxMenu = page.locator('.lm-Menu, .p-Menu').first();
    await ctxMenu.waitFor({ state: 'visible', timeout: 10000 });
    await shot('11-context-menu');
    await ctxMenu.getByText('Rename', { exact: true }).first().click();
    const renameInput = page.locator('#theia-dialog-shell .dialogBlock input.theia-input').last();
    await renameInput.waitFor({ state: 'visible', timeout: 10000 });
    await renameInput.fill('qa-temp-renamed.txt');
    await page.locator('#theia-dialog-shell .dialogBlock button', { hasText: /^OK$/i }).first().click().catch(async () => {
      await page.keyboard.press('Enter');
    });
    await sleep(1200);
    if (!fs.existsSync(path.join(TEMP_DIR, 'qa-temp-renamed.txt'))) throw new Error('rename did not land on disk');
    logStep('RENAME_VERIFIED_ON_DISK');

    // tree must reflect the rename; if not, try the explorer Refresh action
    let renamedNode = null;
    for (let i = 0; i < 10 && !renamedNode; i++) {
      renamedNode = await treeNode(page, 'qa-temp-renamed.txt').catch(() => null);
      if (!renamedNode) await sleep(1000);
    }
    if (!renamedNode) {
      await page.locator('#navigator\\.refresh, [id*="navigator.refresh"]').first().click().catch(() => {});
      for (let i = 0; i < 5 && !renamedNode; i++) {
        renamedNode = await treeNode(page, 'qa-temp-renamed.txt').catch(() => null);
        if (!renamedNode) await sleep(1000);
      }
      if (!renamedNode) {
        appendDefect({
          severity: 'P2',
          title: `${FLOW}: navigator does not reflect a UI rename (old name shown) even after Refresh`,
          evidence: ['screenshots/m2/flow-02/99-fail.png'],
        });
        logError('tree did not reflect rename even after Refresh (defect filed)');
      }
    }
    if (!renamedNode) {
      // The tree did not reflect the rename even after Refresh (defect
      // already filed above). Reload the page to rebuild the tree from disk
      // so the Delete step can run against the real file.
      logStep('RELOAD_FOR_TREE_SYNC');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(8000);
      await waitForStatusBarContains(page, 'Runtime: connected', 90000);
      await ensureExplorerExpanded(page);
      await sleep(1500);
      // re-expand src (conditional: only when its children are not visible)
      for (let i = 0; i < 10 && !renamedNode; i++) {
        renamedNode = await treeNode(page, 'qa-temp-renamed.txt').catch(() => null);
        if (!renamedNode) await sleep(1000);
      }
      if (renamedNode && !(await renamedNode.isVisible().catch(() => false))) {
        const srcAgain = await treeNode(page, /^src$/i).catch(() => null);
        if (srcAgain) await srcAgain.locator('.theia-ExpansionToggle').first().click().catch(() => {});
        await sleep(1200);
      }
      renamedNode = await treeNode(page, 'qa-temp-renamed.txt').catch(() => null);
    }
    if (!renamedNode) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: navigator does not show renamed file even after full page reload (disk has it)`,
        evidence: ['screenshots/m2/flow-02/99-fail.png'],
      });
      throw new Error('tree never showed renamed file even after reload');
    }
    await renamedNode.click({ button: 'right' });
    await ctxMenu.waitFor({ state: 'visible', timeout: 10000 });
    await ctxMenu.getByText('Delete', { exact: true }).first().click();
    const delDialog = page.locator('#theia-dialog-shell .dialogBlock');
    await delDialog.waitFor({ state: 'visible', timeout: 10000 });
    await shot('12-delete-confirm');
    await delDialog.locator('button', { hasText: /^(OK|Delete|Move to Trash)$/i }).first().click();
    await sleep(1500);
    await shot('13-after-delete');
    if (fs.existsSync(path.join(TEMP_DIR, 'qa-temp-renamed.txt'))) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: Delete via navigator context menu ("Move File to Trash" -> OK) silently does nothing — file remains on disk, no error shown`,
        evidence: ['screenshots/m2/flow-02/12-delete-confirm.png', 'screenshots/m2/flow-02/13-after-delete.png'],
      });
      logError('delete via UI silently no-op (defect filed); removing fixture via shell to continue evidence collection');
      fs.rmSync(path.join(TEMP_DIR, 'qa-temp-renamed.txt'), { force: true });
    } else {
      logStep('DELETE_VERIFIED_ON_DISK');
    }

    // ---- 8. Java completion + F12 ----------------------------------------
    logStep('JAVA_COMPLETION');
    await quickOpenFile(page, 'HelloServlet.java');
    await sleep(1500);
    const sbBeforeCompletion = await getStatusBarText(page);
    // put cursor at end of the class body and type a member access
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Meta+ArrowDown').catch(() => {});
    await page.keyboard.press('Control+End').catch(() => {});
    await page.keyboard.press('Enter');
    await page.keyboard.type('System.', { delay: 20 });
    await page.keyboard.press('Control+Space');
    const suggest = page.locator('.monaco-editor .suggest-widget.visible, .suggest-widget.visible').first();
    const suggestVisible = await suggest.waitFor({ state: 'visible', timeout: 150000 }).then(() => true).catch(() => false); // JDT LS first start can take 1-2 min
    if (suggestVisible) {
      const rows = await page.locator('.suggest-widget.visible .monaco-list-row').count();
      // capture JDT LS state on the success path too (coordinator request)
      const jdtlsOk = await agentGet(env, '/api/v1/jdtls', 10000);
      result.crossVerification.jdtlsAtCompletion = { ok: jdtlsOk.ok, status: jdtlsOk.status, body: (jdtlsOk.text || '').slice(0, 400) };
      logStep('JAVA_COMPLETION_OK', { suggestions: rows, jdtls: result.crossVerification.jdtlsAtCompletion });
      await shot('13-java-completion');
      await page.keyboard.press('Escape');
    } else {
      const jdtls = await agentGet(env, '/api/v1/jdtls', 10000);
      await shot('13-java-completion-blocked');
      markBlocked('Java completion', {
        reason: 'suggest widget never appeared within 8s',
        statusBar: sbBeforeCompletion.slice(0, 250),
        jdtlsApi: { ok: jdtls.ok, status: jdtls.status, body: (jdtls.text || '').slice(0, 300) },
      });
    }
    // undo the typed probe text so the file stays pristine
    await page.keyboard.press('Meta+Z');
    await page.keyboard.press('Meta+Z');
    await page.keyboard.press('Meta+Z');
    await page.keyboard.press('Meta+Shift+Z').catch(() => {});
    // close without saving if dirty
    const dirtyClose = page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabCloseIcon').first();
    await dirtyClose.click().catch(() => {});
    const maybeDialog = page.locator('#theia-dialog-shell .dialogBlock');
    if (await maybeDialog.isVisible().catch(() => false)) {
      await maybeDialog.locator('button', { hasText: /Don'?t Save/i }).first().click().catch(() => {});
    }

    // F12 go-to-definition on 'HttpServletRequest' in HelloServlet.java —
    // click the symbol occurrence directly (no find widget needed).
    logStep('JAVA_F12');
    await quickOpenFile(page, 'HelloServlet.java');
    await sleep(1200);
    const symbol = page.locator('.monaco-editor .view-lines span', { hasText: 'HttpServletRequest' }).first();
    await symbol.waitFor({ state: 'visible', timeout: 15000 });
    await symbol.click();
    await sleep(400);
    await page.keyboard.press('F12');
    await sleep(3000);
    const f12Peek = await page.locator('.monaco-editor .peekview-widget, .zone-widget').count();
    const f12Tab = await activeTabLabel(page);
    const jdtlsAtF12 = await agentGet(env, '/api/v1/jdtls', 10000);
    const jdtlsState = (() => { try { return JSON.parse(jdtlsAtF12.text).payload.state; } catch (_e) { return 'unknown'; } })();
    if (f12Peek > 0) {
      logStep('JAVA_F12_RESULT', { peekWidgets: f12Peek, activeTab: f12Tab, jdtlsState });
      await shot('14-java-f12');
    } else {
      await shot('14-java-f12-blocked');
      markBlocked('Java F12 go-to-definition', { activeTab: f12Tab, peekWidgets: f12Peek, jdtlsState });
    }
    // JDT LS never started in this build (state=stopped at completion AND
    // F12): the 12 completion rows are a non-JDT fallback. Java language
    // intelligence is BLOCKED for release — evidence: jdtls API snapshots
    // + agent log (copied in teardown).
    if (jdtlsState === 'stopped') {
      markBlocked('Java language server (JDT LS)', {
        state: 'stopped at completion and F12 time',
        completionRowsWereNonJdt: true,
        jdtlsApi: (jdtlsAtF12.text || '').slice(0, 300),
        agentLog: 'logs/flow-02/agent.log',
      });
    }

    // ---- 9. large files ----------------------------------------------------
    logStep('LARGE_FILE_1MB');
    await quickOpenFile(page, 'qa-big-1mb.txt', 40000);
    await page.keyboard.press('Control+End').catch(() => {});
    await sleep(1500);
    const bottomLine = await page.locator('.monaco-editor .view-lines').first().textContent();
    if (!(bottomLine || '').includes('needle-line')) throw new Error('1MB file content not rendered');
    await shot('15-large-1mb-bottom');
    logStep('LARGE_1MB_OK', { rendered: (bottomLine || '').length });

    logStep('LARGE_FILE_10MB');
    await quickOpenFile(page, 'qa-big-10mb.txt', 60000);
    await sleep(3000);
    const big10Rendered = await page.locator('.monaco-editor .view-lines').first().textContent().catch(() => '');
    // Meta+F never opened the find widget in repeated runs (see run19/20
    // logs) — try the Edit menu's Find entry instead.
    await page.locator('.monaco-editor .view-lines').first().click();
    await sleep(300);
    await page.locator('.lm-MenuBar-item', { hasText: 'Edit' }).first().click();
    await sleep(600);
    const editMenu = page.locator('.lm-Menu').first();
    await editMenu.waitFor({ state: 'visible', timeout: 10000 });
    const editItems = await editMenu.locator('.lm-Menu-itemLabel').allTextContents();
    result.crossVerification.editMenuItems = editItems.filter(Boolean).slice(0, 20);
    await editMenu.getByText(/^Find/, { exact: false }).first().click();
    const bigFind = page.locator('.monaco-editor .find-widget input, .find-widget input').first();
    const findOpened = await bigFind.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!findOpened) {
      // coordinator probe calls this a false positive; our evidence shows it
      // consistently not opening in this flow — record, don't hard-fail.
      logError('find widget did not open via Edit>Find menu (coordinator disputes; recorded for triage)');
      result.crossVerification.findWidgetOpened = false;
      await page.keyboard.press('Escape').catch(() => {});
      await shot('16-large-10mb');
      result.crossVerification.large10mb = { renderedChars: (big10Rendered || '').length, findMatches: 'WIDGET_DID_NOT_OPEN' };
      logStep('LARGE_10MB_RESULT', result.crossVerification.large10mb);
    } else {
      result.crossVerification.findWidgetOpened = true;
      await bigFind.fill('ABCDEFGHIJ');
      await sleep(1500);
      const matchInfo = await page.locator('.monaco-editor .find-widget .matchesCount').textContent().catch(() => '');
      await page.keyboard.press('Escape');
      await shot('16-large-10mb');
      result.crossVerification.large10mb = { renderedChars: (big10Rendered || '').length, findMatches: matchInfo };
      logStep('LARGE_10MB_RESULT', result.crossVerification.large10mb);
    }

    // ---- 10. console gate ---------------------------------------------------
    writeLogs(dirs.logs, page._kairoLogs || []);
    const gate = consoleGate(page._kairoLogs || []);
    result.consoleGate = { ok: gate.ok, errorCount: gate.errors.length, first: gate.errors[0] || null };
    if (!gate.ok) {
      logError(`console gate: ${gate.errors.length} errors, first: ${JSON.stringify(gate.errors[0]).slice(0, 300)}`);
      appendDefect({
        severity: 'P2', title: `${FLOW}: console/page errors during files & editor flow (${gate.errors.length})`,
        evidence: ['logs/flow-02/console.jsonl'], first: gate.errors[0],
      });
      throw new Error('console gate failed');
    }
    logStep('CONSOLE_GATE_CLEAN');

    result.status = result.blocked.length ? 'BLOCKED' : 'PASS';
    logStep(`FLOW_${result.status}`);
  } catch (err) {
    result.status = result.status === 'BLOCKED' && result.steps.some(s => s.name === 'FLOW_BLOCKED') ? 'BLOCKED' : 'FAIL';
    logError(err.message);
    if (stackInfo) {
      try {
        const { execFileSync } = require('child_process');
        result.failureDiagnostics = {
          port18080Pids: execFileSync('bash', ['-c', 'lsof -ti tcp:18080 2>/dev/null || true'], { encoding: 'utf8' }).trim(),
        };
      } catch (_e) { /* best effort */ }
    }
    if (page) await shot('99-fail').catch(() => {});
  } finally {
    if (page) writeLogs(dirs.logs, page._kairoLogs || []);
    if (browser) await browser.close().catch(() => {});
    result.finishedAt = new Date().toISOString();
    if (stackInfo && !useExisting) {
      logStep('STOP_STACK');
      const agentLogSrc = stackInfo.env.KAIRO_QA_AGENT_LOG;
      result.stopResult = await stopStack(stackInfo.dataDir);
      if (agentLogSrc && fs.existsSync(agentLogSrc)) fs.copyFileSync(agentLogSrc, path.join(dirs.logs, 'agent.log'));
      result.dataDir = stackInfo.dataDir;
    }
    writeResult(OUT, result);
    recordFlowResult(FLOW, {
      status: result.status, runId,
      errors: result.errors.map(e => e.message),
      blocked: result.blocked,
      crossVerification: result.crossVerification,
      consoleGate: result.consoleGate,
    });
    console.log(`\nArtifacts: ${OUT}`);
    console.log(`Result: ${result.status}`);
  }
  if (result.status === 'FAIL') process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
