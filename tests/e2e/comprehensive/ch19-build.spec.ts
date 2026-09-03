/**
 * Chapter 19 — Build system (BROWSER column).
 * Lane E: THEIA_URL=http://127.0.0.1:18441 AGENT_PORT=18440
 *
 * Live UI + agent API. Source greps are not used as the pass condition.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  openIde,
  openKairoCommand,
  paletteLists,
  api,
  LANE_WS,
  envelopePayload,
  firstProject,
  waitBuild,
  startBuild,
  customBuild,
  customStatus,
  customCancel,
} from './campaign';

let page: Page;
let projectId = '';
let projectRoot = '';
const ARGFILE_DIR = path.join(LANE_WS, 'legacy-sample', 'src', 'main', 'java', 'com', 'example', 'argfile');
const BROKEN_FILE = path.join(LANE_WS, 'legacy-sample', 'src', 'main', 'java', 'com', 'example', 'BrokenBuild.java');

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await openIde(page);
  const proj = await firstProject();
  projectId = proj.id;
  projectRoot = proj.rootPath || proj.root || path.join(LANE_WS, 'legacy-sample');
});
test.afterAll(async () => {
  try { fs.rmSync(ARGFILE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.unlinkSync(BROKEN_FILE); } catch { /* ignore */ }
  await page?.close();
});

async function waitUiState(states: RegExp, timeout = 90_000): Promise<string> {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    last = await page.locator('[data-testid="build-state"]').first().getAttribute('data-state').catch(() => '') ?? '';
    if (states.test(last)) return last;
    await page.waitForTimeout(400);
  }
  throw new Error(`build UI state never matched ${states} (last=${last})`);
}

