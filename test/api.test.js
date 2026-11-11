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
const ids = {};

test('đăng nhập, sai mật khẩu, khóa sau 5 lần', async () => {
  const c = client();
  assert.equal((await c.get('/me')).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/login', { username: 'thoai', password: 'sai' })).status, 401);
  assert.equal((await c.post('/login', { username: 'thoai', password: 'tam12345' })).status, 429);
});

test('luồng chính và phân quyền', async () => {
  const owner = await login('vinh');
  const mgr = await login('truong');
  const duong = await login('duong');
  const thu = await login('thu');
  const staff = Object.fromEntries((await owner.get('/staff')).data.map((s) => [s.full_name, s.id]));

  // Khách
  let r = await thu.post('/customers', { name: 'Lan', phone: '979 143 612', birthday: '1990-' + new Date().toISOString().slice(5, 10) });
  assert.equal(r.status, 200); ids.lan = r.data.id;
  assert.equal((await thu.post('/customers', { name: 'Lan 2', phone: '0979143612' })).status, 409, 'trùng SĐT');
  r = await thu.get('/customers/' + ids.lan);
  assert.equal(r.data.phone, '0979143612');

  // Lịch hẹn + trùng giờ
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  r = await thu.post('/appointments', { customer_id: ids.lan, staff_id: staff['Dương'], date: tomorrow, time: '10:00', service: 'Nhuộm' });
  assert.equal(r.status, 200);
  assert.equal((await thu.post('/appointments', { guest_name: 'Khách lạ', staff_id: staff['Dương'], date: tomorrow, time: '10:00' })).status, 409);

  // Bán thẻ: nhân viên bán, HH 5% cho chính mình
  const types = (await thu.get('/card-types')).data;
  r = await thu.post('/cards', { customer_id: ids.lan, card_type_id: types.find((t) => t.name === 'Thẻ Bạc').id, seller_id: staff['Trường'], payment_method: 'Tiền mặt' });
  assert.equal(r.status, 200); assert.equal(r.data.balance, 2200000); assert.equal(r.data.seller_id, staff['Chị Thu']); assert.equal(r.data.commission, 100000);
  ids.card = r.data.id;

  // Lượt làm dùng thẻ
  const svcs = (await duong.get('/services')).data;
  const nhuom = svcs.find((s) => s.name === 'Nhuộm');
  r = await duong.post('/visits', { customer_id: ids.lan, main_staff_id: staff['Dương'], assistant_id: staff['Thoại'], items: [{ service_id: nhuom.id }],
    surcharge: 420000, discount: 70000, discount_reason: 'Khách quen', card_id: ids.card, card_paid: 1000000, payment_method: 'Chuyển khoản', tip: 50000, formula: '5.14 60ml + oxi 30' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.total, 1600000); assert.equal(r.data.cash_paid, 600000); assert.equal(r.data.card_paid, 1000000);
  assert.equal(r.data.main_commission, Math.round(1250000 * (1600000 / 1250000) * 0.15));
  assert.equal(r.data.assistant_commission, 48000);
  ids.visit = r.data.id;
  assert.equal((await duong.get('/cards?customer_id=' + ids.lan)).data.find((c) => c.id === ids.card).balance, 1200000);
  assert.equal((await duong.post('/visits', { customer_id: ids.lan, main_staff_id: staff['Dương'], items: [{ service_id: nhuom.id }], discount: 1000 })).status, 400, 'giảm giá phải có lý do');
  assert.equal((await duong.post('/visits', { customer_id: ids.lan, main_staff_id: staff['Dương'], items: [{ service_id: nhuom.id }], card_id: ids.card, card_paid: 5000000 })).status, 400, 'vượt số dư thẻ');
  assert.equal((await duong.post('/visits', { date: '2020-01-01', customer_id: ids.lan, main_staff_id: staff['Dương'], items: [{ service_id: nhuom.id }], payment_method: 'Tiền mặt' })).status, 403, 'nhân viên không ghi lùi ngày');

  // Hóa đơn: thợ làm lượt xem được, người khác không
  r = await duong.get(`/visits/${ids.visit}/receipt`);
  assert.equal(r.status, 200); assert.equal(r.data.visit.total, 1600000); assert.equal(r.data.card_balance, 1200000); assert.ok(r.data.salon.name);
  assert.equal((await thu.get(`/visits/${ids.visit}/receipt`)).status, 403);

  // Hủy lịch: bắt buộc lý do, hiện ở nhắc "mời đặt lại", đánh dấu đã mời
  const apptId = (await thu.get(`/appointments?from=${tomorrow}`)).data[0].id;
  assert.equal((await thu.post(`/appointments/${apptId}/status`, { status: 'cancelled' })).status, 400);
  assert.equal((await thu.post(`/appointments/${apptId}/status`, { status: 'cancelled', reason: 'Khách ốm' })).status, 200);
  r = await duong.get('/reminders');
  const cx = r.data.cancels.find((x) => x.id === apptId);
  assert.ok(cx); assert.equal(cx.cancel_reason, 'Khách ốm'); assert.equal(cx.cancelled_by_name, 'Chị Thu'); assert.equal(r.data.counts.cancels, 1);
  await duong.post(`/appointments/${apptId}/followup`);
  assert.equal((await duong.get('/reminders')).data.counts.cancels, 0);

  // Nhân viên khác không thấy tiền lượt của Dương
  r = await thu.get('/visits/' + ids.visit);
  assert.equal(r.data.total, null); assert.equal(r.data.masked, true); assert.equal(r.data.formula, '5.14 60ml + oxi 30');
  assert.equal((await thu.put('/visits/' + ids.visit, { customer_id: ids.lan, main_staff_id: staff['Chị Thu'], items: [{ service_id: nhuom.id }] })).status, 403);
  // Hóa đơn đã hoàn thành: thợ chỉ sửa ghi chú, không đổi được tiền/tip/giá
  const beforeV = (await mgr.get('/visits/' + ids.visit)).data;
  r = await duong.put('/visits/' + ids.visit, { ...beforeV, tip: 999000, discount: 500000, discount_reason: 'x', items: [{ service_id: nhuom.id, price: 1 }], formula: beforeV.formula, note: 'khách hài lòng' });
  assert.equal(r.status, 200);
  const afterV = (await mgr.get('/visits/' + ids.visit)).data;
  assert.equal(afterV.tip, beforeV.tip); assert.equal(afterV.total, beforeV.total); assert.equal(afterV.discount, beforeV.discount); assert.equal(afterV.note, 'khách hài lòng');
  assert.equal((await thu.del('/visits/' + ids.visit, { reason: 'x' })).status, 403);

  // Doanh số: nhân viên chỉ thấy dòng của mình, không có tổng tiệm
  r = await duong.get('/reports/sales');
  assert.equal(r.data.summary, null); assert.equal(r.data.rows.length, 1); assert.equal(r.data.rows[0].sales, 1600000);
  r = await mgr.get('/reports/sales');
  assert.equal(r.data.summary.service_sales, 1600000);
  assert.equal(r.data.summary.money_in, 600000 + 2000000, 'tiền vào = thu dịch vụ + bán thẻ');
  assert.equal(r.data.summary.paid_by_card, 1000000);

  // Thẻ tri ân 1Tr: giá 0 → tự là thẻ tặng, hạn cố định 25/10/2027, người khác dùng được (tặng lại)
  const gift = types.find((t) => t.name === 'Thẻ tri ân 1Tr');
  r = await thu.post('/cards', { customer_id: ids.lan, card_type_id: gift.id, sale_type: 'new' });
  assert.equal(r.data.sale_type, 'gift'); assert.equal(r.data.commission, 0); assert.equal(r.data.expires_at, '2027-10-25'); assert.equal(r.data.balance, 1000000);
  const giftId = r.data.id, giftCode = r.data.code;
  const ban = (await thu.post('/customers', { name: 'Bạn của Lan' })).data.id;
  assert.equal((await duong.get('/cards?status=active&q=' + giftCode)).data.length, 1);
  r = await duong.post('/visits', { customer_id: ban, main_staff_id: staff['Dương'], items: [{ service_id: nhuom.id }], card_id: giftId, payment_method: 'Tiền mặt' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.card_paid, 1000000); assert.equal(r.data.cash_paid, 250000, 'dịch vụ cao hơn thẻ → trả thêm');
  assert.equal((await duong.post('/visits', { customer_id: ban, main_staff_id: staff['Dương'], items: [{ service_id: nhuom.id }], card_id: ids.card })).status, 400, 'thẻ mua không cho người khác dùng');
  assert.equal((await mgr.get('/reports/sales')).data.summary.paid_by_gift, 1000000);
  await mgr.del('/visits/' + r.data.id, { reason: 'dọn dữ liệu kiểm thử' });

  // Quyền Excel, tài khoản, nhật ký
  assert.equal((await duong.get('/export')).status, 403);
  assert.equal((await mgr.call('GET', '/export')).status, 200);
  assert.equal((await mgr.get('/users')).status, 403);
  assert.equal((await mgr.get('/audit')).status, 403);
  assert.equal((await mgr.put('/settings', { return_days: 5 })).status, 403);
  assert.equal((await duong.post('/services', { name: 'X', price: 1 })).status, 403);

  // Quản lý sửa rồi xóa lượt → hoàn số dư thẻ, ghi nhật ký
  r = await mgr.put('/visits/' + ids.visit, { customer_id: ids.lan, main_staff_id: staff['Dương'], items: [{ service_id: nhuom.id }], card_id: ids.card, card_paid: 1250000 });
  assert.equal(r.status, 200); assert.equal(r.data.cash_paid, 0);
  assert.equal((await mgr.get('/cards?customer_id=' + ids.lan)).data.find((c) => c.id === ids.card).balance, 950000);
  assert.equal((await mgr.del('/visits/' + ids.visit, {})).status, 400, 'xóa phải có lý do');
  assert.equal((await mgr.del('/visits/' + ids.visit, { reason: 'Ghi nhầm' })).status, 200);
  assert.equal((await mgr.get('/cards?customer_id=' + ids.lan)).data.find((c) => c.id === ids.card).balance, 2200000);
  const log = (await owner.get('/audit')).data.map((a) => a.action);
  for (const a of ['delete_visit', 'update_visit', 'sell_card', 'export_excel']) assert.ok(log.includes(a), a);

  // Nhắc nhở: sinh nhật hôm nay, lịch ngày mai
  r = await thu.get('/reminders');
  assert.ok(r.data.birthdays.some((b) => b.id === ids.lan));
  assert.equal(r.data.appointments.length, 0, 'lịch đã hủy không cần gọi xác nhận');
  await thu.post('/reminders/done', { customer_id: ids.lan, type: 'birthday', ref: r.data.birthdays[0].ref });
  assert.equal((await thu.get('/reminders')).data.counts.birthdays, 0);

  // Lịch off: nhân viên xin → chờ duyệt; quản lý duyệt → đặt lịch trùng bị cảnh báo
  const d2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const nv6 = await login('nhanvien6');
  r = await nv6.post('/offs', { date: d2, reason: 'Việc nhà' });
  assert.equal(r.data.status, 'pending');
  assert.equal((await nv6.post(`/offs/${r.data.id}/decide`, { status: 'approved' })).status, 403);
  assert.equal((await mgr.post(`/offs/${r.data.id}/decide`, { status: 'approved' })).status, 200);
  assert.equal((await thu.post('/appointments', { guest_name: 'Khách A', staff_id: staff['Nhân viên 6'], date: d2, time: '10:00', service: 'Cắt nam + Gội' })).status, 409, 'thợ nghỉ');
  r = await thu.post('/offs', { date: d2, from_time: '13:00', to_time: '15:00' });
  assert.equal(r.status, 200);
  r = await thu.get('/schedule?date=' + d2);
  assert.equal(r.data.offs.filter((o) => o.status === 'approved').length, 1, 'nhân viên thấy lịch nghỉ đã duyệt của người khác + đơn của mình');

  // Chấm công: chưa cài → từ chối; Lãnh đạo cài wifi tiệm → chấm được; GPS xa → từ chối
  assert.equal((await thu.post('/attendance', { kind: 'in' })).status, 400);
  assert.equal((await mgr.post('/attendance/setup', { use: 'wifi' })).status, 403);
  assert.equal((await owner.post('/attendance/setup', { use: 'gps', lat: 21.0285, lng: 105.8542, shop_radius: 150 })).status, 200);
  r = await thu.post('/attendance', { kind: 'in', lat: 21.04, lng: 105.86, accuracy: 20 });
  assert.equal(r.status, 400); assert.match(r.data.error, /cách tiệm/);
  r = await thu.post('/attendance', { kind: 'in', lat: 21.0287, lng: 105.8543, accuracy: 15 });
  assert.equal(r.status, 200); assert.equal(r.data.method, 'gps');
  assert.equal((await thu.post('/attendance', { kind: 'in', lat: 21.0287, lng: 105.8543, accuracy: 15 })).status, 400, 'chấm trùng');
  await owner.post('/attendance/setup', { use: 'wifi' });
  r = await thu.post('/attendance', { kind: 'out' });
  assert.equal(r.status, 200); assert.equal(r.data.method, 'wifi');
  assert.equal((await thu.post('/attendance/manual', { user_id: staff['Chị Thu'], date: d2, kind: 'in', time: '09:00', note: 'x' })).status, 403);
  assert.equal((await mgr.post('/attendance/manual', { user_id: staff['Thoại'], date: d2, kind: 'in', time: '09:30' })).status, 400, 'chấm hộ phải có lý do');
  r = await thu.get('/attendance/report');
  assert.ok(r.data.summary.every((p) => p.user_id === staff['Chị Thu']), 'nhân viên chỉ thấy công của mình');
  assert.equal(r.data.summary[0].days, 1);

  // Khách vãng lai đặt lịch → Thu tiền tự tạo hồ sơ; lịch hiện số tiền đã thu, nhân viên khác không thấy tiền
  const d3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  r = await thu.post('/appointments', { guest_name: 'C Hương', guest_phone: '0983059659', staff_id: staff['Chị Thu'], date: d3, time: '09:30', service: 'Cắt tóc nữ – Director' });
  const apId = r.data.id;
  r = await thu.post(`/appointments/${apId}/customer`);
  assert.equal(r.data.created, true); assert.equal(r.data.name, 'C Hương');
  const huong = r.data.id;
  assert.equal((await thu.post(`/appointments/${apId}/customer`)).data.id, huong, 'gọi lại không tạo trùng');
  const cutM = (await thu.get('/services')).data.find((x) => x.name === 'Cắt tóc nữ – Director');
  r = await mgr.post('/visits', { customer_id: huong, date: d3, time: '09:30', main_staff_id: staff['Chị Thu'], appointment_id: apId, items: [{ service_id: cutM.id }], payment_method: 'Tiền mặt' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await thu.get(`/appointments?from=${d3}&to=${d3}`);
  const ap = r.data.find((x) => x.id === apId);
  assert.equal(ap.status, 'done'); assert.equal(ap.visit_total, cutM.price); assert.equal(ap.visit_services, 'Cắt tóc nữ – Director');
  assert.equal((await nv6.get(`/appointments?from=${d3}&to=${d3}`)).data.find((x) => x.id === apId).visit_total, null, 'thợ khác không thấy tiền');

  // Kho & giá cốt: nhập hóa chất, định mức, ghi hóa chất ở phiếu thu, bán sản phẩm tên thật; nhân viên không thấy giá vốn
  assert.equal((await thu.post('/materials', { name: 'Màu X 100ml', kind: 'service' })).status, 403);
  const color = (await mgr.post('/materials', { name: 'Màu X', kind: 'service', unit: 'Tuýp', size: 100, size_unit: 'ml' })).data.id;
  const oxy = (await mgr.post('/materials', { name: 'Oxy 6%', kind: 'service', unit: 'Chai', size: 1000, size_unit: 'ml' })).data.id;
  const shampoo = (await mgr.post('/materials', { name: 'Dầu gội Y 250ml', kind: 'retail', unit: 'Chai', sell_price: 450000 })).data.id;
  await mgr.post(`/materials/${color}/move`, { kind: 'in', qty: 10, unit_cost: 200000 });
  await mgr.post(`/materials/${color}/move`, { kind: 'in', qty: 10, unit_cost: 100000 });
  await mgr.post(`/materials/${oxy}/move`, { kind: 'in', qty: 2, unit_cost: 300000 });
  await mgr.post(`/materials/${shampoo}/move`, { kind: 'in', qty: 6, unit_cost: 250000 });
  const dye = (await mgr.get('/services')).data.find((x) => x.name === 'Nhuộm');
  assert.equal((await mgr.put('/recipes/' + dye.id, { lines: [{ material_id: color, qty: 0.6 }, { material_id: oxy, qty: 0.09 }] })).status, 200);
  assert.equal((await mgr.get('/recipes')).data.find((x) => x.material_id === color).cost, 90000, 'giá vốn bình quân 150k × 0,6 tuýp');
  assert.equal((await thu.get('/recipes')).data[0].cost, undefined, 'nhân viên không thấy giá cốt định mức');
  r = await mgr.post('/visits', { customer_id: huong, date: d3, time: '15:00', main_staff_id: staff['Trường'], assistant_id: staff['Chị Thu'], payment_method: 'Tiền mặt',
    items: [{ service_id: dye.id }, { material_id: shampoo, qty: 2 }], materials: [{ material_id: color, qty: 0.6 }, { material_id: oxy, qty: 0.09 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const vid = r.data.id;
  assert.equal(r.data.cost, 90000 + 27000 + 500000, 'hóa chất 117k + 2 chai × 250k');
  assert.equal(r.data.total, dye.price + 900000);
  assert.ok(r.data.items.some((i) => i.name === 'Dầu gội Y 250ml ×2' && i.grp === 'Bán sản phẩm'));
  let mats = (await mgr.get('/materials')).data;
  assert.equal(mats.find((m) => m.id === color).stock, 19.4); assert.equal(mats.find((m) => m.id === shampoo).stock, 4);
  const tv = (await thu.get('/visits/' + vid)).data;
  assert.equal(tv.cost, null, 'thợ phụ không thấy giá cốt'); assert.equal(tv.materials[0].unit_cost, null); assert.equal(tv.materials.length, 2);
  assert.equal((await thu.get('/materials')).data.find((m) => m.id === color).avg_cost, undefined, 'nhân viên không thấy giá vốn');
  assert.equal((await thu.get('/reports/cost')).status, 403);
  r = await mgr.get(`/reports/cost?from=${d3}&to=${d3}`);
  assert.equal(r.data.summary.use_cost, 117000); assert.equal(r.data.summary.product_cost, 500000); assert.equal(r.data.summary.product_revenue, 900000);
  // Sửa lượt không gửi hóa chất → giữ nguyên; xóa lượt → trả lại kho
  await mgr.put('/visits/' + vid, { customer_id: huong, date: d3, time: '15:00', main_staff_id: staff['Trường'], payment_method: 'Tiền mặt', items: [{ service_id: dye.id }] });
  mats = (await mgr.get('/materials')).data;
  assert.equal(mats.find((m) => m.id === color).stock, 19.4); assert.equal(mats.find((m) => m.id === shampoo).stock, 6);
  await mgr.del('/visits/' + vid, { reason: 'test' });
  assert.equal((await mgr.get('/materials')).data.find((m) => m.id === color).stock, 20);

  // Quyền kho: Thu + Dương xem tồn (không giá), Dương kiểm kho, Thu được báo hàng hết; người khác không xem được
  assert.equal((await thu.get('/me')).data.user.stock_view, true); assert.equal((await thu.get('/me')).data.user.stock_count, false);
  assert.equal((await duong.get('/me')).data.user.stock_count, true);
  assert.equal((await nv6.get('/stock/levels')).status, 403);
  let lv = (await thu.get('/stock/levels')).data;
  assert.equal(lv.find((m) => m.id === color).stock, 20); assert.ok(lv.every((m) => m.avg_cost === undefined && m.unit_cost === undefined));
  assert.equal((await thu.post('/stock/count', { lines: [{ material_id: color, counted: 18 }] })).status, 403, 'Thu không kiểm kho');
  r = await duong.post('/stock/count', { lines: [{ material_id: color, counted: 18 }, { material_id: oxy, counted: '' }], note: 'test' });
  assert.equal(r.status, 200); assert.equal(r.data.counted, 1); assert.equal(r.data.diffs[0].diff, -2);
  assert.equal((await mgr.get('/materials')).data.find((m) => m.id === color).stock, 18);
  await thu.put(`/stock/${color}/min`, { min_qty: 18 });
  let rem = (await thu.get('/reminders')).data;
  assert.ok(rem.stock.some((m) => m.id === color && m.status === 'low')); assert.ok(rem.counts.stock >= 1);
  assert.equal((await nv6.get('/reminders')).data.stock, undefined, 'người không có quyền kho không nhận nhắc hàng');
  await thu.post(`/stock/${color}/ordered`, {});
  rem = (await thu.get('/reminders')).data;
  assert.ok(rem.stock.find((m) => m.id === color).ordered_at);
  await mgr.put(`/stock/${color}/min`, { min_qty: '' });

  // Thợ phụ trách + công thức khách: lượt có công thức → lưu vào hồ sơ; lọc "khách của tôi"; nhân viên không đổi được thợ phụ trách
  r = await mgr.post('/visits', { customer_id: huong, date: d3, time: '16:00', main_staff_id: staff['Chị Thu'], payment_method: 'Tiền mặt', items: [{ service_id: dye.id }], formula: 'Milbon 7NB 30g + oxy 6% 1:1,5' });
  assert.equal(r.status, 200);
  let br = (await thu.get(`/customers/${huong}/brief`)).data;
  assert.equal(br.formula, 'Milbon 7NB 30g + oxy 6% 1:1,5'); assert.equal(br.staff_id, staff['Chị Thu'], 'khách chưa có thợ → gán thợ làm lượt đầu');
  assert.ok((await thu.get('/customers?staff_id=mine')).data.rows.some((c) => c.id === huong));
  assert.ok((await thu.get('/customers?q=7NB')).data.rows.some((c) => c.id === huong), 'tìm khách theo công thức');
  await thu.put('/customers/' + huong, { name: 'C Hương', phone: '0983059659', staff_id: staff['Trường'], formula: 'Milbon 7NB 40g' });
  br = (await thu.get(`/customers/${huong}/brief`)).data;
  assert.equal(br.staff_id, staff['Chị Thu'], 'nhân viên không đổi thợ phụ trách'); assert.equal(br.formula, 'Milbon 7NB 40g');
  await mgr.put('/customers/' + huong, { name: 'C Hương', phone: '0983059659', staff_id: staff['Trường'] });
  br = (await thu.get(`/customers/${huong}/brief`)).data;
  assert.equal(br.staff_id, staff['Trường']); assert.equal(br.formula, 'Milbon 7NB 40g', 'không gửi công thức → giữ nguyên');

  // Chia tip: tip ngày chia đều cho nhóm; ai nghỉ cả ngày (off đã duyệt) không được chia ngày đó
  const tipDay = '2026-03-10', tipDay2 = '2026-03-11';
  const pool = [staff['Chị Thu'], staff['Trường'], staff['Thoại'], staff['Dương']];
  assert.equal((await thu.put('/tips/pool', { user_ids: pool })).status, 403);
  assert.equal((await mgr.put('/tips/pool', { user_ids: pool })).status, 200);
  await mgr.post('/visits', { customer_id: huong, date: tipDay, time: '10:00', main_staff_id: staff['Trường'], payment_method: 'Tiền mặt', items: [{ service_id: cutM.id }], tip: 200000 });
  await mgr.post('/visits', { customer_id: huong, date: tipDay2, time: '10:00', main_staff_id: staff['Trường'], payment_method: 'Tiền mặt', items: [{ service_id: cutM.id }], tip: 90000 });
  await mgr.post('/offs', { user_id: staff['Thoại'], date: tipDay2, reason: 'Nghỉ' });
  await mgr.post('/offs', { user_id: staff['Dương'], date: tipDay2, from_time: '09:00', to_time: '11:00' });
  let tp = (await thu.get('/tips?month=2026-03')).data;
  assert.equal(tp.total_tip, 290000); assert.equal(tp.pay_date, '2026-04-05');
  const sh = (n) => tp.shares.find((x) => x.user_id === staff[n]).amount;
  assert.equal(sh('Thoại'), 50000, 'nghỉ ngày 11 → chỉ nhận 200k/4');
  assert.equal(sh('Trường'), 80000); assert.equal(sh('Dương'), 80000, 'nghỉ vài giờ vẫn chia');
  assert.equal((await mgr.post('/tips/paid', { month: '2026-03', user_id: staff['Thoại'] })).status, 200);
  tp = (await thu.get('/tips?month=2026-03')).data;
  assert.equal(tp.shares.find((x) => x.user_id === staff['Thoại']).paid_amount, 50000);

  // Báo cáo khách phụ trách theo thợ: quản lý thấy tiền, nhân viên chỉ thấy dòng của mình, không có tiền
  let sc = (await mgr.get(`/reports/staff-customers?from=${d3}&to=${d3}`)).data;
  const rowT = sc.rows.find((x) => x.staff_id === staff['Trường']);
  assert.ok(rowT.customers >= 1 && rowT.active_period >= 1 && rowT.avg_spend > 0);
  assert.equal(rowT.return_rate, 1, 'C Hương đã đến nhiều lần');
  sc = (await thu.get(`/reports/staff-customers?from=${d3}&to=${d3}`)).data;
  assert.ok(sc.rows.every((x) => x.staff_id === staff['Chị Thu'] && x.avg_spend === null));
  // Nhắc nhở có thợ phụ trách để lọc "khách của tôi"
  assert.ok('staff_id' in ((await thu.get('/reminders')).data.birthdays[0] || { staff_id: 1 }));
  // Bàn giao khách: chỉ quản lý; chuyển toàn bộ khách của Trường sang Dương rồi trả lại
  assert.equal((await thu.post('/customers/transfer', { from_staff_id: staff['Trường'], to_staff_id: staff['Chị Thu'] })).status, 403);
  assert.equal((await mgr.post('/customers/transfer', { from_staff_id: staff['Trường'], to_staff_id: staff['Trường'] })).status, 400);
  r = await mgr.post('/customers/transfer', { from_staff_id: staff['Trường'], to_staff_id: staff['Dương'] });
  assert.equal(r.status, 200); assert.ok(r.data.count >= 1);
  assert.equal((await thu.get(`/customers/${huong}/brief`)).data.staff_id, staff['Dương']);
  r = await mgr.post('/customers/transfer', { from_staff_id: staff['Dương'], to_staff_id: staff['Trường'], customer_ids: [huong] });
  assert.equal(r.data.count, 1, 'chuyển từng khách được chọn');
  assert.equal((await thu.get(`/customers/${huong}/brief`)).data.staff_id, staff['Trường']);

  // Chat nội bộ: tin đặt lịch → gợi ý; tạo lịch rồi gắn vào tin; tin thường không gợi ý; xóa là xóa hẳn
  let cm = (await thu.post('/chat', { body: 'chị Lan 0912 345 678 mai 9h30 nhuộm với Dương' })).data;
  assert.equal(cm.draft.phone, '0912345678'); assert.equal(cm.draft.time, '09:30'); assert.equal(cm.draft.staff_id, staff['Dương']);
  assert.equal(cm.draft.name, 'Chị Lan'); assert.equal(cm.draft.service, 'Nhuộm'); assert.ok(cm.draft.date > '2000');
  assert.equal((await duong.get('/chat/unread')).data.unread >= 1, true);
  const apC = (await thu.post('/appointments', { guest_name: cm.draft.name, guest_phone: cm.draft.phone, date: cm.draft.date, time: cm.draft.time, staff_id: cm.draft.staff_id, service: cm.draft.service, force: true })).data;
  cm = (await duong.post(`/chat/${cm.id}/link`, { appointment_id: apC.id })).data;
  assert.equal(cm.appointment_id, apC.id); assert.equal(cm.linked_by_name, 'Dương');
  const plain = (await duong.post('/chat', { body: 'chị Thu ơi lấy giúp em hộp màu' })).data;
  assert.equal(plain.draft, null);
  assert.equal((await thu.del('/chat/' + plain.id)).status, 403, 'không xóa tin người khác');
  assert.equal((await duong.del('/chat/' + plain.id)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE id=?').get(plain.id).n, 0, 'xóa hẳn');
  assert.equal((await duong.get('/chat')).data.length, 1);

  // Chi & quỹ: quản lý nạp 1tr; nhân viên ghi chi → chờ duyệt; không duyệt thì không trừ quỹ, phải hoàn
  assert.equal((await thu.post('/expenses', { kind: 'in', amount: 1000000 })).status, 403, 'nhân viên không nạp quỹ');
  await mgr.post('/expenses', { kind: 'in', amount: 1000000, note: 'Quỹ đầu' });
  assert.equal((await thu.post('/expenses', { amount: 50000 })).status, 400, 'phải ghi mua gì');
  const e1 = (await thu.post('/expenses', { amount: '120.000', note: 'Nước suối', category: 'Nước uống, tiếp khách' })).data;
  const e2 = (await duong.post('/expenses', { amount: 300000, note: 'Ăn trưa' })).data;
  let fx = (await thu.get('/expenses')).data;
  assert.equal(fx.balance, 1000000 - 420000); assert.equal(fx.pending_count, 2); assert.equal(fx.can_decide, false);
  assert.equal((await thu.post(`/expenses/${e1.id}/decide`, { status: 'approved' })).status, 403, 'nhân viên không tự duyệt');
  await mgr.post(`/expenses/${e1.id}/decide`, { status: 'approved' });
  assert.equal((await mgr.post(`/expenses/${e2.id}/decide`, { status: 'rejected' })).status, 400, 'không duyệt phải có lý do');
  await mgr.post(`/expenses/${e2.id}/decide`, { status: 'rejected', reason: 'Không phải chi của tiệm' });
  fx = (await mgr.get('/expenses')).data;
  assert.equal(fx.balance, 880000); assert.equal(fx.need_topup, 120000); assert.equal(fx.pending_count, 0);
  assert.equal(fx.refund_due[0].amount, 300000); assert.equal(fx.total_out, 120000);
  assert.equal((await thu.del('/expenses/' + e1.id)).status, 403, 'khoản đã duyệt nhân viên không xóa được');

  // Lịch sử chỉnh sửa: chỉ chủ xem; ghi rõ ô nào đổi, cũ → mới
  assert.equal((await mgr.get('/audit')).status, 403);
  const au = (await owner.get(`/audit?only=edit&user_id=${staff['Chị Thu']}`)).data;
  const ed = au.find((x) => x.action === 'update_customer' && x.entity_id === huong);
  assert.ok(ed && ed.entity_label === 'C Hương');
  assert.deepEqual(JSON.parse(ed.detail).changes.formula, ['Milbon 7NB 30g + oxy 6% 1:1,5', 'Milbon 7NB 40g']);
  assert.ok(au.every((x) => x.user_id === staff['Chị Thu'] && x.action !== 'login'));

  // Tìm kiếm nhanh: theo tên, SĐT, mã thẻ
  r = await thu.get('/search?q=Hương');
  assert.ok(r.data.customers.some((c) => c.id === huong)); assert.ok(r.data.appointments.some((x) => x.id === apId));
  assert.ok((await thu.get('/search?q=059659')).data.customers.some((c) => c.id === huong));
  assert.ok((await thu.get('/search?q=0979143612')).data.cards.length >= 1, 'tìm thẻ theo SĐT chủ thẻ');

  // Khóa tài khoản nghỉ việc → mất phiên ngay
  assert.equal((await owner.put('/users/' + staff['Dương'], { active: false })).status, 200);
  assert.equal((await duong.get('/me')).status, 401);
  assert.equal((await owner.put('/users/' + staff['Vinh'], { role: 'staff' })).status, 400, 'không tự hạ quyền');
});

test('ảnh trước/sau: chỉ nhận ảnh thật, phải đăng nhập mới xem', async () => {
  const c = client();
  await c.post('/login', { username: 'vinh', password: 'moi-vinh' });
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');
  const cookie = await (async () => { const res = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'vinh', password: 'moi-vinh' }) }); return res.headers.get('set-cookie').split(';')[0]; })();
  const fd = new FormData();
  fd.append('kind', 'before');
  fd.append('photos', new Blob([jpg], { type: 'image/jpeg' }), 'a.jpg');
  let res = await fetch(`${base}/customers/${ids.lan}/photos`, { method: 'POST', headers: { Cookie: cookie }, body: fd });
  assert.equal(res.status, 200);
  const { ids: pids } = await res.json();
  const fake = new FormData();
  fake.append('photos', new Blob(['<script>'], { type: 'image/jpeg' }), 'x.jpg');
  res = await fetch(`${base}/customers/${ids.lan}/photos`, { method: 'POST', headers: { Cookie: cookie }, body: fake });
  assert.equal(res.status, 400);
  assert.equal((await fetch(`${base}/photos/${pids[0]}`)).status, 401);
  res = await fetch(`${base}/photos/${pids[0]}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM photos').get().n, 1);
});

test('bán thẻ 2 người: người tư vấn + chia hoa hồng, quản lý sửa tỷ lệ', async () => {
  const thu = client(); await thu.post('/login', { username: 'thu', password: 'moi-thu' });
  const vinh = client(); await vinh.post('/login', { username: 'vinh', password: 'moi-vinh' });
  const staff = Object.fromEntries((await vinh.get('/staff')).data.map((s) => [s.full_name, s.id]));
  const vang = (await thu.get('/card-types')).data.find((t) => t.name === 'Thẻ Vàng');
  let r = await thu.post('/cards', { customer_id: ids.lan, card_type_id: vang.id, consultant_id: staff['Dương'], seller_share: 50, payment_method: 'Tiền mặt' });
  assert.equal(r.status, 200);
  assert.equal(r.data.commission, 125000); assert.equal(r.data.consultant_commission, 125000);
  const id = r.data.id;
  // Nhân viên không được sửa tỷ lệ; quản lý đổi sang 70/30
  assert.equal((await thu.put('/cards/' + id, { seller_id: staff['Chị Thu'], consultant_id: staff['Dương'], seller_share: 30 })).status, 403);
  r = await vinh.put('/cards/' + id, { seller_id: staff['Chị Thu'], consultant_id: staff['Dương'], seller_share: 70 });
  assert.equal(r.status, 200);
  const c = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
  assert.equal(c.commission, 175000); assert.equal(c.consultant_commission, 75000);
  // Báo cáo: mỗi người nhận đúng phần mình
  const d = c.sold_at;
  const rep = (await vinh.get(`/reports/sales?from=${d}&to=${d}`)).data;
  const duong = rep.rows.find((x) => x.user_id === staff['Dương']);
  assert.ok(duong.card_commission >= 75000);
  // Nhân viên khác chỉ thấy HH của mình
  const list = (await thu.get('/cards?customer_id=' + ids.lan)).data.find((x) => x.id === id);
  assert.equal(list.commission, 175000); assert.equal(list.consultant_commission, null);
  // Khách tự nạp: tính 100% cho thợ phụ trách (người chốt 0%)
  r = await thu.post('/cards', { customer_id: ids.lan, card_type_id: vang.id, sale_type: 'renewal', consultant_id: staff['Trường'], seller_share: 0, payment_method: 'Tiền mặt' });
  assert.equal(r.data.commission, 0); assert.equal(r.data.consultant_commission, 150000);
});

test('lượt nhập từ Excel không có hình thức TT: chủ vẫn sửa được tip', async () => {
  const vinh = client(); await vinh.post('/login', { username: 'vinh', password: 'moi-vinh' });
  const v = db.prepare("SELECT * FROM visits WHERE status='done' AND card_paid=0 ORDER BY id LIMIT 1").get();
  db.prepare('UPDATE visits SET payment_method=NULL WHERE id=?').run(v.id);
  const full = (await vinh.get('/visits/' + v.id)).data;
  const r = await vinh.put('/visits/' + v.id, { ...full, payment_method: '', tip: 77000, items: full.items.map((i) => ({ service_id: i.service_id, name: i.name, price: i.price })) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(db.prepare('SELECT tip FROM visits WHERE id=?').get(v.id).tip, 77000);
});
