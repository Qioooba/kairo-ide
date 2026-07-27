const { _electron: electron } = require('playwright');
const path = require('path');

const EXE_PATH = path.join(__dirname, '..', '..', 'dist', 'win-unpacked', 'Kairo IDE.exe');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, KAIRO_DEV: '1', THEIA_CONFIG_DIR: path.join(__dirname, 'theia-config-quick7') },
  });

  const page = await app.firstWindow();
  await sleep(40000);

  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    const map = container._bindingDictionary._map;

    let cmdKey = null;
    for (const [key] of map.entries()) {
      if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
        cmdKey = key;
        break;
      }
    }
    const svc = container.get(cmdKey);

    // What does .commands getter return?
    const cmds = svc.commands;
    const cmdsKeys = cmds ? Object.keys(cmds).slice(0, 20) : null;
    const cmdsProto = cmds ? Object.getOwnPropertyNames(Object.getPrototypeOf(cmds)).filter(k => k !== 'constructor') : null;

    // getAllCommands()
    const all = svc.getAllCommands();
    const allIsArray = Array.isArray(all);
    const allType = all?.constructor?.name;
    let allSample = [];
    let kairoSample = [];
    if (all && typeof all[Symbol.iterator] === 'function') {
      let count = 0;
      for (const cmd of all) {
        if (count >= 10 && kairoSample.length >= 3) break;
        const label = cmd?.label || '';
        const cat = cmd?.category || '';
        const id = cmd?.id;
        if (count < 5) allSample.push({ id: String(id).slice(0,50), label, cat });
        if ((label.toLowerCase().includes('kairo') || cat.toLowerCase().includes('kairo')) && kairoSample.length < 10) {
          kairoSample.push({ id: String(id).slice(0,60), label, cat });
        }
        count++;
      }
    }

    // Check toUnregisterCommands
    const toUnreg = svc.toUnregisterCommands;
    let toUnregSample = [];
    if (toUnreg instanceof Map) {
      let count = 0;
      for (const [id, cmd] of toUnreg.entries()) {
        if (count >= 5) break;
        toUnregSample.push({
          id: String(id).slice(0,60),
          isObject: typeof cmd === 'object',
          label: cmd?.label,
          cat: cmd?.category,
          hasHandler: !!cmd?.handler,
        });
        count++;
      }
    }

    // Check if there's a CommandRegistry-specific class
    // (In Theia, CommandService is the interface, CommandRegistry is the impl)
    let cmdRegImpl = null;
    for (const [key] of map.entries()) {
      if (typeof key === 'function') {
        try {
          const s = container.get(key);
          if (s && s !== svc && typeof s.getAllCommands === 'function' && typeof s.registerCommand === 'function') {
            cmdRegImpl = { name: key.name, ctor: s.constructor.name };
            break;
          }
        } catch (_) {}
      }
    }

    return {
      cmdsKeys,
      cmdsProto,
      allIsArray,
      allType,
      allSample,
      kairoSample,
      toUnregIsMap: toUnreg instanceof Map,
      toUnregSize: toUnreg?.size,
      toUnregSample,
      cmdRegImpl,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
