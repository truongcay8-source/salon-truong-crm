'use strict';
// Bảng lương tháng – CHỈ Lãnh đạo (tài khoản Vinh) xem/sửa.
// Lương = Lương cứng (theo công) + Phụ cấp (trừ lỗi) + Hoa hồng (DV tự làm, phụ, thẻ, phụ thu) + Thưởng DS theo bậc
//       + Thưởng KPI + Bù sàn (nếu có) + Tip (chung + riêng) + Cộng khác − Trừ khác − Ứng lương
// Số hoa hồng/tip lấy thẳng từ hóa đơn (cùng cách tính với trang Doanh số / Chia tip). Chốt tháng → lưu lại, không đổi nữa.
const { db, audit } = require('./db');
const L = require('./logic');
const { bad, int } = L;
const { tipReport } = require('./tips');

db.exec(`
CREATE TABLE IF NOT EXISTS payroll_params (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  base_salary INTEGER NOT NULL DEFAULT 0,
  std_days INTEGER NOT NULL DEFAULT 26,
  allowance INTEGER NOT NULL DEFAULT 0,
  allowance_label TEXT,
  error_penalty INTEGER NOT NULL DEFAULT 0,
  kpi_max INTEGER NOT NULL DEFAULT 0,
  bonus_tiers TEXT,
  floor_amount INTEGER NOT NULL DEFAULT 0,
  floor_until TEXT,
  floor_kpi_min REAL NOT NULL DEFAULT 0.7,
  note TEXT
);
CREATE TABLE IF NOT EXISTS payroll_inputs (
  month TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  days REAL,
  kpi_pct REAL,
  errors INTEGER NOT NULL DEFAULT 0,
  advance INTEGER NOT NULL DEFAULT 0,
  plus INTEGER NOT NULL DEFAULT 0,
  minus INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  PRIMARY KEY (month, user_id)
);
CREATE TABLE IF NOT EXISTS payroll_locks (
  month TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  locked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  locked_by INTEGER REFERENCES users(id)
);
`);

const isMonth = (m) => /^\d{4}-\d{2}$/.test(String(m || ''));
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
// Bậc thưởng: "40000000:2, 60000000:4" hoặc [[40000000,0.02],…] → [{from, pct}] tăng dần
function parseTiers(v) {
  let arr = [];
  try { arr = Array.isArray(v) ? v : v ? JSON.parse(v) : []; } catch { arr = []; }
  return arr.map((t) => ({ from: Math.max(0, Number(t.from ?? t[0]) || 0), pct: Math.max(0, Number(t.pct ?? t[1]) || 0) }))
    .filter((t) => t.from > 0 && t.pct > 0 && t.pct < 1).sort((a, b) => a.from - b.from);
}
function tierFor(tiers, sales) { let pct = 0; for (const t of tiers) if (sales >= t.from) pct = t.pct; return pct; }

