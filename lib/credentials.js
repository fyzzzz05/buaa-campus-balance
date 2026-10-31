'use strict';
// Credential storage is a small adapter so the macOS Keychain implementation
// used by the web/native app keeps working while Electron passes a safeStorage
// backed implementation. Adapters expose save/read/remove/available.
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const exec = promisify(execFile);
const service = 'edu.buaa.campus-balance.auto-login';

let adapter = null;
function configure(next) { adapter = next || null; }
function available() { return adapter ? adapter.available() === true : process.platform === 'darwin'; }

function checkAccount(user) {
  if (process.platform !== 'darwin' || !/^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$/.test(user)) throw new Error('Keychain unavailable');
}
function quote(value) { return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
async function keychainRead(user) {
  checkAccount(user);
  const {stdout} = await exec('/usr/bin/security', ['find-generic-password', '-a', user, '-s', service, '-w'], {encoding: 'utf8', timeout: 30000, maxBuffer: 4096});
  return stdout.replace(/\r?\n$/, '');
}
async function keychainSave(user, password) {
  checkAccount(user);
  if (!password || password.length > 256 || /[\r\n\0]/.test(password)) throw new Error('Invalid credential');
  // Supply the secret through stdin; never place it in process arguments.
  const {spawn} = require('node:child_process');
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', ['-i'], {stdio: ['pipe', 'ignore', 'ignore']});
    const timer = setTimeout(() => { child.kill(); reject(new Error('Keychain timed out')); }, 30000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Keychain unavailable')); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Keychain unavailable')); });
    child.stdin.on('error', () => {});
    child.stdin.end(`add-generic-password -U -a ${quote(user)} -s ${quote(service)} -w ${quote(password)}\n`);
  });
  if (await keychainRead(user) !== password) throw new Error('Keychain verification failed');
}
async function keychainRemove(user) {
  checkAccount(user);
  try { await exec('/usr/bin/security', ['delete-generic-password', '-a', user, '-s', service], {timeout: 30000, maxBuffer: 4096}); }
  catch (err) { if (err.code !== 44) throw new Error('Keychain unavailable'); }
}

async function save(user, password, options = {}) {
  if (adapter) return adapter.save(user, password, options);
  return keychainSave(user, password);
}
async function read(user) {
  if (adapter) return adapter.read(user);
  return keychainRead(user);
}
async function remove(user) {
  if (adapter) return adapter.remove(user);
  return keychainRemove(user);
}
function autoLoginUser() {
  return adapter && typeof adapter.autoLoginUser === 'function' ? adapter.autoLoginUser() : null;
}
module.exports = {configure, available, save, read, remove, autoLoginUser};
