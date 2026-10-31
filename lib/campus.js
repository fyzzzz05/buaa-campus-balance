const { CookieJar } = require('tough-cookie');
const { load } = require('cheerio');
const crypto = require('node:crypto');
const { parse } = require('csv-parse/sync');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const diagnostics = require('./diagnostics');
const runtime = require('./runtime');
const {CampusIssue} = diagnostics;

function trace(event) {
  if (!runtime.traceEnabled()) return;
  try {
    const dir = runtime.logDir() || path.join(os.homedir(), 'Library', 'Logs', 'CampusBalance');
    fs.mkdirSync(dir, {recursive:true, mode:0o700});
    fs.appendFileSync(path.join(dir, 'auth.log'), JSON.stringify({time:new Date().toISOString(), ...event}) + '\n', {mode:0o600});
  } catch {}
}

const HOSTS = new Set(['www.cc-pay.cn', 'pass.cc-pay.cn', 'mall.cc-pay.cn', 'sso.buaa.edu.cn', 'zfw.buaa.edu.cn']);
const AGENT = 'Mozilla/5.0 (compatible; CampusBalance/1.0)';

async function request(jar, rawUrl, options = {}) {
  let url = new URL(rawUrl), method = options.method || 'GET', body = options.body;
  for (let i = 0; i < 8; i++) {
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port) { trace({event:'blocked_redirect',host:url.hostname}); throw new CampusIssue('REDIRECT_BLOCKED'); }
    const cookie = await jar.getCookieString(url.href);
    const headers = { 'user-agent': AGENT, 'accept': options.accept || 'text/html,application/json', ...(options.headers || {}) };
    if (cookie) headers.cookie = cookie;
    if (body && method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded';
    let response;
    try { response = await fetch(url, { method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(18000) }); }
    catch (err) { trace({event:'network_error',host:url.hostname,code:err.cause?.code || err.name}); throw diagnostics.withStage(err, url.hostname === 'sso.buaa.edu.cn' ? 'schoolLogin' : url.pathname === '/site/sso' ? 'networkAuth' : options.stage); }
    trace({event:'response',host:url.hostname,status:response.status});
    for (const item of response.headers.getSetCookie()) await jar.setCookie(item, url.href);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new CampusIssue('REDIRECT_BLOCKED');
      const next = new URL(location, url);
      if (body && [307,308].includes(response.status) && next.hostname !== url.hostname) throw new CampusIssue('REDIRECT_BLOCKED');
      if ([301,302,303].includes(response.status)) { method = 'GET'; body = undefined; }
      url = next;
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw diagnostics.withStage(new CampusIssue(response.status === 401 ? 'LOGIN_REQUIRED' : 'HTTP_ERROR',{httpStatus:response.status}),options.stage);
    const data = await response.text();
    if (data.length > 3_000_000) throw new CampusIssue('RESPONSE_TOO_LARGE');
    return { url: url.href, status: response.status, body: data, contentType:response.headers.get?.('content-type') || '' };
  }
  throw new CampusIssue('REDIRECT_BLOCKED');
}

async function login(user, password, networkSamePassword = false) {
  const jar = new CookieJar();
  const start = await request(jar, 'https://www.cc-pay.cn/login?channel=BUAASSO');
  const $ = load(start.body), form = $('#loginForm');
  if (new URL(start.url).hostname !== 'sso.buaa.edu.cn' || !form.length || !form.find('input[name=execution]').length) {
    throw new Error('学校认证页面暂不可用');
  }
  const fields = new URLSearchParams();
  form.find('input[name]').each((_, el) => {
    const name = $(el).attr('name');
    if (['execution','_eventId','type'].includes(name)) fields.set(name, $(el).attr('value') || '');
  });
  fields.set('username', user);
  fields.set('password', password);
  fields.set('submit', 'LOGIN');
  const action = new URL(form.attr('action') || start.url, start.url);
  if (action.hostname !== 'sso.buaa.edu.cn' || action.protocol !== 'https:') throw new Error('学校认证页面异常');
  await request(jar, action.href, { method: 'POST', body: fields.toString(), headers: { origin: 'https://sso.buaa.edu.cn', referer: start.url } });
  let account;
  try { account = JSON.parse((await request(jar, 'https://www.cc-pay.cn/api/user', { accept: 'application/json' })).body); }
  catch (err) { throw diagnostics.withStage(err,'schoolLogin'); }
  if (account.success !== true || !account.data) throw new Error('登录失败，或学校要求额外验证');
  // A university SSO password is not necessarily the network account password.
  // Only reuse it after the owner confirms they are the same credential.
  const netDigest = networkSamePassword || process.env.NETWORK_AUTH_SAME_PASSWORD === 'true' ? crypto.createHash('md5').update(password).digest('hex') : null;
  return { user, jar: jar.serializeSync(), netDigest };
}

