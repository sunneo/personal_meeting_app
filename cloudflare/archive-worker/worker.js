// 長期儲存路徑 B：Cloudflare Worker → GitHub 私有 repo 的分支。認證見 docs/DESIGN.auth.md。
// 目錄版面（每月一個資料夾）：
//   YYYY-MM/conversation.jsonl   本月所有訊息，一行一則
//   YYYY-MM/manifest.json        本月附件清單
//   YYYY-MM/<category>/<name>    附件；超過 20MB 的檔案由前端切成 <name>.partNNN
//
// Secrets（只存在 Cloudflare）：GH_TOKEN、SESSION_SECRET（≥32 字元）、INVITE_CODE（註冊用）
// Variables：ARCHIVE_REPO、ARCHIVE_BRANCH
// KV binding：KV（帳號紀錄 acct:<代號>）
import {
  normalizeCode, validCode, validPassword, hashPassword, verifyPassword, signToken, verifyToken,
  loginGate, afterFailure, afterSuccess, constantTimeEqual, TOKEN_TTL_SEC,
} from './auth.js';

const MAX_PART_BYTES = 20 * 1024 * 1024;
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // 月份以 UTC+8 切分（見 docs/DESIGN.md）
const CATEGORIES = new Set(['audio', 'music', 'video', 'pdf', 'docs', 'voice', 'other']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function monthOf(ts) {
  const d = new Date(Number(ts) + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function validMonth(m) {
  return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

export function validName(n) {
  return typeof n === 'string' && n.length > 0 && n.length <= 200 && !/[\/\\\0]/.test(n) && n !== '.' && n !== '..';
}

/** 單一 part 路徑：只有一份不加後綴，否則 .partNNN。 */
export function partPath(month, category, name, index, total) {
  const base = `${month}/${category}/${name}`;
  return total > 1 ? `${base}.part${String(index).padStart(3, '0')}` : base;
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

// ---- GitHub Contents API
function ghUrl(env, path) {
  return `https://api.github.com/repos/${env.ARCHIVE_REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'personal-meeting-archive-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghGet(env, path) {
  const res = await fetch(`${ghUrl(env, path)}?ref=${encodeURIComponent(env.ARCHIVE_BRANCH)}`, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} 失敗：${res.status}`);
  const j = await res.json();
  return { b64: j.content.replace(/\n/g, ''), sha: j.sha };
}

async function ghPut(env, path, contentB64, sha, message) {
  const body = { message, content: contentB64, branch: env.ARCHIVE_BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(ghUrl(env, path), {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path} 失敗：${res.status}`);
  return res.json();
}

/** 讀-改-寫，遇到衝突（409）重試幾次。 */
async function updateFile(env, path, mutate, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await ghGet(env, path);
    const next = mutate(cur ? b64ToUtf8(cur.b64) : null);
    try {
      await ghPut(env, path, utf8ToB64(next), cur ? cur.sha : undefined, message);
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

// ---- 帳號（KV）
async function getAcct(env, code) {
  return env.KV.get(`acct:${code}`, 'json');
}

async function putAcct(env, code, rec) {
  await env.KV.put(`acct:${code}`, JSON.stringify(rec));
}

async function handleRegister(env, req) {
  if (!env.INVITE_CODE) return json({ error: '尚未設定 INVITE_CODE，註冊已關閉' }, 403);
  const b = await req.json();
  const code = normalizeCode(b.code);
  if (!constantTimeEqual(new TextEncoder().encode(String(b.invite || '')), new TextEncoder().encode(env.INVITE_CODE))) {
    return json({ error: '邀請碼不對' }, 403);
  }
  if (!validCode(code)) return json({ error: '代號格式不對（3–32 字元：小寫英數、底線、連字號）' }, 400);
  if (!validPassword(b.password)) return json({ error: '密碼至少 8 字元' }, 400);
  if (await getAcct(env, code)) return json({ error: '這個代號已被使用' }, 409);
  const pw = await hashPassword(b.password);
  await putAcct(env, code, { pw, fails: 0, lockedUntil: 0, created: Date.now() });
  return json({ ok: true, code });
}

async function handleLogin(env, req) {
  if (!env.SESSION_SECRET) return json({ error: '尚未設定 SESSION_SECRET' }, 500);
  const b = await req.json();
  const code = normalizeCode(b.code);
  const now = Date.now();
  const rec = validCode(code) ? await getAcct(env, code) : null;
  if (!rec) return json({ error: '代號或密碼不對' }, 401);
  const gate = loginGate(rec, now);
  if (!gate.allowed) return json({ error: '嘗試次數過多，請稍後再試', retryAfterSec: Math.ceil(gate.retryAfter / 1000) }, 429);
  const ok = await verifyPassword(String(b.password || ''), rec.pw);
  if (!ok) {
    await putAcct(env, code, afterFailure(rec, now));
    return json({ error: '代號或密碼不對' }, 401);
  }
  await putAcct(env, code, afterSuccess(rec));
  const { token, exp } = await signToken(code, env.SESSION_SECRET, Math.floor(now / 1000), undefined, TOKEN_TTL_SEC);
  return json({ token, exp, code });
}

/** 驗證 Authorization: Bearer <token>，回傳代號或 null。 */
async function authedCode(env, req) {
  const h = req.headers.get('Authorization') || '';
  const m = /^Bearer (.+)$/.exec(h);
  if (!m || !env.SESSION_SECRET) return null;
  const v = await verifyToken(m[1], env.SESSION_SECRET, Math.floor(Date.now() / 1000));
  return v ? v.sub : null;
}

// ---- 歸檔端點（需要 token）
async function handleAppend(env, req, code) {
  const msg = await req.json();
  if (!msg || typeof msg.id !== 'string' || typeof msg.ts !== 'number') return json({ error: '訊息格式不對' }, 400);
  msg.from = code; // 發送者以登入的帳號為準，避免冒充
  const month = monthOf(msg.ts);
  const line = JSON.stringify(msg) + '\n';
  await updateFile(env, `${month}/conversation.jsonl`, (old) => (old ? old : '') + line, `archive: ${month} message ${msg.id}`);
  return json({ ok: true, month });
}

async function handleAttachment(env, req) {
  const b = await req.json();
  if (!validMonth(b.month) || !CATEGORIES.has(b.category) || !validName(b.name)) {
    return json({ error: '月份、分類或檔名不對' }, 400);
  }
  if (!Number.isInteger(b.index) || !Number.isInteger(b.total) || b.index < 1 || b.total < 1 || b.index > b.total) {
    return json({ error: 'part 編號不對' }, 400);
  }
  const bin = atob(b.data || '');
  if (bin.length > MAX_PART_BYTES) return json({ error: '單一 part 超過 20MB' }, 413);

  const path = partPath(b.month, b.category, b.name, b.index, b.total);
  const cur = await ghGet(env, path);
  await ghPut(env, path, b.data, cur ? cur.sha : undefined, `archive: ${b.month} ${b.category} ${b.name} part ${b.index}/${b.total}`);

  if (b.index === b.total && b.sha256) {
    await updateFile(
      env,
      `${b.month}/manifest.json`,
      (old) => {
        const m = old ? JSON.parse(old) : { month: b.month, attachments: [] };
        m.attachments = m.attachments.filter((a) => !(a.category === b.category && a.name === b.name));
        m.attachments.push({ name: b.name, category: b.category, sha256: b.sha256, size: b.size || null, total: b.total });
        return JSON.stringify(m, null, 2);
      },
      `archive: ${b.month} manifest (${b.name})`
    );
  }
  return json({ ok: true, path });
}

async function handleManifest(env, url) {
  const month = url.searchParams.get('month');
  if (!validMonth(month)) return json({ error: '月份格式應為 YYYY-MM' }, 400);
  const cur = await ghGet(env, `${month}/manifest.json`);
  return json(cur ? JSON.parse(b64ToUtf8(cur.b64)) : { month, attachments: [] });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'archive-worker' });
    if (!env.GH_TOKEN || !env.ARCHIVE_REPO || !env.ARCHIVE_BRANCH || !env.KV) {
      return json({ error: 'Worker 尚未設定 GH_TOKEN / ARCHIVE_REPO / ARCHIVE_BRANCH / KV' }, 500);
    }
    try {
      if (req.method === 'POST' && url.pathname === '/register') return await handleRegister(env, req);
      if (req.method === 'POST' && url.pathname === '/login') return await handleLogin(env, req);

      const code = await authedCode(env, req);
      if (!code) return json({ error: '未登入或登入已過期' }, 401);
      if (req.method === 'POST' && url.pathname === '/append') return await handleAppend(env, req, code);
      if (req.method === 'POST' && url.pathname === '/attachment') return await handleAttachment(env, req);
      if (req.method === 'GET' && url.pathname === '/manifest') return await handleManifest(env, url);
      return json({ error: '找不到端點' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 502);
    }
  },
};
