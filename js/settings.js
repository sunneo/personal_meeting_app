// 設定面板的瀏覽器部分：偏好與頭像存在 localStorage（只存在這台裝置）。
// 所有存取都包在 try/catch；讀寫失敗時用預設值，頁面仍可用。
import { normalizePrefs, prefsToCssVars, avatarSize, DEFAULT_PREFS } from './core/prefs.js';

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
