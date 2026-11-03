#!/usr/bin/env bash
# 08 —— 备案号下发后的切换（三件事必须同批）
#
#   1) web.env 写入 NUXT_PUBLIC_ICP_BEIAN（+ 可选 POLICE）
#   2) 删除 ONEFRAME_ALLOW_MISSING_ICP（逃生舱）
#   3) api.env 的 COOKIE_SECURE 改 true —— 只有 HTTPS 真的可用时才改
#
# 铁律（INC-01 之后，见 docs/05-ops/deployment.md §7.4.2）：
#   a) **默认 dry-run**：不带 --apply 只打印改动，绝不写盘。
#   b) **负向用例只打副本**：演练用 ENVD=<mktemp -d 下的拷贝>，不要指向 /etc/oneframe。
#   c) **HTTP 状态码禁用不等号**：curl -w 失败会输出 "000" 并与兜底拼接成 "000000"，
#      `!= "000"` 会被绕过。一律用 curl 退出码判断。
#   d) **占位备案号拒收**：TEST-/example/0000000 一律拒绝（演练加 --allow-placeholder）。
#   e) **备份在任何写入之前**，并校验备份本身是否已含坏值（否则回滚回坏状态）。
#
# 用法：
#   # 演练（默认 dry-run，什么都不写）
#   ICP_BEIAN='京ICP备2024000000号-1' DOMAIN=oneframe.example.com \
#     ENVD=/tmp/rehearsal /etc/oneframe副本 ./08-post-icp.sh
#
#   # 真跑
#   ICP_BEIAN='京ICP备2024000000号-1' DOMAIN=oneframe.example.com sudo -E ./08-post-icp.sh --apply
#
# 参数：
#   --apply              真正落盘（缺省只预览）
#   --allow-http         TLS 不可用时仍继续（保留 COOKIE_SECURE=false）
#   --allow-placeholder  允许测试备案号（仅演练）
#   --no-restart         演练用：不重启服务（ENVD 不是 /etc/oneframe 时自动生效）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

APPLY=0; ALLOW_HTTP=0; ALLOW_PH=0; NO_RESTART=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --allow-http) ALLOW_HTTP=1 ;;
    --allow-placeholder) ALLOW_PH=1 ;;
    --no-restart) NO_RESTART=1 ;;
  esac
done

DOMAIN="${DOMAIN:?必须提供 DOMAIN（用于 TLS 探测）}"
ICP_BEIAN="${ICP_BEIAN:?必须提供 ICP_BEIAN（备案号，如 京ICP备2024000000号-1）}"
ICP_POLICE="${ICP_POLICE:-}"
ENVD="${ENVD:-/etc/oneframe}"
WEB_ENV="$ENVD/web.env"
API_ENV="$ENVD/api.env"
STAMP=$(date +%Y%m%d-%H%M%S)

# 演练目录一律不碰线上服务
case "$(readlink -f "$ENVD" 2>/dev/null || echo "$ENVD")" in
  /etc/oneframe) ;;
  *) NO_RESTART=1 ;;
esac

say() { printf '\n=== %s ===\n' "$*"; }
die() { echo "  ✗ $*"; exit 1; }

[ "$APPLY" = "1" ] || say "模式：DRY-RUN（只预览；真跑请加 --apply）"

say "1. 前置检查"
[ -f "$WEB_ENV" ] || die "找不到 $WEB_ENV"
[ -f "$API_ENV" ] || die "找不到 $API_ENV"
echo "  ENVD=$ENVD"
echo "  备案号（原始）：[$ICP_BEIAN]"

# 空白归一化：备案系统页面上显示的是「京 ICP 备 2024000000 号-1」，运维最自然的动作
# 是复制粘贴。先去掉所有空白再校验，避免把真实号误拦；**写盘也写归一化后的值**，
# 否则 web.env 里留着空格，后续 grep/比对容易误判（与 web 侧 icp-guard 同一口径）。
ICP_BEIAN_NORM=$(printf '%s' "$ICP_BEIAN" | tr -d '[:space:]')
ICP_POLICE_NORM=$(printf '%s' "$ICP_POLICE" | tr -d '[:space:]')
[ "$ICP_BEIAN_NORM" != "$ICP_BEIAN" ] && echo "  归一化后：[$ICP_BEIAN_NORM]（已去掉空白）"

