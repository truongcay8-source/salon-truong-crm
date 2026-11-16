'use strict';
const os = require('os'); const fs = require('fs'); const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-act-'));
process.env.NODE_ENV = 'test';
process.env.SEED_PASSWORD = 'tam12345';
require('../server/index');
const { db } = require('../server/db');
const A = require('../server/chatact');
const C = require('../server/chat');

test('chat → việc: chi quỹ, báo hết hàng, xin nghỉ, khách đến, @tên', () => {
  const ctx = C.ctxNow(); ctx.today = '2026-11-16';
  const u = (n) => ctx.staff.find((x) => x.full_name.includes(n)).id;
  // chi quỹ
  let a = A.parseAction('mua đá 30k', ctx, u('Dương'));
  assert.equal(a.kind, 'expense'); assert.equal(a.amount, 30000);
  assert.equal(A.parseAction('đóng tiền điện 1tr2', ctx, 1).amount, 1200000);
  assert.equal(A.parseAction('khách chuyển khoản 500k rồi', ctx, 1), null, 'tiền khách trả không phải chi quỹ');
  assert.equal(A.parseAction('chị Lan nạp thẻ 2tr', ctx, 1), null);
  // báo hết hàng
  db.prepare("INSERT INTO materials(code,name,kind,grp,unit) VALUES ('VT9001','Dầu gội Milbon Smooth 500ml','retail','Gội','chai')").run();
  a = A.parseAction('hết dầu gội milbon rồi chị Thu ơi', ctx, 1);
  assert.equal(a.kind, 'stock'); assert.match(a.candidates[0].name, /Milbon/);
  // xin nghỉ
  a = A.parseAction('mai em xin nghỉ buổi chiều', ctx, u('Thoại'));
  assert.deepEqual([a.kind, a.user_id, a.date, a.from_time], ['off', u('Thoại'), '2026-11-17', '13:00']);
  a = A.parseAction('Dương nghỉ thứ 7 nhé', ctx, u('Trường'));
  assert.deepEqual([a.user_id, a.date], [u('Dương'), '2026-11-21']);
  // khách đến
  db.prepare("INSERT INTO appointments(guest_name,date,time,status,created_by) VALUES ('Chị Lan Anh',?,'10:00','booked',1)").run(require('../server/logic').today());
  const real = C.ctxNow();
  a = A.parseAction('c Lan đến rồi nhé', real, 1);
  assert.equal(a.kind, 'arrived'); assert.equal(a.candidates[0].name, 'Chị Lan Anh');
  // @tên
  assert.deepEqual(A.parseMentions('@Dương mai em mở cửa nhé', ctx), [u('Dương')]);
  assert.equal(A.parseMentions('@all họp 5 phút', ctx).length, ctx.staff.length);
  // tin thường không thành việc
  assert.equal(A.parseAction('hôm nay đông khách quá', ctx, 1), null);
});

test('bấm ✓: ghi chi quỹ chờ duyệt, báo kho, xin nghỉ', () => {
  const thoai = db.prepare("SELECT * FROM users WHERE full_name LIKE '%Thoại%'").get();
  const ins = (body, action) => db.prepare('INSERT INTO chat_messages(user_id,body,action) VALUES (?,?,?)').run(thoai.id, body, JSON.stringify(action)).lastInsertRowid;
  const get = (id) => db.prepare('SELECT * FROM chat_messages WHERE id=?').get(id);
  let id = ins('mua đá 30k', { kind: 'expense', amount: 30000, note: 'mua đá 30k', category: 'Khác' });
  let r = A.apply(get(id), {}, thoai);
  assert.match(r.text, /chờ quản lý duyệt/);
  assert.equal(db.prepare("SELECT status FROM expenses WHERE note LIKE 'mua đá%'").get().status, 'pending');
  const mid = db.prepare("SELECT id FROM materials WHERE code='VT9001'").get().id;
  id = ins('hết dầu gội milbon', { kind: 'stock', level: 'out', text: 'dau goi milbon', candidates: [{ id: mid, name: 'x' }] });
  A.apply(get(id), {}, thoai);
  const lv = require('../server/stock').stockAlerts().find((m) => m.id === mid);
  assert.ok(lv && lv.status !== 'ok');
  id = ins('mai em xin nghỉ', { kind: 'off', user_id: thoai.id, date: '2030-01-02', from_time: null, to_time: null });
  r = A.apply(get(id), {}, thoai);
  assert.match(r.text, /chờ duyệt/);
  const duong = db.prepare("SELECT * FROM users WHERE full_name LIKE '%Dương%'").get();
  id = ins('Thoại nghỉ mai', { kind: 'off', user_id: thoai.id, date: '2030-01-03' });
  assert.throws(() => A.apply(get(id), {}, duong), /người xin nghỉ|chính mình/);
});

test('lịch hẹn trùng do sửa chữ trong ô sổ: gộp lại, giữ lịch đã thu tiền', () => {
  const I = require('../server/importer');
  assert.equal(I.apptKey('A thái uk 685'), I.apptKey('A thái uk'));
  assert.equal(I.apptKey('Thảo Đặng 300'), I.apptKey('Thảo Đặng'));
  assert.notEqual(I.apptKey('C Lan'), I.apptKey('C Hoa'));
  const d = require('../server/logic').today();
  const ins = db.prepare("INSERT INTO appointments(guest_name,staff_id,date,time,status,note,pay_note,created_by) VALUES (?,2,?,'09:30',?,?,?,1)");
  const done = ins.run('A thái uk', d, 'done', 'A thái uk', null).lastInsertRowid;
  const dup = ins.run('A thái uk', d, 'booked', 'A thái uk 685', 'Chuyển khoản').lastInsertRowid;
  const other = ins.run('C Hoa', d, 'booked', 'C Hoa', null).lastInsertRowid;
  assert.equal(I.dedupeAppointments(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM appointments WHERE id=?').get(dup).n, 0);
  const k = db.prepare('SELECT * FROM appointments WHERE id=?').get(done);
  assert.equal(k.status, 'done'); assert.equal(k.note, 'A thái uk 685'); assert.equal(k.pay_note, 'Chuyển khoản');
  assert.ok(db.prepare('SELECT 1 FROM appointments WHERE id=?').get(other));
});
