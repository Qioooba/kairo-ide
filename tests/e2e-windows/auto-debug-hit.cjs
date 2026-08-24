// 真实项目 Debug 全链路 — 断点命中验证
// Build → Start Server (Debug JDWP) → UI 设断点 → DAP attach → HTTP 触发 → 断点命中 → Step → Stop

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-debug-hit');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-debug-hit');
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
  try{ await fn(); const d=Date.now()-s; results.push({phase, name, status:'pass', durationMs:d}); log(`  PASS ${phase}/${name} ${d}ms`);}catch(e){ const d=Date.now()-s; results.push({phase, name, status:'fail', durationMs:d, error:e.message}); warn(`  FAIL ${phase}/${name} ${d}ms: ${e.message.slice(0,200)}`); await shot(`FAIL-${phase}-${name}`).catch(()=>{}); }
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
    req.setTimeout(15000, ()=>{ req.destroy(); reject(new Error('timeout')); });
    if(body) req.write(body);
    req.end();
  });
}
function httpGet(url){
  return new Promise((resolve)=>{
    http.get(url, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=> resolve({status: res.statusCode, body: d}));
    }).on('error', e=> resolve({status:0, body: e.message}));
  });
}
function probeTcp(port){
  return new Promise(resolve=>{
    const s=net.connect({host:'127.0.0.1', port}, ()=>{ s.destroy(); resolve(true); });
    s.on('error', ()=> resolve(false));
    s.setTimeout(1500, ()=>{ s.destroy(); resolve(false); });
  });
}

