// Quick probe: launch exe and check what's on window
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const exe = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  const runDir = path.join(repoRoot, 'artifacts', 'test-results', 'window-probe');
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
  console.log('Window title:', await page.title());
  await page.waitForSelector('#theia-statusBar, .theia-statusBar', { timeout: 60_000 });
  await new Promise(r => setTimeout(r, 5000));

  // Check what's on window
  const info = await page.evaluate(() => {
    const keys = Object.keys(window).filter(k => {
      try { return typeof window[k] !== 'undefined' && (k.toLowerCase().includes('theia') || k.toLowerCase().includes('command') || k === 'require' || k === 'monaco'); }
      catch { return false; }
    });
    const result = { theiaKeys: keys };
    // Check if there's a theia object and its keys
    if (window.theia) {
      result.theiaType = typeof window.theia;
      result.theiaKeys = Object.keys(window.theia).slice(0, 50);
    }
    // Check for __THEIA__ or other global
    for (const k of Object.getOwnPropertyNames(window)) {
      if (/theia|container|command/i.test(k) && typeof window[k] === 'object' && window[k] !== null) {
        try {
          const keys2 = Object.keys(window[k] || {}).slice(0, 20);
          result['global:' + k] = { type: typeof window[k], keys: keys2 };
        } catch {}
      }
    }
    // Check for monaco
    if (window.monaco) {
      result.monaco = typeof window.monaco;
      if (window.monaco.editor) result.monacoEditor = true;
    }
    // Check for require
    result.hasRequire = typeof window.require === 'function';
    result.hasNodeRequire = typeof require !== 'undefined';
    // Look for CommandRegistry in the DOM or via Theia's container
    const allScripts = Array.from(document.querySelectorAll('script')).length;
    result.scriptCount = allScripts;
    // Try to get the command registry via the Theia application
    try {
      // In Theia, the FrontendApplication is available via the DOM
      const appShell = document.querySelector('.theia-ApplicationShell, #theia-app-shell');
      result.hasAppShell = !!appShell;
    } catch(e) { result.appShellError = e.message; }
    return result;
  });

  console.log(JSON.stringify(info, null, 2));

  await app.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
