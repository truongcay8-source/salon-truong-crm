'use strict';
/* CRM Salon Nếp — giao diện một trang, không cần build. */

const S = { me: null, settings: null, groups: [], today: null, staff: [], services: [], cardTypes: [], page: 'dashboard', params: {} };
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
  ['customers', 'Khách hàng', '👤', () => true],
  ['visits', 'Lượt làm', '✂️', () => true],
  ['reminders', 'Nhắc nhở', '🔔', () => true],
  ['cards', 'Thẻ trả trước', '💳', () => true],
  ['sales', 'Doanh số', '📊', () => true],
  ['excel', 'Nhập / Xuất Excel', '📥', isMgr],
  ['settings', 'Cài đặt', '⚙️', () => true],
];
const MOBILE = ['dashboard', 'appointments', 'customers', 'visits', 'reminders', 'more'];
let reminderCount = 0;

async function boot() {
  try {
    const me = await api('/me');
    S.me = me.user; S.settings = me.settings; S.groups = me.groups; S.today = me.today;
    if (S.me.must_change_pw) return renderChangePw(true);
    [S.staff, S.services, S.cardTypes] = await Promise.all([api('/staff'), api('/services'), api('/card-types')]);
    shell();
    route();
  } catch (e) { if (e.status !== 401) console.error(e); if (!S.me) renderLogin(); }
}
function shell() {
  const pages = PAGES.filter((p) => p[3]());
  $('#root').innerHTML = `<div class="app">
    <aside class="side"><div class="brand"><div class="logo">N</div><div><b>${esc(S.settings.salon_name)}</b><div class="small muted">CRM</div></div></div>
      ${pages.map((p) => `<button class="nav-btn" data-page="${p[0]}"><span>${p[2]}</span>${p[1]}${p[0] === 'reminders' ? '<span class="badge count hidden" data-rc></span>' : ''}</button>`).join('')}
      <div class="me"><b>${esc(S.me.full_name)}</b> · ${ROLE[S.me.role]}<div class="row" style="margin-top:8px"><button class="btn sm" id="pwBtn">Đổi mật khẩu</button><button class="btn sm" id="outBtn">Đăng xuất</button></div></div>
    </aside>
    <main class="main" id="main"></main>
    <nav class="bottom-nav">${MOBILE.map((k) => {
      if (k === 'more') return '<button data-page="more"><span class="ico">☰</span>Thêm</button>';
      const p = PAGES.find((x) => x[0] === k);
      const short = { customers: 'Khách', appointments: 'Lịch hẹn' }[k] || p[1];
      return `<button data-page="${k}"><span class="ico">${p[2]}</span>${short}${k === 'reminders' ? '<span class="badge count hidden" data-rc></span>' : ''}</button>`;
    }).join('')}</nav></div>`;
  $$('[data-page]').forEach((b) => (b.onclick = () => go(b.dataset.page)));
  $('#pwBtn').onclick = () => renderChangePw(false);
  $('#outBtn').onclick = logout;
  refreshReminderBadge();
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
    `<button class="btn" id="qAppt">+ Lịch hẹn</button><button class="btn primary" id="qVisit">+ Ghi lượt làm</button>`) +
    `<div class="grid kpis">${kpis}</div>
    <div class="grid two">
      <div class="card"><h3>Lịch hẹn hôm nay (${d.appointments.length})</h3>${apptList(d.appointments)}</div>
      <div class="card"><h3>Việc cần làm</h3>
        ${[['birthdays', '🎂 Sinh nhật sắp tới'], ['cards', '💳 Thẻ sắp hết hạn / hết tiền'], ['returns', '🔁 Khách đến hạn quay lại'], ['appointments', '📞 Gọi xác nhận lịch ngày mai'], ['cancels', '❌ Khách hủy / không đến – mời đặt lại']]
          .map(([k, l]) => `<div class="stat-line"><a href="#reminders">${l}</a><b>${rc[k]}</b></div>`).join('')}
      </div></div>`;
  $('#qAppt').onclick = () => apptForm({ date: d.today });
  $('#qVisit').onclick = () => visitForm({});
  bindApptList(main, () => VIEWS.dashboard(main));
};
function apptList(rows, showDate) {
  if (!rows.length) return '<div class="empty">Không có lịch hẹn</div>';
  return rows.map((a) => `<div class="list-item"><div class="time-pill">${esc(a.time)}${showDate ? `<div class="small muted">${dmy(a.date).slice(0, 5)}</div>` : ''}</div>
    <div style="flex:1;min-width:0"><div class="t">${a.customer_id ? `<a href="#customer?id=${a.customer_id}">${esc(a.name)}</a>` : esc(a.name) + ' <span class="badge">khách mới</span>'}</div>
      <div class="small muted">${esc(a.service || '')}${a.staff_name ? ' · ' + esc(a.staff_name) : ''} · ${telLinks(a.phone)}</div>
      ${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}
      ${a.cancel_reason && ['cancelled', 'noshow'].includes(a.status) ? `<div class="small" style="color:var(--bad)">Lý do: ${esc(a.cancel_reason)}</div>` : ''}</div>
    <div style="text-align:right"><span class="badge ${APPT[a.status][1]}">${APPT[a.status][0]}</span>
      <div class="row" style="justify-content:flex-end;margin-top:6px">
      ${a.status === 'booked' ? `<button class="btn sm" data-ast="arrived" data-id="${a.id}">Đã đến</button>` : ''}
      ${['booked', 'arrived'].includes(a.status) ? `<button class="btn sm primary" data-avisit="${a.id}">Thu tiền</button><button class="btn sm" data-aedit="${a.id}">Sửa</button><button class="btn sm" data-acancel="${a.id}">Hủy / không đến</button>` : ''}
      </div></div></div>`).join('');
}
function bindApptList(root, reload, rows) {
  $$('[data-ast]', root).forEach((b) => (b.onclick = () => guard(b, async () => { await api(`/appointments/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.ast } }); reload(); })));
  const find = async (id) => (rows || (await api(`/appointments?from=${S.today}&to=${addDays(S.today, 60)}`))).find((a) => a.id === Number(id));
  $$('[data-avisit]', root).forEach((b) => (b.onclick = async () => {
    const a = await find(b.dataset.avisit);
    if (!a.customer_id) { toast('Khách mới: tạo hồ sơ khách trước, rồi sửa lịch hẹn chọn khách đó'); return apptForm(a, reload); }
    visitForm({ customer_id: a.customer_id, customer: { id: a.customer_id, code: a.customer_code || '', name: a.name }, main_staff_id: a.staff_id, appointment_id: a.id, service: a.service }, reload);
  }));
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
  return `<div class="totals"><div class="small muted">Tin nhắn gửi khách (sửa được):</div><textarea id="msgT" rows="4">${esc(text)}</textarea>
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
VIEWS.appointments = async (main) => {
  const date = S.params.date || S.today;
  const staffId = S.params.staff || '';
  const rows = await api(`/appointments?from=${date}&to=${date}${staffId ? '&staff_id=' + staffId : ''}`);
  main.innerHTML = header('Lịch hẹn', '', `<button class="btn primary" id="newAppt">+ Đặt lịch</button>`) +
    `<div class="card"><div class="row"><button class="btn sm" id="prev">‹</button><input type="date" id="d" value="${date}" style="width:auto"><button class="btn sm" id="next">›</button>
    <button class="btn sm" id="tod">Hôm nay</button><span class="spacer"></span><select id="st" style="width:auto">${staffOptions(Number(staffId), 'Tất cả thợ')}</select></div></div>
    <div class="card"><h3>${dmy(date)} · ${rows.filter((r) => !['cancelled', 'noshow'].includes(r.status)).length} lịch</h3>${apptList(rows)}</div>`;
  const set = (d, s = staffId) => go('appointments', { date: d, ...(s ? { staff: s } : {}) });
  $('#prev').onclick = () => set(addDays(date, -1)); $('#next').onclick = () => set(addDays(date, 1));
  $('#tod').onclick = () => set(S.today); $('#d').onchange = (e) => set(e.target.value);
  $('#st').onchange = (e) => set(date, e.target.value);
  $('#newAppt').onclick = () => apptForm({ date }, () => VIEWS.appointments(main));
  bindApptList(main, () => VIEWS.appointments(main), rows);
};
function apptForm(a = {}, after) {
  const isEdit = !!a.id;
  openModal(isEdit ? 'Sửa lịch hẹn' : 'Đặt lịch hẹn', `<form id="af"><div class="form-grid">
    <div class="full"><label>Khách hàng có sẵn</label>${customerPicker('customer_id', a.customer_id ? { id: a.customer_id, code: a.customer_code || '', name: a.name } : null)}</div>
    <div><label>…hoặc tên khách mới</label><input name="guest_name" value="${esc(a.customer_id ? '' : a.guest_name || a.name || '')}"></div>
    <div><label>SĐT khách mới</label><input name="guest_phone" inputmode="tel" value="${esc(a.customer_id ? '' : a.guest_phone || a.phone || '')}"></div>
    <div><label>Ngày</label><input type="date" name="date" value="${a.date || S.today}" required></div>
    <div><label>Giờ</label><input type="time" name="time" value="${a.time || '09:00'}" step="900" required></div>
    <div><label>Thợ</label><select name="staff_id">${staffOptions(a.staff_id, 'Chưa chọn')}</select></div>
    <div><label>Thời lượng (phút)</label><input type="number" name="duration" value="${a.duration || 60}" min="15" step="15"></div>
    <div class="full"><label>Dịch vụ dự kiến</label><input name="service" list="svcList" value="${esc(a.service || '')}"><datalist id="svcList">${S.services.filter((s) => s.active).map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist></div>
    ${isEdit ? `<div class="full"><label>Trạng thái</label><select name="status">${Object.entries(APPT).map(([k, v]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>` : ''}
    <div class="full"><label>Ghi chú</label><textarea name="note">${esc(a.note || '')}</textarea></div></div>
    <div class="err"></div><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu lịch hẹn</button></div></form>`);
  bindPicker($('#af'));
  $('#af').onsubmit = (e) => {
    e.preventDefault();
    const btn = $('#af button.primary');
    guard(btn, async () => {
      const body = formData($('#af'));
      const send = (force) => api(isEdit ? '/appointments/' + a.id : '/appointments', { method: isEdit ? 'PUT' : 'POST', body: { ...body, force } });
      try { await send(false); } catch (er) { if (er.data && er.data.clash && confirm(er.message)) await send(true); else throw er; }
      closeModal(); toast('Đã lưu lịch hẹn'); (after || route)(); refreshReminderBadge();
    });
  };
}

// ---------- Khách hàng ----------
VIEWS.customers = async (main) => {
  const q = S.params.q || '';
  const r = await api('/customers?limit=200&q=' + encodeURIComponent(q));
  main.innerHTML = header('Khách hàng', `${r.total} khách`, `<button class="btn primary" id="newC">+ Khách mới</button>`) +
    `<div class="card"><input id="q" placeholder="Tìm theo tên, SĐT, mã khách…" value="${esc(q)}" type="search"></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Tên khách</th><th>SĐT</th><th class="num">Lượt</th><th>Lần gần nhất</th>${isMgr() ? '<th class="num">Tổng chi</th>' : ''}</tr></thead>
    <tbody>${r.rows.map((c) => `<tr class="click" data-c="${c.id}"><td class="muted">${esc(c.code)}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}</td>
      <td class="num">${c.visits}</td><td>${dmy(c.last_visit)}</td>${isMgr() ? `<td class="num">${money(c.spend)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    ${r.total > r.rows.length ? `<div class="muted small" style="margin-top:8px">Đang hiện ${r.rows.length}/${r.total} — gõ tìm kiếm để lọc.</div>` : ''}</div>`;
  let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => go('customers', e.target.value ? { q: e.target.value } : {}), 350); };
  if (q) { const i = $('#q'); i.focus(); i.setSelectionRange(q.length, q.length); }
  $$('[data-c]', main).forEach((tr) => (tr.onclick = () => go('customer', { id: tr.dataset.c })));
  $('#newC').onclick = () => customerForm({}, (id) => go('customer', { id }));
};
function customerForm(c = {}, after) {
  const isEdit = !!c.id;
  openModal(isEdit ? 'Sửa thông tin khách' : 'Khách mới', `<form id="cf"><div class="form-grid">
    <div><label>Tên khách *</label><input name="name" value="${esc(c.name || '')}" required></div>
    <div><label>Số điện thoại</label><input name="phone" inputmode="tel" value="${esc(c.phone || '')}"></div>
    <div><label>Sinh nhật</label><input type="date" name="birthday" value="${c.birthday && c.birthday.length === 10 ? c.birthday : ''}"></div>
    <div><label>Giới tính</label><select name="gender">${['', 'Nữ', 'Nam', 'Khác'].map((g) => `<option ${c.gender === g ? 'selected' : ''} value="${g}">${g || '—'}</option>`).join('')}</select></div>
    <div class="full"><label>Nguồn khách (Zalo, Facebook, giới thiệu…)</label><input name="source" value="${esc(c.source || '')}"></div>
    <div class="full"><label>Lưu ý tóc, da đầu (nền tóc, % bạc, dị ứng…)</label><textarea name="hair_notes">${esc(c.hair_notes || '')}</textarea></div>
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
      <div class="stat-line"><span class="muted">Số lượt</span><b>${c.stats.visits}</b></div>
      ${c.stats.spend != null ? `<div class="stat-line"><span class="muted">Tổng chi tiêu</span><b>${money(c.stats.spend)}</b></div>` : ''}
      <div class="stat-line"><span class="muted">Lần gần nhất</span><b>${dmy(c.stats.last_visit) || '—'}</b></div>
      <div class="stat-line"><span class="muted">Sinh nhật</span><b>${c.birthday ? (c.birthday.length === 10 ? dmy(c.birthday) : c.birthday.split('-').reverse().join('/')) : '<span class="badge warn">chưa có</span>'}</b></div>
      ${c.gender ? `<div class="stat-line"><span class="muted">Giới tính</span><b>${esc(c.gender)}</b></div>` : ''}
      ${c.source ? `<div class="stat-line"><span class="muted">Nguồn</span><b>${esc(c.source)}</b></div>` : ''}
      ${activeCards.map((k) => `<div class="stat-line"><span class="muted">💳 ${esc(k.name)} (${esc(k.code)})</span><b>${money(k.balance)}</b></div>`).join('')}
    </div><div class="card"><h3>Lưu ý tóc</h3><div class="pre">${esc(c.hair_notes || '—')}</div>
      ${(() => { const lv = c.visits.find((x) => x.formula); return lv ? `<h3 style="margin-top:12px">🧪 Công thức hóa chất gần nhất <span class="small muted">${dmy(lv.date)}</span></h3><div class="pre small">${esc(lv.formula)}</div>` : ''; })()}${c.notes ? `<h3 style="margin-top:12px">Ghi chú</h3><div class="pre">${esc(c.notes)}</div>` : ''}</div></div>
    <div class="card"><div class="tabs">${[['visits', `Lượt làm (${c.visits.length})`], ['photos', `Ảnh (${c.photos.length})`], ['cards', `Thẻ (${c.cards.length})`], ['appts', `Lịch hẹn (${c.appointments.length})`]]
      .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="tabBody"></div></div>`;
  const reload = () => VIEWS.customer(main);
  $$('[data-tab]').forEach((b) => (b.onclick = () => { history.replaceState({}, '', `#customer?id=${id}&tab=${b.dataset.tab}`); S.params.tab = b.dataset.tab; reload(); }));
  $('#eC').onclick = () => customerForm(c, reload);
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
    .map((s) => `<option value="${s.id}" data-price="${s.price}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${s.price ? ' · ' + (s.price / 1000) + 'k' : ''}</option>`).join('')}</optgroup>`).join('');
  let items = v.items ? v.items.map((i) => ({ service_id: i.service_id, name: i.name, price: i.price })) : [];
  if (!items.length) {
    const guess = v.service && S.services.find((s) => s.name === v.service);
    items = [guess ? { service_id: guess.id, price: guess.price } : { service_id: '', price: '' }];
  }
  const custSel = v.customer || (v.customer_id ? { id: v.customer_id, code: v.customer_code || '', name: v.customer_name || '' } : null);
  openModal(isEdit ? `Sửa lượt ${v.code}` : 'Ghi lượt làm / thu tiền', `<form id="vf"><div class="form-grid">
    <div class="full"><label>Khách hàng *</label>${customerPicker('customer_id', custSel)}</div>
    <div><label>Ngày</label><input type="date" name="date" value="${v.date || S.today}" ${!isMgr() ? 'readonly' : ''}></div>
    <div><label>Giờ</label><input type="time" name="time" value="${v.time || new Date().toTimeString().slice(0, 5)}"></div>
    <div><label>Thợ chính *</label><select name="main_staff_id" required>${staffOptions(v.main_staff_id || (!isMgr() ? S.me.id : null))}</select></div>
    <div><label>Người phụ</label><select name="assistant_id">${staffOptions(v.assistant_id, 'Không có')}</select></div>
    <div class="full"><label>Dịch vụ (giá sửa được)</label><div id="items"></div><button type="button" class="btn sm" id="addItem">+ Thêm dịch vụ</button></div>
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
    <div class="full"><label>Công thức / tỷ lệ pha</label><textarea name="formula">${esc(v.formula || '')}</textarea></div>
    <div class="full"><label>Kết quả sau làm</label><input name="result" value="${esc(v.result || '')}"></div>
    <div><label>Hẹn chăm sóc lại</label><input type="date" name="next_visit_date" value="${v.next_visit_date || ''}"></div>
    <div><label>Ghi chú</label><input name="note" value="${esc(v.note || '')}"></div>
    ${!isEdit ? `<div><label>📷 Ảnh trước</label><input type="file" accept="image/*" multiple id="phB"></div><div><label>📷 Ảnh sau</label><input type="file" accept="image/*" multiple id="phA"></div>` : ''}
    </div><div class="err"></div><div class="modal-foot">${isEdit && isMgr() ? '<button type="button" class="btn danger" id="delV">Xóa lượt</button><span class="spacer"></span>' : ''}
    <button type="button" class="btn" onclick="closeModal()">Hủy</button><button class="btn primary">Lưu lượt làm</button></div></form>`, true);
  const f = $('#vf');
  let cards = [];
  const renderItems = () => {
    $('#items').innerHTML = items.map((it, i) => `<div class="item-row"><select data-i="${i}" class="isvc">${svcOpts(it.service_id)}${!it.service_id && it.name ? `<option selected value="">${esc(it.name)}</option>` : ''}</select>
      <input type="number" data-i="${i}" class="iprice" min="0" step="1000" value="${it.price ?? ''}" placeholder="Giá"><button type="button" class="icon-btn" data-rm="${i}">×</button></div>`).join('');
    $$('.isvc', f).forEach((s) => (s.onchange = () => { const o = s.selectedOptions[0]; items[s.dataset.i] = { service_id: Number(s.value) || '', price: o && o.dataset.price ? Number(o.dataset.price) : '' }; renderItems(); }));
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
      <div class="row"><span><b>Khách trả thêm</b></span><span class="num big">${money(Math.max(0, total - cardPaid))}</span></div>`;
  };
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
      + (customerId ? `<div class="row small" style="margin-top:6px"><span class="muted">Khách dùng thẻ tặng của người khác?</span><input id="giftQ" placeholder="Mã thẻ (T1M-…) hoặc SĐT chủ thẻ" style="width:auto;flex:1;min-width:150px"><button type="button" class="btn sm" id="giftFind">Tìm thẻ</button></div>` : '');
    if (cards.length) { f.card_id.onchange = calc; f.card_paid.oninput = calc; }
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
  bindPicker(f, loadCards);
  $('#addItem').onclick = () => { items.push({ service_id: '', price: '' }); renderItems(); };
  for (const n of ['surcharge', 'discount']) f[n].oninput = calc;
  renderItems();
  loadCards(custSel && custSel.id);
  f.onsubmit = (e) => {
    e.preventDefault();
    guard($('#vf button.primary'), async () => {
      const d = formData(f);
      const body = { ...d, items: items.filter((i) => i.service_id || i.name).map((i) => ({ service_id: i.service_id || null, name: i.name, price: i.price === '' ? null : Number(i.price) })), appointment_id: v.appointment_id };
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
  const sec = (key, title, help, rows, line) => `<div class="card"><h3>${title} <span class="badge ${r.counts[key] ? 'bad' : ''}">${r.counts[key]}</span></h3><div class="small muted">${help}</div>
    ${rows.length ? rows.map((x) => `<div class="list-item" style="${x.done ? 'opacity:.5' : ''}"><div style="flex:1;min-width:0">${line(x)}<div class="small">${telLinks(x.phone)}</div></div>
      ${x.done ? '<span class="badge ok">Đã liên hệ</span>' : `<button class="btn sm" data-done='${esc(JSON.stringify({ customer_id: x.customer_id || x.id, type: key === 'birthdays' ? 'birthday' : key === 'cards' ? 'card' : key === 'returns' ? 'return' : 'appointment', ref: x.ref }))}'>Đã liên hệ</button>`}</div>`).join('') : '<div class="empty">Không có</div>'}</div>`;
  main.innerHTML = header('Nhắc nhở', 'Gọi / nhắn Zalo cho khách rồi bấm “Đã liên hệ”') + `<div class="grid two">
    ${sec('appointments', '📞 Xác nhận lịch ngày mai', 'Gọi trước để giảm khách không đến.', r.appointments, (a) => `<b>${esc(a.time)} · ${a.customer_id ? `<a href="#customer?id=${a.customer_id}">${esc(a.name)}</a>` : esc(a.name)}</b> <span class="muted small">${esc(a.service || '')} ${a.staff_name ? '· ' + esc(a.staff_name) : ''}</span>`)}
    <div class="card"><h3>❌ Khách hủy / không đến <span class="badge ${r.counts.cancels ? 'bad' : ''}">${r.counts.cancels}</span></h3><div class="small muted">14 ngày gần đây, khách chưa đặt lịch mới. Nhắn mời đặt lại rồi bấm “Đã mời”.</div>
      ${r.cancels.length ? r.cancels.map((a) => `<div class="list-item" style="${a.done ? 'opacity:.5' : ''}"><div style="flex:1;min-width:0">
        <b>${a.customer_id ? `<a href="#customer?id=${a.customer_id}">${esc(a.name)}</a>` : esc(a.name)}</b> <span class="badge ${APPT[a.status][1]}">${APPT[a.status][0]}</span>
        <div class="small muted">${esc(a.time)} ${dmy(a.date)}${a.staff_name ? ' · ' + esc(a.staff_name) : ''}${a.cancelled_by_name ? ' · ghi bởi ' + esc(a.cancelled_by_name) : ''}</div>
        <div class="small">Lý do: ${esc(a.cancel_reason || '—')}</div><div class="small">${telLinks(a.phone)}</div></div>
        <div class="row" style="flex-direction:column;align-items:flex-end"><button class="btn sm" data-inv="${a.id}">📋 Tin mời</button>
        ${a.done ? '<span class="badge ok">Đã mời</span>' : `<button class="btn sm" data-fu="${a.id}">Đã mời</button>`}</div></div>`).join('') : '<div class="empty">Không có</div>'}</div>
    ${sec('birthdays', '🎂 Sinh nhật sắp tới', 'Gửi lời chúc + ưu đãi sinh nhật.', r.birthdays, (c) => `<b><a href="#customer?id=${c.id}">${esc(c.name)}</a></b> <span class="badge warn">${c.date === S.today ? 'HÔM NAY' : dmy(c.date).slice(0, 5)}</span>`)}
    ${sec('cards', '💳 Thẻ trả trước', 'Thẻ sắp hết hạn → nhắc khách dùng; hết tiền → mời nạp thêm.', r.cards, (c) => `<b><a href="#customer?id=${c.id}">${esc(c.name)}</a></b> <span class="small">${esc(c.card_name)} · còn ${money(c.balance)}</span> <span class="badge warn">${esc(c.reason)}</span>`)}
    ${sec('returns', '🔁 Khách đến hạn quay lại', 'Đã quá số ngày cài đặt kể từ lần làm gần nhất và chưa có lịch hẹn.', r.returns, (c) => `<b><a href="#customer?id=${c.id}">${esc(c.name)}</a></b> <span class="small muted">lần cuối ${dmy(c.last_date)} · ${c.days} ngày · ${c.n} lượt</span>`)}
    </div>`;
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
function bindCardTable(root, cards, reload) {
  $$('[data-card]', root).forEach((b) => (b.onclick = async () => {
    const c = cards.find((x) => x.id === Number(b.dataset.card));
    const hist = await api(`/cards/${c.id}/history`);
    openModal(`Thẻ ${c.code} · ${c.name}`, `<div class="stat-line"><span class="muted">Giá bán / giá trị</span><b>${money(c.price)} / ${money(c.value)}</b></div>
      <div class="stat-line"><span class="muted">Số dư</span><b>${money(c.balance)}</b></div>
      <div class="stat-line"><span class="muted">Hạn dùng</span><b>${dmy(c.expires_at)}</b></div>
      ${c.commission != null ? `<div class="stat-line"><span class="muted">Hoa hồng bán thẻ</span><b>${money(c.commission)}</b></div>` : ''}
      <h3 style="margin-top:14px">Lịch sử dùng thẻ</h3>${hist.length ? `<table><tbody>${hist.map((h) => `<tr><td>${esc(h.created_at.slice(0, 10).split('-').reverse().join('/'))}</td><td>${esc(h.visit_code || h.note || '')}</td><td class="num">${money(h.amount)}</td><td class="small muted">${esc(h.by_name || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa dùng</div>'}
      ${isMgr() ? `<form id="cardEdit"><h3 style="margin-top:14px">Quản lý thẻ</h3><div class="form-grid">
        <div><label>Gia hạn đến</label><input type="date" name="expires_at" value="${c.expires_at || ''}"></div>
        <div><label>Trạng thái</label><select name="status"><option value="active" ${c.status === 'active' ? 'selected' : ''}>Đang dùng</option><option value="closed" ${c.status === 'closed' ? 'selected' : ''}>Đóng thẻ</option><option value="refunded" ${c.status === 'refunded' ? 'selected' : ''}>Hoàn tiền (thu hồi HH)</option></select></div>
        <div><label>Điều chỉnh số dư (+/−)</label><input type="number" name="amount" step="1000"></div><div><label>Lý do điều chỉnh</label><input name="note"></div></div>
        <div class="err"></div><div class="modal-foot"><button class="btn primary">Lưu</button></div></form>` : ''}`);
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

// ---------- Doanh số ----------
VIEWS.sales = async (main) => {
  const from = S.params.from || S.today.slice(0, 8) + '01', to = S.params.to || S.today;
  const r = await api(`/reports/sales?from=${from}&to=${to}`);
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
      <div class="small muted" style="margin-top:8px">Hoa hồng tạm tính theo % từng dịch vụ (Cài đặt › Dịch vụ) và % người phụ, bán thẻ (Cài đặt › Tham số). Chưa gồm lương cứng, thưởng mốc doanh số và chia tip.</div></div>`;
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

// ---------- Nhập / xuất Excel ----------
VIEWS.excel = async (main) => {
  main.innerHTML = header('Nhập / Xuất Excel') + `<div class="grid two">
    <div class="card"><h3>📥 Nhập từ Excel</h3>
      <div class="small muted">Nhận các mẫu: <b>Salon Nếp – Nhật ký</b> (khách, nhật ký dịch vụ, danh mục), <b>CRM Nếp Hair</b> (CRM Khách, lịch hẹn đã đặt), <b>Sổ đặt lịch</b> (tab Tháng 10, Tháng 11… + Quản lý Thẻ 1Tr) và file <b>xuất từ phần mềm này</b>.
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
        ${s.staff_created.length ? `<div class="small">Nhân viên lạ được tạo (không đăng nhập được): ${s.staff_created.map(esc).join(', ')}</div>` : ''}
        ${s.matched_by_name.length ? `<details class="small"><summary>${s.matched_by_name.length} khách ghép theo TÊN — nên kiểm tra</summary>${s.matched_by_name.map(esc).join(', ')}</details>` : ''}
        ${s.warnings.map((w) => `<div class="small" style="color:var(--warn)">⚠ ${esc(w)}</div>`).join('')}</div>`;
      if (!r.dry_run) { S.services = await api('/services'); S.staff = await api('/staff'); refreshReminderBadge(); }
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
    ['params', 'Tham số', isOwner()], ['audit', 'Nhật ký thao tác', isOwner()], ['backup', 'Sao lưu', isOwner()]].filter((t) => t[2]);
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
    const rows = await api('/audit?limit=500');
    const A = { login: 'Đăng nhập', create_visit: 'Ghi lượt', update_visit: 'SỬA lượt', delete_visit: 'XÓA lượt', create_customer: 'Thêm khách', update_customer: 'Sửa khách', delete_customer: 'Xóa khách',
      sell_card: 'Bán thẻ', update_card: 'Sửa thẻ', adjust_card: 'Điều chỉnh số dư thẻ', import_excel: 'Nhập Excel', export_excel: 'Xuất Excel', upload_photo: 'Tải ảnh', delete_photo: 'Xóa ảnh',
      create_appointment: 'Đặt lịch', update_appointment: 'Sửa lịch', appointment_status: 'Đổi trạng thái lịch', change_password: 'Đổi mật khẩu', reset_password: 'Đặt lại MK',
      create_user: 'Tạo tài khoản', update_user: 'Sửa tài khoản', update_settings: 'Sửa tham số', create_service: 'Thêm dịch vụ', update_service: 'Sửa dịch vụ', backup: 'Sao lưu', download_backup: 'Tải bản sao lưu' };
    const hot = ['update_visit', 'delete_visit', 'adjust_card', 'delete_customer', 'export_excel', 'update_card'];
    sb.innerHTML = `<div class="small muted" style="margin-bottom:8px">Các thao tác nhạy cảm (sửa/xóa lượt thu tiền, chỉnh thẻ, xuất dữ liệu) được tô đỏ.</div><div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người</th><th>Thao tác</th><th>Chi tiết</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="small">${esc(r.created_at)}</td><td>${esc(r.user_name || '')}</td><td>${hot.includes(r.action) ? `<span class="badge bad">${esc(A[r.action] || r.action)}</span>` : esc(A[r.action] || r.action)}${r.entity_id ? ` <span class="muted small">#${r.entity_id}</span>` : ''}</td>
      <td class="small" style="max-width:420px;word-break:break-word">${esc(r.detail || '')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  if (tab === 'backup') {
    const files = await api('/backups');
    sb.innerHTML = `<div class="small muted">Hệ thống tự sao lưu dữ liệu mỗi 6 giờ, giữ 30 bản gần nhất. Nên tải 1 bản về máy/Google Drive mỗi tuần. Ảnh khách lưu ở thư mục <code>data/photos</code> trên máy chủ.</div>
      <div class="row" style="margin:12px 0"><button class="btn primary" id="bk">Sao lưu ngay</button></div>
      <table><tbody>${files.map((f) => `<tr><td>${esc(f.file)}</td><td class="num">${(f.size / 1024).toFixed(0)} KB</td><td><a class="btn sm" href="/api/backups/${encodeURIComponent(f.file)}">Tải về</a></td></tr>`).join('') || '<tr><td class="empty">Chưa có</td></tr>'}</tbody></table>`;
    $('#bk').onclick = (e) => guard(e.target, async () => { await api('/backups', { method: 'POST' }); toast('Đã sao lưu'); reload(); });
  }
};

VIEWS.more = async (main) => {
  main.innerHTML = header('Thêm') + `<div class="card">${PAGES.filter((p) => p[3]() && !MOBILE.includes(p[0])).map((p) => `<button class="nav-btn" data-goto="${p[0]}"><span>${p[2]}</span>${p[1]}</button>`).join('')}
    <button class="nav-btn" id="mpw"><span>🔑</span>Đổi mật khẩu</button><button class="nav-btn" id="mlo"><span>🚪</span>Đăng xuất (${esc(S.me.full_name)})</button></div>`;
  $$('[data-goto]', main).forEach((b) => (b.onclick = () => go(b.dataset.goto)));
  $('#mpw').onclick = () => renderChangePw(false); $('#mlo').onclick = logout;
};

window.closeModal = closeModal;
boot();
