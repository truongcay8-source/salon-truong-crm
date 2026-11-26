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
  res.json({ user: { ...u, ...stockMod.perm(req.user) }, settings: { salon_name: s.salon_name, salon_address: s.salon_address, salon_phone: s.salon_phone, bank_info: s.bank_info, receipt_footer: s.receipt_footer, chat_keep_days: Number(s.chat_keep_days) || 90, card_new_rate: Number(s.card_new_rate) || 0, card_renewal_rate: Number(s.card_renewal_rate) || 0, payment_methods: s.payment_methods.split(',').map((x) => x.trim()), surcharge_salon_rate: s.surcharge_salon_rate === undefined ? 0.33 : Number(s.surcharge_salon_rate), qr: s.qr_bank && s.qr_account ? { bank: s.qr_bank, account: s.qr_account, name: s.qr_name || '' } : null }, groups: GROUPS, today: today() });
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
  res.json(db.prepare('SELECT id, full_name, role, active, level, works FROM users ORDER BY active DESC, id').all());
});
app.get('/api/users', OWNER, (req, res) => {
  res.json(db.prepare('SELECT id,username,full_name,role,active,can_login,must_change_pw,commission_enabled,works,aliases,level,created_at FROM users ORDER BY id').all());
});
const LEVELS = ['Director', 'Senior', 'Stylist', 'Junior'];
function userInput(b) {
  const r = {};
  if (b.full_name != null) { r.full_name = str(b.full_name); if (!r.full_name) throw bad('Nhập họ tên'); }
  if (b.role != null) { if (!['owner', 'manager', 'staff'].includes(b.role)) throw bad('Vai trò không hợp lệ'); r.role = b.role; }
  for (const k of ['active', 'can_login', 'commission_enabled', 'works']) if (b[k] != null) r[k] = b[k] ? 1 : 0;
  if (b.aliases != null) r.aliases = str(b.aliases);
  if (b.level != null) { const l = str(b.level); if (l && !LEVELS.includes(l)) throw bad('Cấp bậc không hợp lệ'); r.level = l || null; }
  return r;
}
app.post('/api/users', OWNER, (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._]{3,30}$/.test(username)) throw bad('Tên đăng nhập 3–30 ký tự, chỉ chữ thường không dấu, số, dấu chấm');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw bad('Tên đăng nhập đã tồn tại');
  const r = userInput({ role: 'staff', ...req.body });
  const pw = String(req.body.password || '');
  if (pw.length < 6) throw bad('Mật khẩu tối thiểu 6 ký tự');
  const id = db.prepare('INSERT INTO users(username,full_name,role,password_hash,commission_enabled,aliases,level) VALUES (?,?,?,?,?,?,?)')
    .run(username, r.full_name, r.role, bcrypt.hashSync(pw, 10), r.commission_enabled ?? 1, r.aliases ?? null, r.level ?? null).lastInsertRowid;
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
  const pw = String(req.body.password || '').trim();
  if (pw.length < 6) throw bad('Mật khẩu tối thiểu 6 ký tự');
  const target = db.prepare('SELECT username FROM users WHERE id=?').get(id);
  if (!target) throw bad('Không tìm thấy tài khoản');
  // mở khóa luôn: bật đăng nhập + đang làm, xóa đếm sai mật khẩu
  db.prepare('UPDATE users SET password_hash=?, must_change_pw=1, active=1, can_login=1 WHERE id=?').run(bcrypt.hashSync(pw, 10), id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  for (const k of [...failed.keys()]) if (k.startsWith(target.username + '|')) failed.delete(k);
  audit(req.user.id, 'reset_password', 'user', id);
  res.json({ ok: true });
});

