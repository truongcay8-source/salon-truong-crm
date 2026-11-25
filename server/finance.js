'use strict';
// Báo cáo tài chính (Lãi/Lỗ tháng) – CHỈ Lãnh đạo (tài khoản Vinh) xem/sửa.
// Doanh thu (dịch vụ + bán SP, bỏ phần trả bằng thẻ tri ân) − Giá vốn (hóa chất/SP đã xuất kho, chỗ chưa ghi thì ước theo %)
// − Lương (theo trang Bảng lương, không tính tip/ứng) − Chi quỹ đã duyệt − Chi phí cố định (nhà, khấu hao, điện nước…) = Lãi/Lỗ.
// Kèm góc nhìn dòng tiền: tiền thực vào (gồm bán thẻ) − tiền thực ra (lương, quỹ, chi phí trả tiền, nhập hàng).
const { db, audit } = require('./db');
const L = require('./logic');
const { bad, int } = L;
const payroll = require('./payroll');
const { parseFormula } = require('../public/formula.js');

// Giá cốt mỗi đầu hóa chất: ưu tiên hóa chất đã xuất kho ở hóa đơn → công thức thợ ghi (ở lượt, hoặc công thức
// của khách cập nhật trong 10 ngày sau lượt) × giá nhập bình quân → không có thì ước theo % giá dịch vụ.
function headCost(from, to, rate) {
  const stock = require('./stock');
  try { stock.syncFormulaUse(true); } catch (e) { console.error('Tự trừ kho theo công thức lỗi:', e.message); }
  const mats = db.prepare('SELECT id, name, kind, size, size_unit, formula_keys, formula_default, active FROM materials').all();
  const byId = new Map(mats.map((m) => [m.id, m]));
  const cache = new Map();
  const ac = (id) => { if (!cache.has(id)) cache.set(id, stock.avgCost(id)); return cache.get(id); };
  const rows = db.prepare(`SELECT v.id, v.code, v.date, v.time, v.formula, c.name customer, c.formula cformula, c.formula_at, u.full_name staff,
      (SELECT SUM(price) FROM visit_items WHERE visit_id=v.id AND grp='Hóa chất') chem,
      (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items WHERE visit_id=v.id AND grp='Hóa chất') svc,
      (SELECT SUM(-qty*unit_cost) FROM stock_moves WHERE visit_id=v.id AND kind='use' AND (note IS NULL OR note<>'Tự trừ theo công thức')) used
    FROM visits v JOIN customers c ON c.id=v.customer_id LEFT JOIN users u ON u.id=v.main_staff_id
    WHERE v.status='done' AND v.date BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM visit_items WHERE visit_id=v.id AND grp='Hóa chất')
    ORDER BY v.date, v.time`).all(from, to);
  const out = rows.map((v) => {
    const r = { id: v.id, code: v.code, date: v.date, time: v.time, customer: v.customer, staff: v.staff, services: v.svc, price: v.chem || 0, lines: [], unknown: [] };
    if (v.used > 0) { r.cost = Math.round(v.used); r.source = 'Xuất kho'; return r; }
    const late = v.formula_at && v.formula_at >= v.date && v.formula_at <= L.addDays(v.date, 10);
    const text = v.formula || (late ? v.cformula : null);
    if (text) {
      const p = parseFormula(text, mats);
      r.lines = p.lines.map((l) => { const m = byId.get(l.material_id); return { name: l.name, amt: l.amt, unit: l.unit, cost: Math.round((m && m.size ? l.amt / m.size : l.amt) * ac(l.material_id)) }; });
      r.unknown = p.unknown;
      const c = r.lines.reduce((s, l) => s + l.cost, 0);
      if (c > 0) { r.cost = c; r.source = 'Công thức'; r.formula = text; return r; }
    }
    r.cost = Math.round(r.price * rate); r.source = 'Ước tính';
    return r;
  });
  const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
  const real = out.filter((x) => x.source !== 'Ước tính');
  return {
    rows: out, heads: out.length, cost: sum(out, 'cost'), price: sum(out, 'price'),
    avg_cost: out.length ? Math.round(sum(out, 'cost') / out.length) : 0,
    real_heads: real.length, real_avg_cost: real.length ? Math.round(sum(real, 'cost') / real.length) : 0,
    real_pct: sum(real, 'price') ? sum(real, 'cost') / sum(real, 'price') : 0,
    by_source: out.reduce((m, x) => ((m[x.source] = (m[x.source] || 0) + 1), m), {}),
  };
}

