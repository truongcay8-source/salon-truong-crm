'use strict';
// Chính sách bảo hành Nếp Hair (bảng giá 15/11/2026) → hạn bảo hành theo từng lượt làm.
const { db } = require('./db');

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const RULES = [
  { key: 'color', label: 'Màu (nhuộm / tẩy / highlight…)', days: 15,
    test: (n, g) => g !== 'Gội & chăm sóc' && !/da chet/.test(n) && /nhuom|tay|nang tone|nang sang|glossing|highlight|balayage|fashion light|cham chan/.test(n),
    note: 'Sửa miễn phí nếu lỗi kỹ thuật trong 15 ngày. Muốn tối màu hơn trong 10 ngày: giảm 15%.' },
  { key: 'perm', label: 'Uốn / duỗi / ép', days: 20,
    test: (n, g) => g !== 'Gội & chăm sóc' && /uon|duoi|ep side/.test(n),
    note: 'Làm lại miễn phí nếu lỗi kỹ thuật trong 20 ngày. Không hợp kiểu, làm lại trong 7 ngày: giảm 20%.' },
  { key: 'cut_m', label: 'Cắt nam (chỉnh form)', days: 3, test: (n, g) => g === 'Cắt' && /nam/.test(n), note: 'Chỉnh form miễn phí trong 3 ngày.' },
  { key: 'cut_f', label: 'Cắt nữ / mái (chỉnh form)', days: 7, test: (n, g) => g === 'Cắt' || /^cat (toc|mai)/.test(n), note: 'Chỉnh form miễn phí trong 7 ngày.' },
];
const EXCLUDE = 'Không bảo hành khi tóc đã chỉnh sửa ở nơi khác, không chăm sóc đúng hướng dẫn, hoặc do tác động bên ngoài.';

function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

const noCut = () => new Set(db.prepare('SELECT id FROM users WHERE no_cut_warranty=1').all().map((u) => u.id));
// items: [{name, grp, staff_id}] → [{key,label,days,until,note,services}]; mainStaff: thợ chính của lượt
function forItems(date, items, mainStaff) {
  const out = [];
  let skip = null;
  for (const it of items || []) {
    const n = fold(it.name);
    const r = RULES.find((x) => x.test(n, it.grp));
    if (!r) continue;
    // Cắt do thợ không áp bảo hành chỉnh form (anh Trường) → không ghi lưu ý bảo hành
    if (/^cut/.test(r.key) && (skip || (skip = noCut())).has(it.staff_id || mainStaff)) continue;
    const ex = out.find((w) => w.key === r.key);
    if (ex) { ex.services.push(it.name); continue; }
    out.push({ key: r.key, label: r.label, days: r.days, until: addDays(date, r.days), note: r.note, services: [it.name] });
  }
  return out;
}
function forVisit(v) { return v && v.date ? forItems(v.date, v.items, v.main_staff_id) : []; }

// Lượt còn trong hạn bảo hành (hôm nay ≤ hạn), mới nhất trước
// chemOnly: chỉ bảo hành hóa chất (màu, uốn/duỗi/ép) – trang Nhắc nhở không liệt kê bảo hành cắt
const CHEM = new Set(['color', 'perm']);
function active(today, customerId, chemOnly) {
  const from = addDays(today, -20);
  const visits = db.prepare(`SELECT v.id, v.code, v.date, v.customer_id, v.main_staff_id, c.name customer_name, c.phone, u.full_name staff_name
    FROM visits v LEFT JOIN customers c ON c.id=v.customer_id LEFT JOIN users u ON u.id=v.main_staff_id
    WHERE v.status='done' AND v.date>=? AND v.date<=? ${customerId ? 'AND v.customer_id=?' : ''} ORDER BY v.date DESC, v.id DESC`)
    .all(...[from, today, customerId].filter((x) => x != null));
  const items = db.prepare('SELECT name, grp, staff_id FROM visit_items WHERE visit_id=?');
  const out = [];
  for (const v of visits) {
    const w = forItems(v.date, items.all(v.id), v.main_staff_id).filter((x) => x.until >= today && (!chemOnly || CHEM.has(x.key)));
    if (w.length) out.push({ ...v, warranties: w, until: w.reduce((m, x) => (x.until > m ? x.until : m), '') });
  }
  return out;
}

