#!/usr/bin/env bash
# OneFrame 服务器初始化 —— 系统原生安装（无 Docker）
#
# 实测环境：Ubuntu 24.04 / 2C / 1.7G / 28G，与宝塔+nginx+MySQL 共用机器。
# 不改 nginx 全局配置、不碰别人的服务与端口。
#
# 用法：sudo ./deploy/server/01-install.sh
#
# 前置：apt 源可用；能访问 npm registry（建议 npmmirror）。
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

PG_PORT="${PG_PORT:-55432}"
REDIS_PORT="${REDIS_PORT:-6380}"
BASE="${BASE:-/srv/oneframe}"
ENVD="${ENVD:-/etc/oneframe}"
STAMP=$(date +%Y%m%d-%H%M%S)
BK="/root/oneframe-backup/$STAMP"

say() { printf '\n=== %s ===\n' "$*"; }

say "0. 备份目录与只读快照（改动前必做）"
mkdir -p "$BK" "$BASE"/{logs/{api,web,worker,redis},storage,backups,releases,bin}
ss -ltnp > "$BK/ports-before.txt" 2>/dev/null || true
dpkg -l  > "$BK/dpkg-before.txt" 2>/dev/null || true
cp -a /etc/fstab "$BK/fstab.orig" 2>/dev/null || true
tar czf "$BK/etc-nginx.tar.gz" /etc/nginx 2>/dev/null || true
echo "  备份在 $BK"

say "1. 安装 PostgreSQL 16 + Redis 7（--no-install-recommends，避免拉进 mail server）"
apt-get update -qq
apt-get install -y --no-install-recommends postgresql-16 postgresql-client-16 redis-server
/usr/lib/postgresql/16/bin/postgres --version
redis-server --version

say "2. pnpm（corepack 优先，失败回落 npm -g）"
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable 2>/dev/null && corepack prepare pnpm@10.33.2 --activate 2>/dev/null || npm i -g pnpm@10.33.2
fi
pnpm -v

say "3. swap（1.7G 机器必备；写 fstab 否则重启丢失）"
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 >/dev/null
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

say "4. 服务账号 oneframe"
id oneframe >/dev/null 2>&1 || useradd -r -m -d "$BASE" -s /usr/sbin/nologin oneframe
chown -R oneframe:oneframe "$BASE/storage" "$BASE/logs/api" "$BASE/logs/web" "$BASE/logs/worker"
chown -R redis:redis "$BASE/logs/redis"

say "完成。下一步：02-configure-pg.sh / 03-configure-redis.sh"
echo "  端口预检：$BASE/bin/preflight.sh"
