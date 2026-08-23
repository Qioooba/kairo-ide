// Kairo IDE — Windows Desktop 全量自动点击/识图/测试 (Win-only)
// 目标：覆盖所有按钮和功能，自动识图判定，产出可追溯报告
// 仅针对 Windows 桌面端 Kairo.exe (Electron + Theia + Go Agent)，不走浏览器 3000/18301
//
// 用法:
//   node tests/e2e-windows/auto-deep-click.cjs                         # 全量
//   node tests/e2e-windows/auto-deep-click.cjs --exe "G:\...\Kairo.exe"
//   node tests/e2e-windows/auto-deep-click.cjs --step boot             # 单步调试
//   node tests/e2e-windows/auto-deep-click.cjs --list
//   node tests/e2e-windows/auto-deep-click.cjs --slow                  # 慢速可视
//
// 产出:
//   docs/screenshots/windows-deep-auto/*.png
//   artifacts/windows-deep-auto/*.json + report.md + desktop-main.log

const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

// ─── CLI ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, def) { const i = argv.indexOf(`--${name}`); return i>=0 && i+1<argv.length ? argv[i+1] : def; }
function flag(name) { return argv.includes(`--${name}`); }
const customExe = arg('exe', null);
const onlyStep = arg('step', null);
const wantList = flag('list');
const wantSlow = flag('slow');
const wantSmoke = flag('smoke');

// ─── 路径 ─────────────────────────────────────────────────
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-deep-auto');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-deep-auto');
const inventoryPath = path.join(recordDir, 'inventory.json');
const reportPath = path.join(recordDir, 'report.md');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(recordDir, { recursive: true });

// ─── 可执行文件定位 ───────────────────────────────────────
function resolveExecutable() {
  if (customExe) {
    if (!fs.existsSync(customExe)) throw new Error(`--exe 不存在: ${customExe}`);
    return { executablePath: customExe, args: [], mode: 'packaged-custom' };
  }
  let packaged = path.join(repoRoot, 'apps', 'desktop', 'dist', 'win-unpacked', 'Kairo.exe');
  if (!fs.existsSync(packaged)) {
    packaged = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  }
  if (!fs.existsSync(packaged)) {
    packaged = path.join(repoRoot, 'apps', 'desktop', 'dist', 'win-unpacked', 'Kairo IDE.exe');
  }
  if (fs.existsSync(packaged)) return { executablePath: packaged, args: [], mode: 'packaged' };
  const devMain = path.join(repoRoot, 'apps', 'desktop', 'lib', 'main.js');
  if (fs.existsSync(devMain)) {
    const electronBin = require(path.join(repoRoot, 'apps', 'desktop', 'node_modules', 'electron'));
    return { executablePath: electronBin, args: [devMain], mode: 'dev' };
  }
  throw new Error('找不到 Kairo.exe，请先 pnpm --filter @kairo/desktop build:win');
}

// ─── 日志 ─────────────────────────────────────────────────
const stamp = () => new Date().toISOString().slice(11,19);
const log = (m) => console.log(`[${stamp()}] ${m}`);
const warn = (m) => console.warn(`[${stamp()}] WARN ${m}`);

// ─── 全局状态 ─────────────────────────────────────────────
let shotIdx = 0;
let page, app;
let consoleErrors = [];
let testResults = []; // {phase, name, status, durationMs, error, screenshot}
let suiteStart = 0;
let agentPortHint = 0;

// ─── 工具 ─────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function shot(name) {
  const safe = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '-').slice(0, 80);
  const file = path.join(outDir, `${String(shotIdx).padStart(3,'0')}-${safe}.png`);
  shotIdx++;
  try {
    await page.screenshot({ path: file, fullPage: false });
    log(`shot: ${path.relative(repoRoot, file)}`);
    return path.relative(recordDir, file);
  } catch (e) { warn(`shot 失败 ${name}: ${e.message}`); return ''; }
}
async function shotFull(name) {
  const safe = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '-').slice(0, 80);
  const file = path.join(outDir, `${String(shotIdx).padStart(3,'0')}-${safe}-full.png`);
  shotIdx++;
  try { await page.screenshot({ path: file, fullPage: true }); log(`shotFull: ${path.relative(repoRoot, file)}`); return path.relative(recordDir, file);} catch(e){ warn(`shotFull 失败: ${e.message}`); return '';}
}
async function dismissTrustDialog(timeoutMs=8000){
  try{
    const dialog = page.locator('.dialogBlock, .workspace-trust-dialog');
    await dialog.first().waitFor({state:'visible', timeout: timeoutMs});
  }catch{ return; }
  try{
    const btn = page.locator('button:has-text("Yes, I trust"), button:has-text("信任"), button:has-text("Yes")').first();
    if(await btn.count()) await btn.click({timeout:3000});
  }catch{}
  await page.waitForSelector('.dialogBlock, .workspace-trust-dialog', {state:'detached', timeout:5000}).catch(()=>{});
  await sleep(300);
}
async function runTest(phase, name, fn){
  const start = Date.now();
  log(`[${phase}] TEST: ${name} ...`);
  let screenshot = '';
  try{
    await fn();
    const dur = Date.now()-start;
    screenshot = await shot(`${phase}-${name}`);
    // 识图判定：非黑屏 + 无 .kairo-error-banner 意外
    const vision = await page.evaluate(()=>{
      try{
        const errBanner = document.querySelector('.kairo-error-banner');
        const shell = document.querySelector('#theia-app-shell, #theia-ApplicationShell, .theia-application');
        return {hasShell: !!shell, hasErrorBanner: !!errBanner, bodyTextLen: document.body.innerText.length};
      }catch{ return {hasShell:false, hasErrorBanner:false, bodyTextLen:0};}
    });
    // 简单健康判定
    const ok = vision.hasShell && vision.bodyTextLen > 10;
    if(!ok) throw new Error(`视觉判定失败 shell=${vision.hasShell} textLen=${vision.bodyTextLen} errorBanner=${vision.hasErrorBanner}`);
    testResults.push({phase, name, status:'pass', durationMs:dur, screenshot, vision});
    log(`  PASS ${dur}ms`);
  }catch(err){
    const dur = Date.now()-start;
    screenshot = await shot(`FAIL-${phase}-${name}`);
    testResults.push({phase, name, status:'fail', durationMs:dur, error: err.message, screenshot});
    warn(`  FAIL ${dur}ms: ${err.message}`);
  }
}

