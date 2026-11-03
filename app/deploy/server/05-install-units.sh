#!/usr/bin/env bash
# 安装三个 systemd 单元（api / web / worker）—— 模板渲染 + 校验，不自动启动
#
# 内存上限按 1.7G 共享机设定；实测 api ~132M、web ~89M，上限留了安全余量，
# 目的是超限时被杀掉自己，而不是拖垮同机的 MySQL/Java。
#
# 用法：sudo ./deploy/server/05-install-units.sh
set -euo pipefail
BASE="${BASE:-/srv/oneframe}"
ENVD="${ENVD:-/etc/oneframe}"
DIR="$(cd "$(dirname "$0")" && pwd)/systemd"

say() { printf '\n=== %s ===\n' "$*"; }

say "1. 生成三个 unit（从模板渲染路径与内存上限）"
mkdir -p /etc/systemd/system
for u in oneframe-api oneframe-web oneframe-worker; do
  sed -e "s|{{BASE}}|${BASE}|g" -e "s|{{ENVD}}|${ENVD}|g" \
      "$DIR/${u}.service.template" > "/etc/systemd/system/${u}.service"
  echo "  写入 /etc/systemd/system/${u}.service"
done

say "2. daemon-reload + 语法校验"
systemctl daemon-reload
for u in oneframe-api oneframe-web oneframe-worker; do
  out=$(systemd-analyze verify "/etc/systemd/system/${u}.service" 2>&1 || true)
  [ -z "$out" ] && echo "  $u : OK" || { echo "  $u :"; echo "$out" | head -5; }
done

say "3. 端口预检"
[ -x "$BASE/bin/preflight.sh" ] && "$BASE/bin/preflight.sh" || echo "  （未安装 preflight.sh）"

say "4. 提示"
cat <<'TXT'
  只装了单元，没有 enable/start。按需：
    systemctl enable --now oneframe-api oneframe-web
    # worker 需要真实供应商 Key 才能过启动守卫，缺 Key 时启了就是拒启
    systemctl enable --now oneframe-worker
  回滚：
    systemctl disable --now oneframe-api oneframe-web oneframe-worker
    rm -f /etc/systemd/system/oneframe-*.service && systemctl daemon-reload
TXT
