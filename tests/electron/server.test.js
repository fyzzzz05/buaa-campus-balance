const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const runtime = require('../../lib/runtime');
const {startServer} = require('../../lib/server');

function publicFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-server-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(publicDir, {recursive: true});
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>login</title>', 'utf8');
  fs.writeFileSync(path.join(publicDir, 'dashboard.html'), '<!doctype html><title>dashboard</title>', 'utf8');
  runtime.configure({
    mode: 'app',
    sessionSecret: 'test-session-secret-that-is-long-enough',
    nativeToken: 'test-native-token-that-is-long-enough',
    dataDir: dir,
    logDir: dir,
    trace: false,
    widget: {read: () => null, write: () => {}, clear: () => {}},
    widgetAgent: {available: () => true, enable: async () => {}, disable: async () => {}},
  });
  t.after(() => runtime.reset());
  return {dir, publicDir};
}

function rawRequest(origin, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({host: '127.0.0.1', port: origin.port, path: pathname, method: 'GET', headers}, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

test('the local server serves pages with a CSP and required headers', async t => {
  const {publicDir} = publicFixture(t);
  const server = await startServer({publicDir});
  t.after(() => server.close());
  const response = await fetch(server.url, {headers: {connection: 'close'}});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await response.text(), /<title>login<\/title>/);
  const dashboard = await fetch(server.url + 'dashboard', {headers: {connection: 'close'}});
  assert.match(await dashboard.text(), /dashboard/);
  assert.equal((await fetch(server.url + 'missing', {headers: {connection: 'close'}})).status, 404);
});

test('requests with a foreign Host header are refused', async t => {
  const {publicDir} = publicFixture(t);
  const server = await startServer({publicDir});
  t.after(() => server.close());
  const {port} = server.server.address();
  assert.equal(await rawRequest({port}, '/', {host: 'evil.example'}), 403);
  assert.equal(await rawRequest({port}, '/', {host: `localhost:${port}`}), 403);
  assert.equal(await rawRequest({port}, '/', {host: `127.0.0.1:${port}`}), 200);
});

test('api requests enforce session, origin and body limits', async t => {
  const {publicDir} = publicFixture(t);
  const server = await startServer({publicDir});
  t.after(() => server.close());
  const unauthenticated = await fetch(server.url + 'api/auth', {headers: {connection: 'close'}});
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), {authenticated: false});

  const foreignOrigin = await fetch(server.url + 'api/auth', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: 'http://evil.example', connection: 'close'},
    body: '{}',
  });
  assert.equal(foreignOrigin.status, 403);

  const badJson = await fetch(server.url + 'api/auth', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: server.origin, connection: 'close'},
    body: '{',
  });
  assert.equal(badJson.status, 400);

  let oversized;
  try {
    oversized = await fetch(server.url + 'api/auth', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Origin: server.origin, connection: 'close'},
      body: JSON.stringify({padding: 'x'.repeat(12000)}),
    });
  } catch {
    oversized = {status: 413};
  }
  assert.equal(oversized.status, 413);

  const unknownApi = await fetch(server.url + 'api/nope', {headers: {connection: 'close'}});
  assert.equal(unknownApi.status, 404);
  const settingsWithoutSession = await fetch(server.url + 'api/settings', {headers: {connection: 'close'}});
  assert.equal(settingsWithoutSession.status, 401);
});
