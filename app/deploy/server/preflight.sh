#!/usr/bin/env bash
# 端口预检：起服务前确认本项目 4 个端口没被「别人的」进程占着
#
# 关键点：不能只看「端口有没有监听」——我们自己的服务正在跑时也监听，
# 那会误报成冲突。所以要比对端口上进程的命令行是否符合本项目预期。
#
# 用法：/srv/oneframe/bin/preflight.sh
# 退出码：0 全部 free 或 ours；1 存在别人的进程占用。
API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-3001}"
PG_PORT="${PG_PORT:-55432}"
REDIS_PORT="${REDIS_PORT:-6380}"

expect() {
  case "$1" in
    "$API_PORT")   echo "apps/api/dist/main.js" ;;
    "$WEB_PORT")   echo ".output/server/index.mjs" ;;
    "$PG_PORT")    echo "postgres" ;;
    "$REDIS_PORT") echo "redis-server" ;;
  esac
}

rc=0
for p in "$API_PORT" "$WEB_PORT" "$PG_PORT" "$REDIS_PORT"; do
  pid=$(ss -ltnp "sport = :$p" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
  if [ -z "$pid" ]; then
    echo "[free]  $p 空闲"
    continue
  fi
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
  want=$(expect "$p")
  if [ -n "$want" ] && echo "$cmd" | grep -q "$want"; then
    echo "[ours]  $p 本项目占用 (pid=$pid)"
  else
    echo "[BUSY]  $p 被其它进程占用: pid=$pid  ${cmd:0:80}"
    rc=1
  fi
done
exit "$rc"
