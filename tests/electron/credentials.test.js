const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createCredentials} = require('../../electron/credentials');

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: value => Buffer.from('enc:' + value),
    decryptString: buffer => Buffer.from(buffer).toString('utf8').slice(4),
  };
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-credentials-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return {dir, accountsFile: path.join(dir, 'auto-login.json'), directory: path.join(dir, 'credentials')};
}

test('refuses to store credentials when encryption is unavailable', t => {
  const {accountsFile, directory} = temp(t);
  const store = createCredentials({safeStorage: fakeSafeStorage(false), directory, accountsFile});
  assert.equal(store.available(), false);
  assert.throws(() => store.save('20250001', 'secret'));
  assert.equal(store.autoLoginUser(), null);
});

test('round trips a password per account and never writes plaintext', t => {
  const {dir, accountsFile, directory} = temp(t);
  const store = createCredentials({safeStorage: fakeSafeStorage(), directory, accountsFile});
  store.save('20250001', 'first-password', {networkSamePassword: true});
  assert.equal(store.read('20250001'), 'first-password');
  assert.equal(store.autoLoginUser(), '20250001');
  assert.equal(store.networkSamePassword(), true);
  assert.equal(fs.readFileSync(accountsFile, 'utf8').includes('first-password'), false);
  const encrypted = fs.readdirSync(directory).map(name => fs.readFileSync(path.join(directory, name)))[0];
  assert.equal(encrypted.equals(Buffer.from('first-password')), false);
  assert.equal(encrypted.subarray(0, 4).toString('utf8'), 'enc:');
  store.save('20250002', 'second-password');
  assert.equal(store.read('20250002'), 'second-password');
  assert.equal(store.read('20250001'), 'first-password');
  assert.equal(store.networkSamePassword(), false);
  store.remove('20250002');
  assert.equal(store.autoLoginUser(), null);
  assert.equal(store.read('20250001'), 'first-password');
  store.remove('20250001');
  assert.equal(store.autoLoginUser(), null);
  assert.equal(fs.existsSync(accountsFile), false);
  assert.equal(fs.existsSync(directory), true);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('rejects invalid accounts, oversized passwords and control characters', t => {
  const {accountsFile, directory} = temp(t);
  const store = createCredentials({safeStorage: fakeSafeStorage(), directory, accountsFile});
  assert.throws(() => store.save('../escape', 'secret'));
  assert.throws(() => store.save('valid-user', ''));
  assert.throws(() => store.save('valid-user', 'x'.repeat(257)));
  assert.throws(() => store.save('valid-user', 'line\nbreak'));
  assert.throws(() => store.read('../escape'));
});
