const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const exe = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  const runDir = path.join(repoRoot, 'artifacts', 'test-results', 'cmd-probe3');
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

  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    if (!container) return { error: 'no container' };
    const bindingMap = container._bindingDictionary?._map;
    if (!bindingMap) return { error: 'no binding map' };

    // Find services that have a `commands` property (Map or Array)
    const candidates = [];
    let checked = 0;
    for (const [key, binding] of bindingMap.entries()) {
      checked++;
      let resolved;
      try { resolved = container.get(key); } catch { continue; }
      if (!resolved || typeof resolved !== 'object') continue;
      const props = Object.getOwnPropertyNames(Object.getPrototypeOf(resolved)).slice(0, 20);
      const ownProps = Object.keys(resolved).slice(0, 20);
      // Check if it has any command-related methods or properties
      const hasCommands = 'commands' in resolved;
      const hasRegisterCommand = typeof resolved.registerCommand === 'function';
      const hasExecuteCommand = typeof resolved.executeCommand === 'function';
      const hasGetCommand = typeof resolved.getCommand === 'function';
      if (hasCommands || hasRegisterCommand || hasExecuteCommand) {
        let cmdInfo = {};
        if (hasCommands && resolved.commands instanceof Map) {
          cmdInfo.commandsSize = resolved.commands.size;
          cmdInfo.sampleKairo = [];
          for (const [id, cmd] of resolved.commands.entries()) {
            if (id.startsWith('kairo.') || /kairo/i.test(cmd.label || '')) {
              cmdInfo.sampleKairo.push({ id, label: cmd.label || '' });
              if (cmdInfo.sampleKairo.length >= 10) break;
            }
          }
        }
        candidates.push({
          key: String(key).slice(0, 80),
          className: resolved.constructor?.name,
          props,
          ownProps,
          hasCommands,
          hasRegisterCommand,
          hasExecuteCommand,
          hasGetCommand,
          ...cmdInfo,
        });
        if (candidates.length >= 10) break;
      }
    }
    return { checked, found: candidates.length, candidates };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
