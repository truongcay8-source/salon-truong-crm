# CRM Salon Nếp

Phần mềm quản lý salon chạy trên trình duyệt (điện thoại + máy tính) cho 6 người dùng, 3 cấp quyền.

## Tính năng

| Mục | Nội dung |
|---|---|
| **Tài khoản** | Mỗi người 1 tài khoản + mật khẩu riêng (mã hóa bcrypt). Bắt buộc đổi mật khẩu ở lần đầu. Sai 5 lần khóa 10 phút. Khóa tài khoản nhân viên nghỉ việc → mất truy cập ngay. |
| **3 cấp quyền** | **Lãnh đạo**: toàn quyền, tài khoản, tham số, nhật ký thao tác, sao lưu. **Quản lý**: doanh số toàn tiệm, nhập/xuất Excel, sửa/xóa lượt, giá dịch vụ, gói thẻ. **Nhân viên**: lịch hẹn, khách, ghi lượt làm trong ngày, ảnh; chỉ xem doanh số/hoa hồng của mình; không xuất dữ liệu; không thấy tiền lượt của người khác. |
| **Khách hàng** | Hồ sơ, SĐT (chặn trùng), sinh nhật, lưu ý tóc, lịch sử từng lượt kèm công thức màu. |
| **Ảnh trước/sau** | Chụp từ điện thoại, tự nén ~1600px, gắn vào từng lượt làm. Chỉ người đã đăng nhập mới xem được. |
| **Lịch hẹn** | Theo ngày / theo thợ, cảnh báo trùng giờ, trạng thái Đã đặt → Đã đến → Hoàn thành / Hủy / Không đến, bấm "Thu tiền" từ lịch. |
| **Lượt làm (thu tiền)** | Nhiều dịch vụ/lượt, thợ chính + người phụ, phụ thu, giảm giá (bắt buộc lý do), trừ thẻ trả trước, hình thức thanh toán, tip. |
| **Doanh số & hoa hồng** | Theo nhân viên × nhóm (Cắt / Gội & chăm sóc / Hóa chất / Bán sản phẩm). HH theo % từng dịch vụ, % người phụ, % bán thẻ mới/mua lại. Tách **doanh số dịch vụ** và **tiền vào thực tế** (tiền bán thẻ tính khi bán, doanh số tính khi dùng — không cộng 2 lần). |
| **Thẻ trả trước** | Bạc / Vàng / Kim cương / Black (theo file Excel), số dư, trừ dần, hạn dùng, gia hạn, điều chỉnh có lý do, hoàn thẻ thu hồi hoa hồng. |
| **Nhắc nhở** | Sinh nhật 7 ngày tới, thẻ sắp hết hạn / số dư thấp, khách quá 30 ngày chưa quay lại, gọi xác nhận lịch ngày mai. Nút gọi điện / Zalo, đánh dấu "Đã liên hệ". |
| **Excel** | Nhập trực tiếp 2 file đang dùng (*Salon Nếp – Nhật ký*, *CRM Nếp Hair*) và file xuất từ phần mềm. Xem trước trước khi nhập; nhập lại không bị nhân đôi. Xuất 5 tab: Khách hàng, Lượt làm, Lịch hẹn, Thẻ, Dịch vụ. |
| **Kiểm soát** | Nhật ký thao tác (ai sửa/xóa lượt thu tiền, chỉnh thẻ, xuất dữ liệu). Sao lưu tự động 6 giờ/lần, giữ 30 bản. |

## Chạy thử trên máy

Cần Node.js 20 trở lên.

```bash
npm install
npm start            # mở http://localhost:3000
npm test             # kiểm thử phân quyền + nghiệp vụ
```

Lần chạy đầu tạo 6 tài khoản và in mật khẩu tạm ra màn hình, đồng thời lưu ở `data/mat-khau-ban-dau.txt` (xóa file này sau khi đã phát mật khẩu):

| Đăng nhập | Tên | Vai trò |
|---|---|---|
| `vinh` | Vinh | Lãnh đạo |
| `truong` | Trường | Quản lý (không tính hoa hồng) |
| `duong` | Dương | Nhân viên |
| `thu` | Chị Thu | Nhân viên |
| `thoai` | Thoại | Nhân viên |
| `nhanvien6` | Nhân viên 6 | Nhân viên (đổi tên trong Cài đặt) |

Lãnh đạo đổi tên, vai trò, khóa/mở, đặt lại mật khẩu trong **Cài đặt › Nhân viên & mật khẩu**.

## Đưa dữ liệu cũ vào

