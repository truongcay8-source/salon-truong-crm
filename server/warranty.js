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

module.exports = { forItems, forVisit, active, RULES, EXCLUDE };
