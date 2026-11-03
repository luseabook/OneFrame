#!/usr/bin/env bash
# OneFrame 一键部署（web/api 产物流转）
#
# 设计要点（都是踩过的坑，不要改掉）：
#   1) 顺序必须是「先写 env → 再换产物 → 再 restart」。新构建带 ICP 启动守卫，
#      只换产物不配 env，web 会直接启动失败。
#   2) 打包只排除根 node_modules，绝不能连 .output/server/node_modules 一起排除
#      （Nitro 产物依赖这 16 个包，缺了就是 vue-bundle-renderer 500）。
#   3) 换产物用 .output.new → mv 原子切换，旧版留 .output.bak-<stamp> 可秒回滚。
#   4) 任何一步失败都不 restart，避免把线上换成半成品。
#
# 用法：
#   HOST=root@113.44.162.107 DOMAIN=oneframe.zltik.top ./deploy/deploy-oneframe.sh web
#
# 本地需能 ssh 到 HOST（密钥优先；本脚本不处理密码）。
set -euo pipefail

WHAT="${1:?用法: deploy-oneframe.sh <web|api> [--skip-verify]}"
SKIP_VERIFY="${2:-}"
HOST="${HOST:?必须提供 HOST，如 root@1.2.3.4}"
DOMAIN="${DOMAIN:?必须提供 DOMAIN}"
APP_DIR="${APP_DIR:-/srv/oneframe/app}"
ENV_DIR="${ENV_DIR:-/etc/oneframe}"
API_URL="${API_URL:-http://127.0.0.1:8080}"
PUBLIC_BASE="${PUBLIC_BASE:-http://127.0.0.1}"
STAMP=$(date +%Y%m%d-%H%M%S)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say() { printf '\n=== %s ===\n' "$*"; }

check_env_guard() {
  say "前置：env 二选一（否则 restart 会下线站点）"
  remote_check='if grep -q "^NUXT_PUBLIC_ICP_BEIAN=.\+" '"$ENV_DIR"'/web.env 2>/dev/null; then echo WITH_ICP;
elif grep -q "^ONEFRAME_ALLOW_MISSING_ICP=1" '"$ENV_DIR"'/web.env 2>/dev/null; then echo ESCAPE_HATCH;
else echo NONE; fi'
  state=$(ssh "$HOST" "$remote_check")
  case "$state" in
    WITH_ICP)     echo "  已配置备案号" ;;
    ESCAPE_HATCH) echo "  验收模式：ONEFRAME_ALLOW_MISSING_ICP=1（不可对外）" ;;
    *) echo "  ✗ web.env 既无备案号也无逃生舱 —— 停止部署，先补 env"; exit 1 ;;
  esac
}

case "$WHAT" in
web)
  check_env_guard

  say "本地构建（幂等，产物内含 SSR 改动）"
  pnpm --filter @app/web build

  say "打包（只排除根 node_modules，保留 .output/server/node_modules）"
  tar czf "$TMP/web-output.tar.gz" -C apps/web .output
  # 断言用「依赖清单逐条比对」，不用目录条数阈值：少一个 vue-bundle-renderer 时
  # 递归条数仍在 200 左右，数量阈值拦不住，而那正是曾经 500 的真实故障形态。
  node -e '
    const fs=require("fs"),path=require("path");const root=process.argv[1];
    const pkg=JSON.parse(fs.readFileSync(path.join(root,"server/package.json"),"utf8"));
    const deps=pkg.dependencies||{}; const bad=[];
    for(const [n,want] of Object.entries(deps)){
      const f=path.join(root,"server/node_modules",n,"package.json");
      if(!fs.existsSync(f)){bad.push(n+" 缺失");continue;}
      const got=JSON.parse(fs.readFileSync(f,"utf8")).version;
      if(got!==want) bad.push(n+" "+got+"!="+want);
    }
    if(bad.length){console.error("✗ 依赖清单不符: "+bad.join("; "));process.exit(1);}
    console.log("  ✓ 依赖清单 "+Object.keys(deps).length+" 个全部就位");' apps/web/.output
  echo "  包内 .output/server/node_modules 条目：$(tar tzf "$TMP/web-output.tar.gz" | grep -c '^\.output/server/node_modules/')"

  say "上传并原子切换"
  scp "$TMP/web-output.tar.gz" "$HOST:/tmp/web-output.tar.gz"
  ssh "$HOST" "set -e
    cd $APP_DIR/apps/web
    rm -rf .output.new && mkdir -p .output.new
    tar xzf /tmp/web-output.tar.gz -C .output.new --strip-components=1
    test -f .output.new/server/index.mjs
    chown -R oneframe:oneframe .output.new
    mv .output .output.bak-$STAMP
    mv .output.new .output
    echo '  switched; previous kept as .output.bak-$STAMP'"

  say "重启并等待就绪"
  ssh "$HOST" "systemctl restart oneframe-web && sleep 6 && systemctl is-active oneframe-web"
  ;;
api)
  say "本地构建 api"
  pnpm --filter @app/api build

  say "打包 dist"
  tar czf "$TMP/api-dist.tar.gz" -C apps/api dist package.json
  scp "$TMP/api-dist.tar.gz" "$HOST:/tmp/api-dist.tar.gz"
  ssh "$HOST" "set -e
    cd $APP_DIR/apps/api
    mv dist dist.bak-$STAMP 2>/dev/null || true
    tar xzf /tmp/api-dist.tar.gz -C . --exclude=package.json
    chown -R oneframe:oneframe dist
    systemctl restart oneframe-api && sleep 6 && systemctl is-active oneframe-api"
  ;;
*)
  echo "未知目标：$WHAT（只支持 web / api）"; exit 1 ;;
esac

if [ "$SKIP_VERIFY" != "--skip-verify" ]; then
  say "刷新产物基准并上传（OPS-15：判据是内容 sha256，不靠人记得生成）"
  # 基准必须由部署流程自己生成：否则下次谁忘了跑摘要工具，⑩ 会因基准过期而误红，
  # 那种“假红”久了就会被当噪音忽略——比没有断言更糟。
  if [ -f deploy/server/artifact_digest.py ]; then
    COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "no-git")
    echo "  基准绑定 commit=$COMMIT（生成端只记录，判红在校验端）"
    python deploy/server/artifact_digest.py --json --commit "$COMMIT" \
      "api=apps/api/dist" "worker=apps/worker/dist" \
      "db=packages/db/dist" "web=apps/web/.output" > "$TMP/artifacts.json"
    cat "$TMP/artifacts.json"
    scp -q "$TMP/artifacts.json" "$HOST:$APP_DIR/.artifacts.json"
    ssh "$HOST" "echo '$COMMIT' > $APP_DIR/.deploy-commit"
    echo "  → $APP_DIR/.artifacts.json + .deploy-commit (commit=$COMMIT)"
  else
    echo "  ✗ 缺 deploy/server/artifact_digest.py，无法生成基准（⑩ 会判红）"; exit 1
  fi

  say "部署后自检（Architect §7.4.1）"
  DOMAIN="$DOMAIN" API_URL="$API_URL" PUBLIC_BASE="$PUBLIC_BASE" ./deploy/verify-deploy.sh
else
  echo "（已跳过自检，禁止以此宣布完成）"
fi

say "完成"
echo "  回滚 web: ssh $HOST 'cd $APP_DIR/apps/web && mv .output .output.failed-$STAMP && mv .output.bak-$STAMP .output && systemctl restart oneframe-web'"
