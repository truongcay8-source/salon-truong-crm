'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-test-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.SEED_PASSWORD = 'tam12345';
const { app } = require('../server/index');
const { db } = require('../server/db');

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return { cookie: () => cookie, call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), put: (p, b) => call('PUT', p, b), del: (p, b) => call('DELETE', p, b) };
}
async function login(username) {
  const c = client();
  let r = await c.post('/login', { username, password: 'tam12345' });
  assert.equal(r.status, 200);
  r = await c.get('/customers');
  assert.equal(r.status, 403, 'phải đổi mật khẩu trước');
  r = await c.post('/me/password', { old_password: 'tam12345', new_password: 'moi-' + username });
  assert.equal(r.status, 200);
  return c;
}
test('người nhà: gắn, tìm 1 người ra cả nhà, gợi ý từ tên, gỡ', async () => {
  const F = require('../server/family');
  assert.deepEqual(F.parseRelation('Phương (vợ Khánh)'), { rel: 'vợ', target: 'khanh' });
  assert.deepEqual(F.parseRelation('c gái Nhung'), { rel: 'chị', target: 'nhung' });
  assert.equal(F.parseRelation('Quỳnh Anh'), null);
  assert.equal(F.parseRelation('Châu Anh'), null);
  const o = await login('vinh');
  const k = (await o.post('/customers', { name: 'Khánh', phone: '0911000111' })).data.id;
  const p = (await o.post('/customers', { name: 'Phương (vợ Khánh)' })).data.id;
  const a = (await o.post('/customers', { name: 'Alex', phone: '0911000222' })).data.id;
  let r = await o.get('/family/suggest');
  const sg = r.data.find((x) => x.id === p);
  assert.ok(sg && sg.candidates[0].id === k && sg.relation === 'vợ');
  assert.equal((await o.post(`/customers/${k}/family`, { other_id: p, relation: 'vợ' })).status, 200);
  assert.equal((await o.post(`/customers/${p}/family`, { other_id: a, relation: 'con' })).status, 200);
  r = await o.get(`/customers/${k}`);
  assert.deepEqual(r.data.family.map((m) => m.name).sort(), ['Alex', 'Phương (vợ Khánh)']);
  assert.ok(!(await o.get('/family/suggest')).data.some((x) => x.id === p), 'đã gắn thì hết gợi ý');
  r = await o.get('/customers?q=0911000222');
  assert.deepEqual(r.data.rows.map((x) => x.name).sort(), ['Alex', 'Khánh', 'Phương (vợ Khánh)'].sort(), 'tìm SĐT 1 người ra cả nhà');
  assert.equal(r.data.rows[0].name, 'Alex', 'người khớp đứng đầu');
  r = await o.get(`/customers/${a}/brief`);
  assert.equal(r.data.family.length, 2);
  assert.equal((await o.del(`/customers/${a}/family`)).status, 200);
  assert.equal((await o.get(`/customers/${k}`)).data.family.length, 1);
  assert.equal((await o.post(`/customers/${k}/family`, { other_id: k })).status, 400);
});

test('cả nhà trong ngày: gom lịch "cháu Nhung", gắn gia đình, Lãnh đạo chia khoản chưa rõ (tổng giữ nguyên)', async () => {
  const c = client();
  let r = await c.post('/login', { username: 'vinh', password: 'moi-vinh' });
  assert.equal(r.status, 200);
  const d = '2026-11-15';
  const svc = db.prepare('SELECT id FROM services WHERE active=1 ORDER BY id LIMIT 1').get().id;
  const n = (await c.post('/customers', { name: 'Nhung', phone: '0948000111' })).data.id;
  const mk = (b) => db.prepare("INSERT INTO appointments(customer_id,guest_name,staff_id,date,time,status,created_by) VALUES (?,?,?,?,?,?,1)").run(b.cid || null, b.guest || null, b.staff, d, b.time, 'booked').lastInsertRowid;
  const a1 = mk({ cid: n, staff: 2, time: '17:30' });
  const a2 = mk({ guest: 'cháu Nhung', staff: 3, time: '17:30' });
  const a3 = mk({ guest: 'c gái Nhung', staff: 2, time: '18:00' });
  const a4 = mk({ guest: 'C Lan', staff: 3, time: '18:00' });
  r = await c.post('/visits', { customer_id: n, date: d, time: '17:30', main_staff_id: 2, appointment_id: a1, payment_method: 'Chuyển khoản',
    items: [{ service_id: svc, price: 100000 }, { name: 'Chưa rõ dịch vụ (sổ thu thêm)', price: 340000 }] });
  assert.equal(r.status, 200);
  const list = (await c.get(`/appointments?from=${d}`)).data;
  assert.equal(list.find((a) => a.id === a2).grp, 3);
  assert.ok(!list.find((a) => a.id === a4).grp, 'C Lan không phải người nhà');
  let g = (await c.get(`/appointments/${a3}/group`)).data;
  assert.equal(g.root_id, a1); assert.equal(g.total, 440000); assert.equal(g.unknown, 340000); assert.equal(g.linked, false);
  r = await c.post(`/appointments/${a2}/group/link`);
  assert.equal(r.data.linked, 2); assert.ok(r.data.group.linked);
  assert.match(r.data.group.rows.find((x) => x.id === a2).relation, /cháu của Nhung/);
  const item = () => (g.rows.find((x) => x.id === a1).visit.items.find((i) => i.unknown) || {}).id;
  g = (await c.post(`/appointments/${a1}/group/split`, { item_id: item(), to_appointment_id: a3, service_id: svc, amount: 100000 })).data;
  g = (await c.post(`/appointments/${a1}/group/split`, { item_id: item(), to_appointment_id: a2, name: 'Gội', amount: 240000 })).data;
  assert.equal(g.total, 440000); assert.equal(g.unknown, 0);
  assert.equal(g.rows.find((x) => x.id === a3).visit.total, 100000);
  assert.equal(g.rows.find((x) => x.id === a2).visit.total, 240000);
  assert.equal(g.rows.find((x) => x.id === a1).visit.total, 100000);
  assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(a2).status, 'done');
  // Quản lý (không phải Lãnh đạo) không chia tiền được
  const m = db.prepare("SELECT username FROM users WHERE role='manager' LIMIT 1").get();
  if (m) {
    const mc = client(); await mc.post('/login', { username: m.username, password: 'tam12345' });
    await mc.post('/me/password', { old_password: 'tam12345', new_password: 'moi-' + m.username });
    await mc.post('/login', { username: m.username, password: 'moi-' + m.username });
    assert.equal((await mc.post(`/appointments/${a1}/group/split`, { item_id: 1, to_appointment_id: a2, amount: 1000 })).status, 403);
  }
});

