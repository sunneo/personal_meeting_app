import assert from 'node:assert/strict';
import { buildIceServers, fetchTurnCredentials, mailboxPush, mailboxDrain, MAILBOX_MAX, MAILBOX_TTL_SEC, TURN_TTL_SEC } from '../cloudflare/archive-worker/rtc.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('沒有 TURN 回應：只回傳 STUN，turn=false', () => {
  const r = buildIceServers(null);
  assert.equal(r.turn, false);
  assert.ok(r.iceServers[0].urls[0].startsWith('stun:'));
  assert.equal(r.iceServers.length, 1);
});
test('TURN 回應（物件形狀）：加入 turn 伺服器並保留 STUN', () => {
  const r = buildIceServers({ iceServers: { urls: ['turn:turn.example:3478?transport=udp', 'turns:turn.example:5349'], username: 'u', credential: 'c' } });
  assert.equal(r.turn, true);
  assert.equal(r.iceServers.length, 2);
  assert.equal(r.iceServers[1].username, 'u');
});
test('TURN 回應（陣列形狀）與錯誤的 URL 會被過濾', () => {
  const r = buildIceServers([{ urls: ['https://bad'], username: 'u', credential: 'c' }, { urls: 'turn:x:3478', username: 'u', credential: 'c' }]);
  assert.equal(r.iceServers.length, 2);
  assert.deepEqual(r.iceServers[1].urls, ['turn:x:3478']);
});
test('缺少 username/credential 的 TURN 不會加入', () => {
  assert.equal(buildIceServers({ iceServers: { urls: 'turn:x' } }).turn, false);
});
test('TURN 憑證：沒有 secrets 不呼叫網路，回傳 null', async () => {
  let called = false;
  const r = await fetchTurnCredentials({}, async () => { called = true; return { ok: true, json: async () => ({}) }; });
  assert.equal(r, null);
  assert.equal(called, false);
});
test('TURN 憑證：呼叫 Cloudflare Calls 並帶 ttl；失敗回 null', async () => {
  let seen = null;
  const okFetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ iceServers: [] }) }; };
  const r = await fetchTurnCredentials({ TURN_KEY_ID: 'kid', TURN_API_TOKEN: 'tok' }, okFetch);
  assert.deepEqual(r, { iceServers: [] });
  assert.match(seen.url, /turn\/keys\/kid\/credentials/);
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(JSON.parse(seen.init.body).ttl, TURN_TTL_SEC);
  const failFetch = async () => ({ ok: false, status: 500 });
  assert.equal(await fetchTurnCredentials({ TURN_KEY_ID: 'k', TURN_API_TOKEN: 't' }, failFetch), null);
  const throwFetch = async () => { throw new Error('net'); };
  assert.equal(await fetchTurnCredentials({ TURN_KEY_ID: 'k', TURN_API_TOKEN: 't' }, throwFetch), null);
});
test('信箱：保留最新 MAILBOX_MAX 則', () => {
  let list = [];
  for (let i = 0; i < MAILBOX_MAX + 5; i++) list = mailboxPush(list, { i }, 1000 + i);
  assert.equal(list.length, MAILBOX_MAX);
  assert.equal(list[list.length - 1].msg.i, MAILBOX_MAX + 4);
});
test('信箱：過期的訊息不會被取出', () => {
  const now = 10_000_000;
  const list = [{ at: now - MAILBOX_TTL_SEC * 1000 - 1, msg: 'old' }, { at: now - 1000, msg: 'new' }];
  assert.deepEqual(mailboxDrain(list, now).messages, ['new']);
  assert.deepEqual(mailboxDrain(undefined, now).messages, []);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (worker-rtc)`);
  if (failed) process.exitCode = 1;
})();
