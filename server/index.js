'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db, DATA_DIR, getSettings, audit, nextCode, GROUPS, diffObj } = require('./db');
const L = require('./logic');
const { importWorkbook } = require('./importer');
const { exportWorkbook } = require('./exporter');
const { startBackups, backupNow } = require('./backup');
const staffMod = require('./staff');
const stockMod = require('./stock');

const { HttpError, bad, int, str, today } = L;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

const SESSION_DAYS = 14;
const COOKIE = 'nep_sid';
const secureCookie = process.env.COOKIE_SECURE === '1';

// ---------- Đăng nhập ----------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s || s.expires_at < Date.now()) return null;
  const u = db.prepare('SELECT id,username,full_name,role,active,can_login,must_change_pw FROM users WHERE id=?').get(s.user_id);
  if (!u || !u.active || !u.can_login) return null;
  u.token = token;
  return u;
}
const failed = new Map();
function tooMany(key) {
  const f = failed.get(key);
  return f && f.n >= 5 && Date.now() - f.t < 10 * 60 * 1000;
}
function noteFail(key) {
  const f = failed.get(key) || { n: 0, t: 0 };
  if (Date.now() - f.t > 10 * 60 * 1000) f.n = 0;
  f.n++; f.t = Date.now();
  failed.set(key, f);
}

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const key = username + '|' + req.ip;
  if (tooMany(key)) return res.status(429).json({ error: 'Sai mật khẩu quá 5 lần. Thử lại sau 10 phút.' });
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || !u.active || !u.can_login || !u.password_hash || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    noteFail(key);
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  }
  failed.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + SESSION_DAYS * 86400000);
  res.set('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureCookie ? '; Secure' : ''}`);
  audit(u.id, 'login', 'user', u.id, { ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.set('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

function auth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Chưa đăng nhập' });
  req.user = u;
  if (u.must_change_pw && !['/me', '/me/password'].includes(req.path)) {
    return res.status(403).json({ error: 'Cần đổi mật khẩu trước khi dùng', must_change_pw: true });
  }
  next();
}
const role = (...roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Bạn không có quyền làm việc này' }));
const MGR = role('owner', 'manager');
const OWNER = role('owner');
app.use('/api', auth);

app.get('/api/me', (req, res) => {
  const { token, ...u } = req.user;
  const s = getSettings();
  res.json({ user: { ...u, ...stockMod.perm(req.user) }, settings: { salon_name: s.salon_name, salon_address: s.salon_address, salon_phone: s.salon_phone, bank_info: s.bank_info, receipt_footer: s.receipt_footer, chat_keep_days: Number(s.chat_keep_days) || 90, payment_methods: s.payment_methods.split(',').map((x) => x.trim()) }, groups: GROUPS, today: today() });
});
app.post('/api/me/password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const { old_password, new_password } = req.body;
  if (!bcrypt.compareSync(String(old_password || ''), u.password_hash)) throw bad('Mật khẩu cũ không đúng');
  if (String(new_password || '').length < 6) throw bad('Mật khẩu mới tối thiểu 6 ký tự');
  if (new_password === old_password) throw bad('Mật khẩu mới phải khác mật khẩu cũ');
  db.prepare('UPDATE users SET password_hash=?, must_change_pw=0 WHERE id=?').run(bcrypt.hashSync(new_password, 10), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token!=?').run(u.id, req.user.token);
  audit(u.id, 'change_password', 'user', u.id);
  res.json({ ok: true });
});

// ---------- Tài khoản ----------
app.get('/api/staff', (req, res) => {
  res.json(db.prepare('SELECT id, full_name, role, active FROM users ORDER BY active DESC, id').all());
});
app.get('/api/users', OWNER, (req, res) => {
  res.json(db.prepare('SELECT id,username,full_name,role,active,can_login,must_change_pw,commission_enabled,aliases,created_at FROM users ORDER BY id').all());
});
function userInput(b) {
  const r = {};
  if (b.full_name != null) { r.full_name = str(b.full_name); if (!r.full_name) throw bad('Nhập họ tên'); }
  if (b.role != null) { if (!['owner', 'manager', 'staff'].includes(b.role)) throw bad('Vai trò không hợp lệ'); r.role = b.role; }
  for (const k of ['active', 'can_login', 'commission_enabled']) if (b[k] != null) r[k] = b[k] ? 1 : 0;
  if (b.aliases != null) r.aliases = str(b.aliases);
  return r;
}
app.post('/api/users', OWNER, (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._]{3,30}$/.test(username)) throw bad('Tên đăng nhập 3–30 ký tự, chỉ chữ thường không dấu, số, dấu chấm');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw bad('Tên đăng nhập đã tồn tại');
  const r = userInput({ role: 'staff', ...req.body });
  const pw = String(req.body.password || '');
  if (pw.length < 6) throw bad('Mật khẩu tối thiểu 6 ký tự');
  const id = db.prepare('INSERT INTO users(username,full_name,role,password_hash,commission_enabled,aliases) VALUES (?,?,?,?,?,?)')
    .run(username, r.full_name, r.role, bcrypt.hashSync(pw, 10), r.commission_enabled ?? 1, r.aliases ?? null).lastInsertRowid;
  audit(req.user.id, 'create_user', 'user', id, { username, role: r.role });
  res.json({ id });
});
app.put('/api/users/:id', OWNER, (req, res) => {
  const id = int(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!target) throw new HttpError(404, 'Không tìm thấy');
  const r = userInput(req.body);
  if (id === req.user.id && ((r.role && r.role !== 'owner') || r.active === 0)) throw bad('Không thể tự hạ quyền hoặc khóa chính mình');
  const keys = Object.keys(r);
  if (keys.length) db.prepare(`UPDATE users SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => r[k]), id);
  if (r.active === 0 || r.can_login === 0) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(req.user.id, 'update_user', 'user', id, r);
  res.json({ ok: true });
});
app.post('/api/users/:id/reset-password', OWNER, (req, res) => {
  const id = int(req.params.id);
  const pw = String(req.body.password || '');
  if (pw.length < 6) throw bad('Mật khẩu tối thiểu 6 ký tự');
  db.prepare('UPDATE users SET password_hash=?, must_change_pw=1 WHERE id=?').run(bcrypt.hashSync(pw, 10), id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(req.user.id, 'reset_password', 'user', id);
  res.json({ ok: true });
});

// ---------- Cài đặt ----------
app.get('/api/settings', MGR, (req, res) => res.json(getSettings()));
app.put('/api/settings', OWNER, (req, res) => {
  const allowed = ['salon_name', 'salon_address', 'salon_phone', 'bank_info', 'receipt_footer', 'return_days', 'birthday_days', 'card_expiry_days', 'card_low_balance', 'assistant_rate', 'card_new_rate', 'card_renewal_rate', 'payment_methods'];
  const up = db.prepare('UPDATE settings SET value=? WHERE key=?');
  for (const k of allowed) if (req.body[k] != null) up.run(String(req.body[k]).trim(), k);
  audit(req.user.id, 'update_settings', 'settings', null, req.body);
  res.json(getSettings());
});

// ---------- Dịch vụ & gói thẻ ----------
app.get('/api/services', (req, res) => res.json(db.prepare('SELECT * FROM services ORDER BY active DESC, grp, name').all()));
function serviceInput(b) {
  const name = str(b.name); if (!name) throw bad('Nhập tên dịch vụ');
  const grp = GROUPS.includes(b.grp) ? b.grp : 'Cắt';
  const rate = Number(b.commission_rate || 0);
  if (!(rate >= 0 && rate <= 1)) throw bad('Tỷ lệ hoa hồng 0–100%');
  return [name, Math.max(0, int(b.price)), grp, rate, b.active === false || b.active === 0 ? 0 : 1];
}
app.post('/api/services', MGR, (req, res) => {
  const v = serviceInput(req.body);
  if (db.prepare('SELECT 1 FROM services WHERE name=?').get(v[0])) throw bad('Dịch vụ đã tồn tại');
  const id = db.prepare('INSERT INTO services(name,price,grp,commission_rate,active) VALUES (?,?,?,?,?)').run(...v).lastInsertRowid;
  audit(req.user.id, 'create_service', 'service', id, req.body);
  res.json({ id });
});
app.put('/api/services/:id', MGR, (req, res) => {
  const v = serviceInput(req.body);
  db.prepare('UPDATE services SET name=?,price=?,grp=?,commission_rate=?,active=? WHERE id=?').run(...v, int(req.params.id));
  audit(req.user.id, 'update_service', 'service', int(req.params.id), req.body);
  res.json({ ok: true });
});
app.get('/api/card-types', (req, res) => res.json(db.prepare('SELECT * FROM card_types ORDER BY price').all()));
function cardTypeInput(b) {
  const name = str(b.name); if (!name) throw bad('Nhập tên gói thẻ');
  const price = int(b.price), value = int(b.value), months = int(b.months);
  if (price <= 0 || value <= 0 || months <= 0) throw bad('Giá bán, giá trị và số tháng phải > 0');
  return [name, price, value, months, b.active === false || b.active === 0 ? 0 : 1];
}
app.post('/api/card-types', MGR, (req, res) => {
  const id = db.prepare('INSERT INTO card_types(name,price,value,months,active) VALUES (?,?,?,?,?)').run(...cardTypeInput(req.body)).lastInsertRowid;
  audit(req.user.id, 'create_card_type', 'card_type', id, req.body);
  res.json({ id });
});
app.put('/api/card-types/:id', MGR, (req, res) => {
  db.prepare('UPDATE card_types SET name=?,price=?,value=?,months=?,active=? WHERE id=?').run(...cardTypeInput(req.body), int(req.params.id));
  audit(req.user.id, 'update_card_type', 'card_type', int(req.params.id), req.body);
  res.json({ ok: true });
});

// ---------- Khách hàng ----------
app.get('/api/customers', (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(500, int(req.query.limit) || 100);
  const offset = Math.max(0, int(req.query.offset));
  let where = 'c.deleted=0';
  const params = [];
  if (q) {
    where += ' AND (c.name LIKE ? OR c.code LIKE ? OR c.phone LIKE ? OR c.formula LIKE ? OR c.hair_notes LIKE ?)';
    const digits = q.replace(/\D/g, '');
    params.push(`%${q}%`, `%${q}%`, `%${digits || q}%`, `%${q}%`, `%${q}%`);
  }
  const sf = req.query.staff_id === 'mine' ? req.user.id : req.query.staff_id === 'none' ? 'none' : int(req.query.staff_id);
  if (sf === 'none') where += ' AND c.staff_id IS NULL';
  else if (sf) { where += ' AND c.staff_id=?'; params.push(sf); }
  const rows = db.prepare(`SELECT c.id,c.code,c.name,c.phone,c.gender,c.birthday,c.source,c.staff_id,c.formula,c.formula_at,
      (SELECT COUNT(*) FROM visits v WHERE v.customer_id=c.id AND v.status='done') visits,
      (SELECT MAX(date) FROM visits v WHERE v.customer_id=c.id AND v.status='done') last_visit,
      (SELECT COALESCE(SUM(total),0) FROM visits v WHERE v.customer_id=c.id AND v.status='done') spend
    FROM customers c WHERE ${where} ORDER BY (last_visit IS NULL), last_visit DESC, c.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) n FROM customers c WHERE ${where}`).get(...params).n;
  if (req.user.role === 'staff') for (const r of rows) r.spend = null;
  res.json({ rows, total });
});
function customerInput(b) {
  const name = str(b.name); if (!name) throw bad('Nhập tên khách');
  const phone = L.normPhone(b.phone);
  if (phone && !/^0\d{9,10}$/.test(phone)) throw bad('Số điện thoại không hợp lệ');
  let birthday = str(b.birthday);
  if (birthday && !/^(\d{4}-)?\d{2}-\d{2}$/.test(birthday)) throw bad('Ngày sinh dạng YYYY-MM-DD');
  return { name, phone, gender: str(b.gender), birthday, source: str(b.source), hair_notes: str(b.hair_notes), notes: str(b.notes),
    staff_id: int(b.staff_id) || null, formula: str(b.formula) };
}
app.post('/api/customers', (req, res) => {
  const c = customerInput(req.body);
  if (c.phone) {
    const dup = db.prepare('SELECT code,name FROM customers WHERE phone=? AND deleted=0').get(c.phone);
    if (dup && !req.body.allow_duplicate) return res.status(409).json({ error: `SĐT đã có: ${dup.code} – ${dup.name}`, duplicate: dup });
  }
  const code = nextCode('customers', 'KH', 4);
  const id = db.prepare('INSERT INTO customers(code,name,phone,gender,birthday,source,hair_notes,notes,created_by,staff_id,formula,formula_at,formula_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(code, c.name, c.phone, c.gender, c.birthday, c.source, c.hair_notes, c.notes, req.user.id, c.staff_id, c.formula, c.formula ? today() : null, c.formula ? req.user.id : null).lastInsertRowid;
  audit(req.user.id, 'create_customer', 'customer', id, { code, name: c.name });
  res.json({ id, code });
});
app.get('/api/customers/:id', (req, res) => {
  const id = int(req.params.id);
  const c = db.prepare(`SELECT c.*, s.full_name staff_name, f.full_name formula_by_name FROM customers c LEFT JOIN users s ON s.id=c.staff_id
    LEFT JOIN users f ON f.id=c.formula_by WHERE c.id=? AND c.deleted=0`).get(id);
  if (!c) throw new HttpError(404, 'Không tìm thấy khách');
  const visits = db.prepare("SELECT id FROM visits WHERE customer_id=? AND status='done' ORDER BY date DESC, id DESC").all(id)
    .map((v) => L.maskVisitMoney(L.getVisit(v.id), req.user));
  c.visits = visits;
  c.photos = db.prepare('SELECT p.id,p.kind,p.visit_id,p.created_at,v.date FROM photos p LEFT JOIN visits v ON v.id=p.visit_id WHERE p.customer_id=? ORDER BY p.id DESC').all(id);
  c.cards = db.prepare('SELECT * FROM cards WHERE customer_id=? ORDER BY id DESC').all(id).map(L.cardRow);
  c.appointments = db.prepare(`SELECT a.*, u.full_name staff_name FROM appointments a LEFT JOIN users u ON u.id=a.staff_id
    WHERE a.customer_id=? ORDER BY a.date DESC, a.time DESC LIMIT 30`).all(id);
  c.stats = { visits: visits.length, spend: req.user.role === 'staff' ? null : visits.reduce((s, v) => s + (v.total || 0), 0), last_visit: visits[0] ? visits[0].date : null };
  res.json(c);
});
app.put('/api/customers/:id', (req, res) => {
  const id = int(req.params.id);
  const before = db.prepare('SELECT * FROM customers WHERE id=? AND deleted=0').get(id);
  if (!before) throw new HttpError(404, 'Không tìm thấy khách');
  const c = customerInput(req.body);
  if (req.user.role === 'staff' || !('staff_id' in req.body)) c.staff_id = before.staff_id; // chỉ quản lý đổi thợ phụ trách
  if (!('formula' in req.body)) c.formula = before.formula;
  db.prepare('UPDATE customers SET name=?,phone=?,gender=?,birthday=?,source=?,hair_notes=?,notes=?,staff_id=?,formula=? WHERE id=?')
    .run(c.name, c.phone, c.gender, c.birthday, c.source, c.hair_notes, c.notes, c.staff_id, c.formula, id);
  if ((before.formula || null) !== (c.formula || null)) db.prepare('UPDATE customers SET formula_at=?, formula_by=? WHERE id=?').run(today(), req.user.id, id);
  const changed = {};
  for (const k of Object.keys(c)) if ((before[k] || null) !== (c[k] || null)) changed[k] = [before[k], c[k]];
  audit(req.user.id, 'update_customer', 'customer', id, { changes: changed });
  res.json({ ok: true });
});
// Thông tin nhanh khi chọn khách ở phiếu thu / đặt lịch: thợ phụ trách, công thức, lưu ý tóc
app.get('/api/customers/:id/brief', (req, res) => {
  const c = db.prepare(`SELECT c.id, c.code, c.name, c.staff_id, c.formula, c.formula_at, c.hair_notes, s.full_name staff_name, f.full_name formula_by_name
    FROM customers c LEFT JOIN users s ON s.id=c.staff_id LEFT JOIN users f ON f.id=c.formula_by WHERE c.id=? AND c.deleted=0`).get(int(req.params.id));
  if (!c) throw new HttpError(404, 'Không tìm thấy khách');
  res.json(c);
});
app.delete('/api/customers/:id', OWNER, (req, res) => {
  const id = int(req.params.id);
  db.prepare('UPDATE customers SET deleted=1 WHERE id=?').run(id);
  audit(req.user.id, 'delete_customer', 'customer', id);
  res.json({ ok: true });
});

// ---------- Tìm kiếm nhanh: khách, thẻ, lịch hẹn, lượt làm ----------
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ customers: [], cards: [], appointments: [], visits: [] });
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, '');
  const ph = digits.length >= 3 ? `%${digits}%` : '%%NOPE%%';
  const customers = db.prepare(`SELECT id, code, name, phone,
      (SELECT MAX(date) FROM visits v WHERE v.customer_id=c.id AND v.status='done') last_visit
    , (SELECT full_name FROM users u WHERE u.id=c.staff_id) staff_name, formula
    FROM customers c WHERE deleted=0 AND (name LIKE ? OR code LIKE ? OR phone LIKE ? OR formula LIKE ?) ORDER BY name LIMIT 10`).all(like, like, ph, like);
  const cards = db.prepare(`SELECT cd.id, cd.code, cd.name, cd.status, cd.expires_at, cd.customer_id, c.name customer_name, c.phone
    FROM cards cd JOIN customers c ON c.id=cd.customer_id WHERE cd.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ? ORDER BY cd.id DESC LIMIT 10`).all(like, like, ph)
    .map((c) => ({ ...c, balance: L.cardBalance(c.id) }));
  const appointments = db.prepare(`SELECT a.id, a.date, a.time, a.status, a.service, a.customer_id, COALESCE(c.name,a.guest_name) name, COALESCE(c.phone,a.guest_phone) phone, u.full_name staff_name
    FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id
    WHERE a.date >= ? AND (COALESCE(c.name,a.guest_name) LIKE ? OR COALESCE(c.phone,a.guest_phone) LIKE ? OR a.service LIKE ? OR a.note LIKE ?)
    ORDER BY a.date, a.time LIMIT 10`).all(L.addDays(today(), -30), like, ph, like, like);
  const visits = db.prepare(`SELECT v.id, v.code, v.date, v.customer_id, c.name customer_name,
      (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id) services
    FROM visits v JOIN customers c ON c.id=v.customer_id WHERE v.status='done' AND (v.code LIKE ? OR v.formula LIKE ? OR v.note LIKE ?
      OR EXISTS (SELECT 1 FROM visit_items i WHERE i.visit_id=v.id AND i.name LIKE ?))
    ORDER BY v.date DESC, v.id DESC LIMIT 10`).all(like, like, like, like);
  res.json({ customers, cards, appointments, visits });
});

// ---------- Lịch hẹn ----------
app.get('/api/appointments', (req, res) => {
  const from = L.isDate(req.query.from) ? req.query.from : today();
  const to = L.isDate(req.query.to) ? req.query.to : from;
  const params = [from, to];
  let extra = '';
  if (req.query.staff_id) { extra = ' AND a.staff_id=?'; params.push(int(req.query.staff_id)); }
  const u = req.user;
  res.json(db.prepare(`SELECT a.*, COALESCE(c.name,a.guest_name) name, COALESCE(c.phone,a.guest_phone) phone, c.code customer_code, u.full_name staff_name,
      v.total visit_total, v.main_staff_id v_main, v.assistant_id v_asst, (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id) visit_services
    FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id
    LEFT JOIN visits v ON v.id=a.visit_id AND v.status='done'
    WHERE a.date BETWEEN ? AND ?${extra} ORDER BY a.date, a.time`).all(...params)
    .map(({ v_main, v_asst, ...a }) => (u.role === 'staff' && v_main !== u.id && v_asst !== u.id ? { ...a, visit_total: null } : a)));
});
function offWarning(a) {
  const o = staffMod.offAt(a.staff_id, a.date, a.time, a.duration);
  if (!o) return null;
  const name = db.prepare('SELECT full_name FROM users WHERE id=?').get(a.staff_id).full_name;
  return `${name} nghỉ ${o.from_time ? o.from_time + '–' + o.to_time : 'cả ngày'} ${a.date.split('-').reverse().join('/')}${o.reason ? ' (' + o.reason + ')' : ''}. Vẫn đặt?`;
}
function apptInput(b) {
  if (!L.isDate(b.date)) throw bad('Chọn ngày hẹn');
  if (!/^\d{2}:\d{2}$/.test(String(b.time || ''))) throw bad('Chọn giờ hẹn');
  const customerId = int(b.customer_id) || null;
  const guestName = str(b.guest_name);
  if (!customerId && !guestName) throw bad('Chọn khách hoặc nhập tên khách mới');
  const status = ['booked', 'arrived', 'done', 'cancelled', 'noshow'].includes(b.status) ? b.status : 'booked';
  return { customer_id: customerId, guest_name: customerId ? null : guestName, guest_phone: customerId ? null : L.normPhone(b.guest_phone),
    staff_id: int(b.staff_id) || null, date: b.date, time: b.time, duration: Math.max(15, int(b.duration) || 60), service: str(b.service), status, note: str(b.note) };
}
app.post('/api/appointments', (req, res) => {
  const a = apptInput(req.body);
  if (a.staff_id) {
    const clash = db.prepare("SELECT time FROM appointments WHERE staff_id=? AND date=? AND time=? AND status IN ('booked','arrived')").get(a.staff_id, a.date, a.time);
    if (clash && !req.body.force) return res.status(409).json({ error: 'Thợ này đã có lịch lúc ' + a.time + '. Vẫn đặt?', clash: true });
    const w = offWarning(a); if (w && !req.body.force) return res.status(409).json({ error: w, clash: true });
  }
  const cols = Object.keys(a);
  const id = db.prepare(`INSERT INTO appointments(${cols.join(',')},created_by) VALUES (${cols.map(() => '?').join(',')},?)`).run(...cols.map((k) => a[k]), req.user.id).lastInsertRowid;
  audit(req.user.id, 'create_appointment', 'appointment', id, { date: a.date, time: a.time });
  res.json({ id });
});
app.put('/api/appointments/:id', (req, res) => {
  const id = int(req.params.id);
  if (!db.prepare('SELECT 1 FROM appointments WHERE id=?').get(id)) throw new HttpError(404, 'Không tìm thấy lịch hẹn');
  const a = apptInput(req.body);
  const old = db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  if (a.staff_id && ['booked', 'arrived'].includes(a.status) && (a.staff_id !== old.staff_id || a.date !== old.date || a.time !== old.time)) {
    const w = offWarning(a); if (w && !req.body.force) return res.status(409).json({ error: w, clash: true });
  }
  if (['cancelled', 'noshow'].includes(a.status) && !['cancelled', 'noshow'].includes(old.status)) {
    Object.assign(a, cancelFields(a.status, req.body.cancel_reason, req.user));
  }
  const cols = Object.keys(a);
  db.prepare(`UPDATE appointments SET ${cols.map((k) => k + '=?').join(',')} WHERE id=?`).run(...cols.map((k) => a[k]), id);
  audit(req.user.id, 'update_appointment', 'appointment', id, { changes: diffObj(old, a, Object.keys(a).filter((k) => !/^cancel/.test(k))) });
  res.json({ ok: true });
});
app.post('/api/appointments/:id/status', (req, res) => {
  const id = int(req.params.id);
  const st = req.body.status;
  if (!['booked', 'arrived', 'done', 'cancelled', 'noshow'].includes(st)) throw bad('Trạng thái không hợp lệ');
  if (!db.prepare('SELECT 1 FROM appointments WHERE id=?').get(id)) throw new HttpError(404, 'Không tìm thấy lịch hẹn');
  if (['cancelled', 'noshow'].includes(st)) {
    const f = cancelFields(st, req.body.reason, req.user);
    db.prepare('UPDATE appointments SET status=?, cancel_reason=?, cancelled_at=?, cancelled_by=?, followup_at=NULL WHERE id=?')
      .run(st, f.cancel_reason, f.cancelled_at, f.cancelled_by, id);
  } else {
    db.prepare('UPDATE appointments SET status=? WHERE id=?').run(st, id);
  }
  audit(req.user.id, 'appointment_status', 'appointment', id, { status: st, reason: str(req.body.reason) });
  res.json({ ok: true });
});
// Khách vãng lai đặt lịch → tự tạo hồ sơ khách (hoặc nhận khách cũ trùng SĐT) để thu tiền, ghi doanh số
app.post('/api/appointments/:id/customer', (req, res) => {
  const id = int(req.params.id);
  const a = db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  if (!a) throw new HttpError(404, 'Không tìm thấy lịch hẹn');
  if (a.customer_id) {
    const c = db.prepare('SELECT id, code, name FROM customers WHERE id=?').get(a.customer_id);
    return res.json({ ...c, created: false });
  }
  const phone = L.normPhone(a.guest_phone);
  let c = phone ? db.prepare('SELECT id, code, name FROM customers WHERE phone=? AND deleted=0').get(phone) : null;
  let created = false;
  if (!c) {
    const name = str(a.guest_name) || 'Khách lẻ';
    const code = nextCode('customers', 'KH', 4);
    const cid = db.prepare('INSERT INTO customers(code,name,phone,source,created_by) VALUES (?,?,?,?,?)')
      .run(code, name, phone && /^0\d{9,10}$/.test(phone) ? phone : null, 'Đặt lịch', req.user.id).lastInsertRowid;
    audit(req.user.id, 'create_customer', 'customer', cid, { code, name, from_appointment: id });
    c = { id: cid, code, name }; created = true;
  }
  db.prepare('UPDATE appointments SET customer_id=?, guest_name=NULL, guest_phone=NULL WHERE id=?').run(c.id, id);
  res.json({ ...c, created });
});
function cancelFields(status, reason, user) {
  const r = str(reason);
  if (status === 'cancelled' && !r) throw bad('Ghi lý do khách hủy lịch');
  return { cancel_reason: r || 'Khách không đến', cancelled_at: L.localDate(new Date()) + ' ' + new Date().toTimeString().slice(0, 5), cancelled_by: user.id };
}
// Đánh dấu đã nhắn/gọi mời khách hủy lịch đặt lại
app.post('/api/appointments/:id/followup', (req, res) => {
  const id = int(req.params.id);
  db.prepare('UPDATE appointments SET followup_at=? WHERE id=?').run(L.localDate(new Date()), id);
  res.json({ ok: true });
});

// ---------- Lượt làm ----------
app.get('/api/visits', (req, res) => {
  const from = L.isDate(req.query.from) ? req.query.from : today();
  const to = L.isDate(req.query.to) ? req.query.to : from;
  const params = [from, to];
  let extra = '';
  if (req.query.staff_id) { extra += ' AND (v.main_staff_id=? OR v.assistant_id=?)'; params.push(int(req.query.staff_id), int(req.query.staff_id)); }
  const rows = db.prepare(`SELECT v.id FROM visits v WHERE v.status='done' AND v.date BETWEEN ? AND ?${extra} ORDER BY v.date DESC, v.time DESC, v.id DESC LIMIT 1000`).all(...params);
  res.json(rows.map((r) => {
    const v = L.maskVisitMoney(L.getVisit(r.id), req.user);
    v.can_edit = L.canEditVisit(req.user, v);
    return v;
  }));
});
// Hóa đơn cho khách: dữ liệu lượt + thông tin salon + số dư thẻ sau khi trừ
app.get('/api/visits/:id/receipt', (req, res) => {
  const v = L.getVisit(int(req.params.id));
  if (!v || v.status !== 'done') throw new HttpError(404, 'Không tìm thấy lượt làm');
  if (L.maskVisitMoney(v, req.user).masked) throw new HttpError(403, 'Chỉ thợ làm lượt này hoặc quản lý mới xem được hóa đơn');
  const s = getSettings();
  res.json({ visit: v, card_balance: v.card_id ? L.cardBalance(v.card_id) : null,
    salon: { name: s.salon_name, address: s.salon_address, phone: s.salon_phone, bank_info: s.bank_info, footer: s.receipt_footer } });
});
app.get('/api/visits/:id', (req, res) => {
  const v = L.getVisit(int(req.params.id));
  if (!v || v.status !== 'done') throw new HttpError(404, 'Không tìm thấy lượt làm');
  const out = L.maskVisitMoney(v, req.user);
  out.can_edit = L.canEditVisit(req.user, v);
  res.json(out);
});
app.post('/api/visits', (req, res) => {
  const { import_ref, ...body } = req.body;
  void import_ref;
  const id = L.saveVisit(body, req.user, null);
  res.json(L.getVisit(id));
});
app.put('/api/visits/:id', (req, res) => {
  const v = db.prepare("SELECT * FROM visits WHERE id=? AND status='done'").get(int(req.params.id));
  if (!v) throw new HttpError(404, 'Không tìm thấy lượt làm');
  if (req.user.role === 'staff') L.updateVisitNotes(req.body, req.user, v); // nhân viên: chỉ ghi chú, không sửa tiền
  else L.saveVisit(req.body, req.user, v);
  res.json(L.getVisit(v.id));
});
app.delete('/api/visits/:id', MGR, (req, res) => {
  L.deleteVisit(int(req.params.id), req.body && req.body.reason, req.user);
  res.json({ ok: true });
});

// ---------- Ảnh trước / sau ----------
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});
function sniffImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
app.post('/api/customers/:id/photos', upload.array('photos', 10), (req, res) => {
  const customerId = int(req.params.id);
  if (!db.prepare('SELECT 1 FROM customers WHERE id=? AND deleted=0').get(customerId)) throw new HttpError(404, 'Không tìm thấy khách');
  const kind = ['before', 'after', 'other'].includes(req.body.kind) ? req.body.kind : 'other';
  const visitId = int(req.body.visit_id) || null;
  if (visitId && !db.prepare('SELECT 1 FROM visits WHERE id=? AND customer_id=?').get(visitId, customerId)) throw bad('Lượt làm không thuộc khách này');
  if (!req.files || !req.files.length) throw bad('Chưa chọn ảnh (jpg/png/webp, tối đa 8MB)');
  const dir = path.join(PHOTO_DIR, String(customerId));
  fs.mkdirSync(dir, { recursive: true });
  const ids = [];
  for (const f of req.files) {
    const ext = sniffImage(f.buffer);
    if (!ext) continue;
    const name = `${String(customerId)}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(PHOTO_DIR, name), f.buffer);
    ids.push(db.prepare('INSERT INTO photos(customer_id,visit_id,kind,file,created_by) VALUES (?,?,?,?,?)').run(customerId, visitId, kind, name, req.user.id).lastInsertRowid);
  }
  if (!ids.length) throw bad('File không phải ảnh hợp lệ');
  audit(req.user.id, 'upload_photo', 'customer', customerId, { count: ids.length, kind, visit_id: visitId });
  res.json({ ids });
});
app.get('/api/photos/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id=?').get(int(req.params.id));
  if (!p) throw new HttpError(404, 'Không có ảnh');
  const file = path.join(PHOTO_DIR, p.file);
  if (!file.startsWith(PHOTO_DIR + path.sep) || !fs.existsSync(file)) throw new HttpError(404, 'Mất file ảnh');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});
