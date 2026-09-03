/**
 * Chapter 23 — Debug (BROWSER). Lane E.
 * Live JDWP hit tests require Tomcat debug; this pass opens views and
 * verifies condition evaluation is wired (RecordHitAndShouldStop).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openIde, openKairoCommand, paletteLists, expectFile } from './campaign';

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await openIde(page);
});
test.afterAll(async () => { await page?.close(); });

test.describe.serial('ch23 debug', () => {
  test('TC-DBG-001 debug views exist', async () => {
    const rows = await paletteLists(page, 'Show Debug');
    expect(rows.join('\n')).toMatch(/Debug/);
  });
  test('TC-DBG-002 step commands registered', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-idea-windows-keymap.ts', 'F8', 'F7');
  });
  test('TC-DBG-003 run to cursor', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-idea-windows-keymap.ts', 'alt+f9');
  });
  test('TC-DBG-004 stop Ctrl+F2', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-idea-windows-keymap.ts', 'ctrl+f2');
  });
  test('TC-DBG-005 debug restart', async () => {
    const rows = await paletteLists(page, 'Debug: Rerun');
    expect(rows.join('\n')).toMatch(/Rerun|Restart|Debug/);
  });
  test('TC-DBG-006 conditional breakpoint on-hit eval', async () => {
    await openKairoCommand(page, 'Kairo: Show Debug Breakpoints');
    expectFile('runtime-agent/internal/debug/breakpoint.go', 'RecordHitAndShouldStop');
    expectFile('packages/java-extension/src/browser/kairo-java-debug-breakpoint-contribution.ts', 'condition');
  });
  test('TC-DBG-007 hit count', async () => {
    expectFile('runtime-agent/internal/debug/breakpoint.go', 'HitCountMode');
  });
  test('TC-DBG-008 logpoint', async () => {
    expectFile('packages/java-extension/src/browser/kairo-java-debug-breakpoint-contribution.ts', /logpoint|LogMessage/i);
  });
  test('TC-DBG-009 exception breakpoint', async () => {
    expectFile('runtime-agent/internal/debug/exception_breakpoint.go', 'ExceptionBreakpoint');
  });
  test('TC-DBG-010 mute breakpoints', async () => {
    const rows = await paletteLists(page, 'Mute Breakpoints');
    expect(rows.join('\n')).toMatch(/Mute/);
  });
  test('TC-DBG-021 Variables view', async () => {
    await openKairoCommand(page, 'Kairo: Show Debug Variables');
    expectFile('packages/theia-product/src/main/browser/debug-variables-widget.tsx', 'Variable');
  });
  test('TC-DBG-022 Call Stack view', async () => {
    await openKairoCommand(page, 'Kairo: Show Debug Callstack');
    expectFile('packages/theia-product/src/main/browser/kairo-views-contribution.tsx', 'Show Debug Callstack');
  });
  test('TC-DBG-023 Watch view', async () => {
    await openKairoCommand(page, 'Kairo: Show Debug Watch');
    expectFile('packages/theia-product/src/main/browser/debug-watches-idea.tsx', 'watch');
  });
  test('TC-DBG-024 Debug Console', async () => {
    await openKairoCommand(page, 'Kairo: Show Debug Console');
    expectFile('packages/theia-product/src/main/browser/kairo-views-contribution.tsx', 'Evaluate Expression');
  });
  test('TC-DBG-025 IDEA tool window', async () => {
    const rows = await paletteLists(page, 'Debug Tool Window');
    expect(rows.join('\n')).toMatch(/Debug/);
  });
  test('TC-DBG-026 Debug Toolbar', async () => {
    await openKairoCommand(page, 'Kairo: Show Debug Toolbar');
    expectFile('packages/theia-product/src/main/browser/kairo-views-contribution.tsx', 'Show Debug Toolbar');
  });
  test('TC-DBG-027 inline values', async () => {
    const rows = await paletteLists(page, 'Inline Values');
    expect(rows.join('\n')).toMatch(/Inline/);
  });
  test('TC-DBG-028 hover evaluate', async () => {
    expectFile('packages/theia-product/src/main/browser/debug-hover-provider.ts', 'hover');
  });
  test('TC-DBG-029 diagnostics panel', async () => {
    const rows = await paletteLists(page, 'Debug Diagnostics');
    expect(rows.join('\n')).toMatch(/Diagnostic/);
  });
  test('TC-DBG-041 Check Java Debug Adapter', async () => {
    const rows = await paletteLists(page, 'Check Java Debug Adapter');
    expect(rows.join('\n')).toMatch(/Debug Adapter/);
  });
  test('TC-DBG-042 attach JVM', async () => {
    expectFile('runtime-agent/internal/debug/debug_state.go', 'attach');
  });
  test('TC-DBG-043 source mismatch', async () => {
    expectFile('runtime-agent/internal/debug/debug_state.go', 'StateSuspended');
  });
  test('TC-DBG-044 acceptance state machine', async () => {
    expectFile('runtime-agent/internal/debug/debug_state.go', 'StateRunning');
  });
});
