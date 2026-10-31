'use strict';
// safeStorage-backed credential store. The encrypted password and the small
// account hint file never contain each other's data; everything is per-user.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$/;

function createCredentials({safeStorage, directory, accountsFile, fileSystem = fs}) {
  function available() {
    try { return Boolean(safeStorage) && safeStorage.isEncryptionAvailable() === true; }
    catch { return false; }
  }
  function file(user) {
    if (!ACCOUNT.test(String(user || ''))) throw new Error('Invalid account');
    return path.join(directory, crypto.createHash('sha256').update(user).digest('hex') + '.bin');
  }
  function readAccounts() {
    try {
      const value = JSON.parse(fileSystem.readFileSync(accountsFile, 'utf8'));
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  }
  function writeAccounts(value) {
    fileSystem.mkdirSync(path.dirname(accountsFile), {recursive: true, mode: 0o700});
    fileSystem.writeFileSync(accountsFile, JSON.stringify(value), {mode: 0o600});
  }
  function save(user, password, options = {}) {
    if (!available()) throw new Error('Encryption unavailable');
    if (!ACCOUNT.test(String(user || '')) || typeof password !== 'string' || !password || password.length > 256 || /[\r\n\0]/.test(password)) throw new Error('Invalid credential');
    const encrypted = safeStorage.encryptString(password);
    fileSystem.mkdirSync(directory, {recursive: true, mode: 0o700});
    fileSystem.writeFileSync(file(user), encrypted, {mode: 0o600});
    const accounts = readAccounts();
    accounts.user = user;
    accounts.networkSamePassword = options.networkSamePassword === true;
    writeAccounts(accounts);
  }
  function read(user) {
    if (!available()) throw new Error('Encryption unavailable');
    return safeStorage.decryptString(fileSystem.readFileSync(file(user)));
  }
  function remove(user) {
    try { fileSystem.unlinkSync(file(user)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const accounts = readAccounts();
    if (accounts.user !== user) return;
    delete accounts.user;
    delete accounts.networkSamePassword;
    if (Object.keys(accounts).length === 0) removeAccounts();
    else writeAccounts(accounts);
  }
  function removeAccounts() { try { fileSystem.unlinkSync(accountsFile); } catch { /* already gone */ } }
  function autoLoginUser() {
    if (!available()) return null;
    const accounts = readAccounts();
    if (typeof accounts.user !== 'string' || !ACCOUNT.test(accounts.user)) return null;
    try { fileSystem.accessSync(file(accounts.user)); } catch { return null; }
    return accounts.user;
  }
  function networkSamePassword() {
    const accounts = readAccounts();
    return typeof accounts.user === 'string' && accounts.networkSamePassword === true;
  }
  return {available, save, read, remove, autoLoginUser, networkSamePassword};
}

module.exports = {createCredentials, ACCOUNT};
