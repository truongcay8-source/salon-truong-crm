'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(path.join(DATA_DIR, 'photos'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(DATA_DIR, 'salon.db'));
// Tìm khách không dấu: "minh huyen" = "Minh Huyền"; xếp hạng: tên trùng khớp → tên bắt đầu bằng → có từ bắt đầu bằng → chứa → đủ các từ → SĐT/mã → công thức/ghi chú
const foldVi = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
function custRank(name, code, phone, extra, q) {
  const f = foldVi(q); if (!f) return 0;
  const n = foldVi(name), c = foldVi(code), digits = String(q).replace(/\D/g, ''), ph = String(phone || '');
  if (n === f || c === f || (digits.length >= 9 && ph === digits)) return 0;
  if (n.startsWith(f)) return 1;
  if ((' ' + n).includes(' ' + f)) return 2;
  if (n.includes(f)) return 3;
  const toks = f.split(' ');
  if (toks.every((t) => n.includes(t))) return 4;
  if ((digits.length >= 3 && digits.length === String(q).replace(/[\s.]/g, '').length && ph.includes(digits)) || c.includes(f)) return 5;
  const all = n + ' ' + c + ' ' + ph + ' ' + foldVi(extra);
  if (toks.every((t) => all.includes(t))) return 6;
  return -1;
}
db.function('cust_rank', { deterministic: true }, (name, code, phone, extra, q) => custRank(name, code, phone, extra, q));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  password_hash TEXT,
  can_login INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_pw INTEGER NOT NULL DEFAULT 1,
  commission_enabled INTEGER NOT NULL DEFAULT 1,
  aliases TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  grp TEXT NOT NULL DEFAULT 'Cắt',
  commission_rate REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  gender TEXT,
  birthday TEXT,
  source TEXT,
  hair_notes TEXT,
  notes TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE TABLE IF NOT EXISTS customer_refs (
  source TEXT NOT NULL, code TEXT NOT NULL, customer_id INTEGER NOT NULL REFERENCES customers(id),
  PRIMARY KEY (source, code)
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  guest_name TEXT,
  guest_phone TEXT,
  staff_id INTEGER REFERENCES users(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 60,
  service TEXT,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','arrived','done','cancelled','noshow')),
  note TEXT,
  visit_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
CREATE TABLE IF NOT EXISTS card_types (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  price INTEGER NOT NULL,
  value INTEGER NOT NULL,
  months INTEGER NOT NULL DEFAULT 12,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  card_type_id INTEGER REFERENCES card_types(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  value INTEGER NOT NULL,
  sold_at TEXT NOT NULL,
  expires_at TEXT,
  seller_id INTEGER REFERENCES users(id),
  sale_type TEXT NOT NULL DEFAULT 'new' CHECK (sale_type IN ('new','renewal','gift')),
  commission INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','refunded')),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS card_txns (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id),
  visit_id INTEGER,
  amount INTEGER NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  date TEXT NOT NULL,
  time TEXT,
  main_staff_id INTEGER REFERENCES users(id),
  assistant_id INTEGER REFERENCES users(id),
  subtotal INTEGER NOT NULL DEFAULT 0,
  surcharge INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  card_id INTEGER REFERENCES cards(id),
  card_paid INTEGER NOT NULL DEFAULT 0,
  cash_paid INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  tip INTEGER NOT NULL DEFAULT 0,
  main_commission INTEGER NOT NULL DEFAULT 0,
  assistant_commission INTEGER NOT NULL DEFAULT 0,
  hair_before TEXT,
  wish TEXT,
  formula TEXT,
  result TEXT,
  note TEXT,
  next_visit_date TEXT,
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done','deleted')),
  delete_reason TEXT,
  import_ref TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(date);
CREATE INDEX IF NOT EXISTS idx_visits_customer ON visits(customer_id);
CREATE TABLE IF NOT EXISTS visit_items (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id),
  name TEXT NOT NULL,
  grp TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  commission_rate REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  visit_id INTEGER REFERENCES visits(id),
  kind TEXT NOT NULL CHECK (kind IN ('before','after','other')),
  file TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL,
  ref TEXT NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (customer_id, type, ref)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

const DEFAULT_SETTINGS = {
  salon_name: 'Salon Nếp',
  return_days: '30',
  birthday_days: '7',
  card_expiry_days: '30',
  card_low_balance: '300000',
  assistant_rate: '0.03', // người phụ dòng không phải hóa chất (cắt…): trích từ hoa hồng dòng
  assistant_rate_chem: '0.05', // người phụ dòng hóa chất: trích 5% từ hoa hồng dòng (nhuộm 15% → chính 10% + phụ 5%)
  card_new_rate: '0.05',
  card_renewal_rate: '0.03',
  payment_methods: 'Tiền mặt,Chuyển khoản,Quẹt thẻ',
  salon_address: '',
  salon_phone: '',
  bank_info: '',
  receipt_footer: 'Cảm ơn quý khách đã tin chọn Nếp Hair. Hẹn gặp lại!',
  surcharge_salon_rate: '0.33',
  qr_bank: '', // mã ngân hàng cho QR chuyển khoản (VD: VCB, TCB, MB, 970436)
  qr_account: '',
  qr_name: '',
  formula_stock_from: '2026-11-01', // tự trừ kho theo công thức thợ ghi cho lượt từ ngày này (chỉ lượt sau lần kiểm kho gần nhất)
  book_money_until: '2026-12-01', // từ ngày này: sổ đặt lịch chỉ lấy LỊCH HẸN, tiền tính trên app (trống = vẫn lấy tiền từ sổ)
};
// Nâng cấp CSDL cũ: thêm cột cho lịch hẹn (lý do hủy, ai hủy, đã mời đặt lại)
{
  const have = new Set(db.prepare('PRAGMA table_info(appointments)').all().map((c) => c.name));
  for (const [col, type] of [['cancel_reason', 'TEXT'], ['cancelled_at', 'TEXT'], ['cancelled_by', 'INTEGER'], ['followup_at', 'TEXT']]) {
    if (!have.has(col)) db.exec(`ALTER TABLE appointments ADD COLUMN ${col} ${type}`);
  }
  // Gói thẻ có hạn cố định (VD: thẻ tri ân hết hạn 25/10/2027 dù tặng ngày nào)
  if (!db.prepare('PRAGMA table_info(card_types)').all().some((c) => c.name === 'fixed_expiry')) db.exec('ALTER TABLE card_types ADD COLUMN fixed_expiry TEXT');
  // Màu ô trong sổ đặt lịch Excel: xanh lá = tiền mặt, vàng = chuyển khoản, hồng = chưa thanh toán
  if (!db.prepare('PRAGMA table_info(appointments)').all().some((c) => c.name === 'pay_note')) db.exec('ALTER TABLE appointments ADD COLUMN pay_note TEXT');
  // Người phụ ghi trong ngoặc ở sổ đặt lịch, vd "C Điệp(Thu)" → điền sẵn khi thu tiền
  if (!db.prepare('PRAGMA table_info(appointments)').all().some((c) => c.name === 'assistant_id')) db.exec('ALTER TABLE appointments ADD COLUMN assistant_id INTEGER REFERENCES users(id)');
  // Cấp bậc thợ theo bảng giá (Director / Senior / Stylist / Junior) → chọn đúng giá cắt
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'level')) {
    db.exec('ALTER TABLE users ADD COLUMN level TEXT');
  }
}
// Cấp thợ ban đầu (Vinh 15/11/2026): chạy 1 lần, sau khi đã có tài khoản
function seedLevels() {
  if (db.prepare("SELECT 1 FROM settings WHERE key='levels_seeded'").get()) return;
  if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) return;
  {
    const f = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
    const LV = [['truong', 'Director'], ['duong', 'Stylist'], ['thoai', 'Junior']];
    for (const u of db.prepare('SELECT id, full_name FROM users').all()) {
      const words = f(u.full_name).split(/\s+/);
      const hit = LV.find(([k]) => words.includes(k));
      if (hit) db.prepare('UPDATE users SET level=? WHERE id=? AND level IS NULL').run(hit[1], u.id);
    }
  }
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('levels_seeded','1')").run();
}
{
  // Phụ thu (sau 19h…): cửa hàng giữ 33%, phần còn lại chia cho thợ làm lượt đó
  if (!db.prepare('PRAGMA table_info(visits)').all().some((c) => c.name === 'surcharge_main')) {
    db.exec('ALTER TABLE visits ADD COLUMN surcharge_main INTEGER NOT NULL DEFAULT 0; ALTER TABLE visits ADD COLUMN surcharge_assist INTEGER NOT NULL DEFAULT 0');
  }
  // Tip riêng: khách tặng riêng 1 người (không đưa vào quỹ tip chung)
  if (!db.prepare('PRAGMA table_info(visits)').all().some((c) => c.name === 'tip_private')) {
    db.exec('ALTER TABLE visits ADD COLUMN tip_private INTEGER NOT NULL DEFAULT 0; ALTER TABLE visits ADD COLUMN tip_private_to INTEGER REFERENCES users(id)');
  }
  // Lịch hẹn: người nhận lịch (ai nghe máy/nhắn tin chốt lịch) + đã sửa trên app → đồng bộ sổ không ghi đè/xóa
  if (!db.prepare('PRAGMA table_info(appointments)').all().some((c) => c.name === 'taken_by')) {
    db.exec('ALTER TABLE appointments ADD COLUMN taken_by INTEGER REFERENCES users(id); ALTER TABLE appointments ADD COLUMN manual_edit INTEGER NOT NULL DEFAULT 0');
  }
  // Thu ngân: 1 hóa đơn trả 2 cách (vd 300k tiền mặt + phần còn lại CK) – pay2_amount nằm TRONG cash_paid
  if (!db.prepare('PRAGMA table_info(visits)').all().some((c) => c.name === 'pay2_method')) {
    db.exec('ALTER TABLE visits ADD COLUMN pay2_method TEXT; ALTER TABLE visits ADD COLUMN pay2_amount INTEGER NOT NULL DEFAULT 0');
  }
  // Khách trả thiếu → ghi nợ: debt = số còn nợ (KHÔNG nằm trong cash_paid); trả nợ ngày nào tính tiền vào ngày đó
  if (!db.prepare('PRAGMA table_info(visits)').all().some((c) => c.name === 'debt')) {
    db.exec('ALTER TABLE visits ADD COLUMN debt INTEGER NOT NULL DEFAULT 0; ALTER TABLE visits ADD COLUMN debt_paid_at TEXT; ALTER TABLE visits ADD COLUMN debt_paid_method TEXT; ALTER TABLE visits ADD COLUMN debt_paid_by INTEGER');
  }
  // Bán thẻ 2 người: người tư vấn/giới thiệu + % hoa hồng của người chốt
  if (!db.prepare('PRAGMA table_info(cards)').all().some((c) => c.name === 'consultant_id')) {
    db.exec('ALTER TABLE cards ADD COLUMN consultant_id INTEGER REFERENCES users(id); ALTER TABLE cards ADD COLUMN seller_share INTEGER NOT NULL DEFAULT 100; ALTER TABLE cards ADD COLUMN consultant_commission INTEGER NOT NULL DEFAULT 0');
  }
  // Thợ phụ trách + công thức chuẩn của khách
  if (!db.prepare('PRAGMA table_info(customers)').all().some((c) => c.name === 'staff_id')) {
    db.exec('ALTER TABLE customers ADD COLUMN staff_id INTEGER REFERENCES users(id); ALTER TABLE customers ADD COLUMN formula TEXT; ALTER TABLE customers ADD COLUMN formula_at TEXT; ALTER TABLE customers ADD COLUMN formula_by INTEGER');
    // Điền sẵn từ lịch sử: thợ làm chính nhiều nhất + công thức lượt gần nhất
    db.exec(`UPDATE customers SET staff_id = (SELECT main_staff_id FROM visits v WHERE v.customer_id=customers.id AND v.status='done' AND main_staff_id IS NOT NULL
        GROUP BY main_staff_id ORDER BY COUNT(*) DESC, MAX(date) DESC LIMIT 1)`);
    db.exec(`UPDATE customers SET (formula, formula_at, formula_by) = (SELECT formula, date, main_staff_id FROM visits v WHERE v.customer_id=customers.id AND v.status='done'
        AND formula IS NOT NULL AND formula<>'' ORDER BY date DESC, id DESC LIMIT 1)`);
  }
}
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);
if (!db.prepare("SELECT 1 FROM settings WHERE key='mig_book_until_1126'").get()) {
  db.prepare("UPDATE settings SET value='2026-11-26' WHERE key='book_money_until' AND (value='2026-12-01' OR value='')").run();
  db.prepare("INSERT INTO settings(key,value) VALUES ('mig_book_until_1126','1')").run();
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function num(key) { return Number(getSettings()[key] || 0); }

// Dịch vụ & tỷ lệ hoa hồng mặc định lấy từ tab "Danh mục" (Nhật ký V1) và "Lương tổ hóa chất" (CRM Nếp Hair).
// Tỷ lệ là MẶC ĐỊNH TẠM — chủ salon chỉnh lại trong Cài đặt > Dịch vụ.
const DEFAULT_SERVICES = [
  ['Nhuộm', 1250000, 'Hóa chất', 0.15], ['Nâng sáng / tẩy', 1000000, 'Hóa chất', 0.15],
  ['Uốn', 1000000, 'Hóa chất', 0.18], ['Duỗi', 0, 'Hóa chất', 0.18],
  ['Phục hồi / hấp dưỡng', 0, 'Hóa chất', 0.2], ['Chấm chân', 900000, 'Hóa chất', 0.15],
  ['Cắt tóc nam – Director', 685000, 'Cắt', 0.03], ['Cắt tóc nữ – Director', 785000, 'Cắt', 0.03],
  ['Cắt tóc nam – Stylist', 180000, 'Cắt', 0.03], ['Cắt tóc nữ – Stylist', 300000, 'Cắt', 0.03],
  ['Cắt mái', 150000, 'Cắt', 0.03], ['Cạo râu', 60000, 'Cắt', 0.03],
  ['Gội', 100000, 'Gội & chăm sóc', 0.3], ['Massage đầu', 80000, 'Gội & chăm sóc', 0],
  ['Tẩy da chết da đầu', 160000, 'Gội & chăm sóc', 0], ['Tẩy da chết mặt', 120000, 'Gội & chăm sóc', 0],
  ['Rửa mặt', 60000, 'Gội & chăm sóc', 0], ['Tạo kiểu', 50000, 'Gội & chăm sóc', 0.03],
  ['Đắp mặt nạ (mask)', 100000, 'Gội & chăm sóc', 0], ['Ủ lạnh', 160000, 'Gội & chăm sóc', 0],
  ['Bán sản phẩm', 0, 'Bán sản phẩm', 0.08],
];
const DEFAULT_CARD_TYPES = [
  ['Thẻ Bạc', 2000000, 2200000, 6], ['Thẻ Vàng', 5000000, 5750000, 12],
  ['Thẻ Kim cương', 10000000, 12000000, 12], ['Thẻ Black (VIP)', 50000000, 62500000, 24],
];
const GIFT_CARD = { name: 'Thẻ tri ân 1Tr', value: 1000000, expires: '2027-10-25' };
const GROUPS = ['Cắt', 'Gội & chăm sóc', 'Hóa chất', 'Bán sản phẩm'];

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM services').get().c === 0) {
    const ins = db.prepare('INSERT INTO services(name,price,grp,commission_rate) VALUES (?,?,?,?)');
    for (const s of DEFAULT_SERVICES) ins.run(...s);
  }
  if (db.prepare('SELECT COUNT(*) c FROM card_types').get().c === 0) {
    const ins = db.prepare('INSERT INTO card_types(name,price,value,months) VALUES (?,?,?,?)');
    for (const c of DEFAULT_CARD_TYPES) ins.run(...c);
  }
  // Thẻ tri ân khai trương: anh Trường tặng khách cũ quay lại, 1 triệu, hạn 25/10/2026 – 25/10/2027
  if (!db.prepare('SELECT 1 FROM card_types WHERE name=?').get(GIFT_CARD.name)) {
    db.prepare('INSERT INTO card_types(name,price,value,months,fixed_expiry) VALUES (?,0,?,12,?)').run(GIFT_CARD.name, GIFT_CARD.value, GIFT_CARD.expires);
  }
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    // 6 tài khoản ban đầu. Mật khẩu tạm ngẫu nhiên, bắt buộc đổi ở lần đăng nhập đầu.
    const accounts = [
      ['vinh', 'Vinh', 'owner', 0, ''],
      ['truong', 'Trường', 'manager', 0, 'Truong'],
      ['duong', 'Dương', 'staff', 1, 'Duong'],
      ['thu', 'Chị Thu', 'staff', 1, 'Thu,C Thu'],
      ['thoai', 'Thoại', 'staff', 1, 'Thoai'],
      ['nhanvien6', 'Nhân viên 6', 'staff', 1, ''],
    ];
    const ins = db.prepare('INSERT INTO users(username,full_name,role,password_hash,commission_enabled,aliases) VALUES (?,?,?,?,?,?)');
    const lines = [];
    for (const [u, n, r, c, a] of accounts) {
      const pw = process.env.SEED_PASSWORD || crypto.randomBytes(4).toString('hex');
      ins.run(u, n, r, bcrypt.hashSync(pw, 10), c, a);
      lines.push(`${u.padEnd(10)} ${pw}   (${n})`);
    }
    const msg = 'TÀI KHOẢN BAN ĐẦU (đổi mật khẩu ở lần đăng nhập đầu tiên):\n' + lines.join('\n') + '\n';
    if (!process.env.SEED_PASSWORD) fs.writeFileSync(path.join(DATA_DIR, 'mat-khau-ban-dau.txt'), msg, { mode: 0o600 });
    if (process.env.NODE_ENV !== 'test') console.log('\n' + msg);
  }
}
seed();
seedLevels();

