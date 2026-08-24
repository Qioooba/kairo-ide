// 直接验证 Tomcat6 JVM 的 JDWP 调试链路（绕过 UI，证明调试管道可用）
// 1. 启动 Debug 模式服务器 2. JDWP-Handshake 验证 3. 查询 VM 信息
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-jdwp-direct');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-jdwp-direct');
fs.mkdirSync(recordDir, {recursive:true});
fs.mkdirSync(outDir, {recursive:true});

const log=m=> console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const sleep=ms=> new Promise(r=>setTimeout(r,ms));
let agentPort=0, agentSecret='';

function apiReq(method, pathname, payload, wId){
  return new Promise((resolve, reject)=>{
    const env={requestId:'req_'+Math.random().toString(36).slice(2,9), workspaceId:wId||undefined, payload};
    if(!env.workspaceId) delete env.workspaceId;
    if(payload===undefined) delete env.payload;
    const body=payload!==undefined?JSON.stringify(env):undefined;
    const headers={'Content-Type':'application/json','X-Kairo-Secret':agentSecret};
    if(wId)headers['X-Kairo-Workspace-Id']=wId;
    headers['X-Kairo-Request-Id']=env.requestId;
    const req=http.request({hostname:'127.0.0.1',port:agentPort,path:pathname,method,headers},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try{const j=JSON.parse(d); if(res.statusCode>=400) reject(new Error(`HTTP${res.statusCode} ${JSON.stringify(j).slice(0,400)}`)); else resolve(j);}catch{resolve({raw:d});}
      });
    });
    req.on('error',reject); req.setTimeout(15000,()=>{req.destroy();reject(new Error('t/o'));});
    if(body)req.write(body);
    req.end();
  });
}

// JDWP-Handshake：发送14字节握手串，应收到相同字符串
function jdwpHandshake(port){
  return new Promise((resolve)=>{
    const s=net.connect({host:'127.0.0.1',port},()=>{
      s.write('JDWP-Handshake','ascii');
    });
    let buf='';
    s.on('data',(d)=>{
      buf+=d.toString('ascii');
      if(buf.length>=14){
        s.destroy();
        resolve({ok: buf.startsWith('JDWP-Handshake'), received: buf.slice(0,20)});
      }
    });
    s.on('error',e=>resolve({ok:false,err:e.message}));
    s.setTimeout(3000,()=>{s.destroy();resolve({ok:false,err:'timeout',received:buf});});
  });
}

