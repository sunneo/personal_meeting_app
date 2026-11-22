import assert from 'node:assert/strict';
import { flipTarget, canFlipCamera, videoConstraintsFor } from '../js/core/camera.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('前後鏡頭互換', () => {
  assert.equal(flipTarget('user'), 'environment');
  assert.equal(flipTarget('environment'), 'user');
  assert.equal(flipTarget(undefined), 'environment');
});
test('只有一顆鏡頭：隱藏切換按鈕', () => {
  assert.equal(canFlipCamera([{ kind: 'videoinput' }, { kind: 'audioinput' }]), false);
  assert.equal(canFlipCamera([]), false);
  assert.equal(canFlipCamera(null), false);
});
test('兩顆以上鏡頭：顯示切換按鈕（麥克風不算）', () => {
  assert.equal(canFlipCamera([{ kind: 'videoinput' }, { kind: 'videoinput' }]), true);
  assert.equal(canFlipCamera([{ kind: 'videoinput' }, { kind: 'audioinput' }, { kind: 'audioinput' }]), false);
});
test('限制用 ideal（找不到會退回），不用 exact', () => {
  const c = videoConstraintsFor('environment');
  assert.deepEqual(c, { facingMode: { ideal: 'environment' } });
  assert.deepEqual(videoConstraintsFor('user'), { facingMode: { ideal: 'user' } });
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (camera)`);
  if (failed) process.exitCode = 1;
})();