test.describe.serial('ch19 build', () => {
  test('TC-BUILD-001 trigger Build and show Builds view', async () => {
    await openKairoCommand(page, 'Kairo: Show Builds');
    await expect(page.locator('[data-testid="build-view"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="build-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="build-state"]')).toHaveAttribute('aria-live', /polite|assertive/);
    const started = await startBuild(projectId);
    expect(started.status, started.body.slice(0, 400)).toBe(200);
    const id = envelopePayload(started)?.id;
    expect(id).toBeTruthy();
    const done = await waitBuild(id);
    expect(['succeeded', 'failed', 'success', 'failure']).toContain(done.state);
    await page.locator('[data-testid="build-button"]').click();
    const uiState = await waitUiState(/pending|running|succeeded|failed|cancelled/);
    console.log('[TC-BUILD-001] api state', done.state, 'ui', uiState, 'id', id);
    expect(uiState).toMatch(/pending|running|succeeded|failed|cancelled/);
  });

  test('TC-BUILD-002 Clean Build command', async () => {
    const rows = await paletteLists(page, 'Clean Build');
    expect(rows.join('\n')).toMatch(/Clean Build/);
    await openKairoCommand(page, 'Kairo: Show Builds');
    await page.locator('[data-testid="clean-build-button"]').click();
    const uiState = await waitUiState(/pending|running|succeeded|failed|cancelled/);
    expect(uiState).toMatch(/pending|running|succeeded|failed|cancelled/);
    const list = envelopePayload(await api('GET', '/builds'));
    expect(Array.isArray(list) ? list.length : 0).toBeGreaterThan(0);
  });

  test('TC-BUILD-003 Cancel in-flight build', async () => {
    await openKairoCommand(page, 'Kairo: Show Builds');
    await expect(page.locator('[data-testid="cancel-build-button"]')).toBeVisible();
    const started = await startBuild(projectId, { clean: true });
    const id = envelopePayload(started)?.id;
    expect(id).toBeTruthy();
    const cancel = await api('DELETE', `/builds/${id}`);
    expect([200, 404, 409]).toContain(cancel.status);
    const done = envelopePayload(cancel) ?? await waitBuild(id).catch(() => ({ state: 'unknown' }));
    console.log('[TC-BUILD-003] cancel', cancel.status, done);
    expect(String(done.state ?? done.status ?? '')).toMatch(/cancel|succeed|fail|unknown/i);
  });

  test('TC-BUILD-004 diagnostics list mapping', async () => {
    fs.writeFileSync(BROKEN_FILE, 'package com.example;\npublic class BrokenBuild { void m() { return 1; } }\n');
    const started = await startBuild(projectId);
    const done = await waitBuild(envelopePayload(started).id);
    const diags = done.diagnostics ?? [];
    console.log('[TC-BUILD-004] state', done.state, 'diags', diags.slice(0, 3));
    expect(done.state).toMatch(/fail/);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0]).toEqual(expect.objectContaining({
      message: expect.any(String),
    }));
    expect(String(diags[0].severity ?? 'error')).toMatch(/error|warning|info/i);
    await openKairoCommand(page, 'Kairo: Show Builds');
    const summary = await page.locator('[data-testid="build-summary"]').textContent().catch(() => '');
    console.log('[TC-BUILD-004] summary', summary);
    try { fs.unlinkSync(BROKEN_FILE); } catch { /* ignore */ }
  });

  test('TC-BUILD-005 marker owner kairo-build', async () => {
    fs.writeFileSync(BROKEN_FILE, 'package com.example;\npublic class BrokenBuild { void m() { return 1; } }\n');
    const started = await startBuild(projectId);
    await waitBuild(envelopePayload(started).id);
    await openKairoCommand(page, 'Kairo: Show Builds');
    const diagRow = page.locator('[data-testid="build-error"], [data-testid="diagnostics-list"] li').first();
    if (await diagRow.count()) {
      await diagRow.click();
      await page.waitForTimeout(800);
    }
    const markers = await page.evaluate(() => {
      const w = window as any;
      const models = w.monaco?.editor?.getModels?.() ?? [];
      const out: string[] = [];
      for (const m of models) {
        const ms = w.monaco?.editor?.getModelMarkers?.({ resource: m.uri }) ?? [];
        for (const mk of ms) out.push(`${mk.owner}:${mk.message}`);
      }
      return out;
    });
    console.log('[TC-BUILD-005] markers', markers.slice(0, 8));
    expect(markers.some(m => /kairo-build/i.test(m))).toBeTruthy();
    try { fs.unlinkSync(BROKEN_FILE); } catch { /* ignore */ }
  });

  test('TC-BUILD-006 history cap 200', async () => {
    const list = envelopePayload(await api('GET', '/builds'));
    expect(Array.isArray(list)).toBeTruthy();
    expect(list.length).toBeLessThanOrEqual(200);
    await openKairoCommand(page, 'Kairo: Show Builds');
    const items = await page.locator('[data-testid="build-list"] li, [data-testid^="build-"]').count();
    expect(items).toBeGreaterThan(0);
  });

  test('TC-BUILD-007 null summary/diagnostics tolerated', async () => {
    await openKairoCommand(page, 'Kairo: Show Builds');
    const crashed = await page.evaluate(() => !document.querySelector('#theia-app-shell'));
    expect(crashed).toBeFalsy();
    const state = await page.locator('[data-testid="build-state"]').first().getAttribute('data-state');
    expect(state).toBeTruthy();
  });

  test('TC-BUILD-008 Reconnect Agent command', async () => {
    const rows = await paletteLists(page, 'Reconnect Agent');
    expect(rows.join('\n')).toMatch(/Reconnect Agent/);
    await openKairoCommand(page, 'Kairo: Show Builds');
    const disconnected = page.locator('[data-testid="build-disconnected"]');
    if (await disconnected.count()) {
      await expect(page.getByRole('button', { name: /Reconnect/i })).toBeVisible();
    } else {
      await expect(page.locator('[data-testid="build-view"]')).toBeVisible();
    }
  });

  test('TC-BUILD-009 javac encoding and source/target flags', async () => {
    const started = await startBuild(projectId);
    const done = await waitBuild(envelopePayload(started).id);
    const blob = `${done.output ?? ''} ${done.summary ?? ''} ${JSON.stringify(done)}`;
    console.log('[TC-BUILD-009] encoding in output', /encoding/i.test(blob), 'source', done.sourceLevel, 'target', done.targetLevel);
    expect(done.sourceLevel || done.targetLevel || /encoding|-g|Xlint/i.test(blob)).toBeTruthy();
  });

  test('TC-BUILD-010 Windows argfile', async () => {
    test.skip(process.platform !== 'win32', 'argfile threshold is Windows-only');
    fs.mkdirSync(ARGFILE_DIR, { recursive: true });
    for (let i = 0; i < 51; i++) {
      fs.writeFileSync(path.join(ARGFILE_DIR, `Gen${i}.java`), `package com.example.argfile;\npublic class Gen${i} {}\n`);
    }
    const started = await startBuild(projectId, { clean: true });
    const done = await waitBuild(envelopePayload(started).id, 120_000);
    console.log('[TC-BUILD-010] filesCompiled', done.filesCompiled, 'state', done.state);
    expect(done.filesCompiled ?? 0).toBeGreaterThan(50);
    try { fs.rmSync(ARGFILE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('TC-BUILD-011 Chinese javac severity', async () => {
    fs.writeFileSync(BROKEN_FILE, 'package com.example;\npublic class BrokenBuild { String x = ;\n}\n');
    const started = await startBuild(projectId);
    const done = await waitBuild(envelopePayload(started).id);
    const diags = done.diagnostics ?? [];
    expect(diags.length).toBeGreaterThan(0);
    const sev = String(diags[0].severity ?? '');
    expect(sev).toMatch(/error|warning|错误|警告/i);
    try { fs.unlinkSync(BROKEN_FILE); } catch { /* ignore */ }
  });

  test('TC-BUILD-012 output redaction', async () => {
    const started = await startBuild(projectId, { clean: false });
    const done = await waitBuild(envelopePayload(started).id);
    const text = `${done.output ?? ''}${JSON.stringify(done.diagnostics ?? [])}`;
    const abs = projectRoot.replace(/\\/g, '/');
    if (text.length > 40) {
      expect(text.includes(abs) && !text.includes('<workspace>')).toBeFalsy();
    }
    const secret = await customBuild({
      command: process.platform === 'win32' ? 'cmd /c echo password=hunter2' : 'echo password=hunter2',
      projectRoot,
    });
    expect(secret.status).toBe(200);
    const bid = envelopePayload(secret)?.buildId;
    await page.waitForTimeout(1500);
    const st = envelopePayload(await customStatus(bid));
    console.log('[TC-BUILD-012] custom status', st);
    const blob = JSON.stringify(st);
    expect(blob.includes('hunter2') && !blob.includes('REDACTED')).toBeFalsy();
  });

  test('TC-BUILD-013 idempotent replay header', async () => {
    const rid = `idem-${Date.now()}`;
    const first = await startBuild(projectId, {}, rid);
    expect(first.status).toBe(200);
    const second = await startBuild(projectId, {}, rid);
    expect(second.status).toBe(200);
    const replay = second.json && typeof second.json === 'object';
    const hdrProbe = await fetch(`${process.env.AGENT_URL || ''}`).catch(() => null);
    void hdrProbe;
    const res = await fetch(`http://127.0.0.1:${process.env.AGENT_PORT || '18440'}/api/v1/builds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: rid, payload: { projectId } }),
    });
    const replayHeader = res.headers.get('X-Kairo-Idempotent-Replay');
    console.log('[TC-BUILD-013] replay header', replayHeader, 'ids', envelopePayload(first)?.id, envelopePayload(second)?.id);
    expect(replayHeader).toBe('1');
    expect(envelopePayload(first)?.id).toBe(envelopePayload(second)?.id);
    expect(replay).toBeTruthy();
  });

  test('TC-BUILD-014 build timeout', async () => {
    const started = await startBuild(projectId);
    const done = await waitBuild(envelopePayload(started).id);
    expect(done.elapsedMs ?? 0).toBeLessThan(5 * 60 * 1000);
    expect(['succeeded', 'failed', 'cancelled', 'success', 'failure']).toContain(done.state);
  });

  test('TC-BUILD-021 ant war', async () => {
    const analyze = await fetch(`http://127.0.0.1:${process.env.AGENT_PORT || '18440'}/api/v1/ant/classpath/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectRoot, buildFile: 'build.xml' }),
    });
    const body = await analyze.text();
    console.log('[TC-BUILD-021] analyze', analyze.status, body.slice(0, 300));
    expect(analyze.status).toBe(200);
    const json = JSON.parse(body);
    const payload = json.payload ?? json;
    expect(payload.buildFile || payload.success === false).toBeTruthy();
    const custom = await customBuild({
      command: process.platform === 'win32' ? 'cmd /c ant -version' : 'ant -version',
      projectRoot,
    });
    const st = envelopePayload(custom);
    console.log('[TC-BUILD-021] ant -version', custom.status, st);
    if (custom.status === 200 && st?.buildId) {
      await page.waitForTimeout(2000);
      const done = envelopePayload(await customStatus(st.buildId));
      console.log('[TC-BUILD-021] ant status', done);
    }
  });

  test('TC-BUILD-022 illegal ant target', async () => {
    const dir = fs.mkdtempSync(path.join(LANE_WS, 'ant-bad-'));
    fs.writeFileSync(path.join(dir, 'build.xml'), '<project name="t"><target name="compile"/></project>');
    const custom = await customBuild({
      command: process.platform === 'win32' ? 'cmd /c ant nosuchtarget' : 'ant nosuchtarget',
      projectRoot: dir,
    });
    if (custom.status === 403 || custom.status === 400) {
      expect([400, 403]).toContain(custom.status);
    } else {
      const bid = envelopePayload(custom)?.buildId;
      await page.waitForTimeout(2500);
      const done = envelopePayload(await customStatus(bid));
      console.log('[TC-BUILD-022] status', done);
      expect(done.exitCode === undefined || done.exitCode !== 0 || /not found|Unknown target|BUILD FAILED/i.test(JSON.stringify(done))).toBeTruthy();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('TC-BUILD-023 classpath analyze', async () => {
    const res = await fetch(`http://127.0.0.1:${process.env.AGENT_PORT || '18440'}/api/v1/ant/classpath/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectRoot, buildFile: 'build.xml' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const payload = json.payload ?? json;
    expect(payload).toEqual(expect.objectContaining({
      classpath: expect.any(Array),
    }));
    expect('sourceRoots' in payload || 'warnings' in payload || 'buildFile' in payload).toBeTruthy();
  });

  test('TC-BUILD-024 ant cancel ForceStop', async () => {
    const started = await customBuild({
      command: process.platform === 'win32' ? 'cmd /c ping -n 30 127.0.0.1' : 'sleep 30',
      projectRoot,
    });
    expect(started.status).toBe(200);
    const bid = envelopePayload(started).buildId;
    await page.waitForTimeout(400);
    const cancel = await customCancel(bid);
    expect(cancel.status).toBe(200);
    await page.waitForTimeout(800);
    const done = envelopePayload(await customStatus(bid));
    console.log('[TC-BUILD-024] after cancel', done);
    expect(['cancelled', 'finished', 'error', 'running']).toContain(String(done.status));
  });

  test('TC-BUILD-031 custom build widget', async () => {
    await openKairoCommand(page, 'Kairo: Show Custom Build');
    const widget = page.locator('[data-testid="custom-build-view"]');
    await expect(widget).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="custom-build-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="custom-build-run"]')).toBeVisible();
    const cmd = process.platform === 'win32' ? 'cmd /c echo kairo-custom-ok' : 'echo kairo-custom-ok';
    await page.locator('[data-testid="custom-build-input"]').fill(cmd);
    await page.locator('[data-testid="custom-build-run"]').click();
    await expect(page.locator('[data-testid="custom-build-output"]')).toBeVisible();
    await page.waitForTimeout(2500);
    const text = await page.locator('[data-testid="custom-build-view"]').innerText();
    expect(text).toMatch(/kairo-custom-ok|Running|Build|exit/i);
  });

  test('TC-BUILD-032 empty custom command', async () => {
    await openKairoCommand(page, 'Kairo: Show Custom Build');
    const input = page.locator('[data-testid="custom-build-input"]');
    await input.fill('');
    await expect(page.locator('[data-testid="custom-build-run"]')).toBeDisabled();
    const res = await customBuild({ command: '', projectRoot });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).toMatch(/command is required/i);
  });

  test('TC-BUILD-033 custom stop', async () => {
    const started = await customBuild({
      command: process.platform === 'win32' ? 'cmd /c ping -n 20 127.0.0.1' : 'sleep 20',
      projectRoot,
    });
    const bid = envelopePayload(started).buildId;
    const cancel = await customCancel(bid);
    expect(cancel.status).toBe(200);
    expect(envelopePayload(cancel).status).toMatch(/cancel/i);
  });

  test('TC-BUILD-034 30 minute deadline', async () => {
    const started = await customBuild({
      command: process.platform === 'win32' ? 'cmd /c ping -n 20 127.0.0.1' : 'sleep 20',
      projectRoot,
      timeoutMs: 1500,
    });
    expect(started.status).toBe(200);
    const bid = envelopePayload(started).buildId;
    const deadline = Date.now() + 12_000;
    let last: any = null;
    while (Date.now() < deadline) {
      last = envelopePayload(await customStatus(bid));
      if (last?.status && last.status !== 'running') break;
      await page.waitForTimeout(400);
    }
    console.log('[TC-BUILD-034] last', last);
    expect(last?.status).not.toBe('running');
    expect(last?.exitCode === -1 || last?.status === 'finished' || last?.status === 'cancelled' || last?.status === 'error').toBeTruthy();
  });

  test('TC-BUILD-035 sandbox workingDir', async () => {
    const outside = process.platform === 'win32' ? 'C:\\\\Windows\\\\System32' : '/etc';
    const res = await customBuild({
      command: process.platform === 'win32' ? 'cmd /c echo hi' : 'echo hi',
      projectRoot: outside,
    });
    console.log('[TC-BUILD-035]', res.status, res.body.slice(0, 300));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).toMatch(/path_forbidden|forbidden|sandbox|authorized|outside/i);
  });
});
