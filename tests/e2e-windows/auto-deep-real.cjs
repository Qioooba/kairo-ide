// 真实项目导入验证 — 针对用户反馈“没有导入真实的项目”
// 策略：
// 1. 复制 legacy-sample 到临时工作区（保留 .kairo/project.yaml，因要验证真实已有项目）
// 2. 以该临时工作区为 Theia 初始打开文件夹启动 Kairo.exe（传参 workspace 路径）
// 3. 通过正确 Envelope + Header 调用 API 完成 workspace 创建与项目检测/导入（若已存在则校验）
// 4. UI 校验 Explorer 已显示真实文件（HelloServlet.java / hello.jsp / build.xml）
// 5. 触发真实 Build / Deploy / Server 全链路

const fs = require('fs');
const path = require('path');
const http = require('http');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const legacySrc = path.join(repoRoot, 'legacy-sample');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-real');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-real');
fs.mkdirSync(outDir, {recursive:true});
fs.mkdirSync(recordDir, {recursive:true});

// 1. 准备临时工作区
const tmpWs = path.join(recordDir, 'workspace-legacy-real');
function copyRecursive(src, dest){
  fs.mkdirSync(dest, {recursive:true});
  for(const e of fs.readdirSync(src, {withFileTypes:true})){
    const s=path.join(src,e.name), d=path.join(dest,e.name);
    if(e.isDirectory()){
      if(e.name==='.git' || e.name==='build' || e.name==='node_modules') continue;
      copyRecursive(s,d);
    } else {
      fs.copyFileSync(s,d);
    }
  }
}
if(fs.existsSync(tmpWs)) fs.rmSync(tmpWs, {recursive:true, force:true});
copyRecursive(legacySrc, tmpWs);
console.log(`临时工作区: ${tmpWs}`);
console.log(`  含 project.yaml: ${fs.existsSync(path.join(tmpWs,'.kairo','project.yaml'))}`);
console.log(`  含 HelloServlet: ${fs.existsSync(path.join(tmpWs,'src','main','java','com','example','legacy','HelloServlet.java'))}`);

