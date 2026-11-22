// 長期儲存路徑 B：Cloudflare Worker → GitHub 私有 repo 的分支。認證見 docs/DESIGN.auth.md。
// 目錄版面（每月一個資料夾）：
//   YYYY-MM/conversation.jsonl   本月所有訊息，一行一則
//   YYYY-MM/manifest.json        本月附件清單
//   YYYY-MM/<category>/<name>    附件；超過 20MB 的檔案由前端切成 <name>.partNNN
//
// Secrets（只存在 Cloudflare）：GH_TOKEN、SESSION_SECRET（≥32 字元）；選填：INVITE_CODE（REGISTRATION_MODE=invite 時）、TURNSTILE_SECRET（人機驗證）
// 變數：REGISTRATION_MODE（open 預設 / invite / closed）；防濫用見 abuse.js 與 docs/DESIGN.auth.md 第 7 節
// Variables：ARCHIVE_REPO、ARCHIVE_BRANCH
// KV binding：KV（帳號紀錄 acct:<代號>）
import {
  normalizeCode, validCode, validPassword, hashPassword, verifyPassword, signToken, verifyToken,
  loginGate, afterFailure, afterSuccess, constantTimeEqual, TOKEN_TTL_SEC,
} from './auth.js';
import { buildIceServers, fetchTurnCredentials, mailboxPush, mailboxDrain } from './rtc.js';
import { accountPath, planSquash, lockActive, headStillValid, LOCK_TTL_SEC } from './squash.js';
import {
  normalizeRegistrationMode, registrationDecision, isReservedCode, normalizeIp, regRateKeys,
  checkRegistrationRate, quotaKeys, checkDailyAppend, checkAttachmentQuota, verifyTurnstile,
} from './abuse.js';

/** 附件 part 路徑：只有一份不加後綴，否則 .partNNN（base 已含帳號與分類）。 */
export function partPathFromBase(base, index, total) {
  return total > 1 ? `${base}.part${String(index).padStart(3, '0')}` : base;
}

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
  const b = await req.json();
  const enc = new TextEncoder();
  // 1) 註冊模式（open 預設；invite 需要 INVITE_CODE；closed 拒絕）
  const mode = normalizeRegistrationMode(env.REGISTRATION_MODE);
  const inviteStr = typeof b.invite === 'string' ? b.invite.trim() : '';
  const inviteOk = Boolean(env.INVITE_CODE) && constantTimeEqual(enc.encode(inviteStr), enc.encode(String(env.INVITE_CODE)));
  const dec = registrationDecision(mode, { inviteConfigured: Boolean(env.INVITE_CODE), inviteOk });
  if (!dec.allowed) return json({ error: dec.error }, dec.status);
  // 2) 人機驗證（只有設定 TURNSTILE_SECRET 才要求）
  const ip = normalizeIp(req.headers.get('CF-Connecting-IP'));
  const ts = await verifyTurnstile(b.turnstile, ip, env.TURNSTILE_SECRET);
  if (!ts.ok) return json({ error: ts.error }, 403);
  // 3) 每個 IP 的註冊頻率（每小時 5、每天 10；失敗的嘗試也計入，防止暴力試代號）
  const rk = regRateKeys(ip, Date.now());
  const hourCount = Number(await env.KV.get(rk.hour)) || 0;
  const dayCount = Number(await env.KV.get(rk.day)) || 0;
  const rate = checkRegistrationRate({ hour: hourCount, day: dayCount });
  if (!rate.ok) return json({ error: rate.error }, rate.status);
  await env.KV.put(rk.hour, String(hourCount + 1), { expirationTtl: 7200 });
  await env.KV.put(rk.day, String(dayCount + 1), { expirationTtl: 2 * 86400 });
  // 4) 代號與密碼
  const code = normalizeCode(b.code);
  if (!validCode(code)) return json({ error: '代號格式不對（3–32 字元：小寫英數、底線、連字號）' }, 400);
  if (isReservedCode(code)) return json({ error: '這個代號不能使用' }, 400);
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

// ---- 歸檔端點（需要 token）。所有路徑都在 accounts/<代號>/ 底下，代號來自 token，不來自請求。
async function squashing(env) {
  const lock = await env.KV.get('squash-lock', 'json');
  return lockActive(lock, Date.now());
}

const BUSY = () => json({ error: '歸檔正在整理中，請稍後重試' }, 503);

