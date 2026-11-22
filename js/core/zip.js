// 最小的 ZIP 讀寫（只支援「不壓縮」store 方式）：用於聊天備份。純邏輯，不依賴瀏覽器 API。
// 不壓縮的理由：JSONL 與附件大多已經是壓縮格式或很小；實作簡單、可完整驗證（CRC32）。

const enc = new TextEncoder();
const dec = new TextDecoder();

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

/** CRC-32（ISO-HDLC，與 zip 相同）。 */
export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

/**
 * 建立 zip。files: [{name:string, data:Uint8Array|string}]。
 * 檔名必須是相對路徑（不可含 .. 或開頭斜線）。
 * @returns {Uint8Array}
 */
export function buildZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    if (typeof f.name !== 'string' || !f.name || f.name.startsWith('/') || f.name.split('/').includes('..')) {
      throw new Error('檔名不合法：' + f.name);
    }
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
    ];
    parts.push(new Uint8Array(local), name, data);
    central.push({ name, crc, size: data.length, offset });
    offset += local.length + name.length + data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const h = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset),
    ]);
    parts.push(h, c.name);
    cdSize += h.length + c.name.length;
  }
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(cdSize), ...u32(cdStart), ...u16(0),
  ]);
  parts.push(end);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

const rd16 = (b, i) => b[i] | (b[i + 1] << 8);
const rd32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/**
 * 讀取 zip（只接受 store 方式）。回傳 [{name, data:Uint8Array}]；CRC 不符或格式錯誤丟出 Error。
 */
export function readZip(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // 找結尾標記（EOCD）
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 65535; i--) {
    if (rd32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 檔');
  const count = rd16(b, eocd + 10);
  let p = rd32(b, eocd + 16);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (rd32(b, p) !== 0x02014b50) throw new Error('zip 中央目錄損毀');
    const method = rd16(b, p + 10);
    if (method !== 0) throw new Error('只支援未壓縮的 zip');
    const crc = rd32(b, p + 16);
    const size = rd32(b, p + 24);
    const nameLen = rd16(b, p + 28);
    const extraLen = rd16(b, p + 30);
    const commentLen = rd16(b, p + 32);
    const localOff = rd32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    if (rd32(b, localOff) !== 0x04034b50) throw new Error('zip 本地檔頭損毀');
    const lNameLen = rd16(b, localOff + 26);
    const lExtraLen = rd16(b, localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = b.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error('CRC 不符：' + name);
    out.push({ name, data: new Uint8Array(data) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
