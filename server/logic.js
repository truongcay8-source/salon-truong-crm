'use strict';
const { db, getSettings, num, audit, nextCode, diffObj } = require('./db');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

const int = (v) => { const n = Math.round(Number(v || 0)); return Number.isFinite(n) ? n : 0; };
const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const today = () => localDate(new Date());
function localDate(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}
function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return localDate(d);
}
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function normPhone(p) {
  if (p == null) return null;
  let s = String(p).replace(/[^\d+]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
  if (/^[1-9]\d{8}$/.test(s)) s = '0' + s; // Excel làm mất số 0 đầu
  return s || null;
}

// ---------- Thẻ trả trước ----------
function cardBalance(cardId) {
  const c = db.prepare('SELECT value FROM cards WHERE id=?').get(cardId);
  if (!c) return 0;
  const used = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM card_txns WHERE card_id=?').get(cardId).s;
  return c.value + used;
}
function cardRow(c) {
  return { ...c, balance: cardBalance(c.id) };
}

function sellCard(input, user) {
  const customer = db.prepare('SELECT id FROM customers WHERE id=? AND deleted=0').get(input.customer_id);
  if (!customer) throw bad('Không tìm thấy khách hàng');
  let type = null;
  if (input.card_type_id) {
    type = db.prepare('SELECT * FROM card_types WHERE id=?').get(input.card_type_id);
    if (!type) throw bad('Gói thẻ không tồn tại');
  }
  const price = input.price != null && input.price !== '' ? int(input.price) : type ? type.price : 0;
  const value = input.value != null && input.value !== '' ? int(input.value) : type ? type.value : price;
  if (value <= 0) throw bad('Giá trị thẻ phải lớn hơn 0');
  const soldAt = isDate(input.sold_at) ? input.sold_at : today();
  const months = type ? type.months : int(input.months) || 12;
  const expires = isDate(input.expires_at) ? input.expires_at : type && type.fixed_expiry ? type.fixed_expiry : addMonths(soldAt, months);
  // Gói giá 0đ (thẻ tặng) luôn là "Tặng": không hoa hồng, không tính tiền vào
  const saleType = price === 0 ? 'gift' : ['new', 'renewal', 'gift'].includes(input.sale_type) ? input.sale_type : 'new';
  const sellerId = user.role === 'staff' ? user.id : int(input.seller_id) || user.id;
  const rate = saleType === 'new' ? num('card_new_rate') : saleType === 'renewal' ? num('card_renewal_rate') : 0;
  const seller = db.prepare('SELECT commission_enabled FROM users WHERE id=?').get(sellerId);
  const commission = seller && seller.commission_enabled ? Math.round(price * rate) : 0;
  const code = nextCode('cards', 'THE', 4);
  const r = db.prepare(`INSERT INTO cards(code,customer_id,card_type_id,name,price,value,sold_at,expires_at,seller_id,sale_type,commission,payment_method,note,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, customer.id, type ? type.id : null, str(input.name) || (type ? type.name : 'Thẻ trả trước'),
    price, value, soldAt, expires, sellerId, saleType, commission, str(input.payment_method), str(input.note), user.id);
  audit(user.id, 'sell_card', 'card', r.lastInsertRowid, { code, price, value, customer_id: customer.id });
  return cardRow(db.prepare('SELECT * FROM cards WHERE id=?').get(r.lastInsertRowid));
}

// ---------- Lượt làm (visit) ----------
function canEditVisit(user, v) {
  if (user.role !== 'staff') return true;
  return (v.created_by === user.id || v.main_staff_id === user.id) && v.date === today();
}

function saveVisit(input, user, existing, opts = {}) {
  const isNew = !existing;
  if (!isNew && !canEditVisit(user, existing)) throw new HttpError(403, 'Nhân viên chỉ sửa được lượt của mình trong ngày. Nhờ quản lý sửa.');
  const date = isDate(input.date) ? input.date : today();
  if (user.role === 'staff' && date !== today()) throw new HttpError(403, 'Nhân viên chỉ ghi lượt làm của ngày hôm nay');
  let customerId = int(input.customer_id) || null;
  if (customerId && !db.prepare('SELECT 1 FROM customers WHERE id=? AND deleted=0').get(customerId)) throw bad('Không tìm thấy khách hàng');
  if (!customerId) throw bad('Chọn khách hàng (hoặc tạo khách mới trước)');
  const mainStaff = int(input.main_staff_id) || null;
  if (!mainStaff) throw bad('Chọn thợ chính');
  const assistant = int(input.assistant_id) || null;
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw bad('Chọn ít nhất 1 dịch vụ');
  const svcStmt = db.prepare('SELECT * FROM services WHERE id=?');
  const cleanItems = items.map((it) => {
    // Sản phẩm bán lẻ lấy từ kho: tên thật + số lượng, tính vào nhóm "Bán sản phẩm"
    if (it.material_id) {
      const m = db.prepare("SELECT * FROM materials WHERE id=? AND kind='retail'").get(int(it.material_id));
      if (!m) throw bad('Không tìm thấy sản phẩm trong kho');
      const qty = Math.max(1, int(it.qty) || 1);
      const ps = db.prepare("SELECT * FROM services WHERE grp='Bán sản phẩm' AND active=1 ORDER BY id LIMIT 1").get();
      const price = it.price != null && it.price !== '' ? int(it.price) : (m.sell_price || 0) * qty;
      if (price < 0) throw bad('Giá sản phẩm không hợp lệ');
      return { service_id: ps ? ps.id : null, name: m.name + (qty > 1 ? ' ×' + qty : ''), grp: 'Bán sản phẩm', price, commission_rate: ps ? ps.commission_rate : 0, material_id: m.id, qty };
    }
    const svc = it.service_id ? svcStmt.get(it.service_id) : null;
    const name = str(it.name) || (svc && svc.name);
    if (!name) throw bad('Dịch vụ thiếu tên');
    const price = it.price != null && it.price !== '' ? int(it.price) : svc ? svc.price : 0;
    if (price < 0) throw bad('Giá dịch vụ không hợp lệ');
    return { service_id: svc ? svc.id : null, name, grp: svc ? svc.grp : str(it.grp) || 'Khác', price, commission_rate: svc ? svc.commission_rate : 0 };
  });
  const subtotal = cleanItems.reduce((s, i) => s + i.price, 0);
  const surcharge = Math.max(0, int(input.surcharge));
  const discount = Math.max(0, int(input.discount));
  if (discount > subtotal + surcharge) throw bad('Giảm giá lớn hơn tổng tiền');
  if (discount > 0 && !str(input.discount_reason) && !opts.imported) throw bad('Ghi lý do giảm giá');
  const total = subtotal + surcharge - discount;

  let cardId = int(input.card_id) || null;
  let cardPaid = Math.max(0, int(input.card_paid));
  if (!cardId) cardPaid = 0;
  if (cardId) {
    const card = db.prepare('SELECT * FROM cards WHERE id=?').get(cardId);
    // Thẻ tặng được phép cho người khác dùng (khách tặng lại bạn bè/người nhà); thẻ mua thì chỉ chủ thẻ dùng
    if (!card || (card.customer_id !== customerId && card.sale_type !== 'gift')) throw bad('Thẻ không thuộc khách này');
    if (card.status !== 'active') throw bad('Thẻ đã đóng/hoàn');
    if (card.expires_at && card.expires_at < date && (isNew || existing.card_id !== cardId)) throw bad('Thẻ đã hết hạn ' + card.expires_at + ' — nhờ quản lý gia hạn');
    let bal = cardBalance(cardId);
    if (!isNew && existing.card_id === cardId) bal += existing.card_paid;
    if (cardPaid === 0) cardPaid = Math.min(bal, total);
    if (cardPaid > bal) throw bad('Số dư thẻ chỉ còn ' + bal.toLocaleString('vi-VN') + 'đ');
    if (cardPaid > total) throw bad('Tiền trừ thẻ lớn hơn tổng tiền');
  }
  const cashPaid = total - cardPaid;
  const methods = getSettings().payment_methods.split(',').map((s) => s.trim());
  const pm = str(input.payment_method);
  if (!opts.imported) {
    if (cashPaid > 0 && !pm) throw bad('Chọn hình thức thanh toán');
    if (pm && !methods.includes(pm)) throw bad('Hình thức thanh toán không hợp lệ');
  }

  const factor = subtotal > 0 ? total / subtotal : 0;
  const staffStmt = db.prepare('SELECT commission_enabled FROM users WHERE id=?');
  const ms = staffStmt.get(mainStaff);
  if (!ms) throw bad('Thợ chính không tồn tại');
  const mainCommission = ms.commission_enabled ? Math.round(cleanItems.reduce((s, i) => s + i.price * factor * i.commission_rate, 0)) : 0;
  let assistantCommission = 0;
  if (assistant) {
    const as = staffStmt.get(assistant);
    if (!as) throw bad('Người phụ không tồn tại');
    if (as.commission_enabled) assistantCommission = Math.round(total * num('assistant_rate'));
  }

  const row = {
    customer_id: customerId, date, time: str(input.time), main_staff_id: mainStaff, assistant_id: assistant,
    subtotal, surcharge, discount, discount_reason: str(input.discount_reason), total,
    card_id: cardId, card_paid: cardPaid, cash_paid: cashPaid, payment_method: cashPaid > 0 ? pm : null,
    tip: Math.max(0, int(input.tip)), main_commission: mainCommission, assistant_commission: assistantCommission,
    hair_before: str(input.hair_before), wish: str(input.wish), formula: str(input.formula), result: str(input.result),
    note: str(input.note), next_visit_date: isDate(input.next_visit_date) ? input.next_visit_date : null,
  };

  const oldServices = isNew ? null : db.prepare('SELECT name FROM visit_items WHERE visit_id=? ORDER BY id').all(existing.id).map((x) => x.name).join(' + ');
  const tx = db.transaction(() => {
    let id;
    if (isNew) {
      row.code = nextCode('visits', 'L', 5);
      row.created_by = user.id;
      row.import_ref = input.import_ref || null;
      const cols = Object.keys(row);
      id = db.prepare(`INSERT INTO visits(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c])).lastInsertRowid;
    } else {
      id = existing.id;
      row.updated_at = new Date().toISOString();
      const cols = Object.keys(row);
      db.prepare(`UPDATE visits SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`).run(...cols.map((c) => row[c]), id);
      db.prepare('DELETE FROM visit_items WHERE visit_id=?').run(id);
      db.prepare('DELETE FROM card_txns WHERE visit_id=?').run(id);
    }
    const ins = db.prepare('INSERT INTO visit_items(visit_id,service_id,name,grp,price,commission_rate,material_id,qty) VALUES (?,?,?,?,?,?,?,?)');
    for (const i of cleanItems) ins.run(id, i.service_id, i.name, i.grp, i.price, i.commission_rate, i.material_id || null, i.qty || null);
    // Hóa chất đã dùng + sản phẩm bán → trừ kho, tính giá cốt lượt
    if (!opts.imported) require('./stock').applyVisit(id, date, cleanItems, Array.isArray(input.materials) ? input.materials : null, user);
    if (cardId && cardPaid > 0) {
      const owner = db.prepare('SELECT customer_id FROM cards WHERE id=?').get(cardId).customer_id;
      const forName = owner !== customerId ? db.prepare('SELECT name FROM customers WHERE id=?').get(customerId).name : null;
      db.prepare('INSERT INTO card_txns(card_id,visit_id,amount,note,created_by) VALUES (?,?,?,?,?)').run(cardId, id, -cardPaid, forName ? 'Dùng cho ' + forName + ' (được tặng lại)' : 'Dùng cho lượt làm', user.id);
    }
    if (input.appointment_id) {
      db.prepare("UPDATE appointments SET status='done', visit_id=? WHERE id=?").run(id, int(input.appointment_id));
    }
    // Hồ sơ khách: chưa có thợ phụ trách → gán thợ chính; công thức mới nhất → thành công thức của khách
    db.prepare('UPDATE customers SET staff_id=? WHERE id=? AND staff_id IS NULL').run(mainStaff, customerId);
    if (row.formula) db.prepare("UPDATE customers SET formula=?, formula_at=?, formula_by=? WHERE id=? AND (formula_at IS NULL OR formula_at<=?)")
      .run(row.formula, date, mainStaff, customerId, date);
    audit(user.id, isNew ? 'create_visit' : 'update_visit', 'visit', id,
      isNew ? { total, cash_paid: cashPaid, card_paid: cardPaid } : { code: existing.code, changes: {
        ...diffObj(existing, row, ['date', 'time', 'customer_id', 'main_staff_id', 'assistant_id', 'surcharge', 'discount', 'discount_reason', 'total', 'card_paid', 'cash_paid', 'payment_method', 'tip', 'formula', 'result', 'note']),
        ...diffObj({ services: oldServices }, { services: cleanItems.map((i) => i.name).join(' + ') }) } });
    return id;
  });
  return tx();
}

