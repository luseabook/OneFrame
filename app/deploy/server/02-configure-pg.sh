#!/usr/bin/env bash
# PostgreSQL 16 配置 —— 独立端口 + 共享机低内存调优 + 建库建用户
#
# 踩过的坑（不要改回）：
#   1) 不要用 pg_conftool set listen_addresses "'127.0.0.1'" —— 会多套一层引号变成
#      '''127.0.0.1'''，postgres 直接拒绝启动。这里直接 sed 写单引号。
#   2) 数据目录保持 Debian 默认 /var/lib/postgresql/16/main：pg_ctlcluster 与该路径
#      硬绑定，搬到 /srv 要重做 initdb 与权限，风险不对等。
#   3) 口令在服务端用 openssl 生成并写入 600 的 env，全程不打印。
#
# 用法：sudo ./deploy/server/02-configure-pg.sh
set -euo pipefail
PG_PORT="${PG_PORT:-55432}"
DB_NAME="${DB_NAME:-oneframe}"
DB_USER="${DB_USER:-oneframe}"
ENVD="${ENVD:-/etc/oneframe}"
CFG=/etc/postgresql/16/main/postgresql.conf

say() { printf '\n=== %s ===\n' "$*"; }

say "1. 备份原配置"
cp -a "$CFG" "$CFG.orig.$(date +%s)"
mkdir -p "$ENVD" && chmod 700 "$ENVD"

say "2. 端口 / 监听 / 内存调优"
sed -i "s|^#\?listen_addresses = .*|listen_addresses = '127.0.0.1'|" "$CFG"
sed -i "s|^#\?port = .*|port = ${PG_PORT}|" "$CFG"
set_kv() { # key value
  if grep -qE "^#?\s*$1\s*=" "$CFG"; then
    sed -i "s|^#\?\s*$1\s*=.*|$1 = $2|" "$CFG"
  else
    printf '%s = %s\n' "$1" "$2" >> "$CFG"
  fi
}
set_kv shared_buffers 128MB
set_kv effective_cache_size 384MB
set_kv work_mem 4MB
set_kv maintenance_work_mem 48MB
set_kv max_connections 50
set_kv wal_compression on
set_kv log_min_duration_statement 1000
grep -E "^(listen_addresses|port|shared_buffers|max_connections) " "$CFG"

say "3. 重启并确认在线"
pg_ctlcluster 16 main restart
sleep 2
pg_lsclusters

say "4. 建角色与库（口令服务端生成，不打印）"
if [ -f "$ENVD/pg.env" ]; then
  PGPASS=$(grep -oP '(?<=PGPASSWORD=).*' "$ENVD/pg.env")
else
  PGPASS=$(openssl rand -hex 24)
  umask 077
  cat > "$ENVD/pg.env" <<EOF
PGPORT=${PG_PORT}
PGDATABASE=${DB_NAME}
PGUSER=${DB_USER}
PGPASSWORD=${PGPASS}
EOF
  chmod 600 "$ENVD/pg.env"
fi

exists() { su - postgres -c "psql -p ${PG_PORT} -tAc \"$1\"" | tr -d '[:space:]'; }
if [ "$(exists "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")" = "1" ]; then
  su - postgres -c "psql -p ${PG_PORT} -c \"ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${PGPASS}';\"" >/dev/null
  echo "  角色已存在 → 已重置口令"
else
  su - postgres -c "psql -p ${PG_PORT} -c \"CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${PGPASS}';\"" >/dev/null
  echo "  角色已创建"
fi
if [ "$(exists "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")" = "1" ]; then
  su - postgres -c "psql -p ${PG_PORT} -c \"ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};\"" >/dev/null
  echo "  库已存在 → 已确保 owner"
else
  su - postgres -c "createdb -p ${PG_PORT} -O ${DB_USER} ${DB_NAME}"
  echo "  库已创建"
fi
unset PGPASS

say "5. 应用侧 TCP 自检"
PGPASS=$(grep -oP '(?<=PGPASSWORD=).*' "$ENVD/pg.env")
PGPASSWORD="$PGPASS" psql -h 127.0.0.1 -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
  "select current_user||'|'||current_database()||'|'||split_part(version(),' ',2)"
PGPASSWORD="$PGPASS" psql -h 127.0.0.1 -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
  "create temp table _t(a int); insert into _t values(1); select 'rw_ok='||count(*) from _t;"
unset PGPASS
