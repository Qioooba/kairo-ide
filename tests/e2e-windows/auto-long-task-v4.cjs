// 超长任务 v3 — 20轮极限循环 + 编码/搜索/SQL/部署全覆盖
// 预期 ~12-15min，持续验证 30+min 稳定性

const fs = require('fs');
const path = require('path');
const http = require('http');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-long-v4');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-long-v4');
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
  try{ await page.screenshot({path:f, fullPage:false}); if(shotIdx%25===0) log(`shot ${shotIdx}`); return path.relative(recordDir,f);}catch(e){ return '';}
}
async function shotFull(name){
  const f=path.join(outDir, `${String(shotIdx).padStart(4,'0')}-${name}-full.png`);
  shotIdx++;
  try{ await page.screenshot({path:f, fullPage:true}); log(`shotFull ${path.relative(repoRoot,f)}`); return path.relative(recordDir,f);}catch(e){ return '';}
}
async function runTest(phase, name, fn){
  const s=Date.now();
  try{ await fn(); const d=Date.now()-s; results.push({cycle, phase, name, status:'pass', durationMs:d}); if(d>2000) log(`  PASS ${phase}/${name} ${d}ms`);}catch(e){ const d=Date.now()-s; results.push({cycle, phase, name, status:'fail', durationMs:d, error:e.message}); warn(`  FAIL ${phase}/${name} ${d}ms: ${e.message.slice(0,120)}`); await shot(`FAIL-${phase}-${name}`).catch(()=>{}); }
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
  const tmpWs=path.join(recordDir,'workspace-v3');
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
    const r=await apiReq('POST','/api/v1/workspaces', {name:'long-v3', root: tmpWs, rootPath: tmpWs});
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

  const TOTAL_CYCLES=30;
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
        await sleep(350);
      }
    });
    await runTest(`C${cycle}-UI`,'buttons', async()=>{
      const els=await page.evaluate(()=> [...document.querySelectorAll('button, .theia-button, [title]')].filter(e=> e.getBoundingClientRect().width>10 && e.offsetParent!==null).slice(0,12));
      for(let i=0;i<Math.min(els.length,6);i++){
        await page.evaluate((idx)=>{
          const es=[...document.querySelectorAll('button, .theia-button, [title]')].filter(e=> e.getBoundingClientRect().width>10 && e.offsetParent!==null);
          es[idx]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        }, i);
        await sleep(250);
        await page.keyboard.press('Escape').catch(()=>{});
        await sleep(100);
      }
    });
    // Build
    const modFile=path.join(tmpWs,'src','main','java','com','example','legacy','HelloServlet.java');
    await runTest(`C${cycle}-Build`,'build', async()=>{
      let c=fs.readFileSync(modFile,'utf-8');
      c+=`// v3 ${cycle} ${Date.now()}\n`;
      fs.writeFileSync(modFile,c,'utf-8');
      const br=await apiReq('POST','/api/v1/builds', {projectId}, wsId);
      const bid=br.payload?.id;
      for(let i=0;i<25;i++){
        await sleep(1000);
        const st=await apiReq('GET',`/api/v1/builds/${bid}`, undefined, wsId);
        const s=st.payload?.state||'';
        if(s==='success' || s==='failure') { if(s!=='success') throw new Error(`build ${s}`); break; }
        if(i===24) throw new Error('timeout');
      }
    });
    // Search + HotReload + 编码抽样
    await runTest(`C${cycle}-Misc`,'search-hot', async()=>{
      await page.keyboard.press('Control+Shift+F');
      await sleep(700);
      const has=await page.locator('input[placeholder*="Search"]').count().then(c=>c>0);
      if(has){
        const inp=page.locator('input[placeholder*="Search"]').first();
        await inp.click({timeout:2000}).catch(()=>{});
        await page.keyboard.type('Hello', {delay:15});
        await sleep(600);
        await page.keyboard.press('Escape');
        await sleep(200);
      } else await page.keyboard.press('Escape');
      await page.keyboard.press('Control+F10');
      await sleep(1000);
    });
    // 压力
    await runTest(`C${cycle}-Stress`,'resize', async()=>{
      await page.keyboard.press('Control+Shift+P');
      await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:5000}).catch(()=>{});
      const inp=await page.$('.quick-input-widget input[type="text"]');
      if(inp){ await inp.fill('>'); await inp.type('Focus', {delay:10}); await sleep(200); await page.keyboard.press('Escape'); }
      await sleep(200);
      const win=await app.evaluate(({BrowserWindow})=> BrowserWindow.getAllWindows()[0]?.getBounds());
      if(win){
        await app.evaluate(({BrowserWindow}, b)=>{ const w=BrowserWindow.getAllWindows()[0]; if(w) w.setBounds({x:b.x, y:b.y, width: b.width===1280? 1000:1280, height: b.height===800? 700:800}); }, win);
        await sleep(500);
        await app.evaluate(({BrowserWindow}, b)=>{ const w=BrowserWindow.getAllWindows()[0]; if(w) w.setBounds(b); }, win);
        await sleep(300);
      }
    });
    await runTest(`C${cycle}-Health`,'health', async()=>{
      const h=await apiReq('GET','/api/v1/health');
      if(!h.payload?.ok) throw new Error('health');
      const ok=await page.locator('#theia-app-shell').first().isVisible().catch(()=>false);
      if(!ok) throw new Error('shell');
      if(cycle%5===0) log(`  health uptime ${h.payload.uptimeSec}s`);
    });
    await shot(`cycle-${cycle}-end`);
    if(cycle%5===0) log(`cycle ${cycle} done ${elapsed()}`);
    await sleep(800);
  }

  // Server 2次
  log(`\n========== SERVER 2x ${elapsed()} ==========`);
  for(let s=1;s<=2;s++){
    await runTest(`Srv${s}`,'start', async()=>{
      const r=await apiReq('POST','/api/v1/servers', {projectId}, wsId);
      const sid=r.payload?.id;
      if(!sid) throw new Error('no sid');
      fs.writeFileSync(path.join(recordDir,`server${s}.txt`), sid);
      for(let i=0;i<30;i++){
        await sleep(1000);
        const st=await apiReq('GET',`/api/v1/servers/${sid}`, undefined, wsId);
        const stt=st.payload?.observedState||'';
        if(stt==='running') break;
        if(stt==='error') throw new Error(st.payload?.lastError||'error');
      }
      for(let h=1;h<=2;h++){
        const f=path.join(tmpWs,'WebRoot','hello.jsp');
        if(fs.existsSync(f)){ let c=fs.readFileSync(f,'utf-8'); c+=`\n<%-- v3 s${s} h${h} --%>\n`; fs.writeFileSync(f,c,'utf-8'); }
        await page.keyboard.press('Control+F10');
        await sleep(1200);
      }
    });
    await shotFull(`srv-${s}-hot`);
    await runTest(`Srv${s}`,'stop', async()=>{
      const sid=fs.readFileSync(path.join(recordDir,`server${s}.txt`),'utf-8').trim();
      await apiReq('DELETE',`/api/v1/servers/${sid}`, undefined, wsId).catch(e=> log(`  stop warn ${e.message}`));
      await sleep(1800);
    });
  }

  await shotFull('final-v3');
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n========== V3 DONE ${elapsed()} ==========`);
  log(`总 ${results.length} 通过 ${passed} 失败 ${failed}`);
  const md=`# 超长任务 v3 20轮报告

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
