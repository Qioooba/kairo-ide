const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const outDir = path.join(process.cwd(), 'test-results', 'debug-tree');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--headless=new'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[pageerror] ${err.message}\n${err.stack || ''}`));
  page.on('response', r => {
    if (!r.ok()) logs.push(`[response] ${r.status()} ${r.url()}`);
  });

  const url = 'http://127.0.0.1:18301/?kairoAgent=http://127.0.0.1:18300#/tmp/kairo-e2e-workspaces/legacy-sample';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('#theia-app-shell, #theia-shell, .theia-shell', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(30_000);

  // Dismiss trust dialog if present
  const yesBtn = page.locator('button:has-text("Yes, I trust")').first();
  try {
    await yesBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await yesBtn.click();
    await page.waitForTimeout(2_000);
  } catch { /* no dialog */ }

  // Close import wizard if open
  const closeBtn = page.locator('[data-testid="ready-close-btn"], .kairo-import-wizard .theia-button.secondary, .p-TabBar-tab[data-id="kairo-import-wizard"] .p-TabBar-tabCloseIcon').first();
  try {
    const wizard = page.locator('[data-testid="import-wizard"]').first();
    if (await wizard.isVisible({ timeout: 2_000 })) {
      const close = page.locator('[data-testid="ready-close-btn"]').first();
      if (await close.isVisible().catch(() => false)) {
        await close.click();
      } else {
        // try X on tab
        const tabClose = page.locator('.p-TabBar-tab[data-id="kairo-import-wizard"] .p-TabBar-tabCloseIcon').first();
        if (await tabClose.isVisible().catch(() => false)) await tabClose.click();
      }
      await page.waitForTimeout(2_000);
      console.log('Closed import wizard');
    }
  } catch { /* no wizard */ }

  // Try to activate Files/Explorer
  const selectors = [
    '.theia-ActivityBar [title="Explorer"]',
    '.theia-ActivityBar [title="Files"]',
    '#theia\:navigator',
    '#theia\:files',
    '.p-TabBar-tab[title="Explorer"]',
    '.p-TabBar-tab[title="Files"]',
    '[id*="navigator"]',
    '[id*="files"]',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      console.log(`Clicked ${sel}`);
      await page.waitForTimeout(2_000);
      break;
    }
  }

  const info = await page.evaluate(async () => {
    const navigatorWidget = document.querySelector('#files, #navigator, [id*="navigator"], [id*="files"]');
    const treeNodes = document.querySelectorAll('.theia-TreeNode');
    const listRows = document.querySelectorAll('.monaco-list-row');
    const fileNodes = document.querySelectorAll('.theia-FileTreeNode, .theia-DirNode');
    const explorer = document.querySelector('#explorer-view-container');

    function describeTree(root, depth = 0) {
      if (!root) return null;
      const children = depth < 3 ? Array.from(root.children).map(c => describeTree(c, depth + 1)) : undefined;
      return {
        tag: root.tagName,
        id: root.id,
        class: root.className,
        text: root.textContent?.trim().slice(0, 100) || '',
        childCount: root.children.length,
        children,
      };
    }

    // Inspect the actual FileNavigatorWidget / model if reachable via Lumino
    let luminoWidget = null;
    try {
      const filesEl = document.getElementById('files');
      if (filesEl) {
        // Lumino attaches the widget reference on the node
        luminoWidget = filesEl['lm-widget'] || filesEl['__theia_widget__'] || filesEl['__lumiwidget__'];
      }
    } catch (e) { /* ignore */ }

    // Try to locate Theia WorkspaceService via container
    let workspaceService = null;
    let workspaceRoot = null;
    let roots = [];
    let wsError = null;
    let containerInfo = {};
    let fileService = null;
    let fileStat = null;
    let fsError = null;
    try {
      const container = window.theia && window.theia.container;
      containerInfo = {
        hasContainer: !!container,
        containerType: typeof container,
        containerKeys: container ? Object.keys(container).slice(0, 30) : [],
        hasGetAsync: !!(container && typeof container.getAsync === 'function'),
        hasGet: !!(container && typeof container.get === 'function'),
        hasGetAll: !!(container && typeof container.getAll === 'function'),
      };
      // Dump all binding identifiers to find workspace-related keys
      const bindingKeys = [];
      let frontendContributionKey = null;
      let workspaceServiceKey = null;
      try {
        const dict = container._bindingDictionary;
        if (dict && dict._map) {
          for (const [key, value] of dict._map.entries()) {
            const name = typeof key === 'symbol' ? key.toString() : (typeof key === 'function' ? key.name : String(key));
            if (/workspace|Workspace|files|FileService|navigator|Navigator|FrontendApplicationContribution/i.test(name)) {
              bindingKeys.push({ type: typeof key, name, count: value && value.length });
            }
            if (name === 'Symbol(FrontendApplicationContribution)') {
              frontendContributionKey = key;
            }
            if (name === 'Symbol(WorkspaceService)' || (typeof key === 'function' && key.name === 'WorkspaceService')) {
              workspaceServiceKey = key;
            }
          }
        }
      } catch (e) {
        bindingKeys.push({ error: String(e) });
      }
      containerInfo.bindingKeys = bindingKeys.slice(0, 30);

      // Try to find WorkspaceService among FrontendApplicationContributions
      const contributionMatches = [];
      try {
        if (frontendContributionKey && container.getAll) {
          const all = container.getAll(frontendContributionKey);
          for (const c of all) {
            if (c && typeof c.open === 'function' && c.roots !== undefined) {
              contributionMatches.push({
                name: c.constructor && c.constructor.name,
                hasOpen: true,
                hasRoots: true,
                rootsCount: c.roots && c.roots.length,
                workspace: c.workspace && c.workspace.resource && c.workspace.resource.toString(),
              });
              if (!workspaceService) {
                workspaceService = c;
                containerInfo.wsKey = 'from FrontendApplicationContribution';
              }
            }
          }
        }
      } catch (e) {
        containerInfo.contributionError = e instanceof Error ? e.message : String(e);
      }
      containerInfo.contributionMatches = contributionMatches;

      // Shape-based detection: the production bundle minifies class names,
      // so locate key Theia services by their instance properties.
      function getCached(binding) {
        const cache = binding && (binding.cache || binding._cache);
        return (cache && !(cache instanceof Promise)) ? cache : undefined;
      }
      function findByShape(testFn, max = 5) {
        const out = [];
        try {
          const dict = container && container._bindingDictionary && container._bindingDictionary._map;
          if (!dict) return out;
          for (const [key, bindings] of dict.entries()) {
            if (typeof key !== 'function') continue;
            for (const binding of bindings) {
              const inst = getCached(binding);
              if (!inst) continue;
              const shape = testFn(inst);
              if (shape) {
                out.push({ keyName: key.name, ctor: inst.constructor && inst.constructor.name, ...shape });
                if (out.length >= max) return out;
              }
            }
          }
        } catch (e) { /* ignore */ }
        return out;
      }
      containerInfo.shapeMatches = {
        workspaceService: findByShape(i =>
          i.workspace !== undefined && typeof i.open === 'function' && i.roots !== undefined
            ? { workspace: i.workspace && i.workspace.resource && i.workspace.resource.toString() }
            : false, 1),
        fileService: findByShape(i =>
          typeof i.resolve === 'function' && typeof i.readFile === 'function' && i.providers !== undefined
            ? { providerCount: i.providers && i.providers.size }
            : false, 1),
        navigatorModel: findByShape(i =>
          i.root !== undefined && typeof i.refresh === 'function' && i.root && i.root.children !== undefined
            ? { rootChildren: i.root.children.length, rootType: i.root.constructor && i.root.constructor.name }
            : false, 2),
        navigatorWidget: findByShape(i =>
          i.id === 'files' && i.model !== undefined
            ? { modelType: i.model.constructor && i.model.constructor.name, modelRootChildren: i.model.root && i.model.root.children && i.model.root.children.length }
            : false, 1),
        widgetManager: findByShape(i =>
          typeof i.getOrCreateWidget === 'function'
            ? { widgetCount: i.widgets && i.widgets.length }
            : false, 1),
        applicationShell: findByShape(i =>
          i.leftPanelHandler !== undefined && i.mainPanel !== undefined
            ? { leftWidgets: i.leftPanelHandler && i.leftPanelHandler.dockPanel && i.leftPanelHandler.dockPanel.widgets && i.leftPanelHandler.dockPanel.widgets.length }
            : false, 1),
      };

      // Try to locate FileNavigatorModel / FileNavigatorWidget / ApplicationShell instances
      let navigatorInstances = [];
      try {
        if (container && container._bindingDictionary && container._bindingDictionary._map) {
          for (const [key, value] of container._bindingDictionary._map.entries()) {
            const name = typeof key === 'symbol' ? key.toString() : (typeof key === 'function' ? key.name : String(key));
            if (/FileNavigator|ApplicationShell|FileTreeModel/i.test(name)) {
              for (const binding of value) {
                try {
                  const cache = binding.cache;
                  const inst = cache && (cache instanceof Promise ? undefined : cache);
                  if (inst) {
                    navigatorInstances.push({
                      key: name,
                      type: inst.constructor && inst.constructor.name,
                      hasModel: !!inst.model,
                      modelType: inst.model && inst.model.constructor && inst.model.constructor.name,
                      rootType: inst.model && inst.model.root && inst.model.root.constructor && inst.model.root.constructor.name,
                      rootChildren: inst.model && inst.model.root && inst.model.root.children && inst.model.root.children.length,
                      opened: inst.workspaceService && inst.workspaceService.opened,
                      isVisible: inst.isVisible,
                      nodeId: inst.id,
                    });
                  }
                } catch (e) { /* ignore */ }
              }
            }
          }
        }
      } catch (e) { containerInfo.navigatorSearchError = String(e); }
      containerInfo.navigatorInstances = navigatorInstances.slice(0, 10);

      if (container && container.getAsync) {
        // Try known symbol names used by Theia
        const possible = [
          'WorkspaceService',
          Symbol.for('WorkspaceService'),
        ];
        // Also try to get any binding tagged with WorkspaceService
        try {
          const all = container.getAll ? container.getAll(Symbol.for('WorkspaceService')) : [];
          containerInfo.allSymbolCount = all.length;
        } catch (e) { containerInfo.allSymbolError = String(e); }
        // Try loading the WorkspaceService class from the module
        try {
          const req = window.require;
          containerInfo.hasWindowRequire = !!req;
          if (req) {
            const mod = await new Promise((resolve, reject) => {
              req('@theia/workspace/lib/browser/workspace-service', resolve, reject);
            });
            containerInfo.modKeys = mod ? Object.keys(mod).slice(0, 10) : [];
            if (mod && mod.WorkspaceService) {
              possible.push(mod.WorkspaceService);
              containerInfo.wsClassLoaded = true;
            }
          }
        } catch (e) {
          containerInfo.wsClassError = e instanceof Error ? e.message : String(e);
        }
        for (const key of possible) {
          if (!key) continue;
          try {
            const svc = await container.getAsync(key);
            if (svc && typeof svc.open === 'function') {
              workspaceService = svc;
              containerInfo.wsKey = String(key);
              break;
            }
          } catch (e) { /* ignore */ }
        }
      }
      if (workspaceService) {
        workspaceRoot = workspaceService.workspace ? {
          name: workspaceService.workspace.name,
          uri: workspaceService.workspace.resource?.toString?.(),
          isDirectory: workspaceService.workspace.isDirectory,
          opened: workspaceService.opened,
        } : null;
        roots = await workspaceService.roots;
        // Try to locate FileService via shape detection (class names are
        // minified in the production bundle, so we identify by methods).
        try {
          const fsMatch = containerInfo.shapeMatches && containerInfo.shapeMatches.fileService && containerInfo.shapeMatches.fileService[0];
          if (fsMatch && fsMatch.keyName) {
            const dict = container._bindingDictionary._map;
            for (const [key, bindings] of dict.entries()) {
              if (typeof key === 'function' && key.name === fsMatch.keyName) {
                for (const b of bindings) {
                  const inst = getCached(b);
                  if (inst) { fileService = inst; break; }
                }
              }
              if (fileService) break;
            }
          }
          if (!fileService && container.isBound && container.isBound('FileService')) {
            fileService = await container.getAsync('FileService');
          }
          if (fileService) {
            containerInfo.fileServiceMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(fileService)).filter(m => typeof fileService[m] === 'function').slice(0, 30);
            containerInfo.fileServiceOwnKeys = Object.keys(fileService).slice(0, 20);
            const rootUri = workspaceService.workspace.resource;
            const statFn = fileService.stat || fileService['_stat'];
            if (typeof statFn === 'function') {
              fileStat = await statFn.call(fileService, rootUri).catch((e) => { fsError = e instanceof Error ? e.message : String(e); return null; });
            } else {
              fsError = 'fileService.stat is not a function';
            }
            if (!fileStat) {
              const resolved = await fileService.resolve(rootUri).catch((e) => { fsError = e instanceof Error ? e.message : String(e); return null; });
              containerInfo.fileServiceResolve = resolved ? { isDirectory: resolved.isDirectory, childrenCount: resolved.children && resolved.children.length } : null;
            }
            if (fileService.providers) {
              const providerSchemes = [];
              try {
                const entries = fileService.providers.entries ? fileService.providers.entries() : Object.entries(fileService.providers);
                for (const [scheme, provider] of entries) {
                  providerSchemes.push({ scheme: String(scheme), type: provider && provider.constructor && provider.constructor.name });
                }
              } catch (e) { providerSchemes.push({ error: String(e) }); }
              containerInfo.fileServiceProviders = providerSchemes;
            }
          }
        } catch (e) {
          fsError = e instanceof Error ? e.message : String(e);
        }

        // Try to create the FileNavigator widget via WidgetManager.
        try {
          const wmMatch = containerInfo.shapeMatches && containerInfo.shapeMatches.widgetManager && containerInfo.shapeMatches.widgetManager[0];
          let widgetManager = null;
          if (wmMatch && wmMatch.keyName) {
            const dict = container._bindingDictionary._map;
            for (const [key, bindings] of dict.entries()) {
              if (typeof key === 'function' && key.name === wmMatch.keyName) {
                for (const b of bindings) {
                  const inst = getCached(b);
                  if (inst) { widgetManager = inst; break; }
                }
              }
              if (widgetManager) break;
            }
          }
          containerInfo.widgetManagerFound = !!widgetManager;
          if (widgetManager) {
            const widget = await widgetManager.getOrCreateWidget('files');
            containerInfo.navigatorWidgetCreated = {
              type: widget && widget.constructor && widget.constructor.name,
              id: widget && widget.id,
              hasModel: !!(widget && widget.model),
              modelType: widget && widget.model && widget.model.constructor && widget.model.constructor.name,
              modelRootChildren: widget && widget.model && widget.model.root && widget.model.root.children && widget.model.root.children.length,
            };
            await new Promise(r => setTimeout(r, 3000));
            containerInfo.navigatorWidgetAfterWait = {
              modelRootChildren: widget && widget.model && widget.model.root && widget.model.root.children && widget.model.root.children.length,
              modelRootType: widget && widget.model && widget.model.root && widget.model.root.constructor && widget.model.root.constructor.name,
            };
          }
        } catch (e) {
          containerInfo.navigatorWidgetError = e instanceof Error ? e.message : String(e);
        }
      }
    } catch (e) {
      wsError = e instanceof Error ? e.message : String(e);
    }

    return {
      title: document.title,
      navigatorFound: !!navigatorWidget,
      navigatorId: navigatorWidget?.id,
      navigatorClass: navigatorWidget?.className,
      treeNodeCount: treeNodes.length,
      listRowCount: listRows.length,
      fileNodeCount: fileNodes.length,
      firstTreeNodes: Array.from(treeNodes).slice(0, 10).map(n => n.textContent?.trim() || ''),
      firstListRows: Array.from(listRows).slice(0, 10).map(n => n.textContent?.trim() || ''),
      explorerHTML: explorer ? explorer.outerHTML.slice(0, 6000) : '',
      filesPartHTML: (() => {
        const filesPart = document.querySelector('#explorer-view-container--files');
        return filesPart ? filesPart.outerHTML.slice(0, 4000) : '';
      })(),
      navigatorTree: describeTree(navigatorWidget),
      workspaceRoot,
      roots: roots.map(r => ({ uri: r.resource?.toString?.(), isDirectory: r.isDirectory, name: r.name })),
      hasWorkspaceService: !!workspaceService,
      wsError,
      fileServiceType: fileService && fileService.constructor && fileService.constructor.name,
      fileStat: fileStat ? { type: fileStat.type, isDirectory: fileStat.isDirectory, size: fileStat.size, name: fileStat.name } : null,
      fsError,
      containerInfo,
      luminoWidget: luminoWidget ? { type: luminoWidget.constructor && luminoWidget.constructor.name, id: luminoWidget.id, hasModel: !!luminoWidget.model } : null,
      theiaKeys: window.theia ? Object.keys(window.theia) : [],
    };
  });

  console.log(JSON.stringify(info, null, 2));

  // Try to open workspace via Theia container
  console.log('Attempting workspaceService.open via container...');
  let openResult = { skipped: true };
  try {
    openResult = await page.evaluate(async () => {
      const container = window.theia.container;
      // Try to find WorkspaceService by searching all bound singletons
      let ws = undefined;
      const checked = new Set();
      function search(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (checked.has(obj)) return;
        checked.add(obj);
        if (obj.constructor && /WorkspaceService$/i.test(obj.constructor.name) && typeof obj.open === 'function') {
          ws = obj;
          return;
        }
        for (const k of Object.keys(obj)) {
          search(obj[k]);
          if (ws) return;
        }
        for (const s of Object.getOwnPropertySymbols(obj)) {
          search(obj[s]);
          if (ws) return;
        }
      }
      search(container);
      if (!ws) return { error: 'WorkspaceService not found in container' };
      const URI = window.theia.URI || window.theia.core.URI;
      const uri = new URI('/tmp/kairo-e2e-workspaces/legacy-sample');
      await ws.open(uri);
      await new Promise(r => setTimeout(r, 3000));
      return { workspace: ws.workspace, roots: await ws.roots, recent: ws.recentWorkspaces };
    });
    console.log('Open result:', JSON.stringify(openResult, null, 2));
  } catch (e) {
    console.log('workspaceService.open failed:', e.message);
  }

  // Try to create the FileNavigatorWidget via WidgetManager and inspect any error
  console.log('Attempting to create FileNavigatorWidget via WidgetManager...');
  try {
    const widgetResult = await page.evaluate(async () => {
      const container = window.theia.container;
      const result = { log: [] };

      function findClass(nameRe) {
        try {
          const dict = container._bindingDictionary._map;
          for (const [key, value] of dict.entries()) {
            const name = typeof key === 'symbol' ? key.toString() : (typeof key === 'function' ? key.name : String(key));
            if (nameRe.test(name)) {
              return { key, name, bindings: value };
            }
          }
        } catch (e) { result.log.push(`findClass error: ${String(e)}`); }
        return undefined;
      }

      function getCachedInstance(bindings) {
        for (const binding of bindings) {
          const cache = binding._cache || binding.cache;
          if (cache && !(cache instanceof Promise)) return cache;
        }
        return undefined;
      }

      const appShellEntry = findClass(/ApplicationShell$/);
      result.log.push(`ApplicationShell entry: ${appShellEntry ? appShellEntry.name : 'not found'}`);
      const widgetManagerEntry = findClass(/WidgetManager$/);
      result.log.push(`WidgetManager entry: ${widgetManagerEntry ? widgetManagerEntry.name : 'not found'}`);
      const fileNavWidgetEntry = findClass(/FileNavigatorWidget$/);
      result.log.push(`FileNavigatorWidget entry: ${fileNavWidgetEntry ? fileNavWidgetEntry.name : 'not found'}`);

      // Dump all class/function key names for inspection
      const allClassNames = [];
      try {
        const dict = container._bindingDictionary._map;
        for (const [key] of dict.entries()) {
          if (typeof key === 'function') {
            allClassNames.push(key.name);
          }
        }
      } catch (e) { result.log.push(`dump error: ${String(e)}`); }
      result.allClassNames = allClassNames.sort();

      // Try to get WidgetManager from container by class key
      if (widgetManagerEntry) {
        try {
          const wm = container.get(widgetManagerEntry.key);
          result.log.push(`WidgetManager resolved: ${wm && wm.constructor && wm.constructor.name}`);
          const widget = await wm.getOrCreateWidget('files');
          result.widget = {
            type: widget.constructor && widget.constructor.name,
            hasModel: !!widget.model,
            modelType: widget.model && widget.model.constructor && widget.model.constructor.name,
            rootType: widget.model && widget.model.root && widget.model.root.constructor && widget.model.root.constructor.name,
            rootChildren: widget.model && widget.model.root && widget.model.root.children && widget.model.root.children.length,
            titleLabel: widget.title && widget.title.label,
          };
        } catch (e) {
          result.widgetError = e instanceof Error ? e.message : String(e);
          result.widgetStack = e instanceof Error ? e.stack : '';
        }
      }

      // Try ApplicationShell
      if (appShellEntry) {
        try {
          const shell = container.get(appShellEntry.key);
          result.shell = {
            type: shell.constructor && shell.constructor.name,
            leftAreaWidgetCount: shell.leftPanelHandler && shell.leftPanelHandler.dockPanel && shell.leftPanelHandler.dockPanel.widgets && shell.leftPanelHandler.dockPanel.widgets.length,
          };
        } catch (e) {
          result.shellError = e instanceof Error ? e.message : String(e);
        }
      }

      return result;
    });
    console.log('Widget result:', JSON.stringify(widgetResult, null, 2));
  } catch (e) {
    console.log('WidgetManager check failed:', e.message);
  }

  await page.waitForTimeout(5_000);

  // Try to focus and expand the file tree
  const filesTree = page.locator('#files').first();
  if (await filesTree.isVisible().catch(() => false)) {
    await filesTree.click();
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(2_000);
  }

  const afterOpen = await page.evaluate(() => {
    const treeNodes = document.querySelectorAll('.theia-TreeNode');
    const listRows = document.querySelectorAll('.monaco-list-row');
    const filesEl = document.querySelector('#files');
    const workspaceRoot = (window.theia && (window.theia.workspaceService || {}).workspace) || null;
    return {
      title: document.title,
      treeNodeCount: treeNodes.length,
      listRowCount: listRows.length,
      filesChildCount: filesEl ? filesEl.children.length : 0,
      filesHTML: filesEl ? filesEl.innerHTML.slice(0, 2000) : '',
      firstTreeNodes: Array.from(treeNodes).slice(0, 10).map(n => n.textContent?.trim() || ''),
      firstListRows: Array.from(listRows).slice(0, 10).map(n => n.textContent?.trim() || ''),
      workspaceRoot: workspaceRoot ? { name: workspaceRoot.name, uri: workspaceRoot.resource?.toString() } : null,
    };
  });

  console.log('After open:', JSON.stringify(afterOpen, null, 2));
  fs.writeFileSync(path.join(outDir, 'tree-info.json'), JSON.stringify({ initial: info, openResult, afterOpen }, null, 2));
  fs.writeFileSync(path.join(outDir, 'logs.txt'), logs.join('\n'));
  await page.screenshot({ path: path.join(outDir, 'screenshot.png'), fullPage: true });

  await browser.close();
})();
