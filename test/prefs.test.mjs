import assert from 'node:assert/strict';
import { normalizePrefs, prefsToCssVars, avatarSize, DEFAULT_PREFS, FONT_FAMILIES } from '../js/core/prefs.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('預設值：字體 16px、系統字體、寬度 720px', () => {
  assert.deepEqual(normalizePrefs(undefined), DEFAULT_PREFS);
  assert.deepEqual(DEFAULT_PREFS, { fontSize: 16, fontFamily: 'system', width: 720 });
});
test('字體大小與寬度會夾在範圍內', () => {
  assert.equal(normalizePrefs({ fontSize: 5 }).fontSize, 12);
  assert.equal(normalizePrefs({ fontSize: 99 }).fontSize, 24);
  assert.equal(normalizePrefs({ width: 100 }).width, 480);
  assert.equal(normalizePrefs({ width: 5000 }).width, 1200);
});
test('不合法的字體家族與數字退回預設', () => {
  assert.equal(normalizePrefs({ fontFamily: 'comic-sans' }).fontFamily, 'system');
  assert.equal(normalizePrefs({ fontFamily: 'toString' }).fontFamily, 'system');
  assert.equal(normalizePrefs({ fontSize: 'abc' }).fontSize, 16);
  assert.equal(normalizePrefs({ width: NaN }).width, 720);
});
test('合法的設定保留', () => {
  assert.deepEqual(normalizePrefs({ fontSize: 20, fontFamily: 'mono', width: 900 }), { fontSize: 20, fontFamily: 'mono', width: 900 });
});
test('prefsToCssVars 產生 CSS 變數', () => {
  const v = prefsToCssVars({ fontSize: 18, fontFamily: 'serif', width: 600 });
  assert.equal(v['--font-size'], '18px');
  assert.equal(v['--layout-width'], '600px');
  assert.equal(v['--font-family'], FONT_FAMILIES.serif);
});
test('頭像縮放：長邊不超過上限、保持比例、不放大', () => {
  assert.deepEqual(avatarSize(1000, 500, 128), { width: 128, height: 64 });
  assert.deepEqual(avatarSize(50, 40, 128), { width: 50, height: 40 });
  assert.throws(() => avatarSize(0, 10));
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (prefs)`);
  if (failed) process.exitCode = 1;
})();
