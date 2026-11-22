import assert from 'node:assert/strict';
import { normalizeLoginCode, validateLogin, validateRegister, viewFor, describeFailure } from '../js/core/auth-form.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('代號正規化：去空白、小寫', () => {
  assert.equal(normalizeLoginCode('  Alice '), 'alice');
  assert.equal(normalizeLoginCode(null), '');
});
test('登入驗證：代號與密碼必填', () => {
  assert.equal(validateLogin({ code: 'alice', password: 'x' }), null);
  assert.match(validateLogin({ code: 'a', password: 'x' }), /代號/);
  assert.match(validateLogin({ code: 'alice', password: '' }), /密碼/);
});
test('註冊驗證：密碼至少 8 字元、兩次要一致；不需要邀請碼', () => {
  const ok = { code: 'alice', password: '12345678', password2: '12345678' };
  assert.equal(validateRegister(ok), null);
  assert.match(validateRegister({ ...ok, password: '1234567', password2: '1234567' }), /8 字元/);
  assert.match(validateRegister({ ...ok, password2: '12345679' }), /不一致/);
  assert.equal(validateRegister({ code: 'alice', password: '12345678', password2: '12345678', invite: '' }), null);
  assert.match(validateRegister({ ...ok, code: 'bad name' }), /代號/);
});
test('畫面選擇：未登入一律 gate；登入或選離線才進 main', () => {
  assert.equal(viewFor({ loggedIn: false, offlineChosen: false }), 'gate');
  assert.equal(viewFor({ loggedIn: true, offlineChosen: false }), 'main');
  assert.equal(viewFor({ loggedIn: false, offlineChosen: true }), 'main');
});
test('錯誤訊息：網路失敗不可當作已登入，要有明確說明', () => {
  assert.match(describeFailure({ networkError: true }, '登入'), /無法連線/);
  assert.equal(describeFailure({ status: 401, data: { error: '代號或密碼不對' } }, '登入'), '代號或密碼不對');
  assert.match(describeFailure({ status: 500 }, '登入'), /HTTP 500/);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (auth-form)`);
  if (failed) process.exitCode = 1;
})();
