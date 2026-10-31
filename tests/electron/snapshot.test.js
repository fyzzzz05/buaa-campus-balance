const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createSnapshot, mergeSnapshot, serialize, MAX_BYTES} = require('../../lib/widget-snapshot');

const ok = (value, note, history = []) => ({status: 'ok', value, note, history});

test('a failed item keeps the last successful value and is marked stale', () => {
  const previous = createSnapshot({card: ok(22.5, '当前余额'), net: ok(12.3, '本期已用 1.25 GB'), lighting: ok(5, '截至 2026-10-28'), air: ok(4, '截至 2026-10-28')});
  const fresh = createSnapshot({card: ok(20, '当前余额'), lighting: {status: 'unavailable', note: '暂时无法查询'}});
  const merged = mergeSnapshot(fresh, previous);
  assert.equal(merged.card.value, 20);
  assert.equal(merged.lighting.value, 5);
  assert.equal(merged.lighting.note, '更新失败');
  assert.equal(merged.lighting.updatedAt, previous.lighting.updatedAt);
  assert.equal(merged.air.value, 4);
  assert.equal(merged.network.value, 12.3);
  assert.equal(merged.network.note, '更新失败');
});

test('daily history is kept for the popup chart and merged with balance refreshes', () => {
  const days = Array.from({length: 14}, (_, index) => ({date: `2026-10-${String(index + 18).padStart(2, '0')}`, value: index % 3 === 0 ? null : index + 0.5}));
  const snapshot = createSnapshot({card: ok(22.5, '当前余额', days)});
  assert.equal(snapshot.card.history.length, 14);
  assert.equal(snapshot.card.history[1].value, 1.5);
  assert.equal(snapshot.card.history[0].value, null);
  // The daily scheduler refreshes balances only; the chart keeps the last series.
  const balanceOnly = createSnapshot({card: ok(21, '当前余额')});
  const merged = mergeSnapshot(balanceOnly, snapshot);
  assert.equal(merged.card.value, 21);
  assert.equal(merged.card.history.length, 14);
  const failed = mergeSnapshot(createSnapshot({card: {status: 'unavailable'}}), merged);
  assert.equal(failed.card.value, 21);
  assert.equal(failed.card.note, '更新失败');
  assert.equal(failed.card.history.length, 14);
});

test('without a previous snapshot nothing is invented', () => {
  const fresh = createSnapshot({card: {status: 'unavailable', note: 'x'}});
  const merged = mergeSnapshot(fresh, null);
  assert.deepEqual(merged.card, {value: null, note: '暂不可用', updatedAt: null, history: []});
});

test('serialized snapshots stay inside the 4096 byte widget limit', () => {
  const snapshot = createSnapshot({
    card: ok(1234.56, '当前余额'),
    net: ok(99.9, '本期已用 11.25 GB'),
    lighting: ok(67.68, '截至 2026-10-28'),
    air: ok(8.64, '截至 2026-10-28'),
  });
  const text = serialize(snapshot);
  assert.ok(Buffer.byteLength(text) <= MAX_BYTES);
  assert.deepEqual(Object.keys(JSON.parse(text)), ['updatedAt', 'card', 'network', 'lighting', 'air']);
  assert.throws(() => serialize({note: 'x'.repeat(MAX_BYTES)}), /Widget snapshot too large/);
});

test('snapshots never carry credentials, cookies or transaction records', () => {
  const snapshot = createSnapshot({
    card: {...ok(22.5, '当前余额'), records: [{password: 'secret'}], jar: 'cookie'},
    net: {...ok(1, '本期已用 1 GB'), netDigest: 'digest'},
    lighting: ok(3, '截至 2026-10-28'),
    air: ok(4, '截至 2026-10-28'),
  });
  const text = JSON.stringify(snapshot);
  assert.equal(text.includes('secret'), false);
  assert.equal(text.includes('cookie'), false);
  assert.equal(text.includes('digest'), false);
});
