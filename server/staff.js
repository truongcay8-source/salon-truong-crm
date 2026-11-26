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
  const partOff = db.prepare("SELECT user_id, date, from_time, to_time FROM staff_off WHERE status='approved' AND from_time IS NOT NULL AND date BETWEEN ? AND ?").all(from, to);
  const list = [...days.values()].map((d) => {
    const mins = d.in && d.out ? Math.max(0, hm(d.out) - hm(d.in)) : 0;
    let st = start;
    for (const o of partOff) if (o.user_id === d.user_id && o.date === d.date && st != null && hm(o.from_time) <= st && hm(o.to_time) > st) st = hm(o.to_time);
    const late = d.in && st != null ? Math.max(0, hm(d.in) - st - grace) : 0;
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
  return { from, to, work_start: s.work_start, late_grace: grace, days: list.reverse(), summary: [...per.values()], grid: grid(from, to, user, userId, list) };
}

// Bảng công: mỗi nhân viên 1 dòng × mỗi ngày 1 ô = chấm công + lịch off (đơn đã duyệt) gộp lại
// Ô: work (có chấm vào) · off (nghỉ cả ngày) · part (nghỉ vài giờ, có/không đi làm) · absent (ngày đã qua, không chấm, không đơn) · '' (chưa tới / trước khi dùng chấm công)
function grid(from, to, user, userId, list) {
  const t = today();
  let staff = db.prepare('SELECT id, full_name FROM users WHERE active=1 AND IFNULL(works,1)=1 AND merged_into IS NULL ORDER BY id').all();
  if (!isMgr(user)) staff = staff.filter((u) => u.id === user.id); else if (userId) staff = staff.filter((u) => u.id === userId);
  const firstUse = (db.prepare('SELECT MIN(date) d FROM attendance').get() || {}).d;
  const offs = db.prepare("SELECT user_id, date, from_time, to_time, reason FROM staff_off WHERE status='approved' AND date BETWEEN ? AND ?").all(from, to);
  const dates = [];
  for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to && dates.length < 62; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  const rows = staff.map((u) => {
    const sum = { work: 0, off: 0, part: 0, absent: 0, late: 0, late_minutes: 0, missing_out: 0, minutes: 0 };
    const cells = dates.map((date) => {
      const a = list.find((x) => x.user_id === u.id && x.date === date);
      const o = offs.filter((x) => x.user_id === u.id && x.date === date);
      const full = o.find((x) => !x.from_time);
      const part = o.filter((x) => x.from_time).map((x) => `${x.from_time}–${x.to_time}`).join(', ');
      const c = { date };
      if (a && a.in) {
        Object.assign(c, { s: 'work', in: a.in, out: a.out, minutes: a.minutes, late: a.late_minutes, missing_out: a.missing_out, part: part || null });
        sum.work++; sum.minutes += a.minutes; if (a.late_minutes) { sum.late++; sum.late_minutes += a.late_minutes; } if (a.missing_out) sum.missing_out++;
        if (part) sum.part++;
      } else if (full) { c.s = 'off'; c.reason = full.reason || null; sum.off++; }
      else if (part) { c.s = 'part'; c.part = part; sum.part++; }
      else if (date < t && firstUse && date >= firstUse) { c.s = 'absent'; sum.absent++; }
      else c.s = '';
      return c;
    });
    return { user_id: u.id, name: u.full_name, cells, sum };
  });
  return { dates, rows, first_use: firstUse || null };
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
  // ===== Chấm đủ hàng loạt: mọi người mọi ngày trong khoảng, bỏ ngày OFF (đơn đã duyệt) và lần đã có =====
  // Nghỉ vài giờ: giờ nghỉ phủ giờ vào → vào = hết giờ nghỉ; phủ giờ ra → ra = đầu giờ nghỉ.
  app.post('/api/attendance/fill', MGR, (req, res) => {
    const b = req.body, t = today();
    if (!isDate(b.from) || !isDate(b.to) || b.from > b.to) throw bad('Chọn từ ngày – đến ngày');
    const to = b.to > t ? t : b.to;
    const tin = str(b.in_time) || '09:00', tout = str(b.out_time) || '20:00';
    if (hm(tin) == null || hm(tout) == null || hm(tout) <= hm(tin)) throw bad('Giờ vào / ra không hợp lệ');
    const ids = (Array.isArray(b.user_ids) ? b.user_ids : String(b.user_ids || '').split(',')).map(int).filter(Boolean);
    let staff = db.prepare("SELECT id, full_name FROM users WHERE active=1 AND IFNULL(works,1)=1 AND merged_into IS NULL AND role<>'owner' ORDER BY id").all();
    if (ids.length) staff = staff.filter((u) => ids.includes(u.id));
    const offs = db.prepare("SELECT user_id, date, from_time, to_time FROM staff_off WHERE status='approved' AND date BETWEEN ? AND ?").all(b.from, to);
    const has = db.prepare('SELECT 1 FROM attendance WHERE user_id=? AND date=? AND kind=?');
    const ins = db.prepare("INSERT INTO attendance(user_id,date,kind,time,method,note,created_by) VALUES (?,?,?,?,'manual','Chấm đủ hàng loạt',?)");
    const dry = b.dry_run === true || b.dry_run === '1';
    const st = { added: 0, days_off: 0, existed: 0, people: staff.length, from: b.from, to };
    db.transaction(() => {
      for (const d of days(b.from, to)) for (const u of staff) {
        const o = offs.filter((x) => x.user_id === u.id && x.date === d);
        if (o.some((x) => !x.from_time)) { st.days_off++; continue; }
        let a = tin, z = tout;
        for (const x of o) { if (hm(x.from_time) <= hm(a) && hm(x.to_time) > hm(a)) a = x.to_time; if (hm(x.from_time) < hm(z) && hm(x.to_time) >= hm(z)) z = x.from_time; }
        if (hm(z) <= hm(a)) { st.days_off++; continue; }
        for (const [kind, time] of [['in', a], ['out', z]]) {
          if (d === t && kind === 'out') continue; // hôm nay chưa hết ca → chưa chấm ra
          if (has.get(u.id, d, kind)) { st.existed++; continue; }
          if (!dry) ins.run(u.id, d, kind, time, req.user.id);
          st.added++;
        }
      }
    })();
    if (!dry) audit(req.user.id, 'fill_attendance', 'attendance', null, { from: b.from, to, in: tin, out: tout, users: staff.map((u) => u.id), added: st.added });
    res.json({ ...st, dry_run: dry });
  });
  // OFF nhanh từ ô bảng công: 1 người hoặc cả tiệm nghỉ (đơn duyệt luôn)
  // Nhiều người × nhiều ngày; cả ngày hoặc theo giờ (nửa ngày). Đơn duyệt luôn, không ghi trùng.
  app.post('/api/attendance/off', MGR, (req, res) => {
    const b = req.body;
    const d1 = isDate(b.from) ? b.from : b.date, d2 = isDate(b.to) ? b.to : d1;
    if (!isDate(d1) || !isDate(d2) || d2 < d1) throw bad('Chọn ngày');
    const all = b.all === true || b.all === 1 || b.all === '1';
    const ids = (Array.isArray(b.user_ids) ? b.user_ids : [b.user_id]).map(int).filter(Boolean);
    const users = all ? db.prepare("SELECT id FROM users WHERE active=1 AND IFNULL(works,1)=1 AND merged_into IS NULL AND role<>'owner'").all().map((u) => u.id) : ids;
    if (!users.length) throw bad('Chọn nhân viên');
    const fromT = str(b.from_time), toT = str(b.to_time);
    if ((fromT || toT) && !(hm(fromT) != null && hm(toT) != null && hm(fromT) < hm(toT))) throw bad('Giờ nghỉ không hợp lệ (từ giờ phải trước đến giờ)');
    const reason = str(b.reason) || (all ? 'Cả tiệm nghỉ' : 'OFF (quản lý ghi)');
    const hasFull = db.prepare("SELECT 1 FROM staff_off WHERE user_id=? AND date=? AND status='approved' AND from_time IS NULL");
    const hasSame = db.prepare("SELECT 1 FROM staff_off WHERE user_id=? AND date=? AND status='approved' AND from_time=? AND to_time=?");
    const ins = db.prepare("INSERT INTO staff_off(user_id,date,from_time,to_time,reason,status,created_by,decided_by) VALUES (?,?,?,?,?,'approved',?,?)");
    let n = 0, skipped = 0;
    db.transaction(() => {
      for (let d = new Date(d1 + 'T00:00:00Z'), k = 0; d.toISOString().slice(0, 10) <= d2 && k < 62; d.setUTCDate(d.getUTCDate() + 1), k++) {
        const date = d.toISOString().slice(0, 10);
        for (const u of users) {
          if (hasFull.get(u, date) || (fromT && hasSame.get(u, date, fromT, toT))) { skipped++; continue; }
          ins.run(u, date, fromT || null, toT || null, reason, req.user.id, req.user.id); n++;
        }
      }
    })();
    audit(req.user.id, 'quick_off', 'staff_off', null, { from: d1, to: d2, users, all, from_time: fromT, to_time: toT, reason });
    res.json({ added: n, skipped, users: users.length });
  });
  // ===== Excel chấm công: xuất mẫu (đã có giờ + ô trống từng người từng ngày) → điền → nhập lại hàng loạt =====
  const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
  const days = (from, to) => { const out = []; for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to && out.length < 62; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
  app.get('/api/attendance/export', MGR, async (req, res) => {
    const ExcelJS = require('exceljs');
    const t = today();
    const from = isDate(req.query.from) ? req.query.from : t.slice(0, 8) + '01';
    const to = isDate(req.query.to) ? req.query.to : t;
    const staff = db.prepare("SELECT id, full_name FROM users WHERE active=1 AND IFNULL(works,1)=1 AND merged_into IS NULL ORDER BY id").all();
    const rec = db.prepare('SELECT user_id, date, kind, MIN(time) first, MAX(time) last FROM attendance WHERE date BETWEEN ? AND ? GROUP BY user_id, date, kind').all(from, to);
    const get = (u, d, k) => rec.find((r) => r.user_id === u && r.date === d && r.kind === k);
    const offs = db.prepare("SELECT user_id, date, from_time, to_time FROM staff_off WHERE status='approved' AND date BETWEEN ? AND ?").all(from, to);
    const wb = new ExcelJS.Workbook();
    // Tab 1: Bảng công (nhìn): dòng = nhân viên, cột = ngày, ô tô màu
    const G = report(from, to, req.user, null).grid;
    const bg = wb.addWorksheet('Bảng công', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
    const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    bg.addRow(['Nhân viên', ...G.dates.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)), 'Ngày công', 'Nghỉ (đơn)', 'Nghỉ vài giờ', 'Vắng không đơn', 'Đi muộn', 'Quên chấm ra', 'Tổng giờ']);
    bg.addRow(['', ...G.dates.map((d) => WD[new Date(d + 'T00:00:00Z').getUTCDay()]), '', '', '', '', '', '', '']);
    const FILL = { work: 'FFDDF1DD', off: 'FFE3E3E3', part: 'FFFFF1C2', absent: 'FFF8D0D0' };
    for (const r of G.rows) {
      const vals = r.cells.map((c) => c.s === 'work' ? `${c.in}${c.out ? '-' + c.out : ' (quên ra)'}${c.late ? ' ⏰' + c.late + '′' : ''}${c.part ? ' ½' : ''}`
        : c.s === 'off' ? 'OFF' : c.s === 'part' ? '½ ' + c.part : c.s === 'absent' ? 'Vắng' : '');
      const row = bg.addRow([r.name, ...vals, r.sum.work, r.sum.off, r.sum.part, r.sum.absent, r.sum.late ? `${r.sum.late} lần (${r.sum.late_minutes}′)` : 0, r.sum.missing_out, `${Math.floor(r.sum.minutes / 60)}g${String(r.sum.minutes % 60).padStart(2, '0')}`]);
      r.cells.forEach((c, k) => { const cell = row.getCell(k + 2); if (FILL[c.s]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.s === 'work' && c.late ? 'FFFFE0B2' : FILL[c.s] } }; cell.alignment = { horizontal: 'center', wrapText: true }; cell.font = { size: 9 }; });
    }
    bg.getColumn(1).width = 14; G.dates.forEach((_, k) => (bg.getColumn(k + 2).width = 11));
    for (let k = 0; k < 7; k++) bg.getColumn(G.dates.length + 2 + k).width = 12;
    [1, 2].forEach((n) => { bg.getRow(n).font = { bold: true }; bg.getRow(n).alignment = { horizontal: 'center' }; bg.getRow(n).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E6D8' } }; });
    bg.addRow([]);
    bg.addRow(['Chú thích: xanh = đi làm (giờ vào-ra) · cam = đi muộn ⏰ · xám = OFF cả ngày (đơn đã duyệt) · vàng = nghỉ vài giờ ½ · đỏ = vắng không chấm công, không có đơn']);
    // Tab 2: mẫu nhập (điền giờ vào ô trống rồi Nhập Excel)
    const ws = wb.addWorksheet('Chấm công', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [{ header: 'Ngày', key: 'd', width: 12 }, { header: 'Nhân viên', key: 'n', width: 16 }, { header: 'Vào', key: 'i', width: 8 }, { header: 'Ra', key: 'o', width: 8 }, { header: 'Ghi chú', key: 'g', width: 36 }];
    ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E6D8' } };
    for (const d of days(from, to)) for (const u of staff) {
      const i = get(u.id, d, 'in'), o = get(u.id, d, 'out');
      const off = offs.filter((x) => x.user_id === u.id && x.date === d);
      const note = off.length ? off.map((x) => (x.from_time ? `Nghỉ ${x.from_time}–${x.to_time}` : 'Nghỉ cả ngày')).join(', ') : (i || o) ? 'đã có trên app' : '';
      const row = ws.addRow({ d: d.split('-').reverse().join('/'), n: u.full_name, i: i ? i.first : '', o: o ? o.last : '', g: note });
      if (i || o) row.font = { color: { argb: 'FF888888' } };
    }
    const h = wb.addWorksheet('Hướng dẫn');
    ['Điền giờ VÀO / RA dạng 09:00, 19:30 vào các ô còn trống.', 'Dòng chữ xám = đã có trên app, nhập lại sẽ bỏ qua (không ghi trùng).', 'Để trống cả Vào lẫn Ra = không chấm ngày đó.',
      'Tên nhân viên phải giống trong app. Ngày dạng dd/mm/yyyy.', 'Xong: trang Chấm công › 📤 Nhập Excel chấm công.'].forEach((x) => h.addRow([x]));
    h.getColumn(1).width = 80;
    audit(req.user.id, 'export_attendance', 'attendance', null, { from, to });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cham-cong-${from}_${to}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  });
  const attUpload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  const cellText = (v) => {
    if (v == null) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'object') return v.result != null ? v.result : v.text != null ? v.text : v.richText ? v.richText.map((x) => x.text).join('') : '';
    return v;
  };
  const toDate = (v) => {
    v = cellText(v);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(String(v).trim()); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isDate(String(v).trim()) ? String(v).trim() : null;
  };
  const toTime = (v) => {
    v = cellText(v);
    if (v === '' || v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(11, 16);
    if (typeof v === 'number') { const m = Math.round((v % 1) * 1440); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
    const m = /^(\d{1,2})\s*[:hg.]\s*(\d{0,2})/i.exec(String(v).trim());
    if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) return undefined;
    return `${m[1].padStart(2, '0')}:${(m[2] || '00').padStart(2, '0')}`;
  };
  app.post('/api/attendance/import', MGR, attUpload.single('file'), async (req, res) => {
    if (!req.file) throw bad('Chưa chọn file Excel');
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(req.file.buffer); } catch { throw bad('Không đọc được file. Lưu file dạng .xlsx rồi thử lại.'); }
    const ws = wb.getWorksheet('Chấm công') || wb.worksheets[0];
    const users = db.prepare('SELECT id, full_name, username, aliases FROM users WHERE merged_into IS NULL').all();
    const findU = (name) => { const k = fold(name); if (!k) return null;
      return users.find((u) => fold(u.full_name) === k || fold(u.username) === k || fold(u.aliases).split(',').map((x) => x.trim()).includes(k)) || users.find((u) => fold(u.full_name).replace(/^chi /, '') === k.replace(/^chi /, '')) || null; };
    const dry = req.body.dry_run === '1';
    const has = db.prepare('SELECT 1 FROM attendance WHERE user_id=? AND date=? AND kind=?');
    const ins = db.prepare("INSERT INTO attendance(user_id,date,kind,time,method,note,created_by) VALUES (?,?,?,?,'manual',?,?)");
    const st = { added: 0, skipped: 0, errors: [] };
    db.transaction(() => {
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const date = toDate(row.getCell(1).value), name = String(cellText(row.getCell(2).value) || '').trim();
        const tin = toTime(row.getCell(3).value), tout = toTime(row.getCell(4).value);
        if (!name && !tin && !tout) return;
        if (!tin && !tout) return;
        if (!date) return st.errors.push(`Dòng ${i}: ngày không đọc được`);
        if (date > today()) return st.errors.push(`Dòng ${i}: ngày ${date} chưa tới`);
        const u = findU(name); if (!u) return st.errors.push(`Dòng ${i}: không thấy nhân viên "${name}"`);
        if (tin === undefined || tout === undefined) return st.errors.push(`Dòng ${i}: giờ không đọc được (ghi dạng 09:00)`);
        if (tin && tout && tout <= tin) return st.errors.push(`Dòng ${i}: giờ ra ${tout} không sau giờ vào ${tin}`);
        for (const [kind, time] of [['in', tin], ['out', tout]]) {
          if (!time) continue;
          if (has.get(u.id, date, kind)) { st.skipped++; continue; }
          if (!dry) ins.run(u.id, date, kind, time, 'Nhập Excel chấm công' + (cellText(row.getCell(5).value) && !/đã có trên app|^Nghỉ/.test(String(cellText(row.getCell(5).value))) ? ': ' + String(cellText(row.getCell(5).value)).slice(0, 80) : ''), req.user.id);
          st.added++;
        }
      });
    })();
    if (!dry) audit(req.user.id, 'import_attendance', 'attendance', null, { file: req.file.originalname, added: st.added, skipped: st.skipped, errors: st.errors.length });
    res.json({ ...st, dry_run: dry });
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
    const u = req.user;
    const canMoney = (v) => u.role !== 'staff' || v.main_staff_id === u.id || v.assistant_id === u.id;
    const visits = db.prepare(`SELECT v.id, v.code, v.time, v.main_staff_id, v.assistant_id, v.customer_id, v.total, c.name customer_name,
        (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id) services
      FROM visits v JOIN customers c ON c.id=v.customer_id WHERE v.date=? AND v.status='done' ORDER BY v.time`).all(date)
      .map((v) => (canMoney(v) ? v : { ...v, total: null }));
    // Lịch đã thu tiền: gắn tổng tiền lượt làm để hiện trên lịch
    const byId = new Map(visits.map((v) => [v.id, v]));
    for (const a of appts) if (a.visit_id && byId.has(a.visit_id)) { a.visit_total = byId.get(a.visit_id).total; a.visit_services = byId.get(a.visit_id).services; }
    const free = visits.filter((v) => !linked.has(v.id));
    require('./famgroup').tag(appts);
    // Dòng dịch vụ do người khác làm / phụ trong phiếu của thợ chính → hiện ở cột người đó (không tiền) để ai cũng thấy việc của mình
    const helps = new Map();
    for (const i of db.prepare(`SELECT vi.name, vi.staff_id, vi.assistant_id, v.id visit_id, v.time, v.main_staff_id, v.customer_id, c.name customer_name
        FROM visit_items vi JOIN visits v ON v.id=vi.visit_id JOIN customers c ON c.id=v.customer_id
        WHERE v.date=? AND v.status='done' AND ((vi.staff_id IS NOT NULL AND vi.staff_id<>v.main_staff_id) OR vi.assistant_id>0) ORDER BY v.time, vi.id`).all(date)) {
      for (const [uid, role] of [[i.staff_id, 'làm'], [i.assistant_id > 0 ? i.assistant_id : null, 'phụ']]) {
        if (!uid || uid === i.main_staff_id) continue;
        const k = uid + ':' + i.visit_id;
        if (!helps.has(k)) helps.set(k, { staff_id: uid, visit_id: i.visit_id, time: i.time, customer_id: i.customer_id, customer_name: i.customer_name, main_staff_id: i.main_staff_id, lines: [] });
        helps.get(k).lines.push((role === 'phụ' ? 'phụ ' : '') + i.name);
      }
    }
    res.json({ date, appointments: appts, visits: free, helps: [...helps.values()], offs: offRows(date, date, req.user), money: u.role === 'owner' ? L.dayMoney(date) : undefined });
  });
}

module.exports = { mount, offAt };
