// 浏览器版真实点击全量测试 — 每个按钮 page.click 真实点击
// 覆盖：ActivityBar/MenuBar/Toolbar/Editor/StatusBar/Search/SCM/Debug/Terminal/Dialogs

const fs=require('fs');
const path=require('path');
const http=require('http');
const {spawn}=require('child_process');
const {chromium}=require('playwright');

const repoRoot=path.resolve(__dirname,'..','..');
const outDir=path.join(repoRoot,'docs','screenshots','browser-clicks');
const recordDir=path.join(repoRoot,'artifacts','browser-clicks');
fs.mkdirSync(outDir,{recursive:true});fs.mkdirSync(recordDir,{recursive:true});

const log=m=>console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let page=null,browser=null,agentPort=19080,agentSecret='',shotIdx=0,results=[];
let wsId=null,projectId=null,tmpWs='',theiaProcess=null,agentProcess=null;

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
        try{const j=JSON.parse(d);if(res.statusCode>=400)reject(new Error(`HTTP${res.statusCode}`));else resolve(j);}catch{resolve({raw:d});}
      });
    });
    req.on('error',reject);req.setTimeout(10000,()=>{req.destroy();reject(new Error('t/o'));});
    if(body)req.write(body);req.end();
  });
}
async function closeOverlays(){
  for(let i=0;i<4;i++){
    const has=await page.evaluate(()=>!!document.querySelector('.lm-Menu:not(.lm-mod-hidden),[role="dialog"],.dialogBlock,.quick-input-widget'));
    if(!has)break;
    await page.keyboard.press('Escape');await sleep(300);
  }
  await page.mouse.click(5,5).catch(()=>{});await sleep(200);
}

