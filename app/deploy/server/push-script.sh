#!/usr/bin/env bash
# push-script.sh —— 上传脚本前验证字节，上传后核对 sha256
#
# 背景：git 的 text=auto eol=lf 只在提交/检出时归一化；直接传工作区文件时
# 坏字节（CRLF）不会被拦，曾导致远端 `set: pipefail: invalid option name`。
# 规则（deployment.md §7.4.2 规则 4）：
#   「我上传过了」不是证据，「远端内容是这份 sha256」才是。
#
# 用法：
#   HOST=root@1.2.3.4 ./push-script.sh 08-post-icp.sh /srv/oneframe/app/deploy/server/08-post-icp.sh \
#                                      07-verify.sh  /srv/oneframe/app/deploy/server/07-verify.sh
#
# 退出码：0 全部一致；1 有文件被拒或 sha 不一致。
set -uo pipefail
HOST="${HOST:?必须提供 HOST，如 root@1.2.3.4}"
[ $# -ge 2 ] || { echo "用法：$0 <本地> <远端> [<本地> <远端> ...]"; exit 1; }

fail=0
say() { printf '\n=== %s ===\n' "$*"; }

sha_local()  { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }
sha_remote() { ssh "$HOST" "sha256sum '$1' 2>/dev/null | awk '{print \$1}'" 2>/dev/null; }

PAIRS=()
while [ $# -gt 0 ]; do PAIRS+=("$1|$2"); shift 2; done

say "1. 上传前逐字节校验（拒 CRLF）"
OK=()
for p in "${PAIRS[@]}"; do
  L="${p%%|*}"; R="${p##*|}"
  if [ ! -f "$L" ]; then echo "  ✗ 本地不存在: $L"; fail=1; continue; fi
  cr=$(python3 -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r'))" "$L")
  lsha=$(sha_local "$L")
  if [ "$cr" != "0" ]; then
    echo "  ✗ $L 含 $cr 个 CR（CRLF），拒绝上传"
    fail=1; continue
  fi
  echo "  ✓ $(basename "$L")  CR=0  lines=$(wc -l < "$L")  sha256=${lsha:0:16}…"
  OK+=("$L|$R")
done
[ "$fail" = "0" ] || { echo; echo "结论：有文件未通过校验，未上传任何内容"; exit 1; }

say "2. 上传并核对远端 sha256"
for p in "${OK[@]}"; do
  L="${p%%|*}"; R="${p##*|}"
  scp -q "$L" "$HOST:$R" || { echo "  ✗ 上传失败 $L"; fail=1; continue; }
  lsha=$(sha_local "$L"); rsha=$(sha_remote "$R")
  if [ "$lsha" = "$rsha" ]; then
    echo "  ✓ $(basename "$L") 远端 sha256=${rsha:0:16}… 一致"
  else
    echo "  ✗ $(basename "$L") 不一致 local=${lsha:0:16}… remote=${rsha:0:16}…"
    fail=1
  fi
done

say "3. 上传清单（贴 PR 用）"
for p in "${OK[@]}"; do
  L="${p%%|*}"; R="${p##*|}"
  printf "  %-24s %s  %s\n" "$(basename "$L")" "$(sha_local "$L")" "$R"
done

echo
[ "$fail" = "0" ] && echo "结论：全部一致，可用" || echo "结论：有不一致，禁止以“已上传”作为完成依据"
exit "$fail"
