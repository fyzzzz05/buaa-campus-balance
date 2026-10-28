const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSnapshot}=require('../lib/widget-snapshot');

test('widget snapshot excludes credentials, account identifiers and detailed transactions',()=>{
  const result=createSnapshot({
    card:{status:'ok',value:22.5,note:'当前余额',records:[{label:'private'}],password:'secret'},
    net:{status:'ok',value:12.3,note:'本期已用 1.25 GB',netDigest:'secret'},
    lighting:{status:'ok',value:5,note:'截至 2026-10-28'},air:{status:'unavailable',note:'secret'}
  },new Date('2026-10-28T01:00:00Z'));
  assert.deepEqual(Object.keys(result),['updatedAt','card','network','lighting','air']);
  assert.equal(result.card.value,22.5);assert.equal(result.air.value,null);
  assert(!JSON.stringify(result).includes('secret'));assert(!JSON.stringify(result).includes('private'));
});
