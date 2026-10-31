const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const diagnostics=require('../lib/diagnostics');
const {CampusIssue}=diagnostics;
const campus=require('../lib/campus');
const {CookieJar}=require('tough-cookie');

const reply=body=>({status:200,headers:{getSetCookie:()=>[]},text:async()=>body});
const quotaTable=value=>`<table><tr><th>已用流量</th><th>免费流量剩余</th><th>计费流量剩余</th></tr><tr><td>70G</td><td>${value}</td><td>40G</td></tr></table>`;

test('transport diagnostics preserve categories without serializing raw errors or authentication URLs',()=>{
  for(const [raw,code] of [['ECONNREFUSED','CONNECTION_FAILED'],['ETIMEDOUT','TIMEOUT'],['ENOTFOUND','DNS_FAILED'],['CERT_HAS_EXPIRED','TLS_FAILED']]) {
    const error=new Error('https://zfw.buaa.edu.cn/site/sso?data=secret-account-password-cookie');
    error.cause={code:raw,headers:{cookie:'secret-cookie'}};
    const diagnostic=diagnostics.describe(error,'networkAuth');
    assert.equal(diagnostic.code,code);assert.equal(diagnostic.port,443);
    assert.equal(diagnostic.transportCode,raw);
    assert.equal(diagnostic.endpoint,'https://zfw.buaa.edu.cn/site/sso');
    assert(!JSON.stringify(diagnostic).includes('secret'));
  }
  const unknown=diagnostics.describe(new Error('secret-password'),'injected-stage?secret');
  assert.equal(unknown.code,'UNKNOWN');assert.equal(unknown.stage,'unknown');assert(!JSON.stringify(unknown).includes('secret'));
  const http=diagnostics.describe(new CampusIssue('HTTP_ERROR',{httpStatus:503}),'networkBalance');
  assert.equal(http.httpStatus,503);assert.match(http.message,/503/);
});

test('unrecognized quota unit is distinguished from login failure and does not retry authentication',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return reply(quotaTable('unknown'))});
  await assert.rejects(campus.network({user:'testuser',netDigest:'digest',jar:new CookieJar().toJSON()}),{code:'QUOTA_VALUE_INVALID',field:'免费流量剩余'});
  assert.equal(calls,1);
  assert.throws(()=>campus.quota('<table><tr><td>new layout</td></tr></table>',true),{code:'QUOTA_TABLE_MISSING'});
});

test('an actual login page retries SSO once and reports authentication rather than parsing failure',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return reply('<form id="login-form"></form>')});
  const data=await campus.network({user:'testuser',netDigest:'digest',jar:new CookieJar().toJSON()});
  assert.equal(calls,3);assert.equal(data.status,'login_required');assert.equal(data.diagnostic.code,'LOGIN_REQUIRED');assert.equal(data.diagnostic.stage,'networkAuth');
});

test('a failed balance request reports HTTP status rather than treating the error page as a login',async t=>{
  t.mock.method(globalThis,'fetch',async()=>({status:503,headers:{getSetCookie:()=>[]},text:async()=>'<html>maintenance</html>'}));
  await assert.rejects(campus.network({user:'testuser',netDigest:'digest',jar:new CookieJar().toJSON()}),{code:'HTTP_ERROR',httpStatus:503});
});

test('missing electricity fields and transport errors stay visible when history fallback is configured',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).includes('raw.githubusercontent.com'))return {ok:true,text:async()=> 'date,key,meter_id,remaining_cny\n2026-10-31,lighting,123,10\n'};
    const error=new Error('secret upstream URL');error.cause={code:'ECONNREFUSED'};throw error;
  });
  const data=await campus.electricity({lighting:'123',air:'456',historyOwner:'example'});
  assert.equal(data.lighting.status,'ok');assert.equal(data.lighting.value,10);assert.equal(data.lighting.fallbackDiagnostic.code,'CONNECTION_FAILED');
  assert.equal(data.lighting.note,'截至 2026-10-31');assert.equal(data.air.status,'unavailable');assert.equal(data.air.diagnostic.stage,'airMeter');
  assert(!JSON.stringify(data).includes('secret'));
});

test('meter parser reports missing price separately from meter identity mismatches',async t=>{
  const html='<p>购电表号:123</p><p>地址:某楼[照明]</p><p>其他字段:0.5</p><svg id="canvas1"><tspan>20</tspan></svg>';
  t.mock.method(globalThis,'fetch',async()=>({ok:true,text:async()=>html}));
  await assert.rejects(campus.meterReading('123','lighting'),{code:'FIELD_MISSING',field:'电价'});
});

test('electricity falls back to HTTP only after a connection failure and accepts known school field aliases',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push(new URL(url).protocol);
    assert.equal(options.redirect,'manual');assert.equal(options.headers.cookie,undefined);
    if(new URL(url).protocol==='https:'){const error=new Error('refused');error.cause={code:'ECONNREFUSED'};throw error}
    return {ok:true,status:200,text:async()=>'<p>购电表号:123</p><p>地哈哈址:某楼[照明]</p><p>电哈哈价:0.5</p><p>[截止 2026/10/31 0:00:00]</p><svg id="canvas1"><tspan>20</tspan></svg>'};
  });
  const reading=await campus.meterReading('123','lighting');
  assert.deepEqual(calls,['https:','http:']);assert.equal(reading.value,10);assert.equal(reading.note,'截至 2026-10-31');
  assert.equal(reading.transportDiagnostic.code,'CONNECTION_FAILED');assert.equal(reading.transportDiagnostic.port,443);
});

test('TLS certificate failures do not trigger an HTTP downgrade',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;const error=new Error('certificate');error.cause={code:'CERT_HAS_EXPIRED'};throw error});
  await assert.rejects(campus.meterReading('123','lighting'),{code:'TLS_FAILED'});assert.equal(calls,1);
});

test('HTTP fallback failure is diagnosed as HTTP port 80',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    const error=new Error('no connection');error.cause={code:new URL(url).protocol==='https:'?'ECONNREFUSED':'ETIMEDOUT'};throw error;
  });
  const data=await campus.electricity({lighting:'123',air:'',historyOwner:''});
  assert.equal(data.lighting.diagnostic.code,'TIMEOUT');assert.equal(data.lighting.diagnostic.scheme,'http');assert.equal(data.lighting.diagnostic.port,80);
});

test('diagnostic files rotate and contain only sanitized records with private permissions',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'campus-diagnostics-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const target=path.join(directory,'diagnostics.ndjson');
  const error=new Error('account-password-cookie-secret');error.cause={code:'ECONNREFUSED'};
  diagnostics.write(diagnostics.describe(error,'electricityMeter'),directory);
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode&0o777,0o600);
  assert.equal(JSON.parse(fs.readFileSync(target,'utf8')).code,'CONNECTION_FAILED');
  assert(!fs.readFileSync(target,'utf8').includes('secret'));
  fs.appendFileSync(target,' '.repeat(262144));
  diagnostics.write(diagnostics.describe(new CampusIssue('HTTP_ERROR',{httpStatus:502}),'networkBalance'),directory);
  assert(fs.existsSync(target+'.1'));assert.equal(JSON.parse(fs.readFileSync(target,'utf8')).httpStatus,502);
});
