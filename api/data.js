const campus = require('../lib/campus');
const session = require('../lib/session');
const cardHistory = require('../lib/card-history');
const settings = require('../lib/settings');
const credentials = require('../lib/credentials');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({error:'不支持此请求'});
  const current = session.read(req);
  if (!current) return res.status(401).json({error:'请重新登录'});
  const data = {};
  // Both authenticated adapters update one cookie jar, so keep these requests sequential.
  try {
    data.card = await campus.card(current);
    if (data.card.status === 'login_required' && current.autoLogin === true && (process.env.CAMPUS_WEB === '1' || process.env.CAMPUS_APP === '1')) {
      try {
        const password=await credentials.read(current.user);
        const refreshed=await campus.login(current.user,password,Boolean(current.netDigest));
        Object.assign(current,refreshed,{autoLogin:true});
        data.card=await campus.card(current);
      } catch { data.card={status:'login_required',note:'自动登录失败，请重新登录'}; }
    }
    if (data.card.status === 'ok' && data.card.historySource !== 'transactions') { try { cardHistory.capture(data.card, current.user); data.card.historyNote = '余额减少估算 · 流水暂不可用'; } catch {} }
  } catch { data.card = {status:'unavailable',note:'饭卡查询暂不可用'}; }
  try { data.net = await campus.network(current); } catch { data.net = {status:'unavailable',note:'校园网查询暂不可用'}; }
  try { Object.assign(data, await campus.electricity(settings.read(current.user))); } catch { data.lighting = data.air = {status:'unavailable',note:'电费查询暂不可用'}; }
  try { session.write(res, current); } catch { return res.status(503).json({error:'登录状态暂不可用'}); }
  return res.status(200).json({data});
};
