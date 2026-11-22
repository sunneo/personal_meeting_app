// 1 對 1 視訊通話：RTCPeerConnection + 信令（js/realtime.js）+ 鏡頭切換（replaceTrack，不重新協商）。
// 狀態機與信令格式見 core/call-state.js；TURN 憑證由 worker 發短效（見 cloudflare/archive-worker/rtc.js）。
import { ARCHIVE_WORKER_URL } from './config.js';
import { parseSignal, makeSignal, nextCallState, recordingNotice } from './core/call-state.js';
import { flipTarget, canFlipCamera, videoConstraintsFor } from './core/camera.js';

const FALLBACK_ICE = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

/** 向 worker 取得 ICE 設定（含 TURN 短效憑證）；失敗就只用 STUN，並回報 turn:false。 */
export async function fetchIceConfig(getToken) {
  const token = getToken();
  if (!token || !ARCHIVE_WORKER_URL) return { iceServers: FALLBACK_ICE, turn: false };
  try {
    const res = await fetch(ARCHIVE_WORKER_URL + '/turn-config', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { iceServers: FALLBACK_ICE, turn: false };
    const data = await res.json();
    return { iceServers: data.iceServers || FALLBACK_ICE, turn: Boolean(data.turn) };
  } catch (_) {
    return { iceServers: FALLBACK_ICE, turn: false };
  }
}

/**
 * 建立通話控制器。
 * @param {{self:string, signaler:{send:(s:object)=>Promise<boolean>}, getToken:()=>string|null, ui:{
 *   onState?:(s:string)=>void, onLocal?:(stream:MediaStream|null)=>void, onRemote?:(stream:MediaStream|null)=>void,
 *   onIncoming?:(info:{from:string, callId:string})=>void, onRecordingPeer?:(on:boolean)=>void,
 *   onCanFlip?:(on:boolean)=>void, onError?:(msg:string)=>void }}} opts
 */
export function createCall(opts) {
  const { self, signaler, getToken, ui = {} } = opts;
  let state = 'idle';
  let callId = null;
  let peer = null;
  let pc = null;
  let local = null;        // MediaStream
  let remote = null;
  let facing = 'user';
  let pendingOffer = null;
  let pendingIce = [];
  let remoteSet = false;
  let micOn = true;
  let camOn = true;
  let recordingLocal = false;

  const setState = (ev) => {
    const next = nextCallState(state, ev);
    if (next !== state) { state = next; ui.onState && ui.onState(state); }
  };
  const err = (m) => ui.onError && ui.onError(m);

  function newCallId() {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return 'call_' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  async function getMedia(video = true) {
    const constraints = { audio: true, video: video ? videoConstraintsFor(facing) : false };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  async function refreshCanFlip() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      ui.onCanFlip && ui.onCanFlip(canFlipCamera(devs));
    } catch (_) {
      ui.onCanFlip && ui.onCanFlip(false);
    }
  }

  async function buildPeer() {
    const cfg = await fetchIceConfig(getToken);
    const c = new RTCPeerConnection({ iceServers: cfg.iceServers });
    c.onicecandidate = (e) => {
      if (e.candidate && callId) {
        signaler.send(makeSignal(callId, self, peer, 'ice', { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex }));
      }
    };
    remote = new MediaStream();
    c.ontrack = (e) => {
      if (e.streams[0]) remote = e.streams[0];
      else remote.addTrack(e.track);
      ui.onRemote && ui.onRemote(remote);
    };
    c.onconnectionstatechange = () => {
      if (c.connectionState === 'connected') setState('connected');
      if (c.connectionState === 'failed') { err('連線失敗（可能是網路限制；未設定 TURN 時無法穿透部分網路）'); hangup(false); }
    };
    return c;
  }

  async function attachLocal(video) {
    local = await getMedia(video);
    ui.onLocal && ui.onLocal(local);
    local.getTracks().forEach((t) => pc.addTrack(t, local));
    refreshCanFlip();
  }

  async function flushIce() {
    for (const c of pendingIce) { try { await pc.addIceCandidate(c); } catch (_) { /* 忽略 */ } }
    pendingIce = [];
  }

  /** 我打給對方。 */
  async function start(to, video = true) {
    if (state !== 'idle' && state !== 'ended') return err('目前正在通話中');
    if (!to) return err('請輸入對方代號');
    callId = newCallId();
    peer = to;
    setState('start-call');
    try {
      pc = await buildPeer();
      await attachLocal(video);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const ok = await signaler.send(makeSignal(callId, self, peer, 'offer', { sdp: pc.localDescription.sdp }));
      if (!ok) { err('無法送出通話請求（信令離線）'); hangup(false); }
    } catch (e) {
      err('無法開始通話：' + (e && e.message ? e.message : e));
      hangup(false);
    }
  }

  /** 接聽來電。 */
  async function accept(video = true) {
    if (!pendingOffer) return;
    const { from, id, sdp } = pendingOffer;
    pendingOffer = null;
    callId = id;
    peer = from;
    try {
      pc = await buildPeer();
      await attachLocal(video);
      await pc.setRemoteDescription({ type: 'offer', sdp });
      remoteSet = true;
      await flushIce();
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await signaler.send(makeSignal(callId, self, peer, 'answer', { sdp: pc.localDescription.sdp }));
      setState('accept');
    } catch (e) {
      err('無法接聽：' + (e && e.message ? e.message : e));
      hangup(false);
    }
  }

  function decline() {
    if (!pendingOffer) return;
    const { from, id } = pendingOffer;
    pendingOffer = null;
    signaler.send(makeSignal(id, self, from, 'hangup', {}));
    setState('hangup');
  }

  /** 處理收到的信令（由 realtime.js 呼叫）。 */
  async function handleSignal(raw) {
    let sig;
    try { sig = parseSignal(raw); } catch (_) { return; }
    if (sig.to !== self) return;
    switch (sig.type) {
      case 'offer':
        if (state === 'idle' || state === 'ended') {
          pendingOffer = { from: sig.from, id: sig.callId, sdp: sig.payload.sdp };
          setState('incoming');
          ui.onIncoming && ui.onIncoming({ from: sig.from, callId: sig.callId });
        }
        return;
      case 'answer':
        if (sig.callId === callId && pc && !remoteSet) {
          try {
            await pc.setRemoteDescription({ type: 'answer', sdp: sig.payload.sdp });
            remoteSet = true;
            await flushIce();
          } catch (e) { err('對方回應無法套用：' + e.message); }
        }
        return;
      case 'ice':
        if (sig.callId !== callId) return;
        if (!pc || !remoteSet) { pendingIce.push({ candidate: sig.payload.candidate, sdpMid: sig.payload.sdpMid, sdpMLineIndex: sig.payload.sdpMLineIndex }); return; }
        try { await pc.addIceCandidate({ candidate: sig.payload.candidate, sdpMid: sig.payload.sdpMid, sdpMLineIndex: sig.payload.sdpMLineIndex }); } catch (_) { /* 忽略 */ }
        return;
      case 'hangup':
        if (sig.callId === callId || (pendingOffer && pendingOffer.id === sig.callId)) hangup(false);
        return;
      case 'record-state':
        if (sig.callId === callId) ui.onRecordingPeer && ui.onRecordingPeer(Boolean(sig.payload.recording));
        return;
    }
  }

  /**
   * 切換前後鏡頭：換掉 video sender 的軌（replaceTrack），不重新協商。
   */
  async function flip() {
    if (!pc || !local) return;
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (!sender) return err('目前沒有影像');
    const target = flipTarget(facing);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraintsFor(target) });
      const newTrack = s.getVideoTracks()[0];
      if (!newTrack) throw new Error('沒有取得鏡頭');
      const oldTrack = sender.track;
      await sender.replaceTrack(newTrack);
      local.removeTrack(oldTrack);
      local.addTrack(newTrack);
      oldTrack.stop();
      facing = target;
      ui.onLocal && ui.onLocal(local);
    } catch (e) {
      err('無法切換鏡頭：' + (e && e.message ? e.message : e));
    }
  }

  function toggleMic() {
    micOn = !micOn;
    if (local) local.getAudioTracks().forEach((t) => { t.enabled = micOn; });
    return micOn;
  }

  function toggleCam() {
    camOn = !camOn;
    if (local) local.getVideoTracks().forEach((t) => { t.enabled = camOn; });
    return camOn;
  }

  /** 通知對方錄製狀態（隱私：對方會看到提示）。 */
  function setRecordingLocal(on) {
    recordingLocal = Boolean(on);
    if (callId && peer) signaler.send(recordingNotice(callId, self, peer, recordingLocal));
    return recordingLocal;
  }

  function hangup(notify = true) {
    if (notify && callId && peer) signaler.send(makeSignal(callId, self, peer, 'hangup', {}));
    if (pc) { try { pc.close(); } catch (_) {} }
    if (local) local.getTracks().forEach((t) => t.stop());
    pc = null;
    local = null;
    remote = null;
    remoteSet = false;
    pendingIce = [];
    pendingOffer = null;
    if (recordingLocal) { recordingLocal = false; }
    ui.onLocal && ui.onLocal(null);
    ui.onRemote && ui.onRemote(null);
    setState('hangup');
    setState('reset');
    callId = null;
    peer = null;
  }

  return {
    start, accept, decline, handleSignal, flip, toggleMic, toggleCam, hangup, setRecordingLocal,
    getLocal: () => local,
    getRemote: () => remote,
    state: () => state,
    facing: () => facing,
  };
}
