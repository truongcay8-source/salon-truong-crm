'use strict';
// Chat nội bộ + đọc tin nhắn đặt lịch ("chị Lan 0912345678 mai 9h nhuộm với Dương") → gợi ý lịch hẹn, bấm 1 lần để tạo
const { db, audit, getSettings } = require('./db');
const L = require('./logic');
const { HttpError, bad, int, str, today } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  draft TEXT,
  appointment_id INTEGER REFERENCES appointments(id),
  linked_by INTEGER REFERENCES users(id),
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS chat_reads (user_id INTEGER PRIMARY KEY, last_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_summaries (date TEXT PRIMARY KEY, body TEXT NOT NULL, msg_count INTEGER NOT NULL, by_user INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
`);
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('chat_keep_days','90')").run();
// chat_auto: '1' = tin đủ thông tin (tên khách + ngày + giờ) tự tạo lịch; '0' = hiện thẻ để nhân viên bấm ✓
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('chat_auto','0')").run();
// Tin cũ hơn N ngày bị xóa hẳn (lịch hẹn đã tạo vẫn giữ)
let lastPurge = 0;
function purge() {
  if (Date.now() - lastPurge < 3600e3) return;
  lastPurge = Date.now();
  const days = Math.max(7, Number(getSettings().chat_keep_days) || 90);
  db.prepare("DELETE FROM chat_messages WHERE created_at < datetime('now','localtime',?)").run(`-${days} days`);
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const pad = (n) => String(n).padStart(2, '0');
const HONOR = ['chị', 'chi', 'c', 'anh', 'a', 'em', 'e', 'cô', 'co', 'bà', 'bác', 'chú', 'khách', 'khach', 'kh', 'bạn', 'ban', 'mẹ', 'me'];
// Từ khóa dịch vụ → tìm dịch vụ có tên chứa từ đó
const SVC_WORDS = ['nhuộm', 'cắt', 'uốn', 'duỗi', 'ép', 'gội', 'phục hồi', 'hấp', 'tẩy', 'highlight', 'balayage', 'tạo kiểu', 'sấy', 'massage', 'phủ bóng', 'nối'];

const NOT_NAME = /^(mai|nay|mot|thu|chu|nhat|hom|sang|chieu|toi|trua|luc|ngay|gio|hen|dat|lam|book|lich|oi|nhe|da|ok|vang|khach|tho|cat|nhuom|uon|duoi|goi|tay|phuc|hap|say|ep|noi|toc|nam|nu|director|stylist|top)$/;
// Tìm tên khách: sau "chị/anh/khách…"; không có thì 1–2 chữ viết hoa đứng giữa câu (VD: "mai 11h Thảo cắt tóc")
function findName(raw, ctx, hasPhone) {
  const staffNames = new Set(ctx.staff.flatMap((u) => [u.full_name, ...String(u.aliases || '').split(',')].map((x) => fold(x).trim().split(/\s+/).pop())));
  const match = (name) => {
    if (hasPhone) return null;
    const cands = db.prepare('SELECT id, name FROM customers WHERE deleted=0').all().filter((c) => fold(c.name) === fold(name));
    return cands.length === 1 ? cands[0] : null;
  };
  const hon = HONOR.flatMap((h) => [h, h.charAt(0).toUpperCase() + h.slice(1)]);
  const re = new RegExp(`(?:^|\\s)(${hon.join('|')})\\.?\\s+([\\p{L}]+(?:\\s+\\p{Lu}\\p{L}*){0,2})`, 'gu');
  let mm;
  while ((mm = re.exec(raw))) {
    const nm = mm[2].trim();
    const first = fold(nm.split(/\s+/)[0]);
    const firstRaw = nm.split(/\s+/)[0];
    if (staffNames.has(first) || SVC_WORDS.some((w) => fold(w).startsWith(first)) || /^(nay|toi|chieu|sang|luc|ngay|thu|hen|dat|lam|book|oi|nhe|a|da)$/.test(first) || (first === 'mai' && firstRaw === 'mai') || /^\d/.test(nm)) continue;
    const h = mm[1].toLowerCase();
    const title = { c: 'Chị', chi: 'Chị', 'chị': 'Chị', a: 'Anh', anh: 'Anh', e: 'Em', em: 'Em', co: 'Cô', 'cô': 'Cô', kh: '', khach: '', 'khách': '' }[h];
    const name = nm.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (!name) continue;
    const full = ((title ?? (h.charAt(0).toUpperCase() + h.slice(1))) + ' ' + name).trim();
    const c = match(full) || match(name);
    return { name: c ? c.name : full, customer_id: c ? c.id : null, span: mm[0] };
  }
  // Tên trơn viết hoa, không phải chữ đầu câu, không phải tên thợ / dịch vụ / từ chỉ ngày giờ
  const bare = /(?<=\S\s+)(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)/gu;
  while ((mm = bare.exec(raw))) {
    const words = mm[1].split(/\s+/).filter((w) => !staffNames.has(fold(w)) && !NOT_NAME.test(fold(w)));
    if (!words.length || words.length !== mm[1].split(/\s+/).length) continue;
    const name = words.join(' ');
    const c = match(name);
    return { name: c ? c.name : name, customer_id: c ? c.id : null, span: mm[0] };
  }
  return null;
}

function parseBooking(text, ctx) {
  const t0 = ctx.today || today();
  const raw = String(text || '');
  const f = ' ' + fold(raw).replace(/[,;!?()]/g, ' ') + ' ';
  const out = {};
  // SĐT
  const pm = raw.match(/(?:\+?84|0)(?:[\s.-]?\d){9,10}/);
  if (pm) out.phone = L.normPhone(pm[0].replace(/^\+?84/, '0'));
  const fNoPhone = pm ? f.replace(fold(pm[0]), ' ') : f;
  // Giờ: 9h, 9h30, 9:30, 9g, 9r (rưỡi), 14h, "9 giờ", kèm sáng/chiều/tối
  const tm = fNoPhone.match(/(?:^|[\s@])(?:luc\s*)?(\d{1,2})\s*(?:(?:h|g|gio)\s*(\d{1,2})?|:(\d{2})|r(?:uoi)?\b)\s*(?:p\b|phut\b)?\s*(sang|trua|chieu|toi)?/);
  if (tm) {
    let h = Number(tm[1]); let m = Number(tm[2] || tm[3] || 0);
    if (/\dr(uoi)?\b/.test(tm[0].replace(/\s/g, ''))) m = 30;
    if ((tm[4] === 'chieu' || tm[4] === 'toi') && h < 12) h += 12;
    else if (!tm[4] && h >= 1 && h <= 7) h += 12; // salon: "3h" hiểu là 15h
    if (h >= 0 && h <= 23 && m < 60) out.time = `${pad(h)}:${pad(m)}`;
  }
  // Khách: theo SĐT có sẵn → tên sau "chị/anh/khách…" (không phải tên thợ) → khớp tên khách có sẵn
  if (out.phone) {
    const c = db.prepare('SELECT id, name, phone, staff_id FROM customers WHERE deleted=0 AND phone=?').get(out.phone);
    if (c) { out.customer_id = c.id; out.name = c.name; if (!out.staff_id && c.staff_id) { out.staff_id = c.staff_id; out.staff_from_profile = true; } }
  }
  let nameSpan = '';
  if (!out.customer_id) {
    const nm = findName(raw, ctx, !!out.phone);
    if (nm) { nameSpan = nm.span; out.name = nm.name; if (nm.customer_id) out.customer_id = nm.customer_id; }
    // Không có tên trong tin này → lấy tên ở tin ngắn ngay trước của cùng người (VD: "A Định" rồi "mai 11h cắt tóc")
    else if (ctx.prev) {
      const pn = findName(ctx.prev, ctx, !!out.phone);
      if (pn) { out.name = pn.name; if (pn.customer_id) out.customer_id = pn.customer_id; out.name_from_prev = true; }
    }
  }
  // Ngày (bỏ phần tên khách để "chị Mai" không bị hiểu là ngày mai)
  const fDate = nameSpan ? fNoPhone.replace(fold(nameSpan), ' ') : fNoPhone;
  const d0 = new Date(t0 + 'T00:00:00Z');
  const addD = (n) => L.addDays(t0, n);
  let date = null;
  const dm = fDate.match(/(?:ngay\s*)?\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dm) {
    let y = dm[3] ? Number(dm[3].length === 2 ? '20' + dm[3] : dm[3]) : d0.getUTCFullYear();
    const cand = `${y}-${pad(dm[2])}-${pad(dm[1])}`;
    if (L.isDate(cand)) date = !dm[3] && cand < t0 ? `${y + 1}-${pad(dm[2])}-${pad(dm[1])}` : cand;
  }
  if (!date) {
    if (/\b(ngay mot|ngay kia|mot)\b/.test(fDate)) date = addD(2);
    else if (/\b(ngay mai|mai|tomorrow)\b/.test(fDate)) date = addD(1);
    else if (/\b(hom nay|nay|chieu nay|toi nay|sang nay)\b/.test(fDate)) date = t0;
    else {
      const wd = fDate.match(/\b(?:thu\s*|t)([2-7])\b|\b(chu nhat|cn)\b/);
      if (wd) {
        const want = wd[2] ? 0 : Number(wd[1]) - 1; // JS: CN=0, T2=1 … T7=6
        let n = (want - d0.getUTCDay() + 7) % 7; if (n === 0) n = 7;
        date = addD(n);
      }
    }
  }
  if (date) out.date = date;
  // Thợ: tên hoặc biệt danh (không dấu), ưu tiên tên đứng sau "với/vs/thợ/cho/làm"
  const staffHits = [];
  for (const u of ctx.staff) {
    const names = [u.full_name, ...String(u.aliases || '').split(',')].map((x) => fold(x).trim()).filter((x) => x.length >= 2);
    for (const n of names) {
      const re = new RegExp(`(\\b(?:voi|vs|tho|lam|cho|book|dat)\\s+)?(?:(?:a|anh|c|chi|e|em|co)\\s+)?\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      const mm = fNoPhone.match(re);
      if (mm) { staffHits.push({ id: u.id, strong: !!mm[1], at: mm.index, len: mm[0].length, name: n }); break; }
    }
  }
  const staff = staffHits.find((s) => s.strong) || (staffHits.length === 1 ? staffHits[0] : null);
  if (staff) out.staff_id = staff.id;
  else if (!out.staff_id && ctx.sender && Object.keys(ctx.staffUsage || {}).some((k) => Number(k.split('|')[0]) === ctx.sender)) { out.staff_id = ctx.sender; out.staff_from_sender = true; }
  // Dịch vụ: khớp tên đầy đủ trước, rồi từ khóa (chọn dịch vụ thợ đó/tiệm hay làm nhất; "anh" → nam, "chị" → nữ)
  const found = [];
  for (const s of ctx.services) { const i = fNoPhone.indexOf(' ' + fold(s.name) + ' '); if (s.active && i >= 0) found.push({ name: s.name, at: i }); }
  const title = fold((out.name || '').split(' ')[0]);
  const male = ['anh', 'chu', 'ong'].includes(title) || /\b(nam|tóc nam|toc nam)\b/.test(f), female = ['chi', 'co', 'ba'].includes(title) || /\b(nu|toc nu)\b/.test(f);
  // Cấp thợ: lấy cấp đã khai ở Cài đặt › Tài khoản; chưa khai thì đoán theo dịch vụ thợ đó hay làm
  const lvl = {};
  for (const [k, n] of Object.entries(ctx.staffUsage || {})) { const [sid, nm] = k.split('|'); if (Number(sid) === out.staff_id) for (const l of ['director', 'stylist']) if (fold(nm).includes(l)) lvl[l] = (lvl[l] || 0) + n; }
  const own = (ctx.staff.find((u) => u.id === out.staff_id) || {}).level;
  const myLvl = own ? fold(own) : Object.keys(lvl).sort((a, b) => lvl[b] - lvl[a])[0];
  for (const w of SVC_WORDS) {
    const fw = fold(w);
    const mw = fNoPhone.match(new RegExp(`\\b${fw}\\b`));
    if (!mw || found.some((x) => fold(x.name).includes(fw))) continue;
    const pick = ctx.services.filter((x) => x.active && new RegExp(`\\b${fw}\\b`).test(fold(x.name)))
      .map((x) => { const n = fold(x.name); return { x, score: ((ctx.usage || {})[x.name] || 0) + 10 * ((ctx.staffUsage || {})[`${out.staff_id}|${x.name}`] || 0)
        + (male && !female ? (/\bnam\b/.test(n) ? 1000 : /\bnu\b/.test(n) ? -1000 : 0) : 0) + (female && !male ? (/\bnu\b/.test(n) ? 1000 : /\bnam\b/.test(n) ? -1000 : 0) : 0) + (myLvl && n.includes(myLvl) ? 500 : 0) + (n.startsWith(fw) ? 2 : 0) + (fw === 'tay' && n.includes('nang sang') ? 100 : 0) + (n.includes(' – m (') ? 1 : 0) - n.length / 100 }; })
      .sort((a, b) => b.score - a.score)[0];
    found.push({ name: pick ? pick.x.name : w.charAt(0).toUpperCase() + w.slice(1), at: mw.index });
  }
  const svcs = found.sort((a, b) => a.at - b.at).map((x) => x.name).filter((n, i, a) => a.indexOf(n) === i);
  if (svcs.length) out.service = svcs.join(' + ');
  // Chỉ coi là tin đặt lịch khi có giờ và (ngày hoặc từ khóa hẹn) và có thêm ít nhất 1 thông tin khách/dịch vụ
  const hint = /\b(hen|dat lich|dat|book|lich|qua lam|toi lam|den lam)\b/.test(fNoPhone);
  if (!out.time || !(out.date || hint) || !(out.name || out.phone || out.service || out.customer_id)) return null;
  if (!out.date) { out.date = t0; out.date_guess = true; }
  if (out.date < t0) return null;
  return out;
}