async function handleAppend(env, req, code) {
  if (await squashing(env)) return BUSY();
  const msg = await req.json();
  if (!msg || typeof msg.id !== 'string' || typeof msg.ts !== 'number') return json({ error: '訊息格式不對' }, 400);
  msg.from = code; // 發送者以登入的帳號為準，避免冒充
  const month = monthOf(msg.ts);
  const line = JSON.stringify(msg) + '\n';
  const path = accountPath(code, month, 'conversation.jsonl');
  const now = Date.now();
  const qk = quotaKeys(code, now);
  const dayUse = (await env.KV.get(qk.day, 'json')) || { count: 0 };
  const qa = checkDailyAppend(dayUse);
  if (!qa.ok) return json({ error: qa.error }, qa.status);
  await env.KV.put(qk.day, JSON.stringify({ count: dayUse.count + 1, parts: dayUse.parts || 0 }), { expirationTtl: 2 * 86400 });
  await updateFile(env, path, (old) => (old ? old : '') + line, `archive: ${code} ${month} message ${msg.id}`);
  return json({ ok: true, month });
}

async function handleAttachment(env, req, code) {
  if (await squashing(env)) return BUSY();
  const b = await req.json();
  if (!validMonth(b.month) || !CATEGORIES.has(b.category) || !validName(b.name)) {
    return json({ error: '月份、分類或檔名不對' }, 400);
  }
  if (!Number.isInteger(b.index) || !Number.isInteger(b.total) || b.index < 1 || b.total < 1 || b.index > b.total) {
    return json({ error: 'part 編號不對' }, 400);
  }
  const bin = atob(b.data || '');
  if (bin.length > MAX_PART_BYTES) return json({ error: '單一 part 超過 20MB' }, 413);

  const now = Date.now();
  const qk = quotaKeys(code, now);
  const dayUse = (await env.KV.get(qk.day, 'json')) || { count: 0, parts: 0 };
  const monUse = (await env.KV.get(qk.month, 'json')) || { bytes: 0 };
  const declared = Number(b.size) > 0 ? Number(b.size) : bin.length;
  const qa = checkAttachmentQuota({ bytes: monUse.bytes, parts: dayUse.parts || 0 }, declared, bin.length);
  if (!qa.ok) return json({ error: qa.error }, qa.status);
  await env.KV.put(qk.day, JSON.stringify({ count: dayUse.count || 0, parts: (dayUse.parts || 0) + 1 }), { expirationTtl: 2 * 86400 });
  await env.KV.put(qk.month, JSON.stringify({ bytes: monUse.bytes + bin.length }), { expirationTtl: 40 * 86400 });

  const base = accountPath(code, b.month, `${b.category}/${b.name}`);
  const path = partPathFromBase(base, b.index, b.total);
  const cur = await ghGet(env, path);
  await ghPut(env, path, b.data, cur ? cur.sha : undefined, `archive: ${code} ${b.month} ${b.category} ${b.name} part ${b.index}/${b.total}`);

  if (b.index === b.total && b.sha256) {
    await updateFile(
      env,
      accountPath(code, b.month, 'manifest.json'),
      (old) => {
        const m = old ? JSON.parse(old) : { account: code, month: b.month, attachments: [] };
        m.attachments = m.attachments.filter((a) => !(a.category === b.category && a.name === b.name));
        m.attachments.push({ name: b.name, category: b.category, sha256: b.sha256, size: b.size || null, total: b.total });
        return JSON.stringify(m, null, 2);
      },
      `archive: ${code} ${b.month} manifest (${b.name})`
    );
  }
  return json({ ok: true, path });
}

async function handleManifest(env, url, code) {
  const month = url.searchParams.get('month');
  if (!validMonth(month)) return json({ error: '月份格式應為 YYYY-MM' }, 400);
  const cur = await ghGet(env, accountPath(code, month, 'manifest.json'));
  return json(cur ? JSON.parse(b64ToUtf8(cur.b64)) : { account: code, month, attachments: [] });
}

