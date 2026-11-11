'use strict';
// Chi trong ngày + quỹ tiền mặt ở tiệm (mặc định 1.000.000đ).
// Nhân viên ghi khoản chi (mua gì, bao nhiêu, ảnh hóa đơn) → quản lý trở lên Duyệt / Không duyệt.
// Số dư quỹ = tiền nạp − các khoản chi (trừ khoản không duyệt: người chi phải hoàn lại quỹ).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, audit, getSettings } = require('./db');
const L = require('./logic');
const { HttpError, bad, int, str, today, isDate } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in','out')),
  amount INTEGER NOT NULL,
  category TEXT,
  note TEXT,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason TEXT,
  created_by INTEGER REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  refunded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(date);
`);
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('petty_target','1000000')").run();

const CATS = ['Hóa chất / vật tư lặt vặt', 'Nước uống, tiếp khách', 'Vệ sinh, giặt khăn', 'Sửa chữa nhỏ', 'Văn phòng phẩm', 'Ship, gửi xe, đi lại', 'Khác'];
const isMgr = (u) => u.role !== 'staff';

function fundState() {
  const r = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN kind='in' THEN amount END),0) ins,
      COALESCE(SUM(CASE WHEN kind='out' AND status<>'rejected' THEN amount END),0) outs,
      COALESCE(SUM(CASE WHEN kind='out' AND status='pending' THEN amount END),0) pending_amount,
      COUNT(CASE WHEN kind='out' AND status='pending' THEN 1 END) pending_count
    FROM expenses`).get();
  const target = Number(getSettings().petty_target) || 1000000;
  const refund = db.prepare(`SELECT e.created_by user_id, u.full_name name, SUM(e.amount) amount, COUNT(*) n FROM expenses e JOIN users u ON u.id=e.created_by
    WHERE e.kind='out' AND e.status='rejected' AND e.refunded=0 GROUP BY e.created_by`).all();
  const balance = r.ins - r.outs;
  return { balance, target, need_topup: Math.max(0, target - balance), pending_amount: r.pending_amount, pending_count: r.pending_count, refund_due: refund };
}

