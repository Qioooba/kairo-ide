const { _electron: electron } = require('playwright');
const path = require('path');

const EXE_PATH = path.join(__dirname, '..', '..', 'dist', 'win-unpacked', 'Kairo IDE.exe');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('Launching:', EXE_PATH);
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: {
      ...process.env,
      KAIRO_DEV: '1',
      THEIA_CONFIG_DIR: path.join(__dirname, 'theia-config-quick'),
    },
  });

  const page = await app.firstWindow();
  console.log('Window title:', await page.title());

  // Wait for app to load
  await sleep(30000);

  // Try to resolve CommandRegistry
  console.log('\n=== Resolving CommandRegistry ===');
  const result = await page.evaluate(() => {
    // Method 1: Direct window.theia reference
    let container = window.theia?.container;
    let method = 'window.theia.container';

    // Method 2: Look for container on the application shell element
    if (!container || !container._bindingDictionary?._map) {
      const shell = document.querySelector('.theia-ApplicationShell, .theia-container, [data-theia-shell]');
      if (shell) {
        container = shell.__inversify_container__
          || Object.values(shell).find(v => v && v._bindingDictionary?._map)
          || null;
        method = 'shell element';
      }
    }

    // Method 3: Scan all elements for the container
    if (!container || !container._bindingDictionary?._map) {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const c = el.__inversify_container__;
        if (c && c._bindingDictionary?._map && c._bindingDictionary._map.size > 100) {
          container = c;
          method = 'DOM scan';
          break;
        }
      }
    }

    if (!container) return { found: false, method };
    const map = container._bindingDictionary._map;

    // Look for CommandService
    let cmdReg = null;
    for (const [key, binding] of map.entries()) {
      const keyStr = String(key);
      if (keyStr.includes('CommandService') || keyStr.includes('CommandRegistry')) {
        try {
          const svc = container.get(key);
          if (svc && svc.commands instanceof Map) {
            cmdReg = svc;
            break;
          }
        } catch (_) {}
      }
    }

    if (!cmdReg) {
      // Fallback: iterate all
      for (const [key, binding] of map.entries()) {
        try {
          const svc = container.get(key);
          if (svc && typeof svc === 'object' && svc.commands instanceof Map) {
            cmdReg = svc;
            break;
          }
        } catch (_) {}
      }
    }

    if (!cmdReg) return { found: false, method, mapSize: map.size };

    // Collect some command info
    const total = cmdReg.commands.size;
    const kairoLabels = [];
    const fileLabels = [];
    const editLabels = [];
    for (const [id, cmd] of cmdReg.commands.entries()) {
      const label = cmd?.label || '';
      const cat = cmd?.category || '';
      if (label.toLowerCase().includes('kairo:') || cat.toLowerCase().includes('kairo')) {
        kairoLabels.push(`${cat}: ${label}`);
      }
      if (label === 'New File' || cat === 'File') fileLabels.push(label);
      if (label === 'Undo' || cat === 'Edit') editLabels.push(label);
    }

    return {
      found: true,
      method,
      totalCommands: total,
      kairoCount: kairoLabels.length,
      kairoSample: kairoLabels.slice(0, 10),
      fileSample: fileLabels.slice(0, 10),
      editSample: editLabels.slice(0, 10),
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
