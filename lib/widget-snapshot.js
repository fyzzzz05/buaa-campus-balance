'use strict';
// Only these four display values cross the app/widget boundary.
// School cookies, account identifiers, transaction records and credentials do not.
const runtime = require('./runtime');

const MAX_BYTES = 4096;
const KINDS = ['card', 'network', 'lighting', 'air'];

function createSnapshot(data, now = new Date()) {
  const updatedAt = now.toISOString();
  const item = (value, unit) => {
    if (value?.status !== 'ok' || !Number.isFinite(value.value) || value.value < 0) return {value: null, note: '暂不可用', updatedAt: null};
    const note = unit === 'network' && /^本期已用 \d+(?:\.\d+)? GB$/.test(value.note || '') ? value.note :
      unit === 'power' && /^截至 \d{4}-\d{2}-\d{2}/.test(value.note || '') ? value.note.slice(0, 13) : '当前余额';
    return {value: value.value, note, updatedAt};
  };
  return {
    updatedAt,
    card: item(data?.card, 'card'),
    network: item(data?.net, 'network'),
    lighting: item(data?.lighting, 'power'),
    air: item(data?.air, 'power'),
  };
}

// A failed item keeps the last successful value and is marked as stale, so the
// widget never shows an empty card just because one school request failed.
function mergeSnapshot(fresh, previous) {
  const merged = {...fresh};
  if (!previous || typeof previous !== 'object') return merged;
  for (const kind of KINDS) {
    const current = merged[kind];
    const old = previous[kind];
    if (!current || current.value !== null) continue;
    if (!old || !Number.isFinite(old.value) || old.value < 0) continue;
    merged[kind] = {...old, note: '更新失败'};
  }
  return merged;
}

function serialize(snapshot) {
  const text = JSON.stringify(snapshot);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Widget snapshot too large');
  return text;
}

async function send(payload) {
  const helper = process.env.CAMPUS_WIDGET_HELPER;
  if (process.env.CAMPUS_APP !== '1' || !helper) return;
  const {spawn} = require('node:child_process');
  await new Promise((resolve, reject) => {
    const child = spawn(helper, [], {stdio: ['pipe', 'ignore', 'ignore']});
    const timer = setTimeout(() => { child.kill(); reject(new Error('Widget storage timeout')); }, 3000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Widget storage unavailable')); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Widget storage unavailable')); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

async function publish(data) {
  const store = runtime.widget();
  if (store) {
    const merged = mergeSnapshot(createSnapshot(data), store.read());
    const text = serialize(merged);
    store.write(JSON.parse(text));
    return;
  }
  await send(createSnapshot(data));
}

async function clear() {
  const store = runtime.widget();
  if (store) { store.clear(); return; }
  await send({action: 'clear'});
}

module.exports = {createSnapshot, mergeSnapshot, serialize, publish, clear, MAX_BYTES};
