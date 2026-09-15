/**
 * Shared helpers for remaining comprehensive chapters (19–48).
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import * as fs from 'fs';
import {
  openIde,
  runCommand,
  repoPath,
  api,
  AGENT,
  LANE_WS,
  ensureWorkspace,
  importProjectApi,
  ensureProjectInWs,
  discoverBoundWorkspaceId,
} from './helpers';
import type { AgentResp } from './helpers';

export {
  openIde,
  runCommand,
  api,
  repoPath,
  AGENT,
  LANE_WS,
  ensureWorkspace,
  importProjectApi,
  ensureProjectInWs,
  discoverBoundWorkspaceId,
};

export async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText.slice(0, 80_000));
}

export async function paletteLists(page: Page, query: string): Promise<string[]> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.keyboard.press('F1');
  const input = page.locator('.quick-input-widget .quick-input-box input').first();
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.fill(`>${query}`);
  await page.waitForTimeout(500);
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row')).map(r => r.textContent?.trim() ?? ''),
  );
  await page.keyboard.press('Escape').catch(() => undefined);
  return rows;
}

export async function openKairoCommand(page: Page, label: string): Promise<void> {
  await runCommand(page, label);
  await page.waitForTimeout(800);
}

/**
 * Static contract check (UI-07 classification: `@contract`).
 *
 * Reads repository source text only. It may assert registration strings,
 * schema keywords or protocol markers, but a passing contract check MUST
 * NOT be reported as "the user flow works" — that requires a real
 * rendering interaction test (`@ui`). Contract checks live alongside UI
 * tests so both run in one campaign, distinguished by this call.
 */
export function expectContract(rel: string, ...needles: Array<string | RegExp>): void {
  const text = fs.readFileSync(repoPath(...rel.split('/')), 'utf8');
  for (const needle of needles) {
    if (typeof needle === 'string') {
      expect(text, `[contract] ${rel}`).toContain(needle);
    } else {
      expect(text, `[contract] ${rel}`).toMatch(needle);
    }
  }
}

/**
 * @deprecated Use {@link expectContract} for static checks (explicit
 * `@contract` classification) or real page locators for UI acceptance.
 * Kept only so unmigrated branches keep compiling; new tests must not use it.
 */
export function expectFile(rel: string, ...needles: Array<string | RegExp>): void {
  expectContract(rel, ...needles);
}

/**
 * Real UI assertion (UI-07 classification: `@ui`).
 *
 * Asserts against the live rendered page text. The historical source-text
 * fallback was removed: when the UI does not show the expected content the
 * test MUST fail — missing buttons, unopenable views or broken interactions
 * can never pass because a keyword still exists in the sources.
 */
export async function uiOrFile(
  page: Page,
  ui: RegExp,
  _rel: string,
  ..._needles: Array<string | RegExp>
): Promise<void> {
  void _rel;
  void _needles;
  const text = await bodyText(page);
  expect(text, '[ui] expected content not rendered; source fallback is prohibited (UI-07)').toMatch(ui);
}

export function envelopePayload(res: AgentResp): any {
  return res.json?.payload ?? res.json;
}

export async function firstProject(): Promise<{ id: string; name: string; rootPath?: string; root?: string }> {
  const list = await api('GET', '/projects');
  const items = envelopePayload(list);
  const arr = Array.isArray(items) ? items : [];
  const found = arr.find((p: { name?: string }) => p.name === 'legacy-sample') ?? arr[0];
  if (!found?.id) throw new Error(`no project registered: ${list.body.slice(0, 300)}`);
  return found;
}

export async function waitBuild(id: string, timeoutMs = 90_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const res = await api('GET', `/builds/${id}`);
    last = envelopePayload(res);
    const state = String(last?.state ?? '');
    if (['succeeded', 'failed', 'cancelled', 'success', 'failure'].includes(state)) return last;
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`build ${id} did not finish: ${JSON.stringify(last)?.slice(0, 400)}`);
}

export async function startBuild(projectId: string, extra: Record<string, unknown> = {}, requestId?: string): Promise<AgentResp> {
  const rid = requestId ?? `build-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await fetch(`${AGENT}/api/v1/builds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: rid, payload: { projectId, ...extra } }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  let json: any = null;
  try { json = JSON.parse(body); } catch { /* ignore */ }
  return { status: res.status, json, body };
}

export async function customBuild(cfg: {
  command: string;
  projectRoot: string;
  workingDir?: string;
  timeoutMs?: number;
  buildId?: string;
}): Promise<AgentResp> {
  return api('POST', '/build/custom', cfg);
}

export async function customStatus(buildId: string): Promise<AgentResp> {
  return api('GET', `/build/custom/${buildId}`);
}

export async function customCancel(buildId: string): Promise<AgentResp> {
  return api('POST', `/build/custom/${buildId}/cancel`, {});
}
