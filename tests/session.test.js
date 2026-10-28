const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SESSION_SECRET = 'example test secret that is longer than 32 characters';
process.env.ALLOWED_USER_ID = '20250001';
const session = require('../lib/session');
const campus = require('../lib/campus');

test('authenticated sessions are encrypted, authenticated and scoped to the owner', () => {
  const token = session.seal({ user:'20250001', jar:{cookies:[]}, netDigest:'sensitive-value' });
  assert(!token.includes('sensitive-value'));
  assert.equal(session.unseal(token).user,'20250001');
  const bytes = Buffer.from(token, 'base64url'); bytes[30] ^= 1;
  assert.equal(session.unseal(bytes.toString('base64url')), null);
  assert.equal(session.unseal(session.seal({user:'different-user'})), null);
});

test('a missing or incomplete cookie never creates a session', () => {
  assert.equal(session.read({headers:{}}),null);
  assert.equal(session.read({headers:{cookie:'campus_session_count=2; campus_session_0=abc'}}),null);
});

test('automatic login extends only the local encrypted session',()=>{
  let headers;const res={setHeader(k,v){if(k==='Set-Cookie')headers=v}};
  session.write(res,{user:'20250001',jar:{cookies:[]},autoLogin:true});
  assert(headers[0].includes('Max-Age=2592000'));
  const decoded=session.unseal(session.seal({user:'20250001',autoLogin:true}));
  assert(decoded.exp>Date.now()+29*24*60*60*1000);
});

test('network quotas are read from the actual table, not from labels elsewhere', () => {
  const html = '<table><thead><tr><th>已用流量</th><th>免费流量剩余</th><th>计费流量剩余</th></tr></thead><tbody><tr><td>35.774G</td><td>34.226G</td><td>40.000G</td></tr></tbody></table>';
  assert.deepEqual(campus.quota(html),{used:35.774,free:34.226,paid:40});
  assert.equal(campus.quota('登录 免费流量剩余'),null);
});

test('sensitive upstream requests refuse redirects to unrelated domains', async () => {
  const {CookieJar} = require('tough-cookie');
  await assert.rejects(campus.request(new CookieJar(), 'https://example.com/'),/Unexpected redirect/);
});

test('only an authenticated school account yields a session; password is not retained', async (t) => {
  process.env.NETWORK_AUTH_SAME_PASSWORD = 'true';
  const school = '<form id="loginForm" action="login"><input name="execution" value="flow"><input name="type" value="username_password"><input name="_eventId" value="submit"></form>';
  const reply = (status,body='',location=null) => ({status,headers:{get:k=>k==='location'?location:null,getSetCookie:()=>[]},text:async()=>body});
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
    calls.push({url:String(url),method:opts.method,body:opts.body});
    if(calls.length===1)return reply(302,'','https://sso.buaa.edu.cn/login?service=registered');
    if(calls.length===2)return reply(200,school);
    if(calls.length===3)return reply(302,'','https://www.cc-pay.cn/login');
    if(calls.length===4)return reply(200,'signed in');
    return reply(200,JSON.stringify({success:true,data:{account:'verified'}}));
  });
  const result=await campus.login('20250001','test-password');
  assert.equal(result.user,'20250001');
  assert.equal(calls[2].method,'POST');
  assert.match(calls[2].body,/password=test-password/);
  assert(!JSON.stringify(result).includes('test-password'));
  assert.equal(result.netDigest.length,32);
  delete process.env.NETWORK_AUTH_SAME_PASSWORD;
});

test('school login failures cannot issue a session', async (t) => {
  const reply = (status,body='',location=null) => ({status,headers:{get:k=>k==='location'?location:null,getSetCookie:()=>[]},text:async()=>body});
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{
    calls++;
    if(calls===1)return reply(302,'','https://sso.buaa.edu.cn/login?service=registered');
    if(calls===2)return reply(200,'<form id="loginForm" action="login"><input name="execution" value="flow"></form>');
    if(calls===3)return reply(200,'bad login');
    return reply(200,JSON.stringify({success:false,message:'login required'}));
  });
  await assert.rejects(campus.login('20250001','wrong-password'),/登录失败/);
});

test('school cookies must be validated by upstream before issuing a session', async t => {
  let count=0;
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
    count++;
    assert(!String(opts.headers.cookie || '').includes('outside=secret'));
    const payload = count===1 ? {success:true,data:{account:'20250001'}} : {success:true,data:[{stuNo:'20250001'}]};
    return {status:200,headers:{get:()=>null,getSetCookie:()=>[]},text:async()=>JSON.stringify(payload)};
  });
  const result=await campus.loginWithSchoolCookies([{domain:'.cc-pay.cn',name:'sid',value:'school-session',path:'/'},{domain:'evil.example',name:'outside',value:'secret',path:'/'}]);
  assert.equal(result.user,'20250001');
  assert.equal(result.netDigest,null);
  assert.equal(count,2);
});

test('native school-session endpoint rejects web and unauthenticated callers', async t => {
  const auth=require('../api/auth');
  const previous=process.env.CAMPUS_APP;
  process.env.CAMPUS_APP='1';
  t.after(()=>{if(previous===undefined)delete process.env.CAMPUS_APP;else process.env.CAMPUS_APP=previous});
  let status=0;
  const res={setHeader(){},status(code){status=code;return this},json(){}};
  await auth({method:'POST',headers:{},body:{action:'school-session',cookies:[]}},res);
  assert.equal(status,403);
  await auth({method:'POST',headers:{origin:'http://127.0.0.1', 'x-campus-native-token':process.env.SESSION_SECRET},body:{action:'school-session',cookies:[]}},res);
  assert.equal(status,403);
});
