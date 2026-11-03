#!/usr/bin/env bash
# selftest-08.sh —— 08-post-icp.sh 的自检（全部在 mktemp 副本上跑）
#
# 为什么需要它：08 会改 /etc/oneframe/*.env。INC-01 事故就是“拿线上去验负向用例”，
# 结果真把测试备案号写进了线上页脚。这条自检把五个用例固化成可重复执行，
# 并强制校验「线上文件 md5 前后不变」——判据是「脚本对坏输入返回非 0」，
# 不是「真的把坏值写进去再观察」。
#
# 用法：sudo ./selftest-08.sh          # 需要能读 /etc/oneframe/*.env
# 退出码：0 全部符合预期；1 有用例不符。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/08-post-icp.sh"
LIVE_ENVD="${LIVE_ENVD:-/etc/oneframe}"
DOMAIN="${DOMAIN:-selftest.invalid}"     # 故意用不可解析域名：TLS 必然失败

fail=0
ok()  { echo "  [PASS] $*"; }
bad() { echo "  [FAIL] $*"; fail=1; }

[ -f "$SCRIPT" ] || { echo "找不到 $SCRIPT"; exit 1; }
bash -n "$SCRIPT" && ok "语法检查" || bad "语法检查未通过"

R=$(mktemp -d /tmp/of-selftest08.XXXXXX)
trap 'rm -rf "$R"' EXIT
[ -f "$LIVE_ENVD/web.env" ] || { echo "找不到 $LIVE_ENVD/web.env"; exit 1; }
cp -a "$LIVE_ENVD/web.env" "$R/web.env"
cp -a "$LIVE_ENVD/api.env" "$R/api.env"

md5() { md5sum "$@" 2>/dev/null | awk '{print $1}' | tr '\n' ' '; }
LIVE_BEFORE=$(md5 "$LIVE_ENVD/web.env" "$LIVE_ENVD/api.env")
TMP_BEFORE=$(md5 "$R/web.env" "$R/api.env")

echo "== 用例 A：未给备案号 → 必须拒绝 =="
if DOMAIN="$DOMAIN" bash "$SCRIPT" >/dev/null 2>&1; then bad "未给备案号却成功"; else ok "拒绝（rc≠0）"; fi

echo "== 用例 B：占位备案号 → 必须拒绝且不写入 =="
if DOMAIN="$DOMAIN" ICP_BEIAN='TEST-京ICP备0000000号-1' ENVD="$R" bash "$SCRIPT" >/dev/null 2>&1; then
  bad "占位备案号未被拒绝"
else
  ok "拒绝（rc≠0）"
fi
[ "$(md5 "$R/web.env" "$R/api.env")" = "$TMP_BEFORE" ] && ok "副本未被改动" || bad "副本被占位用例改动"

echo "== 用例 C：真实格式备案号 + TLS 不可用 + 未加 --allow-http → 必须拒绝 =="
if DOMAIN="$DOMAIN" ICP_BEIAN='京ICP备2024000999号-1' ENVD="$R" bash "$SCRIPT" >/dev/null 2>&1; then
  bad "TLS 不可用却继续执行（COOKIE_SECURE 会被误置 true）"
else
  ok "拒绝（rc≠0）"
fi
[ "$(md5 "$R/web.env" "$R/api.env")" = "$TMP_BEFORE" ] && ok "副本未被改动" || bad "副本被 TLS 用例改动"

echo "== 用例 D：默认 dry-run → 只预览、不写盘 =="
out=$(DOMAIN="$DOMAIN" ICP_BEIAN='京ICP备2024000999号-1' ENVD="$R" bash "$SCRIPT" --allow-http 2>&1)
rc=$?
[ "$rc" = "0" ] && ok "dry-run 返回 0" || bad "dry-run 返回 $rc"
echo "$out" | grep -q "DRY-RUN 结束" && ok "打印了 DRY-RUN 结束" || bad "未提示 dry-run"
echo "$out" | grep -q "NUXT_PUBLIC_ICP_BEIAN=京ICP备2024000999号-1" && ok "预览里能看到将写入的备案号" || bad "预览缺少备案号变更"
[ "$(md5 "$R/web.env" "$R/api.env")" = "$TMP_BEFORE" ] && ok "dry-run 未改动副本" || bad "dry-run 竟改动了副本"

echo "== 用例 E：--apply --no-restart 对副本 → 只改副本，语义正确 =="
DOMAIN="$DOMAIN" ICP_BEIAN='京ICP备2024000999号-1' ENVD="$R" \
  bash "$SCRIPT" --apply --allow-http --no-restart >/dev/null 2>&1
rc=$?
[ "$rc" = "0" ] && ok "--apply 返回 0" || bad "--apply 返回 $rc"
grep -q '^NUXT_PUBLIC_ICP_BEIAN=京ICP备2024000999号-1' "$R/web.env" && ok "备案号已写入副本" || bad "备案号未写入"
grep -q '^ONEFRAME_ALLOW_MISSING_ICP' "$R/web.env" && bad "逃生舱未被删除" || ok "逃生舱已删除"
# --allow-http 时 TLS 不可用，COOKIE_SECURE 必须保持 false（否则刷新掉登录）
grep -q '^COOKIE_SECURE=false' "$R/api.env" && ok "COOKIE_SECURE 保持 false（--allow-http 下正确）" \
  || bad "COOKIE_SECURE 被误改（会导致刷新掉登录）"
grep -qiE 'TEST-|0000000' "$R/web.env" && bad "副本里出现占位值" || ok "副本无占位值"

echo "== 线上文件必须完全未被触碰 =="
LIVE_AFTER=$(md5 "$LIVE_ENVD/web.env" "$LIVE_ENVD/api.env")
if [ "$LIVE_BEFORE" = "$LIVE_AFTER" ]; then
  ok "线上 env md5 前后一致（$LIVE_BEFORE）"
else
  bad "线上 env 被改动！before=$LIVE_BEFORE after=$LIVE_AFTER"
fi

echo
[ "$fail" -eq 0 ] && echo "结论：selftest-08 全部通过" || echo "结论：selftest-08 有失败项"
exit "$fail"
