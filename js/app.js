// 入口：本地模式。之後的功能（傳輸、長期儲存）依 docs/HANDOFF.md 的 todo 逐步加入。
import { requestPersistence, saveMessage, loadMessages, deleteMessage, clearMessages } from './store.js';
import { summarizeUsage, formatBytes } from './core/storage-usage.js';
import { loadStickers, stickerUrl, importStickerFile, exportStickerYaml } from './stickers.js';
import { initSocial } from './social.js';
import { initCallUi } from './call-ui.js';
import { initRecordingLibrary } from './recordings.js';
import { putMessage } from './supabase-store.js';
import { initSettings } from './settings.js';
import {
  archiveConfigured, isLoggedIn, login, register, logout, archiveAppend, archiveAttachment,
} from './archive-client.js';


const conv = document.getElementById('conversation');
const form = document.getElementById('composer');
const input = document.getElementById('text-input');

/** @type {{id:string, ts:number, me:boolean, body:string}[]} */
const messages = [];

/** 新增一則訊息：先放進記憶體顯示，再寫入 IndexedDB。 */
function pushMessage(msg) {
  messages.push(msg);
  msg.pendingSync = true;                    // 長期 A（Supabase）尚未確認寫入
  msg.archivePending = archiveConfigured();  // 長期 B（Cloudflare 歸檔）尚未完成
  msg.archiveAppended = false;
  saveMessage(msg);
  render();
  syncOne(msg);
}

const busy = new WeakSet();

/**
 * 把單則訊息同步到兩條長期路徑；失敗的部分保留待補傳旗標，不丟失。
 * - A：Supabase（備援全失敗就保留 pendingSync）
 * - B：歸檔（先上傳附件，附件全成功才 append JSONL；附件已成功的不重傳，append 成功後不再重送）
 */
async function syncOne(msg) {
  if (busy.has(msg)) return;
  busy.add(msg);
  let changed = false;
  try {
    if (msg.pendingSync && (await putMessage(msg))) {
      msg.pendingSync = false;
      changed = true;
    }
    if (msg.archivePending && isLoggedIn()) {
      let ok = true;
      for (const att of msg.attachments || []) {
        if (att.archived) continue;
        const r = await archiveAttachment(att, msg.ts);
        if (r.ok) { att.archived = true; changed = true; } else { ok = false; break; }
      }
      if (ok && !msg.archiveAppended) {
        const r = await archiveAppend(msg);
        if (r.ok) { msg.archiveAppended = true; changed = true; }
      }
      if (msg.archiveAppended) {
        msg.archivePending = false;
        changed = true;
      }
    }
  } finally {
    busy.delete(msg);
  }
  if (changed) {
    await saveMessage(msg);
    render();
  }
}

/** 補傳所有待補傳的訊息（啟動、定時、上線、登入後都會呼叫）。 */
async function flushPending() {
  for (const m of messages) {
    if (m.pendingSync || m.archivePending) await syncOne(m);
  }
}

// 啟動後與網路恢復時補傳；每分鐘也補傳一次
window.addEventListener('online', flushPending);
setInterval(flushPending, 60 * 1000);

// Supabase 備援的提示（例如 404 代表該專案還沒執行 pma.sql）
const statusEl = document.getElementById('status');
window.addEventListener('pma:supabase-hint', (e) => {
  statusEl.textContent = e.detail.message;
});

