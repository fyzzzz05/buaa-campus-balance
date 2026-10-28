const campus = require('../lib/campus');
const session = require('../lib/session');
const credentials = require('../lib/credentials');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const current = session.read(req);
    return res.status(current ? 200 : 401).json(current ? {authenticated:true} : {authenticated:false});
  }
  if (req.method !== 'POST') return res.status(405).json({error:'不支持此请求'});
  if (req.body?.action === 'school-session') {
    // Only the native app knows this per-launch secret; the web page never sees it.
    const crypto = require('node:crypto');
    const supplied = Buffer.from(String(req.headers['x-campus-native-token'] || ''));
    const expected = Buffer.from(String(process.env.SESSION_SECRET || ''));
    if (process.env.CAMPUS_APP !== '1' || expected.length < 32 || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected) || req.headers.origin) return res.status(403).json({error:'请求来源不受支持'});
    try {
      const current = await campus.loginWithSchoolCookies(req.body.cookies);
      session.write(res, current);
      return res.status(200).json({ok:true});
    } catch { return res.status(401).json({error:'学校登录尚未完成'}); }
  }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({error:'请求来源不受支持'});
  if (req.body?.action === 'logout') {
    const current=session.read(req);
    if (current?.autoLogin === true) {
      try { await credentials.remove(current.user); } catch { return res.status(503).json({error:'无法移除钥匙串中的密码，请先解锁钥匙串'}); }
    }
    session.clear(res); return res.status(200).json({ok:true});
  }
  const user = String(req.body?.username || '').trim(), password = String(req.body?.password || '');
  if (!process.env.SESSION_SECRET || (!process.env.ALLOWED_USER_ID && process.env.CAMPUS_WEB !== '1' && process.env.CAMPUS_APP !== '1')) return res.status(503).json({error:'系统尚未配置登录'});
  if (!/^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$/.test(user) || (process.env.ALLOWED_USER_ID && user !== process.env.ALLOWED_USER_ID) || !password || password.length > 256) return res.status(401).json({error:'账号或密码不正确'});
  try {
    const current = await campus.login(user, password, req.body?.networkSamePassword === true);
    if (req.body?.autoLogin === true) {
      if (process.env.CAMPUS_WEB !== '1' && process.env.CAMPUS_APP !== '1') return res.status(400).json({error:'自动登录仅支持本机运行'});
      try { await credentials.save(user,password); } catch { return res.status(503).json({error:'无法保存到钥匙串，请解锁钥匙串后重试'}); }
      current.autoLogin=true;
    }
    session.write(res, current);
    return res.status(200).json({ok:true});
  } catch (err) {
    const text = ['学校认证页面暂不可用','学校认证页面异常','学校认证服务暂不可用','登录失败，或学校要求额外验证'].includes(err.message) ? err.message : '无法连接学校认证服务，请稍后重试';
    if (process.env.CAMPUS_APP === '1' && text === '无法连接学校认证服务，请稍后重试') {
      try {
        const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
        const dir = path.join(os.homedir(), 'Library', 'Logs', 'CampusBalance');
        fs.mkdirSync(dir, {recursive:true, mode:0o700});
        fs.appendFileSync(path.join(dir, 'auth.log'), JSON.stringify({time:new Date().toISOString(), event:'login_error', name:err.name, code:err.code || err.cause?.code || null}) + '\n', {mode:0o600});
      } catch {}
    }
    return res.status(401).json({error:text});
  }
};
