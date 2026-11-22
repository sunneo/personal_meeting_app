import assert from 'node:assert/strict';
import { accountPath, planSquash, lockActive, headStillValid, LOCK_TTL_SEC } from '../cloudflare/archive-worker/squash.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const c = (sha) => ({ sha });

test('帳號路徑：accounts/<代號>/YYYY-MM/...', () => {
  assert.equal(accountPath('alice', '2026-11', 'conversation.jsonl'), 'accounts/alice/2026-11/conversation.jsonl');
  assert.throws(() => accountPath('../x', '2026-11', 'a'), /代號/);
  assert.throws(() => accountPath('alice', '2026-13', 'a'), /月份/);
});
test('壓縮：沒有 commit 或只有 base 時跳過', () => {
  assert.equal(planSquash([]).skip, true);
  assert.equal(planSquash([c('base')]).skip, true);
});
test('壓縮：只有 base + 一個 commit 也跳過（不到兩個）', () => {
  const r = planSquash([c('base'), c('a')]);
  assert.equal(r.skip, true);
  assert.equal(r.count, 1);
});
test('壓縮：base 之後有兩個以上 → 壓縮，base 不動，head 是最新的', () => {
  const r = planSquash([c('base'), c('a'), c('b'), c('c')]);
  assert.equal(r.skip, false);
  assert.equal(r.baseSha, 'base');
  assert.equal(r.headSha, 'c');
  assert.equal(r.count, 3);
});
test('壓縮：永遠不把 base（最舊的那筆）算進去', () => {
  const r = planSquash([c('root'), c('x'), c('y')]);
  assert.equal(r.baseSha, 'root');
  assert.notEqual(r.headSha, 'root');
});
test('鎖：在 TTL 內有效，過期後失效，沒有鎖也不擋', () => {
  const now = 10_000_000;
  assert.equal(lockActive({ at: now - 1000 }, now), true);
  assert.equal(lockActive({ at: now - LOCK_TTL_SEC * 1000 }, now), false);
  assert.equal(lockActive(null, now), false);
  assert.equal(lockActive({}, now), false);
});
test('確認 head 未被改動才可以壓縮', () => {
  assert.equal(headStillValid('abc', 'abc'), true);
  assert.equal(headStillValid('abc', 'def'), false);
  assert.equal(headStillValid(null, null), false);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (squash)`);
  if (failed) process.exitCode = 1;
})();
