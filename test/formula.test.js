'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseFormula } = require('../public/formula.js');

const M = [
  { id: 1, name: 'Màu Milbon Ordeve', kind: 'service', size: 80, size_unit: 'g', formula_keys: 'ordeve', formula_default: 1 },
  { id: 2, name: 'Màu Milbon Addicthy', kind: 'service', size: 80, size_unit: 'g', formula_keys: 'addicthy,graypearl,cobalt,colbalt,blue' },
  { id: 3, name: 'Nước pha thuốc nhuộm Activator 20vol – 900ml', kind: 'service', size: 900, size_unit: 'ml' },
  { id: 4, name: 'Nước pha thuốc nhuộm Activator 10vol – 900ml', kind: 'service', size: 900, size_unit: 'ml' },
  { id: 5, name: 'Màu Jaas', kind: 'service', size: null, formula_keys: 'jaas' },
];

test('công thức chị Hà: màu + oxi 20 tự tính theo lượng màu', () => {
  const r = parseFormula('Thân ngọn lv 9 ánh cam\nB9cb 25ml 9graypearl 15ml\n9colbalt blue 10ml oxi 20\nchấm chân để 15′', M);
  const by = Object.fromEntries(r.lines.map((l) => [l.material_id, l.amt]));
  assert.deepEqual(by, { 1: 25, 2: 25, 3: 50 });
  assert.equal(r.unknown.length, 0);
});

test('công thức chị Khánh Linh: số tông → màu mặc định, oxi 10, bỏ qua 10cm', () => {
  const r = parseFormula('10cm tóc mới nhuộm lv 12\nHạ 10cm phần mới nhuộm:\n9nb 35ml 7glca 25ml 8glvi 20ml oxi 10 chấm chân để 20′', M);
  const by = Object.fromEntries(r.lines.map((l) => [l.material_id, l.amt]));
  assert.deepEqual(by, { 1: 80, 4: 80 });
});

test('tỷ lệ 1:1,5, oxi ghi %, hóa chất chưa khai dung tích thì cảnh báo', () => {
  let r = parseFormula('Ordeve 7-NB 30g + Addicthy silver 10g, oxy 6% 1:1,5', M);
  assert.deepEqual(Object.fromEntries(r.lines.map((l) => [l.material_id, l.amt])), { 1: 30, 2: 10, 3: 60 });
  r = parseFormula('jaas 8.0 40ml', M);
  assert.equal(r.lines.length, 0); assert.match(r.warn[0], /dung tích/);
});