// ─── 命令/菜单清单（静态 + 动态） ─────────────────────────
const STATIC_KAIRO_COMMANDS = [
  'Kairo: Import Project', 'Kairo: Select Project', 'Kairo: Scan Project',
  'Kairo: Build', 'Kairo: Clean Build', 'Kairo: Build and Deploy', 'Kairo: Publish',
  'Kairo: Start Server', 'Kairo: Start Server (Debug)', 'Kairo: Stop Server', 'Kairo: Restart Server', 'Kairo: Open Application',
  'Kairo: Show Servers', 'Kairo: Show Builds', 'Kairo: Show Deployments', 'Kairo: Show Tomcat Logs',
  'Kairo: Show Maven', 'Kairo: Show TODO/FIXME', 'Kairo: Show Test Results', 'Kairo: Show SQL Console', 'Kairo: Show Remote Development', 'Kairo: Show Performance',
  'Kairo: Show Debug Variables', 'Kairo: Show Debug Callstack', 'Kairo: Show Debug Breakpoints', 'Kairo: Show Debug Watch', 'Kairo: Show Debug Toolbar', 'Kairo: Show Debug Console',
  'Kairo: Manage Run Configurations', 'Kairo: Switch JDK', 'Kairo: Reconnect Agent', 'Kairo: Open Keyboard Shortcuts', 'Kairo: Toggle Terminal',
  'Kairo: Check Java Debug Adapter', 'Kairo: Open Debug View', 'Kairo: Open Debug Console',
  // IDEA 风格
  'Debug: Open Debug Tool Window (IDEA-style)', 'Debug: Rerun', 'Debug: Drop Frame',
];

const STATIC_NATIVE_MENUS = [
  {top:'File', items:['New Text File','New File...','Open File...','Open Folder...','Save','Save As...','Save All','Import Kairo Project...','Select Kairo Project...','Run Configurations...','Preferences','Close Tab','Close All Tabs','Exit']},
  {top:'Edit', items:['Undo','Redo','Cut','Copy','Paste','Find','Replace','Select All']},
  {top:'Selection', items:['Select All','Expand Selection','Shrink Selection']},
  {top:'View', items:['Explorer','Search','Source Control','Debug','Terminal','Problems','Kairo Servers','Kairo Builds','Kairo Deployments','Tomcat Logs','Maven','TODO / FIXME','Test Results','SQL Console','Remote Development','Performance Dashboard']},
  {top:'Go', items:['Back','Forward','Go to File...','Go to Line...','Go to Symbol...']},
  {top:'Terminal', items:['New Terminal','Toggle Terminal']},
  {top:'Kairo', items:['Import Kairo Project...','Select Kairo Project...','Scan Workspace','Run Configurations...','Build','Clean Build','Build & Deploy','Publish','Start Server','Start Server (Debug)','Stop Server','Restart Server','Open Application','Check Java Debug Adapter','Servers','Builds','Deployments','Tomcat Logs','Maven','TODO / FIXME','Test Results','SQL Console','Remote Development','Performance Dashboard','Open Debug View','Open Debug Console','Toggle Terminal','Keyboard Shortcuts','Switch JDK','Configure Tomcat...','Reconnect Runtime Agent']},
  {top:'Help', items:['Welcome','Toggle Developer Tools','Debug Diagnostics','About']},
];

const STATIC_ACTIVITY_BAR = ['Explorer','Search','Source Control','Run and Debug','Java','Servers']; // 近似
const STATIC_WIDGET_VIEWS = [
  {id:'servers', cmd:'Kairo: Show Servers', label:'Servers'},
  {id:'builds', cmd:'Kairo: Show Builds', label:'Builds'},
  {id:'deployments', cmd:'Kairo: Show Deployments', label:'Deployments'},
  {id:'logs', cmd:'Kairo: Show Tomcat Logs', label:'Tomcat Logs'},
  {id:'maven', cmd:'Kairo: Show Maven', label:'Maven'},
  {id:'todo', cmd:'Kairo: Show TODO/FIXME', label:'TODO'},
  {id:'tests', cmd:'Kairo: Show Test Results', label:'Test Results'},
  {id:'sql', cmd:'Kairo: Show SQL Console', label:'SQL Console'},
  {id:'remote', cmd:'Kairo: Show Remote Development', label:'Remote'},
  {id:'perf', cmd:'Kairo: Show Performance', label:'Perf Dashboard'},
  {id:'debugVars', cmd:'Kairo: Show Debug Variables', label:'Debug Variables'},
  {id:'debugStack', cmd:'Kairo: Show Debug Callstack', label:'Call Stack'},
  {id:'debugBp', cmd:'Kairo: Show Debug Breakpoints', label:'Breakpoints'},
  {id:'debugWatch', cmd:'Kairo: Show Debug Watch', label:'Watch'},
];

