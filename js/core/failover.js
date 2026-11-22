// Supabase 備援的純邏輯（不依賴 fetch 或瀏覽器 API），給 supabase-store.js 與測試共用。

export const REQUEST_TIMEOUT_MS = 8000;
export const PRIMARY_RETRY_MS = 10 * 60 * 1000;

/**
 * 把一次請求的結果分類。
 * @param {{ok?:boolean, status?:number, error?:string, timedOut?:boolean}} r
 * @returns {{success:boolean, reason:'ok'|'timeout'|'network'|'server'|'missing'|'client'}}
 *   missing：404，代表該專案還沒執行 supabase/pma.sql（需要在 UI/console 提示）。
 */
export function classify(r) {
  if (r.timedOut) return { success: false, reason: 'timeout' };
  if (r.error && !r.status) return { success: false, reason: 'network' };
  if (r.ok) return { success: true, reason: 'ok' };
  if (r.status === 404) return { success: false, reason: 'missing' };
  if (r.status >= 500) return { success: false, reason: 'server' };
  return { success: false, reason: 'client' };
}

/**
 * 決定這次要嘗試的專案順序（索引陣列，每個索引最多出現一次）。
 * - 先試記住的專案（preferred）。
 * - 若 preferred 不是主要（0），且距離上次嘗試主要已超過 retryMs，主要排第一，讓它有機會回來。
 * - 其餘依順序（循環）排在後面，作為備援。
 * @param {number} count 專案數
 * @param {{preferred:number, lastPrimaryTryAt:number, now:number, retryMs?:number}} st
 * @returns {number[]}
 */
export function attemptOrder(count, st) {
  if (count <= 0) return [];
  const retryMs = st.retryMs ?? PRIMARY_RETRY_MS;
  const preferred = Number.isInteger(st.preferred) && st.preferred >= 0 && st.preferred < count ? st.preferred : 0;
  const order = [];
  const retryPrimary = preferred !== 0 && count > 0 && st.now - (st.lastPrimaryTryAt || 0) >= retryMs;
  if (retryPrimary) order.push(0);
  order.push(preferred);
  for (let k = 1; k < count; k++) {
    const idx = (preferred + k) % count;
    if (!order.includes(idx)) order.push(idx);
  }
  return order;
}

/**
 * 成功後更新記住的專案。
 * @returns {{preferred:number, lastPrimaryTryAt:number}}
 */
export function afterAttempt(state, index, now, success) {
  const next = { preferred: state.preferred, lastPrimaryTryAt: state.lastPrimaryTryAt || 0 };
  if (index === 0) next.lastPrimaryTryAt = now;
  if (success) next.preferred = index;
  return next;
}
