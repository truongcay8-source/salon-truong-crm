'use strict';
// Bảng giá Nếp Hair áp dụng từ 15/11/2026 (đơn vị nghìn đồng trên bảng in → lưu đồng).
// Chạy 1 lần khi khởi động: sửa giá dịch vụ đang có (khớp theo tên), thêm dịch vụ mới, ngừng các dịch vụ chung đã tách theo độ dài tóc.
// Lượt làm cũ giữ nguyên giá đã thu (giá lưu trong từng lượt).
const { db, audit } = require('./db');

const KEY = 'price_list_2026_11_15';
const SIZES = [['S', 'tóc ngắn'], ['M', 'ngang vai'], ['L', 'qua vai'], ['XL', 'qua lưng']];

// [nhóm, tên, giá (nghìn), % hoa hồng cho dịch vụ MỚI, tên cũ để đổi tên]
const LIST = [
  ['Cắt', 'Cắt tóc nữ – Director', 785, 0.03], ['Cắt', 'Cắt tóc nam – Director', 685, 0.03], ['Cắt', 'Cắt mái – Director', 150, 0.03, 'Cắt mái'],
  ['Cắt', 'Cắt tóc nữ – Senior', 480, 0.03], ['Cắt', 'Cắt tóc nam – Senior', 360, 0.03], ['Cắt', 'Cắt mái – Senior', 100, 0.03],
  ['Cắt', 'Cắt tóc nữ – Stylist', 360, 0.03], ['Cắt', 'Cắt tóc nam – Stylist', 240, 0.03], ['Cắt', 'Cắt mái – Stylist', 70, 0.03],
  ['Cắt', 'Cắt tóc nữ – Junior', 280, 0.03], ['Cắt', 'Cắt tóc nam – Junior', 190, 0.03], ['Cắt', 'Cắt mái – Junior', 50, 0.03],
  ['Gội & chăm sóc', 'Rửa mặt', 60, 0], ['Gội & chăm sóc', 'Rửa mặt tẩy da chết', 120, 0, 'Tẩy da chết mặt'],
  ['Gội & chăm sóc', 'Đắp mặt nạ', 100, 0, 'Đắp mặt nạ (mask)'], ['Gội & chăm sóc', 'Tẩy da chết da đầu', 100, 0],
  ['Gội & chăm sóc', 'Massage đầu', 80, 0], ['Gội & chăm sóc', 'Ủ lạnh', 160, 0], ['Gội & chăm sóc', 'Gội', 100, 0],
  ['Gội & chăm sóc', 'Tạo kiểu bằng máy/lược (100/120/150)', 100, 0.03],
  ['Gội & chăm sóc', 'Combo chăm sóc da mặt & da đầu + ủ lạnh hoặc tẩy da chết da đầu', 450, 0],
  ['Gội & chăm sóc', 'Tạo kiểu nam (50/70/100)', 50, 0.03, 'Tạo kiểu'], ['Gội & chăm sóc', 'Gội đen thảo dược phủ bạc (nam)', 160, 0],
  ['Hóa chất', 'Chấm chân', 900, 0.15], ['Hóa chất', 'Tẩy nối chân (dưới 2cm)', 1000, 0.15], ['Hóa chất', 'Tẩy nối chân (trên 2cm)', 1330, 0.15],
  ['Hóa chất', 'Uốn mái', 500, 0.18], ['Hóa chất', 'Uốn phồng chân', 910, 0.18],
  ['Hóa chất', 'Chữa trị 3 bước Milbon Grand Linkage – trên vai', 870, 0.2], ['Hóa chất', 'Chữa trị 3 bước Milbon Grand Linkage – dưới vai', 1100, 0.2],
  ['Hóa chất', 'Chữa trị 6 bước Number Three 003 – trên vai', 1550, 0.2], ['Hóa chất', 'Chữa trị 6 bước Number Three 003 – dưới vai', 1720, 0.2],
  // Dịch vụ nam (giá tham khảo theo khoảng: lưu giá thấp nhất, sửa khi thu)
  ['Hóa chất', 'Nhuộm nam (700–1.000)', 700, 0.15], ['Hóa chất', 'Tẩy nam (600–800)', 600, 0.15], ['Hóa chất', 'Tẩy nối chân nam (dưới 2cm)', 850, 0.15],
  ['Hóa chất', 'Uốn – Duỗi nam (800–1.200)', 800, 0.18], ['Hóa chất', 'Ép side nam (500–700)', 500, 0.18],
];
// Dịch vụ tính theo độ dài tóc S/M/L/XL
const SIZED = [
  ['Nhuộm tóc', [1100, 1375, 1595, 1837], 0.15], ['Nâng tone (không tẩy)', [750, 825, 910, 1080], 0.15],
  ['Tẩy tóc (gồm dưỡng Olaplex)', [1100, 1330, 1610, 1820], 0.15], ['Glossing (tráng màu)', [1000, 1250, 1450, 1670], 0.15],
  ['Half highlight', [1320, 1450, 1820, 2175], 0.15], ['Full highlight', [1570, 1730, 2280, 2550], 0.15],
  ['Fashion light (tẩy + nhuộm)', [1250, 1530, 1860, 2110], 0.15], ['Glossing light', [860, 1377, 1674, 1899], 0.15],
  ['Balayage', [2800, 3300, 4200, 5100], 0.15], ['Uốn / Duỗi', [1375, 1551, 1782, 2002], 0.18],
  ['Uốn đặc biệt (hippie / xoăn mì)', [1650, 1861, 2138, 2402], 0.18], ['Phục hồi kết hợp uốn / duỗi', [500, 600, 700, 800], 0.2],
];
// Dịch vụ chung cũ đã tách theo độ dài → ngừng (lượt cũ vẫn giữ tên & giá)
const RETIRE = ['Nhuộm', 'Uốn', 'Duỗi', 'Nâng sáng / tẩy', 'Phục hồi / hấp dưỡng'];

