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
      THEIA_CONFIG_DIR: path.join(__dirname, 'theia-config-quick2'),
    },
  });

  const page = await app.firstWindow();
  console.log('Window title:', await page.title());

  await sleep(35000);

  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    if (!container || !container._bindingDictionary?._map) return { error: 'no container' };
    const map = container._bindingDictionary._map;

    // Print all keys that contain "command" (case insensitive)
    const cmdKeys = [];
    const allKeySamples = [];
    for (const [key, binding] of map.entries()) {
      const keyStr = String(key);
      if (keyStr.toLowerCase().includes('command')) {
        cmdKeys.push(keyStr);
        try {
          const svc = container.get(key);
          if (svc) cmdKeys.push(`  -> resolved: ${typeof svc}, has commands: ${svc.commands instanceof Map}`);
        } catch (e) {
          cmdKeys.push(`  -> error: ${e.message}`);
        }
      }
      if (allKeySamples.length < 30) allKeySamples.push(keyStr);
    }

    // Also try to find any service with a .commands Map of size > 100
    const cmdLike = [];
    for (const [key, binding] of map.entries()) {
      try {
        const svc = container.get(key);
        if (svc && svc.commands instanceof Map && svc.commands.size > 100) {
          cmdLike.push({ key: String(key), size: svc.commands.size });
          if (cmdLike.length >= 5) break;
        }
      } catch (_) {}
    }

    return {
      mapSize: map.size,
      cmdKeys,
      cmdLike,
      keySamples: allKeySamples,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
