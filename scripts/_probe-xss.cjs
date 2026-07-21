// Probe: XSS — project with hostile name must render escaped everywhere it appears. (KAIRO-RC-WEB security)
'use strict';
const path = require('path');
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog,
  waitForStatusBarContains, ensureDir, sleep, httpGet,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa.SOUdxO';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'probe-xss'));
const PAYLOAD = '<img src=x onerror="window.__kairoXSS=1">';
const PROJ_DIR = path.join(QA_ROOT, 'xss-fixture');

async function main() {
  const fs = require('fs');
  fs.mkdirSync(path.join(PROJ_DIR, 'WebRoot'), { recursive: true });
  fs.writeFileSync(path.join(PROJ_DIR, 'WebRoot', 'index.jsp'), '<html>xss fixture</html>');

  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'probe-xss-stack'), port: 19090, webPort: 13900, skipBuild: true });
  const env = stack.env;
  const agent = 'http://127.0.0.1:19090';
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/?kairoAgent=${encodeURIComponent(agent)}`;

  // Create workspace + hostile-named project via agent API
  const wsRes = await fetch(`${agent}/api/v1/workspaces`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'xss-ws', root: PROJ_DIR }),
  });
  const wsJson = await wsRes.json().catch(() => null);
  const wsId = wsJson?.payload?.id || wsJson?.payload?.workspaceId || 'ws_xss';
  // Project creation is PUT /api/v1/projects/{projectId} (see protocol).
  const projRes = await fetch(`${agent}/api/v1/projects/proj_xss`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: { projectId: 'proj_xss', workspaceId: wsId, name: PAYLOAD, rootPath: PROJ_DIR, webappDir: 'WebRoot', contextPath: '/xss' } }),
  });
  console.log('project create status:', projRes.status, await projRes.text().then(t => t.slice(0, 200)));

  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  // Open the project selector (lists project names)
  await page.keyboard.press('F1');
  await sleep(1000);
  await page.keyboard.type('Kairo: Select Project', { delay: 20 });
  await sleep(1000);
  await page.keyboard.press('Enter');
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'project-selector.png') });

  const xssFired = await page.evaluate(() => Boolean(window.__kairoXSS));
  const rawInDom = await page.evaluate((p) => {
    // raw payload present as unescaped HTML (an actual <img> node with our onerror)?
    const imgs = [...document.querySelectorAll('img')].some(i => i.getAttribute('src') === 'x');
    return imgs;
  });
  console.log(`${!xssFired && !rawInDom ? 'PASS' : 'FAIL'} xss.project-name — fired=${xssFired} rawImgInDom=${rawInDom}`);

  await browser.close();
  await stopStack(stack.dataDir);
  process.exit(!xssFired && !rawInDom ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