// Accept only cookies obtained by the native app from the school login window.
// The upstream API, rather than the browser or caller, establishes the identity.
async function loginWithSchoolCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length > 80) throw new Error('学校登录状态不可用');
  const jar = new CookieJar();
  for (const cookie of cookies) {
    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (!['cc-pay.cn', 'www.cc-pay.cn', 'pass.cc-pay.cn', 'mall.cc-pay.cn', 'sso.buaa.edu.cn'].includes(domain)) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(cookie.name || '') || /[;\r\n]/.test(cookie.value || '') || String(cookie.value || '').length > 4096) continue;
    const path = typeof cookie.path === 'string' && /^\/[^;\r\n]*$/.test(cookie.path) ? cookie.path : '/';
    await jar.setCookie(`${cookie.name}=${cookie.value}; Domain=${domain}; Path=${path}; Secure`, `https://${domain}/`);
  }
  async function schoolAccount() { return JSON.parse((await request(jar, 'https://www.cc-pay.cn/api/user', {accept:'application/json'})).body); }
  let account = await schoolAccount();
  if (account.success !== true || !account.data) {
    await request(jar, 'https://www.cc-pay.cn/login?channel=BUAASSO');
    account = await schoolAccount();
  }
  if (account.success !== true || !account.data || typeof account.data !== 'object') throw new Error('学校登录状态不可用');
  const cards = JSON.parse((await request(jar, 'https://www.cc-pay.cn/api/campus_cards', {accept:'application/json'})).body);
  const list = Array.isArray(cards.data) ? cards.data : Array.isArray(cards.data?.data) ? cards.data.data : Array.isArray(cards.data?.list) ? cards.data.list : Array.isArray(cards.data?.records) ? cards.data.records : [];
  const user = String(list[0]?.stuNo || account.data.stuNo || account.data.userName || account.data.username || account.data.account || '').trim();
  if (cards.success !== true || !/^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$/.test(user)) throw new Error('无法确认学校账号');
  if (process.env.ALLOWED_USER_ID && user !== process.env.ALLOWED_USER_ID) throw new Error('无法确认学校账号');
  return {user, jar:jar.serializeSync(), netDigest:null};
}

async function card(session, options = {}) {
  const jar = CookieJar.fromJSON(session.jar);
  async function getCards() {
    const result = await request(jar, 'https://www.cc-pay.cn/api/campus_cards', {accept:'application/json'});
    return JSON.parse(result.body);
  }
  let cards = await getCards();
  if (!cards.success) {
    await request(jar, 'https://www.cc-pay.cn/login?channel=BUAASSO');
    cards = await getCards();
  }
  session.jar = jar.serializeSync();
  if (!cards.success) return diagnostics.failure(new CampusIssue('LOGIN_REQUIRED'),'cardBalance','login_required');
  trace({event:'card_list',success:cards.success === true,dataType:Array.isArray(cards.data) ? 'array' : typeof cards.data,keys:cards.data && !Array.isArray(cards.data) && typeof cards.data === 'object' ? Object.keys(cards.data).slice(0,20) : [],count:Array.isArray(cards.data) ? cards.data.length : null});
  const list = Array.isArray(cards.data) ? cards.data : Array.isArray(cards.data?.data) ? cards.data.data : Array.isArray(cards.data?.list) ? cards.data.list : Array.isArray(cards.data?.records) ? cards.data.records : [];
  // The balance endpoint identifies a card by student number; the school login
  // identifier is a sensible fallback when the list has no bound-card record.
  const number = list[0]?.stuNo || session.user;
  if (!number || typeof number !== 'string' && typeof number !== 'number') return diagnostics.failure(new CampusIssue('INVALID_RESPONSE'),'cardBalance');
  const result = await request(jar, 'https://www.cc-pay.cn/api/campus_card/balance?' + new URLSearchParams({stuNo:String(number)}), {accept:'application/json'});
  const payload = JSON.parse(result.body);
  trace({event:'card_balance',success:payload.success === true,status:result.status,hasBalance:payload.data?.balance != null,dataType:typeof payload.data,keys:payload.data && typeof payload.data === 'object' ? Object.keys(payload.data).slice(0,20) : []});
  session.jar = jar.serializeSync();
  const rawBalance = payload.data?.balance;
  const value = Number(rawBalance);
  if (payload.success !== true || rawBalance == null || String(rawBalance).trim() === '' || !Number.isFinite(value)) return diagnostics.failure(new CampusIssue('INVALID_RESPONSE'),'cardBalance');
  const card = {status:'ok',value,unit:'元',note:'当前余额',updatedAt:new Date().toISOString()};
  if (!options.balanceOnly) {
    try { Object.assign(card, await cardTrades(jar, String(number))); }
    catch (err) { card.historyDiagnostic=diagnostics.report(err,'cardHistory'); card.historyNote=card.historyDiagnostic.message; }
  }
  session.jar = jar.serializeSync();
  return card;
}

