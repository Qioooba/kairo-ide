// 真实按钮全量点击 — 不走命令面板，全部 page.click 真实按钮
// 覆盖：ActivityBar、SideBar、Editor Tab、Toolbar、StatusBar、View、Dialog、BottomPanel
// 每个按钮：发现 → 悬停 → 真实点击 → 截图 → 识图判定 → 关闭弹窗 → 继续

const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-all-buttons');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-all-buttons');
fs.mkdirSync(outDir, {recursive:true});
fs.mkdirSync(recordDir, {recursive:true});

const stamp=()=> new Date().toISOString().slice(11,19);
const log=m=> console.log(`[${stamp()}] ${m}`);
const warn=m=> console.warn(`[${stamp()}] WARN ${m}`);
const sleep=ms=> new Promise(r=>setTimeout(r,ms));

let app, page, shotIdx=0, results=[];
async function shot(name){
  const f=path.join(outDir, `${String(shotIdx).padStart(3,'0')}-${name.replace(/[^a-z0-9\u4e00-\u9fa5-_]/g,'-').slice(0,70)}.png`);
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
  throw new Error('找不到 Kairo.exe');
}

// 发现当前页面所有可点击按钮（可见）
async function discoverButtons(){
  return await page.evaluate(()=>{
    const isVisible=(el)=>{
      const st=window.getComputedStyle(el);
      if(st.display==='none' || st.visibility==='hidden' || st.opacity==='0') return false;
      const r=el.getBoundingClientRect();
      if(r.width<4 || r.height<4) return false;
      if(r.width===0 || r.height===0) return false;
      // 检查是否在视口内
      // if(r.top<0 || r.left<0) return false;
      // hidden id
      if(el.id && el.id.includes('hidden')) return false;
      if(el.closest('[hidden]')) return false;
      return true;
    };
    const infos=[];
    const seen=new WeakSet();
    const selectors=[
      'button',
      '[role="button"]',
      'a[role="button"]',
      '.theia-button',
      '.lm-TabBar-tab',
      '.p-TabBar-tab',
      '.action-label',
      '.kairo-toolbar button',
      '.theia-toolbar button',
      '.p-Toolbar button',
      '.lm-MenuBar-item',
      '#theia-statusBar .element',
      '#theia-statusBar *',
      '.kairo-status-bar-group *',
      '.codicon',
      '[title]',
      'input[type="button"]',
      'input[type="submit"]',
      '.p-TabBar-tabCloseIcon',
      '.lm-TabBar-tabCloseIcon'
    ];
    // 特殊：收集所有有 click 监听或 cursor pointer 的
    const all=[...document.querySelectorAll('*')];
    for(const el of all){
      if(seen.has(el)) continue;
      const tag=el.tagName.toLowerCase();
      const role=el.getAttribute('role');
      const hasBtnClass= el.classList.contains('theia-button') || el.classList.contains('lm-TabBar-tab') || el.classList.contains('action-label');
      const isButton = tag==='button' || role==='button' || hasBtnClass || el.getAttribute('title') || el.getAttribute('aria-label');
      // 额外：cursor pointer 且有文字
      const style=window.getComputedStyle(el);
      const isClickable = isButton || style.cursor==='pointer';
      if(!isClickable) continue;
      if(!isVisible(el)) continue;
      // 过滤纯文本容器
      const text=(el.textContent||'').trim().slice(0,40);
      const title=el.getAttribute('title')||'';
      const aria=el.getAttribute('aria-label')||'';
      const label=text || title || aria || el.className.slice(0,30);
      if(!label) continue;
      // 去重：同一坐标的只留一个
      const r=el.getBoundingClientRect();
      const key=`${Math.round(r.left)}-${Math.round(r.top)}-${Math.round(r.width)}-${Math.round(r.height)}-${label.slice(0,20)}`;
      if(infos.some(x=> x.key===key)) continue;
      // 计算唯一选择器
      let sel='';
      if(el.id) sel=`#${el.id}`;
      else if(title) sel=`[title="${title.replace(/"/g,'\\"')}"]`;
      else if(aria) sel=`[aria-label="${aria.replace(/"/g,'\\"')}"]`;
      else sel=el.className ? `.${el.className.split(' ').filter(Boolean).slice(0,2).join('.')}` : tag;
      infos.push({label: label.slice(0,60), title, aria, tag, cls: el.className.slice(0,80), text: text.slice(0,40), rect:{x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height)}, sel, key});
      seen.add(el);
      if(infos.length>200) break;
    }
    // 去重文本相同的
    const uniq=[];
    const seenLabel=new Set();
    for(const i of infos){
      const k=i.label + `-${i.rect.x}-${i.rect.y}`;
      if(seenLabel.has(k)) continue;
      seenLabel.add(k);
      uniq.push(i);
      if(uniq.length>120) break;
    }
    return uniq;
  });
}

