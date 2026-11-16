'use strict';
// "Cả nhà / đi cùng" trong 1 ngày: gom các lịch hẹn cùng gia đình (đã gắn người nhà) hoặc tên có quan hệ
// ("cháu Nhung", "c gái Nhung" → nhóm của "Nhung"), để thợ xem chung và Lãnh đạo chia lại tiền nhanh.
const { db, audit, nextCode } = require('./db');
const L = require('./logic');
const family = require('./family');
const { HttpError } = L;

const vcols = db.prepare('PRAGMA table_info(visits)').all().map((c) => c.name);
// Hóa đơn nhập từ sổ đã được sửa tay → lần đồng bộ sổ sau không ghi đè
if (!vcols.includes('manual_edit')) db.exec('ALTER TABLE visits ADD COLUMN manual_edit INTEGER NOT NULL DEFAULT 0');

const UNKNOWN = /^Chưa rõ dịch vụ/;
const SHORT = new Set(['c', 'a', 'e', 'chi', 'anh', 'em', 'co', 'chu', 'bac', 'b', 'be', 'kh', 'khach']);
function personKey(name) {
  const w = family.core(name).split(' ').filter(Boolean);
  while (w.length > 1 && SHORT.has(w[0])) w.shift();
  return w.slice(0, 3).join(' ');
}
function anchorOf(name) {
  const p = family.parseRelation(name);
  return p ? { key: p.target, rel: p.rel } : { key: personKey(name), rel: null };
}

