// 設定面板的瀏覽器部分：偏好與頭像存在 localStorage（只存在這台裝置）。
// 所有存取都包在 try/catch；讀寫失敗時用預設值，頁面仍可用。
import { normalizePrefs, prefsToCssVars, avatarSize, DEFAULT_PREFS } from './core/prefs.js';
import {
  loadNotifyConfig, saveNotifyConfig, saveCustomSound, requestPermission, playPreset, notifyIncoming,
} from './notify.js';

const PREFS_KEY = 'pma.prefs';
const AVATAR_KEY = 'pma.avatar';

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return normalizePrefs(raw ? JSON.parse(raw) : DEFAULT_PREFS);
  } catch (_) {
    return normalizePrefs(DEFAULT_PREFS);
  }
}

export function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(normalizePrefs(p))); } catch (_) { /* 忽略 */ }
}

export function applyPrefs(p) {
  const vars = prefsToCssVars(p);
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
}

export function loadAvatar() {
  try { return localStorage.getItem(AVATAR_KEY); } catch (_) { return null; }
}

function saveAvatar(dataUrl) {
  try { localStorage.setItem(AVATAR_KEY, dataUrl); } catch (_) { /* 容量不足等情況忽略 */ }
}

/** 把圖片檔縮成頭像（長邊 128px）並回傳 data URL。 */
export async function imageToAvatar(file) {
  const bmp = await createImageBitmap(file);
  const { width, height } = avatarSize(bmp.width, bmp.height, 128);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bmp, 0, 0, width, height);
  bmp.close && bmp.close();
  return canvas.toDataURL('image/png');
}

function showAvatar(url) {
  const img = document.getElementById('avatar');
  if (!img) return;
  if (url) { img.src = url; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
}

/** 通知設定：模式、音效、自訂音效、測試按鈕。 */
function initNotifySettings(form) {
  const cfg0 = loadNotifyConfig();
  const msgEl = document.getElementById('notify-msg');
  form.notifyMode.value = cfg0.mode;
  form.notifySound.value = cfg0.sound;
  const current = () => ({ ...loadNotifyConfig(), mode: form.notifyMode.value, sound: form.notifySound.value });
  form.notifyMode.addEventListener('change', async () => {
    if (form.notifyMode.value === 'web') {
      const perm = await requestPermission();
      msgEl.textContent = perm === 'granted' ? '已允許網頁通知。' : perm === 'unsupported' ? '此瀏覽器不支援網頁通知。' : '未允許通知權限，仍會播放音效。';
    }
    saveNotifyConfig(current());
  });
  form.notifySound.addEventListener('change', () => {
    saveNotifyConfig(current());
    playPreset(form.notifySound.value);
  });
  form.customSound.addEventListener('change', async () => {
    const f = form.customSound.files[0];
    form.customSound.value = '';
    if (!f) return;
    const err = await saveCustomSound(f);
    msgEl.textContent = err || '已儲存自訂音效（會優先於內建音效）。';
  });
  document.getElementById('btn-notify-test').addEventListener('click', () => {
    const cfg = current();
    msgEl.textContent = '';
    notifyIncoming({ ...cfg, mode: 'web' }, { me: false, body: '這是測試通知' }, false);
  });
}

/** 初始化：載入偏好與頭像、綁定設定面板。 */
export function initSettings() {
  let prefs = loadPrefs();
  applyPrefs(prefs);
  showAvatar(loadAvatar());

  const panel = document.getElementById('settings');
  const form = document.getElementById('prefs-form');
  document.getElementById('btn-settings').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });

  form.fontSize.value = prefs.fontSize;
  form.fontFamily.value = prefs.fontFamily;
  form.width.value = prefs.width;

  const onPrefInput = () => {
    prefs = normalizePrefs({
      fontSize: form.fontSize.value,
      fontFamily: form.fontFamily.value,
      width: form.width.value,
    });
    savePrefs(prefs);
    applyPrefs(prefs);
  };
  form.fontSize.addEventListener('change', onPrefInput);
  form.fontFamily.addEventListener('change', onPrefInput);
  form.width.addEventListener('change', onPrefInput);

  initNotifySettings(form);

  form.avatar.addEventListener('change', async () => {
    const f = form.avatar.files[0];
    form.avatar.value = '';
    if (!f) return;
    try {
      const url = await imageToAvatar(f);
      saveAvatar(url);
      showAvatar(url);
    } catch (_) {
      alert('無法讀取這張圖片，請換一張。');
    }
  });
}
