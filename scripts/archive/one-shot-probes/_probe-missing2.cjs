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

  // Find container - same method as in full-test-driver
  await page.evaluate(() => {
    if (window.theia && window.theia.container) {
      window.__kairoContainer = window.theia.container;
      return;
    }
    const shell = document.querySelector('.theia-ApplicationShell, #theia-app-shell, [id*="ApplicationShell"]');
    if (shell) {
      const kk = Object.keys(shell).filter(k => k.startsWith('__inversify'));
      for (const k of kk) {
        try { window.__kairoContainer = shell[k]; return; } catch(_){}
      }
    }
    for (let i = 0; i < 99999; i++) {
      const el = document.querySelector(`[data-theia-zone-id="${i}"]`);
      if (!el) break;
      const keys = Object.keys(el).filter(k => k.startsWith('__inversify'));
      for (const k of keys) {
        try { window.__kairoContainer = el[k]; return; } catch(_){}
      }
    }
    const allEls = document.querySelectorAll('*');
    let found = null;
    for (const el of allEls) {
      const kk = Object.keys(el).filter(k => k.startsWith('__inversify'));
      for (const k of kk) {
        try {
          const c = el[k];
          if (c && typeof c === 'object') {
            const symK = Object.getOwnPropertySymbols(c);
            if (symK.length > 50) { found = c; break; }
          }
        } catch(_){}
      }
      if (found) break;
    }
    window.__kairoContainer = found;
  });

  const cmdInfo = await page.evaluate(() => {
    const container = window.__kairoContainer;
    let cmdReg = null;
    if (container) {
      for (const k of Object.getOwnPropertySymbols(container)) {
        try {
          const b = container[k];
          if (b && b._binding) {
            const svcId = String(b._binding.serviceIdentifier);
            if (svcId.includes('CommandService')) {
              cmdReg = b._binding.cache?.value;
              break;
            }
          }
        } catch(_){}
      }
    }
    if (!cmdReg) return { error: 'cmdReg not found' };
    if (typeof cmdReg.getAllCommands !== 'function') return { error: 'getAllCommands not found', type: typeof cmdReg.getAllCommands };
    const all = cmdReg.getAllCommands();

    // Search for specific commands
    const searches = [
      'quick open', 'go to file', 'file search', 'open file', 'workspace',
      'welcome', 'get started', 'start', 'home',
      'dev tools', 'developer tools', 'toggle dev', 'inspect', 'electron',
      'save', 'save file',
      'deploy',
      'output', 'output channel'
    ];

    const results = {};
    for (const s of searches) {
      const matches = [];
      for (const c of all) {
        if (!c) continue;
        const labelStr = String(c.label || '').toLowerCase();
        const catStr = String(c.category || '').toLowerCase();
        const idStr = String(c.id || '').toLowerCase();
        const allStr = labelStr + ' ' + catStr + ' ' + idStr;
        if (allStr.includes(s)) {
          matches.push({ id: c.id, label: c.label, category: c.category });
        }
      }
      results[s] = matches.slice(0, 8);
    }

    // Also list all File category and Help category commands
    const fileCmds = [];
    const helpCmds = [];
    const viewCmds = [];
    for (const c of all) {
      if (!c) continue;
      const catStr = String(c.category || '').toLowerCase();
      if (catStr === 'file' || c.id === 'file.open') fileCmds.push({ id: c.id, label: c.label });
      if (catStr === 'help') helpCmds.push({ id: c.id, label: c.label });
      if (catStr === 'view') viewCmds.push({ id: c.id, label: c.label });
    }

    return { results, total: all.length, fileCmds, helpCmds, viewCmds };
  });

  console.log('=== ERROR? ===');
  if (cmdInfo.error) { console.log(cmdInfo); return; }

  console.log('=== SEARCH RESULTS ===');
  for (const [key, matches] of Object.entries(cmdInfo.results)) {
    console.log(`\n--- Search "${key}" ---`);
    if (matches.length === 0) console.log('  (no matches)');
    for (const m of matches) console.log(`  id="${m.id}" label="${m.label}" cat="${m.category}"`);
  }
  console.log(`\nTotal commands: ${cmdInfo.total}`);
  console.log('\n=== File category commands ===');
  for (const c of cmdInfo.fileCmds) console.log(`  id="${c.id}" label="${c.label}"`);
  console.log('\n=== Help category commands ===');
  for (const c of cmdInfo.helpCmds) console.log(`  id="${c.id}" label="${c.label}"`);
  console.log('\n=== View category commands (first 30) ===');
  for (const c of cmdInfo.viewCmds.slice(0, 30)) console.log(`  id="${c.id}" label="${c.label}"`);

  await app.close();
})();
