const fs = require('fs');
const path = require('path');
require('../../tests/setup-tmp.cjs'); // KAIRO_TMP override
const os = require('os');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const exePath = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
const tmpDir = path.join(os.tmpdir(), 'kairo-diag-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Launching Kairo IDE for DI diagnostics...');
  const app = await electron.launch({
    executablePath: exePath,
    env: { ...process.env, THEIA_CONFIG_DIR: tmpDir },
    timeout: 60000,
  });
  const page = await app.firstWindow();

  // Wait for load
  console.log('Waiting for page load...');
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await sleep(8000);

  // Dismiss trust dialog if present
  try {
    const trustBtn = await page.locator('button:has-text("Trust"), button:has-text("Yes, I trust"), button:has-text("Trust Authors")').first();
    if (await trustBtn.isVisible({ timeout: 2000 })) {
      console.log('Found trust dialog, clicking...');
      await trustBtn.click();
      await sleep(2000);
    }
  } catch(e) {}

  // Wait for __kairo and theia
  for (let i = 0; i < 40; i++) {
    const info = await page.evaluate(() => {
      const shell = document.querySelector('#theia-app-shell, .theia-ApplicationShell');
      return {
        hasKairo: !!window.__kairo,
        base: window.__kairo?.agentBaseUrl,
        hasTheia: !!window.theia,
        theiaKeys: window.theia ? Object.keys(window.theia).slice(0, 30) : [],
        shellVisible: !!shell,
        title: document.title,
        url: window.location.href.slice(0, 100),
      };
    });
    console.log('Check', i, 'shell:', info.shellVisible, 'kairo:', info.hasKairo, 'theia:', info.hasTheia, 'title:', info.title);
    if (info.hasKairo && info.hasTheia && info.shellVisible) break;
    await sleep(2000);
  }

  console.log('Page ready, running DI diagnostics...');

  // Inject diagnostic code to find WorkspaceService and URI
  const diag = await page.evaluate(() => {
    const result = { theiaKeys: Object.keys(window.theia || {}), containerFound: false, wsCandidates: [], uriCandidates: [] };
    
    const container = window.theia?.container;
    if (!container?._bindingDictionary?._map) {
      result.error = 'No container found';
      return result;
    }
    result.containerFound = true;
    result.containerHasGet = typeof container.get === 'function';
    result.containerHasGetAsync = typeof container.getAsync === 'function';

    const dict = container._bindingDictionary._map;
    result.bindingCount = dict.size;

    function getCached(binding) {
      const cache = binding && (binding.cache || binding._cache);
      return (cache && !(cache instanceof Promise)) ? cache : undefined;
    }

    const wsShapeMatches = [];
    const uriShapeMatches = [];
    let checked = 0;
    for (const [key, bindings] of dict.entries()) {
      const keyName = typeof key === 'symbol' ? key.toString() : (typeof key === 'function' ? key.name : String(key));
      for (const binding of bindings) {
        checked++;
        const inst = getCached(binding);
        if (!inst) continue;

        // Shape for WorkspaceService: has .workspace, .open(), .roots, .addRoot()
        const isWorkspaceService = 
          typeof inst === 'object' && inst !== null &&
          typeof inst.open === 'function' &&
          typeof inst.addRoot === 'function' &&
          'workspace' in inst &&
          'roots' in inst;
        
        if (isWorkspaceService) {
          let rootInfo = 'unknown';
          try {
            const roots = inst.roots;
            rootInfo = Array.isArray(roots) ? `array(${roots.length})` : typeof roots;
          } catch(e) { rootInfo = 'error: ' + e.message; }
          
          wsShapeMatches.push({
            keyName,
            ctorName: inst.constructor?.name,
            opened: inst.opened,
            hasWorkspace: !!inst.workspace,
            workspaceStr: inst.workspace ? String(inst.workspace).slice(0, 80) : null,
            rootsType: rootInfo,
            ownMethodNames: Object.getOwnPropertyNames(Object.getPrototypeOf(inst)).filter(m => typeof inst[m] === 'function').slice(0, 25),
          });
        }

        // Shape for URI class (static methods)
        if (typeof inst === 'function') {
          const isURI = typeof inst.file === 'function' && typeof inst.parse === 'function';
          if (isURI) {
            try {
              const t1 = inst.file('C:\\test');
              const t2 = inst.file('/tmp/test');
              uriShapeMatches.push({
                keyName,
                fnName: inst.name,
                staticMethodNames: Object.getOwnPropertyNames(inst).filter(k => typeof inst[k] === 'function').slice(0, 15),
                test1_scheme: t1?.scheme, test1_path: t1?.path, test1_str: t1?.toString?.(),
                test2_scheme: t2?.scheme, test2_path: t2?.path, test2_str: t2?.toString?.(),
              });
            } catch(e) {
              uriShapeMatches.push({ keyName, fnName: inst.name, error: e.message });
            }
          }
        }
      }
    }
    result.checkedBindings = checked;
    result.wsShapeMatches = wsShapeMatches;
    result.uriShapeMatches = uriShapeMatches;

    // Direct window.theia.URI check
    result.directUriType = typeof window.theia?.URI;
    result.directUriFile = typeof window.theia?.URI?.file;
    if (window.theia?.URI?.file) {
      try {
        const tu = window.theia.URI.file('C:\\Users\\Qi\\test');
        result.directUriTest = { scheme: tu.scheme, path: tu.path, authority: tu.authority, str: tu.toString() };
      } catch(e) { result.directUriTestErr = e.message; }
    }

    return result;
  });

  console.log('\n=== DIAGNOSTIC RESULT ===\n');
  console.log(JSON.stringify(diag, null, 2));

  await page.screenshot({ path: path.join(tmpDir, 'diag.png') });
  console.log('\nScreenshot:', path.join(tmpDir, 'diag.png'));

  await app.close();
  await sleep(2000);
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
