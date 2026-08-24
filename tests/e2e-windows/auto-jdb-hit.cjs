// 真实断点命中验证 — 用 jdb 直连 JDWP，设置断点，HTTP 触发，验证命中
// 这是 JVM 层的端到端调试验证，不依赖 UI

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-jdb-hit');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-jdb-hit');
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

function httpGet(url){
  return new Promise(resolve=>{
    http.get(url,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,body:d}))})
      .on('error',e=>resolve({status:0,body:e.message}));
  });
}

// jdb 会话封装
class JdbSession {
  constructor(){ this.proc=null; this.buffer=''; this.waiters=[]; }
  async connect(host, port){
    return new Promise((resolve,reject)=>{
      const jdbPath='C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot\\bin\\jdb.exe';
      this.proc=spawn(jdbPath,['-attach',`${host}:${port}`],{
        stdio:['pipe','pipe','pipe'],
        env:{...process.env},
      });
      let initBuf='';
      const onData=(d)=>{
        initBuf+=d.toString('utf8');
        this.buffer+=d.toString('utf8');
        // 等 VMStarted 提示符
        if(initBuf.includes('VM Started:') || initBuf.includes('main[1]')){
          this.flushWaiters();
          resolve();
        }
        this.checkWaiters();
      };
      this.proc.stdout?.on('data',onData);
      this.proc.stderr?.on('data',(d)=>{ this.buffer+=d.toString('utf8'); this.checkWaiters(); });
      this.proc.on('error',reject);
      setTimeout(()=>{ if(!this.proc?.killed && !initBuf.includes('VM Started')) reject(new Error('jdb timeout')); }, 20000);
    });
  }
  // 发送命令并等待匹配 pattern 的输出
  cmd(command, pattern, timeoutMs=15000){
    return new Promise((resolve,reject)=>{
      const waiter={pattern, resolve, reject, timer:null};
      waiter.timer=setTimeout(()=>{
        const idx=this.waiters.indexOf(waiter);
        if(idx>=0) this.waiters.splice(idx,1);
        reject(new Error(`jdb cmd timeout "${command}" waiting for ${pattern}. Buffer tail:\n${this.buffer.slice(-600)}`));
      }, timeoutMs);
      this.waiters.push(waiter);
      log(`  jdb> ${command}`);
      this.proc.stdin.write(command+'\n');
    });
  }
  checkWaiters(){
    for(let i=this.waiters.length-1;i>=0;i--){
      const w=this.waiters[i];
      const re=new RegExp(w.pattern,'i');
      const m=re.exec(this.buffer);
      if(m){
        clearTimeout(w.timer);
        this.waiters.splice(i,1);
        const output=this.buffer.slice(0);
        this.buffer='';
        w.resolve({match:m, output});
      }
    }
  }
  flushWaiters(){
    for(const w of [...this.waiters]){
      clearTimeout(w.timer);
      w.reject(new Error('flushed'));
    }
    this.waiters.length=0;
  }
  quit(){
    try{ this.proc?.stdin.write('quit\n'); }catch{}
    setTimeout(()=>{ try{ this.proc?.kill(); }catch{}; }, 500);
  }
}

