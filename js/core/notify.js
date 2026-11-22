// 通知的純邏輯：決定要不要顯示、要不要響、用哪個音效。不依賴瀏覽器 API。

export const SOUND_PRESETS = Object.freeze({
  ding: { label: '叮', notes: [{ f: 880, d: 0.25 }] },
  chime: { label: '風鈴', notes: [{ f: 659, d: 0.2 }, { f: 988, d: 0.3 }] },
  none: { label: '靜音', notes: [] },
});

export const DEFAULT_NOTIFY = Object.freeze({ mode: 'web', sound: 'ding', customSound: false });
export const MAX_CUSTOM_SOUND_BYTES = 1024 * 1024; // 1MB，避免 IndexedDB 佔用過大

/**
 * 依設定與情境決定通知動作。
 * @param {{mode:'off'|'web'|'phone', sound:string, customSound:boolean}} cfg
 * @param {{fromMe:boolean, pageVisible:boolean}} ctx
 * @returns {{showNotification:boolean, playSound:boolean}}
 *   - 自己發的訊息不通知。
 *   - 頁面可見時只播音效（不跳系統通知）。
 */
export function notificationPlan(cfg, ctx) {
  const off = { showNotification: false, playSound: false };
  if (!cfg || cfg.mode === 'off' || (ctx && ctx.fromMe)) return off;
  const soundOn = cfg.customSound || (cfg.sound && cfg.sound !== 'none');
  if (ctx && ctx.pageVisible) return { showNotification: false, playSound: Boolean(soundOn) };
  return { showNotification: true, playSound: Boolean(soundOn) };
}

/** 自訂音效檢查：必須是 audio/* 且不超過 1MB。回傳錯誤訊息或 null。 */
export function checkCustomSound(file) {
  if (!file) return '沒有選擇檔案';
  if (!(file.type || '').startsWith('audio/')) return '請選擇音訊檔（mp3、wav、ogg…）';
  if (file.size > MAX_CUSTOM_SOUND_BYTES) return '音效檔超過 1MB';
  return null;
}
