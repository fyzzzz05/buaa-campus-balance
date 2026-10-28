const {test}=require('node:test');
const assert=require('node:assert/strict');
const {refresh}=require('../widget-refresh');
const {makePlist}=require('../lib/widget-agent');

test('widget refresh reads the opted-in account and queries balances without requesting histories',async()=>{
  const calls=[],current={user:'student',jar:{}};
  const deps={
    credentials:{read:async u=>{calls.push(['credentials',u]);return 'test-password'}},
    campus:{login:async(u,p,same)=>{assert.equal(p,'test-password');assert.equal(same,true);return current},
      card:async(c,o)=>{assert.equal(c,current);assert.equal(o.balanceOnly,true);return {status:'ok',value:1}},
      network:async(c,o)=>{assert.equal(c,current);assert.equal(o.balanceOnly,true);return {status:'ok',value:2}},
      electricity:async()=>({lighting:{status:'ok',value:3},air:{status:'ok',value:4}})},
    settings:{read:u=>{assert.equal(u,'student');return {}}},
    widget:{publish:async data=>calls.push(['publish',data])}
  };
  const result=await refresh({user:'student',networkSamePassword:true},deps);
  assert.equal(result.card.value,1);assert.equal(result.air.value,4);assert.equal(calls.at(-1)[0],'publish');
  assert(!JSON.stringify(calls.at(-1)).includes('test-password'));
});

test('scheduled widget refresh configuration escapes paths and contains no credentials',()=>{
  const body=makePlist('/tmp/a&b/node','/tmp/a&b/worker.js','/tmp/a&b/helper');
  assert(body.includes('/tmp/a&amp;b/node'));assert(body.includes('<key>StartCalendarInterval</key>'));
  assert(!body.includes('password'));assert(!body.includes('student'));
});
