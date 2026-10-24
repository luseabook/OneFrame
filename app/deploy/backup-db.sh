#!/usr/bin/env bash
# 数据库备份脚本（deployment.md §6）
# 用法：./backup-db.sh [输出目录]
# 依赖：pg_dump（PostgreSQL 客户端）
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
mkdir -p "$BACKUP_DIR"

: "${DATABASE_URL:?DATABASE_URL is required}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/oneframe-${STAMP}.dump"

echo "[backup] dumping to $FILE"
# -Fc：自定义格式，支持并行恢复与选择性恢复；-Z6 压缩
pg_dump --format=custom --compress=6 --no-owner --no-privileges \
  --file="$FILE" "$DATABASE_URL"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "[backup] done: $FILE ($SIZE)"

# 校验：列出归档目录，确认文件可读
pg_restore --list "$FILE" > /dev/null
echo "[backup] verified (pg_restore --list ok)"

# 保留策略：默认保留 14 天
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
find "$BACKUP_DIR" -name 'oneframe-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete || true
echo "[backup] pruned files older than ${RETENTION_DAYS} days"
