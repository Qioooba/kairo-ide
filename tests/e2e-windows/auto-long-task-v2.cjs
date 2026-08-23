// 超长任务 v2 — 10轮循环 + Server 3次启停 + 大量UI交互 + 编码/搜索/部署
// 预期 ~25-30min，持续截图与健康检查

const fs = require('fs');
const path = require('path');
const http = require('http');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-long-v2');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-long-v2');
fs.mkdirSync(outDir, {recursive:true});
fs.mkdirSync(recordDir, {recursive:true});

const stamp=()=> new Date().toISOString().slice(11,19);
const log=m=> console.log(`[${stamp()}] ${m}`);
const warn=m=> console.warn(`[${stamp()}] WARN ${m}`);
const sleep=ms=> new Promise(r=>setTimeout(r,ms));

let app, page, agentPort=0, agentSecret='', shotIdx=0, results=[], cycle=0;
const startedAt=Date.now();
async function shot(name){
  const f=path.join(outDir, `${String(shotIdx).padStart(4,'0')}-${name.replace(/[^a-z0-9\u4e00-\u9fa5-_]/g,'-').slice(0,60)}.png`);
  shotIdx++;
  try{ await page.screenshot({path:f, fullPage:false}); if(shotIdx%20===0) log(`shot ${shotIdx}`); return path.relative(recordDir,f);}catch(e){ return '';}
}
async function shotFull(name){
  const f=path.join(outDir, `${String(shotIdx).padStart(4,'0')}-${name}-full.png`);
  shotIdx++;
  try{ await page.screenshot({path:f, fullPage:true}); log(`shotFull ${path.relative(repoRoot,f)}`); return path.relative(recordDir,f);}catch(e){ return '';}
}
async function runTest(phase, name, fn){
  const s=Date.now();
  try{ await fn(); const d=Date.now()-s; results.push({cycle, phase, name, status:'pass', durationMs:d}); if(d>1500) log(`  PASS ${phase}/${name} ${d}ms`);}catch(e){ const d=Date.now()-s; results.push({cycle, phase, name, status:'fail', durationMs:d, error:e.message}); warn(`  FAIL ${phase}/${name} ${d}ms: ${e.message.slice(0,120)}`); await shot(`FAIL-${phase}-${name}`).catch(()=>{}); }
}
function resolveExe(){ let p=path.join(repoRoot,'apps','desktop','dist','win-unpacked','Kairo.exe'); if(fs.existsSync(p)) return p; throw new Error('no exe'); }
function apiReq(method, pathname, payload, wsId){
  return new Promise((resolve, reject)=>{
    const envelope={requestId: 'req_'+Math.random().toString(36).slice(2,9), workspaceId: wsId||undefined, payload};
    if(!envelope.workspaceId) delete envelope.workspaceId;
    if(payload===undefined) delete envelope.payload;
    const body=payload!==undefined? JSON.stringify(envelope): undefined;
    const headers={'Content-Type':'application/json', 'X-Kairo-Secret': agentSecret};
    if(wsId) headers['X-Kairo-Workspace-Id']=wsId;
    headers['X-Kairo-Request-Id']=envelope.requestId;
    const opts={hostname:'127.0.0.1', port: agentPort, path: pathname, method, headers};
    const req=http.request(opts, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try{ const j=JSON.parse(d); if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${JSON.stringify(j).slice(0,500)}`)); else resolve(j);}catch{ if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${d.slice(0,500)}`)); else resolve({raw:d}); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, ()=>{ req.destroy(); reject(new Error('timeout')); });
    if(body) req.write(body);
    req.end();
  });
}
function elapsed(){ return ((Date.now()-startedAt)/1000/60).toFixed(1)+'min'; }