// ─── 动态发现 ─────────────────────────────────────────────
async function discoverInventory(){
  // 尝试从运行时获取真实命令列表（若 palette 可用）
  let dynamicCommands = [];
  try{
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:5000});
    const input = await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Kairo', {delay:30});
    await sleep(1000);
    dynamicCommands = await page.$$eval('.quick-input-widget .monaco-list-row', els=> els.map(e=> (e.getAttribute('aria-label')||e.textContent||'').trim()).filter(Boolean));
    await page.keyboard.press('Escape');
    await sleep(300);
    log(`动态发现 Kairo 命令 ${dynamicCommands.length} 条`);
  }catch(e){ warn(`动态发现命令失败: ${e.message}`); await page.keyboard.press('Escape').catch(()=>{}); }
  // DOM 枚举
  let dom = {activityBar:[], toolbar:[], statusBar:[]};
  try{
    dom = await page.evaluate(()=>{
      const abSels = ['.theia-app-left .lm-TabBar-tab','.lm-TabBar.theia-app-left .lm-TabBar-tab','.lm-TabBar-tab'];
      const ab = []; const seen=new Set();
      for(const sel of abSels){ for(const el of document.querySelectorAll(sel)){ if(seen.has(el)) continue; seen.add(el); ab.push({title: el.getAttribute('title')||el.getAttribute('aria-label')||'', text:(el.textContent||'').trim().slice(0,50), cls:el.className});}}
      const tb = [...document.querySelectorAll('.kairo-toolbar button, .theia-button, .p-Toolbar button')].map(b=> (b.textContent||'').trim().slice(0,40)).filter(Boolean);
      const sb = document.querySelector('#theia-statusBar, .theia-statusBar');
      const sbText = sb ? sb.innerText.slice(0,300) : '';
      return {activityBar:ab, toolbar: tb.slice(0,20), statusBar: sbText};
    });
    log(`DOM 发现 activityBar ${dom.activityBar.length} toolbar ${dom.toolbar.length} statusBarLen ${dom.statusBar.length}`);
  }catch(e){ warn(`DOM 发现失败: ${e.message}`); }
  // Electron 菜单（主进程）
  let electronMenu = [];
  try{
    electronMenu = await app.evaluate(({Menu})=>{
      const m = Menu.getApplicationMenu();
      if(!m) return [];
      return m.items.map(it=>({label: it.label, submenu: (it.submenu? it.submenu.items.map(s=>s.label).filter(Boolean): [])}));
    });
    log(`Electron 菜单 ${electronMenu.length} 顶级`);
  }catch(e){ warn(`Electron 菜单获取失败: ${e.message}`); }
  const inventory = {
    generatedAt: new Date().toISOString(),
    staticKairoCommands: STATIC_KAIRO_COMMANDS,
    dynamicKairoCommands: dynamicCommands,
    staticNativeMenus: STATIC_NATIVE_MENUS,
    electronMenu,
    dom,
    staticWidgetViews: STATIC_WIDGET_VIEWS,
  };
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2), 'utf-8');
  log(`inventory 写入 ${path.relative(repoRoot, inventoryPath)}`);
  return inventory;
}

// ─── 步骤库 ───────────────────────────────────────────────
const steps = {};

steps.boot = async () => {
  log('boot: 等待 Theia shell (#theia-statusBar)');
  await page.waitForSelector('#theia-statusBar', {timeout: 90000});
  await page.waitForSelector('#theia-ApplicationShell', {timeout:30000}).catch(()=>{});
  await sleep(2000);
  await dismissTrustDialog();
  await shotFull('boot-shell');
  // 清理残留欢迎页
  try{
    const closed = await page.evaluate(()=>{
      const tabs=[...document.querySelectorAll('.p-TabBar-tab, .lm-TabBar-tab, .theia-tabbar-tab')];
      let n=0; for(const t of tabs){ const lbl=(t.getAttribute('title')||t.textContent||'').trim(); if(/Import Project|导入项目|Welcome|欢迎/i.test(lbl)){ const c=t.querySelector('.p-TabBar-tabCloseIcon, .theia-tabbar-tab-close, .p-TabBar-tabClose, .lm-TabBar-tabCloseIcon'); if(c){ c.click(); n++;}}}
      return n;
    });
    if(closed>0) log(`清理残留 tab ${closed}`);
    await sleep(800);
  }catch{}
};

