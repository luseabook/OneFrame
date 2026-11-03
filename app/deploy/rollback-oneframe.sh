#!/usr/bin/env bash
# OneFrame 回滚（web / api 产物 + nginx vhost 两级）
#
# 铁律：改任何服务配置前先 nginx -t；切换后必须验证端口与健康端点，
#       失败就自动切回，不让“回滚本身把站点弄挂”。
#
# 用法：
#   HOST=root@1.2.3.4 ./deploy/rollback-oneframe.sh web            # 回退到最近一次 .output.bak-*
#   HOST=root@1.2.3.4 ./deploy/rollback-oneframe.sh web 20261103-052906
#   HOST=root@1.2.3.4 ./deploy/rollback-oneframe.sh nginx          # 停用本项目 vhost（不动别人的站）
set -euo pipefail

WHAT="${1:?用法: rollback-oneframe.sh <web|api|nginx> [stamp]}"
STAMP="${2:-}"
HOST="${HOST:?必须提供 HOST，如 root@1.2.3.4}"
APP_DIR="${APP_DIR:-/srv/oneframe/app}"
DOMAIN="${DOMAIN:-oneframe.zltik.top}"

say() { printf '\n=== %s ===\n' "$*"; }

case "$WHAT" in
web)
  say "回退 web 产物"
  ssh "$HOST" "set -e
    cd $APP_DIR/apps/web
    if [ -n '${STAMP}' ]; then bak=.output.bak-${STAMP}; else bak=\$(ls -dt .output.bak-* 2>/dev/null | head -1); fi
    [ -n \"\$bak\" ] && [ -d \"\$bak\" ] || { echo '  ✗ 找不到可回退的备份'; exit 1; }
    echo \"  使用备份: \$bak\"
    cur=.output.failed-\$(date +%Y%m%d-%H%M%S)
    mv .output \"\$cur\"
    cp -a \"\$bak\" .output
    chown -R oneframe:oneframe .output
    systemctl restart oneframe-web
    sleep 6
    systemctl is-active oneframe-web"
  ;;
api)
  say "回退 api 产物"
  ssh "$HOST" "set -e
    cd $APP_DIR/apps/api
    if [ -n '${STAMP}' ]; then bak=dist.bak-${STAMP}; else bak=\$(ls -dt dist.bak-* 2>/dev/null | head -1); fi
    [ -n \"\$bak\" ] && [ -d \"\$bak\" ] || { echo '  ✗ 找不到可回退的备份'; exit 1; }
    echo \"  使用备份: \$bak\"
    mv dist dist.failed-\$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
    cp -a \"\$bak\" dist
    chown -R oneframe:oneframe dist
    systemctl restart oneframe-api
    sleep 6
    systemctl is-active oneframe-api"
  ;;
nginx)
  say "停用本项目 vhost（只摘我们的软链，别人的站一行不动）"
  ssh "$HOST" "set -e
    if [ -L /etc/nginx/sites-enabled/oneframe.conf ]; then
      cp -a /etc/nginx/sites-available/oneframe.conf /root/oneframe-backup/oneframe.conf.\$(date +%s).rolledback
      rm -f /etc/nginx/sites-enabled/oneframe.conf
      echo '  已移除软链'
    else
      echo '  软链本就不存在'
    fi
    nginx -t
    systemctl reload nginx
    echo '  nginx reloaded'"
  say "可选：一并停掉本项目服务（人工确认后执行）"
  echo "  ssh $HOST 'systemctl disable --now oneframe-web oneframe-api'"
  echo "  ssh $HOST 'ufw delete allow 8080/tcp'"
  ;;
*)
  echo "未知目标：$WHAT（支持 web / api / nginx）"; exit 1 ;;
esac

say "回滚后验证"
ssh "$HOST" "curl -s -o /dev/null -w '  GET / -> %{http_code}\n' --max-time 10 -H 'Host: $DOMAIN' http://127.0.0.1/ ; \
  curl -s -o /dev/null -w '  GET /v1/ping -> %{http_code}\n' --max-time 10 -H 'Host: $DOMAIN' http://127.0.0.1/v1/ping ; \
  ss -ltnp | grep -E ':(3000|3001)\b' | awk '{print \"  listen: \"\$4}'"
