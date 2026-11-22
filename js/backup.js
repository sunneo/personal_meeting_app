// 聊天紀錄備份：匯出／還原（zip：messages.jsonl + 附件 + manifest.json），以及登入後每日自動上傳到帳號的歸檔。
// 還原是冪等的（同 id 覆蓋），不會產生重複訊息。
import { buildZip, readZip } from './core/zip.js';
import { archiveAttachment, isLoggedIn } from './archive-client.js';

const LAST_KEY = 'pma.backup.lastUpload';
const DAY_MS = 24 * 60 * 60 * 1000;
export const BACKUP_VERSION = 1;

/** messages：本機的訊息陣列（附件含 blob）。回傳 Uint8Array（zip）。 */
export async function buildBackupZip(messages) {
  const files = [];
  const lines = [];
  for (const m of messages) {
    const atts = [];
    for (const a of m.attachments || []) {
      if (!a.blob) continue;
      const path = `attachments/${m.id}/${a.name}`;
      files.push({ name: path, data: new Uint8Array(await a.blob.arrayBuffer()) });
      atts.push({ name: a.name, category: a.category, type: a.blob.type || '', path });
    }
    const { attachments, ...rest } = m;
    lines.push(JSON.stringify({ ...rest, attachments: atts }));
  }
  files.unshift({ name: 'messages.jsonl', data: lines.join('\n') + (lines.length ? '\n' : '') });
  files.unshift({ name: 'manifest.json', data: JSON.stringify({ version: BACKUP_VERSION, count: messages.length, createdAt: Date.now() }, null, 2) });
  return buildZip(files);
}

/**
 * 還原：讀 zip，把每則訊息寫入（同 id 覆蓋）。回傳還原的訊息陣列（供畫面更新）。
 * saveMessage：通常是 store.js 的 saveMessage。
 */
export async function restoreBackupZip(bytes, saveMessage) {
  const entries = readZip(bytes);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const manifest = byName.get('manifest.json');
  if (!manifest) throw new Error('這不是備份檔（缺少 manifest.json）');
  const info = JSON.parse(new TextDecoder().decode(manifest));
  if (info.version !== BACKUP_VERSION) throw new Error(`備份版本不支援：${info.version}`);
  const text = byName.get('messages.jsonl');
  if (!text) throw new Error('備份內容缺少 messages.jsonl');
  const out = [];
  for (const line of new TextDecoder().decode(text).split('\n')) {
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    m.attachments = (m.attachments || []).map((a) => {
      const data = byName.get(a.path);
      return { name: a.name, category: a.category, blob: data ? new Blob([data], { type: a.type }) : null };
    }).filter((a) => a.blob);
    m.pendingSync = false;
    m.archivePending = false;
    await saveMessage(m);
    out.push(m);
  }
  return out;
}

/** 每日一次：把備份 zip 上傳到帳號歸檔（accounts/<代號>/YYYY-MM/docs/backup-YYYYMMDD.zip）。 */
export async function maybeUploadDailyBackup(messages, now = Date.now()) {
  if (!isLoggedIn()) return { skipped: 'not-logged-in' };
  let last = 0;
  try { last = Number(localStorage.getItem(LAST_KEY)) || 0; } catch (_) { /* 忽略 */ }
  if (now - last < DAY_MS) return { skipped: 'recent' };
  const zip = await buildBackupZip(messages);
  const d = new Date(now + 8 * 60 * 60 * 1000); // UTC+8 日期
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const r = await archiveAttachment({ name: `backup-${stamp}.zip`, category: 'docs', blob: new Blob([zip], { type: 'application/zip' }) }, now);
  if (r.ok) { try { localStorage.setItem(LAST_KEY, String(now)); } catch (_) { /* 忽略 */ } }
  return { uploaded: r.ok };
}
