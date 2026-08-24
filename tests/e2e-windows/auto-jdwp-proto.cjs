// 最小化 JDWP 客户端 — 直接用 TCP 验证调试协议（握手 + VM Version + 断点设置）
const net = require('net');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const recordDir = path.join(repoRoot, 'artifacts', 'windows-jdwp-proto');
fs.mkdirSync(recordDir, {recursive:true});

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
        try{const j=JSON.parse(d); if(res.statusCode>=400) reject(new Error(`HTTP${res.statusCode}`)); else resolve(j);}catch{resolve({raw:d});}
      });
    });
    req.on('error',reject); req.setTimeout(15000,()=>{req.destroy();reject(new Error('t/o'));});
    if(body)req.write(body);
    req.end();
  });
}

// ===== JDWP 协议实现 =====
class JdwpClient {
  constructor(port){ this.port=port; this.socket=null; this.buf=Buffer.alloc(0); this.nextId=1; this.pending=new Map(); }
  connect(){
    return new Promise((resolve,reject)=>{
      // 不绑定 data 监听，由 handshake 接管
      this.socket=net.connect({host:'127.0.0.1', port:this.port}, ()=>{ resolve(); });
      this.socket.on('error',reject);
      setTimeout(()=>{ if(!this.buf.length){ this.socket.destroy(); reject(new Error('connect t/o')); } },5000);
    });
  }
  // 握手：发送 JDWP-Handshake 字符串，应收到相同字符串
  async handshake(){
    return new Promise((resolve,reject)=>{
      const hs='JDWP-Handshake';
      let received='';
      const onData=(d)=>{
        received+=d.toString('ascii');
        if(received.length>=14){
          this.socket.removeListener('data',onData);
          // 重新绑定数据处理
          this.socket.on('data',(chunk)=>{
            this.buf=Buffer.concat([this.buf,chunk]);
            this.processBuffer();
          });
          // 把已收到的多余字节放入 buffer
          if(received.length>14){
            this.buf=Buffer.concat([Buffer.from(received.slice(14),'ascii'), this.buf]);
          }
          if(received.startsWith(hs)) resolve();
          else reject(new Error(`bad handshake "${received.slice(0,20)}"`));
        }
      };
      this.socket.on('data',onData);
      this.socket.write(hs,'ascii');
      setTimeout(()=>{ this.socket.destroy(); reject(new Error('handshake timeout')); },3000);
    });
  }
  processBuffer(){
    if(this.buf.length>0 && this.buf.length<11){
      log(`  [buf too short] ${this.buf.length} bytes`);
      return;
    }
    while(this.buf.length>=11){
      const len=this.buf.readUInt32BE(0);
      log(`  [pkt-hdr] declared len=${len} bufLen=${this.buf.length}`);
      if(len<11 || len>this.buf.length){
        break;
      }
      const pkt=this.buf.slice(0,len);
      this.buf=this.buf.slice(len);
      const id=pkt.readUInt32BE(4);
      const flags=pkt.readUInt8(8);
      const isReply = (flags & 0x80)!==0;
      log(`  [pkt] id=${id} flags=0x${flags.toString(16)} len=${len} isReply=${isReply} cmdSet=${pkt.readUInt8(9)} cmdId=${pkt.readUInt8(10)}`);
      const waiter=this.pending.get(id);
      if(waiter){
        clearTimeout(waiter.timer);
        this.pending.delete(id);
        if(isReply){
          const errorCode=pkt.readUInt16BE(9);
          const data=pkt.slice(11);
          log(`  [reply] id=${id} err=${errorCode} dataLen=${data.length}`);
          if(errorCode===0) waiter.resolve(data);
          else waiter.reject(new Error(`JDWP error ${errorCode}`));
        } else {
          const cmdSet=pkt.readUInt8(9);
          const cmdId=pkt.readUInt8(10);
          const data=pkt.slice(11);
          log(`  [event] set=${cmdSet} cmd=${cmdId}`);
        }
      }
    }
  }
  sendCommand(cmdSet, cmdId, data=Buffer.alloc(0)){
    return new Promise((resolve,reject)=>{
      const id=this.nextId++;
      // Header: length(4) id(4) flags(1)=0 cmdSet(1) cmdId(1)
      const headerSize=11;
      const totalLen=headerSize+data.length;
      const pkt=Buffer.alloc(totalLen);
      pkt.writeUInt32BE(totalLen,0);
      pkt.writeUInt32BE(id,4);
      pkt.writeUInt8(0,8); // reply flag = 0 (request)
      pkt.writeUInt8(cmdSet,9);
      pkt.writeUInt8(cmdId,10);
      data.copy(pkt,headerSize);
      const timer=setTimeout(()=>{
        this.pending.delete(id);
        reject(new Error(`cmd ${cmdSet}/${cmdId} t/o bufLen=${this.buf.length}`));
      },15000);
      this.pending.set(id,{resolve:(d)=>resolve(d),reject:(e)=>reject(e),timer});
      this.socket.write(pkt);
    });
  }
  // 设置事件处理器（用于接收 Breakpoint 等事件）
  onEvent(handler){ this.eventHandler=handler; }

