// 防濫用（開放註冊後的防線）的純邏輯：註冊模式、IP 註冊頻率、帳號配額、保留字、Turnstile 驗證。
// 設計見 docs/DESIGN.auth.md 第 7 節。KV 讀寫與 HTTP 在 worker.js；這裡只做判斷，方便測試。

export const REGISTRATION_MODES = Object.freeze(['open', 'invite', 'closed']);
export const REG_LIMITS = Object.freeze({ perHour: 5, perDay: 10 });
export const QUOTA = Object.freeze({
  monthBytes: 200 * 1024 * 1024,   // 每個帳號每月歸檔總量上限（所有 part 加總）
  maxFileBytes: 100 * 1024 * 1024, // 單一檔案上限（宣告大小）
  dailyAppends: 2000,              // 每日 /append 次數
  dailyParts: 1000,                // 每日 /attachment part 次數
});

// 保留字：不可註冊，避免冒充系統或管理者。
export const RESERVED_CODES = Object.freeze(new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'official', 'moderator', 'mod',
  'owner', 'staff', 'security', 'api', 'www', 'mail', 'login', 'logout', 'register', 'signup',
  'signin', 'me', 'null', 'undefined', 'anonymous', 'test', 'bot', 'worker', 'archive', 'github',
  'cloudflare', 'supabase', 'webmaster', 'noreply', 'abuse',
]));

/** 註冊模式：預設 open；未知值視為 closed（寧可拒絕）。 */
export function normalizeRegistrationMode(raw) {
  if (raw === undefined || raw === null || raw === '') return 'open';
  return REGISTRATION_MODES.includes(raw) ? raw : 'closed';
}

/**
 * 決定這次註冊是否允許。
 * @param {string} mode normalizeRegistrationMode 的結果
 * @param {{inviteConfigured:boolean, inviteOk:boolean}} ctx
 *   invite 模式：必須設定 INVITE_CODE 且 inviteOk（邀請碼正確）。
 * @returns {{allowed:boolean, status?:number, error?:string}}
 */
export function registrationDecision(mode, ctx = {}) {
  if (mode === 'closed') return { allowed: false, status: 403, error: '目前暫停開放註冊' };
  if (mode === 'invite') {
    if (!ctx.inviteConfigured) return { allowed: false, status: 403, error: 'Worker 尚未設定 INVITE_CODE，註冊已關閉' };
    if (!ctx.inviteOk) return { allowed: false, status: 403, error: '邀請碼不對' };
  }
  return { allowed: true };
}

/** 帳號代號是否為保留字（比較前應已轉小寫）。 */
export function isReservedCode(code) {
  return RESERVED_CODES.has(String(code || '').toLowerCase());
}

/** 清理 CF-Connecting-IP：只留合理的 IP 字元；沒有或不合理就用 'unknown'。 */
export function normalizeIp(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > 64 || !/^[0-9a-fA-F:.]+$/.test(s)) return 'unknown';
  return s;
}

/** 時間桶的索引（小時、UTC 日）。 */
export function hourIndex(now) { return Math.floor(now / 3600000); }
export function dayIndex(now) { return Math.floor(now / 86400000); }

/** IP 註冊頻率的 KV 鍵。 */
export function regRateKeys(ip, now) {
  const i = normalizeIp(ip);
  return {
    hour: `rl:reg:h:${i}:${hourIndex(now)}`,
    day: `rl:reg:d:${i}:${dayIndex(now)}`,
  };
}

/**
 * 檢查 IP 註冊頻率。counts = {hour, day} 目前已用次數（不含這次）。
 * 超過就回傳 429。
 */
export function checkRegistrationRate(counts, limits = REG_LIMITS) {
  const h = Number(counts && counts.hour) || 0;
  const d = Number(counts && counts.day) || 0;
  if (h >= limits.perHour) return { ok: false, status: 429, error: '這個網路一小時內註冊太多次，請稍後再試' };
  if (d >= limits.perDay) return { ok: false, status: 429, error: '這個網路今天註冊太多次，請明天再試' };
  return { ok: true };
}

/** 帳號配額的 KV 鍵（每日次數、每月大小）。 */
export function quotaKeys(code, now) {
  const d = new Date(now);
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    day: `q:day:${code}:${dayIndex(now)}`,
    month: `q:month:${code}:${month}`,
  };
}

/** /append 的每日次數檢查。usage = {count} 目前已用。 */
export function checkDailyAppend(usage, limits = QUOTA) {
  const n = Number(usage && usage.count) || 0;
  if (n >= limits.dailyAppends) return { ok: false, status: 429, error: '今天的歸檔次數已用完，請明天再試' };
  return { ok: true };
}

/**
 * /attachment 的配額檢查。
 * @param {{bytes:number, parts:number}} usage 本月已用位元組、今日 part 次數（分開兩個鍵時由呼叫端合併）
 * @param {number} declaredFileSize 宣告的整個檔案大小
 * @param {number} partBytes 這一份 part 的實際位元組
 */
export function checkAttachmentQuota(usage, declaredFileSize, partBytes, limits = QUOTA) {
  if (!(declaredFileSize >= 0) || declaredFileSize > limits.maxFileBytes) {
    return { ok: false, status: 413, error: `單一檔案超過 ${Math.round(limits.maxFileBytes / 1048576)}MB` };
  }
  if ((Number(usage && usage.parts) || 0) >= limits.dailyParts) {
    return { ok: false, status: 429, error: '今天的附件上傳次數已用完，請明天再試' };
  }
  const used = Number(usage && usage.bytes) || 0;
  if (used + partBytes > limits.monthBytes) {
    return { ok: false, status: 413, error: '本月歸檔容量已用完' };
  }
  return { ok: true };
}

/**
 * Turnstile 驗證：呼叫 Cloudflare siteverify。未設定 secret 時直接視為通過（選用功能）。
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function verifyTurnstile(token, ip, secret, fetchFn = fetch) {
  if (!secret) return { ok: true, skipped: true };
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { ok: false, error: '請先完成人機驗證' };
  }
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = await res.json();
    return data && data.success === true ? { ok: true } : { ok: false, error: '人機驗證失敗，請重試' };
  } catch (_) {
    return { ok: false, error: '無法完成人機驗證（網路問題），請稍後再試' };
  }
}
