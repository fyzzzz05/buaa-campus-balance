const {test}=require('node:test');
const assert=require('node:assert/strict');
const campus=require('../lib/campus'),session=require('../lib/session');
const handler=require('../api/data');
const credentials=require('../lib/credentials');

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

test('expired school card session is renewed using opted-in local keychain credentials',async t=>{
  const old=process.env.CAMPUS_WEB;process.env.CAMPUS_WEB='1';t.after(()=>{if(old===undefined)delete process.env.CAMPUS_WEB;else process.env.CAMPUS_WEB=old});
  const current={user:'testuser',jar:{},autoLogin:true,netDigest:'existing-digest'};
  t.mock.method(session,'read',()=>current);t.mock.method(session,'write',()=>{});
  let calls=0;t.mock.method(campus,'card',async()=>++calls===1?{status:'login_required'}:{status:'ok',historySource:'transactions',value:1});
  t.mock.method(credentials,'read',async user=>{assert.equal(user,'testuser');return 'test-password'});
  t.mock.method(campus,'login',async(user,password,networkSame)=>{assert.equal(user,'testuser');assert.equal(password,'test-password');assert.equal(networkSame,true);return {user,jar:{renewed:true},netDigest:'new-digest'}});
  t.mock.method(campus,'network',async()=>({status:'ok'}));t.mock.method(campus,'electricity',async()=>({}));
  let result;const res={setHeader(){},status(){return this},json(v){result=v;return v}};
  await handler({method:'GET',headers:{}},res);
  assert.equal(result.data.card.status,'ok');assert.equal(calls,2);assert.equal(current.autoLogin,true);assert.equal(current.jar.renewed,true);
});

test('automatic reauthentication failure prompts for login and preserves other services',async t=>{
  const old=process.env.CAMPUS_WEB;process.env.CAMPUS_WEB='1';t.after(()=>{if(old===undefined)delete process.env.CAMPUS_WEB;else process.env.CAMPUS_WEB=old});
  t.mock.method(session,'read',()=>({user:'testuser',jar:{},autoLogin:true}));t.mock.method(session,'write',()=>{});
  t.mock.method(campus,'card',async()=>({status:'login_required'}));t.mock.method(credentials,'read',async()=>{throw new Error('locked')});
  t.mock.method(campus,'network',async()=>({status:'ok'}));t.mock.method(campus,'electricity',async()=>({}));
  let result;const res={setHeader(){},status(){return this},json(v){result=v;return v}};
  await handler({method:'GET',headers:{}},res);
  assert.equal(result.data.card.status,'login_required');assert.equal(result.data.card.note,'自动登录失败，请重新登录');assert.equal(result.data.net.status,'ok');
});
