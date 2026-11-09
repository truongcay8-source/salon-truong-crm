#!/usr/bin/env bash
# Cài CRM Salon Nếp lên VPS Ubuntu 22.04/24.04 bằng 1 lệnh (chạy với quyền root):
#   curl -fsSL https://raw.githubusercontent.com/truongcay8-source/salon-truong-crm/main/scripts/install-vps.sh | bash
# Có tên miền riêng thì thêm:  | DOMAIN=crm.tenmien.vn bash
# Chạy lại lệnh này bất kỳ lúc nào để CẬP NHẬT bản mới (dữ liệu được giữ nguyên).
set -euo pipefail

REPO="${REPO:-https://github.com/truongcay8-source/salon-truong-crm.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/salon
DATA_DIR=/opt/salon-data
PORT=3000

[ "$(id -u)" -eq 0 ] || { echo "Hãy chạy bằng tài khoản root (hoặc: sudo bash)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Cập nhật hệ thống và cài Node.js 22, Caddy, git"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
apt-get install -y build-essential python3 >/dev/null 2>&1 || true

echo "==> Lấy mã nguồn ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH" && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR" && npm ci --omit=dev

id salon >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin salon
mkdir -p "$DATA_DIR" && chown -R salon:salon "$DATA_DIR" && chmod 700 "$DATA_DIR"
timedatectl set-timezone Asia/Ho_Chi_Minh || true

echo "==> Tạo dịch vụ chạy nền"
cat > /etc/systemd/system/salon.service <<UNIT
[Unit]
Description=CRM Salon Nep
After=network.target
[Service]
User=salon
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production PORT=$PORT DATA_DIR=$DATA_DIR COOKIE_SECURE=1 TZ=Asia/Ho_Chi_Minh
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable salon >/dev/null
systemctl restart salon

echo "==> Cấu hình HTTPS"
if [ -z "${DOMAIN:-}" ]; then
  IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')
  DOMAIN="${IP//./-}.sslip.io"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  request_body { max_size 25MB }
  reverse_proxy localhost:$PORT
}
CADDY
systemctl reload caddy || systemctl restart caddy

ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

sleep 3
echo
echo "======================================================"
echo " XONG! Mở trên điện thoại/máy tính:  https://$DOMAIN"
echo "======================================================"
if [ -f "$DATA_DIR/mat-khau-ban-dau.txt" ]; then
  cat "$DATA_DIR/mat-khau-ban-dau.txt"
  echo "(Mật khẩu này chỉ hiện ở lần cài đầu. Phát cho từng người rồi xóa file:  rm $DATA_DIR/mat-khau-ban-dau.txt)"
fi
systemctl --no-pager --lines=0 status salon | head -3
