// 好友與群組的瀏覽器部分：資料存在 localStorage（只存在這台裝置；跨裝置同步尚未實作）。
import { addFriend, removeFriend, createGroup, addGroupMember, makeShareCode, parseShareCode } from './core/social.js';

const KEY = 'pma.social';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const d = raw ? JSON.parse(raw) : {};
    return { friends: Array.isArray(d.friends) ? d.friends : [], groups: Array.isArray(d.groups) ? d.groups : [] };
  } catch (_) {
    return { friends: [], groups: [] };
  }
}

function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) { /* 忽略 */ }
}

/**
 * 初始化面板。getSelf() 回傳目前登入的代號（沒登入回傳 ''）。
 */
export function initSocial(getSelf) {
  const panel = document.getElementById('social-panel');
  if (!panel) return;
  const msg = panel.querySelector('#social-msg');
  const friendsEl = panel.querySelector('#friend-list');
  const groupsEl = panel.querySelector('#group-list');
  const mineEl = panel.querySelector('#my-share');
  const addInput = panel.querySelector('#friend-input');
  const groupInput = panel.querySelector('#group-name');

  const say = (t) => { msg.textContent = t; };

  function render() {
    const d = load();
    const self = getSelf();
    mineEl.textContent = self ? makeShareCode({ t: 'friend', code: self }) : '登入後才會產生你的分享代號。';

    friendsEl.replaceChildren();
    for (const f of d.friends) {
      const li = document.createElement('li');
      li.textContent = f.code + ' ';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '移除';
      b.addEventListener('click', () => { save({ ...d, friends: removeFriend(d.friends, f.code) }); render(); });
      li.append(b);
      friendsEl.append(li);
    }
    if (d.friends.length === 0) friendsEl.append(Object.assign(document.createElement('li'), { textContent: '（還沒有好友）' }));

    groupsEl.replaceChildren();
    for (const g of d.groups) {
      const li = document.createElement('li');
      li.textContent = `${g.name}（${g.members.length} 人）`;
      const share = document.createElement('button');
      share.type = 'button';
      share.textContent = '分享代號';
      share.addEventListener('click', () => {
        const code = makeShareCode({ t: 'group', id: g.id, name: g.name, members: g.members });
        say('群組分享代號（複製給對方）：' + code);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = '加人';
      add.addEventListener('click', () => {
        const who = prompt('要加入的成員代號');
        if (!who) return;
        try {
          const updated = addGroupMember(g, who, getSelf());
          save({ ...d, groups: d.groups.map((x) => (x.id === g.id ? updated : x)) });
          render();
        } catch (e) { say(e.message); }
      });
      li.append(' ', share, ' ', add);
      groupsEl.append(li);
    }
    if (d.groups.length === 0) groupsEl.append(Object.assign(document.createElement('li'), { textContent: '（還沒有群組）' }));
  }

  panel.querySelector('#btn-add-friend').addEventListener('click', () => {
    const text = addInput.value.trim();
    addInput.value = '';
    try {
      const d = load();
      let code = text;
      if (text.startsWith('PMA1-')) {
        const p = parseShareCode(text);
        if (p.t !== 'friend') throw new Error('這是群組代號，請在群組區塊加入');
        code = p.code;
      }
      save({ ...d, friends: addFriend(d.friends, code, getSelf()) });
      say('已加入好友。');
      render();
    } catch (e) { say(e.message); }
  });

  panel.querySelector('#btn-create-group').addEventListener('click', () => {
    try {
      const g = createGroup(groupInput.value, getSelf());
      groupInput.value = '';
      const d = load();
      save({ ...d, groups: [...d.groups, g] });
      say('已建立群組。');
      render();
    } catch (e) { say(e.message); }
  });

  render();
  return { refresh: render };
}
