const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const exe = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  const runDir = path.join(repoRoot, 'artifacts', 'test-results', 'window-probe2');
  const userDataDir = path.join(runDir, 'userdata');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const theiaConfigDir = path.join(userDataDir, 'theia-config');
  fs.mkdirSync(theiaConfigDir, { recursive: true });

  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, KAIRO_DEV: '1', THEIA_CONFIG_DIR: theiaConfigDir, KAIRO_USER_DATA_DIR: userDataDir },
    timeout: 60_000,
  });
  console.log('Launched pid=', app.process().pid);
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForSelector('#theia-statusBar, .theia-statusBar', { timeout: 60_000 });
  await new Promise(r => setTimeout(r, 6000));

  const info = await page.evaluate(() => {
    const result = {};
    const theia = window.theia;
    if (!theia || !theia.container) return { error: 'no theia.container' };

    const container = theia.container;
    result.containerType = typeof container;
    result.containerKeys = typeof container === 'object' ? Object.keys(container).slice(0, 20) : [];

    // Try to get CommandRegistry from container
    try {
      // InversifyJS container has get/getAll methods
      let cmdReg = null;
      try {
        // Try getting by symbol or class
        // Theia uses Symbol('CommandRegistry') - try getAll
        if (typeof container.getAll === 'function') {
          // Try common service identifiers used by Theia
          // InversifyJS uses Symbol or string as identifiers
          // Let's see what services are available
          result.hasGetAll = true;
        }
        if (typeof container.get === 'function') {
          result.hasGet = true;
        }
        // Try getting the FrontendApplication which holds the shell
        let app2 = null;
        try {
          // Try symbol-based lookups
          const services = [];
          // Check if container has _bindingDictionary or similar
          if (container._bindingDictionary) {
            const keys = [];
            if (container._bindingDictionary._map) {
              for (const k of container._bindingDictionary._map.keys()) {
                keys.push(String(k).slice(0, 80));
              }
            }
            result.bindingCount = keys.length;
            result.bindingSample = keys.slice(0, 30);
          }
        } catch(e) { result.bindingsError = e.message; }
      } catch(e) { result.cmdRegError = e.message; }
    } catch(e) { result.containerError = e.message; }
    return result;
  });

  console.log(JSON.stringify(info, null, 2));

  // Now try to get command count via a different approach
  const cmdInfo = await page.evaluate(() => {
    // The quick open / command palette registers commands
    // Try Monaco's command registry or Theia's KeybindingRegistry
    try {
      // Look for command-related DOM elements that might give us info
      const quickInput = document.querySelector('.quick-input-widget');
      return {
        hasQuickInputWidget: !!quickInput,
        quickInputVisible: quickInput ? !quickInput.classList.contains('hidden') && quickInput.offsetParent !== null : false,
        // Try to find Theia command registry service
        // Theia stores services on the container and the frontend application
        // Let's try accessing via the Inversify container
        containerKeys: window.theia?.container ? Object.getOwnPropertyNames(Object.getPrototypeOf(window.theia.container)).slice(0, 20) : [],
      };
    } catch(e) { return { error: e.message }; }
  });
  console.log('CMD info:', JSON.stringify(cmdInfo, null, 2));

  // Let's open command palette with Ctrl+Shift+P and see what's there
  await page.keyboard.press('Control+Shift+P');
  await new Promise(r => setTimeout(r, 1000));

  const paletteInfo = await page.evaluate(() => {
    const input = document.querySelector('.quick-input-widget input[type="text"]');
    const rows = document.querySelectorAll('.quick-input-list .monaco-list-row, .monaco-list .monaco-list-row');
    return {
      hasInput: !!input,
      inputPlaceholder: input ? input.getAttribute('aria-label') || input.getAttribute('placeholder') : null,
      rowCount: rows.length,
      firstRows: Array.from(rows).slice(0, 10).map(r => r.textContent.trim().slice(0, 80)),
    };
  });
  console.log('Palette:', JSON.stringify(paletteInfo, null, 2));

  // Type 'kairo' to see Kairo commands
  if (paletteInfo.hasInput) {
    const input = await page.$('.quick-input-widget input[type="text"]');
    await input.type('kairo', { delay: 50 });
    await new Promise(r => setTimeout(r, 1500));

    const kairoInfo = await page.evaluate(() => {
      const rows = document.querySelectorAll('.quick-input-list .monaco-list-row, .monaco-list .monaco-list-row');
      return {
        rowCount: rows.length,
        rows: Array.from(rows).slice(0, 20).map(r => r.textContent.trim().slice(0, 100)),
      };
    });
    console.log('Kairo commands:', JSON.stringify(kairoInfo, null, 2));
  }

  await page.keyboard.press('Escape');
  await app.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
