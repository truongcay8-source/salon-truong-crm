# CRM Salon Trường - MVP + Security Baseline

Bản Web CRM cho Salon Trường, 23/25 Triệu Việt Vương, Hà Nội.

## MVP hiện có
- Đăng nhập theo 4 vai trò: Lãnh đạo, Quản lý, Nhân viên, Lễ tân/Thu ngân.
- Đăng ký tài khoản mới → mặc định **Chờ duyệt** → chưa được truy cập CRM.
- Lãnh đạo/Quản lý duyệt tài khoản và gán vai trò.
- Quản lý chỉ được cấp Staff/Reception; chỉ Owner được cấp Manager.
- Nhân viên chỉ xem hoa hồng của chính mình.
- Doanh số chỉ Lãnh đạo/Quản lý xem.
- Quản lý khách, lịch hẹn, hồ sơ tóc, nhân sự, hoa hồng, báo cáo.

## Tài khoản demo
- admin / 123456
- manager / 123456
- stylist1 / 123456
- reception / 123456
- newstaff / 123456 → tài khoản mẫu đang **Chờ duyệt**, không đăng nhập được trước khi được duyệt.

## Chạy thử giao diện
Mở `index.html`, hoặc chạy server tĩnh:
`python3 -m http.server 8080`

## Bảo mật production
Bản localStorage chỉ là prototype UX. Không dùng dữ liệu thật trên bản này.

Production cần Supabase/PostgreSQL:
- `supabase_schema.sql`: schema + RLS + RPC duyệt tài khoản.
- `SECURITY.md`: nguyên tắc bảo mật và luồng phân quyền.

### Quyền tại database
- `PENDING`: không đọc được dữ liệu salon.
- `OWNER/MANAGER`: đọc doanh số và toàn bộ hoa hồng.
- `STAFF/RECEPTION`: không đọc bảng doanh số.
- Hoa hồng: user thường chỉ đọc hàng có `staff_id = auth.uid()`.

Trước khi đưa vào vận hành thật cần bổ sung: audit log, MFA cho Owner, backup, cloud storage ảnh Before/After, rate limit, session expiry, khóa/xóa tài khoản nhân sự nghỉ việc và kiểm thử RLS bằng test tự động.
