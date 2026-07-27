// Quick debug probe to find the actual Theia debug-variables DOM class
import { test, expect } from '@playwright/test';
import { navigateToTheia, waitForTheiaShell, dismissTrustDialog, runKairoImportWizard, setBreakpoint, openFileViaQuickOpen, waitForBuildState } from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';

const TEST_WORKSPACE = '/tmp/kairo-k4-workspace/projects/workspace-shard06';
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');

function copyDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(sp, dp); else fs.copyFileSync(sp, dp);
  }
}

test('PROBE: find debug widget classes', async ({ page, baseURL, request }) => {
  if (!fs.existsSync(TEST_WORKSPACE) && fs.existsSync(LEGACY_SAMPLE)) {
    copyDirSync(LEGACY_SAMPLE, TEST_WORKSPACE);
  }
  const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
  try { await request.delete(`${agentBase}/api/v1/projects/project-workspace-shard06`); } catch {}
  await navigateToTheia(page, baseURL);
  await waitForTheiaShell(page);
  await dismissTrustDialog(page);
  const result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
  if (!result.opened) {
    console.log('wizard failed:', result.reason);
    return;
  }
  await openFileViaQuickOpen(page, 'HelloServlet.java');
  await page.waitForTimeout(2000);
  await setBreakpoint(page, 'HelloServlet.java', 25);
  // trigger build
  await page.evaluate(async (b) => {
    await fetch(`${b}/api/v1/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'project-workspace-shard06', type: 'tomcat6', port: 18302, debug: true, debugPort: 18303 }) });
  }, agentBase).catch(() => {});
  // wait for server
  let running = false;
  for (let i = 0; i < 90; i++) {
    const r = await request.get(`${agentBase}/api/v1/servers`).catch(() => null);
    if (r) {
      const j = await r.json().catch(() => null) as any;
      if (j?.payload?.some((s: any) => s.state === 'running')) { running = true; break; }
    }
    await page.waitForTimeout(1000);
  }
  if (!running) { console.log('server not running'); return; }
  // trigger breakpoint
  const np = await page.context().newPage();
  await np.goto('http://127.0.0.1:18302/hello').catch(() => {});
  await np.waitForTimeout(3000);
  await np.close();
  // wait for paused
  await page.waitForTimeout(5000);
  // open Variables view
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
  await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
  await page.keyboard.press('End');
  await page.keyboard.type('Debug: Focus on Variables View', { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  // dump all classes containing 'debug' or 'variable'
  const dump = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const set = new Set<string>();
    for (const el of Array.from(all)) {
      const cls = el.className;
      if (typeof cls === 'string') {
        for (const c of cls.split(/\s+/)) {
          if (c.toLowerCase().includes('debug') || c.toLowerCase().includes('variable') || c.toLowerCase().includes('watch') || c.toLowerCase().includes('breakpoint')) {
            set.add(c);
          }
        }
      }
      const id = el.id;
      if (typeof id === 'string' && (id.toLowerCase().includes('debug') || id.toLowerCase().includes('variable'))) {
        set.add('#' + id);
      }
    }
    return Array.from(set).sort();
  });
  console.log('=== Debug-related classes/ids ===');
  console.log(JSON.stringify(dump, null, 2));
  // also dump the variables widget area
  const widget = await page.evaluate(() => {
    const candidates = [
      '#debug\\.variables',
      '[id*="debug.variables"]',
      '[id*="debug-variables"]',
      '.theia-debug-variables',
      '.theia-DebugVariablesWidget',
      '#debug\\.breakpoints',
      '#debug\\.watch',
    ];
    const found: any[] = [];
    for (const c of candidates) {
      try {
        const els = document.querySelectorAll(c.replace(/\\\\/g, '\\'));
        if (els.length > 0) {
          found.push({ selector: c, count: els.length, first: (els[0] as HTMLElement).outerHTML.substring(0, 200) });
        }
      } catch {}
    }
    return found;
  });
  console.log('=== Widget candidates ===');
  console.log(JSON.stringify(widget, null, 2));
  await page.screenshot({ path: 'test-results/probe-debug-widgets.png', fullPage: true });
});
