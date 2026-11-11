'use strict';
// Chat nội bộ + đọc tin nhắn đặt lịch ("chị Lan 0912345678 mai 9h nhuộm với Dương") → gợi ý lịch hẹn, bấm 1 lần để tạo
const { db, audit, getSettings } = require('./db');
const L = require('./logic');
const { HttpError, bad, int, str, today } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  draft TEXT,
  appointment_id INTEGER REFERENCES appointments(id),
  linked_by INTEGER REFERENCES users(id),
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS chat_reads (user_id INTEGER PRIMARY KEY, last_id INTEGER NOT NULL DEFAULT 0);
`);
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('chat_keep_days','90')").run();
// Tin cũ hơn N ngày bị xóa hẳn (lịch hẹn đã tạo vẫn giữ)
let lastPurge = 0;
function purge() {
  if (Date.now() - lastPurge < 3600e3) return;
  lastPurge = Date.now();
  const days = Math.max(7, Number(getSettings().chat_keep_days) || 90);
  db.prepare("DELETE FROM chat_messages WHERE created_at < datetime('now','localtime',?)").run(`-${days} days`);
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const pad = (n) => String(n).padStart(2, '0');
const HONOR = ['chị', 'chi', 'c', 'anh', 'a', 'em', 'e', 'cô', 'co', 'bà', 'bác', 'chú', 'khách', 'khach', 'kh', 'bạn', 'ban', 'mẹ', 'me'];
// Từ khóa dịch vụ → tìm dịch vụ có tên chứa từ đó
const SVC_WORDS = ['nhuộm', 'cắt', 'uốn', 'duỗi', 'ép', 'gội', 'phục hồi', 'hấp', 'tẩy', 'highlight', 'balayage', 'tạo kiểu', 'sấy', 'massage', 'phủ bóng', 'nối'];

function parseBooking(text, ctx) {
  const t0 = ctx.today || today();
  const raw = String(text || '');
  const f = ' ' + fold(raw).replace(/[,;!?()]/g, ' ') + ' ';
  const out = {};
  // SĐT
  const pm = raw.match(/(?:\+?84|0)(?:[\s.-]?\d){9,10}/);
  if (pm) out.phone = L.normPhone(pm[0].replace(/^\+?84/, '0'));
  const fNoPhone = pm ? f.replace(fold(pm[0]), ' ') : f;
  // Giờ: 9h, 9h30, 9:30, 9g, 9r (rưỡi), 14h, "9 giờ", kèm sáng/chiều/tối
  const tm = fNoPhone.match(/(?:^|[\s@])(?:luc\s*)?(\d{1,2})\s*(?:(?:h|g|gio)\s*(\d{1,2})?|:(\d{2})|r(?:uoi)?\b)\s*(?:p\b|phut\b)?\s*(sang|trua|chieu|toi)?/);
  if (tm) {
    let h = Number(tm[1]); let m = Number(tm[2] || tm[3] || 0);
    if (/\dr(uoi)?\b/.test(tm[0].replace(/\s/g, ''))) m = 30;
    if ((tm[4] === 'chieu' || tm[4] === 'toi') && h < 12) h += 12;
    else if (!tm[4] && h >= 1 && h <= 7) h += 12; // salon: "3h" hiểu là 15h
    if (h >= 0 && h <= 23 && m < 60) out.time = `${pad(h)}:${pad(m)}`;
  }
  // Khách: theo SĐT có sẵn → tên sau "chị/anh/khách…" (không phải tên thợ) → khớp tên khách có sẵn
  if (out.phone) {
    const c = db.prepare('SELECT id, name, phone, staff_id FROM customers WHERE deleted=0 AND phone=?').get(out.phone);
    if (c) { out.customer_id = c.id; out.name = c.name; if (!out.staff_id && c.staff_id) { out.staff_id = c.staff_id; out.staff_from_profile = true; } }
  }
  let nameSpan = '';
  if (!out.customer_id) {
    const staffNames = new Set(ctx.staff.flatMap((u) => [u.full_name, ...String(u.aliases || '').split(',')].map((x) => fold(x).trim().split(/\s+/).pop())));
    const hon = HONOR.flatMap((h) => [h, h.charAt(0).toUpperCase() + h.slice(1)]);
    const re = new RegExp(`(?:^|\\s)(${hon.join('|')})\\.?\\s+([\\p{L}]+(?:\\s+\\p{Lu}\\p{L}*){0,2})`, 'gu');
    let mm;
    while ((mm = re.exec(raw))) {
      const nm = mm[2].trim();
      const first = fold(nm.split(/\s+/)[0]);
      const firstRaw = nm.split(/\s+/)[0];
      // "mai" viết thường = ngày mai; "Mai" viết hoa = tên khách
      if (staffNames.has(first) || SVC_WORDS.some((w) => fold(w).startsWith(first)) || /^(nay|toi|chieu|sang|luc|ngay|thu|hen|dat|lam|book|oi|nhe|a|da)$/.test(first) || (first === 'mai' && firstRaw === 'mai') || /^\d/.test(nm)) continue;
      const hon = mm[1].toLowerCase();
      const title = { c: 'Chị', chi: 'Chị', 'chị': 'Chị', a: 'Anh', anh: 'Anh', e: 'Em', em: 'Em', co: 'Cô', 'cô': 'Cô', kh: '', khach: '', 'khách': '' }[hon];
      nameSpan = mm[0];
      const name = nm.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      if (!name) continue;
      out.name = ((title ?? (hon.charAt(0).toUpperCase() + hon.slice(1))) + ' ' + name).trim();
      const cands = db.prepare('SELECT id, name, phone FROM customers WHERE deleted=0').all().filter((c) => fold(c.name) === fold(out.name) || fold(c.name) === fold(name));
      // Có SĐT mà không khớp khách nào → khách mới, không gán nhầm theo tên trùng
      if (cands.length === 1 && !out.phone) { out.customer_id = cands[0].id; out.name = cands[0].name; }
      break;
    }
  }
  // Ngày (bỏ phần tên khách để "chị Mai" không bị hiểu là ngày mai)
  const fDate = nameSpan ? fNoPhone.replace(fold(nameSpan), ' ') : fNoPhone;
  const d0 = new Date(t0 + 'T00:00:00Z');
  const addD = (n) => L.addDays(t0, n);
  let date = null;
  const dm = fDate.match(/(?:ngay\s*)?\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dm) {
    let y = dm[3] ? Number(dm[3].length === 2 ? '20' + dm[3] : dm[3]) : d0.getUTCFullYear();
    const cand = `${y}-${pad(dm[2])}-${pad(dm[1])}`;
    if (L.isDate(cand)) date = !dm[3] && cand < t0 ? `${y + 1}-${pad(dm[2])}-${pad(dm[1])}` : cand;
  }
  if (!date) {
    if (/\b(ngay mot|ngay kia|mot)\b/.test(fDate)) date = addD(2);
    else if (/\b(ngay mai|mai|tomorrow)\b/.test(fDate)) date = addD(1);
    else if (/\b(hom nay|nay|chieu nay|toi nay|sang nay)\b/.test(fDate)) date = t0;
    else {
      const wd = fDate.match(/\b(?:thu\s*|t)([2-7])\b|\b(chu nhat|cn)\b/);
      if (wd) {
        const want = wd[2] ? 0 : Number(wd[1]) - 1; // JS: CN=0, T2=1 … T7=6
        let n = (want - d0.getUTCDay() + 7) % 7; if (n === 0) n = 7;
        date = addD(n);
      }
    }
  }
  if (date) out.date = date;
  // Thợ: tên hoặc biệt danh (không dấu), ưu tiên tên đứng sau "với/vs/thợ/cho/làm"
  const staffHits = [];
  for (const u of ctx.staff) {
    const names = [u.full_name, ...String(u.aliases || '').split(',')].map((x) => fold(x).trim()).filter((x) => x.length >= 2);
    for (const n of names) {
      const re = new RegExp(`(\\b(?:voi|vs|tho|lam|cho|book|dat)\\s+)?(?:(?:a|anh|c|chi|e|em|co)\\s+)?\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      const mm = fNoPhone.match(re);
      if (mm) { staffHits.push({ id: u.id, strong: !!mm[1], at: mm.index, len: mm[0].length, name: n }); break; }
    }
  }
  const staff = staffHits.find((s) => s.strong) || (staffHits.length === 1 ? staffHits[0] : null);
  if (staff) out.staff_id = staff.id;
  // Dịch vụ: khớp tên đầy đủ trước, rồi từ khóa (chọn dịch vụ thợ đó/tiệm hay làm nhất; "anh" → nam, "chị" → nữ)
  const found = [];
  for (const s of ctx.services) { const i = fNoPhone.indexOf(' ' + fold(s.name) + ' '); if (s.active && i >= 0) found.push({ name: s.name, at: i }); }
  const title = fold((out.name || '').split(' ')[0]);
  const male = ['anh', 'chu', 'ong'].includes(title) || /\b(nam|tóc nam|toc nam)\b/.test(f), female = ['chi', 'co', 'ba'].includes(title) || /\b(nu|toc nu)\b/.test(f);
  // Cấp thợ (Director/Stylist): theo dịch vụ thợ đó hay làm
  const lvl = {};
  for (const [k, n] of Object.entries(ctx.staffUsage || {})) { const [sid, nm] = k.split('|'); if (Number(sid) === out.staff_id) for (const l of ['director', 'stylist']) if (fold(nm).includes(l)) lvl[l] = (lvl[l] || 0) + n; }
  const myLvl = Object.keys(lvl).sort((a, b) => lvl[b] - lvl[a])[0];
  for (const w of SVC_WORDS) {
    const fw = fold(w);
    const mw = fNoPhone.match(new RegExp(`\\b${fw}\\b`));
    if (!mw || found.some((x) => fold(x.name).includes(fw))) continue;
    const pick = ctx.services.filter((x) => x.active && new RegExp(`\\b${fw}\\b`).test(fold(x.name)))
      .map((x) => { const n = fold(x.name); return { x, score: ((ctx.usage || {})[x.name] || 0) + 10 * ((ctx.staffUsage || {})[`${out.staff_id}|${x.name}`] || 0)
        + (male && !female ? (/\bnam\b/.test(n) ? 1000 : /\bnu\b/.test(n) ? -1000 : 0) : 0) + (female && !male ? (/\bnu\b/.test(n) ? 1000 : /\bnam\b/.test(n) ? -1000 : 0) : 0) + (myLvl && n.includes(myLvl) ? 500 : 0) + (n.startsWith(fw) ? 2 : 0) + (fw === 'tay' && n.includes('nang sang') ? 100 : 0) - n.length / 100 }; })
      .sort((a, b) => b.score - a.score)[0];
    found.push({ name: pick ? pick.x.name : w.charAt(0).toUpperCase() + w.slice(1), at: mw.index });
  }
  const svcs = found.sort((a, b) => a.at - b.at).map((x) => x.name).filter((n, i, a) => a.indexOf(n) === i);
  if (svcs.length) out.service = svcs.join(' + ');
  // Chỉ coi là tin đặt lịch khi có giờ và (ngày hoặc từ khóa hẹn) và có thêm ít nhất 1 thông tin khách/dịch vụ
  const hint = /\b(hen|dat lich|dat|book|lich|qua lam|toi lam|den lam)\b/.test(fNoPhone);
  if (!out.time || !(out.date || hint) || !(out.name || out.phone || out.service || out.customer_id)) return null;
  if (!out.date) { out.date = t0; out.date_guess = true; }
  if (out.date < t0) return null;
  return out;
}

