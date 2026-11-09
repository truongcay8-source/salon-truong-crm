'use strict';
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const { db, nextCode, GROUPS } = require('./db');
const L = require('./logic');

const ROLLBACK = Symbol('dry-run');

// ---------- Đọc ô Excel ----------
function cellVal(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellVal(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if (v.error) return null;
    return null;
  }
  return v;
}
function asText(v) {
  v = cellVal(v);
  if (v == null) return null;
  if (v instanceof Date) return asDate(v);
  const s = String(v).trim();
  return s === '' ? null : s;
}
function asNum(v) {
  v = cellVal(v);
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function asDate(v) {
  v = cellVal(v);
  if (v == null) return null;
  if (v instanceof Date) {
    // exceljs trả ngày theo UTC
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m) return `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // sinh nhật không có năm → MM-DD
  return null;
}
function asTime(v) {
  v = cellVal(v);
  if (v == null) return null;
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof v === 'number' && v < 1) { const mins = Math.round(v * 1440); return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; }
  const m = String(v).match(/(\d{1,2})[:hH](\d{2})?/);
  return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : null;
}
const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
function stripAccents(s) { return norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }

// Tìm dòng tiêu đề (dòng có "Tên khách" / "Ngày"...) và lập bản đồ tên cột → số cột
function readTable(ws, mustHave, maxScan = 8) {
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const map = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const h = asText(cell.value);
      if (h && !(norm(h) in map)) map[norm(h)] = col;
    });
    if (mustHave.every((h) => norm(h) in map)) {
      const rows = [];
      for (let i = r + 1; i <= ws.rowCount; i++) {
        const rr = ws.getRow(i);
        const get = (...names) => { for (const n of names) { const c = map[norm(n)]; if (c) return rr.getCell(c).value; } return null; };
        rows.push({ get, rowNumber: i });
      }
      return rows;
    }
  }
  return null;
}

// ---------- Nhân viên ----------
function staffResolver(summary) {
  const users = db.prepare('SELECT id, full_name, aliases FROM users').all();
  const key = (s) => stripAccents(s).replace(/^(chi|anh|em|c|a|e)\s+/, '');
  const map = new Map();
  for (const u of users) {
    map.set(key(u.full_name), u.id);
    for (const a of String(u.aliases || '').split(',')) if (a.trim()) map.set(key(a), u.id);
  }
  return (name) => {
    const n = asText(name);
    if (!n) return null;
    const k = key(n);
    if (map.has(k)) return map.get(k);
    let username = 'nv_' + k.replace(/[^a-z0-9]/g, '').slice(0, 20);
    while (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) username += '1';
    const id = db.prepare("INSERT INTO users(username,full_name,role,can_login,active,must_change_pw) VALUES (?,?,'staff',0,0,0)").run(username, n).lastInsertRowid;
    map.set(k, id);
    summary.staff_created.push(n);
    return id;
  };
}

// ---------- Khách hàng ----------
function customerResolver(summary, user) {
  const byRef = db.prepare('SELECT customer_id FROM customer_refs WHERE source=? AND code=?');
  const byCode = db.prepare('SELECT id FROM customers WHERE code=? AND deleted=0');
  const byPhone = db.prepare('SELECT id FROM customers WHERE phone=? AND deleted=0');
  const all = () => db.prepare('SELECT id, name, phone FROM customers WHERE deleted=0').all();
  const addRef = db.prepare('INSERT OR IGNORE INTO customer_refs(source,code,customer_id) VALUES (?,?,?)');

  function find(source, code, phone, name) {
    if (code) {
      const r = byRef.get(source, code); if (r) return { id: r.customer_id, how: 'ref' };
      if (source === 'APP') { const c = byCode.get(code); if (c) return { id: c.id, how: 'code' }; }
    }
    if (phone) { const p = byPhone.get(phone); if (p) return { id: p.id, how: 'phone' }; }
    if (name) {
      const n = norm(name);
      const hits = all().filter((c) => norm(c.name) === n && (!phone || !c.phone || c.phone === phone));
      if (hits.length === 1) return { id: hits[0].id, how: 'name' };
    }
    return null;
  }

  function upsert(source, data, counted = true) {
    const phone = L.normPhone(data.phone);
    const validPhone = phone && /^0\d{9,10}$/.test(phone) ? phone : null;
    const hit = find(source, data.code, validPhone, data.name);
    if (hit) {
      const c = db.prepare('SELECT * FROM customers WHERE id=?').get(hit.id);
      const upd = {};
      if (!c.phone && validPhone) upd.phone = validPhone;
      for (const k of ['gender', 'birthday', 'source']) if (!c[k] && data[k]) upd[k] = data[k];
      for (const k of ['hair_notes', 'notes']) {
        if (data[k] && !String(c[k] || '').includes(data[k])) upd[k] = c[k] ? `${c[k]}\n${data[k]}` : data[k];
      }
      const keys = Object.keys(upd);
      if (keys.length) db.prepare(`UPDATE customers SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => upd[k]), hit.id);
      if (data.code) addRef.run(source, data.code, hit.id);
      if (counted) {
        summary.customers_merged++;
        if (hit.how === 'name') summary.matched_by_name.push(data.name);
      }
      return hit.id;
    }
    if (!data.name) return null;
    let code = source === 'APP' && data.code && !byCode.get(data.code) ? data.code : nextCode('customers', 'KH', 4);
    const id = db.prepare('INSERT INTO customers(code,name,phone,gender,birthday,source,hair_notes,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(code, data.name, validPhone, data.gender || null, data.birthday || null, data.source || null, data.hair_notes || null, data.notes || null, user.id).lastInsertRowid;
    if (data.code) addRef.run(source, data.code, id);
    summary.customers_created++;
    if (phone && !validPhone) summary.warnings.push(`SĐT không hợp lệ, bỏ qua: ${data.name} – ${data.phone}`);
    return id;
  }
  return { upsert, find };
}

