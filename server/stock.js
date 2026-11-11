'use strict';
// Kho vật tư: hóa chất làm dịch vụ (tính giá cốt) + sản phẩm bán lẻ (trừ kho, lãi gộp).
// Giá vốn = bình quân gia quyền các lần nhập. Nhân viên KHÔNG xem được giá nhập / giá cốt / lãi.
const { db, audit, nextCode } = require('./db');
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

const isMgr = (u) => u.role !== 'staff';
const r2 = (x) => Math.round(x * 1000) / 1000;

// Giá vốn bình quân 1 đơn vị (tuýp/chai/hộp)
function avgCost(mid) {
  const r = db.prepare("SELECT SUM(qty) q, SUM(qty*unit_cost) a FROM stock_moves WHERE material_id=? AND kind='in'").get(mid);
  return r.q > 0 ? r.a / r.q : 0;
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
    const base = { id: m.id, code: m.code, name: m.name, kind: m.kind, grp: m.grp, unit: m.unit, size: m.size, size_unit: m.size_unit, sell_price: m.sell_price, active: m.active };
    if (!isMgr(user)) return base;
    const cost = avgCost(m.id), stock = stockOf(m.id);
    return { ...base, note: m.note, avg_cost: Math.round(cost), cost_per_size: m.size ? cost / m.size : null, stock: r2(stock), stock_value: Math.round(stock * cost) };
  });
}

// Ghi vật tư của 1 lượt làm: hóa chất dùng (use) + sản phẩm bán (sale). Trả về giá cốt lượt.
// used = null (phiếu không gửi danh sách hóa chất) → giữ nguyên hóa chất đã ghi trước đó
function applyVisit(visitId, date, items, used, user) {
  if (!used) used = db.prepare("SELECT material_id, -qty qty FROM stock_moves WHERE visit_id=? AND kind='use' ORDER BY id").all(visitId);
  db.prepare('DELETE FROM stock_moves WHERE visit_id=?').run(visitId);
  const ins = db.prepare('INSERT INTO stock_moves(material_id,date,kind,qty,unit_cost,price,visit_id,created_by) VALUES (?,?,?,?,?,?,?,?)');
  let cost = 0;
  const one = (mid, qty, kind, price) => {
    const m = db.prepare('SELECT id FROM materials WHERE id=?').get(mid);
    if (!m || !(qty > 0)) return;
    const uc = avgCost(mid);
    ins.run(mid, date, kind, -qty, uc, price ?? null, visitId, user.id);
    cost += qty * uc;
  };
  for (const u of used || []) one(int(u.material_id), Number(u.qty), 'use');
  for (const i of items) if (i.material_id) one(i.material_id, i.qty || 1, 'sale', i.price);
  db.prepare('UPDATE visits SET cost=? WHERE id=?').run(Math.round(cost), visitId);
  return Math.round(cost);
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

function mount(app, { MGR }) {
  app.get('/api/materials', (req, res) => res.json(materialRows(req.user, { all: req.query.all === '1' && isMgr(req.user) })));
  const matInput = (b) => {
    const name = str(b.name); if (!name) throw bad('Nhập tên vật tư');
    const sz = Number(b.size) > 0 ? Number(b.size) : null;
    return { name, kind: b.kind === 'retail' ? 'retail' : 'service', grp: str(b.grp), unit: str(b.unit), size: sz, size_unit: sz ? (b.size_unit === 'g' ? 'g' : 'ml') : null,
      sell_price: b.sell_price === '' || b.sell_price == null ? null : Math.max(0, int(b.sell_price)), active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1, note: str(b.note) };
  };
  app.post('/api/materials', MGR, (req, res) => {
    const m = matInput(req.body);
    const cols = Object.keys(m);
    const id = db.prepare(`INSERT INTO materials(code,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`).run(nextCode('materials', 'VT', 4), ...cols.map((k) => m[k])).lastInsertRowid;
    res.json({ id });
  });
  app.put('/api/materials/:id', MGR, (req, res) => {
    const id = int(req.params.id);
    if (!db.prepare('SELECT 1 FROM materials WHERE id=?').get(id)) throw new HttpError(404, 'Không tìm thấy vật tư');
    const m = matInput(req.body); const cols = Object.keys(m);
    db.prepare(`UPDATE materials SET ${cols.map((k) => k + '=?').join(',')} WHERE id=?`).run(...cols.map((k) => m[k]), id);
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
  app.get('/api/materials/:id/moves', MGR, (req, res) => {
    res.json(db.prepare(`SELECT s.*, v.code visit_code, c.name customer_name FROM stock_moves s LEFT JOIN visits v ON v.id=s.visit_id LEFT JOIN customers c ON c.id=v.customer_id
      WHERE s.material_id=? ORDER BY s.date DESC, s.id DESC LIMIT 200`).all(int(req.params.id)));
  });

  // Định mức hóa chất cho từng dịch vụ (nhân viên lấy để điền sẵn; giá cốt chỉ quản lý thấy)
  app.get('/api/recipes', (req, res) => {
    const rows = db.prepare('SELECT service_id, material_id, qty FROM service_materials ORDER BY id').all();
    if (!isMgr(req.user)) return res.json(rows);
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
  app.get('/api/reports/cost', MGR, (req, res) => {
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

module.exports = { mount, applyVisit, clearVisit, visitMaterials, importPurchases, avgCost, parseSize };