app.delete('/api/photos/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id=?').get(int(req.params.id));
  if (!p) throw new HttpError(404, 'Không có ảnh');
  if (req.user.role === 'staff' && p.created_by !== req.user.id) throw new HttpError(403, 'Chỉ xóa được ảnh mình tải lên');
  db.prepare('DELETE FROM photos WHERE id=?').run(p.id);
  try { fs.unlinkSync(path.join(PHOTO_DIR, p.file)); } catch { /* đã mất */ }
  audit(req.user.id, 'delete_photo', 'customer', p.customer_id, { photo_id: p.id });
  res.json({ ok: true });
});

// ---------- Thẻ trả trước ----------
app.get('/api/cards', (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.customer_id) { where += ' AND cd.customer_id=?'; params.push(int(req.query.customer_id)); }
  if (req.query.status) { where += ' AND cd.status=?'; params.push(String(req.query.status)); }
  if (req.query.q) { const q = String(req.query.q).trim(); where += " AND cd.sale_type='gift' AND (UPPER(cd.code)=UPPER(?) OR c.phone=?)"; params.push(q, L.normPhone(q)); }
  const rows = db.prepare(`SELECT cd.*, c.name customer_name, c.code customer_code, c.phone, u.full_name seller_name
    FROM cards cd JOIN customers c ON c.id=cd.customer_id LEFT JOIN users u ON u.id=cd.seller_id WHERE ${where} ORDER BY cd.id DESC`).all(...params);
  res.json(rows.map(L.cardRow).map((c) => (req.user.role === 'staff' && c.seller_id !== req.user.id ? { ...c, commission: null } : c)));
});
app.post('/api/cards', (req, res) => res.json(L.sellCard(req.body, req.user)));
app.get('/api/cards/:id/history', (req, res) => {
  const id = int(req.params.id);
  res.json(db.prepare(`SELECT t.*, v.code visit_code, v.date visit_date, u.full_name by_name FROM card_txns t
    LEFT JOIN visits v ON v.id=t.visit_id LEFT JOIN users u ON u.id=t.created_by WHERE t.card_id=? ORDER BY t.id DESC`).all(id));
});
app.put('/api/cards/:id', MGR, (req, res) => {
  const id = int(req.params.id);
  const c = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
  if (!c) throw new HttpError(404, 'Không tìm thấy thẻ');
  const expires = L.isDate(req.body.expires_at) ? req.body.expires_at : c.expires_at;
  const status = ['active', 'closed', 'refunded'].includes(req.body.status) ? req.body.status : c.status;
  db.prepare('UPDATE cards SET expires_at=?, status=?, note=? WHERE id=?').run(expires, status, str(req.body.note) ?? c.note, id);
  if (status === 'refunded' && c.status !== 'refunded') db.prepare('UPDATE cards SET commission=0 WHERE id=?').run(id);
  audit(req.user.id, 'update_card', 'card', id, { expires_at: [c.expires_at, expires], status: [c.status, status] });
  res.json({ ok: true });
});
app.post('/api/cards/:id/adjust', MGR, (req, res) => {
  const id = int(req.params.id);
  const amount = int(req.body.amount);
  if (!amount) throw bad('Nhập số tiền điều chỉnh (+ cộng, - trừ)');
  if (!str(req.body.note)) throw bad('Ghi lý do điều chỉnh');
  if (L.cardBalance(id) + amount < 0) throw bad('Số dư không đủ');
  db.prepare('INSERT INTO card_txns(card_id,amount,note,created_by) VALUES (?,?,?,?)').run(id, amount, str(req.body.note), req.user.id);
  audit(req.user.id, 'adjust_card', 'card', id, { amount, note: req.body.note });
  res.json({ ok: true, balance: L.cardBalance(id) });
});

