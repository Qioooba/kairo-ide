const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const exe = process.argv[2] || 'G:/spaces/kairo-ide/apps/desktop/dist/run/Kairo.exe';
const outDir = 'G:/spaces/kairo-ide/artifacts/e2e-windows/diagnose';
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const userDataDir = path.join(outDir, 'userdata3');
  fs.mkdirSync(userDataDir, { recursive: true });
  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, KAIRO_DEV: '1', KAIRO_NO_DEVTOOLS: '1', KAIRO_USER_DATA_DIR: userDataDir },
    timeout: 120000,
  });
  const page = await app.firstWindow({ timeout: 90000 });
  page.on('dialog', d => { Promise.resolve(d.accept()).catch(() => {}); });
  await page.waitForSelector('#theia-statusBar', { timeout: 90000 });
  await page.waitForTimeout(12000);

  const info = await page.evaluate(() => {
    const out = { ok: false, error: null, total: 0, kairo: [], sample: [], bindingKeys: [] };
    try {
      const container = window.theia && window.theia.container;
      if (!container) {
        out.error = 'no window.theia.container';
        return out;
      }
      const map = container._bindingDictionary && container._bindingDictionary._map;
      if (!map) {
        out.error = 'no binding map';
        return out;
      }
      out.bindingKeys = Array.from(map.keys()).slice(0, 30).map(k => String(k));
      let registry = null;
      for (const [key] of map.entries()) {
        try {
          const svc = container.get(key);
          if (svc && typeof svc.getAllCommands === 'function' && typeof svc.executeCommand === 'function') {
            registry = svc;
            out.regKey = String(key);
            break;
          }
        } catch (_) {}
      }
      if (!registry) {
        // try common symbols
        for (const key of map.keys()) {
          if (String(key).includes('Command')) {
            try {
              const svc = container.get(key);
              out.tried = String(key);
              out.svcKeys = svc && Object.keys(svc).slice(0, 20);
              if (svc && typeof svc.getAllCommands === 'function') {
                registry = svc;
                out.regKey = String(key);
                break;
              }
            } catch (e) {
              out.errCmd = e.message;
            }
          }
        }
      }
      if (!registry) {
        out.error = 'CommandRegistry not resolved';
        return out;
      }
      const all = Array.from(registry.getAllCommands());
      out.ok = true;
      out.total = all.length;
      out.sample = all.filter(c => c && c.label).slice(0, 25).map(c => ({ id: c.id, label: c.label }));
      out.kairo = all.filter(c => c && (/kairo/i.test(c.id || '') || /kairo|导入|服务器/i.test(c.label || '')))
        .map(c => ({
          id: c.id,
          label: c.label,
          enabled: registry.isEnabled(c.id),
          visible: registry.isVisible(c.id),
        }));
      // Also try execute one harmless command
      out.hasImport = !!registry.getCommand('kairo.project.import');
      out.hasServers = !!registry.getCommand('kairo.view.servers');
    } catch (e) {
      out.error = e.stack || e.message;
    }
    return out;
  });

  fs.writeFileSync(path.join(outDir, 'registry.json'), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));

  // If registry has the command, execute Show Servers via evaluate
  if (info.hasServers) {
    const execResult = await page.evaluate(async () => {
      const container = window.theia.container;
      const map = container._bindingDictionary._map;
      let registry = null;
      for (const [key] of map.entries()) {
        try {
          const svc = container.get(key);
          if (svc && typeof svc.executeCommand === 'function' && typeof svc.getAllCommands === 'function') {
            registry = svc; break;
          }
        } catch (_) {}
      }
      try {
        await registry.executeCommand('kairo.view.servers');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    console.log('execute servers', execResult);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, 'after-servers.png') });
  }

  // Check why palette search returns empty — dump quick input filter internals
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-widget input', { timeout: 5000 });
  await page.keyboard.type('Kairo', { delay: 40 });
  await page.waitForTimeout(1000);
  const paletteState = await page.evaluate(() => {
    const widget = document.querySelector('.quick-input-widget');
    return {
      display: widget && getComputedStyle(widget).display,
      visibility: widget && getComputedStyle(widget).visibility,
      inputValue: widget && widget.querySelector('input') && widget.querySelector('input').value,
      listCount: document.querySelectorAll('.quick-input-widget .monaco-list-row').length,
      listHtml: (document.querySelector('.quick-input-widget .monaco-list') || {}).innerHTML?.slice(0, 500),
      message: (document.querySelector('.quick-input-widget .quick-input-message, .quick-input-widget .monaco-highlighted-label') || {}).textContent,
      allText: widget && widget.innerText.slice(0, 800),
    };
  });
  console.log('paletteState', JSON.stringify(paletteState, null, 2));
  await page.screenshot({ path: path.join(outDir, 'palette-kairo2.png') });

  try { await app.close(); } catch (_) {}
  try { app.process().kill(); } catch (_) {}
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