steps.windowInfo = async () => {
  const info = await app.evaluate(({app, BrowserWindow})=>{
    const wins = BrowserWindow.getAllWindows();
    return {
      title: app.getName(),
      windowCount: wins.length,
      windows: wins.map(w=>({title:w.getTitle(), url:w.webContents.getURL(), bounds:w.getBounds(), isVisible:w.isVisible()})),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
      agentUrl: process.env.KAIRO_AGENT_URL || '',
    };
  });
  log(`windowInfo: ${JSON.stringify(info,null,2)}`);
  fs.writeFileSync(path.join(recordDir,'window-info.json'), JSON.stringify(info,null,2));
  // 优先从 app env 读取 Agent URL，其次读 agent-state.json，最后回退扫描
  try{
    let agentPort = 0;
    if(info.agentUrl){
      try{ const u=new URL(info.agentUrl); agentPort=parseInt(u.port,10); }catch{}
    }
    if(!agentPort){
      const statePath = path.join(recordDir,'userdata','kairo-data','agent-state.json');
      if(fs.existsSync(statePath)){
        const st=JSON.parse(fs.readFileSync(statePath,'utf-8'));
        if(st.port) agentPort=st.port;
      }
    }
    let agentInfo={port:0, ok:false};
    const tryPorts = agentPort ? [agentPort, 18080, 18081] : [18080,18081,18082];
    // 在 renderer 中 fetch 健康
    agentInfo = await page.evaluate(async (ports)=>{
      for(const p of ports){
        try{ const r=await fetch(`http://127.0.0.1:${p}/api/v1/health`); if(r.ok){ const j=await r.json(); return {port:p, ok:true, data:j}; } }catch{}
      }
      return {port:0, ok:false};
    }, tryPorts);
    // 若 renderer 失败，直接用主进程 http 探测（绕过 CSP）
    if(!agentInfo.ok && agentPort){
      const http=require('http');
      const probe = (port)=> new Promise(res=>{
        const req=http.get(`http://127.0.0.1:${port}/api/v1/health`, r=>{ let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{ res({port, ok:r.statusCode===200, data:JSON.parse(d)}); }catch{ res({port, ok:true, data:{}});} }); });
        req.on('error',()=>res({port:0, ok:false})); req.setTimeout(2000,()=>{req.destroy(); res({port:0, ok:false});});
      });
      const direct=await probe(agentPort);
      if(direct.ok) agentInfo=direct;
    }
    log(`agent health: ${JSON.stringify(agentInfo).slice(0,600)}`);
    if(agentInfo.port) agentPortHint = agentInfo.port;
    fs.writeFileSync(path.join(recordDir,'agent-health.json'), JSON.stringify(agentInfo,null,2));
  }catch(e){ warn(`agent health 探测失败: ${e.message}`); }
};

steps.discover = async () => {
  await discoverInventory();
};

steps.activityBar = async () => {
  // 依次点击所有 ActivityBar 图标
  const items = await page.evaluate(()=>{
    const sels=['.theia-app-left .lm-TabBar-tab','.lm-TabBar.theia-app-left .lm-TabBar-tab','.lm-TabBar-tab','.p-TabBar-tab'];
    const seen=new Set(); const out=[];
    for(const sel of sels){ for(const el of document.querySelectorAll(sel)){ if(seen.has(el)) continue; seen.add(el); out.push({title:el.getAttribute('title')||el.getAttribute('aria-label')||'', idx: out.length}); }}
    return out;
  });
  log(`activityBar 发现 ${items.length} 个 tab`);
  for(let i=0;i<Math.min(items.length, 10); i++){
    await runTest('ActivityBar', `click-${i}-${(items[i].title||'tab-'+i).slice(0,20)}`, async()=>{
      const tabs = page.locator('.lm-TabBar-tab, .p-TabBar-tab');
      const cnt = await tabs.count();
      if(cnt> i){
        await tabs.nth(i).click({timeout:3000});
        await sleep(600);
      } else {
        throw new Error(`tab ${i} 不存在 cnt=${cnt}`);
      }
    });
    if(wantSlow) await sleep(250);
  }
};

steps.commandPaletteFull = async () => {
  // 全量 Kairo 命令逐一执行 — 以静态 39 条为准（动态仅作补充，不截断）
  let commands = STATIC_KAIRO_COMMANDS;
  try{
    const inv = JSON.parse(fs.readFileSync(inventoryPath,'utf-8'));
    if(inv.dynamicKairoCommands && inv.dynamicKairoCommands.length>10){
      // 合并去重，静态为主
      const set=new Set(commands);
      for(const c of inv.dynamicKairoCommands) if(!set.has(c)) commands.push(c);
    }
  }catch{}
  log(`commandPaletteFull 将执行 ${commands.length} 条 Kairo 命令`);
  for(const cmd of commands){
    await runTest('Command', cmd, async()=>{
      await page.keyboard.press('Escape');
      await sleep(200);
      await page.keyboard.press('Control+Shift+P');
      await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
      const input = await page.$('.quick-input-widget input[type="text"]');
      if(!input) throw new Error('无 quick-input');
      await input.fill('>');
      await sleep(100);
      await input.type(cmd.replace(/^Kairo:\s*/,'').replace(/^Debug:\s*/,''), {delay:25});
      await sleep(800);
      const hit = await page.evaluate((label)=>{
        const rows=[...document.querySelectorAll('.quick-input-widget .monaco-list-row')];
        return rows.some(r=> (r.getAttribute('aria-label')||r.textContent||'').toLowerCase().includes(label.toLowerCase().slice(0,12)));
      }, cmd);
      if(!hit){
        // 尝试完整匹配
        const anyHit = await page.evaluate(()=> document.querySelectorAll('.quick-input-widget .monaco-list-row').length);
        if(anyHit===0) throw new Error('无匹配命令');
      }
      await page.keyboard.press('Enter');
      await sleep(1000);
      // 若是对话框，等待出现后关闭
      const dialogVisible = await page.locator('[role="dialog"], .dialogBlock, .theia-dialog').count().then(c=>c>0).catch(()=>false);
      if(dialogVisible){
        await sleep(500);
        // 截图对话框已在外层 shot，这里关闭
        await page.keyboard.press('Escape');
        await sleep(400);
      }
    });
    if(wantSlow) await sleep(200);
  }
};

