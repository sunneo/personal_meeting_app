import assert from 'node:assert/strict';
import { parseSignal, makeSignal, nextCallState, recordingNotice } from '../js/core/call-state.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const base = { v: 1, callId: 'call_abcdef12', from: 'alice', to: 'bob' };
const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';

test('offer/answer 需要 SDP 且以 v=0 開頭', () => {
  assert.equal(parseSignal({ ...base, type: 'offer', payload: { sdp: SDP } }).type, 'offer');
  assert.throws(() => parseSignal({ ...base, type: 'answer', payload: { sdp: 'hello' } }), /SDP 格式/);
  assert.throws(() => parseSignal({ ...base, type: 'offer', payload: {} }), /SDP/);
  assert.throws(() => parseSignal({ ...base, type: 'offer', payload: { sdp: 'v=0' + 'x'.repeat(70000) } }), /SDP/);
});
test('ice 候選長度限制', () => {
  assert.equal(parseSignal({ ...base, type: 'ice', payload: { candidate: 'candidate:1 1 udp' } }).type, 'ice');
  assert.throws(() => parseSignal({ ...base, type: 'ice', payload: { candidate: 'x'.repeat(5000) } }), /ICE/);
});
test('record-state 必須是布林', () => {
  assert.equal(parseSignal({ ...base, type: 'record-state', payload: { recording: true } }).payload.recording, true);
  assert.throws(() => parseSignal({ ...base, type: 'record-state', payload: { recording: 'yes' } }), /錄製狀態/);
});
test('hangup 不需要 payload', () => {
  assert.equal(parseSignal({ ...base, type: 'hangup' }).type, 'hangup');
});
test('版本、代號、callId、自己打自己都會被拒絕', () => {
  assert.throws(() => parseSignal({ ...base, v: 2, type: 'hangup' }), /版本/);
  assert.throws(() => parseSignal({ ...base, from: 'Bad Name', type: 'hangup' }), /代號/);
  assert.throws(() => parseSignal({ ...base, callId: 'x', type: 'hangup' }), /callId/);
  assert.throws(() => parseSignal({ ...base, to: 'alice', type: 'hangup' }), /自己/);
  assert.throws(() => parseSignal({ ...base, type: 'bye' }), /類型/);
  assert.throws(() => parseSignal(null), /物件/);
});
test('makeSignal 產生的訊息可以再被解析', () => {
  const m = makeSignal('call_abcdef12', 'alice', 'bob', 'offer', { sdp: SDP });
  assert.deepEqual(parseSignal(m), m);
});
test('狀態機：我打出 → 對方接聽 → 連線 → 掛斷', () => {
  let s = 'idle';
  s = nextCallState(s, 'start-call'); assert.equal(s, 'calling');
  s = nextCallState(s, 'connected'); assert.equal(s, 'connected');
  s = nextCallState(s, 'hangup'); assert.equal(s, 'ended');
  s = nextCallState(s, 'start-call'); assert.equal(s, 'calling', '結束後可以再打');
});
test('狀態機：來電 → 接聽 → 連線', () => {
  let s = nextCallState('idle', 'incoming');
  assert.equal(s, 'ringing');
  s = nextCallState(s, 'accept'); assert.equal(s, 'connected');
});
test('狀態機：不合法的事件忽略（重複 start、接聽沒有來電）', () => {
  assert.equal(nextCallState('connected', 'start-call'), 'connected');
  assert.equal(nextCallState('idle', 'accept'), 'idle');
  assert.equal(nextCallState('idle', 'hangup'), 'idle');
  assert.equal(nextCallState('ringing', 'reset'), 'idle');
});
test('錄製通知是 record-state 信令', () => {
  const m = recordingNotice('call_abcdef12', 'alice', 'bob', true);
  assert.equal(m.type, 'record-state');
  assert.equal(m.payload.recording, true);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (call-state)`);
  if (failed) process.exitCode = 1;
})();
