const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const runtime = require('./runtime');

function location(user) {
  const base=runtime.dataDir();
  const dir=base?path.join(base,'users'):path.join(os.homedir(),'Library','Application Support','CampusBalance','users');
  const key=crypto.createHash('sha256').update(user).digest('hex');
  return {dir,file:path.join(dir,key+'.json')};
}
function read(user) {
  try {
    const x=JSON.parse(fs.readFileSync(location(user).file,'utf8'));
    return validate(x);
  } catch { return {dorm:'',lighting:'',air:'',historyOwner:''}; }
}
function validate(input) {
  const x={dorm:String(input?.dorm||'').trim(),lighting:String(input?.lighting||'').trim(),air:String(input?.air||'').trim(),historyOwner:String(input?.historyOwner||'').trim()};
  if (x.dorm.length>60 || /[\u0000-\u001f]/.test(x.dorm) || !/^(?:\d{1,30})?$/.test(x.lighting) || !/^(?:\d{1,30})?$/.test(x.air) || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)?$/.test(x.historyOwner)) throw new Error('宿舍信息格式不正确');
  return x;
}
function write(user,input) {
  const value=validate(input), {dir,file}=location(user);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600});fs.renameSync(temporary,file);
  return value;
}
module.exports={read,write,validate};