async function cardTrades(jar, number) {
  const days = recentDays(14), totals = Object.fromEntries(days.map(day=>[day,0]));
  // Pad the UTC search window so timezone conversion cannot drop a local day.
  const start = new Date(`${days[0]}T00:00:00+08:00`);
  const end = new Date(new Date(`${days.at(-1)}T00:00:00+08:00`).getTime()+86400000);
  const pageSize=100, records=[];
  let page=1, count=null, received=0;
  do {
    const params = new URLSearchParams({t:String(Date.now()),pageSize:String(pageSize),pageNum:String(page),minTsCreation:start.toISOString(),maxTsCreation:end.toISOString(),tradeType:'all',stuNo:number});
    const referer='https://mall.cc-pay.cn/cardInquiry?'+new URLSearchParams({stuNo:number,linkfrom:'pass'});
    const response = await request(jar,'https://mall.cc-pay.cn/api/campus_card/trades?'+params,{accept:'application/json, text/plain, */*',headers:{referer}});
    if (response.status!==200) throw new Error('Card transactions unavailable');
    trace({event:'card_transactions_response',contentType:response.contentType,html:/^\s*(<!doctype|<html)/i.test(response.body)});
    const body=JSON.parse(response.body);
    const payload=body?.data, rows=payload?.data;
    const message=String(body?.message || body?.msg || '');
    const category=/登录|登陆|login|session|认证|授权/i.test(message)?'login':/参数|格式|时间|日期/i.test(message)?'parameter':message?'other':'none';
    const hints=['用户验证失败','需要用户登陆','校园卡','无权限','参数','操作失败','访问失败','系统错误','请求失败','查询失败','日期','无数据','没有','超时'].filter(word=>message.includes(word));
    trace({event:'card_transactions_shape',success:body?.success === true,type:typeof body?.type === 'number'?body.type:null,code:typeof body?.code === 'number' || /^\d{1,5}$/.test(String(body?.code || '')) ? body.code : null,category,hints,topKeys:Object.keys(body || {}).slice(0,20),dataType:typeof payload,keys:payload && typeof payload === 'object' ? Object.keys(payload).slice(0,20) : [],rows:Array.isArray(rows) ? rows.length : null,count:typeof payload?.count==='number'?payload.count:null,pageSize:typeof payload?.pageSize==='number'?payload.pageSize:null});
    if (body.success!==true || !Array.isArray(rows)) throw new Error('Card transactions unavailable');
    const total=payload.count == null || payload.count === '' ? null : Number(payload.count);
    // The service may report count=0 even when it returns transactions.
    // In that case use page length, not the unreliable count.
    if (total!==null && Number.isSafeInteger(total) && total>=0 && !(total===0 && rows.length)) count=total;
    for (const row of rows) {
      const match=typeof row.date==='string' && row.date.match(/^(\d{4}-\d{2}-\d{2})/);
      const amount=Number(row.amount);
      if (!match || row.amount===null || row.amount===undefined || String(row.amount).trim()==='' || !Number.isSafeInteger(amount)) throw new Error('Invalid card transaction');
      if (amount<0 && Object.hasOwn(totals,match[1])) {
        totals[match[1]] += -amount;
        records.push({label:String(row.merName || row.txName || '校园卡消费').slice(0,100),date:row.date,value:`¥${(-amount/100).toFixed(2)}`});
      }
    }
    received += rows.length;
    if (count!==null && received>count) throw new Error('Invalid card transaction count');
    if ((count!==null && received===count) || (count===null && rows.length<pageSize)) break;
    if (!rows.length || page>=20) throw new Error('Incomplete card transactions');
    page++;
  } while (true);
  return {history:days.map(date=>({date,value:totals[date]/100})),historyNote:'校园卡消费 · 元',records,historySource:'transactions'};
}

