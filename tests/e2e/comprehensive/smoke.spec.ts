/**
 * TC-LAUNCH-061/062/064 + TC-WELC-001/003/004 — smoke gate for every lane.
 * Verifies the fresh build actually boots before chapter testing begins.
 */
import { test, expect } from '@playwright/test';
import { openIde, attachDiagnostics, api } from './helpers';

test('SMOKE: agent health (TC-SEC-002 precondition, lane no-auth)', async () => {
  const health = await api('GET', '/health');
  expect(health.status).toBe(200);
  expect(health.json?.payload?.ok).toBe(true);
});

test('SMOKE: workbench loads with title Kairo IDE (TC-LAUNCH-062)', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Kairo IDE/, { timeout: 60_000 });
  await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
  // favicon must not 404 (TC-LAUNCH-062)
  const resp = await page.request.get('/favicon.ico');
  expect(resp.status()).toBeLessThan(400);
  // hard console errors are failures
  const fatal = diag.pageErrors;
  expect(fatal).toEqual([]);
});

test('SMOKE: welcome widget auto-opens when no active project (TC-WELC-001/003)', async ({ page }) => {
  await openIde(page);
  // Welcome opens as a main-area tab; content renders h1 "Kairo IDE" (TC-WELC-003)
  await expect(page.getByRole('tab', { name: /Welcome/i })).toBeVisible({ timeout: 30_000 });
  const panel = page.getByRole('tabpanel').filter({ has: page.getByRole('heading', { level: 1, name: 'Kairo IDE' }) });
  await expect(panel).toBeVisible({ timeout: 15_000 });
});
