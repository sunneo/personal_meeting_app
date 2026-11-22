// 貼圖庫的 YAML 格式（受限的子集，只用於貼圖檔；不是完整 YAML）。
//
// 範例：
//   # 註解
//   stickers:
//     - name: smile
//       type: svg
//       data: |
//         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>
//     - name: wave
//       type: gif
//       data: "data:image/gif;base64,R0lGODlh..."
//
// 規則：
// - 頂層只有 stickers:，底下是清單；每個項目以 "  - " 開頭，欄位縮排 4 格。
// - 值可以是：未加引號的單行文字、JSON 字串（雙引號）、或 | 區塊（之後的行縮排 ≥ 6 格，會去掉共同縮排）。
// - name：小寫英數、底線、連字號，1–40 字，且不可重複。
// - type：svg 或 gif。
// - svg：data 必須以 <svg 開頭，且不可含 <script、<foreignObject，也不可有 on*= 事件屬性（防止 XSS）。
// - gif：data 必須是 data:image/gif;base64, 開頭。

const NAME_RE = /^[a-z0-9_-]{1,40}$/;
const MAX_STICKERS = 500;
const MAX_DATA_CHARS = 2 * 1024 * 1024;

export class StickerParseError extends Error {
  constructor(line, message) {
    super(`第 ${line} 行：${message}`);
    this.line = line;
  }
}

/** 檢查 SVG 是否安全（只做字串層級的基本檢查）。回傳錯誤訊息或 null。 */
export function checkSvg(data) {
  const s = String(data || '').trim();
  if (!s.startsWith('<svg')) return 'svg 內容必須以 <svg 開頭';
  if (/<script/i.test(s)) return 'svg 不可含 <script';
  if (/<foreignObject/i.test(s)) return 'svg 不可含 <foreignObject';
  if (/\son[a-z]+\s*=/i.test(s)) return 'svg 不可含事件屬性（on…=）';
  if (/javascript:/i.test(s)) return 'svg 不可含 javascript:';
  return null;
}

function parseScalar(raw, line) {
  const t = raw.trim();
  if (t.startsWith('"')) {
    try {
      const v = JSON.parse(t);
      if (typeof v !== 'string') throw new Error();
      return v;
    } catch (_) {
      throw new StickerParseError(line, '雙引號字串格式不對');
    }
  }
  return t;
}

/**
 * 解析貼圖 YAML。回傳 {stickers:[{name,type,data}]}；格式錯誤丟出 StickerParseError（帶行號）。
 */
export function parseStickerYaml(text) {
  if (typeof text !== 'string') throw new StickerParseError(0, '不是文字');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const stickers = [];
  let inList = false;
  let cur = null;
  let i = 0;

  const pushCur = () => { if (cur) { stickers.push(cur); cur = null; } };

  while (i < lines.length) {
    const lineNo = i + 1;
    const line = lines[i];
    i++;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    if (!line.startsWith(' ')) {
      if (line.trim() !== 'stickers:') throw new StickerParseError(lineNo, '頂層只能是 stickers:');
      inList = true;
      continue;
    }
    if (!inList) throw new StickerParseError(lineNo, '缺少 stickers: 開頭');

    const item = /^  - (\w+):\s*(.*)$/.exec(line);
    if (item) {
      if (item[1] !== 'name') throw new StickerParseError(lineNo, '每個項目要先寫 name:');
      pushCur();
      cur = { name: parseScalar(item[2], lineNo), type: undefined, data: undefined, _line: lineNo };
      continue;
    }

    const field = /^ {4}(\w+):\s*(.*)$/.exec(line);
    if (!field || !cur) throw new StickerParseError(lineNo, '欄位縮排或位置不對');
    const [, key, rest] = field;
    if (!['type', 'data'].includes(key)) throw new StickerParseError(lineNo, `不認識的欄位：${key}`);

    if (rest.trim() === '|') {
      const block = [];
      while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('      '))) {
        block.push(lines[i].startsWith('      ') ? lines[i].slice(6) : '');
        i++;
      }
      cur[key] = block.join('\n').replace(/\n+$/, '');
    } else {
      cur[key] = parseScalar(rest, lineNo);
    }
  }
  pushCur();

  if (!inList) throw new StickerParseError(0, '缺少 stickers: 開頭');
  if (stickers.length > MAX_STICKERS) throw new StickerParseError(0, `貼圖超過 ${MAX_STICKERS} 個`);

  const seen = new Set();
  for (const s of stickers) {
    const where = s._line;
    if (!NAME_RE.test(s.name || '')) throw new StickerParseError(where, `名稱不合法：${s.name}`);
    if (seen.has(s.name)) throw new StickerParseError(where, `名稱重複：${s.name}`);
    seen.add(s.name);
    if (s.type !== 'svg' && s.type !== 'gif') throw new StickerParseError(where, `type 只能是 svg 或 gif（${s.name}）`);
    if (typeof s.data !== 'string' || !s.data) throw new StickerParseError(where, `缺少 data（${s.name}）`);
    if (s.data.length > MAX_DATA_CHARS) throw new StickerParseError(where, `data 太大（${s.name}）`);
    if (s.type === 'svg') {
      const err = checkSvg(s.data);
      if (err) throw new StickerParseError(where, `${err}（${s.name}）`);
    } else if (!s.data.startsWith('data:image/gif;base64,')) {
      throw new StickerParseError(where, `gif 的 data 必須是 data:image/gif;base64,…（${s.name}）`);
    }
  }
  return { stickers: stickers.map(({ name, type, data }) => ({ name, type, data })) };
}

/** 貼圖清單 → YAML 文字（data 一律用雙引號 JSON 字串，避免縮排問題）。 */
export function serializeStickerYaml(stickers) {
  const out = ['# 貼圖庫', 'stickers:'];
  for (const s of stickers) {
    out.push(`  - name: ${s.name}`);
    out.push(`    type: ${s.type}`);
    out.push(`    data: ${JSON.stringify(s.data)}`);
  }
  return out.join('\n') + '\n';
}