function deleteVisit(id, reason, user) {
  const v = db.prepare("SELECT * FROM visits WHERE id=? AND status='done'").get(id);
  if (!v) throw new HttpError(404, 'Không tìm thấy lượt làm');
  if (!str(reason)) throw bad('Ghi lý do xóa');
  db.transaction(() => {
    db.prepare("UPDATE visits SET status='deleted', delete_reason=?, updated_at=? WHERE id=?").run(str(reason), new Date().toISOString(), id);
    db.prepare('DELETE FROM card_txns WHERE visit_id=?').run(id);
    require('./stock').clearVisit(id);
    audit(user.id, 'delete_visit', 'visit', id, { reason, total: v.total, cash_paid: v.cash_paid, date: v.date });
  })();
}

function getVisit(id) {
  const v = db.prepare(`SELECT v.*, c.name customer_name, c.code customer_code, c.phone customer_phone,
      m.full_name main_staff_name, a.full_name assistant_name, cd.code card_code
    FROM visits v LEFT JOIN customers c ON c.id=v.customer_id LEFT JOIN users m ON m.id=v.main_staff_id
    LEFT JOIN users a ON a.id=v.assistant_id LEFT JOIN cards cd ON cd.id=v.card_id WHERE v.id=?`).get(id);
  if (!v) return null;
  v.items = db.prepare('SELECT * FROM visit_items WHERE visit_id=? ORDER BY id').all(id);
  v.photos = db.prepare('SELECT id,kind,created_at FROM photos WHERE visit_id=? ORDER BY id').all(id);
  v.materials = require('./stock').visitMaterials(id);
  return v;
}