function mount(app, { MGR, upload, sniffImage, PHOTO_DIR }) {
  const rowsSql = `SELECT e.*, u.full_name by_name, d.full_name decided_by_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by LEFT JOIN users d ON d.id=e.decided_by`;
  app.get('/api/expenses', (req, res) => {
    const t = today();
    const from = isDate(req.query.from) ? req.query.from : t;
    const to = isDate(req.query.to) ? req.query.to : from;
    const rows = db.prepare(`${rowsSql} WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`).all(from, to);
    const pending = db.prepare(`${rowsSql} WHERE e.kind='out' AND e.status='pending' AND e.date NOT BETWEEN ? AND ? ORDER BY e.date, e.id`).all(from, to);
    const out = rows.filter((x) => x.kind === 'out' && x.status !== 'rejected');
    const byCat = {};
    for (const x of out) byCat[x.category || 'Khác'] = (byCat[x.category || 'Khác'] || 0) + x.amount;
    res.json({ from, to, rows, older_pending: pending, ...fundState(), total_out: out.reduce((s, x) => s + x.amount, 0),
      total_in: rows.filter((x) => x.kind === 'in').reduce((s, x) => s + x.amount, 0), by_category: byCat, categories: CATS, can_decide: isMgr(req.user) });
  });
  // Ghi khoản chi (ai cũng ghi được) hoặc nạp quỹ (quản lý). Ảnh hóa đơn tùy chọn.
  app.post('/api/expenses', upload.single('photo'), (req, res) => {
    const b = req.body;
    const kind = b.kind === 'in' ? 'in' : 'out';
    if (kind === 'in' && !isMgr(req.user)) throw new HttpError(403, 'Chỉ quản lý nạp quỹ');
    const amount = int(String(b.amount || '').replace(/[.,\s]/g, ''));
    if (!(amount > 0)) throw bad('Nhập số tiền');
    if (amount > 50000000) throw bad('Số tiền quá lớn');
    const note = str(b.note);
    if (kind === 'out' && !note) throw bad('Ghi rõ mua gì');
    const date = isDate(b.date) ? b.date : today();
    if (!isMgr(req.user) && date !== today()) throw bad('Nhân viên chỉ ghi chi trong ngày hôm nay');
    let photo = null;
    if (req.file) {
      const ext = sniffImage(req.file.buffer);
      if (!ext) throw bad('Ảnh hóa đơn không hợp lệ');
      fs.mkdirSync(path.join(PHOTO_DIR, 'expenses'), { recursive: true });
      photo = `expenses/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(PHOTO_DIR, photo), req.file.buffer);
    }
    const auto = kind === 'in' || isMgr(req.user); // quản lý tự ghi thì coi như đã duyệt
    const id = db.prepare('INSERT INTO expenses(date,kind,amount,category,note,photo,status,created_by,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(date, kind, amount, kind === 'out' ? (CATS.includes(b.category) ? b.category : 'Khác') : null, note, photo, auto ? 'approved' : 'pending', req.user.id,
        auto ? req.user.id : null, auto ? new Date().toISOString() : null).lastInsertRowid;
    audit(req.user.id, kind === 'in' ? 'petty_in' : 'expense_create', 'expense', id, { amount, note });
    res.json({ id, ...fundState() });
  });
  app.post('/api/expenses/:id/decide', MGR, (req, res) => {
    const e = db.prepare("SELECT * FROM expenses WHERE id=? AND kind='out'").get(int(req.params.id));
    if (!e) throw new HttpError(404, 'Không tìm thấy khoản chi');
    const st = req.body.status;
    if (!['approved', 'rejected', 'pending'].includes(st)) throw bad('Trạng thái không hợp lệ');
    if (st === 'rejected' && !str(req.body.reason)) throw bad('Ghi lý do không duyệt');
    db.prepare("UPDATE expenses SET status=?, reason=?, decided_by=?, decided_at=datetime('now','localtime'), refunded=0 WHERE id=?").run(st, st === 'rejected' ? str(req.body.reason) : null, req.user.id, e.id);
    audit(req.user.id, 'expense_' + st, 'expense', e.id, { changes: { status: [e.status, st] }, amount: e.amount, note: e.note, reason: str(req.body.reason) });
    res.json({ ok: true, ...fundState() });
  });
  // Khoản không duyệt: người chi đã hoàn tiền vào quỹ
  app.post('/api/expenses/:id/refunded', MGR, (req, res) => {
    const e = db.prepare("SELECT * FROM expenses WHERE id=? AND status='rejected'").get(int(req.params.id));
    if (!e) throw bad('Chỉ đánh dấu hoàn tiền cho khoản không duyệt');
    db.prepare('UPDATE expenses SET refunded=1 WHERE id=?').run(e.id);
    // Tiền hoàn đã vào lại quỹ: số dư sổ sách không đổi (khoản bị loại đã không trừ quỹ)
    audit(req.user.id, 'expense_refunded', 'expense', e.id, { amount: e.amount });
    res.json({ ok: true });
  });
  app.delete('/api/expenses/:id', (req, res) => {
    const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(int(req.params.id));
    if (!e) throw new HttpError(404, 'Không tìm thấy');
    if (!isMgr(req.user) && !(e.created_by === req.user.id && e.status === 'pending')) throw new HttpError(403, 'Chỉ xóa được khoản của mình khi chưa duyệt');
    db.prepare('DELETE FROM expenses WHERE id=?').run(e.id);
    if (e.photo) { try { fs.unlinkSync(path.join(PHOTO_DIR, e.photo)); } catch { /* bỏ qua */ } }
    audit(req.user.id, 'expense_delete', 'expense', e.id, { kind: e.kind, amount: e.amount, note: e.note, date: e.date, status: e.status });
    res.json({ ok: true });
  });
  app.get('/api/expenses/:id/photo', (req, res) => {
    const e = db.prepare('SELECT photo FROM expenses WHERE id=?').get(int(req.params.id));
    if (!e || !e.photo) throw new HttpError(404, 'Không có ảnh');
    const file = path.join(PHOTO_DIR, e.photo);
    if (!file.startsWith(PHOTO_DIR + path.sep) || !fs.existsSync(file)) throw new HttpError(404, 'Mất file ảnh');
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(file);
  });
  app.put('/api/expenses/target', MGR, (req, res) => {
    const v = int(req.body.target);
    if (!(v > 0)) throw bad('Nhập mức quỹ');
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('petty_target',?)").run(String(v));
    audit(req.user.id, 'petty_target', 'settings', null, { target: v });
    res.json({ ok: true });
  });
}

module.exports = { mount, fundState };