function quota(html, strict = false) {
  const $ = load(html);
  let found = null;
  $('tr').each((_, row) => {
    const cells = $(row).children('th,td').map((_, el) => $(el).text().trim()).get();
    if (!cells.some(t => t.includes('免费流量剩余')) || !cells.some(t => t.includes('计费流量剩余'))) return;
    const rows = $(row).closest('table').find('tr').toArray();
    const values = $(rows[rows.indexOf(row) + 1]).children('th,td').map((_, el) => $(el).text().trim()).get();
    const get = name => values[cells.findIndex(t => t.includes(name))];
    const parse = value => {
      const m = String(value || '').match(/^\s*(\d+(?:\.\d+)?)\s*(G|GB|M|MB|K|KB|T|TB|B|BYTE|BYTES)\s*$/i);
      if (!m) return null;
      const amount=Number(m[1]) * ({g:1,m:1/1024,k:1/1024**2,t:1024,b:1/1024**3}[m[2][0].toLowerCase()]);
      return Number.isFinite(amount) ? amount : null;
    };
    const names=['免费流量剩余','计费流量剩余','已用流量'];
    const amounts=names.map(name=>parse(get(name)));
    if (strict && amounts.some(x=>x===null)) throw new CampusIssue('QUOTA_VALUE_INVALID',{field:names[amounts.indexOf(null)]});
    const [free,paid,used]=amounts;
    if (free !== null && paid !== null && used !== null) found = {free,paid,used};
  });
  if (strict && !found) throw new CampusIssue('QUOTA_TABLE_MISSING');
  return found;
}

async function network(session, options = {}) {
  if (!session.netDigest) return diagnostics.failure(new CampusIssue('NETWORK_NOT_CONFIGURED'),'networkAuth');
  const jar = CookieJar.fromJSON(session.jar);
  async function home() {
    const response = await request(jar, 'https://zfw.buaa.edu.cn/home', {stage:'networkBalance'});
    if (new URL(response.url).pathname === '/login' || load(response.body)('form#login-form').length) throw new CampusIssue('LOGIN_REQUIRED');
    return quota(response.body,true);
  }
  let data;
  try { data=await home(); }
  catch (err) {
    if (!(err instanceof CampusIssue) || err.code!=='LOGIN_REQUIRED') throw err;
    const sso = Buffer.from(`zh-CN:${session.user}:${session.netDigest}`).toString('base64');
    await request(jar, 'https://zfw.buaa.edu.cn/site/sso?' + new URLSearchParams({data:sso}), {stage:'networkAuth'});
    try { data=await home(); }
    catch (error) {
      session.jar = jar.serializeSync();
      if (error instanceof CampusIssue && error.code==='LOGIN_REQUIRED') return diagnostics.failure(error,'networkAuth','login_required');
      throw error;
    }
  }
  session.jar = jar.serializeSync();
  const result = {status:'ok',value:data.free + data.paid,unit:'GB',note:`本期已用 ${data.used.toFixed(2)} GB`,updatedAt:new Date().toISOString()};
  if (!options.balanceOnly) {
    try { Object.assign(result, await networkHistory(jar)); }
    catch (err) { result.historyDiagnostic=diagnostics.report(err,'networkHistory'); result.historyNote=result.historyDiagnostic.message; }
  }
  session.jar = jar.serializeSync();
  return result;
}

function dayString(date) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
function recentDays(count = 7, now = new Date()) {
  const today = dayString(now);
  const base = new Date(`${today}T12:00:00+08:00`);
  return Array.from({length:count},(_,i)=>dayString(new Date(base.getTime()-(count-1-i)*86400000)));
}