// Nhân viên không xem tiền của lượt người khác.
function maskVisitMoney(v, user) {
  if (user.role !== 'staff') return v;
  // Nhân viên không bao giờ thấy giá cốt / giá nhập hóa chất
  v = { ...v, cost: null, materials: v.materials ? v.materials.map((m) => ({ ...m, unit_cost: null })) : v.materials };
  if (v.main_staff_id === user.id || v.assistant_id === user.id) return v;
  const out = { ...v };
  for (const k of ['subtotal', 'surcharge', 'discount', 'total', 'card_paid', 'cash_paid', 'tip', 'main_commission', 'assistant_commission']) out[k] = null;
  if (out.items) out.items = out.items.map((i) => ({ ...i, price: null }));
  out.masked = true;
  return out;
}

// ---------- Báo cáo doanh số ----------
function salesReport(from, to, user) {
  const visits = db.prepare("SELECT * FROM visits WHERE status='done' AND date BETWEEN ? AND ?").all(from, to);
  const items = db.prepare(`SELECT vi.*, v.main_staff_id FROM visit_items vi JOIN visits v ON v.id=vi.visit_id
    WHERE v.status='done' AND v.date BETWEEN ? AND ?`).all(from, to);
  const users = db.prepare('SELECT id, full_name, role, active FROM users ORDER BY id').all();
  const per = new Map(users.map((u) => [u.id, {
    user_id: u.id, name: u.full_name, active: u.active, main_count: 0, assist_count: 0,
    by_group: { 'Cắt': 0, 'Gội & chăm sóc': 0, 'Hóa chất': 0, 'Bán sản phẩm': 0, 'Khác': 0 },
    sales: 0, assist_sales: 0, main_commission: 0, assistant_commission: 0, tip: 0,
    cards_count: 0, cards_amount: 0, card_commission: 0, total_commission: 0,
  }]));
  const vById = new Map(visits.map((v) => [v.id, v]));
  for (const v of visits) {
    const m = per.get(v.main_staff_id);
    if (m) { m.main_count++; m.sales += v.total; m.main_commission += v.main_commission; m.tip += v.tip; }
    const a = per.get(v.assistant_id);
    if (a) { a.assist_count++; a.assist_sales += v.total; a.assistant_commission += v.assistant_commission; }
  }
  for (const i of items) {
    const v = vById.get(i.visit_id); const m = per.get(i.main_staff_id);
    if (!m || !v) continue;
    const f = v.subtotal > 0 ? v.total / v.subtotal : 0;
    const g = m.by_group[i.grp] != null ? i.grp : 'Khác';
    m.by_group[g] += Math.round(i.price * f);
  }
  const cards = db.prepare("SELECT * FROM cards WHERE status!='refunded' AND sold_at BETWEEN ? AND ?").all(from, to);
  for (const c of cards) {
    const s = per.get(c.seller_id);
    if (s) { s.cards_count++; s.cards_amount += c.price; s.card_commission += c.commission; }
  }
  let rows = [...per.values()].map((r) => ({ ...r, total_commission: r.main_commission + r.assistant_commission + r.card_commission }))
    .filter((r) => r.active || r.main_count || r.assist_count || r.cards_count);
  const giftCards = new Set(db.prepare("SELECT id FROM cards WHERE sale_type='gift'").all().map((c) => c.id));
  const summary = {
    visits: visits.length,
    service_sales: visits.reduce((s, v) => s + v.total, 0),
    paid_by_card: visits.reduce((s, v) => s + v.card_paid, 0),
    paid_by_gift: visits.reduce((s, v) => s + (v.card_id && giftCards.has(v.card_id) ? v.card_paid : 0), 0),
    service_cash: visits.reduce((s, v) => s + v.cash_paid, 0),
    card_sales: cards.reduce((s, c) => s + c.price, 0),
    tips: visits.reduce((s, v) => s + v.tip, 0),
    discounts: visits.reduce((s, v) => s + v.discount, 0),
    by_method: {},
    by_day: {},
  };
  for (const v of visits) {
    if (v.cash_paid > 0) { const k = v.payment_method || 'Chưa ghi'; summary.by_method[k] = (summary.by_method[k] || 0) + v.cash_paid; }
    summary.by_day[v.date] = (summary.by_day[v.date] || 0) + v.total;
  }
  for (const c of cards) { const k = c.payment_method || 'Chưa ghi'; summary.by_method[k] = (summary.by_method[k] || 0) + c.price; }
  summary.money_in = summary.service_cash + summary.card_sales;
  if (user.role === 'staff') return { from, to, rows: rows.filter((r) => r.user_id === user.id), summary: null };
  return { from, to, rows, summary };
}

