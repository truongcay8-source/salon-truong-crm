'use strict';
/* CRM Salon Nếp — giao diện một trang, không cần build. */

const S = { me: null, settings: null, groups: [], today: null, staff: [], services: [], cardTypes: [], materials: [], recipes: [], page: 'dashboard', params: {} };
const ROLE = { owner: 'Lãnh đạo', manager: 'Quản lý', staff: 'Nhân viên' };
const APPT = { booked: ['Đã đặt', 'brand'], arrived: ['Đã đến', 'warn'], done: ['Hoàn thành', 'ok'], cancelled: ['Đã hủy', ''], noshow: ['Không đến', 'bad'] };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v == null ? '—' : Number(v).toLocaleString('vi-VN') + 'đ');
const pct = (v) => (Math.round(Number(v || 0) * 1000) / 10) + '%';
const dmy = (d) => (d ? d.split('-').reverse().join('/') : '');
const isMgr = () => S.me && S.me.role !== 'staff';
const isOwner = () => S.me && S.me.role === 'owner';
function addDays(d, n) { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); const z = new Date(x.getTime() - x.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function staffName(id) { const s = S.staff.find((x) => x.id === id); return s ? s.full_name : ''; }
function activeStaff() { return S.staff.filter((s) => s.active && s.works !== 0); }
const hdrName = (id) => { const u = S.staff.find((x) => String(x.id) === String(id)); return u ? u.full_name : ''; };
function staffOptions(sel, withEmpty = '— Chọn —') {
  return (withEmpty ? `<option value="">${withEmpty}</option>` : '') + activeStaff().map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.full_name)}${s.level ? ' · ' + s.level : ''}</option>`).join('');
}
const LEVELS = ['Director', 'Senior', 'Stylist', 'Junior'];
// Dịch vụ cắt có cấp (vd "Cắt tóc nữ – Senior") → đổi sang đúng cấp của thợ chính, kèm giá
function levelSwap(it, staffId) {
  const st = S.staff.find((x) => x.id === Number(staffId));
  if (!st || !st.level || !it.service_id) return false;
  const sv = S.services.find((x) => x.id === Number(it.service_id));
  const m = sv && sv.name.match(/^(.*) – (Director|Senior|Stylist|Junior)$/);
  if (!m || m[2] === st.level) return false;
  const alt = S.services.find((x) => x.active && x.name === `${m[1]} – ${st.level}`);
  if (!alt) return false;
  it.service_id = alt.id; it.price = alt.price; return true;
}
const WARRANTY_EXCLUDE = 'Không bảo hành khi tóc đã chỉnh sửa ở nơi khác, không chăm sóc đúng hướng dẫn, hoặc do tác động bên ngoài.';
function warrantyLines(ws) { return (ws || []).map((w) => `🛡 ${w.label}: đến ${dmy(w.until)}. ${w.note}`); }
function telLinks(phone) {
  if (!phone) return '<span class="muted small">Chưa có SĐT</span>';
  return `<a href="tel:${esc(phone)}">${esc(phone)}</a> · <a href="https://zalo.me/${esc(phone)}" target="_blank" rel="noopener">Zalo</a>`;
}

async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body !== undefined) { o.body = JSON.stringify(opts.body); o.headers['Content-Type'] = 'application/json'; }
  const res = await fetch('/api' + path, o);
  if (opts.raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* không phải JSON */ }
  if (res.status === 401 && path !== '/login') { const was = S.me; S.me = null; renderLogin(); const e = new Error(was ? 'Phiên đăng nhập hết hạn' : 'Chưa đăng nhập'); e.status = 401; throw e; }
  // Tab khác vừa đăng nhập tài khoản khác (trình duyệt chỉ giữ 1 đăng nhập) → tải lại theo tài khoản đang đăng nhập
  if (res.status === 403 && S.me && path !== '/me') { const m = await fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null); if (m && m.user && m.user.id !== S.me.id) { toast('Trình duyệt đang đăng nhập ' + m.user.full_name + ' (từ tab khác) – tải lại'); setTimeout(() => location.reload(), 1200); } }
  if (!res.ok) { const e = new Error((data && data.error) || 'Lỗi ' + res.status); e.status = res.status; e.data = data; throw e; }
  return data;
}
// Quay lại tab: kiểm tra còn đúng tài khoản không
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || !S.me) return;
  fetch('/api/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((m) => { if (m && m.user && S.me && m.user.id !== S.me.id) location.reload(); }).catch(() => {}); });
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2800);
}
function openModal(title, html, wide) {
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
  $('.modal-card').classList.toggle('wide', !!wide);
  $('#modal').classList.remove('hidden');
  const f = $('#modalBody input, #modalBody select, #modalBody textarea'); if (f && window.innerWidth > 820) f.focus();
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }
$('#modalClose').onclick = closeModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
function formData(root) {
  const o = {};
  for (const el of $$('[name]', root)) o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  return o;
}
async function guard(btn, fn) {
  const err = btn.closest('.modal-card, .card, .login')?.querySelector('.err');
  if (err) err.textContent = '';
  btn.disabled = true;
  try { await fn(); } catch (e) { if (err) err.textContent = e.message; else toast(e.message); } finally { btn.disabled = false; }
}

// ---------- Đăng nhập ----------
function renderLogin() {
  $('#root').innerHTML = `<div class="center"><form class="login" id="loginForm">
    <div class="logo">N</div><h1>Salon Nếp</h1><p>Đăng nhập để vào CRM</p>
    <label>Tên đăng nhập</label><input name="username" autocomplete="username" autocapitalize="none" required>
    <label>Mật khẩu</label><input name="password" type="password" autocomplete="current-password" required>
    <button class="btn primary block" style="margin-top:16px">Đăng nhập</button><div class="err"></div></form></div>`;
  $('#loginForm').onsubmit = (e) => {
    e.preventDefault();
    guard($('#loginForm button'), async () => { await api('/login', { method: 'POST', body: formData($('#loginForm')) }); await boot(); });
  };
}
function renderChangePw(forced) {
  const html = `<form id="pwForm">${forced ? '<p>Lần đầu đăng nhập: hãy đổi mật khẩu riêng của bạn (tối thiểu 6 ký tự).</p>' : ''}
    <label>Mật khẩu hiện tại</label><input name="old_password" type="password" autocomplete="current-password" required>
    <label>Mật khẩu mới</label><input name="new_password" type="password" autocomplete="new-password" minlength="6" required>
    <label>Nhập lại mật khẩu mới</label><input name="again" type="password" autocomplete="new-password" required>
    <button class="btn primary block" style="margin-top:16px">Đổi mật khẩu</button><div class="err"></div></form>`;
  if (forced) { $('#root').innerHTML = `<div class="center"><div class="login"><div class="logo">N</div><h1>Đổi mật khẩu</h1>${html}</div></div>`; }
  else openModal('Đổi mật khẩu', html);
  $('#pwForm').onsubmit = (e) => {
    e.preventDefault();
    guard($('#pwForm button'), async () => {
      const d = formData($('#pwForm'));
      if (d.new_password !== d.again) throw new Error('Hai lần nhập mật khẩu mới không khớp');
      await api('/me/password', { method: 'POST', body: d });
      toast('Đã đổi mật khẩu'); closeModal(); if (forced) boot();
    });
  };
}
async function logout() { await api('/logout', { method: 'POST' }).catch(() => {}); S.me = null; renderLogin(); }

// ---------- Khung ứng dụng ----------
// Menu chia nhóm (Vinh 26/11: báo cáo ra báo cáo, kho ra kho, nhân viên ra nhân viên, khách ra khách)
const PAGES = [
  ['dashboard', 'Tổng quan', '🏠', () => true, 'Hằng ngày'],
  ['appointments', 'Lịch hẹn', '📅', () => true, 'Hằng ngày'],
  ['pos', 'Thu ngân', '🧾', () => true, 'Hằng ngày'],
  ['chat', 'Chat nội bộ', '💬', () => true, 'Hằng ngày'],
  ['reminders', 'Nhắc nhở', '🔔', () => true, 'Hằng ngày'],
  ['visits', 'Hóa đơn bán hàng', '📄', () => true, 'Báo cáo'],
  ['sales', 'Doanh số', '📊', () => true, 'Báo cáo'],
  ['finance', 'Báo cáo tài chính', '📈', () => isOwner(), 'Báo cáo'],
  ['customers', 'Khách hàng', '👤', () => true, 'Khách hàng'],
  ['cards', 'Thẻ trả trước', '💳', () => true, 'Khách hàng'],
  ['attendance', 'Chấm công', '🕘', () => true, 'Nhân viên'],
  ['offs', 'Lịch off', '🌴', () => true, 'Nhân viên'],
  ['tips', 'Chia tip', '💵', () => true, 'Nhân viên'],
  ['payroll', 'Bảng lương', '💰', () => isOwner(), 'Nhân viên'],
  ['stock', 'Kho hàng', '🧪', () => isMgr() || S.me.stock_view, 'Kho & chi tiêu'],
  ['expenses', 'Chi & quỹ tiền mặt', '💸', () => true, 'Kho & chi tiêu'],
  ['excel', 'Nhập / Xuất Excel', '📥', isMgr, 'Hệ thống'],
  ['settings', 'Cài đặt', '⚙️', () => true, 'Hệ thống'],
];
const NAV_GROUPS = ['Hằng ngày', 'Báo cáo', 'Khách hàng', 'Nhân viên', 'Kho & chi tiêu', 'Hệ thống'];
const navOpen = () => { try { return JSON.parse(localStorage.getItem('navOpen') || 'null') || ['Hằng ngày']; } catch { return ['Hằng ngày']; } };
function navHtml(pages, attr = 'data-page') {
  const open = navOpen();
  return NAV_GROUPS.map((g) => { const ps = pages.filter((p) => p[4] === g); if (!ps.length) return '';
    return `<div class="nav-grp ${open.includes(g) ? 'open' : ''}" data-grp="${g}"><button class="nav-grp-h" data-grph="${g}">${g}<span class="chev">▾</span></button><div class="nav-grp-b">
      ${ps.map((p) => `<button class="nav-btn" ${attr}="${p[0]}"><span>${p[2]}</span>${p[1]}${p[0] === 'reminders' ? '<span class="badge count hidden" data-rc></span>' : ''}${p[0] === 'chat' ? '<span class="badge count hidden" data-cc></span>' : ''}</button>`).join('')}</div></div>`; }).join('');
}
function navToggle(root) {
  $$('[data-grph]', root).forEach((h) => (h.onclick = () => { const box = h.parentElement; box.classList.toggle('open');
    try { localStorage.setItem('navOpen', JSON.stringify($$('.nav-grp.open', root).map((x) => x.dataset.grp))); } catch { /* bỏ qua */ } }));
}
const MOBILE = ['dashboard', 'appointments', 'pos', 'chat', 'customers', 'more'];
let reminderCount = 0;

async function boot() {
  try {
    const me = await api('/me');
    S.me = me.user; S.settings = me.settings; S.groups = me.groups; S.today = me.today;
    if (S.me.must_change_pw) return renderChangePw(true);
    [S.staff, S.services, S.cardTypes, S.materials, S.recipes] = await Promise.all([api('/staff'), api('/services'), api('/card-types'), api('/materials'), api('/recipes')]);
    shell();
    route();
  } catch (e) { if (e.status !== 401) console.error(e); if (!S.me) renderLogin(); }
}
function shell() {
  const pages = PAGES.filter((p) => p[3]());
  $('#root').innerHTML = `<div class="app">
    <aside class="side"><div class="brand"><div class="logo">N</div><div><b>${esc(S.settings.salon_name)}</b><div class="small muted">CRM</div></div></div>
      <button class="search-btn" data-search>🔍 Tìm kiếm… <kbd>/</kbd></button>
      <div class="nav-groups">${navHtml(pages)}</div>
      <div class="me"><b>${esc(S.me.full_name)}</b> · ${ROLE[S.me.role]}<div class="row" style="margin-top:8px"><button class="btn sm" id="pwBtn">Đổi mật khẩu</button><button class="btn sm" id="outBtn">Đăng xuất</button></div></div>
    </aside>
    <main class="main" id="main"></main>
    <nav class="bottom-nav">${MOBILE.map((k) => {
      if (k === 'more') return '<button data-page="more"><span class="ico">☰</span>Thêm</button>';
      const p = PAGES.find((x) => x[0] === k);
      const short = { customers: 'Khách', appointments: 'Lịch hẹn', chat: 'Chat' }[k] || p[1];
      return `<button data-page="${k}"><span class="ico">${p[2]}</span>${short}${k === 'reminders' ? '<span class="badge count hidden" data-rc></span>' : ''}${k === 'chat' ? '<span class="badge count hidden" data-cc></span>' : ''}</button>`;
    }).join('')}</nav><button class="search-fab" data-search aria-label="Tìm kiếm">🔍</button></div>`;
  $$('[data-page]').forEach((b) => (b.onclick = () => go(b.dataset.page)));
  navToggle($('.side'));
  $$('[data-search]').forEach((b) => (b.onclick = searchBox));
  $('#pwBtn').onclick = () => renderChangePw(false);
  $('#outBtn').onclick = logout;
  refreshReminderBadge();
  startChatPoll();
}
// ---------- Chat nội bộ ----------
let chatTimer = null;
async function refreshChatBadge() {
  try { const r = await api('/chat/unread'); $$('[data-cc]').forEach((b) => { b.textContent = r.mentions ? '@' + r.mentions : r.unread; b.classList.toggle('hidden', !r.unread || S.page === 'chat'); }); } catch { /* bỏ qua */ }
}
// Thông báo đẩy: đăng ký service worker + quyền thông báo cho máy này
const b64u = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
async function pushSetup() {
  const ios = /iphone|ipad/i.test(navigator.userAgent), standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    openModal('🔔 Thông báo', ios && !standalone ? `<div>iPhone cần cài app ra màn hình chính trước:</div><ol><li>Mở trang này bằng <b>Safari</b></li><li>Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên) → <b>Thêm vào MH chính</b></li><li>Mở app từ biểu tượng <b>Salon Nếp</b> vừa tạo → vào Chat → bấm 🔔 lại</li></ol><div class="small muted">Cần iOS 16.4 trở lên.</div>`
      : 'Trình duyệt này không hỗ trợ thông báo. Dùng Chrome / Safari / Edge bản mới.');
    return;
  }
  const st = await api('/push');
  const reg = await navigator.serviceWorker.register('/sw.js');
  const cur = await reg.pushManager.getSubscription();
  openModal('🔔 Thông báo về máy này', `<div class="small muted" style="margin-bottom:8px">${cur ? '✅ Máy này đang bật thông báo.' : 'Máy này chưa bật thông báo.'} Tài khoản của bạn đang bật trên ${st.devices} máy.</div>
    <label style="display:flex;gap:8px;align-items:flex-start;color:var(--text);font-weight:normal"><input type="radio" name="pm" value="mention" style="width:auto;margin-top:3px" ${st.mode !== 'all' ? 'checked' : ''}><span>Chỉ khi có người <b>@gọi tên tôi</b> hoặc việc giao cho tôi (khuyên dùng)</span></label>
    <label style="display:flex;gap:8px;align-items:flex-start;color:var(--text);font-weight:normal"><input type="radio" name="pm" value="all" style="width:auto;margin-top:3px" ${st.mode === 'all' ? 'checked' : ''}><span>Mọi tin nhắn trong nhóm</span></label>
    ${ios && !standalone ? '<div class="small" style="color:var(--warn)">iPhone: phải mở app từ biểu tượng ở màn hình chính (Chia sẻ → Thêm vào MH chính) thì thông báo mới chạy.</div>' : ''}
    <div class="err"></div><div class="modal-foot">${cur ? '<button class="btn" id="pOff">Tắt trên máy này</button>' : ''}<button class="btn primary" id="pOn">${cur ? 'Lưu & gửi thử' : 'Bật thông báo'}</button></div>`);
  $('#pOn').onclick = () => guard($('#pOn'), async () => {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Bạn chưa cho phép thông báo. Vào cài đặt trình duyệt → cho phép thông báo cho trang này.');
    const sub = cur || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(st.public_key) });
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), mode: $('[name=pm]:checked').value } });
    await api('/push/test', { method: 'POST', body: {} });
    closeModal(); toast('Đã bật thông báo — sẽ có 1 thông báo thử');
  });
  if ($('#pOff')) $('#pOff').onclick = () => guard($('#pOff'), async () => { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: cur.endpoint } }); await cur.unsubscribe(); closeModal(); toast('Đã tắt thông báo trên máy này'); });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
function startChatPoll() {
  clearInterval(chatTimer);
  refreshChatBadge();
  chatTimer = setInterval(() => { if (document.hidden || !S.me) return; if (S.page === 'chat' && S.chatPull) S.chatPull(); else refreshChatBadge(); }, 15000);
}
function chatActCard(m) {
  if (m.action_done) return `<div class="chat-card ok">✅ ${esc(m.action_done.text)}${m.action_done.by ? ' · ' + esc(m.action_done.by) : ''}</div>`;
  const a = m.action; if (!a) return '';
  const btns = (label, dis) => `<div class="row" style="margin-top:6px"><button class="btn sm primary" data-ak="${m.id}" ${dis ? 'disabled' : ''}>${label}</button><button class="btn sm" data-ax="${m.id}">Bỏ qua</button></div>`;
  if (a.kind === 'expense') return `<div class="chat-card"><div class="small"><b>💸 Ghi khoản chi quỹ tiền mặt?</b></div>
    <div class="row" style="margin-top:4px"><input data-af="note" value="${esc(a.note)}" style="flex:1;min-width:160px"><input data-af="amount" inputmode="numeric" value="${a.amount}" style="width:110px"></div>
    <div class="small muted">${esc(a.category || '')}${isMgr() ? ' · quản lý ghi thì tự duyệt' : ' · chờ quản lý duyệt'}</div>${btns('✓ Ghi chi')}</div>`;
  if (a.kind === 'stock') return `<div class="chat-card"><div class="small"><b>📦 Báo ${a.level === 'low' ? 'sắp hết' : 'hết'} hàng cho người xem kho?</b></div>
    ${a.candidates.length ? `<select data-af="material_id" style="margin-top:4px">${a.candidates.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>` : `<div class="small">“${esc(a.text)}” — chưa có trong kho, vẫn báo được bằng chữ</div>`}${btns('✓ Báo kho')}</div>`;
  if (a.kind === 'off') {
    const mine = a.user_id === S.me.id || isMgr();
    return `<div class="chat-card"><div class="small"><b>🌴 Ghi ${isMgr() ? 'lịch nghỉ' : 'đơn xin nghỉ'}?</b></div><div class="cf-wrap"><span class="cf">Ai: <b>${esc(a.staff_name)}</b></span><span class="cf">Ngày: <b>${dmy(a.date)}</b></span>${a.from_time ? `<span class="cf">Giờ: <b>${esc(a.from_time)}–${esc(a.to_time)}</b></span>` : '<span class="cf">Cả ngày</span>'}</div>
      ${mine ? btns(isMgr() ? '✓ Ghi lịch nghỉ' : '✓ Gửi đơn xin nghỉ') : '<div class="small muted">Chỉ người nghỉ hoặc quản lý bấm ghi được.</div>'}</div>`;
  }
  if (a.kind === 'arrived') return `<div class="chat-card"><div class="small"><b>🙋 Đánh dấu khách đã đến?</b></div>
    <select data-af="appointment_id" style="margin-top:4px">${a.candidates.map((c) => `<option value="${c.id}">${esc(c.time || '')} · ${esc(c.name || '')}${c.staff_name ? ' · ' + esc(c.staff_name) : ''}</option>`).join('')}</select>${btns('✓ Đã đến')}</div>`;
  return '';
}
const chatBody = (m) => {
  let h = esc(m.body).replace(/\n/g, '<br>');
  h = h.replace(/(^|\s)(@[^\s<.,!?]+)/g, '$1<b class="mention">$2</b>');
  return h;
};
function chatDraftCard(m) {
  if (!m.draft && !m.appointment_id) return chatActCard(m);
  if (m.appointment_id) return `<div class="chat-card ok">✅ Đã tạo lịch <a href="#appointments?date=${m.appt_date}">${dmy(m.appt_date)} ${esc(m.appt_time || '')}</a>${m.linked_by_name ? ' · ' + esc(m.linked_by_name) : ''}${m.appt_status && m.appt_status !== 'booked' ? ` · ${APPT[m.appt_status] ? APPT[m.appt_status][0] : ''}` : ''}</div>`;
  const d = m.draft; if (!d) return '';
  const f = (l, v, warn) => `<span class="cf ${v ? '' : 'miss'}">${l}: <b>${v || 'chưa rõ'}</b>${warn ? ` <span class="badge warn">${warn}</span>` : ''}</span>`;
  return `<div class="chat-card"><div class="small"><b>📅 Tạo lịch hẹn từ tin này?</b></div><div class="cf-wrap">
    ${f('Khách', d.name ? esc(d.name) + (d.customer_id ? ' <span class="badge ok">khách cũ</span>' : ' <span class="badge">khách mới</span>') : '', d.name_from_prev ? 'lấy từ tin trước' : '')}
    ${d.phone ? f('SĐT', esc(d.phone)) : ''}${f('Ngày', d.date ? dmy(d.date) : '', d.date_guess ? 'đoán hôm nay' : '')}${f('Giờ', esc(d.time || ''))}
    ${f('Dịch vụ', esc(d.service || ''))}${f('Thợ', d.staff_id ? esc(staffName(d.staff_id)) : '', d.staff_from_profile ? 'thợ phụ trách' : d.staff_from_sender ? 'người nhắn' : '')}</div>
    <div class="row" style="margin-top:6px"><button class="btn sm primary" data-mk="${m.id}" ${d.name || d.customer_id ? '' : 'disabled title="Chưa rõ tên khách, bấm Sửa"'}>✓ Tạo lịch</button><button class="btn sm" data-ed="${m.id}">Sửa rồi tạo</button><button class="btn sm" data-dm="${m.id}">Không phải lịch</button></div></div>`;
}
// ---------- Tìm kiếm nhanh ----------
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && S.me && !e.target.closest('input,textarea,select') && $('#modal').classList.contains('hidden')) { e.preventDefault(); searchBox(); }
});
function searchBox() {
  openModal('Tìm kiếm', `<input id="sq" type="search" placeholder="Tên khách, SĐT, mã KH, mã thẻ, mã lượt, dịch vụ, công thức…" autocomplete="off">
    <div class="small muted" style="margin:6px 2px">Gõ ít nhất 2 ký tự.</div><div id="sres"></div>`);
  const inp = $('#sq'); inp.focus();
  let t, seq = 0;
  const sec = (title, rows) => (rows.length ? `<h3 style="margin:12px 0 4px">${title}</h3>${rows.join('')}` : '');
  const item = (attrs, main, sub, right) => `<div class="list-item click" ${attrs}><div style="flex:1;min-width:0"><b>${main}</b><div class="small muted">${sub}</div></div>${right ? `<div style="text-align:right">${right}</div>` : ''}</div>`;
  inp.oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = inp.value.trim(), my = ++seq;
      if (q.length < 2) { $('#sres').innerHTML = ''; return; }
      const r = await api('/search?q=' + encodeURIComponent(q));
      if (my !== seq) return;
      const html = sec('👤 Khách hàng', r.customers.map((c) => item(`data-sc="${c.id}"`, esc(c.name), `${esc(c.code)} · ${esc(c.phone || 'chưa có SĐT')}${c.last_visit ? ' · lần cuối ' + dmy(c.last_visit) : ''}`)))
        + sec('💳 Thẻ', r.cards.map((c) => item(`data-sc="${c.customer_id}"`, `${esc(c.code)} · ${esc(c.name)}`, `${esc(c.customer_name)} · ${esc(c.phone || '')} · hạn ${dmy(c.expires_at)}`, `<b>${money(c.balance)}</b><div class="small muted">số dư</div>`)))
        + sec('📅 Lịch hẹn', r.appointments.map((a) => item(`data-sa="${a.date}"`, `${dmy(a.date)} ${esc(a.time)} · ${esc(a.name)}`, `${esc(a.service || '')}${a.staff_name ? ' · ' + esc(a.staff_name) : ''}`, `<span class="badge ${APPT[a.status][1]}">${APPT[a.status][0]}</span>`)))
        + sec('✂️ Lượt làm', r.visits.map((v) => item(`data-sc="${v.customer_id}"`, `${esc(v.code)} · ${esc(v.customer_name)}`, `${dmy(v.date)} · ${esc(v.services || '')}`)));
      $('#sres').innerHTML = html || '<div class="empty">Không tìm thấy</div>';
      $$('[data-sc]', $('#sres')).forEach((el) => (el.onclick = () => { closeModal(); go('customer', { id: el.dataset.sc }); }));
      $$('[data-sa]', $('#sres')).forEach((el) => (el.onclick = () => { closeModal(); go('appointments', { date: el.dataset.sa, view: 'list' }); }));
    }, 250);
  };
}
// Ô gõ tìm dịch vụ (thay vì cuộn danh sách dài)
function svcSearch(id, onPick) {
  return { html: `<input id="${id}" list="${id}L" placeholder="🔍 Gõ tìm dịch vụ (vd: nhuộm, gội…)" autocomplete="off"><datalist id="${id}L">${S.services.filter((x) => x.active).map((x) => `<option value="${esc(x.name)}">${x.price ? kMoney(x.price) : ''}</option>`).join('')}</datalist>`,
    bind: () => { const el = $('#' + id); el.onchange = () => { const sv = findSvc(el.value); if (sv) { onPick(sv); el.value = ''; } }; } };
}
// Sao lưu Excel về máy cá nhân (quản lý trở lên, nhắc mỗi tuần)
function backupBox(st) {
  const when = st.last_at ? `Lần gần nhất: <b>${dmy(st.last_at.slice(0, 10))} ${esc(st.last_at.slice(11, 16))}</b> · ${esc(st.last_by || '')} (${st.days} ngày trước)` : '<b>Chưa sao lưu về máy lần nào</b>';
  return `<h3>💾 Sao lưu về máy tính cá nhân ${st.due ? '<span class="badge bad">Đến hạn</span>' : '<span class="badge ok">Đã sao lưu tuần này</span>'}</h3>
    <div class="small">${when}</div>
    <div class="small muted" style="margin:6px 0 10px">1 file Excel gồm: khách hàng, lượt làm, lịch hẹn, thẻ + lịch sử thẻ, chi & quỹ, tồn kho, nhập xuất kho, dịch vụ, nhân viên. Mỗi tuần tải 1 lần, lưu vào máy tính hoặc Google Drive. Máy chủ hỏng vẫn còn dữ liệu.</div>
    <button class="btn primary" data-bkpc>⬇️ Tải bản sao lưu Excel</button>`;
}
function bindBackupBox(root, after) {
  $$('[data-bkpc]', root).forEach((b) => (b.onclick = () => guard(b, async () => {
    const res = await api('/backup-pc/download', { raw: true });
    if (!res.ok) throw new Error('Không tải được file sao lưu');
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `SaoLuu-Salon-Nep-${S.today}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Đã tải bản sao lưu về máy'); refreshReminderBadge(); after && after();
  })));
}
async function refreshReminderBadge() {
  try {
    const r = await api('/reminders');
    reminderCount = Object.values(r.counts).reduce((a, b) => a + b, 0);
    $$('[data-rc]').forEach((b) => { b.textContent = reminderCount; b.classList.toggle('hidden', !reminderCount); });
  } catch { /* bỏ qua */ }
}
function go(page, params = {}) {
  const q = new URLSearchParams(params).toString();
  history.pushState({}, '', '#' + page + (q ? '?' + q : ''));
  route();
}
window.addEventListener('popstate', () => { closeModal(); if (S.me) route(); });
function route() {
  const [page, q] = (location.hash.slice(1) || 'dashboard').split('?');
  S.page = page; S.params = Object.fromEntries(new URLSearchParams(q || ''));
  $$('[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page || (page === 'customer' && b.dataset.page === 'customers')));
  { const a = $('.side .nav-btn.active'); if (a) a.closest('.nav-grp').classList.add('open'); }
  const main = $('#main');
  main.innerHTML = '<div class="empty">Đang tải…</div>';
  window.scrollTo(0, 0);
  const fn = VIEWS[page] || VIEWS.dashboard;
  Promise.resolve(fn(main)).catch((e) => { main.innerHTML = `<div class="card err">${esc(e.message)}</div>`; });
}
function header(title, sub, actions = '') {
  return `<div class="top"><div><h2>${esc(title)}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="row">${actions}</div></div>`;
}

// ---------- Ô chọn khách hàng ----------
function customerPicker(name = 'customer_id', selected) {
  return `<div class="picker" data-picker="${name}"><input type="hidden" name="${name}" value="${selected ? selected.id : ''}">
    <input class="pick-q" placeholder="Gõ tên, SĐT hoặc mã khách…" value="${selected ? esc(selected.code + ' – ' + selected.name) : ''}" autocomplete="off">
    <div class="picker-list hidden"></div></div>`;
}
function bindPicker(root, onPick) {
  for (const p of $$('[data-picker]', root)) {
    const q = $('.pick-q', p), list = $('.picker-list', p), hid = $('input[type=hidden]', p);
    let t;
    q.oninput = () => {
      hid.value = '';
      clearTimeout(t);
      t = setTimeout(async () => {
        if (!q.value.trim()) return list.classList.add('hidden');
        const r = await api('/customers?limit=12&q=' + encodeURIComponent(q.value.trim()));
        list.innerHTML = r.rows.map((c) => `<div data-id="${c.id}" data-label="${esc(c.code + ' – ' + c.name)}"><b>${esc(c.name)}</b> <span class="muted small">${esc(c.code)} · ${esc(c.phone || 'chưa có SĐT')}</span></div>`).join('')
          || '<div class="muted">Không thấy — tạo khách mới ở mục Khách hàng</div>';
        list.classList.remove('hidden');
        $$('[data-id]', list).forEach((d) => (d.onclick = () => {
          hid.value = d.dataset.id; q.value = d.dataset.label; list.classList.add('hidden');
          if (onPick) onPick(Number(d.dataset.id));
        }));
      }, 200);
    };
    q.onblur = () => setTimeout(() => list.classList.add('hidden'), 200);
  }
}

// ---------- Ảnh: nén trước khi tải ----------
function compressImage(file, max = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => { URL.revokeObjectURL(url); resolve(b || file); }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
async function uploadPhotos(customerId, files, kind, visitId) {
  const fd = new FormData();
  fd.append('kind', kind);
  if (visitId) fd.append('visit_id', visitId);
  for (const f of files) fd.append('photos', await compressImage(f), (f.name || 'anh').replace(/\.\w+$/, '') + '.jpg');
  return api(`/customers/${customerId}/photos`, { method: 'POST', body: fd });
}
function photoGrid(photos, canDelete) {
  if (!photos.length) return '<div class="empty">Chưa có ảnh</div>';
  const L = { before: ['Trước', 'warn'], after: ['Sau', 'ok'], other: ['Khác', ''] };
  return `<div class="photos">${photos.map((p) => `<div class="photo" data-photo="${p.id}"><img loading="lazy" src="/api/photos/${p.id}" alt="">
    <span class="badge ${L[p.kind][1]} tag">${L[p.kind][0]}${p.date ? ' ' + dmy(p.date).slice(0, 5) : ''}</span>
    ${canDelete ? `<button class="icon-btn" data-delphoto="${p.id}" style="position:absolute;right:0;top:0;color:#fff;text-shadow:0 0 4px #000">×</button>` : ''}</div>`).join('')}</div>`;
}
function bindPhotos(root, onChange) {
  $$('[data-photo]', root).forEach((el) => (el.onclick = (e) => {
    if (e.target.dataset.delphoto) return;
    const lb = document.createElement('div'); lb.className = 'lightbox';
    lb.innerHTML = `<img src="/api/photos/${el.dataset.photo}">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb);
  }));
  $$('[data-delphoto]', root).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('Xóa ảnh này?')) return;
    try { await api('/photos/' + b.dataset.delphoto, { method: 'DELETE' }); toast('Đã xóa ảnh'); onChange && onChange(); } catch (er) { toast(er.message); }
  }));
}

const VIEWS = {};

// ---------- Tổng quan ----------
VIEWS.dashboard = async (main) => {
  const d = await api('/dashboard');
  const mine = d.today_report.rows.find((r) => r.user_id === S.me.id);
  const mineMonth = d.month_report.rows.find((r) => r.user_id === S.me.id);
  const T = d.today_report.summary, M = d.month_report.summary;
  const kpis = isOwner() && T && M ? `
    <div class="kpi"><div class="l">DS dịch vụ hôm nay</div><div class="v">${money(T.shop_service_sales)}</div><div class="s">${T.visits} lượt${T.product_sales ? ' · bán SP ' + money(T.product_sales) : ''}${T.card_sales ? ' · thẻ ' + money(T.card_sales) : ''}</div></div>
    <div class="kpi"><div class="l">Tiền vào hôm nay</div><div class="v">${money(T.money_in)}</div><div class="s">dịch vụ + sản phẩm + bán thẻ, không gồm tip</div></div>
    <div class="kpi"><div class="l">DS dịch vụ tháng này</div><div class="v">${money(M.shop_service_sales)}</div><div class="s">bán SP ${money(M.product_sales)} · bán thẻ ${money(M.card_sales)}</div></div>
    <div class="kpi"><div class="l">Khách hàng</div><div class="v">${d.customers}</div><div class="s">trong hệ thống</div></div>`
    : `<div class="kpi"><div class="l">DS dịch vụ của bạn hôm nay</div><div class="v">${money(mine ? mine.service_sales : 0)}</div><div class="s">${mine ? mine.main_count : 0} lượt làm chính${mine && mine.product_sales ? ' · bán SP ' + money(mine.product_sales) : ''}</div></div>
    <div class="kpi"><div class="l">① DS dịch vụ tháng (xét thưởng)</div><div class="v">${money(mineMonth ? mineMonth.bonus_sales : 0)}</div><div class="s">dịch vụ tự làm${mineMonth && (mineMonth.gift_sales || mineMonth.family_sales) ? ', đã trừ thẻ tri ân / người nhà' : ''}</div></div>
    <div class="kpi"><div class="l">② DS bán sản phẩm tháng</div><div class="v">${money(mineMonth ? mineMonth.product_sales : 0)}</div><div class="s">riêng · chỉ tính % HH sản phẩm</div></div>
    <div class="kpi"><div class="l">② DS bán thẻ tháng</div><div class="v">${money(mineMonth ? mineMonth.cards_amount : 0)}</div><div class="s">${mineMonth ? mineMonth.cards_count : 0} thẻ · riêng · chỉ tính HH thẻ</div></div>
    <div class="kpi"><div class="l">② DS làm phụ tháng</div><div class="v">${money(mineMonth ? mineMonth.assist_sales : 0)}</div><div class="s">${mineMonth ? mineMonth.assist_count : 0} lượt · chỉ tính HH thợ phụ</div></div>
    <div class="kpi"><div class="l">Hoa hồng tháng (tạm tính)</div><div class="v">${money(mineMonth ? mineMonth.total_commission : 0)}</div></div>`;
  const rc = d.reminder_counts;
  main.innerHTML = header(`Chào ${S.me.full_name}`, `Hôm nay ${dmy(d.today)}`,
    `<button class="btn" data-goto2="attendance">🕘 Chấm công</button><button class="btn" id="qAppt">+ Lịch hẹn</button><button class="btn primary" id="qVisit">+ Ghi lượt làm</button>`) +
    `<div class="grid kpis">${kpis}</div>
    <div class="grid two">
      <div class="card"><h3>Lịch hẹn hôm nay (${d.appointments.length})</h3>${apptListCompact(d.appointments)}</div>
      <div class="card"><h3>Việc cần làm</h3>
        ${[['cycles', '📞 Khách định kỳ – gọi hỏi giờ'], ['birthdays', '🎂 Sinh nhật sắp tới'], ['cards', '💳 Thẻ sắp hết hạn / hết tiền'], ['returns', '🔁 Khách đến hạn quay lại'], ['appointments', '📞 Gọi xác nhận lịch ngày mai'], ['cancels', '❌ Khách hủy / không đến – mời đặt lại']]
          .map(([k, l]) => `<div class="stat-line"><a href="#reminders">${l}</a><b>${rc[k]}</b></div>`).join('')}
      </div></div>`;
  $('#qAppt').onclick = () => apptForm({ date: d.today });
  $$('[data-goto2]', main).forEach((b) => (b.onclick = () => go(b.dataset.goto2)));
  $('#qVisit').onclick = () => visitForm({});
  bindApptList(main, () => VIEWS.dashboard(main));
  // Nhắc quản lý tải bản sao lưu về máy mỗi tuần
  if (isMgr()) api('/backup-pc').then((st) => {
    if (!st.due || S.page !== 'dashboard') return;
    const box = document.createElement('div'); box.className = 'card bk-due'; box.innerHTML = backupBox(st);
    const h = main.querySelector('.top') || main.firstElementChild; h.after(box);
    bindBackupBox(box, () => box.remove());
  }).catch(() => {});
};
function apptList(rows, showDate) {
  if (!rows.length) return '<div class="empty">Không có lịch hẹn</div>';
  return rows.map((a) => `<div class="list-item"><div class="time-pill">${esc(a.time)}${showDate ? `<div class="small muted">${dmy(a.date).slice(0, 5)}</div>` : ''}</div>
    <div style="flex:1;min-width:0"><div class="t">${a.customer_id ? `<a href="#customer?id=${a.customer_id}">${esc(a.name)}</a>` : esc(a.name) + ' <span class="badge">khách mới</span>'}</div>
      <div class="small muted">${a.visit_services ? esc(a.visit_services) : svcWithPrice(a.service)}${a.staff_name ? ' · ' + esc(a.staff_name) : ''}${a.assistant_id ? ' + phụ ' + esc(staffName(a.assistant_id)) : ''} · ${telLinks(a.phone)}${a.taken_by_name ? ` · <span title="Người nhận lịch">📝 ${esc(a.taken_by_name)}</span>` : ''}</div>
      ${a.visit_id && a.visit_total != null ? (a.pay_note === 'Chưa thanh toán' ? `<div class="small"><b style="color:var(--bad)">⚠ Đã làm, khách chưa trả ${money(a.visit_total)}</b> · <a href="#" data-rcpt="${a.visit_id}">Hóa đơn</a></div>${isOwner() ? `<div class="row" style="margin-top:4px">${S.settings.payment_methods.slice(0, 3).map((m) => `<button class="btn sm" data-apaid="${a.id}" data-m="${esc(m)}">Đã thu: ${esc(m)}</button>`).join('')}</div>` : ''}`
        : `<div class="small"><b style="color:var(--ok)">✓ Đã thu ${money(a.visit_total)}</b>${a.pay_note ? ' · ' + esc(a.pay_note) : ''} · <a href="#" data-rcpt="${a.visit_id}">Hóa đơn</a></div>`)
        : a.service && estTotal(a.service) && !['cancelled', 'noshow'].includes(a.status) ? `<div class="small">Dự kiến: <b>${money(estTotal(a.service))}</b></div>` : ''}
      ${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}
      ${a.pay_note && a.status !== 'cancelled' && !(a.visit_id && a.visit_total != null) ? `<div class="small"><span class="badge ${a.pay_note === 'Chưa thanh toán' ? 'bad' : 'ok'}">${a.pay_note === 'Chưa thanh toán' ? '⚠ Chưa thanh toán' : '💵 ' + esc(a.pay_note)}</span></div>` : ''}
      ${a.cancel_reason && ['cancelled', 'noshow'].includes(a.status) ? `<div class="small" style="color:var(--bad)">Lý do: ${esc(a.cancel_reason)}</div>` : ''}</div>
    <div style="text-align:right"><span class="badge ${APPT[a.status][1]}">${APPT[a.status][0]}</span>
      <div class="row" style="justify-content:flex-end;margin-top:6px">
      ${a.grp ? `<button class="btn sm" data-agrp="${a.id}" title="Xem cả nhà / người đi cùng trong ngày">👨‍👩‍👧 Cả nhà (${a.grp})</button>` : ''}
      ${a.status === 'booked' ? `<button class="btn sm" data-ast="arrived" data-id="${a.id}">Đã đến</button>` : ''}
      ${a.customer_id ? `<button class="btn sm" data-acust="${a.customer_id}" title="Sửa tên, SĐT, sinh nhật, lưu ý tóc của khách">✏️ Sửa thông tin khách</button>` : ''}
      ${['booked', 'arrived'].includes(a.status) ? `<button class="btn sm primary" data-avisit="${a.id}">Thu tiền</button><button class="btn sm" data-aedit="${a.id}">Sửa</button><button class="btn sm" data-acancel="${a.id}">Hủy / không đến</button>` : ''}
      </div></div></div>`).join('');
}
function apptListCompact(rows, showDate) {
  if (!rows.length) return '<div class="empty">Không có lịch hẹn</div>';
  return rows.map((a) => `<div class="list-item"><div class="time-pill">${esc(a.time)}${showDate ? `<div class="small muted">${dmy(a.date).slice(0, 5)}</div>` : ''}</div>
    <div class="appt-main"><div class="appt-head"><span class="t">${a.customer_id ? `<a href="#customer?id=${a.customer_id}">${esc(a.name)}</a>` : esc(a.name) + ' <span class="badge">khách mới</span>'}</span><span class="badge ${APPT[a.status][1]}">${APPT[a.status][0]}</span></div>
      <div class="small muted">${a.visit_services ? esc(a.visit_services) : svcWithPrice(a.service)}${a.staff_name ? ' · ' + esc(a.staff_name) : ''}${a.assistant_id ? ' + phụ ' + esc(staffName(a.assistant_id)) : ''} · ${telLinks(a.phone)}</div>
      ${a.visit_id && a.visit_total != null ? (a.pay_note === 'Chưa thanh toán' ? `<div class="small"><b style="color:var(--bad)">⚠ Đã làm, khách chưa trả ${money(a.visit_total)}</b> · <a href="#" data-rcpt="${a.visit_id}">Hóa đơn</a></div>${isOwner() ? `<div class="row" style="margin-top:4px">${S.settings.payment_methods.slice(0, 3).map((m) => `<button class="btn sm" data-apaid="${a.id}" data-m="${esc(m)}">Đã thu: ${esc(m)}</button>`).join('')}</div>` : ''}`
        : `<div class="small"><b style="color:var(--ok)">✓ Đã thu ${money(a.visit_total)}</b>${a.pay_note ? ' · ' + esc(a.pay_note) : ''} · <a href="#" data-rcpt="${a.visit_id}">Hóa đơn</a></div>`)
        : a.service && estTotal(a.service) && !['cancelled', 'noshow'].includes(a.status) ? `<div class="small">Dự kiến: <b>${money(estTotal(a.service))}</b></div>` : ''}
      ${a.note ? `<div class="small muted appt-note" title="${esc(a.note)}">📒 ${esc(a.note)}</div>` : ''}
      ${a.pay_note && a.status !== 'cancelled' && !(a.visit_id && a.visit_total != null) ? `<div class="small"><span class="badge ${a.pay_note === 'Chưa thanh toán' ? 'bad' : 'ok'}">${a.pay_note === 'Chưa thanh toán' ? '⚠ Chưa thanh toán' : '💵 ' + esc(a.pay_note)}</span></div>` : ''}
      ${a.cancel_reason && ['cancelled', 'noshow'].includes(a.status) ? `<div class="small" style="color:var(--bad)">Lý do: ${esc(a.cancel_reason)}</div>` : ''}
      <div class="appt-acts">
      ${a.grp ? `<button class="btn sm" data-agrp="${a.id}" title="Xem cả nhà / người đi cùng trong ngày">👨‍👩‍👧 Cả nhà (${a.grp})</button>` : ''}
      ${a.status === 'booked' ? `<button class="btn sm" data-ast="arrived" data-id="${a.id}">Đã đến</button>` : ''}
      ${a.customer_id ? `<button class="btn sm" data-acust="${a.customer_id}" title="Sửa tên, SĐT, sinh nhật, lưu ý tóc của khách">✏️ Sửa thông tin khách</button>` : ''}
      ${['booked', 'arrived'].includes(a.status) ? `<button class="btn sm primary" data-avisit="${a.id}">Thu tiền</button><button class="btn sm" data-aedit="${a.id}">Sửa</button><button class="btn sm" data-acancel="${a.id}">Hủy / không đến</button>` : ''}
      </div></div></div>`).join('');
}
// ---------- Cả nhà / người đi cùng trong ngày ----------
// Thợ xem chung cả nhóm (ai làm gì, ai đã thu); Lãnh đạo chia khoản "Chưa rõ dịch vụ" sang đúng người, tổng tiền giữ nguyên
async function familyDay(apptId, after) {
  let g = await api(`/appointments/${apptId}/group`);
  let dirty = false;
  const act = S.services.filter((x) => x.active);
  const render = () => {
    const live = g.rows.filter((r) => !['cancelled', 'noshow'].includes(r.status));
    const seen = new Map();
    const html = `${g.total != null ? `<div class="daysum" style="margin-bottom:8px"><div><span class="muted small">Tổng cả nhà đã thu</span><b>${money(g.total)}</b></div>
        ${g.unknown ? `<div><span class="muted small">Còn "chưa rõ dịch vụ"</span><b style="color:var(--bad)">${money(g.unknown)}</b></div>` : ''}</div>` : ''}
      ${g.unknown && isOwner() ? `<div class="small" style="margin-bottom:8px">⚠ Sổ ghi tổng tiền chung cho cả nhà nên app dồn phần chênh vào 1 người. Bấm <b>Chia</b> để chuyển đúng số tiền sang người đã làm, tổng không đổi.</div>`
        : g.unknown ? '<div class="small muted" style="margin-bottom:8px">Có khoản chưa rõ dịch vụ, nhờ anh/chị Vinh chia lại.</div>' : ''}
      ${!g.linked ? `<div class="row" style="margin-bottom:8px"><button class="btn sm primary" id="fgLink">🔗 Lưu thành 1 gia đình</button><span class="small muted">để lần sau mở hồ sơ ai cũng thấy cả nhà, công thức tóc</span></div>` : '<div class="small muted" style="margin-bottom:8px">✓ Đã gắn chung 1 gia đình</div>'}
      ${g.rows.map((r) => {
        const k = r.time + '|' + (r.customer_id || r.name);
        const dupOf = !r.visit && ['booked', 'arrived'].includes(r.status) ? seen.get(k) : null;
        if (!seen.has(k) && !['cancelled', 'noshow'].includes(r.status)) seen.set(k, r);
        const dupLater = !r.visit && ['booked', 'arrived'].includes(r.status) && !dupOf && g.rows.some((o) => o !== r && o.time === r.time && (o.customer_id || o.name) === (r.customer_id || r.name) && !['cancelled', 'noshow'].includes(o.status) && (o.visit || o.id < r.id));
        return `<div class="list-item" style="${['cancelled', 'noshow'].includes(r.status) ? 'opacity:.5' : ''}"><div class="time-pill">${esc(r.time)}</div>
        <div style="flex:1;min-width:0"><div class="t">${r.customer_id ? `<a href="#customer?id=${r.customer_id}">${esc(r.name)}</a>` : esc(r.name)}
          ${r.is_root ? '<span class="badge">người gốc</span>' : r.relation ? `<span class="badge">${esc(r.relation)}</span>` : ''}</div>
          <div class="small muted">${esc(r.staff_name || 'Chưa xếp thợ')}${r.assistant_id ? ' + phụ ' + esc(staffName(r.assistant_id)) : ''} · ${APPT[r.status][0]}</div>
          ${r.visit ? r.visit.items.map((i) => `<div class="small" ${i.unknown ? 'style="color:var(--bad)"' : ''}>• ${esc(i.name)}${i.price != null ? ' · <b>' + money(i.price) + '</b>' : ''}
            ${i.unknown && isOwner() ? ` <button class="btn sm" data-fgsplit="${i.id}" data-max="${i.price}">Chia</button>` : ''}</div>`).join('')
            : `<div class="small muted">${r.service ? esc(r.service) : 'Chưa thu tiền'}${r.note ? ' · ' + esc(r.note) : ''}</div>`}
          <div id="fgf${r.visit ? r.visit.items.filter((i) => i.unknown).map((i) => i.id).join('_') : 'x' + r.id}"></div></div>
        <div style="text-align:right">${r.visit ? `${r.visit.total != null ? `<b>${money(r.visit.total)}</b><br>` : ''}<a href="#" data-rcpt="${r.visit.id}" class="small">Hóa đơn</a>` : ''}
          ${(dupOf || dupLater) && isMgr() ? `<div><button class="btn sm" data-fgdup="${r.id}" title="2 dòng cùng giờ cùng khách, dòng này chưa thu tiền">Bỏ lịch trùng</button></div>` : ''}</div></div>`;
      }).join('')}
      <div class="small muted" style="margin-top:8px">${live.length} người · ${dmy(g.date)}. Thợ xem được cả nhóm; tiền chỉ hiện với người làm lượt đó và quản lý.</div>`;
    $('#fgBody').innerHTML = html;
    $$('[data-rcpt]', $('#fgBody')).forEach((b) => (b.onclick = (e) => { e.preventDefault(); showReceipt(Number(b.dataset.rcpt)); }));
    const link = $('#fgLink');
    if (link) link.onclick = () => guard(link, async () => { const r = await api(`/appointments/${apptId}/group/link`, { method: 'POST' }); g = r.group; dirty = true; toast(`Đã gắn ${r.linked} người vào gia đình`); render(); });
    $$('[data-fgdup]', $('#fgBody')).forEach((b) => (b.onclick = () => guard(b, async () => {
      await api(`/appointments/${b.dataset.fgdup}/status`, { method: 'POST', body: { status: 'cancelled', reason: 'Trùng lịch (cả nhà)' } });
      g = await api(`/appointments/${apptId}/group`); dirty = true; toast('Đã bỏ lịch trùng'); render();
    })));
    $$('[data-fgsplit]', $('#fgBody')).forEach((b) => (b.onclick = () => {
      const box = b.closest('.list-item').querySelector('[id^="fgf"]');
      const max = Number(b.dataset.max);
      const opts = g.rows.filter((r) => !['cancelled', 'noshow'].includes(r.status));
      box.innerHTML = `<div class="card" style="margin:6px 0;padding:8px"><div class="small"><b>Chia ${money(max)} chưa rõ</b></div>
        <label class="small">Chuyển cho</label><select id="fgTo">${opts.map((r) => `<option value="${r.id}">${esc(r.time)} · ${esc(r.name)} (${esc(r.staff_name || '?')})${r.visit ? '' : ' · chưa có hóa đơn'}</option>`).join('')}</select>
        <label class="small">Dịch vụ</label><select id="fgSvc"><option value="">Khác (gõ tên)</option>${act.map((x) => `<option value="${x.id}" data-p="${x.price || ''}">${esc(x.name)}${x.price ? ' · ' + kMoney(x.price) : ''}</option>`).join('')}</select>
        <input id="fgName" placeholder="Tên dịch vụ (nếu chọn Khác)">
        <label class="small">Số tiền</label><input type="number" id="fgAmt" min="1000" step="1000" max="${max}" value="${max}">
        <div class="row" style="margin-top:6px"><button class="btn sm primary" id="fgSave">Lưu chia tiền</button><button class="btn sm" id="fgCancel">Thôi</button></div></div>`;
      $('#fgSvc').onchange = () => { const o = $('#fgSvc').selectedOptions[0]; const pr = Number(o.dataset.p || 0); if (pr && pr <= max) $('#fgAmt').value = pr; $('#fgName').style.display = $('#fgSvc').value ? 'none' : ''; };
      // Gợi ý: người chưa có hóa đơn trước, tên dịch vụ lấy từ chữ ghi trong sổ của người đó
      const firstNo = opts.find((r) => !r.visit);
      if (firstNo) $('#fgTo').value = firstNo.id;
      const fillName = () => { const r = opts.find((x) => x.id === Number($('#fgTo').value)); if (!$('#fgSvc').value) $('#fgName').value = r && !r.visit && r.note ? r.note.replace(new RegExp('^' + r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').slice(0, 60) : ''; };
      $('#fgTo').onchange = fillName; fillName();
      $('#fgCancel').onclick = () => (box.innerHTML = '');
      $('#fgSave').onclick = () => guard($('#fgSave'), async () => {
        g = await api(`/appointments/${apptId}/group/split`, { method: 'POST', body: { item_id: Number(b.dataset.fgsplit), to_appointment_id: Number($('#fgTo').value), service_id: Number($('#fgSvc').value) || null, name: $('#fgName').value, amount: Number($('#fgAmt').value) } });
        dirty = true; toast('Đã chia tiền, tổng cả nhà giữ nguyên'); render();
      });
    }));
  };
  const root = g.rows.find((r) => r.is_root) || g.rows[0];
  openModal(`👨‍👩‍👧 Cả nhà ${root.name} · ${dmy(g.date)}`, '<div id="fgBody"></div>');
  render();
  // Đóng cửa sổ sau khi đã chia tiền / gắn gia đình → tải lại lịch
  let fired = false;
  const onClose = (e) => { if (fired || (e.currentTarget.id === 'modal' && e.target.id !== 'modal')) return; fired = true; if (dirty && after) after(); };
  $('#modalClose').addEventListener('click', onClose, { once: true });
  $('#modal').addEventListener('click', onClose);
}
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const payIcon = (m) => (/mặt/i.test(m) ? '💵' : /khoản|ck/i.test(m) ? '🏦' : /thẻ|quẹt|pos/i.test(m) ? '💳' : '💰');
VIEWS.pos = async (main) => {
  const date = isMgr() && S.params.date ? S.params.date : S.today;
  const r = await api('/pos' + (date !== S.today ? '?date=' + date : ''));
  const who = (a) => `${a.staff_name ? esc(a.staff_name) : '<span class="muted">chưa gán thợ</span>'}`;
  const key = (a) => esc(fold([a.name, a.phone, a.staff_name, a.service, a.visit_code].filter(Boolean).join(' ')));
  const late = (a) => { if (date !== S.today || !a.time) return ''; const m = toMin(new Date().toTimeString().slice(0, 5)) - toMin(a.time); return m > 15 ? `<span class="badge warn">trễ ${m} phút</span>` : ''; };
  const card = (a, kind) => `<div class="pos-tile ${kind}" data-k="${key(a)}" data-st="${esc(a.staff_name || '')}">
    <div class="pos-h"><b>${esc(a.time || '')}</b><span class="pos-n">${esc(a.name || 'Khách lẻ')}</span>${a.gift_left && kind !== 'paid' ? `<span class="badge warn" title="Khách có thẻ tri ân chưa dùng">🎁 ${money(a.gift_left)}</span>` : ''}${kind === 'waiting' ? late(a) : ''}</div>
    <div class="small muted pos-s">${esc(a.service || '')}${a.service ? ' · ' : ''}${who(a)}</div>
    ${kind === 'waiting' ? `<div class="row"><button class="btn sm" data-in="${a.id}">✓ Khách đến</button><button class="btn sm primary" data-pay="${a.id}">💰 Thanh toán</button></div>` : ''}
    ${kind === 'serving' ? `<div class="row"><button class="btn primary" data-pay="${a.id}">💰 Thanh toán</button><button class="btn sm" data-out="${a.id}" title="Bấm nhầm">↶</button></div>` : ''}
    ${kind === 'unpaid' ? `<div class="row"><span class="badge bad">Chưa trả</span>${a.visit_total != null ? `<b>${money(a.visit_total)}</b>` : ''}<button class="btn sm" data-vw="${a.visit_id}">Xem</button></div>` : ''}
    ${kind === 'paid' ? `<div class="row"><span class="badge ok">✓ ${esc(a.payment_method || 'Đã thu')}</span>${a.visit_total != null ? `<b>${money(a.visit_total)}</b>` : ''}<button class="btn sm" data-vw="${a.visit_id}">${isOwner() ? 'Xem / sửa' : 'Hóa đơn'}</button></div>` : ''}
  </div>`;
  const col = (title, list, kind, empty) => `<div class="pos-col"><h3>${title} <span class="badge">${list.length}</span></h3>${list.map((a) => card(a, kind)).join('') || `<div class="small muted">${empty}</div>`}</div>`;
  const C = r.cash, T = r.totals;
  const tot = T ? `<div class="card"><h3>💰 Tổng tiền ${dmy(date)} <span class="small muted">(chỉ bạn thấy)</span></h3><div class="grid kpis" style="margin:0">
      <div class="kpi"><div class="l">Doanh số (${T.visits} lượt)</div><div class="v">${money(T.sales)}</div><div class="s">${T.paid_by_card ? 'trừ thẻ ' + money(T.paid_by_card) + (T.paid_by_gift ? ' (tri ân ' + money(T.paid_by_gift) + ')' : '') : ''}</div></div>
      <div class="kpi"><div class="l">Tiền thực thu</div><div class="v">${money(T.money_in)}</div><div class="s">${Object.entries(T.by_method).filter(([, v]) => v).map(([k, v]) => esc(k) + ' ' + money(v)).join(' · ')}</div></div>
      <div class="kpi"><div class="l">Bán thẻ</div><div class="v">${money(T.card_sales)}</div><div class="s">tip ${money(T.tips)}</div></div>
      ${T.unpaid ? `<div class="kpi"><div class="l">Khách chưa trả</div><div class="v" style="color:var(--bad,#c0392b)">${money(T.unpaid)}</div></div>` : ''}</div></div>` : '';
  main.innerHTML = header('🧾 Thu ngân', 'Ai cũng làm thu ngân được: khách đến bấm ✓, làm xong bấm 💰 Thanh toán. Sửa hóa đơn đã lưu vẫn chỉ Lãnh đạo.',
    `<button class="btn primary" id="walk">+ Khách vãng lai</button><button class="btn" id="close">🔒 Kết ca</button>`) +
    `${isMgr() ? `<div class="card"><div class="row"><input type="date" id="pd" value="${date}" style="width:auto">${date !== S.today ? '<button class="btn sm" id="tdy">Hôm nay</button>' : ''}<span class="small muted">${dmy(date)}</span></div></div>` : ''}
    ${tot}
    ${r.debts && r.debts.length ? `<div class="card"><h3>📝 Khách còn nợ <span class="badge bad">${money(r.debts.reduce((s, d) => s + d.debt, 0))}</span></h3>
      ${r.debts.map((d) => `<div class="stat-line debt-line"><span><b>${esc(d.name)}</b> <span class="small muted">${dmy(d.date)} · ${esc(d.visit_code)}${d.staff_name ? ' · ' + esc(d.staff_name) : ''}</span></span>
        <span class="row" style="gap:4px;justify-content:flex-end"><b style="color:var(--bad)">${money(d.debt)}</b>${S.settings.payment_methods.slice(0, 3).map((m) => `<button class="btn sm" data-debt="${d.visit_id}" data-m="${esc(m)}">Thu: ${payIcon(m)} ${esc(m)}</button>`).join('')}</span></div>`).join('')}</div>` : ''}
    <div class="card pos-find"><input id="pq" type="search" placeholder="🔍 Tìm khách: tên, SĐT, thợ, dịch vụ…" autocomplete="off">
      <div class="chips" id="pst"><button class="chip on" data-pst="">Tất cả thợ</button>${[...new Set(r.waiting.concat(r.serving, r.unpaid, r.paid).map((a) => a.staff_name).filter(Boolean))].map((n) => `<button class="chip" data-pst="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <div id="pfind"></div></div>
    <div class="pos-board">
      ${col('⏳ Chờ đến', r.waiting, 'waiting', 'Không còn lịch chờ')}
      ${col('✂️ Đang phục vụ', r.serving, 'serving', 'Chưa có khách trong tiệm')}
      <div class="pos-col"><h3>✅ Đã thu <span class="badge">${r.paid.length}</span></h3>${r.unpaid.map((a) => card(a, 'unpaid')).join('')}${r.paid.slice().reverse().map((a) => card(a, 'paid')).join('') || (r.unpaid.length ? '' : '<div class="small muted">Chưa thu lượt nào</div>')}</div>
    </div>
    ${isOwner() && C ? `<div class="card"><h3>💵 Tiền mặt trong két ${dmy(date)} (chỉ bạn thấy)</h3>
      <div class="stat-line"><span>Tiền mặt từ hóa đơn (${C.invoices} hóa đơn)</span><b>${money(C.visits)}</b></div>
      <div class="stat-line"><span>Tip chung trả tiền mặt</span><b>${money(C.tips)}</b></div>
      <div class="stat-line"><span>Bán thẻ tiền mặt</span><b>${money(C.cards)}</b></div>
      ${C.debts ? `<div class="stat-line"><span>Thu nợ tiền mặt</span><b>${money(C.debts)}</b></div>` : ''}
      <div class="stat-line"><span><b>Máy tính phải có</b></span><b>${money(C.total)}</b></div>
      ${r.closes.map((k) => `<div class="stat-line"><span>Kết ca ${esc(k.created_at.slice(11, 16))} · ${esc(k.user_name || '')}${k.note ? ` <span class="small muted">${esc(k.note)}</span>` : ''}</span><b>đếm ${money(k.counted)} · <span style="color:${k.diff ? 'var(--bad,#c0392b)' : 'var(--ok,#1e8449)'}">${k.diff ? (k.diff > 0 ? 'thừa ' : 'thiếu ') + money(Math.abs(k.diff)) : 'khớp'}</span></b></div>`).join('') || '<div class="small muted">Chưa ai kết ca hôm nay.</div>'}
      <div class="small muted" style="margin-top:6px">Không gồm phong bì quỹ chi tiêu 1tr và tip riêng. Người kết ca không thấy số máy tính (đếm mù) nên không "đếm cho khớp" được.</div>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="hist">Lịch sử kết ca 30 ngày</button></div></div>`
    : r.closes.length ? `<div class="card small">Hôm nay đã kết ca: ${r.closes.map((k) => esc(k.created_at.slice(11, 16)) + ' · ' + esc(k.user_name || '')).join('; ')}</div>` : ''}`;
  const reload = () => VIEWS.pos(main);
  const all = r.waiting.concat(r.serving);
  $$('[data-in]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api('/pos/checkin/' + b.dataset.in, { method: 'POST' }); reload(); })));
  $$('[data-out]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api('/pos/checkin/' + b.dataset.out, { method: 'POST', body: { undo: 1 } }); reload(); })));
  $$('[data-pay]', main).forEach((b) => (b.onclick = () => guard(b, async () => {
    const a = all.find((x) => x.id === Number(b.dataset.pay)); if (!a) return;
    await checkout({ ...a, date: date }, reload);
  })));
  $('#walk').onclick = () => visitForm({ date: S.today }, reload);
  // Tìm kiếm + lọc theo thợ (lọc ngay trên các ô); không thấy trong ngày → tìm trong danh bạ khách để thu tiền luôn
  let pst = '', tmr;
  const applyF = () => {
    const q = fold($('#pq').value.trim());
    let shown = 0;
    $$('.pos-tile', main).forEach((t) => { const ok = (!q || t.dataset.k.includes(q)) && (!pst || t.dataset.st === pst); t.style.display = ok ? '' : 'none'; if (ok) shown++; });
    clearTimeout(tmr);
    if (!q || q.length < 2 || shown) { $('#pfind').innerHTML = ''; return; }
    tmr = setTimeout(async () => {
      const cs = await api('/customers?limit=5&q=' + encodeURIComponent($('#pq').value.trim())).catch(() => []);
      const list = Array.isArray(cs) ? cs : cs.rows || [];
      $('#pfind').innerHTML = list.length ? `<div class="small muted" style="margin-top:8px">Không có trong hôm nay. Khách trong danh bạ:</div>` + list.map((c) => `<div class="stat-line"><span><b>${esc(c.name)}</b> <span class="small muted">${esc(c.code || '')} ${esc(c.phone || '')}</span></span><button class="btn sm primary" data-pc="${c.id}">💰 Thu tiền</button></div>`).join('')
        : '<div class="small muted" style="margin-top:8px">Không tìm thấy. Bấm <b>+ Khách vãng lai</b> để tạo khách mới.</div>';
      $$('[data-pc]', main).forEach((b) => (b.onclick = () => { const c = list.find((x) => x.id === Number(b.dataset.pc)); visitForm({ date: S.today, customer_id: c.id, customer: c }, reload); }));
    }, 300);
  };
  $('#pq').oninput = applyF;
  $$('[data-debt]', main).forEach((b) => (b.onclick = () => guard(b, async () => { const x = await api('/pos/debt/' + b.dataset.debt, { method: 'POST', body: { method: b.dataset.m } }); toast(`Đã thu nợ ${money(x.amount)} (${b.dataset.m})`); reload(); })));
  $$('[data-pst]', main).forEach((b) => (b.onclick = () => { pst = b.dataset.pst; $$('[data-pst]', main).forEach((x) => x.classList.toggle('on', x === b)); applyF(); }));
  $$('[data-vw]', main).forEach((b) => (b.onclick = () => guard(b, async () => { if (isOwner()) visitForm(await api('/visits/' + b.dataset.vw), reload); else showReceipt(Number(b.dataset.vw)); })));
  if ($('#pd')) $('#pd').onchange = (e) => e.target.value && go('pos', { date: e.target.value });
  if ($('#tdy')) $('#tdy').onclick = () => go('pos', {});
  $('#close').onclick = () => {
    openModal('🔒 Kết ca – đếm tiền mặt', `<form id="cf"><div class="small muted">Đếm toàn bộ <b>tiền mặt thu trong ngày</b> trong két (tiền khách trả + tip chung tiền mặt + bán thẻ tiền mặt). <b>Không</b> tính phong bì quỹ chi tiêu 1tr, không tính tip riêng đã đưa thợ.</div>
      <div class="form-grid" style="margin-top:10px"><label>Số tiền mặt đếm được (đ)<input name="counted" inputmode="numeric" required placeholder="VD 2.350.000"></label>
      <label>Ghi chú (nếu có)<input name="note" placeholder="VD: đã đưa anh Trường 1tr"></label></div>
      <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Gửi kết ca</button></div></form>`);
    const cf = $('#cf'); cf.counted.oninput = () => { const n = cf.counted.value.replace(/\D/g, ''); cf.counted.value = n ? Number(n).toLocaleString('vi-VN') : ''; };
    cf.onsubmit = (e) => { e.preventDefault(); guard($('button.primary', cf), async () => {
      const x = await api('/pos/close', { method: 'POST', body: { counted: cf.counted.value.replace(/\D/g, ''), note: cf.note.value } });
      closeModal(); toast(x.diff == null ? 'Đã gửi kết ca. Cảm ơn bạn!' : x.diff === 0 ? 'Kết ca khớp tiền ✓' : `Kết ca lệch ${x.diff > 0 ? 'thừa' : 'thiếu'} ${money(Math.abs(x.diff))}`); reload();
    }); };
  };
  if ($('#hist')) $('#hist').onclick = async () => {
    const rows = await api('/pos/closes');
    openModal('Lịch sử kết ca 30 ngày', `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Giờ</th><th>Người kết</th><th class="num">Máy tính</th><th class="num">Đếm được</th><th class="num">Lệch</th><th>Ghi chú</th></tr></thead><tbody>
      ${rows.map((k) => `<tr><td>${dmy(k.date)}</td><td>${esc(k.created_at.slice(11, 16))}</td><td>${esc(k.user_name || '')}</td><td class="num">${money(k.expected)}</td><td class="num">${money(k.counted)}</td>
        <td class="num" style="color:${k.diff ? 'var(--bad,#c0392b)' : 'inherit'}">${k.diff ? (k.diff > 0 ? '+' : '−') + money(Math.abs(k.diff)) : 'khớp'}</td><td class="small">${esc(k.note || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Chưa có</td></tr>'}</tbody></table></div>`, true);
  };
};
// Thu tiền từ lịch hẹn: mở phiếu có sẵn dịch vụ + giá → lưu là vào doanh số. Khách vãng lai tự tạo hồ sơ.
async function checkout(a, after) {
  let c = { id: a.customer_id, code: a.customer_code || '', name: a.name };
  if (!a.customer_id) {
    c = await api(`/appointments/${a.id}/customer`, { method: 'POST' });
    toast(c.created ? `Đã tạo hồ sơ khách ${c.code} – ${c.name}` : `Nhận khách cũ ${c.code} – ${c.name} (trùng SĐT)`);
  }
  visitForm({ customer_id: c.id, customer: c, main_staff_id: a.staff_id, assistant_id: a.assistant_id || null, appointment_id: a.id, service: a.service, date: a.date, time: a.time }, after);
}
function bindApptList(root, reload, rows) {
  $$('[data-ast]', root).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/appointments/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.ast } }); reload(); })));
  const find = async (id) => (rows || (await api(`/appointments?from=${S.today}&to=${addDays(S.today, 60)}`))).find((a) => a.id === Number(id));
  $$('[data-avisit]', root).forEach((b) => (b.onclick = async () => {
    guard(b, async () => checkout(await find(b.dataset.avisit), reload));
  }));
  $$('[data-rcpt]', root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); showReceipt(Number(b.dataset.rcpt)); }));
  $$('[data-acust]', root).forEach((b) => (b.onclick = () => guard(b, async () => { const c = await api('/customers/' + b.dataset.acust); customerForm(c, () => reload()); })));
  $$('[data-apaid]', root).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/appointments/${b.dataset.apaid}/pay-note`, { method: 'POST', body: { pay_note: b.dataset.m } }); toast('Đã ghi thu: ' + b.dataset.m); reload(); refreshReminderBadge(); })));
  $$('[data-aedit]', root).forEach((b) => (b.onclick = async () => apptForm(await find(b.dataset.aedit), reload)));
  $$('[data-agrp]', root).forEach((b) => (b.onclick = () => guard(b, () => familyDay(Number(b.dataset.agrp), reload))));
  $$('[data-acancel]', root).forEach((b) => (b.onclick = async () => cancelForm(await find(b.dataset.acancel), reload)));
}

// ---------- Hủy lịch / khách không đến ----------
const CANCEL_REASONS = ['Khách bận việc đột xuất', 'Khách đổi sang ngày khác', 'Khách ốm', 'Thời tiết xấu', 'Salon/thợ báo đổi lịch', 'Không liên lạc được'];
const firstName = (n) => String(n || '').trim();
function msgCancel(a) {
  return `${S.settings.salon_name} xin chào ${firstName(a.name)}. Salon đã hủy lịch hẹn lúc ${a.time} ngày ${dmy(a.date)} theo yêu cầu của mình. Khi nào tiện, mình nhắn lại để salon giữ giờ đẹp và thợ quen cho mình nhé. Cảm ơn mình!`;
}
function msgRebook(a) {
  return a.status === 'noshow'
    ? `${S.settings.salon_name} xin chào ${firstName(a.name)}. Hôm ${dmy(a.date)} salon có giữ lịch ${a.time} nhưng chưa thấy mình ghé, mong là mọi việc đều ổn ạ. Mình muốn hẹn lại ngày nào để salon xếp lịch cho mình?`
    : `${S.settings.salon_name} xin chào ${firstName(a.name)}. Lịch hẹn ${dmy(a.date)} của mình đã được hủy. Tuần này salon còn trống vài khung giờ đẹp, mình muốn đặt lại ngày nào để salon giữ chỗ ạ?`;
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Đã copy — mở Zalo và dán (giữ ngón tay → Dán)'); }
  catch { prompt('Copy đoạn này để gửi khách:', t); }
}
function msgBox(text, phone) {
  return `<div class="totals"><div class="small muted">Tin nhắn gửi khách (sửa được):</div><textarea id="msgT" rows="7">${esc(text)}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn sm primary" id="msgCopy" type="button">📋 Copy tin nhắn</button>
    ${phone ? `<a class="btn sm" href="https://zalo.me/${esc(phone)}" target="_blank" rel="noopener">Mở Zalo khách</a><a class="btn sm" href="sms:${esc(phone)}">SMS</a>` : '<span class="small muted">Khách chưa có SĐT</span>'}</div></div>`;
}
function bindMsgBox() { const b = $('#msgCopy'); if (b) b.onclick = () => copyText($('#msgT').value); }
function cancelForm(a, reload) {
  openModal(`Hủy lịch · ${a.name}`, `<form id="cf"><div class="small muted">${esc(a.time)} ${dmy(a.date)}${a.staff_name ? ' · ' + esc(a.staff_name) : ''}${a.service ? ' · ' + esc(a.service) : ''}</div>
    <label>Loại</label><select name="status"><option value="cancelled">Khách báo hủy</option><option value="noshow">Khách không đến (không báo)</option></select>
    <label>Lý do</label><select name="pick">${CANCEL_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}<option value="">Khác (ghi bên dưới)</option></select>
    <label>Ghi thêm</label><input name="extra" placeholder="VD: hẹn lại tuần sau, khách xin dời sang 15h…">
    <div class="err"></div><div class="modal-foot"><button class="btn primary">Xác nhận hủy</button></div></form>`);
  const f = $('#cf');
  f.status.onchange = () => { if (f.status.value === 'noshow') f.pick.value = 'Không liên lạc được'; };
  f.onsubmit = (e) => {
    e.preventDefault();
    const reason = [f.pick.value, f.extra.value.trim()].filter(Boolean).join(' · ');
    if (!reason) { $('#cf .err').textContent = 'Chọn hoặc ghi lý do'; return; }
    guard($('#cf button.primary'), async () => {
      await api(`/appointments/${a.id}/status`, { method: 'POST', body: { status: f.status.value, reason } });
      const done = { ...a, status: f.status.value };
      openModal('Đã hủy lịch', `<div>Lịch <b>${esc(a.time)} ${dmy(a.date)}</b> của <b>${esc(a.name)}</b> đã chuyển sang <b>${APPT[done.status][0]}</b>.
        ${a.staff_name ? `Thợ <b>${esc(a.staff_name)}</b> và quản lý sẽ thấy ở mục <b>Nhắc nhở › Khách hủy / không đến</b>.` : ''}</div>
        ${msgBox(done.status === 'cancelled' ? msgCancel(done) : msgRebook(done), a.phone)}`);
      bindMsgBox(); refreshReminderBadge(); reload && reload();
    });
  };
}

// ---------- Hóa đơn ----------
async function showReceipt(id) {
  let r;
  try { r = await api(`/visits/${id}/receipt`); } catch (e) { return toast(e.message); }
  const v = r.visit, s = r.salon;
  const line = (l, val, b) => `<div class="rc-row${b ? ' b' : ''}"><span>${l}</span><span>${val}</span></div>`;
  const paid = v.cash_paid;
  const html = `<div id="receipt" class="receipt">
    <div class="rc-c"><b class="rc-name">${esc(s.name)}</b>${s.address ? `<div>${esc(s.address)}</div>` : ''}${s.phone ? `<div>ĐT: ${esc(s.phone)}</div>` : ''}</div>
    <div class="rc-c rc-title">HÓA ĐƠN DỊCH VỤ</div>
    ${line('Số', esc(v.code))}${line('Ngày', `${dmy(v.date)} ${esc(v.time || '')}`)}
    ${line('Khách', esc(v.customer_name))}${line('Thợ', esc(v.main_staff_name || '') + (v.assistant_name ? ' + ' + esc(v.assistant_name) : ''))}
    <hr>${v.items.map((i) => line(esc(i.name), money(i.price))).join('')}
    ${v.surcharge ? line('Phụ thu', money(v.surcharge)) : ''}${v.discount ? line('Giảm giá' + (v.discount_reason ? ` (${esc(v.discount_reason)})` : ''), '−' + money(v.discount)) : ''}
    <hr>${line('Tổng dịch vụ', money(v.total), true)}
    ${v.card_paid ? line(`Trừ thẻ ${esc(v.card_code || '')}`, '−' + money(v.card_paid)) : ''}
    ${line('Khách thanh toán', money(paid), true)}${v.payment_method && paid ? line('Hình thức', esc(v.payment_method)) : ''}
    ${v.debt ? line(v.debt_paid_at ? `Đã trả nợ ${dmy(v.debt_paid_at)}` : 'CÒN NỢ', money(v.debt), true) : ''}
    ${v.tip ? line('Tip cho thợ', money(v.tip)) : ''}
    ${v.tip_private ? line('Tip riêng · ' + esc(staffName(v.tip_private_to)), money(v.tip_private)) : ''}
    ${r.card_balance != null ? line(`Số dư thẻ còn lại`, money(r.card_balance), true) : ''}
    ${s.bank_info && paid ? `<hr><div class="rc-c small">${esc(s.bank_info)}</div>` : ''}
    ${v.warranties && v.warranties.length ? `<hr><div class="small"><b>BẢO HÀNH</b>${warrantyLines(v.warranties).map((l) => `<div>${esc(l)}</div>`).join('')}<div class="muted">${esc(WARRANTY_EXCLUDE)}</div></div>` : ''}
    <hr><div class="rc-c">${esc(s.footer || 'Cảm ơn quý khách!')}</div></div>`;
  const text = [`${s.name} – HÓA ĐƠN ${v.code}`, `Ngày: ${dmy(v.date)} ${v.time || ''}`, `Khách: ${v.customer_name}`, '',
    ...v.items.map((i) => `• ${i.name}: ${money(i.price)}`),
    v.surcharge ? `• Phụ thu: ${money(v.surcharge)}` : '', v.discount ? `• Giảm giá: −${money(v.discount)}` : '',
    `Tổng dịch vụ: ${money(v.total)}`, v.card_paid ? `Trừ thẻ: −${money(v.card_paid)}` : '', `Thanh toán: ${money(paid)}${v.payment_method && paid ? ' (' + v.payment_method + ')' : ''}`, v.debt && !v.debt_paid_at ? `Còn nợ: ${money(v.debt)}` : '',
    r.card_balance != null ? `Số dư thẻ còn lại: ${money(r.card_balance)}` : '',
    ...(v.warranties && v.warranties.length ? ['', 'BẢO HÀNH:', ...warrantyLines(v.warranties), WARRANTY_EXCLUDE] : []), '', s.footer || ''].filter((x, i, arr) => x !== '' || (arr[i - 1] !== '' && i > 0)).join('\n');
  openModal('Hóa đơn ' + v.code, html + `<div class="modal-foot"><button class="btn" id="rcPrint">🖨 In</button><button class="btn primary" id="rcCopy">📋 Copy gửi Zalo</button>
    ${v.customer_phone ? `<a class="btn" href="https://zalo.me/${esc(v.customer_phone)}" target="_blank" rel="noopener">Mở Zalo khách</a>` : ''}</div>`);
  $('#rcPrint').onclick = () => window.print();
  $('#rcCopy').onclick = () => copyText(text);
}

// ---------- Lịch hẹn ----------
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const wday = (d) => WD[new Date(d + 'T00:00:00').getDay()];
const toMin = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
VIEWS.appointments = async (main) => {
  const date = S.params.date || S.today;
  const mine = S.params.mine === '1';
  const mode = S.params.view || 'grid';
  const reload = () => VIEWS.appointments(main);
  const set = (p) => go('appointments', { date, ...(mine ? { mine: '1' } : {}), ...(mode !== 'grid' ? { view: mode } : {}), ...p });
  const top = header('Lịch hẹn', `${wday(date)} ${dmy(date)}`, `<button class="btn primary" id="newAppt">+ Đặt lịch</button>`) +
    `<div class="card"><div class="row"><button class="btn sm" id="prev">‹</button><input type="date" id="d" value="${date}" style="width:auto"><button class="btn sm" id="next">›</button>
    <button class="btn sm" id="tod">Hôm nay</button><span class="spacer"></span>
    <button class="btn sm ${mine ? 'primary' : ''}" id="mine">${mine ? '✓ ' : ''}Lịch của tôi</button>
    <button class="btn sm" id="mode">${mode === 'grid' ? '☰ Danh sách' : '▦ Bảng giờ'}</button></div></div>`;
  let body;
  if (mode === 'list' || mine) {
    // Danh sách 7 ngày (lịch của tôi) hoặc danh sách trong ngày
    const to = mine ? addDays(date, 6) : date;
    let rows = await api(`/appointments?from=${date}&to=${to}${mine ? '&staff_id=' + S.me.id : ''}`);
    const sc = mine ? null : await api('/schedule?date=' + date);
    body = `<div class="card"><h3>${mine ? `Lịch của ${esc(S.me.full_name)} · 7 ngày từ ${dmy(date)}` : dmy(date)} · ${rows.filter((r) => !['cancelled', 'noshow'].includes(r.status)).length} lịch</h3>${apptList(rows, mine)}</div>
      ${sc && sc.visits.length ? `<div class="card"><h3>✓ Khách đã làm (không qua lịch hẹn) · ${sc.visits.length}</h3>${sc.visits.map(visitChipLine).join('')}</div>` : ''}`;
    main.innerHTML = top + (sc ? daySum(rows, sc.visits, sc.money) : '') + body;
    bindApptList(main, reload, rows);
    $$('[data-dmv]', main).forEach((a) => (a.onclick = async (e) => { e.preventDefault(); visitForm(await api('/visits/' + a.dataset.dmv), reload); }));
  } else {
    const sc = await api('/schedule?date=' + date);
    main.innerHTML = top + daySum(sc.appointments, sc.visits, sc.money) + `<div class="card grid-card">${scheduleGrid(sc)}</div>
      <div class="small muted" style="margin:0 4px 12px">Bấm ô trống để đặt lịch · bấm lịch để Thu tiền / Sửa / Hủy. <span class="chip-k brand">Đã đặt</span> <span class="chip-k warn">Đã đến</span> <span class="chip-k ok">Đã làm</span> <span class="chip-k help">↪ Làm/phụ trong phiếu người khác</span> <span class="chip-k off">Nghỉ</span></div>`;
    $$('[data-slot]', main).forEach((td) => (td.onclick = (e) => {
      if (e.target.closest('[data-ap],[data-vv]')) return;
      const [time, staff] = td.dataset.slot.split('|');
      apptForm({ date, time, staff_id: Number(staff) || null }, reload);
    }));
    $$('[data-ap]', main).forEach((el) => (el.onclick = () => {
      const a = sc.appointments.find((x) => x.id === Number(el.dataset.ap));
      openModal(`${a.time} · ${a.name}`, `<div id="oneAp">${apptList([a])}</div>`);
      bindApptList($('#oneAp'), () => { closeModal(); reload(); }, [a]);
    }));
    $$('[data-vv]', main).forEach((el) => (el.onclick = () => go('customer', { id: el.dataset.vv })));
    $$('[data-dmv]', main).forEach((a) => (a.onclick = async (e) => { e.preventDefault(); visitForm(await api('/visits/' + a.dataset.dmv), reload); }));
  }
  $('#prev').onclick = () => set({ date: addDays(date, -1) }); $('#next').onclick = () => set({ date: addDays(date, 1) });
  $('#tod').onclick = () => set({ date: S.today }); $('#d').onchange = (e) => set({ date: e.target.value });
  $('#mine').onclick = () => go('appointments', { date, ...(mine ? {} : { mine: '1' }) });
  $('#mode').onclick = () => go('appointments', { date, ...(mode === 'grid' ? { view: 'list' } : {}) });
  $('#newAppt').onclick = () => apptForm({ date }, reload);
};
function visitChipLine(v) {
  return `<div class="list-item"><div class="time-pill">${esc(v.time || '')}</div><div style="flex:1"><a href="#customer?id=${v.customer_id}"><b>${esc(v.customer_name)}</b></a>
    <div class="small muted">${esc(v.services || '')} · ${esc(staffName(v.main_staff_id))}${v.assistant_id ? ' + ' + esc(staffName(v.assistant_id)) : ''}</div></div>
    <div style="text-align:right">${v.total != null ? `<b>${money(v.total)}</b><br>` : ''}<span class="badge ok">Đã làm</span></div></div>`;
}
const evMoney = (a) => a.visit_id && a.visit_total != null ? `<div class="small"><b>✓ ${money(a.visit_total)}</b></div>`
  : !['cancelled', 'noshow'].includes(a.status) && estTotal(a.service) ? `<div class="small">~${money(estTotal(a.service))}</div>` : '';
// Tổng tiền trong ngày: đã thu (lượt đã lưu) + còn dự kiến (lịch chưa thu)
function daySum(appts, visits, M) {
  const est = appts.filter((a) => ['booked', 'arrived'].includes(a.status) && !a.visit_id).reduce((t, a) => t + estTotal(a.service), 0);
  if (M) return dayMoneyCard(M, est);
  const got = appts.reduce((t, a) => t + (a.visit_id ? Number(a.visit_total || 0) : 0), 0) + visits.reduce((t, v) => t + Number(v.total || 0), 0);
  const n = appts.filter((a) => a.visit_id).length + visits.length;
  return `<div class="card daysum"><div><span class="muted small">Đã thu (${n} lượt)</span><b>${money(got)}</b></div><div><span class="muted small">Còn dự kiến (lịch chưa thu)</span><b>${money(est)}</b></div>
    <div><span class="muted small">Cả ngày nếu thu đủ</span><b>${money(got + est)}</b></div></div>`;
}
// Lãnh đạo: tiền trong ngày tách rõ trước/sau trừ thẻ, TM/CK, tip từng khách, chi trong ngày
function dayMoneyCard(M, est) {
  const by = M.by_method || {};
  const cashK = Object.keys({ ...by, ...M.tip_by_method }).filter((k) => /mặt/i.test(k));
  const ckK = Object.keys({ ...by, ...M.tip_by_method }).filter((k) => /khoản|ck/i.test(k));
  const sumK = (o, ks) => ks.reduce((t, k) => t + (o[k] || 0), 0);
  const other = Object.entries(by).filter(([k]) => !cashK.includes(k) && !ckK.includes(k) && by[k]);
  const minus = [[M.gift, 'thẻ tri ân'], [M.prepaid, 'thẻ trả trước'], [M.unpaid, 'chưa thu']].filter(([v]) => v > 0);
  const cashTip = sumK(M.tip_by_method, cashK), ckTip = sumK(M.tip_by_method, ckK);
  const extra = [M.card_sales ? `bán thẻ ${money(M.card_sales)}` : '', M.debt_in ? `thu nợ cũ ${money(M.debt_in)}` : ''].filter(Boolean).join(' · ');
  return `<div class="card"><div class="grid kpis" style="margin:0">
      <div class="kpi"><div class="l">Tổng hóa đơn (${M.invoices} lượt)</div><div class="v">${money(M.total)}</div><div class="s">trước trừ thẻ${M.discounts ? ` · đã giảm ${money(M.discounts)}` : ''}</div></div>
      <div class="kpi"><div class="l">Thực thu (sau trừ thẻ)</div><div class="v">${money(M.real)}</div><div class="s">${minus.length ? minus.map(([v, l]) => `− ${l} ${money(v)}`).join('<br>') : 'không trừ thẻ'}</div></div>
      <div class="kpi"><div class="l">💵 Tiền mặt</div><div class="v">${money(sumK(by, cashK) + cashTip)}</div><div class="s">${cashTip ? `gồm tip ${money(cashTip)}` : 'không có tip'}</div></div>
      <div class="kpi"><div class="l">🏦 Chuyển khoản</div><div class="v">${money(sumK(by, ckK) + ckTip)}</div><div class="s">${ckTip ? `gồm tip ${money(ckTip)}` : 'không có tip'}</div></div>
      <div class="kpi"><div class="l">Chi trong ngày</div><div class="v">${money(M.expense_total)}</div><div class="s">${M.expense_shop_cash !== M.expense_total ? `TM tại tiệm ${money(M.expense_shop_cash)} · nguồn khác ${money(M.expense_total - M.expenses.filter((e) => e.source === 'fund').reduce((t, e) => t + e.amount, 0))}` : `${M.expenses.length} khoản, lấy TM tại tiệm`}</div></div></div>
    <div class="small" style="margin-top:8px;display:grid;gap:4px">
      <div>💝 <b>Tip ${money(M.tips)}</b>: ${M.tip_list.length ? M.tip_list.map((t) => `<a href="#" data-dmv="${t.id}">${esc(t.name)}</a> ${money(t.tip)} <span class="muted">(${esc(/mặt/i.test(t.method) ? 'TM' : /khoản|ck/i.test(t.method) ? 'CK' : t.method)})</span>`).join(' · ') : '<span class="muted">không có</span>'}</div>
      <div>🧾 <b>Chi ${money(M.expense_total)}</b>: ${M.expenses.length ? M.expenses.map((e) => `${esc((e.note || e.category || 'Chi').replace(/ · từ sổ đặt lịch$/, ''))} ${money(e.amount)}${e.source !== 'fund' ? ` <span class="muted">(${e.source === 'staff' ? esc(e.by_name || 'NV') + ' ứng' : 'chủ trả'})</span>` : ''}${e.spread_months > 1 ? ` <span class="muted">(chia ${e.spread_months} th)</span>` : ''}${e.status === 'pending' ? ' <span class="muted">(chờ duyệt)</span>' : ''}`).join(' · ') : '<span class="muted">không có</span>'}${M.reimbursed.length ? ` · hoàn ứng TM: ${M.reimbursed.map((x) => `${esc(x.by_name || '')} ${money(x.amount)}`).join(', ')}` : ''}</div>
      ${M.other_income && M.other_income.length ? `<div>🧧 <b>Thu khác ${money(M.other_income.reduce((t, x) => t + x.amount, 0))}</b> <span class="muted">(không phải tip, không tính doanh số thợ)</span>: ${M.other_income.map((x) => `${esc(x.kind)}${x.note ? ' – ' + esc(x.note) : ''} ${money(x.amount)} <span class="muted">(${/chuy/i.test(x.method || '') ? 'CK' : 'TM'})</span>`).join(' · ')}</div>` : ''}
      <div>💵 <b>Tiền mặt sau chi: ${money(sumK(by, cashK) + cashTip - M.expense_shop_cash)}</b> <span class="muted">= TM thu ${money(sumK(by, cashK) + cashTip)} − chi lấy TM tại tiệm ${money(M.expense_shop_cash)}</span></div>
      ${other.length || extra || est ? `<div class="muted">${[other.map(([k, v]) => `${esc(k)} ${money(v)}`).join(' · '), extra, est ? `lịch chưa thu dự kiến ~${money(est)}` : ''].filter(Boolean).join(' · ')}</div>` : ''}
    </div></div>`;
}
function scheduleGrid(sc) {
  const live = (a) => !['cancelled', 'noshow'].includes(a.status);
  const ids = new Set(activeStaff().filter((u) => u.role !== 'owner').map((u) => u.id));
  for (const a of sc.appointments) if (a.staff_id) ids.add(a.staff_id);
  for (const v of sc.visits) if (v.main_staff_id) ids.add(v.main_staff_id);
  const helps = sc.helps || [];
  for (const h of helps) ids.add(h.staff_id);
  const cols = [...ids].map((id) => ({ id, name: staffName(id) }));
  const hasNone = sc.appointments.some((a) => !a.staff_id && live(a));
  if (hasNone) cols.push({ id: 0, name: 'Chưa chọn thợ' });
  const times = [...sc.appointments.map((a) => toMin(a.time)), ...sc.visits.map((v) => toMin(v.time))].filter((x) => x != null);
  const start = Math.min(9 * 60, ...times.map((t) => t - (t % 30))), end = Math.max(20 * 60 + 30, ...times);
  const slot = (t) => t - (t % 30);
  const offOf = (uid, t) => sc.offs.find((o) => o.user_id === uid && o.status === 'approved' && (!o.from_time || (t + 30 > toMin(o.from_time) && t < toMin(o.to_time))));
  let html = `<div class="table-wrap sched"><table><thead><tr><th class="tcol">Giờ</th>${cols.map((c) => {
    const off = sc.offs.find((o) => o.user_id === c.id && o.status === 'approved');
    return `<th class="${c.id === S.me.id ? 'me' : ''}">${esc(c.name)}${off ? `<div class="small" style="color:var(--bad)">Nghỉ ${off.from_time ? off.from_time + '–' + off.to_time : 'cả ngày'}</div>` : ''}</th>`;
  }).join('')}</tr></thead><tbody>`;
  const noTime = sc.visits.filter((v) => toMin(v.time) == null);
  if (noTime.length) {
    html += `<tr><td class="tcol small">Không ghi giờ</td>` + cols.map((c) => `<td>${noTime.filter((v) => v.main_staff_id === c.id)
      .map((v) => `<div class="ev done" data-vv="${v.customer_id}"><b>✓</b> ${esc(v.customer_name)}<div class="small">${esc(v.services || '')}</div>${v.total != null ? `<div class="small"><b>${money(v.total)}</b></div>` : ''}</div>`).join('')}</td>`).join('') + '</tr>';
  }
  for (let t = start; t <= end; t += 30) {
    html += `<tr><td class="tcol">${fromMin(t)}</td>` + cols.map((c) => {
      const ap = sc.appointments.filter((a) => (a.staff_id || 0) === c.id && slot(toMin(a.time)) === t);
      const vs = sc.visits.filter((v) => v.main_staff_id === c.id && slot(toMin(v.time)) === t);
      const hs = helps.filter((h) => h.staff_id === c.id && slot(toMin(h.time)) === t);
      const off = c.id && offOf(c.id, t);
      const inner = ap.map((a) => `<div class="ev ${a.status}" data-ap="${a.id}"><b>${esc(a.time)}</b> ${esc(a.name)}${a.grp ? ` <span title="Đi cùng người nhà: ${a.grp} người">👨‍👩‍👧</span>` : ''}${a.visit_services || a.service ? `<div class="small">${a.visit_services ? esc(a.visit_services) : svcWithPrice(a.service)}</div>` : ''}${evMoney(a)}</div>`).join('')
        + vs.map((v) => `<div class="ev done" data-vv="${v.customer_id}"><b>✓ ${esc(v.time || '')}</b> ${esc(v.customer_name)}<div class="small">${esc(v.services || '')}</div>${v.total != null ? `<div class="small"><b>${money(v.total)}</b></div>` : ''}</div>`).join('')
        + hs.map((h) => `<div class="ev help" data-vv="${h.customer_id}" title="Dòng dịch vụ trong phiếu của ${esc(staffName(h.main_staff_id))} – tiền tính ở phiếu đó"><b>↪ ${esc(h.time || '')}</b> ${esc(h.customer_name)}<div class="small">${esc(h.lines.join(' + '))}</div><div class="small muted">phiếu của ${esc(staffName(h.main_staff_id))}</div></div>`).join('');
      return `<td class="${off ? 'offc' : ''} ${c.id === S.me.id ? 'me' : ''}" data-slot="${fromMin(t)}|${c.id}">${inner || (off ? '<span class="small">Nghỉ</span>' : '')}</td>`;
    }).join('') + '</tr>';
  }
  return html + '</tbody></table></div>';
}
const splitSvc = (t) => String(t || '').split(/\s*\+\s*|\s*,\s*/).map((x) => x.trim()).filter(Boolean);
// Tìm dịch vụ trong bảng giá theo tên (không phân biệt hoa thường, chấp nhận tên gần đúng)
const norm = (t) => String(t || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
function findSvc(n) {
  const k = norm(n); if (!k) return null;
  const act = S.services.filter((x) => x.active);
  return act.find((x) => norm(x.name) === k) || act.find((x) => norm(x.name).startsWith(k)) || act.find((x) => k.startsWith(norm(x.name))) || null;
}
const svcPrice = (n) => { const x = findSvc(n); return x ? x.price : 0; };
const estTotal = (text) => splitSvc(text).reduce((t, n) => t + svcPrice(n), 0);
const kMoney = (v) => (v >= 1000 ? (v / 1000).toLocaleString('vi-VN') + 'k' : money(v));
// Dòng dịch vụ kèm giá: "Cắt nữ 150k + Gội 50k"
const svcWithPrice = (text) => splitSvc(text).map((n) => { const p = svcPrice(n); return esc(n) + (p ? ` <span class="price">${kMoney(p)}</span>` : ''); }).join(' + ');
// ---------- Kho: hóa chất & sản phẩm ----------
const matById = (id) => S.materials.find((m) => m.id === Number(id));
const matUnit = (m) => (m && m.size ? m.size_unit : (m && m.unit ? m.unit.split(' ')[0].toLowerCase() : 'đv'));
// lượng nhập trên phiếu (ml/g, hoặc số tuýp/chai nếu chưa có dung tích) ↔ số đơn vị kho
const toUnits = (m, amt) => (m && m.size ? Number(amt) / m.size : Number(amt));
const fromUnits = (m, q) => Math.round((m && m.size ? q * m.size : q) * 100) / 100;
const matOptions = (kind, sel) => {
  const list = S.materials.filter((m) => m.kind === kind && (m.active || m.id === sel));
  const groups = [...new Set(list.map((m) => m.grp || 'Khác'))];
  return groups.map((g) => `<optgroup label="${esc(g)}">${list.filter((m) => (m.grp || 'Khác') === g).map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</optgroup>`).join('');
};
const SVC_MIN = { 'Cắt': 45, 'Gội & chăm sóc': 30, 'Hóa chất': 120, 'Bán sản phẩm': 0 }; // thời lượng gợi ý
function apptForm(a = {}, after, onSaved) {
  const isEdit = !!a.id;
  openModal(isEdit ? 'Sửa lịch hẹn' : 'Đặt lịch hẹn', `<form id="af"><div class="form-grid">
    <div class="full"><label>Khách hàng có sẵn</label>${customerPicker('customer_id', a.customer_id ? { id: a.customer_id, code: a.customer_code || '', name: a.name } : null)}</div>
    <div><label>…hoặc tên khách mới</label><input name="guest_name" value="${esc(a.customer_id ? '' : a.guest_name || a.name || '')}"></div>
    <div><label>SĐT khách mới</label><input name="guest_phone" inputmode="tel" value="${esc(a.customer_id ? '' : a.guest_phone || a.phone || '')}"><div class="small" id="gpHit"></div></div>
    <div><label>Ngày</label><input type="date" name="date" value="${a.date || S.today}" required></div>
    <div><label>Giờ</label><input type="time" name="time" value="${a.time || '09:00'}" step="900" required></div>
    <div><label>Thợ làm chính</label><select name="staff_id">${staffOptions(a.staff_id, 'Chưa chọn')}</select></div>
    <div><label>Thời lượng (phút)</label><input type="number" name="duration" value="${a.duration || 60}" min="15" step="15"></div>
    <div><label>Người nhận lịch</label><select name="taken_by">${(() => { const sel = a.taken_by || (isEdit ? null : S.me.id); const list = S.staff.filter((x) => x.active || x.id === sel);
      if (!list.some((x) => x.id === S.me.id)) list.unshift({ id: S.me.id, full_name: S.me.full_name });
      return '<option value="">Không rõ</option>' + list.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.full_name)}</option>`).join(''); })()}</select></div>
    <div class="full"><label>Dịch vụ dự kiến (chọn được nhiều)</label><div id="svcChips" class="chips"></div>
      <div class="row"><div style="flex:1;min-width:200px" id="aSvcS"></div><select id="svcAdd" style="flex:1"><option value="">+ Thêm dịch vụ…</option>${S.groups.map((g) => `<optgroup label="${esc(g)}">${S.services.filter((x) => x.active && x.grp === g).map((x) => `<option>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
      <input type="hidden" name="service" value="${esc(a.service || '')}"></div>
    ${isEdit ? `<div class="full"><label>Trạng thái</label><select name="status">${Object.entries(APPT).map(([k, v]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>` : ''}
    <div class="full"><label>Ghi chú</label><textarea name="note">${esc(a.note || '')}</textarea></div></div>
    ${isEdit && !a.visit_id ? '<div class="full small muted">💡 Chọn trạng thái <b>Hoàn thành</b> rồi Lưu (hoặc bấm <b>💰 Thu tiền</b>) → phiếu thu mở sẵn dịch vụ + giá, lưu là tự vào doanh số.</div>' : ''}
    <div class="err"></div><div class="modal-foot">${isEdit && !a.visit_id && !['cancelled', 'noshow'].includes(a.status) ? '<button type="button" class="btn" id="afPay">💰 Thu tiền</button><span class="spacer"></span>' : ''}<button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu lịch hẹn</button></div></form>`);
  bindPicker($('#af'), async (cid) => {
    const st = $('#af [name=staff_id]');
    if (st.value) return;
    try { const b = await api(`/customers/${cid}/brief`); if (b.staff_id) { st.value = b.staff_id; toast('Đã chọn thợ phụ trách: ' + b.staff_name); } } catch { /* bỏ qua */ }
  });
  // Gõ SĐT khách mới: đã có trong danh bạ thì báo, lưu lịch sẽ tự gắn vào hồ sơ khách cũ
  const gp = $('#af [name=guest_phone]');
  let gpT;
  const gpCheck = () => { clearTimeout(gpT); const q = gp.value.replace(/\D/g, ''); if (q.length < 9) { $('#gpHit').innerHTML = ''; return; }
    gpT = setTimeout(async () => { const cs = await api('/customers?limit=3&q=' + q).catch(() => []); const list = Array.isArray(cs) ? cs : cs.rows || [];
      const hit = list.find((c) => String(c.phone || '').replace(/\D/g, '').endsWith(q.slice(-9)));
      $('#gpHit').innerHTML = hit ? `<span style="color:var(--ok)">✓ Đã có khách <b>${esc(hit.name)}</b> (${esc(hit.code || '')}) – lịch sẽ gắn vào hồ sơ này, không tạo khách mới</span>` : ''; }, 300); };
  gp.addEventListener('input', gpCheck); gpCheck();
  const svcIn = $('#af [name=service]');
  let chosen = splitSvc(svcIn.value);
  const drawChips = () => {
    svcIn.value = chosen.join(' + ');
    $('#svcChips').innerHTML = (chosen.map((n, i) => `<span class="chip">${esc(n)}${svcPrice(n) ? ` <span class="price">${kMoney(svcPrice(n))}</span>` : ''}<button type="button" data-rm="${i}" aria-label="Bỏ">×</button></span>`).join('') || '<span class="small muted">Chưa chọn dịch vụ</span>')
      + (chosen.length ? `<span class="chip-total">Dự kiến: <b>${money(estTotal(chosen.join(' + ')))}</b></span>` : '');
    $$('[data-rm]', $('#svcChips')).forEach((b) => (b.onclick = () => { chosen.splice(Number(b.dataset.rm), 1); drawChips(); }));
    const mins = chosen.reduce((t, n) => t + (SVC_MIN[(S.services.find((x) => x.name === n) || {}).grp] || 0), 0);
    if (mins && !a.id) $('#af [name=duration]').value = Math.max(30, mins);
  };
  const ass = svcSearch('aSvcQ', (sv) => { if (!chosen.includes(sv.name)) chosen.push(sv.name); drawChips(); });
  $('#aSvcS').innerHTML = ass.html; ass.bind();
  $('#svcAdd').onchange = (e) => { if (e.target.value && !chosen.includes(e.target.value)) chosen.push(e.target.value); e.target.value = ''; drawChips(); };
  drawChips();
  $('#af').onsubmit = (e) => {
    e.preventDefault();
    const btn = $('#af button.primary');
    guard(btn, async () => {
      await saveAppt(body0().status === 'done' && !a.visit_id);
    });
  };
  const body0 = () => formData($('#af'));
  // pay=true: lưu lịch (giữ "Đã đến"), rồi mở phiếu thu có sẵn dịch vụ + giá để ghi doanh số
  const saveAppt = async (pay) => {
    const body = body0();
    if (pay && body.status === 'done') body.status = 'arrived';
    const send = (force) => api(isEdit ? '/appointments/' + a.id : '/appointments', { method: isEdit ? 'PUT' : 'POST', body: { ...body, force } });
    let saved;
    try { saved = await send(false); } catch (er) { if (er.data && er.data.clash && confirm(er.message)) saved = await send(true); else throw er; }
    if (onSaved && saved && saved.id) await onSaved(saved.id);
    closeModal(); refreshReminderBadge();
    if (!pay) { toast('Đã lưu lịch hẹn'); return (after || route)(); }
    const fresh = (await api(`/appointments?from=${body.date}&to=${body.date}`)).find((x) => x.id === a.id) || { ...a, ...body };
    await checkout(fresh, after || route);
  };
  const pb = $('#afPay');
  if (pb) pb.onclick = () => guard(pb, () => saveAppt(true));
}

VIEWS.chat = async (main) => {
  const day = /^\d{4}-\d\d-\d\d$/.test(S.params.date || '') ? S.params.date : S.today, isToday = day === S.today;
  const [info, first] = await Promise.all([api('/chat/days'), api('/chat?date=' + day)]);
  let msgs = first;
  const days = info.days.some((d) => d.date === S.today) ? info.days : [{ date: S.today, n: 0, appts: 0, pending: 0 }, ...info.days];
  const dayLabel = (d) => d === S.today ? 'Hôm nay' : d === addDays(S.today, -1) ? 'Hôm qua' : dmy(d).slice(0, 5);
  const autoBtn = isMgr() ? `<button class="btn sm ${info.auto ? 'primary' : ''}" id="chatAuto" title="Bật: tin nào đủ tên khách + ngày + giờ thì app tự tạo lịch, không cần bấm">⚡ Tự tạo lịch: <b>${info.auto ? 'BẬT' : 'TẮT'}</b></button>` : '';
  main.innerHTML = header('Chat nội bộ', (info.auto ? '⚡ Đang bật tự tạo lịch. ' : '') + 'Nhắn tự nhiên, app tự gợi ý việc: “chị Lan mai 9h nhuộm với Dương” → lịch hẹn · “mua đá 30k” → chi quỹ · “hết dầu gội Milbon” → báo kho · “mai em xin nghỉ” → lịch off · “c Lan đến rồi” → khách đã đến · gõ @Tên để gọi người', `<button class="btn sm" id="chatBell">🔔 Thông báo</button>` + autoBtn) +
    `<div class="chat-days">${days.map((d) => `<a class="chip ${d.date === day ? 'on' : ''}" href="#chat?date=${d.date}">${dayLabel(d.date)}${d.n ? ` <span class="muted">${d.n}</span>` : ''}${d.pending ? ` <span class="badge warn">${d.pending} chờ tạo</span>` : ''}${d.appts ? ` <span class="badge ok">${d.appts} lịch</span>` : ''}</a>`).join('')}</div>
    <div class="card chat-sum" id="chatSum"></div>
    <div class="card chat-box"><div id="chatList" class="chat-list"></div>
    <div id="chatAt" class="row hidden" style="gap:4px;margin-bottom:6px"></div>
    <form id="chatF" class="chat-input"><button type="button" class="btn mic" id="chatMic" title="Nói để nhập tin">🎤</button><textarea name="body" rows="1" placeholder="${isToday ? 'Nhập tin hoặc bấm 🎤…' : 'Đang xem ngày cũ, tin gửi sẽ vào Hôm nay'}" maxlength="2000"></textarea><button class="btn primary">Gửi</button></form>
    <div class="small muted" style="margin-top:6px">🔒 Tin nhắn lưu trên máy chủ riêng của tiệm, tự xóa sau ${esc(String(S.settings.chat_keep_days || 90))} ngày. Không gửi mật khẩu, số tài khoản, lương thưởng vào đây.</div></div>`;
  const list = $('#chatList');
  const timeOf = (c) => { const d = c.slice(0, 10); return (d === S.today ? '' : dmy(d).slice(0, 5) + ' ') + c.slice(11, 16); };
  const draw = (keepPos) => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.innerHTML = msgs.length ? msgs.map((m, i) => { const mine = m.user_id === S.me.id; const same = i && msgs[i - 1].user_id === m.user_id;
      return `<div class="chat-msg ${mine ? 'mine' : ''} ${(m.mentions || []).includes(S.me.id) ? 'to-me' : ''}">${same ? '' : `<div class="small muted">${mine ? 'Bạn' : `<b>${esc(m.user_name)}</b>`}</div>`}
        <div class="bubble">${chatBody(m)}<span class="t">${timeOf(m.created_at)}${mine || isMgr() ? ` <a href="#" data-del="${m.id}" title="Xóa">✕</a>` : ''}</span></div>${chatDraftCard(m)}</div>`; }).join('')
      : `<div class="empty">${isToday ? 'Hôm nay chưa có tin nhắn. Gõ thử “chị Lan 0912345678 mai 9h nhuộm với Dương”.' : 'Ngày này không có tin nhắn.'}</div>`;
    if (!keepPos || atBottom) list.scrollTop = list.scrollHeight;
    bind();
  };
  const upd = (m) => { const i = msgs.findIndex((x) => x.id === m.id); if (i >= 0) msgs[i] = m; draw(true); };
  const link = async (m, id) => upd(await api(`/chat/${m.id}/link`, { method: 'POST', body: { appointment_id: id } }));
  const bind = () => {
    $$('[data-mk]', list).forEach((b) => (b.onclick = () => guard(b, async () => {
      const m = msgs.find((x) => x.id === Number(b.dataset.mk)); const d = m.draft;
      const body = { customer_id: d.customer_id || '', guest_name: d.customer_id ? '' : d.name, guest_phone: d.customer_id ? '' : d.phone || '', date: d.date, time: d.time, staff_id: d.staff_id || '', service: d.service || '', note: 'Từ chat: ' + m.body.slice(0, 200) };
      const send = (force) => api('/appointments', { method: 'POST', body: { ...body, force } });
      let r; try { r = await send(false); } catch (er) { if (er.data && er.data.clash && confirm(er.message)) r = await send(true); else throw er; }
      await link(m, r.id); toast(`Đã tạo lịch ${dmy(d.date)} ${d.time}`); refreshReminderBadge();
    })));
    $$('[data-ed]', list).forEach((b) => (b.onclick = () => {
      const m = msgs.find((x) => x.id === Number(b.dataset.ed)); const d = m.draft;
      apptForm({ customer_id: d.customer_id, name: d.name, guest_name: d.name, guest_phone: d.phone, phone: d.phone, date: d.date, time: d.time, staff_id: d.staff_id, service: d.service, note: 'Từ chat: ' + m.body.slice(0, 200) },
        () => VIEWS.chat(main), async (id) => { await api(`/chat/${m.id}/link`, { method: 'POST', body: { appointment_id: id } }); });
    }));
    $$('[data-ak]', list).forEach((b) => (b.onclick = () => guard(b, async () => {
      const card = b.closest('.chat-card'); const input = {};
      $$('[data-af]', card).forEach((x) => { input[x.dataset.af] = x.dataset.af === 'amount' ? Number(String(x.value).replace(/\D/g, '')) : x.value; });
      const m = await api(`/chat/${b.dataset.ak}/act`, { method: 'POST', body: input }); upd(m); toast(m.action_done ? m.action_done.text : 'Đã ghi'); refreshReminderBadge();
    })));
    $$('[data-ax]', list).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/chat/${b.dataset.ax}/act-dismiss`, { method: 'POST', body: {} }); const m = msgs.find((x) => x.id === Number(b.dataset.ax)); m.action = null; draw(true); })));
    $$('[data-dm]', list).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/chat/${b.dataset.dm}/dismiss`, { method: 'POST', body: {} }); const m = msgs.find((x) => x.id === Number(b.dataset.dm)); m.draft = null; draw(true); })));
    $$('[data-del]', list).forEach((a) => (a.onclick = async (e) => { e.preventDefault(); if (!confirm('Xóa hẳn tin nhắn này?')) return; await api('/chat/' + a.dataset.del, { method: 'DELETE' }); msgs = msgs.filter((x) => x.id !== Number(a.dataset.del)); draw(true); }));
  };
  // Tóm tắt ngày bằng AI
  const sumBox = $('#chatSum');
  const drawSum = (s) => {
    sumBox.innerHTML = s ? `<details ${s.date === day ? 'open' : ''}><summary><b>🤖 Tóm tắt ${dayLabel(day).toLowerCase()}</b> <span class="small muted">· ${s.msg_count} tin · ${esc(s.by_name || '')} ${esc(String(s.created_at || '').slice(11, 16))}</span></summary>
        <div class="sum-body">${esc(s.body).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>
        <div class="row" style="margin-top:6px"><button class="btn sm" id="sumGo">↻ Tóm tắt lại${s.msg_count < msgs.length ? ` (có ${msgs.length - s.msg_count} tin mới)` : ''}</button></div></details>`
      : `<div class="row" style="justify-content:space-between"><span class="small muted">${msgs.length ? `${msgs.length} tin nhắn ${dayLabel(day).toLowerCase()}` : 'Chưa có tin để tóm tắt'}</span>
        ${msgs.length ? `<button class="btn sm" id="sumGo">🤖 AI tóm tắt ngày</button>` : ''}</div>`;
    const b = $('#sumGo');
    if (b) b.onclick = () => {
      if (!info.ai) { toast(isOwner() ? 'Chưa có khóa AI: vào Cài đặt › Tham số để nhập khóa Claude' : 'Chưa bật AI: nhờ Lãnh đạo nhập khóa ở Cài đặt › Tham số'); return; }
      guard(b, async () => { b.textContent = 'AI đang đọc…'; drawSum(await api('/chat/summary', { method: 'POST', body: { date: day } })); });
    };
  };
  drawSum(await api('/chat/summary?date=' + day));
  const ab = $('#chatAuto');
  if (ab) ab.onclick = () => {
    const on = !info.auto;
    if (on && !confirm('Bật tự tạo lịch?\n\nTin nào có đủ TÊN KHÁCH + NGÀY + GIỜ sẽ tự thành lịch hẹn (thợ trùng giờ thì không tự tạo). Tin thiếu vẫn hiện thẻ để bấm tay.')) return;
    guard(ab, async () => { await api('/chat/settings', { method: 'PUT', body: { auto: on } }); toast(on ? 'Đã bật tự tạo lịch' : 'Đã tắt tự tạo lịch'); VIEWS.chat(main); });
  };
  // Mic: nói tiếng Việt → chữ
  const mic = $('#chatMic');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  mic.onclick = () => {
    if (!SR) { toast('Máy này chưa hỗ trợ mic trong app: bấm vào ô nhập rồi dùng nút 🎤 trên bàn phím điện thoại'); ta.focus(); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'vi-VN'; rec.interimResults = true; rec.continuous = false;
    const base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
    rec.onresult = (e) => { ta.value = base + Array.from(e.results).map((r) => r[0].transcript).join(''); ta.oninput(); };
    rec.onerror = (e) => { toast(e.error === 'not-allowed' ? 'Chưa cho phép dùng micro: bật quyền micro cho trang này' : 'Không nghe rõ, thử lại'); };
    rec.onend = () => { rec = null; mic.classList.remove('rec'); mic.textContent = '🎤'; ta.focus(); };
    mic.classList.add('rec'); mic.textContent = '⏹'; rec.start();
  };
  S.chatPull = async () => {
    if (!document.body.contains(list)) { S.chatPull = null; return; }
    if (!isToday) return refreshChatBadge();
    const last = msgs.length ? msgs[msgs.length - 1].id : 0;
    const fresh = await api(`/chat?after=${last}&date=${day}`);
    if (fresh.length) { msgs = msgs.concat(fresh.filter((m) => !msgs.some((x) => x.id === m.id))); draw(true); }
  };
  const f = $('#chatF'), ta = f.body;
  // Gõ @ → hiện tên để chọn
  const atBar = $('#chatAt');
  const atNames = [...activeStaff().map((u) => u.full_name.split(' ').pop()), 'all'];
  const atShow = () => {
    const mm = ta.value.slice(0, ta.selectionStart).match(/(?:^|\s)@([^\s@]*)$/);
    if (!mm) { atBar.classList.add('hidden'); return; }
    const q = mm[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const opts = atNames.filter((n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().startsWith(q));
    atBar.innerHTML = opts.map((n) => `<button type="button" class="btn sm" data-at="${esc(n)}">@${esc(n === 'all' ? 'all (cả nhóm)' : n)}</button>`).join('');
    atBar.classList.toggle('hidden', !opts.length);
    $$('[data-at]', atBar).forEach((b) => (b.onclick = () => {
      const pos = ta.selectionStart; const before = ta.value.slice(0, pos).replace(/@([^\s@]*)$/, '@' + b.dataset.at + ' ');
      ta.value = before + ta.value.slice(pos); ta.focus(); ta.setSelectionRange(before.length, before.length); atBar.classList.add('hidden');
    }));
  };
  ta.addEventListener('input', atShow); ta.addEventListener('click', atShow);
  $('#chatBell').onclick = () => pushSetup();
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } };
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
  f.onsubmit = (e) => { e.preventDefault(); const v = ta.value.trim(); if (!v) return;
    guard(f.querySelector('button[class~="primary"]'), async () => { const m = await api('/chat', { method: 'POST', body: { body: v } }); ta.value = ''; ta.style.height = 'auto';
      if (!isToday) { go('chat', { date: S.today }); return; }
      msgs.push(m); draw();
      if (m.auto_created) { toast(`⚡ Đã tự tạo lịch ${dmy(m.appt_date)} ${m.appt_time || ''}`); refreshReminderBadge(); }
      else if (m.action) toast('App gợi ý việc từ tin này — kiểm tra rồi bấm ✓');
      else if (m.draft) toast(m.draft.name || m.draft.customer_id ? 'App nhận ra lịch hẹn, kiểm tra rồi bấm ✓ Tạo lịch' : 'Chưa rõ tên khách: bấm “Sửa rồi tạo” để điền'); }); };
  draw(); refreshChatBadge(); ta.focus();
};

// ---------- Chi trong ngày + quỹ tiền mặt ----------
const EXP_ST = { pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'ok'], rejected: ['Không duyệt', 'bad'] };
const EXP_SRC = { fund: '💵 TM tại tiệm', staff: '👤 Nhân viên ứng', owner: '🏠 Chủ trả' };
VIEWS.expenses = async (main) => {
  const from = S.params.from || S.today, to = S.params.to || from;
  const r = await api(`/expenses?from=${from}&to=${to}`);
  const reload = () => VIEWS.expenses(main);
  const pct = Math.max(0, Math.min(100, Math.round((r.balance / r.target) * 100)));
  const row = (e) => `<div class="list-item exp-row ${e.status === 'rejected' ? 'rej' : ''}"><div style="flex:1;min-width:0">
      <div>${e.kind === 'in' ? '<b class="ok-text">+ Nạp quỹ</b>' : `<b>${esc(e.note || '')}</b>`} <span class="badge">${esc(e.category || '')}</span>${e.kind === 'out' ? ` <span class="badge ${EXP_ST[e.status][1]}">${EXP_ST[e.status][0]}</span>` : ''}${e.status === 'rejected' && !e.refunded && (e.source || 'fund') === 'fund' ? ' <span class="badge bad">chưa hoàn quỹ</span>' : ''}
        ${e.kind === 'out' && e.source && e.source !== 'fund' ? ` <span class="badge">${EXP_SRC[e.source]}${e.pay_method ? ' · ' + (/chuy/i.test(e.pay_method) ? 'CK' : 'TM') : ''}</span>` : ''}${e.spread_months > 1 ? ` <span class="badge">chia ${e.spread_months} tháng · ${money(Math.round(e.amount / e.spread_months))}/th</span>` : ''}
        ${e.source === 'staff' && e.status === 'approved' ? (e.reimbursed_at ? ` <span class="badge ok">Đã hoàn ứng ${dmy(e.reimbursed_at)} · ${esc(r.reimburse_methods[e.reimburse_method] || '')}</span>` : ' <span class="badge warn">chờ hoàn ứng</span>') : ''}</div>
      <div class="small muted">${dmy(e.date)} ${esc(e.created_at.slice(11, 16))} · ${esc(e.by_name || '')}${e.kind === 'in' && e.note ? ' · ' + esc(e.note) : ''}${e.decided_by_name && e.kind === 'out' && e.status !== 'pending' ? ` · ${e.status === 'approved' ? 'duyệt' : 'từ chối'} bởi ${esc(e.decided_by_name)}` : ''}${e.reason ? ' · Lý do: ' + esc(e.reason) : ''}</div>
      ${e.photo ? `<a href="/api/expenses/${e.id}/photo" target="_blank" class="small">🧾 Xem hóa đơn</a>` : ''}</div>
    <div style="text-align:right"><div class="${e.kind === 'in' ? 'ok-text' : ''}"><b>${e.kind === 'in' ? '+' : '−'}${money(e.amount)}</b></div>
      <div class="row" style="justify-content:flex-end;margin-top:4px">${r.can_decide && e.kind === 'out' && e.status !== 'approved' ? `<button class="btn sm primary" data-ok="${e.id}">✓ Duyệt</button>` : ''}
      ${r.can_decide && e.kind === 'out' && e.status !== 'rejected' ? `<button class="btn sm" data-no="${e.id}">✕ Không duyệt</button>` : ''}
      ${r.can_decide && e.status === 'rejected' && !e.refunded && (e.source || 'fund') === 'fund' ? `<button class="btn sm" data-rf="${e.id}">Đã hoàn quỹ</button>` : ''}
      ${r.can_decide && e.source === 'staff' && e.status === 'approved' && !e.reimbursed_at ? `<button class="btn sm primary" data-rb="${e.id}">Hoàn ứng</button>` : ''}
      ${r.can_decide && e.kind === 'out' ? `<button class="btn sm" data-ee="${e.id}" title="Nguồn tiền / chia tháng">⚙</button>` : ''}
      ${(r.can_decide || (e.created_by === S.me.id && e.status === 'pending')) ? `<button class="btn sm" data-del="${e.id}" title="Xóa">🗑</button>` : ''}</div></div></div>`;
  main.innerHTML = header('Chi & quỹ tiền mặt', `Quỹ để ở tiệm ${money(r.target)} · ai mua gì thì ghi lại, quản lý trở lên duyệt`,
    `<button class="btn primary" id="addE">+ Ghi khoản chi</button>${r.can_decide ? '<button class="btn" id="topE">+ Nạp quỹ</button>' : ''}`) +
    `<div class="grid kpis">
      <div class="kpi"><div class="l">Quỹ còn (sổ sách)</div><div class="v ${r.balance < r.target * 0.3 ? 'bad-text' : ''}">${money(r.balance)}</div><div class="fund-bar"><span style="width:${pct}%"></span></div><div class="s">${r.need_topup ? `cần nạp thêm <b>${money(r.need_topup)}</b> để đủ ${money(r.target)}` : 'đủ quỹ'}</div></div>
      <div class="kpi"><div class="l">Chi ${from === to ? (from === S.today ? 'hôm nay' : dmy(from)) : 'trong kỳ'}</div><div class="v">${money(r.total_out)}</div><div class="s">${r.rows.filter((x) => x.kind === 'out').length} khoản (không tính khoản bị từ chối)</div></div>
      <div class="kpi"><div class="l">Chờ duyệt</div><div class="v">${r.pending_count}</div><div class="s">${money(r.pending_amount)}</div></div>
      ${r.reimburse_due.length ? `<div class="kpi"><div class="l">Tiệm nợ nhân viên (chờ hoàn ứng)</div><div class="v warn-text">${money(r.reimburse_due.reduce((a, x) => a + x.amount, 0))}</div><div class="s">${r.reimburse_due.map((x) => esc(x.name) + ' ' + money(x.amount)).join(', ')}</div></div>` : ''}
      ${r.refund_due.length ? `<div class="kpi"><div class="l">Phải hoàn lại quỹ</div><div class="v bad-text">${money(r.refund_due.reduce((a, x) => a + x.amount, 0))}</div><div class="s">${r.refund_due.map((x) => esc(x.name) + ' ' + money(x.amount)).join(', ')}</div></div>` : ''}</div>
    <div class="card"><div class="row"><input type="date" id="ef" value="${from}" style="width:auto"> → <input type="date" id="et" value="${to}" style="width:auto">
      <button class="btn sm" data-p="today">Hôm nay</button><button class="btn sm" data-p="yest">Hôm qua</button><button class="btn sm" data-p="month">Tháng này</button>
      ${r.can_decide ? `<span class="spacer"></span><a class="btn sm" href="/api/expenses/export?from=${from}&to=${to}" download>📥 Xuất Excel</a><button class="btn sm" id="tgE">Đổi mức quỹ</button>` : ''}</div></div>
    ${r.reimburse_list.length ? `<div class="card"><h3>👤 Chờ hoàn ứng cho nhân viên (${r.reimburse_list.length})</h3>${r.reimburse_list.map(row).join('')}</div>` : ''}
    ${r.spread_list.length ? `<details class="card"><summary><b>📆 Khoản đang chia tháng (${r.spread_list.length})</b> <span class="small muted">còn phân bổ ${money(r.spread_list.reduce((a, x) => a + x.left, 0))}</span></summary>
      ${r.spread_list.map((x) => `<div class="stat-line"><span>${esc(String(x.note || '').replace(/ · từ sổ đặt lịch$/, ''))} <span class="small muted">${dmy(x.date)} · ${money(x.amount)} ÷ ${x.spread_months} tháng</span></span><b>${money(x.per_month)}/th · còn ${x.months_left} th</b></div>`).join('')}</details>` : ''}
    ${r.older_pending.length ? `<div class="card"><h3>⏳ Khoản chờ duyệt từ ngày khác (${r.older_pending.length})</h3>${r.older_pending.map(row).join('')}</div>` : ''}
    <div class="grid two"><div class="card"><h3>Các khoản</h3>${r.rows.map(row).join('') || '<div class="empty">Chưa có khoản chi nào</div>'}</div>
      <div class="card"><h3>Theo loại</h3>${Object.entries(r.by_category).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="stat-line"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join('') || '<div class="empty">—</div>'}
        <div class="small muted" style="margin-top:10px">• Khoản <b>không duyệt</b> không tính vào chi phí tiệm, người chi phải hoàn tiền lại vào quỹ.<br>• Cuối ngày đếm tiền mặt trong hộp quỹ, so với “Quỹ còn”; lệch thì báo quản lý.<br>• Ảnh hóa đơn giúp duyệt nhanh, nên chụp mọi khoản trên 100.000đ.</div></div></div>`;
  const set = (a, b) => go('expenses', { from: a, to: b });
  $('#ef').onchange = (e) => set(e.target.value, to < e.target.value ? e.target.value : to); $('#et').onchange = (e) => set(from, e.target.value);
  $$('[data-p]', main).forEach((b) => (b.onclick = () => { const t = S.today; if (b.dataset.p === 'today') set(t, t); if (b.dataset.p === 'yest') { const y = addDays(t, -1); set(y, y); } if (b.dataset.p === 'month') set(t.slice(0, 8) + '01', t); }));
  const form = (kind) => {
    openModal(kind === 'in' ? 'Nạp tiền vào quỹ' : 'Ghi khoản chi', `<form id="xf"><div class="form-grid">
      ${kind === 'out' ? `<div class="full"><label>Mua gì / chi việc gì *</label><input name="note" required placeholder="VD: 2 thùng nước suối, gửi xe…"></div>
      <div><label>Loại</label><select name="category">${r.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="full"><label>Tiền lấy từ đâu?</label><div class="row" style="gap:6px">
        <label class="chk"><input type="radio" name="source" value="fund" checked> 💵 Lấy TM tại tiệm</label>
        <label class="chk"><input type="radio" name="source" value="staff"> 👤 Tôi tự ứng trước (tiệm hoàn lại)</label>
        ${isMgr() ? '<label class="chk"><input type="radio" name="source" value="owner"> 🏠 Chủ trả cá nhân</label>' : ''}</div>
        <div id="pmW" style="display:none;margin-top:6px"><select name="pay_method" style="width:auto"><option>Tiền mặt</option><option>Chuyển khoản</option></select> <span class="small muted">trả bằng</span></div></div>
      ${isMgr() ? `<div><label>Tính chi phí cho</label><select name="spread_months">${[[1, 'Hết vào tháng này'], [3, 'Chia 3 tháng'], [6, 'Chia 6 tháng'], [12, 'Chia 12 tháng (trả theo năm)'], [24, 'Chia 24 tháng (đồ dùng lâu)'], [36, 'Chia 36 tháng']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><div class="small muted" id="spTxt"></div></div>` : ''}`
      : '<div class="full"><label>Ghi chú</label><input name="note" placeholder="VD: nạp đủ quỹ đầu tuần"></div>'}
      <div><label>Số tiền *</label><input name="amount" inputmode="numeric" required placeholder="${kind === 'in' ? r.need_topup || 1000000 : '50000'}" value="${kind === 'in' && r.need_topup ? r.need_topup : ''}"><div class="small muted" id="amtTxt"></div></div>
      ${isMgr() ? `<div><label>Ngày</label><input type="date" name="date" value="${S.today}"></div>` : ''}
      ${kind === 'out' ? '<div class="full"><label>📷 Ảnh hóa đơn (nếu có)</label><input type="file" name="photo" accept="image/*" capture="environment"></div>' : ''}</div>
      ${kind === 'out' && !isMgr() ? '<div class="small muted">Khoản chi sẽ chờ quản lý duyệt. Chọn "Tôi tự ứng trước" nếu bạn trả bằng tiền/CK của mình – tiệm sẽ hoàn lại.</div>' : ''}
      <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form>`);
    const amt = $('#xf [name=amount]');
    const show = () => { const v = Number(amt.value.replace(/\D/g, '')); $('#amtTxt').textContent = v ? money(v) : ''; };
    const sp = $('#xf [name=spread_months]');
    const spShow = () => { if (!sp) return; const v = Number(amt.value.replace(/\D/g, '')), n = Number(sp.value); $('#spTxt').textContent = n > 1 && v ? `≈ ${money(Math.round(v / n))}/tháng trong ${n} tháng` : ''; };
    amt.oninput = () => { show(); spShow(); }; show();
    if (sp) { sp.onchange = spShow; const nt = $('#xf [name=note]'), ct = $('#xf [name=category]');
      // Gợi ý: app/phần mềm trả năm → chia 12; xe đẩy, máy, ghế… → chia 24
      const hint = () => { const t = (nt.value || '').toLowerCase(); if (sp.dataset.touched) return;
        if (/năm|nam |1 năm|app|phần mềm|canva|capcut|youtube|tên miền/.test(t) || ct.value === 'Phần mềm / app') sp.value = '12';
        else if (/xe đẩy|máy|ghế|gương|tủ|kệ|bồn|giường/.test(t) || ct.value === 'Dụng cụ, thiết bị') sp.value = Number(amt.value.replace(/\D/g, '')) >= 2000000 ? '24' : '1';
        else sp.value = '1'; spShow(); };
      sp.addEventListener('change', () => (sp.dataset.touched = '1')); nt.addEventListener('change', hint); ct.addEventListener('change', hint); amt.addEventListener('change', hint); }
    $$('#xf [name=source]').forEach((x) => (x.onchange = () => ($('#pmW').style.display = $('#xf [name=source]:checked').value === 'fund' ? 'none' : '')));
    $('#xf').onsubmit = (e) => { e.preventDefault(); guard($('#xf button.primary'), async () => {
      const fd = new FormData($('#xf')); fd.append('kind', kind); fd.set('amount', amt.value.replace(/\D/g, ''));
      const ph = $('#xf [name=photo]'); if (ph && !ph.files.length) fd.delete('photo');
      const res = await api('/expenses', { method: 'POST', body: fd }); closeModal();
      toast(kind === 'in' ? 'Đã nạp quỹ' : `Đã ghi chi · quỹ còn ${money(res.balance)}`); refreshReminderBadge(); reload(); }); };
  };
  $('#addE').onclick = () => form('out');
  if ($('#topE')) $('#topE').onclick = () => form('in');
  if ($('#tgE')) $('#tgE').onclick = () => { const v = prompt('Mức quỹ tiền mặt để ở tiệm (đồng):', r.target); if (v) api('/expenses/target', { method: 'PUT', body: { target: Number(v.replace(/\D/g, '')) } }).then(reload).catch((e) => toast(e.message)); };
  $$('[data-ok]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/expenses/${b.dataset.ok}/decide`, { method: 'POST', body: { status: 'approved' } }); refreshReminderBadge(); reload(); })));
  $$('[data-no]', main).forEach((b) => (b.onclick = () => { const why = prompt('Lý do không duyệt (người chi phải hoàn tiền lại quỹ):'); if (!why) return;
    guard(b, async () => { await api(`/expenses/${b.dataset.no}/decide`, { method: 'POST', body: { status: 'rejected', reason: why } }); refreshReminderBadge(); reload(); }); }));
  $$('[data-rf]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/expenses/${b.dataset.rf}/refunded`, { method: 'POST', body: {} }); reload(); })));
  const allRows = [...r.rows, ...r.older_pending, ...r.reimburse_list];
  $$('[data-rb]', main).forEach((b) => (b.onclick = () => {
    const e = allRows.find((x) => x.id === Number(b.dataset.rb));
    openModal('Hoàn ứng cho ' + esc(e.by_name || ''), `<div><b>${esc(e.note)}</b> · ${money(e.amount)}</div><div class="row" style="gap:6px;margin-top:10px">
      ${Object.entries(r.reimburse_methods).map(([k, l]) => `<button class="btn ${k === 'fund' ? 'primary' : ''}" data-rbm="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="small muted" style="margin-top:8px">TM tại tiệm: trừ vào quỹ/két hôm nay. Cộng vào lương: nhớ nhập khoản này ở Bảng lương (ô cộng/trừ) khi chốt tháng.</div>`);
    $$('[data-rbm]').forEach((x) => (x.onclick = () => guard(x, async () => { await api(`/expenses/${e.id}/reimburse`, { method: 'POST', body: { method: x.dataset.rbm } }); closeModal(); toast('Đã ghi hoàn ứng'); reload(); })));
  }));
  $$('[data-ee]', main).forEach((b) => (b.onclick = () => {
    const e = allRows.find((x) => x.id === Number(b.dataset.ee));
    openModal('Nguồn tiền / chia tháng', `<form id="eef"><div class="small"><b>${esc(e.note)}</b> · ${money(e.amount)} · ${dmy(e.date)}</div><div class="form-grid" style="margin-top:8px">
      <div><label>Tiền lấy từ đâu</label><select name="source">${Object.entries(r.sources).map(([k, l]) => `<option value="${k}" ${(e.source || 'fund') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div><label>Trả bằng</label><select name="pay_method"><option ${!/chuy/i.test(e.pay_method || '') ? 'selected' : ''}>Tiền mặt</option><option ${/chuy/i.test(e.pay_method || '') ? 'selected' : ''}>Chuyển khoản</option></select></div>
      <div><label>Loại</label><select name="category">${r.categories.map((c) => `<option ${c === e.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div><label>Chia chi phí cho (tháng)</label><input type="number" name="spread_months" min="1" max="60" value="${e.spread_months || 1}"></div></div>
      ${e.reimbursed_at ? `<div class="small" style="margin-top:6px">Đã hoàn ứng ${dmy(e.reimbursed_at)} <button type="button" class="btn sm" id="unRb">Bỏ đánh dấu hoàn ứng</button></div>` : ''}
      <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form>`);
    if ($('#unRb')) $('#unRb').onclick = () => guard($('#unRb'), async () => { await api(`/expenses/${e.id}/reimburse`, { method: 'POST', body: { undo: true } }); closeModal(); reload(); });
    $('#eef').onsubmit = (ev) => { ev.preventDefault(); guard($('#eef button.primary'), async () => { await api('/expenses/' + e.id, { method: 'PUT', body: formData($('#eef')) }); closeModal(); toast('Đã lưu'); reload(); }); };
  }));
  $$('[data-del]', main).forEach((b) => (b.onclick = () => { if (!confirm('Xóa khoản này?')) return; guard(b, async () => { await api('/expenses/' + b.dataset.del, { method: 'DELETE' }); refreshReminderBadge(); reload(); }); }));
};

// ---------- Khách hàng ----------
VIEWS.customers = async (main) => {
  const q = S.params.q || '';
  const sf = S.params.staff || '';
  const fetchList = (qq) => api('/customers?limit=200&q=' + encodeURIComponent(qq) + (sf ? '&staff_id=' + sf : ''));
  let r = await fetchList(q);
  const canMove = isMgr() && sf && sf !== 'mine' && r.total > 0;
  const rowsHtml = () => r.rows.length ? r.rows.map((c) => `<tr class="click" data-c="${c.id}"><td class="muted">${esc(c.code)}</td><td><b>${esc(c.name)}</b>${c.fam ? ` <span class="badge" title="Có người nhà / người đi cùng">👨‍👩‍👧 ${c.fam + 1}</span>` : ''}${c.relation ? `<div class="small muted">${esc(c.relation)}</div>` : ''}</td><td>${esc(c.phone || '')}</td>
      <td class="num">${c.visits}</td><td>${dmy(c.last_visit)}</td><td>${c.staff_id ? esc(staffName(c.staff_id)) : '<span class="muted small">—</span>'}</td>
      <td class="small formula-cell" title="${esc(c.formula || '')}">${c.formula ? esc(c.formula.length > 40 ? c.formula.slice(0, 40) + '…' : c.formula) : ''}</td>${isMgr() ? `<td class="num">${money(c.spend)}</td>` : ''}</tr>`).join('')
    : `<tr><td colspan="8" class="muted">Không thấy khách nào. Thử gõ ít chữ hơn, không cần dấu (vd: “huyen”) hoặc 4 số cuối SĐT.</td></tr>`;
  const moreHtml = () => r.total > r.rows.length ? `Đang hiện ${r.rows.length}/${r.total} — gõ tìm kiếm để lọc.` : '';
  main.innerHTML = header('Khách hàng', `<span id="cTotal">${r.total}</span> khách`, `${isMgr() ? '<button class="btn" id="famSug">👨‍👩‍👧 Gợi ý người nhà</button>' : ''}${canMove ? '<button class="btn" id="moveC">🔄 Bàn giao khách</button>' : ''}<button class="btn primary" id="newC">+ Khách mới</button>`) +
    `<div class="card"><div class="row"><input id="q" placeholder="🔍 Tìm tên (không cần dấu), SĐT, mã khách, công thức…" value="${esc(q)}" type="search" autocomplete="off" autocorrect="off" style="flex:1;min-width:220px">
      <select id="sf" style="width:auto"><option value="">Tất cả thợ</option><option value="mine" ${sf === 'mine' ? 'selected' : ''}>⭐ Khách của tôi</option>${activeStaff().map((u) => `<option value="${u.id}" ${String(u.id) === sf ? 'selected' : ''}>Khách của ${esc(u.full_name)}</option>`).join('')}<option value="none" ${sf === 'none' ? 'selected' : ''}>Chưa giao thợ</option></select></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Tên khách</th><th>SĐT</th><th class="num">Lượt</th><th>Lần gần nhất</th><th>Thợ phụ trách</th><th>Công thức</th>${isMgr() ? '<th class="num">Tổng chi</th>' : ''}</tr></thead>
    <tbody id="cBody">${rowsHtml()}</tbody></table></div>
    <div class="muted small" id="cMore" style="margin-top:8px">${moreHtml()}</div></div>`;
  const params = (over) => { const p = { q: $('#q').value.trim(), staff: $('#sf').value, ...over }; return Object.fromEntries(Object.entries(p).filter(([, v]) => v)); };
  const bindRows = () => $$('[data-c]', main).forEach((tr) => (tr.onclick = () => go('customer', { id: tr.dataset.c })));
  const qi = $('#q');
  let t, seq = 0, composing = false;
  const refresh = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const v = qi.value.trim(), my = ++seq;
      const p = new URLSearchParams(params()).toString();
      history.replaceState({}, '', '#customers' + (p ? '?' + p : ''));
      const nr = await fetchList(v); if (my !== seq || !document.body.contains(qi)) return; // bỏ kết quả cũ về muộn
      r = nr; $('#cBody').innerHTML = rowsHtml(); $('#cMore').textContent = moreHtml(); $('#cTotal').textContent = r.total; bindRows();
    }, 400);
  };
  // Bàn phím tiếng Việt (Telex) đang ghép chữ thì chưa tìm, gõ xong mới tìm
  qi.addEventListener('compositionstart', () => { composing = true; clearTimeout(t); });
  qi.addEventListener('compositionend', () => { composing = false; refresh(); });
  qi.oninput = (e) => { if (composing || e.isComposing) return; refresh(); };
  qi.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); qi.blur(); } };
  $('#sf').onchange = () => go('customers', params());
  if (q && window.innerWidth > 820) { qi.focus(); qi.setSelectionRange(q.length, q.length); }
  bindRows();
  $('#newC').onclick = () => customerForm({}, (id) => go('customer', { id }));
  if ($('#famSug')) $('#famSug').onclick = () => familySuggest(() => VIEWS.customers(main));
  if (canMove) $('#moveC').onclick = () => {
    const fromName = sf === 'none' ? 'chưa giao thợ' : 'của ' + staffName(Number(sf));
    const list = r.rows;
    openModal('Bàn giao khách', `<form id="mf"><div class="small">Chuyển khách <b>${esc(fromName)}</b> sang thợ khác. Lịch sử lượt làm, công thức giữ nguyên.</div>
      <label style="margin-top:10px">Chuyển sang</label><select name="to"><option value="">— Chọn thợ nhận —</option>${activeStaff().filter((u) => String(u.id) !== sf).map((u) => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}${sf !== 'none' ? '<option value="0">Bỏ giao (chưa giao thợ)</option>' : ''}</select>
      <label style="margin-top:10px">Khách cần chuyển</label><label class="small"><input type="checkbox" id="mAll" checked style="width:auto"> Chọn tất cả (${r.total} khách)</label>
      <div style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px">${list.map((c) => `<label class="small" style="display:block;font-weight:normal"><input type="checkbox" class="mc" value="${c.id}" checked style="width:auto"> ${esc(c.name)} <span class="muted">${esc(c.phone || '')} · ${c.visits} lượt</span></label>`).join('')}</div>
      ${r.total > list.length ? `<div class="small muted">Danh sách hiện ${list.length}/${r.total}. “Chọn tất cả” sẽ chuyển đủ ${r.total} khách.</div>` : ''}
      <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Chuyển khách</button></div></form>`);
    const all = $('#mAll');
    all.onchange = () => $$('.mc').forEach((x) => (x.checked = all.checked));
    $$('.mc').forEach((x) => (x.onchange = () => { all.checked = $$('.mc').every((y) => y.checked); }));
    $('#mf').onsubmit = (e) => {
      e.preventDefault();
      guard($('#mf button.primary'), async () => {
        const to = $('#mf [name=to]').value;
        if (to === '') throw new Error('Chọn thợ nhận');
        const ids = all.checked ? null : $$('.mc').filter((x) => x.checked).map((x) => Number(x.value));
        if (ids && !ids.length) throw new Error('Chưa chọn khách nào');
        const n = ids ? ids.length : r.total;
        const toName = to === '0' ? 'chưa giao thợ' : staffName(Number(to));
        if (!confirm(`Chuyển ${n} khách ${fromName} sang ${toName}?`)) return;
        const res = await api('/customers/transfer', { method: 'POST', body: { from_staff_id: sf, to_staff_id: Number(to) || null, customer_ids: ids } });
        closeModal(); toast(`Đã chuyển ${res.count} khách sang ${toName}`); go('customers', { staff: to === '0' ? 'none' : to });
      });
    };
  };
};
function customerForm(c = {}, after) {
  const isEdit = !!c.id;
  openModal(isEdit ? 'Sửa thông tin khách' : 'Khách mới', `<form id="cf"><div class="form-grid">
    <div><label>Tên khách *</label><input name="name" value="${esc(c.name || '')}" required></div>
    <div><label>Số điện thoại</label><input name="phone" inputmode="tel" value="${esc(c.phone || '')}"></div>
    <div><label>Sinh nhật</label><input type="date" name="birthday" value="${c.birthday && c.birthday.length === 10 ? c.birthday : ''}"></div>
    <div><label>Giới tính</label><select name="gender">${['', 'Nữ', 'Nam', 'Khác'].map((g) => `<option ${c.gender === g ? 'selected' : ''} value="${g}">${g || '—'}</option>`).join('')}</select></div>
    <div class="full"><label>Nguồn khách (Zalo, Facebook, giới thiệu…)</label><input name="source" value="${esc(c.source || '')}"></div>
    <div><label>Thợ phụ trách</label>${isMgr() ? `<select name="staff_id">${staffOptions(c.staff_id || (isEdit ? null : S.me.role === 'staff' ? S.me.id : null), 'Chưa giao')}</select>` : `<input value="${esc(c.staff_name || staffName(c.staff_id) || 'Chưa giao')}" disabled>`}</div>
    <div class="full"><label>Lưu ý tóc, da đầu (nền tóc, % bạc, dị ứng…)</label><textarea name="hair_notes">${esc(c.hair_notes || '')}</textarea></div>
    <div class="full"><label>🧪 Công thức chuẩn của khách (màu, tỷ lệ, oxy, thời gian ủ…)</label><textarea name="formula" rows="3" placeholder="VD: Milbon 7-NB 30g + 8-MT 30g, oxy 6% 1:1,5, ủ 30'">${esc(c.formula || '')}</textarea></div>
    <div class="full"><label>Ghi chú / sở thích</label><textarea name="notes">${esc(c.notes || '')}</textarea></div>
    <div><label>🔁 Khách định kỳ: bao nhiêu ngày làm 1 lần</label><input type="number" name="cycle_days" min="0" max="365" placeholder="vd 14 = 2 tuần" value="${c.cycle_days || ''}"></div>
    <div><label>&nbsp;</label><label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="cycle_call" style="width:auto" ${c.cycle_call ? 'checked' : ''}> Gọi điện trước hỏi khách muốn mấy giờ</label></div>
    <div class="full"><label>Ghi chú khi gọi (giờ hay đặt, cách gọi…)</label><input name="cycle_note" value="${esc(c.cycle_note || '')}" placeholder="vd: hay đặt chiều thứ 7, gọi sau 10h"></div>
    ${isOwner() ? `<div class="full"><label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="owner_family" style="width:auto" ${c.owner_family ? 'checked' : ''}> 👪 Người nhà chủ: tự giảm 50%, không tính vào doanh số tổng xét thưởng của thợ</label></div>` : ''}</div>
    ${c.birthday && c.birthday.length === 5 ? `<div class="small muted">Sinh nhật đang lưu: ${c.birthday.split('-').reverse().join('/')} (không có năm). Để trống ô trên nếu không đổi.</div>` : ''}
    <div class="err"></div><div class="modal-foot">${isEdit && isOwner() ? '<button type="button" class="btn danger" id="delC">Xóa khách</button><span class="spacer"></span>' : ''}<button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form>`);
  $('#cf').onsubmit = (e) => {
    e.preventDefault();
    guard($('#cf button.primary'), async () => {
      const body = formData($('#cf'));
      body.cycle_call = $('#cf').cycle_call.checked ? '1' : '0';
      if (!body.birthday && c.birthday && c.birthday.length === 5) body.birthday = c.birthday;
      let r;
      if (isEdit) r = await api('/customers/' + c.id, { method: 'PUT', body });
      else {
        try { r = await api('/customers', { method: 'POST', body }); } catch (er) {
          if (er.status === 409) throw new Error(er.message + ' – không tạo khách mới. Tìm khách theo SĐT này để dùng hồ sơ cũ.');
          throw er;
        }
      }
      closeModal(); toast('Đã lưu khách'); after && after(isEdit ? c.id : r.id);
    });
  };
  const del = $('#delC');
  if (del) del.onclick = async () => { if (confirm('Xóa khách ' + c.name + '? (ẩn khỏi danh sách, lịch sử vẫn giữ)')) { await api('/customers/' + c.id, { method: 'DELETE' }); closeModal(); go('customers'); } };
}
VIEWS.customer = async (main) => {
  const id = Number(S.params.id);
  const c = await api('/customers/' + id);
  const tab = S.params.tab || 'visits';
  const activeCards = c.cards.filter((x) => x.status === 'active');
  main.innerHTML = header(c.name, `${esc(c.code)} · ${telLinks(c.phone)}${c.relation ? ' · ' + esc(c.relation) : ''}`,
    `<button class="btn" id="eC">Sửa</button><button class="btn" id="aC">Đặt lịch</button><button class="btn" id="sC">Bán thẻ</button><button class="btn primary" id="vC">+ Ghi lượt làm</button>`) +
    `<div class="grid two"><div class="card">
      <div class="stat-line"><span class="muted">Thợ phụ trách</span><b>${c.staff_name ? esc(c.staff_name) : '<span class="badge warn">chưa giao</span>'}</b></div>
      <div class="stat-line"><span class="muted">Số lượt</span><b>${c.stats.visits}</b></div>
      ${c.stats.spend != null ? `<div class="stat-line"><span class="muted">Tổng chi tiêu</span><b>${money(c.stats.spend)}</b></div>` : ''}
      ${c.debt ? `<div class="stat-line"><span style="color:var(--bad)">📝 Đang nợ</span><b style="color:var(--bad)">${money(c.debt)}</b></div>` : ''}
      <div class="stat-line"><span class="muted">Lần gần nhất</span><b>${dmy(c.stats.last_visit) || '—'}</b></div>
      <div class="stat-line"><span class="muted">Sinh nhật</span><b>${c.birthday ? (c.birthday.length === 10 ? dmy(c.birthday) : c.birthday.split('-').reverse().join('/')) : '<span class="badge warn">chưa có</span>'}</b></div>
      ${c.gender ? `<div class="stat-line"><span class="muted">Giới tính</span><b>${esc(c.gender)}</b></div>` : ''}
      ${c.source ? `<div class="stat-line"><span class="muted">Nguồn</span><b>${esc(c.source)}</b></div>` : ''}
      ${activeCards.map((k) => `<div class="stat-line"><span class="muted">💳 ${esc(k.name)} (${esc(k.code)})</span><b>${money(k.balance)}</b></div>`).join('')}
    </div><div class="card"><h3>Lưu ý tóc</h3><div class="pre">${esc(c.hair_notes || '—')}</div>
      <h3 style="margin-top:12px">🧪 Công thức của khách <button class="btn sm" id="fEdit" style="margin-left:6px">Sửa</button></h3>
      ${c.formula ? `<div class="pre formula-box">${esc(c.formula)}</div><div class="small muted">Cập nhật ${dmy(c.formula_at)}${c.formula_by_name ? ' · ' + esc(c.formula_by_name) : ''}</div>` : '<div class="small muted">Chưa có. Ghi ở phiếu thu (ô Công thức) là tự lưu vào đây.</div>'}
      ${(() => { const hist = c.visits.filter((x) => x.formula); return hist.length > 1 || (hist.length && hist[0].formula !== c.formula) ? `<details class="small" style="margin-top:6px"><summary>Lịch sử công thức (${hist.length} lần)</summary>${hist.map((x) => `<div style="margin:6px 0"><b>${dmy(x.date)}</b> · ${esc(x.main_staff_name || '')} · ${esc(x.items.map((i) => i.name).join(' + '))}<div class="pre">${esc(x.formula)}</div></div>`).join('')}</details>` : ''; })()}${c.notes ? `<h3 style="margin-top:12px">Ghi chú</h3><div class="pre">${esc(c.notes)}</div>` : ''}</div></div>
    <div class="card"><h3>👨‍👩‍👧 Người nhà & người đi cùng <button class="btn sm" id="famAdd" style="margin-left:6px">+ Thêm</button></h3>
      ${c.family.length ? c.family.map((m) => `<div class="list-item"><a href="#customer?id=${m.id}"><b>${esc(m.name)}</b></a>
        <span class="small muted">${esc(m.relation || '')}</span>${m.formula ? ' <span class="badge" title="Có công thức">🧪</span>' : ''}
        <span class="spacer"></span><span class="small muted">${m.visits} lượt${m.last_visit ? ' · gần nhất ' + dmy(m.last_visit) : ''}</span><button class="btn sm" data-funlink="${m.id}">Gỡ</button></div>`).join('')
        : '<div class="small muted">Chưa gắn ai. Khách đi cùng vợ/chồng, con, anh chị em, bạn… bấm "+ Thêm" để gắn — tìm 1 người là ra cả nhà, xem được công thức và lịch sử của từng người.</div>'}</div>
    <div class="card"><div class="tabs">${[['visits', `Lượt làm (${c.visits.length})`], ['hair', `Tình trạng tóc (${c.hair_log.length})`], ['photos', `Ảnh (${c.photos.length})`], ['cards', `Thẻ (${c.cards.length})`], ['appts', `Lịch hẹn (${c.appointments.length})`]]
      .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="tabBody"></div></div>`;
  const reload = () => VIEWS.customer(main);
  $$('[data-tab]').forEach((b) => (b.onclick = () => { history.replaceState({}, '', `#customer?id=${id}&tab=${b.dataset.tab}`); S.params.tab = b.dataset.tab; reload(); }));
  $('#eC').onclick = () => customerForm(c, reload);
  $('#fEdit').onclick = () => {
    openModal('Công thức · ' + c.name, `<form id="ff"><textarea name="formula" rows="6" placeholder="Màu, tỷ lệ pha, oxy, thời gian ủ, lưu ý…">${esc(c.formula || '')}</textarea>
      <div class="small muted">Lần sau ghi lượt làm, phiếu thu hiện sẵn công thức này để thợ dùng lại.</div><div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu công thức</button></div></form>`);
    $('#ff').onsubmit = (e) => { e.preventDefault(); guard($('#ff button'), async () => { await api('/customers/' + c.id, { method: 'PUT', body: { ...c, formula: $('#ff [name=formula]').value, staff_id: c.staff_id } }); closeModal(); toast('Đã lưu công thức'); reload(); }); };
  };
  $('#famAdd').onclick = () => familyAdd(c, reload);
  $$('[data-funlink]').forEach((b) => (b.onclick = async () => { if (!confirm('Gỡ người này khỏi nhóm người nhà?')) return; try { await api(`/customers/${b.dataset.funlink}/family`, { method: 'DELETE' }); reload(); } catch (e) { toast(e.message); } }));
  $('#aC').onclick = () => apptForm({ customer_id: c.id, customer_code: c.code, name: c.name }, reload);
  $('#sC').onclick = () => cardForm(c, reload);
  $('#vC').onclick = () => visitForm({ customer_id: c.id, customer: c }, reload);
  const body = $('#tabBody');
  if (tab === 'visits') {
    body.innerHTML = c.visits.length ? c.visits.map((v) => visitBlock(v, c.photos)).join('') : '<div class="empty">Chưa có lượt làm</div>';
    bindPhotos(body, reload);
    $$('[data-vedit]', body).forEach((b) => (b.onclick = () => visitForm(c.visits.find((v) => v.id === Number(b.dataset.vedit)), reload)));
    $$('[data-rc-id]', body).forEach((b) => (b.onclick = () => showReceipt(b.dataset.rcId)));
    $$('[data-vphoto]', body).forEach((inp) => (inp.onchange = async () => {
      if (!inp.files.length) return;
      try { await uploadPhotos(c.id, inp.files, inp.dataset.kind, inp.dataset.vphoto); toast('Đã tải ảnh'); reload(); } catch (e) { toast(e.message); }
    }));
  } else if (tab === 'hair') {
    body.innerHTML = c.hair_log.length ? `<div class="small muted" style="margin-bottom:8px">Ghi ở phiếu thu: ô "Tình trạng tóc trước khi làm" và "Kết quả". Mới nhất ở trên.</div>` + c.hair_log.map((h) => `<div class="list-item" style="display:block">
        <div class="row"><b>${dmy(h.date)}</b><span class="small">${esc(h.services)}</span><span class="badge brand">${esc(h.staff || '')}</span></div>
        ${h.hair_before ? `<div class="small"><span class="muted">Tóc trước:</span> ${esc(h.hair_before)}</div>` : ''}
        ${h.formula ? `<div class="small pre"><span class="muted">Công thức:</span> ${esc(h.formula)}</div>` : ''}
        ${h.result ? `<div class="small"><span class="muted">Kết quả:</span> ${esc(h.result)}</div>` : ''}</div>`).join('')
      : '<div class="empty">Chưa có ghi chép. Khi ghi lượt làm, điền "Tình trạng tóc trước khi làm" (có nút chọn nhanh) và "Kết quả" để theo dõi tóc qua từng lần.</div>';
  } else if (tab === 'photos') {
    body.innerHTML = `<div class="row" style="margin-bottom:10px"><label class="btn sm">+ Ảnh trước<input type="file" accept="image/*" multiple hidden data-kind="before" class="up"></label>
      <label class="btn sm">+ Ảnh sau<input type="file" accept="image/*" multiple hidden data-kind="after" class="up"></label></div>${photoGrid(c.photos, true)}`;
    bindPhotos(body, reload);
    $$('.up', body).forEach((inp) => (inp.onchange = async () => { try { await uploadPhotos(c.id, inp.files, inp.dataset.kind); toast('Đã tải ảnh'); reload(); } catch (e) { toast(e.message); } }));
  } else if (tab === 'cards') {
    body.innerHTML = cardTable(c.cards, false);
    bindCardTable(body, c.cards, reload);
  } else {
    body.innerHTML = apptList(c.appointments, true);
    bindApptList(body, reload, c.appointments.map((a) => ({ ...a, name: c.name, customer_code: c.code })));
  }
};
const HAIR_TAGS = ['Khỏe', 'Khô', 'Xơ', 'Hư tổn', 'Gãy rụng', 'Tóc mỏng', 'Bạc ít', 'Bạc nhiều', 'Đã nhuộm', 'Đã tẩy', 'Đã uốn/duỗi', 'Da đầu dầu', 'Gàu', 'Da đầu nhạy cảm'];
function hairChips() {
  return `<div class="row hair-chips" style="gap:4px;margin:4px 0">${HAIR_TAGS.map((t) => `<button type="button" class="btn sm" data-hchip="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
}
// bấm chip → thêm/bớt chữ trong ô tình trạng tóc
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-hchip]'); if (!b) return;
  const ta = b.closest('div.full')?.querySelector('textarea[name=hair_before]'); if (!ta) return;
  const t = b.dataset.hchip; const parts = ta.value.split(/\s*,\s*/).filter(Boolean);
  const i = parts.findIndex((p) => p.toLowerCase() === t.toLowerCase());
  if (i >= 0) parts.splice(i, 1); else parts.push(t);
  ta.value = parts.join(', '); ta.dispatchEvent(new Event('input', { bubbles: true }));
});
async function familyAdd(c, done) {
  const rels = await api('/family/relations');
  openModal('Thêm người nhà · ' + c.name, `<form id="fam"><label>Tìm khách (tên hoặc SĐT)</label><input id="famQ" placeholder="VD: khanh, 0935…" autocomplete="off">
    <div id="famR" class="small" style="max-height:220px;overflow:auto"></div><input type="hidden" name="other_id">
    <label>Người này là gì của ${esc(c.name)}?</label><select name="relation"><option value="">— chọn —</option>${rels.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
    <div class="err"></div><div class="modal-foot"><button class="btn primary">Gắn vào nhóm người nhà</button></div></form>`);
  const f = $('#fam'); let t;
  $('#famQ').oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    const q = $('#famQ').value.trim(); if (q.length < 2) { $('#famR').innerHTML = ''; return; }
    const r = await api('/customers?limit=8&q=' + encodeURIComponent(q));
    $('#famR').innerHTML = r.rows.filter((x) => x.id !== c.id).map((x) => `<div class="list-item click" data-pick="${x.id}"><b>${esc(x.name)}</b> <span class="muted">${esc(x.phone || '')} · ${x.visits} lượt</span></div>`).join('') || '<div class="muted">Không thấy — tạo khách mới ở trang Khách hàng trước.</div>';
    $$('[data-pick]', $('#famR')).forEach((d) => (d.onclick = () => { f.other_id.value = d.dataset.pick; $$('[data-pick]', $('#famR')).forEach((x) => x.classList.toggle('active', x === d)); $('#famQ').value = d.querySelector('b').textContent; }));
  }, 300); };
  f.onsubmit = (e) => { e.preventDefault(); guard($('#fam .btn.primary'), async () => {
    if (!f.other_id.value) throw new Error('Chọn 1 khách trong danh sách');
    await api(`/customers/${c.id}/family`, { method: 'POST', body: { other_id: Number(f.other_id.value), relation: f.relation.value } });
    closeModal(); toast('Đã gắn người nhà'); done();
  }); };
}
async function familySuggest(done) {
  const list = await api('/family/suggest');
  openModal('👨‍👩‍👧 Gợi ý người nhà từ tên khách', list.length ? `<div class="small muted" style="margin-bottom:8px">App đọc tên khách ghi trong sổ (vd "Phương vợ Khánh", "Alex (con Khánh Linh)") và tìm người được nhắc tới. Kiểm tra rồi bấm Gắn — sai thì Bỏ qua.</div>
    ${list.map((s, i) => `<div class="list-item" style="display:block" data-sg="${i}"><div><b>${esc(s.name)}</b> ${s.phone ? `<span class="muted small">${esc(s.phone)}</span>` : ''} → là <b>${esc(s.relation)}</b> của:</div>
      <div class="row" style="margin-top:4px"><select data-sgc>${s.candidates.map((x) => `<option value="${x.id}">${esc(x.name)}${x.phone ? ' · ' + esc(x.phone) : ''}</option>`).join('')}</select>
      <button class="btn sm primary" data-sgok>Gắn</button><button class="btn sm" data-sgno>Bỏ qua</button></div></div>`).join('')}` : '<div class="empty">Chưa có gợi ý nào.</div>', true);
  $$('[data-sg]').forEach((el) => {
    const s = list[Number(el.dataset.sg)]; const sel = $('[data-sgc]', el);
    $('[data-sgok]', el).onclick = async () => { try { await api(`/customers/${sel.value}/family`, { method: 'POST', body: { other_id: s.id, relation: s.relation } }); el.remove(); toast('Đã gắn'); } catch (e) { toast(e.message); } };
    $('[data-sgno]', el).onclick = async () => { try { await api('/family/ignore', { method: 'POST', body: { a: Number(sel.value), b: s.id } }); el.remove(); } catch (e) { toast(e.message); } };
  });
  const mc = $('#modal'); const obs = new MutationObserver(() => { if (mc.classList.contains('hidden')) { obs.disconnect(); done(); } }); obs.observe(mc, { attributes: true });
}
function visitBlock(v, photos) {
  const ps = photos.filter((p) => p.visit_id === v.id);
  return `<div class="list-item" style="display:block"><div class="row"><b>${dmy(v.date)}${v.time ? ' ' + esc(v.time) : ''}</b>
    <span>${v.items.map((i) => esc(i.name)).join(' + ')}</span><span class="badge brand">${esc(v.main_staff_name || '')}${v.assistant_name ? ' + ' + esc(v.assistant_name) : ''}</span>
    <span class="spacer"></span>${v.masked ? '' : `<b>${money(v.total)}</b><button class="btn sm" data-rc-id="${v.id}">Hóa đơn</button>`}${v.can_edit ? `<button class="btn sm" data-vedit="${v.id}">${isOwner() ? 'Sửa' : 'Sửa ghi chú'}</button>` : ''}</div>
    ${v.hair_before ? `<div class="small"><span class="muted">Tóc trước:</span> ${esc(v.hair_before)}</div>` : ''}
    ${v.wish ? `<div class="small"><span class="muted">Mong muốn:</span> ${esc(v.wish)}</div>` : ''}
    ${v.formula ? `<div class="small pre"><span class="muted">Công thức:</span> ${esc(v.formula)}</div>` : ''}
    ${v.result ? `<div class="small"><span class="muted">Kết quả:</span> ${esc(v.result)}</div>` : ''}
    ${v.note ? `<div class="small"><span class="muted">Ghi chú:</span> ${esc(v.note)}</div>` : ''}
    ${!v.masked && v.card_paid ? `<div class="small"><span class="muted">Trừ thẻ ${esc(v.card_code || '')}:</span> ${money(v.card_paid)}</div>` : ''}
    <div style="margin-top:8px">${ps.length ? photoGrid(ps, true) : ''}
    <div class="row" style="margin-top:6px"><label class="btn sm">📷 Ảnh trước<input type="file" accept="image/*" multiple hidden data-vphoto="${v.id}" data-kind="before"></label>
    <label class="btn sm">📷 Ảnh sau<input type="file" accept="image/*" multiple hidden data-vphoto="${v.id}" data-kind="after"></label></div></div></div>`;
}

// ---------- Ghi lượt làm (thu tiền) ----------
// Nhân viên sửa hóa đơn đã hoàn thành: chỉ ghi chú, tiền khóa (quản lý mới sửa được)
function visitNotesForm(v, after) {
  openModal('Sửa ghi chú lượt ' + (v.code || ''), `<form id="vn"><div class="small" style="margin-bottom:8px">🔒 Hóa đơn đã hoàn thành: <b>dịch vụ, giá, giảm giá, tip, thanh toán</b> chỉ Lãnh đạo (Vinh) sửa được. Cần sửa tiền thì nhắn Vinh. Thông tin khách (tên, SĐT, lưu ý tóc) sửa ở hồ sơ khách.</div>
    <div class="totals small">${esc((v.items || []).map((i) => i.name).join(' + '))}${v.total != null ? ` · <b>${money(v.total)}</b>` : ''}${v.tip ? ' · tip ' + money(v.tip) : ''}${v.tip_private ? ' · tip riêng ' + money(v.tip_private) : ''}</div>
    <div class="form-grid" style="margin-top:8px">
    <div class="full"><label>Tình trạng tóc trước khi làm</label>${hairChips()}<textarea name="hair_before">${esc(v.hair_before || '')}</textarea></div>
    <div class="full"><label>Mong muốn của khách</label><input name="wish" value="${esc(v.wish || '')}"></div>
    <div class="full"><label>Công thức / tỷ lệ pha</label><textarea name="formula">${esc(v.formula || '')}</textarea></div>
    <div class="full"><label>Kết quả sau làm</label><input name="result" value="${esc(v.result || '')}"></div>
    <div><label>Hẹn chăm sóc lại</label><input type="date" name="next_visit_date" value="${v.next_visit_date || ''}"></div>
    <div><label>Ghi chú</label><input name="note" value="${esc(v.note || '')}"></div></div>
    <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu ghi chú</button></div></form>`);
  $('#vn').onsubmit = (e) => { e.preventDefault(); guard($('#vn button.primary'), async () => { await api('/visits/' + v.id, { method: 'PUT', body: formData($('#vn')) }); closeModal(); toast('Đã lưu ghi chú'); (after || route)(); }); };
}
async function visitForm(v = {}, after) {
  const isEdit = !!v.id;
  if (isEdit && !isOwner()) return visitNotesForm(v, after);
  const methods = S.settings.payment_methods;
  const svcOpts = (sel) => `<option value="">— Dịch vụ —</option>` + S.groups.map((g) => `<optgroup label="${esc(g)}">${S.services.filter((s) => s.grp === g && (s.active || s.id === sel))
    .map((s) => `<option value="${s.id}" data-price="${s.price}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${s.price ? ' · ' + (s.price / 1000) + 'k' : ''}</option>`).join('')}</optgroup>`).join('')
    + (S.materials.some((m) => m.kind === 'retail' && m.active) ? `<optgroup label="🛍 Sản phẩm bán lẻ (trừ kho)">${S.materials.filter((m) => m.kind === 'retail' && m.active)
      .map((m) => `<option value="m${m.id}" data-price="${m.sell_price || 0}">${esc(m.name)}${m.sell_price ? ' · ' + kMoney(m.sell_price) : ''}</option>`).join('')}</optgroup>` : '');
  let items = v.items ? v.items.map((i) => (i.material_id ? { material_id: i.material_id, qty: i.qty || 1, price: i.price, staff_id: i.staff_id || '', assistant_id: i.assistant_id ?? '' } : { service_id: i.service_id, name: i.name, price: i.price, staff_id: i.staff_id || '', assistant_id: i.assistant_id ?? '' })) : [];
  // Hóa chất đã dùng: amt theo ml/g (hoặc tuýp/chai nếu chưa khai dung tích)
  let used = (v.materials || []).map((x) => ({ material_id: x.material_id, amt: fromUnits(matById(x.material_id), x.qty) }));
  const recipeFor = (its) => {
    const out = [];
    for (const it of its) for (const r of S.recipes.filter((x) => x.service_id === Number(it.service_id))) {
      const m = matById(r.material_id); if (!m) continue;
      const ex = out.find((o) => o.material_id === r.material_id);
      if (ex) ex.amt = Math.round((ex.amt + fromUnits(m, r.qty)) * 100) / 100; else out.push({ material_id: r.material_id, amt: fromUnits(m, r.qty) });
    }
    return out;
  };
  if (!items.length) {
    items = splitSvc(v.service).map((n) => { const g = findSvc(n); return g ? { service_id: g.id, price: g.price } : { service_id: '', name: n, price: '' }; });
    if (!items.length) items = [{ service_id: '', price: '' }];
  }
  const custSel = v.customer || (v.customer_id ? { id: v.customer_id, code: v.customer_code || '', name: v.customer_name || '' } : null);
  openModal(isEdit ? `Sửa lượt ${v.code}` : 'Ghi lượt làm / thu tiền', `<form id="vf"><div class="form-grid">
    <div class="full"><label>Khách hàng *</label>${customerPicker('customer_id', custSel)}</div>
    <div><label>Ngày</label><input type="date" name="date" value="${v.date || S.today}" ${!isMgr() ? 'readonly' : ''}></div>
    <div><label>Giờ</label><input type="time" name="time" value="${v.time || new Date().toTimeString().slice(0, 5)}"></div>
    <div><label>Thợ chính (người làm) *</label><select name="main_staff_id" required>${staffOptions(v.main_staff_id || (!isMgr() ? S.me.id : null))}</select></div>
    <div><label>Người phụ (cả phiếu)</label><select name="assistant_id">${staffOptions(v.assistant_id, 'Không có')}</select></div>
    <div class="full"><label>Dịch vụ / sản phẩm bán (giá sửa được)</label><div id="items"></div><div class="row"><div style="flex:1;min-width:200px" id="vSvcS"></div><button type="button" class="btn sm" id="addItem">+ Thêm dòng</button><button type="button" class="btn sm" id="scanItem">📷 Quét SP bán</button></div></div>
    ${S.materials.some((m) => m.kind === 'service') ? `<div class="full"><label>🧪 Hóa chất đã dùng (ghi để tính giá cốt, trừ kho)</label><div id="used"></div>
      <div class="row"><button type="button" class="btn sm" id="addUsed">+ Thêm hóa chất</button><button type="button" class="btn sm" id="recipeFill">↻ Lấy theo định mức dịch vụ</button><button type="button" class="btn sm" id="formulaFill">🧪 Tính từ công thức</button></div></div>` : ''}
    <div><label>Phụ thu</label><input type="number" name="surcharge" min="0" step="1000" value="${v.surcharge || ''}"></div>
    <div><label>Giảm giá</label><div class="row" style="gap:6px;flex-wrap:nowrap"><input type="number" name="discount" min="0" step="1000" value="${v.discount || ''}" style="flex:1;min-width:0">
      <input type="number" id="discPct" min="0" max="100" step="1" placeholder="%" title="Giảm theo % tiền dịch vụ" style="width:70px"><span class="muted">%</span></div>
      <div class="row" style="gap:4px;margin-top:4px">${[10, 15, 20, 30, 50].map((p) => `<button type="button" class="btn sm" data-dpct="${p}">${p}%</button>`).join('')}<button type="button" class="btn sm" data-dpct="0">Bỏ</button></div>
      <div class="small muted" id="discTxt"></div></div>
    <div class="full" id="discRW" style="${v.discount ? '' : 'display:none'}"><label>Lý do giảm (bắt buộc khi có giảm)</label><input name="discount_reason" list="reasons" value="${esc(v.discount_reason || '')}">
      <datalist id="reasons"><option value="Khách quen"><option value="Khách giới thiệu"><option value="Khuyến mãi"><option value="Bù lỗi dịch vụ"><option value="Người nhà / nhân viên"><option value="Trẻ em dưới 13 tuổi (giảm 50%)"></datalist></div>
    <div id="cardBox" class="full"></div>
    <div class="full"><div class="totals" id="tot"></div></div>
    <div class="full pay-box"><label>Khách trả bằng</label><div class="row pay-quick">${methods.map((m) => `<button type="button" class="btn ${v.payment_method === m ? 'primary' : ''}" data-pm="${esc(m)}">${payIcon(m)} ${esc(m)}</button>`).join('')}
      <button type="button" class="btn sm ghost" id="pay2Tg">${v.pay2_method ? '− Bỏ trả 2 cách' : '+ Trả 2 cách'}</button></div>
      <select name="payment_method" style="display:none"><option value="">—</option>${methods.map((m) => `<option ${v.payment_method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <div class="row" id="pay2Box" style="margin-top:6px;gap:6px;${v.pay2_method ? '' : 'display:none'}"><span class="small">Trong đó trả bằng</span><select name="pay2_method" style="width:auto"><option value="">—</option>${methods.map((m) => `<option ${v.pay2_method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
        <input type="number" name="pay2_amount" min="0" step="1000" placeholder="số tiền" value="${v.pay2_amount || ''}" style="width:130px"><span class="small muted" id="pay2Txt"></span></div>
      <div id="qrBox"></div>
      <div class="pay-give"><label for="paidAct">Khách đưa</label><input type="number" id="paidAct" min="0" step="1000" placeholder="trống = trả đủ"><span class="small" id="paidHint"></span></div>
      <div id="shortBox"></div><input type="hidden" name="debt" value="${v.debt || ''}"></div>
    <details class="full tipbox" ${v.tip || v.tip_private ? 'open' : ''}><summary>💝 Tip <span class="small muted">(khách cho thêm · trả dư tự vào tip chung)</span></summary>
      <div class="form-grid" style="margin:6px 0 0"><div><label>Tip chung (chia cả nhóm)</label><input type="number" name="tip" min="0" step="1000" value="${v.tip || ''}"></div>
      <div><label>Tip riêng 1 người</label><div class="row" style="gap:6px;flex-wrap:nowrap"><input type="number" name="tip_private" min="0" step="1000" value="${v.tip_private || ''}" style="flex:1;min-width:0"><select name="tip_private_to" style="flex:1;min-width:0">${staffOptions(v.tip_private_to || null, '— Thợ chính —')}</select></div></div></div></details>
    <div class="full"><label>Tình trạng tóc trước khi làm</label>${hairChips()}<textarea name="hair_before">${esc(v.hair_before || '')}</textarea></div>
    <div class="full"><label>Mong muốn của khách</label><input name="wish" value="${esc(v.wish || '')}"></div>
    <div class="full"><label>Công thức / tỷ lệ pha</label><div id="fHint"></div><textarea name="formula" placeholder="VD: 9nb 35ml + 7glca 25ml, oxi 20 (gõ lượng ml/g để app tự tính hóa chất & giá cốt)">${esc(v.formula || '')}</textarea><div id="fCost" class="small"></div></div>
    <div class="full"><label>Kết quả sau làm</label><input name="result" value="${esc(v.result || '')}"></div>
    <div><label>Hẹn chăm sóc lại</label><input type="date" name="next_visit_date" value="${v.next_visit_date || ''}"></div>
    <div><label>Ghi chú</label><input name="note" value="${esc(v.note || '')}"></div>
    ${!isEdit ? `<div><label>📷 Ảnh trước</label><input type="file" accept="image/*" multiple id="phB"></div><div><label>📷 Ảnh sau</label><input type="file" accept="image/*" multiple id="phA"></div>` : ''}
    </div><div class="err"></div><div class="modal-foot">${isEdit && isOwner() ? '<button type="button" class="btn danger" id="delV">Xóa lượt</button><span class="spacer"></span>' : ''}
    <button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary" id="vfSave">Lưu lượt làm</button></div></form>`, true);
  const f = $('#vf');
  let cards = [];
  // Khách trả dư so với số phải trả → phần dư tự vào TIP CHUNG (chia đều người đi làm hôm đó)
  let due = 0;
  const debtNow = () => Number((f.debt && f.debt.value) || 0);
  const paidSync = () => {
    const pa = $('#paidAct'), sb = $('#shortBox'); if (!pa || !sb) return;
    const debt = debtNow();
    sb.innerHTML = debt ? `<div class="debt-note">📝 ${v.debt_paid_at ? `Khách đã trả nợ ${money(debt)} ngày ${dmy(v.debt_paid_at)}` : `Ghi nợ <b>${money(debt)}</b> – khách trả sau, thu ở trang Thu ngân`}
      ${v.debt_paid_at ? '' : '<button type="button" class="btn sm" id="debtX">Bỏ nợ</button>'}</div>` : '';
    if (pa.value === '') { $('#paidHint').textContent = ''; }
    else {
      const extra = Number(pa.value) - (due - debt);
      $('#paidHint').innerHTML = extra > 0 ? `<span style="color:var(--ok)">Dư ${money(extra)} → tip chung</span>` : extra < 0 ? `<b style="color:var(--bad)">Thiếu ${money(-extra)}</b>` : '<span style="color:var(--ok)">✓ Đủ tiền</span>';
      if (extra > 0) { f.tip.value = extra; $('.tipbox', f).open = true; } else if (extra === 0 && !debt) f.tip.value = '';
      if (extra < 0) sb.innerHTML += `<div class="short-pick"><span>Khách đưa thiếu <b>${money(-extra)}</b>, xử lý:</span>
        <button type="button" class="btn sm primary" id="shDebt">📝 Ghi nợ, trả sau</button><button type="button" class="btn sm" id="shDisc">🏷 Giảm giá ${money(-extra)}</button></div>`;
      const sd = $('#shDebt'); if (sd) sd.onclick = () => { f.debt.value = debt - extra; calc(); };
      const sc = $('#shDisc'); if (sc) sc.onclick = () => { $('#discPct').value = ''; f.discount.value = Number(f.discount.value || 0) - extra; if (!f.discount_reason.value) f.discount_reason.value = 'Khách trả thiếu'; calc(); };
    }
    const dx = $('#debtX'); if (dx) dx.onclick = () => { f.debt.value = ''; calc(); };
  };
  // QR chuyển khoản có sẵn số tiền (VietQR) – hiện khi chọn Chuyển khoản
  const qrSync = () => {
    const box = $('#qrBox'); if (!box) return;
    const pm = f.payment_method.value, m2 = f.pay2_method.value, a2 = Number(f.pay2_amount.value || 0);
    const two = $('#pay2Box').style.display !== 'none' && m2 && a2 > 0, now = Math.max(0, due - debtNow());
    $('#pay2Txt').textContent = two ? `· còn ${money(Math.max(0, now - a2))} bằng ${pm || '…'}` : '';
    const isCk = (m) => /khoản|ck|bank/i.test(m || '');
    const amt = two && isCk(m2) ? a2 : isCk(pm) ? (two ? Math.max(0, now - a2) : now) : 0;
    const q = S.settings.qr;
    if (!amt) { box.innerHTML = ''; return; }
    if (!q) { box.innerHTML = isOwner() ? '<div class="small muted" style="margin-top:6px">Muốn hiện mã QR chuyển khoản có sẵn số tiền: vào Cài đặt › Tham số, điền ngân hàng + số tài khoản.</div>' : ''; return; }
    const info = 'NEP ' + (custSel ? custSel.name || '' : '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').slice(0, 20);
    const src = `https://img.vietqr.io/image/${encodeURIComponent(q.bank)}-${encodeURIComponent(q.account)}-compact2.png?amount=${amt}&addInfo=${encodeURIComponent(info)}&accountName=${encodeURIComponent(q.name)}`;
    box.innerHTML = `<div class="qr-pay"><img src="${src}" alt="QR chuyển khoản" loading="lazy"><div><b>Quét để chuyển ${money(amt)}</b><div class="small muted">${esc(q.bank)} · ${esc(q.account)}${q.name ? ' · ' + esc(q.name) : ''}</div><div class="small muted">Khách chuyển xong, kiểm tra tiền về rồi mới bấm Lưu.</div></div></div>`;
  };
  $$('[data-pm]', f).forEach((b) => (b.onclick = () => { f.payment_method.value = b.dataset.pm; $$('[data-pm]', f).forEach((x) => x.classList.toggle('primary', x === b)); qrSync(); }));
  $('#pay2Tg').onclick = () => { const box = $('#pay2Box'), on = box.style.display === 'none'; box.style.display = on ? '' : 'none'; if (!on) { f.pay2_method.value = ''; f.pay2_amount.value = ''; } $('#pay2Tg').textContent = on ? '− Bỏ trả 2 cách' : '+ Trả 2 cách'; qrSync(); };
  f.pay2_method.onchange = qrSync; f.pay2_amount.oninput = qrSync;
  const renderItems = () => {
    $('#items').innerHTML = items.map((it, i) => `<div class="item-row"><select data-i="${i}" class="isvc">${svcOpts(it.service_id).replace(it.material_id ? `value="m${it.material_id}"` : '\u0000', `value="m${it.material_id}" selected`)}${!it.service_id && !it.material_id && it.name ? `<option selected value="">${esc(it.name)}</option>` : ''}</select>
      ${it.material_id ? `<input type="number" data-i="${i}" class="iqty" min="1" step="1" value="${it.qty || 1}" title="Số lượng" style="width:64px">` : ''}
      <select data-i="${i}" class="istaff" title="Thợ làm dòng này (hoa hồng dịch vụ tính cho người này)"><option value="">Chính: ${esc(hdrName(f.main_staff_id.value) || 'thợ chính')}</option>${activeStaff().filter((s) => String(s.id) !== String(f.main_staff_id.value)).map((s) => `<option value="${s.id}" ${Number(it.staff_id) === s.id ? 'selected' : ''}>Chính: ${esc(s.full_name)}</option>`).join('')}</select>
      <select data-i="${i}" class="iasst" title="Người phụ của dòng này (hoa hồng phụ tính cho người này)"><option value="">Phụ: ${esc(hdrName(f.assistant_id.value) || 'không có')}</option>${f.assistant_id.value ? `<option value="0" ${it.assistant_id === 0 || it.assistant_id === '0' ? 'selected' : ''}>Phụ: không có</option>` : ''}${activeStaff().filter((s) => String(s.id) !== String(f.assistant_id.value)).map((s) => `<option value="${s.id}" ${Number(it.assistant_id) === s.id ? 'selected' : ''}>Phụ: ${esc(s.full_name)}</option>`).join('')}</select>
      <input type="number" data-i="${i}" class="iprice" min="0" step="1000" value="${it.price ?? ''}" placeholder="Giá"><button type="button" class="icon-btn" data-rm="${i}">×</button></div>`).join('');
    $$('.istaff', f).forEach((s) => (s.onchange = () => { items[s.dataset.i].staff_id = s.value; }));
    $$('.iasst', f).forEach((s) => (s.onchange = () => { items[s.dataset.i].assistant_id = s.value; }));
    $$('.isvc', f).forEach((s) => (s.onchange = () => {
      const o = s.selectedOptions[0], price = o && o.dataset.price ? Number(o.dataset.price) : '';
      const who = items[s.dataset.i] ? items[s.dataset.i].staff_id : '', asst = items[s.dataset.i] ? items[s.dataset.i].assistant_id : '';
      items[s.dataset.i] = s.value.startsWith('m') ? { material_id: Number(s.value.slice(1)), qty: 1, price, staff_id: who, assistant_id: asst } : { service_id: Number(s.value) || '', price, staff_id: who, assistant_id: asst };
      if (levelSwap(items[s.dataset.i], f.main_staff_id.value)) toast('Đã đổi sang giá cắt đúng cấp của thợ chính');
      renderItems(); autoRecipe();
    }));
    $$('.iqty', f).forEach((q) => (q.oninput = () => { const it = items[q.dataset.i]; const m = matById(it.material_id); it.qty = Math.max(1, Number(q.value) || 1); if (m && m.sell_price) { it.price = m.sell_price * it.qty; $(`.iprice[data-i="${q.dataset.i}"]`, f).value = it.price; } calc(); }));
    $$('.iprice', f).forEach((p) => (p.oninput = () => { items[p.dataset.i].price = p.value; calc(); }));
    $$('[data-rm]', f).forEach((b) => (b.onclick = () => { items.splice(b.dataset.rm, 1); if (!items.length) items.push({ service_id: '', price: '' }); renderItems(); }));
    calc();
  };
  const calc = () => {
    const sub = items.reduce((s, i) => s + Number(i.price || 0), 0);
    // Giảm theo %: tính trên tiền dịch vụ/sản phẩm (không tính phụ thu), làm tròn nghìn
    const pct = Number($('#discPct').value || 0);
    if (pct > 0) { f.discount.value = Math.round((sub * Math.min(100, pct)) / 100 / 1000) * 1000; $('#discTxt').textContent = `${pct}% của ${money(sub)} = −${money(Number(f.discount.value))}`; }
    else $('#discTxt').textContent = Number(f.discount.value) > 0 && sub ? `≈ ${Math.round((Number(f.discount.value) / sub) * 1000) / 10}% tiền dịch vụ` : '';
    const total = Math.max(0, sub + Number(f.surcharge.value || 0) - Number(f.discount.value || 0));
    $('#discRW').style.display = Number(f.discount.value) > 0 ? '' : 'none';
    const cardSel = f.card_id ? Number(f.card_id.value) : 0;
    let cardPaid = 0;
    if (cardSel) {
      const c = cards.find((x) => x.id === cardSel);
      const bal = c ? c.balance + (isEdit && v.card_id === c.id ? v.card_paid : 0) : 0;
      cardPaid = f.card_paid.value !== '' ? Number(f.card_paid.value) : Math.min(bal, total);
      $('#cardHint').innerHTML = c && c.sale_type === 'gift'
        ? (total > 0 ? `🎁 Thẻ tri ân dùng 1 lần: trừ <b>${money(cardPaid)}</b>${bal > cardPaid ? `, <span style="color:var(--bad)">bỏ ${money(bal - cardPaid)}</span> (không giữ cho lần sau)` : ''}. Lưu xong thẻ tự đóng.` : `🎁 Thẻ tri ân ${money(bal)} – thêm dịch vụ để tính tiền trừ.`)
        : `Số dư khả dụng ${money(bal)}`;
    }
    $('#tot').innerHTML = `${sub !== total ? `<div class="row"><span>Tạm tính</span><span class="num">${money(sub)}</span></div>` : ''}
      <div class="row"><span>Doanh số lượt này</span><span class="num big">${money(total)}</span></div>
      ${cardSel ? `<div class="row"><span>Trừ thẻ</span><span class="num">−${money(cardPaid)}</span></div>` : ''}
      <div class="row"><span><b>Khách cần trả</b></span><span class="num big">${money(Math.max(0, total - cardPaid))}</span></div>
      ${debtNow() ? `<div class="row" style="color:var(--bad)"><span>Ghi nợ (trả sau)</span><span class="num">−${money(debtNow())}</span></div><div class="row"><span><b>Thu bây giờ</b></span><span class="num big">${money(Math.max(0, total - cardPaid - debtNow()))}</span></div>` : ''}${(() => { due = Math.max(0, total - cardPaid); setTimeout(() => { paidSync(); qrSync(); }); return ''; })()}
      ${Number(f.surcharge.value) > 0 ? (() => { const sc = Number(f.surcharge.value), r = S.settings.surcharge_salon_rate ?? 0.33, st = sc - Math.round(sc * r), as = f.assistant_id.value ? Math.floor(st / 2) : 0;
        return `<div class="row small muted"><span>Phụ thu chia: cửa hàng ${money(sc - st)} (${Math.round(r * 100)}%) · thợ chính ${money(st - as)}${as ? ' · người phụ ' + money(as) : ''}</span></div>`; })() : ''}
      ${f.time.value >= '19:00' && sub && !Number(f.surcharge.value) ? `<div class="row small" style="color:var(--warn)"><span>Lịch sau 19:00: phụ thu 10% theo bảng giá</span><button type="button" class="btn sm" id="eveSur">+ ${money(Math.round(sub * 0.1 / 1000) * 1000)}</button></div>` : ''}
      ${isMgr() && (used.length || items.some((i) => i.material_id)) ? (() => {
        const cost = Math.round(used.reduce((t, u) => { const m = matById(u.material_id); return t + (m ? toUnits(m, u.amt || 0) * (m.avg_cost || 0) : 0); }, 0)
          + items.reduce((t, i) => { const m = i.material_id && matById(i.material_id); return t + (m ? (i.qty || 1) * (m.avg_cost || 0) : 0); }, 0));
        return `<div class="row small muted"><span>Giá cốt (hóa chất + giá vốn SP) · chỉ quản lý thấy</span><span class="num">${money(cost)} · lãi gộp ${money(total - cost)}${total ? ' (' + Math.round((total - cost) / total * 100) + '%)' : ''}</span></div>`;
      })() : ''}`;
    const es = $('#eveSur'); if (es) es.onclick = () => { f.surcharge.value = Math.round(sub * 0.1 / 1000) * 1000; calc(); };
  };
  const renderUsed = () => {
    const box = $('#used'); if (!box) return;
    box.innerHTML = used.map((u, i) => { const m = matById(u.material_id); return `<div class="item-row"><select data-u="${i}" class="usel"><option value="">— Chọn hóa chất —</option>${matOptions('service', u.material_id)}</select>
      <input type="number" data-u="${i}" class="uamt" min="0" step="any" value="${u.amt ?? ''}" placeholder="Lượng" style="width:90px"><span class="small muted" style="min-width:34px">${esc(matUnit(m))}</span><button type="button" class="icon-btn" data-urm="${i}">×</button></div>`; }).join('')
      || '<div class="small muted">Chưa ghi hóa chất. Bấm "Lấy theo định mức" hoặc "+ Thêm hóa chất".</div>';
    $$('.usel', box).forEach((s) => (s.onchange = () => { used[s.dataset.u] = { material_id: Number(s.value) || '', amt: used[s.dataset.u].amt }; renderUsed(); }));
    $$('.uamt', box).forEach((a) => (a.oninput = () => { used[a.dataset.u].amt = a.value === '' ? '' : Number(a.value); calc(); }));
    $$('[data-urm]', box).forEach((b) => (b.onclick = () => { used.splice(Number(b.dataset.urm), 1); renderUsed(); }));
    calc();
  };
  let usedTouched = isEdit, fromFormula = false;
  // Gõ công thức → tự nhận hóa chất + lượng (9nb 35ml, oxi 20…) để tính giá cốt từng đầu
  const applyFormula = (force) => {
    const box = $('#fCost'); if (!box || !window.parseFormula) return;
    const text = f.formula.value.trim();
    if (!text) { box.innerHTML = ''; return; }
    const r = window.parseFormula(text, S.materials);
    box.innerHTML = (r.lines.length ? `<div style="margin-top:4px">🧪 App đọc được: ${r.lines.map((l) => `<b>${esc(l.name)}</b> ${l.amt}${esc(l.unit || '')}${l.guessed ? ' <span class="muted">(đoán)</span>' : ''}`).join(' · ')}</div>` : '')
      + (r.unknown.length ? `<div style="color:var(--warn)">Chưa nhận ra: ${r.unknown.map(esc).join(', ')}</div>` : '')
      + (r.warn.length ? `<div style="color:var(--warn)">${r.warn.map(esc).join('<br>')}</div>` : '')
      + (isMgr() && (r.unknown.length || r.lines.some((l) => l.guessed)) ? '<div class="muted">Dạy app mã màu: Kho › Sửa hóa chất › ô “Mã viết trong công thức”.</div>' : '');
    if (!$('#used') || !r.lines.length) return;
    if (force || fromFormula || !usedTouched || !used.some((u) => u.material_id)) {
      used = r.lines.map((l) => ({ material_id: l.material_id, amt: l.amt })); fromFormula = true; renderUsed();
    }
  };
  const autoRecipe = () => { if (usedTouched || fromFormula) return; const r = recipeFor(items); if (r.length) { used = r; renderUsed(); } };
  let extraCards = [];
  const loadCards = async (customerId, pick) => {
    const own = customerId ? (await api('/cards?status=active&customer_id=' + customerId)).filter((c) => c.balance > 0 || c.id === v.card_id) : [];
    if (v.card_id && !own.some((c) => c.id === v.card_id) && !extraCards.some((c) => c.id === v.card_id)) {
      const all = await api('/cards?status=active'); const c = all.find((x) => x.id === v.card_id); if (c) extraCards.push(c);
    }
    cards = [...own, ...extraCards.filter((c) => !own.some((o) => o.id === c.id))];
    const sel = pick || v.card_id;
    const gift = !sel && cards.find((c) => c.sale_type === 'gift' && c.balance > 0 && c.customer_id === Number(customerId));
    $('#cardBox').innerHTML = (gift ? `<div class="gift-ban">🎁 Khách có <b>${esc(gift.name)}</b> (${esc(gift.code)}) còn <b>${money(gift.balance)}</b>. Chỉ dùng 1 lần, dư không giữ lại.
        <button type="button" class="btn sm primary" id="useGift">Dùng thẻ cho lượt này</button></div>` : '')
      + (cards.length ? `<div class="form-grid"><div><label>Trừ vào thẻ</label><select name="card_id"><option value="">Không dùng thẻ</option>
      ${cards.map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.code)} · ${esc(c.name)} · còn ${money(c.balance)}${c.customer_id !== Number(customerId) ? ' · thẻ của ' + esc(c.customer_name) : ''}${c.expires_at < S.today ? ' (HẾT HẠN)' : ''}</option>`).join('')}</select></div>
      <div><label>Số tiền trừ thẻ (trống = tự tính)</label><input type="number" name="card_paid" min="0" step="1000" value="${isEdit && v.card_id ? v.card_paid : ''}"><div class="small muted" id="cardHint"></div></div></div>` : '')
      + (customerId ? `<details class="small card-more"><summary>Tặng / bán thẻ · khách dùng thẻ của người khác</summary><div class="row small" style="margin-top:6px"><button type="button" class="btn sm" id="vGift">🎁 Tặng thẻ tri ân 1Tr</button><button type="button" class="btn sm" id="vSell">💳 Bán thẻ trả trước</button>
        <span class="muted">→ tạo xong trừ vào thẻ luôn ở phiếu này</span></div><div id="vSellBox"></div>` : '')
      + (customerId ? `<div class="row small" style="margin-top:6px"><span class="muted">Khách dùng thẻ tặng của người khác?</span><input id="giftQ" placeholder="Mã thẻ (T1M-…) hoặc SĐT chủ thẻ" style="width:auto;flex:1;min-width:150px"><button type="button" class="btn sm" id="giftFind">Tìm thẻ</button></div></details>` : '');
    if (cards.length) { f.card_id.onchange = calc; f.card_paid.oninput = calc; }
    const ug = $('#useGift'); if (ug) ug.onclick = () => loadCards(customerId, gift.id);
    // Bán / tặng thẻ ngay trong phiếu thu, rồi chọn luôn thẻ đó để trừ
    const giftType = S.cardTypes.find((t) => t.active && !t.price && t.fixed_expiry) || S.cardTypes.find((t) => t.active && !t.price);
    const makeCard = async (body) => {
      const c = await api('/cards', { method: 'POST', body: { customer_id: customerId, ...body } });
      await loadCards(customerId, c.id);
      toast(c.price ? `Đã bán thẻ ${c.code}: thu ${money(c.price)}, số dư ${money(c.balance)}` : `Đã tặng thẻ ${c.code} trị giá ${money(c.balance)}`);
    };
    const vg = $('#vGift');
    if (vg) {
      if (!giftType) vg.remove();
      else vg.onclick = () => guard(vg, async () => {
        const all = await api('/cards?customer_id=' + customerId);
        const had = all.find((c) => c.card_type_id === giftType.id);
        if (had && !confirm(`Khách đã được tặng thẻ ${had.code} (còn ${money(had.balance)}). Vẫn tặng thêm thẻ nữa?`)) return;
        await makeCard({ card_type_id: giftType.id });
      });
    }
    const vs = $('#vSell');
    if (vs) vs.onclick = () => {
      const paid = S.cardTypes.filter((t) => t.active && t.price);
      $('#vSellBox').innerHTML = `<div class="totals" style="margin-top:6px"><div class="form-grid">
        <div class="full"><label>Gói thẻ</label><select id="vsType">${paid.map((t) => `<option value="${t.id}">${esc(t.name)} · thu ${money(t.price)} → dùng ${money(t.value)}</option>`).join('')}<option value="">Tùy chỉnh số tiền…</option></select></div>
        <div><label>Khách trả (trống = theo gói)</label><input type="number" id="vsPrice" min="0" step="100000"></div>
        <div><label>Giá trị dùng (trống = theo gói)</label><input type="number" id="vsValue" min="0" step="100000"></div>
        <div><label>Hình thức thanh toán</label><select id="vsPay">${S.settings.payment_methods.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
        <div><label>Loại</label><select id="vsKind"><option value="new">Khách mua mới</option><option value="renewal">Mua lại / nạp thêm</option></select></div></div>
        <div class="small muted">Tiền bán thẻ tính vào tiền vào, không cộng vào doanh số dịch vụ. Đừng ghi bán thẻ vào dòng "Bán sản phẩm".</div>
        <div class="row" style="margin-top:8px"><button type="button" class="btn sm primary" id="vsGo">Xác nhận bán thẻ</button><button type="button" class="btn sm" id="vsX">Bỏ</button></div></div>`;
      $('#vsX').onclick = () => { $('#vSellBox').innerHTML = ''; };
      $('#vsGo').onclick = () => guard($('#vsGo'), async () => {
        const type = $('#vsType').value, price = $('#vsPrice').value, value = $('#vsValue').value;
        if (!type && !price) throw new Error('Nhập số tiền khách trả');
        await makeCard({ card_type_id: type || null, price, value: value || (!type ? price : ''), payment_method: $('#vsPay').value, sale_type: $('#vsKind').value });
      });
    };
    const gb = $('#giftFind');
    if (gb) gb.onclick = () => guard(gb, async () => {
      const q = $('#giftQ').value.trim(); if (!q) return;
      const found = (await api('/cards?status=active&q=' + encodeURIComponent(q))).filter((c) => c.balance > 0);
      if (!found.length) return toast('Không thấy thẻ tặng còn số dư với mã/SĐT này');
      extraCards = [...extraCards, ...found.filter((c) => !extraCards.some((e) => e.id === c.id))];
      await loadCards(customerId, found[0].id);
      toast(`Đã chọn thẻ ${found[0].code} của ${found[0].customer_name}`);
    });
    calc();
  };
  // Chọn khách → hiện công thức chuẩn + lưu ý tóc, tự chọn thợ phụ trách nếu chưa chọn thợ
  const showBrief = async (cid) => {
    if (!cid) return;
    let b; try { b = await api(`/customers/${cid}/brief`); } catch { return; }
    if (!isEdit && !f.main_staff_id.value && b.staff_id) f.main_staff_id.value = b.staff_id;
    const wb = (b.warranties || []).map((x) => `<div class="totals small" style="margin-bottom:6px;border-left:3px solid var(--warn)"><b>🛡 Khách đang trong hạn bảo hành</b> · lượt ${esc(x.code)} ngày ${dmy(x.date)}${x.staff_name ? ' (' + esc(x.staff_name) + ')' : ''}
      ${warrantyLines(x.warranties).map((l) => `<div>${esc(l)}</div>`).join('')}<div class="muted">Nếu làm lại do lỗi kỹ thuật: ghi giảm giá với lý do "Bảo hành lượt ${esc(x.code)}".</div></div>`).join('');
    const fam = (b.family || []).length ? `<div><span class="muted">👨‍👩‍👧 Người nhà:</span> ${b.family.map((m) => `<a href="#customer?id=${m.id}" target="_blank">${esc(m.name)}</a>${m.relation ? ' (' + esc(m.relation) + ')' : ''}${m.has_formula ? ' 🧪' : ''}`).join(', ')}</div>` : '';
    const lh = b.last_hair ? `<div><span class="muted">Tóc lần trước (${dmy(b.last_hair.date)}):</span> ${esc([b.last_hair.hair_before, b.last_hair.result && 'KQ: ' + b.last_hair.result].filter(Boolean).join(' · '))}</div>` : '';
    $('#fHint').innerHTML = wb + (b.formula || b.hair_notes || fam || lh ? `<div class="totals small" style="margin-bottom:6px">${b.staff_name ? `<div>Thợ phụ trách: <b>${esc(b.staff_name)}</b></div>` : ''}
      ${b.hair_notes ? `<div><span class="muted">Lưu ý tóc:</span> ${esc(b.hair_notes)}</div>` : ''}${lh}${fam}
      ${b.formula ? `<div><span class="muted">Công thức khách (${dmy(b.formula_at)}${b.formula_by_name ? ', ' + esc(b.formula_by_name) : ''}):</span><div class="pre">${esc(b.formula)}</div>
      ${!f.formula.value ? '<button type="button" class="btn sm" id="useF">↓ Dùng lại công thức này</button>' : ''}` : ''}</div>` : '');
    const u = $('#useF'); if (u) u.onclick = () => { f.formula.value = b.formula; u.remove(); };
  };
  { let ft; f.formula.addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(() => applyFormula(false), 500); }); }
  if (f.formula.value.trim()) applyFormula(false);
  bindPicker(f, (cid) => { loadCards(cid); showBrief(cid); });
  showBrief(custSel && custSel.id);
  $('#addItem').onclick = () => { items.push({ service_id: '', price: '' }); renderItems(); };
  // Quét mã sản phẩm bán lẻ → thêm dòng (quét lại cùng SP = tăng số lượng)
  $('#scanItem').onclick = () => scanBarcode({ title: 'Quét sản phẩm bán cho khách', continuous: true, hint: 'Quét từng sản phẩm khách mua, xong bấm “Xong”.', onCode: async (code) => {
    let m = S.materials.find((x) => x.active && hasCode(x, code));
    if (!m) { const r = await api('/stock/barcode/' + encodeURIComponent(code)); if (r.found) m = matById(r.id) || r; }
    if (!m) return `⚠ Mã <b>${esc(code)}</b> chưa gắn sản phẩm. Người giữ kho gắn mã ở trang Kho › 📷 Quét mã vạch.`;
    if (m.kind !== 'retail') return `⚠ <b>${esc(m.name)}</b> là hóa chất làm dịch vụ, không bán lẻ.`;
    const blank = items.findIndex((i) => !i.service_id && !i.material_id && !i.name);
    const ex = items.find((i) => i.material_id === m.id);
    if (ex) { ex.qty = (ex.qty || 1) + 1; if (m.sell_price) ex.price = m.sell_price * ex.qty; }
    else {
      const row = { material_id: m.id, qty: 1, price: m.sell_price || '', staff_id: '', assistant_id: '' };
      if (blank >= 0) items[blank] = row; else items.push(row);
    }
    renderItems();
    return `✓ <b>${esc(m.name)}</b>${ex ? ' × ' + ex.qty : ''}${m.sell_price ? ' · ' + money(m.sell_price) : ' · chưa có giá bán, nhập tay'}`;
  } });
  if ($('#used')) {
    $('#used').addEventListener('input', () => { usedTouched = true; fromFormula = false; });
    $('#used').addEventListener('change', () => { usedTouched = true; fromFormula = false; });
    $('#formulaFill').onclick = () => { if (!f.formula.value.trim()) return toast('Gõ công thức trước, vd: 9nb 35ml + 7glca 25ml, oxi 20'); applyFormula(true); if (!fromFormula) toast('Chưa đọc được hóa chất nào, xem dòng gợi ý dưới ô công thức'); };
    $('#addUsed').onclick = () => { usedTouched = true; used.push({ material_id: '', amt: '' }); renderUsed(); };
    $('#recipeFill').onclick = () => { const r = recipeFor(items); if (!r.length) return toast('Dịch vụ đã chọn chưa có định mức. Quản lý cài ở Kho & giá cốt → Định mức'); used = r; usedTouched = true; renderUsed(); };
  }
  const vss = svcSearch('vSvcQ', (sv) => { const empty = items.findIndex((i) => !i.service_id && !i.name); const it = { service_id: sv.id, price: sv.price }; levelSwap(it, f.main_staff_id.value); if (empty >= 0) items[empty] = it; else items.push(it); renderItems(); });
  $('#vSvcS').innerHTML = vss.html; vss.bind();
  for (const n of ['surcharge', 'discount', 'time']) f[n].addEventListener('input', calc);
  f.discount.addEventListener('input', () => { $('#discPct').value = ''; calc(); }); // gõ số tiền giảm → bỏ %
  const setPct = (p) => {
    $('#discPct').value = p || '';
    if (!p) f.discount.value = '';
    else if (!f.discount_reason.value.trim() || /^Giảm \d+%$/.test(f.discount_reason.value.trim())) f.discount_reason.value = `Giảm ${p}%`;
    calc();
  };
  $('#discPct').addEventListener('input', () => setPct(Number($('#discPct').value) || 0));
  $$('[data-dpct]', f).forEach((b) => (b.onclick = () => setPct(Number(b.dataset.dpct))));
  f.assistant_id.addEventListener('change', calc);
  $('#paidAct').addEventListener('input', () => { if (debtNow() && !v.debt_paid_at) { f.debt.value = ''; calc(); } else paidSync(); });
  f.main_staff_id.addEventListener('change', () => { const sw = items.map((it) => levelSwap(it, f.main_staff_id.value)).some(Boolean); renderItems(); if (sw) toast('Đã đổi giá cắt theo cấp của thợ chính'); });
  f.assistant_id.addEventListener('change', () => renderItems());
  renderItems();
  if (!isEdit && !used.length) autoRecipe(); else renderUsed();
  loadCards(custSel && custSel.id);
  f.onsubmit = (e) => {
    e.preventDefault();
    guard($('#vfSave'), async () => {
      const pa = $('#paidAct').value;
      if (pa !== '' && Number(pa) < due - debtNow()) throw new Error(`Khách đưa thiếu ${money(due - debtNow() - Number(pa))}: bấm "Ghi nợ" hoặc "Giảm giá" ở phần thanh toán`);
      const d = formData(f);
      const body = { ...d, items: items.filter((i) => i.service_id || i.name || i.material_id).map((i) => (i.material_id ? { material_id: i.material_id, qty: i.qty || 1, price: i.price === '' ? null : Number(i.price), staff_id: Number(i.staff_id) || null, assistant_id: i.assistant_id === '' || i.assistant_id == null ? null : Number(i.assistant_id) }
        : { service_id: i.service_id || null, name: i.name, price: i.price === '' ? null : Number(i.price), staff_id: Number(i.staff_id) || null, assistant_id: i.assistant_id === '' || i.assistant_id == null ? null : Number(i.assistant_id) })), appointment_id: v.appointment_id };
      if ($('#used')) body.materials = used.filter((u) => u.material_id && Number(u.amt) > 0).map((u) => ({ material_id: u.material_id, qty: toUnits(matById(u.material_id), u.amt) }));
      if (body.card_id && body.card_paid === '') body.card_paid = 0;
      if ($('#pay2Box').style.display === 'none') { body.pay2_method = ''; body.pay2_amount = 0; }
      const saved = await api(isEdit ? '/visits/' + v.id : '/visits', { method: isEdit ? 'PUT' : 'POST', body });
      if (!isEdit) {
        const pb = $('#phB').files, pa = $('#phA').files;
        if (pb.length) await uploadPhotos(saved.customer_id, pb, 'before', saved.id);
        if (pa.length) await uploadPhotos(saved.customer_id, pa, 'after', saved.id);
      }
      closeModal(); toast(`Đã lưu lượt ${saved.code}: ${money(saved.total)}`); (after || route)(); refreshReminderBadge();
      if (!isEdit) showReceipt(saved.id);
    });
  };
  const del = $('#delV');
  if (del) del.onclick = async () => {
    const reason = prompt('Lý do xóa lượt này? (bắt buộc, được ghi vào nhật ký)');
    if (!reason) return;
    try { await api('/visits/' + v.id, { method: 'DELETE', body: { reason } }); closeModal(); toast('Đã xóa lượt'); (after || route)(); } catch (er) { toast(er.message); }
  };
}

VIEWS.visits = async (main) => {
  const from = S.params.from || S.today, to = S.params.to || from;
  const staffId = S.params.staff || '';
  const all = await api(`/visits?from=${from}&to=${to}${staffId ? '&staff_id=' + staffId : ''}`);
  const q = fold(S.params.q || '');
  const rows = q ? all.filter((v) => fold([v.code, v.customer_name, v.customer_phone, v.main_staff_name, v.payment_method, ...v.items.map((i) => i.name)].filter(Boolean).join(' ')).includes(q)) : all;
  const sum = rows.filter((r) => !r.masked).reduce((a, r) => ({ total: a.total + r.total, cash: a.cash + r.cash_paid, card: a.card + r.card_paid, tip: a.tip + r.tip }), { total: 0, cash: 0, card: 0, tip: 0 });
  const mStart = S.today.slice(0, 8) + '01', y = addDays(S.today, -1), w = addDays(S.today, -6);
  const rng = [['Hôm nay', S.today, S.today], ['Hôm qua', y, y], ['7 ngày', w, S.today], ['Tháng này', mStart, S.today]];
  main.innerHTML = header('Hóa đơn bán hàng', 'Mỗi hóa đơn 1 dòng · bấm Hóa đơn để xem' + (isOwner() ? ', Sửa để chỉnh tiền / dịch vụ / thợ' : ''), `${isOwner() ? '<button class="btn" id="delv">🗑 Đã xóa</button>' : ''}<button class="btn primary" id="nv">+ Ghi lượt làm</button>`) +
    `<div class="card"><div class="chips" style="margin-bottom:8px">${rng.map(([l, a, b]) => `<button class="chip ${from === a && to === b ? 'on' : ''}" data-rng="${a}|${b}">${l}</button>`).join('')}</div>
      <div class="row" style="flex-wrap:wrap;gap:6px"><input type="date" id="f" value="${from}" style="width:auto"> → <input type="date" id="t" value="${to}" style="width:auto">
      <select id="st" style="width:auto">${staffOptions(Number(staffId), 'Tất cả thợ')}</select><input id="vq" placeholder="🔍 Tìm khách, mã HĐ, dịch vụ…" value="${esc(S.params.q || '')}" style="flex:1;min-width:180px"></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Khách</th><th>Dịch vụ</th><th>Thợ</th><th class="num">Doanh số</th><th class="num">Trừ thẻ</th><th class="num">Thu</th><th>TT</th><th class="num">Tip</th><th></th></tr></thead>
    <tbody>${rows.map((v) => `<tr><td class="nowrap">${dmy(v.date).slice(0, 5)} ${esc(v.time || '')}<div class="small muted">${esc(v.code || '')}</div></td><td><a href="#customer?id=${v.customer_id}">${esc(v.customer_name)}</a></td>
      <td>${v.items.map((i) => esc(i.name)).join(' + ')}</td><td>${esc(v.main_staff_name)}${v.assistant_name ? ' <span class="muted small">+' + esc(v.assistant_name) + '</span>' : ''}</td>
      <td class="num">${money(v.total)}</td><td class="num">${v.card_paid ? money(v.card_paid) : ''}</td><td class="num">${money(v.cash_paid)}</td><td class="small">${esc(v.payment_method || '')}</td><td class="num">${v.tip ? money(v.tip) : ''}${v.tip_private ? `<div class="small muted">riêng ${money(v.tip_private)}</div>` : ''}</td>
      <td class="nowrap">${v.masked ? '' : `<button class="btn sm" data-rc-id="${v.id}">Hóa đơn</button>`}${v.can_edit ? `<button class="btn sm" data-ev="${v.id}">${isOwner() ? 'Sửa' : 'Ghi chú'}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Chưa có lượt nào</td></tr>'}</tbody>
    ${rows.length ? `<tfoot><tr><td colspan="4">${rows.length} lượt${rows.some((r) => r.masked) ? ' <span class="muted small">(chỉ cộng lượt của bạn)</span>' : ''}</td><td class="num">${money(sum.total)}</td><td class="num">${money(sum.card)}</td><td class="num">${money(sum.cash)}</td><td></td><td class="num">${money(sum.tip)}</td><td></td></tr></tfoot>` : ''}
    </table></div></div>`;
  const set = (p) => go('visits', { from, to, ...(staffId ? { staff: staffId } : {}), ...p });
  $('#f').onchange = (e) => set({ from: e.target.value, to: e.target.value > to ? e.target.value : to });
  $('#t').onchange = (e) => set({ to: e.target.value });
  $$('[data-rng]', main).forEach((b) => (b.onclick = () => { const [a, c] = b.dataset.rng.split('|'); set({ from: a, to: c }); }));
  $('#vq').onchange = (e) => set({ q: e.target.value.trim() });
  $('#st').onchange = (e) => go('visits', { from, to, ...(e.target.value ? { staff: e.target.value } : {}) });
  $('#nv').onclick = () => visitForm({}, () => VIEWS.visits(main));
  if ($('#delv')) $('#delv').onclick = () => deletedVisits(from, to, () => VIEWS.visits(main));
  $$('[data-ev]', main).forEach((b) => (b.onclick = () => guard(b, async () => visitForm(await api('/visits/' + b.dataset.ev), () => VIEWS.visits(main)))));
  $$('[data-rc-id]', main).forEach((b) => (b.onclick = () => showReceipt(b.dataset.rcId)));
};

// Chi tiết hóa đơn tạo nên doanh số 1 nhân viên (theo nhóm dịch vụ) → bấm Sửa để chọn đúng người làm từng dòng
async function salesLines(from, to, staffId, grp, after) {
  const r = await api(`/reports/sales-lines?from=${from}&to=${to}&staff_id=${staffId}${grp ? '&grp=' + encodeURIComponent(grp) : ''}`);
  openModal(`${esc(staffName(staffId))} – ${grp ? esc(grp) : 'tất cả dịch vụ'} (${dmy(from).slice(0, 5)}–${dmy(to).slice(0, 5)})`,
    `<div class="small muted" style="margin-bottom:8px">Dòng nào <b>không phải ${esc(staffName(staffId))} làm</b>: bấm <b>Sửa</b> → ở dòng dịch vụ đó chọn <b>Chính: tên người làm</b> → Lưu. Doanh số, hoa hồng chuyển sang đúng người. Ô "Sổ ghi" là chữ trong ô sổ đặt lịch để đối chiếu.</div>
    <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Khách</th><th>Dịch vụ</th><th>Vai trò</th><th class="num">Tiền</th><th>Sổ ghi</th><th></th></tr></thead><tbody>
    ${r.lines.map((l) => `<tr><td class="nowrap">${dmy(l.date).slice(0, 5)} ${esc(l.time || '')}</td><td>${esc(l.customer_name || '')}</td><td>${esc(l.name)}<div class="small muted">${esc(l.grp)}</div></td>
      <td class="small">${esc(l.role)}</td><td class="num">${money(l.net)}</td><td class="small muted">${esc(l.note || '')}</td>
      <td class="nowrap"><button class="btn sm" data-lrc="${l.visit_id}">Hóa đơn</button>${isOwner() ? `<button class="btn sm" data-lev="${l.visit_id}">Sửa</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Không có dòng nào</td></tr>'}
    </tbody></table></div><div class="stat-line" style="margin-top:8px"><span>Tổng (không gồm dòng làm phụ)</span><b>${money(r.total)}</b></div>`);
  $$('[data-lrc]').forEach((b) => (b.onclick = () => showReceipt(b.dataset.lrc)));
  $$('[data-lev]').forEach((b) => (b.onclick = () => guard(b, async () => { const v = await api('/visits/' + b.dataset.lev); closeModal(); visitForm(v, () => { after && after(); }); })));
}

// Lượt đã xóa → khôi phục (lỡ tay xóa)
async function deletedVisits(from, to, after) {
  const show = async (all) => {
    const rows = await api('/visits-deleted' + (all ? '' : `?from=${from}&to=${to}`));
    openModal('🗑 Lượt đã xóa', `<div class="small muted" style="margin-bottom:8px">${all ? 'Tất cả lượt đã xóa (mới xóa lên trước).' : `Từ ${dmy(from)} đến ${dmy(to)}.`} Lỡ tay xóa thì bấm <b>Khôi phục</b>: lượt quay lại đủ dịch vụ, tiền, trừ thẻ; lần đồng bộ sổ sau không ghi đè.
      ${all ? '' : ' <a href="#" id="dvAll">Xem tất cả ngày</a>'}</div>
      <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Khách</th><th>Dịch vụ</th><th>Thợ</th><th class="num">Tiền</th><th>Lý do xóa</th><th></th></tr></thead><tbody>
      ${rows.map((v) => `<tr><td class="nowrap">${dmy(v.date).slice(0, 5)} ${esc(v.time || '')}</td><td>${esc(v.customer_name || '')}</td><td class="small">${esc(v.services || '')}</td><td>${esc(v.main_staff_name || '')}</td>
        <td class="num">${money(v.total)}</td><td class="small muted">${esc(v.delete_reason || '')}</td><td><button class="btn sm" data-rs="${v.id}">Khôi phục</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Không có lượt nào bị xóa</td></tr>'}
      </tbody></table></div>`);
    const a = $('#dvAll'); if (a) a.onclick = (e) => { e.preventDefault(); show(true); };
    $$('[data-rs]').forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/visits/${b.dataset.rs}/restore`, { method: 'POST' }); toast('Đã khôi phục lượt làm'); closeModal(); after && after(); })));
  };
  show(false);
}

// ---------- Nhắc nhở ----------
VIEWS.reminders = async (main) => {
  const r = await api('/reminders');
  // Lọc theo thợ phụ trách: nhân viên mặc định thấy khách của mình
  const sf0 = S.params.staff ?? (S.me.role === 'staff' ? 'mine' : '');
  const sf = sf0 === 'all' ? '' : sf0;
  const want = sf === 'mine' ? S.me.id : sf === 'none' ? null : sf ? Number(sf) : undefined;
  const owner = (x) => x.cust_staff_id !== undefined ? x.cust_staff_id : x.staff_id;
  const keep = (x, appt) => want === undefined || (want === null ? !owner(x) : owner(x) === want || (appt && x.staff_id === want));
  for (const k of ['cycles', 'birthdays', 'cards', 'returns']) r[k] = r[k].filter((x) => keep(x));
  for (const k of ['appointments', 'cancels']) r[k] = r[k].filter((x) => keep(x, true));
  for (const k of ['cycles', 'birthdays', 'cards', 'returns', 'appointments', 'cancels']) r.counts[k] = r[k].filter((x) => !x.done).length; // stock/expenses giữ số từ máy chủ
  const who = (x) => { const id = owner(x); return id ? ` <span class="badge">${esc(staffName(id))}</span>` : ''; };
  const sec = (key, title, help, rows, line) => `<div class="card"><h3>${title} <span class="badge ${r.counts[key] ? 'bad' : ''}">${r.counts[key]}</span></h3><div class="small muted">${help}</div>
    ${rows.length ? rows.map((x) => `<div class="list-item" style="${x.done ? 'opacity:.5' : ''}"><div style="flex:1;min-width:0">${line(x)}<div class="small">${telLinks(x.phone)}</div></div>
      ${x.done ? '<span class="badge ok">Đã liên hệ</span>' : `<button class="btn sm" data-done='${esc(JSON.stringify({ customer_id: x.customer_id || x.id, type: key === 'cycles' ? 'cycle' : key === 'birthdays' ? 'birthday' : key === 'cards' ? 'card' : key === 'returns' ? 'return' : 'appointment', ref: x.ref }))}'>Đã liên hệ</button>`}</div>`).join('') : '<div class="empty">Không có</div>'}</div>`;
  main.innerHTML = header('Nhắc nhở', 'Gọi / nhắn Zalo cho khách rồi bấm “Đã liên hệ”') +
    `<div class="card"><div class="row"><span class="muted small">Xem nhắc nhở của</span><select id="rsf" style="width:auto">
      <option value="all" ${!sf ? 'selected' : ''}>Tất cả khách</option><option value="mine" ${sf === 'mine' ? 'selected' : ''}>⭐ Khách của tôi</option>
      ${activeStaff().map((u) => `<option value="${u.id}" ${String(u.id) === sf ? 'selected' : ''}>Khách của ${esc(u.full_name)}</option>`).join('')}
      <option value="none" ${sf === 'none' ? 'selected' : ''}>Khách chưa giao thợ</option></select>
      <span class="small muted">Mỗi thợ tự gọi khách của mình, quản lý xem tổng.</span></div></div>
    <div class="grid two">
    ${sec('cycles', '📞 Khách định kỳ đến lịch – gọi hỏi giờ', 'Khách cài "làm định kỳ" (vd 2 tuần/lần) sắp đến hoặc đã đến hạn, chưa có lịch hẹn. Gọi hỏi giờ rồi đặt lịch.', r.cycles, (c) => `<b><a href="#customer?id=${c.id}">${esc(c.name)}</a></b>${who(c)} <span class="small muted">${c.cycle_days} ngày/lần · lần cuối ${dmy(c.last_date)} · đến hạn <b>${dmy(c.due)}</b></span>${c.cycle_call ? '<div class="small"><b>☎ Gọi trước hỏi giờ</b></div>' : ''}${c.cycle_note ? `<div class="small">${esc(c.cycle_note)}</div>` : ''}`)}
    ${sec('appointments', '📞 Xác nhận lịch ngày mai', 'Gọi trước để giảm khách không đến.', r.appointments, (a) => `<b>${esc(a.time)} · ${a.customer_id ? `<a href="#customer?id=${a.customer_id}">${esc(a.name)}</a>` : esc(a.name)}</b> <span class="muted small">${esc(a.service || '')} ${a.staff_name ? '· ' + esc(a.staff_name) : ''}</span>`)}
    <div class="card"><h3>❌ Khách hủy / không đến <span class="badge ${r.counts.cancels ? 'bad' : ''}">${r.counts.cancels}</span></h3><div class="small muted">14 ngày gần đây, khách chưa đặt lịch mới. Nhắn mời đặt lại rồi bấm “Đã mời”.</div>
      ${r.cancels.length ? r.cancels.map((a) => `<div class="list-item" style="${a.done ? 'opacity:.5' : ''}"><div style="flex:1;min-width:0">
        <b>${a.customer_id ? `<a href="#customer?id=${a.customer_id}">${esc(a.name)}</a>` : esc(a.name)}</b> <span class="badge ${APPT[a.status][1]}">${APPT[a.status][0]}</span>
        <div class="small muted">${esc(a.time)} ${dmy(a.date)}${a.staff_name ? ' · ' + esc(a.staff_name) : ''}${a.cancelled_by_name ? ' · ghi bởi ' + esc(a.cancelled_by_name) : ''}</div>
        <div class="small">Lý do: ${esc(a.cancel_reason || '—')}</div><div class="small">${telLinks(a.phone)}</div></div>
        <div class="row" style="flex-direction:column;align-items:flex-end"><button class="btn sm" data-inv="${a.id}">📋 Tin mời</button>
        ${a.done ? '<span class="badge ok">Đã mời</span>' : `<button class="btn sm" data-fu="${a.id}">Đã mời</button>`}</div></div>`).join('') : '<div class="empty">Không có</div>'}</div>
    ${sec('birthdays', '🎂 Sinh nhật sắp tới', 'Gửi lời chúc + ưu đãi sinh nhật.', r.birthdays, (c) => `<b><a href="#customer?id=${c.id}">${esc(c.name)}</a></b>${who(c)} <span class="badge warn">${c.date === S.today ? 'HÔM NAY' : dmy(c.date).slice(0, 5)}</span>`)}
    ${sec('cards', '💳 Thẻ trả trước', 'Thẻ sắp hết hạn → nhắc khách dùng; hết tiền → mời nạp thêm.', r.cards, (c) => `<b><a href="#customer?id=${c.id}">${esc(c.name)}</a></b>${who(c)} <span class="small">${esc(c.card_name)} · còn ${money(c.balance)}</span> <span class="badge warn">${esc(c.reason)}</span>`)}
    ${r.stock ? `<div class="card"><h3>📦 Hàng hết / sắp hết <span class="badge ${r.counts.stock ? 'bad' : ''}">${r.counts.stock}</span></h3><div class="small muted">Gọi NCC đặt thêm rồi bấm “Đã gọi hàng”. Hàng về nhập kho là tự hết nhắc.</div>
      ${r.stock.length ? r.stock.map((m) => `<div class="list-item" style="${m.ordered_at ? 'opacity:.55' : ''}"><div style="flex:1;min-width:0"><b>${esc(m.name)}</b> <span class="badge ${STK[m.status][1]}">${STK[m.status][0]}</span>
        <div class="small muted">Còn ${qtyFmt(m.stock)} ${esc(m.unit || '')}${m.min_qty != null ? ' · mức báo ' + qtyFmt(m.min_qty) : ''}${m.ordered_at ? ' · đã gọi ' + dmy(m.ordered_at.slice(0, 10)) + (m.ordered_by_name ? ' (' + esc(m.ordered_by_name) + ')' : '') : ''}</div></div>
        ${m.ordered_at ? '<span class="badge ok">Đã gọi</span>' : `<button class="btn sm" data-ord="${m.id}">📞 Đã gọi hàng</button>`}</div>`).join('') : '<div class="empty">Không có</div>'}
      <div style="margin-top:6px"><a href="#stock?tab=levels&st=need">Xem tồn kho →</a></div></div>` : ''}
    ${r.unpaid && r.unpaid.length ? `<div class="card"><h3>💰 Khách chưa thanh toán <span class="badge bad">${r.unpaid.length}</span></h3><div class="small muted">Từ ô màu hồng trong sổ đặt lịch Excel. Thu xong bấm hình thức đã thu.</div>
      ${r.unpaid.map((a) => `<div class="rem-pay"><div class="rem-pay-l"><span class="small muted nowrap">${dmy(a.date).slice(0, 5)} ${esc(a.time || '')}</span>
          <b>${a.customer_id ? `<a href="#customer?id=${a.customer_id}">${esc(a.name || '')}</a>` : esc(a.name || '')}</b>${a.amount ? ` <b class="nowrap">${money(a.amount)}</b>` : ''}${a.staff_name ? ` <span class="badge">${esc(a.staff_name)}</span>` : ''}
          ${a.phone ? `<span class="small">${telLinks(a.phone)}</span>` : ''}</div>
        <div class="rem-pay-b">${isOwner() ? S.settings.payment_methods.slice(0, 3).map((m) => `<button class="btn sm" data-paid="${a.id}" data-m="${esc(m)}">✓ ${esc(m)}</button>`).join('') : '<span class="small muted">Vinh ghi đã thu</span>'}</div></div>`).join('')}</div>` : ''}
    ${r.backup && r.backup.due ? `<div class="card">${backupBox(r.backup)}</div>` : ''}
    ${r.warranty && r.warranty.length ? `<div class="card"><h3>🛡 Bảo hành hóa chất còn hạn <span class="badge">${r.warranty.length}</span></h3><div class="small muted">Màu, uốn/duỗi/ép. Khách quay lại báo lỗi trong hạn: sửa miễn phí theo chính sách.</div>
      ${r.warranty.map((x) => `<div class="rem-pay"><div class="rem-pay-l"><b>${x.customer_id ? `<a href="#customer?id=${x.customer_id}">${esc(x.customer_name || '')}</a>` : ''}</b>
        <span class="small">${x.warranties.map((w) => esc(w.label.replace(/ \(.*\)/, ''))).join(', ')} · đến <b>${dmy(x.until).slice(0, 5)}</b></span>
        <span class="small muted">${dmy(x.date).slice(0, 5)}${x.staff_name ? ' · ' + esc(x.staff_name) : ''}</span></div></div>`).join('')}
      <div class="small muted" style="margin-top:6px">${esc(WARRANTY_EXCLUDE)}</div></div>` : ''}
    ${r.expenses && r.expenses.pending_count ? `<div class="card"><h3>💸 Khoản chi chờ duyệt <span class="badge bad">${r.expenses.pending_count}</span></h3><div class="small muted">Tổng ${money(r.expenses.pending_amount)} · quỹ còn ${money(r.expenses.balance)}</div><div style="margin-top:8px"><a class="btn sm primary" href="#expenses">Mở để duyệt →</a></div></div>` : ''}
    ${sec('returns', '🔁 Khách đến hạn quay lại', 'Đã quá số ngày cài đặt kể từ lần làm gần nhất và chưa có lịch hẹn.', r.returns, (c) => `<b><a href="#customer?id=${c.id}">${esc(c.name)}</a></b>${who(c)} <span class="small muted">lần cuối ${dmy(c.last_date)} · ${c.days} ngày · ${c.n} lượt</span>`)}
    </div>`;
  bindBackupBox(main, () => VIEWS.reminders(main));
  $$('[data-ord]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/stock/${b.dataset.ord}/ordered`, { method: 'POST', body: {} }); refreshReminderBadge(); VIEWS.reminders(main); })));
  $('#rsf').onchange = (e) => go('reminders', { staff: e.target.value });
  $$('[data-done]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api('/reminders/done', { method: 'POST', body: JSON.parse(b.dataset.done) }); refreshReminderBadge(); VIEWS.reminders(main); })));
  $$('[data-paid]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/appointments/${b.dataset.paid}/pay-note`, { method: 'POST', body: { pay_note: b.dataset.m } }); toast('Đã ghi thu: ' + b.dataset.m); VIEWS.reminders(main); refreshReminderBadge(); })));
  $$('[data-inv]', main).forEach((b) => (b.onclick = () => { const a = r.cancels.find((x) => x.id === Number(b.dataset.inv)); openModal('Mời đặt lại · ' + a.name, msgBox(msgRebook(a), a.phone)); bindMsgBox(); }));
  $$('[data-fu]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/appointments/${b.dataset.fu}/followup`, { method: 'POST', body: {} }); refreshReminderBadge(); VIEWS.reminders(main); })));
};

// ---------- Thẻ trả trước ----------
function cardTable(cards, showCustomer = true) {
  if (!cards.length) return '<div class="empty">Chưa có thẻ</div>';
  const ST = { active: ['Đang dùng', 'ok'], closed: ['Đã đóng', ''], refunded: ['Đã hoàn', 'bad'] };
  return `<div class="table-wrap"><table><thead><tr><th>Mã</th>${showCustomer ? '<th>Khách</th>' : ''}<th>Gói</th><th>Ngày bán</th><th>Hạn</th><th class="num">Giá bán</th><th class="num">Số dư</th><th>NV bán</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${cards.map((c) => `<tr><td>${esc(c.code)}</td>${showCustomer ? `<td><a href="#customer?id=${c.customer_id}">${esc(c.customer_name)}</a></td>` : ''}<td>${esc(c.name)}</td>
    <td>${dmy(c.sold_at)}</td><td>${dmy(c.expires_at)}${c.status === 'active' && c.expires_at < S.today ? ' <span class="badge bad">hết hạn</span>' : ''}</td><td class="num">${money(c.price)}</td>
    <td class="num"><b>${money(c.balance)}</b></td><td>${esc(c.seller_name || staffName(c.seller_id))}${c.consultant_id ? `<div class="small muted">+ ${esc(c.consultant_name || staffName(c.consultant_id))} (${c.seller_share}/${100 - c.seller_share})</div>` : ''}</td><td><span class="badge ${ST[c.status][1]}">${ST[c.status][0]}</span></td>
    <td><button class="btn sm" data-card="${c.id}">Chi tiết</button></td></tr>`).join('')}</tbody></table></div>`;
}
// Tin nhắn báo số dư thẻ cho khách (gửi Zalo/SMS sau khi bán thẻ hoặc khi khách hỏi)
function cardMsg(c, hist, sold) {
  const uses = (hist || []).filter((h) => h.visit_id && h.amount < 0);
  const last = uses[0];
  return [`${S.settings.salon_name} xin chào ${c.customer_name || ''}.`,
    sold ? `Salon xác nhận mình đã ${c.price ? 'mua' : 'được tặng'} thẻ ${c.code} (${c.name}).` : `Salon gửi mình thông tin thẻ ${c.code} (${c.name}):`,
    c.price ? `• Số tiền đã thanh toán: ${money(c.price)}` : '',
    `• Giá trị thẻ: ${money(c.value)}`,
    !sold ? `• Đã dùng: ${money(Math.max(0, c.value - c.balance))} (${uses.length} lần)` : '',
    last ? `• Lần gần nhất ${dmy((last.visit_date || last.created_at).slice(0, 10))}: trừ ${money(-last.amount)}` : '',
    `• SỐ DƯ CÒN LẠI: ${money(c.balance)}`,
    `• Hạn dùng: ${dmy(c.expires_at)}`,
    'Mỗi lần làm dịch vụ salon trừ dần vào thẻ, dịch vụ cao hơn số dư thì mình trả thêm phần chênh. Cảm ơn mình!'].filter(Boolean).join('\n');
}
function bindCardTable(root, cards, reload) {
  $$('[data-card]', root).forEach((b) => (b.onclick = async () => {
    const c = cards.find((x) => x.id === Number(b.dataset.card));
    const hist = await api(`/cards/${c.id}/history`);
    openModal(`Thẻ ${c.code} · ${c.name}`, `<div class="stat-line"><span class="muted">Giá bán / giá trị</span><b>${money(c.price)} / ${money(c.value)}</b></div>
      <div class="stat-line"><span class="muted">Số dư</span><b>${money(c.balance)}</b></div>
      <div class="stat-line"><span class="muted">Hạn dùng</span><b>${dmy(c.expires_at)}</b></div>
      <div class="stat-line"><span class="muted">Người chốt bán</span><b>${esc(c.seller_name || staffName(c.seller_id))}${c.consultant_id ? ` (${c.seller_share}%)` : ''}${c.commission != null ? ' · HH ' + money(c.commission) : ''}</b></div>
      ${c.consultant_id ? `<div class="stat-line"><span class="muted">Người tư vấn</span><b>${esc(c.consultant_name || staffName(c.consultant_id))} (${100 - c.seller_share}%)${c.consultant_commission != null ? ' · HH ' + money(c.consultant_commission) : ''}</b></div>` : ''}
      ${msgBox(cardMsg(c, hist), c.phone)}
      <h3 style="margin-top:14px">Lịch sử dùng thẻ</h3>${hist.length ? `<table><tbody>${hist.map((h) => `<tr><td>${esc(h.created_at.slice(0, 10).split('-').reverse().join('/'))}</td><td>${esc(h.visit_code || h.note || '')}</td><td class="num">${money(h.amount)}</td><td class="small muted">${esc(h.by_name || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa dùng</div>'}
      ${isMgr() ? `<form id="cardEdit"><h3 style="margin-top:14px">Quản lý thẻ</h3><div class="form-grid">
        <div><label>Gia hạn đến</label><input type="date" name="expires_at" value="${c.expires_at || ''}"></div>
        <div><label>Trạng thái</label><select name="status"><option value="active" ${c.status === 'active' ? 'selected' : ''}>Đang dùng</option><option value="closed" ${c.status === 'closed' ? 'selected' : ''}>Đóng thẻ</option><option value="refunded" ${c.status === 'refunded' ? 'selected' : ''}>Hoàn tiền (thu hồi HH)</option></select></div>
        <div><label>Điều chỉnh số dư (+/−)</label><input type="number" name="amount" step="1000"></div><div><label>Lý do điều chỉnh</label><input name="note"></div>
        ${sellerFields(c)}</div>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>` : ''}
      ${isOwner() ? `<form id="cardSale"><h3 style="margin-top:14px">✏️ Sửa số tiền thẻ (chỉ Lãnh đạo)</h3>
        <div class="small muted">Dùng khi ghi nhầm (vd nạp 2tr mà ghi 20tr). Số dư = giá trị mới − phần đã dùng (${money(Math.max(0, c.value - c.balance))}); hoa hồng bán thẻ tính lại.</div><div class="form-grid">
        <div><label>Giá bán (khách trả)</label><input type="number" name="price" min="0" step="1000" value="${c.price}"></div>
        <div><label>Giá trị dùng</label><input type="number" name="value" min="1000" step="1000" value="${c.value}"></div>
        <div><label>Loại</label><select name="sale_type">${[['new', 'Khách mua mới'], ['renewal', 'Mua lại / nạp thêm'], ['gift', 'Tặng']].map(([k, l]) => `<option value="${k}" ${c.sale_type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>Hình thức thanh toán</label><select name="payment_method">${S.settings.payment_methods.map((m) => `<option ${c.payment_method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
        <div><label>Ngày bán</label><input type="date" name="sold_at" value="${c.sold_at || ''}"></div>
        <div><label>Lý do sửa *</label><input name="reason" placeholder="vd: ghi nhầm 20tr, đúng 2tr"></div></div>
        <div class="small" id="cardSaleHint"></div>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu số tiền thẻ</button></div></form>` : ''}`);
    bindMsgBox();
    const fs2 = $('#cardSale');
    if (fs2) {
      const used = Math.max(0, c.value - c.balance);
      const hint = () => { const v = Number(fs2.value.value || 0); $('#cardSaleHint').innerHTML = v ? `Số dư sau khi sửa: <b>${money(v - used)}</b>` : ''; };
      fs2.value.oninput = hint; hint();
      fs2.onsubmit = (e) => {
        e.preventDefault();
        guard($('#cardSale button'), async () => {
          await api(`/cards/${c.id}/sale`, { method: 'PUT', body: formData(fs2) });
          closeModal(); toast('Đã sửa số tiền thẻ'); reload();
        });
      };
    }
    const f = $('#cardEdit');
    if (f) bindSellerFields(f, c);
    if (f) f.onsubmit = (e) => {
      e.preventDefault();
      guard($('#cardEdit button'), async () => {
        const d = formData(f);
        await api('/cards/' + c.id, { method: 'PUT', body: { expires_at: d.expires_at, status: d.status, seller_id: d.seller_id, consultant_id: d.consultant_id, seller_share: d.seller_share } });
        if (d.amount) await api(`/cards/${c.id}/adjust`, { method: 'POST', body: { amount: Number(d.amount), note: d.note } });
        closeModal(); toast('Đã cập nhật thẻ'); reload();
      });
    };
  }));
}
// Người chốt bán + người tư vấn + cách chia hoa hồng (gợi ý 50/50 khi cùng làm, 70/30 khi 1 người chỉ giới thiệu)
const SPLITS = [[50, '50/50'], [70, '70/30'], [60, '60/40'], [30, '30/70']];
function sellerFields(c = {}) {
  const share = c.consultant_id ? c.seller_share : 50;
  return `<div><label>Nhân viên chốt bán</label><select name="seller_id" ${!isMgr() ? 'disabled' : ''}>${staffOptions(c.seller_id || S.me.id, '')}</select></div>
    <div><label>Người tư vấn / giới thiệu (nếu có)</label><select name="consultant_id">${staffOptions(c.consultant_id || null, '— Không có —')}</select></div>
    <div class="full sp-wrap" ${c.consultant_id ? '' : 'hidden'}><label>Người chốt được bao nhiêu % hoa hồng (gõ số bất kỳ, phần còn lại cho người tư vấn)</label>
      <div class="row"><input type="number" name="seller_share" min="0" max="100" step="5" value="${share}" style="width:90px"> %
        ${SPLITS.map(([v, t]) => `<button type="button" class="btn sm" data-sp="${v}">${t}</button>`).join('')}</div>
      <div class="small muted sp-txt"></div></div>
    <div class="full small muted sp-hint"></div>`;
}
function bindSellerFields(f, c = {}) {
  const sel = f.querySelector('[name=consultant_id]'), wrap = f.querySelector('.sp-wrap'), sh = f.querySelector('[name=seller_share]'), txt = f.querySelector('.sp-txt');
  const show = () => {
    const seller = Number(f.querySelector('[name=seller_id]').value || S.me.id), k = Number(sel.value);
    wrap.hidden = !k;
    if (k && k === seller) txt.textContent = 'Người tư vấn trùng người chốt → không chia.';
    else if (k) {
      const typeSel = f.querySelector('[name=card_type_id]'), st = f.querySelector('[name=sale_type]');
      const t = typeSel && S.cardTypes.find((x) => x.id === Number(typeSel.value));
      const pr = f.querySelector('[name=price]');
      const price = c.price != null ? c.price : pr && pr.value !== '' ? Number(pr.value) : t ? t.price : 0;
      const type = c.sale_type || (st ? st.value : 'new');
      const rate = type === 'new' ? Number(S.settings.card_new_rate || 0) : type === 'renewal' ? Number(S.settings.card_renewal_rate || 0) : 0;
      const tot = Math.round(price * rate), a = Math.round((tot * Number(sh.value)) / 100);
      txt.innerHTML = tot ? `Tổng HH ${money(tot)} → người chốt <b>${money(a)}</b>, người tư vấn <b>${money(tot - a)}</b>` : 'Thẻ này không có hoa hồng.';
    }
  };
  f.querySelectorAll('select,input').forEach((x) => { x.addEventListener('change', show); if (x === sh) x.addEventListener('input', show); });
  f.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => { sh.value = b.dataset.sp; show(); }));
  f._spShow = show;
  show();
}
// Khách đã từng mua thẻ → tự chọn "Mua lại / nạp thêm"; thợ phụ trách khách (nếu khác người bán) gợi ý làm người tư vấn 50/50
async function suggestRenewal(f, cid) {
  const hint = f.querySelector('.sp-hint');
  if (!cid) { hint.textContent = ''; return; }
  const [cards, cu] = await Promise.all([api('/cards?customer_id=' + cid), api('/customers/' + cid)]);
  const old = cards.filter((x) => x.sale_type !== 'gift' && x.status !== 'refunded');
  const parts = [];
  if (old.length) {
    f.querySelector('[name=sale_type]').value = 'renewal';
    parts.push(`Khách đã mua ${old.length} thẻ (gần nhất ${esc(old[0].code)} · ${dmy(old[0].sold_at)}) → đã chọn <b>Mua lại / nạp thêm</b>.`);
  }
  const c = cu.customer || cu;
  const seller = Number(f.querySelector('[name=seller_id]').value || S.me.id);
  const k = f.querySelector('[name=consultant_id]');
  if (old.length && c.staff_id && c.staff_id !== seller && !k.value) {
    k.value = c.staff_id; f.querySelector('[name=seller_share]').value = 0;
    parts.push(`Thợ phụ trách khách là <b>${esc(c.staff_name || staffName(c.staff_id))}</b> → theo quy định, <b>hoa hồng mua lại tính 100% cho thợ phụ trách</b> (sửa được nếu có người khác cùng tư vấn).`);
  } else if (old.length && c.staff_id === seller) parts.push('Người bán là thợ phụ trách khách → nhận đủ hoa hồng.');
  if (c.staff_id && c.staff_id !== seller && !old.length) parts.push(`<button type="button" class="btn sm" id="selfTop">🙋 Tính 100% cho thợ phụ trách ${esc(c.staff_name || staffName(c.staff_id))}</button>`);
  hint.innerHTML = parts.join('<br>');
  const st = hint.querySelector('#selfTop');
  if (st) st.onclick = () => { k.value = c.staff_id; f.querySelector('[name=seller_share]').value = 0; f._spShow && f._spShow(); };
  f._spShow && f._spShow();
}
function cardForm(customer, after) {
  openModal('Bán thẻ trả trước', `<form id="sf"><div class="form-grid">
    <div class="full"><label>Khách hàng *</label>${customerPicker('customer_id', customer && customer.id ? customer : null)}</div>
    <div class="full"><label>Gói thẻ</label><select name="card_type_id">${S.cardTypes.filter((t) => t.active).map((t) => `<option value="${t.id}">${esc(t.name)} · ${t.price ? `bán ${money(t.price)} → dùng ${money(t.value)}` : `TẶNG ${money(t.value)}`} · ${t.fixed_expiry ? 'hạn đến ' + dmy(t.fixed_expiry) : t.months + ' tháng'}</option>`).join('')}<option value="">Thẻ tùy chỉnh…</option></select></div>
    <div><label>Giá bán (trống = theo gói)</label><input type="number" name="price" min="0" step="1000"></div>
    <div><label>Giá trị dùng (trống = theo gói)</label><input type="number" name="value" min="0" step="1000"></div>
    <div><label>Loại</label><select name="sale_type"><option value="new">Khách mua mới</option><option value="renewal">Mua lại / nạp thêm</option><option value="gift">Tặng (không HH)</option></select></div>
    ${sellerFields()}
    <div><label>Hình thức thanh toán</label><select name="payment_method">${S.settings.payment_methods.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
    <div><label>Ngày bán</label><input type="date" name="sold_at" value="${S.today}"></div>
    <div class="full"><label>Ghi chú</label><input name="note"></div></div>
    <div class="small muted">Tiền bán thẻ tính vào <b>tiền vào</b>, không tính vào doanh số dịch vụ (doanh số tính khi khách dùng thẻ) — tránh cộng 2 lần.</div>
    <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Bán thẻ</button></div></form>`);
  bindPicker($('#sf'), (cid) => suggestRenewal($('#sf'), cid));
  bindSellerFields($('#sf'));
  if (customer && customer.id) suggestRenewal($('#sf'), customer.id);
  $('#sf').onsubmit = (e) => {
    e.preventDefault();
    guard($('#sf button.primary'), async () => {
      const d = formData($('#sf'));
      if (!d.customer_id) throw new Error('Chọn khách hàng');
      const c = await api('/cards', { method: 'POST', body: d });
      closeModal(); toast(`Đã bán thẻ ${c.code}`); after && after();
      const full = (await api('/cards?customer_id=' + c.customer_id)).find((x) => x.id === c.id) || c;
      openModal(`Đã bán thẻ ${c.code}`, `<div class="stat-line"><span class="muted">Khách</span><b>${esc(full.customer_name || '')}</b></div>
        <div class="stat-line"><span class="muted">Thu tiền</span><b>${money(full.price)}</b></div><div class="stat-line"><span class="muted">Số dư dùng dần</span><b>${money(full.balance)}</b></div>
        ${msgBox(cardMsg(full, [], true), full.phone)}`);
      bindMsgBox();
    });
  };
}
VIEWS.cards = async (main) => {
  const status = S.params.status ?? 'active';
  const cards = await api('/cards' + (status ? '?status=' + status : ''));
  const act = cards.filter((c) => c.status === 'active');
  const total = act.filter((c) => c.sale_type !== 'gift').reduce((s, c) => s + c.balance, 0);
  const gifts = act.filter((c) => c.sale_type === 'gift');
  main.innerHTML = header('Thẻ trả trước', isMgr() ? `Số dư thẻ khách đã trả tiền: <b>${money(total)}</b> (tiệm còn nợ dịch vụ khách)<br>Thẻ tri ân 1Tr chưa dùng: <b>${gifts.length} thẻ</b> = ${money(gifts.reduce((s, c) => s + c.balance, 0))} (chỉ dùng 1 lần, không có tiền vào)` : '', `<button class="btn primary" id="sell">+ Bán thẻ</button>`) +
    `<div class="card"><div class="row"><select id="stf" style="width:auto"><option value="active" ${status === 'active' ? 'selected' : ''}>Đang dùng</option><option value="" ${status === '' ? 'selected' : ''}>Tất cả</option><option value="closed" ${status === 'closed' ? 'selected' : ''}>Đã đóng</option><option value="refunded" ${status === 'refunded' ? 'selected' : ''}>Đã hoàn</option></select></div></div>
    <div class="card">${cardTable(cards)}</div>`;
  $('#stf').onchange = (e) => go('cards', { status: e.target.value });
  $('#sell').onclick = () => cardForm(null, () => VIEWS.cards(main));
  bindCardTable(main, cards, () => VIEWS.cards(main));
};

// ---------- Kho & giá cốt (chỉ Lãnh đạo / Quản lý) ----------
// Tồn kho cho người kiểm / gọi hàng (không có giá nhập)
const STK = { out: ['Hết hàng', 'bad'], low: ['Sắp hết', 'warn'], ok: ['Đủ', 'ok'] };
const qtyFmt = (q) => (Math.round(q * 100) / 100).toLocaleString('vi-VN');
const normCode = (c) => String(c || '').replace(/[^0-9A-Za-z\-._]/g, '').toUpperCase();
const hasCode = (m, code) => !!m.barcode && m.barcode.split(/[,;\s]+/).map(normCode).includes(normCode(code));
// Quét 1 mã ở trang Kho: tìm thấy → kiểm đếm / nhập thêm; chưa gắn → chọn sản phẩm để gắn mã
function stockScan(rows, reload) {
  scanBarcode({ title: 'Quét mã sản phẩm', onCode: (code) => {
    const m = rows.find((x) => hasCode(x, code));
    if (m) return stockScanItem(m, rows, reload);
    openModal('Mã chưa gắn sản phẩm', `<form id="bcf"><div>Mã <b>${esc(code)}</b> chưa gắn với sản phẩm nào. Chọn đúng sản phẩm để gắn (lần sau quét là ra luôn):</div>
      <input id="bcq" type="search" placeholder="🔍 Gõ tên để lọc…" style="margin:8px 0">
      <select name="mid" size="8" required style="height:auto">${rows.map((x) => `<option value="${x.id}">${esc(x.name)}${x.barcode ? ' 🏷' : ''}</option>`).join('')}</select>
      <div class="small muted" style="margin-top:6px">Không có trong danh sách? ${isMgr() ? 'Thêm sản phẩm mới ở Kho › Hóa chất & sản phẩm (ô Mã vạch).' : 'Báo quản lý thêm sản phẩm mới.'}</div>
      <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Gắn mã</button></div></form>`);
    const sel = $('#bcf [name=mid]');
    $('#bcq').oninput = (e) => { const q = e.target.value.toLowerCase(); [...sel.options].forEach((o) => (o.hidden = !o.textContent.toLowerCase().includes(q))); };
    $('#bcf').onsubmit = (e) => { e.preventDefault(); guard($('#bcf button.primary'), async () => {
      const id = Number(sel.value); if (!id) throw new Error('Chọn sản phẩm');
      await api(`/stock/${id}/barcode`, { method: 'POST', body: { code } });
      const m2 = rows.find((x) => x.id === id); m2.barcode = [m2.barcode, code].filter(Boolean).join(',');
      const sm = matById(id); if (sm) sm.barcode = m2.barcode;
      toast('Đã gắn mã'); stockScanItem(m2, rows, reload);
    }); };
  } });
}
function stockScanItem(m, rows, reload) {
  const canCount = S.me.stock_count || isMgr();
  openModal(m.name, `<div class="stat-line"><span class="muted">Tồn trên máy</span><b>${qtyFmt(m.stock)} ${esc(m.unit || '')}</b></div>
    <div class="stat-line"><span class="muted">Trạng thái</span><span class="badge ${STK[m.status][1]}">${STK[m.status][0]}</span></div>
    ${m.kind === 'retail' && m.sell_price ? `<div class="stat-line"><span class="muted">Giá bán</span><b>${money(m.sell_price)}</b></div>` : ''}
    ${canCount ? `<form id="scc" style="margin-top:10px"><label>🧮 Kiểm kho: số đếm thực tế (${esc(m.unit || 'đơn vị')})</label><div class="row"><input type="number" name="counted" step="0.01" min="0" inputmode="decimal" style="flex:1"><button class="btn sm primary">Lưu số đếm</button></div></form>
    <form id="sci" style="margin-top:10px"><label>📦 Nhập thêm hàng mới về</label><div class="row"><input type="number" name="qty" step="any" min="0" placeholder="Số lượng" inputmode="decimal" style="flex:1">
      ${isMgr() ? '<input type="number" name="unit_cost" min="0" step="1000" placeholder="Giá nhập/đv" style="flex:1">' : ''}<button class="btn sm primary">Nhập kho</button></div>
      <input name="supplier" placeholder="Nhà cung cấp / ghi chú" style="margin-top:6px">${isMgr() ? '' : '<div class="small muted">Giá nhập quản lý sẽ cập nhật sau.</div>'}</form>` : '<div class="small muted" style="margin-top:8px">Bạn chỉ có quyền xem tồn. Kiểm kho / nhập hàng do người được giao.</div>'}
    <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Đóng</button><button type="button" class="btn" id="scNext">📷 Quét tiếp</button></div>`);
  $('#scNext').onclick = () => { closeModal(); stockScan(rows, reload); };
  const fc = $('#scc');
  if (fc) fc.onsubmit = (e) => { e.preventDefault(); guard($('#scc button'), async () => {
    const v = fc.counted.value; if (v === '') throw new Error('Nhập số đếm');
    const r = await api('/stock/count', { method: 'POST', body: { lines: [{ material_id: m.id, counted: Number(v) }], note: 'quét mã' } });
    closeModal(); toast(r.diffs.length ? `Đã lưu: lệch ${r.diffs[0].diff > 0 ? '+' : ''}${qtyFmt(r.diffs[0].diff)}` : 'Khớp với máy'); refreshReminderBadge(); reload();
  }); };
  const fi = $('#sci');
  if (fi) fi.onsubmit = (e) => { e.preventDefault(); guard($('#sci button'), async () => {
    const r = await api(`/stock/${m.id}/receive`, { method: 'POST', body: formData(fi) });
    closeModal(); toast(`Đã nhập. Tồn mới: ${qtyFmt(r.stock)}`); refreshReminderBadge(); reload();
  }); };
}
async function stockLevelsView(main, reload) {
  const rows = await api('/stock/levels');
  const kind = S.params.kind || 'all', st = S.params.st || '';
  const list = rows.filter((m) => (kind === 'all' || m.kind === kind) && (!st || (st === 'need' ? m.status !== 'ok' : m.status === st)));
  const need = rows.filter((m) => m.status !== 'ok');
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="grid kpis"><div class="kpi"><div class="l">Hết hàng</div><div class="v">${rows.filter((m) => m.status === 'out').length}</div><div class="s">mặt hàng</div></div>
      <div class="kpi"><div class="l">Sắp hết</div><div class="v">${rows.filter((m) => m.status === 'low').length}</div><div class="s">dưới mức báo</div></div>
      <div class="kpi"><div class="l">Cần gọi thêm</div><div class="v">${need.filter((m) => !m.ordered_at).length}</div><div class="s">chưa báo NCC</div></div></div>
    <div class="card"><div class="row">
      ${[['all', 'Tất cả'], ['service', 'Hóa chất'], ['retail', 'Sản phẩm bán']].map(([k, l]) => `<button class="btn sm ${k === kind ? 'primary' : ''}" data-sk="${k}">${l}</button>`).join('')}
      <select id="stf" style="width:auto"><option value="">Mọi trạng thái</option><option value="need" ${st === 'need' ? 'selected' : ''}>Hết + sắp hết</option><option value="out" ${st === 'out' ? 'selected' : ''}>Hết hàng</option><option value="low" ${st === 'low' ? 'selected' : ''}>Sắp hết</option></select>
      <span class="spacer"></span><button class="btn primary sm" id="scanS">📷 Quét mã vạch</button>${S.me.stock_count || isMgr() ? '<button class="btn primary sm" id="cnt">🧮 Kiểm kho / đếm hàng</button>' : ''}${isMgr() ? '<button class="btn sm" id="sperm">Phân quyền kho</button>' : ''}</div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Tên</th><th>Nhóm</th><th>ĐVT</th><th class="num">Tồn</th><th class="num">Mức báo hết</th><th>Trạng thái</th><th>Kiểm gần nhất</th><th></th></tr></thead>
      <tbody>${list.map((m) => `<tr><td><b>${esc(m.name)}</b>${m.size ? ` <span class="small muted">${m.size}${m.size_unit}</span>` : ''}${m.barcode ? ' <span class="small muted" title="Đã gắn mã vạch">🏷</span>' : ''}</td><td class="small">${esc(m.grp || '')}</td><td>${esc(m.unit || '')}</td>
        <td class="num"><b>${qtyFmt(m.stock)}</b>${m.left_amt != null && m.kind === 'service' ? `<div class="small muted">≈ ${m.left_amt.toLocaleString('vi-VN')}${esc(m.size_unit || '')}</div>` : ''}${m.days_left != null ? `<div class="small ${m.days_left < 7 ? '' : 'muted'}" style="${m.days_left < 7 ? 'color:var(--warn)' : ''}" title="Dùng 30 ngày qua: ${qtyFmt(m.use30)} ${esc(m.unit || '')}${m.use30_amt ? ' ≈ ' + m.use30_amt.toLocaleString('vi-VN') + esc(m.size_unit || '') : ''}">đủ ~${m.days_left} ngày</div>` : ''}</td><td class="num">${m.min_qty != null ? qtyFmt(m.min_qty) : '<span class="muted small">—</span>'} <button class="btn sm" data-min="${m.id}">Sửa</button></td>
        <td><span class="badge ${STK[m.status][1]}">${STK[m.status][0]}</span>${m.ordered_at ? ` <span class="badge">Đã gọi ${dmy(m.ordered_at.slice(0, 10))}${m.ordered_by_name ? ' · ' + esc(m.ordered_by_name) : ''}</span>` : ''}</td>
        <td class="small">${m.last_count ? dmy(m.last_count) + (m.last_count_by ? ' · ' + esc(m.last_count_by) : '') : '<span class="muted">chưa kiểm</span>'}</td>
        <td>${m.status !== 'ok' ? (m.ordered_at ? `<button class="btn sm" data-unord="${m.id}">Bỏ đánh dấu</button>` : `<button class="btn sm" data-ord="${m.id}">📞 Đã gọi hàng</button>`) : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Không có</td></tr>'}</tbody></table></div>
      <div class="small muted" style="margin-top:8px">Tồn = nhập − dùng cho dịch vụ (tự trừ theo công thức thợ ghi) − bán − điều chỉnh kiểm kho. “Đủ ~N ngày” tính theo lượng dùng 30 ngày qua; còn dưới 7 ngày app tự báo sắp hết. Đặt “Mức báo hết” nếu muốn mức riêng. Khi hàng mới về (nhập kho), dấu “Đã gọi” tự xóa.</div></div>`;
  main.appendChild(wrap);
  const setP = (o) => go('stock', { ...S.params, ...o });
  $('#scanS').onclick = () => stockScan(rows, reload);
  $$('[data-sk]', wrap).forEach((b) => (b.onclick = () => setP({ kind: b.dataset.sk })));
  $('#stf').onchange = (e) => setP({ st: e.target.value });
  $$('[data-min]', wrap).forEach((b) => (b.onclick = () => {
    const m = rows.find((x) => x.id === Number(b.dataset.min));
    const v = prompt(`Mức báo sắp hết cho "${m.name}" (số ${m.unit || 'đơn vị'}; để trống = chỉ báo khi hết hẳn)`, m.min_qty ?? '');
    if (v === null) return;
    guard(b, async () => { await api(`/stock/${m.id}/min`, { method: 'PUT', body: { min_qty: v.trim() === '' ? '' : Number(v.replace(',', '.')) } }); reload(); });
  }));
  $$('[data-ord]', wrap).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/stock/${b.dataset.ord}/ordered`, { method: 'POST', body: {} }); toast('Đã đánh dấu gọi hàng'); refreshReminderBadge(); reload(); })));
  $$('[data-unord]', wrap).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/stock/${b.dataset.unord}/ordered`, { method: 'POST', body: { ordered: false } }); refreshReminderBadge(); reload(); })));
  const cnt = $('#cnt');
  if (cnt) cnt.onclick = () => {
    const items = rows.filter((m) => kind === 'all' || m.kind === kind);
    openModal('Kiểm kho / đếm hàng', `<form id="cf2"><div class="small muted">Đếm thực tế rồi điền số vào ô. Ô để trống = không kiểm món đó. Lệch so với máy sẽ tự ghi điều chỉnh.</div>
      <div class="row" style="margin:8px 0;gap:6px"><input id="cq" type="search" placeholder="🔍 Lọc tên…" style="flex:1"><button type="button" class="btn sm primary" id="cScan">📷 Quét để đếm</button></div>
      <div style="max-height:52vh;overflow:auto">${items.map((m) => `<div class="row cnt-row" data-n="${esc(m.name.toLowerCase())}" style="padding:4px 0;border-bottom:1px solid var(--line)"><div style="flex:1;min-width:0" class="small"><b>${esc(m.name)}</b> <span class="muted">· máy: ${qtyFmt(m.stock)} ${esc(m.unit || '')}</span></div>
        <input type="number" step="0.01" min="0" inputmode="decimal" data-cm="${m.id}" style="width:90px"></div>`).join('')}</div>
      <label style="margin-top:8px">Ghi chú</label><input name="note" placeholder="VD: kiểm cuối tháng 11">
      <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu kết quả kiểm</button></div></form>`);
    $('#cq').oninput = (e) => { const q = e.target.value.toLowerCase(); $$('.cnt-row').forEach((r) => (r.style.display = r.dataset.n.includes(q) ? '' : 'none')); };
    // Quét liên tục: mỗi lần quét 1 sản phẩm = +1 vào ô đếm của món đó
    $('#cScan').onclick = () => scanBarcode({ title: 'Quét để đếm (mỗi lần quét +1)', continuous: true, hint: 'Quét lần lượt từng chai/hộp. Mỗi lần quét cộng 1.', onCode: (code) => {
      const m = items.find((x) => hasCode(x, code));
      if (!m) return `⚠ Mã <b>${esc(code)}</b> chưa gắn sản phẩm. Gắn ở nút “📷 Quét mã vạch” ngoài trang Kho.`;
      const inp = $(`[data-cm="${m.id}"]`); if (!inp) return 'Món này không nằm trong danh sách đang kiểm';
      inp.value = Math.round(((Number(inp.value) || 0) + 1) * 100) / 100;
      $$('.cnt-row.hit').forEach((r) => r.classList.remove('hit'));
      const row = inp.closest('.cnt-row'); row.style.display = ''; row.classList.add('hit'); row.scrollIntoView({ block: 'nearest' });
      return `✓ <b>${esc(m.name)}</b>: đếm được <b>${inp.value}</b> (máy ${qtyFmt(m.stock)})`;
    } });
    $('#cf2').onsubmit = (e) => {
      e.preventDefault();
      guard($('#cf2 button.primary'), async () => {
        const lines = $$('[data-cm]').filter((i) => i.value !== '').map((i) => ({ material_id: Number(i.dataset.cm), counted: Number(i.value) }));
        if (!lines.length) throw new Error('Chưa nhập số đếm nào');
        const r = await api('/stock/count', { method: 'POST', body: { lines, note: $('#cf2 [name=note]').value } });
        closeModal();
        if (r.diffs.length) openModal('Kết quả kiểm kho', `<div>Đã kiểm <b>${r.counted}</b> món, <b>${r.diffs.length}</b> món lệch:</div><table style="margin-top:8px"><thead><tr><th>Món</th><th class="num">Máy</th><th class="num">Đếm</th><th class="num">Lệch</th></tr></thead>
          <tbody>${r.diffs.map((d) => `<tr><td>${esc(d.name)}</td><td class="num">${qtyFmt(d.before)}</td><td class="num">${qtyFmt(d.counted)}</td><td class="num"><b>${d.diff > 0 ? '+' : ''}${qtyFmt(d.diff)}</b></td></tr>`).join('')}</tbody></table>
          <div class="small muted" style="margin-top:8px">Lệch nhiều thường do quên ghi hóa chất ở phiếu thu hoặc định mức chưa đúng.</div>`);
        else toast(`Đã kiểm ${r.counted} món, khớp hết`);
        refreshReminderBadge(); reload();
      });
    };
  };
  const sp = $('#sperm');
  if (sp) sp.onclick = async () => {
    const p = await api('/stock/perm');
    const staffOnly = activeStaff().filter((u) => u.role === 'staff');
    openModal('Phân quyền kho cho nhân viên', `<form id="spf"><div class="small muted">Lãnh đạo / Quản lý luôn có đủ quyền. Nhân viên KHÔNG thấy giá nhập, giá cốt.</div>
      <table style="margin-top:8px"><thead><tr><th>Nhân viên</th><th>Xem tồn + báo hết hàng</th><th>Kiểm kho, đếm hàng</th></tr></thead><tbody>
      ${staffOnly.map((u) => `<tr><td>${esc(u.full_name)}</td><td><input type="checkbox" data-pv="${u.id}" ${p.viewers.includes(u.id) ? 'checked' : ''} style="width:auto"></td><td><input type="checkbox" data-pc="${u.id}" ${p.counters.includes(u.id) ? 'checked' : ''} style="width:auto"></td></tr>`).join('')}</tbody></table>
      <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>`);
    $('#spf').onsubmit = (e) => { e.preventDefault(); guard($('#spf button'), async () => {
      await api('/stock/perm', { method: 'PUT', body: { viewers: $$('[data-pv]:checked').map((x) => Number(x.dataset.pv)), counters: $$('[data-pc]:checked').map((x) => Number(x.dataset.pc)) } });
      closeModal(); toast('Đã lưu quyền kho. Nhân viên đăng nhập lại để thấy thay đổi.'); }); };
  };
}
const perUnit = (m) => (m.size ? `${money(Math.round(m.avg_cost / m.size))}/${m.size_unit}` : '');
VIEWS.stock = async (main) => {
  if (!isMgr()) {
    if (!S.me.stock_view) { main.innerHTML = '<div class="empty">Bạn chưa được giao quyền xem kho</div>'; return; }
    main.innerHTML = header('Kho hàng', S.me.stock_count ? 'Xem tồn, kiểm kho đếm hàng, báo hàng cần gọi thêm' : 'Xem tồn kho, báo hàng hết cần gọi thêm');
    return stockLevelsView(main, () => VIEWS.stock(main));
  }
  const tab = S.params.tab || 'report';
  const reload = () => VIEWS.stock(main);
  const tabs = [['report', 'Giá cốt & lãi gộp'], ['levels', 'Tồn kho & kiểm kho'], ['items', 'Hóa chất & sản phẩm'], ['recipes', 'Định mức dịch vụ']];
  const top = header('Kho & giá cốt', 'Chỉ Lãnh đạo / Quản lý thấy giá nhập, giá cốt, lãi gộp') +
    `<div class="card"><div class="row">${tabs.map(([k, l]) => `<button class="btn sm ${k === tab ? 'primary' : ''}" data-tab="${k}">${l}</button>`).join('')}
    <span class="spacer"></span><button class="btn sm" data-goto="excel">📥 Tải file sổ nhập hàng</button></div></div>`;
  const bindTop = () => { $$('[data-tab]', main).forEach((b) => (b.onclick = () => go('stock', { tab: b.dataset.tab }))); $$('[data-goto]', main).forEach((b) => (b.onclick = () => go(b.dataset.goto))); };
  if (tab === 'levels') { main.innerHTML = top; bindTop(); return stockLevelsView(main, reload); }
  S.materials = await api('/materials?all=1');

  if (tab === 'report') {
    const from = S.params.from || S.today.slice(0, 8) + '01', to = S.params.to || S.today;
    const r = await api(`/reports/cost?from=${from}&to=${to}`);
    const s = r.summary;
    const pc = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');
    main.innerHTML = top + `<div class="card"><div class="row"><input type="date" id="f" value="${from}" style="width:auto"> → <input type="date" id="t" value="${to}" style="width:auto"><button class="btn sm" id="go">Xem</button></div></div>
      <div class="grid kpis">
        <div class="kpi"><div class="l">Doanh số hóa chất</div><div class="v">${money(s.chem_revenue)}</div><div class="s">${s.chem_visits} lượt</div></div>
        <div class="kpi"><div class="l">Giá cốt hóa chất đã dùng</div><div class="v">${money(s.use_cost)}</div><div class="s">= ${pc(s.use_cost, s.chem_revenue)} doanh số hóa chất</div></div>
        <div class="kpi"><div class="l">Bán sản phẩm</div><div class="v">${money(s.product_revenue)}</div><div class="s">giá vốn ${money(s.product_cost)} · lãi ${money(s.product_revenue - s.product_cost)}</div></div>
        <div class="kpi"><div class="l">Tồn kho (giá vốn)</div><div class="v">${money(s.stock_value_service + s.stock_value_retail)}</div><div class="s">hóa chất ${money(s.stock_value_service)} · SP ${money(s.stock_value_retail)}</div></div></div>
      ${s.chem_visits_no_record ? `<div class="card" style="border-color:var(--warn)">⚠ <b>${s.chem_visits_no_record}/${s.chem_visits}</b> lượt hóa chất <b>chưa ghi lượng hóa chất</b> → giá cốt đang thấp hơn thực tế. Nhắc thợ ghi ở phiếu thu (có nút "Lấy theo định mức").</div>` : ''}
      <div class="card"><h3>Từng lượt có hóa chất / bán sản phẩm</h3>${r.visits.length ? `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Lượt</th><th>Khách</th><th>Thợ</th><th>Dịch vụ</th><th class="num">Doanh số</th><th class="num">Giá cốt</th><th class="num">Lãi gộp</th><th class="num">% cốt</th></tr></thead>
        <tbody>${r.visits.map((v) => `<tr class="click" data-c="${v.id}"><td>${dmy(v.date)}</td><td class="muted">${esc(v.code)}</td><td>${esc(v.customer_name)}</td><td>${esc(v.staff_name || '')}</td><td class="small">${esc(v.services || '')}</td>
          <td class="num">${money(v.total)}</td><td class="num">${v.used_lines || v.cost ? money(v.cost) : '<span class="badge warn">chưa ghi</span>'}</td><td class="num"><b>${money(v.total - v.cost)}</b></td><td class="num">${pc(v.cost, v.total)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Chưa có lượt nào</div>'}</div>
      <div class="card"><h3>Hóa chất / sản phẩm dùng nhiều tiền nhất</h3>${r.top_used.length ? r.top_used.map((t) => `<div class="stat-line"><span>${esc(t.name)} <span class="muted small">${t.size ? Math.round(t.qty * t.size) + ' ' + t.size_unit : Math.round(t.qty * 100) / 100 + ' ' + esc(t.unit || '')}</span></span><b>${money(t.cost)}</b></div>`).join('') : '<div class="empty">—</div>'}</div>`;
    bindTop();
    $('#go').onclick = () => go('stock', { tab, from: $('#f').value, to: $('#t').value });
    $$('[data-c]', main).forEach((tr) => (tr.onclick = async () => visitForm(await api('/visits/' + tr.dataset.c), reload)));
    return;
  }

  if (tab === 'items') {
    const kind = S.params.kind || 'service';
    const list = S.materials.filter((m) => m.kind === kind);
    main.innerHTML = top + `<div class="card"><div class="row"><button class="btn sm ${kind === 'service' ? 'primary' : ''}" data-k="service">🧪 Hóa chất làm dịch vụ</button><button class="btn sm ${kind === 'retail' ? 'primary' : ''}" data-k="retail">🛍 Sản phẩm bán lẻ</button>
      <span class="spacer"></span><button class="btn sm primary" id="newM">+ Thêm</button></div>
      <div class="small muted" style="margin-top:6px">Giá vốn = bình quân các lần nhập (hàng tặng kèm làm giá vốn giảm). Khai <b>dung tích</b> (vd tuýp màu 60ml) để thợ ghi theo ml/g.</div></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Tên</th><th>Nhóm</th><th>ĐVT</th><th>Dung tích</th><th class="num">Tồn</th><th class="num">Giá vốn/đv</th><th class="num">Giá cốt</th>${kind === 'retail' ? '<th class="num">Giá bán</th><th class="num">Lãi/SP</th>' : ''}<th class="num">Giá trị tồn</th><th></th></tr></thead>
      <tbody>${list.map((m) => `<tr style="${m.active ? '' : 'opacity:.5'}"><td><b>${esc(m.name)}</b></td><td class="small">${esc(m.grp || '')}</td><td class="small">${esc(m.unit || '')}</td><td>${m.size ? m.size + ' ' + m.size_unit : '<span class="badge warn">chưa khai</span>'}</td>
        <td class="num ${m.stock <= 0 ? 'bad' : ''}">${m.stock}</td><td class="num">${money(m.avg_cost)}</td><td class="num small">${perUnit(m)}</td>
        ${kind === 'retail' ? `<td class="num">${m.sell_price ? money(m.sell_price) : '<span class="badge warn">chưa có</span>'}</td><td class="num">${m.sell_price ? money(m.sell_price - m.avg_cost) : '—'}</td>` : ''}
        <td class="num">${money(m.stock_value)}</td><td style="white-space:nowrap"><button class="btn sm" data-em="${m.id}">Sửa</button><button class="btn sm" data-mv="${m.id}">Nhập/kiểm</button></td></tr>`).join('')}</tbody></table></div>
      ${list.length ? '' : '<div class="empty">Chưa có. Tải file sổ nhập hàng ở "Nhập / Xuất Excel" hoặc bấm + Thêm.</div>'}</div>`;
    bindTop();
    $$('[data-k]', main).forEach((b) => (b.onclick = () => go('stock', { tab, kind: b.dataset.k })));
    const form = (m = { kind, active: 1 }) => {
      openModal(m.id ? 'Sửa ' + m.name : 'Thêm hóa chất / sản phẩm', `<form id="mf"><div class="form-grid">
        <div class="full"><label>Tên *</label><input name="name" value="${esc(m.name || '')}" required></div>
        <div><label>Loại</label><select name="kind"><option value="service" ${m.kind === 'service' ? 'selected' : ''}>Hóa chất làm dịch vụ</option><option value="retail" ${m.kind === 'retail' ? 'selected' : ''}>Sản phẩm bán lẻ</option></select></div>
        <div><label>Nhóm</label><input name="grp" value="${esc(m.grp || '')}"></div>
        <div><label>ĐVT (tuýp, chai, hộp…)</label><input name="unit" value="${esc(m.unit || '')}"></div>
        <div><label>Dung tích 1 đơn vị</label><div class="row"><input type="number" name="size" step="any" min="0" value="${m.size || ''}" style="flex:1"><select name="size_unit" style="width:auto"><option ${m.size_unit !== 'g' ? 'selected' : ''}>ml</option><option ${m.size_unit === 'g' ? 'selected' : ''}>g</option></select></div></div>
        <div><label>Giá bán cho khách (sản phẩm)</label><input type="number" name="sell_price" min="0" step="1000" value="${m.sell_price ?? ''}"></div>
        <div><label>Giá thị trường 1 đơn vị (khi nhập 0đ / hàng tặng)</label><input type="number" name="ref_cost" min="0" step="1000" value="${m.ref_cost ?? ''}"><div class="small muted">Chỉ dùng tính giá cốt khi giá nhập = 0đ</div></div>
        <div><label>Mã vạch (nhiều mã cách nhau dấu phẩy)</label><div class="row" style="gap:6px"><input name="barcode" value="${esc(m.barcode || '')}" style="flex:1;min-width:0"><button type="button" class="btn sm" id="mfScan">📷</button></div></div>
        <div><label>Trạng thái</label><select name="active"><option value="1">Đang dùng</option><option value="0" ${m.active ? '' : 'selected'}>Ngừng</option></select></div>
        <div class="full"><label>Ghi chú</label><input name="note" value="${esc(m.note || '')}"></div>
        ${m.kind !== 'retail' ? `<div class="full"><label>🧪 Mã viết trong công thức (cách nhau dấu phẩy)</label><input name="formula_keys" value="${esc(m.formula_keys || '')}" placeholder="VD: graypearl, cobalt, addicthy">
          <label class="small" style="font-weight:normal;margin-top:6px"><input type="checkbox" name="formula_default" value="1" style="width:auto" ${m.formula_default ? 'checked' : ''}> Màu mặc định khi công thức chỉ ghi số tông (9nb, 7glca…)</label>
          <div class="small muted">Thợ gõ “9graypearl 15ml” ở lượt làm → app tự ghi hóa chất này 15${esc(m.size_unit || 'ml')} và tính giá cốt. Cần điền “Dung tích 1 đơn vị”.</div></div>` : ''}</div>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>`);
      $('#mfScan').onclick = () => scanBarcode({ title: 'Quét mã cho ' + (m.name || 'sản phẩm mới'), onCode: (code) => { const i = $('#mf [name=barcode]'); if (!i.value.split(/[,;\s]+/).map(normCode).includes(normCode(code))) i.value = [i.value.trim(), code].filter(Boolean).join(','); } });
      $('#mf').onsubmit = (e) => { e.preventDefault(); guard($('#mf button.primary'), async () => {
        await api(m.id ? '/materials/' + m.id : '/materials', { method: m.id ? 'PUT' : 'POST', body: formData($('#mf')) }); closeModal(); toast('Đã lưu'); reload(); }); };
    };
    $('#newM').onclick = () => form();
    $$('[data-em]', main).forEach((b) => (b.onclick = () => form(matById(b.dataset.em))));
    $$('[data-mv]', main).forEach((b) => (b.onclick = async () => {
      const m = matById(b.dataset.mv);
      const hist = await api(`/materials/${m.id}/moves`);
      const KN = { in: 'Nhập', use: 'Dùng', sale: 'Bán', adjust: 'Điều chỉnh' };
      openModal(m.name, `<div class="stat-line"><span class="muted">Tồn hiện tại</span><b>${m.stock} ${esc(m.unit || '')}</b></div>
        <form id="mvf"><div class="form-grid"><div><label>Loại</label><select name="kind"><option value="in">Nhập thêm hàng</option><option value="adjust">Kiểm kho: điều chỉnh +/−</option></select></div>
        <div><label>Số lượng (${esc(m.unit || 'đơn vị')})</label><input type="number" name="qty" step="any" required></div>
        <div><label>Đơn giá nhập (khi nhập)</label><input type="number" name="unit_cost" min="0" step="1000"></div><div><label>Ngày</label><input type="date" name="date" value="${S.today}"></div>
        <div class="full"><label>Nhà cung cấp / lý do</label><input name="note"></div></div><div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>
        <h3 style="margin-top:14px">Lịch sử</h3>${hist.length ? `<table><tbody>${hist.map((h) => `<tr><td>${dmy(h.date)}</td><td>${KN[h.kind]}</td><td class="num">${Math.round(h.qty * 1000) / 1000}</td><td class="num small">${money(Math.round(h.unit_cost))}</td><td class="small muted">${esc(h.visit_code ? h.visit_code + ' · ' + (h.customer_name || '') : h.supplier || h.note || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">—</div>'}`);
      $('#mvf').onsubmit = (e) => { e.preventDefault(); guard($('#mvf button.primary'), async () => {
        const d = formData($('#mvf')); await api(`/materials/${m.id}/move`, { method: 'POST', body: { ...d, supplier: d.kind === 'in' ? d.note : '' } }); closeModal(); toast('Đã lưu'); reload(); }); };
    }));
    return;
  }

  // Định mức: mỗi dịch vụ dùng bao nhiêu hóa chất → giá cốt dự kiến
  S.recipes = await api('/recipes');
  const svcs = S.services.filter((x) => x.active && x.grp !== 'Bán sản phẩm').sort((a, b) => (b.grp === 'Hóa chất') - (a.grp === 'Hóa chất'));
  const rc = (sid) => S.recipes.filter((r) => r.service_id === sid);
  main.innerHTML = top + `<div class="card small muted">Khai 1 lần: dịch vụ này thường dùng bao nhiêu ml/g hóa chất. Phiếu thu sẽ <b>tự điền</b> theo định mức, thợ sửa lại lượng thực tế. Giá cốt dự kiến tính theo giá vốn bình quân hiện tại.</div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Dịch vụ</th><th>Nhóm</th><th>Định mức</th><th class="num">Giá bán</th><th class="num">Giá cốt dự kiến</th><th class="num">Lãi gộp</th><th class="num">% cốt</th><th></th></tr></thead>
    <tbody>${svcs.map((x) => { const lines = rc(x.id); const cost = lines.reduce((t, r) => t + r.cost, 0);
      return `<tr><td><b>${esc(x.name)}</b></td><td class="small">${esc(x.grp)}</td><td class="small">${lines.map((r) => { const m = matById(r.material_id); return m ? `${esc(m.name)}: ${fromUnits(m, r.qty)} ${esc(matUnit(m))}` : ''; }).join('<br>') || '<span class="muted">—</span>'}</td>
      <td class="num">${money(x.price)}</td><td class="num">${lines.length ? money(cost) : '—'}</td><td class="num">${lines.length && x.price ? `<b>${money(x.price - cost)}</b>` : '—'}</td><td class="num">${lines.length && x.price ? Math.round(cost / x.price * 100) + '%' : '—'}</td>
      <td><button class="btn sm" data-rcp="${x.id}">Sửa</button></td></tr>`; }).join('')}</tbody></table></div></div>`;
  bindTop();
  $$('[data-rcp]', main).forEach((b) => (b.onclick = () => {
    const sv = S.services.find((x) => x.id === Number(b.dataset.rcp));
    let lines = rc(sv.id).map((r) => ({ material_id: r.material_id, amt: fromUnits(matById(r.material_id), r.qty) }));
    if (!lines.length) lines = [{ material_id: '', amt: '' }];
    openModal('Định mức · ' + sv.name, `<div id="rl"></div><button type="button" class="btn sm" id="rAdd">+ Thêm hóa chất</button><div class="totals" id="rTot" style="margin-top:10px"></div>
      <div class="err"></div><div class="modal-foot"><button class="btn primary" id="rSave">Lưu định mức</button></div>`, true);
    const draw = () => {
      $('#rl').innerHTML = lines.map((l, i) => { const m = matById(l.material_id); return `<div class="item-row"><select data-r="${i}" class="rsel"><option value="">— Chọn hóa chất —</option>${matOptions('service', l.material_id)}</select>
        <input type="number" data-r="${i}" class="ramt" step="any" min="0" value="${l.amt}" placeholder="Lượng" style="width:90px"><span class="small muted" style="min-width:34px">${esc(matUnit(m))}</span>
        <span class="small" style="min-width:80px;text-align:right">${m && l.amt ? money(Math.round(toUnits(m, l.amt) * m.avg_cost)) : ''}</span><button type="button" class="icon-btn" data-rr="${i}">×</button></div>`; }).join('');
      const cost = Math.round(lines.reduce((t, l) => { const m = matById(l.material_id); return t + (m && l.amt ? toUnits(m, l.amt) * m.avg_cost : 0); }, 0));
      $('#rTot').innerHTML = `<div class="row"><span>Giá bán</span><span class="num">${money(sv.price)}</span></div><div class="row"><span>Giá cốt dự kiến</span><span class="num big">${money(cost)}</span></div>
        <div class="row"><span><b>Lãi gộp / lượt</b></span><span class="num big">${money(sv.price - cost)}${sv.price ? ' (' + Math.round((sv.price - cost) / sv.price * 100) + '%)' : ''}</span></div>`;
      $$('.rsel').forEach((x) => (x.onchange = () => { lines[x.dataset.r].material_id = Number(x.value) || ''; draw(); }));
      $$('.ramt').forEach((x) => (x.onchange = () => { lines[x.dataset.r].amt = x.value; draw(); }));
      $$('[data-rr]').forEach((x) => (x.onclick = () => { lines.splice(Number(x.dataset.rr), 1); draw(); }));
    };
    draw();
    $('#rAdd').onclick = () => { lines.push({ material_id: '', amt: '' }); draw(); };
    $('#rSave').onclick = () => guard($('#rSave'), async () => {
      await api('/recipes/' + sv.id, { method: 'PUT', body: { lines: lines.filter((l) => l.material_id && Number(l.amt) > 0).map((l) => ({ material_id: l.material_id, qty: toUnits(matById(l.material_id), l.amt) })) } });
      closeModal(); toast('Đã lưu định mức'); reload();
    });
  }));
};

// ---------- Doanh số ----------
VIEWS.sales = async (main) => {
  const from = S.params.from || S.today.slice(0, 8) + '01', to = S.params.to || S.today;
  const [r, sc] = await Promise.all([api(`/reports/sales?from=${from}&to=${to}`), api(`/reports/staff-customers?from=${from}&to=${to}`)]);
  const s = r.summary;
  const G = S.groups;
  const GS = G.filter((g) => g !== 'Bán sản phẩm'); // nhóm dịch vụ (bán sản phẩm tách riêng)
  for (const x of r.rows) {
    // Khác + phụ thu = phần DS dịch vụ không thuộc nhóm nào (dịch vụ chưa rõ, phụ thu sau 19h…) → cộng đủ ra "DS dịch vụ"
    x.other_sales = x.service_sales - GS.reduce((a, g) => a + (x.by_group[g] || 0), 0);
    x.product_commission = x.product_commission || 0;
    x.service_commission = x.main_commission - x.product_commission;
  }
  const showUnpaid = () => {
    const L = s.unpaid_list;
    openModal(`Chưa thu ${money(s.unpaid)} · ${L.length} lượt`, `<div class="small muted" style="margin-bottom:8px">Khách đã trả: bấm <b>Đã thu</b> đúng hình thức (TM / CK / Thẻ). Bấm tên khách để mở phiếu.</div>
      <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Khách</th><th>Thợ</th><th class="num">Chưa thu</th><th>Nguồn</th></tr></thead><tbody>
      ${L.map((x) => `<tr><td>${dmy(x.date)} ${esc(x.time || '')}</td><td><a href="#" data-uv="${x.id}">${esc(x.name || x.code)}</a>${x.phone ? `<div class="small muted">${esc(x.phone)}</div>` : ''}</td><td>${esc(x.staff || '')}</td>
        <td class="num"><b>${money(x.amount)}</b>${x.amount !== x.total ? `<div class="small muted">/ ${money(x.total)}</div>` : ''}</td><td class="small">${esc(x.kind)}
          ${isOwner() ? `<div class="row" style="gap:4px;margin-top:4px;flex-wrap:nowrap" data-upr="${x.id}"><span class="small muted">Đã thu:</span>${S.settings.payment_methods.slice(0, 3).map((m) => `<button class="btn sm" data-upd="${x.id}" data-m="${esc(m)}" title="Khách đã trả: ${esc(m)}">${payIcon(m)} ${esc(/mặt/i.test(m) ? 'TM' : /khoản/i.test(m) ? 'CK' : /thẻ/i.test(m) ? 'Thẻ' : m)}</button>`).join('')}</div>` : ''}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Tổng</b></td><td class="num"><b>${money(L.reduce((t, x) => t + x.amount, 0))}</b></td><td></td></tr></tbody></table></div>`, true);
    $$('[data-uv]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); visitForm(await api('/visits/' + a.dataset.uv), () => VIEWS.sales(main)); }));
    $$('[data-upd]').forEach((b) => (b.onclick = () => guard(b, async () => {
      await api(`/visits/${b.dataset.upd}/mark-paid`, { method: 'POST', body: { method: b.dataset.m } });
      const box = $(`[data-upr="${b.dataset.upd}"]`); box.innerHTML = `<span class="badge ok">✓ Đã thu ${esc(b.dataset.m)}</span>`;
      box.closest('tr').style.opacity = 0.55; toast('Đã ghi khách đã trả: ' + b.dataset.m); VIEWS.sales(main);
    })));
  };
  main.innerHTML = header('Doanh số & hoa hồng', isMgr() ? 'Toàn tiệm' : 'Chỉ hiển thị số liệu của bạn') +
    `<div class="card"><div class="row"><input type="date" id="f" value="${from}" style="width:auto"> → <input type="date" id="t" value="${to}" style="width:auto">
      <button class="btn sm" data-p="today">Hôm nay</button><button class="btn sm" data-p="month">Tháng này</button><button class="btn sm" data-p="last">Tháng trước</button><button class="btn sm" data-p="all">Từ khai trương</button></div></div>
    ${s ? (() => {
      // Doanh thu dịch vụ = tiền dịch vụ thực tính khách (đã trừ giảm giá), KHÔNG gồm phần khách trả bằng thẻ tri ân (chi phí tiệm)
      const giftSvc = s.paid_by_gift - ((s.gift_by_group || {})['Bán sản phẩm'] || 0);
      const svcNet = s.shop_service_sales - giftSvc;
      const line = (l, v, sub) => `<div class="stat-line"><span>${l}${sub ? `<div class="small muted">${sub}</div>` : ''}</span><b>${v}</b></div>`;
      return `<div class="grid kpis">
      <div class="kpi"><div class="l">✂️ Doanh thu dịch vụ</div><div class="v">${money(svcNet)}</div><div class="s">${s.visits} lượt</div></div>
      <div class="kpi"><div class="l">🧴 Bán sản phẩm</div><div class="v">${money(s.product_sales)}</div></div>
      <div class="kpi"><div class="l">💳 Bán thẻ</div><div class="v">${money(s.card_sales)}</div></div>
      <div class="kpi"><div class="l">💰 Tiền vào thực tế</div><div class="v">${money(s.money_in)}</div>${s.unpaid ? `<div class="s"><a href="#" id="unpaidL" style="color:var(--bad)">chưa thu ${money(s.unpaid)} · xem ${s.unpaid_list.length} lượt ›</a></div>` : ''}</div></div>
      <details class="card sales-more"><summary><b>Chi tiết</b> <span class="small muted">giảm giá · thẻ tri ân · trả bằng thẻ · tip · hình thức trả</span></summary>
        <div class="sales-cols"><div>
          ${line('Giảm giá đã cho khách', money(s.discounts), 'đã trừ sẵn trong doanh thu')}
          ${line('🎁 Khách dùng thẻ tri ân', money(s.paid_by_gift), 'chi phí tiệm, không tính doanh thu' + (Object.keys(s.gift_by_group || {}).length ? ': ' + Object.entries(s.gift_by_group).map(([k, v]) => esc(k) + ' ' + money(v)).join(', ') : ''))}
          ${line('Dịch vụ trả bằng thẻ trả trước', money(s.paid_by_card - s.paid_by_gift), 'đã thu tiền lúc bán thẻ')}
          ${line('Tip', money(s.tips), 'không tính doanh thu')}
        </div><div>
          <div class="small muted" style="margin-bottom:4px">Tiền vào theo hình thức</div>
          ${Object.entries(s.by_method).filter(([, v]) => v).map(([k, v]) => line(esc(k), money(v))).join('') || '<div class="empty">—</div>'}
        </div></div></details>`;
    })() : ''}
    ${!isMgr() ? r.rows.map((x) => `<div class="card"><h3>${esc(x.name)}</h3>
      <div class="stat-line"><span class="muted">Lượt làm chính / phụ</span><b>${x.main_count} / ${x.assist_count}</b></div>
      <div class="small" style="margin-top:6px"><b>① Doanh số dịch vụ</b> (xét thưởng)</div>
      ${GS.map((g) => `<div class="stat-line"><span class="muted">DS ${esc(g)}</span><b>${money(x.by_group[g])}</b></div>`).join('')}
      ${x.other_sales ? `<div class="stat-line"><span class="muted">DS khác + phụ thu</span><b>${money(x.other_sales)}</b></div>` : ''}
      ${x.gift_sales ? `<div class="stat-line"><span class="muted">− khách trả bằng thẻ tri ân</span><b>${money(x.gift_sales)}</b></div>` : ''}
      ${x.family_sales ? `<div class="stat-line"><span class="muted">− người nhà chủ</span><b>${money(x.family_sales)}</b></div>` : ''}
      <div class="stat-line"><span>DS tính thưởng</span><b>${money(x.bonus_sales)}</b></div>
      <div class="small" style="margin-top:6px"><b>② Doanh số riêng</b> (không cộng vào ①)</div>
      <div class="stat-line"><span class="muted">Bán sản phẩm</span><b>${money(x.product_sales)}</b></div>
      <div class="stat-line"><span class="muted">Bán thẻ (${x.cards_count} thẻ)</span><b>${money(x.cards_amount)}</b></div>
      <div class="stat-line"><span class="muted">Làm phụ</span><b>${money(x.assist_sales)}</b></div>
      <div class="small" style="margin-top:6px"><b>③ Hoa hồng</b></div>
      <div class="stat-line"><span class="muted">HH dịch vụ</span><b>${money(x.service_commission)}</b></div>
      ${x.product_commission ? `<div class="stat-line"><span class="muted">HH bán sản phẩm</span><b>${money(x.product_commission)}</b></div>` : ''}
      <div class="stat-line"><span class="muted">HH làm phụ</span><b>${money(x.assistant_commission)}</b></div>
      <div class="stat-line"><span class="muted">HH bán thẻ (${x.cards_count} thẻ)</span><b>${money(x.card_commission)}</b></div>
      ${x.surcharge_share ? `<div class="stat-line"><span class="muted">Phần phụ thu được chia</span><b>${money(x.surcharge_share)}</b></div>` : ''}
      <div class="stat-line"><span>Tổng hoa hồng (tạm tính)</span><b>${money(x.total_commission)}</b></div>
      <div class="stat-line"><span class="muted">Tip khách ghi ở lượt</span><b>${money(x.tip)}</b></div></div>`).join('') : ''}
    <div class="card ${!isMgr() ? 'hidden' : ''}"><h3>Theo nhân viên</h3><div class="table-wrap"><table class="sales-split"><thead>
      <tr><th rowspan="2">Nhân viên</th><th class="grp-svc" colspan="${GS.length + 5}">① DOANH SỐ DỊCH VỤ tự làm → xét thưởng / nhân hệ số</th><th class="grp-own" colspan="3">② DOANH SỐ RIÊNG – KHÔNG cộng vào ①</th><th class="grp-hh" colspan="6">③ HOA HỒNG</th><th rowspan="2" class="num">Tip</th></tr>
      <tr>${GS.map((g) => `<th class="num grp-svc">${esc(g)}</th>`).join('')}<th class="num grp-svc">Khác + phụ thu</th><th class="num grp-svc">DS dịch vụ</th><th class="num grp-svc">− Tri ân</th><th class="num grp-svc">− Người nhà</th><th class="num grp-svc">DS tính thưởng</th>
        <th class="num grp-own">Bán sản phẩm</th><th class="num grp-own">Bán thẻ</th><th class="num grp-own">Làm phụ (${'lượt'})</th>
        <th class="num grp-hh">HH dịch vụ</th><th class="num grp-hh">HH phụ</th><th class="num grp-hh">HH thẻ</th><th class="num grp-hh">HH SP</th><th class="num grp-hh">Phụ thu</th><th class="num grp-hh">Tổng HH</th></tr></thead>
      <tbody>${r.rows.map((x) => `<tr><td><a href="#" data-sl="${x.user_id}" data-g=""><b>${esc(x.name)}</b></a><div class="small muted">${x.main_count} lượt chính</div></td>
        ${GS.map((g) => `<td class="num">${x.by_group[g] ? `<a href="#" data-sl="${x.user_id}" data-g="${esc(g)}">${money(x.by_group[g])}</a>` : '–'}</td>`).join('')}
        <td class="num">${x.other_sales ? `<a href="#" data-sl="${x.user_id}" data-g="Khác">${money(x.other_sales)}</a>` : '–'}</td><td class="num">${money(x.service_sales)}</td><td class="num">${x.gift_sales ? '−' + money(x.gift_sales) : '–'}</td><td class="num">${x.family_sales ? '−' + money(x.family_sales) : '–'}</td><td class="num grp-key"><b>${money(x.bonus_sales)}</b></td>
        <td class="num">${x.product_sales ? `<a href="#" data-sl="${x.user_id}" data-g="Bán sản phẩm">${money(x.product_sales)}</a>` : '–'}</td><td class="num">${x.cards_count ? `${money(x.cards_amount)}<div class="small muted">${x.cards_count} thẻ</div>` : '–'}</td><td class="num">${x.assist_sales ? `${money(x.assist_sales)}<div class="small muted">${x.assist_count} lượt</div>` : '–'}</td>
        <td class="num">${money(x.service_commission)}</td><td class="num">${money(x.assistant_commission)}</td><td class="num">${money(x.card_commission)}</td><td class="num">${money(x.product_commission)}</td><td class="num">${money(x.surcharge_share)}</td><td class="num"><b>${money(x.total_commission)}</b></td><td class="num">${money(x.tip)}</td></tr>`).join('')}</tbody></table></div>
      <div class="small muted" style="margin-top:8px">Hoa hồng tạm tính theo % từng dịch vụ (Cài đặt › Dịch vụ) và % người phụ, bán thẻ (Cài đặt › Tham số). Phụ thu: cửa hàng giữ ${Math.round((S.settings.surcharge_salon_rate ?? 0.33) * 100)}%, còn lại chia thợ chính / người phụ của lượt đó. Chưa gồm lương cứng, thưởng mốc doanh số. <b>DS tính thưởng</b> = chỉ doanh số DỊCH VỤ tự làm, trừ phần khách trả bằng thẻ tri ân (chi phí cửa hàng) và lượt của người nhà chủ. <b>Bán sản phẩm, bán thẻ, làm phụ là doanh số riêng</b>: chỉ hưởng % hoa hồng của từng loại, KHÔNG cộng vào DS tính thưởng. Tip được chia chung ở trang <a href="#tips">Chia tip</a>.</div></div>
    ${staffCustomerCard(sc)}`;
  const set = (a, b) => go('sales', { from: a, to: b });
  $$('[data-sl]', main).forEach((a) => (a.onclick = (e) => { e.preventDefault(); salesLines(from, to, Number(a.dataset.sl), a.dataset.g, () => VIEWS.sales(main)); }));
  $('#f').onchange = (e) => set(e.target.value, to); $('#t').onchange = (e) => set(from, e.target.value);
  if ($('#unpaidL')) $('#unpaidL').onclick = (e) => { e.preventDefault(); showUnpaid(); };
  $$('[data-p]').forEach((b) => (b.onclick = () => {
    const t = S.today;
    if (b.dataset.p === 'today') set(t, t);
    if (b.dataset.p === 'month') set(t.slice(0, 8) + '01', t);
    if (b.dataset.p === 'all') set('2026-10-25', t);
    if (b.dataset.p === 'last') { const f = addDays(t.slice(0, 8) + '01', -1); set(f.slice(0, 8) + '01', f); }
  }));
};

// ---------- Chia tip chung theo tháng ----------
// ---------- Bảng lương (chỉ Lãnh đạo) ----------
VIEWS.finance = async (main) => {
  if (!isOwner()) { main.innerHTML = header('Báo cáo tài chính', '') + '<div class="card empty">Chỉ Lãnh đạo xem được báo cáo tài chính</div>'; return; }
  if (S.params.year) return financeYear(main, Number(S.params.year));
  const month = S.params.month || S.today.slice(0, 7);
  const r = await api('/finance?month=' + month);
  const shift = (n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const R = r.revenue, C = r.cogs, P = r.payroll, F = r.fixed, K = r.cash;
  const neg = (v) => (v ? '−' + money(v) : money(0));
  const row = (l, v, cls = '', sub = '') => `<tr class="${cls}"><td>${l}${sub ? `<div class="small muted">${sub}</div>` : ''}</td><td class="num">${v}</td></tr>`;
  const sign = (v) => `<b style="color:${v < 0 ? 'var(--danger,#c0392b)' : 'var(--ok,#1e8449)'}">${v < 0 ? '−' + money(-v) : money(v)}</b>`;
  const estTxt = Object.entries(C.est).map(([g, v]) => `${esc(g)} ${money(v)}${r.rates[g] != null ? ` (${pct(r.rates[g])})` : ''}`).join(' · ');
  const H = r.head_cost;
  const headCard = H && H.heads ? `<div class="card"><h3>🧪 Giá cốt mỗi đầu hóa chất (tháng ${month.slice(5)})</h3>
      <div class="grid kpis" style="margin:0">
        <div class="kpi"><div class="l">Cốt TB / đầu (theo công thức + xuất kho)</div><div class="v">${H.real_heads ? money(H.real_avg_cost) : '—'}</div><div class="s">${H.real_heads ? `${H.real_heads} đầu · ${pct(H.real_pct)} giá dịch vụ` : 'chưa có lượt nào ghi công thức có lượng'}</div></div>
        <div class="kpi"><div class="l">Cốt TB / đầu (cả tháng)</div><div class="v">${money(H.avg_cost)}</div><div class="s">${H.heads} đầu hóa chất · ${Object.entries(H.by_source).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</div></div></div>
      <details style="margin-top:8px"><summary class="small">Xem từng đầu</summary><div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Khách · thợ</th><th>Dịch vụ</th><th class="num">Giá</th><th class="num">Cốt</th><th class="num">%</th><th>Tính từ</th></tr></thead><tbody>
        ${H.rows.map((x) => `<tr><td>${dmy(x.date)}</td><td>${esc(x.customer || '')}<div class="small muted">${esc(x.staff || '')}</div></td><td class="small">${esc(x.services || '')}</td><td class="num">${money(x.price)}</td><td class="num"><b>${money(x.cost)}</b></td><td class="num">${x.price ? pct(x.cost / x.price) : ''}</td>
          <td class="small">${x.source === 'Ước tính' ? `<span class="muted">Ước tính ${pct(r.rates['Hóa chất'])}</span>` : esc(x.source)}${x.lines.length ? `<div class="muted">${x.lines.map((l) => `${esc(l.name)} ${l.amt}${esc(l.unit || '')} = ${money(l.cost)}`).join('<br>')}</div>` : ''}${x.unknown.length ? `<div style="color:var(--warn)">Chưa nhận ra: ${x.unknown.map(esc).join(', ')}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div></details>
      <div class="small muted" style="margin-top:6px">Lấy hóa chất đã xuất kho ở hóa đơn; chưa có thì đọc công thức thợ ghi (ở lượt, hoặc công thức khách cập nhật trong 10 ngày sau) × giá nhập bình quân; không có công thức thì ước theo %. Công thức không ghi oxi thì chưa tính tiền oxi – nhắc thợ ghi "oxi 20".</div></div>` : '';
  const warn = [];
  if (P.no_params.length) warn.push(`<b>${P.no_params.length} người chưa cài lương cứng</b> (${P.no_params.map(esc).join(', ')}) → chi phí lương đang thiếu phần lương cứng/phụ cấp. Vào 💰 Bảng lương › ⚙ để cài.`);
  if (C.est_total) warn.push(`<b>${C.est_visits} lượt chưa ghi xuất kho</b> → giá vốn ${money(C.est_total)} là <b>ước tính</b> theo % doanh thu. Ghi xuất kho ở hóa đơn để số chính xác hơn.`);
  if (F.rows.some((f) => /điện/i.test(f.name) && !f.amount)) warn.push('Chưa nhập <b>tiền điện nước</b> tháng này.');
  if (r.fund.flags.length) warn.push(`Chi quỹ có <b>${r.fund.flags.length} khoản dễ bị tính trùng hoặc không phải chi phí</b>: ${r.fund.flags.map((x) => `${esc(x.note)} ${money(x.amount)}`).join('; ')}. Nếu điện nước/phần mềm đã chi từ quỹ thì để 0 ở chi phí cố định; khoản đổi tiền/ứng lương thì sửa hoặc bỏ duyệt bên trang Quỹ.`);
  if (R.unpaid) warn.push(`Có ${money(R.unpaid)} khách <b>chưa thanh toán</b> (ô hồng) – đã tính vào doanh thu nhưng chưa thu tiền.`);
  main.innerHTML = header('📈 Báo cáo tài chính', 'Chỉ tài khoản Lãnh đạo thấy. Lãi/lỗ tháng sau khi trừ giá vốn, lương, chi quỹ và chi phí cố định.', `<button class="btn primary" id="fyear">📅 Xem cả năm ${month.slice(0, 4)}</button><button class="btn" id="fcfg">⚙ Chi phí cố định & % giá vốn</button>`) +
    `<div class="card"><div class="row"><button class="btn sm" id="pm">‹</button><input type="month" id="mo" value="${month}" style="width:auto"><button class="btn sm" id="nm">›</button>
      <span class="small muted">${r.from.split('-').reverse().join('/')} – ${r.to.split('-').reverse().join('/')} · ${R.visits} lượt khách${r.locked_payroll ? ' · lương đã chốt' : ' · lương chưa chốt (số tạm)'}</span></div></div>
    <div class="grid kpis">
      <div class="kpi"><div class="l">Doanh thu</div><div class="v">${money(R.total)}</div><div class="s">DV ${money(R.service)} · SP ${money(R.product)}</div></div>
      <div class="kpi"><div class="l">Tổng chi phí</div><div class="v">${money(C.total + r.opex)}</div><div class="s">giá vốn ${money(C.total)} · vận hành ${money(r.opex)}</div></div>
      <div class="kpi"><div class="l">${r.profit < 0 ? '🔻 LỖ' : '✅ LÃI'} sau mọi chi phí</div><div class="v">${sign(r.profit)}</div><div class="s">${pct(r.profit_pct)} doanh thu · trước khấu hao ${r.ebitda < 0 ? '−' + money(-r.ebitda) : money(r.ebitda)}</div></div>
      <div class="kpi"><div class="l">Doanh thu hòa vốn</div><div class="v">${r.breakeven ? money(r.breakeven) : '—'}</div><div class="s">${r.breakeven ? (R.total >= r.breakeven ? 'đã vượt ' : 'còn thiếu ') + money(Math.abs(R.total - r.breakeven)) : ''}</div></div>
    </div>
    ${warn.length ? `<div class="card" style="border-left:4px solid var(--warn,#e0a800)"><b>Cần lưu ý</b><ul style="margin:6px 0 0 18px">${warn.map((w) => `<li class="small">${w}</li>`).join('')}</ul></div>` : ''}
    ${headCard}
    <div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
    <div class="card"><h3>Lãi / Lỗ tháng ${month.slice(5)}/${month.slice(0, 4)}</h3><div class="table-wrap"><table class="fin"><tbody>
      ${row('Doanh thu dịch vụ tại tiệm', money(R.service), '', `giảm giá đã trừ ${money(R.discounts)}`)}
      ${row('Doanh thu bán sản phẩm', money(R.product))}
      ${R.gift ? row('− Khách dùng thẻ tri ân (không thu tiền)', neg(R.gift)) : ''}
      ${row('<b>(1) DOANH THU</b>', `<b>${money(R.total)}</b>`, 'sum')}
      ${row('− Hóa chất/vật tư đã xuất kho', neg(C.use))}
      ${row('− Giá vốn sản phẩm đã bán', neg(C.sale))}
      ${C.est_total ? row('− Giá vốn ước tính (lượt chưa ghi kho)', neg(C.est_total), '', estTxt) : ''}
      ${row('<b>(2) LÃI GỘP</b>', `<b>${money(r.gross)}</b> <span class="small muted">${pct(r.gross_pct)}</span>`, 'sum')}
      ${row('− Lương cứng + phụ cấp + KPI', neg(P.base + P.allowance + P.kpi + P.floor_topup), '', P.floor_topup ? 'gồm bù sàn ' + money(P.floor_topup) : '')}
      ${row('− Hoa hồng + thưởng doanh số', neg(P.commission + P.bonus), '', 'theo Bảng lương, không tính tip')}
      ${P.plus_minus ? row('− Cộng/trừ khác trong lương', P.plus_minus > 0 ? neg(P.plus_minus) : money(-P.plus_minus)) : ''}
      ${row('− Chi phát sinh (đã duyệt)', neg(r.fund.total), '', r.fund.rows.map((x) => `${esc(x.category)} ${money(x.amount)}`).join(' · ')
        + (r.fund.spread && r.fund.spread.length ? `<br>chia tháng: ${r.fund.spread.map((x) => `${esc(x.note)} ${money(x.share)}/tháng (${money(x.amount)} ÷ ${x.months})`).join(' · ')}` : ''))}
      ${F.rows.map((f) => row('− ' + esc(f.name), neg(f.amount), '', [f.cash ? '' : 'không chi tiền', f.source === 'tháng này' ? 'riêng tháng này' : '', esc(f.note)].filter(Boolean).join(' · '))).join('')}
      ${r.other_income.total ? row('+ Thu nhập khác', `+${money(r.other_income.total)}`, '', r.other_income.rows.map((x) => `${esc(x.kind)}${x.note ? ' – ' + esc(x.note) : ''} ${money(x.amount)}`).join(' · ')) : ''}
      ${row(`<b>(3) ${r.profit < 0 ? 'LỖ' : 'LÃI'} SAU MỌI CHI PHÍ</b>`, sign(r.profit), 'sum big')}
      ${row('Lãi/lỗ trước khấu hao', r.ebitda < 0 ? '−' + money(-r.ebitda) : money(r.ebitda), '', 'cộng lại khấu hao – gần với tiền thật kiếm được')}
    </tbody></table></div></div>
    <div class="card"><h3>Dòng tiền tháng (tiền thật vào/ra)</h3><div class="table-wrap"><table class="fin"><tbody>
      ${row('Tiền khách trả dịch vụ + SP', money(K.in_service), '', 'không gồm ô hồng chưa trả, phần trừ thẻ')}
      ${row('Tiền bán thẻ', money(K.in_cards), '', 'thu trước – khách sẽ dùng dịch vụ sau')}
      ${K.in_other ? row('Thu nhập khác', money(K.in_other), '', 'lì xì khai trương…') : ''}
      ${row('<b>Tiền vào</b>', `<b>${money(K.in_total)}</b>`, 'sum')}
      ${row('− Lương (không tip)', neg(K.payroll))}
      ${row('− Chi phát sinh', neg(K.fund), '', 'tiền thật trả trong tháng, kể cả khoản chia nhiều tháng')}
      ${row('− Chi phí cố định trả tiền', neg(K.fixed), '', 'tiền nhà tính đều 15tr/tháng')}
      ${row('− Nhập hàng trong tháng', neg(K.purchases))}
      ${row('<b>Tiền còn lại</b>', sign(K.net), 'sum big')}
    </tbody></table></div>
    <div class="small muted" style="margin-top:8px">Khác với lãi/lỗ: bán thẻ là tiền thu trước (chưa phải doanh thu); khách dùng thẻ thì có doanh thu nhưng không có tiền vào. Tip ${money(R.tips)} là tiền khách cho thợ nên không tính. Lì xì cho cửa hàng ghi ở mục 🧧 Thu nhập khác.</div></div></div>
    <div class="card"><h3>🧧 Thu nhập khác (lì xì khai trương…)</h3><div class="small muted">Tiền khách/đối tác lì xì cho cửa hàng: <b>không</b> chia tip, <b>không</b> tính doanh số thợ, được cộng vào lãi/lỗ và dòng tiền.</div>
      <form id="oi" class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px"><input type="date" name="date" value="${S.today.slice(0, 7) === month ? S.today : month + '-01'}" style="width:auto">
        <input name="kind" list="oikinds" value="Lì xì khai trương" style="flex:2;min-width:150px"><datalist id="oikinds"><option value="Lì xì khai trương"><option value="Lì xì Tết"><option value="Hỗ trợ NCC"><option value="Thu khác"></datalist>
        <input name="amount" inputmode="numeric" placeholder="Số tiền" style="flex:1;min-width:110px"><select name="method" style="width:auto"><option>Tiền mặt</option><option>Chuyển khoản</option></select>
        <input name="note" placeholder="Ai lì xì / ghi chú" style="flex:2;min-width:140px"><button class="btn primary">+ Thêm</button></form><div class="err"></div>
      ${r.other_income.rows.map((x) => `<div class="stat-line"><span>${dmy(x.date)} · ${esc(x.kind)}${x.note ? ` <span class="small muted">${esc(x.note)}</span>` : ''} <span class="small muted">${/chuy/i.test(x.method || '') ? 'CK' : 'TM'}</span></span><span><b>${money(x.amount)}</b> <button class="btn sm" data-oid="${x.id}">✕</button></span></div>`).join('')}
      ${r.other_income.rows.length ? `<div class="stat-line"><b>Tổng tháng</b><b>${money(r.other_income.total)}</b></div>` : ''}
    </div>
    <div class="card"><h3>Khoản chi riêng tháng này</h3><div class="small muted">Nhập điện nước, sửa chữa, quảng cáo… của riêng tháng ${month.slice(5)}. Trùng tên với khoản mặc định thì <b>thay</b> khoản mặc định (vd "Điện, nước, internet").</div>
      <form id="fi" class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px"><input name="name" placeholder="Tên khoản" list="fnames" style="flex:2;min-width:160px"><datalist id="fnames">${r.defaults.fixed.map((f) => `<option value="${esc(f.name)}">`).join('')}</datalist>
        <input name="amount" inputmode="numeric" placeholder="Số tiền" style="flex:1;min-width:110px"><input name="note" placeholder="Ghi chú" style="flex:2;min-width:140px">
        <label class="small" style="display:flex;align-items:center;gap:4px"><input type="checkbox" name="cash" checked style="width:auto">chi tiền</label><button class="btn primary">+ Thêm</button></form><div class="err"></div>
      ${F.rows.filter((f) => f.id).map((f) => `<div class="stat-line"><span>${esc(f.name)}${f.note ? ` <span class="small muted">${esc(f.note)}</span>` : ''}</span><span><b>${money(f.amount)}</b> <button class="btn sm" data-del="${f.id}">✕</button></span></div>`).join('')}
    </div>
    <div class="card small muted">Cách tính: Doanh thu = tiền dịch vụ + sản phẩm đã làm trong tháng (cả phần khách trừ thẻ trả trước), bỏ phần dùng thẻ tri ân. Giá vốn = hóa chất/SP xuất kho theo giá nhập bình quân; lượt chưa ghi kho thì ước theo %. Lương lấy từ Bảng lương (chốt rồi thì lấy số chốt). Hòa vốn = chi phí cố định ÷ (1 − giá vốn và hoa hồng/doanh thu).</div>`;
  const go2 = (m) => go('finance', { month: m });
  $('#pm').onclick = () => go2(shift(-1)); $('#nm').onclick = () => go2(shift(1)); $('#mo').onchange = (e) => e.target.value && go2(e.target.value);
  $('#fi').onsubmit = (e) => { e.preventDefault(); const b = formData(e.target); guard($('button.primary', e.target), async () => {
    await api('/finance/items', { method: 'POST', body: { month, name: b.name, amount: String(b.amount).replace(/\D/g, ''), note: b.note, cash: b.cash ? 1 : 0 } });
    toast('Đã thêm khoản chi'); VIEWS.finance(main); }); };
  $$('[data-del]', main).forEach((x) => (x.onclick = () => guard(x, async () => { if (!confirm('Xóa khoản chi này?')) return; await api('/finance/items/' + x.dataset.del, { method: 'DELETE' }); VIEWS.finance(main); })));
  $('#oi').onsubmit = (e) => { e.preventDefault(); const b = formData(e.target); guard($('button.primary', e.target), async () => {
    await api('/finance/income', { method: 'POST', body: { ...b, amount: String(b.amount).replace(/\D/g, '') } });
    toast('Đã ghi thu nhập khác'); VIEWS.finance(main); }); };
  $$('[data-oid]', main).forEach((x) => (x.onclick = () => guard(x, async () => { if (!confirm('Xóa khoản thu này?')) return; await api('/finance/income/' + x.dataset.oid, { method: 'DELETE' }); VIEWS.finance(main); })));
  $('#fcfg').onclick = () => finConfig(r.defaults, () => VIEWS.finance(main));
  $('#fyear').onclick = () => go('finance', { year: month.slice(0, 4) });
};
// Cả năm: mỗi tháng 1 cột, cộng dồn lãi và tiền; biểu đồ cột doanh thu / lãi
async function financeYear(main, year) {
  main.innerHTML = header('📈 Báo cáo tài chính cả năm', 'Đang tính từng tháng…', '') + '<div class="card empty">Đang tải…</div>';
  const y = await api('/finance/year?year=' + year);
  const M = y.months, T = y.total;
  const mm = (m) => 'T' + Number(m.slice(5));
  const cell = (v, bold) => `<td class="num">${bold ? '<b>' : ''}${v < 0 ? `<span style="color:var(--bad)">−${money(-v)}</span>` : money(v)}${bold ? '</b>' : ''}</td>`;
  const line = (label, k, o = {}) => `<tr class="${o.cls || ''}"><td>${label}${o.sub ? `<div class="small muted">${o.sub}</div>` : ''}</td>${M.map((x) => cell(o.neg ? -(x[k] || 0) || 0 : x[k] || 0, o.bold)).join('')}${o.noTotal ? '<td></td>' : cell(o.neg ? -(T[k] || 0) || 0 : T[k] || 0, true)}</tr>`;
  const best = M.length ? M.reduce((a, b) => (b.profit > a.profit ? b : a)) : null;
  const last = M[M.length - 1];
  // Biểu đồ cột: doanh thu (nhạt) + lãi/lỗ (xanh/đỏ)
  const W = Math.max(320, M.length * 70), H = 210, pad = 24, bw = 22;
  const mx = Math.max(1, ...M.map((x) => Math.max(x.revenue, Math.abs(x.profit))));
  const zero = H - pad - (M.some((x) => x.profit < 0) ? 50 : 0);
  const sc = (v) => (v / mx) * (zero - 12);
  const chart = M.length ? `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto" role="img" aria-label="Doanh thu và lãi lỗ từng tháng">
    <line x1="0" x2="${W}" y1="${zero}" y2="${zero}" stroke="var(--line)" />
    ${M.map((x, i) => { const cx = 40 + i * 70; const hp = sc(Math.abs(x.profit));
      return `<rect x="${cx - bw}" y="${zero - sc(x.revenue)}" width="${bw}" height="${sc(x.revenue)}" fill="var(--brand)" opacity=".25"><title>Doanh thu ${money(x.revenue)}</title></rect>
      <rect x="${cx + 2}" y="${x.profit >= 0 ? zero - hp : zero}" width="${bw}" height="${x.profit >= 0 ? hp : Math.min(hp, H - 22 - zero)}" fill="${x.profit >= 0 ? 'var(--ok,#1e8449)' : 'var(--bad)'}"><title>${x.profit >= 0 ? 'Lãi' : 'Lỗ'} ${money(Math.abs(x.profit))}</title></rect>
      <text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="11" fill="currentColor">${mm(x.month)}</text>`; }).join('')}
  </svg><div class="small muted"><span style="display:inline-block;width:10px;height:10px;background:var(--brand);opacity:.25"></span> Doanh thu &nbsp; <span style="display:inline-block;width:10px;height:10px;background:var(--ok,#1e8449)"></span> Lãi &nbsp; <span style="display:inline-block;width:10px;height:10px;background:var(--bad)"></span> Lỗ</div>` : '';
  main.innerHTML = header(`📈 Báo cáo tài chính năm ${year}`, `${M.length} tháng có số liệu · bấm tên tháng để xem chi tiết`,
    `<button class="btn" id="ybk">‹ Về báo cáo tháng</button>`) +
    `<div class="card"><div class="row"><button class="btn sm" id="ypv">‹ ${year - 1}</button><b>${year}</b><button class="btn sm" id="ynx">${year + 1} ›</button></div></div>
    ${M.length ? `<div class="grid kpis">
      <div class="kpi"><div class="l">Doanh thu năm</div><div class="v">${money(T.revenue)}</div><div class="s">${T.visits} lượt · TB ${money(Math.round(T.revenue / M.length))}/tháng</div></div>
      <div class="kpi"><div class="l">${T.profit < 0 ? '🔻 Lỗ' : '✅ Lãi'} cả năm</div><div class="v" style="color:${T.profit < 0 ? 'var(--bad)' : 'var(--ok,#1e8449)'}">${T.profit < 0 ? '−' : ''}${money(Math.abs(T.profit))}</div><div class="s">TB ${y.avg_profit < 0 ? '−' : ''}${money(Math.abs(y.avg_profit))}/tháng · trước khấu hao ${T.ebitda < 0 ? '−' : ''}${money(Math.abs(T.ebitda))}</div></div>
      <div class="kpi"><div class="l">Tiền còn lại (dòng tiền)</div><div class="v">${T.cash_net < 0 ? '−' : ''}${money(Math.abs(T.cash_net))}</div><div class="s">vào ${money(T.cash_in)} · ra ${money(T.cash_out)}</div></div>
      <div class="kpi"><div class="l">Tháng tốt nhất</div><div class="v">${best ? mm(best.month) : '—'}</div><div class="s">${best ? (best.profit < 0 ? 'lỗ ' : 'lãi ') + money(Math.abs(best.profit)) : ''}${last && last.month === S.today.slice(0, 7) ? ` · ${mm(last.month)} đang chạy (chưa đủ tháng)` : ''}</div></div></div>
    <div class="card">${chart}</div>
    <div class="card"><div class="table-wrap"><table class="fin year-tbl"><thead><tr><th></th>${M.map((x) => `<th class="num"><a href="#" data-ym="${x.month}">${mm(x.month)}</a>${x.locked_payroll ? '' : '<div class="small muted">lương tạm</div>'}</th>`).join('')}<th class="num">Cả năm</th></tr></thead><tbody>
      ${line('Doanh thu dịch vụ', 'service')}
      ${line('Bán sản phẩm', 'product')}
      ${T.gift ? line('− Dùng thẻ tri ân', 'gift', { neg: true }) : ''}
      ${line('<b>Doanh thu</b>', 'revenue', { cls: 'sum', bold: true })}
      ${line('− Giá vốn', 'cogs', { neg: true, sub: T.cogs_est ? `trong đó ước tính ${money(T.cogs_est)}` : '' })}
      ${line('<b>Lãi gộp</b>', 'gross', { cls: 'sum', bold: true })}
      ${line('− Lương + hoa hồng', 'payroll', { neg: true })}
      ${line('− Chi phát sinh', 'fund', { neg: true })}
      ${line('− Chi phí cố định', 'fixed', { neg: true, sub: `gồm khấu hao ${money(T.depreciation)}` })}
      ${T.other_income ? line('+ Thu nhập khác', 'other_income', { sub: 'lì xì khai trương…' }) : ''}
      ${line('<b>LÃI / LỖ</b>', 'profit', { cls: 'sum big', bold: true })}
      ${line('Lãi/lỗ cộng dồn', 'cum_profit', { noTotal: true })}
      ${line('Lãi/lỗ trước khấu hao', 'ebitda')}
      <tr><td colspan="${M.length + 2}" class="small muted" style="padding-top:14px"><b>Dòng tiền</b></td></tr>
      ${line('Tiền vào', 'cash_in', { sub: 'gồm bán thẻ, thu khác' })}
      ${line('− Tiền ra', 'cash_out', { neg: true, sub: 'lương, chi, nhà, điện, nhập hàng' })}
      ${line('<b>Tiền còn lại</b>', 'cash_net', { cls: 'sum', bold: true })}
      ${line('Tiền còn lại cộng dồn', 'cum_cash', { noTotal: true })}
      ${line('Tip khách cho thợ (không tính)', 'tips', { cls: 'muted' })}
    </tbody></table></div>
    <div class="small muted" style="margin-top:8px">Mỗi cột tính giống hệt báo cáo tháng. Tháng chưa chốt lương là số tạm; tháng hiện tại chưa hết nên thường thấp hơn. Lãi khác tiền còn lại vì: khấu hao không chi tiền, bán thẻ là tiền thu trước, nhập hàng là tiền ra nhưng chưa phải chi phí.</div></div>`
    : '<div class="card empty">Năm này chưa có số liệu</div>'}`;
  $('#ybk').onclick = () => go('finance', {});
  $('#ypv').onclick = () => go('finance', { year: year - 1 }); $('#ynx').onclick = () => go('finance', { year: year + 1 });
  $$('[data-ym]', main).forEach((a) => (a.onclick = (e) => { e.preventDefault(); go('finance', { month: a.dataset.ym }); }));
}
function finConfig(d, after) {
  const line = (f = {}) => `<div class="row fx" style="gap:6px;margin-bottom:6px;flex-wrap:wrap"><input name="n" value="${esc(f.name || '')}" placeholder="Tên khoản" style="flex:2;min-width:150px">
    <input name="a" inputmode="numeric" value="${f.amount ? Number(f.amount).toLocaleString('vi-VN') : ''}" placeholder="Số tiền/tháng" style="flex:1;min-width:110px">
    <input name="t" value="${esc(f.note || '')}" placeholder="Ghi chú" style="flex:2;min-width:120px">
    <label class="small" style="display:flex;align-items:center;gap:4px"><input type="checkbox" name="c" ${f.cash === 0 ? '' : 'checked'} style="width:auto">chi tiền</label></div>`;
  const groups = ['Hóa chất', 'Gội & chăm sóc', 'Cắt', 'Bán sản phẩm'];
  openModal('Chi phí cố định hàng tháng & % giá vốn ước tính', `<form id="fc">
    <h3>Chi phí cố định mỗi tháng</h3><div class="small muted">Bỏ tích "chi tiền" với khoản không phải tiền ra thật (vd khấu hao). Để trống tên để xóa dòng.</div>
    <div id="fxl" style="margin-top:8px">${d.fixed.map(line).join('')}${line()}</div><button type="button" class="btn sm" id="fadd">+ Dòng</button>
    <div class="row" style="margin-top:10px;gap:8px"><label class="small" style="margin:0">Ngày khai trương</label><input type="date" name="open_date" value="${esc(d.open_date || '')}" style="width:auto"><span class="small muted">tháng khai trương chỉ tính chi phí cố định theo số ngày mở cửa; trước ngày này không tính</span></div>
    <h3 style="margin-top:14px">% giá vốn ước tính (lượt chưa ghi xuất kho)</h3><div class="form-grid">
    ${groups.map((g) => `<label>${esc(g)} (%)<input name="r_${esc(g)}" type="number" min="0" max="100" step="0.5" value="${Math.round((d.rates[g] || 0) * 1000) / 10}"></label>`).join('')}</div>
    <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form>`, true);
  $('#fadd').onclick = () => $('#fxl').insertAdjacentHTML('beforeend', line());
  $('#fc').onsubmit = (e) => { e.preventDefault(); guard($('button.primary', e.target), async () => {
    const fixed = $$('.fx', e.target).map((x) => ({ name: $('[name=n]', x).value.trim(), amount: $('[name=a]', x).value.replace(/\D/g, ''), note: $('[name=t]', x).value, cash: $('[name=c]', x).checked ? 1 : 0 })).filter((f) => f.name);
    const rates = {}; for (const g of groups) rates[g] = (Number($(`[name="r_${g}"]`, e.target).value) || 0) / 100;
    await api('/finance/config', { method: 'PUT', body: { fixed, rates, open_date: e.target.open_date.value } });
    toast('Đã lưu'); closeModal(); after(); }); };
}
VIEWS.payroll = async (main) => {
  if (!isOwner()) { main.innerHTML = header('Bảng lương', '') + '<div class="card empty">Chỉ Lãnh đạo xem được bảng lương</div>'; return; }
  const month = S.params.month || S.today.slice(0, 7);
  const r = await api('/payroll?month=' + month);
  const shift = (n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const T = r.totals;
  main.innerHTML = header('💰 Bảng lương', 'Chỉ tài khoản Lãnh đạo thấy trang này. Hoa hồng, phụ thu, thẻ, tip lấy thẳng từ hóa đơn.',
    `<button class="btn" id="pxl">📥 Xuất Excel</button>${r.locked ? '<button class="btn" id="unlock">🔓 Mở chốt</button>' : '<button class="btn primary" id="lock">🔒 Chốt lương tháng</button>'}`) +
    `<div class="card"><div class="row"><button class="btn sm" id="pm">‹</button><input type="month" id="mo" value="${month}" style="width:auto"><button class="btn sm" id="nm">›</button>
      ${r.locked ? `<span class="badge ok">Đã chốt ${esc(r.locked.at)}${r.locked.by ? ' · ' + esc(r.locked.by) : ''}</span><span class="small muted">Số liệu giữ nguyên như lúc chốt, sửa hóa đơn không làm đổi.</span>` : '<span class="small muted">Chưa chốt: số tự cập nhật theo hóa đơn. Cuối tháng kiểm tra xong thì bấm Chốt.</span>'}</div></div>
    <div class="grid kpis"><div class="kpi"><div class="l">Tổng thực nhận</div><div class="v">${money(T.net)}</div><div class="s">${r.rows.length} người</div></div>
      <div class="kpi"><div class="l">Lương cứng + phụ cấp</div><div class="v">${money(T.base + T.allowance)}</div></div>
      <div class="kpi"><div class="l">Hoa hồng + thưởng</div><div class="v">${money(T.commission + T.bonus + T.kpi + T.floor_topup)}</div><div class="s">${T.floor_topup ? 'gồm bù sàn ' + money(T.floor_topup) : ''}</div></div>
      <div class="kpi"><div class="l">Quỹ lương / doanh số DV</div><div class="v">${r.service_sales ? Math.round(((T.net - T.tips) / r.service_sales) * 100) + '%' : '—'}</div><div class="s">không tính tip · DS ${money(r.service_sales)}</div></div></div>
    <div class="card"><h3>Theo nhân viên <span class="small muted">(bấm tên để xem phiếu lương, nhập công/KPI/ứng lương)</span></h3><div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th class="num">Công</th><th class="num">Lương cứng</th><th class="num">Phụ cấp</th><th class="num">Hoa hồng</th><th class="num">Thưởng DS</th><th class="num">KPI</th><th class="num">Bù sàn</th><th class="num">Tip</th><th class="num">Ứng / trừ</th><th class="num">Thực nhận</th></tr></thead>
      <tbody>${r.rows.map((x) => `<tr><td><a href="#" data-ps="${x.user_id}"><b>${esc(x.name)}</b></a>${x.has_params ? '' : ' <span class="badge warn">chưa cài lương</span>'}</td><td class="num">${x.days}/${x.std_days}</td>
        <td class="num">${money(x.base)}</td><td class="num">${money(x.allowance)}</td><td class="num">${money(x.commission)}</td><td class="num">${money(x.bonus)}</td><td class="num">${money(x.kpi)}</td>
        <td class="num">${x.floor_topup ? money(x.floor_topup) : ''}</td><td class="num">${money(x.tip_shared + x.tip_private)}</td><td class="num">${x.advance + x.minus - x.plus ? money(-(x.advance + x.minus - x.plus)) : ''}</td><td class="num"><b>${money(x.net)}</b></td></tr>`).join('') || '<tr><td colspan="11" class="empty">Chưa có nhân viên</td></tr>'}</tbody>
      <tfoot><tr><td>Tổng</td><td></td><td class="num">${money(T.base)}</td><td class="num">${money(T.allowance)}</td><td class="num">${money(T.commission)}</td><td class="num">${money(T.bonus)}</td><td class="num">${money(T.kpi)}</td><td class="num">${money(T.floor_topup)}</td><td class="num">${money(T.tips)}</td><td></td><td class="num"><b>${money(T.net)}</b></td></tr></tfoot></table></div>
      <div class="small muted" style="margin-top:8px">Hoa hồng = HH dịch vụ tự làm + HH phụ + HH bán thẻ + phần phụ thu. Thưởng DS tính trên <b>DS tính thưởng</b> (đã bỏ thẻ tri ân và người nhà). Ngày công lấy theo trang Chấm công; chưa chấm thì lấy công chuẩn trừ ngày off đã duyệt; bạn sửa tay được ở phiếu.</div></div>`;
  const go2 = (m) => go('payroll', { month: m });
  $('#pm').onclick = () => go2(shift(-1)); $('#nm').onclick = () => go2(shift(1)); $('#mo').onchange = (e) => e.target.value && go2(e.target.value);
  $('#pxl').onclick = () => guard($('#pxl'), async () => {
    const res = await api('/payroll/export?month=' + month, { raw: true });
    if (!res.ok) throw new Error('Không xuất được file');
    const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Bang-luong-${month}.xlsx`; a.click();
  });
  if ($('#lock')) $('#lock').onclick = () => guard($('#lock'), async () => { if (!confirm(`Chốt bảng lương tháng ${month}? Sau khi chốt số liệu giữ nguyên.`)) return; await api('/payroll/lock', { method: 'POST', body: { month } }); toast('Đã chốt lương'); VIEWS.payroll(main); });
  if ($('#unlock')) $('#unlock').onclick = () => guard($('#unlock'), async () => { await api('/payroll/lock', { method: 'POST', body: { month, lock: false } }); toast('Đã mở chốt'); VIEWS.payroll(main); });
  $$('[data-ps]', main).forEach((a) => (a.onclick = (e) => { e.preventDefault(); payslip(r, Number(a.dataset.ps), () => VIEWS.payroll(main)); }));
};
function payslip(r, uid, after) {
  const x = r.rows.find((y) => y.user_id === uid); if (!x) return;
  const P = x.params, I = x.input, c = x.commission_detail;
  const line = (l, v, sub) => `<div class="stat-line"><span>${l}${sub ? `<div class="small muted">${sub}</div>` : ''}</span><b>${v}</b></div>`;
  const pct = (v) => Math.round(v * 1000) / 10 + '%';
  const lk = !!r.locked;
  openModal(`Phiếu lương ${x.name} – tháng ${r.month.slice(5)}/${r.month.slice(0, 4)}`, `
    ${line('Ngày công', `${x.days}/${x.std_days}`, x.days_source)}
    ${line('(A) Lương cứng theo công', money(x.base), `${money(P.base_salary)} × ${x.days}/${x.std_days}`)}
    ${line('(B) ' + esc(P.allowance_label || 'Phụ cấp'), money(x.allowance), I.errors ? `${I.errors} lỗi × ${money(P.error_penalty)}` : '')}
    ${line('(C) HH dịch vụ tự làm', `<a href="#" id="psl">${money(c.service)}</a>`, `DS tự làm ${money(x.sales)} · ${x.main_count} lượt — bấm để xem từng hóa đơn`)}
    ${line('(D) HH làm phụ', money(c.assist), x.assist_count + ' lượt phụ')}
    ${c.card ? line('(E) HH bán thẻ', money(c.card)) : ''}
    ${c.surcharge ? line('(F) Phần phụ thu', money(c.surcharge)) : ''}
    ${line('(G) Thưởng DS theo bậc', money(x.bonus), `DS tính thưởng ${money(x.bonus_sales)}${x.bonus_pct ? ' × ' + pct(x.bonus_pct) : P.bonus_tiers.length ? ' · chưa đạt bậc' : ' · chưa cài bậc'}${x.gift_sales || x.family_sales ? ` (đã bỏ tri ân ${money(x.gift_sales)}, người nhà ${money(x.family_sales)})` : ''}`)}
    ${P.kpi_max ? line('(H) Thưởng KPI', money(x.kpi), `${money(P.kpi_max)} × ${pct(x.kpi_pct)}`) : ''}
    ${line('Tổng theo cơ chế', money(x.subtotal))}
    ${x.floor_topup ? line('Bù sàn chuyển tiếp', money(x.floor_topup), `sàn ${money(P.floor_amount)}${P.floor_until ? ' đến ' + dmy(P.floor_until) : ''}`) : ''}
    ${line('Tip chung / tip riêng', `${money(x.tip_shared)} / ${money(x.tip_private)}`, 'theo trang Chia tip')}
    ${x.plus ? line('Cộng khác', money(x.plus)) : ''}${x.minus ? line('Trừ khác', '−' + money(x.minus)) : ''}${x.advance ? line('Đã ứng', '−' + money(x.advance)) : ''}
    <div class="stat-line" style="font-size:1.15em"><span><b>THỰC NHẬN</b></span><b>${money(x.net)}</b></div>
    ${lk ? '<div class="small muted" style="margin-top:8px">Tháng đã chốt: mở chốt để sửa.</div>' : `
    <form id="pin" style="margin-top:12px"><h3>Nhập cuối tháng</h3><div class="form-grid">
      <label>Ngày công (để trống = tự lấy ${x.days_auto})<input name="days" type="number" step="0.5" min="0" max="31" value="${I.days ?? ''}"></label>
      <label>% KPI đạt (để trống = 100%)<input name="kpi" type="number" min="0" max="100" value="${I.kpi_pct != null ? Math.round(I.kpi_pct * 100) : ''}"></label>
      <label>Số lỗi lễ tân / lỗi trừ phụ cấp<input name="errors" type="number" min="0" value="${I.errors || ''}"></label>
      <label>Đã ứng lương (đ)<input name="advance" inputmode="numeric" value="${I.advance || ''}"></label>
      <label>Cộng khác (đ)<input name="plus" inputmode="numeric" value="${I.plus || ''}"></label>
      <label>Trừ khác (đ)<input name="minus" inputmode="numeric" value="${I.minus || ''}"></label>
      <label class="full">Ghi chú<input name="note" value="${esc(I.note || '')}"></label></div>
      <div class="err"></div><div class="modal-foot"><button type="button" class="btn" id="pcfg">⚙️ Cài lương ${esc(x.name)}</button><span class="spacer"></span><button class="btn primary">Lưu</button></div></form>`}`, true);
  $('#psl').onclick = (e) => { e.preventDefault(); salesLines(r.from, r.to, uid, '', () => {}); };
  if (lk) return;
  const num = (v) => Number(String(v || '').replace(/[^\d]/g, '')) || 0;
  $('#pin').onsubmit = (e) => { e.preventDefault(); const b = formData(e.target); guard(e.submitter || $("button.primary", e.target), async () => {
    await api('/payroll/inputs', { method: 'PUT', body: { month: r.month, user_id: uid, days: b.days, kpi_pct: b.kpi === '' ? '' : Number(b.kpi) / 100, errors: b.errors, advance: num(b.advance), plus: num(b.plus), minus: num(b.minus), note: b.note } });
    toast('Đã lưu'); closeModal(); after(); }); };
  $('#pcfg').onclick = () => payParams(x, after);
}
function payParams(x, after) {
  const P = x.params;
  const num = (v) => Number(String(v || '').replace(/[^\d]/g, '')) || 0;
  openModal(`⚙️ Cài lương ${x.name}`, `<form id="pp"><div class="small muted" style="margin-bottom:8px">Cài 1 lần, áp dụng các tháng chưa chốt. Hoa hồng từng dịch vụ vẫn theo tỷ lệ ở Cài đặt › Dịch vụ & giá.</div><div class="form-grid">
    <label>Lương cứng / tháng (đ)<input name="base_salary" inputmode="numeric" value="${P.base_salary || ''}"></label>
    <label>Công chuẩn (ngày)<input name="std_days" type="number" min="1" max="31" value="${P.std_days || 26}"></label>
    <label>Tên phụ cấp<input name="allowance_label" placeholder="Phụ cấp lễ tân" value="${esc(P.allowance_label || '')}"></label>
    <label>Phụ cấp / tháng (đ)<input name="allowance" inputmode="numeric" value="${P.allowance || ''}"></label>
    <label>Trừ mỗi lỗi (đ)<input name="error_penalty" inputmode="numeric" value="${P.error_penalty || ''}"></label>
    <label>Thưởng KPI tối đa (đ)<input name="kpi_max" inputmode="numeric" value="${P.kpi_max || ''}"></label>
    <label class="full">Bậc thưởng DS (mỗi dòng: mốc DS = %)<textarea name="tiers" rows="4" placeholder="40000000 = 2&#10;60000000 = 4&#10;80000000 = 6">${P.bonus_tiers.map((t) => `${t.from} = ${Math.round(t.pct * 1000) / 10}`).join('\n')}</textarea>
      <span class="small muted">Đạt mốc nào nhận % đó trên toàn bộ DS tính thưởng.</span></label>
    <label>Sàn thu nhập (đ, bỏ trống = không)<input name="floor_amount" inputmode="numeric" value="${P.floor_amount || ''}"></label>
    <label>Sàn áp dụng đến ngày<input name="floor_until" type="date" value="${P.floor_until || ''}"></label>
    <label>KPI tối thiểu để được bù sàn (%)<input name="floor_kpi_min" type="number" min="0" max="100" value="${Math.round((P.floor_kpi_min ?? 0.7) * 100)}"></label>
    <label class="full">Ghi chú cơ chế<input name="note" value="${esc(P.note || '')}"></label></div>
    <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form>`, true);
  $('#pp').onsubmit = (e) => { e.preventDefault(); const b = formData(e.target); guard(e.submitter || $("button.primary", e.target), async () => {
    const tiers = b.tiers.split('\n').map((l) => l.split(/[=:]/)).filter((p) => p.length === 2).map(([a, p]) => [num(a), Number(String(p).replace(',', '.').replace('%', '')) / 100]);
    await api('/payroll/params/' + x.user_id, { method: 'PUT', body: { base_salary: num(b.base_salary), std_days: b.std_days, allowance_label: b.allowance_label, allowance: num(b.allowance), error_penalty: num(b.error_penalty),
      kpi_max: num(b.kpi_max), bonus_tiers: tiers, floor_amount: num(b.floor_amount), floor_until: b.floor_until, floor_kpi_min: Number(b.floor_kpi_min || 70) / 100, note: b.note } });
    toast('Đã lưu cài đặt lương'); closeModal(); after(); }); };
}

VIEWS.tips = async (main) => {
  const month = S.params.month || S.today.slice(0, 7);
  const r = await api('/tips?month=' + month);
  const nm = (id) => esc((r.members.find((m) => m.id === id) || {}).name || staffName(id));
  const shift = (n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const isPast = r.pay_date <= S.today;
  main.innerHTML = header('Chia tip', `Tip cả tháng chia đều cho nhóm · ai nghỉ ngày nào không được chia tip ngày đó · trả ngày <b>${dmy(r.pay_date)}</b>`) +
    `<div class="card"><div class="row"><button class="btn sm" id="pm">‹</button><input type="month" id="mo" value="${month}" style="width:auto"><button class="btn sm" id="nm">›</button>
      <span class="small muted">Nhóm chia: ${r.members.map((m) => esc(m.name)).join(', ') || '—'}</span>${isMgr() ? '<button class="btn sm" id="pool">Sửa nhóm</button>' : ''}</div></div>
    <div class="grid kpis"><div class="kpi"><div class="l">Tip chung tháng</div><div class="v">${money(r.total_tip)}</div><div class="s">${r.days.length} ngày có tip · chia đều</div></div>
      ${r.total_private ? `<div class="kpi"><div class="l">Tip riêng</div><div class="v">${money(r.total_private)}</div><div class="s">${r.private_list.length} lượt · ai được tặng người đó nhận</div></div>` : ''}
      <div class="kpi"><div class="l">Ngày trả</div><div class="v">${dmy(r.pay_date)}</div><div class="s">${isPast ? 'đã đến hạn trả' : 'mồng 5 tháng sau'}</div></div>
      ${r.unallocated ? `<div class="kpi"><div class="l">Chưa chia được</div><div class="v">${money(r.unallocated)}</div><div class="s">ngày cả nhóm đều nghỉ</div></div>` : ''}</div>
    <div class="card"><h3>Mỗi người nhận</h3><div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th class="num">Ngày được chia</th><th class="num">Ngày nghỉ có tip</th><th class="num">Tip chung</th><th class="num">Tip riêng</th><th class="num">Tổng nhận</th><th>Trạng thái</th></tr></thead>
      <tbody>${r.shares.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.outside ? ' <span class="small muted">(ngoài nhóm)</span>' : ''}</td><td class="num">${x.outside ? '' : x.days_shared + '/' + r.days.length}</td><td class="num">${x.days_off || ''}</td>
        <td class="num">${money(x.shared)}</td><td class="num">${x.private ? money(x.private) : ''}</td><td class="num"><b>${money(x.amount)}</b></td>
        <td>${x.paid_at ? `<span class="badge ok">Đã trả ${money(x.paid_amount)}</span> <span class="small muted">${dmy(x.paid_at.slice(0, 10))}${x.paid_by_name ? ' · ' + esc(x.paid_by_name) : ''}</span>${x.paid_amount !== x.amount ? ' <span class="badge warn">số đã đổi</span>' : ''}${isMgr() ? ` <button class="btn sm" data-unpay="${x.user_id}">Hủy</button>` : ''}`
          : isMgr() ? `<button class="btn sm" data-pay="${x.user_id}" ${x.amount ? '' : 'disabled'}>Đánh dấu đã trả</button>` : '<span class="muted small">Chưa trả</span>'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Tổng</td><td></td><td></td><td class="num">${money(r.shares.reduce((a, x) => a + x.shared, 0))}</td><td class="num">${money(r.shares.reduce((a, x) => a + x.private, 0))}</td><td class="num"><b>${money(r.shares.reduce((a, x) => a + x.amount, 0))}</b></td><td></td></tr></tfoot></table></div>
      ${r.private_list.length ? `<details class="small" style="margin-top:8px"><summary>Chi tiết tip riêng (${r.private_list.length} lượt)</summary>${r.private_list.map((p) => `<div>${dmy(p.date)} · ${esc(p.code)} · ${esc(p.customer_name || '')} → <b>${nm(p.user_id)}</b> ${money(p.amount)}</div>`).join('')}</details>` : ''}
      <div class="small muted" style="margin-top:8px">Tip chung lấy từ ô “Tip chung” ở phiếu thu, chia đều. Tip riêng (khách tặng riêng 1 người) người đó nhận nguyên, không chia. Nghỉ = đơn off <b>cả ngày</b> đã duyệt ở trang Lịch off; nghỉ vài giờ vẫn được chia. Làm tròn đến đồng nên tổng có thể lệch vài đồng.</div></div>
    <div class="card"><h3>Chi tiết từng ngày</h3>${r.days.length ? `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th class="num">Tip</th><th class="num">Số người chia</th><th class="num">Mỗi người</th><th>Nghỉ (không chia)</th><th>Ghi chú</th></tr></thead>
      <tbody>${r.days.map((d) => `<tr><td>${dmy(d.date)}</td><td class="num"><details class="tipd"><summary>${money(d.tip)}</summary>${(d.list || []).map((t) => `<div class="small" style="text-align:left;white-space:nowrap">${esc(t.time || '')} <a href="#" data-tv="${t.id}">${esc(t.customer || t.code)}</a>${t.staff ? ' · ' + esc(t.staff) : ''} · <b>${money(t.tip)}</b>${t.auto_extra ? ` <span class="badge warn" title="Sổ ghi thu nhiều hơn giá dịch vụ, app tự chuyển phần dư vào tip">gồm ${money(t.auto_extra)} tiền dư tự chuyển</span>` : ''} <span class="muted">(${t.source})</span></div>`).join('')}</details></td><td class="num">${d.present.length}</td><td class="num">${money(d.share)}</td>
        <td>${d.absent.map((id) => `<span class="badge bad">${nm(id)}</span>`).join(' ')}</td>
        <td class="small">${d.partial.length ? 'Nghỉ vài giờ (vẫn chia): ' + d.partial.map(nm).join(', ') + '. ' : ''}${d.no_checkin.length ? '<span class="badge warn">Không chấm công</span> ' + d.no_checkin.map(nm).join(', ') + ' — nếu thực tế nghỉ, thêm đơn off cả ngày.' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Tháng này chưa có tip</div>'}</div>`;
  const go2 = (m) => go('tips', { month: m });
  $$('[data-tv]', main).forEach((a) => (a.onclick = async (e) => { e.preventDefault(); if (isOwner()) visitForm(await api('/visits/' + a.dataset.tv), () => VIEWS.tips(main)); else showReceipt(Number(a.dataset.tv)); }));
  $('#pm').onclick = () => go2(shift(-1)); $('#nm').onclick = () => go2(shift(1));
  $('#mo').onchange = (e) => e.target.value && go2(e.target.value);
  const pool = $('#pool');
  if (pool) pool.onclick = () => {
    openModal('Nhóm chia tip', `<form id="tp"><div class="small muted">Tip chia đều cho những người được chọn.</div>
      ${activeStaff().map((u) => `<label style="display:block;font-weight:normal"><input type="checkbox" value="${u.id}" ${r.members.some((m) => m.id === u.id) ? 'checked' : ''} style="width:auto"> ${esc(u.full_name)}</label>`).join('')}
      <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>`);
    $('#tp').onsubmit = (e) => { e.preventDefault(); guard($('#tp button'), async () => {
      await api('/tips/pool', { method: 'PUT', body: { user_ids: $$('#tp input:checked').map((x) => Number(x.value)) } }); closeModal(); toast('Đã lưu nhóm chia tip'); VIEWS.tips(main); }); };
  };
  $$('[data-pay]', main).forEach((b) => (b.onclick = () => guard(b, async () => {
    const x = r.shares.find((s) => s.user_id === Number(b.dataset.pay));
    if (!isPast && !confirm(`Chưa đến ngày trả (${dmy(r.pay_date)}). Vẫn ghi đã trả ${money(x.amount)} cho ${x.name}?`)) return;
    await api('/tips/paid', { method: 'POST', body: { month, user_id: x.user_id } }); toast('Đã ghi trả tip'); VIEWS.tips(main);
  })));
  $$('[data-unpay]', main).forEach((b) => (b.onclick = () => guard(b, async () => {
    if (!confirm('Hủy ghi nhận đã trả?')) return;
    await api('/tips/paid', { method: 'POST', body: { month, user_id: Number(b.dataset.unpay), paid: false } }); VIEWS.tips(main);
  })));
};

// Khách phụ trách theo thợ: giữ khách, khách quay lại, chi tiêu TB (dùng cho KPI/3P)
function staffCustomerCard(sc) {
  const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
  const mgr = isMgr();
  return `<div class="card"><h3>👥 Khách phụ trách theo thợ</h3>
    <div class="table-wrap"><table><thead><tr><th>Thợ</th><th class="num">Khách phụ trách</th><th class="num">Đến trong kỳ</th><th class="num">Khách mới</th><th class="num">Lượt trong kỳ</th>
      <th class="num" title="Lượt của khách mình do chính mình làm chính">Tự làm</th><th class="num" title="Khách đã đến từ 2 lần ÷ khách đã từng đến">Tỷ lệ quay lại</th>
      <th class="num" title="Lần cuối quá ${sc.return_days} ngày">Quá hạn chưa quay lại</th>${mgr ? '<th class="num">Chi tiêu TB/khách</th><th class="num">Tổng chi trong kỳ</th>' : ''}</tr></thead>
    <tbody>${sc.rows.map((x) => `<tr><td><b><a href="#customers?staff=${x.staff_id || 'none'}">${esc(x.name)}</a></b></td>
      <td class="num">${x.customers}</td><td class="num">${x.active_period}</td><td class="num">${x.new_period}</td><td class="num">${x.visits_period}</td>
      <td class="num">${x.staff_id && x.visits_period ? pct(x.own_visits_period / x.visits_period) : '—'}</td>
      <td class="num"><b>${pct(x.return_rate)}</b></td><td class="num">${x.overdue ? `<a href="#reminders?staff=${x.staff_id || 'none'}">${x.overdue}</a>` : 0}</td>
      ${mgr ? `<td class="num"><b>${money(x.avg_spend)}</b></td><td class="num">${money(x.spend_period)}</td>` : ''}</tr>`).join('') || '<tr><td colspan="10" class="empty">Chưa có khách được giao</td></tr>'}</tbody></table></div>
    <div class="small muted" style="margin-top:8px">“Khách phụ trách” tính theo hồ sơ hiện tại. Tỷ lệ quay lại = khách đã đến từ 2 lần trở lên ÷ khách đã từng đến (tính đến ngày cuối kỳ). “Tự làm” thấp nghĩa là khách của thợ này hay được thợ khác làm. Bấm số quá hạn để mở danh sách cần gọi.</div></div>`;
}

// ---------- Nhập / xuất Excel ----------
function showImport(r, sel) {
      const s = r.summary;
      $(sel).innerHTML = `<div class="totals" style="margin-top:12px"><b>${r.dry_run ? 'XEM TRƯỚC (chưa lưu)' : '✅ ĐÃ NHẬP'}</b> · ${esc(s.format)}
        <div class="stat-line"><span>Khách mới</span><b>${s.customers_created}</b></div><div class="stat-line"><span>Khách ghép với khách có sẵn</span><b>${s.customers_merged}</b></div>
        <div class="stat-line"><span>Lượt làm thêm mới</span><b>${s.visits_created}</b></div><div class="stat-line"><span>Lượt đã có (bỏ qua)</span><b>${s.visits_skipped_existing}</b></div>
        <div class="stat-line"><span>Lượt trùng khách + ngày (bỏ qua)</span><b>${s.visits_skipped_duplicate}</b></div><div class="stat-line"><span>Lịch hẹn mới</span><b>${s.appointments_created}</b></div>
        ${s.appointments_linked ? `<div class="stat-line"><span>…trong đó gắn được với khách có sẵn</span><b>${s.appointments_linked}</b></div>` : ''}
        ${s.appointments_past_skipped ? `<div class="stat-line"><span>Lịch ngày đã qua (bỏ qua)</span><b>${s.appointments_past_skipped}</b></div>` : ''}
        ${s.appointments_skipped ? `<div class="stat-line"><span>Lịch đã có (cập nhật theo màu ô)</span><b>${s.appointments_skipped}</b></div>` : ''}
        ${s.appointments_cancelled ? `<div class="stat-line"><span>🟥 Ô đỏ → khách hủy / thợ nghỉ</span><b>${s.appointments_cancelled}</b></div>` : ''}
        ${Object.entries(s.pay_colors || {}).map(([k, n]) => `<div class="stat-line"><span>${k === 'Tiền mặt' ? '🟩' : k === 'Chuyển khoản' ? '🟨' : '🩷'} ${esc(k)}</span><b>${n}</b></div>`).join('')}
        ${s.visits_paid_set ? `<div class="stat-line"><span>Lượt làm được ghi hình thức thanh toán</span><b>${s.visits_paid_set}</b></div>` : ''}
        ${s.visits_assistant_set ? `<div class="stat-line"><span>Lượt làm được ghi người phụ (tên trong ngoặc)</span><b>${s.visits_assistant_set}</b></div>` : ''}
        ${s.cards_created || s.cards_skipped_existing ? `<div class="stat-line"><span>Thẻ voucher mới / đã có</span><b>${s.cards_created} / ${s.cards_skipped_existing}</b></div>` : ''}
        ${s.book ? `<div class="stat-line"><span><b>Tiền theo sổ đặt lịch</b> (${s.book.days} ngày từ 01/11)</span><b>${money(s.book.total)}</b></div>
          <div class="stat-line"><span>Lượt làm tạo mới / cập nhật</span><b>${s.book.visits} / ${s.book.updated}</b></div>
          ${s.book.replaced_nk ? `<div class="stat-line"><span>Lượt nhập từ Nhật ký được thay bằng số liệu sổ</span><b>${s.book.replaced_nk}</b></div>` : ''}
          ${s.book.locked ? `<div class="stat-line"><span>🔒 Lượt đã có trong máy (khóa, không nhập lại / không đổi tiền)</span><b>${s.book.locked}</b></div>` : ''}
          ${s.visits_deduped ? `<div class="stat-line"><span>🧹 Lượt làm bị nhập 2 lần trước đây → đã xóa bản trùng</span><b>${s.visits_deduped}</b></div>` : ''}
          ${s.gifts_closed ? `<div class="stat-line"><span>🎁 Thẻ tri ân đã dùng 1 lần → đã đóng (bỏ phần dư)</span><b>${s.gifts_closed}</b></div>` : ''}
          ${s.visits_merged ? `<div class="stat-line"><span>🔗 Gộp lượt: 1 khách làm nhiều dịch vụ cùng lúc / trùng lượt ghi tay</span><b>${s.visits_merged}</b></div>` : ''}
          ${s.book.relinked ? `<div class="stat-line"><span>Ô sổ bị sửa chữ, nhận ra lượt cũ (không tạo trùng)</span><b>${s.book.relinked}</b></div>` : ''}
          ${s.book.customer_fixed ? `<div class="stat-line"><span>Lượt chuyển về đúng khách</span><b>${s.book.customer_fixed}</b></div>` : ''}
          ${s.book.kept_manual ? `<div class="stat-line"><span>Ô đã có lượt nhân viên tự ghi (giữ nguyên)</span><b>${s.book.kept_manual}</b></div>` : ''}
          <div class="stat-line"><span>Tip chung (cột Tiền Tip + khách trả dư ${money(s.book.extra_tip)})</span><b>${money(s.book.tip)}</b></div>
          ${s.book.unpaid ? `<div class="stat-line"><span>🩷 Đã làm chưa thanh toán (giá theo bảng giá)</span><b>${money(s.book.unpaid)}</b></div>` : ''}
          ${(s.book.gifts_added || []).length ? `<details class="small" open><summary>🎁 Bổ sung ${s.book.gifts_added.length} thẻ tri ân (ô ghi tặng/có vc, chưa có trong tab Quản lý Thẻ 1Tr)</summary>${s.book.gifts_added.map((x) => `<div>${esc(x)}</div>`).join("")}</details>` : ""}
          ${(s.book.debts_paid || []).length ? `<details class="small" open><summary>💵 ${s.book.debts_paid.length} khách trả nợ lượt ngày trước (ghi "tt dd/mm") → đã ghi đã thu, không cộng doanh số lần nữa</summary>${s.book.debts_paid.map((x) => `<div>${esc(x)}</div>`).join("")}</details>` : ""}
          ${s.book.rows_check.length ? `<details class="small"><summary>⚠ ${s.book.rows_check.length} dòng tiền thu khác giá ghi trong ô (thẻ/voucher, sản phẩm…) — nên kiểm tra</summary>${s.book.rows_check.map((x) => `<div>${esc(x)}</div>`).join('')}</details>` : ''}
          ${s.book.no_money.length ? `<details class="small"><summary>${s.book.no_money.length} ô không có tiền thu → chưa tạo lượt làm</summary>${s.book.no_money.map((x) => `<div>${esc(x)}</div>`).join('')}</details>` : ''}` : ''}
        ${s.expenses ? `<div class="stat-line"><span>💸 Khoản chi đưa vào quỹ tiền mặt (${s.expenses.days} ngày)</span><b>${s.expenses.created} · ${money(s.expenses.amount)}</b></div>
          <div class="stat-line"><span>…ngày trước đã thanh toán → ghi hoàn quỹ</span><b>${money(s.expenses.settled)}</b></div>` : ''}
        ${s.visits_updated ? `<div class="stat-line"><span>Lượt cũ được bổ sung công thức hóa chất</span><b>${s.visits_updated}</b></div>` : ''}
        <div class="stat-line"><span>Dịch vụ mới</span><b>${s.services_added}</b></div>
        ${s.purchases_created != null ? `<div class="stat-line"><span>Hóa chất / sản phẩm mới trong kho</span><b>${s.materials_created}</b></div>
          <div class="stat-line"><span>Dòng nhập hàng mới / cập nhật</span><b>${s.purchases_created} / ${s.purchases_updated}</b></div>
          <div class="stat-line"><span class="muted">Vật tư vận hành (Loại 2) không đưa vào kho</span><b>${s.purchases_skipped_ops}</b></div>` : ''}
        ${s.staff_created.length ? `<div class="small">Nhân viên lạ được tạo (không đăng nhập được): ${s.staff_created.map(esc).join(', ')}</div>` : ''}
        ${s.matched_by_name.length ? `<details class="small"><summary>${s.matched_by_name.length} khách ghép theo TÊN — nên kiểm tra</summary>${s.matched_by_name.map(esc).join(', ')}</details>` : ''}
        ${s.warnings.map((w) => `<div class="small" style="color:var(--warn)">⚠ ${esc(w)}</div>`).join('')}</div>`;
}
VIEWS.excel = async (main) => {
  const gs = await api('/gsync').catch(() => null);
  main.innerHTML = header('Nhập / Xuất Excel') + (gs ? `<div class="card" id="gsCard"><h3>🔄 Đồng bộ sổ đặt lịch từ Google Sheet</h3>
      <div class="small muted">Dán link Google Sheet "Đặt lịch – Ghi sổ tiền" một lần. Sheet cần chia sẻ <b>"Bất kỳ ai có đường liên kết – Người xem"</b>.
      Máy chủ tự lấy số liệu mỗi ${gs.every_min} phút (lịch hẹn, tiền từ 01/11, tip, khoản chi quỹ, thẻ tri ân) — không cần tải file về.</div>
      <label>Link Google Sheet</label><input id="gsUrl" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(gs.url)}">
      <label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" id="gsAuto" ${gs.auto ? 'checked' : ''}> Tự đồng bộ mỗi ${gs.every_min} phút</label>
      <div class="small" style="margin-top:6px">${gs.last_at ? `Lần đồng bộ gần nhất: <b>${esc(gs.last_at)}</b>${gs.last ? ` · ${gs.last.days} ngày · ${money(gs.last.total)} · tip ${money(gs.last.tip)} · ${gs.last.expenses} khoản chi${gs.last.check ? ` · ⚠ ${gs.last.check} dòng cần kiểm tra` : ''}` : ''}` : '<span class="muted">Chưa đồng bộ lần nào</span>'}
        ${gs.last_error ? `<div style="color:var(--warn)">⚠ Lần trước lỗi: ${esc(gs.last_error)}</div>` : ''}</div>
      <div class="err"></div><div class="row" style="margin-top:12px"><button class="btn" id="gsSave">Lưu link</button><button class="btn" id="gsPrev">Xem trước</button><button class="btn primary" id="gsRun">🔄 Đồng bộ ngay</button></div>
      <div id="gsRes"></div></div>` : '') + `<div class="grid two">
    <div class="card"><h3>📥 Nhập từ Excel</h3>
      <div class="small muted">Nhận các mẫu: <b>Salon Nếp – Nhật ký</b> (khách, nhật ký dịch vụ, danh mục), <b>CRM Nếp Hair</b> (CRM Khách, lịch hẹn đã đặt), <b>Sổ đặt lịch</b> (tab Tháng 10, Tháng 11… + Quản lý Thẻ 1Tr) , <b>sổ nhập mỹ phẩm/hóa chất</b> (file theo dõi chi phí, tab "Nhập mỹ phẩm" → vào Kho) và file <b>xuất từ phần mềm này</b>.
      Khách trùng được ghép theo mã cũ → SĐT → tên. Nhập lại cùng file không bị nhân đôi.</div>
      <form id="imp"><label>File .xlsx</label><input type="file" name="file" accept=".xlsx" required>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="include_history"> Nhập cả lịch sử cũ (lượt "Hoàn thành" ở tab Lịch sử của CRM Nếp Hair / lịch các ngày đã qua trong Sổ đặt lịch)</label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="book_money" checked> Sổ đặt lịch: lấy <b>số tiền từ 01/11</b> theo cột Thu tiền / Tiền Tip → tạo lượt làm, thay các lượt nhập từ Nhật ký cùng ngày (lượt nhân viên tự ghi trong app giữ nguyên). Khách trả dư → tip chung.</label>
      ${isOwner() ? `<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="update_past"> 🔓 Cập nhật lại cả lượt đã có trong máy theo sổ (ghi đè tiền/dịch vụ). Bình thường để TẮT: lượt đã nhập bị khóa, đồng bộ không làm doanh số nhảy.</label>` : ''}
      <div class="small muted">Không nên tick nếu đã nhập file Nhật ký: 2 file ghi cùng các lượt 25/10–6/11 → doanh số bị cộng 2 lần (đã có chặn trùng theo khách + ngày).</div>
      <div class="err"></div><div class="row" style="margin-top:12px"><button class="btn" data-mode="1">Xem trước</button><button class="btn primary" data-mode="0">Nhập vào hệ thống</button></div></form>
      <div id="impRes"></div></div>
    <div class="card"><h3>📤 Xuất ra Excel</h3><div class="small muted">Gồm các tab: Khách hàng, Lượt làm, Lịch hẹn, Thẻ trả trước, Dịch vụ.</div>
      <label>Lượt làm từ ngày</label><input type="date" id="ef" value="${S.today.slice(0, 8)}01"><label>đến ngày</label><input type="date" id="et" value="${S.today}">
      <div class="row" style="margin-top:12px"><button class="btn primary" id="exp">Tải file Excel</button><button class="btn" id="expAll">Xuất toàn bộ</button></div></div></div>`;
  $$('#imp [data-mode]').forEach((b) => (b.onclick = (e) => {
    e.preventDefault();
    const f = $('#imp');
    if (!f.file.files.length) { $('#imp .err').textContent = 'Chọn file Excel'; return; }
    guard(b, async () => {
      const fd = new FormData();
      fd.append('file', f.file.files[0]); fd.append('dry_run', b.dataset.mode); fd.append('include_history', f.include_history.checked ? '1' : '0'); fd.append('book_money', f.book_money.checked ? '1' : '0'); if (f.update_past && f.update_past.checked) fd.append('update_past', '1');
      if (b.dataset.mode === '0' && !confirm('Nhập dữ liệu vào hệ thống?')) return;
      const r = await api('/import', { method: 'POST', body: fd });
      showImport(r, '#impRes');
      if (!r.dry_run) { S.services = await api('/services'); S.staff = await api('/staff'); S.materials = await api('/materials'); refreshReminderBadge(); }
    });
  }));
  if (gs) {
    const saveGs = () => api('/gsync', { method: 'PUT', body: { url: $('#gsUrl').value, auto: $('#gsAuto').checked } });
    $('#gsSave').onclick = () => guard($('#gsSave'), async () => { await saveGs(); toast('Đã lưu link'); });
    $('#gsAuto').onchange = () => saveGs().catch((e) => toast(e.message));
    $('#gsPrev').onclick = () => guard($('#gsPrev'), async () => { await saveGs(); showImport(await api('/gsync/run', { method: 'POST', body: { dry_run: true } }), '#gsRes'); });
    $('#gsRun').onclick = () => guard($('#gsRun'), async () => {
      await saveGs();
      showImport(await api('/gsync/run', { method: 'POST', body: { dry_run: false } }), '#gsRes');
      S.services = await api('/services'); S.staff = await api('/staff'); refreshReminderBadge(); toast('Đã đồng bộ từ Google Sheet');
    });
  }
  const dl = async (from, to) => {
    const res = await api(`/export?from=${from}&to=${to}`, { raw: true });
    if (!res.ok) return toast('Không xuất được file');
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `CRM-Salon-Nep-${S.today}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#exp').onclick = () => dl($('#ef').value, $('#et').value);
  $('#expAll').onclick = () => dl('2000-01-01', S.today);
};

// ---------- Cài đặt ----------
VIEWS.settings = async (main) => {
  const tabs = [['me', 'Tài khoản của tôi', true], ['services', 'Dịch vụ & giá', isMgr()], ['cardtypes', 'Gói thẻ', isMgr()], ['users', 'Nhân viên & mật khẩu', isOwner()],
    ['params', 'Tham số', isOwner()], ['audit', 'Lịch sử chỉnh sửa', isOwner()], ['backup', 'Sao lưu', isMgr()]].filter((t) => t[2]);
  const tab = S.params.tab || tabs[0][0];
  main.innerHTML = header('Cài đặt') + `<div class="card"><div class="tabs">${tabs.map(([k, l]) => `<button data-st="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div><div id="sb"></div></div>`;
  $$('[data-st]').forEach((b) => (b.onclick = () => go('settings', { tab: b.dataset.st })));
  const sb = $('#sb');
  const reload = () => VIEWS.settings(main);
  if (tab === 'me') {
    sb.innerHTML = `<div class="stat-line"><span class="muted">Họ tên</span><b>${esc(S.me.full_name)}</b></div><div class="stat-line"><span class="muted">Tên đăng nhập</span><b>${esc(S.me.username)}</b></div>
      <div class="stat-line"><span class="muted">Vai trò</span><b>${ROLE[S.me.role]}</b></div><div class="row" style="margin-top:12px"><button class="btn" id="cp">Đổi mật khẩu</button><button class="btn" id="lo">Đăng xuất</button></div>`;
    $('#cp').onclick = () => renderChangePw(false); $('#lo').onclick = logout;
  }
  if (tab === 'services') {
    S.services = await api('/services');
    sb.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="small muted">% hoa hồng = phần thợ chính được hưởng trên doanh số dịch vụ. Mặc định lấy từ file Excel — chốt lại cho đúng chính sách.</span><span class="spacer"></span><button class="btn primary sm" id="ns">+ Dịch vụ</button></div>
      <div class="table-wrap"><table><thead><tr><th>Dịch vụ</th><th>Nhóm</th><th class="num">Giá niêm yết</th><th class="num">% HH</th><th></th></tr></thead><tbody>
      ${S.services.map((s) => `<tr style="${s.active ? '' : 'opacity:.5'}"><td>${esc(s.name)}</td><td>${esc(s.grp)}</td><td class="num">${money(s.price)}</td><td class="num">${pct(s.commission_rate)}</td><td><button class="btn sm" data-es="${s.id}">Sửa</button></td></tr>`).join('')}</tbody></table></div>`;
    const form = (s = {}) => {
      openModal(s.id ? 'Sửa dịch vụ' : 'Dịch vụ mới', `<form id="sv"><label>Tên</label><input name="name" value="${esc(s.name || '')}" required>
        <label>Nhóm doanh số</label><select name="grp">${S.groups.map((g) => `<option ${s.grp === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
        <label>Giá niêm yết</label><input type="number" name="price" min="0" step="1000" value="${s.price ?? ''}">
        <label>% hoa hồng thợ chính</label><input type="number" name="rate" min="0" max="100" step="0.5" value="${s.commission_rate != null ? Math.round(s.commission_rate * 1000) / 10 : ''}">
        <label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="active" ${s.active !== 0 ? 'checked' : ''}> Đang dùng</label>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>`);
      $('#sv').onsubmit = (e) => { e.preventDefault(); guard($('#sv button'), async () => {
        const d = formData($('#sv')); d.commission_rate = Number(d.rate || 0) / 100;
        await api(s.id ? '/services/' + s.id : '/services', { method: s.id ? 'PUT' : 'POST', body: d }); closeModal(); reload();
      }); };
    };
    $('#ns').onclick = () => form();
    $$('[data-es]', sb).forEach((b) => (b.onclick = () => form(S.services.find((s) => s.id === Number(b.dataset.es)))));
  }
  if (tab === 'cardtypes') {
    S.cardTypes = await api('/card-types');
    sb.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="spacer"></span><button class="btn primary sm" id="nt">+ Gói thẻ</button></div><div class="table-wrap"><table><thead><tr><th>Gói</th><th class="num">Giá bán</th><th class="num">Giá trị dùng</th><th class="num">Tặng thêm</th><th class="num">Hạn (tháng)</th><th></th></tr></thead><tbody>
      ${S.cardTypes.map((t) => `<tr style="${t.active ? '' : 'opacity:.5'}"><td>${esc(t.name)}</td><td class="num">${money(t.price)}</td><td class="num">${money(t.value)}</td><td class="num">${pct((t.value - t.price) / t.price)}</td><td class="num">${t.months}</td><td><button class="btn sm" data-et="${t.id}">Sửa</button></td></tr>`).join('')}</tbody></table></div>`;
    const form = (t = {}) => {
      openModal(t.id ? 'Sửa gói thẻ' : 'Gói thẻ mới', `<form id="ct"><label>Tên gói</label><input name="name" value="${esc(t.name || '')}" required>
        <label>Giá bán</label><input type="number" name="price" value="${t.price || ''}" required><label>Giá trị dùng</label><input type="number" name="value" value="${t.value || ''}" required>
        <label>Hạn dùng (tháng)</label><input type="number" name="months" value="${t.months || 12}" required>
        <label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="active" ${t.active !== 0 ? 'checked' : ''}> Đang bán</label>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>`);
      $('#ct').onsubmit = (e) => { e.preventDefault(); guard($('#ct button'), async () => { await api(t.id ? '/card-types/' + t.id : '/card-types', { method: t.id ? 'PUT' : 'POST', body: formData($('#ct')) }); closeModal(); reload(); }); };
    };
    $('#nt').onclick = () => form();
    $$('[data-et]', sb).forEach((b) => (b.onclick = () => form(S.cardTypes.find((t) => t.id === Number(b.dataset.et)))));
  }
  if (tab === 'users') {
    const users = await api('/users');
    sb.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="small muted">Mỗi người 1 tài khoản riêng. Nhân viên nghỉ việc: bỏ tick "Đang làm" để khóa ngay.</span><span class="spacer"></span><button class="btn primary sm" id="nu">+ Tài khoản</button></div>
      <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Đăng nhập</th><th>Vai trò</th><th>Cấp</th><th>Trạng thái</th><th>Hoa hồng</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr style="${u.active ? '' : 'opacity:.5'}"><td><b>${esc(u.full_name)}</b>${u.aliases ? `<div class="small muted">tên khác: ${esc(u.aliases)}</div>` : ''}</td><td>${u.can_login ? esc(u.username) : '<span class="muted">không đăng nhập</span>'}</td><td>${ROLE[u.role]}</td><td>${esc(u.level || '')}</td>
      <td>${u.active ? (u.must_change_pw && u.can_login ? '<span class="badge warn">chưa đổi MK</span>' : '<span class="badge ok">đang làm</span>') : '<span class="badge">đã khóa</span>'}</td><td>${u.commission_enabled ? 'Có' : 'Không'}</td>
      <td class="row"><button class="btn sm" data-eu="${u.id}">Sửa</button>${u.can_login ? `<button class="btn sm" data-pw="${u.id}">Đặt lại MK</button>` : ''}${u.role !== 'owner' ? `<button class="btn sm" data-mu="${u.id}" title="Chuyển hết dữ liệu sang tài khoản khác rồi xóa tài khoản này">⇢ Chuyển & xóa</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    const form = (u = {}) => {
      openModal(u.id ? 'Sửa tài khoản' : 'Tài khoản mới', `<form id="uf"><label>Họ tên (hiển thị)</label><input name="full_name" value="${esc(u.full_name || '')}" required>
        ${u.id ? '' : '<label>Tên đăng nhập (không dấu)</label><input name="username" autocapitalize="none" required><label>Mật khẩu tạm (≥6 ký tự)</label><input name="password" required minlength="6" autocapitalize="none" autocorrect="off" spellcheck="false">'}
        <label>Vai trò</label><select name="role">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>Cấp thợ (theo bảng giá cắt)</label><select name="level"><option value="">— Không áp dụng —</option>${LEVELS.map((l) => `<option ${u.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>Tên khác trong sổ Excel (cách nhau dấu phẩy)</label><input name="aliases" value="${esc(u.aliases || '')}">
        <label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="active" ${u.active !== 0 ? 'checked' : ''}> Đang làm (bỏ tick = khóa tài khoản)</label>
        <label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="can_login" ${u.can_login !== 0 ? 'checked' : ''}> Được đăng nhập</label>
        <label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="commission_enabled" ${u.commission_enabled !== 0 ? 'checked' : ''}> Tính hoa hồng</label>
        <label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="works" ${u.works !== 0 ? 'checked' : ''}> Làm dịch vụ (bỏ tick = ẩn khỏi danh sách thợ, lịch, báo cáo)</label>
        <div class="small muted">Lãnh đạo: toàn quyền. Quản lý: xem doanh số toàn tiệm, nhập/xuất Excel, sửa/xóa lượt, giá dịch vụ. Nhân viên: lịch hẹn, khách, ghi lượt trong ngày, chỉ xem doanh số của mình, không xuất dữ liệu.</div>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>`);
      $('#uf').onsubmit = (e) => { e.preventDefault(); guard($('#uf button'), async () => { await api(u.id ? '/users/' + u.id : '/users', { method: u.id ? 'PUT' : 'POST', body: formData($('#uf')) }); closeModal(); S.staff = await api('/staff'); reload(); }); };
    };
    $('#nu').onclick = () => form();
    $$('[data-eu]', sb).forEach((b) => (b.onclick = () => form(users.find((u) => u.id === Number(b.dataset.eu)))));
    $$('[data-mu]', sb).forEach((b) => (b.onclick = () => {
      const u = users.find((x) => x.id === Number(b.dataset.mu));
      openModal('Chuyển dữ liệu & xóa tài khoản', `<form id="muf"><p>Chuyển <b>toàn bộ</b> dữ liệu của <b>${esc(u.full_name)}</b> (${esc(u.username)}): lượt làm, doanh số, hoa hồng, lịch hẹn, khách phụ trách, thẻ đã bán, chấm công, lương, tip, chat… sang:</p>
        <select name="to" required><option value="">— Chọn tài khoản nhận —</option>${users.filter((x) => x.id !== u.id).map((x) => `<option value="${x.id}">${esc(x.full_name)} (${esc(x.username)})</option>`).join('')}</select>
        <div class="small muted" style="margin-top:8px">Tài khoản nhận sẽ mang tên <b>${esc(u.full_name)}</b>, giữ tên đăng nhập + mật khẩu của nó. Tài khoản <b>${esc(u.username)}</b> bị xóa, không đăng nhập được nữa.</div>
        <label style="display:flex;gap:8px;color:var(--text);margin-top:10px"><input type="checkbox" name="ok" required> Tôi đã kiểm tra, chuyển và xóa</label>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Chuyển & xóa</button></div></form>`);
      $('#muf').onsubmit = (e) => { e.preventDefault(); guard($('#muf button'), async () => {
        const r = await api(`/users/${u.id}/merge`, { method: 'POST', body: { to: formData($('#muf')).to } });
        const n = Object.values(r.moved || {}).reduce((a, x) => a + x, 0);
        toast(`Đã chuyển ${n} mục sang ${r.username} và xóa tài khoản cũ`); closeModal(); S.staff = await api('/staff'); reload();
      }); };
    }));
    $$('[data-pw]', sb).forEach((b) => (b.onclick = () => {
      const u = users.find((x) => x.id === Number(b.dataset.pw));
      const sug = String(Math.floor(100000 + Math.random() * 900000));
      openModal('Đặt lại mật khẩu – ' + esc(u.full_name), `<form id="rpf"><div class="small muted">Tên đăng nhập: <b style="font-size:16px;color:var(--text)">${esc(u.username)}</b></div>
        <label>Mật khẩu tạm (≥6 ký tự, nên dùng toàn số)</label><input name="password" value="${sug}" required minlength="6" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" inputmode="numeric" style="font-size:18px;letter-spacing:2px">
        <div class="small muted">Sau khi lưu, tài khoản được mở khóa. Lần đầu vào, ${esc(u.full_name)} gõ mật khẩu tạm này ở ô "Mật khẩu hiện tại" rồi đặt mật khẩu riêng.</div>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu mật khẩu</button></div></form>`);
      $('#rpf').onsubmit = (e) => { e.preventDefault(); guard($('#rpf button'), async () => {
        const pw = String(formData($('#rpf')).password || '').trim();
        await api(`/users/${u.id}/reset-password`, { method: 'POST', body: { password: pw } });
        openModal('Đã đặt lại mật khẩu', `<p>Gửi cho ${esc(u.full_name)}:</p><div class="card" style="font-size:17px">Tên đăng nhập: <b>${esc(u.username)}</b><br>Mật khẩu tạm: <b>${esc(pw)}</b></div><div class="modal-foot"><button class="btn primary" id="rpok">Xong</button></div>`);
        $('#rpok').onclick = () => { closeModal(); reload(); };
      }); };
    }));
  }
  if (tab === 'params') {
    const s = await api('/settings');
    const F = [['salon_name', 'Tên salon', 'text'], ['salon_address', 'Địa chỉ (in trên hóa đơn)', 'text'], ['salon_phone', 'Số điện thoại salon', 'text'],
      ['bank_info', 'Thông tin chuyển khoản (in trên hóa đơn)', 'text'], ['receipt_footer', 'Lời cảm ơn cuối hóa đơn', 'text'], ['return_days', 'Nhắc khách quay lại sau (ngày)', 'number'], ['birthday_days', 'Nhắc sinh nhật trước (ngày)', 'number'],
      ['card_expiry_days', 'Nhắc thẻ sắp hết hạn trước (ngày)', 'number'], ['card_low_balance', 'Nhắc khi số dư thẻ ≤ (đồng)', 'number'],
      ['assistant_rate', 'Hoa hồng người phụ (tỷ lệ, 0.03 = 3%)', 'number'], ['card_new_rate', 'HH bán thẻ mới (0.05 = 5%)', 'number'],
      ['card_renewal_rate', 'HH khách mua lại thẻ (0.03 = 3%)', 'number'], ['surcharge_salon_rate', 'Phụ thu: phần cửa hàng giữ (0.33 = 33%, còn lại chia thợ)', 'number'], ['book_money_until', 'Từ ngày này sổ đặt lịch chỉ lấy lịch hẹn, tiền tính trên app (để trống = vẫn lấy tiền từ sổ)', 'date'], ['qr_bank', 'QR chuyển khoản: mã ngân hàng (VD VCB, TCB, MB, ACB)', 'text'], ['qr_account', 'QR chuyển khoản: số tài khoản', 'text'], ['qr_name', 'QR chuyển khoản: tên chủ tài khoản (không dấu)', 'text'], ['payment_methods', 'Hình thức thanh toán (cách nhau dấu phẩy)', 'text']];
    sb.innerHTML = `<form id="pf"><div class="form-grid">${F.map(([k, l, t]) => `<div><label>${l}</label><input name="${k}" type="${t}" step="any" value="${esc(s[k])}"></div>`).join('')}</div>
      <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu tham số</button></div></form>`;
    $('#pf').onsubmit = (e) => { e.preventDefault(); guard($('#pf button'), async () => { await api('/settings', { method: 'PUT', body: formData($('#pf')) }); toast('Đã lưu'); boot(); }); };
    const ci = await api('/chat/days');
    sb.insertAdjacentHTML('beforeend', `<div class="card" style="margin-top:14px"><b>🤖 AI tóm tắt chat</b> · <span class="badge ${ci.ai ? 'ok' : ''}">${ci.ai ? 'Đã có khóa' : 'Chưa có khóa'}</span>
      <div class="small muted" style="margin:6px 0">Lấy khóa ở console.anthropic.com (API Keys), nạp ít tiền vào tài khoản. Khóa chỉ lưu trên máy chủ của tiệm, không hiện lại ra ngoài. Khi tóm tắt, số điện thoại được che trước khi gửi đi.</div>
      <form id="aif" class="row"><input name="key" type="password" autocomplete="off" placeholder="${ci.ai ? 'Dán khóa mới để thay' : 'sk-ant-…'}" style="flex:1;min-width:200px"><button class="btn primary">Lưu khóa</button>${ci.ai ? '<button type="button" class="btn" id="aiDel">Xóa khóa</button>' : ''}</form></div>`);
    $('#aif').onsubmit = (e) => { e.preventDefault(); guard($('#aif .primary'), async () => { await api('/chat/ai-key', { method: 'PUT', body: { key: $('#aif').key.value } }); toast('Đã lưu khóa AI'); reload(); }); };
    if ($('#aiDel')) $('#aiDel').onclick = () => { if (confirm('Xóa khóa AI? Nút tóm tắt sẽ ngừng hoạt động.')) guard($('#aiDel'), async () => { await api('/chat/ai-key', { method: 'PUT', body: { key: '' } }); reload(); }); };
  }
  if (tab === 'audit') {
    const P = S.params;
    const from = P.from || addDays(S.today, -30), to = P.to || S.today, uid = P.u || '', only = P.only ?? 'edit';
    const rows = await api(`/audit?limit=1000&from=${from}&to=${to}${uid ? '&user_id=' + uid : ''}${only ? '&only=edit' : ''}`);
    const A = { login: 'Đăng nhập', create_visit: 'Ghi lượt', update_visit: 'SỬA lượt', delete_visit: 'XÓA lượt', create_customer: 'Thêm khách', update_customer: 'Sửa khách', delete_customer: 'XÓA khách',
      sell_card: 'Bán thẻ', update_card: 'Sửa thẻ', adjust_card: 'Điều chỉnh số dư thẻ', import_excel: 'Nhập Excel', export_excel: 'Xuất Excel', backup_pc: 'Tải sao lưu về máy', upload_photo: 'Tải ảnh', delete_photo: 'Xóa ảnh',
      create_appointment: 'Đặt lịch', update_appointment: 'Sửa lịch hẹn', appointment_status: 'Đổi trạng thái lịch', change_password: 'Đổi mật khẩu', reset_password: 'Đặt lại MK',
      create_user: 'Tạo tài khoản', update_user: 'Sửa tài khoản', update_settings: 'Sửa tham số', create_service: 'Thêm dịch vụ', update_service: 'Sửa dịch vụ', backup: 'Sao lưu', download_backup: 'Tải bản sao lưu',
      create_off: 'Xin/ghi nghỉ', decide_off: 'Duyệt nghỉ', delete_off: 'Xóa đơn nghỉ', manual_attendance: 'Chấm công tay', delete_attendance: 'Xóa chấm công',
      stock_in: 'Nhập kho', stock_adjust: 'Điều chỉnh kho', stock_count: 'Kiểm kho', stock_ordered: 'Báo đã gọi hàng', stock_barcode: 'Gắn mã vạch', stock_unordered: 'Bỏ báo gọi hàng', stock_perm: 'Phân quyền kho',
      transfer_customers: 'Bàn giao khách', update_visit_notes: 'Sửa ghi chú lượt', tip_paid: 'Ghi trả tip', expense_create: 'Ghi khoản chi', petty_in: 'Nạp quỹ', expense_approved: 'Duyệt chi', expense_rejected: 'KHÔNG duyệt chi', expense_pending: 'Đưa chi về chờ duyệt', expense_delete: 'XÓA khoản chi', expense_refunded: 'Hoàn quỹ', petty_target: 'Đổi mức quỹ', chat_to_appointment: 'Tạo lịch từ chat', chat_auto: 'Bật/tắt tự tạo lịch', price_list: 'Áp bảng giá mới', appointment_pay: 'Ghi đã thu (khách nợ)', set_ai_key: 'Đổi khóa AI', chat_summary: 'AI tóm tắt chat', delete_chat: 'Xóa tin chat', set_tip_pool: 'Sửa nhóm chia tip', create_card_type: 'Thêm gói thẻ', update_card_type: 'Sửa gói thẻ' };
    const hot = ['update_visit', 'delete_visit', 'adjust_card', 'delete_customer', 'export_excel', 'update_card', 'stock_adjust', 'delete_attendance', 'expense_delete', 'expense_rejected'];
    const LB = { date: 'Ngày', time: 'Giờ', customer_id: 'Khách', main_staff_id: 'Thợ chính', assistant_id: 'Người phụ', staff_id: 'Thợ', surcharge: 'Phụ thu', discount: 'Giảm giá', discount_reason: 'Lý do giảm',
      total: 'Tổng tiền', card_paid: 'Trừ thẻ', cash_paid: 'Tiền thu', payment_method: 'Hình thức TT', tip: 'Tip', formula: 'Công thức', result: 'Kết quả', note: 'Ghi chú', services: 'Dịch vụ', name: 'Tên', phone: 'SĐT',
      gender: 'Giới tính', birthday: 'Sinh nhật', source: 'Nguồn', hair_notes: 'Lưu ý tóc', notes: 'Ghi chú', status: 'Trạng thái', service: 'Dịch vụ', duration: 'Thời lượng (phút)', guest_name: 'Tên khách',
      guest_phone: 'SĐT khách', amount: 'Số tiền', reason: 'Lý do', qty: 'Số lượng', expires_at: 'Hạn thẻ', price: 'Giá', value: 'Giá trị', role: 'Quyền', active: 'Đang làm', count: 'Số khách', to: 'Sang thợ', month: 'Tháng', seller_id: 'Người chốt bán', tip_private: 'Tip riêng', tip_private_to: 'Người nhận tip riêng', consultant_id: 'Người tư vấn', seller_share: '% người chốt', commission: 'HH người chốt', consultant_commission: 'HH người tư vấn' };
    const MONEY = ['surcharge', 'discount', 'total', 'card_paid', 'cash_paid', 'tip', 'amount', 'price', 'value', 'unit_cost', 'commission', 'consultant_commission', 'tip_private'];
    const STAFFK = ['main_staff_id', 'assistant_id', 'staff_id', 'to', 'user_id', 'seller_id', 'consultant_id', 'tip_private_to'];
    const fv = (k, v) => v == null || v === '' ? '<span class="muted">(trống)</span>' : MONEY.includes(k) ? money(v) : STAFFK.includes(k) ? esc(staffName(v) || '#' + v)
      : k === 'status' && APPT[v] ? APPT[v][0] : k === 'status' && EXP_ST[v] ? EXP_ST[v][0] : esc(typeof v === 'object' ? JSON.stringify(v) : String(v));
    const detail = (r) => {
      let d; try { d = r.detail ? JSON.parse(r.detail) : null; } catch { return esc(r.detail); }
      if (!d) return '';
      const ch = d.changes || (Object.values(d).length && Object.values(d).every((x) => Array.isArray(x) && x.length === 2) ? d : null);
      if (ch) {
        const ks = Object.keys(ch);
        return ks.length ? ks.map((k) => `<div><b>${esc(LB[k] || k)}:</b> <span class="aud-old">${fv(k, ch[k][0])}</span> → <span class="aud-new">${fv(k, ch[k][1])}</span></div>`).join('') : '<span class="muted">Lưu lại, không đổi gì</span>';
      }
      if (d.before && d.after) return Object.keys(d.after).map((k) => `<div><b>${esc(LB[k] || k)}:</b> ${fv(k, d.before[k])} → ${fv(k, d.after[k])}</div>`).join('');
      return Object.entries(d).filter(([k]) => k !== 'code').map(([k, v]) => `<span style="margin-right:10px"><b>${esc(LB[k] || k)}:</b> ${fv(k, v)}</span>`).join('');
    };
    const link = (r) => r.entity === 'visit' ? `#visits` : r.entity === 'customer' ? `#customer?id=${r.entity_id}` : r.entity === 'appointment' ? '#appointments' : r.entity === 'card' ? '#cards' : '';
    sb.innerHTML = `<div class="row" style="margin-bottom:10px"><select id="au" style="width:auto"><option value="">Mọi người</option>${S.staff.map((u) => `<option value="${u.id}" ${String(u.id) === uid ? 'selected' : ''}>${esc(u.full_name)}</option>`).join('')}</select>
      <input type="date" id="af" value="${from}" style="width:auto"> → <input type="date" id="at" value="${to}" style="width:auto">
      <label class="small" style="font-weight:normal"><input type="checkbox" id="ao" ${only ? 'checked' : ''} style="width:auto"> Chỉ sửa / xóa / điều chỉnh</label></div>
      <div class="small muted" style="margin-bottom:8px">Mỗi lần sửa ghi rõ <b>ô nào đổi, giá trị cũ → mới</b>. Thao tác nhạy cảm (sửa/xóa lượt thu tiền, chỉnh thẻ, chỉnh kho, xuất dữ liệu) tô đỏ. ${rows.length} dòng.</div>
      <div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người</th><th>Thao tác</th><th>Đối tượng</th><th>Nội dung thay đổi</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="small" style="white-space:nowrap">${esc(r.created_at.slice(11, 16))} ${dmy(r.created_at.slice(0, 10))}</td><td><b>${esc(r.user_name || '')}</b></td>
        <td>${hot.includes(r.action) ? `<span class="badge bad">${esc(A[r.action] || r.action)}</span>` : esc(A[r.action] || r.action)}</td>
        <td class="small">${r.entity_label ? (link(r) ? `<a href="${link(r)}">${esc(r.entity_label)}</a>` : esc(r.entity_label)) : r.entity_id ? '#' + r.entity_id : ''}</td>
        <td class="small" style="max-width:520px;word-break:break-word">${detail(r)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Không có thao tác nào</td></tr>'}</tbody></table></div>`;
    const setA = () => go('settings', { tab: 'audit', u: $('#au').value, from: $('#af').value, to: $('#at').value, only: $('#ao').checked ? 'edit' : '' });
    ['#au', '#af', '#at', '#ao'].forEach((k) => ($(k).onchange = setA));
  }
  if (tab === 'backup') {
    const st = await api('/backup-pc');
    const files = isOwner() ? await api('/backups') : [];
    sb.innerHTML = `<div class="card" style="margin:0 0 14px">${backupBox(st)}</div>` + (!isOwner() ? '' : `<h3>Bản sao lưu trên máy chủ (chỉ Lãnh đạo)</h3><div class="small muted">Hệ thống tự sao lưu dữ liệu mỗi 6 giờ, giữ 30 bản gần nhất. Nên tải 1 bản về máy/Google Drive mỗi tuần. Ảnh khách lưu ở thư mục <code>data/photos</code> trên máy chủ.</div>
      <div class="row" style="margin:12px 0"><button class="btn primary" id="bk">Sao lưu ngay</button></div>
      <table><tbody>${files.map((f) => `<tr><td>${esc(f.file)}</td><td class="num">${(f.size / 1024).toFixed(0)} KB</td><td><a class="btn sm" href="/api/backups/${encodeURIComponent(f.file)}">Tải về</a></td></tr>`).join('') || '<tr><td class="empty">Chưa có</td></tr>'}</tbody></table>`);
    bindBackupBox(sb, reload);
    if ($('#bk')) $('#bk').onclick = (e) => guard(e.target, async () => { await api('/backups', { method: 'POST' }); toast('Đã sao lưu'); reload(); });
  }
};

// ---------- Lịch off nhân viên ----------
const OFF_ST = { pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'ok'], rejected: ['Từ chối', 'bad'] };
VIEWS.offs = async (main) => {
  const from = S.params.from || addDays(S.today, -7);
  const to = addDays(from, 45);
  const rows = await api(`/offs?from=${from}&to=${to}`);
  const pend = rows.filter((o) => o.status === 'pending');
  const byDate = {};
  for (const o of rows) (byDate[o.date] = byDate[o.date] || []).push(o);
  main.innerHTML = header('Lịch off', isMgr() ? 'Nhân viên xin nghỉ → quản lý duyệt. Ngày nghỉ hiện trên lịch hẹn và cảnh báo khi đặt khách.' : 'Xin nghỉ → chờ quản lý duyệt', `<button class="btn primary" id="newOff">+ ${isMgr() ? 'Thêm lịch nghỉ' : 'Xin nghỉ'}</button>`) +
    (isMgr() && pend.length ? `<div class="card"><h3>⏳ Chờ duyệt (${pend.length})</h3>${pend.map(offLine).join('')}</div>` : '') +
    `<div class="card"><div class="row"><button class="btn sm" id="pv">‹ Trước</button><span class="small muted">${dmy(from)} → ${dmy(to)}</span><button class="btn sm" id="nx">Sau ›</button></div>
    ${Object.keys(byDate).sort().map((d) => `<div class="off-day ${d === S.today ? 'today' : ''}"><b>${wday(d)} ${dmy(d)}</b>${byDate[d].map(offLine).join('')}</div>`).join('') || '<div class="empty">Chưa có lịch nghỉ</div>'}</div>`;
  const reload = () => VIEWS.offs(main);
  $('#pv').onclick = () => go('offs', { from: addDays(from, -30) }); $('#nx').onclick = () => go('offs', { from: addDays(from, 30) });
  $('#newOff').onclick = () => offForm(reload);
  $$('[data-od]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/offs/${b.dataset.id}/decide`, { method: 'POST', body: { status: b.dataset.od } }); reload(); })));
  $$('[data-odel]', main).forEach((b) => (b.onclick = () => { if (confirm('Xóa lịch nghỉ này?')) guard(b, async () => { await api('/offs/' + b.dataset.odel, { method: 'DELETE' }); reload(); }); }));
};
function offLine(o) {
  const canDel = isMgr() || (o.user_id === S.me.id && o.status === 'pending');
  return `<div class="list-item"><div style="flex:1"><b>${esc(o.staff_name)}</b> · ${o.from_time ? `${esc(o.from_time)}–${esc(o.to_time)}` : 'Cả ngày'} <span class="badge ${OFF_ST[o.status][1]}">${OFF_ST[o.status][0]}</span>
    ${o.reason ? `<div class="small">${esc(o.reason)}</div>` : ''}${o.decided_by_name && o.status !== 'pending' ? `<div class="small muted">duyệt: ${esc(o.decided_by_name)}</div>` : ''}</div>
    <div class="row">${isMgr() && o.status === 'pending' ? `<button class="btn sm primary" data-od="approved" data-id="${o.id}">Duyệt</button><button class="btn sm" data-od="rejected" data-id="${o.id}">Từ chối</button>` : ''}
    ${canDel ? `<button class="btn sm" data-odel="${o.id}">Xóa</button>` : ''}</div></div>`;
}
function offForm(after) {
  openModal(isMgr() ? 'Thêm lịch nghỉ' : 'Xin nghỉ', `<form id="of"><div class="form-grid">
    ${isMgr() ? `<div class="full"><label>Nhân viên</label><select name="user_id">${staffOptions(S.me.id, '')}</select></div>` : ''}
    <div><label>Từ ngày</label><input type="date" name="date" value="${addDays(S.today, 1)}" required></div>
    <div><label>Đến ngày (nghỉ nhiều ngày)</label><input type="date" name="date_to"></div>
    <div class="full"><label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="part"> Chỉ nghỉ vài giờ</label></div>
    <div class="parttime hidden"><label>Từ giờ</label><input type="time" name="from_time" value="13:00" step="900"></div>
    <div class="parttime hidden"><label>Đến giờ</label><input type="time" name="to_time" value="17:00" step="900"></div>
    <div class="full"><label>Lý do</label><input name="reason" placeholder="VD: việc gia đình, khám bệnh…"></div></div>
    <div class="err"></div><div class="modal-foot"><button class="btn primary">${isMgr() ? 'Lưu' : 'Gửi xin nghỉ'}</button></div></form>`);
  const f = $('#of');
  f.part.onchange = () => $$('.parttime', f).forEach((x) => x.classList.toggle('hidden', !f.part.checked));
  f.onsubmit = (e) => {
    e.preventDefault();
    guard($('#of button.primary'), async () => {
      const d = formData(f);
      const end = d.date_to && d.date_to > d.date ? d.date_to : d.date;
      let n = 0, clash = 0;
      for (let x = d.date; x <= end && n < 31; x = addDays(x, 1), n++) {
        const r = await api('/offs', { method: 'POST', body: { user_id: d.user_id, date: x, reason: d.reason, from_time: d.part ? d.from_time : '', to_time: d.part ? d.to_time : '' } });
        clash += r.appointments_that_day;
      }
      closeModal(); toast(`Đã ${isMgr() ? 'lưu' : 'gửi'} ${n} ngày nghỉ${clash ? ` — ⚠ có ${clash} lịch khách trong những ngày này, nhớ chuyển thợ` : ''}`); after();
    });
  };
}

// ---------- Chấm công ----------
function getPos() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}
const mins2h = (m) => `${Math.floor(m / 60)}g${String(m % 60).padStart(2, '0')}`;
VIEWS.attendance = async (main) => {
  const t = S.today;
  const from = S.params.from || t.slice(0, 8) + '01', to = S.params.to || t;
  const uid = S.params.u || '';
  const [me, rep] = await Promise.all([api('/attendance/me'), api(`/attendance/report?from=${from}&to=${to}${uid ? '&user_id=' + uid : ''}`)]);
  const lastKind = me.records.length ? me.records[me.records.length - 1].kind : null;
  const M = { gps: '📍 GPS', wifi: '📶 Wifi', manual: '✍ Chấm hộ' };
  main.innerHTML = header('Chấm công', `Giờ vào ca: ${esc(rep.work_start || '09:00')} · trễ quá ${rep.late_grace} phút tính đi muộn`) +
    `<div class="card"><h3>Hôm nay ${dmy(me.today)}</h3>
      ${!me.configured ? `<div class="small" style="color:var(--warn)">⚠ Chưa cài vị trí / wifi tiệm. ${S.me.role === 'owner' ? 'Kéo xuống mục Cài đặt chấm công.' : 'Nhờ Lãnh đạo cài.'}</div>` : ''}
      <div class="row" style="gap:12px;margin:10px 0"><button class="btn primary big-btn" id="cin" ${lastKind === 'in' ? 'disabled' : ''}>🟢 Vào ca</button><button class="btn big-btn" id="cout" ${lastKind !== 'in' ? 'disabled' : ''}>🔴 Ra ca</button></div>
      <div class="small muted">${me.on_shop_wifi ? '📶 Bạn đang dùng wifi tiệm' : me.has_gps ? `📍 Sẽ kiểm tra định vị (trong bán kính ${me.radius}m quanh tiệm)` : ''}</div>
      ${me.records.map((r) => `<div class="stat-line"><span>${r.kind === 'in' ? 'Vào' : 'Ra'} · ${M[r.method] || r.method}${r.distance != null ? ' · cách ' + r.distance + 'm' : ''}</span><b>${esc(r.time)}</b></div>`).join('')}</div>
    <div class="card"><div class="row"><input type="date" id="f" value="${from}" style="width:auto"> → <input type="date" id="tt" value="${to}" style="width:auto">
      ${isMgr() ? `<select id="u" style="width:auto">${staffOptions(Number(uid), 'Tất cả')}</select><button class="btn sm" id="man">+ Chấm công hộ</button>` : ''}</div>
      <h3 style="margin-top:12px">Tổng hợp</h3><div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th class="num">Ngày công</th><th class="num">Tổng giờ</th><th class="num">Đi muộn</th><th class="num">Quên chấm ra</th><th class="num">Nghỉ (ngày)</th></tr></thead>
      <tbody>${rep.summary.map((p) => `<tr><td>${esc(p.staff_name)}</td><td class="num">${p.days}</td><td class="num">${mins2h(p.minutes)}</td><td class="num">${p.late_days ? `${p.late_days} lần · ${p.late_minutes}′` : '0'}</td><td class="num">${p.missing_out || 0}</td><td class="num">${p.off_days || 0}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Chưa có dữ liệu</td></tr>'}</tbody></table></div>
      <h3 style="margin-top:12px">Chi tiết từng ngày</h3><div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Nhân viên</th><th>Vào</th><th>Ra</th><th class="num">Giờ làm</th><th></th></tr></thead>
      <tbody>${rep.days.map((d) => `<tr><td>${wday(d.date)} ${dmy(d.date).slice(0, 5)}</td><td>${esc(d.staff_name)}</td>
        <td>${esc(d.in || '—')} <span class="small muted">${d.in_method ? M[d.in_method] : ''}</span>${d.late_minutes ? ` <span class="badge bad">muộn ${d.late_minutes}′</span>` : ''}</td>
        <td>${esc(d.out || '—')}${d.missing_out ? ' <span class="badge warn">quên chấm ra</span>' : ''}</td><td class="num">${d.minutes ? mins2h(d.minutes) : ''}</td>
        <td>${isMgr() ? d.records.map((r) => `<button class="btn sm" data-adel="${r.id}" title="Xóa lần chấm ${r.kind === 'in' ? 'vào' : 'ra'} ${r.time}">✕ ${r.time}</button>`).join('') : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">—</td></tr>'}</tbody></table></div></div>
    ${S.me.role === 'owner' ? '<div class="card" id="attSetup"></div>' : ''}`;
  const reload = () => VIEWS.attendance(main);
  const punch = (kind, btn) => guard(btn, async () => {
    btn.textContent = 'Đang lấy vị trí…';
    const pos = me.on_shop_wifi ? null : await getPos();
    if (!me.on_shop_wifi && !pos && !me.configured) throw new Error('Chưa cài vị trí tiệm');
    try {
      const r = await api('/attendance', { method: 'POST', body: { kind, ...(pos || {}) } });
      toast(`Đã chấm ${kind === 'in' ? 'VÀO' : 'RA'} lúc ${r.time} (${r.method === 'wifi' ? 'wifi tiệm' : 'GPS, cách ' + r.distance + 'm'})`);
    } catch (e) {
      if (!pos && !me.on_shop_wifi) throw new Error('Không lấy được vị trí: bấm "Cho phép" khi trình duyệt hỏi vị trí (Cài đặt › Safari/Chrome › Vị trí), hoặc kết nối wifi tiệm.');
      throw e;
    }
    reload();
  });
  $('#cin').onclick = (e) => punch('in', e.currentTarget);
  $('#cout').onclick = (e) => punch('out', e.currentTarget);
  const setR = (p) => go('attendance', { from, to, ...(uid ? { u: uid } : {}), ...p });
  $('#f').onchange = (e) => setR({ from: e.target.value }); $('#tt').onchange = (e) => setR({ to: e.target.value });
  if (isMgr()) {
    $('#u').onchange = (e) => setR({ u: e.target.value });
    $('#man').onclick = () => {
      openModal('Chấm công hộ', `<form id="mf"><div class="form-grid"><div class="full"><label>Nhân viên</label><select name="user_id">${staffOptions(Number(uid) || null)}</select></div>
        <div><label>Ngày</label><input type="date" name="date" value="${S.today}"></div><div><label>Giờ</label><input type="time" name="time" value="09:00"></div>
        <div><label>Loại</label><select name="kind"><option value="in">Vào ca</option><option value="out">Ra ca</option></select></div>
        <div class="full"><label>Lý do (bắt buộc)</label><input name="note" placeholder="VD: quên chấm, điện thoại hết pin"></div></div><div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>`);
      $('#mf').onsubmit = (e) => { e.preventDefault(); guard($('#mf button.primary'), async () => { await api('/attendance/manual', { method: 'POST', body: formData($('#mf')) }); closeModal(); reload(); }); };
    };
    $$('[data-adel]', main).forEach((b) => (b.onclick = () => { if (confirm('Xóa lần chấm công này?')) guard(b, async () => { await api('/attendance/' + b.dataset.adel, { method: 'DELETE' }); reload(); }); }));
  }
  if (S.me.role === 'owner') attSetup($('#attSetup'), reload);
};
async function attSetup(box, reload) {
  const c = await api('/attendance/setup');
  box.innerHTML = `<h3>⚙️ Cài đặt chấm công (Lãnh đạo)</h3>
    <div class="small muted">Làm 1 lần khi đang đứng ở tiệm. Nhân viên chấm được khi <b>định vị trong bán kính</b> quanh tiệm${c.shop_ips ? ' HOẶC <b>đang dùng wifi tiệm</b>' : ' (chỉ dùng GPS — chưa lưu wifi tiệm)'}.</div>
    <div class="stat-line"><span>📍 Vị trí tiệm</span><b>${c.shop_lat ? `${Number(c.shop_lat).toFixed(5)}, ${Number(c.shop_lng).toFixed(5)}` : 'chưa có'}</b></div>
    <div class="stat-line"><span>📶 IP wifi tiệm</span><b>${esc(c.shop_ips || 'chưa có')}</b></div>
    <div class="stat-line"><span class="muted">Mạng bạn đang dùng</span><span>${esc(c.your_ip)}</span></div>
    <div class="row" style="margin:8px 0"><button class="btn sm" id="sgps">📍 Lấy vị trí hiện tại làm vị trí tiệm</button><button class="btn sm" id="swifi">📶 Mạng đang dùng là wifi tiệm</button>${c.shop_ips ? '<button class="btn sm" id="cwifi">Xóa wifi đã lưu</button>' : ''}</div>
    <form id="asf"><div class="form-grid"><div class="full small muted">Hoặc nhập toạ độ tiệm (Google Maps: giữ ngón tay lên vị trí tiệm → copy 2 số, VD 21.02850, 105.85420):</div>
    <div class="full"><label>Toạ độ tiệm</label><input name="coords" placeholder="21.02850, 105.85420" value="${c.shop_lat ? `${c.shop_lat}, ${c.shop_lng}` : ''}"></div>
    <div><label>Bán kính cho phép (m)</label><input type="number" name="shop_radius" value="${esc(c.shop_radius)}" min="30" step="10"></div>
    <div><label>Giờ vào ca</label><input type="time" name="work_start" value="${esc(c.work_start)}"></div><div><label>Cho phép trễ (phút)</label><input type="number" name="late_grace" value="${esc(c.late_grace)}" min="0"></div></div>
    <div class="modal-foot"><button class="btn primary">Lưu</button></div></form>
    <div class="small muted">Lưu ý: wifi gia đình/tiệm thường đổi IP khi modem khởi động lại → nếu nhân viên báo không chấm được bằng wifi, bấm lại "Mạng đang dùng là wifi tiệm". Định vị trong nhà có thể lệch 20–100m.</div>`;
  const save = (body) => api('/attendance/setup', { method: 'POST', body }).then(() => { toast('Đã lưu'); reload(); }).catch((e) => toast(e.message));
  $('#sgps').onclick = async () => { const p = await getPos(); if (!p) return toast('Không lấy được vị trí — cho phép trình duyệt dùng vị trí'); if (p.accuracy > 100 && !confirm(`Vị trí đang lệch khoảng ${p.accuracy}m. Vẫn lưu?`)) return; save({ use: 'gps', ...p }); };
  $('#swifi').onclick = () => { if (confirm('Bạn đang kết nối WIFI CỦA TIỆM (không phải 4G)?')) save({ use: 'wifi' }); };
  if ($('#cwifi')) $('#cwifi').onclick = () => save({ use: 'clear_wifi' });
  $('#asf').onsubmit = (e) => {
    e.preventDefault();
    const d = formData($('#asf'));
    const m = String(d.coords || '').match(/(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);
    if (d.coords && !m) return toast('Toạ độ chưa đúng dạng: 21.02850, 105.85420');
    save({ ...d, ...(m && (Number(m[1]) !== Number(c.shop_lat) || Number(m[2]) !== Number(c.shop_lng)) ? { use: 'gps', lat: Number(m[1]), lng: Number(m[2]) } : {}) });
  };
}

VIEWS.more = async (main) => {
  main.innerHTML = header('Thêm') + `<div class="card nav-groups more-nav">${NAV_GROUPS.map((g) => { const ps = PAGES.filter((p) => p[3]() && p[4] === g && !MOBILE.includes(p[0])); return ps.length ? `<div class="nav-grp-h static">${g}</div>${ps.map((p) => `<button class="nav-btn" data-goto="${p[0]}"><span>${p[2]}</span>${p[1]}</button>`).join('')}` : ''; }).join('')}
    <button class="nav-btn" id="mpw"><span>🔑</span>Đổi mật khẩu</button><button class="nav-btn" id="mlo"><span>🚪</span>Đăng xuất (${esc(S.me.full_name)})</button></div>`;
  $$('[data-goto]', main).forEach((b) => (b.onclick = () => go(b.dataset.goto)));
  $('#mpw').onclick = () => renderChangePw(false); $('#mlo').onclick = logout;
};

window.closeModal = closeModal;
boot();
