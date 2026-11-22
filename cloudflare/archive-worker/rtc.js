// WebRTC 的 worker 端純邏輯：ICE 設定組裝、TURN 憑證取得（Cloudflare Calls）、KV 信箱（信令備援）。
// 金鑰（TURN_API_TOKEN）只在 worker secrets；前端只拿到短效憑證。

export const STUN_URLS = Object.freeze(['stun:stun.cloudflare.com:3478']);
export const TURN_TTL_SEC = 3600;          // 憑證 1 小時
export const MAILBOX_MAX = 50;             // 每個信箱最多保留幾則
export const MAILBOX_TTL_SEC = 120;        // 信箱內容 2 分鐘後自動過期（KV 最小 60 秒）

/**
 * 把 TURN 服務的回應整理成 RTCPeerConnection 的 iceServers。
 * 接受兩種形狀：{iceServers:{urls,username,credential}} 或 [{urls,username,credential}]。
 * 沒有回應或格式不對時只回傳 STUN，並標示 turn:false。
 */
export function buildIceServers(turnResponse) {
  const servers = [{ urls: [...STUN_URLS] }];
  let turnList = null;
  if (Array.isArray(turnResponse)) {
    turnList = turnResponse;
  } else if (turnResponse && turnResponse.iceServers) {
    turnList = Array.isArray(turnResponse.iceServers) ? turnResponse.iceServers : [turnResponse.iceServers];
  }
  let turn = false;
  if (turnList) {
    for (const s of turnList) {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      const ok = urls.filter((u) => typeof u === 'string' && /^turns?:/.test(u));
      if (ok.length && typeof s.username === 'string' && typeof s.credential === 'string') {
        servers.push({ urls: ok, username: s.username, credential: s.credential });
        turn = true;
      }
    }
  }
  return { iceServers: servers, turn, ttl: TURN_TTL_SEC };
}

/**
 * 呼叫 Cloudflare Calls 取得 TURN 憑證。缺少 secrets 或失敗時回傳 null（前端退回 STUN-only）。
 * @param {{TURN_KEY_ID?:string, TURN_API_TOKEN?:string}} env
 * @param {typeof fetch} fetchFn 可注入（測試用）
 */
export async function fetchTurnCredentials(env, fetchFn = fetch) {
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return null;
  try {
    const res = await fetchFn(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_SEC }),
      }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

/**
 * 信箱加入一則訊息：保留最新 MAILBOX_MAX 則；過期的（超過 TTL）丟掉。
 * list 形狀：[{at:毫秒, msg:{...}}]。
 */
export function mailboxPush(list, msg, now) {
  const fresh = (Array.isArray(list) ? list : []).filter((e) => now - e.at < MAILBOX_TTL_SEC * 1000);
  fresh.push({ at: now, msg });
  return fresh.slice(-MAILBOX_MAX);
}

/** 取出信箱內容（未過期的），回傳 {messages, remaining:[]}；讀完即清空。 */
export function mailboxDrain(list, now) {
  const fresh = (Array.isArray(list) ? list : []).filter((e) => now - e.at < MAILBOX_TTL_SEC * 1000);
  return { messages: fresh.map((e) => e.msg), remaining: [] };
}
