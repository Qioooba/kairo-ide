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
      THEIA_CONFIG_DIR: path.join(__dirname, 'theia-config-quick3'),
    },
  });

  const page = await app.firstWindow();
  console.log('Window title:', await page.title());

  await sleep(40000);

  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    if (!container || !container._bindingDictionary?._map) return { error: 'no container' };
    const map = container._bindingDictionary._map;

    // Find Symbol keys specifically
    const symbolKeys = [];
    let cmdReg = null;
    for (const [key, binding] of map.entries()) {
      if (typeof key === 'symbol') {
        const desc = key.toString();
        symbolKeys.push(desc);
        if (desc.includes('Command')) {
          try {
            const svc = container.get(key);
            if (svc && svc.commands instanceof Map) {
              cmdReg = svc;
              symbolKeys.push(`  -> ${desc} RESOLVED with commands Map size=${svc.commands.size}`);
            }
          } catch (e) {}
        }
      }
    }

    // Also look for any service with .commands Map
    const cmdLike = [];
    if (!cmdReg) {
      for (const [key, binding] of map.entries()) {
        try {
          const svc = container.get(key);
          if (svc && svc.commands instanceof Map && svc.commands.size > 50) {
            cmdLike.push({
              keyType: typeof key,
              keyStr: typeof key === 'symbol' ? key.toString() : (typeof key === 'function' ? `class ${key.name}` : String(key).slice(0, 100)),
              cmdSize: svc.commands.size,
              hasRegister: typeof svc.registerCommand === 'function',
              hasExecute: typeof svc.executeCommand === 'function',
            });
            if (cmdLike.length >= 10) break;
          }
        } catch (_) {}
      }
    }

    // Check if FrontendApplication has commands
    let faCommands = null;
    for (const [key, binding] of map.entries()) {
      if (typeof key === 'function' && key.name === 'FrontendApplication') {
        try {
          const svc = container.get(key);
          faCommands = {
            has: !!svc.commands,
            size: svc.commands?.commands?.size || svc.commands?.size || 0,
            cmdsType: svc.commands ? svc.commands.constructor.name : null,
          };
        } catch (e) { faCommands = { error: e.message }; }
        break;
      }
    }

    return {
      mapSize: map.size,
      symbolKeyCount: symbolKeys.length,
      symbolCmdHits: symbolKeys.filter(s => s.includes('Command')),
      cmdRegFound: !!cmdReg,
      cmdRegSize: cmdReg?.commands?.size || 0,
      cmdLike,
      faCommands,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
