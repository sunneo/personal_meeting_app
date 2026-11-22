// 儲存空間統計的純邏輯（不依賴 IndexedDB 或瀏覽器 API）。

const enc = new TextEncoder();

/** 文字的 UTF-8 位元組數。 */
export function textBytes(s) {
  return typeof s === 'string' ? enc.encode(s).length : 0;
}

/**
 * 統計一批訊息的本地佔用（估計值）：文字 + 各分類附件的 Blob 大小。
 * @param {{body?:string, subtitle?:string, attachments?:{category:string, blob?:{size:number}}[]}[]} messages
 * @returns {{count:number, textBytes:number, attachmentBytes:number, byCategory:Record<string,{count:number,bytes:number}>, totalBytes:number}}
 */
export function summarizeUsage(messages) {
  const out = { count: 0, textBytes: 0, attachmentBytes: 0, byCategory: {}, totalBytes: 0 };
  for (const m of messages || []) {
    out.count++;
    out.textBytes += textBytes(m.body) + textBytes(m.subtitle);
    for (const a of m.attachments || []) {
      const size = a.blob && Number.isFinite(a.blob.size) ? a.blob.size : 0;
      const cat = a.category || 'other';
      if (!out.byCategory[cat]) out.byCategory[cat] = { count: 0, bytes: 0 };
      out.byCategory[cat].count++;
      out.byCategory[cat].bytes += size;
      out.attachmentBytes += size;
    }
  }
  out.totalBytes = out.textBytes + out.attachmentBytes;
  return out;
}

/** 位元組 → 人看得懂的字串（B / KB / MB / GB）。 */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}
