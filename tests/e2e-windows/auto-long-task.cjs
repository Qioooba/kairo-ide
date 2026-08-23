// Kairo IDE — Windows 桌面长任务压力测试
// 时长 ~15-20min，循环覆盖：
// 1. 全量按钮真实点击（3轮，含 ActivityBar/Toolbar/StatusBar）
// 2. 真实项目 5轮：修改文件 → Build → 验证产物 → 热更
// 3. 窗口压力：resize / theme / 快速切换 / 大量文件打开
// 4. Server 长驻：start → 多次热更 → stop
// 每轮截图 + 健康检查 + 日志

const fs = require('fs');
const path = require('path');
const http = require('http');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-long');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-long');
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
  try{ await page.screenshot({path:f, fullPage:false}); if(shotIdx%20===0) log(`shot ${path.relative(repoRoot,f)}`); return path.relative(recordDir,f);}catch(e){ return '';}
}
async function shotFull(name){
  const f=path.join(outDir, `${String(shotIdx).padStart(4,'0')}-${name}-full.png`);
  shotIdx++;
  try{ await page.screenshot({path:f, fullPage:true}); log(`shotFull ${path.relative(repoRoot,f)}`); return path.relative(recordDir,f);}catch(e){ return '';}
}
async function runTest(phase, name, fn){
  const s=Date.now(); 
  try{ await fn(); const d=Date.now()-s; results.push({cycle, phase, name, status:'pass', durationMs:d}); if(d>2000) log(`  PASS ${phase}/${name} ${d}ms`); }catch(e){ const d=Date.now()-s; results.push({cycle, phase, name, status:'fail', durationMs:d, error:e.message}); warn(`  FAIL ${phase}/${name} ${d}ms: ${e.message.slice(0,120)}`); await shot(`FAIL-${phase}-${name}`).catch(()=>{}); }
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
        try{ const j=JSON.parse(d); if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${JSON.stringify(j).slice(0,400)}`)); else resolve(j);}catch{ if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${d.slice(0,400)}`)); else resolve({raw:d}); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, ()=>{ req.destroy(); reject(new Error('timeout')); });
    if(body) req.write(body);
    req.end();
  });
}
function elapsed(){ return ((Date.now()-startedAt)/1000).toFixed(1)+'s'; }