/** 依副檔名／MIME 分類：audio（聲音/音樂）、pdf、other（文件）。 */
function categoryOf(file) {
  const t = file.type || '';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (t === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  return 'other';
}

/** 附件的顯示：聲音用內建播放器；PDF 用內嵌檢視；其他提供下載。 */
function attachmentNode(att) {
  const wrap = document.createElement('div');
  wrap.className = 'attachment';
  const url = URL.createObjectURL(att.blob);
  if (att.category === 'audio' || att.category === 'voice') {
    const a = document.createElement('audio');
    a.controls = true;
    a.src = url;
    wrap.append(a);
  } else if (att.category === 'video') {
    // 不自動播放：preload=none、沒有 autoplay；點一下才播放，controls 內含全螢幕按鈕
    const v = document.createElement('video');
    v.controls = true;
    v.preload = 'none';
    v.playsInline = true;
    v.src = url;
    v.className = 'chat-video';
    wrap.append(v);
  } else if (att.category === 'pdf') {
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.className = 'pdf-view';
    frame.title = att.name;
    wrap.append(frame);
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = att.name;
  link.textContent = `📄 ${att.name}（${Math.ceil(att.blob.size / 1024)} KB）`;
  wrap.append(link);
  return wrap;
}

/** 朗讀文字（Web Speech API）。不支援時靜默略過。 */
function speakText(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = /[一-鿿]/.test(text) ? 'zh-TW' : 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (_) {
    /* 瀏覽器不支援或被阻擋時忽略 */
  }
}

function render() {
  conv.replaceChildren();
  if (messages.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = '尚無訊息。';
    conv.append(p);
    return;
  }
  for (const m of messages) {
    const b = document.createElement('div');
    b.className = 'bubble' + (m.me ? ' me' : '');
    if (m.pendingSync) b.dataset.pending = '1';
    const text = document.createElement('span');
    text.textContent = m.body;
    const speak = document.createElement('button');
    speak.type = 'button';
    speak.className = 'speak';
    speak.title = '朗讀';
    speak.textContent = '🔊';
    speak.addEventListener('click', () => speakText(m.body));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'speak';
    del.title = '刪除本機這則訊息';
    del.textContent = '🗑';
    del.addEventListener('click', () => removeLocal(m));
    b.append(text, speak, del);
    if (m.sticker) {
      const img = document.createElement('img');
      img.className = 'sticker-img';
      img.alt = m.sticker.name;
      img.src = stickerUrl(m.sticker); // <img> 不會執行 svg 內的腳本
      b.append(img);
    }
    for (const att of m.attachments || []) b.append(attachmentNode(att));
    if (m.subtitle !== undefined) {
      const sub = document.createElement('div');
      sub.className = 'subtitle';
      sub.textContent = '字幕：' + m.subtitle;
      b.append(sub);
    }
    conv.append(b);
  }
  conv.scrollTop = conv.scrollHeight;
  refreshStorage();
}

/** 刪除本機一則訊息（已歸檔的不會刪）。 */
async function removeLocal(m) {
  if (!confirm('刪除這台裝置上的這則訊息？已歸檔的內容不會被刪除。')) return;
  const i = messages.indexOf(m);
  if (i >= 0) messages.splice(i, 1);
  await deleteMessage(m.id);
  render();
}

// ---- 儲存空間：顯示瀏覽器估計用量與本機訊息佔用；可清除本機資料
const storageInfo = document.getElementById('storage-info');
async function refreshStorage() {
  const s = summarizeUsage(messages);
  const cats = Object.entries(s.byCategory).map(([k, v]) => `${k} ${v.count} 個（${formatBytes(v.bytes)}）`).join('、') || '無附件';
  let est = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      est = `瀏覽器用量 ${formatBytes(e.usage || 0)} / 配額 ${formatBytes(e.quota || 0)}。`;
    }
  } catch (_) { /* 不支援就略過 */ }
  storageInfo.textContent = `${est}本機 ${s.count} 則訊息，文字 ${formatBytes(s.textBytes)}，附件 ${formatBytes(s.attachmentBytes)}（${cats}）。`;
}
// ---- 貼圖：選擇器、送出貼圖訊息、匯入／匯出 YAML
const stickerPicker = document.getElementById('sticker-picker');
function renderPicker() {
  stickerPicker.replaceChildren();
  const list = loadStickers();
  if (list.length === 0) {
    const p = document.createElement('p');
    p.className = 'acct-msg';
    p.textContent = '貼圖庫是空的，請先到設定匯入 YAML。';
    stickerPicker.append(p);
    return;
  }
  for (const s of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = s.name;
    const img = document.createElement('img');
    img.src = stickerUrl(s);
    img.alt = s.name;
    btn.append(img);
    btn.addEventListener('click', () => {
      stickerPicker.hidden = true;
      pushMessage({ id: crypto.randomUUID(), ts: Date.now(), me: true, body: `[貼圖] ${s.name}`, sticker: { name: s.name, type: s.type, data: s.data } });
    });
    stickerPicker.append(btn);
  }
}
document.getElementById('btn-stickers').addEventListener('click', () => {
  stickerPicker.hidden = !stickerPicker.hidden;
  if (!stickerPicker.hidden) renderPicker();
});
document.getElementById('sticker-import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const r = await importStickerFile(f, 'merge');
  document.getElementById('sticker-msg').textContent = r.message;
});
document.getElementById('btn-sticker-export').addEventListener('click', () => {
  const blob = new Blob([exportStickerYaml()], { type: 'text/yaml;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stickers.yaml';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById('btn-clear-local').addEventListener('click', async () => {
  if (!confirm('清除這台裝置上的所有訊息？已歸檔的內容不會被刪除。')) return;
  messages.length = 0;
  await clearMessages();
  render();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = input.value.trim();
  if (!body) return;
  pushMessage({ id: crypto.randomUUID(), ts: Date.now(), me: true, body });
  input.value = '';
});

// ---- 語音訊息：MediaRecorder 錄音，Web Speech API 即時產生字幕（不支援時可手動輸入）。
const btnVoice = document.getElementById('btn-voice');
const voicePanel = document.getElementById('voice-panel');
const voiceState = document.getElementById('voice-state');
const voiceSubtitle = document.getElementById('voice-subtitle');
const btnVoiceStop = document.getElementById('btn-voice-stop');
const btnVoiceCancel = document.getElementById('btn-voice-cancel');

let recorder = null;
let recChunks = [];
let recognizer = null;
let recSubtitle = '';
let recCancelled = false;

function startRecognizer() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'zh-TW';
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (ev) => {
    let text = '';
    for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
    recSubtitle = text;
    voiceSubtitle.textContent = text;
  };
  r.onerror = () => { /* 字幕失敗不影響錄音 */ };
  try { r.start(); } catch (_) { return null; }
  return r;
}

btnVoice.addEventListener('click', async () => {
  if (recorder) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    voicePanel.hidden = false;
    voiceState.textContent = '無法使用麥克風（權限被拒絕或不支援）';
    voiceSubtitle.textContent = '';
    btnVoiceStop.hidden = true;
    return;
  }
  recChunks = [];
  recSubtitle = '';
  recCancelled = false;
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (recognizer) { try { recognizer.stop(); } catch (_) {} recognizer = null; }
    const cancelled = recCancelled;
    const blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
    recorder = null;
    voicePanel.hidden = true;
    if (cancelled) return;
    pushMessage({
      id: crypto.randomUUID(),
      ts: Date.now(),
      me: true,
      body: '🎤 語音訊息',
      subtitle: recSubtitle || '（未產生字幕）',
      attachments: [{ name: 'voice.webm', blob, category: 'voice' }],
    });
  };
  recorder.start();
  recognizer = startRecognizer();
  voicePanel.hidden = false;
  voiceState.textContent = '錄音中…';
  voiceSubtitle.textContent = recognizer ? '' : '（此瀏覽器不支援即時字幕）';
  btnVoiceStop.hidden = false;
});

btnVoiceStop.addEventListener('click', () => {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
});
btnVoiceCancel.addEventListener('click', () => {
  recCancelled = true;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else voicePanel.hidden = true;
});

const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (files.length === 0) return;
  pushMessage({
    id: crypto.randomUUID(),
    ts: Date.now(),
    me: true,
    body: files.map((f) => f.name).join('、'),
    attachments: files.map((f) => ({ name: f.name, blob: f, category: categoryOf(f) })),
  });
});

