'use strict';
const path = require('path');
const fs = require('fs');
const { db, DATA_DIR } = require('./db');

const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const dir = path.join(DATA_DIR, 'backups');

function stamp() {
  const d = new Date();
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

// Sao lưu cơ sở dữ liệu (an toàn khi đang chạy). Ảnh nằm trong data/photos — sao lưu cả thư mục data/ ra ngoài máy chủ định kỳ.
async function backupNow() {
  const file = `salon-${stamp()}.db`;
  await db.backup(path.join(dir, file));
  const files = fs.readdirSync(dir).filter((f) => /^salon-[\d-]+\.db$/.test(f)).sort();
  while (files.length > KEEP_DAYS) fs.unlinkSync(path.join(dir, files.shift()));
  return file;
}

function startBackups() {
  const run = () => backupNow().catch((e) => console.error('Sao lưu lỗi:', e));
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}

module.exports = { backupNow, startBackups };