function rows() {
  const out = LIST.map(([grp, name, k, rate, old]) => ({ grp, name, price: k * 1000, rate, old }));
  for (const [base, prices, rate] of SIZED) SIZES.forEach(([s, label], i) => out.push({ grp: 'Hóa chất', name: `${base} – ${s} (${label})`, price: prices[i] * 1000, rate }));
  return out;
}

function apply(force) {
  if (!force && db.prepare('SELECT 1 FROM settings WHERE key=?').get(KEY)) return null;
  const byName = db.prepare('SELECT id, price FROM services WHERE name=?');
  const sum = { updated: 0, added: 0, renamed: 0, retired: 0, changes: [] };
  db.transaction(() => {
    for (const r of rows()) {
      let s = byName.get(r.name);
      if (!s && r.old) {
        const o = byName.get(r.old);
        if (o) { db.prepare('UPDATE services SET name=? WHERE id=?').run(r.name, o.id); s = o; sum.renamed++; }
      }
      if (s) {
        if (s.price !== r.price) sum.changes.push([r.name, s.price, r.price]);
        db.prepare('UPDATE services SET price=?, grp=?, active=1 WHERE id=?').run(r.price, r.grp, s.id); sum.updated++;
      } else {
        db.prepare('INSERT INTO services(name,price,grp,commission_rate,active) VALUES (?,?,?,?,1)').run(r.name, r.price, r.grp, r.rate); sum.added++;
      }
    }
    for (const n of RETIRE) sum.retired += db.prepare('UPDATE services SET active=0 WHERE name=? AND active=1').run(n).changes;
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(KEY, new Date().toISOString());
    const owner = db.prepare("SELECT id FROM users WHERE role='owner' ORDER BY id LIMIT 1").get();
    if (owner) audit(owner.id, 'price_list', 'settings', null, { from: '2026-11-15', updated: sum.updated, added: sum.added, retired: sum.retired, changes: sum.changes });
  })();
  return sum;
}

module.exports = { apply, rows, KEY };
