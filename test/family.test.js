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
  return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), put: (p, b) => call('PUT', p, b), del: (p, b) => call('DELETE', p, b) };
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
  const svc = db.prepare('SELECT id FROM services WHERE active=1 ORDER BY id LIMIT 1').get().id;
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
  const b = await c.post('/visits', { customer_id: cid, date: '2026-11-22', time: '11:00', main_staff_id: 2, items: [{ service_id: svc.id, price: 1200000 }], payment_method: 'Tiền mặt' });
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
  assert.equal((await o.put('/finance/config', { fixed: [{ name: 'Tiền nhà', amount: 10000000, cash: 1 }, { name: 'Khấu hao', amount: 2000000, cash: 0 }], rates: { 'Hóa chất': 0.2 } })).status, 200);
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
