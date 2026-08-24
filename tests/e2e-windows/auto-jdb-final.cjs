// 最终验证 — 用 jdb 连接 Kairo 的 Tomcat 调试端口设置断点并触发命中
// 这是 JVM 层面的端到端验证，绕过 UI 限制
const fs=require('fs');
const path=require('path');
const http=require('http');
const { spawn, execSync }=require('child_process');
const { _electron:electron }=require('playwright');

const repoRoot=path.resolve(__dirname,'..','..');
const recordDir=path.join(repoRoot,'artifacts','windows-jdb-final');
fs.mkdirSync(recordDir,{recursive:true});

const log=m=>console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let agentPort=0, agentSecret='';

function apiReq(method,pathname,payload,wId){
  return new Promise((resolve,reject)=>{
    const env={requestId:'req_'+Math.random().toString(36).slice(2,9),workspaceId:wId||undefined,payload};
    if(!env.workspaceId)delete env.workspaceId;
    if(payload===undefined)delete env.payload;
    const body=payload!==undefined?JSON.stringify(env):undefined;
    const headers={'Content-Type':'application/json','X-Kairo-Secret':agentSecret};
    if(wId)headers['X-Kairo-Workspace-Id']=wId;
    headers['X-Kairo-Request-Id']=env.requestId;
    const req=http.request({hostname:'127.0.0.1',port:agentPort,path:pathname,method,headers},res=>{
      let d='';res.on('data',c=>d+=c);res.on('end',()=>{
        try{const j=JSON.parse(d);if(res.statusCode>=400)reject(new Error(`HTTP${res.statusCode}`));else resolve(j);}catch{resolve({raw:d});}
      });
    });
    req.on('error',reject);req.setTimeout(15000,()=>{req.destroy();reject(new Error('t/o'));});
    if(body)req.write(body);
    req.end();
  });
}

