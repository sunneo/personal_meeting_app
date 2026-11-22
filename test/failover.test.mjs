// 不依賴 node:test（Node 16 沒有）。
import assert from 'node:assert/strict';
import { classify, attemptOrder, afterAttempt, PRIMARY_RETRY_MS } from '../js/core/failover.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
process.on('exit', () => {
  let failed = 0;
  for (const t of tests) {
    try { t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (failover)`);
  if (failed) process.exitCode = 1;
});

test('classify：2xx 成功', () => {
  assert.deepEqual(classify({ ok: true, status: 200 }), { success: true, reason: 'ok' });
});
test('classify：逾時、網路錯誤、5xx 都失敗', () => {
  assert.equal(classify({ timedOut: true }).reason, 'timeout');
  assert.equal(classify({ error: 'Failed to fetch' }).reason, 'network');
  assert.equal(classify({ ok: false, status: 503 }).reason, 'server');
  assert.equal(classify({ ok: false, status: 500 }).success, false);
});
test('classify：404 視為尚未執行 pma.sql（missing）', () => {
  assert.deepEqual(classify({ ok: false, status: 404 }), { success: false, reason: 'missing' });
});
test('classify：其他 4xx 是 client 錯誤', () => {
  assert.equal(classify({ ok: false, status: 401 }).reason, 'client');
});

test('attemptOrder：預設從主要開始，依序循環', () => {
  assert.deepEqual(attemptOrder(4, { preferred: 0, lastPrimaryTryAt: 0, now: 1000 }), [0, 1, 2, 3]);
});
test('attemptOrder：記住的備援優先，之後循環，不重複', () => {
  assert.deepEqual(attemptOrder(4, { preferred: 2, lastPrimaryTryAt: 1000, now: 1500 }), [2, 3, 0, 1]);
});
test('attemptOrder：超過 10 分鐘未試主要，主要排第一', () => {
  const now = 10_000_000;
  const order = attemptOrder(4, { preferred: 2, lastPrimaryTryAt: now - PRIMARY_RETRY_MS, now });
  assert.deepEqual(order, [0, 2, 3, 1]);
});
test('attemptOrder：未滿 10 分鐘不試主要', () => {
  const now = 10_000_000;
  const order = attemptOrder(4, { preferred: 2, lastPrimaryTryAt: now - PRIMARY_RETRY_MS + 1000, now });
  assert.deepEqual(order, [2, 3, 0, 1]);
});
test('attemptOrder：preferred 是主要時不需要額外排主要', () => {
  const order = attemptOrder(4, { preferred: 0, lastPrimaryTryAt: 0, now: 99_999_999 });
  assert.deepEqual(order, [0, 1, 2, 3]);
});
test('attemptOrder：無效的 preferred 退回主要；0 個專案回空', () => {
  assert.deepEqual(attemptOrder(3, { preferred: 9, lastPrimaryTryAt: 0, now: 0 }), [0, 1, 2]);
  assert.deepEqual(attemptOrder(0, { preferred: 0, lastPrimaryTryAt: 0, now: 0 }), []);
});

test('afterAttempt：成功就記住該專案', () => {
  const s = afterAttempt({ preferred: 0, lastPrimaryTryAt: 0 }, 2, 5000, true);
  assert.deepEqual(s, { preferred: 2, lastPrimaryTryAt: 0 });
});
test('afterAttempt：失敗不改 preferred；試過主要就更新時間', () => {
  const s = afterAttempt({ preferred: 2, lastPrimaryTryAt: 0 }, 0, 7000, false);
  assert.deepEqual(s, { preferred: 2, lastPrimaryTryAt: 7000 });
});
