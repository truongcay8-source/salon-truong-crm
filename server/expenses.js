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
// Khoản chi nhập từ sổ đặt lịch (cột Chi + Ghi chú) → không nhân đôi khi nhập lại file
if (!db.prepare('PRAGMA table_info(expenses)').all().some((c) => c.name === 'import_ref')) db.exec('ALTER TABLE expenses ADD COLUMN import_ref TEXT');
// Nguồn tiền: fund = tiền mặt tại tiệm (quỹ/két, mặc định); staff = nhân viên ứng trước (TM/CK cá nhân) → chờ hoàn ứng;
// owner = chủ trả cá nhân (không đụng quỹ, vẫn là chi phí tiệm). spread_months: chia đều chi phí cho N tháng (app trả năm, đồ dùng lâu).
for (const c of ['source TEXT', 'pay_method TEXT', 'spread_months INTEGER NOT NULL DEFAULT 1', 'reimbursed_at TEXT', 'reimburse_method TEXT', 'reimbursed_by INTEGER']) {
  if (!db.prepare('PRAGMA table_info(expenses)').all().some((x) => x.name === c.split(' ')[0])) db.exec('ALTER TABLE expenses ADD COLUMN ' + c);
}
const SOURCES = { fund: 'Tiền mặt tại tiệm', staff: 'Nhân viên ứng trước', owner: 'Chủ trả cá nhân' };
const REIMB = { fund: 'TM tại tiệm', ck: 'Chuyển khoản', salary: 'Cộng vào lương' };
// Chi phí phân bổ vào 1 tháng (YYYY-MM): khoản trả 1 lần tính hết tháng chi; khoản chia N tháng tính amount/N mỗi tháng
function monthShare(e, month) {
  const n = Math.max(1, Number(e.spread_months) || 1);
  const [y, m] = e.date.slice(0, 7).split('-').map(Number);
  const [y2, m2] = month.split('-').map(Number);
  const k = (y2 - y) * 12 + (m2 - m);
  if (k < 0 || k >= n) return 0;
  const base = Math.floor(e.amount / n);
  return k === n - 1 ? e.amount - base * (n - 1) : base; // tháng cuối nhận phần lẻ
}
function monthExpenses(month) {
  const from = month + '-01';
  const rows = db.prepare(`SELECT e.*, u.full_name by_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by
    WHERE e.kind='out' AND e.status='approved' AND e.date<=? AND date(e.date, '+' || (COALESCE(e.spread_months,1)) || ' months') > ?`).all(month + '-31', from);
  return rows.map((e) => ({ ...e, share: monthShare(e, month) })).filter((e) => e.share > 0);
}

