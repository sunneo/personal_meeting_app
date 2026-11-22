import assert from 'node:assert/strict';
import { encodeFrame, decodeFrame, broadcastFrame, extractSignal, joinFrame, inboxTopic, realtimeWsUrl } from '../js/core/realtime-frame.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('inboxTopic：合法代號；不合法代號丟錯', () => {
  assert.equal(inboxTopic('alice'), 'realtime:pma-inbox-alice');
  assert.throws(() => inboxTopic('Bad Name'), /不合法/);
});
test('realtimeWsUrl：https → wss，帶 apikey 與 vsn；非 https 拒絕', () => {
  assert.equal(realtimeWsUrl('https://abc.supabase.co', 'K'), 'wss://abc.supabase.co/realtime/v1/websocket?apikey=K&vsn=1.0.0');
  assert.throws(() => realtimeWsUrl('http://x.test', 'K'), /https/);
});
test('encode/decode 往返', () => {
  const s = encodeFrame('realtime:pma-inbox-bob', 'broadcast', { a: 1 }, 7);
  assert.deepEqual(decodeFrame(s), { topic: 'realtime:pma-inbox-bob', event: 'broadcast', payload: { a: 1 }, ref: '7' });
});
test('心跳頻道 phoenix 可以編碼', () => {
  assert.equal(decodeFrame(encodeFrame('phoenix', 'heartbeat', {}, 1)).topic, 'phoenix');
});
test('頻道名稱不合法會被拒絕', () => {
  assert.throws(() => encodeFrame('other:x', 'broadcast', {}, 1), /頻道/);
});
test('decode：非 JSON 或缺欄位會丟錯', () => {
  assert.throws(() => decodeFrame('{bad'), /JSON/);
  assert.throws(() => decodeFrame('{"topic":"x"}'), /缺少/);
});
test('broadcastFrame 與 extractSignal 互逆', () => {
  const sig = { v: 1, callId: 'call_abcdef12', from: 'alice', to: 'bob', type: 'hangup', payload: {} };
  const f = decodeFrame(broadcastFrame('realtime:pma-inbox-bob', sig, 3));
  assert.deepEqual(extractSignal(f), sig);
});
test('extractSignal：其他事件或沒有 signal 內容回傳 null', () => {
  assert.equal(extractSignal({ event: 'phx_reply', payload: {} }), null);
  assert.equal(extractSignal({ event: 'broadcast', payload: { event: 'other', payload: {} } }), null);
  assert.equal(extractSignal({ event: 'broadcast', payload: null }), null);
});
test('joinFrame：關閉自己收自己的廣播', () => {
  const f = decodeFrame(joinFrame('realtime:pma-inbox-bob', 1));
  assert.equal(f.event, 'phx_join');
  assert.equal(f.payload.config.broadcast.self, false);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (realtime-frame)`);
  if (failed) process.exitCode = 1;
})();
