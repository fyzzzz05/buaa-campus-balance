// Only these four display values cross the app/widget boundary.
// School cookies, account identifiers, transaction records and credentials do not.
function createSnapshot(data, now = new Date()) {
  const updatedAt=now.toISOString();
  const item=(value,unit)=>{
    if (value?.status!=='ok' || !Number.isFinite(value.value) || value.value<0) return {value:null,note:'暂不可用',updatedAt:null};
    let note=unit==='network' && /^本期已用 \d+(?:\.\d+)? GB$/.test(value.note || '') ? value.note :
      unit==='power' && /^截至 \d{4}-\d{2}-\d{2}/.test(value.note || '') ? value.note.slice(0,13) : '当前余额';
    return {value:value.value,note,updatedAt};
  };
  return {updatedAt,card:item(data.card,'card'),network:item(data.net,'network'),lighting:item(data.lighting,'power'),air:item(data.air,'power')};
}
async function send(payload) {
  const helper=process.env.CAMPUS_WIDGET_HELPER;
  if (process.env.CAMPUS_APP!=='1' || !helper) return;
  const {spawn}=require('node:child_process');
  await new Promise((resolve,reject)=>{
    const child=spawn(helper,[],{stdio:['pipe','ignore','ignore']});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Widget storage timeout'))},3000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Widget storage unavailable'))});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Widget storage unavailable'))});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
  });
}
async function publish(data){await send(createSnapshot(data));}
async function clear(){await send({action:'clear'});}
module.exports={createSnapshot,publish,clear};
