'use strict';
const ExcelJS = require('exceljs');
const { db } = require('./db');
const { cardBalance } = require('./logic');

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(([header, key, width, fmt]) => ({ header, key, width: width || 16, style: fmt ? { numFmt: fmt } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E6D8' } };
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}
const M = '#,##0';

async function exportWorkbook({ from, to }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Salon Nếp';
  wb.created = new Date();

  const customers = db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM visits v WHERE v.customer_id=c.id AND v.status='done') visits,
      (SELECT MAX(date) FROM visits v WHERE v.customer_id=c.id AND v.status='done') last_visit,
      (SELECT COALESCE(SUM(total),0) FROM visits v WHERE v.customer_id=c.id AND v.status='done') spend
    FROM customers c WHERE c.deleted=0 ORDER BY c.code`).all();
  sheet(wb, 'Khách hàng', [
    ['Mã khách', 'code', 10], ['Tên khách', 'name', 28], ['Số điện thoại', 'phone', 14], ['Giới tính', 'gender', 9],
    ['Sinh nhật', 'birthday', 12], ['Nguồn khách', 'source', 14], ['Lưu ý tóc / da đầu', 'hair_notes', 40], ['Ghi chú', 'notes', 40],
    ['Số lượt', 'visits', 8], ['Lần gần nhất', 'last_visit', 12], ['Tổng chi tiêu', 'spend', 14, M],
  ], customers);

  const visits = db.prepare(`SELECT v.*, c.code customer_code, c.name customer_name, c.phone, m.full_name main_name, a.full_name assist_name, cd.code card_code,
      (SELECT GROUP_CONCAT(name, ' + ') FROM visit_items i WHERE i.visit_id=v.id) services
    FROM visits v LEFT JOIN customers c ON c.id=v.customer_id LEFT JOIN users m ON m.id=v.main_staff_id LEFT JOIN users a ON a.id=v.assistant_id
    LEFT JOIN cards cd ON cd.id=v.card_id
    WHERE v.status='done' AND v.date BETWEEN ? AND ? ORDER BY v.date, v.time, v.id`).all(from, to);
  sheet(wb, 'Lượt làm', [
    ['Mã lượt', 'code', 9], ['Ngày', 'date', 11], ['Giờ', 'time', 7], ['Mã khách', 'customer_code', 9], ['Tên khách', 'customer_name', 24],
    ['SĐT', 'phone', 13], ['Dịch vụ', 'services', 34], ['Thợ chính', 'main_name', 12], ['Người phụ', 'assist_name', 12],
    ['Tạm tính', 'subtotal', 12, M], ['Phụ thu', 'surcharge', 10, M], ['Giảm giá', 'discount', 10, M], ['Lý do giảm', 'discount_reason', 16],
    ['Doanh số', 'total', 12, M], ['Trừ thẻ', 'card_paid', 11, M], ['Mã thẻ', 'card_code', 9], ['Thực thu', 'cash_paid', 12, M],
    ['Hình thức TT', 'payment_method', 13], ['Tip', 'tip', 9, M], ['HH thợ chính', 'main_commission', 12, M], ['HH người phụ', 'assistant_commission', 12, M],
    ['Tình trạng tóc trước', 'hair_before', 30], ['Mong muốn', 'wish', 24], ['Công thức', 'formula', 40], ['Kết quả', 'result', 24], ['Ghi chú', 'note', 24],
  ], visits);

  const appts = db.prepare(`SELECT a.*, COALESCE(c.name,a.guest_name) name, COALESCE(c.phone,a.guest_phone) phone, c.code customer_code, u.full_name staff_name
    FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.staff_id
    WHERE a.date BETWEEN ? AND ? ORDER BY a.date, a.time`).all(from, '9999-12-31');
  const ST = { booked: 'Đã đặt', arrived: 'Đã đến', done: 'Hoàn thành', cancelled: 'Đã hủy', noshow: 'Không đến' };
  sheet(wb, 'Lịch hẹn', [
    ['Ngày', 'date', 11], ['Giờ', 'time', 7], ['Mã khách', 'customer_code', 9], ['Tên khách', 'name', 24], ['SĐT', 'phone', 13],
    ['Dịch vụ', 'service', 24], ['Thợ', 'staff_name', 12], ['Trạng thái', 'status_vi', 12], ['Ghi chú', 'note', 30],
  ], appts.map((a) => ({ ...a, status_vi: ST[a.status] })));

  const cards = db.prepare(`SELECT cd.*, c.code customer_code, c.name customer_name, c.phone, u.full_name seller_name FROM cards cd
    JOIN customers c ON c.id=cd.customer_id LEFT JOIN users u ON u.id=cd.seller_id ORDER BY cd.id`).all();
  const CS = { active: 'Đang dùng', closed: 'Đã đóng', refunded: 'Đã hoàn' };
  const SALE = { new: 'Mới', renewal: 'Mua lại', gift: 'Tặng' };
  sheet(wb, 'Thẻ trả trước', [
    ['Mã thẻ', 'code', 9], ['Gói', 'name', 16], ['Mã khách', 'customer_code', 9], ['Tên khách', 'customer_name', 24], ['SĐT', 'phone', 13],
    ['Ngày bán', 'sold_at', 11], ['Hạn dùng', 'expires_at', 11], ['Giá bán', 'price', 12, M], ['Giá trị', 'value', 12, M], ['Số dư', 'balance', 12, M],
    ['Loại', 'sale_vi', 9], ['NV bán', 'seller_name', 12], ['HH bán thẻ', 'commission', 11, M], ['Trạng thái', 'status_vi', 11],
  ], cards.map((c) => ({ ...c, balance: cardBalance(c.id), status_vi: CS[c.status], sale_vi: SALE[c.sale_type] })));

  sheet(wb, 'Dịch vụ', [['Dịch vụ', 'name', 28], ['Giá niêm yết', 'price', 13, M], ['Nhóm doanh số', 'grp', 16], ['% hoa hồng', 'rate', 11], ['Đang dùng', 'active_vi', 10]],
    db.prepare('SELECT * FROM services ORDER BY grp, name').all().map((s) => ({ ...s, rate: s.commission_rate, active_vi: s.active ? 'Có' : 'Không' })));

  return wb.xlsx.writeBuffer();
}

module.exports = { exportWorkbook };
