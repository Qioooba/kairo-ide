const { _electron: electron } = require('playwright');
const path = require('path');

const EXE_PATH = path.join(__dirname, '..', '..', 'dist', 'win-unpacked', 'Kairo IDE.exe');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, KAIRO_DEV: '1', THEIA_CONFIG_DIR: path.join(__dirname, 'theia-config-quick5') },
  });

  const page = await app.firstWindow();
  await sleep(40000);

  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    const map = container._bindingDictionary._map;

    // Get Symbol(CommandService)
    let cmdSvcKey = null;
    for (const [key] of map.entries()) {
      if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
        cmdSvcKey = key;
        break;
      }
    }
    const svc = container.get(cmdSvcKey);

    // List all properties of the service
    const props = [];
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(svc) || {})) {
      if (k !== 'constructor') props.push(k);
    }
    const ownProps = Object.getOwnPropertyNames(svc);
    const symbols = Object.getOwnPropertySymbols(svc);

    // Check for any property that is or contains a commands Map
    const cmdContaining = [];
    for (const key of Object.keys(svc)) {
      try {
        const val = svc[key];
        if (val instanceof Map) {
          cmdContaining.push({ key, type: 'Map', size: val.size });
        } else if (val && typeof val === 'object' && val.commands instanceof Map) {
          cmdContaining.push({ key, type: 'has .commands', size: val.commands.size });
        }
      } catch (_) {}
    }

    // Deep scan: recursively look for .commands Map
    function findCommandsMap(obj, depth, visited, path) {
      if (depth > 4 || !obj || typeof obj !== 'object') return null;
      if (visited.has(obj)) return null;
      visited.add(obj);
      if (obj.commands instanceof Map && obj.commands.size > 50) {
        return { path, size: obj.commands.size };
      }
      // Also check if it IS a Map
      if (obj instanceof Map && obj.size > 50) {
        // Check a few entries for command-like keys
        let looksLikeCommands = false;
        let sampleKeys = [];
        let count = 0;
        for (const [k, v] of obj.entries()) {
          count++;
          if (count <= 5) sampleKeys.push(String(typeof k === 'symbol' ? k.toString() : k).slice(0, 60));
          if (v && typeof v === 'object' && (v.label || v.handler)) looksLikeCommands = true;
          if (count > 20) break;
        }
        if (looksLikeCommands) return { path: path + '(Map itself)', size: obj.size, sampleKeys };
      }
      for (const k of Object.keys(obj)) {
        try {
          const r = findCommandsMap(obj[k], depth+1, visited, path + k + '.');
          if (r) return r;
        } catch (_) {}
      }
      return null;
    }

    const found = findCommandsMap(svc, 0, new Set(), 'svc.');

    // Also try looking for CommandRegistry symbol directly
    let cmdRegKey = null;
    for (const [key] of map.entries()) {
      if (typeof key === 'symbol') {
        const s = key.toString();
        if (s.includes('CommandRegistry')) {
          cmdRegKey = s;
          break;
        }
      }
    }

    return {
      svcConstructor: svc.constructor.name,
      prototypeProps: props,
      ownProps,
      symbolCount: symbols.length,
      cmdContaining,
      deepFind: found,
      cmdRegSymbol: cmdRegKey,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
