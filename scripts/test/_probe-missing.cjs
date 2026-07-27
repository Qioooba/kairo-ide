const { _electron: electron } = require('playwright');
const path = require('path');

const EXE_PATH = path.join(__dirname, '../../dist/win-unpacked/Kairo IDE.exe');

(async () => {
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, KAIRO_DEV: '1', THEIA_CONFIG_DIR: path.join(__dirname, 'test-run/theia-config') },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(25000);

  await page.evaluate(() => {
    for (let i = 0; i < 99999; i++) {
      const el = document.querySelector(`[data-theia-zone-id="${i}"]`);
      if (!el) break;
      const keys = Object.keys(el).filter(k => k.startsWith('__inversify'));
      for (const k of keys) {
        try { window.__kairoContainer = el[k]; break; } catch(_){}
      }
    }
  });

  const results = await page.evaluate(() => {
    const container = window.__kairoContainer;
    let cmdReg = null;
    if (container) {
      for (const k of Object.getOwnPropertySymbols(container)) {
        try {
          const bindingWhenOnSyntax = container[k];
          if (bindingWhenOnSyntax && bindingWhenOnSyntax._binding) {
            const svcId = String(bindingWhenOnSyntax._binding.serviceIdentifier);
            if (svcId.includes('CommandService')) {
              cmdReg = bindingWhenOnSyntax._binding.cache?.value;
              break;
            }
          }
        } catch(_){}
      }
    }
    if (!cmdReg || typeof cmdReg.getAllCommands !== 'function') {
      return { error: 'CmdReg not found' };
    }
    const all = cmdReg.getAllCommands();
    const search = ['Command Palette', 'Go to File', 'Welcome', 'Developer Tools', 'Save', 'Debug Server', 'Deploy', 'Output', 'Runtime', 'Import Project', 'Select Project'];
    const found = {};
    for (const s of search) {
      const matches = [];
      for (const c of all) {
        if (!c) continue;
        const labelStr = String(c.label || '').toLowerCase();
        const catStr = String(c.category || '').toLowerCase();
        const idStr = String(c.id || '').toLowerCase();
        if (labelStr.includes(s.toLowerCase()) || catStr.includes(s.toLowerCase()) || idStr.includes(s.toLowerCase())) {
          matches.push({ id: c.id, label: c.label, category: c.category });
        }
      }
      found[s] = matches.slice(0, 5);
    }
    return { found, total: all.length };
  });

  console.log(JSON.stringify(results, null, 2));
  await app.close();
})();