// ===== Làm lại bảo hành do LỖI KỸ THUẬT (Vinh 26/11 chọn phương án C) =====
// Giá cốt đầu bảo hành = hóa chất dùng + phí vận hành/đầu (mặc định 50k – giả định).
// Thợ chịu 100% giá cốt; có người phụ → phụ chịu X% (chỉnh được, mặc định 30% – giả định), thợ chính chịu phần còn lại.
// Không có phụ → thợ chính chịu hết. Trừ vào Bảng lương tháng làm bảo hành.
db.exec(`CREATE TABLE IF NOT EXISTS warranty_jobs (
  id INTEGER PRIMARY KEY,
  orig_visit_id INTEGER REFERENCES visits(id),
  date TEXT NOT NULL,
  chem_cost INTEGER NOT NULL DEFAULT 0,
  fee INTEGER NOT NULL DEFAULT 0,
  staff_pct REAL NOT NULL DEFAULT 1,
  main_staff_id INTEGER REFERENCES users(id),
  assistant_id INTEGER REFERENCES users(id),
  asst_pct REAL NOT NULL DEFAULT 0,
  main_penalty INTEGER NOT NULL DEFAULT 0,
  asst_penalty INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_wj_date ON warranty_jobs(date);`);
for (const [k, v] of [['warranty_fee', '50000'], ['warranty_staff_pct', '100'], ['warranty_asst_pct', '30']]) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(k, v);
const conf = () => { const g = (k) => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) || {}).value;
  return { fee: Number(g('warranty_fee')) || 0, staff_pct: Number(g('warranty_staff_pct') ?? 100), asst_pct: Number(g('warranty_asst_pct') ?? 30) }; };
// Gợi ý cho lượt gốc: hóa chất lượt gốc đã xuất kho; chưa ghi kho thì ước 25% tiền dịch vụ hóa chất
function preview(visitId) {
  const v = db.prepare(`SELECT v.id, v.code, v.date, v.customer_id, v.main_staff_id, v.assistant_id, c.name customer_name, u.full_name staff_name, a.full_name assistant_name
    FROM visits v LEFT JOIN customers c ON c.id=v.customer_id LEFT JOIN users u ON u.id=v.main_staff_id LEFT JOIN users a ON a.id=v.assistant_id WHERE v.id=? AND v.status='done'`).get(visitId);
  if (!v) return null;
  const items = db.prepare('SELECT name, grp, price, staff_id, assistant_id FROM visit_items WHERE visit_id=?').all(v.id);
  const chemItems = items.filter((i) => i.grp === 'Hóa chất');
  const used = db.prepare("SELECT COALESCE(SUM(-qty*unit_cost),0) s FROM stock_moves WHERE visit_id=? AND kind='use'").get(v.id).s;
  const est = Math.round(chemItems.reduce((a, i) => a + i.price, 0) * 0.25);
  // Người làm dòng hóa chất (nếu dòng có thợ/phụ riêng)
  const ci = chemItems[0] || {};
  const main = ci.staff_id || v.main_staff_id;
  const asst = ci.assistant_id > 0 ? ci.assistant_id : ci.assistant_id === 0 ? null : v.assistant_id;
  return { visit: { ...v, services: items.map((i) => i.name).join(' + ') }, chem_cost: Math.round(used) || est, chem_source: used ? 'hóa chất lượt gốc đã xuất kho' : 'ước 25% tiền dịch vụ hóa chất',
    main_staff_id: main || null, assistant_id: asst || null, ...conf() };
}
function split(total, staffPct, hasAsst, asstPct) {
  const owe = Math.round(total * staffPct / 100);
  const a = hasAsst ? Math.round(owe * asstPct / 100) : 0;
  return { owe, main: owe - a, asst: a };
}
function jobs(from, to) {
  return db.prepare(`SELECT j.*, v.code orig_code, v.date orig_date, c.name customer_name, u.full_name main_name, a.full_name asst_name
    FROM warranty_jobs j LEFT JOIN visits v ON v.id=j.orig_visit_id LEFT JOIN customers c ON c.id=v.customer_id
    LEFT JOIN users u ON u.id=j.main_staff_id LEFT JOIN users a ON a.id=j.assistant_id
    WHERE j.deleted=0 AND j.date BETWEEN ? AND ? ORDER BY j.date, j.id`).all(from, to);
}
// Phạt bảo hành theo người trong kỳ: Map(user_id → {amount, list})
function penalties(from, to) {
  const out = new Map();
  const add = (uid, amt, j, role) => { if (!uid || !amt) return; const x = out.get(uid) || { amount: 0, list: [] }; x.amount += amt; x.list.push({ id: j.id, date: j.date, code: j.orig_code, customer: j.customer_name, role, amount: amt }); out.set(uid, x); };
  for (const j of jobs(from, to)) { add(j.main_staff_id, j.main_penalty, j, 'thợ chính'); add(j.assistant_id, j.asst_penalty, j, 'người phụ'); }
  return out;
}

module.exports = { forItems, forVisit, active, RULES, EXCLUDE, preview, split, jobs, penalties, conf };
