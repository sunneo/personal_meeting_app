// 錄音錄影庫：只屬於使用者本人，不進對話。
// 預設存在 IndexedDB（獨立資料庫 pma-recordings，並請求持久儲存）。
// 「fap」= File System Access API：可選本機資料夾（showDirectoryPicker），資料夾的 handle 存在 IndexedDB；
// 不支援的瀏覽器（多數手機）隱藏這個功能，改用下載。
import { validateRecording, renameRecording } from './core/recording.js';

const DB = 'pma-recordings';
const DB_VER = 1;
let dbp = null;

function openDb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : true);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function fapSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** 新增一則錄製（會先驗證格式）。 */
export async function saveRecording(raw) {
  const r = validateRecording({ ...raw, id: raw.id || crypto.randomUUID() });
  await tx('recordings', 'readwrite', (s) => s.put(r));
  return r;
}

export async function listRecordings() {
  const all = await tx('recordings', 'readonly', (s) => s.getAll());
  return (all || []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRecording(id) {
  return tx('recordings', 'readonly', (s) => s.get(id));
}

export async function renameStoredRecording(id, name) {
  const cur = await getRecording(id);
  if (!cur) throw new Error('找不到這筆錄製');
  const next = renameRecording(cur, name);
  await tx('recordings', 'readwrite', (s) => s.put(next));
  return next;
}

export async function deleteRecording(id) {
  await tx('recordings', 'readwrite', (s) => s.delete(id));
}

/** 設定儲存資料夾（需要使用者手勢觸發）。回傳 true/false。 */
export async function chooseFolder() {
  if (!fapSupported()) return false;
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await tx('handles', 'readwrite', (s) => s.put(handle, 'dir'));
  return true;
}

async function getFolder() {
  const h = await tx('handles', 'readonly', (s) => s.get('dir'));
  return h || null;
}

/** 把一則錄製寫入已選的資料夾；權限不足時會要求權限（需要使用者手勢）。 */
export async function saveToFolder(rec) {
  const dir = await getFolder();
  if (!dir) throw new Error('尚未選擇儲存資料夾');
  let perm = await dir.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') perm = await dir.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new Error('沒有資料夾寫入權限');
  const fh = await dir.getFileHandle(rec.name, { create: true });
  const w = await fh.createWritable();
  await w.write(rec.blob);
  await w.close();
  return true;
}

function download(rec) {
  const url = URL.createObjectURL(rec.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = rec.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 錄音錄影庫的畫面：列表、播放（影像點一下才播）、重新命名、刪除、下載、存到資料夾。 */
export function initRecordingLibrary(root) {
  if (!root) return;
  const list = root.querySelector('#rec-list');
  const msg = root.querySelector('#rec-msg');
  const folderBtn = root.querySelector('#rec-folder');
  const saveFolderBtn = root.querySelector('#rec-save-folder');
  const say = (t) => { msg.textContent = t; };

  if (!fapSupported()) {
    folderBtn.hidden = true;
    saveFolderBtn.hidden = true;
  }

  async function render() {
    const items = await listRecordings();
    list.replaceChildren();
    if (items.length === 0) {
      list.append(Object.assign(document.createElement('li'), { textContent: '（錄音錄影庫是空的）' }));
      return;
    }
    for (const r of items) {
      const li = document.createElement('li');
      li.className = 'rec-item';
      const title = document.createElement('div');
      title.textContent = `${r.kind === 'video' ? '🎥' : '🎙'} ${r.name}（${Math.ceil(r.blob.size / 1024)} KB，${new Date(r.createdAt).toLocaleString()}）`;
      li.append(title);
      const media = document.createElement(r.kind === 'video' ? 'video' : 'audio');
      media.controls = true;
      media.preload = 'none';   // 不自動播放；點一下才載入
      media.playsInline = true;
      media.src = URL.createObjectURL(r.blob);
      li.append(media);

      const bar = document.createElement('div');
      bar.className = 'rec-actions';
      const mk = (label, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', fn);
        bar.append(b);
      };
      mk('改名', async () => {
        const n = prompt('新名稱', r.name);
        if (!n) return;
        try { await renameStoredRecording(r.id, n); render(); } catch (e) { say(e.message); }
      });
      mk('下載', () => download(r));
      if (fapSupported()) mk('存到資料夾', async () => {
        try { await saveToFolder(r); say('已存到資料夾：' + r.name); } catch (e) { say(e.message); }
      });
      mk('刪除', async () => {
        if (!confirm('刪除這筆錄製？此動作無法復原（若已存到資料夾，資料夾裡的檔案不會被刪）。')) return;
        await deleteRecording(r.id);
        render();
      });
      li.append(bar);
      list.append(li);
    }
  }

  folderBtn.addEventListener('click', async () => {
    try {
      await chooseFolder();
      say('已選擇儲存資料夾。');
    } catch (e) { say('未選擇資料夾：' + (e && e.message ? e.message : e)); }
  });

  render();
  return { refresh: render, save: saveRecording };
}
