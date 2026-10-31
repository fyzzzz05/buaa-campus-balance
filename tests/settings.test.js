const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const runtime=require('../lib/runtime');
const settings=require('../lib/settings');
test('dorm settings are isolated by account and validate meter identifiers',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campus-settings-'));
  runtime.configure({dataDir:dir});
  t.after(()=>{runtime.reset();fs.rmSync(dir,{recursive:true,force:true})});
  settings.write('testuser1',{dorm:'一号楼',lighting:'123',air:'456',historyOwner:'student'});
  assert.equal(settings.read('testuser1').lighting,'123');
  assert.equal(settings.read('testuser2').lighting,'');
  assert.throws(()=>settings.write('testuser2',{lighting:'../123'}));
  assert.throws(()=>settings.write('testuser2',{historyOwner:'../other'}));
});
