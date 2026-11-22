// 通知的瀏覽器部分：權限、系統通知、音效（內建合成音或自訂音檔）。設定存在 localStorage。
// 注意：手機推播（Web Push）尚未實作，這裡的 mode 只有 'off' 與 'web'。
import { notificationPlan, checkCustomSound, SOUND_PRESETS, DEFAULT_NOTIFY } from './core/notify.js';

const KEY = 'pma.notify';
const CUSTOM_KEY = 'pma.notify.customSound';

export function loadNotifyConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    const c = raw ? JSON.parse(raw) : {};
    return {
      mode: c.mode === 'off' ? 'off' : 'web',
      sound: Object.prototype.hasOwnProperty.call(SOUND_PRESETS, c.sound) ? c.sound : DEFAULT_NOTIFY.sound,
      customSound: Boolean(localStorage.getItem(CUSTOM_KEY)),
    };
  } catch (_) {
    return { ...DEFAULT_NOTIFY };
  }
}

export function saveNotifyConfig(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify({ mode: cfg.mode, sound: cfg.sound })); } catch (_) { /* 忽略 */ }
}

/** 上傳自訂音效：檢查後存為 data URL；容量不足時回傳錯誤訊息。 */
export function saveCustomSound(file) {
  const err = checkCustomSound(file);
  if (err) return Promise.resolve(err);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        localStorage.setItem(CUSTOM_KEY, reader.result);
        resolve(null);
      } catch (_) {
        resolve('瀏覽器儲存空間不足，請換一個較小的音效檔');
      }
    };
    reader.onerror = () => resolve('無法讀取音效檔');
    reader.readAsDataURL(file);
  });
}

export function clearCustomSound() {
  try { localStorage.removeItem(CUSTOM_KEY); } catch (_) { /* 忽略 */ }
}

/** 播放內建合成音（Web Audio）。 */
export function playPreset(name) {
  const preset = SOUND_PRESETS[name];
  if (!preset || preset.notes.length === 0) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let t = ctx.currentTime;
    for (const n of preset.notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + n.d);
      t += n.d;
    }
  } catch (_) { /* 沒有音訊能力就略過 */ }
}

/** 播放自訂音效。 */
export function playCustom() {
  try {
    const src = localStorage.getItem(CUSTOM_KEY);
    if (src) new Audio(src).play().catch(() => {});
  } catch (_) { /* 忽略 */ }
}

/** 依設定播放音效（呼叫端先用 notificationPlan 判斷）。 */
export function playSound(cfg) {
  if (cfg.customSound && localStorage.getItem(CUSTOM_KEY)) playCustom();
  else playPreset(cfg.sound);
}

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

/** 收到他人訊息時呼叫：依設定決定是否跳通知與響。 */
export function notifyIncoming(cfg, msg, pageVisible = document.visibilityState === 'visible') {
  const plan = notificationPlan(cfg, { fromMe: Boolean(msg.me), pageVisible });
  if (plan.showNotification && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('新訊息', { body: (msg.body || '').slice(0, 120) });
    } catch (_) { /* 某些環境不允許建立通知 */ }
  }
  if (plan.playSound) playSound(cfg);
  return plan;
}
