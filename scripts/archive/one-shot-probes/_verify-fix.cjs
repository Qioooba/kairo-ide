const { _electron: electron } = require('playwright');
const path = require('path');

const EXE_PATH = path.join(__dirname, '..', '..', 'dist', 'win-unpacked', 'Kairo IDE.exe');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 15; attempt++) {
    const found = await page.evaluate(() => {
      let container = window.theia?.container;
      if (!container || !container._bindingDictionary?._map) {
        const shell = document.querySelector('.theia-ApplicationShell, .theia-container');
        if (shell) container = shell.__inversify_container__ || Object.values(shell).find(v => v && v._bindingDictionary?._map) || null;
      }
      if (!container || !container._bindingDictionary?._map) {
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const c = el.__inversify_container__;
          if (c && c._bindingDictionary?._map && c._bindingDictionary._map.size > 100) { container = c; break; }
        }
      }
      if (!container || !container._bindingDictionary?._map) return false;
      const map = container._bindingDictionary._map;
      for (const [key] of map.entries()) {
        if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
          try {
            const svc = container.get(key);
            if (svc && typeof svc.getAllCommands === 'function' && typeof svc.registerCommand === 'function') {
              window.__kairoCmdReg = svc;
              return true;
            }
          } catch (_) {}
        }
      }
      for (const [key] of map.entries()) {
        try {
          const svc = container.get(key);
          if (svc && typeof svc.getAllCommands === 'function' && typeof svc.registerCommand === 'function') {
            window.__kairoCmdReg = svc;
            return true;
          }
        } catch (_) {}
      }
      return false;
    });
    if (found) return true;
    await sleep(1500);
  }
  return false;
}

async function hasCommand(page, label) {
  await ensureCmdReg(page);
  return page.evaluate((lbl) => {
    const reg = window.__kairoCmdReg;
    if (!reg) return null;
    const want = lbl.toLowerCase();
    for (const c of reg.getAllCommands()) {
      if (!c) continue;
      if ((c.label||'').toLowerCase().includes(want) || (c.category||'').toLowerCase().includes(want) || String(c.id||'').toLowerCase().includes(want)) return c.id;
    }
    return null;
  }, label);
}

(async () => {
  console.log('Launching...');
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, KAIRO_DEV: '1', THEIA_CONFIG_DIR: path.join(__dirname, 'theia-config-verify') },
  });

  const page = await app.firstWindow();
  console.log('Window:', await page.title());
  console.log('Waiting for app to fully load (40s)...');
  await sleep(40000);

  console.log('\n=== Resolving CommandRegistry ===');
  const ok = await ensureCmdReg(page);
  console.log('ensureCmdReg:', ok);

  if (ok) {
    const testCmds = [
      'New File', 'Open File', 'Save',
      'Import Project', 'Select Project', 'Build',
      'Start Server', 'Debug Server',
      'Undo', 'Redo', 'Find', 'Replace',
      'Command Palette', 'Explorer', 'Search',
      'Terminal', 'Output', 'Problems',
      'Debug: Start', 'Step Over',
      'Show Servers', 'Show Builds', 'Show Deployments',
    ];
    console.log('\n=== Testing command lookups ===');
    for (const cmd of testCmds) {
      const hit = await hasCommand(page, cmd);
      console.log(`  ${hit ? '✓' : '✗'} "${cmd}" -> ${hit || 'NOT FOUND'}`);
    }

    // Count total and Kairo commands
    const counts = await page.evaluate(() => {
      const reg = window.__kairoCmdReg;
      let total = 0, kairo = 0;
      for (const c of reg.getAllCommands()) {
        if (!c) continue;
        total++;
        const l = (c.label||'').toLowerCase(), cat = (c.category||'').toLowerCase(), id = String(c.id||'').toLowerCase();
        if (l.includes('kairo:') || cat.includes('kairo') || id.startsWith('kairo.')) kairo++;
      }
      return { total, kairo };
    });
    console.log(`\nTotal commands: ${counts.total}, Kairo commands: ${counts.kairo}`);
  }

  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