// ---------- Dịch vụ ----------
const GROUP_RATE = { 'Hóa chất': 0.15, 'Cắt': 0.03, 'Gội & chăm sóc': 0, 'Bán sản phẩm': 0.08 };
function importServices(rows, summary) {
  for (const r of rows) {
    const name = asText(r.get('Dịch vụ'));
    if (!name) continue;
    const price = asNum(r.get('Giá niêm yết (VNĐ)', 'Giá niêm yết'));
    let grp = asText(r.get('Nhóm doanh số'));
    if (!GROUPS.includes(grp)) grp = 'Cắt';
    const ex = db.prepare('SELECT * FROM services WHERE name=?').get(name);
    if (!ex) {
      db.prepare('INSERT INTO services(name,price,grp,commission_rate) VALUES (?,?,?,?)').run(name, price, grp, GROUP_RATE[grp] || 0);
      summary.services_added++;
    } else if (!ex.price && price) {
      db.prepare('UPDATE services SET price=? WHERE id=?').run(price, ex.id);
    }
  }
}

function crmGroup(g) {
  const s = norm(g);
  if (!s) return null;
  if (s.includes('cắt')) return 'Cắt';
  if (['làm màu', 'uốn', 'ép tóc', 'chữa trị', 'hóa chất'].some((x) => s.includes(x))) return 'Hóa chất';
  if (s.includes('sản phẩm')) return 'Bán sản phẩm';
  return 'Gội & chăm sóc';
}

