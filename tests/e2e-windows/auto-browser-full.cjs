// Kairo IDE 浏览器版全量测试 — Playwright 浏览器模式
// 覆盖：启动→Go Agent→Theia前端→全量按钮/视图/编辑/搜索/SVN/Git/Debug

const fs=require('fs');
const path=require('path');
const http=require('http');
const {execSync,spawn}=require('child_process');
const {chromium}=require('playwright');

const repoRoot=path.resolve(__dirname,'..','..');
const outDir=path.join(repoRoot,'docs','screenshots','browser-full');
const recordDir=path.join(repoRoot,'artifacts','browser-full');
fs.mkdirSync(outDir,{recursive:true});fs.mkdirSync(recordDir,{recursive:true});

const log=m=>console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let page=null,browser=null,agentPort=0,agentSecret='',shotIdx=0,results=[];
let wsId=null,projectId=null,tmpWs='';
let theiaProcess=null,agentProcess=null;
const BROWSER_PORT=18301;

async function shot(name){
  const f=path.join(outDir,`${String(shotIdx).padStart(4,'0')}-${name.replace(/[^a-z0-9\u4e00-\u9fa5-_]/g,'-').slice(0,60)}.png`);
  shotIdx++;
  try{await page.screenshot({path:f,fullPage:false});return path.relative(recordDir,f);}catch{return'';}
}
async function runTest(phase,name,fn){
  const s=Date.now();
  try{await fn();const d=Date.now()-s;results.push({phase,name,status:'pass',durationMs:d});log(`  PASS ${phase}/${name} ${d}ms`);}
  catch(e){const d=Date.now()-s;results.push({phase,name,status:'fail',durationMs:d,error:e.message});log(`  FAIL ${phase}/${name} ${d}ms: ${e.message.slice(0,120)}`);await shot(`FAIL-${phase}-${name}`).catch(()=>{});}
}
function apiReq(method,pn,payload,wId){
  return new Promise((resolve,reject)=>{
    const env={requestId:'req_'+Math.random().toString(36).slice(2,9),workspaceId:wId||undefined,payload};
    if(!env.workspaceId)delete env.workspaceId;
    if(payload===undefined)delete env.payload;
    const body=payload!==undefined?JSON.stringify(env):undefined;
    const headers={'Content-Type':'application/json'};
    if(agentSecret)headers['X-Kairo-Secret']=agentSecret;
    if(wId)headers['X-Kairo-Workspace-Id']=wId;
    headers['X-Kairo-Request-Id']=env.requestId;
    const req=http.request({hostname:'127.0.0.1',port:agentPort,path:pn,method,headers},res=>{
      let d='';res.on('data',c=>d+=c);res.on('end',()=>{
        try{const j=JSON.parse(d);if(res.statusCode>=400)reject(new Error(`HTTP${res.statusCode} ${JSON.stringify(j).slice(0,300)}`));else resolve(j);}catch{resolve({raw:d});}
      });
    });
    req.on('error',reject);req.setTimeout(10000,()=>{req.destroy();reject(new Error('t/o'));});
    if(body)req.write(body);req.end();
  });
}
async function closeOverlays(){
  for(let i=0;i<3;i++){
    const has=await page.evaluate(()=>!!document.querySelector('.lm-Menu:not(.lm-mod-hidden),[role="dialog"],.dialogBlock,.quick-input-widget'));
    if(!has)break;
    await page.keyboard.press('Escape');await sleep(250);
  }
}

