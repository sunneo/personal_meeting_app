// 貼圖庫的瀏覽器部分：本機保存（localStorage）、匯入／匯出 YAML、貼圖選擇器。
// 貼圖只以 <img> 顯示（不執行 svg 內的腳本）；svg 在匯入時已檢查（見 core/sticker-yaml.js）。
import { parseStickerYaml, serializeStickerYaml, StickerParseError } from './core/sticker-yaml.js';

const KEY = 'pma.stickers';

export function loadStickers() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

/** 寫入本機；容量不足時回傳 false。 */
export function saveStickers(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch (_) {
    return false;
  }
}

/** 貼圖 → 可顯示的 URL（svg 轉成 data URL；gif 本來就是 data URL）。 */
export function stickerUrl(s) {
  if (s.type === 'svg') return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.data);
  return s.data;
}

/** 匯入 YAML 檔：整份取代或合併（同名以新的為準）。回傳 {ok, message}。 */
export async function importStickerFile(file, mode = 'merge') {
  try {
    const text = await file.text();
    const parsed = parseStickerYaml(text);
    const current = mode === 'replace' ? [] : loadStickers();
    const map = new Map(current.map((s) => [s.name, s]));
    for (const s of parsed.stickers) map.set(s.name, s);
    const next = [...map.values()];
    if (!saveStickers(next)) return { ok: false, message: '瀏覽器儲存空間不足，請減少貼圖數量或檔案大小' };
    return { ok: true, message: `已匯入 ${parsed.stickers.length} 個貼圖（目前共 ${next.length} 個）` };
  } catch (e) {
    if (e instanceof StickerParseError) return { ok: false, message: e.message };
    return { ok: false, message: '無法讀取貼圖檔' };
  }
}

/** 匯出為 YAML 字串（呼叫端負責下載）。 */
export function exportStickerYaml() {
  return serializeStickerYaml(loadStickers());
}