async function importWorkbook(buffer, opts, user) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw L.bad('Không đọc được file. Chỉ nhận file .xlsx'); }
  const ws = (name) => wb.worksheets.find((w) => norm(w.name) === norm(name));
  const summary = {
    format: null, customers_created: 0, customers_merged: 0, matched_by_name: [], services_added: 0,
    visits_created: 0, visits_skipped_existing: 0, visits_skipped_duplicate: 0, visits_skipped_invalid: 0,
    appointments_created: 0, cards_created: 0, staff_created: [], warnings: [],
  };
  const importer = { ...user, role: 'owner' }; // bỏ giới hạn ngày của nhân viên khi nhập lịch sử

  const run = () => {
    const staffOf = staffResolver(summary);
    const cust = customerResolver(summary, user);
    const svcByName = new Map(db.prepare('SELECT id, name FROM services').all().map((s) => [norm(s.name), s.id]));
    const refreshSvc = () => { for (const s of db.prepare('SELECT id, name FROM services').all()) svcByName.set(norm(s.name), s.id); };
    let recognised = false;

    // ===== File "Salon Nếp – Nhật ký" =====
    const nk = ws('Nhật ký dịch vụ');
    if (nk) {
      recognised = true; summary.format = 'Salon Nếp – Nhật ký dịch vụ';
      const dm = ws('Danh mục');
      if (dm) { const rows = readTable(dm, ['Dịch vụ', 'Nhóm doanh số']); if (rows) { importServices(rows, summary); refreshSvc(); } }
      const kh = ws('Khách hàng');
      if (kh) {
        const rows = readTable(kh, ['Mã khách', 'Tên khách']) || [];
        for (const r of rows) {
          const name = asText(r.get('Tên khách')); if (!name) continue;
          cust.upsert('NK', { code: asText(r.get('Mã khách')), name, phone: asText(r.get('Số điện thoại')), birthday: asDate(r.get('Sinh nhật')),
            hair_notes: asText(r.get('Lưu ý về tóc, da đầu')) });
        }
      }
      const rows = readTable(nk, ['Ngày làm', 'Mã lượt', 'Thợ chính']) || [];
      for (const r of rows) {
        const date = asDate(r.get('Ngày làm'));
        const ref = asText(r.get('Mã lượt'));
        const name = asText(r.get('Tên khách'));
        if (!date || !ref || (!name && !asText(r.get('Mã khách')))) continue;
        if (db.prepare('SELECT 1 FROM visits WHERE import_ref=?').get('NK:' + ref)) { summary.visits_skipped_existing++; continue; }
        const customerId = cust.upsert('NK', { code: asText(r.get('Mã khách')), name, phone: asText(r.get('Số điện thoại')) }, false);
        if (!customerId) { summary.visits_skipped_invalid++; continue; }
        const svcNames = ['Dịch vụ 1', 'Dịch vụ 2', 'Dịch vụ 3'].map((k) => asText(r.get(k))).filter(Boolean);
        const items = svcNames.map((n) => {
          const id = svcByName.get(norm(n));
          return id ? { service_id: id } : { name: n, price: 0 };
        });
        if (!items.length) items.push({ name: 'Không ghi dịch vụ', price: 0 });
        const listed = asNum(r.get('Tổng giá dịch vụ (VNĐ)'));
        const disc = asNum(r.get('Giảm giá (VNĐ)'));
        const thucThu = asNum(r.get('Thực thu (VNĐ)'));
        const target = thucThu || Math.max(0, listed - disc);
        const svcStmt = db.prepare('SELECT price FROM services WHERE id=?');
        let sub = items.reduce((s, i) => s + (i.service_id ? svcStmt.get(i.service_id).price : i.price), 0);
        if (sub === 0) { items[0] = { ...items[0], price: target }; sub = target; }
        const diff = target - sub;
        const reason = asText(r.get('Lý do giảm')) || (asNum(r.get('Tiền quy đổi điểm (VNĐ)')) ? 'Đổi điểm' : 'Chênh lệch khi nhập từ Excel');
        const notes = [asText(r.get('Phản hồi của khách')), asText(r.get('Ghi chú thanh toán (cọc / nợ / hoàn)'))].filter(Boolean).join(' · ');
        let pm = asText(r.get('Hình thức thanh toán'));
        L.saveVisit({
          customer_id: customerId, date, main_staff_id: staffOf(r.get('Thợ chính')) || staffOf('Chưa rõ thợ'),
          assistant_id: staffOf(r.get('Người phụ')), items,
          surcharge: diff > 0 ? diff : 0, discount: diff < 0 ? -diff : 0, discount_reason: diff < 0 ? reason : null,
          payment_method: pm, hair_before: asText(r.get('Tình trạng tóc trước khi làm')), wish: asText(r.get('Mong muốn của khách')),
          formula: asText(r.get('Công thức / tỷ lệ pha')), result: asText(r.get('Kết quả sau làm')), note: notes || null,
          import_ref: 'NK:' + ref,
        }, importer, null, { imported: true });
        summary.visits_created++;
      }
    }

    // ===== File "CRM Nếp Hair" =====
    const crm = ws('CRM Khách');
    const ls = ws('Lịch sử');
    if (crm || ls) {
      recognised = true; summary.format = summary.format ? summary.format + ' + CRM Nếp Hair' : 'CRM Nếp Hair';
      if (crm) {
        const rows = readTable(crm, ['Mã KH', 'Tên khách']) || [];
        for (const r of rows) {
          const name = asText(r.get('Tên khách')); if (!name) continue;
          const g = asText(r.get('Giới tính'));
          cust.upsert('CRM', { code: asText(r.get('Mã KH')), name, phone: asText(r.get('SĐT')), gender: g,
            source: asText(r.get('Kênh đặt')), notes: asText(r.get('Ghi chú / sở thích')) });
        }
      }
      if (ls) {
        const rows = readTable(ls, ['Ngày', 'Mã KH', 'Trạng thái']) || [];
        const t = L.today();
        for (const r of rows) {
          const date = asDate(r.get('Ngày'));
          const code = asText(r.get('Mã KH'));
          const status = norm(asText(r.get('Trạng thái')));
          if (!date || !code || date.length !== 10) continue;
          const name = asText(r.get('Tên khách (tự hiện)', 'Tên khách'));
          const service = asText(r.get('Dịch vụ'));
          const time = asTime(r.get('Giờ'));
          if (status === 'đã đặt') {
            if (date < t) continue;
            const customerId = cust.upsert('CRM', { code, name }, false);
            const exists = db.prepare('SELECT 1 FROM appointments WHERE customer_id=? AND date=? AND time IS ?').get(customerId, date, time || '09:00');
            if (exists) continue;
            db.prepare("INSERT INTO appointments(customer_id,staff_id,date,time,service,status,note,created_by) VALUES (?,?,?,?,?,'booked',?,?)")
              .run(customerId, staffOf(r.get('Stylist')), date, time || '09:00', service, asText(r.get('Ghi chú')), user.id);
            summary.appointments_created++;
            continue;
          }
          if (status !== 'hoàn thành' || !opts.includeHistory) continue;
          const ref = 'CRM:' + crypto.createHash('sha1').update([date, time, code, service, asNum(r.get('Thu tiền (VNĐ)'))].join('|')).digest('hex').slice(0, 16);
          if (db.prepare('SELECT 1 FROM visits WHERE import_ref=?').get(ref)) { summary.visits_skipped_existing++; continue; }
          const customerId = cust.upsert('CRM', { code, name }, false);
          if (!customerId) { summary.visits_skipped_invalid++; continue; }
          // Chống trùng: cùng khách, cùng ngày đã có lượt (thường do file Nhật ký đã ghi) → bỏ qua
          if (db.prepare("SELECT 1 FROM visits WHERE customer_id=? AND date=? AND status='done'").get(customerId, date)) { summary.visits_skipped_duplicate++; continue; }
          const amount = asNum(r.get('Thu tiền (VNĐ)'));
          const sid = service ? svcByName.get(norm(service)) : null;
          const item = sid ? { service_id: sid, price: amount } : { name: service || 'Không ghi dịch vụ', grp: crmGroup(asText(r.get('Nhóm DV chính'))) || 'Khác', price: amount };
          const tip = asNum(r.get('Tiền tip (VNĐ)'));
          L.saveVisit({
            customer_id: customerId, date, time, main_staff_id: staffOf(r.get('Stylist')) || staffOf('Chưa rõ thợ'),
            assistant_id: staffOf(r.get('Thợ phụ 1')), items: [item], tip, note: asText(r.get('Ghi chú')), import_ref: ref,
          }, importer, null, { imported: true });
          summary.visits_created++;
        }
      }
    }

    // ===== File xuất từ chính phần mềm này =====
    if (!recognised) {
      const kh = ws('Khách hàng');
      const rows = kh && readTable(kh, ['Mã khách', 'Tên khách'], 3);
      if (rows) {
        recognised = true; summary.format = 'Danh sách khách hàng (mẫu của phần mềm)';
        for (const r of rows) {
          const name = asText(r.get('Tên khách')); if (!name) continue;
          cust.upsert('APP', { code: asText(r.get('Mã khách')), name, phone: asText(r.get('Số điện thoại')), gender: asText(r.get('Giới tính')),
            birthday: asDate(r.get('Sinh nhật')), source: asText(r.get('Nguồn khách')), hair_notes: asText(r.get('Lưu ý tóc / da đầu')), notes: asText(r.get('Ghi chú')) });
        }
      }
    }
    if (!recognised) throw L.bad('Không nhận ra mẫu file. Hỗ trợ: "Salon Nếp – Nhật ký", "CRM Nếp Hair", hoặc file Excel xuất từ phần mềm (tab Khách hàng).');
    if (opts.dryRun) throw ROLLBACK;
  };

  try {
    db.transaction(run)();
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  if (ws('Lịch sử') && !opts.includeHistory) summary.warnings.push('Chưa nhập lượt làm "Hoàn thành" từ tab "Lịch sử" (CRM Nếp Hair) vì trùng với Nhật ký dịch vụ. Tick "Nhập cả lịch sử" nếu cần.');
  return { dry_run: opts.dryRun, summary };
}

module.exports = { importWorkbook, asDate, asTime };