function msgRows(where, params, limit) {
  return db.prepare(`SELECT m.*, u.full_name user_name, lb.full_name linked_by_name, a.date appt_date, a.time appt_time, a.status appt_status
    FROM chat_messages m JOIN users u ON u.id=m.user_id LEFT JOIN users lb ON lb.id=m.linked_by LEFT JOIN appointments a ON a.id=m.appointment_id
    WHERE m.deleted=0 AND ${where} ORDER BY m.id DESC LIMIT ?`).all(...params, limit).reverse()
    .map((m) => ({ ...m, draft: m.draft ? JSON.parse(m.draft) : null, action: m.action ? JSON.parse(m.action) : null, action_done: m.action_done ? JSON.parse(m.action_done) : null,
      mentions: m.mentions ? m.mentions.split(',').map(Number) : [] }));
}
function ctxNow() {
  const since = L.addDays(today(), -180);
  const use = db.prepare(`SELECT v.main_staff_id sid, vi.name, COUNT(*) n FROM visit_items vi JOIN visits v ON v.id=vi.visit_id WHERE v.status='done' AND v.date>=? GROUP BY 1,2`).all(since);
  const usage = {}, staffUsage = {};
  for (const r of use) { usage[r.name] = (usage[r.name] || 0) + r.n; staffUsage[`${r.sid}|${r.name}`] = r.n; }
  return { today: today(), staff: db.prepare('SELECT id, username, full_name, aliases, level, role FROM users WHERE active=1').all(), services: db.prepare('SELECT name, active FROM services').all(), usage, staffUsage };
}

