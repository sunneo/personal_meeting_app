// 好友、群組與分享代號的純邏輯（不依賴 DOM / 網路）。
// 與 cloudflare/archive-worker/auth.js 的 validCode 規則相同（前端不直接引用 worker 目錄）。
const validCode = (c) => typeof c === 'string' && /^[a-z0-9_-]{3,32}$/.test(c);
const normalizeCode = (c) => (typeof c === 'string' ? c.trim().toLowerCase() : '');

export const SHARE_PREFIX = 'PMA1-';
const MAX_GROUP_MEMBERS = 50;
const MAX_GROUP_NAME = 40;

/** 32-bit FNV-1a，用來當分享代號的校驗（防手滑，不是安全機制）。 */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function b64urlEncode(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * 分享代號：PMA1-<payload>-<checksum>。
 * payload 內容：{t:'friend', code} 或 {t:'group', id, name, members}。
 */
export function makeShareCode(payload) {
  const body = b64urlEncode(JSON.stringify(payload));
  return `${SHARE_PREFIX}${body}-${fnv1a(body)}`;
}

/** 解析分享代號；格式或校驗錯誤丟出 Error（中文訊息）。 */
export function parseShareCode(text) {
  const s = String(text || '').trim();
  if (!s.startsWith(SHARE_PREFIX)) throw new Error('分享代號格式不對');
  const rest = s.slice(SHARE_PREFIX.length);
  const dash = rest.lastIndexOf('-');
  if (dash < 1) throw new Error('分享代號格式不對');
  const body = rest.slice(0, dash);
  const sum = rest.slice(dash + 1);
  if (fnv1a(body) !== sum) throw new Error('分享代號校驗失敗（可能抄錯了）');
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body));
  } catch (_) {
    throw new Error('分享代號內容無法讀取');
  }
  if (payload.t === 'friend') {
    if (!validCode(payload.code)) throw new Error('分享的代號不合法');
    return { t: 'friend', code: payload.code };
  }
  if (payload.t === 'group') {
    if (typeof payload.id !== 'string' || typeof payload.name !== 'string' || !Array.isArray(payload.members)) {
      throw new Error('群組分享內容不完整');
    }
    return { t: 'group', id: payload.id, name: payload.name.slice(0, MAX_GROUP_NAME), members: payload.members.filter(validCode) };
  }
  throw new Error('分享代號種類不認識');
}

/** 加好友：代號要合法、不能加自己、不能重複。回傳新的好友清單。 */
export function addFriend(list, code, selfCode) {
  const c = normalizeCode(code);
  if (!validCode(c)) throw new Error('好友代號格式不對');
  if (c === normalizeCode(selfCode)) throw new Error('不能加自己當好友');
  if (list.some((f) => f.code === c)) throw new Error('已經是好友了');
  return [...list, { code: c, addedAt: Date.now() }];
}

export function removeFriend(list, code) {
  const c = normalizeCode(code);
  return list.filter((f) => f.code !== c);
}

/** 建立群組：名稱必填、最多 40 字；成員包含建立者。 */
export function createGroup(name, ownerCode, id = null) {
  const n = String(name || '').trim();
  if (!n) throw new Error('群組名稱不能是空的');
  if (n.length > MAX_GROUP_NAME) throw new Error(`群組名稱最多 ${MAX_GROUP_NAME} 字`);
  const owner = normalizeCode(ownerCode);
  if (!validCode(owner)) throw new Error('請先登入再建立群組');
  return { id: id || `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: n, owner, members: [owner], createdAt: Date.now() };
}

/** 加入群組成員（只有群主能加；上限 50 人）。 */
export function addGroupMember(group, code, byCode) {
  if (normalizeCode(byCode) !== group.owner) throw new Error('只有群主可以加人');
  const c = normalizeCode(code);
  if (!validCode(c)) throw new Error('成員代號格式不對');
  if (group.members.includes(c)) return group;
  if (group.members.length >= MAX_GROUP_MEMBERS) throw new Error(`群組最多 ${MAX_GROUP_MEMBERS} 人`);
  return { ...group, members: [...group.members, c] };
}
