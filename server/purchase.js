'use strict';
// Phiếu nhập hàng (kiểu KiotViet / Sapo): 1 phiếu = 1 NCC + nhiều dòng hàng; tạo hàng mới ngay trong phiếu;
// chiết khấu dòng + chiết khấu cả phiếu (chia đều vào giá vốn); trả NCC ngay / trả sau (công nợ NCC).
// Dòng tiền: hàng nhập theo phiếu tính TIỀN RA vào ngày trả NCC (không phải ngày nhập).
const { db, audit, nextCode } = require('./db');
const L = require('./logic');
const { HttpError, bad, int, str, today, isDate } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  date TEXT NOT NULL,
  supplier TEXT,
  ref_no TEXT,
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS purchase_pays (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);`);
const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
if (!has('stock_moves', 'purchase_id')) db.exec('ALTER TABLE stock_moves ADD COLUMN purchase_id INTEGER; CREATE INDEX IF NOT EXISTS idx_moves_pur ON stock_moves(purchase_id)');
if (!has('stock_moves', 'list_price')) db.exec('ALTER TABLE stock_moves ADD COLUMN list_price REAL');
if (!has('materials', 'sku')) db.exec('ALTER TABLE materials ADD COLUMN sku TEXT'); // mã hàng của NCC (vd MB442150)

const PAY_METHODS = ['Tiền mặt', 'Chuyển khoản'];
const paidOf = (pid) => db.prepare('SELECT COALESCE(SUM(amount),0) s FROM purchase_pays WHERE purchase_id=?').get(pid).s;
function head(p) {
  const paid = paidOf(p.id);
  const lines = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(qty),0) q FROM stock_moves WHERE purchase_id=?').get(p.id);
  return { ...p, paid, owe: Math.max(0, p.total - paid), status: paid >= p.total ? 'paid' : paid > 0 ? 'partial' : 'unpaid', line_count: lines.n, qty: lines.q };
}
function detail(id) {
  const p = db.prepare('SELECT p.*, u.full_name by_name FROM purchases p LEFT JOIN users u ON u.id=p.created_by WHERE p.id=?').get(id);
  if (!p) throw new HttpError(404, 'Không tìm thấy phiếu nhập');
  return { ...head(p),
    lines: db.prepare(`SELECT s.id, s.material_id, s.qty, s.unit_cost, s.list_price, m.name, m.unit, m.kind, m.grp, m.sell_price, m.sku FROM stock_moves s JOIN materials m ON m.id=s.material_id
      WHERE s.purchase_id=? ORDER BY s.id`).all(id),
    pays: db.prepare('SELECT * FROM purchase_pays WHERE purchase_id=? ORDER BY date, id').all(id) };
}
// Tiền trả NCC trong kỳ (cho dòng tiền) – phiếu đã xóa không tính
function paidBetween(from, to) {
  return db.prepare(`SELECT COALESCE(SUM(x.amount),0) s FROM purchase_pays x JOIN purchases p ON p.id=x.purchase_id WHERE p.deleted=0 AND x.date BETWEEN ? AND ?`).get(from, to).s;
}

function create(b, user) {
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) throw bad('Phiếu chưa có hàng');
  const date = isDate(b.date) ? b.date : today();
  const supplier = str(b.supplier), refNo = str(b.ref_no);
  if (refNo && !b.force) {
    const dup = db.prepare('SELECT code FROM purchases WHERE deleted=0 AND ref_no=? AND IFNULL(supplier,\'\')=?').get(refNo, supplier || '');
    if (dup) throw new HttpError(409, `Số phiếu ${refNo} của NCC này đã nhập (${dup.code}). Nhập lại sẽ cộng kho 2 lần.`);
  }
  const clean = lines.map((l, i) => {
    const qty = Number(l.qty), price = Math.max(0, Math.round(Number(l.price) || 0)), disc = Math.max(0, Math.round(Number(l.discount) || 0));
    if (!(qty > 0)) throw bad(`Dòng ${i + 1}: nhập số lượng`);
    if (disc > price) throw bad(`Dòng ${i + 1}: chiết khấu lớn hơn đơn giá`);
    const mid = int(l.material_id);
    if (!mid && !(l.new && str(l.new.name))) throw bad(`Dòng ${i + 1}: chọn hàng hoặc nhập tên hàng mới`);
    if (mid && !db.prepare('SELECT 1 FROM materials WHERE id=?').get(mid)) throw bad(`Dòng ${i + 1}: không tìm thấy hàng`);
    return { mid, qty, price, net: price - disc, nw: l.new, sell: l.sell_price === '' || l.sell_price == null ? null : Math.max(0, int(l.sell_price)), sku: str(l.sku) };
  });
  const subtotal = Math.round(clean.reduce((a, l) => a + l.qty * l.net, 0));
  const discount = Math.min(subtotal, Math.max(0, Math.round(Number(b.discount) || 0)));
  const total = subtotal - discount;
  const f = subtotal > 0 ? total / subtotal : 1; // CK cả phiếu chia đều vào giá vốn từng dòng
  const payNow = Math.min(total, Math.max(0, Math.round(Number(b.paid) || 0)));
  const method = PAY_METHODS.includes(b.pay_method) ? b.pay_method : 'Chuyển khoản';
  const { parseSize } = require('./stock');
  let created = 0;
  const id = db.transaction(() => {
    const code = nextCode('purchases', 'PN', 4);
    const pid = db.prepare('INSERT INTO purchases(code,date,supplier,ref_no,subtotal,discount,total,note,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(code, date, supplier, refNo, subtotal, discount, total, str(b.note), user.id).lastInsertRowid;
    for (const l of clean) {
      let mid = l.mid;
      if (!mid) {
        const n = l.nw; const name = str(n.name);
        const ex = db.prepare('SELECT id FROM materials WHERE lower(name)=lower(?)').get(name);
        if (ex) mid = ex.id;
        else {
          const sz = Number(n.size) > 0 ? { size: Number(n.size), size_unit: n.size_unit === 'g' ? 'g' : 'ml' } : parseSize(name, n.unit);
          mid = db.prepare('INSERT INTO materials(code,name,kind,grp,unit,size,size_unit,sell_price,sku,barcode) VALUES (?,?,?,?,?,?,?,?,?,?)')
            .run(nextCode('materials', 'VT', 4), name, n.kind === 'retail' ? 'retail' : 'service', str(n.grp), str(n.unit), sz.size || null, sz.size ? sz.size_unit : null,
              l.sell, l.sku || null, str(n.barcode)).lastInsertRowid;
          created++;
        }
      }
      if (l.sell != null) db.prepare('UPDATE materials SET sell_price=? WHERE id=?').run(l.sell, mid);
      if (l.sku) db.prepare("UPDATE materials SET sku=? WHERE id=? AND IFNULL(sku,'')=''").run(l.sku, mid);
      db.prepare("INSERT INTO stock_moves(material_id,date,kind,qty,unit_cost,list_price,supplier,note,created_by,purchase_id) VALUES (?,?,'in',?,?,?,?,?,?,?)")
        .run(mid, date, l.qty, l.net * f, l.price, supplier, `Phiếu nhập ${code}${refNo ? ' · ' + refNo : ''}`, user.id, pid);
    }
    if (payNow > 0) db.prepare('INSERT INTO purchase_pays(purchase_id,date,amount,method,created_by) VALUES (?,?,?,?,?)').run(pid, date, payNow, method, user.id);
    return pid;
  })();
  audit(user.id, 'purchase_create', 'purchases', id, { supplier, ref_no: refNo, total, lines: clean.length, created });
  return { ...detail(id), created };
}

function mount(app, { OWNER }) {
  app.get('/api/purchases/meta', OWNER, (req, res) => {
    const sup = db.prepare(`SELECT supplier s, MAX(date) d FROM (SELECT supplier, date FROM purchases WHERE deleted=0 UNION ALL SELECT supplier, date FROM stock_moves WHERE kind='in')
      WHERE IFNULL(supplier,'')<>'' GROUP BY supplier ORDER BY d DESC LIMIT 80`).all().map((r) => r.s);
    const grp = db.prepare("SELECT kind, grp, COUNT(*) n FROM materials WHERE IFNULL(grp,'')<>'' GROUP BY kind, grp ORDER BY n DESC").all();
    const units = db.prepare("SELECT unit, COUNT(*) n FROM materials WHERE IFNULL(unit,'')<>'' GROUP BY unit ORDER BY n DESC LIMIT 30").all().map((r) => r.unit);
    res.json({ suppliers: sup, groups: grp, units, pay_methods: PAY_METHODS });
  });
  app.get('/api/purchases', OWNER, (req, res) => {
    const t = today(); const from = isDate(req.query.from) ? req.query.from : t.slice(0, 8) + '01'; const to = isDate(req.query.to) ? req.query.to : t;
    const rows = db.prepare('SELECT * FROM purchases WHERE deleted=0 AND date BETWEEN ? AND ? ORDER BY date DESC, id DESC').all(from, to).map(head);
    const owing = db.prepare('SELECT * FROM purchases WHERE deleted=0 ORDER BY date').all().map(head).filter((p) => p.owe > 0);
    res.json({ from, to, rows, total: rows.reduce((a, p) => a + p.total, 0), owing, owe_total: owing.reduce((a, p) => a + p.owe, 0) });
  });
  app.get('/api/purchases/:id', OWNER, (req, res) => res.json(detail(int(req.params.id))));
  app.post('/api/purchases', OWNER, (req, res) => res.json(create(req.body || {}, req.user)));
  app.post('/api/purchases/:id/pay', OWNER, (req, res) => {
    const p = detail(int(req.params.id)); if (p.deleted) throw bad('Phiếu đã xóa');
    const amt = Math.min(p.owe, Math.max(0, Math.round(Number(req.body.amount) || 0)));
    if (!amt) throw bad(p.owe ? 'Nhập số tiền trả' : 'Phiếu đã trả đủ');
    db.prepare('INSERT INTO purchase_pays(purchase_id,date,amount,method,created_by) VALUES (?,?,?,?,?)')
      .run(p.id, isDate(req.body.date) ? req.body.date : today(), amt, PAY_METHODS.includes(req.body.method) ? req.body.method : 'Chuyển khoản', req.user.id);
    audit(req.user.id, 'purchase_pay', 'purchases', p.id, { amount: amt });
    res.json(detail(p.id));
  });
  app.delete('/api/purchases/:id', OWNER, (req, res) => {
    const p = detail(int(req.params.id)); if (p.deleted) throw bad('Phiếu đã xóa');
    db.transaction(() => {
      db.prepare('DELETE FROM stock_moves WHERE purchase_id=?').run(p.id);
      db.prepare('UPDATE purchases SET deleted=1 WHERE id=?').run(p.id);
    })();
    audit(req.user.id, 'purchase_delete', 'purchases', p.id, { code: p.code, total: p.total });
    res.json({ ok: true });
  });
}

module.exports = { mount, create, detail, paidBetween };
