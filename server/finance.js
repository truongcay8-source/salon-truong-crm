'use strict';
// Báo cáo tài chính (Lãi/Lỗ tháng) – CHỈ Lãnh đạo (tài khoản Vinh) xem/sửa.
// Doanh thu (dịch vụ + bán SP, bỏ phần trả bằng thẻ tri ân) − Giá vốn (hóa chất/SP đã xuất kho, chỗ chưa ghi thì ước theo %)
// − Lương (theo trang Bảng lương, không tính tip/ứng) − Chi quỹ đã duyệt − Chi phí cố định (nhà, khấu hao, điện nước…) = Lãi/Lỗ.
// Kèm góc nhìn dòng tiền: tiền thực vào (gồm bán thẻ) − tiền thực ra (lương, quỹ, chi phí trả tiền, nhập hàng).
const { db, audit } = require('./db');
const L = require('./logic');
const { bad, int } = L;
const payroll = require('./payroll');

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
  const fundRows = db.prepare(`SELECT COALESCE(category,'Khác') category, SUM(amount) amount FROM expenses
    WHERE kind='out' AND status='approved' AND date BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC`).all(from, to);
  const fund = fundRows.reduce((a, r) => a + r.amount, 0);
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
  const profit = gross - opex;
  const ebitda = profit + depreciation; // lãi trước khấu hao (gần với tiền thật)
  // Hòa vốn: chi phí cố định / (1 − tỷ lệ chi phí biến đổi)
  const varCost = cogs + payVar;
  const fixCost = payFixed + plusMinus + fund + fixedTotal;
  const cmRatio = revenue > 0 ? 1 - varCost / revenue : 0;
  const breakeven = cmRatio > 0 ? Math.round(fixCost / cmRatio) : null;

  // Dòng tiền tháng: tiền khách trả (DV + SP + bán thẻ) − tiền chi thật
  const purchases = Math.round(db.prepare(`SELECT COALESCE(SUM(qty*unit_cost),0) c FROM stock_moves WHERE kind='in' AND date BETWEEN ? AND ?`).get(from, to).c);
  const cashOut = payTotal + fund + (fixedTotal - depreciation) + purchases;

  return {
    month, from, to, locked_payroll: !!pr.locked, rates,
    revenue: { service: serviceRev, product: productRev, gift: S.paid_by_gift, total: revenue, unpaid: S.unpaid, tips: S.tips,
      card_sales: S.card_sales, paid_by_card: S.paid_by_card, family: S.family_sales, discounts: S.discounts, visits: S.visits },
    cogs: { use: useCost, sale: saleCost, est, est_total: estTotal, est_visits: estVisits, total: cogs },
    gross, gross_pct: revenue ? gross / revenue : 0,
    payroll: { fixed: payFixed, variable: payVar, plus_minus: plusMinus, total: payTotal, people: pr.rows.length, no_params: noParams,
      base: T.base, allowance: T.allowance, commission: T.commission, bonus: T.bonus, kpi: T.kpi, floor_topup: T.floor_topup },
    fund: { total: fund, rows: fundRows, flags: fundFlags },
    fixed: { rows: fixed, total: fixedTotal, depreciation },
    opex, profit, profit_pct: revenue ? profit / revenue : 0, ebitda, breakeven,
    cash: { in_service: S.service_cash, in_cards: S.card_sales, in_total: S.money_in, payroll: payTotal, fund, fixed: fixedTotal - depreciation, purchases, out_total: cashOut, net: S.money_in - cashOut },
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
  app.delete('/api/finance/items/:id', OWNER, (req, res) => {
    db.prepare('DELETE FROM fin_items WHERE id=?').run(int(req.params.id));
    audit(req.user.id, 'finance.item.delete', 'fin_items', int(req.params.id), null);
    res.json({ ok: true });
  });
}

module.exports = { mount, report };