async function networkHistory(jar) {
  const days = recentDays(14), totals = Object.fromEntries(days.map(day=>[day,0]));
  const params = new URLSearchParams({'DetailLogSearch[start_time]':`${days[0]} 00:00:00`,'DetailLogSearch[end_time]':`${days.at(-1)} 23:59:59`});
  let total = null, processed = 0, page = 1;
  const records = [];
  do {
    params.set('page',String(page));
    const response = await request(jar, 'https://zfw.buaa.edu.cn/log/detail?'+params);
    const $ = load(response.body), rows = $('table tbody tr');
    const summary = $('.summary').text().match(/共\s*([\d,]+)\s*条/);
    if (!summary || !$('table').text().includes('总流量')) throw new Error('Network history unavailable');
    if (total === null) total = Number(summary[1].replaceAll(',',''));
    let parsedRows = 0;
    rows.each((_,row)=>{
      const cols = $(row).children('td').map((_,el)=>$(el).text().trim()).get();
      if (cols.length < 6) return;
      const stamp = cols[1].match(/^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}/);
      const bytes = Number(cols[4].replaceAll(',',''));
      if (!stamp || !Number.isFinite(bytes) || bytes < 0) return;
      parsedRows++;
      const gb = bytes / 1024**3;
      if (Object.hasOwn(totals,stamp[1])) totals[stamp[1]] += gb;
      records.push({label:'流量结算',date:cols[1],value:`${gb.toFixed(2)} GB`});
    });
    processed += parsedRows;
    if (!parsedRows && processed < total) throw new Error('Incomplete network history');
    page++;
    if (page > 51 && processed < total) throw new Error('Network history too large');
  } while (processed < total);
  return {history:days.map(date=>({date,value:totals[date]})),historyNote:'按学校结算日 · GB',records:records.slice(0,100)};
}

async function electricity(config) {
  const missing=()=>({status:'unavailable',note:'请先设置宿舍电表'});
  if (!config?.lighting && !config?.air) return {lighting:missing(),air:missing()};
  const owner=config.historyOwner;
  let historical={}, historyDiagnostic;
  if (owner) {
    try { historical=await electricityHistory(config); } catch (err) { historyDiagnostic=diagnostics.report(err,'electricityHistory'); }
  }
  const [lighting,air]=await Promise.all(['lighting','air'].map(async key=>{
    const id=config[key];if(!id)return missing();
    try { const current=await meterReading(id,key), prior=historical[key]; if(historyDiagnostic) {current.historyDiagnostic=historyDiagnostic; current.historyNote=historyDiagnostic.message;} return prior?.status==='ok' ? {...current,history:prior.history,historyNote:prior.historyNote} : current; }
    catch (err) {
      const failed=diagnostics.failure(err,key==='air'?'airMeter':'lightingMeter');
      if (historical[key]?.status==='ok') return {...historical[key],fallbackDiagnostic:failed.diagnostic};
      if (historyDiagnostic) failed.historyDiagnostic=historyDiagnostic;
      return failed;
    }
  }));
  return {lighting,air};
}

async function meterReading(id,key) {
  if (!/^\d{1,30}$/.test(id)) throw new Error('Invalid meter');
  async function read(scheme) {
    try {
      const response=await fetch(`${scheme}://shsd.buaa.edu.cn/PubBuaa?`+new URLSearchParams({id}),{redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'user-agent':AGENT}});
      if(response.status>=300&&response.status<400)throw new CampusIssue('REDIRECT_BLOCKED');
      if(!response.ok)throw new CampusIssue('HTTP_ERROR',{httpStatus:response.status});
      const html=await response.text();if(html.length>2_000_000)throw new CampusIssue('RESPONSE_TOO_LARGE');
      return parseMeter(html,id,key);
    } catch (err) { throw diagnostics.withTransport(err,scheme); }
  }
  try { return await read('https'); }
  catch (err) {
    if(!['CONNECTION_FAILED','TIMEOUT'].includes(diagnostics.describe(err,'electricityMeter').code))throw err;
    const transportDiagnostic=diagnostics.report(err,key==='air'?'airMeter':'lightingMeter');
    const reading=await read('http');
    reading.transportDiagnostic=transportDiagnostic;
    return reading;
  }
}

