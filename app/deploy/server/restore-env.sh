#!/usr/bin/env bash
# restore-env.sh —— 按 manifest 回滚 env（规则 5 的落地）
#
# 为什么需要 manifest：INC-01 第一次回滚失败，不是因为操作错，而是因为
# 那份备份拍在“文件已被改坏之后”，回滚它等于把坏状态当成基线。
# 没有 manifest 的备份只能算「某个时刻的副本」，不能算可回滚点。
#
# 判定逻辑：
#   1) manifest 必须存在，且含 before_sha256_*（必要时 after_sha256_*）
#   2) 当前文件 sha256 若 == before_sha256 → 说明它本来就没被改过，
#      这份备份不是「改动前」的快照（或已经回滚过），拒绝并提示换更早的备份
#   3) 当前文件 sha256 若 == after_sha256 → 说明已经回滚过，幂等退出
#   4) 恢复后复核 sha256 == before_sha256
#
# 用法：
#   ./restore-env.sh                      # 列出可用 manifest
#   ./restore-env.sh <STAMP>              # 回滚该 stamp
#   ./restore-env.sh <STAMP> --force      # 无 manifest 时强行按备份恢复（不推荐）
set -uo pipefail
BK="${BK:-/root/oneframe-backup}"
ENVD="${ENVD:-/etc/oneframe}"
STAMP="${1:-}"
FORCE=0; [ "${2:-}" = "--force" ] && FORCE=1

sha() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }
say() { printf '\n=== %s ===\n' "$*"; }
die() { echo "  ✗ $*"; exit 1; }

if [ -z "$STAMP" ]; then
  say "可用 manifest"
  ls -1t "$BK"/env.*.manifest 2>/dev/null | sed 's/^/  /' || echo "  （无）"
  echo
  echo "用法：$0 <STAMP>   例：$0 20261103-054302"
  exit 0
fi

MANIFEST="$BK/env.$STAMP.manifest"
say "1. 校验 manifest"
if [ -f "$MANIFEST" ]; then
  echo "  ✓ $MANIFEST"
  grep -E '^(timestamp|script|purpose|before_sha256_|after_sha256_)' "$MANIFEST" | sed 's/^/    /'
else
  if [ "$FORCE" != "1" ]; then
    die "找不到 $MANIFEST —— 该备份不能作为可回滚点（缺 before/after 语义）。
     确认要按原始副本恢复，请加 --force（风险自负）。"
  fi
  echo "  ⚠ 无 manifest，--force 模式按原始副本恢复"
fi

say "2. 逐个文件判定"
for f in web.env api.env; do
  CUR=$(sha "$ENVD/$f")
  BAK="$BK/$f.$STAMP"
  [ -f "$BAK" ] || { echo "  ✗ 缺备份 $BAK"; die "中止"; }
  BAKSHA=$(sha "$BAK")
  BEFORE=$(grep -E "^before_sha256_$f=" "$MANIFEST" 2>/dev/null | cut -d= -f2)
  AFTER=$(grep -E "^after_sha256_$f=" "$MANIFEST" 2>/dev/null | cut -d= -f2)
  echo "  [$f] cur=${CUR:0:12} bak=${BAKSHA:0:12} before=${BEFORE:0:12} after=${AFTER:0:12}"
  # 判定顺序（方向不能反，写反过一次）：
  #   cur == before → 已经是改动前的状态，回滚已完成 → 幂等跳过
  #   cur == after  → 正处于改动后的状态，**这才是要回滚的情形**
  #   bak == cur    → 备份与当前一致，恢复不出任何东西，不能当可回滚点
  if [ -n "$BEFORE" ] && [ "$CUR" = "$BEFORE" ]; then
    echo "    → 已处于改动前状态（回滚已完成），跳过（幂等）"; continue
  fi
  if [ "$BAKSHA" = "$CUR" ]; then
    echo "    → 备份与当前内容一致：恢复不出任何东西，不能作为可回滚点"
    if [ "$FORCE" != "1" ]; then die "拒绝回滚 $f（确认无变化要跳过请加 --force）"; fi
    echo "    → --force：跳过 $f"; continue
  fi
  if [ -n "$AFTER" ] && [ "$CUR" != "$AFTER" ] && [ "$FORCE" != "1" ]; then
    echo "    → 当前内容既非改动前也非改动后（可能被手工改过）"
    die "拒绝回滚 $f（确认覆盖请加 --force）"
  fi
  install -m 600 -o root -g root "$BAK" "$ENVD/$f"
  NEW=$(sha "$ENVD/$f")
  if [ -n "$BEFORE" ] && [ "$NEW" != "$BEFORE" ]; then
    die "恢复后 sha256 与 manifest 的 before 不一致（$NEW ≠ $BEFORE）"
  fi
  echo "    → 已恢复，sha256=${NEW:0:12} ✓"
done

say "3. 重启并复核"
if [ "$ENVD" = "/etc/oneframe" ]; then
  systemctl restart oneframe-web; sleep 6
  echo -n "  oneframe-web: "; systemctl is-active oneframe-web
  systemctl restart oneframe-api; sleep 6
  echo -n "  oneframe-api: "; systemctl is-active oneframe-api
  echo -n "  /v1/ping: "; curl -s --max-time 10 -H "Host: ${DOMAIN:-oneframe.zltik.top}" http://127.0.0.1/v1/ping
  echo
else
  echo "  演练目录：跳过重启"
fi
say "完成"
