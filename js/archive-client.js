// 長期路徑 B 的前端：登入（token 只放記憶體）、寫入訊息與附件（超過 20MB 切片）。
// 端點與認證見 cloudflare/archive-worker/worker.js 與 docs/DESIGN.auth.md。
import { ARCHIVE_WORKER_URL } from './config.js';
import { splitRanges, monthOf, MAX_PART_BYTES } from './core/archive-format.js';

const TIMEOUT_MS = 30000;
let token = null;        // 只在記憶體；重新整理後要重新登入
let tokenExp = 0;        // 秒

export function archiveConfigured() {
  return Boolean(ARCHIVE_WORKER_URL);
}

export function isLoggedIn(nowSec = Math.floor(Date.now() / 1000)) {
  return Boolean(token) && tokenExp > nowSec + 30;
}

/** 目前的登入 token（沒登入或已過期回傳 null）。給通話信令與 TURN 使用。 */
export function getToken() {
  return isLoggedIn() ? token : null;
}

export function logout() {
  token = null;
  tokenExp = 0;
}

async function call(method, path, body, withAuth = true) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (withAuth) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(ARCHIVE_WORKER_URL + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* 非 JSON 回應 */ }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** 註冊：代號 + 密碼（開放註冊，不需邀請碼）；turnstile 為人機驗證 token（沒設定 sitekey 時可為空）。 */
export async function register(code, password, turnstile = '') {
  return call('POST', '/register', { code, password, turnstile }, false);
}

/** 登入：成功後把 token 存在記憶體。 */
export async function login(code, password) {
  const r = await call('POST', '/login', { code, password }, false);
  if (r.ok && r.data && r.data.token) {
    token = r.data.token;
    tokenExp = r.data.exp;
  }
  return r;
}

/** 把 Uint8Array 轉 base64（分段處理，避免大檔案字串拼接過慢）。 */
export function bytesToB64(bytes) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

export async function sha256Hex(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 寫入一則訊息到歸檔（JSONL）。 */
export async function archiveAppend(msg) {
  if (!isLoggedIn()) return { ok: false, status: 401, data: null };
  return call('POST', '/append', {
    id: msg.id,
    ts: msg.ts,
    from: msg.from || '',
    kind: msg.kind || 'text',
    body: msg.body,
    subtitle: msg.subtitle ?? null,
    attachments: (msg.attachments || []).map((a) => ({ name: a.name, category: a.category, size: a.blob ? a.blob.size : 0 })),
  });
}

/**
 * 上傳附件：超過 20MB 切成多份依序上傳，最後一份帶上 sha256 讓 worker 更新 manifest。
 * 任何一份失敗就回傳失敗（呼叫端保留待補傳狀態，之後從頭重傳）。
 */
export async function archiveAttachment(att, ts = Date.now()) {
  if (!isLoggedIn()) return { ok: false, status: 401, data: null };
  const month = monthOf(ts);
  const ranges = splitRanges(att.blob.size, MAX_PART_BYTES);
  const sha256 = await sha256Hex(att.blob);
  for (const r of ranges) {
    const bytes = new Uint8Array(await att.blob.slice(r.start, r.end).arrayBuffer());
    const res = await call('POST', '/attachment', {
      month,
      category: att.category,
      name: att.name,
      index: r.index,
      total: ranges.length,
      data: bytesToB64(bytes),
      sha256,
      size: att.blob.size,
    });
    if (!res.ok) return res;
  }
  return { ok: true, status: 200, data: { parts: ranges.length, sha256 } };
}
