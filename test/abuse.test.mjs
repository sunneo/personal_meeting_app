import assert from 'node:assert/strict';
import {
  normalizeRegistrationMode, registrationDecision, isReservedCode, normalizeIp, regRateKeys,
  checkRegistrationRate, quotaKeys, checkDailyAppend, checkAttachmentQuota, verifyTurnstile,
  REG_LIMITS, QUOTA, hourIndex, dayIndex,
} from '../cloudflare/archive-worker/abuse.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const MB = 1024 * 1024;

test('註冊模式：預設 open；invite/closed 有效；未知值視為 closed', () => {
  assert.equal(normalizeRegistrationMode(undefined), 'open');
  assert.equal(normalizeRegistrationMode(''), 'open');
  assert.equal(normalizeRegistrationMode('invite'), 'invite');
  assert.equal(normalizeRegistrationMode('closed'), 'closed');
  assert.equal(normalizeRegistrationMode('whatever'), 'closed');
});
test('註冊決策：open 不需邀請碼；closed 一律拒絕', () => {
  assert.equal(registrationDecision('open', {}).allowed, true);
  assert.equal(registrationDecision('closed', { inviteConfigured: true, inviteOk: true }).allowed, false);
});
test('註冊決策：invite 需要設定 INVITE_CODE 且邀請碼正確', () => {
  assert.equal(registrationDecision('invite', { inviteConfigured: true, inviteOk: true }).allowed, true);
  assert.equal(registrationDecision('invite', { inviteConfigured: true, inviteOk: false }).status, 403);
  assert.match(registrationDecision('invite', { inviteConfigured: false, inviteOk: true }).error, /INVITE_CODE/);
});
test('保留字：系統名稱不能註冊，一般代號可以', () => {
  assert.equal(isReservedCode('admin'), true);
  assert.equal(isReservedCode('ADMIN'), true);
  assert.equal(isReservedCode('alice'), false);
});
test('IP：清理非法字元，缺少就 unknown', () => {
  assert.equal(normalizeIp('203.0.113.7'), '203.0.113.7');
  assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
  assert.equal(normalizeIp(''), 'unknown');
  assert.equal(normalizeIp('1.2.3.4;drop'), 'unknown');
  assert.equal(normalizeIp('x'.repeat(100)), 'unknown');
});
test('註冊頻率：每小時 5 個、每天 10 個', () => {
  assert.equal(checkRegistrationRate({ hour: 4, day: 9 }).ok, true);
  const h = checkRegistrationRate({ hour: 5, day: 0 });
  assert.equal(h.ok, false);
  assert.equal(h.status, 429);
  const d = checkRegistrationRate({ hour: 0, day: REG_LIMITS.perDay });
  assert.equal(d.ok, false);
  assert.match(d.error, /今天/);
});
test('註冊頻率的 KV 鍵：同一小時同一 IP 共用，換小時就換鍵', () => {
  const t = Date.UTC(2026, 10, 22, 10, 5);
  assert.deepEqual(regRateKeys('1.2.3.4', t), regRateKeys('1.2.3.4', t + 60000));
  assert.notEqual(regRateKeys('1.2.3.4', t).hour, regRateKeys('1.2.3.4', t + 3600000).hour);
  assert.notEqual(regRateKeys('1.2.3.4', t).hour, regRateKeys('5.6.7.8', t).hour);
  assert.equal(hourIndex(t), Math.floor(t / 3600000));
  assert.equal(dayIndex(t), Math.floor(t / 86400000));
});
test('每日 /append 次數上限', () => {
  assert.equal(checkDailyAppend({ count: QUOTA.dailyAppends - 1 }).ok, true);
  assert.equal(checkDailyAppend({ count: QUOTA.dailyAppends }).status, 429);
});
test('附件配額：單檔超過上限回 413', () => {
  const r = checkAttachmentQuota({ bytes: 0, parts: 0 }, QUOTA.maxFileBytes + 1, 1);
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
});
test('附件配額：每月總量超過回 413；每日 part 次數超過回 429', () => {
  const nearFull = { bytes: QUOTA.monthBytes - 10, parts: 0 };
  assert.equal(checkAttachmentQuota(nearFull, 20 * MB, 20 * MB).status, 413);
  assert.equal(checkAttachmentQuota({ bytes: 0, parts: QUOTA.dailyParts }, 1, 1).status, 429);
  assert.equal(checkAttachmentQuota({ bytes: 0, parts: 0 }, 1 * MB, 1 * MB).ok, true);
});
test('配額鍵：月與日分開，同帳號同月共用', () => {
  const t = Date.UTC(2026, 10, 22);
  const k = quotaKeys('alice', t);
  assert.match(k.month, /2026-11/);
  assert.notEqual(k.day, quotaKeys('alice', t + 86400000).day);
  assert.equal(quotaKeys('alice', t).month, quotaKeys('alice', t + 3600000).month);
});
test('Turnstile：未設定 secret 直接略過（通過）', async () => {
  const r = await verifyTurnstile('tok', '1.2.3.4', '', async () => { throw new Error('should not call'); });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
});
test('Turnstile：有 secret 但沒有 token → 拒絕，不呼叫網路', async () => {
  const r = await verifyTurnstile('', '1.2.3.4', 'sec', async () => { throw new Error('should not call'); });
  assert.equal(r.ok, false);
});
test('Turnstile：呼叫 siteverify 並依 success 判斷', async () => {
  let body = null;
  const okFetch = async (url, init) => { body = init.body; return { json: async () => ({ success: true }) }; };
  const r = await verifyTurnstile('tok', '1.2.3.4', 'sec', okFetch);
  assert.equal(r.ok, true);
  assert.equal(body.get('secret'), 'sec');
  assert.equal(body.get('response'), 'tok');
  assert.equal(body.get('remoteip'), '1.2.3.4');
  const badFetch = async () => ({ json: async () => ({ success: false }) });
  assert.equal((await verifyTurnstile('tok', 'unknown', 'sec', badFetch)).ok, false);
  const throwFetch = async () => { throw new Error('net'); };
  assert.equal((await verifyTurnstile('tok', '1.2.3.4', 'sec', throwFetch)).ok, false);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (abuse)`);
  if (failed) process.exitCode = 1;
})();
