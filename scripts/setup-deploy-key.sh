#!/usr/bin/env bash
# Cài 1 lần trên VPS để repo GitHub để PRIVATE mà VPS vẫn tự lấy bản mới được (khóa chỉ đọc).
#   curl -fsSL https://raw.githubusercontent.com/truongcay8-source/salon-truong-crm/main/scripts/setup-deploy-key.sh | bash
# Sau đó mỗi lần cập nhật chỉ cần gõ:  capnhat-salon
set -euo pipefail
[ "${EUID:-$(id -u 2>/dev/null || echo 1)}" = 0 ] || { echo "Hãy chạy bằng tài khoản root"; exit 1; }

SLUG=truongcay8-source/salon-truong-crm
APP_DIR=/opt/salon
KEY=/root/.ssh/salon_deploy

mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "vps-salon-chi-doc" -f "$KEY" >/dev/null
grep -q "Host github-salon" /root/.ssh/config 2>/dev/null || cat >> /root/.ssh/config <<CFG

Host github-salon
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
CFG
chmod 600 /root/.ssh/config
ssh-keygen -F github.com >/dev/null 2>&1 || ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null

[ -d "$APP_DIR/.git" ] && git -C "$APP_DIR" remote set-url origin "git@github-salon:$SLUG.git"

cat > /usr/local/bin/capnhat-salon <<'CMD'
#!/usr/bin/env bash
# Lấy bản mới nhất từ GitHub (repo private, dùng khóa chỉ đọc) rồi cài lại. Dữ liệu giữ nguyên.
set -euo pipefail
cd /opt/salon
git fetch --depth 1 origin main
git reset --hard origin/main
bash scripts/install-vps.sh
CMD
chmod 755 /usr/local/bin/capnhat-salon

echo
echo "=============================================================="
echo " BƯỚC TIẾP: copy NGUYÊN dòng khóa dưới đây (bắt đầu bằng ssh-ed25519)"
echo "=============================================================="
cat "$KEY.pub"
echo "=============================================================="
echo " Dán vào: https://github.com/$SLUG/settings/keys/new"
echo "   Title: VPS salon   ·   KHÔNG tích 'Allow write access'   ·   bấm Add key"
echo " Xong thì đổi repo về Private, rồi thử gõ:  capnhat-salon"
echo "=============================================================="
