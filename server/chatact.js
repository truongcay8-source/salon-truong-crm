'use strict';
// Chat → việc: đọc tin nhắn nội bộ và gợi ý thao tác, ai trong nhóm bấm ✓ là ghi vào phần mềm.
//  "mua đá 30k"            → khoản chi quỹ tiền mặt (nhân viên: chờ duyệt)
//  "hết dầu gội Milbon"    → báo hết hàng cho người xem kho (Thu)
//  "mai em xin nghỉ"       → đơn xin nghỉ (Lịch off)
//  "c Lan đến rồi"         → lịch hẹn hôm nay chuyển "đã đến"
const { db, audit } = require('./db');
const L = require('./logic');
const { today } = L;

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const fmt = (n) => Number(n).toLocaleString('vi-VN') + 'đ';

const mcols = db.prepare('PRAGMA table_info(materials)').all().map((c) => c.name);
if (mcols.length && !mcols.includes('reported_at')) db.exec('ALTER TABLE materials ADD COLUMN reported_at TEXT; ALTER TABLE materials ADD COLUMN reported_by INTEGER');
const ccols = db.prepare('PRAGMA table_info(chat_messages)').all().map((c) => c.name);
if (!ccols.includes('action')) db.exec('ALTER TABLE chat_messages ADD COLUMN action TEXT; ALTER TABLE chat_messages ADD COLUMN action_done TEXT; ALTER TABLE chat_messages ADD COLUMN mentions TEXT');

// Số tiền: 30k, 30 k, 30.000, 30000, 1tr2, 1,5tr, 150 nghìn
function money(f) {
  let m = f.match(/(\d+(?:[.,]\d+)?)\s*(tr|trieu|cu)\s*(\d{1,3})?\b/);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1e6 + (m[3] ? Number(m[3].padEnd(3, '0')) * 1e3 : 0));
  m = f.match(/(\d+(?:[.,]\d+)?)\s*(k|nghin|ngan|ng)\b/);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1e3);
  m = f.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,8})\s*(d|dong|vnd)?\b/);
  if (m) return Number(m[1].replace(/[.,]/g, ''));
  return null;
}

const EXP_VERB = /\b(mua|chi|tra tien|tra|dong tien|nop|ship|gui xe|do xang|xang|sua|thue|tip shipper|tien dien|tien nuoc|tien rac|tien mang|tien wifi)\b/;
function parseExpense(raw, f) {
  if (!EXP_VERB.test(f)) return null;
  if (/\b(khach|kh)\b.*\b(tra|chuyen|ck)\b/.test(f) || /\b(the|voucher|vc|nap)\b/.test(f)) return null; // tiền khách trả / thẻ — không phải chi quỹ
  const amount = money(f);
  if (!amount || amount < 1000 || amount > 5e6) return null;
  const note = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  return { kind: 'expense', amount, note, category: require('./expenses').guessCat(note) };
}