test('từng dòng dịch vụ chọn người làm: doanh số + hoa hồng dòng đó tính cho người làm', async () => {
  const c = client();
  assert.equal((await c.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const L = require('../server/logic');
  db.prepare('UPDATE users SET commission_enabled=1 WHERE id IN (2,4)').run();
  const svc = db.prepare("SELECT id, commission_rate FROM services WHERE active=1 AND commission_rate>0 ORDER BY id LIMIT 1").get();
  const cid = (await c.post('/customers', { name: 'Khách test dòng', phone: '0912345999' })).data.id;
  const d = '2026-11-20';
  const before = L.salesReport(d, d, { role: 'owner' }).rows;
  const r = await c.post('/visits', { customer_id: cid, date: d, time: '10:00', main_staff_id: 2, payment_method: 'Tiền mặt',
    items: [{ service_id: svc.id, price: 200000 }, { service_id: svc.id, price: 100000, staff_id: 4 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const it = r.data.items.find((i) => i.staff_id === 4);
  assert.ok(it && it.staff_name, 'dòng ghi người làm');
  assert.equal(it.commission, Math.round(100000 * svc.commission_rate));
  assert.equal(r.data.main_commission, Math.round(200000 * svc.commission_rate));
  const rows = L.salesReport(d, d, { role: 'owner' }).rows;
  const g = (rows, id) => rows.find((x) => x.user_id === id) || { sales: 0, main_commission: 0 };
  assert.equal(g(rows, 4).sales - g(before, 4).sales, 100000);
  assert.equal(g(rows, 2).sales - g(before, 2).sales, 200000);
  assert.equal(g(rows, 4).main_commission - g(before, 4).main_commission, it.commission);
  // chọn lại đúng thợ chính → coi như thợ chính
  const r2 = await c.put('/visits/' + r.data.id, { ...r.data, items: [{ service_id: svc.id, price: 300000, staff_id: 2 }] });
  assert.equal(r2.data.items[0].staff_id, null);
});

test('sửa số tiền thẻ đã bán (ghi nhầm 20tr → 2tr): chỉ Lãnh đạo, số dư + hoa hồng tính lại', async () => {
  const c = client();
  assert.equal((await c.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const cid = (await c.post('/customers', { name: 'Khách thẻ nhầm', phone: '0912888777' })).data.id;
  const card = (await c.post('/cards', { customer_id: cid, price: 20000000, value: 20000000, sale_type: 'renewal', payment_method: 'Tiền mặt', seller_id: 2 })).data;
  db.prepare('INSERT INTO card_txns(card_id,amount,note,created_by) VALUES (?,?,?,1)').run(card.id, -300000, 'dùng thử');
  let r = await c.put(`/cards/${card.id}/sale`, { price: 2000000, value: 2000000 });
  assert.equal(r.status, 400, 'bắt ghi lý do');
  r = await c.put(`/cards/${card.id}/sale`, { price: 2000000, value: 2000000, reason: 'ghi nhầm 20tr' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.balance, 1700000);
  const rate = Number(db.prepare("SELECT value FROM settings WHERE key='card_renewal_rate'").get()?.value || 0);
  if (db.prepare('SELECT commission_enabled FROM users WHERE id=2').get().commission_enabled) assert.equal(r.data.commission, Math.round(2000000 * rate));
  assert.equal((await c.put(`/cards/${card.id}/sale`, { value: 200000, reason: 'x' })).status, 400, 'không nhỏ hơn phần đã dùng');
  const t = client(); await t.post('/login', { username: 'truong', password: 'tam12345' });
  await t.post('/me/password', { old_password: 'tam12345', new_password: 'moi-truong' }); await t.post('/login', { username: 'truong', password: 'moi-truong' });
  assert.equal((await t.put(`/cards/${card.id}/sale`, { price: 1, reason: 'x' })).status, 403);
});

test('từng dòng có người phụ riêng: hoa hồng phụ tính theo dòng', async () => {
  const c = client();
  assert.equal((await c.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  db.prepare('UPDATE users SET commission_enabled=1 WHERE id IN (2,3,4,5)').run();
  const rate = Number(db.prepare("SELECT value FROM settings WHERE key='assistant_rate'").get().value);
  const svc = db.prepare("SELECT id FROM services WHERE active=1 AND grp<>'Hóa chất' AND commission_rate>=? ORDER BY id LIMIT 1").get(rate).id;
  const cid = (await c.post('/customers', { name: 'Khách phụ dòng', phone: '0912777666' })).data.id;
  const r = await c.post('/visits', { customer_id: cid, date: '2026-11-21', time: '13:30', main_staff_id: 2, assistant_id: 4, payment_method: 'Tiền mặt',
    items: [{ service_id: svc, price: 600000 }, { service_id: svc, price: 1000000, staff_id: 3, assistant_id: 5 }, { service_id: svc, price: 400000, assistant_id: 0 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.assistant_commission, Math.round(600000 * rate), 'người phụ chung chỉ ăn dòng theo phiếu');
  const l2 = r.data.items[1];
  assert.equal(l2.assistant_id, 5); assert.equal(l2.asst_commission, Math.round(1000000 * rate)); assert.equal(l2.assistant_name.length > 0, true);
  assert.equal(r.data.items[2].assistant_id, 0);
  const rows = require('../server/logic').salesReport('2026-11-21', '2026-11-21', { role: 'owner' }).rows;
  assert.equal(rows.find((x) => x.user_id === 5).assistant_commission, Math.round(1000000 * rate));
  assert.equal(rows.find((x) => x.user_id === 4).assistant_commission, Math.round(600000 * rate));
});

test('khách định kỳ (2 tuần/lần, gọi trước hỏi giờ) + cắt của thợ không áp bảo hành', async () => {
  const c = client();
  assert.equal((await c.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const L = require('../server/logic');
  const t = L.today();
  const cid = (await c.post('/customers', { name: 'A Minh PH test', phone: '0912000333', cycle_days: 14, cycle_call: '1', cycle_note: 'gọi sau 10h' })).data.id;
  const cut = db.prepare("SELECT id FROM services WHERE grp='Cắt' AND active=1 AND name LIKE '%nam%' LIMIT 1").get();
  await c.post('/visits', { customer_id: cid, date: L.addDays(t, -13), time: '10:00', main_staff_id: 2, payment_method: 'Tiền mặt', items: [{ service_id: cut.id, price: 100000 }] });
  let r = (await c.get('/reminders')).data;
  const x = r.cycles.find((y) => y.id === cid);
  assert.ok(x, JSON.stringify(r.cycles)); assert.equal(x.cycle_call, 1); assert.equal(x.due, L.addDays(t, 1));
  assert.ok(!r.returns.some((y) => y.id === cid));
  // Trường không áp bảo hành chỉnh form cắt; Dương vẫn có
  const v2 = (await c.post('/visits', { customer_id: cid, date: t, time: '11:00', main_staff_id: 3, payment_method: 'Tiền mặt', items: [{ service_id: cut.id, price: 100000 }] })).data;
  assert.ok(v2.warranties.some((w) => /^cut/.test(w.key)), 'Dương cắt có bảo hành');
  const v3 = (await c.post('/visits', { customer_id: cid, date: t, time: '12:00', main_staff_id: 2, payment_method: 'Tiền mặt', items: [{ service_id: cut.id, price: 100000 }] })).data;
  assert.ok(!v3.warranties.some((w) => /^cut/.test(w.key)), 'Trường cắt không lưu ý bảo hành');
  r = (await c.get('/reminders')).data;
  assert.ok(!r.cycles.some((y) => y.id === cid), 'đã làm hôm nay → hết nhắc');
});

test('thẻ tri ân chỉ dùng 1 lần: dùng chưa hết cũng đóng; xóa lượt thì mở lại; dọn trùng không làm thẻ "hoàn" lại', async () => {
  const c = client();
  assert.equal((await c.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const L = require('../server/logic'); const I = require('../server/importer');
  const svc = db.prepare("SELECT id FROM services WHERE active=1 ORDER BY id LIMIT 1").get();
  const cid = (await c.post('/customers', { name: 'Khách tri ân', phone: '0912000111' })).data.id;
  const card = (await c.post('/cards', { customer_id: cid, price: 0, value: 1000000 })).data;
  assert.equal(card.sale_type, 'gift');
  const r = await c.post('/visits', { customer_id: cid, date: '2026-11-21', time: '10:00', main_staff_id: 2, card_id: card.id, card_paid: 600000,
    items: [{ service_id: svc.id, price: 600000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let k = db.prepare('SELECT status FROM cards WHERE id=?').get(card.id);
  assert.equal(k.status, 'closed'); assert.equal(L.cardBalance(card.id), 0);
  // sửa lại lượt vẫn dùng được thẻ đã đóng của chính lượt đó
  const r2 = await c.put('/visits/' + r.data.id, { ...r.data, card_id: card.id, card_paid: 500000, payment_method: 'Tiền mặt', items: [{ service_id: svc.id, price: 700000 }] });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.card_paid, 500000); assert.equal(L.cardBalance(card.id), 0);
  // xóa lượt → thẻ mở lại đủ 1tr
  assert.equal((await c.del('/visits/' + r.data.id, { reason: 'test' })).status, 200);
  assert.equal(L.cardBalance(card.id), 1000000);
  assert.equal(db.prepare('SELECT status FROM cards WHERE id=?').get(card.id).status, 'active');
  // bản cũ: dọn trùng xóa lượt có trừ thẻ, lượt giữ lại không trừ → sửa lại
  const a = await c.post('/visits', { customer_id: cid, date: '2026-11-22', time: '11:00', main_staff_id: 2, card_id: card.id, card_paid: 1000000, items: [{ service_id: svc.id, price: 1200000 }], payment_method: 'Tiền mặt' });
  const b = await c.post('/visits', { customer_id: cid, date: '2026-11-22', time: '11:00', main_staff_id: 2, items: [{ service_id: svc.id, price: 1200000 }], payment_method: 'Tiền mặt', force: true });
  L.deleteVisit(a.data.id, 'Trùng: ô sổ đặt lịch bị sửa chữ nên nhập 2 lần (giữ lượt ' + b.data.id + ')', { id: 1 });
  assert.equal(L.cardBalance(card.id), 1000000, 'lỗi cũ: thẻ như chưa dùng');
  I.closeUsedGifts();
  const kept = db.prepare('SELECT card_id, card_paid, cash_paid FROM visits WHERE id=?').get(b.data.id);
  assert.equal(kept.card_id, card.id); assert.equal(kept.card_paid, 1000000); assert.equal(kept.cash_paid, 200000);
  assert.equal(L.cardBalance(card.id), 0);
  I.closeUsedGifts(); assert.equal(db.prepare('SELECT COUNT(*) n FROM card_txns WHERE card_id=?').get(card.id).n, 1, 'chạy lại không trừ 2 lần');
});

test('sổ đặt lịch: đuôi SĐT ghi cạnh tên không bị đọc thành tiền', () => {
  const BM = require('../server/bookmoney');
  const svcs = db.prepare('SELECT * FROM services').all();
  const p = BM.parseEntry('Bảo 2772(Thu) 685 voucher 0933982772', { level: 'Director' }, (n) => svcs.find((s) => s.name === n), svcs);
  assert.equal(p.explicit, 685000);
});

test('thẻ tri ân: hoa hồng % vẫn đủ, nhưng tách khỏi doanh số tính thưởng; bóc theo nhóm dịch vụ', async () => {
  const c = client();
  assert.equal((await c.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const L = require('../server/logic');
  const cut = db.prepare("SELECT id, grp FROM services WHERE active=1 AND grp='Cắt' ORDER BY id LIMIT 1").get();
  const chem = db.prepare("SELECT id, grp FROM services WHERE active=1 AND grp='Hóa chất' ORDER BY id LIMIT 1").get();
  const cid = (await c.post('/customers', { name: 'Khách tri ân 2', phone: '0912000222' })).data.id;
  const card = (await c.post('/cards', { customer_id: cid, price: 0, value: 1000000 })).data;
  const d = '2026-11-25';
  const before = L.salesReport(d, d, { role: 'owner' });
  const r = await c.post('/visits', { customer_id: cid, date: d, time: '10:00', main_staff_id: 2, card_id: card.id, card_paid: 1000000, payment_method: 'Tiền mặt',
    items: [{ service_id: cut.id, price: 500000 }, { service_id: chem.id, price: 1500000, staff_id: 4 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rep = L.salesReport(d, d, { role: 'owner' });
  const g = (x, id) => x.rows.find((y) => y.user_id === id) || { sales: 0, gift_sales: 0, bonus_sales: 0 };
  assert.equal(g(rep, 2).sales - g(before, 2).sales, 500000);
  assert.equal(g(rep, 2).gift_sales - g(before, 2).gift_sales, 250000);
  assert.equal(g(rep, 4).gift_sales - g(before, 4).gift_sales, 750000);
  assert.equal(g(rep, 4).bonus_sales - g(before, 4).bonus_sales, 750000);
  assert.equal(rep.summary.gift_by_group['Cắt'], 250000);
  assert.equal(rep.summary.gift_by_group['Hóa chất'], 750000);
});

test('sổ: "+tt 2/11 685" là trả nợ ngày trước, không tính doanh số hôm nay; ô chỉ trả nợ không tạo lượt', () => {
  const BM = require('../server/bookmoney');
  const svcs = db.prepare('SELECT * FROM services').all();
  const by = (n) => svcs.find((s) => s.name === n);
  const p = BM.parseEntry('A Quân lợn 0888386666(Thu)685+tt 2/11 685(Thu)', { level: 'Director' }, by, svcs);
  assert.equal(p.explicit, 685000); assert.deepEqual(p.debt, { day: 2, month: 11, amount: 685000 }); assert.equal(p.debtOnly, false);
  const q = BM.parseEntry('c Thảo trả nợ 12/11 785k', { level: 'Director' }, by, svcs);
  assert.equal(q.debtOnly, true);
  const row = { amount: 1370000, entries: [{ text: 'x', parsed: p }] };
  BM.splitRow(row);
  assert.equal(row.entries[0].amount, 685000);
  assert.ok(!(row.entries[0].extraTip > 0), 'tiền trả nợ không thành tip');
});

test('người nhà chủ: tự giảm 50%, không tính DS thưởng; tài khoản không làm dịch vụ ẩn khỏi danh sách thợ', async () => {
  const c = client();
  assert.equal((await c.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const L = require('../server/logic');
  const svc = db.prepare("SELECT id FROM services WHERE active=1 AND price>0 ORDER BY id LIMIT 1").get();
  const cr = await c.post('/customers', { name: 'Người nhà test', phone: '0913777333' });
  assert.equal(cr.status, 200, JSON.stringify(cr.data));
  const cid = cr.data.id;
  const pr = await c.put('/customers/' + cid, { name: 'Người nhà test', phone: '0913777333', owner_family: true });
  assert.equal(pr.status, 200, JSON.stringify(pr.data));
  assert.equal(db.prepare('SELECT owner_family FROM customers WHERE id=?').get(cid).owner_family, 1);
  const d = '2026-11-26';
  const before = L.salesReport(d, d, { role: 'owner' });
  const r = await c.post('/visits', { customer_id: cid, date: d, time: '10:00', main_staff_id: 2, payment_method: 'Tiền mặt', items: [{ service_id: svc.id, price: 400000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.discount, 200000); assert.equal(r.data.total, 200000);
  const rep = L.salesReport(d, d, { role: 'owner' });
  const g = (x) => x.rows.find((y) => y.user_id === 2) || { family_sales: 0, bonus_sales: 0 };
  assert.equal(g(rep).family_sales - g(before).family_sales, 200000);
  assert.equal(g(rep).bonus_sales - g(before).bonus_sales, 0);
  // ẩn tài khoản không làm dịch vụ
  const vinh = db.prepare("SELECT id FROM users WHERE username='vinh'").get();
  const st = (await c.get('/staff')).data.find((u) => u.id === vinh.id);
  assert.equal(st.works, 0);
});

test('gộp lượt: 1 khách làm 2 dịch vụ cùng lúc ở 2 cột thợ → 1 phiếu, dòng ghi người làm, tổng giữ nguyên', () => {
  const L = require('../server/logic'); const I = require('../server/importer');
  const svc = db.prepare("SELECT id FROM services WHERE active=1 AND price>0 ORDER BY id LIMIT 1").get();
  const mk = (name) => db.prepare("INSERT INTO customers(code,name) VALUES (?,?)").run('T' + Math.random().toString(36).slice(2, 8), name).lastInsertRowid;
  const beo = mk('Beo test'), ebeo = mk('e Beo test'), son = mk('E Long test'), bo = mk('Bố Long test');
  const sys = { id: 1, role: 'owner' };
  const v = (cust, staff, price, time, ref) => L.saveVisit({ customer_id: cust, date: '2026-11-27', time, main_staff_id: staff, items: [{ service_id: svc.id, price }], payment_method: 'Tiền mặt', import_ref: ref }, sys, null, { imported: true });
  const a = v(beo, 3, 327000, '11:30', 'SO:t1'), b = v(ebeo, 5, 78000, '11:30', 'SO:t2');
  const x = v(son, 2, 685000, '11:00', 'SO:t3'), y = v(bo, 4, 240000, '11:00', 'SO:t4');
  I.mergeSameVisits();
  const live = db.prepare("SELECT id, total FROM visits WHERE import_ref IN ('SO:t1','SO:t2') AND status='done'").all();
  assert.equal(live.length, 1); assert.equal(live[0].total, 405000);
  const lines = db.prepare('SELECT staff_id FROM visit_items WHERE visit_id=?').all(live[0].id);
  assert.equal(lines.length, 2); assert.ok(lines.some((l) => l.staff_id === 5));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM visits WHERE import_ref IN ('SO:t3','SO:t4') AND status='done'").get().n, 2, 'Bố Long ≠ E Long');
});

test('lỡ tay xóa lượt → Lãnh đạo khôi phục được', async () => {
  const c = client();
  assert.equal((await c.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const svc = db.prepare("SELECT id FROM services WHERE active=1 AND price>0 ORDER BY id LIMIT 1").get();
  const cid = (await c.post('/customers', { name: 'Mây test', phone: '0913777444' })).data.id;
  const r = await c.post('/visits', { customer_id: cid, date: '2026-11-28', time: '10:30', main_staff_id: 3, payment_method: 'Tiền mặt', items: [{ service_id: svc.id, price: 3704000 }] });
  assert.equal((await c.del('/visits/' + r.data.id, { reason: 'lỡ tay' })).status, 200);
  const del = (await c.get('/visits-deleted?from=2026-11-28&to=2026-11-28')).data;
  assert.ok(del.some((v) => v.id === r.data.id));
  assert.equal((await c.post(`/visits/${r.data.id}/restore`)).status, 200);
  const v = db.prepare('SELECT status, total FROM visits WHERE id=?').get(r.data.id);
  assert.equal(v.status, 'done'); assert.equal(v.total, 3704000);
});

test('hồ sơ thừa 0đ trùng người → gộp vào hồ sơ có lượt, giữ SĐT/thẻ/lịch; khác giới không gộp', () => {
  const L = require('../server/logic'); const I = require('../server/importer');
  const svc = db.prepare("SELECT id FROM services WHERE active=1 AND price>0 ORDER BY id LIMIT 1").get();
  const mk = (name, phone) => db.prepare("INSERT INTO customers(code,name,phone) VALUES (?,?,?)").run('O' + Math.random().toString(36).slice(2, 8), name, phone || null).lastInsertRowid;
  const sys = { id: 1, role: 'owner' };
  const bon = mk('E Bon xyz'); L.saveVisit({ customer_id: bon, date: '2026-11-03', time: '15:00', main_staff_id: 2, items: [{ service_id: svc.id, price: 390000 }], payment_method: 'Tiền mặt' }, sys, null, { imported: true });
  const orphan = mk('Em Bon xyz', '0912345111');
  db.prepare("INSERT INTO cards(code,customer_id,name,price,value,sold_at,sale_type,status,created_by) VALUES ('TXYZ',?, 'Thẻ tri ân 1Tr',0,1000000,'2026-11-03','gift','active',1)").run(orphan);
  const man = mk('a Lan xyz'); L.saveVisit({ customer_id: man, date: '2026-11-04', time: '10:00', main_staff_id: 2, items: [{ service_id: svc.id, price: 100000 }], payment_method: 'Tiền mặt' }, sys, null, { imported: true });
  const woman = mk('c Lan xyz');
  I.mergeOrphanCustomers();
  assert.equal(db.prepare('SELECT deleted FROM customers WHERE id=?').get(orphan).deleted, 1);
  assert.equal(db.prepare('SELECT phone FROM customers WHERE id=?').get(bon).phone, '0912345111');
  assert.equal(db.prepare("SELECT customer_id FROM cards WHERE code='TXYZ'").get().customer_id, bon);
  assert.equal(db.prepare('SELECT deleted FROM customers WHERE id=?').get(woman).deleted, 0, 'anh Lan ≠ chị Lan');
});

test('bảng lương: chỉ Lãnh đạo xem; lương cứng theo công, HH từ hóa đơn, bậc thưởng, bù sàn, chốt tháng', async () => {
  const o = client();
  assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const thu = db.prepare("SELECT id FROM users WHERE username='thu'").get().id;
  const svc = db.prepare("SELECT id, commission_rate FROM services WHERE active=1 AND commission_rate>0 ORDER BY id LIMIT 1").get();
  const cid = (await o.post('/customers', { name: 'Khách lương', phone: '0913888555' })).data.id;
  assert.equal((await o.post('/visits', { customer_id: cid, date: '2026-09-10', time: '10:00', main_staff_id: thu, payment_method: 'Tiền mặt', items: [{ service_id: svc.id, price: 10000000 }] })).status, 200);
  let r = await o.put('/payroll/params/' + thu, { base_salary: 5500000, std_days: 26, allowance: 2000000, allowance_label: 'Phụ cấp lễ tân', error_penalty: 200000, kpi_max: 2000000,
    bonus_tiers: [[5000000, 0.02], [20000000, 0.04]], floor_amount: 14000000, floor_until: '2026-12-31', floor_kpi_min: 0.7 });
  assert.equal(r.status, 200);
  assert.equal((await o.put('/payroll/inputs', { month: '2026-09', user_id: thu, days: 13, kpi_pct: 0.5, errors: 2, advance: 1000000 })).status, 200);
  r = await o.get('/payroll?month=2026-09');
  const x = r.data.rows.find((y) => y.user_id === thu);
  assert.equal(x.base, 2750000);
  assert.equal(x.allowance, 1600000);
  assert.equal(x.commission_detail.service, Math.round(10000000 * svc.commission_rate));
  assert.equal(x.bonus, 200000);
  assert.equal(x.kpi, 1000000);
  assert.equal(x.floor_topup, 0, 'KPI 50% < 70% → không bù sàn');
  assert.equal(x.net, x.subtotal - 1000000);
  // Nhân viên / quản lý không xem được
  const t = client();
  assert.equal((await t.post('/login', { username: 'truong', password: 'moi-truong' })).status, 200);
  assert.equal((await t.get('/payroll?month=2026-09')).status, 403);
  const s = await login('thu');
  assert.equal((await s.get('/payroll?month=2026-09')).status, 403);
  assert.equal((await s.put('/payroll/inputs', { month: '2026-09', user_id: thu, plus: 9000000 })).status, 403);
  // Chốt → sửa không được, số giữ nguyên
  assert.equal((await o.post('/payroll/lock', { month: '2026-09' })).status, 200);
  assert.equal((await o.put('/payroll/inputs', { month: '2026-09', user_id: thu, days: 26 })).status, 400);
  r = await o.get('/payroll?month=2026-09');
  assert.ok(r.data.locked);
  assert.equal(r.data.rows.find((y) => y.user_id === thu).net, x.net);
  assert.equal((await o.post('/payroll/lock', { month: '2026-09', lock: false })).status, 200);
});

test('kho: tự điền dung tích hàng thiếu + giá thị trường cho hàng nhập 0đ', () => {
  const St = require('../server/stock');
  const ins = db.prepare("INSERT INTO materials(code,name,kind,unit) VALUES (?,?,'service','Tuýp')");
  const g = ins.run('VT-T1', 'Màu Guytang').lastInsertRowid;
  const a = ins.run('VT-T2', 'Nước pha thuốc nhuộm Activator 20vol – 900ml').lastInsertRowid;
  const k = ins.run('VT-T3', 'Màu Milbon Ordeve test').lastInsertRowid;
  db.prepare("UPDATE materials SET size=60, size_unit='g' WHERE id=?").run(k);
  db.prepare("INSERT INTO stock_moves(material_id,date,qty,unit_cost,kind) VALUES (?,?,?,?,'in')").run(a, '2026-11-01', 2, 0);
  St.fillSizes();
  const mg = db.prepare('SELECT size, size_unit FROM materials WHERE id=?').get(g);
  assert.deepEqual([mg.size, mg.size_unit], [57, 'g']);
  assert.equal(St.avgCost(a), 306000, 'nhập 0đ → lấy giá thị trường');
  assert.equal(db.prepare('SELECT size FROM materials WHERE id=?').get(k).size, 60, 'không ghi đè dung tích đã khai');
});

test('doanh số: bán sản phẩm, bán thẻ, làm phụ tách riêng – không cộng vào DS tính thưởng', async () => {
  const o = client();
  assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const duong = db.prepare("SELECT id FROM users WHERE username='duong'").get().id;
  const cut = db.prepare("SELECT id FROM services WHERE active=1 AND grp='Cắt' AND price>0 ORDER BY id LIMIT 1").get();
  const prod = db.prepare("SELECT id FROM services WHERE grp='Bán sản phẩm' ORDER BY id LIMIT 1").get();
  const cid = (await o.post('/customers', { name: 'Khách tách DS', phone: '0913999666' })).data.id;
  const r = await o.post('/visits', { customer_id: cid, date: '2026-08-12', time: '10:00', main_staff_id: duong, payment_method: 'Tiền mặt',
    items: [{ service_id: cut.id, price: 500000 }, { service_id: prod.id, name: 'Sáp', grp: 'Bán sản phẩm', price: 400000 }] });
  assert.equal(r.status, 200);
  const rep = (await o.get('/reports/sales?from=2026-08-12&to=2026-08-12')).data;
  const x = rep.rows.find((y) => y.user_id === duong);
  assert.equal(x.product_sales, 400000);
  assert.equal(x.service_sales, 500000);
  assert.equal(x.bonus_sales, 500000, 'sản phẩm không vào DS tính thưởng');
});

test('báo cáo tài chính: chỉ Lãnh đạo; lãi/lỗ = doanh thu − giá vốn − lương − chi quỹ − chi phí cố định', async () => {
  const o = client();
  assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const duong = db.prepare("SELECT id FROM users WHERE username='duong'").get().id;
  const chem = db.prepare("SELECT id FROM services WHERE active=1 AND grp='Hóa chất' ORDER BY id LIMIT 1").get();
  const cid = (await o.post('/customers', { name: 'Khách tài chính', phone: '0913999777' })).data.id;
  assert.equal((await o.post('/visits', { customer_id: cid, date: '2026-07-10', time: '10:00', main_staff_id: duong, payment_method: 'Tiền mặt',
    items: [{ service_id: chem.id, price: 1000000 }] })).status, 200);
  // cố định: chỉ tiền nhà 10tr + khấu hao 2tr
  assert.equal((await o.put('/finance/config', { fixed: [{ name: 'Tiền nhà', amount: 10000000, cash: 1 }, { name: 'Khấu hao', amount: 2000000, cash: 0 }], rates: { 'Hóa chất': 0.2 }, open_date: '' })).status, 200);
  assert.equal((await o.post('/finance/items', { month: '2026-07', name: 'Tiền nhà', amount: 12000000 })).status, 200);
  assert.equal((await o.post('/finance/items', { month: '2026-07', name: 'Điện nước', amount: 1500000 })).status, 200);
  const r = (await o.get('/finance?month=2026-07')).data;
  assert.equal(r.revenue.total, 1000000);
  assert.equal(r.cogs.est_total, 200000, 'chưa ghi kho → ước 20%');
  assert.equal(r.fixed.total, 12000000 + 2000000 + 1500000, 'khoản tháng thay khoản mặc định cùng tên');
  assert.equal(r.fixed.depreciation, 2000000);
  assert.equal(r.profit, r.gross - r.payroll.total - r.fund.total - r.fixed.total);
  assert.equal(r.ebitda, r.profit + 2000000);
  assert.ok(r.profit < 0);
  const t = client(); assert.equal((await t.post('/login', { username: 'truong', password: 'moi-truong' })).status, 200);
  assert.equal((await t.get('/finance?month=2026-07')).status, 403);
  assert.equal((await t.post('/finance/items', { month: '2026-07', name: 'x', amount: 1 })).status, 403);
});

test('thu ngân: ai cũng thu được, trả 2 cách, kết ca đếm mù – chỉ Lãnh đạo thấy lệch', async () => {
  const L = require('../server/logic');
  const o = client();
  assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const s = client();
  assert.equal((await s.post('/login', { username: 'thu', password: 'moi-thu' })).status, 200);
  const duong = db.prepare("SELECT id FROM users WHERE username='duong'").get().id;
  const cut = db.prepare("SELECT id FROM services WHERE active=1 AND grp='Cắt' AND price>0 ORDER BY id LIMIT 1").get();
  const cid = (await o.post('/customers', { name: 'Khách thu ngân', phone: '0913999888' })).data.id;
  const today = L.today();
  const ap = (await s.post('/appointments', { customer_id: cid, date: today, time: '23:50', staff_id: duong, service: 'Cắt' })).data.id;
  let b = (await s.get('/pos')).data;
  assert.ok(b.waiting.some((a) => a.id === ap));
  assert.equal(b.cash, undefined, 'nhân viên không thấy tiền két');
  assert.equal((await s.post('/pos/checkin/' + ap)).status, 200);
  b = (await s.get('/pos')).data;
  assert.ok(b.serving.some((a) => a.id === ap));
  // trả 2 cách: 300k tiền mặt chính, 200k CK
  const bad = await s.post('/visits', { customer_id: cid, date: today, time: '23:50', main_staff_id: duong, appointment_id: ap, payment_method: 'Tiền mặt', pay2_method: 'Tiền mặt', pay2_amount: 200000, items: [{ service_id: cut.id, price: 500000 }] });
  assert.equal(bad.status, 400, 'cách 2 phải khác cách chính');
  const r = await s.post('/visits', { customer_id: cid, date: today, time: '23:50', main_staff_id: duong, appointment_id: ap, payment_method: 'Tiền mặt', pay2_method: 'Chuyển khoản', pay2_amount: 200000, tip: 50000, items: [{ service_id: cut.id, price: 500000 }] });
  assert.equal(r.status, 200);
  b = (await s.get('/pos')).data;
  assert.ok(b.paid.some((a) => a.id === ap));
  const rep = (await o.get(`/reports/sales?from=${today}&to=${today}`)).data;
  assert.ok(rep.summary.by_method['Chuyển khoản'] >= 200000);
  const exp = require('../server/pos').expectedCash(today);
  assert.ok(exp.visits >= 300000 && exp.tips >= 50000);
  // nhân viên kết ca: không thấy số máy tính
  const k = (await s.post('/pos/close', { counted: '100.000' })).data;
  assert.equal(k.expected, undefined); assert.equal(k.diff, undefined);
  const ko = (await o.post('/pos/close', { counted: String(exp.total) })).data;
  assert.equal(ko.diff, 0);
  const h = (await o.get('/pos/closes')).data;
  assert.ok(h.some((x) => x.counted === 100000 && x.diff === 100000 - exp.total));
  assert.equal((await s.get('/pos/closes')).status, 403);
});

test('lịch hẹn: người nhận lịch mặc định là người đặt; lịch sửa trên app không bị đồng bộ sổ xóa/ghi đè', async () => {
  const I = require('../server/importer');
  const L = require('../server/logic');
  const o = client();
  assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const vinh = db.prepare("SELECT id FROM users WHERE username='vinh'").get().id;
  const duong = db.prepare("SELECT id FROM users WHERE username='duong'").get().id;
  const d = L.addDays(L.today(), 2);
  const id = (await o.post('/appointments', { guest_name: 'C Lan Test', date: d, time: '10:00', staff_id: duong })).data.id;
  assert.equal((await o.put('/appointments/' + id, { guest_name: 'C Lan Test', date: d, time: '10:00', staff_id: duong, service: 'Cắt + Gội' })).status, 200);
  // bản do sổ tạo trùng (cũ hơn thì id nhỏ hơn – giả lập bằng chèn sau)
  db.prepare("INSERT INTO appointments(guest_name,staff_id,date,time,status,note) VALUES ('C Lan',?,?,?,'booked','C Lan test')").run(duong, d, '10:00');
  I.dedupeAppointments();
  const left = db.prepare('SELECT * FROM appointments WHERE date=? AND time=? AND staff_id=?').all(d, '10:00', duong);
  assert.equal(left.length, 1);
  assert.equal(left[0].id, id, 'giữ lịch đã sửa trên app');
  assert.equal(left[0].service, 'Cắt + Gội');
  assert.equal(left[0].taken_by, vinh);
  const r = (await o.get(`/appointments?from=${d}&to=${d}`)).data.find((a) => a.id === id);
  assert.ok(r.taken_by_name);
});

test('khách trả thiếu: ghi nợ, thu nợ ngày sau tính tiền vào ngày trả', async () => {
  const L = require('../server/logic');
  const P = require('../server/pos');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const s = client(); assert.equal((await s.post('/login', { username: 'thu', password: 'moi-thu' })).status, 200);
  const duong = db.prepare("SELECT id FROM users WHERE username='duong'").get().id;
  const cut = db.prepare("SELECT id FROM services WHERE active=1 AND grp='Cắt' AND price>0 ORDER BY id LIMIT 1").get();
  const cid = (await o.post('/customers', { name: 'Khách nợ', phone: '0913777666' })).data.id;
  const d = '2025-03-15';
  assert.equal((await o.post('/visits', { customer_id: cid, date: d, time: '10:00', main_staff_id: duong, payment_method: 'Tiền mặt', debt: 900000, items: [{ service_id: cut.id, price: 500000 }] })).status, 400, 'nợ không quá số phải trả');
  const v = (await o.post('/visits', { customer_id: cid, date: d, time: '10:00', main_staff_id: duong, payment_method: 'Tiền mặt', debt: 100000, items: [{ service_id: cut.id, price: 500000 }] })).data;
  const row = db.prepare('SELECT total, cash_paid, debt FROM visits WHERE id=?').get(v.id);
  assert.deepEqual(row, { total: 500000, cash_paid: 400000, debt: 100000 });
  let sm = L.salesReport(d, d, { role: 'owner' }).summary;
  assert.equal(sm.service_sales, 500000); assert.equal(sm.unpaid, 100000); assert.equal(sm.money_in, 400000);
  assert.equal((await o.get('/customers/' + cid)).data.debt, 100000);
  assert.ok((await s.get('/pos')).data.debts.some((x) => x.visit_id === v.id));
  assert.equal((await s.post('/pos/debt/' + v.id, { method: 'Tiền mặt' })).status, 200);
  assert.equal((await s.post('/pos/debt/' + v.id, { method: 'Tiền mặt' })).status, 400, 'không thu 2 lần');
  const t = L.today();
  sm = L.salesReport(t, t, { role: 'owner' }).summary;
  assert.ok(sm.debt_in >= 100000);
  assert.ok(P.expectedCash(t).debts >= 100000);
  assert.equal(L.salesReport(d, d, { role: 'owner' }).summary.unpaid, 0);
  assert.equal((await o.get('/customers/' + cid)).data.debt, 0);
});

test('đặt lịch khách mới mà SĐT đã có → gắn vào khách cũ', async () => {
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const cid = (await o.post('/customers', { name: 'Anh Có SĐT', phone: '0912345670' })).data.id;
  const id = (await o.post('/appointments', { guest_name: 'anh sdt', guest_phone: '0912 345 670', date: '2026-12-20', time: '10:00', service: 'Cắt' })).data.id;
  const a = db.prepare('SELECT customer_id, guest_name FROM appointments WHERE id=?').get(id);
  assert.equal(a.customer_id, cid); assert.equal(a.guest_name, null);
});

test('chưa thu: Lãnh đạo bấm đã thu ngay trong danh sách', async () => {
  const L = require('../server/logic');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const s = client(); assert.equal((await s.post('/login', { username: 'thu', password: 'moi-thu' })).status, 200);
  const duong = db.prepare("SELECT id FROM users WHERE username='duong'").get().id;
  const cut = db.prepare("SELECT id FROM services WHERE active=1 AND grp='Cắt' AND price>0 ORDER BY id LIMIT 1").get();
  const cid = (await o.post('/customers', { name: 'Khách ô hồng', phone: '0913555444' })).data.id;
  const d = '2025-04-02';
  const v = (await o.post('/visits', { customer_id: cid, date: d, time: '10:00', main_staff_id: duong, payment_method: 'Tiền mặt', items: [{ service_id: cut.id, price: 300000 }] })).data;
  db.prepare("UPDATE visits SET payment_method=NULL, note='Sổ đặt lịch: x · CHƯA THANH TOÁN (ô hồng), giá theo bảng giá' WHERE id=?").run(v.id);
  let sm = L.salesReport(d, d, { role: 'owner' }).summary;
  assert.equal(sm.unpaid, 300000); assert.equal(sm.unpaid_list.length, 1);
  assert.equal((await s.post(`/visits/${v.id}/mark-paid`, { method: 'Chuyển khoản' })).status, 403);
  assert.equal((await o.post(`/visits/${v.id}/mark-paid`, { method: 'Chuyển khoản' })).status, 200);
  sm = L.salesReport(d, d, { role: 'owner' }).summary;
  assert.equal(sm.unpaid, 0); assert.equal(sm.by_method['Chuyển khoản'], 300000);
  assert.equal((await o.post(`/visits/${v.id}/mark-paid`, { method: 'Chuyển khoản' })).status, 400);
});

test('gộp khách trùng SĐT: dồn lượt về 1 hồ sơ, hồ sơ thừa bị ẩn; không tạo mới trùng SĐT', async () => {
  const I = require('../server/importer');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const a = db.prepare("INSERT INTO customers(code,name,phone) VALUES ('KHT1','Quỳnh Anh','0868000111')").run().lastInsertRowid;
  const b = db.prepare("INSERT INTO customers(code,name,phone) VALUES ('KHT2','C Quỳnh Anh','0868000111')").run().lastInsertRowid;
  db.prepare("INSERT INTO appointments(customer_id,date,time,status) VALUES (?,?,?,'booked')").run(b, '2026-12-01', '10:00');
  const r = I.mergeSamePhone();
  assert.ok(r.merged >= 1);
  const alive = db.prepare("SELECT id FROM customers WHERE phone='0868000111' AND deleted=0").all();
  assert.equal(alive.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM appointments WHERE customer_id=?').get(alive[0].id).n, 1);
  void a;
  assert.equal((await o.post('/customers', { name: 'Trùng', phone: '0868000111', allow_duplicate: true })).status, 409);
});

test('tự trừ kho theo công thức thợ ghi (lượt chưa ghi hóa chất), sửa công thức thì trừ lại, kiểm kho chốt', async () => {
  const st = require('../server/stock');
  const L = require('../server/logic');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const mid = db.prepare("INSERT INTO materials(name,kind,unit,size,size_unit,formula_keys) VALUES ('Màu ZZ','service','Tuýp',80,'g','zzmau')").run().lastInsertRowid;
  db.prepare("INSERT INTO stock_moves(material_id,date,kind,qty,unit_cost) VALUES (?,?,'in',2,200000)").run(mid, L.addDays(L.today(), -20));
  const chem = db.prepare("SELECT id FROM services WHERE active=1 AND grp='Hóa chất' ORDER BY id LIMIT 1").get();
  const cid = (await o.post('/customers', { name: 'Khách màu', phone: '0913777888' })).data.id;
  const d = L.addDays(L.today(), -3);
  const duong = db.prepare("SELECT id FROM users WHERE username='duong'").get().id;
  const v = (await o.post('/visits', { customer_id: cid, date: d, time: '10:00', main_staff_id: duong, payment_method: 'Tiền mặt', items: [{ service_id: chem.id, price: 800000 }] })).data;
  assert.ok(v.id, JSON.stringify(v));
  db.prepare("UPDATE visits SET formula='zzmau 40g' WHERE id=?").run(v.id);
  st.syncFormulaUse(true);
  const stock = () => db.prepare('SELECT SUM(qty) q FROM stock_moves WHERE material_id=?').get(mid).q;
  assert.equal(stock(), 1.5);
  assert.equal(db.prepare('SELECT cost FROM visits WHERE id=?').get(v.id).cost, 100000);
  const lv = st.syncFormulaUse(true); assert.equal(lv, 0, 'chạy lại không trừ 2 lần');
  db.prepare("UPDATE visits SET formula='zzmau 60g' WHERE id=?").run(v.id);
  st.syncFormulaUse(true);
  assert.equal(stock(), 1.25);
  const lvl = (await o.get('/stock/levels')).data.find((m) => m.id === mid);
  assert.equal(lvl.left_amt, 100); assert.ok(lvl.days_left != null);
  // Kiểm kho sau lượt → công thức sửa sau đó không đổi kho nữa
  db.prepare("INSERT INTO stock_moves(material_id,date,kind,qty,note) VALUES (?,?,'adjust',0,'Kiểm kho')").run(mid, L.today());
  db.prepare("UPDATE visits SET formula='zzmau 10g' WHERE id=?").run(v.id);
  st.syncFormulaUse(true);
  assert.equal(stock(), 1.25);
});

test('chi: nguồn tiền (quỹ / nhân viên ứng / chủ trả), hoàn ứng, chia tháng vào lãi lỗ', async () => {
  const E = require('../server/expenses');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const b0 = E.fundState().balance;
  const d = '2025-06-10';
  const mk = async (x) => (await o.post('/expenses', { kind: 'out', category: 'Khác', date: d, ...x })).data;
  await mk({ amount: 100000, note: 'nước' });
  const st = await mk({ amount: 200000, note: 'khăn – Thu mua hộ', source: 'staff', pay_method: 'Chuyển khoản' });
  await mk({ amount: 1200000, note: 'Canva 1 năm', source: 'owner', spread_months: 12 });
  const P = require('../server/pos'); void b0;
  assert.equal(P.expectedCash(d).spent, 100000, 'chỉ khoản lấy TM tại tiệm trừ tiền trong két');
  assert.equal(E.fundState().reimburse_due.reduce((a, x) => a + x.amount, 0), 200000);
  assert.equal((await o.post(`/expenses/${st.id}/reimburse`, { method: 'fund' })).status, 200);
  assert.ok(P.expectedCash(require('../server/logic').today()).reimb >= 200000, 'hoàn ứng bằng TM tại tiệm trừ tiền trong két');
  assert.equal(E.fundState().reimburse_due.length, 0);
  const share = (m) => E.monthExpenses(m).reduce((a, x) => a + x.share, 0);
  assert.equal(share('2025-06'), 100000 + 200000 + 100000);
  assert.equal(share('2025-07'), 100000);
  assert.equal(share('2026-05'), 100000);
  assert.equal(share('2026-06'), 0);
  const fin = require('../server/finance').report('2025-06');
  assert.equal(fin.fund.total, 400000); assert.equal(fin.cash.fund, 1500000);
});

test('thu nhập khác (lì xì khai trương): cộng lãi lỗ + dòng tiền, không phải tip', async () => {
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const F = require('../server/finance');
  const before = F.report('2025-08');
  assert.equal((await o.post('/finance/income', { date: '2025-08-02', amount: '2000000', kind: 'Lì xì khai trương', method: 'Tiền mặt', note: 'anh A' })).status, 200);
  const after = F.report('2025-08');
  assert.equal(after.other_income.total, 2000000);
  assert.equal(after.profit - before.profit, 2000000);
  assert.equal(after.cash.net - before.cash.net, 2000000);
  assert.equal(after.revenue.tips, before.revenue.tips);
  const s = client(); assert.equal((await s.post('/login', { username: 'thu', password: 'moi-thu' })).status, 200);
  assert.equal((await s.post('/finance/income', { amount: 1 })).status, 403);
});

test('lì xì khai trương từ sổ đặt lịch → thu nhập khác, nhập lại không nhân đôi', () => {
  const F = require('../server/finance');
  const u = db.prepare("SELECT * FROM users WHERE role='owner'").get();
  const blocks = [{ date: '2025-09-25', lixi: [{ time: '14:30', amount: 1000000, who: '14:30 Anh Vĩnh – Cắt tóc nam – Director(Thoại phụ)' }, { time: '19:30', amount: 1500000, who: '' }] }];
  const s1 = {}; F.importLixi(blocks, u, s1);
  const s2 = {}; F.importLixi(blocks, u, s2);
  assert.equal(s1.lixi.created, 2); assert.equal(s2.lixi.created, 0);
  const rows = db.prepare("SELECT * FROM other_income WHERE date='2025-09-25' ORDER BY id").all();
  assert.equal(rows.reduce((a, x) => a + x.amount, 0), 2500000);
  assert.ok(rows[0].note.startsWith('Anh Vĩnh'));
  assert.equal(F.report('2025-09').other_income.total, 2500000);
});

test('báo cáo tài chính cả năm: cộng từng tháng khớp báo cáo tháng', async () => {
  const F = require('../server/finance');
  const y = F.yearReport(2025);
  assert.ok(y.months.length >= 1);
  const sum = y.months.reduce((a, m) => a + m.profit, 0);
  assert.equal(y.total.profit, sum);
  const m0 = y.months[0];
  assert.equal(m0.profit, F.report(m0.month).profit);
  assert.equal(y.months[y.months.length - 1].cum_profit, sum);
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  assert.equal((await o.get('/finance/year?year=2025')).status, 200);
  const s = client(); assert.equal((await s.post('/login', { username: 'thu', password: 'moi-thu' })).status, 200);
  assert.equal((await s.get('/finance/year?year=2025')).status, 403);
});

test('tháng khai trương: chi phí cố định mặc định tính theo ngày mở cửa', async () => {
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  assert.equal((await o.put('/finance/config', { fixed: [{ name: 'Tiền nhà', amount: 15500000, cash: 1 }, { name: 'Khấu hao', amount: 3100000, cash: 0 }], open_date: '2026-10-25' })).status, 200);
  const F = require('../server/finance');
  const oct = F.report('2026-10'), sep = F.report('2026-09'), dec = F.report('2026-12');
  assert.equal(oct.fixed.open_days, 7);
  assert.equal(oct.fixed.total, Math.round(15500000 * 7 / 31) + Math.round(3100000 * 7 / 31));
  assert.equal(sep.fixed.total, 0);
  assert.equal(dec.fixed.total, 15500000 + 3100000);
  await o.put('/finance/config', { open_date: '' });
});

test('tạo thêm tài khoản trùng tên ("TruongV1" tên khác "Trường") → sổ không nhân đôi lịch/lượt; dọn bản thừa; chặn tạo mới', async () => {
  const L = require('../server/logic'); const I = require('../server/importer');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const truong = db.prepare("SELECT id FROM users WHERE username='truong'").get().id;
  const r = await o.post('/users', { username: 'truongv1', full_name: 'TruongV1', aliases: 'Trường', password: '123456', role: 'manager' });
  assert.equal(r.status, 400); assert.match(r.data.error, /Đặt lại MK/);
  // tình trạng trên máy thật (tạo trước bản sửa)
  const clone = db.prepare("INSERT INTO users(username,full_name,role,aliases) VALUES ('truongv1','TruongV1','manager','Trường')").run().lastInsertRowid;
  const svc = db.prepare("SELECT id FROM services WHERE active=1 AND price>0 ORDER BY id LIMIT 1").get();
  const cu = db.prepare("INSERT INTO customers(code,name) VALUES ('TCL1','B Chí Mỗ test')").run().lastInsertRowid;
  const sys = { id: 1, role: 'owner' };
  const mkv = (staff, ref) => L.saveVisit({ customer_id: cu, date: '2026-11-20', time: '10:00', main_staff_id: staff, items: [{ service_id: svc.id, price: 300000 }], payment_method: 'Tiền mặt', import_ref: ref, note: 'Sổ đặt lịch: B Chí Mỗ 300' }, sys, null, { imported: true });
  const keep = mkv(truong, 'SO:cl1'), dup = mkv(clone, 'SO:cl2');
  const d = L.addDays(L.today(), 1);
  const ins = db.prepare("INSERT INTO appointments(customer_id,staff_id,date,time,status,note) VALUES (?,?,?,?,'booked',?)");
  const a1 = ins.run(cu, truong, d, '10:00', 'B Chí Mỗ').lastInsertRowid; ins.run(cu, clone, d, '10:00', 'B Chí Mỗ');
  assert.ok(I.dedupeCloneStaff() >= 2);
  assert.equal(db.prepare('SELECT status FROM visits WHERE id=?').get(dup.id || dup).status, 'deleted');
  assert.equal(db.prepare('SELECT status FROM visits WHERE id=?').get(keep.id || keep).status, 'done');
  const left = db.prepare('SELECT id FROM appointments WHERE date=? AND time=? AND customer_id=?').all(d, '10:00', cu);
  assert.deepEqual(left.map((x) => x.id), [a1]);
  // sửa tài khoản Trường gốc (không đổi tên) vẫn được
  assert.equal((await o.put('/users/' + truong, { full_name: 'Trường', aliases: '' })).status, 200);
  db.prepare("UPDATE users SET active=0, works=0, aliases=NULL WHERE id=?").run(clone);
});

test('chuyển hết dữ liệu tài khoản cũ sang tài khoản mới rồi xóa tài khoản cũ', async () => {
  const L = require('../server/logic');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const old = db.prepare("INSERT INTO users(username,full_name,role,level,password_hash) VALUES ('thoaicu','Thoại Cũ','staff','Junior','x')").run().lastInsertRowid;
  const neo = db.prepare("INSERT INTO users(username,full_name,role,aliases,password_hash) VALUES ('thoaimoi','ThoaiV1','staff','Thoại Cũ','x')").run().lastInsertRowid;
  const svc = db.prepare("SELECT id FROM services WHERE active=1 AND price>0 ORDER BY id LIMIT 1").get();
  const cu = db.prepare("INSERT INTO customers(code,name,staff_id) VALUES ('TMG1','Khách chuyển',?)").run(old).lastInsertRowid;
  const v = L.saveVisit({ customer_id: cu, date: '2026-11-21', time: '15:00', main_staff_id: old, items: [{ service_id: svc.id, price: 200000 }], payment_method: 'Tiền mặt' }, { id: 1, role: 'owner' }, null, {});
  const vid = v.id || v;
  db.prepare("INSERT INTO payroll_inputs(month,user_id) VALUES ('2026-11',?)").run(old);
  db.prepare("INSERT INTO payroll_inputs(month,user_id) VALUES ('2026-11',?)").run(neo);
  const r = await o.post(`/users/${old}/merge`, { to: neo });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(db.prepare('SELECT main_staff_id FROM visits WHERE id=?').get(vid).main_staff_id, neo);
  assert.equal(db.prepare('SELECT staff_id FROM customers WHERE id=?').get(cu).staff_id, neo);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payroll_inputs WHERE user_id=?').get(neo).n, 1);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(neo);
  assert.equal(u.full_name, 'Thoại Cũ'); assert.equal(u.level, 'Junior'); assert.equal(u.username, 'thoaimoi');
  const list = (await o.get('/users')).data;
  assert.ok(!list.some((x) => x.id === old)); assert.ok(!(await o.get('/staff')).data.some((x) => x.id === old));
  assert.equal((await o.post(`/users/${neo}/merge`, { to: neo })).status, 400);
  db.prepare('UPDATE users SET active=0, works=0 WHERE id=?').run(neo);
});

test('thứ tự: Director (Trường) luôn đầu danh sách thợ và doanh số; còn lại doanh số cao đứng trước', async () => {
  const L = require('../server/logic');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  db.prepare("UPDATE users SET level='Director' WHERE username='truong'").run();
  const staff = (await o.get('/staff')).data.filter((x) => x.active);
  assert.equal(staff[0].level, 'Director');
  const rows = L.salesReport('2020-01-01', '2030-12-31', { role: 'owner', id: 1 }).rows;
  assert.equal(rows[0].level, 'Director');
  const rest = rows.slice(1).map((r) => r.sales + r.assist_sales + r.cards_amount);
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a));
});

test('chat: xem Hôm nay chưa có tin → không kéo tin các ngày cũ', async () => {
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const u = db.prepare("SELECT id FROM users WHERE username='vinh'").get().id;
  db.prepare("INSERT INTO chat_messages(user_id,body,created_at) VALUES (?,?,?)").run(u, 'tin cũ test', '2026-11-16 20:32:00');
  const today = (await o.get('/me')).data.today;
  const r = (await o.get(`/chat?after=0&date=${today}`)).data;
  assert.ok(!r.some((m) => m.body === 'tin cũ test'));
});

test('lượt bản sao (tài khoản trùng tên) bị gộp nhầm → 1 hóa đơn ×2 → tự tách lại đúng 1 lần tiền', () => {
  const L = require('../server/logic'); const I = require('../server/importer');
  const truong = db.prepare("SELECT id FROM users WHERE username='truong'").get().id;
  const clone = db.prepare("INSERT INTO users(username,full_name,role) VALUES ('truongv2','TruongV2','manager')").run().lastInsertRowid;
  const svc = db.prepare("SELECT id FROM services WHERE active=1 AND price>0 ORDER BY id LIMIT 1").get();
  const cu = db.prepare("INSERT INTO customers(code,name) VALUES ('TUM1','A Hưng gộp test')").run().lastInsertRowid;
  const sys = { id: 1, role: 'owner' };
  const mk = (staff, ref) => L.saveVisit({ customer_id: cu, date: '2026-11-19', time: '09:30', main_staff_id: staff, items: [{ service_id: svc.id, price: 685000 }], tip: 50000, payment_method: 'Chuyển khoản', import_ref: ref, note: 'Sổ đặt lịch: a hưng 685' }, sys, null, { imported: true });
  mk(truong, 'SO:um1'); mk(clone, 'SO:um2');
  I.mergeSameVisits();
  const live = () => db.prepare("SELECT * FROM visits WHERE customer_id=? AND status='done'").all(cu);
  assert.equal(live().length, 1); assert.equal(live()[0].total, 1370000, 'lỗi cũ: gộp thành ×2');
  assert.equal(I.unmergeCloneDupes(), 1);
  assert.equal(live().length, 1); assert.equal(live()[0].total, 685000); assert.equal(live()[0].tip, 50000);
  assert.equal(I.unmergeCloneDupes(), 0, 'chạy lại không đổi');
  db.prepare("UPDATE users SET active=0, works=0 WHERE id=?").run(clone);
});

test('xuất Excel hóa đơn bán hàng: chỉ Lãnh đạo, đúng số hóa đơn + dòng tổng', async () => {
  const ExcelJS = require('exceljs');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const thu = client(); assert.equal((await thu.post('/login', { username: 'thu', password: 'moi-thu' })).status, 200);
  assert.equal((await thu.get('/visits/export?from=2026-11-01&to=2026-11-30')).status, 403);
  const res = await fetch(base + '/visits/export?from=2026-11-19&to=2026-11-21', { headers: { Cookie: o.cookie() } });
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.getWorksheet('Hóa đơn');
  const n = db.prepare("SELECT COUNT(*) n FROM visits WHERE status='done' AND date BETWEEN '2026-11-19' AND '2026-11-21'").get().n;
  assert.equal(ws.rowCount, n + 2);
  assert.equal(ws.getRow(ws.rowCount).getCell(1).value, 'TỔNG');
});

test('1 khách 1 ngày: uốn/nhuộm đã có trong hóa đơn khác → cảnh báo trước khi tạo; trang hóa đơn liệt kê cặp nghi trùng', async () => {
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const chem = db.prepare("SELECT id, price FROM services WHERE grp='Hóa chất' AND active=1 ORDER BY id LIMIT 1").get();
  const cut = db.prepare("SELECT id, price FROM services WHERE grp='Cắt' AND active=1 ORDER BY id LIMIT 1").get();
  const cid = db.prepare("INSERT INTO customers(code,name) VALUES ('TDS1','C Điệp test')").run().lastInsertRowid;
  const thu = db.prepare("SELECT id FROM users WHERE username='thu'").get().id, tr = db.prepare("SELECT id FROM users WHERE username='truong'").get().id;
  const base = { customer_id: cid, date: '2026-11-25', payment_method: 'Chuyển khoản' };
  const a = await o.post('/visits', { ...base, time: '09:30', main_staff_id: tr, items: [{ service_id: cut.id, price: 785000, staff_id: tr }, { service_id: chem.id, price: 1551000, staff_id: thu }] });
  assert.equal(a.status, 200);
  const cutOnly = await o.post('/visits', { ...base, time: '11:00', main_staff_id: tr, items: [{ service_id: cut.id, price: 100000 }] });
  assert.equal(cutOnly.status, 200, 'cắt thêm không cảnh báo');
  const b = await o.post('/visits', { ...base, time: '10:00', main_staff_id: thu, items: [{ service_id: chem.id, price: 1551000 }] });
  assert.equal(b.status, 409); assert.ok(b.data.dup);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM visits WHERE customer_id=? AND status='done'").get(cid).n, 2, 'không lưu khi chưa xác nhận');
  const b2 = await o.post('/visits', { ...base, time: '10:00', main_staff_id: thu, items: [{ service_id: chem.id, price: 1551000 }], force: true });
  assert.equal(b2.status, 200);
  const sus = (await o.get('/visits/suspects?from=2026-11-25&to=2026-11-25')).data;
  assert.ok(sus.some((x) => x.a_id === a.data.id && x.b_id === b2.data.id));
});

test('hóa đơn sổ ghi lại dịch vụ hóa chất đã có trong hóa đơn khác cùng ngày → tự xóa mềm; hóa đơn ghi tay thì giữ', () => {
  const I = require('../server/importer');
  const cid = db.prepare("SELECT id FROM customers WHERE code='TDS1'").get().id;
  const vs = db.prepare("SELECT id, time FROM visits WHERE customer_id=? AND status='done' ORDER BY id").all(cid);
  const b = vs.find((v) => v.time === '10:00');
  assert.equal(I.dedupeSameDayChem(), 0, 'ghi tay (không từ sổ) thì không tự xóa');
  db.prepare("UPDATE visits SET import_ref='SO:test-10h' WHERE id=?").run(b.id);
  assert.equal(I.dedupeSameDayChem(), 1);
  const st = db.prepare('SELECT status, delete_reason FROM visits WHERE id=?').get(b.id);
  assert.equal(st.status, 'deleted'); assert.match(st.delete_reason, /hóa chất/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM visits WHERE customer_id=? AND status='done'").get(cid).n, 2, 'giữ hóa đơn 09:30 và hóa đơn cắt');
  assert.equal(I.dedupeSameDayChem(), 0);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='book_money_until'").get().value, '2026-11-26', 'sổ chỉ lấy lịch hẹn từ 26/11');
});

test('thu ngân: sổ ô hồng nhưng đã trừ thẻ hết → Đã thu; hóa đơn bị xóa → lịch về Đang phục vụ để thu lại', async () => {
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const cid = db.prepare("INSERT INTO customers(code,name) VALUES ('TTT1','Tuấn Tạng test')").run().lastInsertRowid;
  const tr = db.prepare("SELECT id FROM users WHERE username='truong'").get().id;
  const vid = db.prepare("INSERT INTO visits(code,customer_id,date,time,main_staff_id,total,cash_paid,card_paid,status) VALUES ('LT1',?,'2026-11-24','12:30',?,1000000,0,1000000,'done')").run(cid, tr).lastInsertRowid;
  const aid = db.prepare("INSERT INTO appointments(customer_id,date,time,staff_id,status,visit_id,pay_note) VALUES (?,'2026-11-24','12:30',?,'done',?,'Chưa thanh toán')").run(cid, tr, vid).lastInsertRowid;
  let r = (await o.get('/pos?date=2026-11-24')).data;
  assert.ok(r.paid.some((a) => a.id === aid), 'trừ thẻ hết → đã thu');
  db.prepare("UPDATE visits SET status='deleted' WHERE id=?").run(vid);
  r = (await o.get('/pos?date=2026-11-24')).data;
  assert.ok(r.serving.some((a) => a.id === aid && !a.visit_id), 'hóa đơn xóa → Đang phục vụ');
  assert.ok(!r.unpaid.some((a) => a.id === aid));
});

test('thanh toán từ hồ sơ khách tự gắn vào lịch hẹn cùng ngày; khung khách nhanh có thẻ, lịch hôm nay', async () => {
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const cid = db.prepare("INSERT INTO customers(code,name) VALUES ('TLK1','Khách nối lịch')").run().lastInsertRowid;
  const tr = db.prepare("SELECT id FROM users WHERE username='truong'").get().id;
  const cut = db.prepare("SELECT id FROM services WHERE grp='Cắt' AND active=1 ORDER BY id LIMIT 1").get();
  const day = (await o.get('/me')).data.today;
  const aid = db.prepare("INSERT INTO appointments(customer_id,date,time,staff_id,status) VALUES (?,?,'15:00',?,'booked')").run(cid, day, tr).lastInsertRowid;
  let q = (await o.get('/customers/' + cid + '/quick')).data;
  assert.equal(q.today_appt.id, aid); assert.ok(!q.today_appt.visit_id);
  const v = await o.post('/visits', { customer_id: cid, date: day, time: '15:10', main_staff_id: tr, payment_method: 'Tiền mặt', items: [{ service_id: cut.id, price: 200000 }] });
  assert.equal(v.status, 200);
  const a = db.prepare('SELECT status, visit_id FROM appointments WHERE id=?').get(aid);
  assert.equal(a.visit_id, v.data.id); assert.equal(a.status, 'done');
  q = (await o.get('/customers/' + cid + '/quick')).data;
  assert.equal(q.today_appt.visit_id, v.data.id); assert.equal(q.visit_count, 1); assert.equal(q.last[0].id, v.data.id);
});

test('lịch hẹn ghi 2 lần (cả bản Hoàn thành / Hủy, sau khi gộp tài khoản) → tự dọn còn 1, giữ bản có hóa đơn', () => {
  const I = require('../server/importer');
  const cid = db.prepare("INSERT INTO customers(code,name) VALUES ('TDA1','Linh Hưng yên test')").run().lastInsertRowid;
  const tr = db.prepare("SELECT id FROM users WHERE username='truong'").get().id;
  const vid = db.prepare("INSERT INTO visits(code,customer_id,date,time,main_staff_id,total,cash_paid,status) VALUES ('LDA1',?,'2026-11-25','10:30',?,300000,300000,'done')").run(cid, tr).lastInsertRowid;
  const ins = db.prepare("INSERT INTO appointments(customer_id,date,time,staff_id,status,visit_id,note) VALUES (?,'2026-11-25',?,?,?,?,?)");
  ins.run(cid, '10:30', tr, 'done', null, 'Em Linh Hưng yên');
  const keep = ins.run(cid, '10:30', tr, 'done', vid, 'Em Linh Hưng yên').lastInsertRowid;
  ins.run(null, '10:30', tr, 'cancelled', null, 'Em Linh Hưng yên');
  ins.run(null, '10:30', tr, 'booked', null, 'Khách khác hẳn');
  I.dedupeAppointments();
  const left = db.prepare("SELECT id, note FROM appointments WHERE date='2026-11-25' AND time='10:30' AND staff_id=?").all(tr);
  assert.equal(left.length, 2, 'còn 1 lịch Linh + 1 khách khác');
  assert.ok(left.some((a) => a.id === keep));
});

test('hoa hồng người phụ trích từ hoa hồng dòng: nhuộm 15% có phụ = 10% + 5%, tự làm = 15%; cắt tự phụ = thợ nhận cả 3%', async () => {
  const c = client(); assert.equal((await c.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  db.prepare('UPDATE users SET commission_enabled=1 WHERE id IN (2,3,4,5)').run();
  const nh = db.prepare("SELECT id, commission_rate r FROM services WHERE grp='Hóa chất' AND commission_rate=0.15 AND active=1 LIMIT 1").get();
  const cut = db.prepare("SELECT id, commission_rate r FROM services WHERE grp='Cắt' AND active=1 LIMIT 1").get();
  const cid = db.prepare("INSERT INTO customers(code,name) VALUES ('THH1','Khách HH')").run().lastInsertRowid;
  const base = { customer_id: cid, date: '2026-11-20', payment_method: 'Tiền mặt' };
  let r = await c.post('/visits', { ...base, time: '09:00', main_staff_id: 3, assistant_id: 5, items: [{ service_id: nh.id, price: 1000000 }] });
  assert.equal(r.data.main_commission, 100000); assert.equal(r.data.assistant_commission, 50000);
  r = await c.post('/visits', { ...base, date: '2026-11-19', time: '12:00', main_staff_id: 3, items: [{ service_id: nh.id, price: 1000000 }] });
  assert.equal(r.data.main_commission, 150000); assert.equal(r.data.assistant_commission, 0);
  r = await c.post('/visits', { ...base, time: '15:00', main_staff_id: 3, items: [{ service_id: cut.id, price: 500000 }] });
  assert.equal(r.data.main_commission, Math.round(500000 * cut.r));
  r = await c.post('/visits', { ...base, time: '17:00', main_staff_id: 3, assistant_id: 5, items: [{ service_id: cut.id, price: 500000 }] });
  assert.equal(r.data.main_commission + r.data.assistant_commission, Math.round(500000 * cut.r), 'tổng không vượt hoa hồng dòng');
  assert.ok(require('../server/logic').recalcCommissions('2026-11-01') > 0);
});

test('chia tip: nghỉ vài giờ / nửa ngày → tip của khách đến trong giờ nghỉ chỉ chia người có mặt', () => {
  const T = require('../server/tips');
  const pool = T.poolIds(); assert.ok(pool.length >= 2);
  const off = pool[0];
  db.prepare("INSERT INTO visits(code,date,time,main_staff_id,total,cash_paid,tip,status) VALUES ('LTP1','2026-09-10','10:00',?,100000,100000,90000,'done')").run(pool[1]);
  db.prepare("INSERT INTO visits(code,date,time,main_staff_id,total,cash_paid,tip,status) VALUES ('LTP2','2026-09-10','16:00',?,100000,100000,40000,'done')").run(pool[1]);
  db.prepare("INSERT INTO staff_off(user_id,date,from_time,to_time,status) VALUES (?,'2026-09-10','08:00','13:00','approved')").run(off);
  const r = T.tipReport('2026-09');
  const d = r.days.find((x) => x.date === '2026-09-10');
  const n = pool.length;
  assert.equal(d.by[off], Math.round(40000 / n), 'người nghỉ sáng chỉ được chia tip buổi chiều');
  assert.equal(d.by[pool[1]], Math.round(90000 / (n - 1) + 40000 / n));
  assert.deepEqual(d.list.find((t) => t.code === 'LTP1').away, [off]);
  assert.equal(d.share, null);
});

test('Excel chấm công: xuất mẫu → điền giờ → nhập hàng loạt, không ghi trùng', async () => {
  const ExcelJS = require('exceljs');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const res = await fetch(base + '/attendance/export?from=2026-09-01&to=2026-09-02', { headers: { Cookie: o.cookie() } });
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.getWorksheet('Chấm công');
  assert.ok(ws.rowCount > 2);
  const r2 = ws.getRow(2); r2.getCell(3).value = '09:00'; r2.getCell(4).value = '19:30';
  const r3 = ws.getRow(3); r3.getCell(3).value = '9h15';
  const buf = await wb.xlsx.writeBuffer();
  const send = async (dry) => { const fd = new FormData(); fd.append('file', new Blob([buf]), 'cc.xlsx'); fd.append('dry_run', dry ? '1' : '0');
    return (await fetch(base + '/attendance/import', { method: 'POST', body: fd, headers: { Cookie: o.cookie() } })).json(); };
  let r = await send(true); assert.equal(r.added, 3); assert.equal(r.errors.length, 0);
  r = await send(false); assert.equal(r.added, 3);
  r = await send(false); assert.equal(r.added, 0); assert.equal(r.skipped, 3, 'nhập lại không ghi trùng');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM attendance WHERE date='2026-09-01' AND method='manual'").get().n >= 2, true);
});

test('Chấm đủ hàng loạt: bỏ ngày OFF, lùi giờ khi nghỉ vài giờ, không ghi trùng; OFF cả tiệm', async () => {
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const staff = db.prepare("SELECT id FROM users WHERE active=1 AND IFNULL(works,1)=1 AND merged_into IS NULL AND role<>'owner' ORDER BY id").all().map((u) => u.id);
  const r0 = await o.post('/attendance/off', { date: '2026-08-01', all: 1 });
  assert.equal(r0.status, 200); assert.equal(r0.data.added, staff.length);
  assert.equal((await o.post('/attendance/off', { date: '2026-08-01', all: 1 })).data.added, 0, 'đánh OFF lần 2 không nhân đôi');
  db.prepare("INSERT INTO staff_off(user_id,date,from_time,to_time,status) VALUES (?,'2026-08-02','08:00','13:00','approved')").run(staff[0]);
  db.prepare("INSERT INTO staff_off(user_id,date,status) VALUES (?,'2026-08-03','approved')").run(staff[1]);
  const body = { from: '2026-08-01', to: '2026-08-03', in_time: '09:00', out_time: '20:00', dry_run: true };
  let r = await o.post('/attendance/fill', body);
  assert.equal(r.status, 200);
  assert.equal(r.data.added, (2 * staff.length - 1) * 2);
  assert.equal(r.data.days_off, staff.length + 1);
  r = await o.post('/attendance/fill', { ...body, dry_run: false });
  assert.equal(db.prepare("SELECT time FROM attendance WHERE user_id=? AND date='2026-08-02' AND kind='in'").get(staff[0]).time, '13:00');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM attendance WHERE date='2026-08-01'").get().n, 0);
  r = await o.post('/attendance/fill', { ...body, dry_run: false });
  assert.equal(r.data.added, 0, 'chạy lại không ghi trùng');
});

test('Quyền tiền: quản lý chỉ thấy doanh số của mình, không thấy giá cốt / giá nhập / tổng tiệm; Thu ngân chỉ hôm nay', async () => {
  const m = client(); const mu = db.prepare("SELECT username FROM users WHERE role='manager' AND active=1 AND merged_into IS NULL ORDER BY id").get();
  db.prepare("UPDATE users SET password_hash=?, can_login=1, must_change_pw=0 WHERE username=?").run(require('bcryptjs').hashSync('Mgr-12345', 4), mu.username);
  assert.equal((await m.post('/login', { username: mu.username, password: 'Mgr-12345' })).status, 200);
  const me = (await m.get('/me')).data;
  assert.equal((await m.get('/reports/cost')).status, 403);
  assert.equal((await m.get('/export')).status, 403);
  const mats = (await m.get('/materials')).data;
  assert.ok(mats.every((x) => x.avg_cost === undefined && x.ref_cost === undefined));
  const rep = (await m.get('/reports/sales?from=2026-01-01&to=2026-12-31')).data;
  assert.equal(rep.summary, null); assert.ok(rep.rows.every((r) => r.user_id === (me.user || me).id));
  const pos = (await m.get('/pos?date=2026-01-02')).data;
  assert.notEqual(pos.date, '2026-01-02', 'quản lý chỉ xem Thu ngân hôm nay'); assert.equal(pos.totals, undefined);
});

test('1 két: kết ca trừ chi lấy từ két, để lại quỹ, phần vượt nộp chủ', async () => {
  const P = require('../server/pos'), L = require('../server/logic');
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const t = L.today(); const before = P.expectedCash(t);
  assert.equal(before.float, 1000000);
  await o.post('/expenses', { kind: 'out', amount: 45000, note: 'gửi xe + nước', category: 'Khác' });
  const after = P.expectedCash(t);
  assert.equal(after.spent - before.spent, 45000); assert.equal(before.total - after.total, 45000);
  const r = await o.post('/pos/close', { counted: String(after.total) });
  assert.equal(r.data.diff, 0); assert.equal(r.data.keep, Math.min(after.total, 1000000)); assert.equal(r.data.handover, after.total - r.data.keep);
});

test('Đánh OFF: nhiều người, nhiều ngày, nửa ngày; không trùng', async () => {
  const o = client(); assert.equal((await o.post('/login', { username: 'vinh', password: 'moi-vinh' })).status, 200);
  const staff = db.prepare("SELECT id FROM users WHERE active=1 AND IFNULL(works,1)=1 AND merged_into IS NULL AND role<>'owner' ORDER BY id").all().map((u) => u.id);
  let r = await o.post('/attendance/off', { from: '2026-07-01', to: '2026-07-02', user_ids: staff.slice(0, 2) });
  assert.equal(r.data.added, 4);
  r = await o.post('/attendance/off', { from: '2026-07-03', to: '2026-07-03', all: 1, from_time: '14:00', to_time: '20:00' });
  assert.equal(r.data.added, staff.length);
  r = await o.post('/attendance/off', { from: '2026-07-01', to: '2026-07-03', all: 1, from_time: '14:00', to_time: '20:00' });
  assert.equal(r.data.skipped, 2 * 2 + staff.length, 'đã OFF cả ngày / cùng giờ thì bỏ qua');
  assert.equal((await o.post('/attendance/off', { from: '2026-07-05', user_ids: [staff[0]], from_time: '15:00', to_time: '14:00' })).status, 400);
  // Đã ⚡ Chấm đủ rồi mới đánh OFF → giờ tự điền ngày đó bị xóa, bảng hiện OFF
  db.prepare("INSERT INTO attendance(user_id,date,kind,time,method,note,created_by) VALUES (?,'2026-07-08','in','09:00','manual','Chấm đủ hàng loạt',1)").run(staff[0]);
  db.prepare("INSERT INTO attendance(user_id,date,kind,time,method,note,created_by) VALUES (?,'2026-07-08','in','09:05','gps',NULL,?)").run(staff[1], staff[1]);
  r = await o.post('/attendance/off', { from: '2026-07-08', all: 1 });
  assert.equal(r.data.removed, 1, 'chỉ xóa giờ do Chấm đủ tự điền');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM attendance WHERE date='2026-07-08'").get().n, 1);
  r = await o.post('/attendance/off', { from: '2026-07-08', all: 1 });
  assert.equal(r.data.added, 0);
});

test('Bảng công xem đến hôm nay → hiện luôn OFF sắp tới trong tháng', async () => {
  const L = require('../server/logic'); const S = require('../server/staff');
  const t = L.today(); const [y, m] = t.split('-').map(Number); const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (end === t) return;
  const uid = db.prepare("SELECT id FROM users WHERE role<>'owner' AND active=1 ORDER BY id").get().id;
  db.prepare("INSERT INTO staff_off(user_id,date,status) VALUES (?,?,'approved')").run(uid, end);
  const r = S.report(t.slice(0, 8) + '01', t, { id: 1, role: 'owner' });
  const row = r.grid.rows.find((x) => x.user_id === uid);
  const c = row.cells.find((x) => x.date === end);
  assert.equal(c.s, 'off'); assert.equal(c.future, true);
});