function audit(userId, action, entity, entityId, detail) {
  db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,detail) VALUES (?,?,?,?,?)')
    .run(userId || null, action, entity || null, entityId || null, detail == null ? null : JSON.stringify(detail));
}

// So sánh trước/sau → { field: [cũ, mới] } chỉ những ô thay đổi (để xem lịch sử chỉnh sửa)
function diffObj(before, after, keys) {
  const out = {};
  for (const k of keys || Object.keys(after)) {
    const a = before[k] ?? null, b = after[k] ?? null;
    if ((a === '' ? null : a) !== (b === '' ? null : b)) out[k] = [a, b];
  }
  return out;
}

function nextCode(table, prefix, width) {
  const rows = db.prepare(`SELECT code FROM ${table} WHERE code LIKE ?`).all(prefix + '%');
  let max = 0;
  for (const r of rows) { const n = parseInt(String(r.code).slice(prefix.length), 10); if (n > max) max = n; }
  return prefix + String(max + 1).padStart(width, '0');
}

// Người nhà chủ (Vinh, Beo…): giảm 50%, không tính vào doanh số tổng xét thưởng của thợ.
// Tài khoản không làm dịch vụ (Vinh) → ẩn khỏi danh sách thợ
{
  const cc = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
  if (!cc.includes('owner_family')) {
    db.exec('ALTER TABLE customers ADD COLUMN owner_family INTEGER NOT NULL DEFAULT 0');
    // Vinh 16/11: Vinh (Vinh Phạm) và Beo là người nhà
    const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
    for (const c of db.prepare('SELECT id, name FROM customers').all()) if (['vinh pham', 'vinh', 'beo', 'e beo'].includes(fold(c.name))) db.prepare('UPDATE customers SET owner_family=1 WHERE id=?').run(c.id);
  }
  const uc = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!uc.includes('works')) {
    db.exec('ALTER TABLE users ADD COLUMN works INTEGER NOT NULL DEFAULT 1');
    db.prepare("UPDATE users SET works=0 WHERE username='vinh'").run();
  }
}
// Vinh 26/11: đổi chữ 'Người nhà' trên hóa đơn thành 'Ưu đãi đặc biệt' cho mỹ miều
db.prepare("UPDATE visits SET discount_reason='Ưu đãi đặc biệt – giảm 50%' WHERE discount_reason='Người nhà – giảm 50%'").run();
// Khách cắt định kỳ (vd anh Minh PH 14 ngày/lần, gọi trước hỏi giờ) + thợ không áp bảo hành chỉnh form cắt
{
  const cc = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
  if (!cc.includes('cycle_days')) db.exec('ALTER TABLE customers ADD COLUMN cycle_days INTEGER; ALTER TABLE customers ADD COLUMN cycle_call INTEGER NOT NULL DEFAULT 0; ALTER TABLE customers ADD COLUMN cycle_note TEXT');
  const uc = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!uc.includes('no_cut_warranty')) {
    db.exec('ALTER TABLE users ADD COLUMN no_cut_warranty INTEGER NOT NULL DEFAULT 0');
    // Vinh 16/11: cắt của anh Trường không cần lưu ý bảo hành chỉnh form
    db.prepare("UPDATE users SET no_cut_warranty=1 WHERE username='truong' OR full_name='Trường'").run();
  }
}
// Người làm từng dòng dịch vụ (trống = thợ chính) + hoa hồng của dòng
{
  const ic = db.prepare('PRAGMA table_info(visit_items)').all().map((c) => c.name);
  if (!ic.includes('staff_id')) db.exec('ALTER TABLE visit_items ADD COLUMN staff_id INTEGER');
  if (!ic.includes('commission')) db.exec('ALTER TABLE visit_items ADD COLUMN commission INTEGER');
  // Người phụ của dòng: NULL = theo người phụ chung của phiếu, 0 = không có, >0 = người phụ riêng
  if (!ic.includes('assistant_id')) db.exec('ALTER TABLE visit_items ADD COLUMN assistant_id INTEGER');
  if (!ic.includes('asst_commission')) db.exec('ALTER TABLE visit_items ADD COLUMN asst_commission INTEGER');
}
module.exports = {
  diffObj, db, DATA_DIR, getSettings, num, audit, nextCode, GROUPS, GIFT_CARD };
