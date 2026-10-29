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
