'use strict';
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const { db, nextCode, GROUPS, GIFT_CARD } = require('./db');
const L = require('./logic');

const ROLLBACK = Symbol('dry-run');

// ---------- Đọc ô Excel ----------
function cellVal(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellVal(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if (v.error) return null;
    return null;
  }
  return v;
}
// Màu nền ô (quy ước của tiệm): đỏ = khách hủy / thợ nghỉ; xanh lá = tiền mặt; vàng = chuyển khoản; hồng = chưa thanh toán
function cellColor(cell) {
  const f = cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor;
  const argb = f && f.argb ? f.argb.slice(-6).toUpperCase() : null;
  if (!argb) return null;
  const n = parseInt(argb, 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (r > 200 && g < 80 && b < 80) return 'red';
  if (g > 200 && r < 120 && b < 120) return 'green';
  if (r > 200 && g > 200 && b < 120) return 'yellow';
  if (r > 200 && b > 150 && g < 190) return 'pink';
  return null;
}
const PAY_COLOR = { green: 'Tiền mặt', yellow: 'Chuyển khoản', pink: 'Chưa thanh toán' };
const pay_ = (c) => (c === 'red' ? null : PAY_COLOR[c] || null);
const BM = require('./bookmoney');
const BOOK_FROM = '2026-11-01'; // Vinh 15/11: số tiền từ tháng 11 lấy theo sổ đặt lịch
function asText(v) {
  v = cellVal(v);
  if (v == null) return null;
  if (v instanceof Date) return asDate(v);
  const s = String(v).trim();
  return s === '' ? null : s;
}
function asNum(v) {
  v = cellVal(v);
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function asDate(v) {
  v = cellVal(v);
  if (v == null) return null;
  if (v instanceof Date) {
    // exceljs trả ngày theo UTC
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m) return `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // sinh nhật không có năm → MM-DD
  return null;
}
function asTime(v) {
  v = cellVal(v);
  if (v == null) return null;
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof v === 'number' && v < 1) { const mins = Math.round(v * 1440); return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; }
  const m = String(v).match(/(\d{1,2})[:hH](\d{2})?/);
  return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : null;
}
const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const TITLES = new Set(['chi', 'anh', 'em', 'c', 'a', 'e', 'b', 'be', 'ban', 'co', 'chu', 'ong', 'ba', 'kh', 'khach']);
function stripAccents(s) { return norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }

// Tìm dòng tiêu đề (dòng có "Tên khách" / "Ngày"...) và lập bản đồ tên cột → số cột
function readTable(ws, mustHave, maxScan = 8) {
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const map = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const h = asText(cell.value);
      if (!h) return;
      let k = norm(h), n = 1;
      while (k in map) k = norm(h) + '#' + ++n; // cột trùng tên (VD: 3 cột "ĐV") → "đv", "đv#2", "đv#3"
      map[k] = col;
    });
    if (mustHave.every((h) => norm(h) in map)) {
      const rows = [];
      for (let i = r + 1; i <= ws.rowCount; i++) {
        const rr = ws.getRow(i);
        const get = (...names) => { for (const n of names) { const c = map[norm(n)]; if (c) return rr.getCell(c).value; } return null; };
        rows.push({ get, rowNumber: i });
      }
      return rows;
    }
  }
  return null;
}

// ---------- Sổ đặt lịch ghi tay: tách SĐT, đoán tên khách ----------
function extractPhone(text) {
  const m = String(text).replace(/[.\s](?=\d)/g, '').match(/(?:\+?84|0)\d{9,10}/);
  if (!m) return null;
  const p = L.normPhone(m[0]);
  return /^0\d{9,10}$/.test(p) ? p : null;
}
// Khóa so khớp tên khách trong ô sổ: bỏ dấu, ngoặc, số tiền, danh xưng → 2 chữ đầu ("A thái uk 685" = "a thái uk" → "thai uk")
function apptKey(text) {
  const n = stripAccents(String(BM.cleanName(text) || text || '')).replace(/\(.*?\)/g, ' ').replace(/[0-9]+k?\b/g, ' ').replace(/[^a-z ]+/g, ' ').trim()
    .replace(/^(chi|anh|em|c|a|e|b|ban|co|chu|bac|khach|kh)\s+/, '').split(/\s+/).filter(Boolean);
  return n.slice(0, 2).join(' ');
}
// Dọn lịch hẹn bị tạo trùng do nhập lại sổ sau khi sửa chữ trong ô: giữ lịch đã thu tiền / hoàn thành, xóa bản "Đã đặt" trùng
function dedupeAppointments() {
  const rows = db.prepare(`SELECT id, date, time, staff_id, status, visit_id, note, guest_name, customer_id, pay_note, assistant_id FROM appointments WHERE date>=date('now','localtime','-60 days') ORDER BY date, time, id`).all();
  const groups = new Map();
  for (const a of rows) {
    const k = apptKey(a.note || a.guest_name || '');
    if (!k) continue;
    const g = `${a.date}|${a.time}|${a.staff_id || 0}|${k}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(a);
  }
  let removed = 0;
  const rank = (a) => (a.visit_id ? 4 : 0) + (a.status === 'done' ? 2 : a.status === 'arrived' ? 1 : 0);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((x, y) => rank(y) - rank(x) || x.id - y.id);
    const keep = list[0];
    for (const a of list.slice(1)) {
      if (a.visit_id || a.status !== 'booked') continue; // chỉ xóa bản "Đã đặt" thừa, không đụng lịch đã thu tiền / đã hủy
      if (a.customer_id && keep.customer_id && a.customer_id !== keep.customer_id) continue;
      try { db.prepare('UPDATE chat_messages SET appointment_id=? WHERE appointment_id=?').run(keep.id, a.id); } catch { /* chưa có bảng chat */ }
      if (a.note && (!keep.note || a.note.length > keep.note.length)) db.prepare('UPDATE appointments SET note=? WHERE id=?').run(a.note, keep.id);
      db.prepare('UPDATE appointments SET customer_id=COALESCE(customer_id,?), pay_note=COALESCE(pay_note,?), assistant_id=COALESCE(assistant_id,?) WHERE id=?').run(a.customer_id, a.pay_note, a.assistant_id, keep.id);
      db.prepare('DELETE FROM appointments WHERE id=?').run(a.id);
      removed++;
    }
  }
  return removed;
}

