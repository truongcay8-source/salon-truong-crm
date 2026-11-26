'use strict';
// Thu ngân: ai cũng làm được (xem khách chờ / đang phục vụ / đã thu trong ngày, bấm Thanh toán).
// Kết ca: người đóng ca đếm tiền mặt trong két rồi nhập số – KHÔNG thấy số máy tính (đếm mù, chống gian lận);
// chỉ Lãnh đạo thấy tiền máy tính và số lệch.
const { db, audit, getSettings } = require('./db');
const L = require('./logic');
const { bad, int } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS cash_closes (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  counted INTEGER NOT NULL,
  expected INTEGER NOT NULL,
  detail TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cash_closes_date ON cash_closes(date);
`);

const cashName = () => getSettings().payment_methods.split(',').map((s) => s.trim()).find((m) => /mặt/i.test(m)) || 'Tiền mặt';

// Tiền mặt máy tính phải có trong két của ngày: phần tiền mặt của hóa đơn + tip chung trả tiền mặt + bán thẻ tiền mặt
function expectedCash(date) {
  const cash = cashName();
  let visits = 0, tips = 0, n = 0;
  for (const v of db.prepare("SELECT cash_paid, payment_method, pay2_method, pay2_amount, tip FROM visits WHERE status='done' AND date=?").all(date)) {
    const p2 = v.pay2_method && v.pay2_amount ? v.pay2_amount : 0;
    let c = 0;
    if (v.payment_method === cash) c += v.cash_paid - p2;
    if (p2 && v.pay2_method === cash) c += p2;
    if (c > 0) n++;
    visits += c;
    if (v.payment_method === cash) tips += v.tip || 0;
  }
  const cards = db.prepare("SELECT COALESCE(SUM(price),0) s FROM cards WHERE sold_at=? AND payment_method=? AND price>0").get(date, cash).s;
  const debts = db.prepare("SELECT COALESCE(SUM(debt),0) s FROM visits WHERE status='done' AND debt>0 AND debt_paid_at=? AND debt_paid_method=?").get(date, cash).s;
  return { visits, tips, cards, debts, total: visits + tips + cards + debts, invoices: n };
}

function board(date, user) {
  const seeMoney = user.role === 'owner'; // Vinh 26/11: tiền lượt người khác chỉ Lãnh đạo thấy
  const appts = db.prepare(`SELECT a.id, a.time, a.status, a.service, a.visit_id, a.staff_id, a.assistant_id, a.customer_id, a.pay_note,
      COALESCE(c.name, a.guest_name) name, COALESCE(c.phone, a.guest_phone) phone, c.code customer_code, u.full_name staff_name, v.id v_live, v.cash_paid v_cash, v.card_paid v_card, v.total visit_total, v.code visit_code, v.payment_method, v.main_staff_id v_main, v.assistant_id v_asst
    FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id LEFT JOIN visits v ON v.id=a.visit_id AND v.status='done'
    WHERE a.date=? AND a.status IN ('booked','arrived','done') ORDER BY a.time, a.id`).all(date);
  const walk = db.prepare(`SELECT v.id visit_id, v.code visit_code, v.time, v.total visit_total, v.payment_method, v.main_staff_id v_main, v.assistant_id v_asst, c.name, c.phone, u.full_name staff_name,
      (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id) service
    FROM visits v JOIN customers c ON c.id=v.customer_id LEFT JOIN users u ON u.id=v.main_staff_id
    WHERE v.status='done' AND v.date=? AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.visit_id=v.id) ORDER BY v.time, v.id`).all(date);
  const mask = (r) => { const own = r.v_main === user.id || r.v_asst === user.id; const { v_main, v_asst, v_live, v_cash, v_card, ...x } = r; void v_main; void v_asst; void v_live; void v_cash; void v_card; return seeMoney || own ? x : { ...x, visit_total: null }; };
  // Sổ ghi ô hồng nhưng hóa đơn đã trừ thẻ hết (không còn tiền phải thu) → coi như đã thu
  const paid = (r) => !!r.visit_id && !(r.pay_note === 'Chưa thanh toán' && !r.payment_method && !(r.v_card > 0 && !(r.v_cash > 0)));
  const out = { date, waiting: [], serving: [], unpaid: [], paid: [] };
  for (const a of appts) {
    // Hóa đơn của lịch đã bị xóa → lịch quay về "Đang phục vụ" để thu tiền lại
    if (a.visit_id && !a.v_live) { a.visit_id = null; a.visit_total = null; a.visit_code = null; a.payment_method = null; a.status = 'arrived'; }
    if (!a.visit_id) { if (a.status !== 'done') (a.status === 'arrived' ? out.serving : out.waiting).push(mask(a)); }
    else (paid(a) ? out.paid : out.unpaid).push(mask(a));
  }
  for (const v of walk) out.paid.push(mask({ ...v, walk_in: true }));
  out.paid.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  // Khách còn nợ (mọi ngày) → thu ngân thu nợ
  out.debts = db.prepare(`SELECT v.id visit_id, v.code visit_code, v.date, v.time, v.debt, c.id customer_id, c.name, c.phone, u.full_name staff_name
    FROM visits v JOIN customers c ON c.id=v.customer_id LEFT JOIN users u ON u.id=v.main_staff_id
    WHERE v.status='done' AND v.debt>0 AND v.debt_paid_at IS NULL ORDER BY v.date, v.time`).all();
  // Khách còn thẻ tri ân chưa dùng → nhắc thu ngân trừ thẻ
  const giftLeft = db.prepare(`SELECT COALESCE(SUM(c.value + COALESCE((SELECT SUM(amount) FROM card_txns t WHERE t.card_id=c.id),0)),0) s
    FROM cards c WHERE c.customer_id=? AND c.sale_type='gift' AND c.status='active'`);
  for (const k of ['waiting', 'serving', 'unpaid']) for (const a of out[k]) if (a.customer_id) a.gift_left = giftLeft.get(a.customer_id).s || 0;
  out.closes = db.prepare('SELECT k.id, k.created_at, u.full_name user_name FROM cash_closes k LEFT JOIN users u ON u.id=k.user_id WHERE k.date=? ORDER BY k.id').all(date);
  if (user.role === 'owner') {
    const e = expectedCash(date);
    out.cash = e;
    // Tổng tiền cả ngày (chỉ Lãnh đạo): doanh số, theo hình thức trả, trừ thẻ, chưa trả, bán thẻ, tip
    const sm = L.salesReport(date, date, { role: 'owner' }).summary;
    out.totals = { visits: sm.visits, sales: sm.service_sales, by_method: sm.by_method, paid_by_card: sm.paid_by_card, paid_by_gift: sm.paid_by_gift,
      unpaid: sm.unpaid, card_sales: sm.card_sales, tips: sm.tips, money_in: sm.money_in };
    out.closes = db.prepare('SELECT k.*, u.full_name user_name FROM cash_closes k LEFT JOIN users u ON u.id=k.user_id WHERE k.date=? ORDER BY k.id').all(date)
      .map((k) => ({ ...k, detail: k.detail ? JSON.parse(k.detail) : null, diff: k.counted - k.expected }));
  }
  const s = getSettings();
  out.qr = s.qr_bank && s.qr_account ? { bank: s.qr_bank, account: s.qr_account, name: s.qr_name || '' } : null;
  return out;
}

function mount(app, { OWNER }) {
  app.get('/api/pos', (req, res) => {
    // Thu ngân: nhân viên + quản lý chỉ xem hôm nay; Lãnh đạo xem ngày khác
    const date = req.user.role === 'owner' && L.isDate(req.query.date) ? req.query.date : L.today();
    res.json(board(date, req.user));
  });
  // Khách đến: chuyển lịch sang "Đang phục vụ"
  app.post('/api/pos/checkin/:id', (req, res) => {
    const a = db.prepare("SELECT a.id, a.status, v.id visit_id FROM appointments a LEFT JOIN visits v ON v.id=a.visit_id AND v.status='done' WHERE a.id=?").get(int(req.params.id));
    if (!a) throw bad('Không tìm thấy lịch hẹn');
    if (a.visit_id) throw bad('Lịch này đã thu tiền');
    const st = req.body && req.body.undo ? 'booked' : 'arrived';
    db.prepare('UPDATE appointments SET status=? WHERE id=?').run(st, a.id);
    audit(req.user.id, 'pos_checkin', 'appointment', a.id, { status: st });
    res.json({ ok: true });
  });
  // Thu nợ: ai cũng thu được; tiền tính vào ngày trả
  app.post('/api/pos/debt/:id', (req, res) => {
    const v = db.prepare("SELECT id, debt, debt_paid_at FROM visits WHERE id=? AND status='done'").get(int(req.params.id));
    if (!v || !v.debt) throw bad('Lượt này không có nợ');
    if (v.debt_paid_at) throw bad('Khách đã trả nợ ngày ' + v.debt_paid_at);
    const m = L.str(req.body && req.body.method);
    if (!getSettings().payment_methods.split(',').map((s) => s.trim()).includes(m)) throw bad('Chọn hình thức trả nợ');
    db.prepare('UPDATE visits SET debt_paid_at=?, debt_paid_method=?, debt_paid_by=? WHERE id=?').run(L.today(), m, req.user.id, v.id);
    audit(req.user.id, 'debt_paid', 'visit', v.id, { amount: v.debt, method: m });
    res.json({ ok: true, amount: v.debt });
  });
  // Kết ca: nhập số tiền mặt đếm được (đếm mù). Ai cũng gửi được, mỗi người nhiều lần (lần sau là đếm lại)
  app.post('/api/pos/close', (req, res) => {
    const b = req.body || {};
    const counted = Math.round(Number(String(b.counted ?? '').replace(/[^\d]/g, '')));
    if (!(counted >= 0) || String(b.counted ?? '').trim() === '' || counted > 1e9) throw bad('Nhập số tiền mặt đếm được');
    const date = L.today();
    const e = expectedCash(date);
    const id = db.prepare('INSERT INTO cash_closes(date,user_id,counted,expected,detail,note) VALUES (?,?,?,?,?,?)')
      .run(date, req.user.id, counted, e.total, JSON.stringify(e), L.str(b.note)).lastInsertRowid;
    audit(req.user.id, 'cash_close', 'cash_closes', id, { date, counted });
    // Chỉ Lãnh đạo thấy số máy tính và lệch
    if (req.user.role === 'owner') return res.json({ id, counted, expected: e.total, diff: counted - e.total, detail: e });
    res.json({ id, counted });
  });
  app.get('/api/pos/closes', OWNER, (req, res) => {
    const to = L.isDate(req.query.to) ? req.query.to : L.today();
    const from = L.isDate(req.query.from) ? req.query.from : L.addDays(to, -30);
    res.json(db.prepare('SELECT k.*, u.full_name user_name FROM cash_closes k LEFT JOIN users u ON u.id=k.user_id WHERE k.date BETWEEN ? AND ? ORDER BY k.date DESC, k.id DESC').all(from, to)
      .map((k) => ({ ...k, detail: k.detail ? JSON.parse(k.detail) : null, diff: k.counted - k.expected })));
  });
}

module.exports = { mount, expectedCash, board };