function msgRows(where, params, limit) {
  return db.prepare(`SELECT m.*, u.full_name user_name, lb.full_name linked_by_name, a.date appt_date, a.time appt_time, a.status appt_status
    FROM chat_messages m JOIN users u ON u.id=m.user_id LEFT JOIN users lb ON lb.id=m.linked_by LEFT JOIN appointments a ON a.id=m.appointment_id
    WHERE m.deleted=0 AND ${where} ORDER BY m.id DESC LIMIT ?`).all(...params, limit).reverse()
    .map((m) => ({ ...m, draft: m.draft ? JSON.parse(m.draft) : null }));
}
function ctxNow() {
  const since = L.addDays(today(), -180);
  const use = db.prepare(`SELECT v.main_staff_id sid, vi.name, COUNT(*) n FROM visit_items vi JOIN visits v ON v.id=vi.visit_id WHERE v.status='done' AND v.date>=? GROUP BY 1,2`).all(since);
  const usage = {}, staffUsage = {};
  for (const r of use) { usage[r.name] = (usage[r.name] || 0) + r.n; staffUsage[`${r.sid}|${r.name}`] = r.n; }
  return { today: today(), staff: db.prepare('SELECT id, full_name, aliases FROM users WHERE active=1').all(), services: db.prepare('SELECT name, active FROM services').all(), usage, staffUsage };
}