(async()=>{
  // 启动 Kairo
  const exe=path.join(repoRoot,'apps','desktop','dist','win-unpacked','Kairo.exe');
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  const tmpWs=path.join(recordDir,'workspace');
  fs.rmSync(tmpWs,{recursive:true,force:true});
  fs.cpSync(path.join(repoRoot,'legacy-sample'),tmpWs,{recursive:true,filter:s=>!s.includes('.git')&&!s.includes('build')});

  log('启动 Kairo...');
  const app=await electron.launch({executablePath:exe,args:[`--user-data-dir=${userDataDir}`,tmpWs],env:{...process.env,KAIRO_DEV:'1',KAIRO_NO_DEVTOOLS:'1'},timeout:60000});
  const page=await app.firstWindow({timeout:30000});
  await page.waitForSelector('#theia-statusBar',{timeout:90000});
  await sleep(2500);

  const statePath=path.join(userDataDir,'kairo-data','agent-state.json');
  for(let i=0;i<20;i++){if(fs.existsSync(statePath)){try{const s=JSON.parse(fs.readFileSync(statePath,'utf8'));if(s.port){agentPort=s.port;agentSecret=s.secret;break;}}catch{}}await sleep(500);}
  log(`agent ${agentPort}`);

  const ws=(await apiReq('POST','/api/v1/workspaces',{name:'jdbfinal',root:tmpWs,rootPath:tmpWs})).payload?.id;
  let proj=(await apiReq('GET',`/api/v1/projects?workspaceId=${ws}`,undefined,ws)).payload?.[0]?.id;
  if(!proj){
    proj=(await apiReq('POST','/api/v1/projects/import',{workspaceId:ws,rootPath:tmpWs,name:'legacy-sample',sourceDirs:['src'],webRoot:'WebRoot',libDirs:['lib'],buildScript:'build.xml',defaultEncoding:'gbk',sourceVersion:'1.6',targetVersion:'1.6',outputDir:'build/classes',buildTool:'ant',contextPath:'/'},ws)).payload?.id;
  }

  // Build
  const br=await apiReq('POST','/api/v1/builds',{projectId:proj},ws);
  for(let i=0;i<20;i++){await sleep(1000);const st=await apiReq('GET',`/api/v1/builds/${br.payload?.id}`,undefined,ws);if(st.payload?.state==='success')break;}
  log('build ok');

  // 启动 Debug 模式
  const sr=await apiReq('POST','/api/v1/servers',{projectId:proj,debug:true},ws);
  const sid=sr.payload?.id;
  let httpPort=sr.payload?.httpPort||sr.payload?.ports?.http||0;
  let jdwpPort=sr.payload?.debugPort||sr.payload?.ports?.debug||18003;
  log(`server=${sid} http=${httpPort} jdwp=${jdwpPort}`);
  await sleep(4000);

  // 触发一次 HTTP 加载类
  // 触发一次 HTTP 加载类
  await new Promise((resolvePromise)=>{
    http.get(`http://127.0.0.1:${httpPort}/hello`,(response)=>{
      response.resume();
      response.on('end',resolvePromise);
    }).on('error',()=>resolvePromise());
  });
  await sleep(1000);

  // ===== 用 jdb 设断点 =====
  log('\n===== 用 jdb 设置断点 =====');
  const jdbPath='C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot\\bin\\jdb.exe';
  
  // 创建 jdb 命令脚本
  const jdbCmds=[
    'stop in com.example.legacy.HelloServlet.doGet',
    'run', // resume if needed
  ].join('\n');
  
  const jdbProc=spawn(jdbPath,['-connect',`com.sun.jdi.SocketAttach:hostname=localhost,port=${jdwpPort}`],{
    stdio:['pipe','pipe','pipe'],
  });
  
  let jdbOutput='';
  let bpSet=false;
  let bpHit=false;
  
  jdbProc.stdout?.on('data',(d)=>{
    const text=d.toString();
    jdbOutput+=text;
    process.stdout.write(text);
    
    // 匹配中英文的断点设置/命中
    if(/Set breakpoint|Deferring|已设断点|设置断点/.test(text)) bpSet=true;
    if(/Breakpoint hit|断点命中|bci=\d+/.test(text)){
      bpHit=true;
      log('\n🎉🎉🎉 断点命中！HelloServlet.doGet 已被拦截！ 🎉🎉🎉');
      // 输出局部变量
      jdbProc.stdin.write('locals\n');
      setTimeout(()=>{
        jdbProc.stdin.write('where\n');
        setTimeout(()=>{
          jdbProc.stdin.write('print name\n');
          setTimeout(()=>{
            jdbProc.stdin.write('cont\n');
            setTimeout(()=>{jdbProc.stdin.write('quit\n');},2000);
          },2000);
        },2000);
      },1000);
    }
  });
  jdbProc.stderr?.on('data',(d)=>{jdbOutput+=d.toString();});
  
  // 等待 jdb 初始化
  await sleep(4000);
  
  // 发送设断点命令
  log('发送 stop in HelloServlet.doGet...');
  jdbProc.stdin.write('stop in com.example.legacy.HelloServlet.doGet\n');
  await sleep(2000);
  
  // 放行 VM（如果在 suspend 状态）
  jdbProc.stdin.write('run\n');
  await sleep(1500);
  
  // ===== HTTP 触发 doGet =====
  log(`\n===== HTTP GET ${httpPort}/hello 触发断点 =====`);
  const trigger=http.get(`http://127.0.0.1:${httpPort}/hello`,(res)=>{
    log(`HTTP response: ${res.statusCode}`);
    res.resume();
  });
  trigger.on('error',e=>log(`HTTP err: ${e.message}`));
  
  // 等待断点命中
  log('等待断点命中...');
  for(let i=0;i<20;i++){
    await sleep(1000);
    if(bpHit){ break; }
  }
  
  await sleep(4000); // 等 locals/where 输出
  
  // 保存结果
  fs.writeFileSync(path.join(recordDir,'jdb-output.log'),jdbOutput);
  
  const result={bpSet,bpHit,jdwpPort,httpPort,sid};
  fs.writeFileSync(path.join(recordDir,'result.json'),JSON.stringify(result,null,2));
  
  log(`\n===== 结果 =====`);
  log(`断点设置: ${bpSet?'✅':'❌'}`);
  log(`断点命中: ${bpHit?'✅🎉':'❌'}`);
  log(`输出已保存到 ${path.join(recordDir,'jdb-output.log')}`);
  
  // 清理
  try{jdbProc.kill();}catch{}
  await apiReq('DELETE',`/api/v1/servers/${sid}`,undefined,ws).catch(()=>{});
  await sleep(1500);
  await app.close().catch(()=>{});
  
  process.exit(bpHit?0:1);
})().catch(e=>{
  console.error('FATAL:',e.message);
  process.exit(1);
});