// ---------- Báo cáo, nhắc nhở, tổng quan ----------
app.get('/api/reports/sales', (req, res) => {
  const t = today();
  const from = L.isDate(req.query.from) ? req.query.from : t.slice(0, 8) + '01';
  const to = L.isDate(req.query.to) ? req.query.to : t;
  res.json(L.salesReport(from, to, req.user));
});
app.get('/api/reminders', (req, res) => {
  const r = L.reminders();
  if (stockMod.perm(req.user).stock_view) { r.stock = stockMod.stockAlerts(); r.counts.stock = r.stock.filter((m) => !m.ordered_at).length; }
  if (req.user.role !== 'staff') { const f = require('./expenses').fundState(); r.counts.expenses = f.pending_count; r.expenses = f; }
  res.json(r);
});
// Khách phụ trách theo thợ: nhân viên chỉ xem dòng của mình, không có số tiền
app.get('/api/reports/staff-customers', (req, res) => {
  const t = today();
  const from = L.isDate(req.query.from) ? req.query.from : t.slice(0, 8) + '01';
  const to = L.isDate(req.query.to) ? req.query.to : t;
  const r = L.staffCustomerReport(from, to);
  if (!['owner', 'manager'].includes(req.user.role)) {
    r.rows = r.rows.filter((x) => x.staff_id === req.user.id).map((x) => ({ ...x, spend_period: null, avg_spend: null }));
  }
  res.json(r);
});
// Bàn giao toàn bộ khách từ thợ này sang thợ khác (thợ nghỉ việc, chia lại khách)
app.post('/api/customers/transfer', MGR, (req, res) => {
  const from = req.body.from_staff_id === 'none' ? null : int(req.body.from_staff_id);
  const to = int(req.body.to_staff_id) || null;
  if (req.body.from_staff_id !== 'none' && !from) throw bad('Chọn thợ cần chuyển khách đi');
  if (from === to) throw bad('Thợ nhận phải khác thợ hiện tại');
  if (to && !db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(to)) throw bad('Thợ nhận không hợp lệ hoặc đã nghỉ');
  const ids = Array.isArray(req.body.customer_ids) ? req.body.customer_ids.map(int).filter(Boolean) : null;
  const cond = from ? 'staff_id=?' : 'staff_id IS NULL';
  const args = from ? [from] : [];
  let n;
  if (ids && ids.length) {
    n = db.prepare(`UPDATE customers SET staff_id=? WHERE deleted=0 AND ${cond} AND id IN (${ids.map(() => '?').join(',')})`).run(to, ...args, ...ids).changes;
  } else {
    n = db.prepare(`UPDATE customers SET staff_id=? WHERE deleted=0 AND ${cond}`).run(to, ...args).changes;
  }
  audit(req.user.id, 'transfer_customers', 'user', from, { to, count: n });
  res.json({ ok: true, count: n });
});
app.post('/api/reminders/done', (req, res) => {
  const { customer_id, type, ref, note } = req.body;
  if (!['birthday', 'card', 'return', 'appointment'].includes(type)) throw bad('Loại nhắc không hợp lệ');
  db.prepare('INSERT OR REPLACE INTO reminder_log(customer_id,type,ref,note,created_by) VALUES (?,?,?,?,?)').run(int(customer_id), type, String(ref), str(note), req.user.id);
  res.json({ ok: true });
});
app.get('/api/dashboard', (req, res) => {
  const t = today();
  const appts = db.prepare(`SELECT a.*, COALESCE(c.name,a.guest_name) name, COALESCE(c.phone,a.guest_phone) phone, u.full_name staff_name
    FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id
    WHERE a.date=? ORDER BY a.time`).all(t);
  const rep = L.salesReport(t, t, req.user);
  const month = L.salesReport(t.slice(0, 8) + '01', t, req.user);
  const rem = L.reminders();
  res.json({ today: t, appointments: appts, today_report: rep, month_report: month, reminder_counts: rem.counts,
    customers: db.prepare('SELECT COUNT(*) n FROM customers WHERE deleted=0').get().n });
});

