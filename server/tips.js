'use strict';
// Chia tip chung: tip cả tháng gom lại, mỗi ngày chia đều cho các thợ trong nhóm có đi làm hôm đó.
// Ai nghỉ (đơn off cả ngày đã duyệt) thì không được chia tip của ngày đó. Trả vào ngày 5 tháng kế tiếp.
const { db, getSettings, audit } = require('./db');
const L = require('./logic');
const { bad, int } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS tip_paid (
  month TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  paid_by INTEGER REFERENCES users(id),
  PRIMARY KEY (month, user_id)
);
`);
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('tip_pay_day','5')").run();

const DEFAULT_POOL = ['Chị Thu', 'Thu', 'Trường', 'Thoại', 'Dương'];
function poolIds() {
  const s = getSettings().tip_pool;
  if (s != null) return s.split(',').map(Number).filter(Boolean);
  return db.prepare('SELECT id, full_name FROM users WHERE active=1').all().filter((u) => DEFAULT_POOL.includes(u.full_name)).map((u) => u.id);
}
const isMonth = (m) => /^\d{4}-\d{2}$/.test(String(m || ''));
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };

function tipReport(month) {
  const from = month + '-01', to = monthEnd(month);
  const ids = poolIds();
  const users = ids.length ? db.prepare(`SELECT id, full_name name, active FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  const members = ids.map((id) => users.find((u) => u.id === id)).filter(Boolean);
  const tipDays = db.prepare(`SELECT date, SUM(tip) tip, COUNT(*) n FROM visits WHERE status='done' AND tip>0 AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`).all(from, to);
  const offs = db.prepare("SELECT user_id, date, from_time, to_time FROM staff_off WHERE status='approved' AND date BETWEEN ? AND ?").all(from, to);
  const fullOff = new Set(offs.filter((o) => !o.from_time || !o.to_time).map((o) => `${o.user_id}|${o.date}`));
  const partOff = new Set(offs.filter((o) => o.from_time && o.to_time).map((o) => `${o.user_id}|${o.date}`));
  const checked = new Set(db.prepare("SELECT DISTINCT user_id||'|'||date k FROM attendance WHERE kind='in' AND date BETWEEN ? AND ?").all(from, to).map((r) => r.k));
  const usesAttendance = checked.size > 0;
  const per = new Map(members.map((m) => [m.id, { user_id: m.id, name: m.name, exact: 0, days_shared: 0, days_off: 0 }]));
  let unallocated = 0;
  const days = tipDays.map((d) => {
    const present = members.filter((m) => !fullOff.has(`${m.id}|${d.date}`)).map((m) => m.id);
    const absent = members.filter((m) => fullOff.has(`${m.id}|${d.date}`)).map((m) => m.id);
    const share = present.length ? d.tip / present.length : 0;
    if (!present.length) unallocated += d.tip;
    for (const id of present) { const p = per.get(id); p.exact += share; p.days_shared++; }
    for (const id of absent) per.get(id).days_off++;
    return { date: d.date, tip: d.tip, visits: d.n, present, absent, share: Math.round(share),
      partial: members.filter((m) => partOff.has(`${m.id}|${d.date}`)).map((m) => m.id),
      no_checkin: usesAttendance ? present.filter((id) => !checked.has(`${id}|${d.date}`)) : [] };
  });
  const paid = new Map(db.prepare(`SELECT p.*, u.full_name paid_by_name FROM tip_paid p LEFT JOIN users u ON u.id=p.paid_by WHERE month=?`).all(month).map((p) => [p.user_id, p]));
  const shares = [...per.values()].map((p) => {
    const pd = paid.get(p.user_id);
    return { user_id: p.user_id, name: p.name, amount: Math.round(p.exact), days_shared: p.days_shared, days_off: p.days_off,
      paid_amount: pd ? pd.amount : null, paid_at: pd ? pd.paid_at : null, paid_by_name: pd ? pd.paid_by_name : null };
  });
  const payDay = String(Math.min(28, Math.max(1, Number(getSettings().tip_pay_day || 5)))).padStart(2, '0');
  return { month, from, to, pay_date: `${nextMonth(month)}-${payDay}`, members, days, shares,
    total_tip: tipDays.reduce((s, d) => s + d.tip, 0), unallocated, uses_attendance: usesAttendance };
}

function mount(app, { MGR }) {
  app.get('/api/tips', (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : L.today().slice(0, 7);
    res.json(tipReport(month));
  });
  // Nhóm chia tip (mặc định Chị Thu, Trường, Thoại, Dương)
  app.put('/api/tips/pool', MGR, (req, res) => {
    const ids = (Array.isArray(req.body.user_ids) ? req.body.user_ids : []).map(int).filter(Boolean);
    if (!ids.length) throw bad('Chọn ít nhất 1 người trong nhóm chia tip');
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('tip_pool',?)").run(ids.join(','));
    audit(req.user.id, 'set_tip_pool', 'settings', null, { ids });
    res.json({ ok: true });
  });
  // Đánh dấu đã trả tip tháng cho 1 người (paid=false để hủy)
  app.post('/api/tips/paid', MGR, (req, res) => {
    const { month } = req.body;
    const uid = int(req.body.user_id);
    if (!isMonth(month) || !uid) throw bad('Thiếu tháng hoặc nhân viên');
    if (req.body.paid === false) db.prepare('DELETE FROM tip_paid WHERE month=? AND user_id=?').run(month, uid);
    else {
      const row = tipReport(month).shares.find((s) => s.user_id === uid);
      if (!row) throw bad('Người này không có trong nhóm chia tip');
      db.prepare('INSERT OR REPLACE INTO tip_paid(month,user_id,amount,paid_by) VALUES (?,?,?,?)').run(month, uid, row.amount, req.user.id);
    }
    audit(req.user.id, 'tip_paid', 'user', uid, { month, paid: req.body.paid !== false });
    res.json({ ok: true });
  });
}

module.exports = { mount, tipReport, poolIds };