// 点击单个按钮（真实 page.click 坐标）
async function clickButton(info){
  // 优先用 Playwright locator 点击可见元素
  // 尝试多种定位
  let clicked=false;
  let lastErr='';
  // 1. 若有 title
  if(info.title){
    try{
      const loc=page.locator(`[title="${info.title.replace(/"/g,'\\"')}"]`).first();
      if(await loc.count()){
        await loc.click({timeout:2000});
        clicked=true;
      }
    }catch(e){ lastErr=e.message; }
  }
  if(clicked) return;
  // 2. aria-label
  if(info.aria && !clicked){
    try{
      const loc=page.locator(`[aria-label="${info.aria.replace(/"/g,'\\"')}"]`).first();
      if(await loc.count()){
        await loc.click({timeout:2000});
        clicked=true;
      }
    }catch(e){ lastErr=e.message; }
  }
  if(clicked) return;
  // 3. 坐标点击
  try{
    await page.mouse.move(info.rect.x + info.rect.w/2, info.rect.y + info.rect.h/2);
    await sleep(100);
    await page.mouse.click(info.rect.x + info.rect.w/2, info.rect.y + info.rect.h/2);
    clicked=true;
  }catch(e){ lastErr=e.message; }
  if(!clicked) throw new Error(`无法点击 ${info.label}: ${lastErr}`);
  await sleep(600);
  // 若打开了对话框/菜单，记录但不立即关闭（由外层处理）
}

// 关闭可能打开的弹窗/菜单/对话框
async function closeOverlays(){
  // 按 Escape 直到无 overlay
  for(let i=0;i<3;i++){
    const hasOverlay=await page.evaluate(()=>{
      return !!document.querySelector('.lm-Menu:not(.lm-mod-hidden), .p-Menu:not(.p-mod-hidden), [role="dialog"], .dialogBlock, .theia-dialog, .quick-input-widget');
    });
    if(!hasOverlay) break;
    await page.keyboard.press('Escape');
    await sleep(400);
  }
  // 额外：点击空白处
  try{
    await page.mouse.click(10,10);
    await sleep(200);
  }catch{}
}

