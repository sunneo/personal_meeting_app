// 短期儲存：IndexedDB（附件 Blob 直接存在同一筆紀錄裡）。
// 所有存取都包在 try/catch 裡；IndexedDB 不可用時退回記憶體，頁面仍可正常運作。

const DB_NAME = 'personal-meeting-app';
const DB_VERSION = 1;
const STORE = 'messages';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('ts', 'ts');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

/** 請求持久儲存（瀏覽器可能拒絕，這裡只是盡力而為）。 */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (_) { /* 忽略 */ }
  return false;
}

/** 寫入一則訊息。失敗時回傳 false，呼叫端仍保有記憶體中的資料。 */
export async function saveMessage(msg) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(msg);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch (_) {
    return false;
  }
}

/** 讀出全部訊息，依時間排序。失敗時回傳空陣列。 */
export async function loadMessages() {
  try {
    const db = await openDb();
    const all = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('ts').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return all;
  } catch (_) {
    return [];
  }
}
