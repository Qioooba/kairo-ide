const { _electron: electron } = require('playwright');
const path = require('path');

const EXE_PATH = path.join(__dirname, '..', '..', 'dist', 'win-unpacked', 'Kairo IDE.exe');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, KAIRO_DEV: '1', THEIA_CONFIG_DIR: path.join(__dirname, 'theia-config-quick4') },
  });

  const page = await app.firstWindow();
  await sleep(40000);

  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    const map = container._bindingDictionary._map;

    // Find Symbol(CommandService) binding
    let cmdKey = null;
    for (const [key] of map.entries()) {
      if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
        cmdKey = key;
        break;
      }
    }

    if (!cmdKey) return { error: 'CommandService symbol key not found' };

    // Try to get it
    let getResult = null;
    let getError = null;
    try {
      getResult = container.get(cmdKey);
    } catch (e) {
      getError = e.message;
    }

    // Check the binding itself
    const binding = map.get(cmdKey);
    const bindingInfo = {
      type: binding?.[0]?.constructor?.name,
      hasOnActivation: !!binding?.[0]?.onActivation,
      hasCache: binding?.[0]?.cache !== undefined,
      implType: binding?.[0]?.implementationType?.name,
    };

    // Also try getAll
    let allResults = [];
    try {
      allResults = container.getAll(cmdKey);
    } catch (e) {}

    // Try resolve
    let resolveResult = null;
    let resolveError = null;
    try {
      if (container.resolve) {
        // Don't know the class, skip
      }
    } catch (e) { resolveError = e.message; }

    // Check if maybe CommandService is a different symbol name?
    // Let's try container.getNamed or getTagged? No.
    // Check window.theia for direct references
    const theiaKeys = Object.keys(window.theia || {}).filter(k => {
      try { return k.toLowerCase().includes('command'); } catch { return false; }
    });

    // Check all services that ARE resolved
    const resolvedServices = [];
    let counter = 0;
    for (const [key] of map.entries()) {
      counter++;
      try {
        const svc = container.get(key);
        if (svc && typeof svc === 'object' && svc.commands instanceof Map) {
          resolvedServices.push({
            keyType: typeof key,
            keyStr: typeof key === 'symbol' ? key.toString() : (key?.name || String(key).slice(0,80)),
            cmdSize: svc.commands.size,
          });
        }
      } catch (_) {}
    }

    return {
      cmdKeyFound: !!cmdKey,
      getError,
      getResultType: getResult ? typeof getResult : null,
      getResultConstructor: getResult?.constructor?.name || null,
      getResultHasCommands: getResult?.commands instanceof Map,
      bindingInfo,
      getAllCount: allResults.length,
      theiaCmdKeys: theiaKeys,
      resolvedServices,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
