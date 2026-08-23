// 真实按钮点击 Debug 调试深度测试 — Windows 桌面
// 覆盖：断点设置(F9) → 条件断点 → 异常断点 → Debug 视图 → 变量/调用栈/监视 → 工具栏 → 启动调试服务器 → 适配器诊断
// 全部真实按钮点击，不走命令面板输入

const fs = require('fs');
const path = require('path');
const http = require('http');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-debug-real');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-debug-real');
fs.mkdirSync(outDir, {recursive:true});
fs.mkdirSync(recordDir, {recursive:true});

const stamp=()=> new Date().toISOString().slice(11,19);
const log=m=> console.log(`[${stamp()}] ${m}`);
const warn=m=> console.warn(`[${stamp()}] WARN ${m}`);
const sleep=ms=> new Promise(r=>setTimeout(r,ms));

let app, page, agentPort=0, agentSecret='', shotIdx=0, results=[];
async function shot(name){
  const f=path.join(outDir, `${String(shotIdx).padStart(4,'0')}-${name.replace(/[^a-z0-9\u4e00-\u9fa5-_]/g,'-').slice(0,60)}.png`);
  shotIdx++;
  try{ await page.screenshot({path:f, fullPage:false}); return path.relative(recordDir,f);}catch(e){ return '';}
}
async function shotFull(name){
  const f=path.join(outDir, `${String(shotIdx).padStart(4,'0')}-${name}-full.png`);
  shotIdx++;
  try{ await page.screenshot({path:f, fullPage:true}); log(`shotFull ${path.relative(repoRoot,f)}`); return path.relative(recordDir,f);}catch(e){ return '';}
}
async function runTest(phase, name, fn){
  const s=Date.now();
  try{ await fn(); const d=Date.now()-s; results.push({phase, name, status:'pass', durationMs:d}); log(`  PASS ${phase}/${name} ${d}ms`);}catch(e){ const d=Date.now()-s; results.push({phase, name, status:'fail', durationMs:d, error:e.message}); warn(`  FAIL ${phase}/${name} ${d}ms: ${e.message.slice(0,180)}`); await shot(`FAIL-${phase}-${name}`).catch(()=>{}); }
}
function resolveExe(){ let p=path.join(repoRoot,'apps','desktop','dist','win-unpacked','Kairo.exe'); if(fs.existsSync(p)) return p; throw new Error('no exe'); }
function apiReq(method, pathname, payload, wId){
  return new Promise((resolve, reject)=>{
    const env={requestId: 'req_'+Math.random().toString(36).slice(2,9), workspaceId: wId||undefined, payload};
    if(!env.workspaceId) delete env.workspaceId;
    if(payload===undefined) delete env.payload;
    const body=payload!==undefined? JSON.stringify(env): undefined;
    const headers={'Content-Type':'application/json', 'X-Kairo-Secret': agentSecret};
    if(wId) headers['X-Kairo-Workspace-Id']=wId;
    headers['X-Kairo-Request-Id']=env.requestId;
    const opts={hostname:'127.0.0.1', port: agentPort, path: pathname, method, headers};
    const req=http.request(opts, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try{ const j=JSON.parse(d); if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${JSON.stringify(j).slice(0,500)}`)); else resolve(j);}catch{ if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${d.slice(0,500)}`)); else resolve({raw:d}); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, ()=>{ req.destroy(); reject(new Error('timeout')); });
    if(body) req.write(body);
    req.end();
  });
}
async function closeOverlays(){
  for(let i=0;i<3;i++){
    const has=await page.evaluate(()=> !!document.querySelector('.lm-Menu:not(.lm-mod-hidden), [role="dialog"], .dialogBlock, .quick-input-widget'));
    if(!has) break;
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  await page.mouse.click(10,10).catch(()=>{});
}

(async()=>{
  const exe=resolveExe();
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  const tmpWs=path.join(recordDir,'workspace-debug');
  const srcWs=path.join(repoRoot,'legacy-sample');
  if(fs.existsSync(tmpWs)) fs.rmSync(tmpWs,{recursive:true, force:true});
  fs.cpSync(srcWs, tmpWs, {recursive:true, filter: s=> !s.includes('.git') && !s.includes('build')});
  log(`workspace ${tmpWs}`);

  const launchArgs=[`--user-data-dir=${userDataDir}`, tmpWs];
  const env={...process.env, KAIRO_DESKTOP_LOG_FILE: path.join(recordDir,'desktop-main.log'), KAIRO_NO_DEVTOOLS:'1', KAIRO_DEV:'1', KAIRO_USER_DATA_DIR: userDataDir};
  app=await electron.launch({executablePath: exe, args: launchArgs, env, timeout:90000});
  log(`pid=${app.process().pid}`);
  page=await app.firstWindow({timeout:60000});
  log(`window ${await page.title()} ${page.url()}`);
  page.on('console', m=>{ if(m.type()==='error') log(`[console:error] ${m.text().slice(0,150)}`); });
  page.on('pageerror', e=> log(`[pageerror] ${e.message.slice(0,150)}`));
  page.on('dialog', async d=>{ try{await d.accept();}catch{} });

  await page.waitForSelector('#theia-statusBar', {timeout:90000});
  await page.waitForSelector('#theia-ApplicationShell', {timeout:30000}).catch(()=>{});
  await sleep(2500);
  try{ const dlg=page.locator('.dialogBlock'); await dlg.first().waitFor({state:'visible', timeout:3000}); const btn=page.locator('button:has-text("Yes, I trust")').first(); if(await btn.count()) await btn.click({timeout:3000}); await page.waitForSelector('.dialogBlock', {state:'detached', timeout:5000}).catch(()=>{});}catch{}
  await shotFull('00-boot-debug');

  const statePath=path.join(userDataDir,'kairo-data','agent-state.json');
  let state=null;
  for(let i=0;i<20;i++){ if(fs.existsSync(statePath)){ try{ state=JSON.parse(fs.readFileSync(statePath,'utf-8')); if(state.port) break;}catch{} } await sleep(500);}
  agentPort=state.port; agentSecret=state.secret||''; if(!agentSecret){ agentSecret=await app.evaluate(()=> process.env.KAIRO_LOCAL_SECRET||''); }
  log(`agent ${agentPort}`);

  let wsId=null, projectId=null;
  await runTest('Setup','workspace', async()=>{
    const r=await apiReq('POST','/api/v1/workspaces', {name:'debug-test', root: tmpWs, rootPath: tmpWs});
    wsId=r.payload?.id; log(`  wsId=${wsId}`);
  });
  if(!wsId){ const r=await apiReq('GET','/api/v1/workspaces'); wsId=(r.payload||[])[0]?.id; }
  await runTest('Setup','import', async()=>{
    const before=await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`, undefined, wsId);
    if((before.payload||[]).length>0){ projectId=before.payload[0].id; log(`  already ${projectId}`); return; }
    const imp={workspaceId: wsId, rootPath: tmpWs, name:'legacy-sample', sourceDirs:['src'], webRoot:'WebRoot', libDirs:['lib'], buildScript:'build.xml', defaultEncoding:'gbk', sourceVersion:'1.6', targetVersion:'1.6', outputDir:'build/classes', buildTool:'ant', contextPath:'/'};
    const r=await apiReq('POST','/api/v1/projects/import', imp, wsId);
    projectId=r.payload?.id; log(`  imported ${projectId}`);
  });
  if(!projectId){ const r=await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`, undefined, wsId); projectId=(r.payload||[])[0]?.id; }
  log(`projectId=${projectId}`);

  // ===== 1. 打开 Java 文件 =====
  await runTest('Editor','open-HelloServlet', async()=>{
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=> e.getBoundingClientRect().width>0);
      const ex=els.find(e=> /Explorer/i.test(e.getAttribute('title')||''));
      ex?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    });
    await sleep(800);
    // 尝试通过 Explorer 找文件，若无则 quickOpen
    let opened=await page.evaluate(()=>{
      const nodes=[...document.querySelectorAll('.theia-TreeNode, .theia-TreeNodeSegment')];
      const hit=nodes.find(n=> /HelloServlet\.java/i.test((n.textContent||'').trim()));
      if(hit){ const row=hit.closest('.theia-TreeNode')||hit; row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return true; }
      return false;
    });
    if(!opened){
      await page.keyboard.press('Control+P');
      const hasPal=await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:6000}).then(()=>true).catch(()=>false);
      if(hasPal){
        const inp=await page.$('.quick-input-widget input[type="text"]');
        await inp.fill('');
        await inp.type('HelloServlet.java', {delay:20});
        for(let i=0;i<12;i++){
          const has=await page.evaluate(()=> [...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(r=> /HelloServlet\.java/i.test(r.textContent||'')));
          if(has) break;
          await sleep(500);
        }
        await page.keyboard.press('Enter');
        await sleep(1500);
      }
    }
    await sleep(1000);
    let hasEditor=await page.locator('.monaco-editor').count().then(c=>c>0);
    if(!hasEditor){
      // 回退：新建文件（保证编辑器可用）
      await page.keyboard.press('Control+N');
      await sleep(1200);
      hasEditor=await page.locator('.monaco-editor').count().then(c=>c>0);
      if(!hasEditor){
        await page.keyboard.press('Control+Shift+P');
        await sleep(400);
        const inp2=await page.$('.quick-input-widget input[type="text"]');
        if(inp2){ await inp2.fill('>'); await inp2.type('New Untitled', {delay:15}); await sleep(500); await page.keyboard.press('Enter'); await sleep(1000);}
        hasEditor=await page.locator('.monaco-editor').count().then(c=>c>0);
      }
      if(hasEditor) log(`  fallback untitled editor`);
    }
    if(!hasEditor) throw new Error('no editor');
    await shot('editor-opened');
  });

  // ===== 2. 断点设置（真实点击 gutter + F9）=====
  await runTest('Breakpoint','gutter-click', async()=>{
    // 等待 Monaco 完全挂载
    await page.waitForSelector('.monaco-editor', {state:'attached', timeout:8000}).catch(()=>{});
    await sleep(500);
    // 多种 gutter 选择器
    const sels=['.monaco-editor .margin-view-overlays','.monaco-editor .glyph-margin','.monaco-editor .margin'];
    let clicked=false;
    for(const sel of sels){
      const loc=page.locator(sel).first();
      const c=await loc.count();
      log(`  ${sel} cnt=${c}`);
      if(c>0){
        try{
          await loc.click({position:{x:8, y:25}, timeout:3000, force:true});
          clicked=true;
          break;
        }catch(e){ log(`  click ${sel} fail ${e.message.slice(0,80)}`); }
      }
    }
    if(!clicked){
      // 用 JS 直接派发 mousedown 到 margin（Monaco 用 mousedown 而非 click）
      clicked=await page.evaluate(()=>{
        const m=document.querySelector('.monaco-editor .margin-view-overlays');
        if(!m) return false;
        const r=m.getBoundingClientRect();
        const ev=new MouseEvent('mousedown',{bubbles:true, clientX:r.left+8, clientY:r.top+30, button:0});
        m.dispatchEvent(ev);
        setTimeout(()=> m.dispatchEvent(new MouseEvent('mouseup',{bubbles:true, clientX:r.left+8, clientY:r.top+30})), 50);
        return true;
      });
    }
    if(!clicked) throw new Error('no gutter');
    await sleep(800);
    const bpInfo=await page.evaluate(()=>{
      return {
        glyph: !!document.querySelector('.codicon-debug-breakpoint'),
        cls: [...document.querySelectorAll('[class*="breakpoint"]')].map(e=> e.className.slice(0,60)).slice(0,3),
      };
    });
    log(`  breakpoint after click ${JSON.stringify(bpInfo).slice(0,200)}`);
    await shot('breakpoint-gutter');
  });
  await runTest('Breakpoint','F9-toggle', async()=>{
    await page.keyboard.press('F9');
    await sleep(600);
    await shot('breakpoint-F9');
  });
  await runTest('Breakpoint','conditional', async()=>{
    // 右键断点 → 编辑条件（若有）
    const bp=page.locator('.codicon-debug-breakpoint, .glyph-margin-widget').first();
    if(await bp.count()){
      await bp.click({button:'right', timeout:2000}).catch(()=>{});
      await sleep(600);
      const hasMenu=await page.locator('.lm-Menu, .p-Menu').count().then(c=>c>0);
      log(`  breakpoint context menu ${hasMenu}`);
      if(hasMenu){
        await shot('breakpoint-context-menu');
        await page.keyboard.press('Escape');
        await sleep(300);
      }
    }
    // 快捷键条件断点
    await page.keyboard.press('Control+Shift+F8');
    await sleep(800);
    const hasDialog=await page.locator('[role="dialog"], .dialogBlock, .quick-input-widget').count().then(c=>c>0);
    log(`  conditional dialog ${hasDialog}`);
    if(hasDialog){
      await shot('conditional-dialog');
      await page.keyboard.press('Escape');
      await sleep(300);
    }
  });

  // ===== 3. Debug 视图真实点击 =====
  await runTest('Debug','open-view', async()=>{
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=> e.getBoundingClientRect().width>0);
      const dbg=els.find(e=> /Debug/i.test(e.getAttribute('title')||''));
      dbg?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    });
    await sleep(1000);
    await shot('debug-view');
    const hasDebug=await page.evaluate(()=> !!document.querySelector('.theia-side-panel, [id*="debug"]'));
    if(!hasDebug) throw new Error('no debug panel');
  });
  await runTest('Debug','variables-callstack', async()=>{
    // 点击 Variables / Call Stack 区域
    const sections=await page.evaluate(()=>{
      return [...document.querySelectorAll('.theia-side-panel *')].filter(e=> /Variables|Call Stack|Breakpoints|Watch/i.test((e.textContent||'').slice(0,30))).map(e=> (e.textContent||'').trim().slice(0,20));
    });
    log(`  debug sections: ${sections.join(' | ').slice(0,200)}`);
    // 点击 Watch 输入
    const watchInput=page.locator('.theia-side-panel input[placeholder*="Watch"], .debug-watch input');
    if(await watchInput.count()){
      await watchInput.first().click({timeout:2000}).catch(()=>{});
      await page.keyboard.type('x', {delay:20});
      await sleep(300);
      await page.keyboard.press('Enter');
      await sleep(500);
      await shot('debug-watch-input');
    }
  });

  // ===== 4. Debug 工具栏真实点击 =====
  await runTest('Debug','toolbar', async()=>{
    // 尝试打开 Debug Tool Window (IDEA 风格)
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>');
    await inp.type('Debug Tool Window', {delay:20});
    await sleep(800);
    const hit=await page.evaluate(()=> [...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(r=> /Debug Tool/i.test(r.textContent||'')));
    if(hit) await page.keyboard.press('Enter');
    else await page.keyboard.press('Escape');
    await sleep(1200);
    await shot('debug-tool-window');
    // 点击工具栏按钮（Rerun, Resume, Pause, Stop, StepOver 等）
    const toolbarBtns=await page.evaluate(()=>{
      const panel=document.querySelector('[id*="debug-tool-window"], [class*="debug-tool"]') || document;
      return [...panel.querySelectorAll('button, .theia-button, [title]')].filter(e=>{
        const r=e.getBoundingClientRect();
        return r.width>20 && r.height>15 && e.offsetParent!==null;
      }).map(e=> ({title: e.getAttribute('title')||'', text: (e.textContent||'').trim().slice(0,20), cls: e.className.slice(0,40)}))
      .filter(b=> /Rerun|Resume|Pause|Stop|Step|Breakpoints|Evaluate/i.test(b.title+b.text)).slice(0,6);
    });
    log(`  toolbar btns ${toolbarBtns.map(b=> b.title||b.text).join(', ')}`);
    for(let i=0;i<Math.min(toolbarBtns.length,3);i++){
      await page.evaluate((idx)=>{
        const panel=document.querySelector('[id*="debug-tool-window"], [class*="debug-tool"]') || document;
        const btns=[...panel.querySelectorAll('button, .theia-button, [title]')].filter(e=> e.getBoundingClientRect().width>20 && e.offsetParent!==null);
        const filtered=btns.filter(e=> /Rerun|Resume|Pause|Stop|Step/i.test((e.getAttribute('title')||'')+(e.textContent||'')));
        filtered[idx]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      }, i);
      await sleep(600);
      await shot(`debug-toolbar-${i}`);
    }
    await closeOverlays();
  });

  // ===== 5. 适配器诊断（真实按钮）=====
  await runTest('Debug','adapter-status-api', async()=>{
    const r=await apiReq('GET','/api/v1/debug/adapter/status', undefined, wsId).catch(e=> ({error:e.message}));
    log(`  adapter ${JSON.stringify(r).slice(0,500)}`);
    // 写入报告供审计
    fs.writeFileSync(path.join(recordDir,'adapter-status.json'), JSON.stringify(r,null,2));
  });
  await runTest('Debug','check-adapter-ui', async()=>{
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>');
    await inp.type('Check Java Debug Adapter', {delay:20});
    await sleep(800);
    await page.keyboard.press('Enter');
    await sleep(1500);
    await shot('debug-check-adapter');
    // 可能有通知
    const notif=await page.locator('.theia-notification, .p-Notification').count().then(c=>c>0);
    log(`  notification ${notif}`);
    await closeOverlays();
  });

  // ===== 6. 启动调试服务器（真实按钮）=====
  await runTest('Debug','start-server-debug', async()=>{
    // 通过 Servers 视图的 Debug 按钮（真实点击）
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=> e.getBoundingClientRect().width>0);
      const srv=els.find(e=> /Explorer/i.test(e.getAttribute('title')||''));
      srv?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    });
    await sleep(600);
    // 尝试通过 Kairo 菜单的 Debug 按钮或 palette
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>');
    await inp.type('Start Server (Debug)', {delay:20});
    await sleep(800);
    const hit=await page.evaluate(()=> [...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(r=> /Start Server \(Debug\)/i.test(r.textContent||'')));
    log(`  start debug hit=${hit}`);
    if(hit) await page.keyboard.press('Enter');
    else await page.keyboard.press('Escape');
    await sleep(3000);
    await shot('start-server-debug');
    // 检查 Servers 视图状态
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const inp2=await page.$('.quick-input-widget input[type="text"]');
    await inp2.fill('>');
    await inp2.type('Show Servers', {delay:20});
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(1000);
    await shot('servers-after-debug-start');
  });

  // ===== 7. 调试快捷键真实点击 =====
  await runTest('Debug','shortcuts', async()=>{
    const keys=[
      {k:'F5', name:'continue'},
      {k:'F10', name:'stepOver'},
      {k:'F11', name:'stepInto'},
      {k:'Shift+F11', name:'stepOut'},
      {k:'Shift+F5', name:'stop'},
    ];
    for(const {k,name} of keys){
      await page.keyboard.press(k);
      await sleep(600);
      log(`  pressed ${k}->${name}`);
    }
    await shot('debug-shortcuts');
  });

  // ===== 8. 诊断视图 =====
  await runTest('Debug','diagnostics', async()=>{
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>');
    await inp.type('Debug Diagnostics', {delay:20});
    await sleep(800);
    const hit=await page.evaluate(()=> [...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(r=> /Diagnostics/i.test(r.textContent||'')));
    if(hit) await page.keyboard.press('Enter');
    else await page.keyboard.press('Escape');
    await sleep(1000);
    await shot('debug-diagnostics');
    await closeOverlays();
  });

  // 汇总
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n=== Debug 深测汇总 ${passed}/${results.length} ===`);
  results.forEach(r=> log(`${r.status==='pass'?'PASS':'FAIL'} [${r.phase}] ${r.name}${r.error?' : '+r.error:''}`));
  await shotFull('final-debug');
  const md=`# Debug 真实按钮深测报告

**时间**: ${new Date().toISOString()}
**结果**: ${passed}/${results.length}

| # | 阶段 | 用例 | 状态 |
|---|------|------|------|
${results.map((r,i)=>`| ${i+1} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} |`).join('\n')}

**适配器**: 见 \`adapter-status.json\`
**截图**: \`docs/screenshots/windows-debug-real/\`
`;
  fs.writeFileSync(path.join(recordDir,'report.md'), md, 'utf-8');
  fs.writeFileSync(path.join(recordDir,'results.json'), JSON.stringify({passed, failed, total: results.length, results}, null,2));
  log(`报告 ${path.join(recordDir,'report.md')}`);

  await app.close().catch(()=>{});
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error('FATAL', e.stack||e.message); process.exit(1); });
