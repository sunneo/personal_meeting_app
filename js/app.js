// 入口：本地模式。之後的功能（傳輸、長期儲存）依 docs/HANDOFF.md 的 todo 逐步加入。
import { requestPersistence, saveMessage, loadMessages } from './store.js';

const conv = document.getElementById('conversation');
const form = document.getElementById('composer');
const input = document.getElementById('text-input');

/** @type {{id:string, ts:number, me:boolean, body:string}[]} */
const messages = [];

/** 新增一則訊息：先放進記憶體顯示，再寫入 IndexedDB。 */
function pushMessage(msg) {
  messages.push(msg);
  saveMessage(msg);
  render();
}

/** 依副檔名／MIME 分類：audio（聲音/音樂）、pdf、other（文件）。 */
function categoryOf(file) {
  const t = file.type || '';
  if (t.startsWith('audio/')) return 'audio';
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
    const text = document.createElement('span');
    text.textContent = m.body;
    const speak = document.createElement('button');
    speak.type = 'button';
    speak.className = 'speak';
    speak.title = '朗讀';
    speak.textContent = '🔊';
    speak.addEventListener('click', () => speakText(m.body));
    b.append(text, speak);
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
}

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

requestPersistence();
messages.push(...(await loadMessages()));
render();