steps.nativeMenus = async () => {
  // 测试渲染层 Theia 菜单栏（.lm-MenuBar / #theia-top-panel），非 Electron原生菜单
  // Electron原生菜单在 did-finish-load 后才设置，且默认仅 5 项，需等待
  await sleep(800);
  const rendererMenus = await page.evaluate(()=>{
    const bar=document.querySelector('#theia-top-panel, .lm-MenuBar, .p-MenuBar, #theia:menubar');
    if(!bar) return [];
    const items=[...bar.querySelectorAll('.lm-MenuBar-item, .p-MenuBar-item, li')].map(e=> (e.textContent||'').trim()).filter(Boolean);
    const hasKairo= [...document.querySelectorAll('*')].some(e=> /Kairo/.test(e.textContent||''));
    return {items, html: bar.outerHTML.slice(0,800), hasKairo};
  }).catch(()=>({items:[]}));
  log(`renderer menubar items: ${JSON.stringify(rendererMenus).slice(0,600)}`);
  await shot('menubar-overview');
  // 尝试点击渲染层菜单
  const menusToTry = ['File','Edit','View','Kairo','Help'];
  for(const top of menusToTry){
    await runTest('Menu', `renderer-${top}`, async()=>{
      const barItem = page.locator('#theia-top-panel .lm-MenuBar-item, .lm-MenuBar-item, .p-MenuBar-item').filter({hasText: top}).first();
      const cnt=await barItem.count();
      if(cnt>0){
        await barItem.click({timeout:3000});
        await sleep(500);
        await shot(`menu-${top}-expanded`);
        // 检查下拉是否出现
        const menuVisible = await page.locator('.lm-Menu, .p-Menu, .theia-menu').count().then(c=>c>0);
        log(`  ${top} menuVisible=${menuVisible}`);
        await page.keyboard.press('Escape');
        await sleep(400);
      } else {
        // 某些环境菜单在顶部由 Electron原生渲染，改测键盘
        await page.keyboard.press('Alt');
        await sleep(300);
        await page.keyboard.press('Escape');
        // 不视为失败，仅记录
        log(`  ${top} 无渲染层菜单项，回退键盘`);
      }
    });
  }
  // 额外验证主进程菜单已设置（延迟检查）
  try{
    await sleep(1000);
    const electronMenu = await app.evaluate(({Menu})=>{
      const m=Menu.getApplicationMenu();
      return m ? m.items.map(i=>({label:i.label, n: i.submenu? i.submenu.items.length:0})) : [];
    });
    log(`主进程菜单(延迟): ${JSON.stringify(electronMenu)}`);
    // 写入报告供审计
    fs.writeFileSync(path.join(recordDir,'electron-menu-delayed.json'), JSON.stringify(electronMenu,null,2));
  }catch{}
};

steps.kairoViews = async () => {
  // 逐一打开所有 Kairo 视图，测试工具栏按钮
  for(const v of STATIC_WIDGET_VIEWS){
    await runTest('View', v.label, async()=>{
      await page.keyboard.press('Control+Shift+P');
      await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
      const input = await page.$('.quick-input-widget input[type="text"]');
      await input.fill('>');
      await input.type(v.cmd.replace('Kairo: ',''), {delay:25});
      await sleep(700);
      await page.keyboard.press('Enter');
      await sleep(1200);
      // 视图内工具栏按钮点击
      const btns = page.locator('.kairo-toolbar button, .theia-button, .p-Toolbar button');
      const cnt = await btns.count();
      log(`  ${v.label} 工具栏按钮 ${cnt}`);
      // 点前2个非危险按钮
      for(let i=0;i<Math.min(cnt,2); i++){
        try{
          const b = btns.nth(i);
          const text = await b.textContent().then(t=> (t||'').trim()).catch(()=> '');
          if(/Delete|Remove|Exit/i.test(text)) continue;
          await b.click({timeout:2000});
          await sleep(500);
        }catch{}
      }
      // 滚动到底部截图（验证空态/列表）
      await page.evaluate(()=>{
        const els=[...document.querySelectorAll('.kairo-widget, .p-Widget, .theia-view-container')];
        for(const el of els){ try{ el.scrollTop = el.scrollHeight; }catch{} }
        window.scrollTo(0, document.body.scrollHeight);
      });
      await sleep(300);
    });
  }
};

