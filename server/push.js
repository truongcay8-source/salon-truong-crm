'use strict';
// Thông báo về điện thoại / máy tính (Web Push). Khóa VAPID tự tạo 1 lần, lưu trong settings.
// iPhone: phải "Thêm vào Màn hình chính" rồi mở app từ biểu tượng đó mới bật được thông báo (iOS 16.4+).
const webpush = require('web-push');
const { db, getSettings } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), keys TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'mention', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);

function keys() {
  const s = getSettings();
  if (s.vapid_public && s.vapid_private) return { publicKey: s.vapid_public, privateKey: s.vapid_private };
  const k = webpush.generateVAPIDKeys();
  const up = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  up.run('vapid_public', k.publicKey); up.run('vapid_private', k.privateKey);
  return k;
}
let configured = false;
function setup() {
  if (configured) return;
  const k = keys();
  webpush.setVapidDetails('mailto:noreply@salon-nep.local', k.publicKey, k.privateKey);
  configured = true;
}

function subscribe(userId, sub, mode) {
  if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Đăng ký thông báo không hợp lệ');
  db.prepare(`INSERT INTO push_subs(endpoint,user_id,keys,mode) VALUES (?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, keys=excluded.keys, mode=excluded.mode`).run(sub.endpoint, userId, JSON.stringify(sub.keys), mode === 'all' ? 'all' : 'mention');
}
function unsubscribe(endpoint) { db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(String(endpoint || '')); }
function state(userId) {
  const r = db.prepare('SELECT mode, COUNT(*) n FROM push_subs WHERE user_id=? GROUP BY mode ORDER BY n DESC').get(userId);
  return { public_key: keys().publicKey, devices: r ? db.prepare('SELECT COUNT(*) n FROM push_subs WHERE user_id=?').get(userId).n : 0, mode: r ? r.mode : 'mention' };
}

// targets: [{ user_id, important }] — important (được gọi tên / việc giao cho mình) gửi cả cho người chọn "chỉ khi gọi tên"
async function send(targets, payload) {
  if (!targets.length) return 0;
  setup();
  const imp = new Map(); for (const t of targets) imp.set(t.user_id, imp.get(t.user_id) || !!t.important);
  const subs = db.prepare(`SELECT * FROM push_subs WHERE user_id IN (${[...imp.keys()].map(() => '?').join(',')})`).all(...imp.keys());
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    if (s.mode !== 'all' && !imp.get(s.user_id)) return;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(payload), { TTL: 3600 * 6 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) unsubscribe(s.endpoint); // máy đã gỡ / tắt thông báo
      else console.error('Gửi thông báo lỗi:', e.statusCode || e.message);
    }
  }));
  return sent;
}
// Gửi không chặn luồng chính
function fire(targets, payload) { send(targets, payload).catch((e) => console.error('Thông báo lỗi:', e.message)); }

module.exports = { subscribe, unsubscribe, state, send, fire, keys };