// Dọn lượt làm bị tạo 2 lần do ô sổ sửa chữ trước đây (cùng ngày, giờ, thợ, cùng khách/tên): giữ lượt đã sửa tay hoặc lượt mới nhất, xóa bản còn lại
// Lượt trùng bị xóa đang giữ phần trừ thẻ (thẻ tri ân…) mà lượt giữ lại chưa trừ → chuyển phần trừ thẻ sang lượt giữ lại
function moveCardUse(fromId, toId) {
  const d = db.prepare('SELECT * FROM visits WHERE id=?').get(fromId), k = db.prepare("SELECT * FROM visits WHERE id=? AND status='done'").get(toId);
  if (!d || !k || !d.card_id || !(d.card_paid > 0) || k.card_id) return false;
  const live = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM card_txns WHERE visit_id=?').get(fromId).s;
  const pay = Math.min(d.card_paid, k.total, L.cardBalance(d.card_id) - live);
  if (!(pay > 0)) return false;
  db.prepare('UPDATE card_txns SET visit_id=? WHERE visit_id=?').run(toId, fromId);
  db.prepare('DELETE FROM card_txns WHERE visit_id=? AND card_id=?').run(toId, d.card_id);
  db.prepare('UPDATE visits SET card_id=?, card_paid=?, cash_paid=? WHERE id=?').run(d.card_id, pay, Math.max(0, k.total - pay), toId);
  db.prepare('INSERT INTO card_txns(card_id,visit_id,amount,note,created_by) VALUES (?,?,?,?,1)').run(d.card_id, toId, -pay, 'Dùng cho lượt làm (chuyển từ lượt trùng ' + fromId + ')');
  L.closeGiftAfterUse(d.card_id, toId, 1);
  return true;
}
// Sửa dữ liệu bản trước: dọn trùng đã xóa lượt cũ có trừ thẻ → thẻ tri ân bị "hoàn" lại như chưa dùng
function repairDedupedCards() {
  let n = 0;
  for (const d of db.prepare("SELECT id, delete_reason FROM visits WHERE status='deleted' AND card_id IS NOT NULL AND card_paid>0 AND delete_reason LIKE 'Trùng: ô sổ đặt lịch%'").all()) {
    const m = /giữ lượt (\d+)/.exec(d.delete_reason || '');
    if (m && moveCardUse(d.id, Number(m[1]))) n++;
  }
  return n;
}
function closeUsedGifts() {
  repairDedupedCards();
  let n = 0;
  for (const c of db.prepare(`SELECT c.id FROM cards c WHERE c.sale_type='gift' AND EXISTS (SELECT 1 FROM card_txns t WHERE t.card_id=c.id AND t.amount<0 AND t.note<>?)`).all(L.GIFT_WRITE_OFF)) {
    const last = db.prepare('SELECT visit_id FROM card_txns WHERE card_id=? AND amount<0 AND note<>? ORDER BY (visit_id IS NULL), id DESC LIMIT 1').get(c.id, L.GIFT_WRITE_OFF);
    const before = L.cardBalance(c.id);
    L.closeGiftAfterUse(c.id, last ? last.visit_id : null, 1);
    if (before > 0) n++;
  }
  return n;
}
function dedupeVisits() {
  const cellText = (v) => String(v.note || '').replace(/^Sổ đặt lịch: /, '').split(' · ')[0];
  const rows = db.prepare("SELECT id, date, time, main_staff_id, customer_id, note, manual_edit FROM visits WHERE status='done' AND import_ref LIKE 'SO:%' ORDER BY id").all();
  const groups = new Map();
  for (const v of rows) {
    const k = `${v.date}|${v.time}|${v.main_staff_id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const done = new Set();
    for (const a of list) {
      if (done.has(a.id)) continue;
      const same = list.filter((b) => !done.has(b.id) && (b.customer_id === a.customer_id || (apptKey(cellText(a)) && apptKey(cellText(a)) === apptKey(cellText(b)))));
      if (same.length < 2) continue;
      same.sort((x, y) => (y.manual_edit || 0) - (x.manual_edit || 0) || y.id - x.id);
      for (const d of same.slice(1)) {
        moveCardUse(d.id, same[0].id);
        L.deleteVisit(d.id, 'Trùng: ô sổ đặt lịch bị sửa chữ nên nhập 2 lần (giữ lượt ' + same[0].id + ')', { id: 1 });
        db.prepare('UPDATE appointments SET visit_id=? WHERE visit_id=?').run(same[0].id, d.id);
        removed++;
      }
      for (const x of same) done.add(x.id);
    }
  }
  return removed;
}

function guessName(text) {
  let s = String(text).split(/[\n(–-]| \d/)[0];
  s = s.replace(/(?:\+?84|0)[\d.\s]{8,}/g, '').replace(/\s+/g, ' ').trim();
  return (s || String(text)).slice(0, 60);
}

// Công thức + hóa chất đã dùng (Hóa chất 1–4, lượng, đơn vị), thời gian xử lý, chi phí HC ước tính
function chemText(r) {
  const parts = [];
  const f = asText(r.get('Công thức / tỷ lệ pha')); if (f) parts.push(f);
  const chems = [];
  for (let i = 1; i <= 4; i++) {
    const n = asText(r.get('Hóa chất ' + i)); if (!n) continue;
    const q = asText(r.get('Lượng ' + i));
    const unit = asText(r.get(i === 1 ? 'ĐV' : 'ĐV#' + i)) || '';
    chems.push(q ? `${n} ${Math.round(Number(q) * 10) / 10 || q}${unit}` : n);
  }
  if (chems.length) parts.push('Hóa chất: ' + chems.join('; '));
  const t = asNum(r.get('Thời gian xử lý (phút)')); if (t) parts.push(`Thời gian: ${t} phút`);
  const cost = asNum(r.get('Chi phí hóa chất ước tính (VNĐ)')); if (cost) parts.push(`Chi phí HC ước tính: ${cost.toLocaleString('vi-VN')}đ`);
  return parts.length ? parts.join('\n') : null;
}

// ---------- Nhân viên ----------
function staffResolver(summary) {
  const users = db.prepare('SELECT id, full_name, aliases FROM users').all();
  const key = (s) => stripAccents(s).replace(/^(chi|anh|em|c|a|e)\s+/, '');
  const map = new Map();
  for (const u of users) {
    map.set(key(u.full_name), u.id);
    for (const a of String(u.aliases || '').split(',')) if (a.trim()) map.set(key(a), u.id);
  }
  return (name) => {
    const n = asText(name);
    if (!n) return null;
    const k = key(n);
    if (map.has(k)) return map.get(k);
    let username = 'nv_' + k.replace(/[^a-z0-9]/g, '').slice(0, 20);
    while (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) username += '1';
    const id = db.prepare("INSERT INTO users(username,full_name,role,can_login,active,must_change_pw) VALUES (?,?,'staff',0,0,0)").run(username, n).lastInsertRowid;
    map.set(k, id);
    summary.staff_created.push(n);
    return id;
  };
}

// ---------- Khách hàng ----------
function customerResolver(summary, user) {
  const byRef = db.prepare('SELECT customer_id FROM customer_refs WHERE source=? AND code=?');
  const byCode = db.prepare('SELECT id FROM customers WHERE code=? AND deleted=0');
  const byPhone = db.prepare('SELECT id FROM customers WHERE phone=? AND deleted=0');
  const all = () => db.prepare('SELECT id, name, phone FROM customers WHERE deleted=0').all();
  const addRef = db.prepare('INSERT OR IGNORE INTO customer_refs(source,code,customer_id) VALUES (?,?,?)');

  function find(source, code, phone, name) {
    if (code) {
      const r = byRef.get(source, code); if (r) return { id: r.customer_id, how: 'ref' };
      if (source === 'APP') { const c = byCode.get(code); if (c) return { id: c.id, how: 'code' }; }
    }
    if (phone) { const p = byPhone.get(phone); if (p) return { id: p.id, how: 'phone' }; }
    if (name) {
      const n = norm(name);
      const hits = all().filter((c) => norm(c.name) === n && (!phone || !c.phone || c.phone === phone));
      if (hits.length === 1) return { id: hits[0].id, how: 'name' };
      // Gần đúng: mọi chữ của tên (bỏ danh xưng) đều có trong tên khách, vd "Phương vợ Khánh" ↔ "Phương (vợ Khánh Tao Lao)"
      // Chỉ bỏ danh xưng ở ĐẦU tên: "Quang Anh", "Mai Chi" thì "Anh"/"Chi" là tên, không phải danh xưng
      const toks = (x) => { const w = stripAccents(x).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean); while (w.length > 1 && TITLES.has(w[0])) w.shift(); return w.filter((t, i) => !(i > 0 && /^(b|ban|cua)$/.test(t))); }; // "Hương b phúc" = "Hương (bạn Phúc)"
      const q = toks(name);
      // Danh xưng khác giới thì không ghép ("Hà" chị ≠ "Anh Hà"); tên 1 chữ phải cùng kiểu danh xưng
      const sex = (x) => { const w = stripAccents(x).split(/[^a-z]+/).filter(Boolean)[0] || ''; return /^(a|anh|chu|ong|bo|cau)$/.test(w) ? 'M' : /^(c|chi|co|ba|me)$/.test(w) ? 'F' : /^(e|em|b|be|ban)$/.test(w) ? 'N' : ''; };
      const okSex = (c) => { const a = sex(name), b = sex(c.name); if (a && b && a !== 'N' && b !== 'N' && a !== b) return false; return q.length > 1 || a === b || (a === 'N' && b !== '') || (b === 'N' && a !== ''); };
      const same = q.length ? all().filter((c) => toks(c.name).join(' ') === q.join(' ') && okSex(c) && (!phone || !c.phone || c.phone === phone)) : [];
      if (same.length === 1) return { id: same[0].id, how: 'name' }; // "E Bon" ↔ "Em Bon"
      // Tên 1 chữ ("E Quang") không ghép gần đúng vào tên dài hơn ("Quang Anh") — dễ là 2 người khác nhau
      if (q.length >= 2) {
        const fz = all().filter((c) => { const t = new Set(toks(c.name)); return q.every((w) => t.has(w)) && okSex(c) && (!phone || !c.phone || c.phone === phone); });
        // ưu tiên tên khớp từ đầu (vd "Khoa Điền" ↔ "Em Khoa Điền")
        const head = fz.filter((c) => toks(c.name).slice(0, q.length).join(' ') === q.join(' '));
        // chỉ nhận khi tên trùng phần đầu (tránh "Khánh Linh" ↔ "Alex (con Khánh Linh)")
        if (head.length === 1) return { id: head[0].id, how: 'name' };
      }
    }
    return null;
  }

  function upsert(source, data, counted = true) {
    const phone = L.normPhone(data.phone);
    const validPhone = phone && /^0\d{9,10}$/.test(phone) ? phone : null;
    const hit = find(source, data.code, validPhone, data.name);
    if (hit) {
      const c = db.prepare('SELECT * FROM customers WHERE id=?').get(hit.id);
      const upd = {};
      if (!c.phone && validPhone) upd.phone = validPhone;
      for (const k of ['gender', 'birthday', 'source']) if (!c[k] && data[k]) upd[k] = data[k];
      for (const k of ['hair_notes', 'notes']) {
        if (data[k] && !String(c[k] || '').includes(data[k])) upd[k] = c[k] ? `${c[k]}\n${data[k]}` : data[k];
      }
      const keys = Object.keys(upd);
      if (keys.length) db.prepare(`UPDATE customers SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => upd[k]), hit.id);
      if (data.code) addRef.run(source, data.code, hit.id);
      if (counted) {
        summary.customers_merged++;
        if (hit.how === 'name') summary.matched_by_name.push(data.name);
      }
      return hit.id;
    }
    if (!data.name) return null;
    let code = source === 'APP' && data.code && !byCode.get(data.code) ? data.code : nextCode('customers', 'KH', 4);
    const id = db.prepare('INSERT INTO customers(code,name,phone,gender,birthday,source,hair_notes,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(code, data.name, validPhone, data.gender || null, data.birthday || null, data.source || null, data.hair_notes || null, data.notes || null, user.id).lastInsertRowid;
    if (data.code) addRef.run(source, data.code, id);
    summary.customers_created++;
    if (phone && !validPhone) summary.warnings.push(`SĐT không hợp lệ, bỏ qua: ${data.name} – ${data.phone}`);
    return id;
  }
  return { upsert, find };
}