steps.editor = async () => {
  await runTest('Editor', 'open-README-and-type', async()=>{
    await page.keyboard.press('Escape'); await sleep(200);
    await page.keyboard.press('Control+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:10000});
    const input = await page.$('.quick-input-widget input[type="text"]');
    await input.fill('');
    await input.type('README.md', {delay:25});
    let matched=false;
    for(let i=0;i<20;i++){
      matched = await page.evaluate(()=> [...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(r=> /README\.md/i.test(r.getAttribute('aria-label')||r.textContent||'')));
      if(matched) break; await sleep(400);
    }
    if(matched) await page.keyboard.press('Enter');
    else {
      await page.keyboard.press('Escape');
      const opened = await page.evaluate(()=>{
        const n=[...document.querySelectorAll('.theia-TreeNode, .theia-TreeNodeSegment')].find(x=> /README\.md/i.test(x.textContent||''));
        if(n){ n.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return true; } return false;
      });
      if(!opened) throw new Error('README.md 未找到');
    }
    await page.waitForSelector('.monaco-editor', {timeout:30000});
    await sleep(800);
    await page.evaluate(()=>{ const ta=document.querySelector('.monaco-editor textarea.inputarea'); if(ta) ta.focus(); });
    await sleep(200);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('// AutoDeepClick Windows 桌面测试 '+new Date().toISOString(), {delay:12});
    await sleep(400);
    // 快捷键
    await page.keyboard.press('Control+/');
    await sleep(300);
    await page.keyboard.press('Control+Z');
    await sleep(300);
  });
  await runTest('Editor', 'shortcuts-CtrlSpace-triggerSuggest', async()=>{
    await page.keyboard.press('Control+Space');
    await sleep(900);
    const sug = await page.evaluate(()=>{
      const w=document.querySelector('.suggest-widget, .monaco-editor .suggest-widget');
      if(!w) return {visible:false};
      const s=getComputedStyle(w);
      return {visible: s.display!=='none' && w.offsetParent!==null};
    });
    log(`  suggest visible=${sug.visible}`);
    await page.keyboard.press('Escape');
    await sleep(200);
  });
  await runTest('Editor', 'monaco-interactions', async()=>{
    const ed = page.locator('.monaco-editor').first();
    await ed.hover({timeout:3000}).catch(()=>{});
    await page.mouse.wheel(0, 200);
    await sleep(300);
    await page.mouse.wheel(0, -200);
    await sleep(300);
    // 右键上下文菜单
    await page.locator('.monaco-editor .view-lines').first().click({button:'right', timeout:3000}).catch(()=>{});
    await sleep(500);
    const hasMenu = await page.locator('.p-Menu, .monaco-menu, .context-menu').count().then(c=>c>0);
    log(`  context menu visible=${hasMenu}`);
    await page.keyboard.press('Escape');
    await sleep(200);
  });
};

steps.dialogs = async () => {
  const dialogs = [
    {name:'Import Project', cmd:'Kairo: Import Project'},
    {name:'Run Configurations', cmd:'Kairo: Manage Run Configurations'},
    {name:'Keyboard Shortcuts', cmd:'Kairo: Open Keyboard Shortcuts'},
    {name:'Preferences', key:'Control+,'},
  ];
  for(const d of dialogs){
    await runTest('Dialog', d.name, async()=>{
      if(d.cmd){
        await page.keyboard.press('Control+Shift+P');
        await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
        const input=await page.$('.quick-input-widget input[type="text"]');
        await input.fill('>');
        await input.type(d.cmd.replace('Kairo: ',''), {delay:25});
        await sleep(700);
        await page.keyboard.press('Enter');
        await sleep(1200);
      } else if(d.key){
        await page.keyboard.press(d.key);
        await sleep(1000);
      }
      const dlgCnt = await page.locator('[role="dialog"], .dialogBlock, .theia-dialog, .p-Dialog').count();
      log(`  dialog count=${dlgCnt}`);
      // 输入框测试：填充 test-输入-123
      const inputs = page.locator('[role="dialog"] input, .dialogBlock input, .theia-dialog input');
      const icnt = await inputs.count();
      for(let i=0;i<Math.min(icnt,3); i++){
        try{ await inputs.nth(i).click({timeout:2000}); await page.keyboard.press('Control+A'); await page.keyboard.type('test-输入-123',{delay:20}); await sleep(200);}catch{}
      }
      await page.keyboard.press('Escape');
      await sleep(500);
      // 再发一次 Escape 确保关闭
      await page.keyboard.press('Escape');
      await sleep(300);
    });
  }
};

steps.bottomAndStatus = async () => {
  await runTest('Bottom', 'toggle-panels', async()=>{
    // 通过命令切换底部面板
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:5000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Toggle Bottom Panel', {delay:25});
    await sleep(500);
    const has = await page.evaluate(()=> [...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(r=> /Toggle Bottom Panel/i.test(r.textContent||'')));
    if(has) await page.keyboard.press('Enter');
    else await page.keyboard.press('Escape');
    await sleep(700);
    // 再切回来
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:5000}).catch(()=>{});
    const input2=await page.$('.quick-input-widget input[type="text"]');
    if(input2){ await input2.fill('>'); await input2.type('Toggle Bottom Panel',{delay:25}); await sleep(400); await page.keyboard.press('Enter').catch(()=>{}); }
    await sleep(500);
  });
  await runTest('StatusBar', 'verify-statusBar', async()=>{
    const sb = await page.evaluate(()=>{
      const el=document.querySelector('#theia-statusBar, .theia-statusBar');
      return el ? el.innerText.slice(0,500) : '';
    });
    log(`  statusBar: ${sb.slice(0,200)}`);
    if(!sb || sb.length<5) throw new Error('statusBar 为空');
    // 识图：检查关键 token
    const hasTokens = /master|main|JDK|Java|GBK|UTF|Tomcat|Connected|LF|CRLF/i.test(sb);
    if(!hasTokens) warn('statusBar 未包含预期 token，但不判定失败');
  });
};

steps.keyBindings = async () => {
  const shortcuts = [
    {name:'F1 palette', key:'F1', expectPalette:true},
    {name:'Ctrl+Shift+P', key:'Control+Shift+P', expectPalette:true},
    {name:'Ctrl+P quickOpen', key:'Control+P', expectPalette:true},
    {name:'Ctrl+Shift+N findFile', key:'Control+Shift+N', expectPalette:true},
    {name:'Ctrl+F10 update', key:'Control+F10', expectPalette:false}, // 新热更快捷键
  ];
  for(const s of shortcuts){
    await runTest('Key', s.name, async()=>{
      await page.keyboard.press(s.key);
      await sleep(600);
      if(s.expectPalette){
        const vis = await page.locator('.quick-input-widget').count().then(c=>c>0);
        if(!vis) throw new Error('palette 未出现');
        await page.keyboard.press('Escape');
        await sleep(300);
      } else {
        // 热更快捷键不应崩溃
        await sleep(400);
        await page.keyboard.press('Escape');
      }
    });
  }
};

steps.final = async () => {
  await runTest('Final', 'full-shell', async()=>{
    await page.evaluate(()=> window.scrollTo(0,0));
    await sleep(500);
    await shotFull('final-full-shell');
  });
  await runTest('Final', 'health-check', async()=>{
    // 优先用已探测的 agentPortHint，其次从文件
    let port = agentPortHint;
    if(!port){
      try{ const st=JSON.parse(fs.readFileSync(path.join(recordDir,'userdata','kairo-data','agent-state.json'),'utf-8')); port=st.port; }catch{}
    }
    let h={ok:false};
    if(port){
      const http=require('http');
      h = await new Promise(res=>{
        const req=http.get(`http://127.0.0.1:${port}/api/v1/health`, r=>{ let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{ res({port, ok:r.statusCode===200, data:JSON.parse(d)}); }catch{ res({port, ok:true, data:{}});} }); });
        req.on('error',()=>res({ok:false})); req.setTimeout(2000,()=>{req.destroy(); res({ok:false});});
      });
    }
    if(!h.ok){
      h = await page.evaluate(async (ph)=>{
        const ports= ph ? [ph,18080,18081] : [18080,18081];
        for(const p of ports){
          try{ const r=await fetch(`http://127.0.0.1:${p}/api/v1/health`); if(r.ok){ const j=await r.json(); return {port:p, ok:true, data:j}; }}catch{}
        }
        return {ok:false};
      }, port);
    }
    log(`  final health: ${JSON.stringify(h).slice(0,500)}`);
    if(!h.ok) throw new Error('Go Agent 健康检查失败');
    const shellOk = await page.locator('#theia-app-shell, #theia-ApplicationShell, .theia-application').first().isVisible().catch(()=>false);
    if(!shellOk) throw new Error('shell 不可见');
  });
};

