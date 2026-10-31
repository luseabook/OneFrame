#!/usr/bin/env bash
# 生成**自签**证书，仅用于「第一次把 compose 拉起来看 TLS 是否通」的冒烟，不要用于生产。
#
# 生产请用真证书（Let's Encrypt / 商业证书），放到同一个目录：
#   deploy/certs/fullchain.pem  站点证书 + 中间证书
#   deploy/certs/privkey.pem    私钥（chmod 600）
#
# 用法：
#   ./deploy/gen-selfsigned-cert.sh [域名] [输出目录]
#   TLS_SERVER_NAME=app.example.com ./deploy/gen-selfsigned-cert.sh
#
# 已存在 fullchain.pem 时拒绝覆盖 —— 避免一条手滑命令把线上证书换成自签。
set -euo pipefail

HOST="${1:-${TLS_SERVER_NAME:-localhost}}"
DIR="${2:-$(cd "$(dirname "$0")" && pwd)/certs}"

mkdir -p "$DIR"

if [ -e "$DIR/fullchain.pem" ] || [ -e "$DIR/privkey.pem" ]; then
  echo "refusing to overwrite existing certificate in $DIR" >&2
  echo "remove it yourself if you really mean to replace it" >&2
  exit 1
fi

# 30 天：自签只是冒烟，过期了重新生成即可；真证书的续期交给 certbot。
openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
  -keyout "$DIR/privkey.pem" \
  -out "$DIR/fullchain.pem" \
  -subj "/CN=${HOST}" \
  -addext "subjectAltName=DNS:${HOST}"

chmod 600 "$DIR/privkey.pem"

echo "self-signed certificate written to $DIR (CN=${HOST}, 30 days)"
echo "browsers will warn; this is for smoke testing only"