// Đoán nhóm chi theo nội dung ghi tay
function guessCat(note) {
  const f = String(note || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  if (/hoa chat|tap de|lo |lo$|chai|bat|choi quet|gang tay|giay bac|mang boc|dao lam|luoc|kep/.test(f)) return 'Hóa chất / vật tư lặt vặt';
  if (/rac|lau|khan|ve sinh|giat|tham|xa phong|nuoc rua|gat nuoc|phoi|nha vs/.test(f)) return 'Vệ sinh, giặt khăn';
  if (/nuoc|tra|banh|keo|cafe|ca phe|hoa qua|trai cay|tiep khach|da\b/.test(f)) return 'Nước uống, tiếp khách';
  if (/sua|thay|bong den|o dien|khoa/.test(f)) return 'Sửa chữa nhỏ';
  if (/but|giay|so |in an|bang dinh/.test(f)) return 'Văn phòng phẩm';
  if (/ship|grab|xe|gui|van chuyen|xang/.test(f)) return 'Ship, gửi xe, đi lại';
  return 'Khác';
}
// days: [{date, items:[{amount, note}]}]; ngày trước hôm nay: Vinh đã thanh toán → ghi khoản nạp hoàn quỹ đúng bằng tổng chi ngày đó
function importFromBook(days, user, summary) {
  const t = today();
  const st = summary.expenses || (summary.expenses = { created: 0, skipped: 0, amount: 0, settled: 0, days: 0 });
  for (const d of days) {
    if (!d.items.length) continue;
    st.days++;
    let dayNew = 0;
    d.items.forEach((x, i) => {
      const ref = `SO:${d.date}:${i}:${x.amount}:${String(x.note || '').slice(0, 40)}`;
      if (db.prepare('SELECT 1 FROM expenses WHERE import_ref=?').get(ref)) { st.skipped++; return; }
      db.prepare(`INSERT INTO expenses(date,kind,amount,category,note,status,created_by,decided_by,decided_at,import_ref) VALUES (?,?,?,?,?,'approved',?,?,datetime('now','localtime'),?)`)
        .run(d.date, 'out', x.amount, guessCat(x.note), (x.note || 'Chi (không ghi nội dung)') + ' · từ sổ đặt lịch', user.id, user.id, ref);
      st.created++; st.amount += x.amount; dayNew += x.amount;
    });
    if (d.date < t && dayNew) {
      const ref = `SO-HOAN:${d.date}:${dayNew}`;
      if (!db.prepare('SELECT 1 FROM expenses WHERE import_ref=?').get(ref)) {
        db.prepare(`INSERT INTO expenses(date,kind,amount,note,status,created_by,decided_by,decided_at,import_ref) VALUES (?,'in',?,?,'approved',?,?,datetime('now','localtime'),?)`)
          .run(d.date, dayNew, 'Đã thanh toán / hoàn quỹ các khoản chi ngày ' + d.date.split('-').reverse().join('/'), user.id, user.id, ref);
        st.settled += dayNew;
      }
    }
  }
}

const CATS = ['Hóa chất / vật tư lặt vặt', 'Nước uống, tiếp khách', 'Vệ sinh, giặt khăn', 'Sửa chữa nhỏ', 'Văn phòng phẩm', 'Ship, gửi xe, đi lại', 'Phần mềm / app', 'Dụng cụ, thiết bị', 'Quảng cáo, marketing', 'Khác'];
const isMgr = (u) => u.role !== 'staff';

function fundState() {
  const r = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN kind='in' THEN amount END),0) ins,
      COALESCE(SUM(CASE WHEN kind='out' AND status<>'rejected' AND COALESCE(source,'fund')='fund' THEN amount END),0)
        + COALESCE(SUM(CASE WHEN kind='out' AND status='approved' AND reimburse_method='fund' THEN amount END),0) outs,
      COALESCE(SUM(CASE WHEN kind='out' AND status='pending' THEN amount END),0) pending_amount,
      COUNT(CASE WHEN kind='out' AND status='pending' THEN 1 END) pending_count
    FROM expenses`).get();
  const target = Number(getSettings().petty_target) || 1000000;
  const refund = db.prepare(`SELECT e.created_by user_id, u.full_name name, SUM(e.amount) amount, COUNT(*) n FROM expenses e JOIN users u ON u.id=e.created_by
    WHERE e.kind='out' AND e.status='rejected' AND e.refunded=0 AND COALESCE(e.source,'fund')='fund' GROUP BY e.created_by`).all();
  // Nhân viên ứng tiền mua hộ, khoản đã duyệt mà tiệm chưa trả lại
  const reimb = db.prepare(`SELECT e.created_by user_id, u.full_name name, SUM(e.amount) amount, COUNT(*) n FROM expenses e JOIN users u ON u.id=e.created_by
    WHERE e.kind='out' AND e.status='approved' AND e.source='staff' AND e.reimbursed_at IS NULL GROUP BY e.created_by`).all();
  const balance = r.ins - r.outs;
  return { balance, target, need_topup: Math.max(0, target - balance), pending_amount: r.pending_amount, pending_count: r.pending_count, refund_due: refund, reimburse_due: reimb };
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
    const reimbList = isMgr(req.user) ? db.prepare(`${rowsSql} WHERE e.kind='out' AND e.status='approved' AND e.source='staff' AND e.reimbursed_at IS NULL ORDER BY e.date, e.id`).all() : [];
    const spreadList = isMgr(req.user) ? db.prepare(`${rowsSql} WHERE e.kind='out' AND e.status='approved' AND e.spread_months>1 AND date(e.date, '+' || e.spread_months || ' months') > ? ORDER BY e.date`).all(t.slice(0, 8) + '01')
      .map((x) => { const done = Math.min(x.spread_months, (Number(t.slice(0, 4)) - Number(x.date.slice(0, 4))) * 12 + Number(t.slice(5, 7)) - Number(x.date.slice(5, 7)) + 1);
        return { ...x, per_month: Math.round(x.amount / x.spread_months), months_left: x.spread_months - done, left: x.amount - Math.round((x.amount / x.spread_months) * done) }; }) : [];
    res.json({ from, to, rows, older_pending: pending, reimburse_list: reimbList, spread_list: spreadList, sources: SOURCES, reimburse_methods: REIMB, ...fundState(), total_out: out.reduce((s, x) => s + x.amount, 0),
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
    if (!isMgr(req.user) && (date > today() || date < L.addDays(today(), -7))) throw bad('Nhân viên chỉ ghi khoản chi trong 7 ngày gần đây');
    const source = kind === 'out' && SOURCES[b.source] ? b.source : 'fund';
    if (source === 'owner' && !isMgr(req.user)) throw bad('Nhân viên chọn "Tiền mặt tại tiệm" hoặc "Tự ứng trước"');
    const payMethod = source === 'fund' ? 'Tiền mặt' : /chuy|ck/i.test(b.pay_method || '') ? 'Chuyển khoản' : 'Tiền mặt';
    const spread = isMgr(req.user) ? Math.min(60, Math.max(1, int(b.spread_months) || 1)) : 1;
    let photo = null;
    if (req.file) {
      const ext = sniffImage(req.file.buffer);
      if (!ext) throw bad('Ảnh hóa đơn không hợp lệ');
      fs.mkdirSync(path.join(PHOTO_DIR, 'expenses'), { recursive: true });
      photo = `expenses/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(PHOTO_DIR, photo), req.file.buffer);
    }
    const auto = kind === 'in' || isMgr(req.user); // quản lý tự ghi thì coi như đã duyệt
    const id = db.prepare('INSERT INTO expenses(date,kind,amount,category,note,photo,status,created_by,decided_by,decided_at,source,pay_method,spread_months) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(date, kind, amount, kind === 'out' ? (CATS.includes(b.category) ? b.category : 'Khác') : null, note, photo, auto ? 'approved' : 'pending', req.user.id,
        auto ? req.user.id : null, auto ? new Date().toISOString() : null, kind === 'out' ? source : null, kind === 'out' ? payMethod : null, kind === 'out' ? spread : 1).lastInsertRowid;
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
  // Sửa nguồn tiền / chia tháng (quản lý; vd lúc duyệt khoản nhân viên ghi)
  app.put('/api/expenses/:id', MGR, (req, res) => {
    const e = db.prepare("SELECT * FROM expenses WHERE id=? AND kind='out'").get(int(req.params.id));
    if (!e) throw new HttpError(404, 'Không tìm thấy khoản chi');
    const b = req.body;
    const source = SOURCES[b.source] ? b.source : e.source || 'fund';
    const spread = b.spread_months != null ? Math.min(60, Math.max(1, int(b.spread_months) || 1)) : e.spread_months;
    const cat = CATS.includes(b.category) ? b.category : e.category;
    db.prepare('UPDATE expenses SET source=?, spread_months=?, category=?, pay_method=COALESCE(?,pay_method) WHERE id=?')
      .run(source, spread, cat, b.pay_method ? (/chuy|ck/i.test(b.pay_method) ? 'Chuyển khoản' : 'Tiền mặt') : null, e.id);
    audit(req.user.id, 'expense_update', 'expense', e.id, { changes: { source: [e.source, source], spread_months: [e.spread_months, spread], category: [e.category, cat] } });
    res.json({ ok: true, ...fundState() });
  });
  // Hoàn ứng cho nhân viên đã mua hộ: TM tại tiệm (trừ quỹ) / chuyển khoản / cộng vào lương
  app.post('/api/expenses/:id/reimburse', MGR, (req, res) => {
    const e = db.prepare("SELECT * FROM expenses WHERE id=? AND kind='out' AND source='staff'").get(int(req.params.id));
    if (!e) throw bad('Chỉ hoàn ứng cho khoản nhân viên ứng trước');
    if (e.status !== 'approved') throw bad('Duyệt khoản này trước khi hoàn ứng');
    const m = req.body.undo ? null : REIMB[req.body.method] ? req.body.method : 'fund';
    db.prepare('UPDATE expenses SET reimbursed_at=?, reimburse_method=?, reimbursed_by=? WHERE id=?').run(m ? today() : null, m, m ? req.user.id : null, e.id);
    audit(req.user.id, m ? 'expense_reimburse' : 'expense_reimburse_undo', 'expense', e.id, { amount: e.amount, method: m });
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
  // Xuất Excel quỹ tiền mặt: từng khoản chi / nạp + tổng theo ngày, theo nhóm
  app.get('/api/expenses/export', MGR, async (req, res) => {
    const ExcelJS = require('exceljs');
    const t = today();
    const from = isDate(req.query.from) ? req.query.from : t.slice(0, 8) + '01';
    const to = isDate(req.query.to) ? req.query.to : t;
    const rows = db.prepare(`${rowsSql} WHERE e.date BETWEEN ? AND ? ORDER BY e.date, e.id`).all(from, to);
    const before = db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind='in' THEN amount WHEN status<>'rejected' THEN -amount ELSE 0 END),0) b FROM expenses WHERE date < ?`).get(from).b;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Quỹ tiền mặt');
    ws.columns = [{ header: 'Ngày', key: 'date', width: 12 }, { header: 'Loại', key: 'kind', width: 10 }, { header: 'Nhóm', key: 'category', width: 24 },
      { header: 'Nội dung', key: 'note', width: 46 }, { header: 'Chi', key: 'out', width: 13 }, { header: 'Nạp / hoàn quỹ', key: 'in', width: 14 },
      { header: 'Số dư quỹ', key: 'bal', width: 13 }, { header: 'Trạng thái', key: 'status', width: 12 }, { header: 'Người ghi', key: 'by', width: 14 }, { header: 'Người duyệt', key: 'dec', width: 14 }];
    ws.addRow({ date: '', note: 'Số dư đầu kỳ (trước ' + from.split('-').reverse().join('/') + ')', bal: before });
    let bal = before;
    const ST = { approved: 'Đã duyệt', pending: 'Chờ duyệt', rejected: 'Không duyệt' };
    for (const e of rows) {
      if (e.kind === 'in') bal += e.amount; else if (e.status !== 'rejected') bal -= e.amount;
      ws.addRow({ date: e.date.split('-').reverse().join('/'), kind: e.kind === 'in' ? 'Nạp quỹ' : 'Chi', category: e.category || '', note: e.note + (e.reason ? ' · Lý do: ' + e.reason : ''),
        out: e.kind === 'out' ? e.amount : null, in: e.kind === 'in' ? e.amount : null, bal, status: ST[e.status] || e.status, by: e.by_name || '', dec: e.decided_by_name || '' });
    }
    const outs = rows.filter((e) => e.kind === 'out' && e.status !== 'rejected');
    ws.addRow({});
    ws.addRow({ note: 'TỔNG CHI (không tính khoản không duyệt)', out: outs.reduce((s2, e) => s2 + e.amount, 0), in: rows.filter((e) => e.kind === 'in').reduce((s2, e) => s2 + e.amount, 0), bal }).font = { bold: true };
    for (const c of ['out', 'in', 'bal']) ws.getColumn(c).numFmt = '#,##0';
    ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
    const ws2 = wb.addWorksheet('Theo ngày');
    ws2.columns = [{ header: 'Ngày', key: 'd', width: 12 }, { header: 'Tổng chi', key: 'v', width: 14, style: { numFmt: '#,##0' } }, { header: 'Số khoản', key: 'n', width: 10 }];
    const byDay = {}; for (const e of outs) { byDay[e.date] = byDay[e.date] || { v: 0, n: 0 }; byDay[e.date].v += e.amount; byDay[e.date].n++; }
    for (const [d, x] of Object.entries(byDay)) ws2.addRow({ d: d.split('-').reverse().join('/'), ...x });
    ws2.getRow(1).font = { bold: true };
    const ws3 = wb.addWorksheet('Theo nhóm');
    ws3.columns = [{ header: 'Nhóm chi', key: 'c', width: 28 }, { header: 'Tổng', key: 'v', width: 14, style: { numFmt: '#,##0' } }];
    const byCat = {}; for (const e of outs) byCat[e.category || 'Khác'] = (byCat[e.category || 'Khác'] || 0) + e.amount;
    for (const [c, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) ws3.addRow({ c, v });
    ws3.getRow(1).font = { bold: true };
    audit(req.user.id, 'expense_export', null, null, { from, to, rows: rows.length });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="quy-tien-mat-${from}-${to}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
  app.put('/api/expenses/target', MGR, (req, res) => {
    const v = int(req.body.target);
    if (!(v > 0)) throw bad('Nhập mức quỹ');
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('petty_target',?)").run(String(v));
    audit(req.user.id, 'petty_target', 'settings', null, { target: v });
    res.json({ ok: true });
  });
}

module.exports = { mount, fundState, importFromBook, guessCat, monthExpenses, monthShare, SOURCES };