// Tóm tắt chat 1 ngày bằng Claude. Số điện thoại được che trước khi gửi đi.
const maskPhone = (t) => String(t).replace(/(?:\+?84|0)(?:[\s.-]?\d){9,10}/g, '[SĐT]');
async function summarize(day, msgs) {
  const key = getSettings().anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!key) throw bad('Chưa bật AI tóm tắt: Lãnh đạo nhập khóa API ở Cài đặt › Tham số');
  const Anthropic = require('@anthropic-ai/sdk').default;
  const client = new Anthropic({ apiKey: key, timeout: 60e3, maxRetries: 1 });
  const lines = msgs.map((m) => `${m.created_at.slice(11, 16)} ${m.user_name}: ${maskPhone(m.body)}${m.appointment_id ? ` [ĐÃ TẠO LỊCH ${m.appt_date} ${m.appt_time || ''}]` : m.draft ? ' [gợi ý lịch, CHƯA tạo]' : ''}`).join('\n');
  let r;
  try {
    r = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: 'Bạn tóm tắt nhóm chat nội bộ của một salon tóc ở Việt Nam cho chủ tiệm đọc nhanh trên điện thoại. Viết tiếng Việt, ngắn gọn, dạng gạch đầu dòng, tối đa khoảng 12 dòng. Chia 3 mục nếu có nội dung: "Lịch hẹn" (khách, ngày giờ, thợ; ghi rõ lịch nào chưa tạo trong phần mềm), "Việc cần làm / cần nhắc" (ai phải làm gì), "Vấn đề / ý kiến" (phàn nàn, thiếu hàng, xin nghỉ…). Chỉ dùng thông tin có trong tin nhắn, không bịa. Không chép lại số điện thoại.',
      messages: [{ role: 'user', content: `Tin nhắn ngày ${day.split('-').reverse().join('/')}:\n${lines}` }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw bad('Khóa API Claude không đúng hoặc đã bị thu hồi');
    if (e instanceof Anthropic.RateLimitError) throw bad('AI đang quá tải, thử lại sau ít phút');
    if (e instanceof Anthropic.APIError) throw bad('AI lỗi (' + (e.status || 'mạng') + '), thử lại sau');
    throw bad('Không kết nối được AI: ' + e.message);
  }
  if (r.stop_reason === 'refusal') throw bad('AI từ chối tóm tắt nội dung này');
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw bad('AI không trả về nội dung');
  return text;
}

