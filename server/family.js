'use strict';
// Người nhà / người đi cùng: gom khách vào 1 nhóm gia đình (family_id = id khách gốc), mỗi người ghi quan hệ.
// Gợi ý tự động từ tên khách ghi trong sổ: "Phương vợ Khánh", "Lệ bạn Hà", "Alex (con Khánh Linh)", "cháu Nhung"…
const { db } = require('./db');

const cols = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
if (!cols.includes('family_id')) db.exec('ALTER TABLE customers ADD COLUMN family_id INTEGER; ALTER TABLE customers ADD COLUMN relation TEXT; CREATE INDEX IF NOT EXISTS idx_customers_family ON customers(family_id)');
db.exec('CREATE TABLE IF NOT EXISTS family_ignore (a INTEGER NOT NULL, b INTEGER NOT NULL, PRIMARY KEY (a,b))');

const RELATIONS = ['vợ', 'chồng', 'con', 'bố', 'mẹ', 'anh', 'chị', 'em', 'cháu', 'ông', 'bà', 'cô/dì/chú/bác', 'họ hàng', 'người yêu', 'bạn', 'đồng nghiệp', 'đi cùng'];

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const TITLE = /^(?:chi|anh|em|c|a|e|co|chu|bac|ong|ba|b)\s+/;
function core(name) {
  return fold(name).replace(/\(.*?\)/g, ' ').replace(/[0-9]+/g, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// "x <quan hệ> (của) <tên>" → { rel, target }. Không dùng "anh"/"chi" đứng riêng vì hay là tên (Quỳnh Anh, Mai Chi).
const REL_WORDS = [
  ['vo', 'vợ'], ['chong', 'chồng'], ['con gai', 'con'], ['con trai', 'con'], ['con', 'con'], ['bo', 'bố'], ['me', 'mẹ'],
  ['chi gai', 'chị'], ['c gai', 'chị'], ['em gai', 'em'], ['e gai', 'em'], ['em trai', 'em'], ['e trai', 'em'], ['anh trai', 'anh'], ['a trai', 'anh'],
  ['chau', 'cháu'], ['ba noi', 'bà'], ['ba ngoai', 'bà'], ['ong noi', 'ông'], ['ong ngoai', 'ông'], ['di', 'cô/dì/chú/bác'], ['chu', 'cô/dì/chú/bác'], ['bac', 'cô/dì/chú/bác'],
  ['nguoi yeu', 'người yêu'], ['ban gai', 'người yêu'], ['ban trai', 'người yêu'], ['ck', 'chồng'], ['vk', 'vợ'], ['di cung', 'đi cùng'], ['ny', 'người yêu'], ['ban', 'bạn'], ['b', 'bạn'], ['dong nghiep', 'đồng nghiệp'], ['hang xom', 'bạn'],
  ['em', 'em'], ['e', 'em'], ['a', 'anh'], ['c', 'chị'],
].sort((x, y) => y[0].length - x[0].length);
const LEAD_OK = /^(ban gai|ban trai|c gai|chi gai|em gai|e gai|em trai|e trai|anh trai|a trai|chau|con gai|con trai|con|vo|chong|me|bo|ban|nguoi yeu|ny)$/;
const SHORT_TITLE = new Set(['c', 'a', 'e', 'chi', 'anh', 'em', 'co', 'chu', 'bac', 'b', 'be']);
const relAt = (words, i) => { const rest = words.slice(i).join(' '); return REL_WORDS.find(([w]) => rest === w || rest.startsWith(w + ' ')); };
const cleanTarget = (ws) => { const t = ws.filter((w) => w !== 'cua'); while (t.length > 1 && SHORT_TITLE.has(t[0])) t.shift(); return t.slice(0, 3).join(' '); };
function parseRelation(name) {
  const raw = fold(name);
  const paren = raw.match(/\(([^)]*)\)/);
  if (paren) {
    const w = core(paren[1]).split(' ').filter(Boolean);
    const hit = w.length > 1 && relAt(w, 0);
    if (hit) { const t = cleanTarget(w.slice(hit[0].split(' ').length)); if (t.length >= 2) return { rel: hit[1], target: t }; }
  }
  const words = core(name).split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const ci = words.indexOf('cua');
  if (ci > 0 && ci < words.length - 1) {
    for (let i = 0; i < ci; i++) { const hit = relAt(words, i); if (hit && (i > 0 || LEAD_OK.test(hit[0]) || hit[0].length > 2)) return { rel: hit[1], target: cleanTarget(words.slice(ci + 1)) }; }
  }
  const h0 = relAt(words, 0);
  if (h0 && LEAD_OK.test(h0[0]) && !(h0[0] === 'chau' && !/^cháu/i.test(String(name).trim()))) { const t = cleanTarget(words.slice(h0[0].split(' ').length)); if (t.length >= 2) return { rel: h0[1], target: t }; }
  let start = SHORT_TITLE.has(words[0]) && words.length > 2 ? 1 : 0;
  for (let i = start + 1; i < words.length - 1; i++) {
    const hit = relAt(words, i);
    if (!hit) continue;
    const t = cleanTarget(words.slice(i + hit[0].split(' ').length));
    if (t.length >= 2) return { rel: hit[1], target: t };
  }
  return null;
}

function familyOf(id) {
  const c = db.prepare('SELECT id, family_id FROM customers WHERE id=?').get(id);
  return c ? c.family_id || null : null;
}

function members(id) {
  const fid = familyOf(id);
  if (!fid) return [];
  return db.prepare(`SELECT c.id, c.code, c.name, c.phone, c.relation, c.formula, c.hair_notes,
      (SELECT MAX(date) FROM visits v WHERE v.customer_id=c.id AND v.status='done') last_visit,
      (SELECT COUNT(*) FROM visits v WHERE v.customer_id=c.id AND v.status='done') visits
    FROM customers c WHERE c.family_id=? AND c.id<>? AND c.deleted=0 ORDER BY last_visit DESC`).all(fid, id);
}

// Gắn b vào nhóm của a; relation = b là gì của a (vd "vợ")
function link(aId, bId, relation) {
  if (!aId || !bId || aId === bId) throw new Error('Chọn 2 khách khác nhau');
  const a = db.prepare('SELECT id, name, family_id FROM customers WHERE id=? AND deleted=0').get(aId);
  const b = db.prepare('SELECT id, name, family_id FROM customers WHERE id=? AND deleted=0').get(bId);
  if (!a || !b) throw new Error('Không tìm thấy khách');
  const fid = a.family_id || b.family_id || a.id;
  db.transaction(() => {
    for (const old of [a.family_id, b.family_id]) if (old && old !== fid) db.prepare('UPDATE customers SET family_id=? WHERE family_id=?').run(fid, old);
    db.prepare('UPDATE customers SET family_id=? WHERE id IN (?,?)').run(fid, a.id, b.id);
    if (relation) db.prepare('UPDATE customers SET relation=? WHERE id=?').run(`${relation} của ${a.name}`, b.id);
  })();
  return fid;
}

function unlink(id) {
  const fid = familyOf(id);
  db.prepare('UPDATE customers SET family_id=NULL, relation=NULL WHERE id=?').run(id);
  if (fid) {
    const left = db.prepare('SELECT id FROM customers WHERE family_id=?').all(fid);
    if (left.length === 1) db.prepare('UPDATE customers SET family_id=NULL, relation=NULL WHERE id=?').run(left[0].id);
  }
}

// Gợi ý: khách có tên chứa quan hệ + tên một khách khác
function suggest(limit = 50) {
  const all = db.prepare('SELECT id, code, name, phone, family_id FROM customers WHERE deleted=0').all();
  const byCore = all.map((c) => ({ ...c, k: core(c.name).replace(TITLE, '') }));
  const ignored = new Set(db.prepare('SELECT a, b FROM family_ignore').all().map((r) => r.a + ':' + r.b));
  const out = [];
  for (const c of all) {
    const p = parseRelation(c.name);
    if (!p) continue;
    const cands = byCore.filter((o) => o.id !== c.id && o.k && (o.k === p.target || o.k.split(' ')[0] === p.target.split(' ')[0] && p.target.split(' ').length === 1 || o.k.startsWith(p.target + ' ')));
    cands.sort((x, y) => (x.k === p.target ? 0 : 1) - (y.k === p.target ? 0 : 1));
    const best = cands.filter((o) => !(o.family_id && o.family_id === c.family_id) && !ignored.has(o.id + ':' + c.id)).slice(0, 3);
    if (!best.length) continue;
    out.push({ id: c.id, code: c.code, name: c.name, phone: c.phone, relation: p.rel, target: p.target,
      candidates: best.map((o) => ({ id: o.id, code: o.code, name: o.name, phone: o.phone })) });
    if (out.length >= limit) break;
  }
  return out;
}
function ignore(aId, bId) { db.prepare('INSERT OR IGNORE INTO family_ignore(a,b) VALUES (?,?)').run(aId, bId); }

module.exports = { RELATIONS, parseRelation, members, link, unlink, suggest, ignore, core };