// ---------- Dịch vụ ----------
const GROUP_RATE = { 'Hóa chất': 0.15, 'Cắt': 0.03, 'Gội & chăm sóc': 0, 'Bán sản phẩm': 0.08 };
function importServices(rows, summary) {
  for (const r of rows) {
    const name = asText(r.get('Dịch vụ'));
    if (!name) continue;
    const price = asNum(r.get('Giá niêm yết (VNĐ)', 'Giá niêm yết'));
    let grp = asText(r.get('Nhóm doanh số'));
    if (!GROUPS.includes(grp)) grp = 'Cắt';
    const ex = db.prepare('SELECT * FROM services WHERE name=?').get(name);
    if (!ex) {
      db.prepare('INSERT INTO services(name,price,grp,commission_rate) VALUES (?,?,?,?)').run(name, price, grp, GROUP_RATE[grp] || 0);
      summary.services_added++;
    } else if (!ex.price && price) {
      db.prepare('UPDATE services SET price=? WHERE id=?').run(price, ex.id);
    }
  }
}

function crmGroup(g) {
  const s = norm(g);
  if (!s) return null;
  if (s.includes('cắt')) return 'Cắt';
  if (['làm màu', 'uốn', 'ép tóc', 'chữa trị', 'hóa chất'].some((x) => s.includes(x))) return 'Hóa chất';
  if (s.includes('sản phẩm')) return 'Bán sản phẩm';
  return 'Gội & chăm sóc';
}