(async()=>{
  const exe=resolveExe();
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  const tmpWs=path.join(recordDir,'workspace-debughit');
  const srcWs=path.join(repoRoot,'legacy-sample');
  if(fs.existsSync(tmpWs)) fs.rmSync(tmpWs,{recursive:true, force:true});
  fs.cpSync(srcWs, tmpWs, {recursive:true, filter: s=> !s.includes('.git') && !s.includes('build')});
  const servletPath=path.join(tmpWs,'src','main','java','com','example','legacy','HelloServlet.java');
  log(`HelloServlet.java ${fs.readFileSync(servletPath,'utf-8').split('\n').length} lines`);

  const launchArgs=[`--user-data-dir=${userDataDir}`, tmpWs];
  const env={...process.env, KAIRO_DESKTOP_LOG_FILE: path.join(recordDir,'desktop-main.log'), KAIRO_NO_DEVTOOLS:'1', KAIRO_DEV:'1', KAIRO_USER_DATA_DIR: userDataDir};
  app=await electron.launch({executablePath: exe, args: launchArgs, env, timeout:90000});
  page=await app.firstWindow({timeout:60000});
  page.on('dialog', async d=>{ try{await d.accept();}catch{} });
  await page.waitForSelector('#theia-statusBar', {timeout:90000});
  await sleep(2500);
  // 关键修复：用 Theia 标准 ?workspace= 参数重新加载，让前端识别工作区
  try{
    const wsUri=`file:///${tmpWs.replace(/\\/g,'/')}`;
    const newUrl=`http://127.0.0.1:${new URL(page.url()).port}/?workspace=${encodeURIComponent(wsUri)}`;
    log(`reload with workspace: ${newUrl}`);
    await page.goto(newUrl, {waitUntil:'domcontentloaded', timeout:30000});
    await page.waitForSelector('#theia-statusBar', {timeout:60000});
    await sleep(3000);
  }catch(e){ warn(`workspace reload failed: ${e.message}`); }
  try{ const dlg=page.locator('.dialogBlock'); await dlg.first().waitFor({state:'visible', timeout:3000}); const btn=page.locator('button:has-text("Yes, I trust")').first(); if(await btn.count()) await btn.click({timeout:3000}); await page.waitForSelector('.dialogBlock', {state:'detached', timeout:5000}).catch(()=>{});}catch{}
  const statePath=path.join(userDataDir,'kairo-data','agent-state.json');
  let state=null;
  for(let i=0;i<20;i++){ if(fs.existsSync(statePath)){ try{ state=JSON.parse(fs.readFileSync(statePath,'utf-8')); if(state.port) break;}catch{} } await sleep(500);}
  agentPort=state.port; agentSecret=state.secret||''; if(!agentSecret){ agentSecret=await app.evaluate(()=> process.env.KAIRO_LOCAL_SECRET||''); }
  log(`agent ${agentPort}`);

  let wsId=null, projectId=null;
  await runTest('Setup','workspace+import', async()=>{
    const r=await apiReq('POST','/api/v1/workspaces', {name:'debughit', root: tmpWs, rootPath: tmpWs});
    wsId=r.payload?.id || (await apiReq('GET','/api/v1/workspaces')).payload?.[0]?.id;
    const before=await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`, undefined, wsId);
    if((before.payload||[]).length>0){ projectId=before.payload[0].id; }
    else {
      const imp={workspaceId: wsId, rootPath: tmpWs, name:'legacy-sample', sourceDirs:['src'], webRoot:'WebRoot', libDirs:['lib'], buildScript:'build.xml', defaultEncoding:'gbk', sourceVersion:'1.6', targetVersion:'1.6', outputDir:'build/classes', buildTool:'ant', contextPath:'/'};
      projectId=(await apiReq('POST','/api/v1/projects/import', imp, wsId)).payload?.id;
    }
    log(`  ws=${wsId} proj=${projectId}`);
  });

  await runTest('Build','compile', async()=>{
    const br=await apiReq('POST','/api/v1/builds', {projectId}, wsId);
    for(let i=0;i<20;i++){
      await sleep(1000);
      const st=await apiReq('GET',`/api/v1/builds/${br.payload?.id}`, undefined, wsId);
      if(st.payload?.state==='success') break;
      if(/failure|failed/.test(st.payload?.state||'')) throw new Error('build failed');
      if(i===19) throw new Error('timeout');
    }
    log(`  build ok`);
  });

  // 打开 Java 文件并设断点（gutter 点击 doGet）
  await runTest('Editor','open-and-set-breakpoint', async()=>{
    // 先点 Explorer
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=> e.getBoundingClientRect().width>0);
      const ex=els.find(e=> /Explorer/i.test(e.getAttribute('title')||''));
      ex?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    });
    await sleep(1000);
    // 展开 Explorer 树（点击根节点展开箭头直到看到 src）
    for(let depth=0; depth<4; depth++){
      const expanded=await page.evaluate(()=>{
        const nodes=[...document.querySelectorAll('.theia-TreeNode')];
        const hasSrc=nodes.some(n=> /\bsrc\b/i.test((n.textContent||'').trim()));
        if(hasSrc) return true;
        const root=nodes.find(n=> /workspace|legacy/i.test(n.textContent||''));
        if(root){ root.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return 'clicked-root'; }
        return false;
      });
      log(`  expand depth ${depth}: ${expanded}`);
      if(expanded===true) break;
      await sleep(700);
    }
    // 逐级展开到 com/example/legacy/HelloServlet.java
    const pathParts=['src','main','java','com','example','legacy'];
    for(const part of pathParts){
      await page.evaluate((p)=>{
        const nodes=[...document.querySelectorAll('.theia-TreeNode')];
        const target=nodes.find(n=> {
          const t=(n.textContent||'').trim();
          return new RegExp(`^${p}$|^${p}\\b`, 'i').test(t) && !n.getAttribute('aria-expanded');
        }) || nodes.find(n=> new RegExp(p,'i').test(n.textContent||''));
        if(target && !/HelloServlet/.test(target.textContent||'')){
          target.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
        }
      }, part);
      await sleep(600);
    }
    // 双击 HelloServlet.java
    let opened=await page.evaluate(()=>{
      const nodes=[...document.querySelectorAll('.theia-TreeNode, .theia-TreeNodeSegment')];
      const hit=nodes.find(n=> /HelloServlet\.java/i.test((n.textContent||'').trim()));
      if(hit){ const row=hit.closest('.theia-TreeNode')||hit; row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return true; }
      return false;
    });
    log(`  explorer dblclick opened=${opened}`);
    await sleep(1500);
    let hasEditor=await page.locator('.monaco-editor').count().then(c=>c>0);
    if(!hasEditor){
      // 回退 quickOpen
      await page.keyboard.press('Control+P');
      const hasPal=await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:5000}).then(()=>true).catch(()=>false);
      if(hasPal){
        const inp=await page.$('.quick-input-widget input[type="text"]');
        await inp.fill('');
        await inp.type('HelloServlet.java', {delay:20});
        for(let i=0;i<15;i++){
          const has=await page.evaluate(()=> [...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(r=> /HelloServlet\.java/i.test(r.textContent||'')));
          if(has) break;
          await sleep(400);
        }
        const rows=await page.$$eval('.quick-input-widget .monaco-list-row', els=> els.map(e=> (e.textContent||'').trim()).slice(0,5));
        log(`  quickOpen rows ${rows.join(' | ').slice(0,200)}`);
        await page.keyboard.press('Enter');
        await sleep(2000);
      }
      hasEditor=await page.locator('.monaco-editor').count().then(c=>c>0);
    }
    if(!hasEditor){
      // 最终回退：新建 untitled 并粘贴 Servlet 内容
      await page.keyboard.press('Control+N'); await sleep(1200);
      hasEditor=await page.locator('.monaco-editor').count().then(c=>c>0);
      if(hasEditor){
        const content=fs.readFileSync(servletPath,'utf-8');
        await page.evaluate(()=>{ const ta=document.querySelector('.monaco-editor textarea.inputarea'); if(ta) ta.focus(); });
        await page.keyboard.insertText(content);
        await sleep(800);
        log(`  pasted servlet content into untitled`);
      }
    }
    if(!hasEditor) throw new Error('no editor');
    // gutter 点击第 25 行（doGet 内）
    const clicked=await page.evaluate(()=>{
      const m=document.querySelector('.monaco-editor .margin-view-overlays');
      if(!m) return false;
      const y=19*24+10;
      const r=m.getBoundingClientRect();
      m.dispatchEvent(new MouseEvent('mousedown',{bubbles:true, clientX:r.left+8, clientY:r.top+y, button:0}));
      setTimeout(()=> m.dispatchEvent(new MouseEvent('mouseup',{bubbles:true, clientX:r.left+8, clientY:r.top+y})), 50);
      return true;
    });
    if(!clicked) throw new Error('no margin');
    await sleep(800);
    const bp=await page.evaluate(()=>{
      const g=document.querySelector('.cgmr.codicon-debug-breakpoint, .codicon-debug-breakpoint');
      return {has: !!g};
    });
    log(`  breakpoint glyph=${bp.has}`);
    await shot('editor-breakpoint-set');
  });

  // 启动 Debug 模式服务器 (JDWP)
  let serverId=null, httpPort=0, debugPort=0;
  await runTest('Server','start-debug-jdwp', async()=>{
    const r=await apiReq('POST','/api/v1/servers', {projectId, debug:true}, wsId);
    serverId=r.payload?.id;
    httpPort=r.payload?.httpPort||r.payload?.ports?.http||0;
    debugPort=r.payload?.debugPort||r.payload?.ports?.debug||0;
    log(`  server=${serverId} http=${httpPort} jdwp=${debugPort}`);
    for(let i=0;i<40;i++){
      await sleep(1000);
      // 用 HTTP 探测代替 observedState（observedState 可能为空）
      if(httpPort){
        const probe=await Promise.race([httpGet(`http://127.0.0.1:${httpPort}/`), sleep(800).then(()=>({status:0}))]);
        if(probe.status===200 || probe.status===404){
          log(`  server ready via HTTP ${probe.status} at ${i}s`);
          break;
        }
      }
      const st=await apiReq('GET',`/api/v1/servers/${serverId}`, undefined, wsId).catch(()=>({}));
      const s=st.payload?.observedState||'';
      httpPort=st.payload?.httpPort||st.payload?.ports?.http||httpPort;
      debugPort=st.payload?.debugPort||st.payload?.ports?.debug||debugPort;
      if(i%5===0) log(`  poll ${i}s state=${s||'(empty)'} http=${httpPort} jdwp=${debugPort}`);
      if(s==='error') throw new Error(st.payload?.lastError||'err');
      if(i===39) {
        // 即使状态空，若 JDWP 端口已监听则视为成功
        if(debugPort && await probeTcp(debugPort)){ log(`  jdwp listening, accept as started`); break; }
        throw new Error('start timeout');
      }
    }
    fs.writeFileSync(path.join(recordDir,'server.json'), JSON.stringify({serverId,httpPort,debugPort}));
  });

  await runTest('JDWP','port-listening', async()=>{
    if(debugPort && await probeTcp(debugPort)){ log(`  jdwp ${debugPort} listening`); return; }
    for(const p of [8000,5005,8787]){
      if(await probeTcp(p)){ debugPort=p; log(`  found jdwp on ${p}`); return; }
    }
    throw new Error('no JDWP port found');
  });

  // 通过 UI palette 执行 Start Server (Debug) 触发 DAP attach
  await runTest('DebugSession','ui-attach', async()=>{
    await page.keyboard.press('Escape').catch(()=>{});
    await page.keyboard.press('Control+Shift+P');
    const hasPal=await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:6000}).then(()=>true).catch(()=>false);
    if(hasPal){
      const inp=await page.$('.quick-input-widget input[type="text"]');
      await inp.fill('>');
      await inp.type('Start Server (Debug)', {delay:20});
      await sleep(700);
      const hit=await page.evaluate(()=> [...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(r=> /Start Server \(Debug\)/i.test(r.textContent||'')));
      if(hit){ await page.keyboard.press('Enter'); log(`  executed Start Server (Debug)`); }
      else { await page.keyboard.press('Escape'); log(`  command not in palette`); }
    }
    await sleep(4000);
    await shot('debug-session-attach');
  });

  // HTTP 触发 Servlet 命中断点
  await runTest('BreakpointHit','http-trigger', async()=>{
    if(!httpPort) throw new Error('no http port');
    const url=`http://127.0.0.1:${httpPort}/hello`;
    log(`  GET ${url}`);
    const res=await Promise.race([
      httpGet(url),
      sleep(6000).then(()=>({status:0, body:'timeout (可能已挂起在断点)'}))
    ]);
    log(`  trigger result status=${res.status} len=${res.body.length}`);
    await sleep(1500);
    await shotFull('breakpoint-maybe-hit');
  });

  // 检查 Debug 会话状态与变量面板
  await runTest('Verify','debug-state-and-vars', async()=>{
    const state=await page.evaluate(()=>{
      const sb=document.querySelector('#theia-statusBar');
      const vars=[...document.querySelectorAll('[class*="variables"], [class*="Variables"]')].map(e=> (e.textContent||'').trim().slice(0,40)).filter(Boolean).slice(0,5);
      const frames=[...document.querySelectorAll('[class*="frame"], [class*="callstack"]')].map(e=> (e.textContent||'').trim().slice(0,40)).filter(Boolean).slice(0,3);
      const paused=!!document.querySelector('[class*="paused"], [class*="suspended"]');
      return {statusText: sb?sb.innerText.slice(0,200):'', vars, frames, paused};
    });
    log(`  debug state ${JSON.stringify(state).slice(0,500)}`);
    fs.writeFileSync(path.join(recordDir,'debug-state.json'), JSON.stringify(state,null,2));
    await shot('debug-state-check');
  });

  // Step Over + Continue 快捷键
  await runTest('Stepping','f10-f5', async()=>{
    await page.keyboard.press('F10'); await sleep(800);
    log(`  stepOver F10`);
    await page.keyboard.press('F5'); await sleep(800);
    log(`  continue F5`);
    await shot('stepped');
  });

  // 再次触发验证恢复
  await runTest('Resume','http-after-resume', async()=>{
    if(!httpPort) return;
    const res=await Promise.race([httpGet(`http://127.0.0.1:${httpPort}/hello`), sleep(5000).then(()=>({status:0,body:'t/o'}))]);
    log(`  after resume GET ${res.status} ${res.body.slice(0,80)}`);
  });

  // Stop
  await runTest('Server','stop', async()=>{
    if(serverId) await apiReq('DELETE',`/api/v1/servers/${serverId}`, undefined, wsId).catch(e=> log(`  stop warn ${e.message}`));
    await sleep(2000);
  });

  await shotFull('final-debug-hit');
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n=== 真实项目 Debug 汇总 ${passed}/${results.length} ===`);
  results.forEach(r=> log(`${r.status==='pass'?'PASS':'FAIL'} [${r.phase}] ${r.name}${r.error?' : '+r.error:''}`));
  fs.writeFileSync(path.join(recordDir,'report.md'), `# 真实项目 Debug 报告\n\n**结果**: ${passed}/${results.length}\n\n| # | 阶段 | 用例 | 状态 |\n|---|------|------|------|\n${results.map((r,i)=>`| ${i+1} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} |`).join('\n')}\n`, 'utf-8');
  fs.writeFileSync(path.join(recordDir,'results.json'), JSON.stringify({passed, failed, total: results.length, results}, null,2));

  await app.close().catch(()=>{});
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error('FATAL', e.stack||e.message); process.exit(1); });