(async()=>{
  // 准备工作区
  tmpWs=path.join(recordDir,'workspace-browser');
  fs.rmSync(tmpWs,{recursive:true,force:true});
  fs.cpSync(path.join(repoRoot,'legacy-sample'),tmpWs,{recursive:true,filter:s=>!s.includes('.git')&&!s.includes('.svn')&&!s.includes('build')});

  // ===== 启动 Go Agent =====
  log('启动 Go Runtime Agent...');
  agentPort=19080;
  const agentExe=path.join(repoRoot,'apps','desktop','dist','win-unpacked','resources','bin','kairo-runtime.exe');
  agentProcess=spawn(agentExe,['--bind','127.0.0.1','--port',String(agentPort),'--data-dir',path.join(recordDir,'kairo-data'),'--log-level','info'],{
    stdio:['ignore','pipe','pipe'],
    env:{...process.env,KAIRO_BROWSER:'1'},
  });
  agentProcess.stdout?.on('data',d=>{const s=d.toString();if(s.includes('secret')){try{agentSecret=s.match(/secret[:\s]+([a-f0-9]+)/)?.[1]||'';}catch{}}});
  
  // 等 agent 就绪
  for(let i=0;i<15;i++){
    await sleep(1000);
    try{
      const res=await new Promise((resolve,reject)=>{
        http.get(`http://127.0.0.1:${agentPort}/api/v1/health`,r=>{r.resume();r.statusCode===200?resolve(true):reject()}).on('error',()=>reject());
      });
      log(`Agent ready on port ${agentPort}`);
      break;
    }catch{}
    if(i===14)throw new Error('Agent failed to start');
  }

  // 从 agent stdout 提取 secret（如果没从日志获取到）
  if(!agentSecret){
    try{
      const healthData=await new Promise((resolve,reject)=>{
        http.get(`http://127.0.0.1:${agentPort}/api/v1/endpoints`,r=>{
          let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve(JSON.parse(d))}catch{resolve(null)}});
        }).on('error',()=>reject());
      });
      log(`endpoints: ${JSON.stringify(healthData).slice(0,200)}`);
    }catch{}
  }
  log(`agent=${agentPort} secret=${agentSecret?'yes':'no'}`);

  // ===== 启动 Theia 后端 =====
  log('启动 Theia Browser Backend...');
  const backendEntry=path.join(repoRoot,'apps','browser','lib','backend','main.js');
  const theiaEnv={
    ...process.env,
    KAIRO_AGENT_URL:`http://127.0.0.1:${agentPort}`,
    KAIRO_AGENT_SECRET:agentSecret,
    KAIRO_HEADLESS:'1',
    THEIA_CONFIG_DIR:path.join(recordDir,'theia-config'),
  };
  fs.mkdirSync(theiaEnv.THEIA_CONFIG_DIR,{recursive:true});

  theiaProcess=spawn(process.execPath,[backendEntry,`--hostname=127.0.0.1`,`--port=${BROWSER_PORT}`,tmpWs],{
    stdio:['ignore','pipe','pipe'],
    env:theiaEnv,
    cwd:path.join(repoRoot,'apps','browser'),
  });
  let theiaOutput='';
  theiaProcess.stdout?.on('data',d=>{theiaOutput+=d.toString();});
  theiaProcess.stderr?.on('data',d=>{theiaOutput+=d.toString();});

  // 等 Theia 就绪
  let theiaReady=false;
  for(let i=0;i<30;i++){
    await sleep(2000);
    try{
      const ok=await new Promise((resolve,reject)=>{
        http.get(`http://127.0.0.1:${BROWSER_PORT}/`,r=>{r.resume();r.statusCode<500?resolve(true):reject()}).on('error',()=>reject());
      });
      theiaReady=true;break;
    }catch{
      if(i%5===4)log(`  waiting... ${i*2}s`);
      // 检查是否崩溃
      if(theiaProcess.killed||(theiaProcess.exitCode!==null&&theiaProcess.exitCode!==0)){
        log(`Theia exited with code ${theiaProcess.exitCode}`);
        log(theiaOutput.slice(-500));
        throw new Error('Theia backend crashed on startup');
      }
    }
  }
  if(!theiaReady)throw new Error('Theia not ready after 60s');
  log(`Theia ready on http://127.0.0.1:${BROWSER_PORT}`);

  // ===== 打开浏览器 =====
  log('\n打开 Chromium...');
  browser=await chromium.launch({
    headless:false,
    args:['--start-maximized','--disable-features=Translate','--no-default-browser-check'],
  });
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  page=await context.newPage();

  // 收集 console errors
  const consoleErrors=[];
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,150));});
  page.on('pageerror',e=>consoleErrors.push(e.message.slice(0,150)));

  // 加载页面
  await runTest('Boot','navigate-to-theia',async()=>{
    await page.goto(`http://127.0.0.1:${BROWSER_PORT}`, {waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#theia-statusBar, .theia-statusBar',{timeout:90000});
    await sleep(3000);
    await shotFull('boot-browser');
  });

  async function shotFull(name){
    const f=path.join(outDir,`${String(shotIdx).padStart(4,'0')}-${name}-full.png`);
    shotIdx++;
    try{await page.screenshot({path:f,fullPage:true});log(`shotFull ${path.relative(repoRoot,f)}`);}catch{}
  }

  // Workspace Trust 对话框
  await runTest('Boot','dismiss-trust',async()=>{
    try{
      const dlg=page.locator('.dialogBlock,.workspace-trust-dialog');
      await dlg.first().waitFor({state:'visible',timeout:5000});
      const btn=page.locator('button:has-text("Yes, I trust"),button:has-text("信任")').first();
      if(await btn.count())await btn.click({timeout:3000});
      await page.waitForSelector('.dialogBlock',{state:'detached',timeout:5000}).catch(()=>{});
    }catch{}
    await sleep(1000);
  });

  // Setup workspace via API
  await runTest('Setup','workspace+import',async()=>{
    wsId=(await apiReq('POST','/api/v1/workspaces',{name:'browser-test',root:tmpWs,rootPath:tmpWs}).catch(()=>({payload:null})))?.payload?.id;
    projectId=(await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`,undefined,wsId).catch(()=>({payload:null})))?.payload?.[0]?.id;
    if(!projectId){
      projectId=(await apiReq('POST','/api/v1/projects/import',{
        workspaceId:wsId,rootPath:tmpWs,name:'legacy-sample',
        sourceDirs:['src'],webRoot:'WebRoot',libDirs:['lib'],
        buildScript:'build.xml',defaultEncoding:'gbk',
        sourceVersion:'1.6',targetVersion:'1.6',
        outputDir:'build/classes',buildTool:'ant',contextPath:'/'
      },wsId)).payload?.id;
    }
    if(!projectId)throw new Error('no project');
    log(`  ws=${wsId?.slice(0,12)} proj=${projectId}`);
  });

  // Build
  await runTest('Build','ant-compile',async()=>{
    const br=await apiReq('POST','/api/v1/builds',{projectId},wsId);
    for(let i=0;i<20;i++){await sleep(1000);
      const st=await apiReq('GET',`/api/v1/builds/${br.payload?.id}`,undefined,wsId);
      if(st.payload?.state==='success')return;
      if(/failure|failed/.test(st.payload?.state||''))throw new Error('build failed');
      if(i===19)throw new Error('timeout');
    }
  });

  // ===== UI 测试 =====
  log('\n===== UI 全量按钮点击 =====');

  // ActivityBar
  await runTest('UI','activityBar-all-clicks',async()=>{
    const tabs=await page.evaluate(()=>{
      return [...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')]
        .filter(e=>e.getBoundingClientRect().width>0&&!e.id.includes('hidden'))
        .map(e=>({title:e.getAttribute('title')||'',idx:0}));
    });
    log(`  ActivityBar ${tabs.length} items`);
    for(let i=0;i<tabs.length;i++){
      await page.evaluate((idx)=>{
        const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')]
          .filter(e=>e.getBoundingClientRect().width>0&&!e.id.includes('hidden'));
        els[idx]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      },i);
      await sleep(600);
    }
    await shot('activitybar-after-all-clicks');
  });

  // Command Palette 全量命令
  await runTest('UI','command-palette-kairo',async()=>{
    await closeOverlays();
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]',{timeout:8000});
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>Kairo');
    await sleep(1000);
    const cmds=await page.$$eval('.quick-input-widget .monaco-list-row',els=>els.map(e=>(e.textContent||'').trim()).slice(0,20));
    log(`  Kairo commands visible: ${cmds.length}`);
    await shot('palette-kairo-commands');
    // 执行几个关键命令
    for(const cmd of ['Show Servers','Show Builds','Show Deployments']){
      await inp.fill(`>${cmd}`);
      await sleep(500);
      await page.keyboard.press('Enter');
      await sleep(1200);
    }
    await closeOverlays();
  });

  // 编辑器操作
  await runTest('Editor','open-and-type',async()=>{
    await closeOverlays();
    await page.keyboard.press('Control+N');await sleep(1200);
    await page.evaluate(()=>{const ta=document.querySelector('.monaco-editor textarea.inputarea');if(ta)ta.focus()});
    await page.keyboard.type('// browser test\npublic class BrowserTest {\n}\n',{delay:15});
    await sleep(400);
    // Ctrl+S 保存
    await page.keyboard.press('Control+S');
    await sleep(500);
    await shot('editor-typed-saved');
  });

  // StatusBar 验证
  await runTest('StatusBar','check-content',async()=>{
    const sbText=await page.evaluate(()=>{
      const bar=document.querySelector('#theia-statusBar,.theia-statusBar');
      return bar?(bar.textContent||'').trim():'';
    });
    log(`  statusBar: ${sbText.slice(0,120)}`);
    if(sbText.length<5)throw new Error('statusBar empty');
    await shot('statusbar-check');
  });

  // 搜索功能
  await runTest('Search','ctrl-shift-f',async()=>{
    await closeOverlays();
    await page.keyboard.press('Control+Shift+F');
    await sleep(800);
    await shot('search-panel');
    await page.keyboard.type('HelloServlet',{delay:20});
    await sleep(1200);
    await shot('search-results');
    await page.keyboard.press('Escape');
  });

  // SVN/Git 视图
  await runTest('SCM','svn-git-views',async()=>{
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=>e.getBoundingClientRect().width>0);
      const svn=els.find(e=>/SVN/i.test(e.getAttribute('title')||''));
      svn?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    });
    await sleep(1000);
    await shot('svn-view-browser');
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=>e.getBoundingClientRect().width>0);
      const scm=els.find(e=>/Source Control|Git/i.test(e.getAttribute('title')||''));
      scm?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    });
    await sleep(1000);
    await shot('git-view-browser');
  });

  // Debug 视图
  await runTest('Debug','open-debug-view',async()=>{
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=>e.getBoundingClientRect().width>0);
      const dbg=els.find(e=>/Debug/i.test(e.getAttribute('title')||''));
      dbg?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    });
    await sleep(1000);
    await shot('debug-view-browser');
  });

  // Server start + HTTP
  await runTest('Server','start-and-http',async()=>{
    const sr=await apiReq('POST','/api/v1/servers',{projectId,debug:false},wsId);
    const sid=sr.payload?.id;
    let httpPort=sr.payload?.httpPort||18081;
    for(let i=0;i<25;i++){
      await sleep(1000);
      try{
        const st=await apiReq('GET',`/api/v1/servers/${sid}`,undefined,wsId);
        if(st.payload?.observedState==='running'){httpPort=st.payload?.httpPort||httpPort;break;}
      }catch{}
    }
    // HTTP 触发
    const httpRes=await new Promise(resolve=>{
      http.get(`http://127.0.0.1:${httpPort}/hello`,res=>{
        let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,body:d}));
      }).on('error',e=>resolve({status:0,body:e.message}));
    });
    log(`  HTTP GET /hello => ${httpRes.status} len=${httpRes.body.length}`);
    if(httpRes.status!==200)throw new Error(`HTTP ${httpRes.status}`);
    await shot('server-running-browser');
    // Stop
    await apiReq('DELETE',`/api/v1/servers/${sid}`,undefined,wsId).catch(()=>{});
    await sleep(1500);
  });

  // 终端
  await runTest('Terminal','toggle',async()=>{
    await page.keyboard.press('Control+`');
    await sleep(1000);
    await shot('terminal-browser');
    await page.keyboard.press('Control+`');
    await sleep(400);
  });

  // 最终截图
  await shotFull('final-browser-full');

  // 汇总
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n${'='.repeat(60)}`);
  log(`浏览器版汇总: ${passed}/${results.length} 通过`);
  log(`Console Errors: ${consoleErrors.length}`);
  consoleErrors.slice(0,5).forEach(e=>log(`  [err] ${e.slice(0,100)}`));
  results.forEach(r=>log(` ${r.status==='pass'?'PASS':'FAIL'} [${r.phase}] ${r.name}${r.error?' : '+r.error.slice(0,80):''}`));

  const md=`# 浏览器版全量测试报告\n\n**时间**: ${new Date().toISOString()}\n**结果**: ${passed}/${results.length}\n**Console Errors**: ${consoleErrors.length}\n\n| # | 阶段 | 用例 | 状态 |\n|---|------|------|------|\n${results.map((r,i)=>`| ${i+1} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} |`).join('\n')}\n`;
  fs.writeFileSync(path.join(recordDir,'report.md'),md);
  fs.writeFileSync(path.join(recordDir,'results.json'),JSON.stringify({passed,failed,total:results.length,consoleErrors:consoleErrors.slice(0,10),results},null,2));

  // 清理
  browser.close().catch(()=>{});
  theiaProcess.kill();
  agentProcess.kill();
  process.exit(failed>0?1:0);
})().catch(e=>{
  console.error('FATAL:',e.message);
  if(theiaProcess)theiaProcess.kill();
  if(agentProcess)agentProcess.kill();
  process.exit(1);
});
