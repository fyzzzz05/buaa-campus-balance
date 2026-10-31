const {test} = require('node:test');
const assert = require('node:assert/strict');
const navigation = require('../../electron/navigation');

test('school login window only follows the whitelisted school hosts over https', () => {
  for (const url of ['https://www.cc-pay.cn/login?channel=BUAASSO', 'https://pass.cc-pay.cn/x', 'https://mall.cc-pay.cn/api', 'https://sso.buaa.edu.cn/login']) {
    assert.equal(navigation.isAllowedSchoolUrl(url), true, url);
  }
  for (const url of ['http://www.cc-pay.cn/login', 'https://www.cc-pay.cn:8443/x', 'https://evil.cc-pay.cn.evil/x', 'https://example.com/', 'https://zfw.buaa.edu.cn/home', 'not a url']) {
    assert.equal(navigation.isAllowedSchoolUrl(url), false, url);
  }
});

test('login completion is detected only on the school payment hosts', () => {
  assert.equal(navigation.isLoginPageUrl('https://www.cc-pay.cn/dashboard'), true);
  assert.equal(navigation.isLoginPageUrl('https://mall.cc-pay.cn/cardInquiry'), true);
  assert.equal(navigation.isLoginPageUrl('https://sso.buaa.edu.cn/login'), false);
  assert.equal(navigation.isLoginPageUrl('http://www.cc-pay.cn/'), false);
});

test('the main window may only stay on its own loopback origin', () => {
  assert.equal(navigation.isLocalUrl('http://127.0.0.1:61234/dashboard', 'http://127.0.0.1:61234'), true);
  assert.equal(navigation.isLocalUrl('http://127.0.0.1:9999/', 'http://127.0.0.1:61234'), false);
  assert.equal(navigation.isLocalUrl('http://localhost:61234/', 'http://127.0.0.1:61234'), false);
  assert.equal(navigation.isLocalUrl('file:///etc/passwd', 'http://127.0.0.1:61234'), false);
  assert.equal(navigation.isLocalUrl('https://example.com/', 'http://127.0.0.1:61234'), false);
});

test('external links are limited to https and school cookies are domain filtered', () => {
  assert.equal(navigation.isSafeExternal('https://github.com/fyzzzz05/buaa-campus-balance'), true);
  assert.equal(navigation.isSafeExternal('http://example.com/'), false);
  assert.equal(navigation.isSafeExternal('javascript:alert(1)'), false);
  assert.equal(navigation.isSchoolCookieDomain('.cc-pay.cn'), true);
  assert.equal(navigation.isSchoolCookieDomain('sso.buaa.edu.cn'), true);
  assert.equal(navigation.isSchoolCookieDomain('evil.example'), false);
});
