const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {files, clampWindowPosition, anchorPopup} = require('../../electron/paths');

test('all state files live below the Electron userData/logs directories', () => {
  const userData = path.join('/tmp', 'user-data');
  const logs = path.join('/tmp', 'logs');
  const value = files({userData, logs});
  assert.equal(value.userData, userData);
  assert.equal(value.logDir, logs);
  for (const key of ['settingsDir', 'accounts', 'credentialsDir', 'snapshot', 'widgetAccount', 'refreshState']) {
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

test('the tray popup anchors above a bottom taskbar, below a top menu bar and beside a side taskbar', () => {
  const size = {width: 384, height: 432};
  const bottom = anchorPopup({tray: {x: 1820, y: 1040, width: 24, height: 24}, workArea: {x: 0, y: 0, width: 1920, height: 1040}, size});
  assert.deepEqual(bottom, {x: 1460, y: 600});
  const top = anchorPopup({tray: {x: 1800, y: 0, width: 24, height: 24}, workArea: {x: 0, y: 25, width: 1920, height: 1055}, size});
  assert.deepEqual(top, {x: 1440, y: 33});
  const rightSideTaskbar = anchorPopup({tray: {x: 1900, y: 500, width: 24, height: 24}, workArea: {x: 0, y: 0, width: 1880, height: 1080}, size});
  assert.deepEqual(rightSideTaskbar, {x: 1488, y: 296});
  const leftSideTaskbar = anchorPopup({tray: {x: 0, y: 500, width: 24, height: 24}, workArea: {x: 40, y: 0, width: 1880, height: 1080}, size});
  assert.deepEqual(leftSideTaskbar, {x: 48, y: 296});
});

test('the tray popup stays inside the work area when the icon is near an edge', () => {
  const size = {width: 384, height: 432};
  const low = anchorPopup({tray: {x: 1910, y: 1030, width: 8, height: 8}, workArea: {x: 0, y: 0, width: 1920, height: 1040}, size});
  assert.ok(low.x >= 8 && low.x + size.width <= 1912);
  assert.ok(low.y >= 8 && low.y + size.height <= 1032);
  const tiny = anchorPopup({tray: {x: 5, y: 5, width: 8, height: 8}, workArea: {x: 0, y: 0, width: 400, height: 500}, size});
  assert.deepEqual(tiny, {x: 8, y: 60});
});
