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
