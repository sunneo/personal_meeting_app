// 入口：本地模式的骨架。之後的功能（朗讀、檔案、語音、儲存）依 docs/HANDOFF.md 的 todo 逐步加入。

const conv = document.getElementById('conversation');
const form = document.getElementById('composer');
const input = document.getElementById('text-input');

/** @type {{id:string, ts:number, me:boolean, body:string}[]} */
const messages = [];

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
    conv.append(b);
  }
  conv.scrollTop = conv.scrollHeight;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = input.value.trim();
  if (!body) return;
  messages.push({ id: crypto.randomUUID(), ts: Date.now(), me: true, body });
  input.value = '';
  render();
});

render();