function parseStock(f) {
  const m = f.match(/\b(het|sap het|con it|gan het|can nhap|can mua them|thieu)\s+(?:hang\s+)?(.{3,60})/);
  if (!m) return null;
  const want = m[2].replace(/\b(roi|nhe|nha|oi|a|r|chi thu|c thu|thu oi|nhap them|di|giup|em|voi)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (want.length < 3) return null;
  const words = want.split(' ').filter((w) => w.length >= 2);
  const mats = db.prepare('SELECT id, name, kind FROM materials WHERE active=1').all();
  const scored = mats.map((x) => { const n = fold(x.name); const hit = words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '')}`).test(n)).length; return { x, hit }; })
    .filter((s) => s.hit >= Math.min(2, words.length)).sort((a, b) => b.hit - a.hit || a.x.name.length - b.x.name.length);
  return { kind: 'stock', level: /sap|it|gan/.test(m[1]) ? 'low' : 'out', text: want, candidates: scored.slice(0, 4).map((s) => ({ id: s.x.id, name: s.x.name })) };
}

function parseOff(f, ctx, senderId) {
  if (!/\b(xin nghi|nghi|off|xin off|vang|xin ve som|ve som|den muon|di muon)\b/.test(f)) return null;
  if (/\b(nghi ngoi|khach nghi|nghi le|tiem nghi|salon nghi)\b/.test(f)) return null;
  const t0 = ctx.today || today();
  let date = null;
  const dm = f.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (dm) { const y = t0.slice(0, 4); const c = `${y}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`; if (L.isDate(c)) date = c; }
  if (!date) {
    if (/\b(ngay kia|ngay mot|mot)\b/.test(f)) date = L.addDays(t0, 2);
    else if (/\b(mai|ngay mai)\b/.test(f)) date = L.addDays(t0, 1);
    else if (/\b(hom nay|nay|chieu nay|sang nay|toi nay)\b/.test(f)) date = t0;
    else {
      const wd = f.match(/\b(?:thu\s*|t)([2-7])\b|\b(chu nhat|cn)\b/);
      if (wd) { const want = wd[2] ? 0 : Number(wd[1]) - 1; const d0 = new Date(t0 + 'T00:00:00Z'); let n = (want - d0.getUTCDay() + 7) % 7; if (n === 0) n = 7; date = L.addDays(t0, n); }
    }
  }
  if (!date) return null;
  // Ai nghỉ: tên thợ trong tin, không có thì người gửi
  let userId = senderId;
  for (const u of ctx.staff) {
    const names = [u.full_name, ...String(u.aliases || '').split(',')].map((x) => fold(x).trim().split(/\s+/).pop()).filter((x) => x && x.length >= 2);
    if (names.some((n) => new RegExp(`\\b${n}\\b`).test(f))) { userId = u.id; break; }
  }
  let from = null, to = null;
  if (/\b(sang)\b/.test(f) && !/\bchieu\b/.test(f)) { from = '08:00'; to = '12:00'; }
  else if (/\b(chieu)\b/.test(f) && !/\bsang\b/.test(f)) { from = '13:00'; to = '17:00'; }
  else if (/\b(toi)\b/.test(f)) { from = '17:00'; to = '21:00'; }
  const tm = f.match(/\b(?:tu\s*)?(\d{1,2})\s*h\s*(\d{2})?\s*(?:den|-|toi)\s*(\d{1,2})\s*h\s*(\d{2})?/);
  if (tm) { const p = (h, m) => `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`; from = p(tm[1], tm[2]); to = p(tm[3], tm[4]); }
  const staff = ctx.staff.find((u) => u.id === userId);
  return { kind: 'off', user_id: userId, staff_name: staff ? staff.full_name : '', date, from_time: from, to_time: to };
}

function parseArrived(raw, f, ctx) {
  if (!/\b(den roi|toi roi|da den|da toi|vua den|vua toi|den nhe|toi nhe|khach den|khach toi|den salon)\b/.test(f)) return null;
  const t0 = ctx.today || today();
  const appts = db.prepare(`SELECT a.id, a.time, a.status, COALESCE(c.name, a.guest_name) name, u.full_name staff_name FROM appointments a
    LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id WHERE a.date=? AND a.status='booked' ORDER BY a.time`).all(t0);
  if (!appts.length) return null;
  const words = f.replace(/\b(chi|c|anh|a|em|e|co|chu|khach|kh|den|toi|roi|da|vua|nhe|nha|salon|oi)\b/g, ' ').split(/\s+/).filter((w) => w.length >= 2);
  const hits = appts.filter((a) => { const n = fold(a.name).split(/\s+/); return words.some((w) => n.includes(w)); });
  if (!hits.length) return null;
  return { kind: 'arrived', candidates: hits.slice(0, 3) };
}

function parseAction(body, ctx, senderId) {
  const raw = String(body || '');
  const f = ' ' + fold(raw).replace(/[,;!?()]/g, ' ').replace(/\s+/g, ' ') + ' ';
  return parseArrived(raw, f, ctx) || parseOff(f, ctx, senderId) || parseStock(f) || parseExpense(raw, f);
}

// @Tên → id nhân viên được gọi
function parseMentions(body, ctx) {
  const ids = new Set();
  const f = fold(body);
  if (/@(all|ca nhom|moi nguoi|tat ca)\b/.test(f)) return ctx.staff.map((u) => u.id);
  for (const m of f.matchAll(/@([a-z0-9]+)/g)) {
    for (const u of ctx.staff) {
      const names = [u.full_name, u.username, ...String(u.aliases || '').split(',')].map((x) => fold(x).trim().split(/\s+/).pop()).filter(Boolean);
      if (names.includes(m[1])) ids.add(u.id);
    }
  }
  return [...ids];
}

// Bấm ✓ trên thẻ việc → ghi vào phần mềm. Trả về dòng mô tả để hiện "đã làm".
function apply(msg, input, user) {
  const a = JSON.parse(msg.action);
  const isMgr = user.role === 'owner' || user.role === 'manager';
  if (a.kind === 'expense') {
    const amount = Number(input.amount || a.amount);
    const note = String(input.note || a.note).slice(0, 200);
    if (!(amount > 0)) throw L.bad('Số tiền không hợp lệ');
    const auto = isMgr;
    const id = db.prepare('INSERT INTO expenses(date,kind,amount,category,note,status,created_by,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(msg.created_at.slice(0, 10), 'out', amount, a.category || 'Khác', note + ' · từ chat', auto ? 'approved' : 'pending', msg.user_id, auto ? user.id : null, auto ? new Date().toISOString() : null).lastInsertRowid;
    audit(user.id, 'expense_create', 'expense', id, { amount, note, from_chat: msg.id });
    return { text: `Đã ghi chi quỹ ${fmt(amount)}${auto ? '' : ' · chờ quản lý duyệt'}`, ref: 'expense:' + id, notify: auto ? null : 'mgr' };
  }
  if (a.kind === 'stock') {
    const mid = Number(input.material_id) || (a.candidates[0] && a.candidates[0].id);
    const m = mid && db.prepare('SELECT id, name FROM materials WHERE id=?').get(mid);
    if (m) db.prepare("UPDATE materials SET reported_at=datetime('now','localtime'), reported_by=? WHERE id=?").run(msg.user_id, m.id);
    audit(user.id, 'stock_reported', 'material', m ? m.id : null, { text: a.text, from_chat: msg.id });
    return { text: `Đã báo ${a.level === 'low' ? 'sắp hết' : 'hết'}: ${m ? m.name : a.text} → người xem kho`, ref: m ? 'material:' + m.id : null, notify: 'stock', material: m ? m.name : a.text };
  }
  if (a.kind === 'off') {
    const uid = isMgr ? Number(input.user_id || a.user_id) : msg.user_id === user.id ? Number(a.user_id) : null;
    if (!uid) throw L.bad('Chỉ người xin nghỉ hoặc quản lý mới ghi được');
    if (!isMgr && uid !== user.id) throw L.bad('Nhân viên chỉ xin nghỉ cho chính mình');
    const status = isMgr ? 'approved' : 'pending';
    const id = db.prepare('INSERT INTO staff_off(user_id,date,from_time,to_time,reason,status,created_by,decided_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(uid, input.date || a.date, a.from_time, a.to_time, ('Từ chat: ' + msg.body).slice(0, 200), status, user.id, status === 'approved' ? user.id : null).lastInsertRowid;
    audit(user.id, 'create_off', 'staff_off', id, { user_id: uid, date: a.date, status, from_chat: msg.id });
    const clash = db.prepare("SELECT COUNT(*) n FROM appointments WHERE staff_id=? AND date=? AND status IN ('booked','arrived')").get(uid, input.date || a.date).n;
    return { text: `Đã ghi ${status === 'approved' ? 'lịch nghỉ' : 'đơn xin nghỉ (chờ duyệt)'} ${String(input.date || a.date).split('-').reverse().join('/')}${clash ? ` · ⚠ có ${clash} lịch hẹn ngày đó` : ''}`, ref: 'off:' + id, notify: status === 'pending' ? 'mgr' : null };
  }
  if (a.kind === 'arrived') {
    const aid = Number(input.appointment_id) || a.candidates[0].id;
    const ap = db.prepare('SELECT id, status FROM appointments WHERE id=?').get(aid);
    if (!ap) throw L.bad('Không tìm thấy lịch hẹn');
    db.prepare("UPDATE appointments SET status='arrived' WHERE id=? AND status='booked'").run(aid);
    audit(user.id, 'appointment_status', 'appointment', aid, { status: 'arrived', from_chat: msg.id });
    const c = a.candidates.find((x) => x.id === aid) || {};
    return { text: `Đã đánh dấu ${c.name || 'khách'} (${c.time || ''}) đã đến`, ref: 'appointment:' + aid, notify: 'staff:' + aid };
  }
  throw L.bad('Không rõ việc cần làm');
}

module.exports = { parseAction, parseMentions, apply, money };
