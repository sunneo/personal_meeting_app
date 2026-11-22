// 視訊通話的純邏輯：信令訊息格式驗證、通話狀態機、錄製通知。不依賴 WebRTC 或網路。

export const SIGNAL_TYPES = Object.freeze(['offer', 'answer', 'ice', 'hangup', 'record-state']);
const CODE_RE = /^[a-z0-9_-]{3,32}$/;
const MAX_SDP = 64 * 1024;
const MAX_ICE = 4 * 1024;

/**
 * 驗證信令訊息（從 Realtime 或 worker 信箱收到的內容）。
 * 必要欄位：v=1、callId（字串）、from、to（代號）、type、payload（依 type 而定）。
 * 回傳正規化後的訊息；不合法丟出 Error。
 */
export function parseSignal(msg) {
  if (!msg || typeof msg !== 'object') throw new Error('信令不是物件');
  if (msg.v !== 1) throw new Error('信令版本不對');
  if (typeof msg.callId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(msg.callId)) throw new Error('callId 不合法');
  if (!CODE_RE.test(msg.from) || !CODE_RE.test(msg.to)) throw new Error('代號不合法');
  if (msg.from === msg.to) throw new Error('不能打給自己');
  if (!SIGNAL_TYPES.includes(msg.type)) throw new Error('信令類型不認識');
  const p = msg.payload;
  switch (msg.type) {
    case 'offer':
    case 'answer':
      if (!p || typeof p.sdp !== 'string' || p.sdp.length === 0 || p.sdp.length > MAX_SDP) throw new Error('SDP 不合法');
      if (!p.sdp.startsWith('v=0')) throw new Error('SDP 格式不對');
      break;
    case 'ice':
      if (!p || typeof p.candidate !== 'string' || p.candidate.length > MAX_ICE) throw new Error('ICE 候選不合法');
      break;
    case 'record-state':
      if (!p || typeof p.recording !== 'boolean') throw new Error('錄製狀態不合法');
      break;
    case 'hangup':
      break;
  }
  return { v: 1, callId: msg.callId, from: msg.from, to: msg.to, type: msg.type, payload: p ?? {} };
}

/** 建立信令訊息。 */
export function makeSignal(callId, from, to, type, payload = {}) {
  return parseSignal({ v: 1, callId, from, to, type, payload });
}

/**
 * 通話狀態機。狀態：idle → calling（我打出）/ ringing（別人打來）→ connected → ended。
 * 事件：start-call、incoming、accept、connected、hangup、failed、reset。
 * 不合法的轉換回傳原狀態（不丟錯），方便 UI 忽略重複事件。
 */
export const CALL_STATES = Object.freeze(['idle', 'calling', 'ringing', 'connected', 'ended']);

export function nextCallState(state, event) {
  switch (event) {
    case 'start-call': return state === 'idle' || state === 'ended' ? 'calling' : state;
    case 'incoming': return state === 'idle' || state === 'ended' ? 'ringing' : state;
    case 'accept': return state === 'ringing' ? 'connected' : state;
    case 'connected': return state === 'calling' ? 'connected' : state;
    case 'hangup':
    case 'failed':
      return state === 'idle' ? 'idle' : 'ended';
    case 'reset': return 'idle';
    default: return state;
  }
}

/** 錄製通知：開始或停止錄製時要告知對方（隱私同意）。回傳要送出的信令內容。 */
export function recordingNotice(callId, from, to, recording) {
  return makeSignal(callId, from, to, 'record-state', { recording: Boolean(recording) });
}
