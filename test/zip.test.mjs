import assert from 'node:assert/strict';
import { crc32, buildZip, readZip } from '../js/core/zip.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('CRC32 標準測試向量："123456789" → CBF43926', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});
test('zip 往返：文字與二進位檔都能還原（含中文檔名）', () => {
  const files = [
    { name: 'conversation-2026-11.jsonl', data: '{"id":"a","body":"你好"}\n' },
    { name: 'attachments/song.bin', data: Uint8Array.from([0, 1, 2, 255, 254]) },
  ];
  const zip = buildZip(files);
  const back = readZip(zip);
  assert.equal(back.length, 2);
  assert.equal(back[0].name, 'conversation-2026-11.jsonl');
  assert.equal(new TextDecoder().decode(back[0].data), files[0].data);
  assert.deepEqual(back[1].data, files[1].data);
});
test('zip：空檔案也可以', () => {
  const back = readZip(buildZip([{ name: 'empty.txt', data: '' }]));
  assert.equal(back[0].data.length, 0);
});
test('zip：不允許 .. 或絕對路徑', () => {
  assert.throws(() => buildZip([{ name: '../x', data: 'a' }]), /不合法/);
  assert.throws(() => buildZip([{ name: '/etc/x', data: 'a' }]), /不合法/);
});
test('zip：資料被竄改時 CRC 會發現', () => {
  const zip = buildZip([{ name: 'a.txt', data: 'hello world' }]);
  const idx = zip.indexOf(0x68); // 'h'
  zip[idx] = 0x48; // 'H'
  assert.throws(() => readZip(zip), /CRC/);
});
test('zip：不是 zip 就報錯', () => {
  assert.throws(() => readZip(new Uint8Array([1, 2, 3])), /不是有效的 zip/);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (zip)`);
  if (failed) process.exitCode = 1;
})();
