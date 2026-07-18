// Screenshot the running Theia browser IDE so we can prove the
// UI actually mounted and the Kairo extensions loaded. This is
// invoked manually for now; the Playwright-based E2E suite in
// tests/e2e/ will replace it for CI runs.
//
// Usage: node scripts/screenshot-theia.cjs <out-path> [url]
//   <out-path>  absolute or workspace-relative PNG path
//   [url]       defaults to http://127.0.0.1:3000

const fs = require('fs');
const path = require('path');

const out = process.argv[2] || 'docs/screenshots/theia-ide.png';
const url = process.argv[3] || 'http://127.0.0.1:3000';
const absOut = path.isAbsolute(out) ? out : path.join(process.cwd(), out);
fs.mkdirSync(path.dirname(absOut), { recursive: true });

(async () => {
  const puppeteer = require('puppeteer');
  // Resolve the bundled Chromium that pnpm cached for the Theia
  // CLI (the test runner uses the same browser).
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    path.join(
      process.env.USERPROFILE || process.env.HOME || '',
      '.cache',
      'puppeteer',
      'chrome',
    ),
    path.join(
      process.env.USERPROFILE || process.env.HOME || '',
      '.cache',
      'puppeteer',
      'chrome-headless-shell',
    ),
  ].filter(Boolean);

  let executablePath;
  for (const c of candidates) {
    if (!c) continue;
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      // Recursive search for chrome* or chrome-headless-shell* executables.
      const stack = [c];
      while (stack.length) {
        const dir = stack.pop();
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            stack.push(full);
          } else if (ent.isFile() && (ent.name === 'chrome.exe' || ent.name === 'chrome-headless-shell.exe')) {
            executablePath = full;
            break;
          }
        }
        if (executablePath) break;
      }
      if (executablePath) break;
    } else if (fs.existsSync(c)) {
      executablePath = c;
      break;
    }
  }
  if (!executablePath) {
    throw new Error('puppeteer chrome not found; set PUPPETEER_EXECUTABLE_PATH');
  }
  console.log('chrome:', executablePath);

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('[browser-error]', msg.text());
    }
  });
  page.on('pageerror', err => console.error('[page-error]', err.message));

  console.log('navigating to', url);
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log('http status:', response ? response.status() : '(none)');

  // Wait for the Theia status bar to appear; that proves the
  // frontend bootstrapped past the loading screen. 1.73.1 renders
  // the status bar inside `.theia-statusbar`.
  try {
    await page.waitForSelector('.theia-statusbar, .monaco-editor', { timeout: 60_000 });
  } catch (err) {
    console.error('timed out waiting for Theia UI:', err.message);
  }
  // Capture extra info: how many Kairo services the UI shows.
  const kairo = await page.evaluate(() => {
    return {
      title: document.title,
      bodyChildren: document.body.children.length,
      hasStatusBar: !!document.querySelector('.theia-statusbar'),
      hasMonaco: !!document.querySelector('.monaco-editor'),
      hasExplorer: !!document.querySelector('.theia-Explorer'),
      errorOverlay: document.querySelectorAll('.theia-preload .theia-errorMarker, .theia-loader.error').length,
    };
  });
  console.log('ui-state:', kairo);

  await page.screenshot({ path: absOut, fullPage: false });
  console.log('wrote', absOut);
  await browser.close();
})().catch(err => {
  console.error('screenshot failed:', err);
  process.exit(1);
});
