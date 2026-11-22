// 純邏輯（不依賴 DOM 或瀏覽器 API），給前端與測試共用。
// 與 cloudflare/archive-worker/worker.js 的版面規則必須一致。

export const MAX_PART_BYTES = 20 * 1024 * 1024;
export const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8

/** 毫秒時間戳 → "YYYY-MM"（UTC+8）。 */
export function monthOf(ts) {
  const d = new Date(Number(ts) + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 把一批大小切成 part 區間：[{index, start, end}]，index 從 1 開始，每段 ≤ maxBytes。 */
export function splitRanges(totalBytes, maxBytes = MAX_PART_BYTES) {
  if (!Number.isInteger(totalBytes) || totalBytes < 0) throw new Error('大小不對');
  if (totalBytes === 0) return [{ index: 1, start: 0, end: 0 }];
  const parts = [];
  for (let start = 0, index = 1; start < totalBytes; start += maxBytes, index++) {
    parts.push({ index, start, end: Math.min(start + maxBytes, totalBytes) });
  }
  return parts;
}

/** 與 worker 一致的 part 路徑：只有一份則不加後綴，否則 .partNNN。 */
export function partPath(month, category, name, index, total) {
  const base = `${month}/${category}/${name}`;
  return total > 1 ? `${base}.part${String(index).padStart(3, '0')}` : base;
}

/** 物件 → 一行 JSONL（含結尾換行）。 */
export function toJsonlLine(obj) {
  return JSON.stringify(obj) + '\n';
}

/** JSONL 文字 → 物件陣列；空行略過；任何一行解析失敗就丟出錯誤（帶行號）。 */
export function parseJsonl(text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`第 ${i + 1} 行不是合法 JSON`);
    }
  });
  return out;
}
