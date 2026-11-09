# Bảo mật CRM Salon Nếp

## Nguyên tắc
1. **Quyền kiểm tra ở máy chủ**, không dựa vào việc ẩn nút trên giao diện. Mọi API đều kiểm tra vai trò (`server/index.js`: `OWNER`, `MGR`, và các kiểm tra trong `server/logic.js`).
2. **Mật khẩu** lưu dạng băm bcrypt, không lưu bản rõ. Mật khẩu ban đầu ngẫu nhiên, bắt buộc đổi ở lần đăng nhập đầu. Đổi mật khẩu sẽ đăng xuất các phiên khác.
3. **Phiên đăng nhập**: cookie `HttpOnly`, `SameSite=Lax`, `Secure` khi đặt `COOKIE_SECURE=1`; hết hạn sau 14 ngày. Khóa tài khoản / đặt lại mật khẩu xóa phiên ngay.
4. **Chống dò mật khẩu**: sai 5 lần / 10 phút theo tài khoản + IP thì tạm khóa.
5. **Dữ liệu khách**: nhân viên không xuất Excel, không xem tổng chi tiêu và tiền các lượt không phải của mình. Xóa khách chỉ Lãnh đạo (xóa mềm).
6. **Tiền**: nhân viên chỉ ghi/sửa lượt của mình trong ngày; sửa/xóa lượt sau đó phải qua Quản lý, xóa bắt buộc ghi lý do. Giảm giá bắt buộc ghi lý do. Mọi thao tác tiền, thẻ, xuất dữ liệu ghi vào nhật ký thao tác (chỉ Lãnh đạo xem).
7. **Ảnh**: chỉ nhận JPG/PNG/WEBP (kiểm tra nội dung file, không tin đuôi file), tối đa 8MB, chỉ xem khi đã đăng nhập.
8. **Không đẩy dữ liệu thật lên Git**: thư mục `data/` đã nằm trong `.gitignore`.

## Trước khi dùng dữ liệu thật
- Chạy sau HTTPS (Caddy/Cloudflare) và đặt `COOKIE_SECURE=1`.
- Xóa file `data/mat-khau-ban-dau.txt` sau khi đã phát mật khẩu.
- Sao lưu thư mục `DATA_DIR` ra ngoài máy chủ hằng tuần.
