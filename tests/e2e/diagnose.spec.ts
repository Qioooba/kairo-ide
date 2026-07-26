import { test } from './fixtures';

test('diagnose IDE state', async ({ page }) => {
  const { navigateToTheia, waitForTheiaShell } = await import('./fixtures');
  const logs: string[] = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[pageerror] ${err.message}\n${err.stack || ''}`));
  await navigateToTheia(page);
  await waitForTheiaShell(page);
  await page.waitForTimeout(3_000);

  // Try to open Explorer view via command palette
  await page.keyboard.press('F1');
  await page.waitForTimeout(1_000);
  await page.keyboard.type('View: Show Explorer');
  await page.waitForTimeout(1_000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3_000);

  const info = await page.evaluate(() => {
    const shell = document.querySelector('#theia-app-shell, #theia-shell, .theia-shell');
    const explorer = document.querySelector('.theia-Explorer, #explorer-view-container, .theia-Files');
    const treeNodes = document.querySelectorAll('.theia-TreeNode');
    const welcome = document.querySelector('.theia-welcome, .welcome-page');
    const title = document.title;
    // Find explorer-like containers
    const allIds = Array.from(document.querySelectorAll('[id]')).map(e => e.id).filter(id => /explorer|navigator|files/i.test(id));
    const allClasses = Array.from(new Set(Array.from(document.querySelectorAll('*')).flatMap(e => Array.from(e.classList)).filter(c => /explorer|navigator|files|sidebar|activity/i.test(c))));
    const sidePanel = document.querySelector('#theia-left-content, #theia-leftContent, .theia-left-content, .theia-app-sidebar-container');
    const mainPanel = document.querySelector('#theia-main-content, #theia-mainContent, .theia-main-content');
    // Activity bar icons
    const activityIcons = Array.from(document.querySelectorAll('.theia-ActivityBar .theia-ActivityBar-tab, .theia-sidebar-menu > *, [id*="navigator"], [id*="files"], [title="Explorer"], [title="Files"]')).map(e => ({
      tag: e.tagName,
      id: e.id,
      class: e.className,
      title: (e as HTMLElement).title,
      text: e.textContent?.trim().slice(0, 100) || '',
      dataCommand: (e as HTMLElement).dataset.command || '',
    }));
    // Sidebar menu items
    const sidebarMenus = Array.from(document.querySelectorAll('.theia-sidebar-menu')).map(menu => ({
      class: menu.className,
      items: Array.from(menu.children).map(item => ({
        tag: item.tagName,
        id: item.id,
        class: item.className,
        title: (item as HTMLElement).title,
        text: item.textContent?.trim().slice(0, 100) || '',
        dataCommand: (item as HTMLElement).dataset.command || '',
      })),
    }));
    // Full shell structure
    function describeEl(el: Element | null, depth = 0): unknown {
      if (!el) return null;
      const attrs: Record<string, string> = {};
      for (const a of el.attributes) attrs[a.name] = a.value;
      return {
        tag: el.tagName,
        id: el.id,
        class: el.className,
        childCount: el.children.length,
        text: el.textContent?.trim().slice(0, 80) || '',
        children: depth < 4 ? Array.from(el.children).map(c => describeEl(c, depth + 1)) : undefined,
      };
    }
    const shellStructure = shell ? describeEl(shell) : null;
    return {
      title,
      hasShell: !!shell,
      hasExplorer: !!explorer,
      treeNodeCount: treeNodes.length,
      firstTreeNodes: Array.from(treeNodes).slice(0, 10).map(n => n.textContent?.trim() || ''),
      hasWelcome: !!welcome,
      welcomeText: welcome?.textContent?.slice(0, 200) || '',
      matchingIds: allIds.slice(0, 20),
      matchingClasses: allClasses.slice(0, 40),
      leftPanelText: sidePanel?.textContent?.slice(0, 500) || '',
      mainPanelText: mainPanel?.textContent?.slice(0, 500) || '',
      shellStructure,
      activityIcons,
      sidebarMenus,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  const fs = await import('node:fs');
  const path = await import('node:path');
  const outDir = path.join(process.cwd(), 'test-results', 'diagnose');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'shell-info.json'), JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(outDir, 'diagnose.png'), fullPage: true });

  // Try clicking the Explorer icon directly
  await test.step('Click Explorer icon', async () => {
    const explorerSelectors = [
      '.theia-ActivityBar .theia-Explorer',
      '.theia-ActivityBar [id*="files"]',
      '.theia-ActivityBar [title="Explorer"]',
      '.theia-ActivityBar [title="Files"]',
      '.theia-sidebar-menu [title="Explorer"]',
      '.theia-sidebar-menu [title="Files"]',
      '[id="theia:navigator"]',
      '[id="theia:explorer"]',
    ];
    let clicked = false;
    for (const sel of explorerSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        clicked = true;
        console.log(`Clicked Explorer via ${sel}`);
        break;
      }
    }
    if (!clicked) {
      console.log('Could not find visible Explorer icon to click');
    }
    await page.waitForTimeout(3_000);
  });

  const afterClick = await page.evaluate(() => {
    const explorer = document.querySelector('.theia-Explorer, #explorer-view-container, .theia-Files');
    const treeNodes = document.querySelectorAll('.theia-TreeNode');
    const allClasses = Array.from(new Set(Array.from(document.querySelectorAll('*')).flatMap(e => Array.from(e.classList)).filter(c => /explorer|navigator|files|sidebar|activity/i.test(c))));
    const sidePanel = document.querySelector('#theia-left-content, #theia-leftContent, .theia-left-content, .theia-app-sidebar-container');
    return {
      hasExplorer: !!explorer,
      treeNodeCount: treeNodes.length,
      firstTreeNodes: Array.from(treeNodes).slice(0, 10).map(n => n.textContent?.trim() || ''),
      matchingClasses: allClasses.slice(0, 40),
      leftPanelText: sidePanel?.textContent?.slice(0, 500) || '',
    };
  });
  console.log('--- after click ---');
  console.log(JSON.stringify(afterClick, null, 2));

  console.log('--- console logs ---');
  for (const log of logs.slice(0, 50)) console.log(log);
});