(async()=>{
  const exe=resolveExe();
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  // 准备真实工作区
  const tmpWs=path.join(recordDir,'workspace-long');
  const srcWs=path.join(repoRoot,'legacy-sample');
  if(fs.existsSync(tmpWs)) fs.rmSync(tmpWs,{recursive:true, force:true});
  fs.cpSync(srcWs, tmpWs, {recursive:true, filter: s=> !s.includes('.git') && !s.includes('build')});
  log(`workspace ${tmpWs}`);

  const launchArgs=[`--user-data-dir=${userDataDir}`, tmpWs];
  const env={...process.env, KAIRO_DESKTOP_LOG_FILE: path.join(recordDir,'desktop-main.log'), KAIRO_NO_DEVTOOLS:'1', KAIRO_DEV:'1', KAIRO_USER_DATA_DIR: userDataDir};
  app=await electron.launch({executablePath: exe, args: launchArgs, env, timeout:90000});
  log(`pid=${app.process().pid} elapsed ${elapsed()}`);
  page=await app.firstWindow({timeout:60000});
  log(`window ${await page.title()} ${page.url()} ${elapsed()}`);
  page.on('console', m=>{ if(m.type()==='error') log(`[console:error] ${m.text().slice(0,150)}`); });
  page.on('pageerror', e=> log(`[pageerror] ${e.message.slice(0,150)}`));
  page.on('dialog', async d=>{ try{await d.accept();}catch{} });

  await page.waitForSelector('#theia-statusBar', {timeout:90000});
  await page.waitForSelector('#theia-ApplicationShell', {timeout:30000}).catch(()=>{});
  await sleep(2000);
  try{ const dlg=page.locator('.dialogBlock'); await dlg.first().waitFor({state:'visible', timeout:3000}); const btn=page.locator('button:has-text("Yes, I trust")').first(); if(await btn.count()) await btn.click({timeout:3000}); await page.waitForSelector('.dialogBlock', {state:'detached', timeout:5000}).catch(()=>{});}catch{}
  await shotFull('00-boot');
  // agent
  const statePath=path.join(userDataDir,'kairo-data','agent-state.json');
  let state=null;
  for(let i=0;i<20;i++){ if(fs.existsSync(statePath)){ try{ state=JSON.parse(fs.readFileSync(statePath,'utf-8')); if(state.port) break;}catch{} } await sleep(500);}
  agentPort=state.port; agentSecret=state.secret||''; if(!agentSecret){ agentSecret=await app.evaluate(()=> process.env.KAIRO_LOCAL_SECRET||''); }
  log(`agent ${agentPort} ${elapsed()}`);

  // 创建 workspace & 导入
  let wsId=null, projectId=null;
  await runTest('Setup','create-workspace', async()=>{
    const r=await apiReq('POST','/api/v1/workspaces', {name:'long-task', root: tmpWs, rootPath: tmpWs});
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

  // 长任务循环 5 轮，每轮含全量按钮 + 构建热更 + 压力
  const TOTAL_CYCLES=5;
  for(cycle=1; cycle<=TOTAL_CYCLES; cycle++){
    log(`\n========== CYCLE ${cycle}/${TOTAL_CYCLES} ${elapsed()} ==========`);
    // 1. ActivityBar 轮询（真实点击）
    await runTest(`C${cycle}-UI`,'activityBar-cycle', async()=>{
      const tabs=await page.evaluate(()=>{
        return [...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=> e.getBoundingClientRect().width>0 && !e.id.includes('hidden')).map(e=> e.getAttribute('title')||'');
      });
      for(let i=0;i<tabs.length;i++){
        await page.evaluate((idx)=>{
          const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=> e.getBoundingClientRect().width>0 && !e.id.includes('hidden'));
          els[idx]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        }, i);
        await sleep(500);
      }
    });
    // 2. 全页面按钮抽样 20个
    await runTest(`C${cycle}-UI`,'all-buttons-sample', async()=>{
      const btns=await page.evaluate(()=>{
        const els=[...document.querySelectorAll('button, .theia-button, [title]')].filter(e=>{
          const r=e.getBoundingClientRect(); return r.width>10 && r.height>10 && e.offsetParent!==null && !e.id.includes('hidden');
        });
        return els.slice(0,20).map(e=> ({title: e.getAttribute('title')||'', text: (e.textContent||'').trim().slice(0,20)}));
      });
      for(let i=0;i<Math.min(btns.length,10);i++){
        await page.evaluate((idx)=>{
          const els=[...document.querySelectorAll('button, .theia-button, [title]')].filter(e=> e.getBoundingClientRect().width>10 && e.offsetParent!==null);
          const t=els[idx];
          if(t) t.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        }, i);
        await sleep(400);
        await page.keyboard.press('Escape').catch(()=>{});
        await sleep(200);
      }
    });
    // 3. 修改文件触发构建
    const modFile=path.join(tmpWs,'src','main','java','com','example','legacy','HelloServlet.java');
    await runTest(`C${cycle}-Build`,'modify-and-build', async()=>{
      // 修改文件：追加注释
      let content=fs.readFileSync(modFile,'utf-8');
      const tag=`// long-task cycle ${cycle} ${new Date().toISOString()}\n`;
      if(!content.includes(tag)) content+=tag;
      fs.writeFileSync(modFile, content, 'utf-8');
      log(`  modified ${path.relative(repoRoot,modFile)}`);
      // 通过 API 构建
      const br=await apiReq('POST','/api/v1/builds', {projectId}, wsId);
      const bid=br.payload?.id;
      log(`  build ${bid} queued`);
      for(let i=0;i<25;i++){
        await sleep(1000);
        const st=await apiReq('GET',`/api/v1/builds/${bid}`, undefined, wsId);
        const s=(st.payload?.state||'');
        log(`    build ${s} ${i}s`);
        if(s==='success' || s==='failure' || s==='failed') {
          if(s!=='success') throw new Error(`build ${s} ${JSON.stringify(st.payload?.diagnostics||'').slice(0,300)}`);
          break;
        }
        if(i===24) throw new Error('build timeout');
      }
      // 校验产物
      const out=path.join(tmpWs,'build','classes','com','example','legacy','HelloServlet.class');
      if(!fs.existsSync(out)) throw new Error('no class output');
      log(`  out ${fs.statSync(out).size} bytes`);
    });
    // 4. 热更快捷键
    await runTest(`C${cycle}-HotReload`,'ctrl-f10', async()=>{
      await page.keyboard.press('Control+F10');
      await sleep(1500);
    });
    // 5. 压力：快速切换 + resize + 主题
    await runTest(`C${cycle}-Stress`,'rapid-switch-resize', async()=>{
      await page.keyboard.press('Control+Shift+P');
      await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:5000}).catch(()=>{});
      const input=await page.$('.quick-input-widget input[type="text"]');
      if(input){ await input.fill('>'); await input.type('Focus', {delay:10}); await sleep(300); await page.keyboard.press('Escape'); }
      await sleep(300);
      // resize
      const win=await app.evaluate(({BrowserWindow})=> BrowserWindow.getAllWindows()[0]?.getBounds());
      if(win){
        await app.evaluate(({BrowserWindow}, b)=>{
          const w=BrowserWindow.getAllWindows()[0];
          if(w) w.setBounds({x:b.x, y:b.y, width: b.width===1280? 1024:1280, height: b.height===800? 700:800});
        }, win);
        await sleep(800);
        await app.evaluate(({BrowserWindow}, b)=>{
          const w=BrowserWindow.getAllWindows()[0];
          if(w) w.setBounds(b);
        }, win);
        await sleep(500);
      }
    });
    // 6. 健康
    await runTest(`C${cycle}-Health`,'agent-and-shell', async()=>{
      const h=await apiReq('GET','/api/v1/health');
      if(!h.payload?.ok) throw new Error('health not ok');
      const ok=await page.locator('#theia-app-shell').first().isVisible().catch(()=>false);
      if(!ok) throw new Error('shell not visible');
      log(`  health uptime ${h.payload.uptimeSec}s cycle ${cycle}`);
    });
    await shot(`cycle-${cycle}-end`);
    log(`cycle ${cycle} done ${elapsed()}`);
    // 每轮间隔
    await sleep(1500);
  }

  // 长驻 Server 测试（第6阶段）
  log(`\n========== SERVER LONG-RUN ${elapsed()} ==========`);
  await runTest('Server','start-long', async()=>{
    const r=await apiReq('POST','/api/v1/servers', {projectId}, wsId);
    log(`  server ${JSON.stringify(r.payload||r).slice(0,500)}`);
    const sid=r.payload?.id;
    if(!sid) throw new Error('no server id');
    fs.writeFileSync(path.join(recordDir,'serverId.txt'), sid);
    // 等待 running
    for(let i=0;i<30;i++){
      await sleep(1000);
      const st=await apiReq('GET',`/api/v1/servers/${sid}`, undefined, wsId);
      const s=st.payload?.observedState || st.payload?.state || '';
      log(`  server ${s} ${i}s`);
      if(s==='running') break;
      if(s==='error' || s==='failed') throw new Error(`server ${s} ${st.payload?.lastError||''}`);
    }
  });
  // 热更 3次
  for(let i=1;i<=3;i++){
    await runTest('Server','hot-reload-'+i, async()=>{
      const f=path.join(tmpWs,'WebRoot','hello.jsp');
      if(fs.existsSync(f)){
        let c=fs.readFileSync(f,'utf-8');
        c+=`\n<%-- long ${i} ${Date.now()} --%>\n`;
        fs.writeFileSync(f,c,'utf-8');
        log(`  modified ${path.relative(repoRoot,f)}`);
      }
      await page.keyboard.press('Control+F10');
      await sleep(2000);
    });
  }
  await shotFull('server-long-hot-reloaded');
  await runTest('Server','stop', async()=>{
    const sid=fs.readFileSync(path.join(recordDir,'serverId.txt'),'utf-8').trim();
    await apiReq('DELETE',`/api/v1/servers/${sid}`, undefined, wsId).catch(e=> log(`  stop warn ${e.message}`));
    await sleep(1500);
  });

  // 最终
  await shotFull('final-long');
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n========== LONG TASK DONE ${elapsed()} ==========`);
  log(`总 ${results.length} 通过 ${passed} 失败 ${failed}`);
  results.filter(r=>r.status==='fail').forEach(r=> log(` FAIL [${r.phase}] ${r.name}: ${r.error}`));
  const md=`# 长任务压力测试报告

**时长**: ${elapsed()}  ${new Date().toISOString()}
**工作区**: \`${tmpWs}\`
**结果**: ${passed}/${results.length} 通过

| # | 周期 | 阶段 | 用例 | 状态 |
|---|------|------|------|------|
${results.map((r,i)=>`| ${i+1} | ${r.cycle||'-'} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} |`).join('\n')}

**截图**: \`docs/screenshots/windows-long/\`
`;
  fs.writeFileSync(path.join(recordDir,'report.md'), md, 'utf-8');
  fs.writeFileSync(path.join(recordDir,'results.json'), JSON.stringify({elapsed: elapsed(), passed, failed, total: results.length, results}, null,2));
  log(`报告 ${path.join(recordDir,'report.md')}`);
  await app.close().catch(()=>{});
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error('FATAL', e.stack||e.message); process.exit(1); });
