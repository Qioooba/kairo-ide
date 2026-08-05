const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const exe = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  const runDir = path.join(repoRoot, 'artifacts', 'test-results', 'cmd-probe-full');
  const userDataDir = path.join(runDir, 'userdata');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const theiaConfigDir = path.join(userDataDir, 'theia-config');
  fs.mkdirSync(theiaConfigDir, { recursive: true });

  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, KAIRO_DEV: '1', THEIA_CONFIG_DIR: theiaConfigDir, KAIRO_USER_DATA_DIR: userDataDir },
    timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 90_000 });
  await page.waitForSelector('#theia-statusBar', { timeout: 90_000 });
  console.log('Shell loaded, waiting 12s for extensions...');
  await new Promise(r => setTimeout(r, 12000));

  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    if (!container) return { error: 'no container' };
    const map = container._bindingDictionary?._map;
    if (!map) return { error: 'no binding map' };

    let cmdReg = null;
    for (const [key] of map.entries()) {
      if (String(key) === 'Symbol(CommandService)') {
        try { cmdReg = container.get(key); } catch {}
        break;
      }
    }
    if (!cmdReg) return { error: 'no CommandService' };

    const allIds = [];
    const kairoIds = [];
    for (const [id, cmd] of cmdReg.commands.entries()) {
      const idStr = String(id);
      allIds.push(idStr);
      if (idStr.startsWith('kairo.') || /kairo/i.test(cmd?.label || '')) {
        kairoIds.push({ id: idStr, label: cmd?.label || '', category: cmd?.category || '' });
      }
    }

    // Also check activity bar
    const activityBar = {
      leftTabs: Array.from(document.querySelectorAll('.theia-app-left [role="tab"], .theia-app-left .p-TabBar-tab'))
        .map(el => el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent?.trim() || '')
        .filter(t => t)
    };

    // Check top menu bar items
    const menuBar = {
      items: Array.from(document.querySelectorAll('#theia-top-panel .p-MenuBar-item, .theia-top-panel [role="menuitem"]'))
        .map(el => el.textContent?.trim() || '')
        .filter(t => t)
    };

    return {
      totalCommands: allIds.length,
      kairoCommands: kairoIds,
      kairoCount: kairoIds.length,
      sampleCommands: allIds.slice(0, 50),
      activityBar,
      menuBar,
      windowTitle: document.title,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await page.screenshot({ path: path.join(runDir, 'probe.png'), fullPage: false });
  await app.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
