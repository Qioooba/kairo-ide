// Quick test: open the app, check if Kairo commands are in the registry
const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const exe = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  console.log('Launching:', exe);

  const app = await electron.launch({
    executablePath: exe,
    cwd: path.join(repoRoot, 'dist', 'win-unpacked'),
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${path.join(repoRoot, 'artifacts', 'test-results', 'inspect-userdata')}`,
    ],
    timeout: 90000,
    env: { ...process.env, KAIRO_DEV: '1', KAIRO_DESKTOP_LOG_FILE: 'C:\\Temp\\kairo-inspect.log' },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Wait for the app to be fully loaded
  await new Promise(r => setTimeout(r, 8000));

  // Check the command registry
  const result = await win.evaluate(() => {
    const reg = window.theia?.CommandRegistry;
    if (!reg) return { error: 'No CommandRegistry on window.theia' };
    const allCommands = [];
    for (const id of reg.commands.keys()) {
      const c = reg.commands.get(id);
      allCommands.push({ id, label: c.label, category: c.category });
    }
    const kairoCommands = allCommands.filter(c => c.id.startsWith('kairo.'));
    return {
      total: allCommands.length,
      kairoCount: kairoCommands.length,
      kairoIds: kairoCommands.map(c => c.id),
      sampleNonKairo: allCommands.slice(0, 5).map(c => c.id),
    };
  });

  console.log('Result:', JSON.stringify(result, null, 2));

  await app.close();
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
