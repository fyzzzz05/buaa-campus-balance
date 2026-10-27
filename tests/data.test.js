const {test}=require('node:test');
const assert=require('node:assert/strict');
const campus=require('../lib/campus'),session=require('../lib/session');
const handler=require('../api/data');

test('expired card login remains visible instead of being labelled as an estimate',async t=>{
  t.mock.method(session,'read',()=>({user:'testuser',jar:{}}));
  t.mock.method(session,'write',()=>{});
  t.mock.method(campus,'card',async()=>({status:'login_required',note:'请重新登录'}));
  t.mock.method(campus,'network',async()=>({status:'ok',value:1}));
  t.mock.method(campus,'electricity',async()=>({lighting:{status:'unavailable'},air:{status:'unavailable'}}));
  let result;const res={setHeader(){},status(){return this},json(v){result=v;return v}};
  await handler({method:'GET',headers:{}},res);
  assert.equal(result.data.card.status,'login_required');
  assert.equal(result.data.card.note,'请重新登录');
  assert.equal(result.data.card.historyNote,undefined);
});
