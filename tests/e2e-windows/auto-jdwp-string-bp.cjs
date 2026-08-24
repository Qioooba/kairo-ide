// 测试 JVM 系统类的断点是否可用 — 排除类加载器因素
const net=require('net');
const log=m=>console.log(m);
let nextId=1;const pending=new Map();let rxBuffer=Buffer.alloc(0);

function processData(){
  while(rxBuffer.length>=11){
    const len=rxBuffer.readUInt32BE(0);if(rxBuffer.length<len)break;
    const pkt=rxBuffer.slice(0,len);rxBuffer=rxBuffer.slice(len);
    const id=pkt.readUInt32BE(4);const flags=pkt.readUInt8(8);
    const w=pending.get(id);
    if(w){clearTimeout(w.timer);pending.delete(id);
      if(flags&0x80){const err=pkt.readUInt16BE(9);
        if(err===0)w.resolve(pkt.slice(11));else{const e=new Error(`JDWP err ${err}`);e.code=err;w.reject(e);}
      } else {
        const cs=pkt.readUInt8(9),ci=pkt.readUInt8(10);
        if(cs===64&&ci===100)global.gotEvent=true;
      }
    }
  }
}
function cmd(socket,cs,ci,data=Buffer.alloc(0),tmo=8000){
  return new Promise((res,rej)=>{
    const id=nextId++;const total=11+data.length;
    const pkt=Buffer.alloc(total);pkt.writeUInt32BE(total,0);pkt.writeUInt32BE(id,4);
    pkt.writeUInt8(0,8);pkt.writeUInt8(cs,9);pkt.writeUInt8(ci,10);data.copy(pkt,11);
    const t=setTimeout(()=>{pending.delete(id);rej(new Error(`t/o ${cs}/${ci}`))},tmo);
    pending.set(id,{resolve:res,reject:rej,timer:t});socket.write(pkt);
  });
}

(async()=>{
  let socket;
  const PORT=parseInt(process.argv[2]||'15601');
  try{
    socket=net.connect({host:'127.0.0.1',port:PORT},()=>socket.write('JDWP-Handshake'));
    await new Promise((res,rej)=>{
      let hs='';
      const fn=(d)=>{hs+=d.toString('ascii');if(hs.length>=14){socket.removeListener('data',fn);
        if(hs.startsWith('JDWP-Handshake')){socket.on('data',(c)=>{rxBuffer=Buffer.concat([rxBuffer,c]);processData();});res();}
        else rej(new Error('bad hs'));}};
      socket.on('data',fn);setTimeout(()=>rej(new Error('hs t/o')),4000);
    });
    log(`✅ Handshake OK port=${PORT}`);
    
    // Resume
    await cmd(socket,1,9).catch(()=>{});
    
    // 找 java.lang.String — 使用 ClassesBySignature 更可靠
    const sigBytes=Buffer.from('Ljava/lang/String;');
    const cbsBuf=Buffer.alloc(4+4+sigBytes.length);
    cbsBuf.writeUInt32BE(1,0);
    cbsBuf.writeUInt32BE(sigBytes.length,4);
    sigBytes.copy(cbsBuf,8);
    let strTypeId=null;
    try{
      const cbsResp=await cmd(socket,1,2,cbsBuf);
      const cbsCnt=cbsResp.readUInt32BE(0);
      log(`ClassesBySignature for String: ${cbsCnt}`);
      if(cbsCnt>0){
        strTypeId=cbsResp.readBigUInt64BE(5); // tag(1) + start of typeId
      }
    }catch(e){log(`CBS err: ${e.message}`);}
    
    if(!strTypeId){
      // 回退到 AllClasses
      const allCls=await cmd(socket,1,20,null,20000);
      if(!allCls||!allCls.length)throw new Error('AllClasses returned empty');
      let off=4;const cnt=allCls.readUInt32BE(off);off+=4;
      log(`AllClasses count: ${cnt}`);
      for(let i=0;i<cnt;i++){
        if(off+21>allCls.length)break;
        off+=1;const tid=allCls.readBigUInt64BE(off);off+=8;
        const sl=allCls.readUInt32BE(off);off+=4;if(off+sl>allCls.length)break;
        const sig=allCls.slice(off,off+sl).toString();off+=sl;
        const gsl=allCls.readUInt32BE(off);off+=4;off+=gsl+4;
        if(sig==='Ljava/lang/String;'){strTypeId=tid;break;}
      }
    }
    if(!strTypeId){log('❌ String not found');process.exit(1);}
    log(`✅ String typeId=0x${strTypeId.toString(16)}`);
    
    // 找 String.length() 方法
    const mBuf=Buffer.alloc(8);mBuf.writeBigUInt64BE(strTypeId,0);
    const methods=await cmd(socket,2,15,mBuf);
    if(!methods || methods.length<4){throw new Error('Methods returned null/empty');}
    off=0;const mCnt=methods.readUInt32BE(off);off+=4;
    log(`String methods: ${mCnt}`);
    let lenMethodId=null;
    for(let i=0;i<mCnt;i++){
      if(off+24>methods.length)break;
      const mid=methods.readBigUInt64BE(off);off+=8;
      const nlen=methods.readUInt32BE(off);off+=4;
      if(off+nlen>methods.length)break;
      const name=methods.slice(off,off+nlen).toString();off+=nlen;
      const slen2=methods.readUInt32BE(off);off+=4;
      if(off+slen2>methods.length)break;
      off+=slen2;
      const gsl2=methods.readUInt32BE(off);off+=4;
      off+=gsl2;
      off+=4;
      log(`  method "${name}"`);
      if(name==='length'){lenMethodId=mid;break;}
    }
    if(!lenMethodId)throw new Error('length not found');
    
    // 设置断点
    const bpData=Buffer.alloc(33);let bo=0;
    bpData.writeUInt8(2,bo);bo+=1;
    bpData.writeUInt8(2,bo);bo+=1;
    bpData.writeUInt32BE(1,bo);bo+=4;
    bpData.writeUInt8(7,bo);bo+=1;
    bpData.writeUInt8(1,bo);bo+=1;
    bpData.writeBigUInt64BE(strTypeId,bo);bo+=8;
    bpData.writeBigUInt64BE(lenMethodId,bo);bo+=8;
    bpData.writeBigUInt64BE(BigInt(0),bo);bo+=8;
    
    try{
      const bpResp=await cmd(socket,15,10,bpData);
      const reqId=bpResp.readUInt32BE(0);
      log(`✅✅✅ 断点设置成功! requestId=${reqId} — 系统类断点完全正常！`);
      log('\n结论: JDWP 断点功能本身正常，问题出在 Tomcat6 的 WebappClassLoader 加载的类');
      process.exit(0);
    }catch(e){
      log(`❌ 断点设置失败: ${e.message}`);
      
      // 如果 String 类也不行，说明是 JVM 本身的问题
      if(e.code===99){
        log('\n结论: 连系统类都无法设断点 → JDWP EventRequest/Set 在此 JVM 上确实未实现');
        log('可能原因: Java 21 的 JDWP agent 在某些模式下限制了事件请求');
      }
      process.exit(1);
    }
  }catch(e){
    console.error('FAIL:',e.message);
    process.exit(1);
  }
})();
