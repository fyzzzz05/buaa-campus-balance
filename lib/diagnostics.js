const fs = require('node:fs');
const runtime = require('./runtime');
const os = require('node:os');
const path = require('node:path');

const messages = {
  TIMEOUT:'学校服务请求超时', CONNECTION_FAILED:'无法连接学校服务', DNS_FAILED:'学校域名解析失败',
  TLS_FAILED:'学校 HTTPS 证书或握手失败', OFFLINE:'当前网络不可用', HTTP_ERROR:'学校服务返回错误',
  REDIRECT_BLOCKED:'学校服务跳转异常', RESPONSE_TOO_LARGE:'学校响应超过大小限制', INVALID_RESPONSE:'学校响应格式异常',
  LOGIN_REQUIRED:'学校登录未完成或已失效，请重新登录', NETWORK_NOT_CONFIGURED:'未启用校园网登录，请使用账号密码登录并勾选相同密码',
  QUOTA_TABLE_MISSING:'校园网流量表缺失，学校页面可能已变化', QUOTA_VALUE_INVALID:'校园网流量数值或单位无法识别',
  METER_ID_MISMATCH:'学校返回的电表号与设置不符', METER_KIND_MISMATCH:'学校返回的电表类型与设置不符',
  FIELD_MISSING:'学校页面缺少字段', METER_VALUE_INVALID:'学校返回的电价或剩余电量无效',
  HISTORY_INCOMPLETE:'学校流水分页不完整', KEYCHAIN_FAILED:'无法读取自动登录密码，请检查钥匙串',
  UNKNOWN:'查询失败，原因尚未识别',
};
const endpoints = {
  schoolLogin:'https://sso.buaa.edu.cn/login', cardBalance:'https://www.cc-pay.cn/api/campus_card/balance',
  cardHistory:'https://mall.cc-pay.cn/api/campus_card/trades', networkBalance:'https://zfw.buaa.edu.cn/home',
  networkAuth:'https://zfw.buaa.edu.cn/site/sso', networkHistory:'https://zfw.buaa.edu.cn/log/detail',
  electricityMeter:'https://shsd.buaa.edu.cn/PubBuaa', electricityHistory:'https://raw.githubusercontent.com',
  lightingMeter:'https://shsd.buaa.edu.cn/PubBuaa', airMeter:'https://shsd.buaa.edu.cn/PubBuaa',
  autoLogin:null,
};
const fields = new Set(['电表号','地址','电价','剩余电量','免费流量剩余','计费流量剩余','已用流量']);
const transportCodes = new Set(['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','UND_ERR_SOCKET','ENOTFOUND','EAI_AGAIN','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_SSL_WRONG_VERSION_NUMBER']);
class CampusIssue extends Error {
  constructor(code, {field, httpStatus} = {}) {
    super(messages[code] || messages.UNKNOWN);
    this.code = Object.hasOwn(messages,code) ? code : 'UNKNOWN';
    if (fields.has(field)) this.field = field;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) this.httpStatus = httpStatus;
  }
}
function describe(error, stage) {
  const rawCode = error?.cause?.code || error?.code;
  let issue = error instanceof CampusIssue ? error : null;
  if (!issue) {
    let code = 'UNKNOWN';
    if (['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(rawCode) || ['TimeoutError','AbortError'].includes(error?.name)) code='TIMEOUT';
    else if (['ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','UND_ERR_SOCKET'].includes(rawCode)) code='CONNECTION_FAILED';
    else if (['ENOTFOUND','EAI_AGAIN'].includes(rawCode)) code='DNS_FAILED';
    else if (['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_SSL_WRONG_VERSION_NUMBER'].includes(rawCode)) code='TLS_FAILED';
    else if (error instanceof SyntaxError) code='INVALID_RESPONSE';
    else if (['Incomplete card transactions','Incomplete network history'].includes(error?.message)) code='HISTORY_INCOMPLETE';
    else if (['学校认证页面暂不可用','学校认证页面异常','学校认证服务暂不可用','Card transactions unavailable','Invalid card transaction','Invalid card transaction count','Network history unavailable','Invalid meter','Invalid history owner'].includes(error?.message)) code='INVALID_RESPONSE';
    else if (['登录失败，或学校要求额外验证','学校登录状态不可用','无法确认学校账号'].includes(error?.message)) code='LOGIN_REQUIRED';
    issue = new CampusIssue(code);
  }
  stage = issue.stage || stage;
  const safeStage = Object.hasOwn(endpoints,stage) ? stage : 'unknown';
  let message = messages[issue.code] || messages.UNKNOWN;
  if (issue.field) message += `：${issue.field}`;
  if (issue.httpStatus) message += `（HTTP ${issue.httpStatus}）`;
  const useHTTP=issue.transport==='http' && ['electricityMeter','lightingMeter','airMeter'].includes(safeStage);
  const endpoint = endpoints[safeStage]?.replace(/^https:/,useHTTP?'http:':'https:');
  const result = {code:issue.code, stage:safeStage, message};
  if (endpoint) Object.assign(result,{endpoint,scheme:useHTTP?'http':'https',port:useHTTP?80:443});
  if (issue.field) result.field=issue.field;
  if (issue.httpStatus) result.httpStatus=issue.httpStatus;
  const transportCode = issue.transportCode || rawCode;
  if (transportCodes.has(transportCode)) result.transportCode=transportCode;
  return result;
}
function write(record, directory = runtime.logDir() || path.join(os.homedir(),'Library','Logs','CampusBalance')) {
  try {
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const target=path.join(directory,'diagnostics.ndjson');
    if (fs.existsSync(target) && fs.statSync(target).size >= 262144) fs.renameSync(target,target+'.1');
    fs.appendFileSync(target,JSON.stringify({time:new Date().toISOString(),...record})+'\n',{mode:0o600});
  } catch { /* Diagnostics must not stop balance queries. */ }
}
function report(error,stage) {
  const diagnostic=describe(error,stage);
  if (runtime.traceEnabled()) write(diagnostic);
  return diagnostic;
}
function withStage(error,stage) {
  const diagnostic=describe(error,stage);
  const issue=error instanceof CampusIssue ? error : new CampusIssue(diagnostic.code);
  if (diagnostic.transportCode) issue.transportCode=diagnostic.transportCode;
  issue.stage=stage;
  return issue;
}
function withTransport(error,transport) {
  const diagnostic=describe(error,'electricityMeter');
  const issue=error instanceof CampusIssue ? error : new CampusIssue(diagnostic.code);
  if (diagnostic.transportCode) issue.transportCode=diagnostic.transportCode;
  issue.transport=transport==='http'?'http':'https';
  return issue;
}
function failure(error,stage,status) {
  const diagnostic=report(error,stage);
  return {status:status || (diagnostic.code==='LOGIN_REQUIRED'?'login_required':'unavailable'),note:diagnostic.message,diagnostic};
}
module.exports={CampusIssue,describe,report,failure,write,withStage,withTransport};