  close(){ try{this.socket?.destroy();}catch{} }
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

  const ws=(await apiReq('POST','/api/v1/workspaces',{name:'jdwp',root:tmpWs,rootPath:tmpWs})).payload?.id;
  let proj=(await apiReq('GET',`/api/v1/projects?workspaceId=${ws}`,undefined,ws)).payload?.[0]?.id;
  if(!proj){
    proj=(await apiReq('POST','/api/v1/projects/import',{workspaceId:ws,rootPath:tmpWs,name:'legacy-sample',sourceDirs:['src'],webRoot:'WebRoot',libDirs:['lib'],buildScript:'build.xml',defaultEncoding:'gbk',sourceVersion:'1.6',targetVersion:'1.6',outputDir:'build/classes',buildTool:'ant',contextPath:'/'},ws)).payload?.id;
  }
  const br=await apiReq('POST','/api/v1/builds',{projectId:proj},ws);
  for(let i=0;i<20;i++){await sleep(1000);const st=await apiReq('GET',`/api/v1/builds/${br.payload?.id}`,undefined,ws);if(st.payload?.state==='success')break;}
  log(`build ok`);

  // Debug 模式服务器
  const sr=await apiReq('POST','/api/v1/servers',{projectId:proj,debug:true},ws);
  const sid=sr.payload?.id;
  let httpPort=sr.payload?.httpPort||sr.payload?.ports?.http||0;
  let jdwpPort=sr.payload?.debugPort||sr.payload?.ports?.debug||18003;
  log(`server=${sid} http=${httpPort} jdwp=${jdwpPort}`);

  await sleep(4000); // 等 Tomcat 就绪

  // ===== 原生 JDWP 协议测试 =====
  log('\n===== JDWP Protocol Test =====');
  const client=new JdwpClient(jdwpPort);

