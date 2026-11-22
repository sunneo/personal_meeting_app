// 長期儲存路徑 A：Supabase（透過 PostgREST 的 RPC 函式，見 supabase/pma.sql）。
// 沒有設定網址或金鑰時，所有函式都直接回傳 false / 空陣列，不影響本地功能。
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name} 失敗：HTTP ${res.status}`);
  return res.json();
}

/** 上傳一則文字訊息（附件走路徑 B，這裡只送中繼資料）。 */
export async function putMessage(msg) {
  try {
    if (!supabaseConfigured()) return false;
    const attachments = (msg.attachments || []).map((a) => ({
      name: a.name,
      category: a.category,
      size: a.blob ? a.blob.size : 0,
    }));
    await rpc('pma_put_message', {
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
    return true;
  } catch (_) {
    return false;
  }
}

/** 讀取某對話在 since（毫秒）之後的訊息。 */
export async function listMessages(conv = 'default', since = 0) {
  try {
    if (!supabaseConfigured()) return [];
    return await rpc('pma_list_messages', { p_conv: conv, p_since: since });
  } catch (_) {
    return [];
  }
}
