const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const settings=require('../lib/settings');
test('dorm settings are isolated by account and validate meter identifiers',t=>{
  const old=process.env.HOME,dir=fs.mkdtempSync(path.join(os.tmpdir(),'campus-settings-'));
  process.env.HOME=dir;t.after(()=>{process.env.HOME=old;fs.rmSync(dir,{recursive:true,force:true})});
  settings.write('testuser1',{dorm:'一号楼',lighting:'123',air:'456',historyOwner:'student'});
  assert.equal(settings.read('testuser1').lighting,'123');
  assert.equal(settings.read('testuser2').lighting,'');
  assert.throws(()=>settings.write('testuser2',{lighting:'../123'}));
  assert.throws(()=>settings.write('testuser2',{historyOwner:'../other'}));
});
