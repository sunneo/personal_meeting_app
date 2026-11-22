// 長期儲存路徑 B：Cloudflare Worker → GitHub 私有 repo 的分支。
// 目錄版面（每月一個資料夾）：
//   YYYY-MM/conversation.jsonl   本月所有訊息，一行一則
//   YYYY-MM/manifest.json        本月附件清單（名稱、大小、sha256、分類、part 列表）
//   YYYY-MM/<category>/<name>    附件；超過 20MB 的檔案由前端切成 <name>.partNNN
//
// 需要的 secrets（只存在 Cloudflare，不進 repo）：
//   GH_TOKEN     fine-grained token，只授權私有 repo 的 Contents 讀寫
//   ARCHIVE_KEY  前端呼叫時要帶的共享密鑰（X-Archive-Key 標頭），擋陌生人寫入
// 變數（wrangler.toml）：ARCHIVE_REPO、ARCHIVE_BRANCH

const MAX_PART_BYTES = 20 * 1024 * 1024;
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // 月份以 UTC+8 切分（見 docs/DESIGN.md）
const CATEGORIES = new Set(['audio', 'music', 'pdf', 'docs', 'voice', 'other']);

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

/** 把一批附件的 part 名稱組出來：不超過 20MB 只有一份，否則 .part001… */
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
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
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

/** 讀取檔案：回傳 { text|bytes, sha } 或 null（不存在）。 */
async function ghGet(env, path) {
  const res = await fetch(`${ghUrl(env, path)}?ref=${encodeURIComponent(env.ARCHIVE_BRANCH)}`, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} 失敗：${res.status}`);
  const j = await res.json();
  return { b64: j.content.replace(/\n/g, ''), sha: j.sha };
}

/** 寫入檔案（新增或覆寫）。sha 為既有檔案的 sha，新檔案傳 undefined。 */
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

/** 讀-改-寫，遇到 409（sha 衝突）重試幾次。 */
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

async function readManifest(env, month) {
  const cur = await ghGet(env, `${month}/manifest.json`);
  return cur ? JSON.parse(b64ToUtf8(cur.b64)) : { month, attachments: [] };
}

// ---- 端點
async function handleAppend(env, req) {
  const msg = await req.json();
  if (!msg || typeof msg.id !== 'string' || typeof msg.ts !== 'number') return json({ error: '訊息格式不對' }, 400);
  const month = monthOf(msg.ts);
  const line = JSON.stringify(msg) + '\n';
  await updateFile(
    env,
    `${month}/conversation.jsonl`,
    (old) => (old ? old : '') + line,
    `archive: ${month} message ${msg.id}`
  );
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

  // 最後一份寫入時，更新 manifest（之前的 part 已經寫進去）
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
  return json(await readManifest(env, month));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Archive-Key',
        },
      });
    }
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'archive-worker' });
    if (!env.GH_TOKEN || !env.ARCHIVE_KEY || !env.ARCHIVE_REPO || !env.ARCHIVE_BRANCH) {
      return json({ error: 'Worker 尚未設定 secrets / 變數' }, 500);
    }
    if (req.headers.get('X-Archive-Key') !== env.ARCHIVE_KEY) return json({ error: '未授權' }, 401);
    try {
      if (req.method === 'POST' && url.pathname === '/append') return await handleAppend(env, req);
      if (req.method === 'POST' && url.pathname === '/attachment') return await handleAttachment(env, req);
      if (req.method === 'GET' && url.pathname === '/manifest') return await handleManifest(env, url);
      return json({ error: '找不到端點' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 502);
    }
  },
};