// ---------- Cài đặt ----------
const publicSettings = () => { const s = { ...getSettings() }; delete s.anthropic_api_key; return s; };
app.get('/api/settings', MGR, (req, res) => res.json(publicSettings()));
app.put('/api/settings', OWNER, (req, res) => {
  const allowed = ['salon_name', 'salon_address', 'salon_phone', 'bank_info', 'receipt_footer', 'return_days', 'birthday_days', 'card_expiry_days', 'card_low_balance', 'assistant_rate', 'card_new_rate', 'card_renewal_rate', 'payment_methods', 'surcharge_salon_rate', 'book_money_until', 'qr_bank', 'qr_account', 'qr_name'];
  const up = db.prepare('UPDATE settings SET value=? WHERE key=?');
  for (const k of allowed) if (req.body[k] != null) up.run(String(req.body[k]).trim(), k);
  audit(req.user.id, 'update_settings', 'settings', null, req.body);
  res.json(publicSettings());
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
  if (q) { where += " AND (cust_rank(c.name, c.code, c.phone, COALESCE(c.formula,'') || ' ' || COALESCE(c.hair_notes,''), ?) >= 0 OR c.family_id IN (SELECT family_id FROM customers WHERE family_id IS NOT NULL AND deleted=0 AND cust_rank(name, code, phone, '', ?) >= 0))"; params.push(q, q); }
  const sf = req.query.staff_id === 'mine' ? req.user.id : req.query.staff_id === 'none' ? 'none' : int(req.query.staff_id);
  if (sf === 'none') where += ' AND c.staff_id IS NULL';
  else if (sf) { where += ' AND c.staff_id=?'; params.push(sf); }
  const rows = db.prepare(`SELECT c.id,c.code,c.name,c.phone,c.gender,c.birthday,c.source,c.staff_id,c.formula,c.formula_at,
      (SELECT COUNT(*) FROM visits v WHERE v.customer_id=c.id AND v.status='done') visits,
      (SELECT MAX(date) FROM visits v WHERE v.customer_id=c.id AND v.status='done') last_visit,
      (SELECT COALESCE(SUM(total),0) FROM visits v WHERE v.customer_id=c.id AND v.status='done') spend
    ,c.family_id, c.relation, (SELECT COUNT(*) FROM customers m WHERE c.family_id IS NOT NULL AND m.family_id=c.family_id AND m.id<>c.id AND m.deleted=0) fam
    FROM customers c WHERE ${where} ORDER BY ${q ? "CASE WHEN cust_rank(c.name, c.code, c.phone, COALESCE(c.formula,'') || ' ' || COALESCE(c.hair_notes,''), ?) < 0 THEN 999 ELSE cust_rank(c.name, c.code, c.phone, COALESCE(c.formula,'') || ' ' || COALESCE(c.hair_notes,''), ?) END, " : ''}(last_visit IS NULL), last_visit DESC, c.id DESC LIMIT ? OFFSET ?`).all(...params, ...(q ? [q, q] : []), limit, offset);
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
    staff_id: int(b.staff_id) || null, formula: str(b.formula),
    cycle_days: int(b.cycle_days) > 0 ? Math.min(365, int(b.cycle_days)) : null, cycle_call: b.cycle_call === true || b.cycle_call === '1' || b.cycle_call === 'on' ? 1 : 0, cycle_note: str(b.cycle_note) };
}
app.post('/api/customers', (req, res) => {
  const c = customerInput(req.body);
  if (c.phone) {
    const dup = db.prepare('SELECT id,code,name FROM customers WHERE phone=? AND deleted=0').get(c.phone);
    if (dup) return res.status(409).json({ error: `SĐT đã có: ${dup.code} – ${dup.name}`, duplicate: dup });
  }
  const code = nextCode('customers', 'KH', 4);
  const id = db.prepare('INSERT INTO customers(code,name,phone,gender,birthday,source,hair_notes,notes,created_by,staff_id,formula,formula_at,formula_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(code, c.name, c.phone, c.gender, c.birthday, c.source, c.hair_notes, c.notes, req.user.id, c.staff_id, c.formula, c.formula ? today() : null, c.formula ? req.user.id : null).lastInsertRowid;
  db.prepare('UPDATE customers SET cycle_days=?, cycle_call=?, cycle_note=? WHERE id=?').run(c.cycle_days, c.cycle_call, c.cycle_note, id);
  audit(req.user.id, 'create_customer', 'customer', id, { code, name: c.name });
  res.json({ id, code });
});
app.get('/api/customers/:id', (req, res) => {
  const id = int(req.params.id);
  const c = db.prepare(`SELECT c.*, s.full_name staff_name, f.full_name formula_by_name FROM customers c LEFT JOIN users s ON s.id=c.staff_id
    LEFT JOIN users f ON f.id=c.formula_by WHERE c.id=? AND c.deleted=0`).get(id);
  if (!c) throw new HttpError(404, 'Không tìm thấy khách');
  const visits = db.prepare("SELECT id FROM visits WHERE customer_id=? AND status='done' ORDER BY date DESC, id DESC").all(id)
    .map((v) => { const x = L.maskVisitMoney(L.getVisit(v.id), req.user); x.can_edit = L.canEditVisit(req.user, x); return x; });
  c.visits = visits;
  c.photos = db.prepare('SELECT p.id,p.kind,p.visit_id,p.created_at,v.date FROM photos p LEFT JOIN visits v ON v.id=p.visit_id WHERE p.customer_id=? ORDER BY p.id DESC').all(id);
  c.cards = db.prepare('SELECT * FROM cards WHERE customer_id=? ORDER BY id DESC').all(id).map(L.cardRow);
  // Lịch hẹn kèm tiền + dịch vụ của lượt đã làm (giống trang Lịch hẹn)
  c.appointments = db.prepare(`SELECT a.*, u.full_name staff_name, v.total visit_total, v.main_staff_id v_main, v.assistant_id v_asst,
      (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id) visit_services
    FROM appointments a LEFT JOIN users u ON u.id=a.staff_id LEFT JOIN visits v ON v.id=a.visit_id AND v.status='done'
    WHERE a.customer_id=? ORDER BY a.date DESC, a.time DESC LIMIT 30`).all(id);
  if (req.user.role === 'staff') for (const a of c.appointments) if (![a.v_main, a.v_asst, a.staff_id].includes(req.user.id)) a.visit_total = null;
  c.family = family.members(id);
  c.hair_log = visits.filter((v) => v.hair_before || v.result || v.formula).slice(0, 20)
    .map((v) => ({ id: v.id, date: v.date, staff: v.main_staff_name, services: v.items.map((i) => i.name).join(' + '), hair_before: v.hair_before, result: v.result, formula: v.formula }));
  c.debt = db.prepare("SELECT COALESCE(SUM(debt),0) s FROM visits WHERE customer_id=? AND status='done' AND debt>0 AND debt_paid_at IS NULL").get(c.id).s;
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
  // Khách định kỳ: chỉ đổi khi form có gửi ô này (form cũ / sửa nhanh không làm mất)
  if (!('cycle_days' in req.body)) Object.assign(c, { cycle_days: before.cycle_days, cycle_call: before.cycle_call, cycle_note: before.cycle_note });
  db.prepare('UPDATE customers SET cycle_days=?, cycle_call=?, cycle_note=? WHERE id=?').run(c.cycle_days, c.cycle_call, c.cycle_note, id);
  // Người nhà chủ (giảm 50%, không tính thưởng): chỉ Lãnh đạo đặt
  if (req.user.role === 'owner' && 'owner_family' in req.body) db.prepare('UPDATE customers SET owner_family=? WHERE id=?').run([true, '1', 'on', 1].includes(req.body.owner_family) ? 1 : 0, id);
  if ((before.formula || null) !== (c.formula || null)) {
    db.prepare('UPDATE customers SET formula_at=?, formula_by=? WHERE id=?').run(today(), req.user.id, id);
    try { require('./stock').syncFormulaUse(true); } catch (e) { console.error('Tự trừ kho theo công thức lỗi:', e.message); }
  }
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
  c.warranties = require('./warranty').active(today(), c.id);
  c.family = family.members(c.id).map((m) => ({ id: m.id, name: m.name, relation: m.relation, last_visit: m.last_visit, has_formula: !!m.formula }));
  c.last_hair = db.prepare("SELECT date, hair_before, result FROM visits WHERE customer_id=? AND status='done' AND (hair_before IS NOT NULL AND hair_before<>'' OR result IS NOT NULL AND result<>'') ORDER BY date DESC, id DESC LIMIT 1").get(c.id) || null;
  res.json(c);
});
// Người nhà / người đi cùng
const family = require('./family');
app.get('/api/family/relations', (req, res) => res.json(family.RELATIONS));
app.post('/api/customers/:id/family', (req, res) => {
  const id = int(req.params.id), other = int(req.body.other_id);
  try { family.link(id, other, str(req.body.relation)); } catch (e) { throw bad(e.message); }
  audit(req.user.id, 'update_customer', 'customer', other, { family_with: id, relation: str(req.body.relation) });
  res.json({ ok: true, family: family.members(id) });
});
app.delete('/api/customers/:id/family', (req, res) => {
  const id = int(req.params.id);
  family.unlink(id);
  audit(req.user.id, 'update_customer', 'customer', id, { family: 'gỡ khỏi nhóm' });
  res.json({ ok: true });
});
const famgroup = require('./famgroup');
// Cả nhà / đi cùng trong ngày: ai cũng xem được (tiền ẩn theo quyền), gắn người nhà cả nhóm, Lãnh đạo chia tiền
app.get('/api/appointments/:id/group', (req, res) => res.json(famgroup.group(int(req.params.id), req.user)));
app.post('/api/appointments/:id/group/link', (req, res) => res.json({ linked: famgroup.linkAll(int(req.params.id), req.user), group: famgroup.group(int(req.params.id), req.user) }));
app.post('/api/appointments/:id/group/split', OWNER, (req, res) => {
  famgroup.moveAmount(req.body, req.user);
  res.json(famgroup.group(int(req.params.id), req.user));
});
app.get('/api/family/suggest', MGR, (req, res) => res.json(family.suggest(100)));
app.post('/api/family/ignore', MGR, (req, res) => { family.ignore(int(req.body.a), int(req.body.b)); res.json({ ok: true }); });
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
    FROM customers c WHERE deleted=0 AND cust_rank(name, code, phone, COALESCE(formula,''), ?) >= 0 ORDER BY cust_rank(name, code, phone, COALESCE(formula,''), ?), (last_visit IS NULL), last_visit DESC LIMIT 10`).all(q, q);
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
// Khách chưa thanh toán (ô hồng): quản lý ghi đã thu bằng hình thức nào
// Ghi khách đã trả tiền: chỉ Lãnh đạo (sửa tiền hóa đơn)
app.post('/api/appointments/:id/pay-note', OWNER, (req, res) => {
  const a = db.prepare('SELECT id, pay_note, visit_id FROM appointments WHERE id=?').get(int(req.params.id));
  if (!a) throw new HttpError(404, 'Không tìm thấy lịch hẹn');
  const methods = getSettings().payment_methods.split(',').map((s) => s.trim());
  const v = str(req.body.pay_note);
  if (v && v !== 'Chưa thanh toán' && !methods.includes(v)) throw bad('Hình thức thanh toán không hợp lệ');
  db.prepare('UPDATE appointments SET pay_note=? WHERE id=?').run(v, a.id);
  if (a.visit_id && v && v !== 'Chưa thanh toán') db.prepare('UPDATE visits SET payment_method=? WHERE id=?').run(v, a.visit_id);
  audit(req.user.id, 'appointment_pay', 'appointment', a.id, { pay_note: [a.pay_note, v] });
  res.json({ ok: true });
});
// Lãnh đạo đánh dấu lượt "chưa thu" là khách đã trả (ô hồng trên sổ → chọn hình thức; ghi nợ → thu nợ hôm nay)
app.post('/api/visits/:id/mark-paid', OWNER, (req, res) => {
  const v = db.prepare("SELECT id, payment_method, note, debt, debt_paid_at, cash_paid FROM visits WHERE id=? AND status='done'").get(int(req.params.id));
  if (!v) throw new HttpError(404, 'Không tìm thấy lượt');
  const m = str(req.body && req.body.method);
  if (!getSettings().payment_methods.split(',').map((x) => x.trim()).includes(m)) throw bad('Chọn hình thức thanh toán');
  let done = false;
  if (!v.payment_method && /CHƯA THANH TOÁN/.test(v.note || '')) {
    db.prepare('UPDATE visits SET payment_method=? WHERE id=?').run(m, v.id);
    db.prepare("UPDATE appointments SET pay_note=? WHERE visit_id=? AND pay_note='Chưa thanh toán'").run(m, v.id);
    done = true;
  }
  if (v.debt && !v.debt_paid_at) { db.prepare('UPDATE visits SET debt_paid_at=?, debt_paid_method=?, debt_paid_by=? WHERE id=?').run(today(), m, req.user.id, v.id); done = true; }
  if (!done) throw bad('Lượt này không còn khoản chưa thu');
  audit(req.user.id, 'visit_mark_paid', 'visit', v.id, { method: m });
  res.json({ ok: true });
});
app.get('/api/appointments', (req, res) => {
  const from = L.isDate(req.query.from) ? req.query.from : today();
  const to = L.isDate(req.query.to) ? req.query.to : from;
  const params = [from, to];
  let extra = '';
  if (req.query.staff_id) { extra = ' AND a.staff_id=?'; params.push(int(req.query.staff_id)); }
  const u = req.user;
  const rows = db.prepare(`SELECT a.*, COALESCE(c.name,a.guest_name) name, COALESCE(c.phone,a.guest_phone) phone, c.code customer_code, u.full_name staff_name, tk.full_name taken_by_name,
      v.total visit_total, v.main_staff_id v_main, v.assistant_id v_asst, (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id) visit_services
    FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id LEFT JOIN users tk ON tk.id=a.taken_by
    LEFT JOIN visits v ON v.id=a.visit_id AND v.status='done'
    WHERE a.date BETWEEN ? AND ?${extra} ORDER BY a.date, a.time`).all(...params);
  if (!req.query.staff_id) require('./famgroup').tag(rows);
  res.json(rows.map(({ v_main, v_asst, ...a }) => (u.role === 'staff' && v_main !== u.id && v_asst !== u.id ? { ...a, visit_total: null } : a)));
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
  let customerId = int(b.customer_id) || null;
  const guestName = str(b.guest_name);
  // Gõ SĐT khách mới mà SĐT đã có trong danh bạ → gắn luôn vào khách cũ (dịch vụ vào đúng hồ sơ)
  if (!customerId && b.guest_phone) {
    const p = L.normPhone(b.guest_phone);
    const hit = p && /^0\d{9,10}$/.test(p) ? db.prepare('SELECT id FROM customers WHERE phone=? AND deleted=0 ORDER BY id LIMIT 1').get(p) : null;
    if (hit) customerId = hit.id;
  }
  if (!customerId && !guestName) throw bad('Chọn khách hoặc nhập tên khách mới');
  const status = ['booked', 'arrived', 'done', 'cancelled', 'noshow'].includes(b.status) ? b.status : 'booked';
  return { customer_id: customerId, guest_name: customerId ? null : guestName, guest_phone: customerId ? null : L.normPhone(b.guest_phone),
    staff_id: int(b.staff_id) || null, date: b.date, time: b.time, duration: Math.max(15, int(b.duration) || 60), service: str(b.service), status, note: str(b.note), taken_by: int(b.taken_by) || null };
}
app.post('/api/appointments', (req, res) => {
  const a = apptInput(req.body);
  a.taken_by = a.taken_by || req.user.id;
  a.manual_edit = 1;
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
  a.taken_by = a.taken_by || old.taken_by || null;
  a.manual_edit = 1; // đã sửa trên app → đồng bộ sổ không ghi đè ghi chú/hủy, không xóa khi dọn trùng
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
  if (req.query.staff_id) { extra += ' AND (v.main_staff_id=? OR v.assistant_id=? OR EXISTS (SELECT 1 FROM visit_items i WHERE i.visit_id=v.id AND (i.staff_id=? OR i.assistant_id=?)))'; params.push(int(req.query.staff_id), int(req.query.staff_id), int(req.query.staff_id), int(req.query.staff_id)); }
  const rows = db.prepare(`SELECT v.id FROM visits v WHERE v.status='done' AND v.date BETWEEN ? AND ?${extra} ORDER BY v.date DESC, v.time DESC, v.id DESC LIMIT 1000`).all(...params);
  res.json(rows.map((r) => {
    const v = L.maskVisitMoney(L.getVisit(r.id), req.user);
    v.can_edit = L.canEditVisit(req.user, v);
    return v;
  }));
});
// Lượt đã xóa (Lãnh đạo xem lại / khôi phục khi lỡ tay xóa)
app.get('/api/visits-deleted', OWNER, (req, res) => {
  const from = L.isDate(req.query.from) ? req.query.from : '2000-01-01';
  const to = L.isDate(req.query.to) ? req.query.to : '2999-12-31';
  res.json(db.prepare(`SELECT v.id, v.code, v.date, v.time, v.total, v.delete_reason, v.updated_at, c.name customer_name, u.full_name main_staff_name,
      (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id) services
    FROM visits v LEFT JOIN customers c ON c.id=v.customer_id LEFT JOIN users u ON u.id=v.main_staff_id
    WHERE v.status='deleted' AND v.date BETWEEN ? AND ? ORDER BY v.updated_at DESC, v.id DESC LIMIT 300`).all(from, to));
});
app.post('/api/visits/:id/restore', OWNER, (req, res) => {
  const v = db.prepare("SELECT * FROM visits WHERE id=? AND status='deleted'").get(int(req.params.id));
  if (!v) throw new HttpError(404, 'Không tìm thấy lượt đã xóa');
  db.transaction(() => {
    db.prepare("UPDATE visits SET status='done', delete_reason=NULL, manual_edit=1, updated_at=? WHERE id=?").run(new Date().toISOString(), v.id);
    if (v.card_id && v.card_paid > 0) {
      const pay = Math.min(v.card_paid, Math.max(0, L.cardBalance(v.card_id)));
      if (pay > 0) { db.prepare('INSERT INTO card_txns(card_id,visit_id,amount,note,created_by) VALUES (?,?,?,?,?)').run(v.card_id, v.id, -pay, 'Dùng cho lượt làm (khôi phục)', req.user.id); L.closeGiftAfterUse(v.card_id, v.id, req.user.id); }
      if (pay !== v.card_paid) db.prepare('UPDATE visits SET card_paid=?, cash_paid=?, card_id=? WHERE id=?').run(pay, v.total - pay, pay ? v.card_id : null, v.id);
    }
    db.prepare("UPDATE appointments SET status='done', visit_id=? WHERE id=(SELECT id FROM appointments WHERE customer_id=? AND date=? AND IFNULL(time,'')=IFNULL(?,'') AND visit_id IS NULL LIMIT 1)").run(v.id, v.customer_id, v.date, v.time);
    audit(req.user.id, 'restore_visit', 'visit', v.id, { code: v.code, total: v.total, reason_was: v.delete_reason });
  })();
  res.json({ ok: true });
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
  // Hóa đơn đã hoàn thành: chỉ Lãnh đạo (nick Vinh) sửa tiền, dịch vụ, giảm giá; người khác chỉ sửa ghi chú
  if (req.user.role !== 'owner') L.updateVisitNotes(req.body, req.user, v);
  else {
    L.saveVisit(req.body, req.user, v);
    // Hóa đơn nhập từ sổ đã sửa tay → đồng bộ sổ lần sau không ghi đè
    if (v.import_ref) db.prepare('UPDATE visits SET manual_edit=1 WHERE id=?').run(v.id);
  }
  res.json(L.getVisit(v.id));
});
app.delete('/api/visits/:id', OWNER, (req, res) => {
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
  const rows = db.prepare(`SELECT cd.*, c.name customer_name, c.code customer_code, c.phone, u.full_name seller_name, k.full_name consultant_name
    FROM cards cd JOIN customers c ON c.id=cd.customer_id LEFT JOIN users u ON u.id=cd.seller_id LEFT JOIN users k ON k.id=cd.consultant_id WHERE ${where} ORDER BY cd.id DESC`).all(...params);
  // Nhân viên chỉ thấy phần hoa hồng của chính mình
  res.json(rows.map(L.cardRow).map((c) => (req.user.role === 'staff'
    ? { ...c, commission: c.seller_id === req.user.id ? c.commission : null, consultant_commission: c.consultant_id === req.user.id ? c.consultant_commission : null } : c)));
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
  // Sửa người bán / người tư vấn / tỷ lệ chia → tính lại hoa hồng
  if (req.body.seller_id !== undefined && status !== 'refunded') {
    const sellerId = int(req.body.seller_id) || c.seller_id;
    const { consultantId, share } = L.cardSplit(req.body, sellerId);
    const cm = L.cardCommission(c.price, c.sale_type, sellerId, consultantId, share);
    db.prepare('UPDATE cards SET seller_id=?, consultant_id=?, seller_share=?, commission=?, consultant_commission=? WHERE id=?').run(sellerId, consultantId, share, cm.commission, cm.consultant_commission, id);
  }
  if (status === 'refunded' && c.status !== 'refunded') db.prepare('UPDATE cards SET commission=0, consultant_commission=0 WHERE id=?').run(id);
  const after = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
  audit(req.user.id, 'update_card', 'card', id, { code: c.code, changes: diffObj(c, after, ['expires_at', 'status', 'seller_id', 'consultant_id', 'seller_share', 'commission', 'consultant_commission']) });
  res.json({ ok: true });
});
// Sửa số tiền thẻ đã bán (ghi nhầm 20tr thay vì 2tr…): chỉ Lãnh đạo. Số dư = giá trị mới − phần đã dùng; hoa hồng tính lại.
app.put('/api/cards/:id/sale', OWNER, (req, res) => {
  const id = int(req.params.id);
  const c = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
  if (!c) throw new HttpError(404, 'Không tìm thấy thẻ');
  const b = req.body;
  const price = b.price != null && b.price !== '' ? int(b.price) : c.price;
  const value = b.value != null && b.value !== '' ? int(b.value) : c.value;
  if (price < 0) throw bad('Giá bán không hợp lệ');
  if (value <= 0) throw bad('Giá trị thẻ phải lớn hơn 0');
  const used = c.value - L.cardBalance(id);
  if (value - used < 0) throw bad(`Thẻ đã dùng ${used.toLocaleString('vi-VN')}đ, giá trị không được nhỏ hơn số đã dùng`);
  const saleType = price === 0 ? 'gift' : ['new', 'renewal', 'gift'].includes(b.sale_type) ? b.sale_type : c.sale_type;
  const methods = getSettings().payment_methods.split(',').map((s) => s.trim());
  const pm = str(b.payment_method) && methods.includes(str(b.payment_method)) ? str(b.payment_method) : c.payment_method;
  const soldAt = L.isDate(b.sold_at) ? b.sold_at : c.sold_at;
  const name = str(b.name) || c.name;
  if (!str(b.reason)) throw bad('Ghi lý do sửa (vd: ghi nhầm 20tr, đúng là 2tr)');
  const cm = c.status === 'refunded' ? { commission: 0, consultant_commission: 0 } : L.cardCommission(price, saleType, c.seller_id, c.consultant_id, c.consultant_id ? c.seller_share : 100);
  db.prepare('UPDATE cards SET price=?, value=?, sale_type=?, payment_method=?, sold_at=?, name=?, commission=?, consultant_commission=? WHERE id=?')
    .run(price, value, saleType, pm, soldAt, name, cm.commission, cm.consultant_commission, id);
  const after = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
  audit(req.user.id, 'update_card_sale', 'card', id, { code: c.code, reason: str(b.reason), changes: diffObj(c, after, ['price', 'value', 'sale_type', 'payment_method', 'sold_at', 'name', 'commission', 'consultant_commission']) });
  res.json(L.cardRow(after));
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
  const rep = L.salesReport(from, to, req.user);
  // Tổng doanh số toàn tiệm (dịch vụ / sản phẩm / thẻ / tiền vào) chỉ Lãnh đạo xem
  if (req.user.role !== 'owner') rep.summary = null;
  res.json(rep);
});
// Bấm vào số trong bảng "Theo nhân viên" → các dòng hóa đơn tạo nên số đó (để tra soát, sửa người làm từng dòng)
app.get('/api/reports/sales-lines', (req, res) => {
  const t = today();
  const from = L.isDate(req.query.from) ? req.query.from : t.slice(0, 8) + '01';
  const to = L.isDate(req.query.to) ? req.query.to : t;
  const staff = req.user.role === 'staff' ? req.user.id : int(req.query.staff_id);
  if (!staff) throw bad('Chọn nhân viên');
  const grp = str(req.query.grp);
  const groups = new Set(require('./db').GROUPS);
  const rows = db.prepare(`SELECT vi.id item_id, vi.name, vi.grp, vi.price, vi.staff_id, vi.assistant_id, v.id visit_id, v.code, v.date, v.time, v.subtotal, v.total, v.surcharge,
      v.main_staff_id, v.assistant_id v_asst, v.note, v.import_ref, c.name customer_name, u.full_name doer_name, m.full_name main_name
    FROM visit_items vi JOIN visits v ON v.id=vi.visit_id LEFT JOIN customers c ON c.id=v.customer_id
    LEFT JOIN users u ON u.id=COALESCE(vi.staff_id, v.main_staff_id) LEFT JOIN users m ON m.id=v.main_staff_id
    WHERE v.status='done' AND v.date BETWEEN ? AND ? ORDER BY v.date, v.time, v.id, vi.id`).all(from, to);
  const out = [];
  for (const r of rows) {
    const f = r.subtotal > 0 ? Math.max(0, r.total - r.surcharge) / r.subtotal : 0;
    const g = groups.has(r.grp) ? r.grp : 'Khác';
    const doer = r.staff_id || r.main_staff_id;
    const asst = r.assistant_id > 0 ? r.assistant_id : r.assistant_id === 0 ? null : r.v_asst;
    let role = null;
    if (doer === staff) role = r.staff_id && r.staff_id !== r.main_staff_id ? 'làm (phiếu của ' + (r.main_name || '') + ')' : 'làm chính';
    else if (!grp && asst === staff) role = 'phụ';
    if (!role || (grp && g !== grp)) continue;
    out.push({ visit_id: r.visit_id, code: r.code, date: r.date, time: r.time, customer_name: r.customer_name, name: r.name, grp: g, net: Math.round(r.price * f),
      role, main_name: r.main_name, doer_name: r.doer_name, note: String(r.note || '').replace(/^Sổ đặt lịch: /, '').split(' · ')[0], from_book: /^SO:/.test(r.import_ref || '') });
  }
  res.json({ from, to, staff_id: staff, grp: grp || null, lines: out, total: out.filter((x) => x.role !== 'phụ').reduce((s, x) => s + x.net, 0) });
});
app.get('/api/reminders', (req, res) => {
  const r = L.reminders();
  if (stockMod.perm(req.user).stock_view) { r.stock = stockMod.stockAlerts(); r.counts.stock = r.stock.filter((m) => !m.ordered_at).length; }
  if (req.user.role !== 'staff') { const f = require('./expenses').fundState(); r.counts.expenses = f.pending_count; r.expenses = f; }
  if (req.user.role !== 'staff') { r.backup = pcBackupState(); r.counts.backup = r.backup.due ? 1 : 0; }
  if (req.user.role !== 'staff') {
    r.unpaid = db.prepare(`SELECT a.id, a.date, a.time, a.note, a.customer_id, COALESCE(c.name,a.guest_name) name, COALESCE(c.phone,a.guest_phone) phone, u.full_name staff_name, v.total amount
      FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id LEFT JOIN visits v ON v.id=a.visit_id AND v.status='done' WHERE a.pay_note='Chưa thanh toán' AND a.status<>'cancelled' ORDER BY a.date, a.time`).all();
    r.counts.unpaid = r.unpaid.length;
  }
  // Khách đang trong hạn bảo hành: chỉ để tra cứu khi khách quay lại, không tính vào số nhắc
  r.warranty = require('./warranty').active(today(), null, true).sort((a, b) => a.until.localeCompare(b.until));
  if (req.user.role === 'staff') r.warranty = r.warranty.filter((v) => v.main_staff_id === req.user.id);
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
  if (!['birthday', 'card', 'return', 'appointment', 'cycle'].includes(type)) throw bad('Loại nhắc không hợp lệ');
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
  if (req.user.role !== 'owner') { rep.summary = null; month.summary = null; } // tổng tiệm chỉ Lãnh đạo xem
  const rem = L.reminders();
  res.json({ today: t, appointments: appts, today_report: rep, month_report: month, reminder_counts: rem.counts,
    customers: db.prepare('SELECT COUNT(*) n FROM customers WHERE deleted=0').get().n });
});

staffMod.mount(app, { MGR, OWNER });
require('./tips').mount(app, { MGR, OWNER });
require('./payroll').mount(app, { OWNER }); // Bảng lương: chỉ Lãnh đạo
require('./finance').mount(app, { OWNER });
require('./pos').mount(app, { OWNER, MGR }); // Thu ngân + kết ca: ai cũng dùng được, chỉ Lãnh đạo xem tiền lệch // Báo cáo tài chính (lãi/lỗ): chỉ Lãnh đạo
require('./chat').mount(app, { MGR, OWNER });
require('./pricelist').apply(); // bảng giá 15/11/2026 (chạy 1 lần)
try { require('./datafix').apply(); } catch (e) { console.error('datafix', e.message); } // công thức gửi qua Messenger 15/11
const expMod = require('./expenses');
expMod.mount(app, { MGR, upload, sniffImage, PHOTO_DIR });
stockMod.mount(app, { MGR, OWNER });

// ---------- Nhập / xuất Excel ----------
const xlsxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } }); // sổ chi phí có ảnh hóa đơn ~20MB+
app.post('/api/import', MGR, xlsxUpload.single('file'), async (req, res) => {
  if (!req.file) throw bad('Chưa chọn file Excel');
  const opts = { dryRun: req.body.dry_run !== '0', includeHistory: req.body.include_history === '1', bookMoney: req.body.book_money !== '0', updatePast: req.body.update_past === '1' && req.user.role === 'owner' };
  const result = await importWorkbook(req.file.buffer, opts, req.user);
  if (!opts.dryRun) audit(req.user.id, 'import_excel', null, null, { file: req.file.originalname, ...result.summary });
  res.json(result);
});
// Đồng bộ sổ đặt lịch từ Google Sheet
const gsync = require('./gsync');
app.get('/api/gsync', MGR, (req, res) => res.json(gsync.state()));
app.put('/api/gsync', MGR, (req, res) => {
  try { res.json(gsync.save({ url: req.body.url, auto: req.body.auto == null ? null : !!req.body.auto })); }
  catch (e) { throw bad(e.message); }
});
app.post('/api/gsync/run', MGR, async (req, res) => {
  const dryRun = req.body.dry_run === true || req.body.dry_run === '1';
  try {
    const r = await gsync.run({ user: req.user, dryRun, force: true });
    if (!dryRun) audit(req.user.id, 'import_excel', null, null, { file: 'Google Sheet', ...(r.summary || {}) });
    res.json(r);
  } catch (e) { throw bad(e.message); }
});
// Sao lưu về máy cá nhân hàng tuần: 1 file Excel đầy đủ, ghi lại ai tải lúc nào để nhắc tuần sau
const BACKUP_EVERY_DAYS = 7;
function pcBackupState() {
  const s = getSettings();
  const last = s.pc_backup_at || null;
  const days = last ? Math.floor((Date.now() - new Date(last.replace(' ', 'T')).getTime()) / 86400000) : null;
  return { last_at: last, last_by: s.pc_backup_by || null, days, due: !last || days >= BACKUP_EVERY_DAYS, every: BACKUP_EVERY_DAYS };
}
app.get('/api/backup-pc', MGR, (req, res) => res.json(pcBackupState()));
app.get('/api/backup-pc/download', MGR, async (req, res) => {
  const t = today();
  const buf = await exportWorkbook({ from: '2000-01-01', to: t, full: true });
  const now = db.prepare("SELECT datetime('now','localtime') t").get().t;
  const up = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  up.run('pc_backup_at', now); up.run('pc_backup_by', req.user.full_name);
  audit(req.user.id, 'backup_pc', null, null, { file: `SaoLuu-Salon-Nep-${t}.xlsx` });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="SaoLuu-Salon-Nep-${t}.xlsx"`);
  res.send(Buffer.from(buf));
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
  gsync.startAutoSync();
  // Lịch đã bấm "Đã thu" nhưng lần đồng bộ sổ (ô vẫn hồng) đổi lại thành chưa thanh toán → lấy theo hình thức TT đã ghi ở hóa đơn
  try { const n = db.prepare(`UPDATE appointments SET pay_note=(SELECT v.payment_method FROM visits v WHERE v.id=appointments.visit_id)
      WHERE pay_note='Chưa thanh toán' AND visit_id IN (SELECT id FROM visits WHERE status='done' AND payment_method IS NOT NULL AND payment_method<>'')`).run().changes;
    if (n) console.log(`Đã sửa ${n} lịch bị báo chưa thanh toán dù đã thu`); } catch (e) { console.error('Sửa lịch đã thu lỗi:', e.message); }
  // Lịch cũ ghi "khách mới" nhưng SĐT đã có trong danh bạ → gắn vào khách cũ
  try {
    const n = db.prepare(`UPDATE appointments SET customer_id=(SELECT c.id FROM customers c WHERE c.phone=appointments.guest_phone AND c.deleted=0 ORDER BY c.id LIMIT 1), guest_name=NULL, guest_phone=NULL
      WHERE customer_id IS NULL AND guest_phone IS NOT NULL AND EXISTS (SELECT 1 FROM customers c WHERE c.phone=appointments.guest_phone AND c.deleted=0)`).run().changes;
    if (n) console.log(`Đã gắn ${n} lịch hẹn vào khách có sẵn theo SĐT`);
  } catch (e) { console.error('Gắn lịch theo SĐT lỗi:', e.message); }
  try { const n = require('./importer').mergeSameVisits(); if (n) console.log(`Đã gộp ${n} lượt cùng khách làm cùng lúc / trùng lượt ghi tay`); } catch (e) { console.error('Gộp lượt lỗi:', e.message); }
  try { const n = require('./importer').closeUsedGifts(); if (n) console.log(`Đã đóng ${n} thẻ tri ân đã dùng 1 lần`); } catch (e) { console.error('Đóng thẻ tri ân lỗi:', e.message); }
  try { const n = require('./importer').dedupeVisits(); if (n) console.log(`Đã dọn ${n} lượt làm trùng do sổ sửa chữ`); } catch (e) { console.error('Dọn lượt trùng lỗi:', e.message); }
  try { const n = require('./importer').dedupeAppointments(); if (n) console.log(`Đã dọn ${n} lịch hẹn trùng`); } catch (e) { console.error('Dọn lịch trùng lỗi:', e.message); }
}

module.exports = { app };