async function importWorkbook(buffer, opts, user) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw L.bad('Không đọc được file. Chỉ nhận file .xlsx'); }
  const ws = (name) => wb.worksheets.find((w) => norm(w.name) === norm(name));
  const summary = {
    format: null, customers_created: 0, customers_merged: 0, matched_by_name: [], services_added: 0,
    visits_created: 0, visits_skipped_existing: 0, visits_skipped_duplicate: 0, visits_skipped_invalid: 0,
    appointments_created: 0, appointments_linked: 0, appointments_skipped: 0, appointments_cancelled: 0, pay_colors: {}, visits_paid_set: 0, assistants_found: 0, visits_assistant_set: 0, appointments_past_skipped: 0, book: null, cards_skipped_existing: 0, cards_created: 0, staff_created: [], warnings: [],
  };
  const importer = { ...user, role: 'owner' }; // bỏ giới hạn ngày của nhân viên khi nhập lịch sử

  const run = () => {
    const staffOf = staffResolver(summary);
    const cust = customerResolver(summary, user);
    const svcByName = new Map(db.prepare('SELECT id, name FROM services').all().map((s) => [norm(s.name), s.id]));
    const refreshSvc = () => { for (const s of db.prepare('SELECT id, name FROM services').all()) svcByName.set(norm(s.name), s.id); };
    let recognised = false;

    // ===== File "Salon Nếp – Nhật ký" =====
    const nk = ws('Nhật ký dịch vụ');
    if (nk) {
      recognised = true; summary.format = 'Salon Nếp – Nhật ký dịch vụ';
      const dm = ws('Danh mục');
      if (dm) { const rows = readTable(dm, ['Dịch vụ', 'Nhóm doanh số']); if (rows) { importServices(rows, summary); refreshSvc(); } }
      const kh = ws('Khách hàng');
      if (kh) {
        const rows = readTable(kh, ['Mã khách', 'Tên khách']) || [];
        for (const r of rows) {
          const name = asText(r.get('Tên khách')); if (!name) continue;
          cust.upsert('NK', { code: asText(r.get('Mã khách')), name, phone: asText(r.get('Số điện thoại')), birthday: asDate(r.get('Sinh nhật')),
            hair_notes: asText(r.get('Lưu ý về tóc, da đầu')) });
        }
      }
      const rows = readTable(nk, ['Ngày làm', 'Mã lượt', 'Thợ chính']) || [];
      for (const r of rows) {
        const date = asDate(r.get('Ngày làm'));
        const ref = asText(r.get('Mã lượt'));
        const name = asText(r.get('Tên khách'));
        if (!date || !ref || (!name && !asText(r.get('Mã khách')))) continue;
        const prev = db.prepare('SELECT id, formula FROM visits WHERE import_ref=?').get('NK:' + ref);
        if (prev) {
          // lượt đã nhập: bổ sung chi tiết hóa chất nếu bản cũ chưa có
          const ft = chemText(r);
          if (ft && ft !== prev.formula && (!prev.formula || ft.startsWith(prev.formula))) { db.prepare('UPDATE visits SET formula=? WHERE id=?').run(ft, prev.id); summary.visits_updated = (summary.visits_updated || 0) + 1; }
          summary.visits_skipped_existing++; continue;
        }
        const customerId = cust.upsert('NK', { code: asText(r.get('Mã khách')), name, phone: asText(r.get('Số điện thoại')) }, false);
        if (!customerId) { summary.visits_skipped_invalid++; continue; }
        const svcNames = ['Dịch vụ 1', 'Dịch vụ 2', 'Dịch vụ 3'].map((k) => asText(r.get(k))).filter(Boolean);
        const items = svcNames.map((n) => {
          const id = svcByName.get(norm(n));
          return id ? { service_id: id } : { name: n, price: 0 };
        });
        if (!items.length) items.push({ name: 'Không ghi dịch vụ', price: 0 });
        const listed = asNum(r.get('Tổng giá dịch vụ (VNĐ)'));
        const disc = asNum(r.get('Giảm giá (VNĐ)'));
        const thucThu = asNum(r.get('Thực thu (VNĐ)'));
        const target = thucThu || Math.max(0, listed - disc);
        const svcStmt = db.prepare('SELECT price FROM services WHERE id=?');
        let sub = items.reduce((s, i) => s + (i.service_id ? svcStmt.get(i.service_id).price : i.price), 0);
        if (sub === 0) { items[0] = { ...items[0], price: target }; sub = target; }
        const diff = target - sub;
        const reason = asText(r.get('Lý do giảm')) || (asNum(r.get('Tiền quy đổi điểm (VNĐ)')) ? 'Đổi điểm' : 'Chênh lệch khi nhập từ Excel');
        const notes = [asText(r.get('Phản hồi của khách')), asText(r.get('Ghi chú thanh toán (cọc / nợ / hoàn)'))].filter(Boolean).join(' · ');
        let pm = asText(r.get('Hình thức thanh toán'));
        L.saveVisit({
          customer_id: customerId, date, main_staff_id: staffOf(r.get('Thợ chính')) || staffOf('Chưa rõ thợ'),
          assistant_id: staffOf(r.get('Người phụ')), items,
          surcharge: diff > 0 ? diff : 0, discount: diff < 0 ? -diff : 0, discount_reason: diff < 0 ? reason : null,
          payment_method: pm, hair_before: asText(r.get('Tình trạng tóc trước khi làm')), wish: asText(r.get('Mong muốn của khách')),
          formula: chemText(r), result: asText(r.get('Kết quả sau làm')), note: notes || null,
          import_ref: 'NK:' + ref,
        }, importer, null, { imported: true });
        summary.visits_created++;
      }
    }

    // ===== File "CRM Nếp Hair" =====
    const crm = ws('CRM Khách');
    const ls = ws('Lịch sử');
    if (crm || ls) {
      recognised = true; summary.format = summary.format ? summary.format + ' + CRM Nếp Hair' : 'CRM Nếp Hair';
      if (crm) {
        const rows = readTable(crm, ['Mã KH', 'Tên khách']) || [];
        for (const r of rows) {
          const name = asText(r.get('Tên khách')); if (!name) continue;
          const g = asText(r.get('Giới tính'));
          cust.upsert('CRM', { code: asText(r.get('Mã KH')), name, phone: asText(r.get('SĐT')), gender: g,
            source: asText(r.get('Kênh đặt')), notes: asText(r.get('Ghi chú / sở thích')) });
        }
      }
      if (ls) {
        const rows = readTable(ls, ['Ngày', 'Mã KH', 'Trạng thái']) || [];
        const t = L.today();
        for (const r of rows) {
          const date = asDate(r.get('Ngày'));
          const code = asText(r.get('Mã KH'));
          const status = norm(asText(r.get('Trạng thái')));
          if (!date || !code || date.length !== 10) continue;
          const name = asText(r.get('Tên khách (tự hiện)', 'Tên khách'));
          const service = asText(r.get('Dịch vụ'));
          const time = asTime(r.get('Giờ'));
          if (status === 'đã đặt') {
            if (date < t) continue;
            const customerId = cust.upsert('CRM', { code, name }, false);
            const exists = db.prepare('SELECT 1 FROM appointments WHERE customer_id=? AND date=? AND time IS ?').get(customerId, date, time || '09:00');
            if (exists) continue;
            db.prepare("INSERT INTO appointments(customer_id,staff_id,date,time,service,status,note,created_by) VALUES (?,?,?,?,?,'booked',?,?)")
              .run(customerId, staffOf(r.get('Stylist')), date, time || '09:00', service, asText(r.get('Ghi chú')), user.id);
            summary.appointments_created++;
            continue;
          }
          if (status !== 'hoàn thành' || !opts.includeHistory) continue;
          const ref = 'CRM:' + crypto.createHash('sha1').update([date, time, code, service, asNum(r.get('Thu tiền (VNĐ)'))].join('|')).digest('hex').slice(0, 16);
          if (db.prepare('SELECT 1 FROM visits WHERE import_ref=?').get(ref)) { summary.visits_skipped_existing++; continue; }
          const customerId = cust.upsert('CRM', { code, name }, false);
          if (!customerId) { summary.visits_skipped_invalid++; continue; }
          // Chống trùng: cùng khách, cùng ngày đã có lượt (thường do file Nhật ký đã ghi) → bỏ qua
          if (db.prepare("SELECT 1 FROM visits WHERE customer_id=? AND date=? AND status='done'").get(customerId, date)) { summary.visits_skipped_duplicate++; continue; }
          const amount = asNum(r.get('Thu tiền (VNĐ)'));
          const sid = service ? svcByName.get(norm(service)) : null;
          const item = sid ? { service_id: sid, price: amount } : { name: service || 'Không ghi dịch vụ', grp: crmGroup(asText(r.get('Nhóm DV chính'))) || 'Khác', price: amount };
          const tip = asNum(r.get('Tiền tip (VNĐ)'));
          L.saveVisit({
            customer_id: customerId, date, time, main_staff_id: staffOf(r.get('Stylist')) || staffOf('Chưa rõ thợ'),
            assistant_id: staffOf(r.get('Thợ phụ 1')), items: [item], tip, note: asText(r.get('Ghi chú')), import_ref: ref,
          }, importer, null, { imported: true });
          summary.visits_created++;
        }
      }
    }

    // ===== File xuất từ chính phần mềm này =====
    if (!recognised) {
      const kh = ws('Khách hàng');
      const rows = kh && readTable(kh, ['Mã khách', 'Tên khách'], 3);
      if (rows) {
        recognised = true; summary.format = 'Danh sách khách hàng (mẫu của phần mềm)';
        for (const r of rows) {
          const name = asText(r.get('Tên khách')); if (!name) continue;
          cust.upsert('APP', { code: asText(r.get('Mã khách')), name, phone: asText(r.get('Số điện thoại')), gender: asText(r.get('Giới tính')),
            birthday: asDate(r.get('Sinh nhật')), source: asText(r.get('Nguồn khách')), hair_notes: asText(r.get('Lưu ý tóc / da đầu')), notes: asText(r.get('Ghi chú')) });
        }
      }
    }
    // ===== Thẻ voucher 1 triệu (tab "Quản lý Thẻ 1Tr") =====
    const vt = ws('Quản lý Thẻ 1Tr');
    const vRows = vt && readTable(vt, ['Mã thẻ', 'Tên khách hàng', 'Mệnh giá thẻ'], 10);
    if (vRows) {
      recognised = true; summary.format = summary.format || 'Thẻ voucher';
      for (const r of vRows) {
        const code = asText(r.get('Mã thẻ'));
        const name = asText(r.get('Tên khách hàng'));
        const value = asNum(r.get('Mệnh giá thẻ'));
        if (!code || !name || !value) continue;
        const giftType = db.prepare('SELECT id FROM card_types WHERE name=?').get(GIFT_CARD.name);
        if (db.prepare('SELECT 1 FROM cards WHERE code=?').get(code)) {
          // bản nhập trước đặt hạn sai (ngày cấp + 12 tháng) → sửa về hạn chung 25/10/2027
          db.prepare("UPDATE cards SET expires_at=?, name=?, card_type_id=? WHERE code=? AND sale_type='gift'").run(GIFT_CARD.expires, GIFT_CARD.name, giftType && giftType.id, code);
          summary.cards_skipped_existing++; continue;
        }
        const customerId = cust.upsert('APP', { name, phone: asText(r.get('Số điện thoại')) }, false);
        if (!customerId) continue;
        const soldAt = asDate(r.get('Ngày cấp thẻ')) || L.today();
        const used = asNum(r.get('Đã chi dùng'));
        const note = [asText(r.get('Ghi chú')), asText(r.get('Trạng thái'))].filter(Boolean).join(' · ') || null;
        const id = db.prepare(`INSERT INTO cards(code,customer_id,card_type_id,name,price,value,sold_at,expires_at,seller_id,sale_type,commission,status,note,created_by)
          VALUES (?,?,?,?,0,?,?,?,?,'gift',0,?,?,?)`).run(code, customerId, giftType && giftType.id, GIFT_CARD.name, value, soldAt, GIFT_CARD.expires,
          staffOf(r.get('NV phụ trách')), used >= value ? 'closed' : 'active', note, user.id).lastInsertRowid;
        if (used) {
          const svc = asText(r.get('Dịch vụ thực hiện'));
          const day = asDate(r.get('Ngày sử dụng'));
          db.prepare('INSERT INTO card_txns(card_id,amount,note,created_by) VALUES (?,?,?,?)')
            .run(id, -Math.min(used, value), ['Đã dùng (nhập từ Excel)', day, svc].filter(Boolean).join(' · '), user.id);
        }
        summary.cards_created++;
      }
    }

    // ===== Sổ đặt lịch theo ngày (tab "Tháng 10", "Tháng 11"...: mỗi ngày 1 khối, cột = thợ, dòng = giờ) =====
    const grids = wb.worksheets.filter((w) => /^tháng\s*\d+/.test(norm(w.name)));
    for (const g of grids) {
      const blocks = findDayBlocks(g);
      if (!blocks.length) continue;
      recognised = true; summary.format = summary.format || 'Sổ đặt lịch theo ngày';
      const t = L.today();
      if (opts.bookMoney !== false) require('./expenses').importFromBook(blocks.filter((b) => b.date <= t).map((b) => ({ date: b.date, items: b.spend })), user, summary);
      for (const b of blocks) {
        const money = opts.bookMoney && b.date >= BOOK_FROM && b.date < t;
        if (b.date < t && !opts.includeHistory && !money) { summary.appointments_past_skipped += b.entries.length; continue; }
        for (const e of b.entries) {
          const phone = extractPhone(e.text);
          const name = (money && BM.cleanName(e.text)) || guessName(e.text);
          let hit = cust.find('APP', null, phone, name);
          const cancelled = e.color === 'red';
          // Sổ có SĐT/tên khách → tạo hoặc bổ sung hồ sơ khách (điền SĐT còn thiếu)
          if (money && !cancelled && (phone || name)) { const id = cust.upsert('APP', { name, phone }, false); if (id) hit = { id }; }
          e.customerId = hit ? hit.id : null; e.cancelled = cancelled; e.pay = pay_(e.color);
          const pay = cancelled ? null : PAY_COLOR[e.color] || null;
          const status = cancelled ? 'cancelled' : b.date < t ? 'done' : 'booked';
          const reason = cancelled ? 'Ô đỏ trong sổ Excel: khách hủy / thợ nghỉ' : null;
          if (cancelled) summary.appointments_cancelled++;
          if (pay) summary.pay_colors[pay] = (summary.pay_colors[pay] || 0) + 1;
          // Người phụ ghi trong ngoặc: "C Điệp(Thu)", "E Ly (300)(Thoại phụ)"
          const asst = assistantIn(e.text, e.staffId);
          if (asst) summary.assistants_found++;
          // Trùng = cùng ngày + giờ + thợ và cùng ô (chữ y hệt, hoặc cùng khách / cùng tên khách — sổ sửa thêm tiền "A thái uk" → "A thái uk 685" vẫn là 1 lịch)
          const key = apptKey(e.text);
          const dup = db.prepare(`SELECT id, status, pay_note, note, customer_id, guest_name FROM appointments WHERE date=? AND time=? AND IFNULL(staff_id,0)=IFNULL(?,0)
              ORDER BY (visit_id IS NOT NULL) DESC, (status='done') DESC, id`).all(b.date, e.time, e.staffId)
            .find((a) => a.note === e.text || (hit && a.customer_id === hit.id) || (key && apptKey(a.note || a.guest_name || '') === key));
          let apptId;
          if (dup && hit) db.prepare('UPDATE appointments SET customer_id=COALESCE(customer_id,?) WHERE id=?').run(hit.id, dup.id);
          if (dup) {
            // Nhập lại file: cập nhật theo màu ô (hủy / hình thức thanh toán), không tạo trùng
            apptId = dup.id;
            if (dup.note !== e.text) db.prepare('UPDATE appointments SET note=? WHERE id=?').run(e.text, dup.id);
            if (cancelled && dup.status !== 'cancelled') db.prepare("UPDATE appointments SET status='cancelled', cancel_reason=COALESCE(cancel_reason,?) WHERE id=?").run(reason, dup.id);
            // Lãnh đạo đã bấm "Đã thu" trong app → giữ, sổ còn màu hồng cũng không đổi lại thành chưa thanh toán
            const appPaid = dup.pay_note && dup.pay_note !== 'Chưa thanh toán';
            if (pay !== dup.pay_note && (pay || dup.pay_note) && !(appPaid && (!pay || pay === 'Chưa thanh toán'))) db.prepare('UPDATE appointments SET pay_note=? WHERE id=?').run(pay, dup.id);
            if (asst) db.prepare('UPDATE appointments SET assistant_id=? WHERE id=? AND assistant_id IS NULL').run(asst, dup.id);
            summary.appointments_skipped++;
          } else {
            apptId = db.prepare('INSERT INTO appointments(customer_id,guest_name,guest_phone,staff_id,date,time,service,status,note,created_by,cancel_reason,pay_note,assistant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
              .run(hit ? hit.id : null, hit ? null : name, hit ? null : phone, e.staffId, b.date, e.time, null, status, e.text, user.id, reason, pay, asst).lastInsertRowid;
            summary.appointments_created++;
            if (hit) summary.appointments_linked++;
          }
          // Cập nhật lượt làm đã nhập cùng ngày/giờ/thợ/khách (chỉ khi khớp đúng 1 lượt)
          if (b.date < t && !cancelled && ((pay && pay !== 'Chưa thanh toán') || asst)) {
            let cands = db.prepare(`SELECT v.id, v.payment_method, v.assistant_id, v.cash_paid, v.total, v.time, c.name cname FROM visits v LEFT JOIN customers c ON c.id=v.customer_id
                WHERE v.date=? AND v.status='done' AND v.import_ref IS NOT NULL AND (? IS NULL OR v.main_staff_id=?) AND (? IS NULL OR v.customer_id=?) AND (v.time IS NULL OR v.time=?)`)
              .all(b.date, e.staffId, e.staffId, hit ? hit.id : null, hit ? hit.id : null, e.time);
            // Nhiều lượt cùng ngày: ưu tiên lượt đúng giờ, rồi lượt có tên khách khớp với chữ trong ô
            if (cands.length > 1 && cands.some((x) => x.time === e.time)) cands = cands.filter((x) => x.time === e.time);
            if (cands.length > 1 && name) {
              const toks = stripAccents(name).replace(/^(chi|anh|em|c|a|e|b|ban)\s+/, '').split(/\s+/).filter((w) => w.length > 1);
              if (toks.length) cands = cands.filter((x) => { const cn = stripAccents(x.cname || '').split(/[^a-z0-9]+/); return toks.every((w) => cn.includes(w)); });
            }
            const v = cands.length === 1 ? cands[0] : null;
            if (v && pay && pay !== 'Chưa thanh toán' && !v.payment_method && v.cash_paid > 0) { db.prepare('UPDATE visits SET payment_method=? WHERE id=?').run(pay, v.id); summary.visits_paid_set++; }
            if (v && asst && !v.assistant_id) {
              const u = db.prepare('SELECT commission_enabled FROM users WHERE id=?').get(asst);
              const rate = Number(db.prepare("SELECT value FROM settings WHERE key='assistant_rate'").pluck().get()) || 0;
              db.prepare('UPDATE visits SET assistant_id=?, assistant_commission=? WHERE id=?').run(asst, u && u.commission_enabled ? Math.round(v.total * rate) : 0, v.id);
              summary.visits_assistant_set++;
            }
          }
          e.apptId = apptId;
        }
        if (money) bookVisits(b);
      }
      // ===== Tiền theo sổ (từ 01/11): mỗi ô = 1 lượt làm, tiền dòng chia theo ô, khách trả dư → tip chung =====
      function bookVisits(b) {
        const st = summary.book || (summary.book = { days: 0, visits: 0, updated: 0, replaced_nk: 0, kept_manual: 0, extra_tip: 0, tip: 0, total: 0, unpaid: 0, voucher: 0, cards_created: [], rows_check: [], no_money: [] });
        st.days++;
        // Lượt nhập từ Nhật ký/CRM cùng ngày → thay bằng số liệu sổ (lượt nhân viên tự ghi trong app giữ nguyên)
        st.replaced_nk += db.prepare(`UPDATE visits SET status='deleted', delete_reason='Thay bằng số liệu sổ đặt lịch' WHERE date=? AND status='done' AND (import_ref LIKE 'NK:%' OR import_ref LIKE 'CRM:%')`).run(b.date).changes;
        const services = db.prepare('SELECT id, name, price, active FROM services').all();
        const byName = (n) => services.find((x) => x.name === n && x.active) || services.find((x) => x.name === n);
        const staffRows = new Map(db.prepare('SELECT id, full_name, level FROM users').all().map((u) => [u.id, u]));
        const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        const dayLabel = `${b.date.slice(8)}/${b.date.slice(5, 7)}`;
        let carry = [];
        const flush = (upTo) => { for (const e of carry.filter((x) => upTo == null || mins(upTo) - mins(x.time) > 60)) st.no_money.push(`${dayLabel} ${e.time}: ${e.text.slice(0, 60)}`); carry = upTo == null ? [] : carry.filter((x) => mins(upTo) - mins(x.time) <= 60); };
        for (const row of b.rows) {
          let es = row.entries.filter((e) => !e.cancelled && e.staffId);
          flush(row.time);
          // Dòng không ghi tiền: ô hồng = đã làm chưa thanh toán (tạo lượt); ô khác thường được cộng tiền ở dòng ngay dưới (≤ 60 phút)
          if (!row.amount && !row.tip) {
            carry.push(...es.filter((x) => x.pay !== 'Chưa thanh toán'));
            es = es.filter((x) => x.pay === 'Chưa thanh toán');
          } else if (carry.length && row.amount) {
            const own = es.reduce((t, e) => t + (BM.parseEntry(e.text, staffRows.get(e.staffId), byName, services).explicit || 0), 0);
            if (own && row.amount > own && es.every((e) => BM.parseEntry(e.text, staffRows.get(e.staffId), byName, services).explicit)) { es = [...carry, ...es]; carry = []; }
            else if (!own && es.length) { /* không có giá ghi: không đoán được, giữ nguyên */ }
          }
          // Ô chỉ ghi chú cho khách cùng dòng ("huyen dung vocher…", "… ck sau") → không tính là lượt riêng
          if (es.length > 1) {
            const k = (e) => BM.fold(BM.cleanName(e.text) || '').replace(/[^a-z0-9 ]+/g, ' ').trim().replace(/^(chi|anh|em|c|a|e|b)\s+/, '').split(/\s+/)[0];
            const notes = es.filter((e) => /voucher|vocher|voch|\bvc\b|dung the|con thua|con lai/.test(BM.fold(e.text)) && !BM.amounts(e.text).list.length && es.some((o) => o !== e && k(o) && k(o) === k(e)));
            for (const nt of notes) { const sib = es.find((o) => o !== nt && !notes.includes(o) && k(o) === k(nt)); if (sib) sib.noteText = (sib.noteText || '') + ' ' + nt.text; }
            es = es.filter((e) => !notes.includes(e));
          }
          if (!es.length) continue;
          for (const e of es) {
            e.parsed = BM.parseEntry(e.text, staffRows.get(e.staffId), byName, services, es.length === 1 ? row.amount : 0);
            if (e.noteText && !e.parsed.voucher) e.parsed.voucher = BM.parseEntry(e.noteText, null, byName, services).voucher;
          }
          BM.splitRow({ amount: row.amount, tip: row.tip, entries: es });
          const sum = es.reduce((t, e) => t + e.amount + e.parsed.surcharge, 0);
          if (es.some((e) => e.check) || (row.amount && Math.abs(row.amount - sum + es.reduce((t, e) => t + (e.voucher || 0), 0) - es.reduce((t, e) => t + e.extraTip, 0)) >= 1000)) st.rows_check.push(`${b.date.slice(8)}/${b.date.slice(5, 7)} ${row.time}: sổ thu ${row.amount.toLocaleString('vi-VN')}, giá ghi trong ô ${es.reduce((t, e) => t + (e.parsed.explicit || e.est) + e.parsed.surcharge, 0).toLocaleString('vi-VN')} (${es.map((e) => e.text).join(' | ').slice(0, 90)})`);
          for (const e of es) {
            if (!e.customerId) { const id = cust.upsert('APP', { name: BM.cleanName(e.text) || ('Khách ' + e.time), phone: null }, false); e.customerId = id; }
            // "+tt 2/11 685": khách trả nợ lượt ngày 2/11 → ghi lượt đó đã thu (không cộng doanh số hôm nay)
            const STOP = new Set(['a', 'anh', 'e', 'em', 'c', 'chi', 'co', 'b', 'ban', 'cua', 'chu', 'vc', 'voucher', 'the', 'kh', 'nap', 'tra', 'truoc', 'chau', 'tt', 'ck', 'sau', 'thu', 'no']);
            const tk = (x) => BM.fold(x).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w) && !/\d/.test(w));
            if (e.parsed.debt && e.customerId) {
              const dd = `${b.date.slice(0, 4)}-${String(e.parsed.debt.month).padStart(2, '0')}-${String(e.parsed.debt.day).padStart(2, '0')}`;
              const open = db.prepare(`SELECT v.id, v.customer_id, c.name FROM visits v JOIN customers c ON c.id=v.customer_id
                WHERE v.date=? AND v.status='done' AND v.payment_method IS NULL AND v.cash_paid>0 ORDER BY v.id`).all(dd);
              const mine = new Set(tk(e.text));
              // cùng khách; hoặc tên ngày đó gọn hơn ("A quân ck sau" ↔ "A Quân lợn … +tt 2/11")
              const dv = open.find((v) => v.customer_id === e.customerId) || open.find((v) => { const t = tk(v.name); return t.length && t.every((w) => mine.has(w)); });
              if (dv) {
                const pm = e.pay && e.pay !== 'Chưa thanh toán' ? e.pay : 'Tiền mặt';
                db.prepare("UPDATE visits SET payment_method=?, note=COALESCE(note,'') || ? WHERE id=?").run(pm, ` · đã trả ngày ${b.date.slice(8)}/${b.date.slice(5, 7)} (${pm})`, dv.id);
                db.prepare("UPDATE appointments SET pay_note=? WHERE visit_id=?").run(pm, dv.id);
                (st.debts_paid = st.debts_paid || []).push(`${dayLabel} trả cho ${e.parsed.debt.day}/${e.parsed.debt.month}: ${BM.cleanName(e.text) || ''} ${e.parsed.debt.amount.toLocaleString('vi-VN')}`);
              }
            }
            if (e.parsed.debtOnly) continue;
            // Ô ghi "tặng vc / tặng voucher / có vc / có thẻ vc" mà khách chưa có thẻ tri ân trong máy → bổ sung thẻ (chưa dùng)
            {
              const ft = BM.fold(e.text);
              const gm = /(chua\s*cap)/.test(ft) ? null : ft.match(/\b(tang|co|cap|phat)\s*(?:the\s*)?(vc|voucher|vocher|the tri an)\b/);
              // Tên ghi trong ô khác tên trong tab thẻ ("e duy anh" / "A Duy Anh") → coi là cùng người, không tạo thẻ thứ 2
              const mine = new Set(tk(e.text));
              const sameName = () => db.prepare("SELECT cu.name FROM cards c JOIN customers cu ON cu.id=c.customer_id WHERE c.sale_type='gift'").all()
                .some((r) => { const t = tk(r.name); return t.length && t.every((w) => mine.has(w)); });
              if (gm && e.customerId && !(e.voucher > 0) && !db.prepare("SELECT 1 FROM cards WHERE customer_id=? AND sale_type='gift'").get(e.customerId) && !sameName()) {
                const gt = db.prepare('SELECT id FROM card_types WHERE name=?').get(GIFT_CARD.name);
                const code = 'TA-' + b.date.slice(5).replace('-', '') + '-' + e.customerId;
                if (!db.prepare('SELECT 1 FROM cards WHERE code=?').get(code)) {
                  db.prepare(`INSERT INTO cards(code,customer_id,card_type_id,name,price,value,sold_at,expires_at,seller_id,sale_type,commission,status,note,created_by)
                    VALUES (?,?,?,?,0,?,?,?,?,'gift',0,'active',?,?)`).run(code, e.customerId, gt && gt.id, GIFT_CARD.name, GIFT_CARD.value || 1000000, b.date, GIFT_CARD.expires, e.staffId,
                    (gm[1] === 'co' ? 'Bổ sung từ sổ: ô ghi "có vc" ngày ' : 'Bổ sung từ sổ: ô ghi "tặng vc" ngày ') + b.date + ' nhưng chưa có trong tab Quản lý Thẻ 1Tr – kiểm tra lại', user.id);
                  (st.gifts_added = st.gifts_added || []).push(`${dayLabel} ${BM.cleanName(e.text) || e.text.slice(0, 30)}`);
                }
              }
            }
            const ref = 'SO:' + crypto.createHash('sha1').update([b.date, e.time, e.staffId, e.text].join('|')).digest('hex').slice(0, 16);
            let ex = db.prepare('SELECT * FROM visits WHERE import_ref=?').get(ref);
            if (!ex) {
              // Ô sổ bị sửa chữ sau khi đã nhập (thêm tiền, SĐT, tên…) → vẫn là lượt cũ (cùng ngày, giờ, thợ, cùng khách/tên), không tạo lượt thứ 2
              const key = apptKey(e.text);
              const cellText = (v) => String(v.note || '').replace(/^Sổ đặt lịch: /, '').split(' · ')[0];
              ex = db.prepare("SELECT * FROM visits WHERE date=? AND time=? AND main_staff_id=? AND import_ref LIKE 'SO:%' ORDER BY (status='done') DESC, id").all(b.date, e.time, e.staffId)
                .find((v) => v.customer_id === e.customerId || (key && apptKey(cellText(v)) === key)) || null;
              if (ex) { db.prepare('UPDATE visits SET import_ref=? WHERE id=?').run(ref, ex.id); st.relinked = (st.relinked || 0) + 1; }
            }
            if (ex && ex.status === 'deleted') continue; // quản lý đã xóa lượt này → không tạo lại
            if (ex && ex.manual_edit) { st.kept_manual++; continue; } // Lãnh đạo đã sửa tay (chia tiền, đổi dịch vụ) → giữ nguyên
            // Lượt đã có trong máy → KHÓA: không nhập lại / không đổi tiền nữa (doanh số không tự nhảy). Chỉ chỉnh khách nếu trước đó nhận nhầm.
            if (ex && !opts.updatePast) {
              if (ex.customer_id !== e.customerId && e.customerId) {
                db.prepare('UPDATE visits SET customer_id=? WHERE id=?').run(e.customerId, ex.id);
                db.prepare('UPDATE appointments SET customer_id=? WHERE visit_id=?').run(e.customerId, ex.id);
                st.customer_fixed = (st.customer_fixed || 0) + 1;
              }
              st.locked = (st.locked || 0) + 1;
              continue;
            }
            const manual = db.prepare(`SELECT 1 FROM visits WHERE date=? AND status='done' AND import_ref IS NULL AND main_staff_id=? AND (customer_id=? OR time=?)`).get(b.date, e.staffId, e.customerId, e.time);
            if (manual) { st.kept_manual++; continue; }
            const items = BM.fitItems(e.parsed.items.map((i) => ({ service_id: i.service_id, name: i.name, price: i.price, grp: i.grp })), e.amount);
            if (!items.length) items.push({ name: e.text.slice(0, 60), price: e.amount });
            const prodSvc = services.find((x) => x.name === 'Bán sản phẩm') || services.find((x) => /sản phẩm/i.test(x.name));
            if (e.extraProduct) items.push(prodSvc ? { service_id: prodSvc.id, name: 'Sản phẩm (theo sổ)', price: e.extraProduct } : { name: 'Sản phẩm (theo sổ)', grp: 'Bán sản phẩm', price: e.extraProduct });
            if (e.extraOther) items.push({ name: 'Chưa rõ dịch vụ (sổ thu thêm)', grp: 'Khác', price: e.extraOther });
            const input = { customer_id: e.customerId, date: b.date, time: e.time, main_staff_id: e.staffId, assistant_id: assistantIn(e.text, e.staffId), items,
              surcharge: e.parsed.surcharge, tip: e.tip, payment_method: e.pay && e.pay !== 'Chưa thanh toán' ? e.pay : null,
              note: 'Sổ đặt lịch: ' + e.text + (e.extraTip ? ` · khách trả dư ${e.extraTip.toLocaleString('vi-VN')} → tip chung` : '') + (e.pay === 'Chưa thanh toán' ? ' · CHƯA THANH TOÁN (ô hồng), giá theo bảng giá' : '') + (!row.amount && e.pay !== 'Chưa thanh toán' ? ' · sổ không ghi tiền thu (trả bằng thẻ?), giá theo bảng giá' : '') + (e.check === 'more' ? ' · ⚠ sổ thu nhiều hơn giá dịch vụ, chưa rõ khoản thêm – kiểm tra lại' : e.check ? ' · ⚠ giá ghi cao hơn tiền thu (thẻ/voucher?) – kiểm tra lại' : ''), import_ref: ref, appointment_id: e.apptId };
            let card = null;
            if (e.voucher > 0) {
              // Trừ thẻ tri ân 1tr: gắn đúng thẻ của khách (thay dòng "đã dùng" nhập từ tab Quản lý Thẻ 1Tr), doanh số giữ đủ cho thợ
              card = db.prepare(`SELECT c.* FROM cards c WHERE c.customer_id=? AND c.sale_type='gift' ORDER BY (c.id=?) DESC,
                (SELECT COUNT(*) FROM card_txns t WHERE t.card_id=c.id AND t.visit_id IS NULL AND t.amount<0) DESC, c.id LIMIT 1`).get(e.customerId, ex ? ex.card_id || 0 : 0);
              if (!card) {
                const gt = db.prepare('SELECT id FROM card_types WHERE name=?').get(GIFT_CARD.name);
                const code = 'TA-' + b.date.slice(5).replace('-', '') + '-' + e.customerId;
                const cid = db.prepare(`INSERT INTO cards(code,customer_id,card_type_id,name,price,value,sold_at,expires_at,seller_id,sale_type,commission,status,note,created_by)
                  VALUES (?,?,?,?,0,?,?,?,NULL,'gift',0,'active',?,?)`).run(code, e.customerId, gt && gt.id, GIFT_CARD.name, Math.max(GIFT_CARD.value || 1000000, e.voucher), b.date, GIFT_CARD.expires,
                  'Tạo khi nhập sổ đặt lịch: ô ghi dùng thẻ tri ân ngày ' + b.date + ' nhưng chưa thấy thẻ của khách – kiểm tra lại (có thể dùng thẻ của người khác)', user.id).lastInsertRowid;
                card = db.prepare('SELECT * FROM cards WHERE id=?').get(cid);
                st.cards_created.push(`${dayLabel} ${BM.cleanName(e.text) || e.text.slice(0, 30)}`);
              }
              if (!ex || ex.card_id !== card.id) {
                const loose = db.prepare('SELECT id FROM card_txns WHERE card_id=? AND visit_id IS NULL AND amount<0 AND note<>? ORDER BY id LIMIT 1').get(card.id, L.GIFT_WRITE_OFF);
                if (loose) db.prepare('DELETE FROM card_txns WHERE card_id=? AND visit_id IS NULL AND note=?').run(card.id, L.GIFT_WRITE_OFF);
                if (loose) db.prepare('DELETE FROM card_txns WHERE id=?').run(loose.id);
              }
              db.prepare("UPDATE cards SET status='active' WHERE id=?").run(card.id);
              const bal = L.cardBalance(card.id) - (ex && ex.card_id === card.id ? db.prepare('SELECT COALESCE(SUM(amount),0) s FROM card_txns WHERE visit_id=? AND card_id=?').get(ex.id, card.id).s : 0);
              input.card_id = card.id; input.card_paid = Math.min(e.voucher, Math.max(0, bal));
              if (!input.card_paid) { input.card_id = null; delete input.card_paid; }
              else { st.voucher += input.card_paid; input.note += ` · trừ thẻ tri ân ${card.code} ${input.card_paid.toLocaleString('vi-VN')}`; }
            }
            L.saveVisit(input, importer, ex || null, { imported: true });
            if (card && L.cardBalance(card.id) <= 0) db.prepare("UPDATE cards SET status='closed' WHERE id=?").run(card.id);
            if (ex) st.updated++; else st.visits++;
            if (e.pay === 'Chưa thanh toán') st.unpaid += e.amount;
            st.total += e.amount + e.parsed.surcharge + e.extraProduct + e.extraOther; st.tip += e.tip; st.extra_tip += e.extraTip;
          }
        }
        flush(null);
      }
      // Chỉ nhận đúng tên nhân viên đang có (không tự tạo người mới từ chữ trong ngoặc)
      function assistantIn(text, mainId) {
        const staff = db.prepare('SELECT id, full_name, aliases FROM users').all();
        const key = (x) => stripAccents(x).replace(/^(chi|anh|em|c|a|e)\s+/, '').trim();
        const names = (x) => [x.full_name, ...String(x.aliases || '').split(',')].map((a) => a.trim() && key(a)).filter(Boolean);
        // "(Thu)", "(Thoại phụ)", cả ngoặc quên đóng "Vợ Hạnh 785(Thu"
        for (const m of String(text).matchAll(/\(([^()]{2,25})(?:\)|$)/g)) {
          const k = key(m[1]).replace(/\s*phu$/, '').replace(/^phu\s*/, '').trim();
          const u = staff.find((x) => names(x).includes(k));
          if (u && u.id !== mainId) return u.id;
        }
        // Không có ngoặc nhưng ghi "Thoai phu"
        const f = ' ' + stripAccents(text).replace(/[^a-z0-9]+/g, ' ') + ' ';
        const u = staff.find((x) => x.id !== mainId && names(x).some((k) => f.includes(' ' + k + ' phu ')));
        return u ? u.id : null;
      }
      function findDayBlocks(ws) {
        const out = [];
        for (let r = 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          if (norm(asText(row.getCell(1).value)) !== 'giờ') continue;
          // ngày nằm ở cột B, 1–4 dòng phía trên tiêu đề
          let date = null;
          for (let k = 1; k <= 4 && r - k >= 1 && !date; k++) {
            const v = cellVal(ws.getRow(r - k).getCell(2).value);
            if (v instanceof Date && v.getUTCFullYear() > 2000) date = asDate(v);
          }
          if (!date) continue;
          const cols = [];
          for (let c = 2; c <= 12; c++) {
            const h = asText(row.getCell(c).value);
            if (!h) break;
            if (/thu tiền|tip|chi|ghi chú/.test(norm(h))) break;
            cols.push({ c, staffId: staffOf(h) });
          }
          const entries = [], rows = [];
          let amtCol = null, tipCol = null;
          let chiCol = null, noteCol = null;
          for (let c = 2; c <= 20; c++) { const h = norm(asText(row.getCell(c).value)); if (h === 'thu tiền') amtCol = c; else if (/^tiền tip|^tip$/.test(h)) tipCol = c; else if (h === 'chi') chiCol = c; else if (h === 'ghi chú' && chiCol && !noteCol) noteCol = c; }
          if (chiCol && !noteCol) noteCol = chiCol + 1;
          const spend = [];
          for (let i = r + 1; i <= Math.min(ws.rowCount, r + 40); i++) {
            const rr = ws.getRow(i);
            if (norm(asText(rr.getCell(1).value)) === 'giờ') break;
            if (norm(asText(rr.getCell(1).value)) === 'tổng ngày' || cols.some((x) => norm(asText(rr.getCell(x.c).value)) === 'tổng ngày')) break;
            // Cột Chi + Ghi chú (khoản chi trong ngày, có thể nằm ở dòng không có giờ)
            if (chiCol) { const v = asNum(rr.getCell(chiCol).value); if (v > 0 && v < 50000000) spend.push({ amount: v, note: asText(rr.getCell(noteCol).value) }); }
            const time = asTime(rr.getCell(1).value);
            if (!time) continue;
            const rowE = [];
            for (const x of cols) {
              const text = asText(rr.getCell(x.c).value);
              if (text && text.replace(/\s/g, '').length > 1) { const en = { time, staffId: x.staffId, text: text.replace(/\s+/g, ' ').trim(), color: cellColor(rr.getCell(x.c)) }; entries.push(en); rowE.push(en); }
            }
            if (rowE.length) rows.push({ time, entries: rowE, amount: amtCol ? asNum(rr.getCell(amtCol).value) : 0, tip: tipCol ? asNum(rr.getCell(tipCol).value) : 0 });
          }
          out.push({ date, entries, rows, spend });
        }
        return out;
      }
    }

    // ===== Tab "Lịch hẹn" / "Đặt lịch" (mẫu của phần mềm hoặc bảng tự ghi) =====
    const lh = ws('Lịch hẹn') || ws('Đặt lịch') || ws('Lich hen');
    const lhRows = lh && (readTable(lh, ['Ngày', 'Tên khách']) || readTable(lh, ['Ngày', 'SĐT']) || readTable(lh, ['Ngày', 'Mã khách']));
    if (lhRows) {
      recognised = true; summary.format = summary.format || 'Lịch hẹn';
      const ST = { 'đã đặt': 'booked', 'đặt lịch': 'booked', 'đã đến': 'arrived', 'hoàn thành': 'done', 'đã hủy': 'cancelled', 'hủy': 'cancelled', 'không đến': 'noshow' };
      const t = L.today();
      for (const r of lhRows) {
        const date = asDate(r.get('Ngày', 'Ngày hẹn'));
        const name = asText(r.get('Tên khách', 'Khách hàng', 'Họ tên'));
        const phone = asText(r.get('SĐT', 'Số điện thoại', 'Điện thoại'));
        const code = asText(r.get('Mã khách', 'Mã KH'));
        if (!date || date.length !== 10 || (!name && !phone && !code)) { if (date || name) summary.appointments_skipped++; continue; }
        const time = asTime(r.get('Giờ', 'Giờ hẹn')) || '09:00';
        const stText = norm(asText(r.get('Trạng thái')));
        const status = ST[stText] || (date < t ? 'done' : 'booked');
        const customerId = cust.upsert('APP', { code, name, phone }, false);
        if (!customerId) { summary.appointments_skipped++; continue; }
        if (db.prepare('SELECT 1 FROM appointments WHERE customer_id=? AND date=? AND time=?').get(customerId, date, time)) { summary.appointments_skipped++; continue; }
        db.prepare('INSERT INTO appointments(customer_id,staff_id,date,time,service,status,note,created_by) VALUES (?,?,?,?,?,?,?,?)')
          .run(customerId, staffOf(r.get('Thợ', 'Stylist', 'Nhân viên')), date, time, asText(r.get('Dịch vụ')), status, asText(r.get('Ghi chú')), user.id);
        summary.appointments_created++;
      }
    }

    // ===== Sổ nhập mỹ phẩm / hóa chất (file theo dõi chi phí cửa hàng) =====
    for (const w of wb.worksheets) {
      const rows = readTable(w, ['Mã NH', 'Tên sản phẩm', 'SL nhập'], 40);
      if (!rows) continue;
      recognised = true; summary.format = summary.format ? summary.format + ' + Sổ nhập hóa chất/sản phẩm' : 'Sổ nhập hóa chất/sản phẩm (' + w.name + ')';
      require('./stock').importPurchases(rows, { asText, asNum, asDate, norm }, summary, user);
    }

    if (!recognised) throw L.bad('Không nhận ra mẫu file. Hỗ trợ: "Salon Nếp – Nhật ký", "CRM Nếp Hair", file Excel xuất từ phần mềm (tab Khách hàng), hoặc file có tab "Lịch hẹn" (cột Ngày, Giờ, Tên khách, SĐT, Dịch vụ, Thợ).');
    if (opts.dryRun) throw ROLLBACK;
  };

  try {
    db.transaction(run)();
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  if (!opts.dryRun) try { summary.visits_deduped = dedupeVisits(); } catch (e) { summary.warnings.push('Dọn lượt trùng: ' + e.message); }
  if (!opts.dryRun) try { summary.gifts_closed = closeUsedGifts(); } catch (e) { summary.warnings.push('Đóng thẻ tri ân: ' + e.message); }
  if (!opts.dryRun) try { summary.appointments_deduped = dedupeAppointments(); } catch (e) { summary.warnings.push('Dọn lịch trùng: ' + e.message); }
  if (!opts.dryRun) try { require('./datafix').apply(); } catch (e) { summary.warnings.push('Bổ sung công thức: ' + e.message); }
  if (ws('Lịch sử') && !opts.includeHistory) summary.warnings.push('Chưa nhập lượt làm "Hoàn thành" từ tab "Lịch sử" (CRM Nếp Hair) vì trùng với Nhật ký dịch vụ. Tick "Nhập cả lịch sử" nếu cần.');
  return { dry_run: opts.dryRun, summary };
}

const VERSION = 3; // 2: không ghép "E Quang" vào "Quang Anh"
module.exports = { VERSION, dedupeVisits, closeUsedGifts, dedupeAppointments, apptKey, importWorkbook, asDate, asTime };