function mount(app, { MGR }) {
  app.get('/api/chat', (req, res) => {
    purge();
    const after = int(req.query.after), before = int(req.query.before);
    const rows = after ? msgRows('m.id>?', [after], 200) : before ? msgRows('m.id<?', [before], 50) : msgRows('1=1', [], 80);
    const last = db.prepare('SELECT MAX(id) n FROM chat_messages').get().n || 0;
    if (!before) db.prepare('INSERT INTO chat_reads(user_id,last_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_id=MAX(last_id, excluded.last_id)').run(req.user.id, last);
    res.json(rows);
  });
  app.get('/api/chat/unread', (req, res) => {
    const r = db.prepare('SELECT last_id FROM chat_reads WHERE user_id=?').get(req.user.id);
    res.json({ unread: db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE deleted=0 AND id>? AND user_id<>?').get(r ? r.last_id : 0, req.user.id).n });
  });
  app.post('/api/chat', (req, res) => {
    const body = str(req.body.body);
    if (!body) throw bad('Tin nhắn trống');
    if (body.length > 2000) throw bad('Tin nhắn quá dài');
    const draft = parseBooking(body, ctxNow());
    const id = db.prepare('INSERT INTO chat_messages(user_id,body,draft) VALUES (?,?,?)').run(req.user.id, body, draft ? JSON.stringify(draft) : null).lastInsertRowid;
    db.prepare('INSERT INTO chat_reads(user_id,last_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_id=MAX(last_id, excluded.last_id)').run(req.user.id, id);
    res.json(msgRows('m.id=?', [id], 1)[0]);
  });
  // Gắn lịch hẹn vừa tạo từ thẻ gợi ý vào tin nhắn (để mọi người thấy "đã tạo lịch")
  app.post('/api/chat/:id/link', (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=? AND deleted=0').get(int(req.params.id));
    if (!m) throw new HttpError(404, 'Không tìm thấy tin nhắn');
    const aid = int(req.body.appointment_id);
    if (!db.prepare('SELECT 1 FROM appointments WHERE id=?').get(aid)) throw bad('Lịch hẹn không tồn tại');
    db.prepare('UPDATE chat_messages SET appointment_id=?, linked_by=? WHERE id=?').run(aid, req.user.id, m.id);
    audit(req.user.id, 'chat_to_appointment', 'appointment', aid, { message_id: m.id });
    res.json(msgRows('m.id=?', [m.id], 1)[0]);
  });
  app.post('/api/chat/:id/dismiss', (req, res) => {
    db.prepare('UPDATE chat_messages SET draft=NULL WHERE id=? AND appointment_id IS NULL').run(int(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/chat/:id', (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=? AND deleted=0').get(int(req.params.id));
    if (!m) throw new HttpError(404, 'Không tìm thấy tin nhắn');
    if (m.user_id !== req.user.id && req.user.role === 'staff') throw new HttpError(403, 'Chỉ xóa được tin của mình');
    db.prepare('DELETE FROM chat_messages WHERE id=?').run(m.id); // xóa hẳn, không giữ nội dung
    audit(req.user.id, 'delete_chat', 'user', m.user_id, { length: m.body.length });
    res.json({ ok: true });
  });
}

module.exports = { mount, parseBooking, fold, ctxNow };
