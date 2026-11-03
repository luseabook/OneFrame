#!/usr/bin/env bash
# 数据库迁移 + 种子 —— 在服务器上执行，不把 devDeps 装进部署树
#
# 为什么不像别处那样 `pnpm --filter @app/api db:migrate`：
#   drizzle-kit 是 devDependency，部署树用 `pnpm install --prod`，
#   直接跑会报 "Cannot find module 'drizzle-kit'"。
# 做法：单独在 $BASE/tools 装一份 drizzle-kit + drizzle-orm + pg，
#   再把 drizzle-kit 软链进部署树供 drizzle.config.ts 的 import 解析。
#   注意版本必须与仓库 package.json 里的一致，否则 journal 读法可能不同。
#
# 踩过的坑：
#   - 只装 drizzle-kit 会报 "Please install latest version of drizzle-orm"（它按 peer 解析）
#   - 只装 drizzle-kit + orm 会报 "please install either of 'pg' ..."
#
# 用法：sudo -E ./deploy/server/06-migrate-seed.sh
set -euo pipefail
BASE="${BASE:-/srv/oneframe}"
ENVD="${ENVD:-/etc/oneframe}"
TOOLS="$BASE/tools"
DRIZZLE_KIT_VERSION="${DRIZZLE_KIT_VERSION:-0.30.6}"
DRIZZLE_ORM_VERSION="${DRIZZLE_ORM_VERSION:-0.38.4}"
PG_CLIENT_VERSION="${PG_CLIENT_VERSION:-8.13.1}"
TSX_VERSION="${TSX_VERSION:-4.19.2}"

say() { printf '\n=== %s ===\n' "$*"; }

say "1. 独立工具链（不进部署树）"
mkdir -p "$TOOLS" && cd "$TOOLS"
[ -f package.json ] || npm init -y >/dev/null 2>&1
npm config set registry "${NPM_REGISTRY:-https://registry.npmmirror.com}" >/dev/null 2>&1 || true
npm i --no-audit --no-fund "drizzle-kit@${DRIZZLE_KIT_VERSION}" "drizzle-orm@${DRIZZLE_ORM_VERSION}" \
      "pg@${PG_CLIENT_VERSION}" "tsx@${TSX_VERSION}" 2>&1 | tail -3
node -e "console.log('  drizzle-kit', require('$TOOLS/node_modules/drizzle-kit/package.json').version)"
node -e "console.log('  drizzle-orm', require('$TOOLS/node_modules/drizzle-orm/package.json').version)"

say "2. 软链进部署树（drizzle.config.ts 从所在目录向上找 drizzle-kit）"
ln -sfn "$TOOLS/node_modules/drizzle-kit" "$BASE/app/node_modules/drizzle-kit"
[ -d "$BASE/app/node_modules/drizzle-orm" ] || \
  ln -sfn "$BASE/app/apps/api/node_modules/drizzle-orm" "$BASE/app/node_modules/drizzle-orm"
ls -l "$BASE/app/node_modules/drizzle-kit" | sed 's/^/  /'

say "3. 备份数据库（迁移前）"
PGPASS=$(grep -oP '(?<=PGPASSWORD=).*' "$ENVD/pg.env")
export PGPASSWORD="$PGPASS"
mkdir -p "$BASE/backups"
DUMP="$BASE/backups/pre-migrate-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump -h 127.0.0.1 -p "${PG_PORT:-55432}" -U "${PGUSER:-oneframe}" "${PGDATABASE:-oneframe}" \
  | gzip > "$DUMP"
echo "  备份：$DUMP ($(du -h "$DUMP" | cut -f1))"

say "4. 迁移"
export DATABASE_URL="postgres://${PGUSER:-oneframe}:${PGPASS}@127.0.0.1:${PG_PORT:-55432}/${PGDATABASE:-oneframe}"
cd "$BASE/app/apps/api"
"$TOOLS/node_modules/.bin/drizzle-kit" migrate --config="$BASE/app/apps/api/drizzle.config.ts"
psql -h 127.0.0.1 -p "${PG_PORT:-55432}" -U "${PGUSER:-oneframe}" -d "${PGDATABASE:-oneframe}" -tAc \
  "select 'journal_rows='||count(*) from drizzle.__drizzle_migrations"

say "5. 种子（模型/价目/SKU；不 seed 则报价无价可算）"
"$TOOLS/node_modules/.bin/tsx" src/db/seed.ts 2>&1 | tail -5
psql -h 127.0.0.1 -p "${PG_PORT:-55432}" -U "${PGUSER:-oneframe}" -d "${PGDATABASE:-oneframe}" -tAc \
  "select 'tables='||count(*) from information_schema.tables where table_schema='public'"
unset PGPASSWORD
