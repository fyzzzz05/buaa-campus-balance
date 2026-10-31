'use strict';
// Pure navigation allow-lists: only the school login window may leave
// 127.0.0.1, and only over https with an exact host allow-list.
const SCHOOL_HOSTS = new Set(['www.cc-pay.cn', 'pass.cc-pay.cn', 'mall.cc-pay.cn', 'sso.buaa.edu.cn']);
const LOGIN_HOSTS = new Set(['www.cc-pay.cn', 'pass.cc-pay.cn', 'mall.cc-pay.cn']);
const SCHOOL_COOKIE_DOMAINS = new Set(['cc-pay.cn', 'www.cc-pay.cn', 'pass.cc-pay.cn', 'mall.cc-pay.cn', 'sso.buaa.edu.cn']);

function parse(raw) { try { return new URL(String(raw)); } catch { return null; } }

function isAllowedSchoolUrl(raw) {
  const url = parse(raw);
  if (!url) return false;
  return url.protocol === 'https:' && SCHOOL_HOSTS.has(url.hostname) && !url.port && !url.username && !url.password;
}

function isLoginPageUrl(raw) {
  const url = parse(raw);
  if (!url) return false;
  return url.protocol === 'https:' && LOGIN_HOSTS.has(url.hostname);
}

function isLocalUrl(raw, origin) {
  const url = parse(raw);
  const base = parse(origin);
  if (!url || !base) return false;
  return url.protocol === 'http:' && url.origin === base.origin;
}

function isSafeExternal(raw) {
  const url = parse(raw);
  return Boolean(url) && url.protocol === 'https:' && Boolean(url.hostname);
}

function isSchoolCookieDomain(domain) {
  return SCHOOL_COOKIE_DOMAINS.has(String(domain || '').replace(/^\./, '').toLowerCase());
}

module.exports = {SCHOOL_HOSTS, LOGIN_HOSTS, SCHOOL_COOKIE_DOMAINS, isAllowedSchoolUrl, isLoginPageUrl, isLocalUrl, isSafeExternal, isSchoolCookieDomain};
