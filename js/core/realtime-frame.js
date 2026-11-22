// Supabase Realtime（Phoenix 協定，vsn 1.0.0）的訊框編解碼與頻道命名。純邏輯，不開網路。
// 協定重點：每則訊框是 JSON {topic, event, payload, ref}；
//   加入頻道：event "phx_join"，回覆 event "phx_reply"（payload.status = ok|error）；
//   心跳：topic "phoenix"，event "heartbeat"，約每 25 秒一次；
//   廣播：送出 event "broadcast"，payload = {type:"broadcast", event:"<名稱>", payload:{...}}；
//         收到同樣是 event "broadcast"。

export const HEARTBEAT_MS = 25000;
const TOPIC_RE = /^realtime:[A-Za-z0-9_-]{1,120}$/;

/** 每個使用者的信令頻道（收件人的收件匣）。 */
export function inboxTopic(code) {
  if (!/^[a-z0-9_-]{3,32}$/.test(code || '')) throw new Error('頻道代號不合法');
  return `realtime:pma-inbox-${code}`;
}

export function realtimeWsUrl(projectUrl, apiKey) {
  const u = new URL(projectUrl);
  if (u.protocol !== 'https:') throw new Error('Supabase 網址必須是 https');
  return `wss://${u.host}/realtime/v1/websocket?apikey=${encodeURIComponent(apiKey)}&vsn=1.0.0`;
}

/** 編碼一則訊框（JSON 字串）。 */
export function encodeFrame(topic, event, payload, ref) {
  if (!TOPIC_RE.test(topic) && topic !== 'phoenix') throw new Error('頻道名稱不合法');
  return JSON.stringify({ topic, event, payload: payload ?? {}, ref: String(ref) });
}

/** 解碼一則訊框；格式錯誤丟出 Error。 */
export function decodeFrame(text) {
  let f;
  try {
    f = JSON.parse(text);
  } catch (_) {
    throw new Error('訊框不是 JSON');
  }
  if (!f || typeof f.topic !== 'string' || typeof f.event !== 'string') throw new Error('訊框缺少 topic 或 event');
  return { topic: f.topic, event: f.event, payload: f.payload ?? {}, ref: f.ref == null ? null : String(f.ref) };
}

/** 廣播的內容：event 固定為 "signal"，payload 是信令訊息。 */
export function broadcastFrame(topic, signal, ref) {
  return encodeFrame(topic, 'broadcast', { type: 'broadcast', event: 'signal', payload: signal }, ref);
}

/** 從收到的 broadcast 取出信令（沒有或不是 signal 事件就回傳 null）。 */
export function extractSignal(frame) {
  if (frame.event !== 'broadcast') return null;
  const p = frame.payload;
  if (!p || p.event !== 'signal' || !p.payload) return null;
  return p.payload;
}

/** 加入頻道的訊框（broadcast.self = false：不收自己送的）。 */
export function joinFrame(topic, ref) {
  return encodeFrame(topic, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' } } }, ref);
}
