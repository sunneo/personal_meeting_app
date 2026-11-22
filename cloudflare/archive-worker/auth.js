// 認證的純邏輯（給 worker 與測試共用）。不直接讀 secrets；密鑰由呼叫端傳入。
// 設計見 docs/DESIGN.auth.md。crypto 參數預設為 globalThis.crypto（Workers 與 Node 19+）。

export const PBKDF2_ITER = 100000;
export const TOKEN_TTL_SEC = 2 * 60 * 60;
export const MAX_LOGIN_FAILS = 8;
export const LOCK_SEC = 15 * 60;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64Url(bytes) {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

/** 常數時間比較兩個位元組陣列。 */
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 帳號代號：3–32 字元，小寫英數、底線、連字號。 */
export function validCode(code) {
  return typeof code === 'string' && /^[a-z0-9_-]{3,32}$/.test(code);
}

/** 密碼：至少 8 字元，最多 200。 */
export function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
}

/** 代號統一小寫、去前後空白。 */
export function normalizeCode(code) {
  return typeof code === 'string' ? code.trim().toLowerCase() : '';
}

async function pbkdf2(password, salt, iter, cr) {
  const key = await cr.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await cr.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

/** 產生密碼雜湊紀錄：{v, iter, salt, hash}（皆為 base64）。 */
export async function hashPassword(password, cr = globalThis.crypto, iter = PBKDF2_ITER) {
  const salt = new Uint8Array(16);
  cr.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, iter, cr);
  return { v: 1, iter, salt: toB64(salt), hash: toB64(hash) };
}

/** 驗證密碼是否符合紀錄。 */
export async function verifyPassword(password, record, cr = globalThis.crypto) {
  if (!record || record.v !== 1) return false;
  const hash = await pbkdf2(password, fromB64(record.salt), record.iter, cr);
  return constantTimeEqual(hash, fromB64(record.hash));
}

async function hmacKey(secret, cr) {
  return cr.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** 簽發 token：payloadB64url.sigB64url；payload = {sub, iat, exp}。 */
export async function signToken(sub, secret, now, cr = globalThis.crypto, ttl = TOKEN_TTL_SEC) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET 太短（至少 32 字元）');
  const payload = { sub, iat: now, exp: now + ttl };
  const body = toB64Url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret, cr);
  const sig = new Uint8Array(await cr.subtle.sign('HMAC', key, enc.encode(body)));
  return { token: `${body}.${toB64Url(sig)}`, exp: payload.exp };
}

/** 驗證 token：回傳 {sub, exp}，失敗回傳 null（簽章錯、過期、格式錯）。 */
export async function verifyToken(token, secret, now, cr = globalThis.crypto) {
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sigPart] = parts;
  let sig;
  try {
    sig = fromB64Url(sigPart);
  } catch (_) {
    return null;
  }
  const key = await hmacKey(secret, cr);
  const expected = new Uint8Array(await cr.subtle.sign('HMAC', key, enc.encode(body)));
  if (!constantTimeEqual(expected, sig)) return null;
  let payload;
  try {
    payload = JSON.parse(dec.decode(fromB64Url(body)));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= now) return null;
  return { sub: payload.sub, exp: payload.exp };
}

/** 防暴力：依失敗次數與鎖定時間，判斷現在能不能嘗試登入。 */
export function loginGate(record, now) {
  if (record && record.lockedUntil && record.lockedUntil > now) {
    return { allowed: false, retryAfter: record.lockedUntil - now };
  }
  return { allowed: true, retryAfter: 0 };
}

/** 登入失敗後更新失敗紀錄（達到上限就鎖定，並把計數歸零）。 */
export function afterFailure(record, now) {
  const fails = ((record && record.fails) || 0) + 1;
  if (fails >= MAX_LOGIN_FAILS) return { ...record, fails: 0, lockedUntil: now + LOCK_SEC * 1000 };
  return { ...record, fails, lockedUntil: (record && record.lockedUntil) || 0 };
}

/** 登入成功後清除失敗紀錄。 */
export function afterSuccess(record) {
  return { ...record, fails: 0, lockedUntil: 0 };
}
