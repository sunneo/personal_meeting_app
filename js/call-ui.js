// 視訊通話的畫面接線：撥號、來電接聽、鏡頭切換、麥克風／鏡頭開關、錄製（音訊或影像）、對方錄製提示。
// 錄製結果進「錄音錄影庫」，不進對話。
import { createSignaler } from './realtime.js';
import { createCall } from './call.js';
import { createRecorder } from './recorder.js';
import { saveRecording } from './recordings.js';
import { getToken } from './archive-client.js';

/**
 * 初始化通話畫面。getSelf() 回傳目前登入的代號（沒登入回傳 ''）。
 * 回傳 {connect(code), disconnect(), refresh()}。
 */
export function initCallUi(getSelf, onLibraryChanged = () => {}) {
  const panel = document.getElementById('call-panel');
  if (!panel) return null;
  const $ = (id) => document.getElementById(id);
  const statusEl = $('call-status');
  const remoteV = $('remote-video');
  const localV = $('local-video');
  const peerInput = $('call-peer');
  const btnAccept = $('btn-accept');
  const btnDecline = $('btn-decline');
  const btnFlip = $('btn-flip');
  const recInd = $('rec-indicator');
  const peerRec = $('peer-rec');

  let signaler = null;
  let call = null;
  let incomingFrom = '';
  let recorder = null;

  const say = (t) => { statusEl.textContent = t; };

  function setButtons() {
    const s = call ? call.state() : 'idle';
    btnAccept.hidden = s !== 'ringing' && s !== 'incoming';
    btnDecline.hidden = btnAccept.hidden;
    const inCall = s === 'calling' || s === 'connected' || s === 'ringing' || s === 'incoming';
    $('btn-hangup').hidden = !inCall;
    $('btn-call').hidden = inCall;
    $('rec-start-audio').hidden = !(s === 'connected');
    $('rec-start-video').hidden = !(s === 'connected');
  }

  const ui = {
    onState: (s) => {
      const label = { calling: '撥號中…', ringing: '來電', incoming: '來電', connected: '通話中', ended: '通話已結束', idle: '' }[s] ?? s;
      say(label);
      setButtons();
    },
    onLocal: (stream) => { localV.srcObject = stream || null; },
    onRemote: (stream) => { remoteV.srcObject = stream || null; },
    onIncoming: ({ from }) => { incomingFrom = from; say(`來電：${from}`); setButtons(); },
    onRecordingPeer: (on) => { peerRec.hidden = !on; },
    onCanFlip: (on) => { btnFlip.hidden = !on; },
    onError: (m) => say(m),
  };

  function ensureCall() {
    if (!call) {
      call = createCall({ self: getSelf(), signaler: { send: (s) => (signaler ? signaler.send(s) : Promise.resolve(false)) }, getToken, ui });
      recorder = createRecorder({ getLocal: () => call.getLocal(), getRemote: () => call.getRemote(), onStateChange: (on) => {
        recInd.hidden = !on;
      } });
    }
    return call;
  }

  async function connect(code) {
    ensureCall();
    if (signaler) signaler.stop();
    signaler = createSignaler({
      self: code,
      getToken,
      onSignal: (sig) => call && call.handleSignal(sig),
      onStatus: (m) => { if (!call || call.state() === 'idle') say(m.startsWith('realtime') ? '信令：Supabase Realtime' : m === 'worker' ? '信令：Cloudflare 備援' : '信令離線（需要登入）'); },
    });
    await signaler.start();
  }

  function disconnect() {
    if (call) call.hangup(false);
    if (signaler) signaler.stop();
    signaler = null;
  }

  $('btn-call').addEventListener('click', () => {
    const c = ensureCall();
    c.start(peerInput.value.trim().toLowerCase(), true);
  });
  btnAccept.addEventListener('click', () => { ensureCall().accept(true); btnAccept.hidden = true; btnDecline.hidden = true; });
  btnDecline.addEventListener('click', () => { ensureCall().decline(); btnDecline.hidden = true; btnAccept.hidden = true; });
  $('btn-hangup').addEventListener('click', () => ensureCall().hangup(true));
  btnFlip.addEventListener('click', () => ensureCall().flip());
  $('btn-mic').addEventListener('click', (e) => { const on = ensureCall().toggleMic(); e.target.textContent = on ? '🎤' : '🔇'; });
  $('btn-cam').addEventListener('click', (e) => { const on = ensureCall().toggleCam(); e.target.textContent = on ? '📷' : '🚫'; });

  async function startRec(kind) {
    const c = ensureCall();
    if (recorder.isRecording()) return;
    const r = recorder.start(kind);
    if (!r.ok) { say(r.error); return; }
    c.setRecordingLocal(true);
    say(kind === 'video' ? '正在錄影（對方會收到通知）' : '正在錄音（對方會收到通知）');
  }
  $('rec-start-audio').addEventListener('click', () => startRec('audio'));
  $('rec-start-video').addEventListener('click', () => startRec('video'));
  $('rec-stop').addEventListener('click', async () => {
    const out = await recorder.stop();
    if (call) call.setRecordingLocal(false);
    if (out) {
      await saveRecording({ kind: out.kind, mime: out.mime, blob: out.blob, name: out.name, createdAt: out.createdAt });
      say('錄製已存入錄音錄影庫（不在對話中）。');
      onLibraryChanged();
    }
  });

  setButtons();
  return { connect, disconnect, refresh: setButtons, incoming: () => incomingFrom };
}
