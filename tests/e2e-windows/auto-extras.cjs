// 补充深测 — 未覆盖的真实交互场景
// 1.Welcome页按钮 2.设置页搜索+主题切换+语言切换 3.Explorer右键菜单 4.Editor Tab操作
// 5.通知系统 6.快捷键面板 7.书签功能 8.TODO视图跳转 9.状态栏交互 10.编码指示器
// 11.热重载横幅 12.性能仪表盘 13.菜单键盘导航 14.大文件策略

const fs=require('fs');
const path=require('path');
const http=require('http');
const {_electron:electron}=require('playwright');

const repoRoot=path.resolve(__dirname,'..','..');
const outDir=path.join(repoRoot,'docs','screenshots','windows-extras');
const recordDir=path.join(repoRoot,'artifacts','windows-extras');
fs.mkdirSync(outDir,{recursive:true});fs.mkdirSync(recordDir,{recursive:true});

const log=m=>console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let app,page,agentPort=0,agentSecret='',shotIdx=0,results=[];
let wsId=null,projectId=null,tmpWs='';

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
async function openPalette(){
  await page.keyboard.press('Escape');await sleep(200);
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-widget input[type="text"]',{timeout:6000});
  const inp=await page.$('.quick-input-widget input[type="text"]');
  return inp;
}

