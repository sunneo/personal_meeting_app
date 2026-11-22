// 使用者偏好的純邏輯（不依賴 DOM）：正規化、CSS 變數、頭像尺寸計算。

export const FONT_FAMILIES = {
  system: 'system-ui, "Noto Sans TC", "Microsoft JhengHei", sans-serif',
  serif: '"Noto Serif TC", "PMingLiU", serif',
  mono: 'ui-monospace, Consolas, "Courier New", monospace',
};

export const DEFAULT_PREFS = Object.freeze({ fontSize: 16, fontFamily: 'system', width: 720 });
export const LIMITS = Object.freeze({ fontSize: [12, 24], width: [480, 1200] });

const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));

/** 把任意輸入（例如 localStorage 的舊資料）整理成合法偏好；不合法的欄位用預設值。 */
export function normalizePrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fs = Number(r.fontSize);
  const w = Number(r.width);
  return {
    fontSize: Number.isFinite(fs) ? Math.round(clamp(fs, LIMITS.fontSize)) : DEFAULT_PREFS.fontSize,
    fontFamily: Object.prototype.hasOwnProperty.call(FONT_FAMILIES, r.fontFamily) ? r.fontFamily : DEFAULT_PREFS.fontFamily,
    width: Number.isFinite(w) ? Math.round(clamp(w, LIMITS.width)) : DEFAULT_PREFS.width,
  };
}

/** 偏好 → CSS 變數（套在 :root 上）。 */
export function prefsToCssVars(prefs) {
  const p = normalizePrefs(prefs);
  return {
    '--font-size': `${p.fontSize}px`,
    '--font-family': FONT_FAMILIES[p.fontFamily],
    '--layout-width': `${p.width}px`,
  };
}

/**
 * 頭像縮放：保持比例，長邊不超過 max。
 * 回傳 {width, height}；原圖更小時不放大。
 */
export function avatarSize(srcW, srcH, max = 128) {
  if (!(srcW > 0) || !(srcH > 0)) throw new Error('圖片尺寸不對');
  const scale = Math.min(1, max / Math.max(srcW, srcH));
  return { width: Math.max(1, Math.round(srcW * scale)), height: Math.max(1, Math.round(srcH * scale)) };
}
