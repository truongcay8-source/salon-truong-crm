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
