const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const exe = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  const runDir = path.join(repoRoot, 'artifacts', 'test-results', 'cmd-probe');
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
  await new Promise(r => setTimeout(r, 5000));

  // Find CommandRegistry in the container and enumerate commands
  const result = await page.evaluate(() => {
    const container = window.theia?.container;
    if (!container) return { error: 'no container' };

    // The Inversify container uses service identifiers. Let's find CommandRegistry
    // by looking at bindings that have "Command" in their key string.
    const bindingMap = container._bindingDictionary?._map;
    if (!bindingMap) return { error: 'no binding map' };

    const cmdRelated = [];
    const kairoRelated = [];
    for (const [key, binding] of bindingMap.entries()) {
      const keyStr = String(key);
      if (/Command/i.test(keyStr)) {
        let resolved = null;
        try {
          resolved = container.get(key);
        } catch(e) { resolved = 'ERROR: ' + e.message; }
        const info = { key: keyStr, type: typeof resolved };
        if (resolved && typeof resolved === 'object') {
          info.className = resolved.constructor?.name;
          if (resolved.commands instanceof Map) {
            info.commandCount = resolved.commands.size;
            // Get first 10 commands
            const cmds = [];
            for (const [id, cmd] of resolved.commands.entries()) {
              cmds.push({ id, label: cmd.label || '', category: cmd.category || '' });
              if (cmds.length >= 30) break;
            }
            info.sampleCommands = cmds;
          }
        }
        cmdRelated.push(info);
      }
    }
    return { cmdRelatedCount: cmdRelated.length, cmdRelated };
  });

  console.log(JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
