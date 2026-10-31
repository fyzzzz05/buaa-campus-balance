'use strict';
// Daily 08:30 refresh scheduling. The decision logic is pure so it can be tested
// with an injected clock and timer.
const fs = require('node:fs');
const path = require('node:path');

const HOUR = 8;
const MINUTE = 30;
const DAY = 24 * 60 * 60 * 1000;

function nextRun(now = new Date(), hour = HOUR, minute = MINUTE) {
  const target = new Date(now.getTime());
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target;
}

function shouldCatchUp(now, lastSuccess) {
  if (!lastSuccess) return true;
  const timestamp = Date.parse(lastSuccess);
  if (!Number.isFinite(timestamp)) return true;
  return now.getTime() - timestamp > DAY;
}

function readState(file, fileSystem = fs) {
  try {
    const value = JSON.parse(fileSystem.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

function writeState(file, value, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fileSystem.writeFileSync(file, JSON.stringify(value), {mode: 0o600});
}

function createScheduler({refresh, stateFile, clock = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, fileSystem = fs, onError = () => {}}) {
  let timer = null;
  let running = false;
  let stopped = true;

  const state = () => readState(stateFile, fileSystem);
  function mark(update) {
    const next = {...state(), ...update};
    try { writeState(stateFile, next, fileSystem); } catch { /* state is advisory */ }
    return next;
  }

  function schedule() {
    if (stopped) return;
    if (timer) { clearTimer(timer); timer = null; }
    const now = clock();
    const at = nextRun(now);
    timer = setTimer(() => {
      const fired = timer;
      timer = null;
      if (fired !== null) clearTimer(fired);
      void runOnce().finally(() => schedule());
    }, Math.max(1000, at.getTime() - now.getTime()));
  }

  async function runOnce() {
    if (running) return false;
    running = true;
    const startedAt = clock();
    mark({lastAttempt: startedAt.toISOString()});
    try {
      await refresh();
      mark({lastSuccess: clock().toISOString(), lastError: null});
      return true;
    } catch (error) {
      mark({lastError: 'refresh'});
      try { onError(error); } catch { /* logging must not break scheduling */ }
      return false;
    } finally {
      running = false;
    }
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    if (shouldCatchUp(clock(), state().lastSuccess)) void runOnce().finally(() => schedule());
    else schedule();
  }
  function stop() {
    stopped = true;
    if (timer) { clearTimer(timer); timer = null; }
  }
  function resume() {
    if (stopped) return;
    if (shouldCatchUp(clock(), state().lastSuccess)) void runOnce().finally(() => schedule());
    else schedule();
  }

  return {start, stop, resume, refreshNow: runOnce, next: () => nextRun(clock()), state};
}

module.exports = {HOUR, MINUTE, DAY, nextRun, shouldCatchUp, createScheduler};
