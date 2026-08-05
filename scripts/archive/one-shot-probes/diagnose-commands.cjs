// Deeper palette/command registry probe
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const exe = process.argv[2] || 'G:/spaces/kairo-ide/apps/desktop/dist/run/Kairo.exe';
const outDir = 'G:/spaces/kairo-ide/artifacts/e2e-windows/diagnose';
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const userDataDir = path.join(outDir, 'userdata2');
  fs.mkdirSync(userDataDir, { recursive: true });
  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, KAIRO_DEV: '1', KAIRO_NO_DEVTOOLS: '1', KAIRO_USER_DATA_DIR: userDataDir },
    timeout: 120000,
  });
  const page = await app.firstWindow({ timeout: 90000 });
  page.on('dialog', d => { d.accept().catch(() => {}); });
  await page.waitForSelector('#theia-statusBar', { timeout: 90000 });
  await page.waitForTimeout(10000);

  // Dump activity bar using Lumino selectors
  const activity = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.lm-TabBar-tab, .p-TabBar-tab'));
    return tabs.map(el => ({
      title: el.getAttribute('title') || '',
      aria: el.getAttribute('aria-label') || '',
      cls: String(el.className).slice(0, 80),
      parent: el.parentElement && String(el.parentElement.className).slice(0, 80),
    }));
  });
  fs.writeFileSync(path.join(outDir, 'activity-lm.json'), JSON.stringify(activity, null, 2));
  console.log('activity tabs', activity.filter(t => t.title && t.title !== 'Close').slice(0, 20));

  // Try multiple ways to find CommandRegistry
  const cmds = await page.evaluate(async () => {
    const result = { methods: [], commands: [], kairo: [], errors: [] };

    // Method A: walk webpack modules / theia globals
    try {
      if (window.theia) result.methods.push('window.theia=' + Object.keys(window.theia).join(','));
    } catch (e) { result.errors.push('theia:' + e.message); }

    // Method B: find via Monaco/Theia services on DOM nodes
    let registry = null;
    const tryGet = (obj, path) => {
      try {
        return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
      } catch { return undefined; }
    };

    // Method C: inversify — also check _bindingDictionary without size gate
    const containers = [];
    for (const el of document.querySelectorAll('*')) {
      const c = el.__inversify_container__ || el._container || el.container;
      if (c && c._bindingDictionary && c._bindingDictionary._map) containers.push(c);
      // Some Theia builds stash container on widget nodes
      for (const k of Object.getOwnPropertyNames(el)) {
        try {
          const v = el[k];
          if (v && v._bindingDictionary && v._bindingDictionary._map) containers.push(v);
        } catch (_) {}
      }
      if (containers.length > 5) break;
    }
    result.methods.push('containers=' + containers.length);

    for (const container of containers) {
      const map = container._bindingDictionary._map;
      result.methods.push('mapSize=' + map.size);
      for (const [key] of map.entries()) {
        try {
          const svc = container.get(key);
          if (svc && typeof svc.getAllCommands === 'function') {
            registry = svc;
            result.methods.push('found via ' + String(key));
            break;
          }
        } catch (_) {}
      }
      if (registry) break;
    }

    // Method D: look for CommandRegistry on window symbols
    if (!registry) {
      for (const k of Object.getOwnPropertyNames(window)) {
        try {
          const v = window[k];
          if (v && typeof v.getAllCommands === 'function' && typeof v.executeCommand === 'function') {
            registry = v;
            result.methods.push('found window.' + k);
            break;
          }
        } catch (_) {}
      }
    }

    if (!registry) {
      result.methods.push('registry-not-found');
      return result;
    }

    const all = Array.from(registry.getAllCommands());
    result.commands = all.length;
    const kairo = all.filter(c => {
      const s = `${c.id}|${c.label}|${c.category}`;
      return /kairo|导入|服务器|构建/i.test(s);
    }).map(c => ({
      id: c.id,
      label: c.label,
      category: c.category,
      enabled: typeof registry.isEnabled === 'function' ? registry.isEnabled(c.id) : null,
      visible: typeof registry.isVisible === 'function' ? registry.isVisible(c.id) : null,
    }));
    result.kairo = kairo.slice(0, 80);
    result.kairoCount = kairo.length;
    result.sampleLabels = all.filter(c => c.label).slice(0, 20).map(c => c.label);
    return result;
  });
  fs.writeFileSync(path.join(outDir, 'commands.json'), JSON.stringify(cmds, null, 2));
  console.log(JSON.stringify(cmds, null, 2));

  // Palette searches
  for (const term of ['Kairo', '导入', 'Show Servers', '显示服务器', 'Build', '构建']) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input', { timeout: 5000 });
    const input = await page.$('.quick-input-widget input');
    await input.click({ clickCount: 3 });
    await page.keyboard.type(term, { delay: 30 });
    await page.waitForTimeout(900);
    const rows = await page.$$eval('.quick-input-widget .monaco-list-row', els =>
      els.map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 15));
    console.log('SEARCH', JSON.stringify(term), '=>', rows.length, rows.slice(0, 5));
    fs.writeFileSync(path.join(outDir, `search-${term.replace(/[^\w\u4e00-\u9fff]+/g, '_')}.json`), JSON.stringify({ term, rows }, null, 2));
    await page.keyboard.press('Escape');
  }

  try { await app.close(); } catch (_) {}
  // force kill if dialog hang
  try { app.process().kill(); } catch (_) {}
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
