'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-w-'));
const W = require('../server/warranty');

test('bảo hành theo chính sách bảng giá 15/11/2026', () => {
  const ws = W.forItems('2026-11-15', [
    { name: 'Nhuộm tóc – M (ngang vai)', grp: 'Hóa chất' }, { name: 'Uốn / Duỗi – L (qua vai)', grp: 'Hóa chất' },
    { name: 'Cắt tóc nam – Junior', grp: 'Cắt' }, { name: 'Cắt mái – Director', grp: 'Cắt' },
    { name: 'Rửa mặt tẩy da chết', grp: 'Gội & chăm sóc' }, { name: 'Gội', grp: 'Gội & chăm sóc' },
  ]);
  const by = Object.fromEntries(ws.map((w) => [w.key, w.until]));
  assert.deepEqual(by, { color: '2026-11-30', perm: '2026-12-05', cut_m: '2026-11-18', cut_f: '2026-11-22' });
});