staffMod.mount(app, { MGR, OWNER });
require('./tips').mount(app, { MGR, OWNER });
require('./chat').mount(app, { MGR, OWNER });
const expMod = require('./expenses');
expMod.mount(app, { MGR, upload, sniffImage, PHOTO_DIR });
stockMod.mount(app, { MGR, OWNER });

// ---------- Nhập / xuất Excel ----------
const xlsxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } }); // sổ chi phí có ảnh hóa đơn ~20MB+
app.post('/api/import', MGR, xlsxUpload.single('file'), async (req, res) => {
  if (!req.file) throw bad('Chưa chọn file Excel');
  const opts = { dryRun: req.body.dry_run !== '0', includeHistory: req.body.include_history === '1' };
  const result = await importWorkbook(req.file.buffer, opts, req.user);
  if (!opts.dryRun) audit(req.user.id, 'import_excel', null, null, { file: req.file.originalname, ...result.summary });
  res.json(result);
});
app.get('/api/export', MGR, async (req, res) => {
  const t = today();
  const from = L.isDate(req.query.from) ? req.query.from : '2000-01-01';
  const to = L.isDate(req.query.to) ? req.query.to : t;
  const buf = await exportWorkbook({ from, to });
  audit(req.user.id, 'export_excel', null, null, { from, to });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="CRM-Salon-Nep-${t}.xlsx"`);
  res.send(Buffer.from(buf));
});

// ---------- Nhật ký thao tác & sao lưu ----------
// Lịch sử chỉnh sửa: ai, lúc nào, sửa gì (lọc theo người, ngày, chỉ sửa/xóa)
app.get('/api/audit', OWNER, (req, res) => {
  const limit = Math.min(2000, int(req.query.limit) || 300);
  let where = '1=1'; const p = [];
  if (int(req.query.user_id)) { where += ' AND a.user_id=?'; p.push(int(req.query.user_id)); }
  if (L.isDate(req.query.from)) { where += ' AND a.created_at>=?'; p.push(req.query.from); }
  if (L.isDate(req.query.to)) { where += ' AND a.created_at<?'; p.push(L.addDays(req.query.to, 1)); }
  if (req.query.only === 'edit') where += " AND (a.action LIKE 'update%' OR a.action LIKE 'delete%' OR a.action IN ('adjust_card','stock_adjust','stock_count','transfer_customers','appointment_status','reset_password','tip_paid'))";
  res.json(db.prepare(`SELECT a.*, u.full_name user_name,
      CASE a.entity
        WHEN 'visit' THEN (SELECT v.code||' · '||COALESCE(c.name,'') FROM visits v LEFT JOIN customers c ON c.id=v.customer_id WHERE v.id=a.entity_id)
        WHEN 'customer' THEN (SELECT name FROM customers WHERE id=a.entity_id)
        WHEN 'appointment' THEN (SELECT COALESCE(c.name,ap.guest_name)||' · '||ap.date FROM appointments ap LEFT JOIN customers c ON c.id=ap.customer_id WHERE ap.id=a.entity_id)
        WHEN 'card' THEN (SELECT cd.code||' · '||c.name FROM cards cd JOIN customers c ON c.id=cd.customer_id WHERE cd.id=a.entity_id)
        WHEN 'material' THEN (SELECT name FROM materials WHERE id=a.entity_id)
        WHEN 'user' THEN (SELECT full_name FROM users WHERE id=a.entity_id)
      END entity_label
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE ${where} ORDER BY a.id DESC LIMIT ?`).all(...p, limit));
});
app.get('/api/backups', OWNER, (req, res) => {
  const dir = path.join(DATA_DIR, 'backups');
  res.json(fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse().map((f) => ({ file: f, size: fs.statSync(path.join(dir, f)).size })));
});
app.post('/api/backups', OWNER, async (req, res) => {
  const file = await backupNow();
  audit(req.user.id, 'backup', null, null, { file });
  res.json({ file });
});
app.get('/api/backups/:file', OWNER, (req, res) => {
  const f = String(req.params.file);
  if (!/^salon-[\d-]+\.db$/.test(f)) throw bad('Tên file không hợp lệ');
  audit(req.user.id, 'download_backup', null, null, { file: f });
  res.download(path.join(DATA_DIR, 'backups', f));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Không có API này' }));

// ---------- Giao diện ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: 0 }));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Lỗi hệ thống, thử lại hoặc báo quản trị' : err.message });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`CRM Salon Nếp chạy tại http://localhost:${port}`));
  startBackups();
}

module.exports = { app };
