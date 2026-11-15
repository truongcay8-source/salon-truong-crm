'use strict';
const test = require('node:test');
const assert = require('node:assert');
const B = require('../server/bookmoney');
const SV = [
  { id: 1, name: 'Cắt tóc nam – Director', price: 685000, active: 1 }, { id: 2, name: 'Cắt tóc nữ – Director', price: 785000, active: 1 },
  { id: 3, name: 'Uốn / Duỗi – M (ngang vai)', price: 1551000, active: 1 }, { id: 4, name: 'Gội', price: 100000, active: 1 },
  { id: 5, name: 'Ủ lạnh', price: 160000, active: 1 }, { id: 6, name: 'Tạo kiểu bằng máy/lược (100/120/150)', price: 100000, active: 1 }, { id: 7, name: 'Tạo kiểu nam (50/70/100)', price: 50000, active: 1 },
];
const by = (n) => SV.find((x) => x.name === n);
const T = { level: 'Director' };

test('sổ đặt lịch: tách tiền dòng, khách trả dư nhỏ → tip chung', () => {
  const e = { text: 'a thành(Thu)' }; e.parsed = B.parseEntry(e.text, T, by, SV, 700000);
  B.splitRow({ amount: 700000, tip: 0, entries: [e] });
  assert.equal(e.amount, 685000); assert.equal(e.tip, 15000);
  const f = { text: 'Phương vợ Khánh(Thu)' }; f.parsed = B.parseEntry(f.text, T, by, SV, 785000);
  B.splitRow({ amount: 785000, tip: 0, entries: [f] });
  assert.equal(f.parsed.items[0].name, 'Cắt tóc nữ – Director'); assert.equal(f.tip, 0);
});
test('sổ đặt lịch: số tiền ghi tay', () => {
  assert.deepEqual(B.amounts('a Dũng 685k + tông đơ 1tr086k').list.map((x) => x.v), [685000, 1086000]);
  assert.deepEqual(B.amounts('Hà 0972178632 cắt lúc 17:00').list, []);
  const p = B.parseEntry('Châu Anh gội 100+ủ lạnh 160+tk 100', null, by, SV);
  assert.equal(p.explicit, 360000); assert.deepEqual(Object.fromEntries(p.items.map((i) => [i.name, i.price])), { 'Gội': 100000, 'Ủ lạnh': 160000, 'Tạo kiểu nam (50/70/100)': 100000 });
  assert.equal(B.cleanName('Lê Anh | 0888788858 | uốn 1tr (Thu)'), 'Lê Anh');
});
