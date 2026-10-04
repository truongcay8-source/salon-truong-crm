# Kiến trúc bảo mật CRM Salon Trường

## Nguyên tắc bắt buộc
1. Không có đăng ký xong dùng ngay. Tài khoản mới luôn là `PENDING` và `role = NULL`.
2. `PENDING` không được đọc khách hàng, lịch, hồ sơ tóc, doanh số hoặc hoa hồng.
3. Quản lý có thể duyệt `STAFF` và `RECEPTION`. Chỉ `OWNER` có thể duyệt `MANAGER`.
4. Doanh số nằm trong bảng `invoices`: chỉ `OWNER`/`MANAGER` được `SELECT`.
5. Hoa hồng nằm trong bảng `commissions`: nhân viên chỉ `SELECT` được hàng có `staff_id = auth.uid()`; quản lý/lãnh đạo xem toàn bộ.
6. Không coi việc ẩn nút/menu là bảo mật. UI chỉ là trải nghiệm; quyền thật nằm ở PostgreSQL RLS.
7. Không cho client cập nhật trực tiếp `profiles.role` hoặc `profiles.status`. Duyệt tài khoản qua RPC `approve_user()`.
8. Mật khẩu không lưu trong bảng ứng dụng hoặc localStorage khi production; dùng Supabase Auth/Auth provider.
9. Bật HTTPS, audit log, backup và MFA cho OWNER trước khi dùng dữ liệu thật.

## Luồng đăng ký
`Đăng ký Auth` → trigger tạo `profiles(PENDING, role=NULL)` → không có quyền dữ liệu → Owner/Manager mở danh sách chờ duyệt → gán role → RPC `approve_user()` → `ACTIVE` → RLS tự cấp đúng phạm vi.

## Phân quyền dữ liệu
- OWNER: toàn bộ dữ liệu và cấu hình.
- MANAGER: xem doanh số, toàn bộ hoa hồng, khách, lịch; duyệt Staff/Reception.
- STAFF: xem khách/lịch/hồ sơ tóc phục vụ công việc; chỉ xem hoa hồng của bản thân; không xem doanh số.
- RECEPTION: xem khách/lịch; tạo giao dịch theo workflow; không query báo cáo doanh số; hoa hồng (nếu có) chỉ của chính mình.

## Lưu ý bản demo
`index.html/app.js` là prototype giao diện chạy localStorage để duyệt UX. Nó mô phỏng luồng chờ duyệt nhưng không thể cung cấp bảo mật production. File `supabase_schema.sql` là baseline cần triển khai lên database thật.
