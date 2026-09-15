/**
 * Chapter 22 — Run configurations, real rendering interaction tests (@ui).
 *
 * UI-07: every case below drives the live Theia page (click / keyboard /
 * geometry) and asserts rendered state. Static source-text checks for this
 * chapter live in ch22-runconfig-contract.spec.ts (@contract) and are never
 * used as UI acceptance here.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openIde, openKairoCommand, paletteLists, bodyText } from './campaign';

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await openIde(page);
});
test.afterAll(async () => { await page?.close(); });

async function openRunConfigurations(): Promise<void> {
  const rows = await paletteLists(page, 'Manage Run Configurations');
  expect(rows.join('\n')).toMatch(/Run Configuration/);
  await openKairoCommand(page, 'Kairo: Manage Run Configurations');
}

async function clickNewConfiguration(): Promise<void> {
  const view = page.locator('.kairo-widget').filter({ hasText: 'Run Configurations' }).first();
  await expect(view).toBeVisible({ timeout: 30_000 });
  const created = page.getByTestId('run-config-title');
  await page.getByRole('button', { name: /new configuration/i }).first().click();
  await expect(created).toBeVisible({ timeout: 15_000 });
}

test.describe.serial('ch22 run configurations @ui', () => {
  test('TC-RUN-001 open Manage Run Configurations renders the view', async () => {
    await openRunConfigurations();
    const text = await bodyText(page);
    expect(text).toMatch(/Run Configuration/);
  });

  test('TC-RUN-002 new configuration shows the create title, not edit', async () => {
    await openRunConfigurations();
    await clickNewConfiguration();
    const title = page.getByTestId('run-config-title');
    await expect(title).toHaveAttribute('data-mode', 'create');
    await expect(title).not.toHaveText(/edit/i);
  });

  test('TC-RUN-003 six form groups render', async () => {
    const form = page.locator('form.kairo-runconfig-form');
    await expect(form).toBeVisible();
    for (const legend of ['General', 'Server', 'Build', 'Deploy', 'Advanced', 'Before Launch']) {
      await expect(form.getByText(legend, { exact: false }).first()).toBeVisible();
    }
  });

  test('TC-RUN-004 JVM options: real Enter keeps a second line (UI-03)', async () => {
    const vm = page.getByTestId('run-config-vm-options');
    await expect(vm).toBeVisible();
    await vm.fill('-Xms256m');
    await vm.press('End');
    await vm.press('Enter');
    await vm.pressSequentially('-Xmx1024m');
    await expect(vm).toHaveValue('-Xms256m\n-Xmx1024m');
  });

  test('TC-RUN-005 ports: clearing keeps intermediate state, submit rejects out-of-range', async () => {
    const http = page.locator('#run-config-http-port');
    await expect(http).toBeVisible();
    await http.fill('');
    await expect(http).toHaveValue('');
    await http.fill('0');
    await page.locator('form.kairo-runconfig-form').getByRole('button', { name: /^save$/i }).click();
    await expect(page.locator('#run-config-http-port-error')).toBeVisible();
    await http.fill('8080');
    await expect(page.locator('#run-config-http-port-error')).toHaveCount(0);
  });

  test('TC-RUN-006 build drafts survive Ant -> Custom -> Ant round-trip (UI-12)', async () => {
    const buildType = page.locator('#run-config-build-type');
    await expect(buildType).toBeVisible();
    await buildType.selectOption('ant');
    await page.locator('#run-config-ant-target').fill('my-war-target');
    await buildType.selectOption('custom');
    await page.locator('#run-config-custom-command').fill('ant war -DskipTests');
    await buildType.selectOption('ant');
    await expect(page.locator('#run-config-ant-target')).toHaveValue('my-war-target');
    await buildType.selectOption('custom');
    await expect(page.locator('#run-config-custom-command')).toHaveValue('ant war -DskipTests');
  });

  test('TC-RUN-007 labels focus their inputs (UI-09)', async () => {
    await page.getByText('HTTP port', { exact: true }).first().click();
    await expect(page.locator('#run-config-http-port')).toBeFocused();
  });

  test('TC-RUN-008 cancel does not persist (dirty guard)', async () => {
    await page.locator('#run-config-name').fill(`ui-probe-${Date.now()}`);
    await page.locator('form.kairo-runconfig-form').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByTestId('run-config-title')).toHaveCount(0);
  });
});
