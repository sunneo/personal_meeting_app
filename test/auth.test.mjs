// 認證純邏輯的測試。Node 16 沒有全域 crypto，這裡明確傳入 webcrypto。不依賴 node:test。
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  hashPassword, verifyPassword, signToken, verifyToken, validCode, validPassword,
  normalizeCode, loginGate, afterFailure, afterSuccess, MAX_LOGIN_FAILS, LOCK_SEC,
  toB64Url, fromB64Url, constantTimeEqual,
} from '../cloudflare/archive-worker/auth.js';

const cr = webcrypto;
const SECRET = 'x'.repeat(40);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('代號驗證：3–32 字元小寫英數底線連字號', () => {
  assert.equal(validCode('alice_01'), true);
  assert.equal(validCode('ab'), false);
  assert.equal(validCode('bad name'), false);
  assert.equal(validCode('a'.repeat(33)), false);
  assert.equal(normalizeCode('  Alice '), 'alice');
});
test('密碼驗證：至少 8 字元', () => {
  assert.equal(validPassword('1234567'), false);
  assert.equal(validPassword('12345678'), true);
});
test('base64url 來回轉換與常數時間比較', () => {
  const b = Uint8Array.from([0, 255, 128, 7, 250]);
  assert.deepEqual(fromB64Url(toB64Url(b)), b);
  assert.equal(constantTimeEqual(b, Uint8Array.from([0, 255, 128, 7, 250])), true);
  assert.equal(constantTimeEqual(b, Uint8Array.from([0, 255, 128, 7, 251])), false);
});
test('防暴力：連續失敗到上限會鎖定，鎖定期間不允許', () => {
  let rec = null;
  const now = 1_000_000;
  for (let i = 0; i < MAX_LOGIN_FAILS; i++) rec = afterFailure(rec, now);
  assert.equal(loginGate(rec, now).allowed, false);
  assert.equal(loginGate(rec, now).retryAfter, LOCK_SEC * 1000);
  assert.equal(loginGate(rec, now + LOCK_SEC * 1000 + 1).allowed, true);
});
test('登入成功清除失敗紀錄', () => {
  const rec = afterSuccess(afterFailure(null, 0));
  assert.equal(rec.fails, 0);
  assert.equal(rec.lockedUntil, 0);
});
test('密碼雜湊：正確密碼通過，錯誤密碼不通過，salt 每次不同', async () => {
  const rec = await hashPassword('correct horse', cr, 1000);
  assert.equal(await verifyPassword('correct horse', rec, cr), true);
  assert.equal(await verifyPassword('correct horsf', rec, cr), false);
  assert.notEqual(rec.salt, (await hashPassword('correct horse', cr, 1000)).salt);
});
test('token：簽發後可驗證，回傳 sub 與 exp', async () => {
  const now = 1_700_000_000;
  const { token, exp } = await signToken('alice', SECRET, now, cr);
  assert.equal(exp, now + 7200);
  assert.deepEqual(await verifyToken(token, SECRET, now + 10, cr), { sub: 'alice', exp });
});
test('token：過期就失效；格式錯誤與空值回 null', async () => {
  const now = 1_700_000_000;
  const { token } = await signToken('alice', SECRET, now, cr, 60);
  assert.notEqual(await verifyToken(token, SECRET, now + 59, cr), null);
  assert.equal(await verifyToken(token, SECRET, now + 60, cr), null);
  assert.equal(await verifyToken('', SECRET, 0, cr), null);
  assert.equal(await verifyToken('a.b.c', SECRET, 0, cr), null);
  assert.equal(await verifyToken(null, SECRET, 0, cr), null);
});
test('token：換了密鑰、竄改內容或簽章就失效', async () => {
  const now = 1_700_000_000;
  const { token } = await signToken('alice', SECRET, now, cr);
  assert.equal(await verifyToken(token, 'y'.repeat(40), now, cr), null);
  const [body, sig] = token.split('.');
  const forgedBody = toB64Url(new TextEncoder().encode(JSON.stringify({ sub: 'bob', iat: now, exp: now + 7200 })));
  assert.equal(await verifyToken(`${forgedBody}.${sig}`, SECRET, now, cr), null);
  assert.equal(await verifyToken(`${body}.AAAA`, SECRET, now, cr), null);
});
test('token：SESSION_SECRET 太短就拒絕簽發', async () => {
  await assert.rejects(() => signToken('alice', 'short', 0, cr));
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (auth)`);
  if (failed) process.exitCode = 1;
})();
