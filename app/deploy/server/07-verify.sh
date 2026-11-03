#!/usr/bin/env bash
# 07 —— 部署后验证（独立于部署，可随时单独重跑）
#
# 顺序：端口预检 → 7 条硬断言（verify-deploy.sh）
# 设计：本脚本不做任何变更，只读 + 只请求，因此可以在任何时候反复执行；
#       05-install-units.sh 之后跑一次，之后每次部署、每次排障都可以再跑。
#
# 用法：
#   DOMAIN=oneframe.example.com sudo -E ./deploy/server/07-verify.sh
#   STRICT_ICP=1 DOMAIN=... ./07-verify.sh      # 对外环境：逃生舱必须已删除
#   ./07-verify.sh --with-selftest              # 额外跑 selftest-08（只打副本，验脚本自身）
#
# 退出码：0 全通过；1 有失败（可直接用于 CI/门禁）。
set -uo pipefail

WITH_SELFTEST=0
for a in "$@"; do [ "$a" = "--with-selftest" ] && WITH_SELFTEST=1; done

DOMAIN="${DOMAIN:?必须提供 DOMAIN}"
BASE="${BASE:-/srv/oneframe}"
ENVD="${ENVD:-/etc/oneframe}"
API_URL="${API_URL:-http://127.0.0.1:8080}"
PUBLIC_BASE="${PUBLIC_BASE:-http://127.0.0.1}"
STRICT_ICP="${STRICT_ICP:-0}"
HERE="$(cd "$(dirname "$0")" && pwd)"

fail=0
say() { printf '\n=== %s ===\n' "$*"; }

say "1. 端口预检（区分 ours / BUSY）"
PRE="$BASE/bin/preflight.sh"
[ -x "$PRE" ] || PRE="$HERE/preflight.sh"
if [ -x "$PRE" ]; then
  "$PRE" || { echo "  ✗ 端口被其它进程占用"; fail=1; }
else
  echo "  [SKIP] 未找到 preflight.sh"
fi

say "2. 7 条硬断言"
VERIFY="${VERIFY_SH:-}"
for c in "$VERIFY" "$HERE/../verify-deploy.sh" "$BASE/app/deploy/verify-deploy.sh" "$BASE/deploy/verify-deploy.sh"; do
  if [ -n "$c" ] && [ -f "$c" ]; then VERIFY="$c"; break; fi
done
if [ -z "${VERIFY:-}" ] || [ ! -f "$VERIFY" ]; then
  echo "  ✗ 找不到 verify-deploy.sh（用 VERIFY_SH=... 指定）"; exit 1
fi
echo "  使用：$VERIFY"
# verify-deploy.sh 的第 ⑤ 条要在含 _acceptance/compliance-check.cjs 的目录下跑，
# 否则会 SKIP。这里自动切到仓库根（$BASE 或脚本上层目录），避免“换个 cwd 就少一条断言”。
GATE_CWD="${GATE_CWD:-}"
if [ -z "$GATE_CWD" ]; then
  for d in "$BASE" "$HERE/../.." "$HERE/.."; do
    [ -f "$d/_acceptance/compliance-check.cjs" ] && { GATE_CWD="$(cd "$d" && pwd)"; break; }
  done
fi
[ -n "$GATE_CWD" ] && echo "  门禁 cwd：$GATE_CWD" || echo "  [WARN] 未找到 _acceptance/compliance-check.cjs，第⑤条会 SKIP"
( cd "${GATE_CWD:-.}" && \
  DOMAIN="$DOMAIN" API_URL="$API_URL" PUBLIC_BASE="$PUBLIC_BASE" STRICT_ICP="$STRICT_ICP" \
  bash "$VERIFY" ) || fail=1

say "3. 服务与单元状态（只读）"
for u in postgresql redis-server nginx oneframe-api oneframe-web; do
  printf "  %-20s %s\n" "$u" "$(systemctl is-active "$u" 2>/dev/null || echo unknown)"
done
echo "  worker（缺真实 Key 时按设计不启）: $(systemctl is-active oneframe-worker 2>/dev/null || echo inactive)"
echo "  端口：$(ss -ltn 2>/dev/null | awk '$4 ~ /:(3000|3001|55432|6380)$/ {print $4}' | tr '\n' ' ')"

if [ "$WITH_SELFTEST" = "1" ]; then
  say "4. selftest-08（脚本自身正确性，只打 mktemp 副本）"
  if [ -f "$HERE/selftest-08.sh" ]; then
    ( cd "$HERE" && bash ./selftest-08.sh ) || fail=1
  else
    echo "  [SKIP] 未找到 selftest-08.sh"
  fi
fi

say "5. 结论"
if [ "$fail" -eq 0 ]; then
  echo "  ✓ 全部通过（可宣布部署完成）"
else
  echo "  ✗ 有失败项（禁止宣布完成）"
fi
exit "$fail"