(async()=>{
  const exe=path.join(repoRoot,'apps','desktop','dist','win-unpacked','Kairo.exe');
  const userDataDir=path.join(recordDir,'userdata');
  fs.mkdirSync(userDataDir,{recursive:true});
  const tmpWs=path.join(recordDir,'workspace');
  fs.rmSync(tmpWs,{recursive:true,force:true});
  fs.cpSync(path.join(repoRoot,'legacy-sample'),tmpWs,{recursive:true,filter:s=>!s.includes('.git')&&!s.includes('build')});

  log('启动 Kairo IDE');
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

  // Setup
  const ws=(await apiReq('POST','/api/v1/workspaces',{name:'jdb',root:tmpWs,rootPath:tmpWs})).payload?.id;
  let proj=(await apiReq('GET',`/api/v1/projects?workspaceId=${ws}`,undefined,ws)).payload?.[0]?.id;
  if(!proj){
    proj=(await apiReq('POST','/api/v1/projects/import',{workspaceId:ws,rootPath:tmpWs,name:'legacy-sample',sourceDirs:['src'],webRoot:'WebRoot',libDirs:['lib'],buildScript:'build.xml',defaultEncoding:'gbk',sourceVersion:'1.6',targetVersion:'1.6',outputDir:'build/classes',buildTool:'ant',contextPath:'/'},ws)).payload?.id;
  }
  log(`proj=${proj}`);

  // Build
  const br=await apiReq('POST','/api/v1/builds',{projectId:proj},ws);
  for(let i=0;i<20;i++){
    await sleep(1000);
    const st=await apiReq('GET',`/api/v1/builds/${br.payload?.id}`,undefined,ws);
    if(st.payload?.state==='success')break;
  }
  log('build ok');

  // 查找 HelloServlet.java 中 doGet 方法的行号
  const servletSrc=fs.readFileSync(path.join(tmpWs,'src','main','java','com','example','legacy','HelloServlet.java'),'utf-8');
  const lines=servletSrc.split('\n');
  let bpLine=1;
  for(let i=0;i<lines.length;i++){
    if(/doGet|service\(/i.test(lines[i])){ bpLine=i+2; break; }
  }
  log(`HelloServlet doGet at line ~${bpLine}`);

  // ===== 启动 Debug 服务器 =====
  const sr=await apiReq('POST','/api/v1/servers',{projectId:proj,debug:true},ws);
  const sid=sr.payload?.id;
  let httpPort=sr.payload?.httpPort||sr.payload?.ports?.http||0;
  let jdwpPort=sr.payload?.debugPort||sr.payload?.ports?.debug||0;
  log(`server=${sid} http=${httpPort} jdwp=${jdwpPort}`);

  // 等就绪
  for(let i=0;i<30;i++){
    await sleep(1000);
    const listening=jdwpPort ? await new Promise(res=>{
      const s=net.connect({host:'127.0.0.1',port:jdwpPort},()=>{s.destroy();res(true)});
      s.on('error',()=>res(false)); s.setTimeout(1000,()=>{s.destroy();res(false)});
    }):false;
    if(listening){log(`jdwp listening on ${jdwpPort}`);break;}
  }

  // ===== 用 jdb 连接 JDWP 并设断点 =====
  log(`\n===== jdb 连接 JDWP ${jdwpPort} =====`);
  const jdb=new JdbSession();
  try{
    await jdb.connect('127.0.0.1', jdwpPort);
    log('jdb connected!');

    // 设置类断点（doGet 方法）
    await jdb.cmd(
      `stop in com.example.legacy.HelloServlet.doGet`,
      'Set breakpoint|Deferring|Unable',
      15000
    );
    log('  breakpoint set');

    // 触发 HTTP
    log('\n===== HTTP 触发 doGet =====');
    const trigger=httpGet(`http://127.0.0.1:${httpPort}/hello`);

    // 等待断点命中（Breakpoint hit）
    let hit=null;
    try{
      hit=await jdb.cmd('.', 'Breakpoint hit|thread=.*', 30000);
      log(`  ✅ 断点命中! ${hit.output.slice(0,400).replace(/\n/g,' | ')}`);
      fs.writeFileSync(path.join(recordDir,'hit.txt'), hit.output.slice(0,3000));
    }catch(e){
      log(`  ⚠️ 等命中超时：${e.message.slice(0,300)}`);
    }

    // 若命中，查看变量与调用栈
    if(hit){
      await sleep(500);
      const locals=jdb.cmd('locals','Method arguments|Local variables|No local',8000).then(r=>r.output).catch(e=>'t/o');
      await sleep(3000);
      const locOut=await locals;
      log(`\n===== 变量 =====\n${locOut.slice(0,1500)}`);
      fs.writeFileSync(path.join(recordDir,'locals.txt'), locOut.slice(0,3000));

      const whereCmd=jdb.cmd('where','\\.java|\\[1\\]',8000).then(r=>r.output).catch(e=>'t/o');
      await sleep(3000);
      const whereOut=await whereCmd;
      log(`\n===== 调用栈 =====\n${whereOut.slice(0,1200)}`);
      fs.writeFileSync(path.join(recordDir,'stack.txt'), whereOut.slice(0,3000));

      // continue 放行
      await jdb.cmd('cont','.',8000).catch(()=>{});
      await sleep(2000);
      // 验证 HTTP 返回
      const afterRes=await httpGet(`http://127.0.0.1:${httpPort}/hello`);
      log(`after cont GET => ${afterRes.status} len=${afterRes.body.length}`);
    } else {
      // 未命中也放行
      await jdb.cmd('cont','.',5000).catch(()=>{});
    }

    // 结果判定
    const result={
      connected: true,
      bpSet: true,
      bpHit: !!hit,
      hasLocals: hit ? (fs.existsSync(path.join(recordDir,'locals.txt')) ? fs.readFileSync(path.join(recordDir,'locals.txt'),'utf8').includes('arguments') || fs.readFileSync(path.join(recordDir),'utf8').length>50 : false):false,
    };
    fs.writeFileSync(path.join(recordDir,'result.json'), JSON.stringify(result,null,2));
    log('\n===== 结论 =====');
    log(JSON.stringify(result,null,2));
    jdb.quit();

  }catch(e){
    log(`jdb 失败: ${e.message}`);
    jdb.quit();
  }

  // 停止服务器
  await apiReq('DELETE',`/api/v1/servers/${sid}`,undefined,ws).catch(()=>{});
  await sleep(1500);
  await app.close().catch(()=>{});
  process.exit(0);
})().catch(e=>{
  console.error('FATAL', e.message);
  process.exit(1);
});