1. Đăng nhập `vinh` → **Nhập / Xuất Excel**.
2. Chọn `Salon_Nep_Nhat_ky V1.xlsx` → **Xem trước** → **Nhập vào hệ thống** (115 khách, 147 lượt, 89.488.000đ).
3. Chọn `CRM_Nep_Hair_1.xlsx` → nhập (không tick "Nhập cả lịch sử") để bổ sung giới tính, kênh đặt, ghi chú và khách chỉ có trong file này.
4. Kiểm tra danh sách "khách ghép theo TÊN" trong kết quả.

> Hai file ghi **cùng các lượt 25/10–6/11 nhưng số tiền khác nhau** (Nhật ký 89,49tr vs Lịch sử 81,03tr). Phần mềm lấy **Nhật ký** làm chuẩn để không cộng doanh số 2 lần.

## Cài lên máy chủ (khuyên dùng: VPS ~100–150k/tháng)

VPS Ubuntu 1 CPU / 1GB RAM là đủ cho 6 người.

**Cách nhanh nhất — 1 lệnh** (đăng nhập VPS bằng root, dán lệnh dưới):

```bash
curl -fsSL https://raw.githubusercontent.com/truongcay8-source/salon-truong-crm/main/scripts/install-vps.sh | bash
```

Script tự cài Node.js, Caddy (HTTPS miễn phí), chạy nền, bật tường lửa, đặt giờ Việt Nam, rồi in ra đường link (dạng `https://1-2-3-4.sslip.io` nếu chưa có tên miền) và mật khẩu ban đầu của 6 tài khoản. Có tên miền riêng: trỏ bản ghi A về IP VPS rồi chạy `... | DOMAIN=crm.tenmien.vn bash`. **Chạy lại đúng lệnh này để cập nhật bản mới**, dữ liệu giữ nguyên.

Cài thủ công:

```bash
# 1. Cài Node 22 + Caddy (tự cấp HTTPS miễn phí)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs caddy
# 2. Lấy mã nguồn
git clone https://github.com/truongcay8-source/salon-truong-crm.git /opt/salon && cd /opt/salon && npm ci --omit=dev
# 3. Chạy nền bằng systemd (xem mẫu dưới), rồi cấu hình Caddy:
#    /etc/caddy/Caddyfile:   crm.ten-mien-cua-ban.vn { reverse_proxy localhost:3000 }
```

Mẫu `/etc/systemd/system/salon.service`:

```ini
[Service]
WorkingDirectory=/opt/salon
Environment=PORT=3000 DATA_DIR=/opt/salon-data COOKIE_SECURE=1 TZ=Asia/Ho_Chi_Minh
ExecStart=/usr/bin/node server/index.js
Restart=always
[Install]
WantedBy=multi-user.target
```

Hoặc dùng Docker: `docker build -t salon . && docker run -d -p 3000:3000 -e TZ=Asia/Ho_Chi_Minh -v /opt/salon-data:/data salon`.

**Chạy trên máy tính ở tiệm (0đ):** `npm start` trên máy luôn bật, rồi dùng Cloudflare Tunnel (miễn phí) để có đường link HTTPS. Rủi ro: máy tắt/mất điện là không dùng được, ổ cứng hỏng là mất dữ liệu nếu không sao lưu ra ngoài.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 3000 | Cổng web |
| `DATA_DIR` | `./data` | Nơi lưu CSDL `salon.db`, ảnh `photos/`, sao lưu `backups/` |
| `COOKIE_SECURE` | — | Đặt `1` khi chạy sau HTTPS |
| `TZ` | theo máy | Đặt `Asia/Ho_Chi_Minh` để "hôm nay" đúng giờ Việt Nam |
| `BACKUP_KEEP_DAYS` | 30 | Số bản sao lưu giữ lại |

### Sao lưu

Toàn bộ dữ liệu nằm trong thư mục `DATA_DIR`. Phần mềm tự sao lưu CSDL; **ảnh và bản sao lưu vẫn nằm trên cùng máy chủ**, nên mỗi tuần cần chép thư mục này ra ngoài (Google Drive, ổ cứng), hoặc Lãnh đạo tải bản sao lưu trong **Cài đặt › Sao lưu**.

## Cấu trúc mã

```
server/index.js     API + đăng nhập + phân quyền
server/db.js        CSDL SQLite, dữ liệu mặc định (dịch vụ, gói thẻ, 6 tài khoản)
server/logic.js     Lượt làm, thẻ, hoa hồng, báo cáo, nhắc nhở
server/importer.js  Nhập Excel (2 mẫu hiện có + mẫu xuất)
server/exporter.js  Xuất Excel
server/backup.js    Sao lưu tự động
public/             Giao diện (HTML/CSS/JS thuần, không cần build)
test/               Kiểm thử
```