// ---- 帳號：代號 + 密碼登入（歸檔需要）；註冊需要邀請碼
const acct = document.getElementById('account');
const acctSummary = document.getElementById('acct-summary');
const acctMsg = document.getElementById('acct-msg');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const btnToggleReg = document.getElementById('btn-toggle-reg');
let currentCode = '';
let callUi = null;
let recLib = null;
function onLoggedIn() { if (callUi) callUi.connect(currentCode); }

function setAcctStatus() {
  acctSummary.textContent = isLoggedIn() ? `已登入：${currentCode}（歸檔已啟用）` : '未登入（長期歸檔需要登入）';
}

btnToggleReg.addEventListener('click', () => {
  const showReg = registerForm.hidden;
  registerForm.hidden = !showReg;
  loginForm.hidden = showReg;
  btnToggleReg.textContent = showReg ? '已有帳號？登入' : '沒有帳號？註冊';
  acctMsg.textContent = '';
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!archiveConfigured()) { acctMsg.textContent = '尚未設定歸檔網址（js/config.js）'; return; }
  const code = loginForm.code.value.trim().toLowerCase();
  const r = await login(code, loginForm.password.value);
  if (r.ok) {
    currentCode = code;
    loginForm.password.value = '';
    acctMsg.textContent = '登入成功。';
    setAcctStatus();
    flushPending();
    onLoggedIn();
  } else {
    acctMsg.textContent = (r.data && r.data.error) || `登入失敗（${r.status}）`;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!archiveConfigured()) { acctMsg.textContent = '尚未設定歸檔網址（js/config.js）'; return; }
  const f = registerForm;
  if (f.password.value !== f.password2.value) { acctMsg.textContent = '兩次輸入的密碼不一致。'; return; }
  const code = f.code.value.trim().toLowerCase();
  const r = await register(code, f.password.value, f.invite.value);
  if (!r.ok) { acctMsg.textContent = (r.data && r.data.error) || `註冊失敗（${r.status}）`; return; }
  const l = await login(code, f.password.value);
  f.password.value = ''; f.password2.value = '';
  if (l.ok) {
    currentCode = code;
    acctMsg.textContent = '註冊並登入成功。';
    setAcctStatus();
    flushPending();
    onLoggedIn();
  } else {
    acctMsg.textContent = '註冊成功，請用新帳號登入。';
  }
});

setAcctStatus();
initSettings();
const social = initSocial(() => (isLoggedIn() ? currentCode : ''));
callUi = initCallUi(() => (isLoggedIn() ? currentCode : ''), () => recLib && recLib.refresh());
recLib = initRecordingLibrary(document.getElementById('recordings-panel'));
document.getElementById('btn-call-toggle').addEventListener('click', () => {
  const p = document.getElementById('call-panel');
  p.hidden = !p.hidden;
});
// 登入狀態改變時刷新分享代號
loginForm.addEventListener('submit', () => setTimeout(() => social.refresh(), 0));
registerForm.addEventListener('submit', () => setTimeout(() => social.refresh(), 0));
requestPersistence();
messages.push(...(await loadMessages()));
render();
flushPending();