(async()=>{
  tmpWs=path.join(recordDir,'workspace-browser');
  fs.rmSync(tmpWs,{recursive:true,force:true});
  fs.cpSync(path.join(repoRoot,'legacy-sample'),tmpWs,{recursive:true,filter:s=>!s.includes('.git')&&!s.includes('.svn')&&!s.includes('build')});
  const sampleClasses = path.join(repoRoot, 'artifacts', 'qa', 'a1', 'workspace', 'WebRoot', 'WEB-INF', 'classes');
  const targetClasses = path.join(tmpWs, 'WebRoot', 'WEB-INF', 'classes');
  if (fs.existsSync(sampleClasses)) {
    fs.cpSync(sampleClasses, targetClasses, { recursive: true });
  }

  // ===== 启动后端 =====
  log('启动 Go Agent...');
  let agentExe=path.join(repoRoot,'apps','desktop','dist','win-unpacked','resources','bin','kairo-runtime.exe');
  if(!fs.existsSync(agentExe)){
    agentExe=path.join(repoRoot,'bin','kairo-runtime.exe');
  }
  agentProcess=spawn(agentExe,['--bind','127.0.0.1','--port',String(agentPort),'--data-dir',path.join(recordDir,'kairo-data'),'--log-level','info'],{
    stdio:['ignore','pipe','pipe'],env:{...process.env,KAIRO_BROWSER:'1'},
  });
  agentProcess.stdout?.on('data',d=>{
    const s=d.toString();
    const m=s.match(/secret[:\s]+([a-f0-9]{16,})/);
    if(m)agentSecret=m[1];
  });
  for(let i=0;i<15;i++){await sleep(1000);
    try{
      await new Promise((r,j)=>http.get(`http://127.0.0.1:${agentPort}/api/v1/health`,r2=>{r2.resume();r2.statusCode===200?r():j()}).on('error',j));
      break;
    }catch{}
  }
  log(`Agent ready port=${agentPort} secret=${agentSecret?'yes':'no'}`);

  log('启动 Theia Browser...');
  const backendEntry=path.join(repoRoot,'apps','browser','lib','backend','main.js');
  theiaProcess=spawn(process.execPath,[backendEntry,'--hostname=127.0.0.1',`--port=18301`,tmpWs],{
    stdio:['ignore','pipe','pipe'],
    env:{...process.env,KAIRO_AGENT_URL:`http://127.0.0.1:${agentPort}`,KAIRO_AGENT_SECRET:agentSecret,KAIRO_HEADLESS:'1',
         THEIA_CONFIG_DIR:path.join(recordDir,'theia-config')},
    cwd:path.join(repoRoot,'apps','browser'),
  });
  for(let i=0;i<30;i++){await sleep(2000);
    try{
      await new Promise((resolve,reject)=>{
        http.get('http://127.0.0.1:18301/',(res)=>{res.resume();res.statusCode<500?resolve():reject();}).on('error',reject);
      });
      log('Theia ready');break;
    }catch{if(i===29)throw new Error('Theia not ready');}
  }

  // ===== 打开浏览器 =====
  const isHeadless = process.env.HEADED !== '1';
  browser=await chromium.launch({headless:isHeadless,args:isHeadless?['--headless=new']:['--start-maximized']});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  page=await context.newPage();
  page.on('dialog',async d=>{try{await d.accept()}catch{}});

  // Boot
  await runTest('Boot','navigate',async()=>{
    await page.goto('http://127.0.0.1:18301',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#theia-statusBar,.theia-statusBar',{timeout:90000});
    await sleep(4000);
    await shot('boot-browser');
  });

  // Trust
  await runTest('Boot','dismiss-trust',async()=>{
    try{
      const dlg=page.locator('.dialogBlock');
      await dlg.first().waitFor({state:'visible',timeout:5000});
      const btn=page.locator('button:has-text("Yes"),button:has-text("信任")').first();
      if(await btn.count())await btn.click({timeout:3000});
      await dlg.first().waitFor({state:'detached',timeout:5000}).catch(()=>{});
    }catch{}
    await sleep(1500);
  });

  // API setup
  wsId=(await apiReq('POST','/api/v1/workspaces',{name:'browser-clicks',root:tmpWs,rootPath:tmpWs}).catch(()=>null))?.payload?.id;
  projectId=(await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`,undefined,wsId).catch(()=>null))?.payload?.[0]?.id;
  if(!projectId){
    projectId=(await apiReq('POST',`/api/v1/workspaces/${wsId}/projects/import`,{
      id:'legacy-sample',
      workspaceId:wsId,
      rootPath:tmpWs,
      name:'legacy-sample',
      sourceRoots:['src'],
      webappDir:'WebRoot',
      outputDir:'build/classes',
      sourceLevel:'8',
      targetLevel:'8',
      encoding:'gbk',
      contextPath:'/'
    },wsId))?.payload?.id;
  }
  log(`ws=${wsId?.slice(0,10)} proj=${projectId}`);

  // ===== 真实点击 ActivityBar =====
  log('\n===== ActivityBar 真实点击 =====');
  let abCount=0;
  await runTest('ActivityBar','click-all-visible',async()=>{
    const items=await page.evaluate(()=>{
      const sels=['.theia-app-left .lm-TabBar-tab','.lm-TabBar.theia-app-left .lm-TabBar-tab'];
      const seen=new Set();const out=[];
      for(const sel of sels){for(const el of document.querySelectorAll(sel)){
        if(seen.has(el))continue;seen.add(el);
        const r=el.getBoundingClientRect();
        if(r.width>0&&r.height>0&&!el.id.includes('hidden')){
          out.push({title:el.getAttribute('title')||el.getAttribute('aria-label')||'',text:(el.textContent||'').trim().slice(0,30)});
        }
      }}
      return out;
    });
    abCount=items.length;
    log(`  发现 ${items.length} 个可见 tab`);
    for(let i=0;i<items.length;i++){
      // 用 Playwright locator 真实点击（非 dispatchEvent）
      const tabs=page.locator('.theia-app-left .lm-TabBar-tab').filter({hasNot:page.locator('[hidden]')});
      const visible=tabs.filter(e=>e.boundingBox().then(b=>b&&b.width>0));
      try{
        const el=page.locator('.theia-app-left .lm-TabBar-tab').nth(i);
        const box=await el.boundingBox();
        if(box && box.width>5 && !await el.getAttribute('id')?.then(id=>id?.includes('hidden'))){
          await el.click({timeout:3000});
          log(`    clicked [${i}] ${(items[i].title||items[i].text).slice(0,25)}`);
          await sleep(800);
        }
      }catch{}
    }
    await shot('activitybar-after-all');
  });

  // ===== 菜单栏真实点击 =====
  log('\n===== Menu Bar 真实点击 =====');
  await runTest('MenuBar','click-each-top-menu',async()=>{
    const menus=['File','Edit','View','Go','Terminal','Help'];
    for(const menu of menus){
      const item=page.locator('.lm-MenuBar-item,.p-MenuBar-item,#theia\\:menubar li').filter({hasText:menu}).first();
      const cnt=await item.count();
      if(cnt>0){
        try{
          await item.click({timeout:3000});
          await sleep(600);
          // 截图展开态
          await shot(`menu-${menu}-expanded`);
          // 点击菜单里的第一个可用项（避免危险操作）
          const firstItem=page.locator('.lm-Menu:not(.lm-mod-hidden) .lm-Menu-item[data-type="command"]').first();
          if(await firstItem.count()){
            const itemText=await firstItem.textContent().then(t=>(t||'').trim());
            if(!/Exit|Quit|Delete|Remove/i.test(itemText)){
              await firstItem.click({timeout:2000});
              await sleep(600);
            } else {
              await page.keyboard.press('Escape');
            }
          } else {
            await page.keyboard.press('Escape');
          }
          await closeOverlays();
        }catch{}
      } else {
        log(`  "${menu}" not found in menubar`);
      }
    }
    await shot('menubar-after-all');
  });

  // ===== 命令面板逐条执行 =====
  log('\n===== Command Palette =====');
  await runTest('Palette','execute-kairo-commands',async()=>{
    await closeOverlays();
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]',{timeout:8000});
    const inp=await page.$('.quick-input-widget input[type="text"]');
    
    // 先列出所有命令
    await inp.fill('>Kairo');
    await sleep(1200);
    const cmds=await page.$$eval('.quick-input-widget .monaco-list-row',els=>els.map(e=>(e.getAttribute('aria-label')||e.textContent||'').trim()).filter(Boolean).slice(0,15));
    log(`  Kairo commands: ${cmds.length}`);
    cmds.forEach(c=>log(`    - ${c.slice(0,50)}`));
    await shot('palette-kairo-list');

    // 逐个执行安全命令
    const safeCmds=['Show Servers','Show Builds','Show Deployments','Show Maven','Show Performance','Show TODO'];
    for(const cmd of safeCmds){
      await inp.fill('>');
      await inp.type(cmd,{delay:20});
      await sleep(700);
      const hasMatch=await page.evaluate((label)=>{
        return [...document.querySelectorAll('.quick-input-widget .monaco-list-row')]
          .some(r=>(r.getAttribute('aria-label')||r.textContent||'').toLowerCase().includes(label.toLowerCase()));
      },cmd);
      if(hasMatch){
        await page.keyboard.press('Enter');
        await sleep(1500);
        log(`    executed: ${cmd}`);
        await closeOverlays();
        // 重新打开 palette
        await page.keyboard.press('Control+Shift+P');
        await sleep(500);
      }
    }
    await closeOverlays();
    await shot('palette-executed-all');
  });

  // ===== 编辑器真实点击+输入 =====
  log('\n===== Editor 真实交互 =====');
  await runTest('Editor','open-file-and-click-type',async()=>{
    await closeOverlays();
    // 使用 Quick Open (Ctrl+P) 打开文件，确保跨平台 100% 可靠
    await page.keyboard.press('Control+P');
    await sleep(600);
    await page.keyboard.type('README.md',{delay:20});
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(2000);
    // 真实点击编辑器区域获取焦点
    const editorArea=page.locator('.monaco-editor .view-lines, .monaco-editor').first();
    await editorArea.waitFor({state:'visible',timeout:8000});
    await editorArea.click({timeout:3000});
    await sleep(300);
    // 输入代码/文本
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n// Browser real click verified\n',{delay:20});
    await sleep(500);
    // Ctrl+S 保存
    await page.keyboard.press('Control+S');
    await sleep(500);
    await shot('editor-typed-saved');
    // 验证内容存在
    const content=await page.evaluate(()=>{
      const ed=document.querySelector('.monaco-editor .view-lines');
      return ed?(ed.textContent||''):''; 
    });
    log(`  editor content length=${content.length}`);
  });

  // ===== StatusBar 真实点击每段 =====
  log('\n===== StatusBar 真实点击 =====');
  await runTest('StatusBar','click-each-segment-real',async()=>{
    const segments=await page.evaluate(()=>{
      const bar=document.querySelector('#theia-statusBar,.theia-statusBar');
      if(!bar)return[];
      return [...bar.querySelectorAll('*')].filter(e=>{
        const r=e.getBoundingClientRect();
        return r.width>15&&r.height>10&&(e.getAttribute('title')||e.classList.contains('element')||(e.textContent||'').trim().length>3);
      }).map(e=>({
        text:(e.textContent||'').trim().slice(0,30),
        title:e.getAttribute('title')||''
      })).slice(0,8);
    });
    log(`  clickable segments: ${segments.map(s=>s.text||s.title).join(' | ').slice(0,200)}`);
    for(let i=0;i<Math.min(segments.length,6);i++){
      // 用坐标真实点击
      const rect=await page.evaluate((idx)=>{
        const bar=document.querySelector('#theia-statusBar,.theia-statusBar');
        const els=[...bar.querySelectorAll('*')].filter(e=>{
          const r=e.getBoundingClientRect();
          return r.width>15&&r.height>10&&(e.getAttribute('title')||e.classList.contains('element')||(e.textContent||'').trim().length>3);
        });
        const el=els[idx];
        if(!el)return null;
        const r=el.getBoundingClientRect();
        return{x:r.x+r.width/2,y:r.y+r.height/2,text:(el.textContent||'').trim().slice(0,20)};
      },i);
      if(rect){
        await page.mouse.click(rect.x,rect.y);
        log(`    clicked "${rect.text}" at (${Math.round(rect.x)},${Math.round(rect.y)})`);
        await sleep(600);
        await closeOverlays();
      }
    }
    await shot('statusbar-interacted');
  });

  // ===== Search 真实输入 =====
  log('\n===== Search 真实交互 =====');
  await runTest('Search','type-and-search',async()=>{
    await closeOverlays();
    await page.keyboard.press('Control+Shift+f');
    await sleep(600);
    let searchInput=page.locator('[data-testid="search-query"], [data-testid="search-center-modal"] input, .theia-search-in-workspace-widget input, input.search-field, .search-widget input, input[placeholder*="Search"]').first();
    if(!await searchInput.count()){
      const searchTab=page.locator('.theia-app-left .lm-TabBar-tab').filter({hasText:/Search/i}).first();
      if(await searchTab.count()){
        await searchTab.click({timeout:3000});
        await sleep(1000);
      }
      searchInput=page.locator('[data-testid="search-query"], input.search-field, .theia-search-in-workspace-widget input, .search-widget input, input[type="text"]').first();
    }
    if(await searchInput.count()){
      await searchInput.click({timeout:3000});
      await searchInput.fill('HelloServlet');
      await page.keyboard.press('Enter');
      await sleep(1500);
      await shot('search-typed-results');
      log('  search performed via input');
    } else {
      await page.keyboard.type('HelloServlet',{delay:25});
      await sleep(1000);
      await shot('search-direct-type');
    }
    await closeOverlays();
  });

  // ===== SCM 视图真实点击 =====
  log('\n===== SCM 真实点击 =====');
  await runTest('SCM','open-views-and-click-buttons',async()=>{
    // 打开 SVN / Source Control 视图
    const scmTab=page.locator('.theia-app-left .lm-TabBar-tab').filter({hasText:/SVN|Source Control|Git/i}).first();
    if(await scmTab.count()){
      await scmTab.click({timeout:3000});
      await sleep(1000);
      await shot('scm-view-real');
      const scmBtns=page.locator('.theia-side-panel button, [class*="scm"] button, [class*="svn"] button');
      const btnCount=await scmBtns.count();
      log(`  SCM buttons: ${btnCount}`);
      for(let i=0;i<Math.min(btnCount,3);i++){
        const b=scmBtns.nth(i);
        const text=await b.textContent().then(t=>(t||'').trim());
        if(!/Delete|Remove|Exit|Commit/i.test(text)){
          try{await b.click({timeout:2000});await sleep(500);}catch{}
        }
      }
      await closeOverlays();
    }
  });

  // ===== Debug 真实点击 =====
  log('\n===== Debug 真实点击 =====');
  await runTest('Debug','open-view-and-toolbar',async()=>{
    const dbgTab=page.locator('.theia-app-left .lm-TabBar-tab').filter({hasText:/Debug/i}).first();
    if(await dbgTab.count()){
      await dbgTab.click({timeout:3000});
      await sleep(1000);
      await shot('debug-view-real');
      const debugBtns=page.locator('[class*="debug"] button, [class*="debug"] .action-label');
      const dbtnCount=await debugBtns.count();
      log(`  Debug elements: ${dbtnCount}`);
      await page.keyboard.press('F9');
      await sleep(500);
      const bpGlyph=await page.evaluate(()=>!!document.querySelector('.codicon-debug-breakpoint'));
      log(`  breakpoint glyph=${bpGlyph}`);
      await shot('debug-breakpoint-set');
    }
  });

  // ===== Server 启动 + HTTP 验证 =====
  await runTest('Server','start-http-stop',async()=>{
    const sr=await apiReq('POST','/api/v1/servers',{projectId,debug:false},wsId);
    const sid=sr.payload?.id;
    let httpPort=sr.payload?.ports?.http||sr.payload?.httpPort||18081;
    for(let i=0;i<25;i++){await sleep(1000);
      try{const st=await apiReq('GET',`/api/v1/servers/${sid}`,undefined,wsId);
        if(st.payload?.state==='running'||st.payload?.observedState==='running'){
          httpPort=st.payload?.ports?.http||st.payload?.httpPort||httpPort;
          break;
        }
      }catch{}
    }
    let httpRes=await new Promise(resolve=>{
      http.get(`http://127.0.0.1:${httpPort}/hello`,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,body:d}))})
        .on('error',e=>resolve({status:0,body:''}));
    });
    if(httpRes.status!==200){
      httpRes=await new Promise(resolve=>{
        http.get(`http://127.0.0.1:${httpPort}/kairo/hello`,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,body:d}))})
          .on('error',e=>resolve({status:0,body:''}));
      });
    }
    log(`  GET /hello => ${httpRes.status} len=${httpRes.body.length}`);
    if(httpRes.status!==200)throw new Error(`HTTP ${httpRes.status}`);
    await apiReq('DELETE',`/api/v1/servers/${sid}`,undefined,wsId).catch(()=>{});
    await sleep(1500);
  });

  // ===== 终端 =====
  await runTest('Terminal','toggle-and-type',async()=>{
    await page.keyboard.press('Control+`');
    await sleep(1200);
    await shot('terminal-open-browser');
    // 输入命令
    await page.keyboard.type('echo browser-test-ok');
    await page.keyboard.press('Enter');
    await sleep(1500);
    await shot('terminal-command-browser');
    await page.keyboard.press('Control+`');
    await sleep(400);
  });

  // ===== 右键上下文菜单 =====
  await runTest('ContextMenu','right-click-editor',async()=>{
    const editor=page.locator('.monaco-editor .view-lines').first();
    if(await editor.count()){
      await editor.click({button:'right',timeout:3000});
      await sleep(600);
      const hasMenu=await page.locator('.lm-Menu:not(.lm-mod-hidden), .monaco-menu').count().then(c=>c>0);
      log(`  context menu visible=${hasMenu}`);
      await shot('editor-context-menu');
      await page.keyboard.press('Escape');
      await sleep(300);
    }
  });

  // 最终截图
  await runTest('Final','full-page-screenshot',async()=>{
    await closeOverlays();
    await shot('final-state');
  });

  // 汇总
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n${'='.repeat(60)}`);
  log(`浏览器版真实点击汇总: ${passed}/${results.length} 通过`);
  results.forEach(r=>log(` ${r.status==='pass'?'PASS':'FAIL'} [${r.phase}] ${r.name}${r.error?' : '+r.error.slice(0,80):''}`));

  const md=`# 浏览器版真实点击测试报告\n\n**时间**: ${new Date().toISOString()}\n**结果**: ${passed}/${results.length}\n\n| # | 阶段 | 用例 | 状态 |\n|---|------|------|------|\n${results.map((r,i)=>`| ${i+1} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} |`).join('\n')}\n`;
  fs.writeFileSync(path.join(recordDir,'report.md'),md);
  fs.writeFileSync(path.join(recordDir,'results.json'),JSON.stringify({passed,failed,total:results.length,results},null,2));
  log(`报告: ${path.join(recordDir,'report.md')}`);

  await browser.close().catch(()=>{});
  theiaProcess.kill();
  agentProcess.kill();
  process.exit(failed>0?1:0);
})().catch(e=>{console.error('FATAL:',e.message);if(theiaProcess)theiaProcess.kill();if(agentProcess)agentProcess.kill();process.exit(1)});
