import assert from 'node:assert/strict';
import { pickMimeType, extFor, recordingFileName, validateRecording, renameRecording, MIME_CANDIDATES } from '../js/core/recording.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const blob = { size: 10 };
const good = { id: 'r1', kind: 'video', mime: 'video/webm', blob, createdAt: 1, name: '  會議  ' };

test('挑選 mimeType：依候選順序取第一個支援的', () => {
  assert.equal(pickMimeType('video', () => true), MIME_CANDIDATES.video[0]);
  assert.equal(pickMimeType('video', (m) => m === 'video/mp4'), 'video/mp4');
  assert.equal(pickMimeType('audio', (m) => m === 'audio/webm'), 'audio/webm');
});
test('挑選 mimeType：都不支援回 null；isSupported 丟錯視為不支援', () => {
  assert.equal(pickMimeType('audio', () => false), null);
  assert.equal(pickMimeType('audio', () => { throw new Error('x'); }), null);
});
test('錯誤的種類會丟錯', () => {
  assert.throws(() => pickMimeType('image', () => true), /audio 或 video/);
});
test('副檔名：mp4 或 webm', () => {
  assert.equal(extFor('video/mp4'), 'mp4');
  assert.equal(extFor('audio/mp4'), 'mp4');
  assert.equal(extFor('video/webm;codecs=vp9,opus'), 'webm');
});
test('檔名含種類與時間，依本機時間格式化', () => {
  const d = new Date(2026, 10, 22, 9, 5, 3);
  assert.equal(recordingFileName('video', 'video/webm', d), 'rec-video-20261122-090503.webm');
  assert.equal(recordingFileName('audio', 'audio/mp4', d), 'rec-audio-20261122-090503.mp4');
});
test('紀錄驗證：正常通過並去除名稱前後空白', () => {
  assert.equal(validateRecording(good).name, '會議');
});
test('紀錄驗證：缺欄位或種類錯誤會丟錯', () => {
  assert.throws(() => validateRecording({ ...good, kind: 'gif' }), /kind/);
  assert.throws(() => validateRecording({ ...good, blob: null }), /錄製內容/);
  assert.throws(() => validateRecording({ ...good, name: '   ' }), /名稱/);
  assert.throws(() => validateRecording({ ...good, createdAt: 'x' }), /時間/);
});
test('重新命名只改名稱', () => {
  const r = renameRecording(good, ' 新名字 ');
  assert.equal(r.name, '新名字');
  assert.equal(r.id, 'r1');
  assert.throws(() => renameRecording(good, ''), /名稱/);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (recording)`);
  if (failed) process.exitCode = 1;
})();
