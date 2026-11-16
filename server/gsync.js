'use strict';
// Đồng bộ sổ đặt lịch từ Google Sheet: dán link 1 lần, máy chủ tự tải file .xlsx và nhập như nút "Nhập vào hệ thống".
// Sheet cần chia sẻ "Bất kỳ ai có đường liên kết – Người xem".
const crypto = require('crypto');
const { db, getSettings } = require('./db');
const { importWorkbook } = require('./importer');

const EVERY_MIN = 30;
const setS = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

function sheetId(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/) || String(url || '').match(/^([a-zA-Z0-9_-]{30,})$/);
  return m ? m[1] : null;
}

function state() {
  const s = getSettings();
  let last = null;
  try { last = s.gsheet_last_result ? JSON.parse(s.gsheet_last_result) : null; } catch { last = null; }
  return { url: s.gsheet_url || '', auto: s.gsheet_auto !== '0', every_min: EVERY_MIN, last_at: s.gsheet_last_at || null, last_error: s.gsheet_last_error || null, last };
}

function save({ url, auto }) {
  if (url != null) {
    const u = String(url).trim();
    if (u && !sheetId(u)) throw Object.assign(new Error('Link không đúng dạng Google Sheet (docs.google.com/spreadsheets/d/…)'), { status: 400 });
    setS.run('gsheet_url', u);
    setS.run('gsheet_hash', '');
  }
  if (auto != null) setS.run('gsheet_auto', auto ? '1' : '0');
  return state();
}

async function download(url) {
  const id = sheetId(url);
  if (!id) throw new Error('Chưa có link Google Sheet');
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || /text\/html/.test(type)) {
    throw new Error('Không tải được Sheet. Mở Sheet → Chia sẻ → "Bất kỳ ai có đường liên kết" (Người xem), rồi bấm lại.');
  }
  return Buffer.from(await r.arrayBuffer());
}

function systemUser() {
  return db.prepare("SELECT id, full_name, role FROM users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get()
    || db.prepare("SELECT id, full_name, role FROM users WHERE role='owner' ORDER BY id LIMIT 1").get();
}

let running = null;
// force: bỏ qua kiểm tra "file không đổi"; dryRun: chỉ xem trước
async function run({ user, dryRun = false, force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const s = getSettings();
    const buf = await download(s.gsheet_url);
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    // Đổi VERSION của bộ nhập (sửa lỗi ghép khách…) → lần tự đồng bộ sau chạy lại cả sổ
    const hash = crypto.createHash('sha1').update(buf).update(today).update(String(require('./importer').VERSION)).digest('hex');
    if (!dryRun && !force && hash === s.gsheet_hash) return { unchanged: true, ...state() };
    const result = await importWorkbook(buf, { dryRun, includeHistory: false, bookMoney: true }, user || systemUser());
    if (!dryRun) {
      const now = db.prepare("SELECT datetime('now','localtime') t").get().t;
      setS.run('gsheet_hash', hash);
      setS.run('gsheet_last_at', now);
      setS.run('gsheet_last_error', '');
      const b = result.summary.book || {}, x = result.summary.expenses || {};
      setS.run('gsheet_last_result', JSON.stringify({ days: b.days || 0, visits: (b.visits || 0) + (b.updated || 0), total: b.total || 0, tip: b.tip || 0, unpaid: b.unpaid || 0,
        appointments: result.summary.appointments_created || 0, expenses: x.created || 0, expense_amount: x.amount || 0, check: (b.rows_check || []).length + (b.no_money || []).length }));
    }
    return result;
  })();
  try { return await running; }
  catch (e) {
    if (!dryRun) setS.run('gsheet_last_error', e.message);
    throw e;
  } finally { running = null; }
}

function startAutoSync() {
  const tick = () => {
    const s = state();
    if (!s.url || !s.auto) return;
    run().catch((e) => console.error('Đồng bộ Google Sheet lỗi:', e.message));
  };
  setTimeout(tick, 20000).unref();
  setInterval(tick, EVERY_MIN * 60000).unref();
}

module.exports = { sheetId, state, save, run, startAutoSync };