(async()=>{
  tmpWs=path.join(recordDir,'workspace-extras');
  fs.rmSync(tmpWs,{recursive:true,force:true});
  fs.cpSync(path.join(repoRoot,'legacy-sample'),tmpWs,{recursive:true,filter:s=>!s.includes('.git')&&!s.includes('build')&&!s.includes('.svn')});

  const devMain=path.join(repoRoot,'apps','desktop','lib','main.js');
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});

  let launchExe,launchArgs;
  if(fs.existsSync(devMain)){
    const electronBin=require(path.join(repoRoot,'apps','desktop','node_modules','electron'));
    launchExe=electronBin;launchArgs=[devMain,`--user-data-dir=${userDataDir}`,tmpWs];
  } else {
    launchExe=path.join(repoRoot,'apps','desktop','dist','win-unpacked','Kairo.exe');
    launchArgs=[`--user-data-dir=${userDataDir}`,tmpWs];
  }

  log(`workspace=${tmpWs}`);
  app=await electron.launch({executablePath:launchExe,args:launchArgs,env:{...process.env,KAIRO_DEV:'1',KAIRO_NO_DEVTOOLS:'1'},timeout:60000});
  page=await app.firstWindow({timeout:30000});
  page.on('dialog',async d=>{try{await d.accept()}catch{}});
  await page.waitForSelector('#theia-statusBar',{timeout:90000});
  await sleep(3000);

  // 获取 agent
  const statePath=path.join(userDataDir,'kairo-data','agent-state.json');
  for(let i=0;i<20;i++){if(fs.existsSync(statePath)){try{const s=JSON.parse(fs.readFileSync(statePath,'utf8'));if(s.port){agentPort=s.port;break;}}catch{}}await sleep(500);}
  try{agentSecret=await app.evaluate(()=>process.env.KAIRO_AGENT_SECRET||process.env.KAIRO_LOCAL_SECRET||'');}catch{}
  log(`agent=${agentPort}`);

  wsId=(await apiReq('POST','/api/v1/workspaces',{name:'extras',root:tmpWs,rootPath:tmpWs}).catch(()=>({payload:null})))?.payload?.id;
  projectId=(await apiReq('GET',`/api/v1/projects?workspaceId=${wsId}`,undefined,wsId).catch(()=>({payload:null})))?.payload?.[0]?.id;
  log(`ws=${wsId} proj=${projectId}`);

  // ===== 1. Welcome 页 =====
  log('\n===== 1. Welcome 页 =====');
  await runTest('Welcome','open-and-click-buttons',async()=>{
    await openPalette();
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>Kairo: Welcome');
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(2000);
    await shot('welcome-page');
    // 点击所有可见按钮（非危险的）
    const btns=await page.evaluate(()=>{
      return [...document.querySelectorAll('button, .theia-button, .kairo-button')].filter(b=>{
        const r=b.getBoundingClientRect();
        return r.width>20&&r.height>10&&b.offsetParent!==null;
      }).map(b=>({text:(b.textContent||'').trim().slice(0,30),title:b.getAttribute('title')||''}));
    });
    log(`  welcome buttons: ${btns.map(b=>b.text).join(', ').slice(0,150)}`);
    for(const b of btns.slice(0,3)){
      if(/Delete|Exit|Close/i.test(b.text+b.title))continue;
      const clicked=await page.evaluate((t)=>{
        const btn=[...document.querySelectorAll('button, .theia-button, .kairo-button')]
          .find(x=>(x.textContent||'').trim().includes(t));
        if(btn){btn.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;}
        return false;
      },b.text);
      if(clicked){await sleep(800);await closeOverlays();}
    }
    await shot('welcome-after-clicks');
  });

  // ===== 2. 设置页 =====
  log('\n===== 2. Preferences =====');
  await runTest('Prefs','search-settings',async()=>{
    await page.keyboard.press('Control+,');
    await sleep(1500);
    await shot('preferences-open');
    // 搜索设置
    const searchInput=page.locator('.settings-tree-editor input, input[placeholder*="settings"], input[placeholder*="Settings"]');
    if(await searchInput.count()){
      await searchInput.first().click({timeout:2000});
      await page.keyboard.type('theme',{delay:25});
      await sleep(1000);
      await shot('prefs-search-theme');
    }
    await page.keyboard.press('Escape');
  });
  await runTest('Prefs','switch-theme-via-palette',async()=>{
    await openPalette();
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>Color Theme');
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(1000);
    // 选择一个不同的主题
    const themes=await page.$$eval('.quick-input-widget .monaco-list-row',els=>els.map(e=>(e.textContent||'').trim()).slice(0,5));
    log(`  themes: ${themes.join(' | ').slice(0,150)}`);
    if(themes.length>1){
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await sleep(1500);
    } else {
      await page.keyboard.press('Escape');
    }
    await shot('theme-switched');
  });

  // ===== 3. Explorer 右键菜单 =====
  log('\n===== 3. Explorer 右键 =====');
  await runTest('Explorer','context-menu',async()=>{
    // 打开 Explorer
    await page.evaluate(()=>{
      const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=>e.getBoundingClientRect().width>0);
      const ex=els.find(e=>/Explorer/i.test(e.getAttribute('title')||''));
      ex?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    });
    await sleep(800);
    // 右键点击 Explorer 区域
    const treeArea=page.locator('.theia-side-panel .tree, [class*="explorer"], .theia-TreeContainer');
    if(await treeArea.count()){
      await treeArea.first().click({button:'right',timeout:3000}).catch(()=>{});
      await sleep(600);
      const menuItems=await page.evaluate(()=>{
        const menu=document.querySelector('.lm-Menu:not(.lm-mod-hidden), .p-Menu');
        if(!menu)return[];
        return [...menu.querySelectorAll('.lm-Menu-item, .p-Menu-item')].map(e=>(e.textContent||'').trim()).filter(Boolean).slice(0,10);
      });
      log(`  context menu items: ${menuItems.join(', ').slice(0,150)}`);
      await shot('explorer-context-menu');
      await page.keyboard.press('Escape');
      await sleep(300);
    } else {log('  explorer tree not found');}
  });

  // ===== 4. Editor Tab 操作 =====
  log('\n===== 4. Editor Tab =====');
  await runTest('EditorTab','create-multiple-close',async()=>{
    // 创建3个文件
    for(let i=0;i<3;i++){
      await page.keyboard.press('Control+N');await sleep(500);
      await page.evaluate(()=>{const ta=document.querySelector('.monaco-editor textarea.inputarea');if(ta)ta.focus();});
      await page.keyboard.type(`// file ${i}\n`,{delay:15});
      await sleep(300);
    }
    // 检查 tab 数量
    const tabsBefore=await page.evaluate(()=>{
      return document.querySelectorAll('.lm-TabBar-tab[data-id], .p-TabBar-tab[id]').length;
    });
    log(`  tabs before close: ${tabsBefore}`);
    // 关闭当前 tab (Ctrl+F4 或 Ctrl+W)
    await page.keyboard.press('Control+F4');
    await sleep(500);
    const tabsAfter=await page.evaluate(()=>{
      return document.querySelectorAll('.lm-TabBar-tab[data-id], .p-TabBar-tab[id]').length;
    });
    log(`  tabs after close: ${tabsAfter}`);
    await shot('editor-tabs');
    // 关闭所有
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+W');
    await sleep(500);
  });

  // ===== 5. 通知系统 =====
  log('\n===== 5. Notifications =====');
  await runTest('Notifications','trigger-and-dismiss',async()=>{
    // 触发一个通知（通过不存在的命令）
    await openPalette();
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>Nonexistent Command XYZ');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1000);
    // 检查通知区域
    const notifs=await page.evaluate(()=>{
      return [...document.querySelectorAll('.theia-notification, [class*="notification"]')].map(n=>(n.textContent||'').trim().slice(0,50)).filter(Boolean);
    });
    log(`  notifications visible: ${notifs.length}`);
    if(notifs.length>0)log(`  content: ${notifs.join(' | ').slice(0,150)}`);
    // 关闭通知
    const closeBtn=page.locator('.theia-notification button[class*="close"], [class*="notification"] button[title*="Clear"], [class*="notification"] button[title*="Dismiss"]');
    if(await closeBtn.count()){
      await closeBtn.first().click({timeout:2000}).catch(()=>{});
      await sleep(400);
    }
    await closeOverlays();
    await shot('notifications');
  });

  // ===== 6. 快捷键面板 =====
  log('\n===== 6. Keyboard Shortcuts =====');
  await runTest('Shortcuts','open-keymap-widget',async()=>{
    await openPalette();
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>Keyboard Shortcuts');
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(2000);
    await shot('keymap-widget');
    // 检查快捷键表格是否有内容
    const rows=await page.evaluate(()=>{
      const widget=document.querySelector('[class*="shortcut"], [class*="keymap"]');
      return widget?widget.querySelectorAll('tr, .row, li').length:0;
    });
    log(`  shortcut rows: ${rows}`);
    await page.keyboard.press('Escape');
    await sleep(300);
  });

  // ===== 7. 书签功能 =====
  log('\n===== 7. Bookmarks =====');
  await runTest('Bookmarks','toggle-bookmark',async()=>{
    // 先确保有编辑器
    await page.keyboard.press('Control+N');await sleep(800);
    await page.evaluate(()=>{const ta=document.querySelector('.monaco-editor textarea.inputarea');if(ta)ta.focus();});
    await page.keyboard.type('// bookmark test',{delay:15});
    await sleep(300);
    // 通过命令切换书签
    await openPalette();
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>bookmark');
    await sleep(500);
    const rows=await page.$$eval('.quick-input-widget .monaco-list-row',els=>els.length);
    log(`  bookmark commands found: ${rows}`);
    if(rows>0){await page.keyboard.press('Enter');await sleep(800);}
    else await page.keyboard.press('Escape');
    await shot('bookmark-toggled');
  });

  // ===== 8. TODO/FIXME 视图 =====
  log('\n===== 8. TODO View =====');
  await runTest('TODO','view-and-count',async()=>{
    // 在文件里写 TODO
    await page.keyboard.press('Control+N');await sleep(600);
    await page.evaluate(()=>{const ta=document.querySelector('.monaco-editor textarea.inputarea');if(ta)ta.focus();});
    await page.keyboard.type('// TODO: fix this later\n// FIXME: urgent issue\n// normal code\n',{delay:15});
    await sleep(300);
    // 打开 TODO 视图
    await openPalette();
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>Show TODO');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1500);
    await shot('todo-view');
    // 检查 TODO 视图内容
    const todoText=await page.evaluate(()=>{
      const panel=document.querySelector('[class*="todo"], [id*="todo"]');
      return panel?(panel.textContent||'').slice(0,150):'';
    });
    log(`  todo view: ${todoText.slice(0,80)}`);
  });

  // ===== 9. 状态栏交互 =====
  log('\n===== 9. StatusBar 交互 =====');
  await runTest('StatusBar','click-each-segment',async()=>{
    const segments=await page.evaluate(()=>{
      const bar=document.querySelector('#theia-statusBar');
      if(!bar)return[];
      return [...bar.querySelectorAll('*')].filter(e=>{
        const r=e.getBoundingClientRect();
        return r.width>15&&r.height>10&&(e.getAttribute('title')||e.classList.contains('element'));
      }).map(e=>({
        text:(e.textContent||'').trim().slice(0,30),
        title:e.getAttribute('title')||''
      })).slice(0,8);
    });
    log(`  clickable segments: ${segments.map(s=>s.text||s.title).join(' | ').slice(0,200)}`);
    for(let i=0;i<Math.min(segments.length,4);i++){
      await page.evaluate((idx)=>{
        const bar=document.querySelector('#theia-statusBar');
        const els=[...bar.querySelectorAll('*')].filter(e=>{
          const r=e.getBoundingClientRect();
          return r.width>15&&(e.getAttribute('title')||e.classList.contains('element'));
        });
        els[idx]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      },i);
      await sleep(600);
      await closeOverlays();
    }
    await shot('statusbar-interacted');
  });

  // ===== 10. 编码指示器点击 =====
  log('\n===== 10. Encoding Indicator =====');
  await runTest('EncodingIndicator','click-to-reopen',async()=>{
    // 找到编码指示器并点击
    const encClicked=await page.evaluate(()=>{
      const bar=document.querySelector('#theia-statusBar');
      if(!bar)return false;
      const enc=[...bar.querySelectorAll('*')].find(e=>/encoding|GBK|UTF|utf/i.test(e.textContent||''));
      if(enc){
        enc.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        return true;
      }
      return false;
    });
    log(`  encoding element clicked=${encClicked}`);
    if(encClicked){
      await sleep(800);
      // 检查是否弹出了对话框或菜单
      const dlg=await page.locator('[role="dialog"], .dialogBlock, .lm-Menu:not(.lm-mod-hidden)').count().then(c=>c>0);
      log(`  dialog/menu appeared=${dlg}`);
      await shot('encoding-indicator-dialog');
      await page.keyboard.press('Escape');
      await sleep(300);
    }
  });

  // ===== 11. 热重载横幅 =====
  log('\n===== 11. Hot Reload Banner =====');
  await runTest('HotReload','check-banner',async()=>{
    // 打开 Servers 视图查看热重载横幅
    await openPalette();
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>Show Servers');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1500);
    const banner=await page.evaluate(()=>{
      const b=document.querySelector('.kairo-hot-reload-banner, [class*="hot-reload"], [class*="hotReload"]');
      if(!b)return null;
      const s=getComputedStyle(b);
      return {text:(b.textContent||'').trim().slice(0,80),bg:s.backgroundColor,visible:b.offsetParent!==null};
    });
    log(`  banner: ${banner?JSON.stringify(banner):'not found'}`);
    await shot('hot-reload-banner');
  });

  // ===== 12. 性能仪表盘 =====
  log('\n===== 12. Performance Dashboard =====');
  await runTest('PerfDashboard','open-and-check',async()=>{
    await openPalette();
    const inp=await page.$('.quick-input-widget input[type="text"]');
    await inp.fill('>Show Performance');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(2000);
    await shot('perf-dashboard');
    // 检查性能数据
    const perfText=await page.evaluate(()=>{
      const panel=document.querySelector('[class*="perf"], [id*="perf"]');
      return panel?(panel.textContent||'').slice(0,200):'';
    });
    log(`  perf data: ${perfText.slice(0,100)}`);
    // 点击 benchmark 按钮
    const benchBtn=page.locator('button:has-text("Benchmark"), button:has-text("benchmark"), button:has-text("Run")');
    if(await benchBtn.count()){
      await benchBtn.first().click({timeout:2000}).catch(()=>{});
      await sleep(1000);
      await shot('perf-benchmark-running');
    }
  });

  // ===== 13. 菜单键盘导航 =====
  log('\n===== 13. Menu Navigation =====');
  await runTest('MenuNav','alt-key-navigation',async()=>{
    // Alt+F 打开 File 菜单
    await page.keyboard.press('Alt+f');
    await sleep(500);
    const menuVisible=await page.evaluate(()=>!!document.querySelector('.lm-Menu:not(.lm-mod-hidden), .p-Menu'));
    log(`  Alt+F menu visible=${menuVisible}`);
    if(menuVisible){
      await shot('file-menu-open');
      await page.keyboard.press('Escape');
      await sleep(300);
    }
    // Alt+E 打开 Edit
    await page.keyboard.press('Alt+e');
    await sleep(500);
    await page.keyboard.press('Escape');
    await sleep(200);
  });

  // ===== 14. 大文件策略 =====
  log('\n===== 14. Large File Policy =====');
  await runTest('LargeFile','create-large-file',async()=>{
    // 创建一个大文件 (>1MB)
    const bigFile=path.join(tmpWs,'large-test.txt');
    const chunk='Line of text for large file testing.\n'.repeat(30000);
    fs.writeFileSync(bigFile,chunk);
    log(`  file size: ${(fs.statSync(bigFile).size/1024/1024).toFixed(1)}MB`);
    // 尝试打开它
    await page.keyboard.press('Control+P');
    await sleep(500);
    const inp=await page.$('.quick-input-widget input[type="text"]');
    if(inp){
      await inp.fill('');
      await inp.type('large-test',{delay:15});
      await sleep(800);
      await page.keyboard.press('Enter');
      await sleep(2000);
    }
    await shot('large-file-open');
    // 清理
    fs.unlinkSync(bigFile);
  });

  // ===== 汇总 =====
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n${'='.repeat(60)}`);
  log(`补充深测汇总: ${passed}/${results.length} 通过, ${failed} 失败`);
  results.forEach(r=>log(` ${r.status==='pass'?'PASS':'FAIL'} [${r.phase}] ${r.name}${r.error?' : '+r.error.slice(0,80):''}`));

  const md=`# 补充深测报告\n\n**时间**: ${new Date().toISOString()}\n**结果**: ${passed}/${results.length}\n\n| # | 阶段 | 用例 | 状态 |\n|---|------|------|------|\n${results.map((r,i)=>`| ${i+1} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} |`).join('\n')}\n`;
  fs.writeFileSync(path.join(recordDir,'report.md'),md);
  fs.writeFileSync(path.join(recordDir,'results.json'),JSON.stringify({passed,failed,total:results.length,results},null,2));

  await app.close().catch(()=>{});
  process.exit(failed>0?1:0);
})().catch(e=>{console.error('FATAL:',e.stack?.split('\n')[0]||e.message);process.exit(1)});
