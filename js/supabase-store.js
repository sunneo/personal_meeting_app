// 長期儲存路徑 A：Supabase（透過 PostgREST 的 RPC 函式，見 supabase/pma.sql）。
// 多專案備援：依 js/core/failover.js 的順序嘗試；成功的專案會記在 localStorage，
// 之後優先用它，超過 10 分鐘會回頭試主要。全部失敗時回傳 false，呼叫端應把訊息標示為待補傳。
import { SUPABASE_PROJECTS } from './config.js';
import { classify, attemptOrder, afterAttempt, REQUEST_TIMEOUT_MS } from './core/failover.js';

const STATE_KEY = 'pma.supabase.state';

/** 404 等提示：UI 可訂閱 window 上的 'pma:supabase-hint' 事件顯示。 */
function hint(message) {
  console.warn('[Supabase]', message);
  try {
    window.dispatchEvent(new CustomEvent('pma:supabase-hint', { detail: { message } }));
  } catch (_) { /* 非瀏覽器環境略過 */ }
}

export function supabaseConfigured() {
  return SUPABASE_PROJECTS.length > 0 && SUPABASE_PROJECTS.every((p) => p.url && p.key);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* 無法讀取就用預設 */ }
  return { preferred: 0, lastPrimaryTryAt: 0 };
}

function saveState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (_) { /* 忽略（隱私模式等） */ }
}

/** 對單一專案呼叫 RPC；回傳 classify 的結果，附上資料。 */
async function callProject(project, name, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${project.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: project.key,
        Authorization: `Bearer ${project.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const verdict = classify({ ok: res.ok, status: res.status });
    if (!verdict.success) return { ...verdict, status: res.status, data: null };
    return { ...verdict, status: res.status, data: await res.json() };
  } catch (e) {
    const timedOut = ctl.signal.aborted;
    return { ...classify({ timedOut, error: String(e && e.message || e) }), data: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 依備援順序呼叫 RPC，直到成功或全部失敗。
 * @returns {Promise<{ok:boolean, data:any, project:string|null}>}
 */
async function withFailover(name, body) {
  if (!supabaseConfigured()) return { ok: false, data: null, project: null };
  const now = Date.now();
  const state = loadState();
  const order = attemptOrder(SUPABASE_PROJECTS.length, { ...state, now });
  let st = { preferred: state.preferred, lastPrimaryTryAt: state.lastPrimaryTryAt || 0 };

  for (const idx of order) {
    const project = SUPABASE_PROJECTS[idx];
    const r = await callProject(project, name, body);
    st = afterAttempt(st, idx, Date.now(), r.success);
    if (r.success) {
      saveState(st);
      return { ok: true, data: r.data, project: project.name };
    }
    if (r.reason === 'missing') {
      hint(`專案「${project.name}」尚未執行 supabase/pma.sql（回應 404），已改用下一個專案。`);
    } else {
      console.info(`[Supabase] 專案「${project.name}」失敗（${r.reason}），改用下一個。`);
    }
  }
  saveState(st);
  return { ok: false, data: null, project: null };
}

/** 上傳一則文字訊息（附件走路徑 B，這裡只送中繼資料）。 */
export async function putMessage(msg) {
  const attachments = (msg.attachments || []).map((a) => ({
    name: a.name,
    category: a.category,
    size: a.blob ? a.blob.size : 0,
  }));
  const r = await withFailover('pma_put_message', {
    p: {
      id: msg.id,
      conv: msg.conv || 'default',
      ts: msg.ts,
      from: msg.from || '',
      kind: msg.kind || 'text',
      body: msg.body,
      subtitle: msg.subtitle ?? null,
      attachments,
    },
  });
  return r.ok;
}

/** 讀取某對話在 since（毫秒）之後的訊息；全部失敗時回傳 null（與「沒有訊息」區分）。 */
export async function listMessages(conv = 'default', since = 0) {
  const r = await withFailover('pma_list_messages', { p_conv: conv, p_since: since });
  return r.ok ? r.data : null;
}
