// 不依賴 node:test（Node 16 沒有）。失敗時列出錯誤並以非零碼結束。
import assert from 'node:assert/strict';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
process.on('exit', () => {
  let failed = 0;
  for (const t of tests) {
    try { t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exitCode = 1;
});
import { monthOf, splitRanges, partPath, toJsonlLine, parseJsonl, MAX_PART_BYTES } from '../js/core/archive-format.js';
import { monthOf as workerMonthOf, partPath as workerPartPath, validMonth, validName } from '../cloudflare/archive-worker/worker.js';

test('monthOf 以 UTC+8 切月', () => {
  // 2026-01-31 23:30 UTC+8 → 2026-01
  assert.equal(monthOf(Date.UTC(2026, 0, 31, 15, 30)), '2026-01');
  // 2026-01-31 16:00 UTC → 2026-02-01 00:00 UTC+8 → 2026-02
  assert.equal(monthOf(Date.UTC(2026, 0, 31, 16, 0)), '2026-02');
  assert.equal(monthOf(0), '1970-01');
});

test('前端與 worker 的 monthOf / partPath 結果一致', () => {
  const samples = [0, Date.UTC(2026, 11, 31, 16, 0), Date.UTC(2027, 0, 1, 0, 0), 1732250000000];
  for (const ts of samples) assert.equal(monthOf(ts), workerMonthOf(ts));
  assert.equal(partPath('2026-11', 'pdf', 'a.pdf', 1, 1), workerPartPath('2026-11', 'pdf', 'a.pdf', 1, 1));
  assert.equal(partPath('2026-11', 'pdf', 'a.pdf', 3, 5), workerPartPath('2026-11', 'pdf', 'a.pdf', 3, 5));
});

test('splitRanges：剛好 20MB 只切一份；多 1 byte 就切兩份', () => {
  assert.deepEqual(splitRanges(MAX_PART_BYTES), [{ index: 1, start: 0, end: MAX_PART_BYTES }]);
  assert.deepEqual(splitRanges(MAX_PART_BYTES + 1), [
    { index: 1, start: 0, end: MAX_PART_BYTES },
    { index: 2, start: MAX_PART_BYTES, end: MAX_PART_BYTES + 1 },
  ]);
});

test('splitRanges：各段不超過 20MB 且首尾相接、涵蓋全部', () => {
  const total = 45 * 1024 * 1024 + 123;
  const parts = splitRanges(total);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].start, 0);
  assert.equal(parts[parts.length - 1].end, total);
  for (let i = 0; i < parts.length; i++) {
    assert.ok(parts[i].end - parts[i].start <= MAX_PART_BYTES);
    assert.equal(parts[i].index, i + 1);
    if (i > 0) assert.equal(parts[i].start, parts[i - 1].end);
  }
});

test('splitRanges：0 bytes 與錯誤輸入', () => {
  assert.deepEqual(splitRanges(0), [{ index: 1, start: 0, end: 0 }]);
  assert.throws(() => splitRanges(-1));
  assert.throws(() => splitRanges(1.5));
});

test('partPath：單份無後綴，多份有 .partNNN', () => {
  assert.equal(partPath('2026-11', 'audio', 'song.mp3', 1, 1), '2026-11/audio/song.mp3');
  assert.equal(partPath('2026-11', 'audio', 'song.mp3', 2, 3), '2026-11/audio/song.mp3.part002');
});

test('JSONL：序列化後可以還原，中文與空行處理正確', () => {
  const msgs = [{ id: 'a', ts: 1, body: '你好 🎤' }, { id: 'b', ts: 2, body: 'x\ny' }];
  const text = msgs.map(toJsonlLine).join('') + '\n';
  assert.deepEqual(parseJsonl(text), msgs);
});

test('JSONL：壞掉的一行會報出行號', () => {
  assert.throws(() => parseJsonl('{"ok":1}\n{bad\n'), /第 2 行/);
});

test('worker 的輸入檢查', () => {
  assert.equal(validMonth('2026-11'), true);
  assert.equal(validMonth('2026-13'), false);
  assert.equal(validMonth('26-11'), false);
  assert.equal(validName('a.pdf'), true);
  assert.equal(validName('../x'), false);
  assert.equal(validName('a/b'), false);
  assert.equal(validName(''), false);
});