db.exec(`
CREATE TABLE IF NOT EXISTS fin_conf (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS fin_items (
  id INTEGER PRIMARY KEY,
  month TEXT NOT NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  cash INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_fin_items_month ON fin_items(month);
-- Thu nhập khác (lì xì khai trương, lì xì Tết…): KHÔNG phải tip, KHÔNG phải doanh thu dịch vụ; cộng vào lãi/lỗ + dòng tiền
CREATE TABLE IF NOT EXISTS other_income (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Lì xì khai trương',
  method TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_other_income_date ON other_income(date);
`);

// Chi phí cố định mặc định mỗi tháng (lấy từ file Excel cũ – bạn sửa trên trang). cash=0: không phải tiền chi ra (khấu hao)
const DEFAULT_FIXED = [
  { name: 'Tiền nhà', amount: 15000000, cash: 1, note: 'trả 3 tháng/lần (45tr)' },
  { name: 'Khấu hao sửa chữa cửa hàng', amount: 18681651, cash: 0, note: 'năm 1 – không phải tiền chi ra' },
  { name: 'Điện, nước, internet', amount: 0, cash: 1, note: 'nhập số từng tháng' },
  { name: 'Phần mềm (YouTube…)', amount: 100000, cash: 1, note: '' },
];
// % giá vốn ước tính cho lượt KHÔNG ghi xuất kho (theo doanh thu dòng đó)
const DEFAULT_RATES = { 'Hóa chất': 0.25, 'Gội & chăm sóc': 0.10, 'Cắt': 0.03, 'Bán sản phẩm': 0.60 };