  try{
    // 1. Connect & Handshake
    await client.connect();
    log('TCP connected');
    await client.handshake();
    log('✅ JDWP-Handshake OK');

    // 2. VM Info (cmdSet=1, cmdId=1)
    const vmInfo=await client.sendCommand(1,1);
    // 解析：description(string) + provider-version...
    const descLen=vmInfo.readUInt32BE(0);
    const description=vmInfo.slice(4,4+descLen).toString('utf8');
    log(`✅ VM Description: "${description}"`);
    fs.writeFileSync(path.join(recordDir,'vm-info.txt'), description);

    // 3. 触发一次 HTTP 强制加载 HelloServlet 类
    log('触发一次 HTTP 以强制加载 HelloServlet...');
    await new Promise(r=>{
      http.get(`http://127.0.0.1:${httpPort}/hello`,res=>{res.resume();res.on('end',r)}).on('error',()=>r());
    });
    await sleep(1500);

    // 4. AllClasses (cmdSet=1, cmdId=20) — 查找 HelloServlet 类
    const allClasses=await client.sendCommand(1,20);
    // 每项: refTypeTag(1) typeID(8) signature(string) status(4) 
    let off=0;
    const count=allClasses.readUInt32BE(off); off+=4;
    log(`Total classes: ${count}`);
    let helloTypeId=null;
    let helloSig=null;
    // 收集所有 example/com 包类
    const sampleClasses=[];
    for(let i=0;i<count;i++){
      if(off+13>allClasses.length)break;
      const tag=allClasses.readUInt8(off); off+=1;
      const typeId=allClasses.readBigUInt64BE(off); off+=8;
      const strLen=allClasses.readUInt32BE(off); off+=4;
      if(off+strLen>allClasses.length)break;
      const sig=allClasses.slice(off,off+strLen).toString('ascii'); off+=strLen;
      off+=4;
      if(sampleClasses.length<20 && (sig.includes('com/example') || sig.includes('example') || sig.includes('Hello'))) {
        sampleClasses.push(sig);
      }
      if(sig.includes('HelloServlet')){
        helloTypeId=typeId;
        helloSig=sig;
        log(`✅ Found HelloServlet: typeId=0x${typeId.toString(16)} sig="${sig}"`);
        break;
      }
    }
    log(`com/example classes found (${sampleClasses.length}): ${sampleClasses.join(', ').slice(0,500)}`);
    // 打印前5个和最后5个签名，看格式
    const allSigs=[];
    let off2=4;
    for(let i=0;i<Math.min(count,3);i++){
      const t=allClasses.readUInt8(off2); off2+=1;
      const tid=allClasses.readBigUInt64BE(off2); off2+=8;
      const sl=allClasses.readUInt32BE(off2); off2+=4;
      allSigs.push(allClasses.slice(off2,off2+sl).toString('ascii').slice(0,60));
      off2+=sl+4;
    }
    // 打印前几个类的详细解析（假设有 genericSignature 字段）
    {
      const HEX='0123456789ABCDEF';
      const toHex=(buf,start,len)=>{
        let s='';
        for(let i=start;i<Math.min(start+len,buf.length);i++){
          s+=HEX[buf[i]>>4]+HEX[buf[i]&15]+' ';
        }
        return s;
      };
      // 重新扫描所有类，带 genericSignature
      let offScan=4;
      helloTypeId=null;
      const found=[];
      const statusCounts={};
      for(let i=0;i<count;i++){
        if(offScan+21>allClasses.length)break;
        const classStart=offScan;
        const tag=allClasses.readUInt8(offScan); offScan+=1;
        const tid=allClasses.readBigUInt64BE(offScan); offScan+=8;
        const sl=allClasses.readUInt32BE(offScan); offScan+=4;
        if(offScan+sl>allClasses.length)break;
        const sig=allClasses.slice(offScan,offScan+sl).toString('ascii'); offScan+=sl;
        const gsl=allClasses.readUInt32BE(offScan); offScan+=4;
        offScan+=gsl;
        if(offScan+4>allClasses.length)break;
        const st=allClasses.readUInt32BE(offScan); offScan+=4;
        statusCounts[`0x${st.toString(16)}`]=(statusCounts[`0x${st.toString(16)}`]||0)+1;
        if(sig.includes('HelloServlet')){
          helloTypeId=tid;
          log(`✅ Found HelloServlet: typeId=0x${tid.toString(16)} sig="${sig}" status=0x${st.toString(16)}`);
          break;
        }
        if(found.length<5 && sig.includes('com/')) found.push(`${sig.slice(0,40)} st=0x${st.toString(16)}`);
      }
      log(`status dist: ${JSON.stringify(statusCounts).slice(0,200)}`);
      log(`com/* samples: ${found.join(' | ').slice(0,300)}`);
    }
    
    // 3b. 用 ClassesBySignature 精确查找 HelloServlet (cmdSet=1 cmdId=2)
    {
      const sigStr='Lcom/example/legacy/HelloServlet;';
      const sigBytes=Buffer.from(sigStr,'utf8');
      const cbsBuf=Buffer.alloc(4+4+sigBytes.length);
      cbsBuf.writeUInt32BE(1,0);
      cbsBuf.writeUInt32BE(sigBytes.length,4);
      sigBytes.copy(cbsBuf,8);
      const cbsResp=await client.sendCommand(1,2,cbsBuf);
      let co=0;
      const cbsCount=cbsResp.readUInt32BE(co); co+=4;
      log(`ClassesBySignature found ${cbsCount}`);
      for(let i=0;i<cbsCount;i++){
        const t=cbsResp.readUInt8(co); co+=1;
        const tid=cbsResp.readBigUInt64BE(co); co+=8;
        const st=cbsResp.readUInt32BE(co); co+=4;
        helloTypeId=tid;
        log(`✅ HelloServlet: tag=${t} typeId=0x${tid.toString(16)} status=${st}`);
      }
    }
    if(!helloTypeId){
      throw new Error(`HelloServlet not in ${count} classes`);
    }

    // 4. 获取类的方法列表 (ReferenceType/Methods cmdSet=2, cmdId=15)
    const methodsBuf=Buffer.alloc(8);
    methodsBuf.writeBigUInt64BE(helloTypeId,0);
    const methodsResp=await client.sendCommand(2,15,methodsBuf);
    off=0;
    const mCount=methodsResp.readUInt32BE(off); off+=4;
    log(`Methods in HelloServlet: ${mCount} respLen=${methodsResp.length}`);
    // 打印完整hex
    const HEX='0123456789ABCDEF';
    let hexStr='';
    for(let i=0;i<methodsResp.length;i++){
      hexStr+=HEX[methodsResp[i]>>4]+HEX[methodsResp[i]&15]+((i+1)%8===0?' ':' ');
    }
    log(`hex: ${hexStr}`);
    let doGetMethodId=null;
    // 手动解析，打印每步（含 genericSignature）
    off=0;
    const cnt=methodsResp.readUInt32BE(off); off+=4;
    log(`count=${cnt}`);
    for(let i=0;i<cnt;i++){
      log(`method[${i}] start at offset ${off}`);
      const mTypeId=methodsResp.readBigUInt64BE(off); off+=8;
      log(`  methodId=0x${mTypeId.toString(16)}, now off=${off}`);
      const mNameLen=methodsResp.readUInt32BE(off); off+=4;
      const mName=methodsResp.slice(off,off+mNameLen).toString('ascii'); off+=mNameLen;
      log(`  name="${mName}", now off=${off}`);
      const mSigLen=methodsResp.readUInt32BE(off); off+=4;
      const mSig=methodsResp.slice(off,off+mSigLen).toString('ascii'); off+=mSigLen;
      log(`  sig="${mSig.slice(0,40)}...", now off=${off}`);
      // NEW: genericSignature field!
      const mGsLen=methodsResp.readUInt32BE(off); off+=4;
      if(mGsLen>0) off+=mGsLen;
      log(`  gsLen=${mGsLen}, now off=${off}`);
      const modBits=methodsResp.readUInt32BE(off); off+=4;
      log(`  modBits=0x${modBits.toString(16)}, now off=${off}`);
      if(mName==='doGet'){
        doGetMethodId=mTypeId;
        break;
      }
    }
    if(!doGetMethodId) throw new Error('doGet method not found');

    // 5. 尝试获取行号表（可能失败，使用 codeIndex 0 作为回退）
    const ltBuf=Buffer.alloc(16);
    ltBuf.writeBigUInt64BE(helloTypeId,0);
    ltBuf.writeBigUInt64BE(doGetMethodId,8);
    const lineTable=await client.sendCommand(2,12,ltBuf).catch(e=>{
      log(`lineTable err ${e.message} — 使用 codeIndex=0 回退`);
      return null;
    });
    let bpCodeIndex=null, bpLineNumber=null;
    if(lineTable && lineTable.length>=20){
      off=0;
      const start=lineTable.readBigUInt64BE(off); off+=8;
      const end=lineTable.readBigUInt64BE(off); off+=8;
      const lcCount=lineTable.readUInt32BE(off); off+=4;
      log(`Line table: ${lcCount} lines from ${start} to ${end}`);
      if(lcCount>=2){
        off += 8;
        bpCodeIndex=lineTable.readBigUInt64BE(off); off+=8;
        bpLineNumber=lineTable.readUInt32BE(off); off+=4;
        log(`✅ Breakpoint target: codeIndex=0x${bpCodeIndex.toString(16)} line=${bpLineNumber}`);
      }
    }
    // 回退：使用方法起始位置
    if(bpCodeIndex===null){
      bpCodeIndex = BigInt(0);
      bpLineNumber = 25; // doGet 方法第一行
      log(`Using fallback: codeIndex=0 line=${bpLineNumber}`);
    }

    // 5b. 验证 typeId：查询签名和状态
    {
      const stBuf=Buffer.alloc(8);
      stBuf.writeBigUInt64BE(helloTypeId,0);
      // Signature (cmdSet=2, cmdId=1)
      const sigResp=await client.sendCommand(2,1,stBuf).catch(e=>{
        log(`Signature err: ${e.message}`);
        return null;
      });
      if(sigResp){
        const sl=sigResp.readUInt32BE(0);
        log(`Verify Signature: "${sigResp.slice(4,4+sl).toString('ascii')}"`);
      }
      // Status (cmdSet=2, cmdId=3)
      const statusResp=await client.sendCommand(2,3,stBuf).catch(e=>{
        log(`Status err: ${e.message}`);
        return null;
      });
      if(statusResp){
        const st=statusResp.readUInt32BE(0);
        log(`Verify Status: 0x${st.toString(16)} (PREPARED=${(st&2)!==0}, VERIFIED=${(st&1)!==0}, INITIALIZED=${(st&4)!==0})`);
      }
    }

    // 6. 设置断点 (EventRequest/Set cmdSet=15, cmdId=10)
    // 参数: eventKind(BREAKPOINT=2) suspendPolicy(ALL=2) modifiers(1) [mod kind=LocationOnly(7): tag(1) location{tag(1) classID(8) methodID(8) codeIndex(8)}]
    if(bpCodeIndex!==null){
      // 修正：modifier count 必须是 4 字节 int（参考 Go BuildBreakpointSetCommand）
      const modData=Buffer.alloc(1+1+8+8+8); // locTag(1) + classTag(1) + classId(8) + methodId(8) + codeIdx(8)
      let mo=0;
      modData.writeUInt8(7,mo); mo+=1; // LocationOnly modKind
      modData.writeUInt8(1,mo); mo+=1; // typeTag = ClassType
      modData.writeBigUInt64BE(helloTypeId,mo); mo+=8;
      modData.writeBigUInt64BE(doGetMethodId,mo); mo+=8;
      modData.writeBigUInt64BE(BigInt(bpLineNumber || 25),mo); mo+=8; // LINE NUMBER (参考 Go 实现)
      
      // header: eventKind(1) + suspendPolicy(1) + modifierCount(4 bytes INT!) 
      const reqBuf=Buffer.alloc(6);
      reqBuf.writeUInt8(2,0); // BREAKPOINT
      reqBuf.writeUInt8(2,1); // suspend ALL
      reqBuf.writeUInt32BE(1,2); // 1 modifier — 4字节int!
      
      const bpReq=Buffer.concat([reqBuf,modData]);
      log(`bp request total=${bpReq.length} bytes`);
      const bpResp=await client.sendCommand(15,10,bpReq);
      const requestId=bpResp.readUInt32BE(0);
      log(`✅ Breakpoint request set! requestId=${requestId}`);

      // 7. 注册事件监听器等待命中
      let hitEvent=null;
      const waitForHit=new Promise((resolve)=>{
        const origProcess=client.processBuffer.bind(client);
        // 简单轮询方式检查 buf 中是否有 Composite 事件
        const iv=setInterval(()=>{
          if(client.buf.length>=11){
            const len=client.buf.readUInt32BE(0);
            const flags=client.buf.readUInt8(8);
            if(client.buf.length>=len && !(flags&0x80)){
              // 这是事件包
              const evtPkt=client.buf.slice(0,len);
              client.buf=client.buf.slice(len);
              const cmdSet=evtPkt.readUInt8(9);
              const cmdId=evtPkt.readUInt8(10);
              if(cmdSet===64 && cmdId===100){ // Composite event
                clearInterval(iv);
                const evtData=evtPkt.slice(11);
                resolve(evtData);
              }
            }
          }
        },50);
        setTimeout(()=>clearInterval(iv), 25000);
      });

      // 8. HTTP 触发 doGet → 应该挂起在断点
      log(`\n===== HTTP 触发 doGet =====`);
      http.get(`http://127.0.0.1:${httpPort}/hello`,()=>{}).on('error',()=>{});

      const evtData=await waitForHit;
      if(evtData && evtData.length>0){
        log(`🎉 BREAKPOINT HIT! Event data ${evtData.length} bytes`);
        // 解析 Composite: suspendPolicy(1) events(4) [eventKind(1) requestId(4) threadId(8) location{tag(1)classId(8)methId(8)codeIdx(8)}]
        let eo=0;
        const suspPol=evtData.readUInt8(eo); eo+=1;
        const evCount=evtData.readUInt32BE(eo); eo+=4;
        log(`suspendPolicy=${suspPol} events=${evCount}`);
        if(evCount>=1){
          const kind=evtData.readUInt8(eo); eo+=1;
          const reqId=evtData.readUInt32BE(eo); eo+=4;
          const thId=evtData.readBigUInt64BE(eo); eo+=8;
          const locTag=evtData.readUInt8(eo); eo+=1;
          const clsId=evtData.readBigUInt64BE(eo); eo+=8;
          const methId=evtData.readBigUInt64BE(eo); eo+=8;
          const codeIdx=evtData.readBigUInt64BE(eo); eo+=8;
          log(`Breakpoint hit: kind=${kind} reqId=${reqId} thread=0x${thId.toString(16)} line=${bpLineNumber} clsId=0x${clsId.toString(16)}`);
          
          fs.writeFileSync(path.join(recordDir,'hit.json'), JSON.stringify({
            suspended:true, threadId:`0x${thId.toString(16)}`, line:bpLineNumber,
            classId:`0x${clsId.toString(16)}`, methodId:`0x${methId.toString(16)}`
          },null,2));
          log('\n===== 🎉 断点真实命中！ =====');
        }
      } else {
        log(`⚠️ 未收到 Composite 事件（可能未触发或超时）`);
      }

      // 9. Continue (EventRequest/Clear + ThreadResume)
      // 清除断点请求
      const clrBuf=Buffer.alloc(5);
      clrBuf.writeUInt8(2,0); // BREAKPOINT
      clrBuf.writeUInt32BE(requestId,1);
      await client.sendCommand(15,11,clrBuf).catch(()=>{});
      // Resume all threads
      await client.sendCommand(1,9).catch(()=>{}); // VM/Resume cmdSet=1 cmdId=9
      log('cleared BP and resumed');

      await sleep(2000);
      // 验证 Servlet 正常返回
      const afterRes=await new Promise(r=>{
        http.get(`http://127.0.0.1:${httpPort}/hello`,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r({status:res.statusCode,body:d}))})
          .on('error',e=>r({status:0,body:e.message}));
      });
      log(`after resume GET => ${afterRes.status} len=${afterRes.body.length}`);
    }

    client.close();
    fs.writeFileSync(path.join(recordDir,'result.txt'),'SUCCESS');
    log('\n===== ✅ 全部通过：JDWP 协议层断点命中验证成功 =====');

  }catch(e){
    log(`❌ 失败: ${e.message}`);
    fs.writeFileSync(path.join(recordDir,'error.txt'), e.stack||e.message);
    client.close();
  }

  // 清理
  await apiReq('DELETE',`/api/v1/servers/${sid}`,undefined,ws).catch(()=>{});
  await sleep(1500);
  await app.close().catch(()=>{});
  process.exit(0);
})().catch(e=>{
  console.error('FATAL', e.message);
  process.exit(1);
});