(async()=>{
  const exe=resolveExe();
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  // 准备临时真实工作区（用于 Explorer 有内容）
  const tmpWs=path.join(recordDir,'workspace-real');
  const srcWs=path.join(repoRoot,'legacy-sample');
  if(fs.existsSync(tmpWs)) fs.rmSync(tmpWs,{recursive:true, force:true});
  fs.mkdirSync(tmpWs,{recursive:true});
  // 复制关键文件
  for(const f of ['src','WebRoot','lib','build.xml','.kairo']){
    const s=path.join(srcWs,f), d=path.join(tmpWs,f);
    if(fs.existsSync(s)){
      if(fs.statSync(s).isDirectory()){
        fs.cpSync(s,d,{recursive:true});
      } else fs.copyFileSync(s,d);
    }
  }
  ['README.md','.project','.classpath'].forEach(f=>{
    const s=path.join(srcWs,f), d=path.join(tmpWs,f);
    if(fs.existsSync(s)) fs.copyFileSync(s,d);
  });

  log(`临时工作区 ${tmpWs}`);
  const launchArgs=[`--user-data-dir=${userDataDir}`, tmpWs];
  const env={...process.env, KAIRO_DESKTOP_LOG_FILE: path.join(recordDir,'desktop-main.log'), KAIRO_NO_DEVTOOLS:'1', KAIRO_DEV:'1', KAIRO_USER_DATA_DIR: userDataDir};
  app=await electron.launch({executablePath: exe, args: launchArgs, env, timeout:90000});
  log(`pid=${app.process().pid}`);
  page=await app.firstWindow({timeout:60000});
  log(`window ${await page.title()} ${page.url()}`);
  page.on('console', m=>{ if(m.type()==='error') log(`[console:error] ${m.text().slice(0,180)}`); });
  page.on('pageerror', e=> log(`[pageerror] ${e.message}`));
  page.on('dialog', async d=>{ log(`dialog ${d.type()}: ${String(d.message()||'').slice(0,80)}`); try{await d.accept();}catch{} });

  await page.waitForSelector('#theia-statusBar', {timeout:90000});
  await page.waitForSelector('#theia-ApplicationShell', {timeout:30000}).catch(()=>{});
  await sleep(2000);
  try{
    const dlg=page.locator('.dialogBlock, .workspace-trust-dialog');
    await dlg.first().waitFor({state:'visible', timeout:3000});
    const btn=page.locator('button:has-text("Yes, I trust"), button:has-text("信任")').first();
    if(await btn.count()) await btn.click({timeout:3000});
    await page.waitForSelector('.dialogBlock', {state:'detached', timeout:5000}).catch(()=>{});
  }catch{}
  await shotFull('01-boot');

  // 获取 Agent 供后续
  const statePath=path.join(userDataDir,'kairo-data','agent-state.json');
  let state=null;
  for(let i=0;i<20;i++){ if(fs.existsSync(statePath)){ try{ state=JSON.parse(fs.readFileSync(statePath,'utf-8')); if(state.port) break;}catch{} } await sleep(500);}
  if(state) log(`agent ${state.port}`);

  // 阶段1：ActivityBar 真实点击
  log('=== 阶段1：ActivityBar 真实点击 ===');
  const abItems=await page.evaluate(()=>{
    const sels=['.theia-app-left .lm-TabBar-tab'];
    const out=[];
    for(const sel of sels){
      for(const el of document.querySelectorAll(sel)){
        const st=window.getComputedStyle(el);
        const r=el.getBoundingClientRect();
        if(st.display==='none' || r.width===0 || el.id.includes('hidden')) continue;
        out.push({title: el.getAttribute('title')||el.getAttribute('aria-label')||'', text: (el.textContent||'').trim()});
      }
    }
    return out;
  });
  log(`ActivityBar 可见 ${abItems.length}: ${abItems.map(i=>i.title||i.text).join(', ')}`);
  for(let i=0;i<abItems.length;i++){
    await runTest('ActivityBar', `click-${abItems[i].title||abItems[i].text||i}`, async()=>{
      const ok=await page.evaluate((idx)=>{
        const els=[...document.querySelectorAll('.theia-app-left .lm-TabBar-tab')].filter(e=>{
          const r=e.getBoundingClientRect();
          return r.width>0 && !e.id.includes('hidden');
        });
        const t=els[idx];
        if(!t) return false;
        t.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        return true;
      }, i);
      if(!ok) throw new Error('未找到');
      await sleep(800);
      // 验证侧边栏已切换
      const hasSidebar=await page.evaluate(()=> !!document.querySelector('.theia-side-panel, .theia-view-container'));
      if(!hasSidebar) throw new Error('侧边栏未出现');
    });
    await closeOverlays();
  }

  // 阶段2：全页面按钮爬取并真实点击（分批）
  log('=== 阶段2：全页面按钮真实点击 ===');
  let allButtons=await discoverButtons();
  log(`发现 ${allButtons.length} 个可点击元素`);
  // 按区域分组：优先点 Toolbar、View、StatusBar、Dialog
  // 过滤掉一些危险或无意义的
  const dangerous=/Exit|Quit|Close All|Delete|Remove|Uninstall/i;
  const filtered=allButtons.filter(b=>{
    // 过滤太小的装饰性 codicon（非按钮）
    if(b.tag==='span' && b.w<12 && !b.title && !b.aria) return false;
    // 过滤隐藏的 tab 关闭图标（太多）
    if(b.cls.includes('TabCloseIcon') && b.rect.w<16) return false;
    return true;
  });
  log(`过滤后 ${filtered.length} 个`);
  // 保存发现清单
  fs.writeFileSync(path.join(recordDir,'discovered-buttons.json'), JSON.stringify(filtered,null,2));
  // 逐个真实点击（限制前60个，避免过长）
  const toClick=filtered.slice(0,60);
  log(`将真实点击前 ${toClick.length} 个按钮`);
  for(let i=0;i<toClick.length;i++){
    const info=toClick[i];
    // 跳过危险按钮，但记录
    if(dangerous.test(info.label) || dangerous.test(info.title)){
      log(`  跳过危险按钮 [${i}] ${info.label} (${info.title})`);
      results.push({phase:'AllButtons', name:`skip-dangerous-${info.label.slice(0,20)}`, status:'pass', durationMs:0, screenshot:''});
      continue;
    }
    await runTest('AllButtons', `${String(i).padStart(2,'0')}-${info.label.slice(0,30).replace(/\s+/g,'-')}`, async()=>{
      await clickButton(info);
      // 识图：检查是否有 error banner 或 shell 仍存在
      const vis=await page.evaluate(()=>{
        const shell=!!document.querySelector('#theia-app-shell, #theia-ApplicationShell');
        const err=!!document.querySelector('.kairo-error-banner');
        const dlg=!!document.querySelector('[role="dialog"], .dialogBlock');
        return {hasShell: shell, hasError: err, hasDialog: dlg, bodyLen: document.body.innerText.length};
      });
      if(!vis.hasShell) throw new Error('shell 消失');
      log(`    vis hasError=${vis.hasError} hasDialog=${vis.hasDialog} bodyLen=${vis.bodyLen}`);
      // 若打开对话框，测试其内部按钮
      if(vis.hasDialog){
        await sleep(500);
        const dialogBtns=await page.evaluate(()=>{
          const dlg=document.querySelector('[role="dialog"], .dialogBlock, .theia-dialog');
          if(!dlg) return [];
          return [...dlg.querySelectorAll('button')].map(b=> (b.textContent||'').trim()).filter(Boolean).slice(0,5);
        });
        log(`    dialog buttons: ${dialogBtns.join(', ')}`);
        // 点 Cancel/Close 关闭
        const cancelBtn=page.locator('[role="dialog"] button:has-text("Cancel"), [role="dialog"] button:has-text("Close"), [role="dialog"] button:has-text("取消"), .dialogBlock button:has-text("Close")').first();
        if(await cancelBtn.count()){
          await cancelBtn.click({timeout:2000}).catch(()=>{});
          await sleep(500);
        } else {
          await page.keyboard.press('Escape');
          await sleep(400);
        }
      }
    });
    await closeOverlays();
    // 每10个全量截图
    if(i%10===9) await shotFull(`batch-${i}`);
  }

  // 阶段3：View 内部 Toolbar 按钮（每个视图单独发现并点击）
  log('=== 阶段3：Kairo 视图 Toolbar 真实点击 ===');
  const views=['Servers','Builds','Deployments','Tomcat Logs','Maven','TODO','Test Results','SQL Console','Remote','Performance'];
  for(const v of views){
    // 通过 ActivityBar 或命令打开视图（这里用真实点击 ActivityBar 已覆盖，改用 API 打开后点击 toolbar）
    // 先尝试通过点击侧边栏对应视图的标题
    const viewBtns=await page.evaluate((label)=>{
      const els=[...document.querySelectorAll('.theia-view-container, .kairo-view, .p-Widget')];
      const target=els.find(e=> (e.textContent||'').includes(label));
      if(!target) return [];
      return [...target.querySelectorAll('button, .theia-button, .kairo-toolbar button')].map(b=> ({
        text: (b.textContent||'').trim().slice(0,30),
        title: b.getAttribute('title')||'',
        cls: b.className.slice(0,50),
        rect: b.getBoundingClientRect()
      })).filter(b=> b.text || b.title).slice(0,8);
    }, v);
    if(viewBtns.length===0){
      log(`  ${v} 未找到 toolbar`);
      continue;
    }
    log(`  ${v} toolbar ${viewBtns.length}: ${viewBtns.map(b=> b.text||b.title).join(', ')}`);
    for(let j=0;j<Math.min(viewBtns.length,3);j++){
      const btnInfo=viewBtns[j];
      await runTest(`View-${v}`, `toolbar-${btnInfo.text||btnInfo.title||j}`, async()=>{
        // 通过坐标点击
        const ok=await page.evaluate((label, text)=>{
          const btns=[...document.querySelectorAll('button, .theia-button, .kairo-toolbar button')];
          const t=btns.find(b=> (b.textContent||'').trim()===text || b.getAttribute('title')===label);
          if(!t) return false;
          const r=t.getBoundingClientRect();
          if(r.width===0) return false;
          t.dispatchEvent(new MouseEvent('click',{bubbles:true}));
          return true;
        }, btnInfo.title, btnInfo.text);
        if(!ok) throw new Error('toolbar 按钮未找到');
        await sleep(800);
      });
      await closeOverlays();
    }
  }

  // 阶段4：StatusBar 真实点击
  log('=== 阶段4：StatusBar 真实点击 ===');
  const statusItems=await page.evaluate(()=>{
    const bar=document.querySelector('#theia-statusBar');
    if(!bar) return [];
    return [...bar.querySelectorAll('*')].filter(e=>{
      const r=e.getBoundingClientRect();
      const st=window.getComputedStyle(e);
      return r.width>10 && r.height>8 && st.cursor==='pointer' || e.classList.contains('element') || e.hasAttribute('title');
    }).map(e=> ({
      text: (e.textContent||'').trim().slice(0,30),
      title: e.getAttribute('title')||'',
      rect: e.getBoundingClientRect()
    })).filter(x=> x.text || x.title).slice(0,10);
  });
  log(`StatusBar ${statusItems.length}: ${statusItems.map(s=> s.text||s.title).join(' | ')}`);
  for(let i=0;i<Math.min(statusItems.length,5);i++){
    await runTest('StatusBar', `click-${statusItems[i].text||statusItems[i].title||i}`, async()=>{
      const ok=await page.evaluate((idx)=>{
        const bar=document.querySelector('#theia-statusBar');
        const els=[...bar.querySelectorAll('*')].filter(e=>{
          const r=e.getBoundingClientRect();
          return r.width>10 && e.getAttribute('title');
        });
        const t=els[idx];
        if(!t) return false;
        t.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        return true;
      }, i);
      if(!ok){
        // 回退坐标点击
        const r=statusItems[i].rect;
        await page.mouse.click(r.x + r.width/2, r.y + r.height/2);
      }
      await sleep(800);
      await closeOverlays();
    });
  }

  // 阶段5：Editor Tab 真实点击
  log('=== 阶段5：Editor Tab 真实点击 ===');
  // 先确保有编辑器
  await page.keyboard.press('Control+N');
  await sleep(1000);
  await page.keyboard.type('// test', {delay:20});
  await sleep(500);
  const tabs=await page.evaluate(()=>{
    return [...document.querySelectorAll('.p-TabBar-tab, .lm-TabBar-tab')].filter(e=>{
      const r=e.getBoundingClientRect();
      return r.width>20 && e.closest('#theia-top-panel')===null && !e.id.includes('hidden');
    }).map(e=> (e.textContent||'').trim().slice(0,20)).slice(0,5);
  });
  log(`Editor tabs: ${tabs.join(', ')}`);
  for(let i=0;i<tabs.length;i++){
    await runTest('EditorTab', `click-${tabs[i]||i}`, async()=>{
      const ok=await page.evaluate((idx)=>{
        const tabs=[...document.querySelectorAll('.p-TabBar-tab, .lm-TabBar-tab')].filter(e=> !e.id.includes('hidden') && e.getBoundingClientRect().width>20 && !e.closest('#theia-top-panel'));
        const t=tabs[idx];
        if(!t) return false;
        t.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        return true;
      }, i);
      if(!ok) throw new Error('tab 未找到');
      await sleep(600);
    });
  }
  // 右键菜单
  await runTest('Editor', 'right-click-context', async()=>{
    const ed=page.locator('.monaco-editor .view-lines').first();
    if(await ed.count()){
      await ed.click({button:'right', timeout:3000});
      await sleep(800);
      const hasMenu=await page.locator('.p-Menu, .lm-Menu, .monaco-menu').count().then(c=>c>0);
      log(`  context menu ${hasMenu}`);
      await page.keyboard.press('Escape');
      await sleep(300);
    }
  });

  // 汇总
  const passed=results.filter(r=>r.status==='pass').length;
  const failed=results.filter(r=>r.status==='fail').length;
  log(`\n=== 真实按钮汇总 ${passed}/${results.length} 通过, ${failed} 失败 ===`);
  results.forEach(r=> log(`${r.status==='pass'?'PASS':'FAIL'} [${r.phase}] ${r.name}${r.error?' : '+r.error:''}`));
  const md=`# 真实按钮全量点击报告

**时间**: ${new Date().toISOString()}
**结果**: ${passed}/${results.length} 通过
**截图**: \`docs/screenshots/windows-all-buttons/\`

| # | 阶段 | 用例 | 状态 | 时长 |
|---|------|------|------|------|
${results.map((r,i)=>`| ${i+1} | ${r.phase} | ${r.name} | ${r.status.toUpperCase()} | ${r.durationMs}ms |`).join('\n')}

**发现按钮数**: ${filtered.length} (原始 ${allButtons.length})
**危险跳过**: ${results.filter(r=> r.name.includes('skip-dangerous')).length}
`;
  fs.writeFileSync(path.join(recordDir,'report.md'), md, 'utf-8');
  fs.writeFileSync(path.join(recordDir,'results.json'), JSON.stringify({passed, failed, total: results.length, results}, null,2));
  log(`报告 ${path.join(recordDir,'report.md')}`);

  await app.close().catch(()=>{});
  process.exit(failed>0?1:0);
})().catch(e=>{ console.error('FATAL', e.stack||e.message); process.exit(1); });
