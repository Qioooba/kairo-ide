const { _electron: electron } = require('playwright');
const path = require('path');

const EXE_PATH = path.join(__dirname, '..', '..', 'dist', 'win-unpacked', 'Kairo IDE.exe');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const app = await electron.launch({
    executablePath: EXE_PATH,
    env: { ...process.env, KAIRO_DEV: '1', THEIA_CONFIG_DIR: path.join(__dirname, 'theia-config-quick6') },
  });

  const page = await app.firstWindow();
  await sleep(40000);

  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    const map = container._bindingDictionary._map;

    // Get Symbol(CommandService)
    let cmdKey = null;
    for (const [key] of map.entries()) {
      if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
        cmdKey = key;
        break;
      }
    }
    const svc = container.get(cmdKey);

    // Check properties
    const commandsProp = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(svc), 'commands');
    const underscoreCommands = svc._commands;

    // Try to get all commands
    let allCommands = null;
    try {
      allCommands = svc.getAllCommands();
    } catch (e) {}

    // Test getter
    let commandsViaGetter = null;
    try { commandsViaGetter = svc.commands; } catch (e) {}

    // Check some Kairo commands
    let kairoCmds = [];
    if (underscoreCommands instanceof Map) {
      for (const [id, cmd] of underscoreCommands.entries()) {
        const label = cmd?.label || '';
        const cat = cmd?.category || '';
        if (label.toLowerCase().includes('kairo') || cat.toLowerCase().includes('kairo')) {
          kairoCmds.push({ id: String(id).slice(0,50), label, cat });
        }
        if (kairoCmds.length >= 15) break;
      }
    }

    // Also check: is svc._commands a Map of id->command?
    let sampleCmds = [];
    if (underscoreCommands instanceof Map) {
      let count = 0;
      for (const [id, cmd] of underscoreCommands.entries()) {
        if (count >= 10) break;
        if (cmd && (cmd.label || cmd.category)) {
          sampleCmds.push({ id: String(id).slice(0,60), label: cmd.label, cat: cmd.category });
          count++;
        }
      }
    }

    return {
      commandsPropType: commandsProp?.get ? 'getter' : (typeof commandsProp?.value),
      underscoreIsMap: underscoreCommands instanceof Map,
      underscoreSize: underscoreCommands?.size || 0,
      getterResult: commandsViaGetter ? { type: typeof commandsViaGetter, isMap: commandsViaGetter instanceof Map, size: commandsViaGetter?.size } : null,
      allCommandsResult: allCommands ? Array.isArray(allCommands) ? `array length=${allCommands.length}` : typeof allCommands : null,
      kairoSample: kairoCmds,
      generalSample: sampleCmds,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
