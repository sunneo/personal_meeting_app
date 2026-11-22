// archive-client 的純邏輯測試（不呼叫網路）：base64 分段與 part 數量。
import assert from 'node:assert/strict';
import { bytesToB64 } from '../js/archive-client.js';
import { splitRanges, MAX_PART_BYTES } from '../js/core/archive-format.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('bytesToB64 與 Buffer 的 base64 結果一致（含大於分段大小的資料）', () => {
  const big = new Uint8Array(0x8000 * 3 + 17);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
  assert.equal(bytesToB64(big), Buffer.from(big).toString('base64'));
});
test('bytesToB64：空陣列', () => {
  assert.equal(bytesToB64(new Uint8Array(0)), '');
});
test('20MB 邊界：20MB 一份，20MB+1 兩份，最後一份只有 1 byte', () => {
  assert.equal(splitRanges(MAX_PART_BYTES).length, 1);
  const two = splitRanges(MAX_PART_BYTES + 1);
  assert.equal(two.length, 2);
  assert.equal(two[1].end - two[1].start, 1);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (archive-client)`);
  if (failed) process.exitCode = 1;
})();
