// 通話錄製（音訊或影像）：混合本地與遠端音軌（WebAudio），影像用 canvas 合成。
// 錄製結果不進對話；由呼叫端存進「錄音錄影庫」（js/recordings.js）。
// 開始／停止時會透過 call.setRecordingLocal() 通知對方（隱私）。
import { pickMimeType, recordingFileName } from './core/recording.js';

const FPS = 30;

/**
 * 建立錄製器。
 * @param {{ getLocal:()=>MediaStream|null, getRemote:()=>MediaStream|null, onStateChange?:(on:boolean)=>void }} opts
 */
export function createRecorder(opts) {
  const { getLocal, getRemote, onStateChange = () => {} } = opts;
  let rec = null;
  let chunks = [];
  let audioCtx = null;
  let canvasTimer = null;
  let kind = null;
  let mime = null;
  let stoppers = [];

  function mixAudio(streams) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    for (const s of streams) {
      if (s && s.getAudioTracks().length) {
        audioCtx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
      }
    }
    return dest.stream;
  }

  /** 影像：遠端大畫面（沒有就用本地），本地小畫面疊在右下角。 */
  function composeVideo() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const g = canvas.getContext('2d');
    const mkVideo = (stream) => {
      if (!stream || !stream.getVideoTracks().length) return null;
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      v.play().catch(() => {});
      return v;
    };
    const big = mkVideo(getRemote()) || mkVideo(getLocal());
    const small = mkVideo(getLocal());
    canvasTimer = setInterval(() => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, canvas.width, canvas.height);
      if (big && big.readyState >= 2) g.drawImage(big, 0, 0, canvas.width, canvas.height);
      if (small && small.readyState >= 2 && big !== small) g.drawImage(small, canvas.width - 320, canvas.height - 180, 320, 180);
      g.fillStyle = '#d00';
      g.beginPath(); g.arc(30, 30, 10, 0, Math.PI * 2); g.fill();
    }, 1000 / FPS);
    stoppers.push(() => { [big, small].forEach((v) => { if (v) v.srcObject = null; }); });
    return canvas.captureStream(FPS).getVideoTracks()[0];
  }

  /**
   * 開始錄製。kind = 'audio' 或 'video'。
   * 回傳 {ok, error?}；不支援的瀏覽器會回傳錯誤訊息。
   */
  function start(k) {
    if (rec) return { ok: false, error: '已經在錄製中' };
    kind = k;
    const local = getLocal();
    const remote = getRemote();
    if (!local) return { ok: false, error: '通話尚未建立' };
    mime = pickMimeType(kind, (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
    if (!mime) return { ok: false, error: '此瀏覽器不支援錄製這種格式' };
    try {
      const audio = mixAudio([local, remote]);
      const tracks = [...audio.getAudioTracks()];
      if (kind === 'video') tracks.unshift(composeVideo());
      const stream = new MediaStream(tracks);
      chunks = [];
      rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start(1000);
      onStateChange(true);
      return { ok: true };
    } catch (e) {
      cleanup();
      return { ok: false, error: '無法開始錄製：' + (e && e.message ? e.message : e) };
    }
  }

  function cleanup() {
    clearInterval(canvasTimer);
    canvasTimer = null;
    stoppers.forEach((f) => { try { f(); } catch (_) {} });
    stoppers = [];
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    rec = null;
  }

  /** 停止並回傳 {blob, kind, mime, name, createdAt}（可直接存入錄音錄影庫）。 */
  function stop() {
    return new Promise((resolve) => {
      if (!rec) return resolve(null);
      const startedAt = Date.now();
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mime });
        const out = { blob, kind, mime, name: recordingFileName(kind, mime, new Date(startedAt)), createdAt: startedAt };
        cleanup();
        onStateChange(false);
        resolve(out);
      };
      try { rec.stop(); } catch (_) { cleanup(); onStateChange(false); resolve(null); }
    });
  }

  return { start, stop, isRecording: () => Boolean(rec) };
}
