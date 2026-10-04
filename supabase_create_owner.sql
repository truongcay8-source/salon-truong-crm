-- Tạo OWNER đầu tiên cho CRM Salon Trường
-- Chạy SAU khi đã chạy supabase_schema.sql.
--
-- Các bước:
-- 1. Supabase > Authentication > Users > Add user (hoặc đăng ký qua app) bằng email của bạn.
--    Trigger handle_new_user sẽ tự tạo profile ở trạng thái PENDING.
-- 2. Thay email bên dưới bằng email vừa tạo, rồi chạy trong SQL Editor.
-- 3. Chỉ chạy thủ công trong SQL Editor, không gọi từ app.

update public.profiles
set role = 'OWNER',
    status = 'ACTIVE',
    approved_at = now(),
    approved_by = id,
    full_name = coalesce(nullif(full_name, 'Chua cap nhat'), 'Vinh')
where id = (select id from auth.users where email = 'THAY_EMAIL_CUA_BAN@example.com')
  and status = 'PENDING';

-- Kiểm tra kết quả: phải có đúng 1 dòng role = OWNER, status = ACTIVE
select p.id, u.email, p.role, p.status
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'OWNER';
