#!/usr/bin/env bash
# Redis 7 配置 —— 独立端口 + 低内存 + 口令 + 修 systemd 加固导致的启动失败
#
# 这台机器上真实踩到的三个坑（缺一个就连不上）：
#   1) /usr/local/lib 下他方的 libjemalloc.so.2 在 systemd 命名空间里映射失败
#      （报 "failed to map segment from shared object"），根因是打包单元的 PrivateUsers=true。
#      → drop-in 里指回发行版 libjemalloc 并关掉 PrivateUsers（作用域仅本服务）。
#   2) 打包单元 ProtectSystem=strict 把 /srv 挂成只读，logfile/dir 写到 /srv 就
#      报 "Can't open the log file: Read-only file system"。→ ReadWritePaths=/srv/oneframe。
#   3) 日志文件若曾被 root 创建，redis 用户写不进去。→ 按服务分目录并 chown。
#
# 用法：sudo ./deploy/server/03-configure-redis.sh
set -euo pipefail
REDIS_PORT="${REDIS_PORT:-6380}"
BASE="${BASE:-/srv/oneframe}"
ENVD="${ENVD:-/etc/oneframe}"
RC=/etc/redis/redis.conf

say() { printf '\n=== %s ===\n' "$*"; }

say "1. 备份 + 目录与权限"
cp -a "$RC" "$RC.orig.$(date +%s)"
mkdir -p "$BASE"/{redis,logs/redis}
rm -f "$BASE/logs/redis/redis.log"
chown -R redis:redis "$BASE/redis" "$BASE/logs/redis"
chmod 755 "$BASE/logs" "$BASE/logs/redis"

say "2. 配置端口 / 绑定 / 内存 / 持久化 / 口令"
set_kv() { # key value
  if grep -qE "^#?\s*$1 " "$RC"; then
    sed -i "s|^#\?\s*$1 .*|$1 $2|" "$RC"
  else
    printf '%s %s\n' "$1" "$2" >> "$RC"
  fi
}
set_kv port "$REDIS_PORT"
set_kv bind "127.0.0.1 -::1"
set_kv maxmemory 96mb
set_kv maxmemory-policy noeviction     # 队列/限流计数不能被逐出，否则语义出错
set_kv dir "$BASE/redis"
set_kv logfile "$BASE/logs/redis/redis.log"

if [ -f "$ENVD/redis.env" ]; then
  RP=$(grep -oP '(?<=REDISPASSWORD=).*' "$ENVD/redis.env")
else
  RP=$(openssl rand -hex 24)
  umask 077
  printf 'REDISPORT=%s\nREDISPASSWORD=%s\n' "$REDIS_PORT" "$RP" > "$ENVD/redis.env"
  chmod 600 "$ENVD/redis.env"
fi
set_kv requirepass "$RP"
grep -E '^(port|bind|maxmemory|maxmemory-policy|dir|logfile) ' "$RC"

say "3. systemd drop-in（修 jemalloc 映射 + /srv 只读）"
mkdir -p /etc/systemd/system/redis-server.service.d
cat > /etc/systemd/system/redis-server.service.d/10-oneframe.conf <<EOF
[Service]
Environment="LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu"
ReadWritePaths=$BASE
PrivateUsers=false
EOF
systemctl daemon-reload
systemctl reset-failed redis-server 2>/dev/null || true
systemctl restart redis-server
sleep 2
systemctl is-active redis-server

say "4. 连接自检（含鉴权反例）"
redis-cli -h 127.0.0.1 -p "$REDIS_PORT" -a "$RP" --no-auth-warning ping
redis-cli -h 127.0.0.1 -p "$REDIS_PORT" -a "$RP" --no-auth-warning set oneframe:smoke ok
redis-cli -h 127.0.0.1 -p "$REDIS_PORT" -a "$RP" --no-auth-warning get oneframe:smoke
redis-cli -h 127.0.0.1 -p "$REDIS_PORT" -a "$RP" --no-auth-warning del oneframe:smoke >/dev/null
echo -n "  无口令应被拒: "
redis-cli -h 127.0.0.1 -p "$REDIS_PORT" ping 2>&1 | head -1
redis-cli -h 127.0.0.1 -p "$REDIS_PORT" -a "$RP" --no-auth-warning info memory | grep -E "used_memory_human|maxmemory_human"
unset RP
