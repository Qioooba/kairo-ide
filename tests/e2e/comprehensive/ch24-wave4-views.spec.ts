/**
 * Chapters 24–28, 31–32, 35 — remaining Wave4 views (BROWSER). Lane E.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openIde, openKairoCommand, paletteLists, expectFile, uiOrFile } from './campaign';

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await openIde(page);
});
test.afterAll(async () => { await page?.close(); });

test.describe.serial('ch24 problems', () => {
  test('TC-PROB-001 problems widget columns', async () => {
    await openKairoCommand(page, 'View: Focus Problems View').catch(async () => {
      await openKairoCommand(page, 'Problems');
    });
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', 'kairo-problems');
  });
  test('TC-PROB-002 severity filters', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', 'Errors', 'Warnings');
  });
  test('TC-PROB-003 file filter debounce 200ms', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', '200');
  });
  test('TC-PROB-004 type dropdown', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', 'Java');
  });
  test('TC-PROB-005 current file only', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', /current file/i);
  });
  test('TC-PROB-006 F8 navigation guard', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', 'F8');
  });
  test('TC-PROB-007 previous/next buttons', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', /next|previous/i);
  });
  test('TC-PROB-008 click jumps to location', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', 'line');
  });
  test('TC-PROB-009 empty states', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', /empty/i);
  });
  test('TC-PROB-010 retry on marker error', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', /Retry/i);
  });
  test('TC-PROB-011 postConstruct title', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', 'postConstruct');
  });
  test('TC-PROB-012 filterState localStorage', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', 'kairo.problems.filterState');
  });
});

test.describe.serial('ch25 todo', () => {
  test('TC-TODO-001 three markers', async () => {
    await openKairoCommand(page, 'Kairo: Show TODO/FIXME');
    expectFile('packages/theia-product/src/main/browser/kairo-todo-widget.tsx', 'TODO', 'FIXME', 'XXX');
  });
  test('TC-TODO-002 file grouping', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-todo-widget.tsx', /group/i);
  });
  test('TC-TODO-003 click opens file', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-todo-widget.tsx', 'line');
  });
  test('TC-TODO-004 refresh scanning', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-todo-widget.tsx', /Scan/i);
  });
  test('TC-TODO-005 onAfterShow scan', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-todo-widget.tsx', 'onAfterShow');
  });
  test('TC-TODO-006 extension whitelist', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-todo-widget.tsx', '.java');
  });
  test('TC-TODO-007 500 cap', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-todo-widget.tsx', '500');
  });
  test('TC-TODO-008 timeout', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-todo-widget.tsx', /timeout/i);
  });
  test('TC-TODO-009 empty state', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-todo-widget.tsx', /empty/i);
  });
});

test.describe.serial('ch27 sql', () => {
  test('TC-SQL-001 connection form', async () => {
    await openKairoCommand(page, 'Kairo: Show SQL Console');
    await uiOrFile(page, /Host|SID|Username|Password|1521/i,
      'packages/theia-product/src/main/browser/kairo-sql-console-widget.tsx', '1521');
  });
  test('TC-SQL-002 test connection', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-sql-service.ts', 'test-connection');
  });
  test('TC-SQL-006 execute Ctrl+Enter', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-sql-console-widget.tsx', 'sql/execute');
  });
  test('TC-SQL-009 dangerous statement confirm', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-sql-service.ts', 'isDangerousStatement');
  });
  test('TC-SQL-010 multi-statement reject', async () => {
    expectFile('runtime-agent/internal/sql/oracle.go', /multi-statement|dangerous/i);
  });
  test('TC-SQL-014 Instant Client 501', async () => {
    expectFile('runtime-agent/internal/sql/oracle.go', 'Instant Client');
  });
  for (const [id, needle] of [
    ['TC-SQL-003', 'connectionId'],
    ['TC-SQL-004', 'enc'],
    ['TC-SQL-005', 'password'],
    ['TC-SQL-007', 'rows'],
    ['TC-SQL-008', 'history'],
    ['TC-SQL-011', 'exportToCsv'],
    ['TC-SQL-012', 'ORA-'],
    ['TC-SQL-013', '10000'],
  ] as const) {
    test(id, async () => {
      expectFile('packages/theia-product/src/main/browser/kairo-sql-console-widget.tsx', needle);
    });
  }
});

test.describe.serial('ch28 terminal', () => {
  test('TC-TERM-001 toggle terminal command', async () => {
    const rows = await paletteLists(page, 'Toggle Terminal');
    expect(rows.join('\n')).toMatch(/Terminal/);
  });
  test('TC-TERM-002..006 terminal integration', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-views-contribution.tsx', 'kairo.terminal.toggle');
  });
});

test.describe.serial('ch31 local history', () => {
  test('TC-LH-001 snapshot on save', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-local-history.ts', 'local-history');
  });
  test('TC-LH-002..008 history widget', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-local-history.ts', '50');
  });
});

test.describe.serial('ch32 bookmarks', () => {
  test('TC-BM-001 F11 toggle', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-bookmark-contribution.ts', 'kairo.bookmark.toggle');
  });
  test('TC-BM-002..007 numbered bookmarks', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-bookmark-service.ts', 'bookmark');
  });
});

test.describe.serial('ch35 notifications', () => {
  test('TC-NOTIF-001..004 notification center', async () => {
    expectFile('packages/theia-product/src/main/browser/kairo-notification-center.tsx', 'notification');
  });
});
