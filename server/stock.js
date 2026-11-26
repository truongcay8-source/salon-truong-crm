'use strict';
// Kho vật tư: hóa chất làm dịch vụ (tính giá cốt) + sản phẩm bán lẻ (trừ kho, lãi gộp).
// Giá vốn = bình quân gia quyền các lần nhập. Nhân viên KHÔNG xem được giá nhập / giá cốt / lãi.
const { db, audit, nextCode, getSettings } = require('./db');
const L = require('./logic');
const { HttpError, bad, int, str, today, isDate } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service','retail')),
  grp TEXT,
  unit TEXT,
  size REAL,
  size_unit TEXT,
  sell_price INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in','use','sale','adjust')),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  price INTEGER,
  visit_id INTEGER REFERENCES visits(id),
  ref TEXT,
  supplier TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_moves_mat ON stock_moves(material_id);
CREATE INDEX IF NOT EXISTS idx_moves_visit ON stock_moves(visit_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_moves_ref ON stock_moves(ref) WHERE ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS service_materials (
  id INTEGER PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty REAL NOT NULL
);
`);
if (!db.prepare('PRAGMA table_info(visits)').all().some((c) => c.name === 'cost')) db.exec('ALTER TABLE visits ADD COLUMN cost INTEGER NOT NULL DEFAULT 0');
for (const c of ['material_id INTEGER', 'qty REAL']) {
  if (!db.prepare('PRAGMA table_info(visit_items)').all().some((x) => x.name === c.split(' ')[0])) db.exec('ALTER TABLE visit_items ADD COLUMN ' + c);
}

for (const c of ['min_qty REAL', 'ordered_at TEXT', 'ordered_by INTEGER']) {
  if (!db.prepare('PRAGMA table_info(materials)').all().some((x) => x.name === c.split(' ')[0])) db.exec('ALTER TABLE materials ADD COLUMN ' + c);
}
// Công thức → hóa chất: mỗi hóa chất có "mã viết trong công thức" (formula_keys); 1 màu mặc định khi công thức chỉ ghi số tông (9nb, 7glca…)
if (!db.prepare('PRAGMA table_info(materials)').all().some((x) => x.name === 'formula_keys')) {
  db.exec('ALTER TABLE materials ADD COLUMN formula_keys TEXT; ALTER TABLE materials ADD COLUMN formula_default INTEGER NOT NULL DEFAULT 0');
}
// Giá thị trường 1 đơn vị: dùng tính giá cốt khi hàng nhập 0đ (hàng tặng) – tiền thật phải bỏ ra nếu mua lại
if (!db.prepare('PRAGMA table_info(materials)').all().some((x) => x.name === 'ref_cost')) db.exec('ALTER TABLE materials ADD COLUMN ref_cost INTEGER');
// Mã vạch in trên sản phẩm (EAN…): 1 sản phẩm có thể nhiều mã, lưu cách nhau dấu phẩy
if (!db.prepare('PRAGMA table_info(materials)').all().some((x) => x.name === 'barcode')) db.exec('ALTER TABLE materials ADD COLUMN barcode TEXT');
const normCode = (c) => String(c || '').replace(/[^0-9A-Za-z\-._]/g, '').toUpperCase();
const codeList = (s) => [...new Set(String(s || '').split(/[,;\s]+/).map(normCode).filter(Boolean))];
function findByBarcode(code) {
  const c = normCode(code); if (!c) return null;
  return db.prepare("SELECT * FROM materials WHERE barcode IS NOT NULL AND barcode<>''").all().find((m) => codeList(m.barcode).includes(c)) || null;
}
// Gắn mã cho 1 sản phẩm (gỡ mã đó khỏi sản phẩm khác nếu đang gắn nhầm)
function attachBarcode(mid, code) {
  const c = normCode(code); if (!c) throw bad('Mã vạch trống');
  for (const m of db.prepare("SELECT id, barcode FROM materials WHERE barcode LIKE ?").all('%' + c + '%')) {
    if (m.id !== mid) db.prepare('UPDATE materials SET barcode=? WHERE id=?').run(codeList(m.barcode).filter((x) => x !== c).join(',') || null, m.id);
  }
  const cur = db.prepare('SELECT barcode FROM materials WHERE id=?').get(mid);
  db.prepare('UPDATE materials SET barcode=? WHERE id=?').run([...new Set([...codeList(cur && cur.barcode), c])].join(','), mid);
}
// Dung tích / giá tham chiếu tra từ web hãng & shop (17/11/2026). Chỉ điền ô đang trống, quản lý sửa được ở Kho.
// [mẫu tên, dung tích, đơn vị, giá thị trường 1 đơn vị nếu nhập 0đ, ghi chú nguồn]
const SIZE_FILL = [
  [/^màu davines mask$/i, 100, 'ml', null, 'Davines Mask with Vibrachrom tuýp 100ml (davinespro.com)'],
  [/^màu guytang$/i, 57, 'g', null, 'Guy Tang #mydentity tuýp 2oz ≈ 57g (giả định đúng dòng #mydentity)'],
  [/^màu jaas$/i, 100, 'ml', null, 'Giả định 100ml như tuýp màu salon phổ thông – chưa tìm thấy thông tin hãng'],
  [/^bột tẩy$/i, 500, 'g', null, 'Giả định hộp 500g (cỡ phổ biến) – kiểm tra nhãn hộp'],
  [/^strong gel davines$/i, 125, 'ml', null, 'Davines More Inside Strong Hold Cream Gel 125ml'],
  [/^moisture mousse davines$/i, 250, 'ml', null, 'Davines Curl Moisturizing Mousse 250ml'],
  [/activator 20vol/i, 900, 'ml', 306000, 'Nhập 0đ → lấy giá Activator 10/40vol cùng NCC 306.000đ/900ml'],
  [/activator 30vol/i, 900, 'ml', 306000, 'Nhập 0đ → lấy giá Activator 10/40vol cùng NCC 306.000đ/900ml'],
  [/blonde perfecting purple.*1000ml/i, 1000, 'ml', 1220000, 'Hàng tặng → ước tính ≈ 3 × chai 200ml (408.000đ), theo tỷ lệ giá 200ml/1L ở các shop nước ngoài'],
];
function fillSizes() {
  const rows = db.prepare('SELECT id, name, size, ref_cost, note FROM materials').all();
  for (const m of rows) {
    const f = SIZE_FILL.find(([re]) => re.test(String(m.name || '').trim()));
    if (!f) continue;
    const [, size, unit, ref, src] = f;
    if (m.size == null) db.prepare('UPDATE materials SET size=?, size_unit=?, note=? WHERE id=?').run(size, unit, [m.note, 'Dung tích: ' + src].filter(Boolean).join(' · '), m.id);
    if (ref && m.ref_cost == null) db.prepare('UPDATE materials SET ref_cost=? WHERE id=?').run(ref, m.id);
  }
}
function seedFormulaKeys() {
  const SEED = [
    [/^màu milbon addicthy/i, 'addicthy,graypearl,gray pearl,cobalt,colbalt,blue,silver,moonstone,sapphire,amethyst,ocean,purple,pink,red'],
    [/^màu milbon ordeve/i, 'ordeve'], [/^màu guytang/i, 'guytang,guy tang'], [/^màu jaas/i, 'jaas'], [/^màu davines mask$/i, 'davines'],
    [/high bleach/i, 'high bleach,highbleach'], [/low bleach/i, 'low bleach,lowbleach'], [/tint clear/i, 'clear'], [/^bột tẩy$/i, 'bot tay,bleach,tay'],
    [/color remover/i, 'remover'],
  ];
  const up = db.prepare("UPDATE materials SET formula_keys=? WHERE id=? AND (formula_keys IS NULL OR formula_keys='')");
  for (const m of db.prepare("SELECT id, name FROM materials WHERE kind='service'").all()) {
    const s = SEED.find(([re]) => re.test(m.name));
    const shade = m.name.match(/vibrachrom số\s*([\d.]+)/i);
    if (s) up.run(s[1], m.id); else if (shade) up.run('mask ' + shade[1] + ',' + shade[1], m.id);
  }
  // Tuýp màu Milbon (Ordeve, Addicthy) là 80g; chỉ điền khi đang để trống, quản lý sửa được ở Kho
  db.prepare("UPDATE materials SET size=80, size_unit='g' WHERE kind='service' AND size IS NULL AND (name LIKE 'Màu Milbon Ordeve%' OR name LIKE 'Màu Milbon Addicthy%')").run();
  if (!db.prepare('SELECT 1 FROM materials WHERE formula_default=1').get()) {
    const d = db.prepare("SELECT id FROM materials WHERE kind='service' AND active=1 AND name LIKE 'Màu Milbon Ordeve%'").get();
    if (d) db.prepare('UPDATE materials SET formula_default=1 WHERE id=?').run(d.id);
  }
}
// Giá bán lẻ tham khảo (tra 23/11/2026): chỉ điền khi giá bán đang trống, quản lý sửa được ở Kho.
// Món không tìm được giá rõ ràng (Muriem V/Scalp S 660ml, Moroccanoil, Davines, Surf Tonic) → để trống, không đoán.
const PRICE_FILL = [
  [/reuzel fiber pomade.*95g/i, 575000, 'reuzel.com.vn (trang Reuzel Việt Nam)'],
  [/label\.?m protein spray 250ml/i, 709000, 'Giá gốc tại myphamtocchinhhang.com, trùng giá niêm yết NCC'],
  [/label\.?m curl define cream 150ml/i, 828000, 'Giá gốc tại myphamtocchinhhang.com, trùng giá niêm yết NCC'],
  [/label\.?m fashion edition ultimate hairspray 250ml/i, 709000, 'Giá gốc tại myphamtocchinhhang.com, trùng giá niêm yết NCC'],
  [/elujuda bleach care serum 120ml/i, 668000, 'Giá gốc tại myphamtocnhapkhau.com, myphamtoclux.com'],
  [/^dầu xả muriem v\b/i, 1200000, 'Giá gốc tại chiaki.vn'],
  [/muriem cleansing.*250g/i, 750000, 'Giá gốc tại lizi.vn'],
];
function fillPrices() {
  for (const m of db.prepare("SELECT id, name, note FROM materials WHERE kind='retail' AND sell_price IS NULL").all()) {
    const f = PRICE_FILL.find(([re]) => re.test(String(m.name || '').trim()));
    if (f) db.prepare('UPDATE materials SET sell_price=?, note=? WHERE id=?').run(f[1], [m.note, 'Giá bán: ' + f[2]].filter(Boolean).join(' · '), m.id);
  }
}
seedFormulaKeys();
fillSizes();
fillPrices();

const isMgr = (u) => u.role !== 'staff';
const seeCost = (u) => u.role === 'owner'; // giá nhập / giá cốt / lãi gộp: CHỈ Lãnh đạo (Vinh 26/11)
// Quyền kho cho nhân viên: xem tồn + báo hàng hết (mặc định Chị Thu, Dương), kiểm kho đếm hàng (mặc định Dương)
function idsSetting(key, names) {
  const s = getSettings()[key];
  if (s != null) return s.split(',').map(Number).filter(Boolean);
  return db.prepare('SELECT id, full_name FROM users WHERE active=1').all().filter((u) => names.includes(u.full_name)).map((u) => u.id);
}
function perm(user) {
  if (isMgr(user)) return { stock_view: true, stock_count: true };
  const counters = idsSetting('stock_counters', ['Dương']);
  const viewers = idsSetting('stock_viewers', ['Chị Thu', 'Thu', 'Dương']);
  return { stock_view: viewers.includes(user.id) || counters.includes(user.id), stock_count: counters.includes(user.id) };
}
const need = (k) => (req, res, next) => (perm(req.user)[k] ? next() : next(new HttpError(403, 'Bạn chưa được giao quyền kho')));

// Tồn kho cho người kiểm/đặt hàng: KHÔNG có giá nhập
function stockLevels() {
  try { syncFormulaUse(); } catch (e) { console.error('Tự trừ kho theo công thức lỗi:', e.message); }
  const d30 = L.addDays(today(), -30);
  const use30 = new Map(db.prepare("SELECT material_id, SUM(-qty) q FROM stock_moves WHERE kind IN ('use','sale') AND date>? GROUP BY material_id").all(d30).map((r) => [r.material_id, r.q]));
  const lastIn = db.prepare("SELECT MAX(created_at) t FROM stock_moves WHERE material_id=? AND kind='in'");
  const lastCount = db.prepare("SELECT s.date, s.created_at, u.full_name by_name FROM stock_moves s LEFT JOIN users u ON u.id=s.created_by WHERE s.material_id=? AND s.kind='adjust' AND s.note LIKE 'Kiểm kho%' ORDER BY s.id DESC LIMIT 1");
  return db.prepare(`SELECT m.*, u.full_name ordered_by_name FROM materials m LEFT JOIN users u ON u.id=m.ordered_by WHERE m.active=1 ORDER BY m.kind, m.grp, m.name`).all().map((m) => {
    const stock = r2(stockOf(m.id));
    const li = lastIn.get(m.id).t;
    const reported = m.reported_at && !(li && li > m.reported_at) ? m.reported_at : null; // nhân viên báo hết qua chat, chưa nhập hàng lại
    // Chưa đặt mức báo: hóa chất báo khi đã mở đơn vị cuối (còn < 1), sản phẩm bán báo khi còn 1
    const lowAt = m.min_qty != null ? m.min_qty : m.kind === 'retail' ? 1 : null;
    const u30 = use30.get(m.id) || 0;
    const daysLeft = u30 > 0 && stock > 0 ? Math.floor(stock / (u30 / 30)) : null;
    // Chưa đặt mức báo mà theo tốc độ dùng 30 ngày chỉ còn đủ < 7 ngày → báo sắp hết để kịp đặt hàng
    const status = stock <= 0 ? 'out' : (lowAt != null ? stock <= lowAt : stock < 1) ? 'low' : reported ? 'low' : (m.min_qty == null && daysLeft != null && daysLeft < 7) ? 'low' : 'ok';
    const ordered = m.ordered_at && !(li && li > m.ordered_at) ? m.ordered_at : null;
    const lc = lastCount.get(m.id);
    return { id: m.id, code: m.code, name: m.name, kind: m.kind, grp: m.grp, unit: m.unit, size: m.size, size_unit: m.size_unit,
      stock, left_amt: m.size && stock > 0 ? Math.round(stock * m.size) : null, use30: r2(u30), use30_amt: m.size ? Math.round(u30 * m.size) : null, days_left: daysLeft,
      min_qty: m.min_qty, status, barcode: m.barcode, sell_price: m.sell_price, ordered_at: ordered, ordered_by_name: ordered ? m.ordered_by_name : null,
      last_count: lc ? lc.date : null, last_count_by: lc ? lc.by_name : null, reported_at: reported };
  });
}
function stockAlerts() { return stockLevels().filter((m) => m.status !== 'ok'); }
const r2 = (x) => Math.round(x * 1000) / 1000;

// Giá vốn bình quân 1 đơn vị (tuýp/chai/hộp)
function avgCost(mid) {
  const r = db.prepare("SELECT SUM(qty) q, SUM(qty*unit_cost) a FROM stock_moves WHERE material_id=? AND kind='in'").get(mid);
  const avg = r.q > 0 ? r.a / r.q : 0;
  if (avg > 0) return avg;
  const m = db.prepare('SELECT ref_cost FROM materials WHERE id=?').get(mid);
  return m && m.ref_cost > 0 ? m.ref_cost : 0;
}
function stockOf(mid) { return db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock_moves WHERE material_id=?').get(mid).q; }

// Dung tích trong tên/ĐVT: "Tuýp 100ml", "900ml", "500g", "5L"
function parseSize(...texts) {
  for (const t of texts) {
    const m = String(t || '').match(/(\d+(?:[.,]\d+)?)\s*(ml|g|l|kg)\b/i);
    if (m) {
      let n = Number(m[1].replace(',', '.')); let u = m[2].toLowerCase();
      if (u === 'l') { n *= 1000; u = 'ml'; } if (u === 'kg') { n *= 1000; u = 'g'; }
      return { size: n, size_unit: u };
    }
  }
  return { size: null, size_unit: null };
}

function materialRows(user, opts = {}) {
  const rows = db.prepare(`SELECT * FROM materials ${opts.all ? '' : 'WHERE active=1'} ORDER BY kind, grp, name`).all();
  return rows.map((m) => {
    const base = { id: m.id, code: m.code, name: m.name, kind: m.kind, grp: m.grp, unit: m.unit, size: m.size, size_unit: m.size_unit, sell_price: m.sell_price, active: m.active,
      formula_keys: m.formula_keys, formula_default: m.formula_default, barcode: m.barcode };
    // Sản phẩm bán lẻ: ai cũng thấy số còn (không có giá nhập) để biết còn hàng lúc bán cho khách
    if (!seeCost(user)) return m.kind === 'retail' || isMgr(user) ? { ...base, stock: r2(stockOf(m.id)) } : base;
    const cost = avgCost(m.id), stock = stockOf(m.id);
    return { ...base, note: m.note, ref_cost: m.ref_cost, avg_cost: Math.round(cost), cost_per_size: m.size ? cost / m.size : null, stock: r2(stock), stock_value: Math.round(stock * cost) };
  });
}

// Ghi vật tư của 1 lượt làm: hóa chất dùng (use) + sản phẩm bán (sale). Trả về giá cốt lượt.
// used = null (phiếu không gửi danh sách hóa chất) → giữ nguyên hóa chất đã ghi trước đó
function applyVisit(visitId, date, items, used, user) {
  if (!used) used = db.prepare("SELECT material_id, -qty qty, note FROM stock_moves WHERE visit_id=? AND kind='use' ORDER BY id").all(visitId);
  db.prepare('DELETE FROM stock_moves WHERE visit_id=?').run(visitId);
  const ins = db.prepare('INSERT INTO stock_moves(material_id,date,kind,qty,unit_cost,price,visit_id,created_by,note) VALUES (?,?,?,?,?,?,?,?,?)');
  let cost = 0;
  const one = (mid, qty, kind, price, note) => {
    const m = db.prepare('SELECT id FROM materials WHERE id=?').get(mid);
    if (!m || !(qty > 0)) return;
    const uc = avgCost(mid);
    ins.run(mid, date, kind, -qty, uc, price ?? null, visitId, user.id, note === AUTO_NOTE ? AUTO_NOTE : null);
    cost += qty * uc;
  };
  for (const u of used || []) one(int(u.material_id), Number(u.qty), 'use', null, u.note);
  for (const i of items) if (i.material_id) one(i.material_id, i.qty || 1, 'sale', i.price);
  db.prepare('UPDATE visits SET cost=? WHERE id=?').run(Math.round(cost), visitId);
  return Math.round(cost);
}
// Tự trừ kho theo công thức thợ ghi: lượt hóa chất chưa ghi "hóa chất đã dùng" (lượt đồng bộ từ sổ, hoặc thợ ghi công thức
// ở hồ sơ khách trong 10 ngày sau) → đọc công thức, đổi g/ml ra số tuýp/chai, ghi xuất kho (note AUTO_NOTE).
// Không trừ lượt trước lần kiểm kho gần nhất của món đó (số đếm đã gồm phần dùng) và không sửa lượt đã bị kiểm kho chốt.
const AUTO_NOTE = 'Tự trừ theo công thức';
let lastSync = 0;
function syncFormulaUse(force) {
  if (!force && Date.now() - lastSync < 60000) return 0;
  lastSync = Date.now();
  const { parseFormula } = require('../public/formula.js');
  const set = getSettings().formula_stock_from;
  const from = [isDate(set) ? set : '2026-11-01', L.addDays(today(), -40)].sort()[1];
  const mats = db.prepare('SELECT id, name, kind, size, size_unit, formula_keys, formula_default, active FROM materials').all();
  const byId = new Map(mats.map((m) => [m.id, m]));
  const counted = new Map(db.prepare("SELECT material_id, MAX(date) d FROM stock_moves WHERE kind='adjust' AND note LIKE 'Kiểm kho%' GROUP BY material_id").all().map((r) => [r.material_id, r.d]));
  const visits = db.prepare(`SELECT v.id, v.date, v.formula, v.main_staff_id, c.formula cformula, c.formula_at,
      (SELECT COUNT(*) FROM stock_moves WHERE visit_id=v.id AND kind='use' AND (note IS NULL OR note<>?)) manual
    FROM visits v JOIN customers c ON c.id=v.customer_id
    WHERE v.status='done' AND v.date>=? AND EXISTS (SELECT 1 FROM visit_items WHERE visit_id=v.id AND grp='Hóa chất')`).all(AUTO_NOTE, from);
  const cur = db.prepare("SELECT material_id, -qty qty FROM stock_moves WHERE visit_id=? AND kind='use' AND note=?");
  const del = db.prepare("DELETE FROM stock_moves WHERE visit_id=? AND kind='use' AND note=?");
  const ins = db.prepare("INSERT INTO stock_moves(material_id,date,kind,qty,unit_cost,visit_id,note,created_by) VALUES (?,?,'use',?,?,?,?,?)");
  const setCost = db.prepare("UPDATE visits SET cost=(SELECT COALESCE(ROUND(SUM(-qty*unit_cost)),0) FROM stock_moves WHERE visit_id=? AND kind IN ('use','sale')) WHERE id=?");
  let n = 0;
  db.transaction(() => {
    for (const v of visits) {
      if (v.manual) continue; // đã ghi hóa chất bằng tay ở phiếu → giữ nguyên
      const have = cur.all(v.id, AUTO_NOTE);
      if (have.some((h) => (counted.get(h.material_id) || '') >= v.date)) continue; // đã kiểm kho sau lượt này
      const late = v.formula_at && v.formula_at >= v.date && v.formula_at <= L.addDays(v.date, 10);
      const text = v.formula || (late ? v.cformula : null);
      const want = new Map();
      if (text) for (const l of parseFormula(text, mats).lines) {
        const m = byId.get(l.material_id);
        if (!m || !m.size || !(l.amt > 0) || (counted.get(m.id) || '') >= v.date) continue;
        want.set(m.id, r2((want.get(m.id) || 0) + l.amt / m.size));
      }
      if (have.length === want.size && have.every((h) => Math.abs((want.get(h.material_id) ?? -1) - h.qty) < 1e-6)) continue;
      del.run(v.id, AUTO_NOTE);
      for (const [mid, q] of want) ins.run(mid, v.date, -q, avgCost(mid), v.id, AUTO_NOTE, v.main_staff_id || null);
      setCost.run(v.id, v.id);
      n++;
    }
  })();
  return n;
}
function clearVisit(visitId) { db.prepare('DELETE FROM stock_moves WHERE visit_id=?').run(visitId); }
function visitMaterials(visitId) {
  return db.prepare(`SELECT s.material_id, -s.qty qty, s.kind, s.unit_cost, m.name, m.size, m.size_unit, m.unit FROM stock_moves s JOIN materials m ON m.id=s.material_id
    WHERE s.visit_id=? AND s.kind='use' ORDER BY s.id`).all(visitId);
}

// ---------- Nhập từ Excel (sheet "Nhập mỹ phẩm": Mã NH, Tên sản phẩm, SL nhập, Đơn giá thực…) ----------
// Giá bán SP mặc định = giá niêm yết NCC (chỉ khi cao hơn giá nhập); quản lý sửa ở Kho.
// Loại 1 (vật tư làm dịch vụ) → kho hóa chất; Loại 3 (hàng bán lẻ) → kho sản phẩm; Loại 2 (vận hành) bỏ qua.
// Tải lại cùng file: dòng đã có (theo Mã NH) được cập nhật, không nhân đôi.
function importPurchases(rows, helpers, summary, user) {
  const { asText, asNum, asDate, norm } = helpers;
  const byName = new Map(db.prepare('SELECT id, name FROM materials').all().map((m) => [norm(m.name), m.id]));
  summary.materials_created = summary.materials_created || 0;
  summary.purchases_created = summary.purchases_created || 0;
  summary.purchases_updated = summary.purchases_updated || 0;
  summary.purchases_skipped_ops = summary.purchases_skipped_ops || 0;
  for (const r of rows) {
    const ref = asText(r.get('Mã NH'));
    const rawName = asText(r.get('Tên sản phẩm'));
    if (!ref || !rawName) continue;
    const cls = norm(asText(r.get('Phân loại kế toán')));
    const grp = asText(r.get('Nhóm'));
    const kind = cls.startsWith('loại 3') || /bán lẻ/.test(norm(grp)) ? 'retail' : cls.startsWith('loại 1') ? 'service' : null;
    if (!kind) { summary.purchases_skipped_ops++; continue; }
    const name = rawName.replace(/\s*\((tặng|km|khuyến mãi)\)\s*$/i, '').trim();
    const qty = asNum(r.get('SL nhập'));
    if (!(qty > 0)) continue;
    let unitCost = asNum(r.get('Đơn giá thực'));
    const amount = asNum(r.get('Thành tiền'));
    if (unitCost == null && amount != null) unitCost = amount / qty;
    const unit = asText(r.get('ĐVT'));
    const list = asNum(r.get('Giá niêm yết'));
    let mid = byName.get(norm(name));
    if (!mid) {
      const sz = parseSize(name, unit);
      mid = db.prepare('INSERT INTO materials(code,name,kind,grp,unit,size,size_unit,sell_price) VALUES (?,?,?,?,?,?,?,?)')
        .run(nextCode('materials', 'VT', 4), name, kind, grp, unit, sz.size, sz.size_unit, kind === 'retail' && list && list > (unitCost || 0) ? Math.round(list) : null).lastInsertRowid;
      byName.set(norm(name), mid); summary.materials_created++;
    }
    const date = asDate(r.get('Ngày nhập'));
    const row = [mid, date && date.length === 10 ? date : today(), qty, unitCost || 0, asText(r.get('Nhà cung cấp')), asText(r.get('Số phiếu')), user.id];
    const old = db.prepare('SELECT id FROM stock_moves WHERE ref=?').get('NH:' + ref);
    if (old) {
      db.prepare('UPDATE stock_moves SET material_id=?, date=?, qty=?, unit_cost=?, supplier=?, note=?, created_by=? WHERE id=?').run(...row, old.id);
      summary.purchases_updated++;
    } else {
      db.prepare("INSERT INTO stock_moves(material_id,date,qty,unit_cost,supplier,note,created_by,kind,ref) VALUES (?,?,?,?,?,?,?,'in',?)").run(...row, 'NH:' + ref);
      summary.purchases_created++;
    }
  }
}

function mount(app, { MGR, OWNER }) {
  app.get('/api/stock/levels', need('stock_view'), (req, res) => res.json(stockLevels()));
  // Kiểm kho: nhập số đếm thực tế → ghi điều chỉnh chênh lệch (giá vốn bình quân), lưu ngày kiểm
  app.post('/api/stock/count', need('stock_count'), (req, res) => {
    const lines = (Array.isArray(req.body.lines) ? req.body.lines : []).filter((l) => l.counted !== '' && l.counted != null && Number(l.counted) >= 0);
    if (!lines.length) throw bad('Chưa nhập số đếm nào');
    const date = today();
    const note = 'Kiểm kho' + (str(req.body.note) ? ': ' + str(req.body.note) : '');
    const ins = db.prepare("INSERT INTO stock_moves(material_id,date,kind,qty,unit_cost,note,created_by) VALUES (?,?,'adjust',?,?,?,?)");
    const diffs = [];
    db.transaction(() => {
      for (const l of lines) {
        const mid = int(l.material_id);
        const m = db.prepare('SELECT id, name FROM materials WHERE id=?').get(mid);
        if (!m) continue;
        const before = r2(stockOf(mid)); const counted = r2(Number(l.counted));
        const d = r2(counted - before);
        ins.run(mid, date, d, avgCost(mid), note, req.user.id);
        if (d) diffs.push({ material_id: mid, name: m.name, before, counted, diff: d });
      }
    })();
    audit(req.user.id, 'stock_count', 'material', null, { changes: Object.fromEntries(diffs.map((d) => [d.name, [d.before, d.counted]])) });
    res.json({ ok: true, counted: lines.length, diffs });
  });
  // Quét mã vạch: tra sản phẩm (ai đăng nhập cũng tra được để tính tiền; không trả giá nhập)
  app.get('/api/stock/barcode/:code', (req, res) => {
    const m = findByBarcode(req.params.code);
    if (!m) return res.json({ found: false, code: normCode(req.params.code) });
    res.json({ found: true, id: m.id, name: m.name, kind: m.kind, unit: m.unit, sell_price: m.sell_price, active: m.active, stock: r2(stockOf(m.id)) });
  });
  app.post('/api/stock/:id/barcode', need('stock_view'), (req, res) => {
    const id = int(req.params.id);
    if (!db.prepare('SELECT 1 FROM materials WHERE id=?').get(id)) throw new HttpError(404, 'Không tìm thấy sản phẩm');
    attachBarcode(id, req.body.code);
    audit(req.user.id, 'stock_barcode', 'material', id, { code: normCode(req.body.code) });
    res.json({ ok: true });
  });
  // Nhập thêm hàng khi quét mã (người kiểm kho làm được). Nhân viên không nhập giá → lấy giá vốn bình quân, quản lý sửa sau.
  app.post('/api/stock/:id/receive', need('stock_count'), (req, res) => {
    const id = int(req.params.id);
    if (!db.prepare('SELECT 1 FROM materials WHERE id=?').get(id)) throw new HttpError(404, 'Không tìm thấy sản phẩm');
    const qty = Number(req.body.qty);
    if (!(qty > 0)) throw bad('Nhập số lượng');
    const given = seeCost(req.user) && req.body.unit_cost !== '' && req.body.unit_cost != null ? Math.max(0, Number(req.body.unit_cost) || 0) : null;
    const uc = given != null ? given : avgCost(id);
    const note = (given == null && !seeCost(req.user) ? 'Nhập kho (giá theo bình quân, chờ Lãnh đạo kiểm)' : 'Nhập hàng') + (str(req.body.note) ? ' · ' + str(req.body.note) : '');
    db.prepare("INSERT INTO stock_moves(material_id,date,kind,qty,unit_cost,supplier,note,created_by) VALUES (?,?,'in',?,?,?,?,?)")
      .run(id, today(), qty, uc, str(req.body.supplier), note, req.user.id);
    audit(req.user.id, 'stock_in', 'material', id, { qty, by_scan: true });
    res.json({ ok: true, stock: r2(stockOf(id)) });
  });
  // Mức báo sắp hết + đánh dấu đã gọi hàng (người xem kho làm được)
  app.put('/api/stock/:id/min', need('stock_view'), (req, res) => {
    const v = req.body.min_qty === '' || req.body.min_qty == null ? null : Math.max(0, Number(req.body.min_qty));
    db.prepare('UPDATE materials SET min_qty=? WHERE id=?').run(Number.isFinite(v) ? v : null, int(req.params.id));
    res.json({ ok: true });
  });
  app.post('/api/stock/:id/ordered', need('stock_view'), (req, res) => {
    const on = req.body.ordered !== false;
    if (on) db.prepare("UPDATE materials SET ordered_at=datetime('now','localtime'), ordered_by=? WHERE id=?").run(req.user.id, int(req.params.id));
    else db.prepare('UPDATE materials SET ordered_at=NULL, ordered_by=NULL WHERE id=?').run(int(req.params.id));
    audit(req.user.id, on ? 'stock_ordered' : 'stock_unordered', 'material', int(req.params.id), {});
    res.json({ ok: true });
  });
  app.get('/api/stock/perm', MGR, (req, res) => res.json({ viewers: idsSetting('stock_viewers', ['Chị Thu', 'Thu', 'Dương']), counters: idsSetting('stock_counters', ['Dương']) }));
  app.put('/api/stock/perm', MGR, (req, res) => {
    const ids = (a) => (Array.isArray(a) ? a : []).map(int).filter(Boolean).join(',');
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('stock_viewers',?)").run(ids(req.body.viewers));
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('stock_counters',?)").run(ids(req.body.counters));
    audit(req.user.id, 'stock_perm', 'settings', null, req.body);
    res.json({ ok: true });
  });
  app.get('/api/materials', (req, res) => res.json(materialRows(req.user, { all: req.query.all === '1' && isMgr(req.user) })));
  const matInput = (b) => {
    const name = str(b.name); if (!name) throw bad('Nhập tên vật tư');
    const sz = Number(b.size) > 0 ? Number(b.size) : null;
    return { name, kind: b.kind === 'retail' ? 'retail' : 'service', grp: str(b.grp), unit: str(b.unit), size: sz, size_unit: sz ? (b.size_unit === 'g' ? 'g' : 'ml') : null,
      sell_price: b.sell_price === '' || b.sell_price == null ? null : Math.max(0, int(b.sell_price)), active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1, note: str(b.note),
      ref_cost: b.ref_cost === '' || b.ref_cost == null ? null : Math.max(0, int(b.ref_cost)) || null,
      barcode: codeList(b.barcode).join(',') || null,
      formula_keys: str(b.formula_keys), formula_default: b.formula_default === '1' || b.formula_default === 1 || b.formula_default === true ? 1 : 0 };
  };
  const oneDefault = (id, m) => { if (m.formula_default) db.prepare('UPDATE materials SET formula_default=0 WHERE id<>?').run(id); };
  app.post('/api/materials', MGR, (req, res) => {
    const m = matInput(req.body);
    const cols = Object.keys(m);
    const id = db.prepare(`INSERT INTO materials(code,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`).run(nextCode('materials', 'VT', 4), ...cols.map((k) => m[k])).lastInsertRowid;
    oneDefault(id, m);
    res.json({ id });
  });
  app.put('/api/materials/:id', MGR, (req, res) => {
    const id = int(req.params.id);
    if (!db.prepare('SELECT 1 FROM materials WHERE id=?').get(id)) throw new HttpError(404, 'Không tìm thấy vật tư');
    const m = matInput(req.body); const cols = Object.keys(m);
    db.prepare(`UPDATE materials SET ${cols.map((k) => k + '=?').join(',')} WHERE id=?`).run(...cols.map((k) => m[k]), id);
    oneDefault(id, m);
    res.json({ ok: true });
  });
  // Nhập thêm hàng / kiểm kho điều chỉnh
  app.post('/api/materials/:id/move', MGR, (req, res) => {
    const id = int(req.params.id);
    if (!db.prepare('SELECT 1 FROM materials WHERE id=?').get(id)) throw new HttpError(404, 'Không tìm thấy vật tư');
    const kind = req.body.kind === 'adjust' ? 'adjust' : 'in';
    const qty = Number(req.body.qty);
    if (!qty || (kind === 'in' && qty < 0)) throw bad('Nhập số lượng');
    if (kind === 'adjust' && !str(req.body.note)) throw bad('Ghi lý do điều chỉnh kho');
    const uc = kind === 'in' ? Math.max(0, Number(req.body.unit_cost) || 0) : avgCost(id);
    db.prepare('INSERT INTO stock_moves(material_id,date,kind,qty,unit_cost,supplier,note,created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, isDate(req.body.date) ? req.body.date : today(), kind, qty, uc, str(req.body.supplier), str(req.body.note), req.user.id);
    audit(req.user.id, 'stock_' + kind, 'material', id, { qty, unit_cost: uc });
    res.json({ ok: true });
  });
  app.get('/api/materials/:id/moves', OWNER, (req, res) => {
    res.json(db.prepare(`SELECT s.*, v.code visit_code, c.name customer_name FROM stock_moves s LEFT JOIN visits v ON v.id=s.visit_id LEFT JOIN customers c ON c.id=v.customer_id
      WHERE s.material_id=? ORDER BY s.date DESC, s.id DESC LIMIT 200`).all(int(req.params.id)));
  });

  // Định mức hóa chất cho từng dịch vụ (nhân viên lấy để điền sẵn; giá cốt chỉ quản lý thấy)
  app.get('/api/recipes', (req, res) => {
    const rows = db.prepare('SELECT service_id, material_id, qty FROM service_materials ORDER BY id').all();
    if (!seeCost(req.user)) return res.json(rows);
    res.json(rows.map((r) => ({ ...r, cost: Math.round(r.qty * avgCost(r.material_id)) })));
  });
  app.put('/api/recipes/:serviceId', MGR, (req, res) => {
    const sid = int(req.params.serviceId);
    if (!db.prepare('SELECT 1 FROM services WHERE id=?').get(sid)) throw new HttpError(404, 'Không tìm thấy dịch vụ');
    const lines = (Array.isArray(req.body.lines) ? req.body.lines : []).map((l) => ({ material_id: int(l.material_id), qty: Number(l.qty) })).filter((l) => l.material_id && l.qty > 0);
    db.transaction(() => {
      db.prepare('DELETE FROM service_materials WHERE service_id=?').run(sid);
      for (const l of lines) db.prepare('INSERT INTO service_materials(service_id,material_id,qty) VALUES (?,?,?)').run(sid, l.material_id, l.qty);
    })();
    res.json({ ok: true });
  });

  // Báo cáo giá cốt & lãi gộp
  app.get('/api/reports/cost', OWNER, (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : today().slice(0, 8) + '01';
    const to = isDate(req.query.to) ? req.query.to : today();
    const grpRev = db.prepare(`SELECT COALESCE(i.grp,'Khác') grp, SUM(i.price) revenue, COUNT(DISTINCT v.id) visits FROM visit_items i JOIN visits v ON v.id=i.visit_id
      WHERE v.status='done' AND v.date BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const moves = db.prepare(`SELECT s.kind, m.kind mkind, SUM(-s.qty*s.unit_cost) cost FROM stock_moves s JOIN materials m ON m.id=s.material_id JOIN visits v ON v.id=s.visit_id
      WHERE v.status='done' AND v.date BETWEEN ? AND ? AND s.kind IN ('use','sale') GROUP BY 1`).all(from, to);
    const useCost = Math.round((moves.find((x) => x.kind === 'use') || {}).cost || 0);
    const saleCost = Math.round((moves.find((x) => x.kind === 'sale') || {}).cost || 0);
    const chemRev = (grpRev.find((g) => g.grp === 'Hóa chất') || {}).revenue || 0;
    const prodRev = (grpRev.find((g) => g.grp === 'Bán sản phẩm') || {}).revenue || 0;
    const visits = db.prepare(`SELECT v.id, v.code, v.date, v.total, v.cost, c.name customer_name, u.full_name staff_name,
        (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id) services,
        (SELECT SUM(price) FROM visit_items WHERE visit_id=v.id AND grp='Hóa chất') chem_revenue,
        (SELECT COUNT(*) FROM stock_moves WHERE visit_id=v.id AND kind='use') used_lines
      FROM visits v JOIN customers c ON c.id=v.customer_id LEFT JOIN users u ON u.id=v.main_staff_id
      WHERE v.status='done' AND v.date BETWEEN ? AND ? AND (v.cost>0 OR EXISTS (SELECT 1 FROM visit_items i WHERE i.visit_id=v.id AND i.grp='Hóa chất'))
      ORDER BY v.date DESC, v.id DESC`).all(from, to);
    const topUsed = db.prepare(`SELECT m.name, m.size, m.size_unit, m.unit, SUM(-s.qty) qty, SUM(-s.qty*s.unit_cost) cost FROM stock_moves s JOIN materials m ON m.id=s.material_id JOIN visits v ON v.id=s.visit_id
      WHERE v.status='done' AND v.date BETWEEN ? AND ? AND s.kind IN ('use','sale') GROUP BY m.id ORDER BY cost DESC LIMIT 15`).all(from, to);
    const stock = materialRows(req.user);
    res.json({ from, to,
      summary: { chem_revenue: chemRev, use_cost: useCost, product_revenue: prodRev, product_cost: saleCost,
        chem_visits: visits.filter((v) => v.chem_revenue > 0).length, chem_visits_no_record: visits.filter((v) => v.chem_revenue > 0 && !v.used_lines).length,
        stock_value_service: stock.filter((m) => m.kind === 'service').reduce((t, m) => t + m.stock_value, 0),
        stock_value_retail: stock.filter((m) => m.kind === 'retail').reduce((t, m) => t + m.stock_value, 0) },
      visits, top_used: topUsed.map((t) => ({ ...t, cost: Math.round(t.cost) })) });
  });
}

module.exports = {
  findByBarcode, attachBarcode, syncFormulaUse, AUTO_NOTE, codeList, perm, stockAlerts, mount, applyVisit, clearVisit, visitMaterials, importPurchases: (...a) => { const r = importPurchases(...a); seedFormulaKeys(); fillSizes(); fillPrices(); return r; }, avgCost, parseSize, seedFormulaKeys, fillSizes };