# 形状判据（docs/05-ops/deployment.md §4.4 同一套）：31 省简称开头 + ICP备/ICP证 + 4 位以上数字 + 号[-N]
ICP_SHAPE='^(京|津|沪|渝|冀|豫|云|辽|黑|湘|皖|鲁|新|苏|浙|赣|鄂|桂|甘|晋|蒙|陕|吉|闽|贵|粤|青|藏|川|宁|琼)ICP[备证][0-9]{4,}号(-[0-9]+)?$'
if ! printf '%s' "$ICP_BEIAN_NORM" | grep -qE "$ICP_SHAPE"; then
  if [ "$ALLOW_PH" = "1" ]; then
    echo "  ⚠ 形状不符（含占位/测试值），已用 --allow-placeholder 放行（仅演练）"
  else
    die "备案号形状不合法：[${ICP_BEIAN_NORM}]
     合法形如 京ICP备2024000000号-1 / 京ICP证030173号 / 粤ICP备12345678号
     占位值（TEST-/pending/待备案/0000000）一律拒绝；带空格会自动归一化。"
  fi
fi
[ -n "$ICP_POLICE_NORM" ] && ! printf '%s' "$ICP_POLICE_NORM" | grep -qE '^.+公网安备[0-9]{8,}号?$' \
  && echo "  ⚠ ICP_POLICE 形状可疑：[${ICP_POLICE_NORM}]（形如 京公网安备11010502030123号）"

say "2. TLS 是否真的可用（决定第 3 条）"
if curl -sk -o /dev/null --max-time 8 "https://${DOMAIN}/" 2>/dev/null; then
  TLS_OK=1; echo "  ✓ https://${DOMAIN}/ 可连通 → 将把 COOKIE_SECURE 改 true"
else
  TLS_OK=0; echo "  ✗ https://${DOMAIN}/ 不可连通"
  if [ "$ALLOW_HTTP" = "1" ]; then
    echo "  --allow-http：保留 COOKIE_SECURE=false，只做前两件事"
  else
    die "TLS 不可用。改 COOKIE_SECURE=true 会让用户刷新即掉登录；先配好证书，或加 --allow-http"
  fi
fi

say "3. 备份（写入之前）并生成 manifest"
# 备份目录：BK 显式指定优先；否则线上落 /root/oneframe-backup，
# 演练目录（ENVD 不是 /etc/oneframe）落到 $ENVD/backup，避免污染真实备份。
if [ -z "${BK:-}" ]; then
  case "$ENVD" in
    /etc/oneframe) BK=/root/oneframe-backup ;;
    *)             BK="$ENVD/backup" ;;
  esac
fi
mkdir -p "$BK"
cp -a "$WEB_ENV" "$BK/web.env.$STAMP"
cp -a "$API_ENV" "$BK/api.env.$STAMP"
grep -qiE 'TEST-|example|0000000|pending' "$BK/web.env.$STAMP" \
  && echo "  ⚠ 备份里已含占位备案号 → 当前文件本来就是坏的，回滚到它没意义" \
  || echo "  备份干净"

# manifest：证明“这份备份拍在改动之前”，并给出改动前后的 sha256。
# 规则 5（docs/05-ops/deployment.md §7.4.2）：没有 manifest 的备份只是“某个时刻的副本”，
# 不能算可回滚点——INC-01 里回滚到坏状态就是因为缺这个语义。
MANIFEST="$BK/env.$STAMP.manifest"
{
  echo "# OneFrame env backup manifest"
  echo "timestamp=$(date -Is)"
  echo "script=$(basename "$0")"
  echo "args=$*"
  echo "envd=$ENVD"
  echo "purpose=post-icp-transition"
  for f in web.env api.env; do
    echo "before_sha256_$f=$(sha256sum "$BK/$f.$STAMP" | awk '{print $1}')"
  done
  echo "applied=${APPLY}"
} > "$MANIFEST"
chmod 600 "$MANIFEST"
echo "  → $MANIFEST"
echo "  before_sha256: $(grep -E 'before_sha256_' "$MANIFEST" | sed 's/before_sha256_//' | tr '\n' ' ')"

