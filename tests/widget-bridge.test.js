const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process');
test('widget bridge serves only authenticated local snapshot',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'widget-bridge-')),token='a'.repeat(64);
 const folder=path.join(dir,'Library','Application Support','CampusBalance');fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'widget-snapshot.json'),JSON.stringify({card:{value:12}}));
 const tokenFile=path.join(dir,'token');fs.writeFileSync(tokenFile,token);
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const executable=process.env.CAMPUS_NATIVE_BRIDGE || process.execPath;
 const args=process.env.CAMPUS_NATIVE_BRIDGE ? [tokenFile] : [path.join(__dirname,'../widget-bridge.js'),tokenFile];
 const child=spawn(executable,args,{env:{...process.env,HOME:dir,CAMPUS_WIDGET_BRIDGE_PORT:String(port)},stdio:'ignore'});
 t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true})});
 let response;for(let i=0;i<30;i++){try{response=await fetch(`http://127.0.0.1:${port}/snapshot`);break}catch{await new Promise(r=>setTimeout(r,20))}}
 assert(response);assert.equal(response.status,404);
 response=await fetch(`http://127.0.0.1:${port}/snapshot`,{headers:{Authorization:'Bearer '+token}});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{card:{value:12}});
});

test('native widget refresh authenticates, coalesces requests and reports failures without blocking snapshots',
 {skip:!process.env.CAMPUS_NATIVE_BRIDGE},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'widget-refresh-bridge-'));
 const folder=path.join(dir,'Library','Application Support','CampusBalance');fs.mkdirSync(folder,{recursive:true});
 const bin=path.join(dir,'bin');fs.mkdirSync(bin);
 const executable=path.join(bin,'CampusWidgetBridge');fs.copyFileSync(process.env.CAMPUS_NATIVE_BRIDGE,executable);fs.chmodSync(executable,0o700);
 const token='b'.repeat(64),tokenFile=path.join(dir,'token');fs.writeFileSync(tokenFile,token);
 const snapshot=path.join(folder,'widget-snapshot.json'),account=path.join(folder,'widget-account.json');
 fs.writeFileSync(snapshot,JSON.stringify({card:{value:12}}));
 fs.writeFileSync(path.join(bin,'CampusWidgetSnapshot'),'#!/bin/sh\nexit 0\n',{mode:0o700});
 fs.writeFileSync(path.join(bin,'CampusWidgetRefresh'),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const folder=path.join(process.env.HOME,'Library','Application Support','CampusBalance');
if(fs.realpathSync(process.env.CAMPUS_WIDGET_HELPER)!==fs.realpathSync(path.join(__dirname,'CampusWidgetSnapshot')))process.exit(2);
fs.appendFileSync(path.join(folder,'calls'),'refresh\\n');
setTimeout(()=>{
 if(fs.existsSync(path.join(folder,'fail')))process.exit(1);
 fs.writeFileSync(path.join(folder,'widget-snapshot.json'),JSON.stringify({card:{value:99}}));
},400);
`,{mode:0o700});
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(executable,[tokenFile],{env:{...process.env,HOME:dir,CAMPUS_WIDGET_BRIDGE_PORT:String(port)},stdio:'ignore'});
 t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true})});
 const base=`http://127.0.0.1:${port}`,headers={Authorization:'Bearer '+token};
 let ready=false;
 for(let i=0;i<60;i++){try{await fetch(base+'/snapshot');ready=true;break}catch{await new Promise(r=>setTimeout(r,20))}}
 assert(ready,'native bridge started');
 const request=(overrides={})=>fetch(base+'/refresh',{method:'POST',headers,...overrides});
 assert.equal((await request({headers:{}})).status,404);
 assert.equal((await request({headers:{...headers,Origin:'https://example.com'}})).status,404);
 const invalidHost=await new Promise((resolve,reject)=>{
  require('node:http').request(base+'/refresh',{method:'POST',headers:{...headers,Host:'example.com'}},res=>{
   res.resume();resolve(res.statusCode);
  }).on('error',reject).end();
 });
 assert.equal(invalidHost,404);
 assert.equal((await request({method:'GET'})).status,404);
 assert.equal((await request()).status,409,'refresh needs an opted-in account');
 assert(!fs.existsSync(path.join(folder,'calls')),'rejected requests never execute the worker');
 fs.writeFileSync(account,JSON.stringify({user:'student',networkSamePassword:true}));
 const first=request(),second=request();
 // A long-running refresh must not block reading the last good snapshot.
 const during=await fetch(base+'/snapshot',{headers});assert.deepEqual(await during.json(),{card:{value:12}});
 assert.deepEqual((await Promise.all([first,second])).map(r=>r.status),[200,200]);
 assert.equal(fs.readFileSync(path.join(folder,'calls'),'utf8'),'refresh\n','overlapping clicks share one worker');
 const fresh=await fetch(base+'/snapshot',{headers});assert.deepEqual(await fresh.json(),{card:{value:99}});
 fs.writeFileSync(path.join(folder,'fail'),'1');
 assert.equal((await request()).status,503,'failed worker is not reported as success');
 const afterFailure=await fetch(base+'/snapshot',{headers});assert.deepEqual(await afterFailure.json(),{card:{value:99}});
 fs.rmSync(path.join(folder,'fail'));
 assert.equal((await request()).status,200,'refresh can recover after a worker failure');
});