// ---- 每日壓縮（squash）：用 Git Data API 把 base 之後的所有 commit 壓成一個。
// 規則：base（最舊的 commit）永遠不動；壓縮期間 KV 的 squash-lock 會讓上傳回 503 重試；
// 更新 ref 前再確認 head 沒變；ref 用 force 更新（改寫歷史，GitHub 要等自己的 GC 才會真正縮小）。
async function ghApi(env, method, p, body) {
  const res = await fetch(`https://api.github.com/repos/${env.ARCHIVE_REPO}${p}`, {
    method,
    headers: { ...ghHeaders(env), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${p} 失敗：${res.status}`);
  return res.json();
}

async function listAllCommits(env) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await ghApi(env, 'GET', `/commits?sha=${encodeURIComponent(env.ARCHIVE_BRANCH)}&per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.map((c) => ({ sha: c.sha, date: Date.parse(c.commit.committer.date) })).reverse(); // 舊 → 新
}

export async function squashArchive(env) {
  const now = Date.now();
  if (lockActive(await env.KV.get('squash-lock', 'json'), now)) return { skipped: 'locked' };
  await env.KV.put('squash-lock', JSON.stringify({ at: now }), { expirationTtl: LOCK_TTL_SEC });
  try {
    const ref = await ghApi(env, 'GET', `/git/ref/heads/${encodeURIComponent(env.ARCHIVE_BRANCH)}`);
    const headSha = ref.object.sha;
    const commits = await listAllCommits(env);
    const plan = planSquash(commits);
    if (plan.skip) return { skipped: plan.reason };
    const headCommit = await ghApi(env, 'GET', `/git/commits/${headSha}`);
    const squashed = await ghApi(env, 'POST', '/git/commits', {
      message: `squash: ${plan.count} commits (daily)`,
      tree: headCommit.tree.sha,
      parents: [plan.baseSha],
    });
    // 寫入前再確認 head 沒變（沒有新的上傳）
    const again = await ghApi(env, 'GET', `/git/ref/heads/${encodeURIComponent(env.ARCHIVE_BRANCH)}`);
    if (!headStillValid(headSha, again.object.sha)) return { skipped: 'head moved' };
    await ghApi(env, 'PATCH', `/git/refs/heads/${encodeURIComponent(env.ARCHIVE_BRANCH)}`, { sha: squashed.sha, force: true });
    await updateFile(env, 'squash-log.json', (old) => {
      const log = old ? JSON.parse(old) : [];
      log.push({ at: now, count: plan.count, base: plan.baseSha, previousHead: headSha, newHead: squashed.sha });
      return JSON.stringify(log.slice(-60), null, 2);
    }, 'archive: squash log');
    return { squashed: plan.count, newHead: squashed.sha };
  } finally {
    await env.KV.delete('squash-lock');
  }
}

// ---- WebRTC：ICE 設定（含 TURN 短效憑證）與 KV 信箱（信令備援）
async function handleTurnConfig(env) {
  const raw = await fetchTurnCredentials(env);
  return json(buildIceServers(raw));
}

async function handleSignal(env, req, code) {
  const msg = await req.json();
  if (!msg || msg.from !== code) return json({ error: '信令的 from 必須是登入的代號' }, 400);
  if (!validCode(msg.to) || msg.to === code) return json({ error: '收件人不合法' }, 400);
  if (typeof msg.type !== 'string' || msg.type.length > 20) return json({ error: '信令類型不對' }, 400);
  const key = `inbox:${msg.to}`;
  const list = (await env.KV.get(key, 'json')) || [];
  await env.KV.put(key, JSON.stringify(mailboxPush(list, msg, Date.now())), { expirationTtl: 120 });
  return json({ ok: true });
}

async function handlePoll(env, code) {
  const key = `inbox:${code}`;
  const list = (await env.KV.get(key, 'json')) || [];
  const out = mailboxDrain(list, Date.now());
  if (list.length) await env.KV.delete(key);
  return json({ messages: out.messages });
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
      if (req.method === 'POST' && url.pathname === '/turn-config') return await handleTurnConfig(env);
      if (req.method === 'POST' && url.pathname === '/signal') return await handleSignal(env, req, code);
      if (req.method === 'POST' && url.pathname === '/signal/poll') return await handlePoll(env, code);
      if (req.method === 'POST' && url.pathname === '/append') return await handleAppend(env, req, code);
      if (req.method === 'POST' && url.pathname === '/attachment') return await handleAttachment(env, req, code);
      if (req.method === 'GET' && url.pathname === '/manifest') return await handleManifest(env, url, code);
      return json({ error: '找不到端點' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 502);
    }
  },
  // Cron：每天一次（建議 0 19 * * *，即 UTC+8 凌晨 03:00 的安靜時段）做每日壓縮。
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(squashArchive(env).catch(() => {}));
  },
};
