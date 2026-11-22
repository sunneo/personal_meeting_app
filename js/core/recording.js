// 錄音錄影的純邏輯：挑選 mimeType、檔名、錄製紀錄格式驗證。不依賴 MediaRecorder。

export const MIME_CANDIDATES = Object.freeze({
  audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'],
  video: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
});

/**
 * 依瀏覽器支援挑選第一個可用的 mimeType；都不支援回傳 null。
 * @param {'audio'|'video'} kind
 * @param {(mime:string)=>boolean} isSupported 通常是 MediaRecorder.isTypeSupported
 */
export function pickMimeType(kind, isSupported) {
  const list = MIME_CANDIDATES[kind];
  if (!list) throw new Error('錄製種類只能是 audio 或 video');
  for (const m of list) {
    let ok = false;
    try { ok = Boolean(isSupported(m)); } catch (_) { ok = false; }
    if (ok) return m;
  }
  return null;
}

/** 副檔名：依 mimeType 判斷（mp4 或 webm）。 */
export function extFor(mime) {
  const isMp4 = Boolean(mime) && (mime.startsWith('video/mp4') || mime.startsWith('audio/mp4'));
  return isMp4 ? 'mp4' : 'webm';
}

/** 檔名：rec-<種類>-YYYYMMDD-HHMMSS.<副檔名>（時間以本機時間）。 */
export function recordingFileName(kind, mime, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `rec-${kind}-${stamp}.${extFor(mime)}`;
}

/**
 * 錄製紀錄（存在錄音錄影庫）的格式驗證。
 * 必要：id、kind（audio|video）、mime、blob（有 size）、createdAt（毫秒）、name。
 */
export function validateRecording(r) {
  if (!r || typeof r !== 'object') throw new Error('紀錄不是物件');
  if (typeof r.id !== 'string' || !r.id) throw new Error('缺少 id');
  if (r.kind !== 'audio' && r.kind !== 'video') throw new Error('kind 只能是 audio 或 video');
  if (typeof r.mime !== 'string' || !r.mime) throw new Error('缺少 mime');
  if (!r.blob || !Number.isFinite(r.blob.size)) throw new Error('缺少錄製內容');
  if (!Number.isFinite(r.createdAt)) throw new Error('缺少時間');
  if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 120) throw new Error('名稱不合法');
  return { ...r, name: r.name.trim() };
}

/** 重新命名：只改名稱，其他欄位不變。 */
export function renameRecording(r, name) {
  return validateRecording({ ...r, name });
}
