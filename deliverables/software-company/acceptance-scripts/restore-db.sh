#!/usr/bin/env bash
# 数据库恢复脚本（deployment.md §6）
# 用法：./restore-db.sh <备份文件>
# 注意：会覆盖目标库现有数据，请先确认 DATABASE_URL 指向正确环境
set -euo pipefail

FILE="${1:?usage: restore-db.sh <dump-file>}"
: "${DATABASE_URL:?DATABASE_URL is required}"

if [ ! -f "$FILE" ]; then
  echo "[restore] file not found: $FILE" >&2
  exit 1
fi

echo "[restore] target: ${DATABASE_URL%%@*}@***"
echo "[restore] source: $FILE"
read -r -p "This will OVERWRITE the target database. Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "[restore] aborted"
  exit 1
fi

# --clean --if-exists：先删除现有对象再重建，保证恢复到备份时的状态
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$DATABASE_URL" "$FILE"

echo "[restore] done"
echo "[restore] 提示：恢复后请重启 api/worker，避免连接池持有旧 schema 缓存"
