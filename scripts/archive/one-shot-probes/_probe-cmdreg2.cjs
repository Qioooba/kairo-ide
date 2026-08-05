const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const exe = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  const runDir = path.join(repoRoot, 'artifacts', 'test-results', 'cmd-probe2');
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
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForSelector('#theia-statusBar', { timeout: 60_000 });
  await new Promise(r => setTimeout(r, 6000));

  // Find CommandRegistry among all container services
  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    if (!container) return { error: 'no container' };
    const bindingMap = container._bindingDictionary?._map;
    if (!bindingMap) return { error: 'no binding map' };

    // Find services that have a `commands` Map
    const cmdRegistries = [];
    for (const [key, binding] of bindingMap.entries()) {
      let resolved;
      try { resolved = container.get(key); } catch { continue; }
      if (resolved && typeof resolved === 'object' && resolved.commands instanceof Map) {
        // Check if it has registerCommand (CommandRegistry signature)
        if (typeof resolved.registerCommand === 'function') {
          const allCmds = [];
          const kairoCmds = [];
          for (const [id, cmd] of resolved.commands.entries()) {
            const label = cmd.label || '';
            const cat = cmd.category || '';
            allCmds.push({ id, label, category: cat });
            if (id.startsWith('kairo.') || /kairo/i.test(label) || /kairo/i.test(cat)) {
              kairoCmds.push({ id, label, category: cat });
            }
          }
          cmdRegistries.push({
            key: String(key).slice(0, 100),
            className: resolved.constructor?.name,
            totalCommands: resolved.commands.size,
            kairoCount: kairoCmds.length,
            kairoSample: kairoCmds.slice(0, 30),
          });
        }
      }
    }
    return { found: cmdRegistries.length, registries: cmdRegistries };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
