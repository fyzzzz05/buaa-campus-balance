const {test} = require('node:test');
const assert = require('node:assert/strict');
const {CookieJar} = require('tough-cookie');
const campus = require('../lib/campus');

test('network history combines pages and groups traffic by settlement day', async t => {
  const day=campus.recentDays(1)[0];
  const table = (bytes) => `<div class="summary">第1-1条，共2条数据.</div><table><thead><tr><th>总流量</th></tr></thead><tbody><tr><td>start</td><td>${day} 04:30:00(虚拟下线)</td><td>mac</td><td>ip</td><td>${bytes}</td><td>G</td></tr></tbody></table>`;
  let page=0;
  t.mock.method(globalThis,'fetch',async()=>({status:200,headers:{getSetCookie:()=>[]},text:async()=>table(++page*1024**3)}));
  const result=await campus.networkHistory(new CookieJar());
  assert.equal(page,2);
  assert.equal(result.history.at(-1).value,3);
  assert.equal(result.records.length,2);
  assert.equal(result.historyNote,'按学校结算日 · GB');
});

test('incomplete pagination is never presented as complete daily usage', async t => {
  t.mock.method(globalThis,'fetch',async()=>({status:200,headers:{getSetCookie:()=>[]},text:async()=>'<div class="summary">共2条数据.</div><table><tr><th>总流量</th></tr></table>'}));
  await assert.rejects(campus.networkHistory(new CookieJar()),/Incomplete/);
});

test('electricity meters keep independent balances and daily estimates', async t => {
  const csv = 'date,key,meter_id,remaining_cny\n2026-10-24,lighting,123,20\n2026-10-25,lighting,123,19\n2026-10-26,lighting,123,25\n2026-10-24,air_conditioner,456,10\n2026-10-25,air_conditioner,456,9.5\n2026-10-26,air_conditioner,456,9.2\n';
  t.mock.method(globalThis,'fetch',async()=>({ok:true,text:async()=>csv}));
  const result=await campus.electricityHistory({historyOwner:'example',lighting:'123',air:'456'});
  assert.equal(result.lighting.value,25);
  assert.equal(result.air.value,9.2);
  assert.equal(result.lighting.history.at(-2).value,1);
  assert.equal(result.lighting.history.at(-1).value,null);
  assert.equal(result.air.history.at(-2).value,.5);
  assert.equal(result.air.history.at(-1).value,.3);
  const other=await campus.electricityHistory({historyOwner:'example',lighting:'999',air:'456'});
  assert.equal(other.lighting.status,'unavailable');
  assert.equal(other.air.value,9.2);
});

test('campus card history sums negative transactions in yuan and excludes top-ups', async t => {
  const day=campus.recentDays(1)[0], calls=[];
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(new URL(url));
    const rows=[{date:day+' 12:00:00',amount:-1733,merName:'食堂'}, {date:day+' 13:00:00',amount:5000,txName:'充值'}, {date:day+' 14:00:00',amount:-260,merName:'商店'}];
    return {status:200,headers:{getSetCookie:()=>[]},text:async()=>JSON.stringify({success:true,data:{data:rows,count:3}})};
  });
  const result=await campus.cardTrades(new CookieJar(),'12345678');
  assert.equal(result.history.at(-1).value,19.93);
  assert.equal(result.records.length,2);
  assert.equal(result.historySource,'transactions');
  assert.equal(calls[0].pathname,'/api/campus_card/trades');
});

test('incomplete card transaction pages do not produce partial totals', async t => {
  t.mock.method(globalThis,'fetch',async()=>({status:200,headers:{getSetCookie:()=>[]},text:async()=>JSON.stringify({success:true,data:{data:[],count:3}})}));
  await assert.rejects(campus.cardTrades(new CookieJar(),'12345678'),/Incomplete/);
});

test('card history handles the live service returning a zero count with rows', async t => {
  const day=campus.recentDays(1)[0];
  t.mock.method(globalThis,'fetch',async()=>({status:200,headers:{getSetCookie:()=>[]},text:async()=>JSON.stringify({success:true,data:{data:[{date:day+' 12:00:00',amount:-1733}],count:0,pageSize:100}})}));
  const result=await campus.cardTrades(new CookieJar(),'12345678');
  assert.equal(result.history.at(-1).value,17.33);
});

test('meter query checks the requested meter and its type', async t => {
  const html='<p>购电表号:123</p><p>地址:某楼[照明]</p><p>电价:0.5</p><p>截止 2026/10/27</p><svg id="canvas1"><text><tspan>20</tspan></text></svg>';
  t.mock.method(globalThis,'fetch',async()=>({ok:true,text:async()=>html}));
  assert.equal((await campus.meterReading('123','lighting')).value,10);
  await assert.rejects(campus.meterReading('123','air'),/mismatch/);
  await assert.rejects(campus.meterReading('456','lighting'),/mismatch/);
});
