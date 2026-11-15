'use strict';
// Công thức thợ gửi qua Messenger nhóm "Thông tin KH" (Vinh gửi ảnh 15/11/2026) → hồ sơ khách + lượt làm.
// Chạy khi khởi động và sau mỗi lần nhập Excel; chỉ ghi khi chưa có, không đè sửa tay.
const { db, audit } = require('./db');

const RECORDS = [
  { date: '2026-11-07', phone: '0972178632', name: 'Chị Hà', note: 'Hòa Bình', staff: 'Dương',
    hair_before: 'Tóc tự nhiên 1cm. Thân ngọn lv 9 ánh cam', wish: 'Màu nâu lạnh / trầm nhiều',
    formula: 'B9cb 25ml + 9graypearl 15ml + 9cobalt blue 10ml, oxi 20.\nChấm chân để 15\' sau đó chải toàn bộ thân ngọn để 15\'',
    result: 'Màu vẫn hơi ấm, tầm lv 5,5. Sau dùng thêm mix blue' },
  { date: '2026-11-09', phone: '0935188866', name: 'Chị Khánh Linh', note: 'Mẹ bé Alex', staff: 'Dương',
    hair_before: '10cm tóc mới nhuộm lv 12 ánh vàng. Thân ngọn nâu ấm lv 9',
    formula: 'Hạ 10cm phần mới nhuộm: 9nb 35ml + 7glca 25ml + 8glvi 20ml, oxi 10.\nChấm chân xong chải 10cm phần tóc vàng để 20\' xả',
    result: 'Kết quả ok' },
];

function apply() {
  const done = [];
  const staff = (n) => (db.prepare('SELECT id FROM users WHERE full_name=?').get(n) || {}).id || null;
  for (const r of RECORDS) {
    let c = db.prepare('SELECT * FROM customers WHERE phone=? AND deleted=0').get(r.phone);
    if (!c) continue; // chưa có khách này (chưa nhập sổ) → lần nhập sau sẽ bổ sung
    const by = staff(r.staff);
    if (!c.formula || (c.formula_at || '') < r.date) {
      db.prepare('UPDATE customers SET formula=?, formula_at=?, formula_by=? WHERE id=?').run(r.formula, r.date, by, c.id);
      done.push(c.name);
    }
    if (r.note && !String(c.notes || '').includes(r.note)) db.prepare('UPDATE customers SET notes=? WHERE id=?').run(c.notes ? c.notes + '\n' + r.note : r.note, c.id);
    // Lượt làm hóa chất cùng ngày của khách này: điền công thức/kết quả nếu còn trống
    const v = db.prepare(`SELECT v.id FROM visits v WHERE v.customer_id=? AND v.date=? AND v.status='done' AND (v.formula IS NULL OR v.formula='')
      ORDER BY EXISTS (SELECT 1 FROM visit_items i WHERE i.visit_id=v.id AND i.grp='Hóa chất') DESC, v.total DESC LIMIT 1`).get(c.id, r.date);
    if (v) db.prepare(`UPDATE visits SET formula=?, result=COALESCE(NULLIF(result,''),?), hair_before=COALESCE(NULLIF(hair_before,''),?), wish=COALESCE(NULLIF(wish,''),?) WHERE id=?`)
      .run(r.formula, r.result, r.hair_before, r.wish || null, v.id);
  }
  if (done.length) {
    const owner = db.prepare("SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1").get();
    if (owner) audit(owner.id, 'formula_fix', 'customer', null, { customers: done });
  }
  return done;
}
module.exports = { apply, RECORDS };
