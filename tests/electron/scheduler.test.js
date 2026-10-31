const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {nextRun, shouldCatchUp, createScheduler, DAY} = require('../../electron/scheduler');

const flush = () => new Promise(resolve => setImmediate(resolve));

test('the next run is today 08:30 before it and tomorrow 08:30 after it', () => {
  const before = nextRun(new Date(2026, 9, 31, 7, 5, 0));
  assert.equal(before.getDate(), 31);
  assert.equal(before.getHours(), 8);
  assert.equal(before.getMinutes(), 30);
  const after = nextRun(new Date(2026, 9, 31, 9, 0, 0));
  assert.equal(after.getDate(), 1);
  assert.equal(after.getMonth(), 10);
  assert.equal(after.getHours(), 8);
  assert.equal(after.getMinutes(), 30);
});

test('catch-up is needed when nothing succeeded or over 24 hours have passed', () => {
  const now = new Date('2026-10-31T09:00:00+08:00');
  assert.equal(shouldCatchUp(now, null), true);
  assert.equal(shouldCatchUp(now, 'not a date'), true);
  assert.equal(shouldCatchUp(now, new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString()), false);
  assert.equal(shouldCatchUp(now, new Date(now.getTime() - DAY - 1000).toISOString()), true);
  assert.equal(shouldCatchUp(now, new Date(now.getTime() - DAY + 1000).toISOString()), false);
});

test('the scheduler catches up once, reschedules for 08:30 and stops cleanly', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-scheduler-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const stateFile = path.join(dir, 'refresh-state.json');
  let now = new Date(2026, 9, 31, 9, 0, 0);
  const timers = new Map();
  let timerId = 0;
  let refreshes = 0;
  const scheduler = createScheduler({
    stateFile,
    refresh: async () => { refreshes += 1; },
    clock: () => new Date(now.getTime()),
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, {callback, delay}); return id; },
    clearTimer: id => timers.delete(id),
  });
  scheduler.start();
  await flush();
  assert.equal(refreshes, 1);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).lastSuccess, new Date(2026, 9, 31, 9, 0, 0).toISOString());
  assert.equal(timers.size, 1);
  const entry = [...timers.values()][0];
  assert.equal(entry.delay, new Date(2026, 10, 1, 8, 30, 0).getTime() - now.getTime());

  now = new Date(2026, 10, 1, 8, 30, 0);
  entry.callback();
  await flush();
  await flush();
  assert.equal(refreshes, 2);
  assert.equal(timers.size, 1);

  scheduler.stop();
  assert.equal(timers.size, 0);
});

test('resuming from sleep catches up after a long gap', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-scheduler-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const stateFile = path.join(dir, 'refresh-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({lastSuccess: new Date(2026, 9, 29, 8, 30).toISOString()}));
  let now = new Date(2026, 9, 31, 12, 0, 0);
  let refreshes = 0;
  const scheduler = createScheduler({
    stateFile,
    refresh: async () => { refreshes += 1; },
    clock: () => new Date(now.getTime()),
    setTimer: () => 1,
    clearTimer: () => {},
  });
  scheduler.start();
  await flush();
  await flush();
  assert.equal(refreshes, 1);
  scheduler.stop();
});
