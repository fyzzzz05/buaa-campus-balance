const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {recentDays} = require('./campus');

// Balance snapshots are estimates, never transaction records. Missing days and
// increases stay unknown rather than being presented as zero expenditure.
function capture(card, user, now = new Date()) {
  if ((process.env.CAMPUS_APP !== '1' && process.env.CAMPUS_WEB !== '1') || card.status !== 'ok') return card;
  const dir = path.join(os.homedir(), 'Library', 'Application Support', 'CampusBalance');
  const file = path.join(dir, 'card-balance-'+crypto.createHash('sha256').update(user).digest('hex')+'.json');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  let history = {};
  for (const candidate of [file,path.join(dir,'card-balance.json')]) {
    try { const parsed=JSON.parse(fs.readFileSync(candidate,'utf8')); if (parsed.user === user && parsed.days && typeof parsed.days === 'object') { history=parsed.days; break; } } catch {}
  }
  const date=recentDays(1,now)[0];
  history[date] = card.value;
  const entries=Object.entries(history).filter(([key,value])=>/^\d{4}-\d\d-\d\d$/.test(key) && Number.isFinite(value) && value >= 0).sort(([a],[b])=>a.localeCompare(b)).slice(-90);
  history=Object.fromEntries(entries);
  const temporary=file+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify({user,days:history}),{mode:0o600});
  fs.renameSync(temporary,file);
  const days=recentDays(15,now);
  card.history=days.slice(1).map((day,i)=>{
    const before=history[days[i]], after=history[day];
    return {date:day,value:Number.isFinite(before) && Number.isFinite(after) && before>=after ? Math.round((before-after)*100)/100 : null};
  });
  card.historyNote='余额减少估算 · 元';
  card.records=card.history.filter(item=>item.value !== null).slice().reverse().map(item=>({label:'余额减少估算',date:item.date,value:`¥${item.value.toFixed(2)}`}));
  card.emptyNote='暂无消费明细';
  return card;
}
module.exports = {capture};