function compute(month) {
  const from = month + '-01', to = monthEnd(month);
  const sales = L.salesReport(from, to, { role: 'owner' });
  const tips = tipReport(month);
  const params = new Map(db.prepare('SELECT * FROM payroll_params').all().map((p) => [p.user_id, p]));
  const inputs = new Map(db.prepare('SELECT * FROM payroll_inputs WHERE month=?').all(month).map((p) => [p.user_id, p]));
  const att = new Map(db.prepare("SELECT user_id, COUNT(DISTINCT date) n FROM attendance WHERE kind='in' AND date BETWEEN ? AND ? GROUP BY user_id").all(from, to).map((r) => [r.user_id, r.n]));
  const offs = new Map();
  for (const o of db.prepare("SELECT user_id, from_time, to_time FROM staff_off WHERE status='approved' AND date BETWEEN ? AND ?").all(from, to)) {
    offs.set(o.user_id, (offs.get(o.user_id) || 0) + (o.from_time && o.to_time ? 0.5 : 1));
  }
  const users = db.prepare("SELECT id, full_name, level FROM users WHERE active=1 AND works<>0 ORDER BY CASE level WHEN 'Director' THEN 0 WHEN 'Senior' THEN 1 WHEN 'Stylist' THEN 2 WHEN 'Junior' THEN 3 ELSE 4 END, id").all();
  const ids = new Set(users.map((u) => u.id));
  for (const r of sales.rows) if (!ids.has(r.user_id) && (r.total_commission || r.sales)) { users.push({ id: r.user_id, full_name: r.name, level: r.level }); ids.add(r.user_id); }
  for (const t of tips.shares) if (!ids.has(t.user_id) && t.amount) { users.push({ id: t.user_id, full_name: t.name }); ids.add(t.user_id); }
  const rows = users.map((u) => {
    const p = params.get(u.id) || { base_salary: 0, std_days: 26, allowance: 0, error_penalty: 0, kpi_max: 0, bonus_tiers: null, floor_amount: 0, floor_until: null, floor_kpi_min: 0.7 };
    const inp = inputs.get(u.id) || {};
    const s = sales.rows.find((r) => r.user_id === u.id) || {};
    const t = tips.shares.find((r) => r.user_id === u.id) || {};
    const std = p.std_days > 0 ? p.std_days : 26;
    // Ngày công: số bạn nhập > số ngày chấm công vào ca > (công chuẩn − ngày off đã duyệt)
    const daysAuto = att.has(u.id) ? att.get(u.id) : Math.max(0, std - (offs.get(u.id) || 0));
    const days = inp.days != null ? inp.days : daysAuto;
    const kpiPct = inp.kpi_pct != null ? inp.kpi_pct : 1;
    const base = Math.round(p.base_salary * Math.min(1, days / std));
    const allowance = Math.max(0, p.allowance - (inp.errors || 0) * p.error_penalty);
    const c = { service: s.main_commission || 0, assist: s.assistant_commission || 0, card: s.card_commission || 0, surcharge: s.surcharge_share || 0 };
    const commission = c.service + c.assist + c.card + c.surcharge;
    const tiers = parseTiers(p.bonus_tiers);
    const bonusSales = s.bonus_sales || 0;
    const bonusPct = tierFor(tiers, bonusSales);
    const bonus = Math.round(bonusSales * bonusPct);
    const kpi = Math.round(p.kpi_max * Math.max(0, Math.min(1, kpiPct)));
    const subtotal = base + allowance + commission + bonus + kpi;
    const floorOn = p.floor_amount > 0 && (!p.floor_until || from <= p.floor_until) && kpiPct >= (p.floor_kpi_min || 0);
    const topup = floorOn && subtotal < p.floor_amount ? p.floor_amount - subtotal : 0;
    const tipShared = t.shared || 0, tipPrivate = t.private || 0;
    const plus = inp.plus || 0, minus = inp.minus || 0, advance = inp.advance || 0;
    const warranty = s.warranty_penalty || 0; // Vinh 26/11: làm lại bảo hành lỗi kỹ thuật – thợ chịu giá cốt (phương án C)
    const net = subtotal + topup + tipShared + tipPrivate + plus - minus - advance - warranty;
    return {
      user_id: u.id, name: u.full_name, level: u.level || null, has_params: params.has(u.id),
      params: { ...p, bonus_tiers: tiers }, input: { days: inp.days ?? null, kpi_pct: inp.kpi_pct ?? null, errors: inp.errors || 0, advance, plus, minus, note: inp.note || '' },
      days, days_auto: daysAuto, days_source: inp.days != null ? 'nhập tay' : att.has(u.id) ? 'chấm công' : 'công chuẩn − ngày off', std_days: std, kpi_pct: kpiPct,
      sales: s.sales || 0, bonus_sales: bonusSales, gift_sales: s.gift_sales || 0, family_sales: s.family_sales || 0, by_group: s.by_group || {}, main_count: s.main_count || 0, assist_count: s.assist_count || 0,
      base, allowance, commission_detail: c, commission, bonus_pct: bonusPct, bonus, kpi, subtotal, floor_topup: topup,
      tip_shared: tipShared, tip_private: tipPrivate, plus, minus, advance, warranty, warranty_list: s.warranty_list || [], net,
    };
  });
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return { month, from, to, rows, totals: { base: sum('base'), allowance: sum('allowance'), commission: sum('commission'), bonus: sum('bonus'), kpi: sum('kpi'),
    floor_topup: sum('floor_topup'), tips: sum('tip_shared') + sum('tip_private'), advance: sum('advance'), net: sum('net') },
    service_sales: sales.summary ? sales.summary.service_sales : 0, money_in: sales.summary ? sales.summary.money_in : 0 };
}