(async()=>{
  const exe=resolveExe();
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  const tmpWs=path.join(recordDir,'workspace-long-v2');
  const srcWs=path.join(repoRoot,'legacy-sample');
  if(fs.existsSync(tmpWs)) fs.rmSync(tmpWs,{recursive:true, force:true});
  fs.cpSync(srcWs, tmpWs, {recursive:true, filter: s=> !s.includes('.git') && !s.includes('build')});
  log(`workspace ${tmpWs}`);

  const launchArgs=[`--user-data-dir=${userDataDir}`, tmpWs];
  const env={...process.env, KAIRO_DESKTOP_LOG_FILE: path.join(recordDir,'desktop-main.log'), KAIRO_NO_DEVTOOLS:'1', KAIRO_DEV:'1', KAIRO_USER_DATA_DIR: userDataDir};
  app=await electron.launch({executablePath: exe, args: launchArgs, env, timeout:90000});
  log(`pid=${app.process().pid} ${elapsed()}`);
  page=await app.firstWindow({timeout:60000});
  log(`window ${await page.title()} ${page.url()} ${elapsed()}`);
  page.on('console', m=>{ if(m.type()==='error') log(`[console:error] ${m.text().slice(0,150)}`); });
  page.on('pageerror', e=> log(`[pageerror] ${e.message.slice(0,150)}`));
  page.on('dialog', async d=>{ try{await d.accept();}catch{} });

  await page.waitForSelector('#theia-statusBar', {timeout:90000});
  await page.waitForSelector('#theia-ApplicationShell', {timeout:30000}).catch(()=>{});
  await sleep(2500);
  try{ const dlg=page.locator('.dialogBlock'); await dlg.first().waitFor({state:'visible', timeout:3000}); const btn=page.locator('button:has-text("Yes, I trust")').first(); if(await btn.count()) await btn.click({timeout:3000}); await page.waitForSelector('.dialogBlock', {state:'detached', timeout:5000}).catch(()=>{});}catch{}
  await shotFull('00-boot');
  const statePath=path.join(userDataDir,'kairo-data','agent-state.json');
  let state=null;
  for(let i=0;i<20;i++){ if(fs.existsSync(statePath)){ try{ state=JSON.parse(fs.readFileSync(statePath,'utf-8')); if(state.port) break;}catch{} } await sleep(500);}
  agentPort=state.port; agentSecret=state.secret||''; if(!agentSecret){ agentSecret=await app.evaluate(()=> process.env.KAIRO_LOCAL_SECRET||''); }
  log(`agent ${agentPort} ${elapsed()}`);

  let wsId=null, projectId=null;
  await runTest('Setup','workspace', async()=>{
    const r=await apiReq('POST','/api/v1/workspaces', {name:'long-v2', root: tmpWs, rootPath: tmpWs});
    wsId=r.payload?.id; log(`  wsId=${wsId}`);
  });
  if(!wsId){ const r=await apiReq('GET','/api/v1/workspaces'); wsId=(r.payload||[])[0]?.id; }
  await runTest('Setup','detect', async()=>{ const r=await apiReq('POST','/api/v1/projects/detect', {rootPath: tmpWs}, wsId); log(`  detect ${r.payload?.buildSystem}`); });
  await runTest('Setup','import', async()=>{
    const before=await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`, undefined, wsId);
    if((before.payload||[]).length>0){ projectId=before.payload[0].id; log(`  already ${projectId}`); return; }
    const imp={workspaceId: wsId, rootPath: tmpWs, name:'legacy-sample', sourceDirs:['src'], webRoot:'WebRoot', libDirs:['lib'], buildScript:'build.xml', defaultEncoding:'gbk', sourceVersion:'1.6', targetVersion:'1.6', outputDir:'build/classes', buildTool:'ant', contextPath:'/'};
    const r=await apiReq('POST','/api/v1/projects/import', imp, wsId);
    projectId=r.payload?.id; log(`  imported ${projectId}`);
  });
  if(!projectId){ const r=await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`, undefined, wsId); projectId=(r.payload||[])[0]?.id; }
  log(`projectId=${projectId} ${elapsed()}`);

  const TOTAL_CYCLES=10;
  for(cycle=1; cycle<=TOTAL_CYCLES; cycle++){
    log(`\n========== CYCLE ${cycle}/${TOTAL_CYCLES} ${elapsed()} ==========`);
    // UI
    await runTest(`C${cycle}-UI`,'activityBar', async()=>{
      const tabs=await page.evaluate(()=> [...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=> e.getBoundingClientRect().width>0 && !e.id.includes('hidden')).map(e=> e.getAttribute('title')||''));
      for(let i=0;i<tabs.length;i++){
        await page.evaluate((idx)=>{
          const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=> e.getBoundingClientRect().width>0 && !e.id.includes('hidden'));
          els[idx]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        }, i);
        await sleep(400);
      }
    });
    await runTest(`C${cycle}-UI`,'buttons-sample', async()=>{
      const btns=await page.evaluate(()=> [...document.querySelectorAll('button, .theia-button, [title]')].filter(e=> e.getBoundingClientRect().width>10 && e.offsetParent!==null).slice(0,15));
      for(let i=0;i<Math.min(btns.length,8);i++){
        await page.evaluate((idx)=>{
          const els=[...document.querySelectorAll('button, .theia-button, [title]')].filter(e=> e.getBoundingClientRect().width>10 && e.offsetParent!==null);
          els[idx]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        }, i);
        await sleep(300);
        await page.keyboard.press('Escape').catch(()=>{});
        await sleep(150);
      }
    });
    // Build
    const modFile=path.join(tmpWs,'src','main','java','com','example','legacy','HelloServlet.java');
    await runTest(`C${cycle}-Build`,'modify-build', async()=>{
      let c=fs.readFileSync(modFile,'utf-8');
      c+=`// v2 cycle ${cycle} ${Date.now()}\n`;
      fs.writeFileSync(modFile,c,'utf-8');
      const br=await apiReq('POST','/api/v1/builds', {projectId}, wsId);
      const bid=br.payload?.id;
      log(`  build ${bid}`);
      for(let i=0;i<25;i++){
        await sleep(1000);
        const st=await apiReq('GET',`/api/v1/builds/${bid}`, undefined, wsId);
        const s=st.payload?.state||'';
        if(s==='success' || s==='failure') { if(s!=='success') throw new Error(`build ${s}`); break; }
        if(i===24) throw new Error('timeout');
      }
      const out=path.join(tmpWs,'build','classes','com','example','legacy','HelloServlet.class');
      if(!fs.existsSync(out)) throw new Error('no class');
    });
    // 编码/搜索 抽样
    await runTest(`C${cycle}-Misc`,'encoding-search', async()=>{
      // 搜索
      await page.keyboard.press('Control+Shift+F');
      await sleep(800);
      const hasSearch=await page.locator('input[placeholder*="Search"], .search-widget input').count().then(c=>c>0);
      if(hasSearch){
        const inp=page.locator('input[placeholder*="Search"], .search-widget input').first();
        await inp.click({timeout:2000}).catch(()=>{});
        await page.keyboard.type('HelloServlet', {delay:20});
        await sleep(800);
        await page.keyboard.press('Escape');
        await sleep(300);
      } else {
        await page.keyboard.press('Escape');
      }
      await page.keyboard.press('Control+F10');
      await sleep(1000);
    });
    // 压力
    await runTest(`C${cycle}-Stress`,'resize-switch', async()=>{
      await page.keyboard.press('Control+Shift+P');
      await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:5000}).catch(()=>{});
      const inp=await page.$('.quick-input-widget input[type="text"]');
      if(inp){ await inp.fill('>'); await inp.type('Focus', {delay:10}); await sleep(300); await page.keyboard.press('Escape'); }
      await sleep(200);
      const win=await app.evaluate(({BrowserWindow})=> BrowserWindow.getAllWindows()[0]?.getBounds());
      if(win){
        await app.evaluate(({BrowserWindow}, b)=>{ const w=BrowserWindow.getAllWindows()[0]; if(w) w.setBounds({x:b.x, y:b.y, width: b.width===1280? 1100:1280, height: b.height===800? 750:800}); }, win);
        await sleep(600);
        await app.evaluate(({BrowserWindow}, b)=>{ const w=BrowserWindow.getAllWindows()[0]; if(w) w.setBounds(b); }, win);
        await sleep(400);
      }
    });
    await runTest(`C${cycle}-Health`,'health', async()=>{
      const h=await apiReq('GET','/api/v1/health');
      if(!h.payload?.ok) throw new Error('health');
      const ok=await page.locator('#theia-app-shell').first().isVisible().catch(()=>false);
      if(!ok) throw new Error('shell');
      log(`  health uptime ${h.payload.uptimeSec}s`);
    });
    await shot(`cycle-${cycle}-end`);
    log(`cycle ${cycle} done ${elapsed()}`);
    await sleep(1000);
  }

  // Server 长驻 3次启停
  log(`\n========== SERVER 3x ${elapsed()} ==========`);
  for(let s=1;s<=3;s++){
    await runTest(`Server${s}`,'start', async()=>{
      const r=await apiReq('POST','/api/v1/servers', {projectId}, wsId);
      const sid=r.payload?.id;
      if(!sid) throw new Error('no sid');
      fs.writeFileSync(path.join(recordDir,`server${s}.txt`), sid);
      log(`  server ${sid}`);
      for(let i=0;i<30;i++){
        await sleep(1000);
        const st=await apiReq('GET',`/api/v1/servers/${sid}`, undefined, wsId);
        const stt=st.payload?.observedState||'';
        log(`  ${s} ${stt} ${i}s`);
        if(stt==='running') break;
        if(stt==='error') throw new Error(st.payload?.lastError||'error');
      }
      // 热更 2次
      for(let h=1;h<=2;h++){
        const f=path.join(tmpWs,'WebRoot','hello.jsp');
        if(fs.existsSync(f)){ let c=fs.readFileSync(f,'utf-8'); c+=`\n<%-- v2 s${s} h${h} ${Date.now()} --%>\n`; fs.writeFileSync(f,c,'utf-8'); }
        await page.keyboard.press('Control+F10');
        await sleep(1500);
        log(`  hot ${h}`);
      }
    });
    await shotFull(`server-${s}-hot`);
    await runTest(`Server${s}`,'stop', async()=>{
      const sid=fs.readFileSync(path.join(recordDir,`server${s}.txt`),'utf-8').trim();
      await apiReq('DELETE',`/api/v1/servers/${sid}`, undefined, wsId).catch(e=> log(`  stop warn ${e.message}`));
      await sleep(2000);
    });
    await sleep(1000);
  }

  await shotFull('final-v2');
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n========== V2 DONE ${elapsed()} ==========`);
  log(`总 ${results.length} 通过 ${passed} 失败 ${failed}`);
  results.filter(r=>r.status==='fail').forEach(r=> log(` FAIL [${r.phase}] ${r.name}: ${r.error}`));
  const md=`# 超长任务 v2 报告

**时长**: ${elapsed()} ${new Date().toISOString()}
**结果**: ${passed}/${results.length}

| # | 周期 | 阶段 | 用例 | 状态 |
|---|------|------|------|------|
${results.map((r,i)=>`| ${i+1} | ${r.cycle} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} |`).join('\n')}
`;
  fs.writeFileSync(path.join(recordDir,'report.md'), md, 'utf-8');
  fs.writeFileSync(path.join(recordDir,'results.json'), JSON.stringify({elapsed: elapsed(), passed, failed, total: results.length, results}, null,2));
  log(`报告 ${path.join(recordDir,'report.md')}`);
  await app.close().catch(()=>{});
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error('FATAL', e.stack||e.message); process.exit(1); });
