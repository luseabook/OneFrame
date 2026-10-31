#!/usr/bin/env bash
# 回滚脚本（deployment.md §7）
# 用法：./rollback.sh <目标 git tag 或 commit>
#
# 设计原则：
# 1) 代码回滚 = 重新构建并切回上一版本镜像，**不做数据库降级**（迁移只前进）；
# 2) 若本次发布包含不可逆迁移，回滚前必须从备份恢复（脚本会提示）；
# 3) 回滚后立即验证 readiness 与核心接口。
set -euo pipefail

TARGET="${1:?usage: rollback.sh <git-tag-or-commit>}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
# 第 107 批：TLS 在 nginx 终止，业务入口是 443。**不能**用 80 —— curl -f 把 308 当成功，
# 会让"其实还没就绪"的回滚假通过。自签证书冒烟时加 -k（CURL_OPTS），生产真证书可留空。
HEALTH_URL="${HEALTH_URL:-https://127.0.0.1/v1/healthz/ready}"
# 用 `${VAR-default}`（无冒号）：显式 CURL_OPTS= 才能关掉 -k、走真证书校验。
CURL_OPTS="${CURL_OPTS--k}"

echo "[rollback] target: $TARGET"
CURRENT="$(git rev-parse --short HEAD)"
echo "[rollback] current: $CURRENT"

echo "[rollback] ⚠️  数据库迁移不会自动回退。"
echo "[rollback] 若 $TARGET 之后包含不可逆迁移（drop/rename 列），请改用："
echo "[rollback]   ./restore-db.sh backups/<发布前备份>.dump"
read -r -p "Continue with code-only rollback? Type 'yes': " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "[rollback] aborted"; exit 1; }

git fetch --all --tags
git checkout "$TARGET"

echo "[rollback] rebuilding images"
docker compose -f "$COMPOSE_FILE" build

echo "[rollback] rolling services"
docker compose -f "$COMPOSE_FILE" up -d

echo "[rollback] waiting for readiness (max 120s)"
for i in $(seq 1 60); do
  if curl $CURL_OPTS -fsS "$HEALTH_URL" > /dev/null 2>&1; then
    echo "[rollback] ready after ${i}x2s"
    break
  fi
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "[rollback] readiness never became OK — investigate before declaring success" >&2
    exit 1
  fi
done

echo "[rollback] verifying core endpoints"
curl $CURL_OPTS -fsS "${HEALTH_URL%/ready}" > /dev/null && echo "  healthz OK"
curl $CURL_OPTS -fsS "${HEALTH_URL%/v1/healthz/ready}/v1/billing/skus" > /dev/null && echo "  billing/skus OK"

echo "[rollback] done at $(git rev-parse --short HEAD)"
echo "[rollback] 提醒：回滚后确认 worker 也在运行（docker compose ps）"
