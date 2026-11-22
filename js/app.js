// 入口：本地模式的骨架。之後的功能（朗讀、檔案、語音、儲存）依 docs/HANDOFF.md 的 todo 逐步加入。

const conv = document.getElementById('conversation');
const form = document.getElementById('composer');
const input = document.getElementById('text-input');

/** @type {{id:string, ts:number, me:boolean, body:string}[]} */
const messages = [];

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
    b.textContent = m.body;
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
