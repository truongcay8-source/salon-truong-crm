'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path'); const fs = require('fs');
process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'gs-'));
const g = require('../server/gsync');

test('Google Sheet: đọc mã sheet từ link, báo lỗi khi sheet chưa chia sẻ', async () => {
  assert.equal(g.sheetId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
  assert.equal(g.sheetId('https://example.com/x'), null);
  assert.throws(() => g.save({ url: 'abc' }));
  g.save({ url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit', auto: false });
  assert.equal(g.state().auto, false);
  const orig = global.fetch;
  global.fetch = async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  try { await assert.rejects(g.run({ force: true }), /chia sẻ|Chia sẻ/); } finally { global.fetch = orig; }
  assert.match(g.state().last_error, /Chia sẻ/);
});