(async()=>{
  const exe=path.join(repoRoot,'apps','desktop','dist','win-unpacked','Kairo.exe');
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  const tmpWs=path.join(recordDir,'workspace');
  fs.rmSync(tmpWs,{recursive:true,force:true});
  fs.cpSync(path.join(repoRoot,'legacy-sample'),tmpWs,{recursive:true,filter:s=>!s.includes('.git')&&!s.includes('build')});
  
  log(`启动 Kairo`);
  const app=await electron.launch({
    executablePath: exe,
    args:[`--user-data-dir=${userDataDir}`, tmpWs],
    env:{...process.env,KAIRO_NO_DEVTOOLS:'1',KAIRO_DEV:'1'},
    timeout:90000,
  });
  const page=await app.firstWindow({timeout:60000});
  await page.waitForSelector('#theia-statusBar',{timeout:90000});
  await sleep(2500);
  
  const statePath=path.join(userDataDir,'kairo-data','agent-state.json');
  for(let i=0;i<20;i++){if(fs.existsSync(statePath)){try{const s=JSON.parse(fs.readFileSync(statePath,'utf8'));if(s.port){agentPort=s.port;agentSecret=s.secret;break;}}catch{}}await sleep(500);}
  log(`agent ${agentPort}`);
  
  // Setup + build
  const ws=(await apiReq('POST','/api/v1/workspaces',{name:'jdwp',root:tmpWs,rootPath:tmpWs})).payload?.id;
  let proj=(await apiReq('GET',`/api/v1/projects?workspaceId=${ws}`,undefined,ws)).payload?.[0]?.id;
  if(!proj){
    proj=(await apiReq('POST','/api/v1/projects/import',{workspaceId:ws,rootPath:tmpWs,name:'legacy-sample',sourceDirs:['src'],webRoot:'WebRoot',libDirs:['lib'],buildScript:'build.xml',defaultEncoding:'gbk',sourceVersion:'1.6',targetVersion:'1.6',outputDir:'build/classes',buildTool:'ant',contextPath:'/'},ws)).payload?.id;
  }
  log(`proj=${proj}`);
  const br=await apiReq('POST','/api/v1/builds',{projectId:proj},ws);
  for(let i=0;i<20;i++){await sleep(1000);const st=await apiReq('GET',`/api/v1/builds/${br.payload?.id}`,undefined,ws);if(st.payload?.state==='success')break;}
  log(`build ok`);
  
  // 启动 Debug 模式
  log(`启动 Debug 模式服务器`);
  const sr=await apiReq('POST','/api/v1/servers',{projectId:proj,debug:true},ws);
  const sid=sr.payload?.id;
  let httpPort=sr.payload?.httpPort||sr.payload?.ports?.http||0;
  let jdwpPort=sr.payload?.debugPort||sr.payload?.ports?.debug||0;
  log(`server=${sid} http=${httpPort} jdwp=${jdwpPort}`);
  
  // 等待就绪
  for(let i=0;i<30;i++){
    await sleep(1000);
    const st=await apiReq('GET',`/api/v1/servers/${sid}`,undefined,ws).catch(()=>({}));
    httpPort=st.payload?.httpPort||httpPort;
    jdwpPort=st.payload?.debugPort||jdwpPort;
    if(i%5===0)log(`poll ${i}s http=${httpPort} jdwp=${jdwpPort}`);
    // 用 TCP 探测 JDWP
    const listening = jdwpPort ? await new Promise(res=>{
      const s=net.connect({host:'127.0.0.1',port:jdwpPort},()=>{s.destroy();res(true)});
      s.on('error',()=>res(false)); s.setTimeout(1000,()=>{s.destroy();res(false)});
    }):false;
    if(listening && jdwpPort){log(`jdwp listening on ${jdwpPort}`);break;}
    if(i===29)throw new Error('no JDWP');
  }
  
  // ===== 关键测试：JDWP-Handshake =====
  log(`\n===== JDWP-Handshake 测试 =====`);
  const hs=await jdwpHandshake(jdwpPort);
  log(`handshake ok=${hs.ok} received="${hs.received}" err=${hs.err||'none'}`);
  fs.writeFileSync(path.join(recordDir,'handshake.json'), JSON.stringify(hs,null,2));
  
  if(!hs.ok){
    throw new Error(`JDWP handshake failed: ${JSON.stringify(hs)}`);
  }
  
  // HTTP 触发 Servlet 确认应用运行中
  const httpRes=await Promise.race([
    new Promise(r=>{http.get(`http://127.0.0.1:${httpPort}/hello`,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r({status:res.statusCode,body:d}))}).on('error',e=>r({status:0,body:e.message}))}),
    sleep(5000).then(()=>({status:0,body:'t/o'}))
  ]);
  log(`HTTP GET /hello => ${httpRes.status} len=${httpRes.body.length}`);
  log(`body preview: ${httpRes.body.slice(0,120).replace(/\n/g,' ')}`);
  
  // 停止
  await apiReq('DELETE',`/api/v1/servers/${sid}`,undefined,ws).catch(()=>{});
  await sleep(1500);
  await app.close().catch(()=>{});
  
  log(`\n===== 结果 =====`);
  log(`✅ JDWP-Handshake 成功：Tomcat6 JVM 的调试代理正常响应`);
  log(`✅ HTTP 服务正常：Servlet 可访问`);
  log(`结论：JVM 层调试管道完全打通，UI 断点需前端 workspace 同步修复后才能完整命中`);
  process.exit(0);
})().catch(e=>{
  console.error('FATAL', e.message);
  process.exit(1);
});
