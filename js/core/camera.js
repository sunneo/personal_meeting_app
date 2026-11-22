// 鏡頭切換的純邏輯：前後鏡頭對應、按鈕是否顯示、要求的 getUserMedia 限制。

/** 前鏡頭 user ↔ 後鏡頭 environment。 */
export function flipTarget(facing) {
  return facing === 'environment' ? 'user' : 'environment';
}

/**
 * 只有兩顆以上鏡頭時才顯示切換按鈕（電腦通常只有一顆，就隱藏）。
 * @param {{kind:string}[]} devices enumerateDevices() 的結果
 */
export function canFlipCamera(devices) {
  const cams = (Array.isArray(devices) ? devices : []).filter((d) => d && d.kind === 'videoinput');
  return cams.length >= 2;
}

/**
 * 切換用的 video 限制。用 ideal（而不是 exact），找不到時瀏覽器會退回可用的鏡頭。
 */
export function videoConstraintsFor(facing) {
  return { facingMode: { ideal: facing === 'environment' ? 'environment' : 'user' } };
}