// Gắn a.grp = số người trong nhóm (≥2) và a.grp_id cho danh sách lịch (cùng 1 ngày hoặc nhiều ngày)
function tag(appts) {
  const live = appts.filter((a) => !['cancelled', 'noshow'].includes(a.status));
  if (!live.length) return appts;
  const ids = [...new Set(live.map((a) => a.customer_id).filter(Boolean))];
  const fam = new Map(ids.length ? db.prepare(`SELECT id, family_id FROM customers WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => [r.id, r.family_id]) : []);
  const parent = live.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { parent[find(i)] = find(j); };
  const byKey = new Map();
  live.forEach((a, i) => {
    const an = anchorOf(a.name || a.guest_name || '');
    a._an = an;
    const keys = [];
    const fid = a.customer_id && fam.get(a.customer_id);
    if (fid) keys.push(`${a.date}|f${fid}`);
    if (an.key && an.key.length >= 2) keys.push(`${a.date}|n${an.key}`);
    for (const k of keys) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); }
  });
  for (const [k, list] of byKey) {
    if (list.length < 2) continue;
    // Cùng tên gốc mà không ai ghi quan hệ ("C Lan" + "C Lan") → có thể là 2 người khác nhau, không gom
    if (k.includes('|n') && !list.some((i) => live[i]._an.rel)) continue;
    for (const i of list.slice(1)) union(list[0], i);
  }
  const size = new Map();
  live.forEach((_, i) => size.set(find(i), (size.get(find(i)) || 0) + 1));
  live.forEach((a, i) => { const r = find(i); if (size.get(r) > 1) { a.grp = size.get(r); a.grp_id = live[r].id; } delete a._an; });
  return appts;
}

const apptRows = (date) => db.prepare(`SELECT a.*, COALESCE(c.name,a.guest_name) name, c.relation, c.family_id, u.full_name staff_name
  FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id WHERE a.date=? ORDER BY a.time, a.id`).all(date);

function members(apptId) {
  const a = db.prepare('SELECT id, date FROM appointments WHERE id=?').get(apptId);
  if (!a) throw new HttpError(404, 'Không tìm thấy lịch hẹn');
  const rows = tag(apptRows(a.date));
  const me = rows.find((r) => r.id === apptId);
  if (!me.grp) return [me];
  return rows.filter((r) => r.grp_id === me.grp_id);
}

// Người "gốc" của nhóm: người không ghi quan hệ (vd "Nhung"), nếu không có thì người đầu tiên
function rootOf(list) {
  const an = list.map((r) => ({ r, an: anchorOf(r.name || '') }));
  const base = an.find((x) => !x.an.rel && an.some((y) => y.an.rel && y.an.key === x.an.key));
  return (base || an.find((x) => !x.an.rel) || an[0]).r;
}

function group(apptId, user) {
  const list = members(apptId);
  const root = rootOf(list);
  const rootKey = anchorOf(root.name || '').key;
  const rows = list.map((a) => {
    const an = anchorOf(a.name || '');
    let v = a.visit_id ? L.getVisit(a.visit_id) : null;
    if (v && v.status !== 'done') v = null;
    if (v) v = L.maskVisitMoney(v, user);
    return {
      id: a.id, time: a.time, status: a.status, staff_id: a.staff_id, staff_name: a.staff_name, assistant_id: a.assistant_id,
      name: a.name, customer_id: a.customer_id, family_id: a.family_id, note: a.note, pay_note: a.pay_note, service: a.service,
      is_root: a.id === root.id, relation: a.relation || (an.rel ? `${an.rel}${an.key === rootKey ? '' : ' ' + an.key}` : null),
      visit: v ? { id: v.id, code: v.code, total: v.total, masked: !!v.masked, payment_method: v.payment_method, main_staff_id: v.main_staff_id,
        items: v.items.map((i) => ({ id: i.id, name: i.name, price: i.price, unknown: UNKNOWN.test(i.name) })) } : null,
    };
  });
  const fids = new Set(rows.map((r) => r.family_id));
  const linked = rows.every((r) => r.customer_id) && fids.size === 1 && !fids.has(null);
  const anyMasked = rows.some((r) => r.visit && r.visit.masked);
  const total = anyMasked ? null : rows.reduce((t, r) => t + (r.visit ? r.visit.total : 0), 0);
  const unknown = anyMasked ? null : rows.reduce((t, r) => t + (r.visit ? r.visit.items.filter((i) => i.unknown).reduce((s, i) => s + i.price, 0) : 0), 0);
  return { date: list[0].date, root_id: root.id, linked, total, unknown, rows };
}

// Lịch của khách vãng lai → tạo/nhận hồ sơ khách (giống bấm Thu tiền)
function ensureCustomer(apptId, user) {
  const a = db.prepare('SELECT * FROM appointments WHERE id=?').get(apptId);
  if (a.customer_id) return a.customer_id;
  const phone = L.normPhone(a.guest_phone);
  let c = phone ? db.prepare('SELECT id FROM customers WHERE phone=? AND deleted=0').get(phone) : null;
  if (!c) {
    const code = nextCode('customers', 'KH', 4);
    const id = db.prepare('INSERT INTO customers(code,name,phone,source,created_by) VALUES (?,?,?,?,?)')
      .run(code, String(a.guest_name || 'Khách lẻ').trim(), phone && /^0\d{9,10}$/.test(phone) ? phone : null, 'Đặt lịch', user.id).lastInsertRowid;
    audit(user.id, 'create_customer', 'customer', id, { code, from_appointment: apptId });
    c = { id };
  }
  db.prepare('UPDATE appointments SET customer_id=?, guest_name=NULL, guest_phone=NULL WHERE id=?').run(c.id, apptId);
  return c.id;
}

// Gắn cả nhóm thành 1 gia đình: "cháu Nhung" → cháu của Nhung…
function linkAll(apptId, user) {
  const list = members(apptId);
  if (list.length < 2) throw new HttpError(400, 'Lịch này không có người đi cùng');
  const root = rootOf(list);
  const rootKey = anchorOf(root.name || '').key;
  const rootCust = ensureCustomer(root.id, user);
  let n = 0;
  db.transaction(() => {
    for (const a of list) {
      if (a.id === root.id) continue;
      const cid = ensureCustomer(a.id, user);
      if (cid === rootCust) continue;
      const an = anchorOf(a.name || '');
      const has = db.prepare('SELECT relation, family_id FROM customers WHERE id=?').get(cid);
      const fr = db.prepare('SELECT family_id FROM customers WHERE id=?').get(rootCust).family_id;
      if (fr && has.family_id === fr) continue;
      family.link(rootCust, cid, has.relation ? null : an.rel && an.key === rootKey ? an.rel : 'đi cùng');
      n++;
    }
  })();
  audit(user.id, 'update_customer', 'customer', rootCust, { family_group_from_appointment: apptId, linked: n });
  return n;
}

const visitBody = (v) => ({
  customer_id: v.customer_id, date: v.date, time: v.time, main_staff_id: v.main_staff_id, assistant_id: v.assistant_id,
  items: v.items.map((i) => ({ service_id: i.service_id, name: i.name, grp: i.grp, price: i.price, material_id: i.material_id, qty: i.qty, staff_id: i.staff_id, assistant_id: i.assistant_id })),
  surcharge: v.surcharge, discount: v.discount, discount_reason: v.discount_reason, card_id: v.card_id, card_paid: v.card_paid,
  payment_method: v.payment_method, tip: v.tip, tip_private: v.tip_private, tip_private_to: v.tip_private_to,
  hair_before: v.hair_before, wish: v.wish, formula: v.formula, result: v.result, note: v.note, next_visit_date: v.next_visit_date,
});

// Chia khoản "Chưa rõ dịch vụ" sang dịch vụ thật của đúng người (chỉ Lãnh đạo). Tổng tiền cả nhóm không đổi.
function moveAmount(input, user) {
  const itemId = Number(input.item_id);
  const it = db.prepare('SELECT * FROM visit_items WHERE id=?').get(itemId);
  if (!it) throw new HttpError(404, 'Không tìm thấy dòng tiền cần chia');
  const from = L.getVisit(it.visit_id);
  if (!from || from.status !== 'done') throw new HttpError(404, 'Không tìm thấy hóa đơn');
  const amount = Math.round(Number(input.amount) || 0);
  if (!(amount > 0)) throw new HttpError(400, 'Nhập số tiền cần chia');
  if (amount > it.price) throw new HttpError(400, `Dòng này chỉ có ${it.price.toLocaleString('vi-VN')}đ`);
  const svc = input.service_id ? db.prepare('SELECT * FROM services WHERE id=?').get(Number(input.service_id)) : null;
  const name = (svc && svc.name) || String(input.name || '').trim() || 'Dịch vụ';
  const newItem = { service_id: svc ? svc.id : null, name, grp: svc ? svc.grp : 'Khác', price: amount };
  const to = db.prepare('SELECT * FROM appointments WHERE id=?').get(Number(input.to_appointment_id));
  if (!to) throw new HttpError(404, 'Chọn người nhận khoản tiền');
  const toVisit = to.visit_id ? db.prepare("SELECT id FROM visits WHERE id=? AND status='done'").get(to.visit_id) : null;
  const save = (body, ex) => {
    const id = L.saveVisit(body, user, ex, { imported: !!(ex && ex.import_ref) || !body.payment_method });
    db.prepare('UPDATE visits SET manual_edit=1 WHERE id=?').run(id);
    return id;
  };
  return db.transaction(() => {
    const fb = visitBody(from);
    const idx = from.items.findIndex((i) => i.id === itemId);
    if (it.price - amount > 0) fb.items[idx].price = it.price - amount; else fb.items.splice(idx, 1);
    if (toVisit && toVisit.id === from.id) fb.items.push(newItem);
    if (!fb.items.length) throw new HttpError(400, 'Hóa đơn phải còn ít nhất 1 dịch vụ');
    const newTotal = fb.items.reduce((s, i) => s + i.price, 0) + (fb.surcharge || 0) - (fb.discount || 0);
    if (newTotal < 0) throw new HttpError(400, 'Giảm giá lớn hơn tiền còn lại, sửa hóa đơn trực tiếp');
    if (fb.card_paid > newTotal) fb.card_paid = newTotal;
    save(fb, from);
    let toId = from.id;
    if (!toVisit || toVisit.id !== from.id) {
      if (toVisit) {
        const tv = L.getVisit(toVisit.id);
        const tb = visitBody(tv);
        tb.items.push(newItem);
        if (!tb.payment_method) tb.payment_method = from.payment_method;
        toId = save(tb, tv);
      } else {
        const cid = ensureCustomer(to.id, user);
        toId = save({ customer_id: cid, date: to.date, time: to.time, main_staff_id: to.staff_id || from.main_staff_id, assistant_id: to.assistant_id || null,
          items: [newItem], payment_method: from.payment_method, appointment_id: to.id, note: `Chia từ hóa đơn ${from.code} (đi cùng)` }, null);
        if (from.payment_method) db.prepare('UPDATE appointments SET pay_note=COALESCE(pay_note,?) WHERE id=?').run(from.payment_method, to.id);
      }
    }
    audit(user.id, 'family_split', 'visit', from.id, { code: from.code, amount, to_visit: toId, service: name });
    return toId;
  })();
}

module.exports = { tag, group, linkAll, moveAmount, personKey, anchorOf };