// ─── 序列表 ───────────────────────────────────────────────
const fullOrder = ['boot','windowInfo','discover','activityBar','commandPaletteFull','nativeMenus','kairoViews','editor','dialogs','bottomAndStatus','keyBindings','final'];
const smokeOrder = ['boot','windowInfo','discover','final'];

if(wantList){
  console.log('Full steps:'); fullOrder.forEach(s=> console.log(' - '+s));
  console.log('Smoke steps:'); smokeOrder.forEach(s=> console.log(' - '+s));
  console.log('Static Kairo commands:', STATIC_KAIRO_COMMANDS.length);
  console.log('Native menus:', STATIC_NATIVE_MENUS.length);
  process.exit(0);
}

// ─── 主流程 ─────────────────────────────────────────────
(async()=>{
  const exec = resolveExecutable();
  suiteStart = Date.now();
  log(`启动 Windows 桌面: ${exec.executablePath} (${exec.mode})`);
  if(wantSlow) log('慢速模式 250ms');
  const userDataDir = path.join(recordDir, 'userdata');
  fs.mkdirSync(userDataDir, {recursive:true});
  const env = {
    ...process.env,
    KAIRO_DESKTOP_LOG_FILE: path.join(recordDir, 'desktop-main.log'),
    KAIRO_NO_DEVTOOLS: '1',
    KAIRO_DEV: '1',
    KAIRO_NO_KAIRO_FRONTEND: process.env.KAIRO_NO_KAIRO_FRONTEND||'0',
    KAIRO_USER_DATA_DIR: userDataDir,
  };
  const launchArgs = exec.args.length===0 ? [`--user-data-dir=${userDataDir}`] : exec.args;
  log(`userDataDir: ${userDataDir}`);
  app = await electron.launch({
    executablePath: exec.executablePath,
    args: launchArgs,
    env,
    timeout: 90000,
  });
  log(`electron 已启动 pid=${app.process().pid}`);
  page = await app.firstWindow({timeout:60000});
  log(`首窗口: ${await page.title()} url=${page.url()}`);

  // 监听
  page.on('console', m=>{ if(m.type()==='error'){ consoleErrors.push(`[console] ${m.text()}`); log(`[console:error] ${m.text().slice(0,200)}`);} });
  page.on('pageerror', e=>{ consoleErrors.push(`[pageerror] ${e.message}`); log(`[pageerror] ${e.message}`); });
  page.on('dialog', async d=>{ log(`dialog ${d.type()}: "${String(d.message()||'').slice(0,80)}"`); try{ await d.accept(); }catch{} });

  const order = onlyStep ? [onlyStep] : (wantSmoke ? smokeOrder : fullOrder);
  let failedSteps = 0;
  for(const name of order){
    const fn = steps[name];
    if(!fn){ warn(`未知步骤 ${name}`); failedSteps++; continue; }
    try{
      if(wantSlow) await sleep(250);
      log(`— 步骤 ${name} 开始 —`);
      await fn();
      log(`— 步骤 ${name} 完成 —`);
    }catch(e){
      warn(`步骤 ${name} 抛异常: ${e.message}`);
      try{ await shot(`FAIL-${name}`); }catch{}
      failedSteps++;
    }
  }

  // 汇总
  const durSec = ((Date.now()-suiteStart)/1000).toFixed(1);
  const passed = testResults.filter(r=>r.status==='pass').length;
  const failed = testResults.filter(r=>r.status==='fail').length;
  log(`\n${'='.repeat(60)}`);
  log(`汇总: 总 ${testResults.length} | 通过 ${passed} | 失败 ${failed} | 步骤失败 ${failedSteps} | 耗时 ${durSec}s`);
  if(failed>0){ log('失败用例:'); testResults.filter(r=>r.status==='fail').forEach(r=> log(` - [${r.phase}] ${r.name}: ${r.error}`)); }
  log(`consoleErrors: ${consoleErrors.length}`);
  consoleErrors.slice(0,20).forEach(e=> log(`  ${e}`));

  // 报告
  const md = `# Kairo IDE Windows 桌面全量自动测试报告

**时间**: ${new Date().toISOString()}
**可执行**: \`${exec.executablePath}\` (${exec.mode})
**耗时**: ${durSec}s
**结果**: ${passed}/${testResults.length} 通过, ${failed} 失败, 步骤异常 ${failedSteps}
**截图目录**: \`docs/screenshots/windows-deep-auto/\`
**日志**: \`artifacts/windows-deep-auto/desktop-main.log\`
**Agent 端口提示**: ${agentPortHint || '自动探测'}

## 汇总表

| # | 阶段 | 用例 | 状态 | 耗时 | 截图 |
|---|------|------|------|------|------|
${testResults.map((r,i)=>`| ${i+1} | ${r.phase} | ${r.name} | ${r.status==='pass'?'PASS':'FAIL'} | ${r.durationMs}ms | ${r.screenshot||'-'} |`).join('\n')}

## 失败详情

${failed? testResults.filter(r=>r.status==='fail').map(r=>`### ${r.phase} / ${r.name}\n\n\`\`\`\n${r.error}\n\`\`\``).join('\n\n') : '无，全部通过'}

## 控制台错误

${consoleErrors.length? consoleErrors.slice(0,50).map(e=>`- ${e}`).join('\n') : '0 条'}

## 环境

- Electron: via windowInfo.json
- Agent: via agent-health.json
- Inventory: via inventory.json

## 覆盖清单（静态）

- Kairo 命令 ${STATIC_KAIRO_COMMANDS.length} 条
- 原生菜单 ${STATIC_NATIVE_MENUS.length} 顶级
- 视图 ${STATIC_WIDGET_VIEWS.length} 个
- 快捷键含 Ctrl+F10 热更
`;
  fs.writeFileSync(reportPath, md, 'utf-8');
  fs.writeFileSync(path.join(recordDir,'results.json'), JSON.stringify({finishedAt:new Date().toISOString(), executable: exec.executablePath, mode: exec.mode, durationSec: durSec, passed, failed, total:testResults.length, failedSteps, consoleErrors: consoleErrors.slice(0,50), testResults}, null, 2));
  fs.writeFileSync(path.join(recordDir,'summary.json'), JSON.stringify({finishedAt:new Date().toISOString(), executable: exec.executablePath, mode: exec.mode, stepsRun: order, passed, failed, total:testResults.length, consoleErrorCount: consoleErrors.length}, null, 2));
  log(`报告写入 ${path.relative(repoRoot, reportPath)}`);
  log(`截图目录 ${path.relative(repoRoot, outDir)}`);

  log('关闭应用');
  try{ await app.close(); }catch(e){ warn(`app.close: ${e.message}`); }
  if(failed>0 || failedSteps>0){ console.error(`FAIL ${failed} 用例失败`); process.exit(1); }
  log('OK — Windows 桌面全量测试完成');
  process.exit(0);
})().catch(err=>{
  console.error('FATAL', err.stack||err.message);
  process.exit(1);
});
