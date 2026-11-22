// 登入／註冊表單的純邏輯：欄位驗證與畫面狀態（gate / main）。不依賴 DOM。

const CODE_RE = /^[a-z0-9_-]{3,32}$/;

/** 代號統一小寫、去空白。 */
export function normalizeLoginCode(code) {
  return typeof code === 'string' ? code.trim().toLowerCase() : '';
}

/** 登入表單驗證：回傳錯誤訊息，或 null 表示通過。 */
export function validateLogin({ code, password }) {
  const c = normalizeLoginCode(code);
  if (!CODE_RE.test(c)) return '帳號代號格式不對（3–32 字元：英數、底線、連字號）';
  if (typeof password !== 'string' || password.length === 0) return '請輸入密碼';
  return null;
}

/** 註冊表單驗證：回傳錯誤訊息，或 null。 */
export function validateRegister({ code, password, password2, invite }) {
  const c = normalizeLoginCode(code);
  if (!CODE_RE.test(c)) return '帳號代號格式不對（3–32 字元：英數、底線、連字號）';
  if (typeof password !== 'string' || password.length < 8) return '密碼至少 8 字元';
  if (password !== password2) return '兩次輸入的密碼不一致';
  if (typeof invite !== 'string' || invite.trim().length === 0) return '請輸入邀請碼';
  return null;
}

/**
 * 畫面要顯示哪一層。
 * - 已登入 → main。
 * - 使用者選了「先用離線本地模式」→ main（僅本機，不代表已登入）。
 * - 其他一律 gate（登入／註冊版面）。
 */
export function viewFor({ loggedIn, offlineChosen }) {
  if (loggedIn) return 'main';
  if (offlineChosen) return 'main';
  return 'gate';
}

/**
 * 把伺服器或網路的錯誤轉成給使用者看的訊息。
 * @param {{status?:number, data?:{error?:string}, networkError?:boolean}} r
 */
export function describeFailure(r, action) {
  if (!r || r.networkError) return `無法連線到歸檔服務（網路或 Worker 不可用），${action}失敗，請稍後再試。`;
  if (r.data && r.data.error) return r.data.error;
  return `${action}失敗（HTTP ${r.status || '?'}）`;
}
