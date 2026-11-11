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
function activeStaff() { return S.staff.filter((s) => s.active); }
function staffOptions(sel, withEmpty = '— Chọn —') {
  return (withEmpty ? `<option value="">${withEmpty}</option>` : '') + activeStaff().map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.full_name)}</option>`).join('');
}
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
  if (!res.ok) { const e = new Error((data && data.error) || 'Lỗi ' + res.status); e.status = res.status; e.data = data; throw e; }
  return data;
}
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
const PAGES = [
  ['dashboard', 'Tổng quan', '🏠', () => true],
  ['appointments', 'Lịch hẹn', '📅', () => true],
  ['chat', 'Chat nội bộ', '💬', () => true],
  ['customers', 'Khách hàng', '👤', () => true],
  ['visits', 'Lượt làm', '✂️', () => true],
  ['reminders', 'Nhắc nhở', '🔔', () => true],
  ['cards', 'Thẻ trả trước', '💳', () => true],
  ['sales', 'Doanh số', '📊', () => true],
  ['tips', 'Chia tip', '💵', () => true],
  ['attendance', 'Chấm công', '🕘', () => true],
  ['offs', 'Lịch off', '🌴', () => true],
  ['stock', 'Kho hàng', '🧪', () => isMgr() || S.me.stock_view],
  ['excel', 'Nhập / Xuất Excel', '📥', isMgr],
  ['settings', 'Cài đặt', '⚙️', () => true],
];
const MOBILE = ['dashboard', 'appointments', 'chat', 'customers', 'visits', 'more'];
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
      ${pages.map((p) => `<button class="nav-btn" data-page="${p[0]}"><span>${p[2]}</span>${p[1]}${p[0] === 'reminders' ? '<span class="badge count hidden" data-rc></span>' : ''}${p[0] === 'chat' ? '<span class="badge count hidden" data-cc></span>' : ''}</button>`).join('')}
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
  $$('[data-search]').forEach((b) => (b.onclick = searchBox));
  $('#pwBtn').onclick = () => renderChangePw(false);
  $('#outBtn').onclick = logout;
  refreshReminderBadge();
  startChatPoll();
}
// ---------- Chat nội bộ ----------
let chatTimer = null;
async function refreshChatBadge() {
  try { const r = await api('/chat/unread'); $$('[data-cc]').forEach((b) => { b.textContent = r.unread; b.classList.toggle('hidden', !r.unread || S.page === 'chat'); }); } catch { /* bỏ qua */ }
}
function startChatPoll() {
  clearInterval(chatTimer);
  refreshChatBadge();
  chatTimer = setInterval(() => { if (document.hidden || !S.me) return; if (S.page === 'chat' && S.chatPull) S.chatPull(); else refreshChatBadge(); }, 15000);
}
function chatDraftCard(m) {
  if (m.appointment_id) return `<div class="chat-card ok">✅ Đã tạo lịch <a href="#appointments?date=${m.appt_date}">${dmy(m.appt_date)} ${esc(m.appt_time || '')}</a>${m.linked_by_name ? ' · ' + esc(m.linked_by_name) : ''}${m.appt_status && m.appt_status !== 'booked' ? ` · ${APPT[m.appt_status] ? APPT[m.appt_status][0] : ''}` : ''}</div>`;
  const d = m.draft; if (!d) return '';
  const f = (l, v, warn) => `<span class="cf ${v ? '' : 'miss'}">${l}: <b>${v || 'chưa rõ'}</b>${warn ? ` <span class="badge warn">${warn}</span>` : ''}</span>`;
  return `<div class="chat-card"><div class="small"><b>📅 Tạo lịch hẹn từ tin này?</b></div><div class="cf-wrap">
    ${f('Khách', d.name ? esc(d.name) + (d.customer_id ? ' <span class="badge ok">khách cũ</span>' : ' <span class="badge">khách mới</span>') : '')}
    ${d.phone ? f('SĐT', esc(d.phone)) : ''}${f('Ngày', d.date ? dmy(d.date) : '', d.date_guess ? 'đoán hôm nay' : '')}${f('Giờ', esc(d.time || ''))}
    ${f('Dịch vụ', esc(d.service || ''))}${f('Thợ', d.staff_id ? esc(staffName(d.staff_id)) : '', d.staff_from_profile ? 'thợ phụ trách' : '')}</div>
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
  const kpis = isMgr() ? `
    <div class="kpi"><div class="l">Doanh số hôm nay</div><div class="v">${money(d.today_report.summary.service_sales)}</div><div class="s">${d.today_report.summary.visits} lượt</div></div>
    <div class="kpi"><div class="l">Tiền vào hôm nay</div><div class="v">${money(d.today_report.summary.money_in)}</div><div class="s">dịch vụ + bán thẻ, không gồm tip</div></div>
    <div class="kpi"><div class="l">Doanh số tháng này</div><div class="v">${money(d.month_report.summary.service_sales)}</div><div class="s">${d.month_report.summary.visits} lượt</div></div>
    <div class="kpi"><div class="l">Khách hàng</div><div class="v">${d.customers}</div><div class="s">trong hệ thống</div></div>`
    : `<div class="kpi"><div class="l">Doanh số của bạn hôm nay</div><div class="v">${money(mine ? mine.sales : 0)}</div><div class="s">${mine ? mine.main_count : 0} lượt làm chính</div></div>
    <div class="kpi"><div class="l">Doanh số tháng của bạn</div><div class="v">${money(mineMonth ? mineMonth.sales : 0)}</div></div>
    <div class="kpi"><div class="l">Hoa hồng tháng (tạm tính)</div><div class="v">${money(mineMonth ? mineMonth.total_commission : 0)}</div></div>`;
  const rc = d.reminder_counts;
  main.innerHTML = header(`Chào ${S.me.full_name}`, `Hôm nay ${dmy(d.today)}`,
    `<button class="btn" data-goto2="attendance">🕘 Chấm công</button><button class="btn" id="qAppt">+ Lịch hẹn</button><button class="btn primary" id="qVisit">+ Ghi lượt làm</button>`) +
    `<div class="grid kpis">${kpis}</div>
    <div class="grid two">
      <div class="card"><h3>Lịch hẹn hôm nay (${d.appointments.length})</h3>${apptList(d.appointments)}</div>
      <div class="card"><h3>Việc cần làm</h3>
        ${[['birthdays', '🎂 Sinh nhật sắp tới'], ['cards', '💳 Thẻ sắp hết hạn / hết tiền'], ['returns', '🔁 Khách đến hạn quay lại'], ['appointments', '📞 Gọi xác nhận lịch ngày mai'], ['cancels', '❌ Khách hủy / không đến – mời đặt lại']]
          .map(([k, l]) => `<div class="stat-line"><a href="#reminders">${l}</a><b>${rc[k]}</b></div>`).join('')}
      </div></div>`;
  $('#qAppt').onclick = () => apptForm({ date: d.today });
  $$('[data-goto2]', main).forEach((b) => (b.onclick = () => go(b.dataset.goto2)));
  $('#qVisit').onclick = () => visitForm({});
  bindApptList(main, () => VIEWS.dashboard(main));
};
function apptList(rows, showDate) {
  if (!rows.length) return '<div class="empty">Không có lịch hẹn</div>';
  return rows.map((a) => `<div class="list-item"><div class="time-pill">${esc(a.time)}${showDate ? `<div class="small muted">${dmy(a.date).slice(0, 5)}</div>` : ''}</div>
    <div style="flex:1;min-width:0"><div class="t">${a.customer_id ? `<a href="#customer?id=${a.customer_id}">${esc(a.name)}</a>` : esc(a.name) + ' <span class="badge">khách mới</span>'}</div>
      <div class="small muted">${a.visit_services ? esc(a.visit_services) : svcWithPrice(a.service)}${a.staff_name ? ' · ' + esc(a.staff_name) : ''} · ${telLinks(a.phone)}</div>
      ${a.visit_id && a.visit_total != null ? `<div class="small"><b style="color:var(--ok)">✓ Đã thu ${money(a.visit_total)}</b> · <a href="#" data-rcpt="${a.visit_id}">Hóa đơn</a></div>`
        : a.service && estTotal(a.service) && !['cancelled', 'noshow'].includes(a.status) ? `<div class="small">Dự kiến: <b>${money(estTotal(a.service))}</b></div>` : ''}
      ${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}
      ${a.cancel_reason && ['cancelled', 'noshow'].includes(a.status) ? `<div class="small" style="color:var(--bad)">Lý do: ${esc(a.cancel_reason)}</div>` : ''}</div>
    <div style="text-align:right"><span class="badge ${APPT[a.status][1]}">${APPT[a.status][0]}</span>
      <div class="row" style="justify-content:flex-end;margin-top:6px">
      ${a.status === 'booked' ? `<button class="btn sm" data-ast="arrived" data-id="${a.id}">Đã đến</button>` : ''}
      ${['booked', 'arrived'].includes(a.status) ? `<button class="btn sm primary" data-avisit="${a.id}">Thu tiền</button><button class="btn sm" data-aedit="${a.id}">Sửa</button><button class="btn sm" data-acancel="${a.id}">Hủy / không đến</button>` : ''}
      </div></div></div>`).join('');
}
// Thu tiền từ lịch hẹn: mở phiếu có sẵn dịch vụ + giá → lưu là vào doanh số. Khách vãng lai tự tạo hồ sơ.
async function checkout(a, after) {
  let c = { id: a.customer_id, code: a.customer_code || '', name: a.name };
  if (!a.customer_id) {
    c = await api(`/appointments/${a.id}/customer`, { method: 'POST' });
    toast(c.created ? `Đã tạo hồ sơ khách ${c.code} – ${c.name}` : `Nhận khách cũ ${c.code} – ${c.name} (trùng SĐT)`);
  }
  visitForm({ customer_id: c.id, customer: c, main_staff_id: a.staff_id, appointment_id: a.id, service: a.service, date: a.date, time: a.time }, after);
}
function bindApptList(root, reload, rows) {
  $$('[data-ast]', root).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/appointments/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.ast } }); reload(); })));
  const find = async (id) => (rows || (await api(`/appointments?from=${S.today}&to=${addDays(S.today, 60)}`))).find((a) => a.id === Number(id));
  $$('[data-avisit]', root).forEach((b) => (b.onclick = async () => {
    guard(b, async () => checkout(await find(b.dataset.avisit), reload));
  }));
  $$('[data-rcpt]', root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); showReceipt(Number(b.dataset.rcpt)); }));
  $$('[data-aedit]', root).forEach((b) => (b.onclick = async () => apptForm(await find(b.dataset.aedit), reload)));
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
    ${v.tip ? line('Tip cho thợ', money(v.tip)) : ''}
    ${r.card_balance != null ? line(`Số dư thẻ còn lại`, money(r.card_balance), true) : ''}
    ${s.bank_info && paid ? `<hr><div class="rc-c small">${esc(s.bank_info)}</div>` : ''}
    <hr><div class="rc-c">${esc(s.footer || 'Cảm ơn quý khách!')}</div></div>`;
  const text = [`${s.name} – HÓA ĐƠN ${v.code}`, `Ngày: ${dmy(v.date)} ${v.time || ''}`, `Khách: ${v.customer_name}`, '',
    ...v.items.map((i) => `• ${i.name}: ${money(i.price)}`),
    v.surcharge ? `• Phụ thu: ${money(v.surcharge)}` : '', v.discount ? `• Giảm giá: −${money(v.discount)}` : '',
    `Tổng dịch vụ: ${money(v.total)}`, v.card_paid ? `Trừ thẻ: −${money(v.card_paid)}` : '', `Thanh toán: ${money(paid)}${v.payment_method && paid ? ' (' + v.payment_method + ')' : ''}`,
    r.card_balance != null ? `Số dư thẻ còn lại: ${money(r.card_balance)}` : '', '', s.footer || ''].filter((x, i, arr) => x !== '' || (arr[i - 1] !== '' && i > 0)).join('\n');
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
    main.innerHTML = top + (sc ? daySum(rows, sc.visits) : '') + body;
    bindApptList(main, reload, rows);
  } else {
    const sc = await api('/schedule?date=' + date);
    main.innerHTML = top + daySum(sc.appointments, sc.visits) + `<div class="card grid-card">${scheduleGrid(sc)}</div>
      <div class="small muted" style="margin:0 4px 12px">Bấm ô trống để đặt lịch · bấm lịch để Thu tiền / Sửa / Hủy. <span class="chip-k brand">Đã đặt</span> <span class="chip-k warn">Đã đến</span> <span class="chip-k ok">Đã làm</span> <span class="chip-k off">Nghỉ</span></div>`;
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
function daySum(appts, visits) {
  const est = appts.filter((a) => ['booked', 'arrived'].includes(a.status) && !a.visit_id).reduce((t, a) => t + estTotal(a.service), 0);
  const got = appts.reduce((t, a) => t + (a.visit_id ? Number(a.visit_total || 0) : 0), 0) + visits.reduce((t, v) => t + Number(v.total || 0), 0);
  const n = appts.filter((a) => a.visit_id).length + visits.length;
  return `<div class="card daysum"><div><span class="muted small">Đã thu (${n} lượt)</span><b>${money(got)}</b></div><div><span class="muted small">Còn dự kiến (lịch chưa thu)</span><b>${money(est)}</b></div>
    <div><span class="muted small">Cả ngày nếu thu đủ</span><b>${money(got + est)}</b></div></div>`;
}
function scheduleGrid(sc) {
  const live = (a) => !['cancelled', 'noshow'].includes(a.status);
  const ids = new Set(activeStaff().filter((u) => u.role !== 'owner').map((u) => u.id));
  for (const a of sc.appointments) if (a.staff_id) ids.add(a.staff_id);
  for (const v of sc.visits) if (v.main_staff_id) ids.add(v.main_staff_id);
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
      const off = c.id && offOf(c.id, t);
      const inner = ap.map((a) => `<div class="ev ${a.status}" data-ap="${a.id}"><b>${esc(a.time)}</b> ${esc(a.name)}${a.visit_services || a.service ? `<div class="small">${a.visit_services ? esc(a.visit_services) : svcWithPrice(a.service)}</div>` : ''}${evMoney(a)}</div>`).join('')
        + vs.map((v) => `<div class="ev done" data-vv="${v.customer_id}"><b>✓ ${esc(v.time || '')}</b> ${esc(v.customer_name)}<div class="small">${esc(v.services || '')}</div>${v.total != null ? `<div class="small"><b>${money(v.total)}</b></div>` : ''}</div>`).join('');
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
    <div><label>SĐT khách mới</label><input name="guest_phone" inputmode="tel" value="${esc(a.customer_id ? '' : a.guest_phone || a.phone || '')}"></div>
    <div><label>Ngày</label><input type="date" name="date" value="${a.date || S.today}" required></div>
    <div><label>Giờ</label><input type="time" name="time" value="${a.time || '09:00'}" step="900" required></div>
    <div><label>Thợ</label><select name="staff_id">${staffOptions(a.staff_id, 'Chưa chọn')}</select></div>
    <div><label>Thời lượng (phút)</label><input type="number" name="duration" value="${a.duration || 60}" min="15" step="15"></div>
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
  let msgs = await api('/chat');
  main.innerHTML = header('Chat nội bộ', 'Gõ “chị Lan 0912… mai 9h nhuộm với Dương” → bấm ✓ là có lịch hẹn') +
    `<div class="card chat-box"><div id="chatList" class="chat-list"></div>
    <form id="chatF" class="chat-input"><textarea name="body" rows="1" placeholder="Nhập tin nhắn…" maxlength="2000"></textarea><button class="btn primary">Gửi</button></form>
    <div class="small muted" style="margin-top:6px">🔒 Tin nhắn lưu trên máy chủ riêng của tiệm, tự xóa sau ${esc(String(S.settings.chat_keep_days || 90))} ngày. Không gửi mật khẩu, số tài khoản, lương thưởng vào đây.</div></div>`;
  const list = $('#chatList');
  const timeOf = (c) => { const d = c.slice(0, 10); return (d === S.today ? '' : dmy(d).slice(0, 5) + ' ') + c.slice(11, 16); };
  const draw = (keepPos) => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.innerHTML = msgs.length ? msgs.map((m, i) => { const mine = m.user_id === S.me.id; const same = i && msgs[i - 1].user_id === m.user_id;
      return `<div class="chat-msg ${mine ? 'mine' : ''}">${same ? '' : `<div class="small muted">${mine ? 'Bạn' : `<b>${esc(m.user_name)}</b>`}</div>`}
        <div class="bubble">${esc(m.body).replace(/\n/g, '<br>')}<span class="t">${timeOf(m.created_at)}${mine || isMgr() ? ` <a href="#" data-del="${m.id}" title="Xóa">✕</a>` : ''}</span></div>${chatDraftCard(m)}</div>`; }).join('')
      : '<div class="empty">Chưa có tin nhắn. Gõ thử “chị Lan 0912345678 mai 9h nhuộm với Dương”.</div>';
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
    $$('[data-dm]', list).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/chat/${b.dataset.dm}/dismiss`, { method: 'POST', body: {} }); const m = msgs.find((x) => x.id === Number(b.dataset.dm)); m.draft = null; draw(true); })));
    $$('[data-del]', list).forEach((a) => (a.onclick = async (e) => { e.preventDefault(); if (!confirm('Xóa hẳn tin nhắn này?')) return; await api('/chat/' + a.dataset.del, { method: 'DELETE' }); msgs = msgs.filter((x) => x.id !== Number(a.dataset.del)); draw(true); }));
  };
  S.chatPull = async () => {
    if (!document.body.contains(list)) { S.chatPull = null; return; }
    const last = msgs.length ? msgs[msgs.length - 1].id : 0;
    const fresh = await api('/chat?after=' + last);
    if (fresh.length) { msgs = msgs.concat(fresh.filter((m) => !msgs.some((x) => x.id === m.id))); draw(true); }
  };
  const f = $('#chatF'), ta = f.body;
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } };
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
  f.onsubmit = (e) => { e.preventDefault(); const v = ta.value.trim(); if (!v) return;
    guard(f.querySelector('button'), async () => { const m = await api('/chat', { method: 'POST', body: { body: v } }); ta.value = ''; ta.style.height = 'auto'; msgs.push(m); draw(); if (m.draft) toast('App nhận ra lịch hẹn, kiểm tra rồi bấm ✓ Tạo lịch'); }); };
  draw(); refreshChatBadge(); ta.focus();
};