say "4. 生成新内容（幂等）"
NEWWEB=$(mktemp); NEWAPI=$(mktemp)
python3 - "$WEB_ENV" "$NEWWEB" "$ICP_BEIAN_NORM" "$ICP_POLICE_NORM" <<'PY'
import sys
src, dst, beian, police = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
out, seen_b, seen_p = [], False, (police == "")
for ln in open(src, encoding='utf-8').read().splitlines():
    s = ln.strip()
    if s.startswith('ONEFRAME_ALLOW_MISSING_ICP'):
        continue
    if s.startswith('# NUXT_PUBLIC_ICP_BEIAN=') or s.startswith('# NUXT_PUBLIC_ICP_POLICE='):
        continue
    if s.startswith('NUXT_PUBLIC_ICP_BEIAN='):
        out.append(f'NUXT_PUBLIC_ICP_BEIAN={beian}'); seen_b = True; continue
    if s.startswith('NUXT_PUBLIC_ICP_POLICE='):
        if police: out.append(f'NUXT_PUBLIC_ICP_POLICE={police}'); seen_p = True
        continue
    out.append(ln)
if not seen_b: out.append(f'NUXT_PUBLIC_ICP_BEIAN={beian}')
if not seen_p and police: out.append(f'NUXT_PUBLIC_ICP_POLICE={police}')
open(dst, 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
print('  web.env 输出行数:', len(out))
PY
if [ "$TLS_OK" = "1" ]; then
  python3 - "$API_ENV" "$NEWAPI" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
out, seen = [], False
for ln in open(src, encoding='utf-8').read().splitlines():
    if ln.strip().startswith('COOKIE_SECURE='):
        out.append('COOKIE_SECURE=true'); seen = True; continue
    out.append(ln)
if not seen: out.append('COOKIE_SECURE=true')
open(dst, 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
print('  api.env: COOKIE_SECURE=true')
PY
else
  cp "$API_ENV" "$NEWAPI"; echo "  api.env: COOKIE_SECURE 保持不变"
fi

say "5. 差异预览（过滤密钥行）"
echo "  --- web.env ---"
diff <(grep -vE 'SECRET|KEY|PASSWORD|TOKEN' "$WEB_ENV") <(grep -vE 'SECRET|KEY|PASSWORD|TOKEN' "$NEWWEB") || true
echo "  --- api.env ---"
diff <(grep -vE 'SECRET|KEY|PASSWORD|TOKEN' "$API_ENV") <(grep -vE 'SECRET|KEY|PASSWORD|TOKEN' "$NEWAPI") || true

if [ "$APPLY" != "1" ]; then
  rm -f "$NEWWEB" "$NEWAPI"
  say "DRY-RUN 结束：未写任何文件"
  echo "  真跑：加 --apply"
  exit 0
fi

say "6. 应用"
install -m 600 -o root -g root "$NEWWEB" "$WEB_ENV"
install -m 600 -o root -g root "$NEWAPI" "$API_ENV"
rm -f "$NEWWEB" "$NEWAPI"
# 补记 after_sha256：回滚脚本靠 before/after 两值判断“当前是否已是回滚后状态”
{
  for f in web.env api.env; do
    echo "after_sha256_$f=$(sha256sum "$ENVD/$f" | awk '{print $1}')"
  done
  echo "applied_at=$(date -Is)"
} >> "$MANIFEST"
echo "  after_sha256 已写入 manifest"
if [ "$NO_RESTART" = "1" ]; then
  echo "  --no-restart / 演练目录：跳过 systemctl"
else
  systemctl restart oneframe-web; sleep 6
  echo -n "  oneframe-web: "; systemctl is-active oneframe-web
  if [ "$TLS_OK" = "1" ]; then
    systemctl restart oneframe-api; sleep 6
    echo -n "  oneframe-api: "; systemctl is-active oneframe-api
  fi
  echo -n "  启动后「缺少 ICP」告警条数（应为 0）: "
  tail -6 /srv/oneframe/logs/web/web.err.log 2>/dev/null | grep -c "缺少 NUXT_PUBLIC_ICP_BEIAN" || true
fi

say "7. 对外门禁（STRICT_ICP=1）"
if [ "$NO_RESTART" = "1" ]; then
  echo "  演练目录/--no-restart：跳过门禁（07 打的是线上 127.0.0.1，与副本无关）"
  exit 0
fi
( cd "$HERE" && STRICT_ICP=1 DOMAIN="$DOMAIN" bash ./07-verify.sh ) || {
  echo "  ✗ 门禁未通过（TLS/域名/备案号任一未就绪）"; exit 1; }
