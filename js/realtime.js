// 信令傳輸：主要走 Supabase Realtime（沿用備援專案清單），全部不可用時退回 Cloudflare worker 信箱（輪詢）。
// 信令內容一律先用 core/call-state.js 的 parseSignal 驗證；不合法的直接丟棄。
import { SUPABASE_PROJECTS } from './config.js';
import { ARCHIVE_WORKER_URL } from './config.js';
import { realtimeWsUrl, inboxTopic, joinFrame, broadcastFrame, decodeFrame, extractSignal, encodeFrame, HEARTBEAT_MS } from './core/realtime-frame.js';
import { parseSignal } from './core/call-state.js';

const CONNECT_TIMEOUT_MS = 8000;
const POLL_MS = 3000;

/**
 * 建立信令傳輸。
 * @param {{self:string, getToken:()=>string|null, onSignal:(sig:object)=>void, onStatus?:(s:string)=>void}} opts
 * @returns {{start:()=>Promise<string>, send:(sig:object)=>Promise<boolean>, stop:()=>void, status:()=>string}}
 */
export function createSignaler(opts) {
  const { self, getToken, onSignal, onStatus = () => {} } = opts;
  let ws = null;
  let mode = 'offline';            // 'realtime:<項目名稱>' | 'worker' | 'offline'
  let ref = 0;
  let hb = null;
  let poll = null;
  const joined = new Set();
  const waiters = new Map();       // ref -> resolve（等 phx_reply）
  const setMode = (m) => { mode = m; onStatus(m); };

  function handleFrame(text) {
    let f;
    try { f = decodeFrame(text); } catch (_) { return; }
    if (f.event === 'phx_reply' && waiters.has(f.ref)) {
      waiters.get(f.ref)(f.payload && f.payload.status === 'ok');
      waiters.delete(f.ref);
      return;
    }
    const raw = extractSignal(f);
    if (!raw) return;
    try { onSignal(parseSignal(raw)); } catch (_) { /* 不合法的信令丟棄 */ }
  }

  function push(text) {
    if (ws && ws.readyState === 1) ws.send(text);
  }

  function nextRef() { ref += 1; return String(ref); }

  function joinChannel(topic) {
    return new Promise((resolve) => {
      if (joined.has(topic)) return resolve(true);
      const r = nextRef();
      const timer = setTimeout(() => { waiters.delete(r); resolve(false); }, CONNECT_TIMEOUT_MS);
      waiters.set(r, (ok) => { clearTimeout(timer); if (ok) joined.add(topic); resolve(ok); });
      push(joinFrame(topic, r));
    });
  }

  function connectRealtime(project) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
      const timer = setTimeout(() => { try { sock.close(); } catch (_) {} finish(false); }, CONNECT_TIMEOUT_MS);
      let sock;
      try {
        sock = new WebSocket(realtimeWsUrl(project.url, project.key));
      } catch (_) {
        clearTimeout(timer);
        return finish(false);
      }
      sock.onopen = async () => {
        ws = sock;
        const ok = await joinChannel(inboxTopic(self));
        clearTimeout(timer);
        if (!ok) { try { sock.close(); } catch (_) {} ws = null; return finish(false); }
        hb = setInterval(() => push(encodeFrame('phoenix', 'heartbeat', {}, nextRef())), HEARTBEAT_MS);
        setMode(`realtime:${project.name}`);
        finish(true);
      };
      sock.onmessage = (ev) => handleFrame(ev.data);
      sock.onerror = () => { clearTimeout(timer); finish(false); };
      sock.onclose = () => {
        clearInterval(hb);
        if (ws === sock) { ws = null; joined.clear(); setMode('worker'); startPoll(); }
        finish(false);
      };
    });
  }

  async function pollOnce() {
    const token = getToken();
    if (!token || !ARCHIVE_WORKER_URL) return;
    try {
      const res = await fetch(ARCHIVE_WORKER_URL + '/signal/poll', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      for (const m of data.messages || []) {
        try { onSignal(parseSignal(m)); } catch (_) { /* 丟棄 */ }
      }
    } catch (_) { /* 下次再試 */ }
  }

  function startPoll() {
    if (poll) return;
    poll = setInterval(pollOnce, POLL_MS);
  }

  return {
    /** 依序嘗試 Realtime 專案；都失敗就用 worker 信箱。回傳目前模式。 */
    async start() {
      for (const p of SUPABASE_PROJECTS) {
        if (!p.url || !p.key) continue;
        if (await connectRealtime(p)) return mode;
      }
      if (ARCHIVE_WORKER_URL && getToken()) {
        setMode('worker');
        startPoll();
      } else {
        setMode('offline');
      }
      return mode;
    },

    /** 送出信令：Realtime 用收件人的收件匣頻道；否則送到 worker 信箱。 */
    async send(sig) {
      if (mode.startsWith('realtime') && ws && ws.readyState === 1) {
        const topic = inboxTopic(sig.to);
        if (await joinChannel(topic)) {
          push(broadcastFrame(topic, sig, nextRef()));
          return true;
        }
      }
      const token = getToken();
      if (!token || !ARCHIVE_WORKER_URL) return false;
      try {
        const res = await fetch(ARCHIVE_WORKER_URL + '/signal', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(sig),
        });
        return res.ok;
      } catch (_) {
        return false;
      }
    },

    stop() {
      clearInterval(hb);
      clearInterval(poll);
      poll = null;
      if (ws) { try { ws.close(); } catch (_) {} ws = null; }
      joined.clear();
      setMode('offline');
    },

    status: () => mode,
  };
}
