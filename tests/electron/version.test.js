const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');

test('VERSION is the single source of the packaged Windows version', () => {
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  assert.match(version, /^\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, version, 'package.json version must match VERSION');
  assert.equal(pkg.main, 'electron/main.js');
  assert.ok(fs.existsSync(path.join(root, 'electron', 'build.mjs')));
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'windows-electron.yml'), 'utf8');
  assert.match(workflow, /win-v\*/);
  assert.match(workflow, /electron:build:win/);
  assert.match(workflow, /upload-artifact/);
});
