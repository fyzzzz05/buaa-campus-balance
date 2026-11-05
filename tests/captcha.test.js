const {test}=require('node:test');
const assert=require('node:assert/strict');
const campus=require('../lib/campus');
const form=(id=null,execution='flow')=>`<form id="loginForm" action="/login"><input name="execution" value="${execution}"><input name="type" value="username_password"><input name="_eventId" value="submit">${id?'<input name="captcha">':''}</form>${id?`<script>config.captcha = { id: '${id}' };</script>`:''}`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
function reply(status,body='',{location,type='text/html',cookies=[]}={}) {
  return {status,headers:{get:name=>name==='location'?location:name==='content-type'?type:null,getSetCookie:()=>cookies},text:async()=>body,arrayBuffer:async()=>png};
}
function schoolMock(t,html,onSubmit) {
  const calls=[];
  t.mock.method(globalThis,'fetch',async(raw,options)=>{
    const url=new URL(raw);calls.push({url,options});
    if(url.host==='www.cc-pay.cn'&&url.pathname==='/login')return reply(302,'',{location:'https://sso.buaa.edu.cn/login?service=registered'});
    if(url.pathname==='/captcha')return reply(200,'',{type:'image/png'});
    if(url.host==='sso.buaa.edu.cn'&&options.method==='POST')return onSubmit?.(url,options)||reply(302,'',{location:'https://www.cc-pay.cn/done'});
    if(url.host==='sso.buaa.edu.cn')return reply(200,html,{cookies:['test-sso=same-session; Path=/; Secure; HttpOnly']});
    if(url.pathname==='/api/user')return reply(200,JSON.stringify({success:true,data:{account:'verified'}}));
    return reply(200,'signed in');
  });return calls;
}

test('CAPTCHA image and submission reuse the form execution and school cookies; challenges are single use',async t=>{
  const calls=schoolMock(t,form('school-captcha-id'));
  const challenge=await campus.beginLogin();
  assert.equal(challenge.required,true);assert.match(challenge.image,/^data:image\/png;base64,/);
  assert(!JSON.stringify(challenge).includes('school-captcha-id'));
  const image=calls.find(c=>c.url.pathname==='/captcha');
  assert.equal(image.url.searchParams.get('captchaId'),'school-captcha-id');
  assert.match(image.options.headers.cookie,/test-sso=same-session/);
  const session=await campus.login('testuser','p+&secret',false,{challengeId:challenge.challengeId,captcha:' AbC2 '});
  const submission=calls.find(c=>c.options.method==='POST');
  const fields=new URLSearchParams(submission.options.body);
  assert.equal(fields.get('execution'),'flow');assert.equal(fields.get('captcha'),'abc2');assert.equal(fields.get('password'),'p+&secret');
  assert.match(submission.options.headers.cookie,/test-sso=same-session/);
  assert.equal(session.user,'testuser');assert(!JSON.stringify(session).includes('p+&secret'));
  await assert.rejects(campus.login('testuser','secret',false,{challengeId:challenge.challengeId,captcha:'abc2'}),{code:'LOGIN_CHALLENGE_EXPIRED'});
});

test('refresh invalidates the previous challenge and expired challenges never submit credentials',async t=>{
  const calls=schoolMock(t,form('school-captcha-id'));
  const first=await campus.beginLogin(),next=await campus.beginLogin(first.challengeId);
  await assert.rejects(campus.login('testuser','secret',false,{challengeId:first.challengeId,captcha:'1234'}),{code:'LOGIN_CHALLENGE_EXPIRED'});
  const now=Date.now();t.mock.method(Date,'now',()=>now+301000);
  await assert.rejects(campus.login('testuser','secret',false,{challengeId:next.challengeId,captcha:'1234'}),{code:'LOGIN_CHALLENGE_EXPIRED'});
  assert(!calls.some(c=>c.options.method==='POST'));
});

test('a 401 response can introduce CAPTCHA and supplies a retry form from the same school session',async t=>{
  const calls=schoolMock(t,form(),()=>reply(401,form('new-captcha','retry-flow')+'<div id="errorDiv"><p>请输入验证码 secret-account</p></div>'));
  const initial=await campus.beginLogin();assert.equal(initial.required,false);assert.equal(initial.image,null);
  let retry;
  await assert.rejects(campus.login('testuser','secret',false,{challengeId:initial.challengeId}),error=>{
    assert.equal(error.code,'VERIFICATION_REQUIRED');retry=error.challenge;return true;
  });
  assert.equal(retry.required,true);assert.notEqual(retry.challengeId,initial.challengeId);
  assert(!JSON.stringify(retry).includes('secret-account'));
  await assert.rejects(campus.login('testuser','secret',false,{challengeId:retry.challengeId,captcha:'1234'}),{code:'VERIFICATION_REQUIRED'});
  const submissions=calls.filter(c=>c.options.method==='POST');
  assert.equal(new URLSearchParams(submissions[1].options.body).get('execution'),'retry-flow');
  assert.equal(calls.filter(c=>c.url.host==='www.cc-pay.cn'&&c.url.pathname==='/login').length,1);
});

test('automatic login stops before posting a password when school requires CAPTCHA',async t=>{
  const calls=schoolMock(t,form('required-captcha'));
  await assert.rejects(campus.login('testuser','secret'),{code:'VERIFICATION_REQUIRED'});
  assert(!calls.some(c=>c.options.method==='POST'));
});

test('CAPTCHA endpoint enforces method and origin and never returns upstream HTML',async t=>{
  const handler=require('../api/auth/captcha');
  schoolMock(t,form('required-captcha'));
  async function call(method,origin){const res={headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(value){this.value=value;return this}};await handler({method,headers:{host:'127.0.0.1:4173',origin},body:{}},res);return res}
  assert.equal((await call('GET')).code,405);
  assert.equal((await call('POST','https://outside.example')).code,403);
  const response=await call('POST','http://127.0.0.1:4173');assert.equal(response.code,200);assert.equal(response.headers['Cache-Control'],'no-store');
  assert.deepEqual(Object.keys(response.value).sort(),['challengeId','image','required']);
});
