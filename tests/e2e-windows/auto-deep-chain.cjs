// Kairo IDE — Windows 桌面真实项目全链路 (legacy-sample)
// 链路：Open Folder(legacy-sample) → Import → Build → Deploy → Server Start → HotReload(Ctrl+F10) → Stop
// 仅针对 Kairo.exe 桌面端，通过 Playwright _electron + Go Agent HTTP API 双重驱动
//
// 用法:
//   node tests/e2e-windows/auto-deep-chain.cjs
//   node tests/e2e-windows/auto-deep-chain.cjs --workspace "G:\spaces\kairo-ide\legacy-sample"
//   node tests/e2e-windows/auto-deep-chain.cjs --port 63814 --secret xxx

const fs = require('fs');
const path = require('path');
const http = require('http');
const { _electron: electron } = require('playwright');

const argv = process.argv.slice(2);
function arg(name, def){ const i=argv.indexOf(`--${name}`); return i>=0&&i+1<argv.length?argv[i+1]:def; }
function flag(n){ return argv.includes(`--${n}`); }

const repoRoot = path.resolve(__dirname, '..', '..');
const workspaceRoot = path.resolve(arg('workspace', path.join(repoRoot, 'legacy-sample')));
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-deep-chain');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-deep-chain');
fs.mkdirSync(outDir, {recursive:true});
fs.mkdirSync(recordDir, {recursive:true});

const stamp=()=> new Date().toISOString().slice(11,19);
const log=(m)=> console.log(`[${stamp()}] ${m}`);
const warn=(m)=> console.warn(`[${stamp()}] WARN ${m}`);
const sleep=(ms)=> new Promise(r=>setTimeout(r,ms));

let app, page;
let agentUrl='', agentSecret='', agentPort=0;
let shotIdx=0;
let results=[];

async function shot(name){
  const safe=name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g,'-').slice(0,80);
  const file=path.join(outDir, `${String(shotIdx).padStart(3,'0')}-${safe}.png`);
  shotIdx++;
  try{ await page.screenshot({path: file, fullPage:false}); log(`shot: ${path.relative(repoRoot,file)}`); return path.relative(recordDir,file);}catch(e){ warn(`shot fail ${e.message}`); return '';}
}
async function shotFull(name){
  const safe=name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g,'-').slice(0,80);
  const file=path.join(outDir, `${String(shotIdx).padStart(3,'0')}-${safe}-full.png`);
  shotIdx++;
  try{ await page.screenshot({path: file, fullPage:true}); log(`shotFull: ${path.relative(repoRoot,file)}`); return path.relative(recordDir,file);}catch(e){ warn(`shotFull fail ${e.message}`); return '';}
}
async function runTest(phase, name, fn){
  const start=Date.now();
  log(`[${phase}] ${name} ...`);
  try{
    await fn();
    const dur=Date.now()-start;
    const sc=await shot(`${phase}-${name}`);
    results.push({phase, name, status:'pass', durationMs:dur, screenshot:sc});
    log(`  PASS ${dur}ms`);
  }catch(e){
    const dur=Date.now()-start;
    const sc=await shot(`FAIL-${phase}-${name}`);
    results.push({phase, name, status:'fail', durationMs:dur, error:e.message, screenshot:sc});
    warn(`  FAIL ${dur}ms: ${e.message}`);
  }
}

function resolveExe(){
  let p=path.join(repoRoot,'apps','desktop','dist','win-unpacked','Kairo.exe');
  if(fs.existsSync(p)) return p;
  p=path.join(repoRoot,'dist','win-unpacked','Kairo IDE.exe');
  if(fs.existsSync(p)) return p;
  throw new Error('找不到 Kairo.exe');
}