function parseMeter(html,id,key) {
  const $=load(html),paragraphs=$('p').map((_,e)=>$(e).text().replace(/\s+/g,' ').trim()).get();
  const field=prefix=>{const aliases=({'地址:':['地址:','地哈哈址:'],'电价:':['电价:','电哈哈价:']})[prefix]||[prefix];for(const label of aliases){const value=paragraphs.find(x=>x.startsWith(label));if(value!==undefined)return value.slice(label.length).trim()}return ''};
  const meter=field('购电表号:'),address=field('地址:'),price=Number((field('电价:').match(/\d+(?:\.\d+)?/)||[])[0]),quantity=Number(($('#canvas1 tspan').last().text().match(/[-+]?\d+(?:\.\d+)?/)||[])[0]);
  if(!meter)throw new CampusIssue('FIELD_MISSING',{field:'电表号'});
  if(meter!==id)throw new CampusIssue('METER_ID_MISMATCH');
  if(!address)throw new CampusIssue('FIELD_MISSING',{field:'地址'});
  if(!address.includes(key==='air'?'空调':'照明'))throw new CampusIssue('METER_KIND_MISMATCH');
  if(!field('电价:'))throw new CampusIssue('FIELD_MISSING',{field:'电价'});
  if(!$('#canvas1 tspan').length)throw new CampusIssue('FIELD_MISSING',{field:'剩余电量'});
  if(!Number.isFinite(price)||price<0)throw new CampusIssue('METER_VALUE_INVALID',{field:'电价'});
  if(!Number.isFinite(quantity)||quantity<0)throw new CampusIssue('METER_VALUE_INVALID',{field:'剩余电量'});
  const cutoff=paragraphs.find(x=>x.includes('截止')||x.includes('截至'))||'';
  const match=cutoff.match(/(?:截止|截至)\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  let note='学校电表';
  if(match){
    const [year,month,day]=match.slice(1).map(Number),date=new Date(Date.UTC(year,month-1,day));
    if(date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day)note=`截至 ${match[1]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return {status:'ok',value:Math.round(price*quantity*100)/100,unit:'元',note,history:[],historyNote:'暂无历史数据'};
}

async function electricityHistory(config) {
  if(!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(config.historyOwner)) throw new Error('Invalid history owner');
  const response = await fetch(`https://raw.githubusercontent.com/${config.historyOwner}/buaa-electricity-monitor/main/data/history.csv`, {signal:AbortSignal.timeout(12000),headers:{'user-agent':AGENT}});
  if (!response.ok) throw new CampusIssue('HTTP_ERROR',{httpStatus:response.status});
  const text = await response.text();
  if (text.length > 2_000_000) throw new CampusIssue('RESPONSE_TOO_LARGE');
  const rows = parse(text, {columns:true, skip_empty_lines:true, bom:true});
  const days = new Map();
  for (const row of rows) {
    const day = row.date, key = row.key, raw = row.remaining_cny;
    const expected=key==='air_conditioner'?config.air:key==='lighting'?config.lighting:null;
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || !expected || row.meter_id!==expected || !raw?.trim()) continue;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const values = days.get(day) || {}; values[key] = amount; days.set(day, values);
  }
  function meter(key) {
    const entries = [...days.entries()].filter(([,v]) => v[key] !== undefined).sort(([a],[b]) => a.localeCompare(b));
    if (!entries.length) return {status:'unavailable',note:'暂无电费数据'};
    const [date,latest] = entries.at(-1), byDay = new Map(entries.map(([day,v])=>[day,v[key]]));
    const dates = recentDays(15, new Date(`${date}T12:00:00+08:00`));
    const history = dates.slice(1).map((day,i)=>{
      const before=byDay.get(dates[i]), after=byDay.get(day);
      return {date:day,value:before !== undefined && after !== undefined && before >= after ? Math.round((before-after)*100)/100 : null};
    });
    return {status:'ok',value:latest[key],unit:'元',note:`截至 ${date}`,updatedAt:date,history,historyNote:'余额减少估算 · 元'};
  }
  return {lighting:meter('lighting'),air:meter('air_conditioner')};
}

module.exports = { request, login, loginWithSchoolCookies, card, cardTrades, quota, network, networkHistory, recentDays, electricity, electricityHistory, meterReading };
