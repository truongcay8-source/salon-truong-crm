'use strict';
// Lịch off nhân viên + chấm công vào/ra (định vị GPS hoặc wifi tiệm)
const { db, getSettings, audit } = require('./db');
const L = require('./logic');
const { HttpError, bad, int, str, today, isDate } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS staff_off (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  from_time TEXT,
  to_time TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_by INTEGER REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_off_date ON staff_off(date);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in','out')),
  time TEXT NOT NULL,
  method TEXT NOT NULL,
  lat REAL, lng REAL, accuracy REAL, distance REAL,
  ip TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date, user_id);
`);
for (const [k, v] of Object.entries({ shop_lat: '', shop_lng: '', shop_radius: '150', shop_ips: '', work_start: '09:00', late_grace: '10' })) {
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(k, v);
}

const isMgr = (u) => u.role !== 'staff';
const hm = (s) => { const m = String(s || '').match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const nowHM = () => new Date().toTimeString().slice(0, 5);

// Thợ có nghỉ (đã duyệt) trùng ngày/giờ không
function offAt(userId, date, time, duration = 60) {
  const t0 = hm(time), t1 = t0 == null ? null : t0 + duration;
  for (const o of db.prepare("SELECT * FROM staff_off WHERE user_id=? AND date=? AND status='approved'").all(userId, date)) {
    const a = hm(o.from_time), b = hm(o.to_time);
    if (a == null || b == null || t0 == null) return o; // nghỉ cả ngày
    if (t0 < b && t1 > a) return o;
  }
  return null;
}

function offRows(from, to, user) {
  const rows = db.prepare(`SELECT o.*, u.full_name staff_name, d.full_name decided_by_name FROM staff_off o JOIN users u ON u.id=o.user_id
    LEFT JOIN users d ON d.id=o.decided_by WHERE o.date BETWEEN ? AND ? ORDER BY o.date, o.from_time`).all(from, to);
  // Nhân viên thấy lịch nghỉ đã duyệt của mọi người (để biết ai vắng) + mọi đơn của chính mình
  return isMgr(user) ? rows : rows.filter((o) => o.status === 'approved' || o.user_id === user.id);
}

// Khoảng cách 2 điểm GPS (mét)
function distance(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const cleanIp = (ip) => String(ip || '').replace(/^::ffff:/, '');
function shopIps(s) { return String(s.shop_ips || '').split(',').map((x) => x.trim()).filter(Boolean); }

function checkPlace(req, body) {
  const s = getSettings();
  const ip = cleanIp(req.ip);
  const out = { ip, wifi: false, gps: false, distance: null };
  if (shopIps(s).includes(ip)) out.wifi = true;
  const lat = Number(body.lat), lng = Number(body.lng), acc = Number(body.accuracy) || 0;
  if (s.shop_lat && s.shop_lng && Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) {
    out.distance = Math.round(distance(lat, lng, Number(s.shop_lat), Number(s.shop_lng)));
    // sai số GPS quá lớn (> 200m) thì không tin
    out.gps = out.distance <= Number(s.shop_radius || 150) && acc <= 200;
  }
  out.configured = !!(shopIps(s).length || (s.shop_lat && s.shop_lng));
  return out;
}

function report(from, to, user, userId) {
  const s = getSettings();
  const start = hm(s.work_start || '09:00'), grace = Number(s.late_grace || 0);
  let rows = db.prepare(`SELECT a.*, u.full_name staff_name FROM attendance a JOIN users u ON u.id=a.user_id
    WHERE a.date BETWEEN ? AND ? ORDER BY a.date, a.time`).all(from, to);
  if (!isMgr(user)) rows = rows.filter((r) => r.user_id === user.id);
  else if (userId) rows = rows.filter((r) => r.user_id === userId);
  const days = new Map();
  for (const r of rows) {
    const k = r.user_id + '|' + r.date;
    const d = days.get(k) || { user_id: r.user_id, staff_name: r.staff_name, date: r.date, in: null, out: null, in_method: null, out_method: null, records: [] };
    d.records.push(r);
    if (r.kind === 'in' && (!d.in || r.time < d.in)) { d.in = r.time; d.in_method = r.method; }
    if (r.kind === 'out' && (!d.out || r.time > d.out)) { d.out = r.time; d.out_method = r.method; }
    days.set(k, d);
  }
  const list = [...days.values()].map((d) => {
    const mins = d.in && d.out ? Math.max(0, hm(d.out) - hm(d.in)) : 0;
    const late = d.in && start != null ? Math.max(0, hm(d.in) - start - grace) : 0;
    return { ...d, minutes: mins, late_minutes: late, missing_out: !!d.in && !d.out && d.date < today() };
  });
  const per = new Map();
  for (const d of list) {
    const p = per.get(d.user_id) || { user_id: d.user_id, staff_name: d.staff_name, days: 0, minutes: 0, late_days: 0, late_minutes: 0, missing_out: 0 };
    p.days++; p.minutes += d.minutes; if (d.late_minutes) { p.late_days++; p.late_minutes += d.late_minutes; } if (d.missing_out) p.missing_out++;
    per.set(d.user_id, p);
  }
  const offs = offRows(from, to, user).filter((o) => o.status === 'approved' && (isMgr(user) ? !userId || o.user_id === userId : o.user_id === user.id));
  for (const o of offs) {
    const p = per.get(o.user_id) || { user_id: o.user_id, staff_name: o.staff_name, days: 0, minutes: 0, late_days: 0, late_minutes: 0, missing_out: 0 };
    p.off_days = (p.off_days || 0) + (o.from_time ? 0.5 : 1);
    per.set(o.user_id, p);
  }
  return { from, to, work_start: s.work_start, late_grace: grace, days: list.reverse(), summary: [...per.values()] };
}

function mount(app, { MGR, OWNER }) {
  // ----- Lịch off -----
  app.get('/api/offs', (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : today();
    const to = isDate(req.query.to) ? req.query.to : L.addDays(from, 31);
    res.json(offRows(from, to, req.user));
  });
  app.post('/api/offs', (req, res) => {
    const b = req.body;
    const userId = isMgr(req.user) ? int(b.user_id) || req.user.id : req.user.id;
    if (!isDate(b.date)) throw bad('Chọn ngày nghỉ');
    const fromT = str(b.from_time), toT = str(b.to_time);
    if ((fromT || toT) && !(hm(fromT) != null && hm(toT) != null && hm(fromT) < hm(toT))) throw bad('Giờ nghỉ không hợp lệ (từ giờ phải trước đến giờ)');
    if (!isMgr(req.user) && b.date < today()) throw bad('Không xin nghỉ cho ngày đã qua');
    const status = isMgr(req.user) ? 'approved' : 'pending';
    const id = db.prepare('INSERT INTO staff_off(user_id,date,from_time,to_time,reason,status,created_by,decided_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(userId, b.date, fromT, toT, str(b.reason), status, req.user.id, status === 'approved' ? req.user.id : null).lastInsertRowid;
    audit(req.user.id, 'create_off', 'staff_off', id, { user_id: userId, date: b.date, status });
    const clash = db.prepare(`SELECT COUNT(*) n FROM appointments WHERE staff_id=? AND date=? AND status IN ('booked','arrived')`).get(userId, b.date).n;
    res.json({ id, status, appointments_that_day: clash });
  });
  app.post('/api/offs/:id/decide', MGR, (req, res) => {
    const id = int(req.params.id);
    const st = req.body.status;
    if (!['approved', 'rejected'].includes(st)) throw bad('Trạng thái không hợp lệ');
    const o = db.prepare('SELECT * FROM staff_off WHERE id=?').get(id);
    if (!o) throw new HttpError(404, 'Không tìm thấy đơn nghỉ');
    db.prepare('UPDATE staff_off SET status=?, decided_by=? WHERE id=?').run(st, req.user.id, id);
    audit(req.user.id, 'decide_off', 'staff_off', id, { status: st });
    res.json({ ok: true });
  });
  app.delete('/api/offs/:id', (req, res) => {
    const o = db.prepare('SELECT * FROM staff_off WHERE id=?').get(int(req.params.id));
    if (!o) throw new HttpError(404, 'Không tìm thấy đơn nghỉ');
    if (!isMgr(req.user) && !(o.user_id === req.user.id && o.status === 'pending')) throw new HttpError(403, 'Chỉ hủy được đơn của mình khi chưa duyệt');
    db.prepare('DELETE FROM staff_off WHERE id=?').run(o.id);
    audit(req.user.id, 'delete_off', 'staff_off', o.id, { date: o.date, user_id: o.user_id });
    res.json({ ok: true });
  });

  // ----- Chấm công -----
  app.get('/api/attendance/me', (req, res) => {
    const s = getSettings();
    const place = checkPlace(req, {});
    res.json({ today: today(), records: db.prepare('SELECT * FROM attendance WHERE user_id=? AND date=? ORDER BY time').all(req.user.id, today()),
      on_shop_wifi: place.wifi, configured: place.configured, has_gps: !!(s.shop_lat && s.shop_lng), radius: Number(s.shop_radius || 150), work_start: s.work_start });
  });
  app.post('/api/attendance', (req, res) => {
    const kind = req.body.kind;
    if (!['in', 'out'].includes(kind)) throw bad('Chọn Vào ca hoặc Ra ca');
    const p = checkPlace(req, req.body);
    if (!p.configured) throw bad('Lãnh đạo chưa cài vị trí / wifi tiệm (Cài đặt › Chấm công)');
    if (!p.wifi && !p.gps) {
      throw bad(p.distance != null ? `Bạn đang cách tiệm khoảng ${p.distance}m — phải ở tiệm (bật định vị hoặc kết nối wifi tiệm) mới chấm công được`
        : 'Không xác định được bạn đang ở tiệm: bật định vị (cho phép trình duyệt dùng vị trí) hoặc kết nối wifi tiệm');
    }
    const t = today(), time = nowHM();
    const last = db.prepare('SELECT * FROM attendance WHERE user_id=? AND date=? ORDER BY time DESC, id DESC LIMIT 1').get(req.user.id, t);
    if (last && last.kind === kind && hm(time) - hm(last.time) < 5) throw bad(`Bạn vừa chấm ${kind === 'in' ? 'vào' : 'ra'} lúc ${last.time}`);
    const method = p.wifi ? 'wifi' : 'gps';
    const id = db.prepare('INSERT INTO attendance(user_id,date,kind,time,method,lat,lng,accuracy,distance,ip,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.user.id, t, kind, time, method, Number(req.body.lat) || null, Number(req.body.lng) || null, Number(req.body.accuracy) || null, p.distance, p.ip, req.user.id).lastInsertRowid;
    res.json({ id, time, method, distance: p.distance });
  });
  app.post('/api/attendance/manual', MGR, (req, res) => {
    const b = req.body;
    if (!int(b.user_id) || !isDate(b.date) || hm(b.time) == null || !['in', 'out'].includes(b.kind)) throw bad('Nhập đủ nhân viên, ngày, giờ, vào/ra');
    if (!str(b.note)) throw bad('Ghi lý do chấm công hộ (VD: quên chấm, điện thoại hết pin)');
    const id = db.prepare("INSERT INTO attendance(user_id,date,kind,time,method,note,created_by) VALUES (?,?,?,?,'manual',?,?)")
      .run(int(b.user_id), b.date, b.kind, b.time, str(b.note), req.user.id).lastInsertRowid;
    audit(req.user.id, 'manual_attendance', 'attendance', id, b);
    res.json({ id });
  });
  app.delete('/api/attendance/:id', MGR, (req, res) => {
    const r = db.prepare('SELECT * FROM attendance WHERE id=?').get(int(req.params.id));
    if (!r) throw new HttpError(404, 'Không tìm thấy');
    db.prepare('DELETE FROM attendance WHERE id=?').run(r.id);
    audit(req.user.id, 'delete_attendance', 'attendance', r.id, r);
    res.json({ ok: true });
  });
  app.get('/api/attendance/report', (req, res) => {
    const t = today();
    const from = isDate(req.query.from) ? req.query.from : t.slice(0, 8) + '01';
    const to = isDate(req.query.to) ? req.query.to : t;
    res.json(report(from, to, req.user, int(req.query.user_id) || null));
  });
  // Lãnh đạo đứng ở tiệm bấm để lấy vị trí / wifi hiện tại làm chuẩn
  app.post('/api/attendance/setup', OWNER, (req, res) => {
    const b = req.body;
    const up = db.prepare('UPDATE settings SET value=? WHERE key=?');
    if (b.use === 'gps') {
      if (!Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))) throw bad('Không lấy được vị trí');
      up.run(String(b.lat), 'shop_lat'); up.run(String(b.lng), 'shop_lng');
    } else if (b.use === 'wifi') {
      const ips = new Set(shopIps(getSettings())); ips.add(cleanIp(req.ip));
      up.run([...ips].join(','), 'shop_ips');
    } else if (b.use === 'clear_wifi') {
      up.run('', 'shop_ips');
    }
    for (const k of ['shop_radius', 'work_start', 'late_grace']) if (b[k] != null && b[k] !== '') up.run(String(b[k]).trim(), k);
    audit(req.user.id, 'attendance_setup', 'settings', null, { use: b.use });
    const s = getSettings();
    res.json({ shop_lat: s.shop_lat, shop_lng: s.shop_lng, shop_radius: s.shop_radius, shop_ips: s.shop_ips, work_start: s.work_start, late_grace: s.late_grace, your_ip: cleanIp(req.ip) });
  });
  app.get('/api/attendance/setup', OWNER, (req, res) => {
    const s = getSettings();
    res.json({ shop_lat: s.shop_lat, shop_lng: s.shop_lng, shop_radius: s.shop_radius, shop_ips: s.shop_ips, work_start: s.work_start, late_grace: s.late_grace, your_ip: cleanIp(req.ip) });
  });

  // ----- Lịch theo ngày: lịch hẹn + lượt đã làm + nghỉ -----
  app.get('/api/schedule', (req, res) => {
    const date = isDate(req.query.date) ? req.query.date : today();
    const appts = db.prepare(`SELECT a.*, COALESCE(c.name,a.guest_name) name, COALESCE(c.phone,a.guest_phone) phone, c.code customer_code, u.full_name staff_name
      FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id WHERE a.date=? ORDER BY a.time`).all(date);
    const linked = new Set(appts.map((a) => a.visit_id).filter(Boolean));
    const visits = db.prepare(`SELECT v.id, v.code, v.time, v.main_staff_id, v.assistant_id, v.customer_id, c.name customer_name,
        (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id) services
      FROM visits v JOIN customers c ON c.id=v.customer_id WHERE v.date=? AND v.status='done' ORDER BY v.time`).all(date)
      .filter((v) => !linked.has(v.id));
    res.json({ date, appointments: appts, visits, offs: offRows(date, date, req.user) });
  });
}

module.exports = { mount, offAt };