// ---------- Khách hàng ----------
VIEWS.customers = async (main) => {
  const q = S.params.q || '';
  const sf = S.params.staff || '';
  const r = await api('/customers?limit=200&q=' + encodeURIComponent(q) + (sf ? '&staff_id=' + sf : ''));
  const canMove = isMgr() && sf && sf !== 'mine' && r.total > 0;
  main.innerHTML = header('Khách hàng', `${r.total} khách`, `${canMove ? '<button class="btn" id="moveC">🔄 Bàn giao khách</button>' : ''}<button class="btn primary" id="newC">+ Khách mới</button>`) +
    `<div class="card"><div class="row"><input id="q" placeholder="🔍 Tìm tên, SĐT, mã khách, công thức (vd: 7NB)…" value="${esc(q)}" type="search" style="flex:1;min-width:220px">
      <select id="sf" style="width:auto"><option value="">Tất cả thợ</option><option value="mine" ${sf === 'mine' ? 'selected' : ''}>⭐ Khách của tôi</option>${activeStaff().map((u) => `<option value="${u.id}" ${String(u.id) === sf ? 'selected' : ''}>Khách của ${esc(u.full_name)}</option>`).join('')}<option value="none" ${sf === 'none' ? 'selected' : ''}>Chưa giao thợ</option></select></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Tên khách</th><th>SĐT</th><th class="num">Lượt</th><th>Lần gần nhất</th><th>Thợ phụ trách</th><th>Công thức</th>${isMgr() ? '<th class="num">Tổng chi</th>' : ''}</tr></thead>
    <tbody>${r.rows.map((c) => `<tr class="click" data-c="${c.id}"><td class="muted">${esc(c.code)}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}</td>
      <td class="num">${c.visits}</td><td>${dmy(c.last_visit)}</td><td>${c.staff_id ? esc(staffName(c.staff_id)) : '<span class="muted small">—</span>'}</td>
      <td class="small formula-cell" title="${esc(c.formula || '')}">${c.formula ? esc(c.formula.length > 40 ? c.formula.slice(0, 40) + '…' : c.formula) : ''}</td>${isMgr() ? `<td class="num">${money(c.spend)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    ${r.total > r.rows.length ? `<div class="muted small" style="margin-top:8px">Đang hiện ${r.rows.length}/${r.total} — gõ tìm kiếm để lọc.</div>` : ''}</div>`;
  const params = (over) => { const p = { q: $('#q').value, staff: $('#sf').value, ...over }; return Object.fromEntries(Object.entries(p).filter(([, v]) => v)); };
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(() => go('customers', params()), 350); };
  $('#sf').onchange = () => go('customers', params());
  if (q) { const i = $('#q'); i.focus(); i.setSelectionRange(q.length, q.length); }
  $$('[data-c]', main).forEach((tr) => (tr.onclick = () => go('customer', { id: tr.dataset.c })));
  $('#newC').onclick = () => customerForm({}, (id) => go('customer', { id }));
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
    <div class="full"><label>Ghi chú / sở thích</label><textarea name="notes">${esc(c.notes || '')}</textarea></div></div>
    ${c.birthday && c.birthday.length === 5 ? `<div class="small muted">Sinh nhật đang lưu: ${c.birthday.split('-').reverse().join('/')} (không có năm). Để trống ô trên nếu không đổi.</div>` : ''}
    <div class="err"></div><div class="modal-foot">${isEdit && isOwner() ? '<button type="button" class="btn danger" id="delC">Xóa khách</button><span class="spacer"></span>' : ''}<button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu</button></div></form>`);
  $('#cf').onsubmit = (e) => {
    e.preventDefault();
    guard($('#cf button.primary'), async () => {
      const body = formData($('#cf'));
      if (!body.birthday && c.birthday && c.birthday.length === 5) body.birthday = c.birthday;
      let r;
      if (isEdit) r = await api('/customers/' + c.id, { method: 'PUT', body });
      else {
        try { r = await api('/customers', { method: 'POST', body }); } catch (er) {
          if (er.status === 409 && confirm(er.message + '\nVẫn tạo khách mới trùng SĐT?')) r = await api('/customers', { method: 'POST', body: { ...body, allow_duplicate: true } });
          else throw er;
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
  main.innerHTML = header(c.name, `${esc(c.code)} · ${telLinks(c.phone)}`,
    `<button class="btn" id="eC">Sửa</button><button class="btn" id="aC">Đặt lịch</button><button class="btn" id="sC">Bán thẻ</button><button class="btn primary" id="vC">+ Ghi lượt làm</button>`) +
    `<div class="grid two"><div class="card">
      <div class="stat-line"><span class="muted">Thợ phụ trách</span><b>${c.staff_name ? esc(c.staff_name) : '<span class="badge warn">chưa giao</span>'}</b></div>
      <div class="stat-line"><span class="muted">Số lượt</span><b>${c.stats.visits}</b></div>
      ${c.stats.spend != null ? `<div class="stat-line"><span class="muted">Tổng chi tiêu</span><b>${money(c.stats.spend)}</b></div>` : ''}
      <div class="stat-line"><span class="muted">Lần gần nhất</span><b>${dmy(c.stats.last_visit) || '—'}</b></div>
      <div class="stat-line"><span class="muted">Sinh nhật</span><b>${c.birthday ? (c.birthday.length === 10 ? dmy(c.birthday) : c.birthday.split('-').reverse().join('/')) : '<span class="badge warn">chưa có</span>'}</b></div>
      ${c.gender ? `<div class="stat-line"><span class="muted">Giới tính</span><b>${esc(c.gender)}</b></div>` : ''}
      ${c.source ? `<div class="stat-line"><span class="muted">Nguồn</span><b>${esc(c.source)}</b></div>` : ''}
      ${activeCards.map((k) => `<div class="stat-line"><span class="muted">💳 ${esc(k.name)} (${esc(k.code)})</span><b>${money(k.balance)}</b></div>`).join('')}
    </div><div class="card"><h3>Lưu ý tóc</h3><div class="pre">${esc(c.hair_notes || '—')}</div>
      <h3 style="margin-top:12px">🧪 Công thức của khách <button class="btn sm" id="fEdit" style="margin-left:6px">Sửa</button></h3>
      ${c.formula ? `<div class="pre formula-box">${esc(c.formula)}</div><div class="small muted">Cập nhật ${dmy(c.formula_at)}${c.formula_by_name ? ' · ' + esc(c.formula_by_name) : ''}</div>` : '<div class="small muted">Chưa có. Ghi ở phiếu thu (ô Công thức) là tự lưu vào đây.</div>'}
      ${(() => { const hist = c.visits.filter((x) => x.formula); return hist.length > 1 || (hist.length && hist[0].formula !== c.formula) ? `<details class="small" style="margin-top:6px"><summary>Lịch sử công thức (${hist.length} lần)</summary>${hist.map((x) => `<div style="margin:6px 0"><b>${dmy(x.date)}</b> · ${esc(x.main_staff_name || '')} · ${esc(x.items.map((i) => i.name).join(' + '))}<div class="pre">${esc(x.formula)}</div></div>`).join('')}</details>` : ''; })()}${c.notes ? `<h3 style="margin-top:12px">Ghi chú</h3><div class="pre">${esc(c.notes)}</div>` : ''}</div></div>
    <div class="card"><div class="tabs">${[['visits', `Lượt làm (${c.visits.length})`], ['photos', `Ảnh (${c.photos.length})`], ['cards', `Thẻ (${c.cards.length})`], ['appts', `Lịch hẹn (${c.appointments.length})`]]
      .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="tabBody"></div></div>`;
  const reload = () => VIEWS.customer(main);
  $$('[data-tab]').forEach((b) => (b.onclick = () => { history.replaceState({}, '', `#customer?id=${id}&tab=${b.dataset.tab}`); S.params.tab = b.dataset.tab; reload(); }));
  $('#eC').onclick = () => customerForm(c, reload);
  $('#fEdit').onclick = () => {
    openModal('Công thức · ' + c.name, `<form id="ff"><textarea name="formula" rows="6" placeholder="Màu, tỷ lệ pha, oxy, thời gian ủ, lưu ý…">${esc(c.formula || '')}</textarea>
      <div class="small muted">Lần sau ghi lượt làm, phiếu thu hiện sẵn công thức này để thợ dùng lại.</div><div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu công thức</button></div></form>`);
    $('#ff').onsubmit = (e) => { e.preventDefault(); guard($('#ff button'), async () => { await api('/customers/' + c.id, { method: 'PUT', body: { ...c, formula: $('#ff [name=formula]').value, staff_id: c.staff_id } }); closeModal(); toast('Đã lưu công thức'); reload(); }); };
  };
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
function visitBlock(v, photos) {
  const ps = photos.filter((p) => p.visit_id === v.id);
  return `<div class="list-item" style="display:block"><div class="row"><b>${dmy(v.date)}${v.time ? ' ' + esc(v.time) : ''}</b>
    <span>${v.items.map((i) => esc(i.name)).join(' + ')}</span><span class="badge brand">${esc(v.main_staff_name || '')}${v.assistant_name ? ' + ' + esc(v.assistant_name) : ''}</span>
    <span class="spacer"></span>${v.masked ? '' : `<b>${money(v.total)}</b><button class="btn sm" data-rc-id="${v.id}">Hóa đơn</button>`}${v.can_edit ? `<button class="btn sm" data-vedit="${v.id}">Sửa</button>` : ''}</div>
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
async function visitForm(v = {}, after) {
  const isEdit = !!v.id;
  const methods = S.settings.payment_methods;
  const svcOpts = (sel) => `<option value="">— Dịch vụ —</option>` + S.groups.map((g) => `<optgroup label="${esc(g)}">${S.services.filter((s) => s.grp === g && (s.active || s.id === sel))
    .map((s) => `<option value="${s.id}" data-price="${s.price}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${s.price ? ' · ' + (s.price / 1000) + 'k' : ''}</option>`).join('')}</optgroup>`).join('')
    + (S.materials.some((m) => m.kind === 'retail' && m.active) ? `<optgroup label="🛍 Sản phẩm bán lẻ (trừ kho)">${S.materials.filter((m) => m.kind === 'retail' && m.active)
      .map((m) => `<option value="m${m.id}" data-price="${m.sell_price || 0}">${esc(m.name)}${m.sell_price ? ' · ' + kMoney(m.sell_price) : ''}</option>`).join('')}</optgroup>` : '');
  let items = v.items ? v.items.map((i) => (i.material_id ? { material_id: i.material_id, qty: i.qty || 1, price: i.price } : { service_id: i.service_id, name: i.name, price: i.price })) : [];
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
    <div><label>Thợ chính *</label><select name="main_staff_id" required>${staffOptions(v.main_staff_id || (!isMgr() ? S.me.id : null))}</select></div>
    <div><label>Người phụ</label><select name="assistant_id">${staffOptions(v.assistant_id, 'Không có')}</select></div>
    <div class="full"><label>Dịch vụ / sản phẩm bán (giá sửa được)</label><div id="items"></div><div class="row"><div style="flex:1;min-width:200px" id="vSvcS"></div><button type="button" class="btn sm" id="addItem">+ Thêm dòng</button></div></div>
    ${S.materials.some((m) => m.kind === 'service') ? `<div class="full"><label>🧪 Hóa chất đã dùng (ghi để tính giá cốt, trừ kho)</label><div id="used"></div>
      <div class="row"><button type="button" class="btn sm" id="addUsed">+ Thêm hóa chất</button><button type="button" class="btn sm" id="recipeFill">↻ Lấy theo định mức dịch vụ</button></div></div>` : ''}
    <div><label>Phụ thu</label><input type="number" name="surcharge" min="0" step="1000" value="${v.surcharge || ''}"></div>
    <div><label>Giảm giá</label><input type="number" name="discount" min="0" step="1000" value="${v.discount || ''}"></div>
    <div class="full"><label>Lý do giảm (bắt buộc nếu có giảm)</label><input name="discount_reason" list="reasons" value="${esc(v.discount_reason || '')}">
      <datalist id="reasons"><option value="Khách quen"><option value="Khách giới thiệu"><option value="Khuyến mãi"><option value="Bù lỗi dịch vụ"><option value="Người nhà / nhân viên"></datalist></div>
    <div id="cardBox" class="full"></div>
    <div><label>Hình thức thanh toán</label><select name="payment_method"><option value="">—</option>${methods.map((m) => `<option ${v.payment_method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
    <div><label>Tip</label><input type="number" name="tip" min="0" step="1000" value="${v.tip || ''}"></div>
    <div class="full"><div class="totals" id="tot"></div></div>
    <div class="full"><label>Tình trạng tóc trước khi làm</label><textarea name="hair_before">${esc(v.hair_before || '')}</textarea></div>
    <div class="full"><label>Mong muốn của khách</label><input name="wish" value="${esc(v.wish || '')}"></div>
    <div class="full"><label>Công thức / tỷ lệ pha</label><div id="fHint"></div><textarea name="formula">${esc(v.formula || '')}</textarea></div>
    <div class="full"><label>Kết quả sau làm</label><input name="result" value="${esc(v.result || '')}"></div>
    <div><label>Hẹn chăm sóc lại</label><input type="date" name="next_visit_date" value="${v.next_visit_date || ''}"></div>
    <div><label>Ghi chú</label><input name="note" value="${esc(v.note || '')}"></div>
    ${!isEdit ? `<div><label>📷 Ảnh trước</label><input type="file" accept="image/*" multiple id="phB"></div><div><label>📷 Ảnh sau</label><input type="file" accept="image/*" multiple id="phA"></div>` : ''}
    </div><div class="err"></div><div class="modal-foot">${isEdit && isMgr() ? '<button type="button" class="btn danger" id="delV">Xóa lượt</button><span class="spacer"></span>' : ''}
    <button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu lượt làm</button></div></form>`, true);
  const f = $('#vf');
  let cards = [];
  const renderItems = () => {
    $('#items').innerHTML = items.map((it, i) => `<div class="item-row"><select data-i="${i}" class="isvc">${svcOpts(it.service_id).replace(it.material_id ? `value="m${it.material_id}"` : '\u0000', `value="m${it.material_id}" selected`)}${!it.service_id && !it.material_id && it.name ? `<option selected value="">${esc(it.name)}</option>` : ''}</select>
      ${it.material_id ? `<input type="number" data-i="${i}" class="iqty" min="1" step="1" value="${it.qty || 1}" title="Số lượng" style="width:64px">` : ''}
      <input type="number" data-i="${i}" class="iprice" min="0" step="1000" value="${it.price ?? ''}" placeholder="Giá"><button type="button" class="icon-btn" data-rm="${i}">×</button></div>`).join('');
    $$('.isvc', f).forEach((s) => (s.onchange = () => {
      const o = s.selectedOptions[0], price = o && o.dataset.price ? Number(o.dataset.price) : '';
      items[s.dataset.i] = s.value.startsWith('m') ? { material_id: Number(s.value.slice(1)), qty: 1, price } : { service_id: Number(s.value) || '', price };
      renderItems(); autoRecipe();
    }));
    $$('.iqty', f).forEach((q) => (q.oninput = () => { const it = items[q.dataset.i]; const m = matById(it.material_id); it.qty = Math.max(1, Number(q.value) || 1); if (m && m.sell_price) { it.price = m.sell_price * it.qty; $(`.iprice[data-i="${q.dataset.i}"]`, f).value = it.price; } calc(); }));
    $$('.iprice', f).forEach((p) => (p.oninput = () => { items[p.dataset.i].price = p.value; calc(); }));
    $$('[data-rm]', f).forEach((b) => (b.onclick = () => { items.splice(b.dataset.rm, 1); if (!items.length) items.push({ service_id: '', price: '' }); renderItems(); }));
    calc();
  };
  const calc = () => {
    const sub = items.reduce((s, i) => s + Number(i.price || 0), 0);
    const total = Math.max(0, sub + Number(f.surcharge.value || 0) - Number(f.discount.value || 0));
    const cardSel = f.card_id ? Number(f.card_id.value) : 0;
    let cardPaid = 0;
    if (cardSel) {
      const c = cards.find((x) => x.id === cardSel);
      const bal = c ? c.balance + (isEdit && v.card_id === c.id ? v.card_paid : 0) : 0;
      cardPaid = f.card_paid.value !== '' ? Number(f.card_paid.value) : Math.min(bal, total);
      $('#cardHint').textContent = `Số dư khả dụng ${money(bal)}`;
    }
    $('#tot').innerHTML = `<div class="row"><span>Tạm tính</span><span class="num">${money(sub)}</span></div>
      <div class="row"><span>Doanh số lượt này</span><span class="num big">${money(total)}</span></div>
      ${cardSel ? `<div class="row"><span>Trừ thẻ</span><span class="num">−${money(cardPaid)}</span></div>` : ''}
      <div class="row"><span><b>Khách trả thêm</b></span><span class="num big">${money(Math.max(0, total - cardPaid))}</span></div>
      ${isMgr() && (used.length || items.some((i) => i.material_id)) ? (() => {
        const cost = Math.round(used.reduce((t, u) => { const m = matById(u.material_id); return t + (m ? toUnits(m, u.amt || 0) * (m.avg_cost || 0) : 0); }, 0)
          + items.reduce((t, i) => { const m = i.material_id && matById(i.material_id); return t + (m ? (i.qty || 1) * (m.avg_cost || 0) : 0); }, 0));
        return `<div class="row small muted"><span>Giá cốt (hóa chất + giá vốn SP) · chỉ quản lý thấy</span><span class="num">${money(cost)} · lãi gộp ${money(total - cost)}${total ? ' (' + Math.round((total - cost) / total * 100) + '%)' : ''}</span></div>`;
      })() : ''}`;
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
  let usedTouched = isEdit;
  const autoRecipe = () => { if (usedTouched) return; const r = recipeFor(items); if (r.length) { used = r; renderUsed(); } };
  let extraCards = [];
  const loadCards = async (customerId, pick) => {
    const own = customerId ? (await api('/cards?status=active&customer_id=' + customerId)).filter((c) => c.balance > 0 || c.id === v.card_id) : [];
    if (v.card_id && !own.some((c) => c.id === v.card_id) && !extraCards.some((c) => c.id === v.card_id)) {
      const all = await api('/cards?status=active'); const c = all.find((x) => x.id === v.card_id); if (c) extraCards.push(c);
    }
    cards = [...own, ...extraCards.filter((c) => !own.some((o) => o.id === c.id))];
    const sel = pick || v.card_id;
    $('#cardBox').innerHTML = (cards.length ? `<div class="form-grid"><div><label>Trừ vào thẻ</label><select name="card_id"><option value="">Không dùng thẻ</option>
      ${cards.map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.code)} · ${esc(c.name)} · còn ${money(c.balance)}${c.customer_id !== Number(customerId) ? ' · thẻ của ' + esc(c.customer_name) : ''}${c.expires_at < S.today ? ' (HẾT HẠN)' : ''}</option>`).join('')}</select></div>
      <div><label>Số tiền trừ thẻ (trống = tự tính)</label><input type="number" name="card_paid" min="0" step="1000" value="${isEdit && v.card_id ? v.card_paid : ''}"><div class="small muted" id="cardHint"></div></div></div>` : '')
      + (customerId ? `<div class="row small" style="margin-top:6px"><button type="button" class="btn sm" id="vGift">🎁 Tặng thẻ tri ân 1Tr</button><button type="button" class="btn sm" id="vSell">💳 Bán thẻ trả trước</button>
        <span class="muted">→ tạo xong trừ vào thẻ luôn ở phiếu này</span></div><div id="vSellBox"></div>` : '')
      + (customerId ? `<div class="row small" style="margin-top:6px"><span class="muted">Khách dùng thẻ tặng của người khác?</span><input id="giftQ" placeholder="Mã thẻ (T1M-…) hoặc SĐT chủ thẻ" style="width:auto;flex:1;min-width:150px"><button type="button" class="btn sm" id="giftFind">Tìm thẻ</button></div>` : '');
    if (cards.length) { f.card_id.onchange = calc; f.card_paid.oninput = calc; }
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
    $('#fHint').innerHTML = b.formula || b.hair_notes ? `<div class="totals small" style="margin-bottom:6px">${b.staff_name ? `<div>Thợ phụ trách: <b>${esc(b.staff_name)}</b></div>` : ''}
      ${b.hair_notes ? `<div><span class="muted">Lưu ý tóc:</span> ${esc(b.hair_notes)}</div>` : ''}
      ${b.formula ? `<div><span class="muted">Công thức khách (${dmy(b.formula_at)}${b.formula_by_name ? ', ' + esc(b.formula_by_name) : ''}):</span><div class="pre">${esc(b.formula)}</div>
      ${!f.formula.value ? '<button type="button" class="btn sm" id="useF">↓ Dùng lại công thức này</button>' : ''}` : ''}</div>` : '';
    const u = $('#useF'); if (u) u.onclick = () => { f.formula.value = b.formula; u.remove(); };
  };
  bindPicker(f, (cid) => { loadCards(cid); showBrief(cid); });
  showBrief(custSel && custSel.id);
  $('#addItem').onclick = () => { items.push({ service_id: '', price: '' }); renderItems(); };
  if ($('#used')) {
    $('#used').addEventListener('input', () => { usedTouched = true; });
    $('#used').addEventListener('change', () => { usedTouched = true; });
    $('#addUsed').onclick = () => { usedTouched = true; used.push({ material_id: '', amt: '' }); renderUsed(); };
    $('#recipeFill').onclick = () => { const r = recipeFor(items); if (!r.length) return toast('Dịch vụ đã chọn chưa có định mức. Quản lý cài ở Kho & giá cốt → Định mức'); used = r; usedTouched = true; renderUsed(); };
  }
  const vss = svcSearch('vSvcQ', (sv) => { const empty = items.findIndex((i) => !i.service_id && !i.name); const it = { service_id: sv.id, price: sv.price }; if (empty >= 0) items[empty] = it; else items.push(it); renderItems(); });
  $('#vSvcS').innerHTML = vss.html; vss.bind();
  for (const n of ['surcharge', 'discount']) f[n].oninput = calc;
  renderItems();
  if (!isEdit && !used.length) autoRecipe(); else renderUsed();
  loadCards(custSel && custSel.id);
  f.onsubmit = (e) => {
    e.preventDefault();
    guard($('#vf button.primary'), async () => {
      const d = formData(f);
      const body = { ...d, items: items.filter((i) => i.service_id || i.name || i.material_id).map((i) => (i.material_id ? { material_id: i.material_id, qty: i.qty || 1, price: i.price === '' ? null : Number(i.price) }
        : { service_id: i.service_id || null, name: i.name, price: i.price === '' ? null : Number(i.price) })), appointment_id: v.appointment_id };
      if ($('#used')) body.materials = used.filter((u) => u.material_id && Number(u.amt) > 0).map((u) => ({ material_id: u.material_id, qty: toUnits(matById(u.material_id), u.amt) }));
      if (body.card_id && body.card_paid === '') body.card_paid = 0;
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
  const rows = await api(`/visits?from=${from}&to=${to}${staffId ? '&staff_id=' + staffId : ''}`);
  const sum = rows.filter((r) => !r.masked).reduce((a, r) => ({ total: a.total + r.total, cash: a.cash + r.cash_paid, card: a.card + r.card_paid, tip: a.tip + r.tip }), { total: 0, cash: 0, card: 0, tip: 0 });
  main.innerHTML = header('Lượt làm', 'Mỗi lượt khách = 1 dòng, thay sổ thu tiền', `<button class="btn primary" id="nv">+ Ghi lượt làm</button>`) +
    `<div class="card"><div class="row"><input type="date" id="f" value="${from}" style="width:auto"> → <input type="date" id="t" value="${to}" style="width:auto">
      <button class="btn sm" id="tod">Hôm nay</button><span class="spacer"></span><select id="st" style="width:auto">${staffOptions(Number(staffId), 'Tất cả thợ')}</select></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Khách</th><th>Dịch vụ</th><th>Thợ</th><th class="num">Doanh số</th><th class="num">Trừ thẻ</th><th class="num">Thu</th><th>TT</th><th class="num">Tip</th><th></th></tr></thead>
    <tbody>${rows.map((v) => `<tr><td>${dmy(v.date).slice(0, 5)} ${esc(v.time || '')}</td><td><a href="#customer?id=${v.customer_id}">${esc(v.customer_name)}</a></td>
      <td>${v.items.map((i) => esc(i.name)).join(' + ')}</td><td>${esc(v.main_staff_name)}${v.assistant_name ? ' <span class="muted small">+' + esc(v.assistant_name) + '</span>' : ''}</td>
      <td class="num">${money(v.total)}</td><td class="num">${v.card_paid ? money(v.card_paid) : ''}</td><td class="num">${money(v.cash_paid)}</td><td class="small">${esc(v.payment_method || '')}</td><td class="num">${v.tip ? money(v.tip) : ''}</td>
      <td class="nowrap">${v.masked ? '' : `<button class="btn sm" data-rc-id="${v.id}">Hóa đơn</button>`}${v.can_edit ? `<button class="btn sm" data-ev="${v.id}">Sửa</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Chưa có lượt nào</td></tr>'}</tbody>
    ${rows.length ? `<tfoot><tr><td colspan="4">${rows.length} lượt${rows.some((r) => r.masked) ? ' <span class="muted small">(chỉ cộng lượt của bạn)</span>' : ''}</td><td class="num">${money(sum.total)}</td><td class="num">${money(sum.card)}</td><td class="num">${money(sum.cash)}</td><td></td><td class="num">${money(sum.tip)}</td><td></td></tr></tfoot>` : ''}
    </table></div></div>`;
  const set = (p) => go('visits', { from, to, ...(staffId ? { staff: staffId } : {}), ...p });
  $('#f').onchange = (e) => set({ from: e.target.value, to: e.target.value > to ? e.target.value : to });
  $('#t').onchange = (e) => set({ to: e.target.value });
  $('#tod').onclick = () => set({ from: S.today, to: S.today });
  $('#st').onchange = (e) => go('visits', { from, to, ...(e.target.value ? { staff: e.target.value } : {}) });
  $('#nv').onclick = () => visitForm({}, () => VIEWS.visits(main));
  $$('[data-ev]', main).forEach((b) => (b.onclick = () => visitForm(rows.find((r) => r.id === Number(b.dataset.ev)), () => VIEWS.visits(main))));
  $$('[data-rc-id]', main).forEach((b) => (b.onclick = () => showReceipt(b.dataset.rcId)));
};

// ---------- Nhắc nhở ----------
VIEWS.reminders = async (main) => {
  const r = await api('/reminders');
  // Lọc theo thợ phụ trách: nhân viên mặc định thấy khách của mình
  const sf0 = S.params.staff ?? (S.me.role === 'staff' ? 'mine' : '');
  const sf = sf0 === 'all' ? '' : sf0;
  const want = sf === 'mine' ? S.me.id : sf === 'none' ? null : sf ? Number(sf) : undefined;
  const owner = (x) => x.cust_staff_id !== undefined ? x.cust_staff_id : x.staff_id;
  const keep = (x, appt) => want === undefined || (want === null ? !owner(x) : owner(x) === want || (appt && x.staff_id === want));
  for (const k of ['birthdays', 'cards', 'returns']) r[k] = r[k].filter((x) => keep(x));
  for (const k of ['appointments', 'cancels']) r[k] = r[k].filter((x) => keep(x, true));
  for (const k of ['birthdays', 'cards', 'returns', 'appointments', 'cancels']) r.counts[k] = r[k].filter((x) => !x.done).length;
  const who = (x) => { const id = owner(x); return id ? ` <span class="badge">${esc(staffName(id))}</span>` : ''; };
  const sec = (key, title, help, rows, line) => `<div class="card"><h3>${title} <span class="badge ${r.counts[key] ? 'bad' : ''}">${r.counts[key]}</span></h3><div class="small muted">${help}</div>
    ${rows.length ? rows.map((x) => `<div class="list-item" style="${x.done ? 'opacity:.5' : ''}"><div style="flex:1;min-width:0">${line(x)}<div class="small">${telLinks(x.phone)}</div></div>
      ${x.done ? '<span class="badge ok">Đã liên hệ</span>' : `<button class="btn sm" data-done='${esc(JSON.stringify({ customer_id: x.customer_id || x.id, type: key === 'birthdays' ? 'birthday' : key === 'cards' ? 'card' : key === 'returns' ? 'return' : 'appointment', ref: x.ref }))}'>Đã liên hệ</button>`}</div>`).join('') : '<div class="empty">Không có</div>'}</div>`;
  main.innerHTML = header('Nhắc nhở', 'Gọi / nhắn Zalo cho khách rồi bấm “Đã liên hệ”') +
    `<div class="card"><div class="row"><span class="muted small">Xem nhắc nhở của</span><select id="rsf" style="width:auto">
      <option value="all" ${!sf ? 'selected' : ''}>Tất cả khách</option><option value="mine" ${sf === 'mine' ? 'selected' : ''}>⭐ Khách của tôi</option>
      ${activeStaff().map((u) => `<option value="${u.id}" ${String(u.id) === sf ? 'selected' : ''}>Khách của ${esc(u.full_name)}</option>`).join('')}
      <option value="none" ${sf === 'none' ? 'selected' : ''}>Khách chưa giao thợ</option></select>
      <span class="small muted">Mỗi thợ tự gọi khách của mình, quản lý xem tổng.</span></div></div>
    <div class="grid two">
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
    ${sec('returns', '🔁 Khách đến hạn quay lại', 'Đã quá số ngày cài đặt kể từ lần làm gần nhất và chưa có lịch hẹn.', r.returns, (c) => `<b><a href="#customer?id=${c.id}">${esc(c.name)}</a></b>${who(c)} <span class="small muted">lần cuối ${dmy(c.last_date)} · ${c.days} ngày · ${c.n} lượt</span>`)}
    </div>`;
  $$('[data-ord]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/stock/${b.dataset.ord}/ordered`, { method: 'POST', body: {} }); refreshReminderBadge(); VIEWS.reminders(main); })));
  $('#rsf').onchange = (e) => go('reminders', { staff: e.target.value });
  $$('[data-done]', main).forEach((b) => (b.onclick = () => guard(b, async () => { await api('/reminders/done', { method: 'POST', body: JSON.parse(b.dataset.done) }); refreshReminderBadge(); VIEWS.reminders(main); })));
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
    <td class="num"><b>${money(c.balance)}</b></td><td>${esc(c.seller_name || staffName(c.seller_id))}</td><td><span class="badge ${ST[c.status][1]}">${ST[c.status][0]}</span></td>
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
      ${c.commission != null ? `<div class="stat-line"><span class="muted">Hoa hồng bán thẻ</span><b>${money(c.commission)}</b></div>` : ''}
      ${msgBox(cardMsg(c, hist), c.phone)}
      <h3 style="margin-top:14px">Lịch sử dùng thẻ</h3>${hist.length ? `<table><tbody>${hist.map((h) => `<tr><td>${esc(h.created_at.slice(0, 10).split('-').reverse().join('/'))}</td><td>${esc(h.visit_code || h.note || '')}</td><td class="num">${money(h.amount)}</td><td class="small muted">${esc(h.by_name || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa dùng</div>'}
      ${isMgr() ? `<form id="cardEdit"><h3 style="margin-top:14px">Quản lý thẻ</h3><div class="form-grid">
        <div><label>Gia hạn đến</label><input type="date" name="expires_at" value="${c.expires_at || ''}"></div>
        <div><label>Trạng thái</label><select name="status"><option value="active" ${c.status === 'active' ? 'selected' : ''}>Đang dùng</option><option value="closed" ${c.status === 'closed' ? 'selected' : ''}>Đóng thẻ</option><option value="refunded" ${c.status === 'refunded' ? 'selected' : ''}>Hoàn tiền (thu hồi HH)</option></select></div>
        <div><label>Điều chỉnh số dư (+/−)</label><input type="number" name="amount" step="1000"></div><div><label>Lý do điều chỉnh</label><input name="note"></div></div>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>` : ''}`);
    bindMsgBox();
    const f = $('#cardEdit');
    if (f) f.onsubmit = (e) => {
      e.preventDefault();
      guard($('#cardEdit button'), async () => {
        const d = formData(f);
        await api('/cards/' + c.id, { method: 'PUT', body: { expires_at: d.expires_at, status: d.status } });
        if (d.amount) await api(`/cards/${c.id}/adjust`, { method: 'POST', body: { amount: Number(d.amount), note: d.note } });
        closeModal(); toast('Đã cập nhật thẻ'); reload();
      });
    };
  }));
}
function cardForm(customer, after) {
  openModal('Bán thẻ trả trước', `<form id="sf"><div class="form-grid">
    <div class="full"><label>Khách hàng *</label>${customerPicker('customer_id', customer && customer.id ? customer : null)}</div>
    <div class="full"><label>Gói thẻ</label><select name="card_type_id">${S.cardTypes.filter((t) => t.active).map((t) => `<option value="${t.id}">${esc(t.name)} · ${t.price ? `bán ${money(t.price)} → dùng ${money(t.value)}` : `TẶNG ${money(t.value)}`} · ${t.fixed_expiry ? 'hạn đến ' + dmy(t.fixed_expiry) : t.months + ' tháng'}</option>`).join('')}<option value="">Thẻ tùy chỉnh…</option></select></div>
    <div><label>Giá bán (trống = theo gói)</label><input type="number" name="price" min="0" step="1000"></div>
    <div><label>Giá trị dùng (trống = theo gói)</label><input type="number" name="value" min="0" step="1000"></div>
    <div><label>Loại</label><select name="sale_type"><option value="new">Khách mua mới</option><option value="renewal">Mua lại / nạp thêm</option><option value="gift">Tặng (không HH)</option></select></div>
    <div><label>Nhân viên bán</label><select name="seller_id" ${!isMgr() ? 'disabled' : ''}>${staffOptions(S.me.id, '')}</select></div>
    <div><label>Hình thức thanh toán</label><select name="payment_method">${S.settings.payment_methods.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
    <div><label>Ngày bán</label><input type="date" name="sold_at" value="${S.today}"></div>
    <div class="full"><label>Ghi chú</label><input name="note"></div></div>
    <div class="small muted">Tiền bán thẻ tính vào <b>tiền vào</b>, không tính vào doanh số dịch vụ (doanh số tính khi khách dùng thẻ) — tránh cộng 2 lần.</div>
    <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Bán thẻ</button></div></form>`);
  bindPicker($('#sf'));
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
  const total = cards.filter((c) => c.status === 'active').reduce((s, c) => s + c.balance, 0);
  main.innerHTML = header('Thẻ trả trước', isMgr() ? `Tổng số dư thẻ đang lưu hành: <b>${money(total)}</b> (tiệm còn nợ dịch vụ khách)` : '', `<button class="btn primary" id="sell">+ Bán thẻ</button>`) +
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
      <span class="spacer"></span>${S.me.stock_count || isMgr() ? '<button class="btn primary sm" id="cnt">🧮 Kiểm kho / đếm hàng</button>' : ''}${isMgr() ? '<button class="btn sm" id="sperm">Phân quyền kho</button>' : ''}</div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Tên</th><th>Nhóm</th><th>ĐVT</th><th class="num">Tồn</th><th class="num">Mức báo hết</th><th>Trạng thái</th><th>Kiểm gần nhất</th><th></th></tr></thead>
      <tbody>${list.map((m) => `<tr><td><b>${esc(m.name)}</b>${m.size ? ` <span class="small muted">${m.size}${m.size_unit}</span>` : ''}</td><td class="small">${esc(m.grp || '')}</td><td>${esc(m.unit || '')}</td>
        <td class="num"><b>${qtyFmt(m.stock)}</b></td><td class="num">${m.min_qty != null ? qtyFmt(m.min_qty) : '<span class="muted small">—</span>'} <button class="btn sm" data-min="${m.id}">Sửa</button></td>
        <td><span class="badge ${STK[m.status][1]}">${STK[m.status][0]}</span>${m.ordered_at ? ` <span class="badge">Đã gọi ${dmy(m.ordered_at.slice(0, 10))}${m.ordered_by_name ? ' · ' + esc(m.ordered_by_name) : ''}</span>` : ''}</td>
        <td class="small">${m.last_count ? dmy(m.last_count) + (m.last_count_by ? ' · ' + esc(m.last_count_by) : '') : '<span class="muted">chưa kiểm</span>'}</td>
        <td>${m.status !== 'ok' ? (m.ordered_at ? `<button class="btn sm" data-unord="${m.id}">Bỏ đánh dấu</button>` : `<button class="btn sm" data-ord="${m.id}">📞 Đã gọi hàng</button>`) : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Không có</td></tr>'}</tbody></table></div>
      <div class="small muted" style="margin-top:8px">Tồn = nhập − dùng cho dịch vụ − bán − điều chỉnh kiểm kho. Đặt “Mức báo hết” để được nhắc trước khi hết hẳn. Khi hàng mới về (nhập kho), dấu “Đã gọi” tự xóa.</div></div>`;
  main.appendChild(wrap);
  const setP = (o) => go('stock', { ...S.params, ...o });
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
      <input id="cq" type="search" placeholder="🔍 Lọc tên…" style="margin:8px 0">
      <div style="max-height:52vh;overflow:auto">${items.map((m) => `<div class="row cnt-row" data-n="${esc(m.name.toLowerCase())}" style="padding:4px 0;border-bottom:1px solid var(--line)"><div style="flex:1;min-width:0" class="small"><b>${esc(m.name)}</b> <span class="muted">· máy: ${qtyFmt(m.stock)} ${esc(m.unit || '')}</span></div>
        <input type="number" step="0.01" min="0" inputmode="decimal" data-cm="${m.id}" style="width:90px"></div>`).join('')}</div>
      <label style="margin-top:8px">Ghi chú</label><input name="note" placeholder="VD: kiểm cuối tháng 11">
      <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu kết quả kiểm</button></div></form>`);
    $('#cq').oninput = (e) => { const q = e.target.value.toLowerCase(); $$('.cnt-row').forEach((r) => (r.style.display = r.dataset.n.includes(q) ? '' : 'none')); };
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
        <div><label>Trạng thái</label><select name="active"><option value="1">Đang dùng</option><option value="0" ${m.active ? '' : 'selected'}>Ngừng</option></select></div>
        <div class="full"><label>Ghi chú</label><input name="note" value="${esc(m.note || '')}"></div></div>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>`);
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
  main.innerHTML = header('Doanh số & hoa hồng', isMgr() ? 'Toàn tiệm' : 'Chỉ hiển thị số liệu của bạn') +
    `<div class="card"><div class="row"><input type="date" id="f" value="${from}" style="width:auto"> → <input type="date" id="t" value="${to}" style="width:auto">
      <button class="btn sm" data-p="today">Hôm nay</button><button class="btn sm" data-p="month">Tháng này</button><button class="btn sm" data-p="last">Tháng trước</button><button class="btn sm" data-p="all">Từ khai trương</button></div></div>
    ${s ? `<div class="grid kpis">
      <div class="kpi"><div class="l">Doanh số dịch vụ</div><div class="v">${money(s.service_sales)}</div><div class="s">${s.visits} lượt · giảm giá ${money(s.discounts)}</div></div>
      <div class="kpi"><div class="l">Tiền vào thực tế</div><div class="v">${money(s.money_in)}</div><div class="s">thu dịch vụ ${money(s.service_cash)} + bán thẻ ${money(s.card_sales)}</div></div>
      <div class="kpi"><div class="l">Dịch vụ trả bằng thẻ</div><div class="v">${money(s.paid_by_card)}</div><div class="s">${s.paid_by_gift ? `trong đó thẻ tặng ${money(s.paid_by_gift)} (chi phí tri ân, không có tiền vào)` : 'đã thu tiền lúc bán thẻ'}</div></div>
      <div class="kpi"><div class="l">Tip</div><div class="v">${money(s.tips)}</div><div class="s">không tính doanh số</div></div></div>
      <div class="card"><h3>Tiền vào theo hình thức</h3>${Object.entries(s.by_method).map(([k, v]) => `<div class="stat-line"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join('') || '<div class="empty">—</div>'}</div>` : ''}
    ${!isMgr() ? r.rows.map((x) => `<div class="card"><h3>${esc(x.name)}</h3>
      <div class="stat-line"><span class="muted">Lượt làm chính / phụ</span><b>${x.main_count} / ${x.assist_count}</b></div>
      ${G.map((g) => `<div class="stat-line"><span class="muted">DS ${esc(g)}</span><b>${money(x.by_group[g])}</b></div>`).join('')}
      <div class="stat-line"><span>Tổng doanh số</span><b>${money(x.sales)}</b></div>
      <div class="stat-line"><span class="muted">HH dịch vụ</span><b>${money(x.main_commission)}</b></div>
      <div class="stat-line"><span class="muted">HH làm phụ</span><b>${money(x.assistant_commission)}</b></div>
      <div class="stat-line"><span class="muted">HH bán thẻ (${x.cards_count} thẻ)</span><b>${money(x.card_commission)}</b></div>
      <div class="stat-line"><span>Tổng hoa hồng (tạm tính)</span><b>${money(x.total_commission)}</b></div>
      <div class="stat-line"><span class="muted">Tip khách ghi ở lượt</span><b>${money(x.tip)}</b></div></div>`).join('') : ''}
    <div class="card ${!isMgr() ? 'hidden' : ''}"><h3>Theo nhân viên</h3><div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th class="num">Lượt chính</th><th class="num">Lượt phụ</th>${G.map((g) => `<th class="num">${esc(g)}</th>`).join('')}<th class="num">Tổng DS</th>
      <th class="num">HH dịch vụ</th><th class="num">HH phụ</th><th class="num">Thẻ bán</th><th class="num">HH thẻ</th><th class="num">Tổng HH</th><th class="num">Tip</th></tr></thead>
      <tbody>${r.rows.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="num">${x.main_count}</td><td class="num">${x.assist_count}</td>${G.map((g) => `<td class="num">${money(x.by_group[g])}</td>`).join('')}
      <td class="num"><b>${money(x.sales)}</b></td><td class="num">${money(x.main_commission)}</td><td class="num">${money(x.assistant_commission)}</td><td class="num">${x.cards_count} · ${money(x.cards_amount)}</td>
      <td class="num">${money(x.card_commission)}</td><td class="num"><b>${money(x.total_commission)}</b></td><td class="num">${money(x.tip)}</td></tr>`).join('')}</tbody></table></div>
      <div class="small muted" style="margin-top:8px">Hoa hồng tạm tính theo % từng dịch vụ (Cài đặt › Dịch vụ) và % người phụ, bán thẻ (Cài đặt › Tham số). Chưa gồm lương cứng, thưởng mốc doanh số. Tip được chia chung ở trang <a href="#tips">Chia tip</a>.</div></div>
    ${staffCustomerCard(sc)}`;
  const set = (a, b) => go('sales', { from: a, to: b });
  $('#f').onchange = (e) => set(e.target.value, to); $('#t').onchange = (e) => set(from, e.target.value);
  $$('[data-p]').forEach((b) => (b.onclick = () => {
    const t = S.today;
    if (b.dataset.p === 'today') set(t, t);
    if (b.dataset.p === 'month') set(t.slice(0, 8) + '01', t);
    if (b.dataset.p === 'all') set('2026-10-25', t);
    if (b.dataset.p === 'last') { const f = addDays(t.slice(0, 8) + '01', -1); set(f.slice(0, 8) + '01', f); }
  }));
};

// ---------- Chia tip chung theo tháng ----------
VIEWS.tips = async (main) => {
  const month = S.params.month || S.today.slice(0, 7);
  const r = await api('/tips?month=' + month);
  const nm = (id) => esc((r.members.find((m) => m.id === id) || {}).name || staffName(id));
  const shift = (n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const isPast = r.pay_date <= S.today;
  main.innerHTML = header('Chia tip', `Tip cả tháng chia đều cho nhóm · ai nghỉ ngày nào không được chia tip ngày đó · trả ngày <b>${dmy(r.pay_date)}</b>`) +
    `<div class="card"><div class="row"><button class="btn sm" id="pm">‹</button><input type="month" id="mo" value="${month}" style="width:auto"><button class="btn sm" id="nm">›</button>
      <span class="small muted">Nhóm chia: ${r.members.map((m) => esc(m.name)).join(', ') || '—'}</span>${isMgr() ? '<button class="btn sm" id="pool">Sửa nhóm</button>' : ''}</div></div>
    <div class="grid kpis"><div class="kpi"><div class="l">Tổng tip tháng</div><div class="v">${money(r.total_tip)}</div><div class="s">${r.days.length} ngày có tip</div></div>
      <div class="kpi"><div class="l">Ngày trả</div><div class="v">${dmy(r.pay_date)}</div><div class="s">${isPast ? 'đã đến hạn trả' : 'mồng 5 tháng sau'}</div></div>
      ${r.unallocated ? `<div class="kpi"><div class="l">Chưa chia được</div><div class="v">${money(r.unallocated)}</div><div class="s">ngày cả nhóm đều nghỉ</div></div>` : ''}</div>
    <div class="card"><h3>Mỗi người nhận</h3><div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th class="num">Ngày được chia</th><th class="num">Ngày nghỉ có tip</th><th class="num">Tiền tip</th><th>Trạng thái</th></tr></thead>
      <tbody>${r.shares.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="num">${x.days_shared}/${r.days.length}</td><td class="num">${x.days_off || ''}</td><td class="num"><b>${money(x.amount)}</b></td>
        <td>${x.paid_at ? `<span class="badge ok">Đã trả ${money(x.paid_amount)}</span> <span class="small muted">${dmy(x.paid_at.slice(0, 10))}${x.paid_by_name ? ' · ' + esc(x.paid_by_name) : ''}</span>${x.paid_amount !== x.amount ? ' <span class="badge warn">số đã đổi</span>' : ''}${isMgr() ? ` <button class="btn sm" data-unpay="${x.user_id}">Hủy</button>` : ''}`
          : isMgr() ? `<button class="btn sm" data-pay="${x.user_id}" ${x.amount ? '' : 'disabled'}>Đánh dấu đã trả</button>` : '<span class="muted small">Chưa trả</span>'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Tổng</td><td></td><td></td><td class="num"><b>${money(r.shares.reduce((a, x) => a + x.amount, 0))}</b></td><td></td></tr></tfoot></table></div>
      <div class="small muted" style="margin-top:8px">Tip lấy từ ô “Tip” ở phiếu thu. Nghỉ = đơn off <b>cả ngày</b> đã duyệt ở trang Lịch off; nghỉ vài giờ vẫn được chia. Làm tròn đến đồng nên tổng có thể lệch vài đồng.</div></div>
    <div class="card"><h3>Chi tiết từng ngày</h3>${r.days.length ? `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th class="num">Tip</th><th class="num">Số người chia</th><th class="num">Mỗi người</th><th>Nghỉ (không chia)</th><th>Ghi chú</th></tr></thead>
      <tbody>${r.days.map((d) => `<tr><td>${dmy(d.date)}</td><td class="num">${money(d.tip)}</td><td class="num">${d.present.length}</td><td class="num">${money(d.share)}</td>
        <td>${d.absent.map((id) => `<span class="badge bad">${nm(id)}</span>`).join(' ')}</td>
        <td class="small">${d.partial.length ? 'Nghỉ vài giờ (vẫn chia): ' + d.partial.map(nm).join(', ') + '. ' : ''}${d.no_checkin.length ? '<span class="badge warn">Không chấm công</span> ' + d.no_checkin.map(nm).join(', ') + ' — nếu thực tế nghỉ, thêm đơn off cả ngày.' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Tháng này chưa có tip</div>'}</div>`;
  const go2 = (m) => go('tips', { month: m });
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
VIEWS.excel = async (main) => {
  main.innerHTML = header('Nhập / Xuất Excel') + `<div class="grid two">
    <div class="card"><h3>📥 Nhập từ Excel</h3>
      <div class="small muted">Nhận các mẫu: <b>Salon Nếp – Nhật ký</b> (khách, nhật ký dịch vụ, danh mục), <b>CRM Nếp Hair</b> (CRM Khách, lịch hẹn đã đặt), <b>Sổ đặt lịch</b> (tab Tháng 10, Tháng 11… + Quản lý Thẻ 1Tr) , <b>sổ nhập mỹ phẩm/hóa chất</b> (file theo dõi chi phí, tab "Nhập mỹ phẩm" → vào Kho) và file <b>xuất từ phần mềm này</b>.
      Khách trùng được ghép theo mã cũ → SĐT → tên. Nhập lại cùng file không bị nhân đôi.</div>
      <form id="imp"><label>File .xlsx</label><input type="file" name="file" accept=".xlsx" required>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="include_history"> Nhập cả lịch sử cũ (lượt "Hoàn thành" ở tab Lịch sử của CRM Nếp Hair / lịch các ngày đã qua trong Sổ đặt lịch)</label>
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
      fd.append('file', f.file.files[0]); fd.append('dry_run', b.dataset.mode); fd.append('include_history', f.include_history.checked ? '1' : '0');
      if (b.dataset.mode === '0' && !confirm('Nhập dữ liệu vào hệ thống?')) return;
      const r = await api('/import', { method: 'POST', body: fd });
      const s = r.summary;
      $('#impRes').innerHTML = `<div class="totals" style="margin-top:12px"><b>${r.dry_run ? 'XEM TRƯỚC (chưa lưu)' : '✅ ĐÃ NHẬP'}</b> · ${esc(s.format)}
        <div class="stat-line"><span>Khách mới</span><b>${s.customers_created}</b></div><div class="stat-line"><span>Khách ghép với khách có sẵn</span><b>${s.customers_merged}</b></div>
        <div class="stat-line"><span>Lượt làm thêm mới</span><b>${s.visits_created}</b></div><div class="stat-line"><span>Lượt đã có (bỏ qua)</span><b>${s.visits_skipped_existing}</b></div>
        <div class="stat-line"><span>Lượt trùng khách + ngày (bỏ qua)</span><b>${s.visits_skipped_duplicate}</b></div><div class="stat-line"><span>Lịch hẹn mới</span><b>${s.appointments_created}</b></div>
        ${s.appointments_linked ? `<div class="stat-line"><span>…trong đó gắn được với khách có sẵn</span><b>${s.appointments_linked}</b></div>` : ''}
        ${s.appointments_past_skipped ? `<div class="stat-line"><span>Lịch ngày đã qua (bỏ qua)</span><b>${s.appointments_past_skipped}</b></div>` : ''}
        ${s.appointments_skipped ? `<div class="stat-line"><span>Lịch đã có (bỏ qua)</span><b>${s.appointments_skipped}</b></div>` : ''}
        ${s.cards_created || s.cards_skipped_existing ? `<div class="stat-line"><span>Thẻ voucher mới / đã có</span><b>${s.cards_created} / ${s.cards_skipped_existing}</b></div>` : ''}
        ${s.visits_updated ? `<div class="stat-line"><span>Lượt cũ được bổ sung công thức hóa chất</span><b>${s.visits_updated}</b></div>` : ''}
        <div class="stat-line"><span>Dịch vụ mới</span><b>${s.services_added}</b></div>
        ${s.purchases_created != null ? `<div class="stat-line"><span>Hóa chất / sản phẩm mới trong kho</span><b>${s.materials_created}</b></div>
          <div class="stat-line"><span>Dòng nhập hàng mới / cập nhật</span><b>${s.purchases_created} / ${s.purchases_updated}</b></div>
          <div class="stat-line"><span class="muted">Vật tư vận hành (Loại 2) không đưa vào kho</span><b>${s.purchases_skipped_ops}</b></div>` : ''}
        ${s.staff_created.length ? `<div class="small">Nhân viên lạ được tạo (không đăng nhập được): ${s.staff_created.map(esc).join(', ')}</div>` : ''}
        ${s.matched_by_name.length ? `<details class="small"><summary>${s.matched_by_name.length} khách ghép theo TÊN — nên kiểm tra</summary>${s.matched_by_name.map(esc).join(', ')}</details>` : ''}
        ${s.warnings.map((w) => `<div class="small" style="color:var(--warn)">⚠ ${esc(w)}</div>`).join('')}</div>`;
      if (!r.dry_run) { S.services = await api('/services'); S.staff = await api('/staff'); S.materials = await api('/materials'); refreshReminderBadge(); }
    });
  }));
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
    ['params', 'Tham số', isOwner()], ['audit', 'Lịch sử chỉnh sửa', isOwner()], ['backup', 'Sao lưu', isOwner()]].filter((t) => t[2]);
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
      <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Đăng nhập</th><th>Vai trò</th><th>Trạng thái</th><th>Hoa hồng</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr style="${u.active ? '' : 'opacity:.5'}"><td><b>${esc(u.full_name)}</b>${u.aliases ? `<div class="small muted">tên khác: ${esc(u.aliases)}</div>` : ''}</td><td>${u.can_login ? esc(u.username) : '<span class="muted">không đăng nhập</span>'}</td><td>${ROLE[u.role]}</td>
      <td>${u.active ? (u.must_change_pw && u.can_login ? '<span class="badge warn">chưa đổi MK</span>' : '<span class="badge ok">đang làm</span>') : '<span class="badge">đã khóa</span>'}</td><td>${u.commission_enabled ? 'Có' : 'Không'}</td>
      <td class="row"><button class="btn sm" data-eu="${u.id}">Sửa</button>${u.can_login ? `<button class="btn sm" data-pw="${u.id}">Đặt lại MK</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    const form = (u = {}) => {
      openModal(u.id ? 'Sửa tài khoản' : 'Tài khoản mới', `<form id="uf"><label>Họ tên (hiển thị)</label><input name="full_name" value="${esc(u.full_name || '')}" required>
        ${u.id ? '' : '<label>Tên đăng nhập (không dấu)</label><input name="username" autocapitalize="none" required><label>Mật khẩu tạm (≥6 ký tự)</label><input name="password" required minlength="6">'}
        <label>Vai trò</label><select name="role">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>Tên khác trong sổ Excel (cách nhau dấu phẩy)</label><input name="aliases" value="${esc(u.aliases || '')}">
        <label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="active" ${u.active !== 0 ? 'checked' : ''}> Đang làm (bỏ tick = khóa tài khoản)</label>
        <label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="can_login" ${u.can_login !== 0 ? 'checked' : ''}> Được đăng nhập</label>
        <label style="display:flex;gap:8px;color:var(--text)"><input type="checkbox" name="commission_enabled" ${u.commission_enabled !== 0 ? 'checked' : ''}> Tính hoa hồng</label>
        <div class="small muted">Lãnh đạo: toàn quyền. Quản lý: xem doanh số toàn tiệm, nhập/xuất Excel, sửa/xóa lượt, giá dịch vụ. Nhân viên: lịch hẹn, khách, ghi lượt trong ngày, chỉ xem doanh số của mình, không xuất dữ liệu.</div>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>`);
      $('#uf').onsubmit = (e) => { e.preventDefault(); guard($('#uf button'), async () => { await api(u.id ? '/users/' + u.id : '/users', { method: u.id ? 'PUT' : 'POST', body: formData($('#uf')) }); closeModal(); S.staff = await api('/staff'); reload(); }); };
    };
    $('#nu').onclick = () => form();
    $$('[data-eu]', sb).forEach((b) => (b.onclick = () => form(users.find((u) => u.id === Number(b.dataset.eu)))));
    $$('[data-pw]', sb).forEach((b) => (b.onclick = async () => {
      const pw = prompt('Mật khẩu tạm mới (≥6 ký tự). Người dùng sẽ phải đổi khi đăng nhập:');
      if (!pw) return;
      try { await api(`/users/${b.dataset.pw}/reset-password`, { method: 'POST', body: { password: pw } }); toast('Đã đặt lại mật khẩu'); reload(); } catch (e) { toast(e.message); }
    }));
  }
  if (tab === 'params') {
    const s = await api('/settings');
    const F = [['salon_name', 'Tên salon', 'text'], ['salon_address', 'Địa chỉ (in trên hóa đơn)', 'text'], ['salon_phone', 'Số điện thoại salon', 'text'],
      ['bank_info', 'Thông tin chuyển khoản (in trên hóa đơn)', 'text'], ['receipt_footer', 'Lời cảm ơn cuối hóa đơn', 'text'], ['return_days', 'Nhắc khách quay lại sau (ngày)', 'number'], ['birthday_days', 'Nhắc sinh nhật trước (ngày)', 'number'],
      ['card_expiry_days', 'Nhắc thẻ sắp hết hạn trước (ngày)', 'number'], ['card_low_balance', 'Nhắc khi số dư thẻ ≤ (đồng)', 'number'],
      ['assistant_rate', 'Hoa hồng người phụ (tỷ lệ, 0.03 = 3%)', 'number'], ['card_new_rate', 'HH bán thẻ mới (0.05 = 5%)', 'number'],
      ['card_renewal_rate', 'HH khách mua lại thẻ (0.03 = 3%)', 'number'], ['payment_methods', 'Hình thức thanh toán (cách nhau dấu phẩy)', 'text']];
    sb.innerHTML = `<form id="pf"><div class="form-grid">${F.map(([k, l, t]) => `<div><label>${l}</label><input name="${k}" type="${t}" step="any" value="${esc(s[k])}"></div>`).join('')}</div>
      <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu tham số</button></div></form>`;
    $('#pf').onsubmit = (e) => { e.preventDefault(); guard($('#pf button'), async () => { await api('/settings', { method: 'PUT', body: formData($('#pf')) }); toast('Đã lưu'); boot(); }); };
  }
  if (tab === 'audit') {
    const P = S.params;
    const from = P.from || addDays(S.today, -30), to = P.to || S.today, uid = P.u || '', only = P.only ?? 'edit';
    const rows = await api(`/audit?limit=1000&from=${from}&to=${to}${uid ? '&user_id=' + uid : ''}${only ? '&only=edit' : ''}`);
    const A = { login: 'Đăng nhập', create_visit: 'Ghi lượt', update_visit: 'SỬA lượt', delete_visit: 'XÓA lượt', create_customer: 'Thêm khách', update_customer: 'Sửa khách', delete_customer: 'XÓA khách',
      sell_card: 'Bán thẻ', update_card: 'Sửa thẻ', adjust_card: 'Điều chỉnh số dư thẻ', import_excel: 'Nhập Excel', export_excel: 'Xuất Excel', upload_photo: 'Tải ảnh', delete_photo: 'Xóa ảnh',
      create_appointment: 'Đặt lịch', update_appointment: 'Sửa lịch hẹn', appointment_status: 'Đổi trạng thái lịch', change_password: 'Đổi mật khẩu', reset_password: 'Đặt lại MK',
      create_user: 'Tạo tài khoản', update_user: 'Sửa tài khoản', update_settings: 'Sửa tham số', create_service: 'Thêm dịch vụ', update_service: 'Sửa dịch vụ', backup: 'Sao lưu', download_backup: 'Tải bản sao lưu',
      create_off: 'Xin/ghi nghỉ', decide_off: 'Duyệt nghỉ', delete_off: 'Xóa đơn nghỉ', manual_attendance: 'Chấm công tay', delete_attendance: 'Xóa chấm công',
      stock_in: 'Nhập kho', stock_adjust: 'Điều chỉnh kho', stock_count: 'Kiểm kho', stock_ordered: 'Báo đã gọi hàng', stock_unordered: 'Bỏ báo gọi hàng', stock_perm: 'Phân quyền kho',
      transfer_customers: 'Bàn giao khách', tip_paid: 'Ghi trả tip', set_tip_pool: 'Sửa nhóm chia tip', create_card_type: 'Thêm gói thẻ', update_card_type: 'Sửa gói thẻ' };
    const hot = ['update_visit', 'delete_visit', 'adjust_card', 'delete_customer', 'export_excel', 'update_card', 'stock_adjust', 'delete_attendance'];
    const LB = { date: 'Ngày', time: 'Giờ', customer_id: 'Khách', main_staff_id: 'Thợ chính', assistant_id: 'Người phụ', staff_id: 'Thợ', surcharge: 'Phụ thu', discount: 'Giảm giá', discount_reason: 'Lý do giảm',
      total: 'Tổng tiền', card_paid: 'Trừ thẻ', cash_paid: 'Tiền thu', payment_method: 'Hình thức TT', tip: 'Tip', formula: 'Công thức', result: 'Kết quả', note: 'Ghi chú', services: 'Dịch vụ', name: 'Tên', phone: 'SĐT',
      gender: 'Giới tính', birthday: 'Sinh nhật', source: 'Nguồn', hair_notes: 'Lưu ý tóc', notes: 'Ghi chú', status: 'Trạng thái', service: 'Dịch vụ', duration: 'Thời lượng (phút)', guest_name: 'Tên khách',
      guest_phone: 'SĐT khách', amount: 'Số tiền', reason: 'Lý do', qty: 'Số lượng', expires_at: 'Hạn thẻ', price: 'Giá', value: 'Giá trị', role: 'Quyền', active: 'Đang làm', count: 'Số khách', to: 'Sang thợ', month: 'Tháng' };
    const MONEY = ['surcharge', 'discount', 'total', 'card_paid', 'cash_paid', 'tip', 'amount', 'price', 'value', 'unit_cost'];
    const STAFFK = ['main_staff_id', 'assistant_id', 'staff_id', 'to', 'user_id'];
    const fv = (k, v) => v == null || v === '' ? '<span class="muted">(trống)</span>' : MONEY.includes(k) ? money(v) : STAFFK.includes(k) ? esc(staffName(v) || '#' + v)
      : k === 'status' && APPT[v] ? APPT[v][0] : esc(typeof v === 'object' ? JSON.stringify(v) : String(v));
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
    const files = await api('/backups');
    sb.innerHTML = `<div class="small muted">Hệ thống tự sao lưu dữ liệu mỗi 6 giờ, giữ 30 bản gần nhất. Nên tải 1 bản về máy/Google Drive mỗi tuần. Ảnh khách lưu ở thư mục <code>data/photos</code> trên máy chủ.</div>
      <div class="row" style="margin:12px 0"><button class="btn primary" id="bk">Sao lưu ngay</button></div>
      <table><tbody>${files.map((f) => `<tr><td>${esc(f.file)}</td><td class="num">${(f.size / 1024).toFixed(0)} KB</td><td><a class="btn sm" href="/api/backups/${encodeURIComponent(f.file)}">Tải về</a></td></tr>`).join('') || '<tr><td class="empty">Chưa có</td></tr>'}</tbody></table>`;
    $('#bk').onclick = (e) => guard(e.target, async () => { await api('/backups', { method: 'POST' }); toast('Đã sao lưu'); reload(); });
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
  main.innerHTML = header('Thêm') + `<div class="card">${PAGES.filter((p) => p[3]() && !MOBILE.includes(p[0])).map((p) => `<button class="nav-btn" data-goto="${p[0]}"><span>${p[2]}</span>${p[1]}</button>`).join('')}
    <button class="nav-btn" id="mpw"><span>🔑</span>Đổi mật khẩu</button><button class="nav-btn" id="mlo"><span>🚪</span>Đăng xuất (${esc(S.me.full_name)})</button></div>`;
  $$('[data-goto]', main).forEach((b) => (b.onclick = () => go(b.dataset.goto)));
  $('#mpw').onclick = () => renderChangePw(false); $('#mlo').onclick = logout;
};

window.closeModal = closeModal;
boot();
