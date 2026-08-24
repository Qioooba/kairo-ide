// 简单 JDWP 断点测试 — 验证 JVM 断点功能本身是否正常（修复版）
const net = require('net');
const log=m=>console.log(m);

let nextId=1;
const pending=new Map();
let rxBuffer=Buffer.alloc(0);

function processData(){
  while(rxBuffer.length>=11){
    const len=rxBuffer.readUInt32BE(0);
    if(rxBuffer.length<len)break;
    const pkt=rxBuffer.slice(0,len);
    rxBuffer=rxBuffer.slice(len);
    const id=pkt.readUInt32BE(4);
    const flags=pkt.readUInt8(8);
    const w=pending.get(id);
    if(w){
      clearTimeout(w.timer);
      pending.delete(id);
      if(flags&0x80){
        const err=pkt.readUInt16BE(9);
        if(err===0)w.resolve(pkt.slice(11));
        else w.reject(new Error(`JDWP error ${err}`));
      } else {
        // Event
        const cs=pkt.readUInt8(9),ci=pkt.readUInt8(10);
        log(`[event] set=${cs} cmd=${ci}`);
        if(cs===64&&ci===100){ // Composite
          global.gotEvent=true;
          global.eventData=pkt.slice(11);
        }
      }
    }
  }
}

function sendCommand(socket,cmdSet,cmdId,data=Buffer.alloc(0),timeoutMs=10000){
  return new Promise((resolve,reject)=>{
    const id=nextId++;
    const totalLen=11+data.length;
    const pkt=Buffer.alloc(totalLen);
    pkt.writeUInt32BE(totalLen,0);
    pkt.writeUInt32BE(id,4);
    pkt.writeUInt8(0,8);
    pkt.writeUInt8(cmdSet,9);
    pkt.writeUInt8(cmdId,10);
    data.copy(pkt,11);
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`cmd ${cmdSet}/${cmdId} timeout`))},timeoutMs);
    pending.set(id,{resolve,reject,timer});
    socket.write(pkt);
  });
}

(async()=>{
  let socket;
  try{
    log('连接 JDWP 15600...');
    socket=net.connect({host:'127.0.0.1',port:15600},()=>{
      socket.write('JDWP-Handshake');
    });
    
    await new Promise((resolve,reject)=>{
      let hs='';
      const onData=(d)=>{
        hs+=d.toString('ascii');
        if(hs.length>=14){
          socket.removeListener('data',onData);
          if(hs.startsWith('JDWP-Handshake')){
            socket.on('data',(chunk)=>{
              rxBuffer=Buffer.concat([rxBuffer,chunk]);
              processData();
            });
            resolve();
          } else reject(new Error('bad hs'));
        }
      };
      socket.on('data',onData);
      setTimeout(()=>reject(new Error('hs t/o')),5000);
    });
    log('✅ Handshake OK');
    
    // Resume VM first (suspend=y 启动)
    await sendCommand(socket,1,9);
    log('VM Resumed, 等待类加载...');
    await new Promise(r=>setTimeout(r,2000)); // 等2秒让类加载
    
    const ver=await sendCommand(socket,1,1);
    const dlen=ver.readUInt32BE(0);
    log(`✅ VM: ${ver.slice(4,4+dlen).toString('utf8').split('\n')[0]}`);
    
    const allCls=await sendCommand(socket,1,20);
    let off=4;
    const cnt=allCls.readUInt32BE(0);off+=4;
    log(`Classes: ${cnt}`);
    let sdTypeId=null;
    const samples=[];
    for(let i=0;i<cnt;i++){
      if(off+21>allCls.length)break;
      off+=1; // tag
      const tid=allCls.readBigUInt64BE(off);off+=8;
      const sl=allCls.readUInt32BE(off);off+=4;
      if(off+sl>allCls.length){log(`out of range at ${i}`);break;}
      const sig=allCls.slice(off,off+sl).toString();off+=sl;
      const gsl=allCls.readUInt32BE(off);off+=4;
      off+=gsl+4;
      if(samples.length<8)samples.push(sig.slice(0,50));
      if(sig.includes('SimpleDebug')||sig.includes('Simple')){
        sdTypeId=tid;
        log(`✅ Found! typeId=0x${tid.toString(16)} sig="${sig}"`);
        break;
      }
    }
    log(`first samples: ${samples.join(' | ')}`);
    if(!sdTypeId)throw new Error(`SimpleDebug not found in ${cnt} classes`);
    
    // Methods
    const mBuf=Buffer.alloc(8);
    mBuf.writeBigUInt64BE(sdTypeId,0);
    const methods=await sendCommand(socket,2,15,mBuf);
    off=0;
    const mCnt=methods.readUInt32BE(off);off+=4;
    let mainMethodId=null;
    for(let i=0;i<mCnt;i++){
      const mid=methods.readBigUInt64BE(off);off+=8;
      const nlen=methods.readUInt32BE(off);off+=4;
      const name=methods.slice(off,off+nlen).toString();off+=nlen;
      const slen=methods.readUInt32BE(off);off+=4;
      off+=slen;
      const gslen=methods.readUInt32BE(off);off+=4;
      off+=gslen+4;
      if(name==='main'){mainMethodId=mid;log(`✅ main methodId=0x${mid.toString(16)}`);}
    }
    if(!mainMethodId)throw new Error('main not found');
    
    // 设置断点
    const bpData=Buffer.alloc(6+27);
    let bo=0;
    bpData.writeUInt8(2,bo);bo+=1;
    bpData.writeUInt8(2,bo);bo+=1;
    bpData.writeUInt32BE(1,bo);bo+=4;
    bpData.writeUInt8(7,bo);bo+=1;
    bpData.writeUInt8(1,bo);bo+=1;
    bpData.writeBigUInt64BE(sdTypeId,bo);bo+=8;
    bpData.writeBigUInt64BE(mainMethodId,bo);bo+=8;
    bpData.writeBigUInt64BE(BigInt(0),bo);bo+=8;
    
    const bpResp=await sendCommand(socket,15,10,bpData);
    const reqId=bpResp.readUInt32BE(0);
    log(`✅ 断点设置成功! requestId=${reqId}`);
    
    log('等待断点命中（main 可能已执行过，等 sleep 循环）...');
    
    // 等待 Composite event
    global.gotEvent=false;
    for(let i=0;i<150;i++){
      await new Promise(r=>setTimeout(r,100));
      if(global.gotEvent){
        log('\n🎉🎉🎉 断点命中！JVM 调试功能完全正常！ 🎉🎉🎉');
        break;
      }
    }
    
    socket.destroy();
    log(`\n结果: ${global.gotEvent?'PASS':'FAIL (未在15秒内命中)'}`);
    process.exit(global.gotEvent?0:1);
    
  }catch(e){
    console.error('FAIL:',e.message);
    if(socket)socket.destroy();
    process.exit(1);
  }
})();