function mount(app, { MGR, OWNER }) {
  const act = require('./chatact');
  const push = require('./push');
  const short = (t, n = 120) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const mgrIds = () => db.prepare("SELECT id FROM users WHERE active=1 AND role IN ('owner','manager')").all().map((u) => u.id);
  const stockIds = () => { const st = require('./stock'); return db.prepare('SELECT * FROM users WHERE active=1').all().filter((u) => st.perm(u).stock_view && u.role === 'staff').map((u) => u.id); };
  app.get('/api/chat', (req, res) => {
    purge();
    const after = int(req.query.after), before = int(req.query.before);
    const day = L.isDate(req.query.date) ? req.query.date : null;
    // Tin mới (đang xem 1 ngày): chỉ lấy tin của ngày đó – trước đây ngày chưa có tin thì after=0 → kéo cả tin các ngày cũ
    const rows = req.query.after !== undefined && day ? msgRows('m.id>? AND substr(m.created_at,1,10)=?', [after || 0, day], 200) : after ? msgRows('m.id>?', [after], 200) : before ? msgRows('m.id<?', [before], 50) : day ? msgRows('substr(m.created_at,1,10)=?', [day], 1000) : msgRows('1=1', [], 80);
    const last = db.prepare('SELECT MAX(id) n FROM chat_messages').get().n || 0;
    if (!before) db.prepare('INSERT INTO chat_reads(user_id,last_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_id=MAX(last_id, excluded.last_id)').run(req.user.id, last);
    res.json(rows);
  });
  // Chủ đề theo ngày: mỗi ngày 1 mục, kèm số tin, số lịch đã tạo, đã có tóm tắt chưa
  app.get('/api/chat/days', (req, res) => {
    const days = db.prepare(`SELECT substr(m.created_at,1,10) date, COUNT(*) n, SUM(CASE WHEN m.appointment_id IS NOT NULL THEN 1 ELSE 0 END) appts,
        SUM(CASE WHEN m.draft IS NOT NULL AND m.appointment_id IS NULL THEN 1 ELSE 0 END) pending, (SELECT 1 FROM chat_summaries s WHERE s.date=substr(m.created_at,1,10)) summarized
      FROM chat_messages m WHERE m.deleted=0 GROUP BY 1 ORDER BY 1 DESC LIMIT 60`).all();
    const st = getSettings();
    res.json({ days, auto: st.chat_auto === '1', ai: !!(st.anthropic_api_key || process.env.ANTHROPIC_API_KEY) });
  });
  app.put('/api/chat/settings', MGR, (req, res) => {
    const v = req.body.auto ? '1' : '0';
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('chat_auto',?)").run(v);
    audit(req.user.id, 'chat_auto', 'settings', null, { auto: v === '1' });
    res.json({ ok: true, auto: v === '1' });
  });
  // Khóa API Claude để tóm tắt (chỉ Lãnh đạo; không bao giờ trả khóa về trình duyệt)
  app.put('/api/chat/ai-key', OWNER, (req, res) => {
    const k = String(req.body.key || '').trim();
    if (k && !/^sk-ant-[\w-]{20,}$/.test(k)) throw bad('Khóa không đúng dạng (bắt đầu bằng sk-ant-)');
    if (k) db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('anthropic_api_key',?)").run(k);
    else db.prepare("DELETE FROM settings WHERE key='anthropic_api_key'").run();
    audit(req.user.id, 'set_ai_key', 'settings', null, { set: !!k });
    res.json({ ok: true, ai: !!k });
  });
  app.get('/api/chat/summary', (req, res) => {
    const day = L.isDate(req.query.date) ? req.query.date : today();
    res.json(db.prepare('SELECT s.*, u.full_name by_name FROM chat_summaries s LEFT JOIN users u ON u.id=s.by_user WHERE date=?').get(day) || null);
  });
  app.post('/api/chat/summary', async (req, res) => {
    const day = L.isDate(req.body.date) ? req.body.date : today();
    const msgs = msgRows('substr(m.created_at,1,10)=?', [day], 1000);
    if (!msgs.length) throw bad('Ngày này chưa có tin nhắn');
    const text = await summarize(day, msgs);
    db.prepare('INSERT OR REPLACE INTO chat_summaries(date,body,msg_count,by_user) VALUES (?,?,?,?)').run(day, text, msgs.length, req.user.id);
    audit(req.user.id, 'chat_summary', 'settings', null, { date: day, messages: msgs.length });
    res.json(db.prepare('SELECT s.*, u.full_name by_name FROM chat_summaries s LEFT JOIN users u ON u.id=s.by_user WHERE date=?').get(day));
  });
  app.get('/api/chat/unread', (req, res) => {
    const r = db.prepare('SELECT last_id FROM chat_reads WHERE user_id=?').get(req.user.id);
    const last = r ? r.last_id : 0;
    res.json({ unread: db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE deleted=0 AND id>? AND user_id<>?').get(last, req.user.id).n,
      mentions: db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE deleted=0 AND id>? AND user_id<>? AND (','||mentions||',') LIKE ?").get(last, req.user.id, `%,${req.user.id},%`).n });
  });
  app.post('/api/chat', (req, res) => {
    const body = str(req.body.body);
    if (!body) throw bad('Tin nhắn trống');
    if (body.length > 2000) throw bad('Tin nhắn quá dài');
    const ctx = ctxNow();
    ctx.sender = req.user.id;
    const prev = db.prepare("SELECT body FROM chat_messages WHERE user_id=? AND deleted=0 AND created_at>=datetime('now','localtime','-15 minutes') ORDER BY id DESC LIMIT 1").get(req.user.id);
    if (prev && prev.body.length <= 40) ctx.prev = prev.body;
    const draft = parseBooking(body, ctx);
    const action = draft ? null : act.parseAction(body, ctx, req.user.id);
    const mentions = act.parseMentions(body, ctx).filter((x) => x !== req.user.id);
    const id = db.prepare('INSERT INTO chat_messages(user_id,body,draft,action,mentions) VALUES (?,?,?,?,?)')
      .run(req.user.id, body, draft ? JSON.stringify(draft) : null, action ? JSON.stringify(action) : null, mentions.length ? mentions.join(',') : null).lastInsertRowid;
    // Thông báo: người được @gọi tên luôn nhận; người chọn "mọi tin" nhận tất cả
    const others = db.prepare('SELECT id FROM users WHERE active=1 AND can_login=1 AND id<>?').all(req.user.id).map((u) => u.id);
    push.fire(others.map((uid) => ({ user_id: uid, important: mentions.includes(uid) })),
      { title: (mentions.length ? '📣 ' : '💬 ') + req.user.full_name, body: short(body), url: '/#chat', tag: 'chat' });
    db.prepare('INSERT INTO chat_reads(user_id,last_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_id=MAX(last_id, excluded.last_id)').run(req.user.id, id);
    // Chế độ tự tạo lịch: chỉ khi đủ tên khách + ngày nói rõ + giờ, và thợ không bị trùng giờ
    let auto = null;
    if (draft && getSettings().chat_auto === '1' && (draft.customer_id || draft.name) && draft.time && !draft.date_guess) {
      const clash = draft.staff_id && db.prepare("SELECT 1 FROM appointments WHERE staff_id=? AND date=? AND time=? AND status IN ('booked','arrived')").get(draft.staff_id, draft.date, draft.time);
      if (!clash) {
        const aid = db.prepare(`INSERT INTO appointments(customer_id,guest_name,guest_phone,staff_id,date,time,duration,service,status,note,created_by)
          VALUES (?,?,?,?,?,?,60,?,'booked',?,?)`).run(draft.customer_id || null, draft.customer_id ? null : draft.name, draft.customer_id ? null : draft.phone || null,
          draft.staff_id || null, draft.date, draft.time, draft.service || null, 'Từ chat: ' + body.slice(0, 200), req.user.id).lastInsertRowid;
        db.prepare('UPDATE chat_messages SET appointment_id=?, linked_by=? WHERE id=?').run(aid, req.user.id, id);
        audit(req.user.id, 'chat_to_appointment', 'appointment', aid, { message_id: id, auto: true });
        auto = aid;
      }
    }
    res.json({ ...msgRows('m.id=?', [id], 1)[0], auto_created: !!auto });
  });
  // Gắn lịch hẹn vừa tạo từ thẻ gợi ý vào tin nhắn (để mọi người thấy "đã tạo lịch")
  app.post('/api/chat/:id/link', (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=? AND deleted=0').get(int(req.params.id));
    if (!m) throw new HttpError(404, 'Không tìm thấy tin nhắn');
    const aid = int(req.body.appointment_id);
    if (!db.prepare('SELECT 1 FROM appointments WHERE id=?').get(aid)) throw bad('Lịch hẹn không tồn tại');
    db.prepare('UPDATE chat_messages SET appointment_id=?, linked_by=? WHERE id=?').run(aid, req.user.id, m.id);
    audit(req.user.id, 'chat_to_appointment', 'appointment', aid, { message_id: m.id });
    res.json(msgRows('m.id=?', [m.id], 1)[0]);
  });
  // Thẻ việc (chi quỹ, báo hết hàng, xin nghỉ, khách đến): bấm ✓ để ghi vào phần mềm
  app.post('/api/chat/:id/act', (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=? AND deleted=0').get(int(req.params.id));
    if (!m || !m.action) throw new HttpError(404, 'Không có việc để ghi');
    if (m.action_done) throw bad('Việc này đã được ghi rồi');
    const r = act.apply(m, req.body || {}, req.user);
    db.prepare('UPDATE chat_messages SET action_done=? WHERE id=?').run(JSON.stringify({ text: r.text, ref: r.ref, by: req.user.full_name, at: new Date().toISOString() }), m.id);
    let to = [];
    if (r.notify === 'mgr') to = mgrIds();
    else if (r.notify === 'stock') to = stockIds();
    else if (r.notify && r.notify.startsWith('staff:')) { const a = db.prepare('SELECT staff_id FROM appointments WHERE id=?').get(Number(r.notify.slice(6))); if (a && a.staff_id) to = [a.staff_id]; }
    to = to.filter((x) => x !== req.user.id);
    if (to.length) push.fire(to.map((uid) => ({ user_id: uid, important: true })), { title: '✅ ' + req.user.full_name, body: r.text, url: r.notify === 'stock' ? '/#stock' : r.notify === 'mgr' ? (r.ref || '').startsWith('off') ? '/#offs' : '/#expenses' : '/#appointments', tag: 'act' });
    res.json(msgRows('m.id=?', [m.id], 1)[0]);
  });
  app.post('/api/chat/:id/act-dismiss', (req, res) => {
    db.prepare('UPDATE chat_messages SET action=NULL WHERE id=? AND action_done IS NULL').run(int(req.params.id));
    res.json({ ok: true });
  });
  // Đăng ký thông báo cho máy này
  app.get('/api/push', (req, res) => res.json(push.state(req.user.id)));
  app.post('/api/push/subscribe', (req, res) => {
    try { push.subscribe(req.user.id, req.body.subscription, req.body.mode); } catch (e) { throw bad(e.message); }
    res.json(push.state(req.user.id));
  });
  app.post('/api/push/unsubscribe', (req, res) => { push.unsubscribe(req.body.endpoint); res.json(push.state(req.user.id)); });
  app.post('/api/push/test', async (req, res) => {
    const n = await push.send([{ user_id: req.user.id, important: true }], { title: 'Salon Nếp', body: 'Thông báo đã bật ✓', url: '/#chat', tag: 'test' });
    res.json({ sent: n });
  });
  app.post('/api/chat/:id/dismiss', (req, res) => {
    db.prepare('UPDATE chat_messages SET draft=NULL WHERE id=? AND appointment_id IS NULL').run(int(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/chat/:id', (req, res) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id=? AND deleted=0').get(int(req.params.id));
    if (!m) throw new HttpError(404, 'Không tìm thấy tin nhắn');
    if (m.user_id !== req.user.id && req.user.role === 'staff') throw new HttpError(403, 'Chỉ xóa được tin của mình');
    db.prepare('DELETE FROM chat_messages WHERE id=?').run(m.id); // xóa hẳn, không giữ nội dung
    audit(req.user.id, 'delete_chat', 'user', m.user_id, { length: m.body.length });
    res.json({ ok: true });
  });
}

module.exports = { mount, parseBooking, fold, ctxNow, findName, maskPhone };
