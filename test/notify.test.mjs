import assert from 'node:assert/strict';
import { notificationPlan, checkCustomSound, SOUND_PRESETS, MAX_CUSTOM_SOUND_BYTES } from '../js/core/notify.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const on = { mode: 'web', sound: 'ding', customSound: false };

test('自己發的訊息不通知、不響', () => {
  assert.deepEqual(notificationPlan(on, { fromMe: true, pageVisible: false }), { showNotification: false, playSound: false });
});
test('關閉通知時不做任何事', () => {
  assert.deepEqual(notificationPlan({ ...on, mode: 'off' }, { fromMe: false, pageVisible: false }), { showNotification: false, playSound: false });
});
test('頁面不可見：跳通知並響', () => {
  assert.deepEqual(notificationPlan(on, { fromMe: false, pageVisible: false }), { showNotification: true, playSound: true });
});
test('頁面可見：只響，不跳系統通知', () => {
  assert.deepEqual(notificationPlan(on, { fromMe: false, pageVisible: true }), { showNotification: false, playSound: true });
});
test('靜音且沒有自訂音效：不響', () => {
  assert.equal(notificationPlan({ ...on, sound: 'none' }, { fromMe: false, pageVisible: false }).playSound, false);
});
test('有自訂音效時即使預設是靜音也會響', () => {
  assert.equal(notificationPlan({ mode: 'web', sound: 'none', customSound: true }, { fromMe: false, pageVisible: false }).playSound, true);
});
test('預設音效都有定義', () => {
  for (const k of ['ding', 'chime', 'none']) assert.ok(SOUND_PRESETS[k]);
});
test('自訂音效檢查：型別與大小', () => {
  assert.equal(checkCustomSound(null), '沒有選擇檔案');
  assert.match(checkCustomSound({ type: 'image/png', size: 10 }), /音訊檔/);
  assert.match(checkCustomSound({ type: 'audio/mpeg', size: MAX_CUSTOM_SOUND_BYTES + 1 }), /1MB/);
  assert.equal(checkCustomSound({ type: 'audio/mpeg', size: 1000 }), null);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (notify)`);
  if (failed) process.exitCode = 1;
})();