const stamp=()=> new Date().toISOString().slice(11,19);
const log=m=> console.log(`[${stamp()}] ${m}`);
const warn=m=> console.warn(`[${stamp()}] WARN ${m}`);
const sleep=ms=> new Promise(r=>setTimeout(r,ms));
let app, page, agentPort=0, agentSecret='', shotIdx=0, results=[];
async function shot(name){
  const f=path.join(outDir, `${String(shotIdx).padStart(3,'0')}-${name.replace(/[^a-z0-9\u4e00-\u9fa5-_]/g,'-')}.png`);
  shotIdx++;
  try{ await page.screenshot({path:f, fullPage:false}); log(`shot ${path.relative(repoRoot,f)}`); return path.relative(recordDir,f);}catch(e){ warn(e.message); return '';}
}
async function shotFull(name){
  const f=path.join(outDir, `${String(shotIdx).padStart(3,'0')}-${name}-full.png`);
  shotIdx++;
  try{ await page.screenshot({path:f, fullPage:true}); log(`shotFull ${path.relative(repoRoot,f)}`); return path.relative(recordDir,f);}catch(e){ warn(e.message); return '';}
}
async function runTest(phase,name,fn){
  const s=Date.now(); log(`[${phase}] ${name} ...`);
  try{ await fn(); const d=Date.now()-s; const sc=await shot(`${phase}-${name}`); results.push({phase,name,status:'pass',durationMs:d,screenshot:sc}); log(`  PASS ${d}ms`);}catch(e){ const d=Date.now()-s; const sc=await shot(`FAIL-${phase}-${name}`); results.push({phase,name,status:'fail',durationMs:d,error:e.message,screenshot:sc}); warn(`  FAIL ${d}ms: ${e.message}`);}
}
function resolveExe(){
  let p=path.join(repoRoot,'apps','desktop','dist','win-unpacked','Kairo.exe');
  if(fs.existsSync(p)) return p;
  p=path.join(repoRoot,'dist','win-unpacked','Kairo IDE.exe');
  if(fs.existsSync(p)) return p;
  throw new Error('找不到 Kairo.exe');
}
// 正确 Envelope 请求
function apiReq(method, pathname, payload, workspaceId){
  return new Promise((resolve, reject)=>{
    const envelope={requestId: 'req_'+Math.random().toString(36).slice(2,10), workspaceId: workspaceId||undefined, payload};
    // 清理 undefined
    if(!envelope.workspaceId) delete envelope.workspaceId;
    if(payload===undefined) delete envelope.payload;
    const body= payload!==undefined ? JSON.stringify(envelope) : undefined;
    const headers={'Content-Type':'application/json', 'X-Kairo-Secret': agentSecret};
    if(workspaceId) headers['X-Kairo-Workspace-Id']=workspaceId;
    headers['X-Kairo-Request-Id']=envelope.requestId;
    const opts={hostname:'127.0.0.1', port: agentPort, path: pathname, method, headers};
    const req=http.request(opts, res=>{
      let data=''; res.on('data',c=>data+=c); res.on('end',()=>{
        try{
          const j=JSON.parse(data);
          if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${JSON.stringify(j).slice(0,600)}`));
          else resolve(j);
        }catch{
          if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${data.slice(0,600)}`));
          else resolve({raw:data});
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, ()=>{ req.destroy(); reject(new Error('timeout')); });
    if(body) req.write(body);
    req.end();
  });
}

(async()=>{
  const exe=resolveExe();
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  // 关键：以临时工作区为初始打开文件夹启动（Theia 会将其作为 workspace）
  const launchArgs=[`--user-data-dir=${userDataDir}`, tmpWs];
  log(`启动: ${exe} ${launchArgs.join(' ')}`);
  const env={...process.env, KAIRO_DESKTOP_LOG_FILE: path.join(recordDir,'desktop-main.log'), KAIRO_NO_DEVTOOLS:'1', KAIRO_DEV:'1', KAIRO_USER_DATA_DIR: userDataDir};
  app=await electron.launch({executablePath: exe, args: launchArgs, env, timeout:90000});
  log(`pid=${app.process().pid}`);
  page=await app.firstWindow({timeout:60000});
  log(`window ${await page.title()} ${page.url()}`);
  page.on('console', m=>{ if(m.type()==='error') log(`[console:error] ${m.text().slice(0,200)}`); });
  page.on('pageerror', e=> log(`[pageerror] ${e.message}`));
  page.on('dialog', async d=>{ log(`dialog ${d.type()}: ${String(d.message()||'').slice(0,80)}`); try{await d.accept();}catch{} });

  await page.waitForSelector('#theia-statusBar', {timeout:90000});
  await page.waitForSelector('#theia-ApplicationShell', {timeout:30000}).catch(()=>{});
  await sleep(2000);
  // 关 trust
  try{
    const dlg=page.locator('.dialogBlock, .workspace-trust-dialog');
    await dlg.first().waitFor({state:'visible', timeout:3000});
    const btn=page.locator('button:has-text("Yes, I trust"), button:has-text("信任")').first();
    if(await btn.count()) await btn.click({timeout:3000});
    await page.waitForSelector('.dialogBlock', {state:'detached', timeout:5000}).catch(()=>{});
  }catch{}
  await shotFull('01-boot-with-workspace');
  // 等 Explorer 加载
  await sleep(1500);

  // 取 Agent 信息
  const statePath=path.join(userDataDir,'kairo-data','agent-state.json');
  let state=null;
  for(let i=0;i<20;i++){ if(fs.existsSync(statePath)){ try{ state=JSON.parse(fs.readFileSync(statePath,'utf-8')); if(state.port) break;}catch{} } await sleep(500);}
  if(!state) throw new Error('无 agent-state');
  agentPort=state.port; agentSecret=state.secret||'';
  if(!agentSecret){ const s=await app.evaluate(()=> process.env.KAIRO_LOCAL_SECRET||''); agentSecret=s; }
  log(`agent ${agentPort} secret ${agentSecret.slice(0,8)}...`);

  // API：列 workspace
  await runTest('API','list-workspaces', async()=>{
    const r=await apiReq('GET','/api/v1/workspaces', undefined);
    log(`  workspaces ${JSON.stringify(r).slice(0,600)}`);
  });
  // API：创建 workspace（若已存在则复用）
  let wsId=null;
  await runTest('API','create-workspace-tmpWs', async()=>{
    try{
      const r=await apiReq('POST','/api/v1/workspaces', {name: 'ws-real', root: tmpWs, rootPath: tmpWs});
      log(`  create ${JSON.stringify(r).slice(0,600)}`);
      wsId=r.payload?.id || r.payload?.workspaceId || r.id;
    }catch(e){
      // 已存在则查
      log(`  create 失败 ${e.message}，尝试查询`);
      const list=await apiReq('GET','/api/v1/workspaces');
      const found=(list.payload||[]).find(w=> w.rootPath===tmpWs || w.root===tmpWs);
      if(found) wsId=found.id;
      else throw e;
    }
    if(!wsId){
      const list=await apiReq('GET','/api/v1/workspaces');
      wsId=(list.payload||[])[0]?.id;
    }
    if(!wsId) throw new Error('无 workspaceId');
    log(`  wsId=${wsId}`);
    fs.writeFileSync(path.join(recordDir,'wsId.txt'), wsId);
  });

  // API：detect
  let detected=null;
  await runTest('API','detect-project', async()=>{
    const r=await apiReq('POST','/api/v1/projects/detect', {rootPath: tmpWs}, wsId);
    log(`  detect ${JSON.stringify(r).slice(0,800)}`);
    detected=r.payload || r;
    fs.writeFileSync(path.join(recordDir,'detect.json'), JSON.stringify(r,null,2));
    if(!detected) throw new Error('无检测结果');
  });

  // API：list projects（看是否已自动注册）
  await runTest('API','list-projects-before-import', async()=>{
    const r=await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`, undefined, wsId);
    log(`  projects before ${JSON.stringify(r).slice(0,800)}`);
    fs.writeFileSync(path.join(recordDir,'projects-before.json'), JSON.stringify(r,null,2));
  });

  // UI：验证 Explorer 已显示真实文件
  await runTest('UI','explorer-shows-real-files', async()=>{
    // 确保 Explorer 视图打开
    await page.keyboard.press('Control+Shift+E');
    await sleep(1000);
    const files=await page.evaluate(()=>{
      const nodes=[...document.querySelectorAll('.theia-TreeNode, .theia-TreeNodeSegment, .p-TreeNode')].map(n=> (n.textContent||'').trim()).filter(Boolean);
      const uniq=[...new Set(nodes)];
      return uniq.slice(0,30);
    });
    log(`  explorer nodes: ${files.join(' | ').slice(0,500)}`);
    await shot('explorer-nodes');
    const hasReal= files.some(t=> /HelloServlet|HelloWorld|build\.xml|hello\.jsp|legacy-sample/i.test(t));
    if(!hasReal){
      // 尝试展开根节点
      await page.evaluate(()=>{
        const exp=[...document.querySelectorAll('.theia-TreeNode')].find(n=> /legacy-real|workspace/i.test(n.textContent||''));
        if(exp) exp.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      });
      await sleep(800);
      const files2=await page.evaluate(()=> [...document.querySelectorAll('.theia-TreeNode')].map(n=> (n.textContent||'').trim()).slice(0,20).join(' | '));
      log(`  after expand: ${files2.slice(0,500)}`);
      if(!/HelloServlet|build\.xml/i.test(files2)) throw new Error(`Explorer 未显示真实文件: ${files.join(',').slice(0,300)}`);
    }
  });

  // 若项目未导入，尝试 API import（使用 detect 结果或已知值）
  await runTest('API','import-if-needed', async()=>{
    const before=JSON.parse(fs.readFileSync(path.join(recordDir,'projects-before.json'),'utf-8'));
    const hasProj=(before.payload||[]).length>0;
    if(hasProj){
      log(`  已有 ${before.payload.length} 个项目，跳过 import`);
      return;
    }
    // 构造 import 请求（基于 legacy-sample 已知结构）
    const imp={
      workspaceId: wsId,
      rootPath: tmpWs,
      name: 'legacy-sample',
      sourceDirs: ['src'],
      webRoot: 'WebRoot',
      libDirs: ['lib'],
      buildScript: 'build.xml',
      defaultEncoding: 'gbk',
      jdkVersion: '1.6',
      sourceVersion: '1.6',
      targetVersion: '1.6',
      outputDir: 'build/classes',
      buildTool: 'ant',
      contextPath: '/'
    };
    // 若 detect 有更准信息则覆盖
    if(detected && detected.sourceDirs) imp.sourceDirs=detected.sourceDirs;
    if(detected && detected.webRoot) imp.webRoot=detected.webRoot;
    const r=await apiReq('POST','/api/v1/projects/import', imp, wsId);
    log(`  import ${JSON.stringify(r).slice(0,800)}`);
    fs.writeFileSync(path.join(recordDir,'import.json'), JSON.stringify(r,null,2));
  });

  await runTest('API','list-projects-after', async()=>{
    const r=await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`, undefined, wsId);
    log(`  projects after ${JSON.stringify(r).slice(0,800)}`);
    fs.writeFileSync(path.join(recordDir,'projects-after.json'), JSON.stringify(r,null,2));
    const cnt=(r.payload||[]).length;
    if(cnt===0) throw new Error('导入后仍无项目');
  });

  // 真实 Build（通过 API，带正确 envelope）
  let projectId=null;
  await runTest('Build','real-ant-build', async()=>{
    const list=await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`, undefined, wsId);
    projectId=(list.payload||[])[0]?.id || (list.payload||[])[0]?.projectId;
    if(!projectId) throw new Error('无 projectId');
    log(`  projectId=${projectId}`);
    // 先通过 UI 触发，再用 API 轮询
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Build', {delay:25});
    await sleep(800);
    await page.keyboard.press('Enter');
    await sleep(2000);
    // API 触发（确保 envelope 正确）
    try{
      const br=await apiReq('POST','/api/v1/builds', {projectId}, wsId);
      log(`  api build ${JSON.stringify(br).slice(0,800)}`);
      const bid=br.payload?.id || br.payload?.buildId;
      if(bid){
        for(let i=0;i<20;i++){
          await sleep(1000);
          const st=await apiReq('GET',`/api/v1/builds/${bid}`, undefined, wsId);
          log(`  build ${bid} ${JSON.stringify(st.payload||st).slice(0,400)}`);
          const s=JSON.stringify(st);
          if(/success|failure|failed|completed/i.test(s)) break;
        }
      }
    }catch(e){
      log(`  api build 失败但 UI 已触发: ${e.message}`);
    }
  });

  await shotFull('02-after-real-build');
  await runTest('UI','show-builds-view', async()=>{
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Show Builds', {delay:25});
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(1200);
  });

  // 验证 build 产物
  await runTest('FS','check-build-output', async()=>{
    const out=path.join(tmpWs,'build','classes','com','example','legacy','HelloServlet.class');
    if(!fs.existsSync(out)) throw new Error(`未生成 ${out}`);
    log(`  产物存在 ${out} ${fs.statSync(out).size} bytes`);
  });

  // 最终
  await runTest('Final','health', async()=>{
    const h=await apiReq('GET','/api/v1/health');
    if(!h.payload?.ok) throw new Error('health not ok');
  });
  await shotFull('03-final-real');

  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n=== 真实项目汇总 ${passed}/${results.length} 通过 ===`);
  results.forEach(r=> log(`${r.status==='pass'?'PASS':'FAIL'} [${r.phase}] ${r.name}${r.error?' : '+r.error:''}`));
  const md=`# 真实项目导入报告

**工作区**: \`${tmpWs}\`
**wsId**: ${wsId||'未知'}
**projectId**: ${projectId||'未知'}
**结果**: ${passed}/${results.length}

| # | 阶段 | 用例 | 状态 |
|---|------|------|------|
${results.map((r,i)=>`| ${i+1} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} |`).join('\n')}

**Explorer 截图**: \`docs/screenshots/windows-real/\`
**产物**: ${fs.existsSync(path.join(tmpWs,'build','classes','com','example','legacy','HelloServlet.class'))?'已生成 HelloServlet.class':'未生成'}
`;
  fs.writeFileSync(path.join(recordDir,'report.md'), md, 'utf-8');
  fs.writeFileSync(path.join(recordDir,'results.json'), JSON.stringify({tmpWs, wsId, projectId, passed, failed, results}, null,2));
  log(`报告 ${path.join(recordDir,'report.md')}`);

  await app.close().catch(()=>{});
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error('FATAL', e.stack||e.message); process.exit(1); });