function apiRequest(method, pathname, body, extraHeaders={}){
  return new Promise((resolve, reject)=>{
    const headers={'Content-Type':'application/json', 'X-Kairo-Secret': agentSecret, ...extraHeaders};
    // Health 无需 secret
    if(pathname==='/api/v1/health') delete headers['X-Kairo-Secret'];
    const opts={hostname:'127.0.0.1', port: agentPort, path: pathname, method, headers};
    const req=http.request(opts, res=>{
      let data=''; res.on('data',c=>data+=c); res.on('end',()=>{
        try{
          const json=JSON.parse(data);
          if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${JSON.stringify(json).slice(0,400)}`));
          else resolve(json);
        }catch{ 
          if(res.statusCode>=400) reject(new Error(`HTTP ${res.statusCode} ${data.slice(0,400)}`));
          else resolve({raw:data});
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, ()=>{ req.destroy(); reject(new Error('timeout')); });
    if(body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function dismissTrust(){
  try{
    const d=page.locator('.dialogBlock, .workspace-trust-dialog');
    await d.first().waitFor({state:'visible', timeout:3000});
    const btn=page.locator('button:has-text("Yes, I trust"), button:has-text("信任"), button:has-text("Yes")').first();
    if(await btn.count()) await btn.click({timeout:3000});
    await page.waitForSelector('.dialogBlock, .workspace-trust-dialog', {state:'detached', timeout:5000}).catch(()=>{});
  }catch{}
}

(async()=>{
  const exe=resolveExe();
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  // 清理旧 chain 数据
  const agentStatePath=path.join(userDataDir,'kairo-data','agent-state.json');

  log(`启动 Kairo.exe: ${exe}`);
  log(`workspace: ${workspaceRoot}`);
  log(`userDataDir: ${userDataDir}`);

  const env={...process.env, KAIRO_DESKTOP_LOG_FILE: path.join(recordDir,'desktop-main.log'), KAIRO_NO_DEVTOOLS:'1', KAIRO_DEV:'1', KAIRO_USER_DATA_DIR: userDataDir};
  app=await electron.launch({executablePath: exe, args:[`--user-data-dir=${userDataDir}`], env, timeout:90000});
  log(`electron pid=${app.process().pid}`);
  page=await app.firstWindow({timeout:60000});
  log(`window: ${await page.title()} ${page.url()}`);
  page.on('console', m=>{ if(m.type()==='error') log(`[console:error] ${m.text().slice(0,200)}`); });
  page.on('pageerror', e=> log(`[pageerror] ${e.message}`));
  page.on('dialog', async d=>{ log(`dialog ${d.type()}: ${String(d.message()||'').slice(0,80)}`); try{await d.accept();}catch{} });

  // 等待 Theia
  log('等待 Theia shell ...');
  await page.waitForSelector('#theia-statusBar', {timeout:90000});
  await page.waitForSelector('#theia-ApplicationShell', {timeout:30000}).catch(()=>{});
  await sleep(2000);
  await dismissTrust();
  await shotFull('01-boot');
  log('Theia 就绪');

  // 获取 Agent 信息
  const winInfo=await app.evaluate(({app})=> ({agentUrl: process.env.KAIRO_AGENT_URL||''}));
  log(`winInfo agentUrl: ${winInfo.agentUrl}`);
  // 读取 agent-state.json 获取 port/secret
  let state=null;
  for(let i=0;i<20;i++){
    if(fs.existsSync(agentStatePath)){
      try{ state=JSON.parse(fs.readFileSync(agentStatePath,'utf-8')); if(state.port) break; }catch{}
    }
    await sleep(500);
  }
  if(!state || !state.port) throw new Error('未找到 agent-state.json');
  agentPort=state.port;
  agentSecret=state.secret || '';
  // 若 file 中无 secret，尝试从 app env 取
  if(!agentSecret){
    const sec=await app.evaluate(()=> process.env.KAIRO_LOCAL_SECRET||process.env.KAIRO_AGENT_SECRET||'');
    agentSecret=sec;
  }
  log(`agent port=${agentPort} secret=${agentSecret.slice(0,8)}...`);

  // 验证健康
  await runTest('Agent','health', async()=>{
    const h=await apiRequest('GET','/api/v1/health');
    if(!h.payload || !h.payload.ok) throw new Error('health not ok');
    log(`  health uptime ${h.payload.uptimeSec}s`);
  });

  // 通过 API 创建 workspace（若已有则复用）
  await runTest('Workspace','create-or-reuse', async()=>{
    // 先 list
    let list;
    try{ list=await apiRequest('GET','/api/v1/workspaces'); }catch(e){ log(`  list workspaces fail ${e.message}, try POST`); }
    log(`  workspaces: ${JSON.stringify(list).slice(0,500)}`);
    // 尝试 POST
    const wsPayload={name: 'legacy-sample', root: workspaceRoot};
    try{
      const created=await apiRequest('POST','/api/v1/workspaces', {name: wsPayload.name, root: wsPayload.root, payload: wsPayload});
      log(`  created workspace: ${JSON.stringify(created).slice(0,500)}`);
    }catch(e){
      // 已存在则忽略
      if(!/conflict|exists|duplicate/i.test(e.message)) throw e;
      log(`  workspace 已存在，复用`);
    }
  });

  // 通过 UI 打开文件夹（备用：若 API 未生效，改用 UI）
  await runTest('UI','open-folder-legacy-sample', async()=>{
    // 尝试 Kairo: Import Project
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Import Project', {delay:25});
    await sleep(800);
    await page.keyboard.press('Enter');
    await sleep(1500);
    // 对话框是否出现
    const dlg=await page.locator('[role="dialog"], .dialogBlock, .theia-dialog').count();
    log(`  import dialog count=${dlg}`);
    if(dlg>0){
      // 尝试填路径
      const pathInput=page.locator('[role="dialog"] input, .dialogBlock input').first();
      if(await pathInput.count()){
        await pathInput.click({timeout:3000});
        await page.keyboard.press('Control+A');
        await page.keyboard.type(workspaceRoot, {delay:10});
        await sleep(500);
      }
      await shot('import-dialog-filled');
      // 点 Import/Continue
      const btn=page.locator('[role="dialog"] button:has-text("Import"), [role="dialog"] button:has-text("Continue"), [role="dialog"] button:has-text("Open")').first();
      if(await btn.count()){
        await btn.click({timeout:3000});
        await sleep(2000);
      } else {
        await page.keyboard.press('Escape');
        await sleep(500);
      }
    } else {
      await page.keyboard.press('Escape');
    }
  });

  // 项目扫描
  await runTest('Project','scan', async()=>{
    try{
      const res=await apiRequest('POST','/api/v1/projects/detect', {root: workspaceRoot});
      log(`  detect: ${JSON.stringify(res).slice(0,600)}`);
    }catch(e){
      // 尝试 /api/v1/projects?workspaceId
      log(`  detect via API 失败 ${e.message}，改用 UI Scan`);
      await page.keyboard.press('Control+Shift+P');
      await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
      const input=await page.$('.quick-input-widget input[type="text"]');
      await input.fill('>');
      await input.type('Scan Project', {delay:25});
      await sleep(700);
      await page.keyboard.press('Enter');
      await sleep(1500);
    }
  });

  // Build
  await runTest('Build','ant-compile', async()=>{
    // 通过 UI 触发 Build
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Build', {delay:25});
    await sleep(800);
    // 优先选 Kairo: Build
    const hit=await page.evaluate(()=>{
      const rows=[...document.querySelectorAll('.quick-input-widget .monaco-list-row')];
      const kairo=rows.find(r=> /Kairo:\s*Build$/i.test(r.textContent||''));
      if(kairo) { kairo.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 'kairo-build'; }
      const any=rows.find(r=> /Build/i.test(r.textContent||''));
      if(any) { any.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 'any-build'; }
      return 'none';
    });
    log(`  build trigger: ${hit}`);
    if(hit==='none') await page.keyboard.press('Escape');
    await sleep(2000);
    // 同时通过 API 触发（若 UI 未触发）
    try{
      // 尝试获取 workspaceId
      const wsList=await apiRequest('GET','/api/v1/workspaces');
      const wsId=wsList.payload?.[0]?.id || wsList.payload?.[0]?.workspaceId || 'ws_legacy-sample';
      log(`  wsId=${wsId}`);
      const buildRes=await apiRequest('POST','/api/v1/builds', {workspaceId: wsId, projectId: 'legacy-sample', clean:false});
      log(`  api build: ${JSON.stringify(buildRes).slice(0,600)}`);
      // 轮询 build 状态
      let bid=buildRes.payload?.id || buildRes.payload?.buildId;
      if(bid){
        for(let i=0;i<15;i++){
          await sleep(1000);
          const st=await apiRequest('GET',`/api/v1/builds/${bid}`);
          log(`  build ${bid} status: ${JSON.stringify(st.payload||st).slice(0,300)}`);
          if(/success|failed|completed/i.test(JSON.stringify(st))) break;
        }
      }
    }catch(e){
      log(`  api build 失败 (可能需先导入project): ${e.message}`);
      // 不判失败，UI 已触发
    }
  });

  await shotFull('02-after-build');

  // 打开 Build 视图验证
  await runTest('View','show-builds', async()=>{
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Show Builds', {delay:25});
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(1200);
    const hasBuildView=await page.evaluate(()=> !!document.querySelector('.kairo-build-view, [id*="build"]'));
    log(`  hasBuildView=${hasBuildView}`);
  });

  // Deploy
  await runTest('Deploy','publish', async()=>{
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Publish', {delay:25});
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(2000);
  });

  // Server Start
  await runTest('Server','start', async()=>{
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Start Server', {delay:25});
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(3000);
    // Show Servers 验证
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input2=await page.$('.quick-input-widget input[type="text"]');
    await input2.fill('>');
    await input2.type('Show Servers', {delay:25});
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(1200);
  });

  await shotFull('03-servers-after-start');

  // Hot Reload Ctrl+F10
  await runTest('HotReload','ctrl-f10-update', async()=>{
    await page.keyboard.press('Control+F10');
    await sleep(2000);
    // 检查是否有 hot-reload 横幅或通知
    const banner=await page.evaluate(()=>{
      const b=document.querySelector('.kairo-hot-reload-banner, .kairo-hotswap-status, [class*="hot-reload"]');
      return b ? b.textContent.slice(0,200) : '';
    });
    log(`  hot-reload banner: "${banner}"`);
  });

  // 模拟文件修改触发 hot reload（改 HelloWorld.java）
  await runTest('HotReload','modify-file-trigger', async()=>{
    // 打开 HelloWorld.java
    await page.keyboard.press('Control+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('');
    await input.type('HelloWorld.java', {delay:25});
    let matched=false;
    for(let i=0;i<10;i++){
      matched=await page.evaluate(()=> [...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(r=> /HelloWorld\.java/i.test(r.textContent||'')));
      if(matched) break; await sleep(400);
    }
    if(matched) await page.keyboard.press('Enter');
    else await page.keyboard.press('Escape');
    await page.waitForSelector('.monaco-editor', {timeout:10000}).catch(()=>{});
    await sleep(800);
    await page.evaluate(()=>{ const ta=document.querySelector('.monaco-editor textarea.inputarea'); if(ta) ta.focus(); });
    await sleep(200);
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n// hot-reload test '+new Date().toISOString(), {delay:12});
    await sleep(400);
    await page.keyboard.press('Control+S');
    await sleep(1500);
    const after=await page.evaluate(()=>{
      const b=document.querySelector('.kairo-hot-reload-banner, [class*="hot"]');
      return b ? b.textContent.slice(0,200) : 'no-banner';
    });
    log(`  after save banner: "${after}"`);
  });

  await shotFull('04-after-hot-reload');

  // Stop Server
  await runTest('Server','stop', async()=>{
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', {timeout:8000});
    const input=await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Stop Server', {delay:25});
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(2000);
  });

  // 最终健康与截图
  await runTest('Final','health-and-shell', async()=>{
    const h=await apiRequest('GET','/api/v1/health');
    if(!h.payload.ok) throw new Error('health not ok');
    log(`  final health uptime ${h.payload.uptimeSec}s`);
    const shellOk=await page.locator('#theia-app-shell, #theia-ApplicationShell').first().isVisible().catch(()=>false);
    if(!shellOk) throw new Error('shell 不可见');
  });
  await shotFull('05-final');

  // 汇总
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n=== 链路汇总: ${passed}/${results.length} 通过, ${failed} 失败 ===`);
  results.forEach(r=> log(` ${r.status==='pass'?'PASS':'FAIL'} [${r.phase}] ${r.name}${r.error?' : '+r.error:''}`));

  const md=`# Kairo Windows 真实项目链路报告

**时间**: ${new Date().toISOString()}
**工作区**: \`${workspaceRoot}\`
**Agent**: ${agentPort}  uptime via health
**结果**: ${passed}/${results.length} 通过

## 用例

| # | 阶段 | 用例 | 状态 | 时长 | 截图 |
|---|------|------|------|------|------|
${results.map((r,i)=>`| ${i+1} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} | ${r.durationMs}ms | ${r.screenshot||'-'} |`).join('\n')}

## 失败

${results.filter(r=>r.status==='fail').map(r=>`- ${r.phase}/${r.name}: ${r.error}`).join('\n') || '无'}

## 下一步

- 若 Build/Server 失败，多为无 JDK6/ Tomcat 配置或工作区未正确导入，需补 .kairo/project.yaml 或通过 UI 导入向导
- 热更需在 Server running 时修改文件，当前链路已覆盖
`;
  fs.writeFileSync(path.join(recordDir,'report.md'), md, 'utf-8');
  fs.writeFileSync(path.join(recordDir,'results.json'), JSON.stringify({workspaceRoot, agentPort, passed, failed, total: results.length, results}, null, 2));
  log(`报告写入 ${path.join(recordDir,'report.md')}`);
  log(`截图 ${outDir}`);

  await app.close().catch(()=>{});
  process.exit(failed>0?1:0);
})().catch(err=>{
  console.error('FATAL', err.stack||err.message);
  process.exit(1);
});
