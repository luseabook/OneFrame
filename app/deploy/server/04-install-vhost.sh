#!/usr/bin/env bash
# 安装 OneFrame 的 nginx vhost + 专属日志格式（只新增文件，不动全局配置）
#
# 用法：DOMAIN=oneframe.example.com sudo -E ./deploy/server/04-install-vhost.sh
set -euo pipefail
DOMAIN="${DOMAIN:?必须提供 DOMAIN（精确域名，不要写 IP）}"
API_UPSTREAM="${API_UPSTREAM:-127.0.0.1:3000}"
WEB_UPSTREAM="${WEB_UPSTREAM:-127.0.0.1:3001}"
LOG_DIR="${LOG_DIR:-/srv/oneframe/logs}"
CLIENT_MAX_BODY="${CLIENT_MAX_BODY:-200m}"
PROXY_READ_TIMEOUT="${PROXY_READ_TIMEOUT:-60s}"
TPL="$(cd "$(dirname "$0")" && pwd)/nginx-oneframe.conf.template"
OUT=/etc/nginx/sites-available/oneframe.conf
RENDERED=$(mktemp)
trap 'rm -f "$RENDERED"' EXIT

say() { printf '\n=== %s ===\n' "$*"; }

say "1. 渲染模板（模板用的是 {{VAR}} 形式，用 sed 显式替换，避免 envsubst 的 \$VAR 混用）"
[ -f "$TPL" ] || { echo "  找不到模板 $TPL"; exit 1; }
sed -e "s|{{DOMAIN}}|${DOMAIN}|g" \
    -e "s|{{API_UPSTREAM}}|${API_UPSTREAM}|g" \
    -e "s|{{WEB_UPSTREAM}}|${WEB_UPSTREAM}|g" \
    -e "s|{{LOG_DIR}}|${LOG_DIR}|g" \
    -e "s|{{CLIENT_MAX_BODY}}|${CLIENT_MAX_BODY}|g" \
    -e "s|{{PROXY_READ_TIMEOUT}}|${PROXY_READ_TIMEOUT}|g" \
    "$TPL" > "$RENDERED"
if grep -q '{{' "$RENDERED"; then
  echo "  渲染后仍有未替换占位符，中止："; grep -n '{{' "$RENDERED" | head -5; exit 1
fi
grep -nE "server_name|listen|proxy_pass" "$RENDERED" | head -8

say "2. 备份旧 vhost 并写入"
mkdir -p /root/oneframe-backup
[ -f "$OUT" ] && cp -a "$OUT" "/root/oneframe-backup/oneframe.conf.$(date +%s)"
install -m 644 "$RENDERED" "$OUT"

say "3. 专属日志格式（新文件；nginx 默认不记 host，排障时很难受）"
cat > /etc/nginx/conf.d/00-oneframe.conf <<'EOF'
# OneFrame: websocket upgrade 映射 + 专属日志格式（新文件，未修改任何现有配置）
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

log_format oneframe '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                    'host="$host" xri="$http_x_real_ip" xff="$http_x_forwarded_for" '
                    'upstream="$upstream_addr" rt=$request_time';
EOF

say "4. 日志文件归属（nginx 以 www-data 运行）"
install -d "$LOG_DIR"
touch "$LOG_DIR/nginx-oneframe.access.log" "$LOG_DIR/nginx-oneframe.error.log"
chown www-data:adm "$LOG_DIR"/nginx-oneframe.*.log
chmod 640 "$LOG_DIR"/nginx-oneframe.*.log

say "5. 启用 + 语法校验 + reload（不 restart，避免影响别人的连接）"
ln -sfn "$OUT" /etc/nginx/sites-enabled/oneframe.conf
nginx -t
systemctl reload nginx

say "6. 命中验证（必须只命中我们的域名）"
echo -n "  Host=$DOMAIN           : "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 -H "Host: $DOMAIN" http://127.0.0.1/
echo -n "  无 Host（应落到别人的默认站）: "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1/
echo "  站点清单："; ls -l /etc/nginx/sites-enabled/