// ---------- Nhắc nhở ----------
function nextBirthday(bday, fromDate) {
  if (!bday) return null;
  const m = String(bday).match(/(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(fromDate.slice(0, 4));
  let d = `${y}-${m[1]}-${m[2]}`;
  if (d < fromDate) d = `${y + 1}-${m[1]}-${m[2]}`;
  return d;
}
function reminders() {
  const s = getSettings();
  const t = today();
  const done = new Set(db.prepare('SELECT customer_id||\'|\'||type||\'|\'||ref k FROM reminder_log').all().map((r) => r.k));
  const isDone = (cid, type, ref) => done.has(`${cid}|${type}|${ref}`);
  const out = { birthdays: [], cards: [], returns: [], appointments: [], cancels: [] };

  const bdEnd = addDays(t, Number(s.birthday_days || 7));
  for (const c of db.prepare('SELECT id,code,name,phone,birthday,staff_id FROM customers WHERE deleted=0 AND birthday IS NOT NULL').all()) {
    const nb = nextBirthday(c.birthday, t);
    if (nb && nb <= bdEnd) out.birthdays.push({ ...c, date: nb, ref: nb.slice(0, 4), done: isDone(c.id, 'birthday', nb.slice(0, 4)) });
  }
  out.birthdays.sort((a, b) => a.date.localeCompare(b.date));

  const expEnd = addDays(t, Number(s.card_expiry_days || 30));
  const low = Number(s.card_low_balance || 0);
  for (const c of db.prepare(`SELECT cd.*, c.name customer_name, c.phone, c.code customer_code, c.staff_id cust_staff_id FROM cards cd JOIN customers c ON c.id=cd.customer_id
      WHERE cd.status='active' AND c.deleted=0`).all()) {
    const bal = cardBalance(c.id);
    const reasons = [];
    if (c.expires_at && c.expires_at < t) reasons.push('Đã hết hạn ' + c.expires_at);
    else if (c.expires_at && c.expires_at <= expEnd) reasons.push('Sắp hết hạn ' + c.expires_at);
    if (bal <= low) reasons.push(bal <= 0 ? 'Hết số dư' : 'Số dư thấp');
    if (reasons.length) {
      const ref = `${c.id}:${reasons.join('/')}`;
      out.cards.push({ id: c.customer_id, card_id: c.id, card_code: c.code, card_name: c.name, name: c.customer_name, phone: c.phone,
        code: c.customer_code, staff_id: c.cust_staff_id, balance: bal, expires_at: c.expires_at, reason: reasons.join(' · '), ref, done: isDone(c.customer_id, 'card', ref) });
    }
  }

  const rd = Number(s.return_days || 30);
  const dueBefore = addDays(t, -rd);
  const oldest = addDays(t, -(rd + 120));
  const rows = db.prepare(`SELECT c.id,c.code,c.name,c.phone,c.staff_id, MAX(v.date) last_date, COUNT(v.id) n
      FROM customers c JOIN visits v ON v.customer_id=c.id AND v.status='done'
      WHERE c.deleted=0 GROUP BY c.id HAVING last_date <= ? AND last_date >= ?`).all(dueBefore, oldest);
  const futureAppt = db.prepare("SELECT 1 FROM appointments WHERE customer_id=? AND date>=? AND status IN ('booked','arrived')");
  for (const r of rows) {
    if (futureAppt.get(r.id, t)) continue;
    out.returns.push({ ...r, days: Math.round((new Date(t) - new Date(r.last_date)) / 86400000), ref: r.last_date, done: isDone(r.id, 'return', r.last_date) });
  }
  out.returns.sort((a, b) => b.days - a.days);

  const tomorrow = addDays(t, 1);
  for (const a of db.prepare(`SELECT a.*, COALESCE(c.name,a.guest_name) name, COALESCE(c.phone,a.guest_phone) phone, u.full_name staff_name, c.staff_id cust_staff_id
      FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id
      WHERE a.date=? AND a.status='booked' ORDER BY a.time`).all(tomorrow)) {
    out.appointments.push({ ...a, ref: String(a.id), done: a.customer_id ? isDone(a.customer_id, 'appointment', String(a.id)) : false });
  }
  // Khách hủy / không đến trong 14 ngày qua, chưa có lịch mới → mời đặt lại
  const hasNew = db.prepare("SELECT 1 FROM appointments WHERE customer_id=? AND id<>? AND date>=? AND status IN ('booked','arrived')");
  for (const a of db.prepare(`SELECT a.*, COALESCE(c.name,a.guest_name) name, COALESCE(c.phone,a.guest_phone) phone, u.full_name staff_name, cb.full_name cancelled_by_name, c.staff_id cust_staff_id
      FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id LEFT JOIN users cb ON cb.id=a.cancelled_by
      WHERE a.status IN ('cancelled','noshow') AND a.date>=? ORDER BY a.date DESC, a.time DESC`).all(addDays(t, -14))) {
    if (a.customer_id && hasNew.get(a.customer_id, a.id, t)) continue;
    out.cancels.push({ ...a, ref: String(a.id), done: !!a.followup_at });
  }
  out.counts = {
    birthdays: out.birthdays.filter((x) => !x.done).length,
    cards: out.cards.filter((x) => !x.done).length,
    returns: out.returns.filter((x) => !x.done).length,
    appointments: out.appointments.filter((x) => !x.done).length,
    cancels: out.cancels.filter((x) => !x.done).length,
  };
  return out;
}

// Báo cáo khách phụ trách theo thợ (KPI giữ khách)
function staffCustomerReport(from, to) {
  const rd = Number(getSettings().return_days || 30);
  const t = today();
  const users = db.prepare("SELECT id, full_name, active FROM users WHERE role<>'owner' OR id IN (SELECT DISTINCT staff_id FROM customers WHERE staff_id IS NOT NULL) ORDER BY id").all();
  // Mỗi khách: số lượt, lần đầu, lần cuối (tính đến 'to'); lượt + chi tiêu trong kỳ
  const rows = db.prepare(`SELECT c.id, c.staff_id,
      COUNT(v.id) n, MIN(v.date) first_date, MAX(v.date) last_date,
      SUM(CASE WHEN v.date BETWEEN ? AND ? THEN 1 ELSE 0 END) n_period,
      SUM(CASE WHEN v.date BETWEEN ? AND ? THEN v.total ELSE 0 END) spend_period,
      SUM(CASE WHEN v.date BETWEEN ? AND ? AND v.main_staff_id=c.staff_id THEN 1 ELSE 0 END) own_period
    FROM customers c LEFT JOIN visits v ON v.customer_id=c.id AND v.status='done' AND v.date<=?
    WHERE c.deleted=0 GROUP BY c.id`).all(from, to, from, to, from, to, to);
  const per = new Map();
  const blank = (id, name, active) => ({ staff_id: id, name, active, customers: 0, visited: 0, returned: 0, active_period: 0, new_period: 0,
    visits_period: 0, own_visits_period: 0, spend_period: 0, overdue: 0 });
  for (const u of users) per.set(u.id, blank(u.id, u.full_name, u.active));
  const none = blank(null, 'Chưa giao thợ', 1);
  const due = addDays(t, -rd);
  for (const r of rows) {
    const p = (r.staff_id && per.get(r.staff_id)) || none;
    p.customers++;
    if (r.n >= 1) p.visited++;
    if (r.n >= 2) p.returned++;
    if (r.n_period > 0) { p.active_period++; p.visits_period += r.n_period; p.own_visits_period += r.own_period; p.spend_period += r.spend_period || 0; }
    if (r.first_date && r.first_date >= from && r.first_date <= to) p.new_period++;
    if (r.last_date && r.last_date <= due) p.overdue++;
  }
  const out = [...per.values(), none].filter((p) => p.customers > 0 || (p.active && p.staff_id));
  for (const p of out) {
    p.return_rate = p.visited ? p.returned / p.visited : null;
    p.avg_spend = p.active_period ? Math.round(p.spend_period / p.active_period) : 0;
  }
  return { from, to, return_days: rd, rows: out };
}

module.exports = {
  staffCustomerReport,
  HttpError, bad, int, str, today, addDays, addMonths, isDate, normPhone, localDate,
  cardBalance, cardRow, sellCard, saveVisit, deleteVisit, getVisit, maskVisitMoney, canEditVisit,
  salesReport, reminders, nextBirthday,
};
