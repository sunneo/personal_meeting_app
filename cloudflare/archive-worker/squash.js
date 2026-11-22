// 每日壓縮（squash）的純邏輯：決定要不要壓、壓哪一段、鎖的判斷、帳號路徑。
// Worker 端的 Git Data API 操作在 worker.js；這裡只做判斷，方便測試。

export const LOCK_TTL_SEC = 15 * 60; // 壓縮鎖最長保留 15 分鐘（避免當機後永遠卡住）

/**
 * 帳號的歸檔路徑：accounts/<代號>/YYYY-MM/...（代號已驗證過，這裡再次保險）。
 */
export function accountPath(code, month, rest) {
  if (!/^[a-z0-9_-]{3,32}$/.test(code || '')) throw new Error('代號不合法');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new Error('月份不合法');
  return `accounts/${code}/${month}/${rest}`;
}

/**
 * 規劃一次壓縮。commits 是「由舊到新」的 commit 清單（第一筆一定是 base/根 commit，永遠不壓）。
 * 壓縮範圍：base 之後的全部 commit，壓成一個新 commit（tree = 目前 head 的 tree，parent = base）。
 * 因為新 commit 的 tree 就是 head 的 tree，範圍內的內容全部保留；不會丟資料。
 * @returns {{skip:boolean, reason?:string, baseSha?:string, headSha?:string, count:number}}
 */
export function planSquash(commits) {
  const list = Array.isArray(commits) ? commits : [];
  if (list.length === 0) return { skip: true, reason: '沒有 commit', count: 0 };
  const base = list[0];
  const rest = list.slice(1);
  if (rest.length <= 1) return { skip: true, reason: '不到兩個 commit，不需要壓縮', count: rest.length, baseSha: base.sha };
  return {
    skip: false,
    baseSha: base.sha,
    headSha: rest[rest.length - 1].sha,
    count: rest.length,
  };
}

/**
 * 壓縮鎖：鎖存在時，上傳要等（回 503）；鎖過期（超過 LOCK_TTL_SEC）視為已失效。
 * @param {{at:number}|null} lock  KV 內的鎖，at 為毫秒時間
 * @param {number} nowMs
 */
export function lockActive(lock, nowMs) {
  if (!lock || typeof lock.at !== 'number') return false;
  return nowMs - lock.at < LOCK_TTL_SEC * 1000;
}

/**
 * 壓縮前後確認：head 必須仍是我們讀到的那個 sha，否則中止（有人在我們讀取後寫入）。
 */
export function headStillValid(readHeadSha, currentHeadSha) {
  return Boolean(readHeadSha) && readHeadSha === currentHeadSha;
}
