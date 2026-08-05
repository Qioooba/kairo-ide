// Quick diagnostic probe against packaged Kairo.exe
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const exe = process.argv[2] || path.join(__dirname, '..', '..', 'apps', 'desktop', 'dist', 'run', 'Kairo.exe');
const outDir = path.join(__dirname, '..', '..', 'artifacts', 'e2e-windows', 'diagnose');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const userDataDir = path.join(outDir, 'userdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      KAIRO_DEV: '1',
      KAIRO_NO_DEVTOOLS: '0',
      KAIRO_USER_DATA_DIR: userDataDir,
      KAIRO_DESKTOP_LOG_FILE: path.join(outDir, 'main.log'),
    },
    timeout: 120000,
  });
  const page = await app.firstWindow({ timeout: 90000 });
  console.log('title:', await page.title());
  await page.waitForSelector('#theia-statusBar', { timeout: 90000 });
  await page.waitForTimeout(8000);

  const dump = await page.evaluate(() => {
    const qs = (sel) => Array.from(document.querySelectorAll(sel));
    const activityCandidates = [
      '.theia-app-left',
      '.theia-app-sides',
      '#theia-left-content-panel',
      '.p-TabBar',
      '.lm-TabBar',
      '[role="tablist"]',
      '.theia-activity-bar',
      '#theia-top-panel',
    ].map(sel => ({
      sel,
      count: qs(sel).length,
      sample: qs(sel).slice(0, 3).map(el => ({
        tag: el.tagName,
        id: el.id,
        cls: String(el.className).slice(0, 120),
        title: el.getAttribute('title'),
        role: el.getAttribute('role'),
        childTitles: Array.from(el.querySelectorAll('[title]')).slice(0, 8).map(c => c.getAttribute('title')),
      })),
    }));

    const allTitles = qs('[title]').map(el => el.getAttribute('title')).filter(Boolean).slice(0, 80);
    const statusText = (document.querySelector('#theia-statusBar') || {}).innerText || '';

    // Try find CommandRegistry via inversify
    let cmdInfo = { found: false };
    try {
      let container = null;
      for (const el of document.querySelectorAll('*')) {
        const c = el.__inversify_container__;
        if (c && c._bindingDictionary && c._bindingDictionary._map && c._bindingDictionary._map.size > 50) {
          container = c; break;
        }
      }
      if (container) {
        const map = container._bindingDictionary._map;
        for (const [key] of map.entries()) {
          try {
            const svc = container.get(key);
            if (svc && typeof svc.getAllCommands === 'function' && typeof svc.executeCommand === 'function') {
              const all = Array.from(svc.getAllCommands());
              const kairo = all.filter(c => {
                const s = `${c.id || ''} ${c.label || ''} ${c.category || ''}`.toLowerCase();
                return s.includes('kairo') || s.includes('导入') || s.includes('服务器');
              }).slice(0, 40).map(c => ({ id: c.id, label: c.label, category: c.category }));
              cmdInfo = {
                found: true,
                total: all.length,
                kairoCount: all.filter(c => String(c.id || '').startsWith('kairo.')).length,
                sampleKairo: kairo,
              };
              break;
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      cmdInfo = { found: false, error: String(e) };
    }

    return {
      url: location.href,
      bodyCls: document.body.className,
      activityCandidates,
      allTitles,
      statusText: statusText.slice(0, 500),
      cmdInfo,
      hasMonaco: !!document.querySelector('.monaco-editor'),
      tabTitles: qs('.p-TabBar-tab').map(t => t.getAttribute('title') || t.textContent.trim()).slice(0, 30),
    };
  });

  fs.writeFileSync(path.join(outDir, 'dump.json'), JSON.stringify(dump, null, 2));
  await page.screenshot({ path: path.join(outDir, 'shell.png') });

  // Open palette and search Kairo
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-widget', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const paletteBefore = await page.evaluate(() => {
    const w = document.querySelector('.quick-input-widget');
    if (!w) return { open: false };
    const input = w.querySelector('input');
    return {
      open: true,
      placeholder: input && (input.getAttribute('placeholder') || input.getAttribute('aria-label')),
      visible: getComputedStyle(w).display !== 'none',
      html: w.outerHTML.slice(0, 1500),
      rows: Array.from(w.querySelectorAll('.monaco-list-row')).slice(0, 15).map(r => (r.textContent || '').trim()),
    };
  });
  fs.writeFileSync(path.join(outDir, 'palette-before.json'), JSON.stringify(paletteBefore, null, 2));
  await page.screenshot({ path: path.join(outDir, 'palette.png') });

  if (paletteBefore.open) {
    const input = await page.$('.quick-input-widget input');
    if (input) {
      await input.click({ clickCount: 3 });
      await page.keyboard.type('Kairo', { delay: 40 });
      await page.waitForTimeout(1200);
      const after = await page.evaluate(() => {
        const w = document.querySelector('.quick-input-widget');
        return {
          rows: Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row, .monaco-list-row')).slice(0, 30).map(r => (r.textContent || '').trim()),
          inputValue: (w && w.querySelector('input') && w.querySelector('input').value) || null,
        };
      });
      fs.writeFileSync(path.join(outDir, 'palette-kairo.json'), JSON.stringify(after, null, 2));
      await page.screenshot({ path: path.join(outDir, 'palette-kairo.png') });
    }
  }

  console.log(JSON.stringify({
    cmdInfo: dump.cmdInfo,
    statusText: dump.statusText,
    tabTitles: dump.tabTitles,
    activityCounts: dump.activityCandidates.map(a => [a.sel, a.count]),
    titleSample: dump.allTitles.slice(0, 20),
    paletteOpen: paletteBefore.open,
    paletteRows: paletteBefore.rows,
  }, null, 2));

  try { await app.close(); } catch (_) {}
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
