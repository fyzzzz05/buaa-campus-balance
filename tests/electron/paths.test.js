const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {files, clampWindowPosition} = require('../../electron/paths');

test('all state files live below the Electron userData/logs directories', () => {
  const userData = path.join('/tmp', 'user-data');
  const logs = path.join('/tmp', 'logs');
  const value = files({userData, logs});
  assert.equal(value.userData, userData);
  assert.equal(value.logDir, logs);
  for (const key of ['settingsDir', 'accounts', 'credentialsDir', 'snapshot', 'widgetWindow', 'widgetAccount', 'refreshState']) {
    assert.equal(value[key].startsWith(userData + path.sep), true, key);
  }
});

test('window positions are kept inside the nearest visible work area', () => {
  const primary = {x: 0, y: 0, width: 1920, height: 1080};
  const secondary = {x: 1920, y: 0, width: 1920, height: 1080};
  const size = {width: 170, height: 170};
  assert.deepEqual(clampWindowPosition({x: 1800, y: 1000}, size, [primary, secondary]), {x: 1750, y: 910});
  assert.deepEqual(clampWindowPosition({x: -500, y: -500}, size, [primary]), {x: 0, y: 0});
  assert.deepEqual(clampWindowPosition({x: 2000, y: 100}, size, [primary, secondary]), {x: 2000, y: 100});
  assert.deepEqual(clampWindowPosition(null, size, [primary]), {x: 875, y: 455});
  assert.deepEqual(clampWindowPosition({x: 10, y: 20}, size, []), {x: 10, y: 20});
});
