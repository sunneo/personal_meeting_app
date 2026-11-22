import assert from 'node:assert/strict';
import { summarizeUsage, formatBytes, textBytes } from '../js/core/storage-usage.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('textBytes：UTF-8 位元組數（中文每字 3 bytes）', () => {
  assert.equal(textBytes('abc'), 3);
  assert.equal(textBytes('你好'), 6);
  assert.equal(textBytes(undefined), 0);
});
test('summarizeUsage：文字、附件分類統計與總量', () => {
  const s = summarizeUsage([
    { body: '你好', attachments: [] },
    { body: 'x', subtitle: 'yy', attachments: [{ category: 'pdf', blob: { size: 100 } }, { category: 'audio', blob: { size: 50 } }] },
    { body: '', attachments: [{ category: 'pdf', blob: { size: 25 } }] },
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.textBytes, 6 + 1 + 2);
  assert.equal(s.attachmentBytes, 175);
  assert.deepEqual(s.byCategory.pdf, { count: 2, bytes: 125 });
  assert.deepEqual(s.byCategory.audio, { count: 1, bytes: 50 });
  assert.equal(s.totalBytes, 9 + 175);
});
test('summarizeUsage：空陣列與缺欄位不出錯', () => {
  assert.equal(summarizeUsage([]).totalBytes, 0);
  assert.equal(summarizeUsage([{ attachments: [{ blob: null }] }]).attachmentBytes, 0);
});
test('formatBytes：單位換算', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(-1), '—');
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (storage-usage)`);
  if (failed) process.exitCode = 1;
})();
