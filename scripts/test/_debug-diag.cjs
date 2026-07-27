const { _electron: electron } = require('playwright');
const path = require('path');

const EXE_PATH = path.join(__dirname, '..', '..', 'dist', 'win-unpacked', 'Kairo IDE.exe');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, THEIA_CONFIG_DIR: path.join(__dirname, 'theia-config-debug5') },
  });

  const page = await app.firstWindow();
  console.log('Window:', await page.title());
  await sleep(45000);

  const diag = await page.evaluate(() => {
    const result = { steps: [] };

    // Step 1: window.theia?.container
    let c1 = window.theia?.container;
    result.steps.push({ step: 'window.theia.container', exists: !!c1, hasMap: !!(c1 && c1._bindingDictionary?._map) });

    let container = c1;

    if (!container || !container._bindingDictionary?._map) {
      const shell = document.querySelector('.theia-ApplicationShell, .theia-container');
      result.steps.push({ step: 'shell query', found: !!shell });
      if (shell) {
        const c2a = shell.__inversify_container__;
        const c2b = Object.values(shell).find(v => v && v._bindingDictionary?._map);
        result.steps.push({ step: 'shell.__inversify_container__', exists: !!c2a, hasMap: !!(c2a && c2a._bindingDictionary?._map) });
        result.steps.push({ step: 'shell values scan', found: !!c2b, hasMap: !!(c2b && c2b._bindingDictionary?._map) });
        container = c2a || c2b || container;
      }
    }

    if (!container || !container._bindingDictionary?._map) {
      const all = document.querySelectorAll('*');
      let found = null;
      for (const el of all) {
        const c = el.__inversify_container__;
        if (c && c._bindingDictionary?._map && c._bindingDictionary._map.size > 100) { found = c; break; }
      }
      result.steps.push({ step: 'DOM scan', found: !!found, mapSize: found?._bindingDictionary?._map?.size });
      container = found || container;
    }

    result.hasContainer = !!(container && container._bindingDictionary?._map);
    result.mapSize = container?._bindingDictionary?._map?.size || 0;

    if (container && container._bindingDictionary?._map) {
      const map = container._bindingDictionary._map;
      let cmdSvcFound = false;
      for (const [key] of map.entries()) {
        if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
          try {
            const svc = container.get(key);
            if (svc && typeof svc.getAllCommands === 'function') {
              cmdSvcFound = true;
              window.__kairoCmdReg = svc;
              result.cmdSvcOk = true;
              // count commands
              let total = 0, kairo = 0;
              for (const c of svc.getAllCommands()) {
                if (!c) continue;
                total++;
                const l = (c.label||'').toLowerCase(), cat = (c.category||'').toLowerCase(), id = String(c.id||'').toLowerCase();
                if (l.includes('kairo:') || cat.includes('kairo') || id.startsWith('kairo.')) kairo++;
              }
              result.totalCmds = total;
              result.kairoCmds = kairo;
            } else {
              result.cmdSvcOk = false;
              result.cmdSvcType = typeof svc;
              result.cmdSvcHasGetAll = svc && typeof svc.getAllCommands;
            }
          } catch (e) {
            result.cmdSvcError = e.message;
          }
          break;
        }
      }
      result.cmdSvcFound = cmdSvcFound;
    }

    return result;
  });

  console.log(JSON.stringify(diag, null, 2));

  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