function payroll(month) {
  const lock = db.prepare('SELECT p.*, u.full_name locked_by_name FROM payroll_locks p LEFT JOIN users u ON u.id=p.locked_by WHERE month=?').get(month);
  if (lock) return { ...JSON.parse(lock.data), locked: { at: lock.locked_at, by: lock.locked_by_name } };
  return { ...compute(month), locked: null };
}
const notLocked = (month) => { if (db.prepare('SELECT 1 FROM payroll_locks WHERE month=?').get(month)) throw bad('Tháng này đã chốt lương. Bấm "Mở chốt" trước khi sửa.'); };
const money = (v, max = 1e9) => { const n = Math.round(Number(v) || 0); if (n < 0 || n > max) throw bad('Số tiền không hợp lệ'); return n; };

function mount(app, { OWNER }) {
  app.get('/api/payroll', OWNER, (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : L.today().slice(0, 7);
    res.json(payroll(month));
  });
  // Tham số cố định của từng người (lương cứng, phụ cấp, KPI, bậc thưởng, sàn thu nhập)
  app.put('/api/payroll/params/:uid', OWNER, (req, res) => {
    const uid = int(req.params.uid);
    if (!uid || !db.prepare('SELECT 1 FROM users WHERE id=?').get(uid)) throw bad('Không tìm thấy nhân viên');
    const b = req.body || {};
    const std = int(b.std_days) || 26;
    if (std < 1 || std > 31) throw bad('Công chuẩn 1–31 ngày');
    const kmin = b.floor_kpi_min == null || b.floor_kpi_min === '' ? 0.7 : Number(b.floor_kpi_min);
    if (!(kmin >= 0 && kmin <= 1)) throw bad('KPI tối thiểu 0–100%');
    const v = {
      base_salary: money(b.base_salary), std_days: std, allowance: money(b.allowance), allowance_label: L.str(b.allowance_label),
      error_penalty: money(b.error_penalty), kpi_max: money(b.kpi_max), bonus_tiers: JSON.stringify(parseTiers(b.bonus_tiers).map((t) => [t.from, t.pct])),
      floor_amount: money(b.floor_amount), floor_until: L.isDate(b.floor_until) ? b.floor_until : null, floor_kpi_min: kmin, note: L.str(b.note),
    };
    const before = db.prepare('SELECT * FROM payroll_params WHERE user_id=?').get(uid);
    const ks = Object.keys(v);
    db.prepare(`INSERT INTO payroll_params(user_id,${ks.join(',')}) VALUES (?,${ks.map(() => '?').join(',')})
      ON CONFLICT(user_id) DO UPDATE SET ${ks.map((k) => `${k}=excluded.${k}`).join(',')}`).run(uid, ...ks.map((k) => v[k]));
    audit(req.user.id, 'payroll_params', 'user', uid, { before: before || null, after: v });
    res.json({ ok: true });
  });
  // Số nhập cuối tháng: công thực tế, % KPI, số lỗi, ứng lương, cộng/trừ khác
  app.put('/api/payroll/inputs', OWNER, (req, res) => {
    const b = req.body || {};
    const uid = int(b.user_id);
    if (!isMonth(b.month) || !uid) throw bad('Thiếu tháng hoặc nhân viên');
    notLocked(b.month);
    const days = b.days === '' || b.days == null ? null : Number(b.days);
    if (days != null && !(days >= 0 && days <= 31)) throw bad('Ngày công 0–31');
    const kpi = b.kpi_pct === '' || b.kpi_pct == null ? null : Number(b.kpi_pct);
    if (kpi != null && !(kpi >= 0 && kpi <= 1)) throw bad('KPI 0–100%');
    const v = [days, kpi, Math.max(0, int(b.errors) || 0), money(b.advance), money(b.plus), money(b.minus), L.str(b.note)];
    db.prepare(`INSERT INTO payroll_inputs(month,user_id,days,kpi_pct,errors,advance,plus,minus,note) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(month,user_id) DO UPDATE SET days=excluded.days,kpi_pct=excluded.kpi_pct,errors=excluded.errors,advance=excluded.advance,plus=excluded.plus,minus=excluded.minus,note=excluded.note`)
      .run(b.month, uid, ...v);
    audit(req.user.id, 'payroll_inputs', 'user', uid, { month: b.month, days, kpi, errors: v[2], advance: v[3], plus: v[4], minus: v[5], note: v[6] });
    res.json({ ok: true });
  });
  // Chốt lương: lưu nguyên bảng tính lúc chốt (sửa hóa đơn sau đó không làm đổi phiếu). lock=false → mở chốt
  app.post('/api/payroll/lock', OWNER, (req, res) => {
    const { month } = req.body || {};
    if (!isMonth(month)) throw bad('Thiếu tháng');
    if (req.body.lock === false) db.prepare('DELETE FROM payroll_locks WHERE month=?').run(month);
    else {
      notLocked(month);
      const data = compute(month);
      db.prepare('INSERT INTO payroll_locks(month,data,locked_by) VALUES (?,?,?)').run(month, JSON.stringify(data), req.user.id);
    }
    audit(req.user.id, req.body.lock === false ? 'payroll_unlock' : 'payroll_lock', 'payroll', null, { month });
    res.json({ ok: true });
  });
  app.get('/api/payroll/export', OWNER, async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : L.today().slice(0, 7);
    const r = payroll(month);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Bảng lương ' + month, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
    const cols = [['Nhân viên', 'name', 18], ['Ngày công', 'days', 10], ['Lương cứng', 'base'], ['Phụ cấp', 'allowance'], ['HH dịch vụ', 'c_service'], ['HH phụ', 'c_assist'],
      ['HH bán thẻ', 'c_card'], ['Phụ thu', 'c_surcharge'], ['DS tính thưởng', 'bonus_sales'], ['% thưởng', 'bonus_pct', 9], ['Thưởng DS', 'bonus'], ['Thưởng KPI', 'kpi'],
      ['Bù sàn', 'floor_topup'], ['Tip chung', 'tip_shared'], ['Tip riêng', 'tip_private'], ['Cộng khác', 'plus'], ['Trừ khác', 'minus'], ['Ứng lương', 'advance'], ['THỰC NHẬN', 'net'], ['Ghi chú', 'note', 30]];
    ws.columns = cols.map(([header, key, width]) => ({ header, key, width: width || 14, style: ['name', 'note', 'days', 'bonus_pct'].includes(key) ? {} : { numFmt: '#,##0' } }));
    ws.getRow(1).font = { bold: true };
    for (const x of r.rows) ws.addRow({ ...x, c_service: x.commission_detail.service, c_assist: x.commission_detail.assist, c_card: x.commission_detail.card, c_surcharge: x.commission_detail.surcharge,
      bonus_pct: x.bonus_pct ? Math.round(x.bonus_pct * 1000) / 10 + '%' : '', note: x.input.note });
    const tot = ws.addRow({ name: 'TỔNG', net: r.totals.net, base: r.totals.base, allowance: r.totals.allowance, bonus: r.totals.bonus, kpi: r.totals.kpi, floor_topup: r.totals.floor_topup, advance: r.totals.advance });
    tot.font = { bold: true };
    if (r.locked) ws.addRow({ name: `Đã chốt ${r.locked.at}${r.locked.by ? ' · ' + r.locked.by : ''}` });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bang-luong-${month}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });
}

module.exports = { mount, compute, payroll, parseTiers };
