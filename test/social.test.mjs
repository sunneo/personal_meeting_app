import assert from 'node:assert/strict';
import { makeShareCode, parseShareCode, addFriend, removeFriend, createGroup, addGroupMember, fnv1a, SHARE_PREFIX } from '../js/core/social.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('fnv1a：穩定且是 8 位十六進位', () => {
  assert.equal(fnv1a('abc'), fnv1a('abc'));
  assert.match(fnv1a('x'), /^[0-9a-f]{8}$/);
  assert.notEqual(fnv1a('abc'), fnv1a('abd'));
});
test('分享代號：好友往返', () => {
  const code = makeShareCode({ t: 'friend', code: 'alice_01' });
  assert.ok(code.startsWith(SHARE_PREFIX));
  assert.deepEqual(parseShareCode(code), { t: 'friend', code: 'alice_01' });
});
test('分享代號：群組往返（含中文名稱）', () => {
  const code = makeShareCode({ t: 'group', id: 'g1', name: '家人群', members: ['alice', 'bob'] });
  assert.deepEqual(parseShareCode(code), { t: 'group', id: 'g1', name: '家人群', members: ['alice', 'bob'] });
});
test('分享代號：抄錯一個字就校驗失敗', () => {
  const code = makeShareCode({ t: 'friend', code: 'alice' });
  const bad = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');
  assert.throws(() => parseShareCode(bad), /校驗失敗/);
});
test('分享代號：格式錯誤、種類不認識都會報錯', () => {
  assert.throws(() => parseShareCode('hello'), /格式/);
  assert.throws(() => parseShareCode(makeShareCode({ t: 'other' })), /種類/);
  assert.throws(() => parseShareCode(makeShareCode({ t: 'friend', code: 'x' })), /不合法/);
});
test('加好友：正常加入；重複、加自己、代號錯誤都拒絕', () => {
  let list = addFriend([], 'Bob_02', 'alice');
  assert.equal(list[0].code, 'bob_02');
  assert.throws(() => addFriend(list, 'bob_02', 'alice'), /已經是好友/);
  assert.throws(() => addFriend([], 'alice', 'Alice'), /不能加自己/);
  assert.throws(() => addFriend([], 'x', 'alice'), /格式/);
});
test('刪除好友', () => {
  const list = addFriend([], 'bob_02', 'alice');
  assert.deepEqual(removeFriend(list, 'BOB_02'), []);
});
test('建立群組：名稱檢查、群主自動在成員內', () => {
  const g = createGroup('  家人  ', 'alice', 'g1');
  assert.equal(g.name, '家人');
  assert.deepEqual(g.members, ['alice']);
  assert.throws(() => createGroup('   ', 'alice'), /不能是空的/);
  assert.throws(() => createGroup('a'.repeat(41), 'alice'), /最多 40/);
  assert.throws(() => createGroup('x', ''), /登入/);
});
test('群組加人：只有群主可以；重複不加；超過 50 人拒絕', () => {
  let g = createGroup('x', 'alice', 'g1');
  g = addGroupMember(g, 'bob', 'alice');
  assert.deepEqual(g.members, ['alice', 'bob']);
  assert.equal(addGroupMember(g, 'bob', 'alice').members.length, 2);
  assert.throws(() => addGroupMember(g, 'carol', 'bob'), /群主/);
  let big = createGroup('y', 'owner', 'g2');
  for (let i = 0; i < 49; i++) big = addGroupMember(big, `user${i}`, 'owner');
  assert.equal(big.members.length, 50);
  assert.throws(() => addGroupMember(big, 'extra', 'owner'), /最多 50/);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   - ' + t.name); }
    catch (e) { failed++; console.log('FAIL - ' + t.name + '\n' + (e && e.stack ? e.stack : e)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (social)`);
  if (failed) process.exitCode = 1;
})();
