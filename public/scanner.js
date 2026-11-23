// Quét mã vạch bằng camera điện thoại (EAN/UPC/Code128/QR). Dùng thư viện html5-qrcode (tải khi cần),
// tự dùng BarcodeDetector của trình duyệt nếu có. Có ô gõ tay / máy quét cầm tay (gõ mã + Enter).
// scanBarcode({ title, continuous, onCode(code) → chuỗi thông báo | Promise }) → đóng bằng hàm trả về.
(function () {
  let libP = null;
  const loadLib = () => libP || (libP = new Promise((ok, fail) => {
    if (window.Html5Qrcode) return ok();
    const s = document.createElement('script');
    s.src = '/vendor/html5-qrcode.min.js'; s.onload = () => ok(); s.onerror = () => { libP = null; fail(new Error('Không tải được bộ quét')); };
    document.head.appendChild(s);
  }));
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const beep = () => {
    try { navigator.vibrate && navigator.vibrate(80); } catch { /* bỏ qua */ }
    try {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
      const a = beep.ctx || (beep.ctx = new A()); const o = a.createOscillator(); const g = a.createGain();
      o.frequency.value = 1200; g.gain.value = 0.08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.09);
    } catch { /* bỏ qua */ }
  };

  window.scanBarcode = function ({ title = 'Quét mã vạch', continuous = false, onCode, hint = '' } = {}) {
    const ov = document.createElement('div');
    ov.className = 'scan-ov';
    ov.innerHTML = `<div class="scan-box"><div class="scan-head"><b>📷 ${esc(title)}</b><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div id="scanReader" class="scan-reader"></div>
      <div class="scan-msg small" data-msg>${esc(hint || 'Đưa mã vạch vào giữa khung, giữ yên 1–2 giây.')}</div>
      <form class="row" data-f style="gap:6px;margin-top:6px"><input data-in inputmode="numeric" autocomplete="off" placeholder="Hoặc gõ mã / dùng máy quét" style="flex:1;min-width:0"><button class="btn sm">OK</button></form>
      ${continuous ? '<div class="modal-foot"><button type="button" class="btn primary" data-x>Xong</button></div>' : ''}</div>`;
    document.body.appendChild(ov);
    const msg = ov.querySelector('[data-msg]');
    let qr = null, closed = false, last = '', lastAt = 0, busy = false;
    const stop = async () => { if (qr) { try { await qr.stop(); } catch { /* đã dừng */ } try { qr.clear(); } catch { /* bỏ qua */ } qr = null; } };
    const close = async () => { if (closed) return; closed = true; await stop(); ov.remove(); };
    const got = async (raw) => {
      const code = String(raw || '').trim().replace(/\s+/g, '');
      if (!code || busy) return;
      const now = Date.now();
      if (code === last && now - lastAt < 1800) return; // cùng 1 mã đang nằm trong khung → không đếm 2 lần
      last = code; lastAt = now; beep();
      if (!continuous) { await close(); onCode && onCode(code); return; }
      busy = true;
      try { const r = onCode ? await onCode(code) : ''; msg.innerHTML = r ? r : 'Đã quét ' + esc(code); } catch (e) { msg.textContent = e.message; } finally { busy = false; }
    };
    ov.querySelectorAll('[data-x]').forEach((b) => (b.onclick = close));
    ov.querySelector('[data-f]').onsubmit = (e) => { e.preventDefault(); const i = ov.querySelector('[data-in]'); const v = i.value; i.value = ''; last = ''; got(v); };
    (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices) throw new Error('Trình duyệt chưa cho dùng camera (cần mở bằng https)');
        await loadLib();
        if (closed) return;
        const F = window.Html5QrcodeSupportedFormats;
        qr = new window.Html5Qrcode('scanReader', { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE] });
        await qr.start({ facingMode: 'environment' }, { fps: 12, qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.9, 340)), height: Math.floor(Math.min(h * 0.6, 170)) }) }, got, () => {});
        if (closed) stop();
      } catch (e) {
        msg.innerHTML = '⚠ ' + esc(e && e.message ? e.message : 'Không mở được camera') + '. Cho phép camera trong cài đặt trình duyệt, hoặc gõ mã bên dưới.';
      }
    })();
    return close;
  };
})();