const getConf = (k, def) => { const r = db.prepare('SELECT value FROM fin_conf WHERE key=?').get(k); if (!r) return def; try { return JSON.parse(r.value); } catch { return def; } };
const setConf = (k, v) => db.prepare('INSERT INTO fin_conf(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));
const isMonth = (m) => /^\d{4}-\d{2}$/.test(String(m || ''));
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const money = (v, max = 1e10) => { const n = Math.round(Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0); if (n < 0 || n > max) throw bad('Số tiền không hợp lệ'); return n; };

function report(month) {
  const from = month + '-01', to = monthEnd(month);
  const sales = L.salesReport(from, to, { role: 'owner' });
  const S = sales.summary;
  const rates = { ...DEFAULT_RATES, ...getConf('rates', {}) };

  // 1) Doanh thu ghi nhận = tiền dịch vụ + bán SP đã làm trong tháng, trừ phần khách dùng thẻ tri ân (không thu tiền)
  const serviceRev = S.shop_service_sales, productRev = S.product_sales;
  const revenue = serviceRev + productRev - S.paid_by_gift;

  // 2) Giá vốn: xuất kho thực tế theo hóa đơn + ước tính cho lượt chưa ghi xuất kho
  const moves = db.prepare(`SELECT s.kind, SUM(-s.qty*s.unit_cost) cost FROM stock_moves s JOIN visits v ON v.id=s.visit_id
    WHERE v.status='done' AND v.date BETWEEN ? AND ? AND s.kind IN ('use','sale') GROUP BY 1`).all(from, to);
  const useCost = Math.round((moves.find((x) => x.kind === 'use') || {}).cost || 0);
  const saleCost = Math.round((moves.find((x) => x.kind === 'sale') || {}).cost || 0);
  const hc = headCost(from, to, Number(rates['Hóa chất']) || 0);
  const fromFormula = new Map(hc.rows.filter((x) => x.source === 'Công thức').map((x) => [x.id, x.cost]));
  const est = {}; let estVisits = 0;
  const vis = db.prepare(`SELECT v.id,
      EXISTS(SELECT 1 FROM stock_moves WHERE visit_id=v.id AND kind='use') has_use,
      EXISTS(SELECT 1 FROM stock_moves WHERE visit_id=v.id AND kind='sale') has_sale
    FROM visits v WHERE v.status='done' AND v.date BETWEEN ? AND ?`).all(from, to);
  const items = db.prepare("SELECT COALESCE(grp,'Khác') grp, SUM(price) p FROM visit_items WHERE visit_id=? GROUP BY 1");
  for (const v of vis) {
    let used = false;
    for (const it of items.all(v.id)) {
      const isProd = it.grp === 'Bán sản phẩm';
      if ((isProd && v.has_sale) || (!isProd && v.has_use)) continue;
      // Hóa chất có công thức thợ ghi → dùng giá cốt theo công thức thay cho % ước tính
      if (it.grp === 'Hóa chất' && fromFormula.has(v.id)) { est['Hóa chất (theo công thức)'] = (est['Hóa chất (theo công thức)'] || 0) + fromFormula.get(v.id); used = true; continue; }
      const r = Number(rates[it.grp]) || 0;
      if (!r || !it.p) continue;
      est[it.grp] = (est[it.grp] || 0) + Math.round(it.p * r); used = true;
    }
    if (used) estVisits++;
  }
  const estTotal = Object.values(est).reduce((a, b) => a + b, 0);
  const cogs = useCost + saleCost + estTotal;
  const gross = revenue - cogs;

  // 3) Lương: theo Bảng lương (đã chốt thì lấy số chốt). Không tính tip (khách trả hộ) và tiền ứng (đã nằm trong lương)
  const pr = payroll.payroll(month);
  const plusMinus = pr.rows.reduce((a, r) => a + (r.plus || 0) - (r.minus || 0), 0);
  const T = pr.totals;
  const payFixed = T.base + T.allowance + T.kpi + T.floor_topup;
  const payVar = T.commission + T.bonus;
  const payTotal = payFixed + payVar + plusMinus;
  const noParams = pr.rows.filter((r) => !r.has_params).map((r) => r.name);

  // 4) Chi quỹ tiền mặt đã duyệt (nước uống, giặt khăn, sửa nhỏ…)
  // Mọi nguồn tiền (quỹ tại tiệm, nhân viên ứng, chủ trả cá nhân) đều là chi phí tiệm; khoản chia N tháng chỉ lấy phần của tháng này
  const mexp = require('./expenses').monthExpenses(month);
  const catMap = {};
  for (const e of mexp) catMap[e.category || 'Khác'] = (catMap[e.category || 'Khác'] || 0) + e.share;
  const fundRows = Object.entries(catMap).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const fund = fundRows.reduce((a, r) => a + r.amount, 0);
  const spreadRows = mexp.filter((e) => e.spread_months > 1).map((e) => ({ id: e.id, date: e.date, note: String(e.note || '').replace(/ · từ sổ đặt lịch$/, ''), amount: e.amount, months: e.spread_months, share: e.share }));
  // Dòng tiền: tiền thật chi ra trong tháng (cả khoản chia tháng tính đủ ngày trả)
  const fundCash = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE kind='out' AND status='approved' AND date BETWEEN ? AND ?`).get(from, to).s;
  // Khoản chi quỹ dễ bị TRÙNG với chi phí cố định (điện, internet, phần mềm, tiền nhà) hoặc KHÔNG phải chi phí (đổi tiền, ứng lương)
  const fundFlags = db.prepare(`SELECT id, date, amount, note FROM expenses WHERE kind='out' AND status='approved' AND date BETWEEN ? AND ?`).all(from, to)
    .filter((e) => /điện|internet|wifi|youtube|youtobe|canva|capcut|phần mềm|tiền nhà|thuê nhà|đổi tiền|ứng lương|rút tiền/i.test(e.note || ''))
    .map((e) => ({ ...e, note: String(e.note).replace(/ · từ sổ đặt lịch$/, '') }));

  // 5) Chi phí cố định: mặc định + khoản riêng của tháng (trùng tên thì khoản của tháng thay mặc định)
  const monthItems = db.prepare('SELECT * FROM fin_items WHERE month=? ORDER BY id').all(month);
  const override = new Set(monthItems.map((i) => i.name.trim().toLowerCase()));
  const fixed = getConf('fixed', DEFAULT_FIXED)
    .filter((f) => !override.has(String(f.name).trim().toLowerCase()))
    .map((f) => ({ name: f.name, amount: Number(f.amount) || 0, cash: f.cash ? 1 : 0, note: f.note || '', source: 'mặc định' }))
    .concat(monthItems.map((i) => ({ id: i.id, name: i.name, amount: i.amount, cash: i.cash, note: i.note || '', source: 'tháng này' })));
  const fixedTotal = fixed.reduce((a, f) => a + f.amount, 0);
  const depreciation = fixed.filter((f) => !f.cash).reduce((a, f) => a + f.amount, 0);

  const opex = payTotal + fund + fixedTotal;
  // Thu nhập khác: lì xì khai trương… (không phải tip, không tính vào doanh số thợ)
  const incomeRows = db.prepare('SELECT * FROM other_income WHERE date BETWEEN ? AND ? ORDER BY date, id').all(from, to);
  const otherIncome = incomeRows.reduce((a, x) => a + x.amount, 0);
  const profit = gross - opex + otherIncome;
  const ebitda = profit + depreciation; // lãi trước khấu hao (gần với tiền thật)
  // Hòa vốn: chi phí cố định / (1 − tỷ lệ chi phí biến đổi)
  const varCost = cogs + payVar;
  const fixCost = payFixed + plusMinus + fund + fixedTotal;
  const cmRatio = revenue > 0 ? 1 - varCost / revenue : 0;
  const breakeven = cmRatio > 0 ? Math.round(fixCost / cmRatio) : null;

  // Dòng tiền tháng: tiền khách trả (DV + SP + bán thẻ) − tiền chi thật
  const purchases = Math.round(db.prepare(`SELECT COALESCE(SUM(qty*unit_cost),0) c FROM stock_moves WHERE kind='in' AND date BETWEEN ? AND ?`).get(from, to).c);
  const cashOut = payTotal + fundCash + (fixedTotal - depreciation) + purchases;

  return {
    month, from, to, locked_payroll: !!pr.locked, rates,
    revenue: { service: serviceRev, product: productRev, gift: S.paid_by_gift, total: revenue, unpaid: S.unpaid, tips: S.tips,
      card_sales: S.card_sales, paid_by_card: S.paid_by_card, family: S.family_sales, discounts: S.discounts, visits: S.visits },
    cogs: { use: useCost, sale: saleCost, est, est_total: estTotal, est_visits: estVisits, total: cogs },
    gross, gross_pct: revenue ? gross / revenue : 0, head_cost: hc,
    payroll: { fixed: payFixed, variable: payVar, plus_minus: plusMinus, total: payTotal, people: pr.rows.length, no_params: noParams,
      base: T.base, allowance: T.allowance, commission: T.commission, bonus: T.bonus, kpi: T.kpi, floor_topup: T.floor_topup },
    fund: { total: fund, rows: fundRows, flags: fundFlags, spread: spreadRows, by_source: mexp.reduce((m, e) => ((m[e.source || 'fund'] = (m[e.source || 'fund'] || 0) + e.share), m), {}) },
    fixed: { rows: fixed, total: fixedTotal, depreciation },
    other_income: { total: otherIncome, rows: incomeRows }, opex, profit, profit_pct: revenue ? profit / revenue : 0, ebitda, breakeven,
    cash: { in_service: S.service_cash, in_cards: S.card_sales, in_other: otherIncome, in_total: S.money_in + otherIncome, payroll: payTotal, fund: fundCash, fixed: fixedTotal - depreciation, purchases, out_total: cashOut, net: S.money_in + otherIncome - cashOut },
  };
}

function mount(app, { OWNER }) {
  app.get('/api/finance', OWNER, (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : L.today().slice(0, 7);
    res.json({ ...report(month), defaults: { fixed: getConf('fixed', DEFAULT_FIXED), rates: { ...DEFAULT_RATES, ...getConf('rates', {}) } } });
  });
  // Sửa danh sách chi phí cố định mặc định + % giá vốn ước tính
  app.put('/api/finance/config', OWNER, (req, res) => {
    const b = req.body || {};
    if (Array.isArray(b.fixed)) {
      const list = b.fixed.map((f) => ({ name: L.str(f.name), amount: money(f.amount), cash: f.cash === false || f.cash === 0 || f.cash === '0' ? 0 : 1, note: L.str(f.note) || '' }))
        .filter((f) => f.name);
      if (list.length > 50) throw bad('Tối đa 50 khoản');
      setConf('fixed', list);
    }
    if (b.rates && typeof b.rates === 'object') {
      const r = {};
      for (const [k, v] of Object.entries(b.rates)) { const n = Number(v); if (!(n >= 0 && n <= 1)) throw bad('Tỷ lệ 0–100%'); r[String(k).slice(0, 40)] = n; }
      setConf('rates', r);
    }
    audit(req.user.id, 'finance.config', 'fin', null, b);
    res.json({ ok: true });
  });
  // Khoản chi riêng của 1 tháng (vd điện nước tháng này, sửa máy, quảng cáo…)
  app.post('/api/finance/items', OWNER, (req, res) => {
    const b = req.body || {};
    if (!isMonth(b.month)) throw bad('Tháng không hợp lệ');
    const name = L.str(b.name); if (!name) throw bad('Nhập tên khoản chi');
    const r = db.prepare('INSERT INTO fin_items(month,name,amount,cash,note) VALUES (?,?,?,?,?)')
      .run(b.month, name, money(b.amount), b.cash === false || b.cash === 0 ? 0 : 1, L.str(b.note));
    audit(req.user.id, 'finance.item', 'fin_items', r.lastInsertRowid, b);
    res.json({ id: r.lastInsertRowid });
  });
  app.post('/api/finance/income', OWNER, (req, res) => {
    const b = req.body || {};
    const amount = money(b.amount);
    if (!(amount > 0)) throw bad('Nhập số tiền');
    const date = L.isDate(b.date) ? b.date : L.today();
    const method = /chuy|ck/i.test(b.method || '') ? 'Chuyển khoản' : 'Tiền mặt';
    const r = db.prepare('INSERT INTO other_income(date,amount,kind,method,note,created_by) VALUES (?,?,?,?,?,?)')
      .run(date, amount, L.str(b.kind) || 'Lì xì khai trương', method, L.str(b.note), req.user.id);
    audit(req.user.id, 'finance.income', 'other_income', r.lastInsertRowid, { date, amount, kind: b.kind, method });
    res.json({ id: r.lastInsertRowid });
  });
  app.delete('/api/finance/income/:id', OWNER, (req, res) => {
    const x = db.prepare('SELECT * FROM other_income WHERE id=?').get(int(req.params.id));
    if (!x) throw bad('Không tìm thấy');
    db.prepare('DELETE FROM other_income WHERE id=?').run(x.id);
    audit(req.user.id, 'finance.income.delete', 'other_income', x.id, x);
    res.json({ ok: true });
  });
  app.delete('/api/finance/items/:id', OWNER, (req, res) => {
    db.prepare('DELETE FROM fin_items WHERE id=?').run(int(req.params.id));
    audit(req.user.id, 'finance.item.delete', 'fin_items', int(req.params.id), null);
    res.json({ ok: true });
  });
}

module.exports = { mount, report, headCost };
