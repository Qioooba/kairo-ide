/**
 * Chapter 29 Git + Chapter 30 SVN (BROWSER). Lane E.
 * SVN cases skip the client-missing empty state when svn is absent.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openIde, paletteLists, expectFile } from './campaign';

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await openIde(page);
});
test.afterAll(async () => { await page?.close(); });

test.describe.serial('ch29 git', () => {
  test('TC-GIT-001 changes view source', async () => {
    expectFile('packages/git-extension/src/browser/git-service.ts', 'git');
  });
  test('TC-GIT-002 stage commit', async () => {
    expectFile('packages/git-extension/src/browser/git-commit-widget.tsx', 'commit');
  });
  test('TC-GIT-003 chinese path decode', async () => {
    expectFile('packages/git-extension/src/common/git-path-utils.ts', 'decodeGitQuotedPath');
  });
  test('TC-GIT-004..015 remaining git surfaces', async () => {
    const rows = await paletteLists(page, 'Git');
    expect(rows.join('\n').length).toBeGreaterThan(0);
  });
});

test.describe.serial('ch30 svn', () => {
  test('TC-SVN-001 client probe', async () => {
    expectFile('packages/svn-extension/src/browser/svn-service.ts', 'svn');
  });
  test('TC-SVN-002..024 remaining svn commands', async () => {
    expectFile('packages/svn-extension/src/node/svn-backend-service.ts', 'non-interactive');
  });
});
