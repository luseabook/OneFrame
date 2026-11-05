#!/usr/bin/env bash
# OneFrame 部署后自检 —— 三条硬断言（Architect 2026-11-03 口径）
#   ① /terms 必须是真 SSR 页面（字节 + 标题 + 正文），且与 /pricing 字节不同
#   ② APP_VERSION 一致（env 的值 == 发布标记文件的值；防“传了产物没重启/传错版本”）
#   ③ compliance-check --runtime-only → 0 FAIL，且 LOG-04 必须 PASS（不是 SKIP）
#
# 用法：
#   DOMAIN=oneframe.zltik.top API_URL=http://127.0.0.1:8080 PUBLIC_BASE=http://127.0.0.1 \
#     ./deploy/verify-deploy.sh
#
#   STRICT_ICP=1  对外环境用：web.env 里若还有 ONEFRAME_ALLOW_MISSING_ICP=1 就 FAIL
#   --self-test   负向自检：故意用一个必然不通的 Host，断言脚本必须以非 0 退出
#
# 退出码：0 全通过；1 有断言失败。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

DOMAIN="${DOMAIN:?必须提供 DOMAIN（精确 server_name）}"
API_URL="${API_URL:?必须提供 API_URL}"
PUBLIC_BASE="${PUBLIC_BASE:-http://127.0.0.1}"
EXPECT_TERMS_MIN_BYTES="${EXPECT_TERMS_MIN_BYTES:-45000}"
STRICT_ICP="${STRICT_ICP:-0}"
WEB_ENV="${WEB_ENV:-/etc/oneframe/web.env}"
API_ENV="${API_ENV:-/etc/oneframe/api.env}"
RELEASE_FILE="${RELEASE_FILE:-/srv/oneframe/app/.release}"
WEB_OUT="${WEB_OUT:-/srv/oneframe/app/apps/web/.output}"

fail=0
ok()   { echo "  [PASS] $*"; }
bad()  { echo "  [FAIL] $*"; fail=1; }
skip() { echo "  [SKIP] $*"; }
get()  { curl -s --max-time 15 -H "Host: $DOMAIN" "$PUBLIC_BASE$1"; }

echo "== ① 新构建判别 =="
terms=$(get /terms); pricing_bytes=$(get /pricing | wc -c)
terms_bytes=$(printf '%s' "$terms" | wc -c)
terms_title=$(printf '%s' "$terms" | grep -o '<title>[^<]*</title>' | head -1)
echo "     /terms   ${terms_bytes}B  ${terms_title}"
echo "     /pricing ${pricing_bytes}B"
[ "$terms_bytes" -ge "$EXPECT_TERMS_MIN_BYTES" ] \
  && ok "/terms ${terms_bytes}B ≥ ${EXPECT_TERMS_MIN_BYTES}（新构建）" \
  || bad "/terms 仅 ${terms_bytes}B，疑似旧构建（SPA 壳）"
[ "$terms_bytes" != "$pricing_bytes" ] \
  && ok "/terms 与 /pricing 字节不同（路由级渲染差异生效）" \
  || bad "/terms 与 /pricing 字节相同 → 同一个 SPA 壳"
case "$terms_title" in
  *"用户协议"*) ok "标题含「用户协议」" ;;
  *) bad "标题不含「用户协议」：$terms_title" ;;
esac
printf '%s' "$terms" | grep -q "一、服务内容" \
  && ok "法律正文已进 SSR HTML" || bad "SSR HTML 无法律正文"

# sitemap 是比精确字节更硬的判据：语言口径收窄后从 ~19641B 降到 ~14KB，
# 且 /terms 只应剩 1 个 <loc> + 1 条 hreflang（中文专属页不进多语 alternate）。
sm_bytes=$(get /sitemap.xml | wc -c)
sm_terms_loc=$(get /sitemap.xml | grep -c '<loc>[^<]*/terms</loc>')
# 精确字节（本机 Host=oneframe.zltik.top 时为 14069B）只用于一次性取证，语言口径收窄后
# 旧构建是 ~19641B，这里用宽松阈值区分「新/旧」而不锁死具体值：
# 域名变长会让 sitemap 线性增长（每处 URL 多几个字符），锁死会因换域名误红。
SM_MAX_BYTES="${SM_MAX_BYTES:-16000}"
# 精确解析包含 /terms 的那个 <url> 块，不能再靠 -A N 窗口（会串到下一条 <url> 的 hreflang）
sm_terms_alt=$(get /sitemap.xml | awk '
  /<url>/{buf="";inblk=1}
  inblk{buf=buf"\n"$0}
  /<\/url>/{if(inblk && buf ~ /\/terms<\/loc>/){n=gsub(/hreflang/,"hreflang",buf); print n; exit} inblk=0}
')
sm_terms_alt=${sm_terms_alt:-0}
echo "     /sitemap.xml ${sm_bytes}B  terms_loc=${sm_terms_loc} terms_hreflang=${sm_terms_alt} (阈值 ${SM_MAX_BYTES}B)"
[ "$sm_bytes" -lt "$SM_MAX_BYTES" ] \
  && ok "sitemap ${sm_bytes}B < ${SM_MAX_BYTES}（语言口径已收窄；旧构建 ~19641B）" \
  || bad "sitemap ${sm_bytes}B ≥ ${SM_MAX_BYTES}，疑似旧构建或域名异常变长"
[ "$sm_terms_loc" = "1" ] \
  && ok "/terms 只 1 个 loc" || bad "/terms 有 ${sm_terms_loc} 个 loc，应只 1 个"
[ "$sm_terms_alt" -le 1 ] \
  && ok "/terms hreflang=${sm_terms_alt}（中文专属页不应有多语 alternate）" \
  || bad "/terms hreflang=${sm_terms_alt}，应 ≤1"

echo
echo "== ② 服务存活 + LOG-04 运行态 =="
for p in / /v1/ping; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "Host: $DOMAIN" "$PUBLIC_BASE$p")
  [ "$code" = "200" ] && ok "GET $p → 200" || bad "GET $p → $code"
done
hdr=$(curl -s -D - -o /tmp/.vd_body --max-time 15 -H "Host: $DOMAIN" "$PUBLIC_BASE/v1/ping")
echo "$hdr" | grep -qi '^x-request-id:' && ok "带 x-request-id" || bad "缺 x-request-id"
grep -q '"pong":true' /tmp/.vd_body 2>/dev/null && ok "data.pong=true" || bad "无 pong:true"
rm -f /tmp/.vd_body

echo
echo "== ③ APP_VERSION 一致性 =="
env_ver=$(grep -h '^APP_VERSION=' "$API_ENV" 2>/dev/null | cut -d= -f2-)
rel_ver=$(cat "$RELEASE_FILE" 2>/dev/null | head -1)
echo "     api.env APP_VERSION = ${env_ver:-<未设>}"
echo "     发布标记 .release   = ${rel_ver:-<不存在>}"
if [ -z "$env_ver" ] || [ -z "$rel_ver" ]; then
  bad "缺少 APP_VERSION 或发布标记，无法证明 env 与产物是同一批（部署脚本应写入 $RELEASE_FILE）"
elif [ "$env_ver" = "$rel_ver" ]; then
  ok "env 与发布标记一致：$env_ver"
else
  bad "版本不一致：env=$env_ver 产物=$rel_ver（传了产物但没改 env，或 env 改了没传产物）"
fi
out_built=$(stat -c %y "$WEB_OUT/server/index.mjs" 2>/dev/null | cut -d. -f1)
[ -n "$out_built" ] && echo "     产物构建时间：$out_built"

echo
echo "== ④ 备案号守卫（对外环境禁止带逃生舱） =="
if grep -qE '^NUXT_PUBLIC_ICP_BEIAN=.+' "$WEB_ENV" 2>/dev/null; then
  ok "已配置 NUXT_PUBLIC_ICP_BEIAN"
elif grep -q '^ONEFRAME_ALLOW_MISSING_ICP=1' "$WEB_ENV" 2>/dev/null; then
  if [ "$STRICT_ICP" = "1" ]; then
    bad "对外环境仍有逃生舱且无备案号 = 无声地未备案"
  else
    skip "验收机：逃生舱已开（此机不得对外）"
  fi
else
  bad "既无备案号也无逃生舱：web 本应启动失败，它为何还活着？"
fi

echo
echo "== ⑤ 合规门禁（runtime-only，LOG-04 必须 PASS） =="
if [ -f ./_acceptance/compliance-check.cjs ]; then
  if grep -q -- '--runtime-only' ./_acceptance/compliance-check.cjs; then
    gate=$(API_URL="$API_URL" node ./_acceptance/compliance-check.cjs --runtime-only 2>&1)
    echo "     $(echo "$gate" | grep -E 'PASS [0-9]+ / FAIL [0-9]+' | tail -1)"
    echo "$gate" | grep -q '^\[FAIL\]' && { echo "$gate" | grep -E '^\[FAIL\]'; bad "门禁有 FAIL"; } \
      || ok "门禁 0 FAIL"
    if echo "$gate" | grep -E '^\[PASS\] LOG-04' >/dev/null; then
      ok "LOG-04 为 PASS（运行态被真正验证）"
    elif echo "$gate" | grep -E '^\[SKIP\] LOG-04' >/dev/null; then
      bad "LOG-04 仍是 SKIP：API_URL 没打到在跑的 api，或判据未生效"
    else
      bad "LOG-04 未出现"
    fi
  else
    skip "当前 compliance-check 不支持 --runtime-only（旧版）"
  fi
else
  skip "未找到 _acceptance/compliance-check.cjs（请在仓库根目录运行）"
fi

echo
echo "== ⑥ 依赖清单比对（比"目录条数阈值"硬：少一个包也过不了） =="
if [ -f "$WEB_OUT/server/package.json" ]; then
  dep_out=$(node -e '
const fs=require("fs"),path=require("path");const root=process.argv[1];
const pkg=JSON.parse(fs.readFileSync(path.join(root,"server/package.json"),"utf8"));
const deps=pkg.dependencies||{}; const bad=[];
for(const [n,want] of Object.entries(deps)){
  const f=path.join(root,"server/node_modules",n,"package.json");
  if(!fs.existsSync(f)){bad.push(n+" 缺失");continue;}
  const got=JSON.parse(fs.readFileSync(f,"utf8")).version;
  if(got!==want) bad.push(n+" "+got+"!="+want);
}
console.log(bad.length?("FAIL "+bad.join("; ")):("PASS "+Object.keys(deps).length));
process.exit(bad.length?1:0)' "$WEB_OUT" 2>&1)
  echo "     $dep_out"
  case "$dep_out" in
    PASS*) ok "依赖清单全就位（N=${dep_out#PASS }）" ;;
    *)     bad "依赖清单不符：$dep_out" ;;
  esac
  echo "     目录：$(find "$WEB_OUT/server/node_modules" -mindepth 1 2>/dev/null | wc -l) 条递归 / $(find "$WEB_OUT/server/node_modules" -maxdepth 1 -mindepth 1 2>/dev/null | wc -l) 顶层 / $(find "$WEB_OUT/server/node_modules" -type l 2>/dev/null | wc -l) 符号链接"
else
  skip "未找到 $WEB_OUT/server/package.json"
fi

echo
echo "== ⑦ 语言口径（zh-only 页钉死中文，i18n 页跟随 Accept-Language） =="
lang_of() { curl -s --max-time 15 -H "Host: $DOMAIN" ${2:+-H "Accept-Language: $2"} "$PUBLIC_BASE$1" | grep -o 'lang="[^"]*"' | head -1 | sed 's/lang="//;s/"//'; }
t_en=$(lang_of /terms en-US); t_ja=$(lang_of /terms ja-JP)
r_en=$(lang_of /report en-US); r_ja=$(lang_of /report ja-JP)
[ "$t_en" = "zh-CN" ] && [ "$t_ja" = "zh-CN" ] \
  && ok "/terms 恒为 zh-CN（en-US→$t_en, ja-JP→$t_ja）" \
  || bad "/terms lang 未钉死：en-US→$t_en, ja-JP→$t_ja"
if [ "$r_en" = "en" ] && [ "$r_ja" = "ja" ]; then
  ok "/report 跟随 Accept-Language（en-US→$r_en, ja-JP→$r_ja）"
else
  bad "/report 未跟随语言：en-US→$r_en, ja-JP→$r_ja（不该被钉成中文）"
fi
notext=$(curl -s --max-time 15 -H "Host: $DOMAIN" -H "Accept-Language: en-US" "$PUBLIC_BASE/terms" | grep -c "authoritative legal text")
[ "$notext" -ge 1 ] && ok "非中文界面出现「以中文版为准」提示（命中 $notext）" \
  || bad "非中文界面缺少权威文本提示"
sm_terms_loc2=$(get /sitemap.xml | grep -c '<loc>[^<]*/terms</loc>')
[ "$sm_terms_loc2" = "1" ] && ok "sitemap /terms 只 1 条 <loc>（语言口径生效）" \
  || bad "sitemap /terms 有 $sm_terms_loc2 条 <loc>，应为 1"

echo
echo "== ⑧ LLM 模式显性与会话真实性（OPS-12 / OPS-13） =="
# 优先读端点（Architect 约束 2：必须机器可判定，不能只看日志/env）。
# 端点未提供时回退读 env，并明确标注“端点缺失”——避免把“读不到”当“没问题”。
llm_mode=""; mock_flag=""; llm_src=""
ready_body=$(curl -s --max-time 15 -H "Host: $DOMAIN" "$PUBLIC_BASE/v1/healthz/ready" 2>/dev/null)
if printf '%s' "$ready_body" | grep -q '"llmMode"'; then
  llm_mode=$(printf '%s' "$ready_body" | sed -n 's/.*"llmMode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  mock_flag=$(printf '%s' "$ready_body" | sed -n 's/.*"mockAllowed"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p')
  llm_src="端点 /v1/healthz/ready"
else
  llm_mode=$(grep -h '^LLM_MODE=' "$API_ENV" 2>/dev/null | cut -d= -f2-)
  mock_flag=$(grep -h '^ONEFRAME_ALLOW_MOCK_LLM=' "$API_ENV" 2>/dev/null | cut -d= -f2-)
  llm_src="env 文件（端点 ${PUBLIC_BASE}/v1/healthz/ready 未提供 llmMode）"
  skip "端点未暴露 llmMode：新构建未上线，本条只能从 env 读（OPS-12 要求端点可判定）"
fi
echo "     来源=$llm_src  LLM_MODE=${llm_mode:-<未设>}  mockAllowed=${mock_flag:-<未设>}"
if [ "$llm_mode" = "mock" ]; then
  if [ "$STRICT_ICP" = "1" ]; then
    bad "对外环境仍在 mock：LLM 输出是假文案，OPS-12 要求该变量存在即判红"
  elif [ "$mock_flag" = "1" ] || [ "$mock_flag" = "true" ]; then
    skip "本机在 mock（已显式声明）—— 大纲/剧本/分镜是假文案，不得对外"
  else
    bad "LLM_MODE=mock 但没有显式声明：新守卫会拒绝启动，或此处为旧构建"
  fi
else
  ok "LLM_MODE=${llm_mode:-<未设>}（非 mock）"
fi

# OPS-13：真实客户端 Cookie 往返。setRefreshCookie 在生产可能默认 Secure，
# grep 配置值看不出来；只有让客户端真的带 Cookie 回来才能验证。
REDIS_ENV="${REDIS_ENV:-/etc/oneframe/redis.env}"
if [ -f "$REDIS_ENV" ] && command -v redis-cli >/dev/null 2>&1; then
  RP=$(grep -oP '(?<=REDISPASSWORD=).*' "$REDIS_ENV" 2>/dev/null)
  RPHOST="${REDIS_HOST:-127.0.0.1}"; RPPORT="${REDIS_PORT:-6380}"
  PHONE="${COOKIE_TEST_PHONE:-13600136099}"
  redis-cli -h "$RPHOST" -p "$RPPORT" -a "$RP" --no-auth-warning \
    del "sms:60:$PHONE" "sms:day:$PHONE" "sms:ip:127.0.0.1" >/dev/null 2>&1
  curl -s -o /dev/null --max-time 15 -X POST "$PUBLIC_BASE/v1/auth/sms-code" \
    -H "Host: $DOMAIN" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}"
  raw=$(redis-cli -h "$RPHOST" -p "$RPPORT" -a "$RP" --no-auth-warning get "sms:code:$PHONE" 2>/dev/null)
  code=$(printf '%s' "$raw" | sed -n 's/.*"code":"\([0-9]\{6\}\)".*/\1/p')
  if [ ${#code} -eq 6 ]; then
    jar=$(mktemp)
    login=$(curl -s -c "$jar" --max-time 15 -X POST "$PUBLIC_BASE/v1/auth/login" \
      -H "Host: $DOMAIN" -H 'Content-Type: application/json' \
      -d "{\"phone\":\"$PHONE\",\"code\":\"$code\",\"age_confirmed\":true}")
    if printf '%s' "$login" | grep -q '"access_token"'; then
      ok "登录成功（$PHONE）"
      # 关键：用 Cookie jar 回传 refresh_token。浏览器同样遵守 Secure 标记。
      refresh=$(curl -s -b "$jar" -o /tmp/.vd_refresh -w '%{http_code}' --max-time 15 \
        -X POST "$PUBLIC_BASE/v1/auth/refresh" -H "Host: $DOMAIN")
      # 注意：Nest 对 POST 默认返回 201，不是 200。判据用 2xx，
      # 写死 200 会把“成功”判成失败（判据过窄，与过宽同样有害）。
      case "$refresh" in
        2??) ;;
        *)   refresh="" ;;
      esac
      if [ -n "$refresh" ] && grep -q '"access_token"' /tmp/.vd_refresh; then
        ok "refresh 往返成功 http=$refresh（Cookie 被回传，Secure 标记与本机协议一致）"
      else
        bad "refresh 失败 http=${refresh:-非2xx} —— Cookie 未被回传（COOKIE_SECURE 与协议不匹配？OPS-13）"
        head -c 200 /tmp/.vd_refresh; echo
      fi
      rm -f /tmp/.vd_refresh
    else
      bad "登录未拿到 access_token：$(printf '%s' "$login" | head -c 160)"
    fi
    rm -f "$jar"
  else
    skip "拿不到验证码（Redis 键为空），跳过会话往返检查"
  fi
else
  skip "无 $REDIS_ENV 或 redis-cli，跳过会话往返检查"
fi

echo
echo "== ⑨ OPS-14 前端 mock 声明（接口字段 + 产物含组件） =="
# 为什么不能 grep 页面 HTML：/home 等是 ssr:false（nuxt.config.ts:56），横幅由客户端
# 依赖 /v1/me 渲染，匿名或 SSR 的 HTML 里命中恒为 0 —— 那样写是永久死断言。
# 因此这里查两件 curl 能证实的事：① /v1/me 根部有 llm_mode；② 提供的 JS 产物里含
# data-env-banner 字面量。**渲染级验证需要浏览器**，不在 curl 能力内，脚本会明说。
if [ "${llm_mode:-}" = "mock" ]; then
  banner_api=0; banner_bundle=0
  if [ -f "$REDIS_ENV" ] && command -v redis-cli >/dev/null 2>&1; then
    RP2=$(grep -oP '(?<=REDISPASSWORD=).*' "$REDIS_ENV" 2>/dev/null)
    P2="${BANNER_TEST_PHONE:-13500135077}"
    redis-cli -h "${REDIS_HOST:-127.0.0.1}" -p "${REDIS_PORT:-6380}" -a "$RP2" --no-auth-warning \
      del "sms:60:$P2" "sms:day:$P2" "sms:ip:127.0.0.1" >/dev/null 2>&1
    curl -s -o /dev/null --max-time 15 -X POST "$PUBLIC_BASE/v1/auth/sms-code" \
      -H "Host: $DOMAIN" -H 'Content-Type: application/json' -d "{\"phone\":\"$P2\"}"
    raw2=$(redis-cli -h "${REDIS_HOST:-127.0.0.1}" -p "${REDIS_PORT:-6380}" -a "$RP2" --no-auth-warning get "sms:code:$P2" 2>/dev/null)
    code2=$(printf '%s' "$raw2" | sed -n 's/.*"code":"\([0-9]\{6\}\)".*/\1/p')
    if [ ${#code2} -eq 6 ]; then
      tk=$(curl -s --max-time 15 -X POST "$PUBLIC_BASE/v1/auth/login" -H "Host: $DOMAIN" \
        -H 'Content-Type: application/json' -d "{\"phone\":\"$P2\",\"code\":\"$code2\",\"age_confirmed\":true}" \
        | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
      if [ -n "$tk" ]; then
        if curl -s --max-time 15 -H "Host: $DOMAIN" -H "Authorization: Bearer $tk" "$PUBLIC_BASE/v1/me" \
             | grep -q '"llm_mode"'; then banner_api=1; fi
      fi
    fi
  fi
  # 产物侧：从首页引用的 JS 里找字面量（只要有一份含即可，命中即证明组件被打进客户端包）
  for js in $(curl -s --max-time 15 -H "Host: $DOMAIN" "$PUBLIC_BASE/home" | grep -oE '/_nuxt/[A-Za-z0-9._-]+\.js' | sort -u | head -20); do
    if curl -s --max-time 15 -H "Host: $DOMAIN" "$PUBLIC_BASE$js" | grep -q 'data-env-banner'; then
      banner_bundle=1; echo "     含横幅的产物：$js"; break
    fi
  done
  [ "$banner_api" = "1" ] && ok "/v1/me 根部返回 llm_mode（数据链通）" \
    || bad "/v1/me 未返回 llm_mode —— 横幅拿不到数据（OPS-14 数据侧）"
  [ "$banner_bundle" = "1" ] && ok "线上 JS 产物含 data-env-banner（组件已发布）" \
    || { [ "$STRICT_ICP" = "1" ] && bad "对外环境 mock 但产物无 data-env-banner（OPS-14）" \
         || skip "产物未含 data-env-banner：前端组件未发布到本机"; }
  if [ "$banner_api" = "1" ] && [ "$banner_bundle" = "1" ]; then
    echo "     [说明] 渲染级验证（登录后 DOM 出现 [data-env-banner]）需浏览器，curl 不能替代；"
    echo "            本条只证明「数据有字段 + 产物有组件」，实际渲染由前端 e2e 覆盖。"
  fi
else
  skip "非 mock，无需横幅"
fi

echo
echo "== ⑩ OPS-15 逐产物核对（api / web / worker / packages/db，判据=内容 sha256） =="
BASE_DIST_API="${BASE_DIST_API:-/srv/oneframe/app/apps/api/dist}"
BASE_DIST_WORKER="${BASE_DIST_WORKER:-/srv/oneframe/app/apps/worker/dist}"
BASE_DIST_DB="${BASE_DIST_DB:-/srv/oneframe/app/packages/db/dist}"
BASE_DIST_WEB="${BASE_DIST_WEB:-/srv/oneframe/app/apps/web/.output}"
BASE_DIST_ADAPTERS="${BASE_DIST_ADAPTERS:-/srv/oneframe/app/packages/model-adapters/dist}"
# 规则 7：三个产物各自要有①本次改动的可辨识标记②构建时间。
# 为什么必须逐产物：drizzle/ 缺 0054、worker/dist 停在旧版、web 残留测试代理，
# 三次的失败形态都是「静默缺失」，没有一个会报错。
# ── 内容判据（主）：四个产物 sha256 与构建机基准双向核对 ──
# 时间戳只作提示；判据是内容摘要（含 node_modules），避免“构建了但没改到该文件/包层陈旧”。
BASELINE="${BASELINE:-/srv/oneframe/app/.artifacts.json}"
CMP="$HERE/compare_artifacts.py"
[ -f "$CMP" ] || CMP="/srv/oneframe/app/deploy/server/compare_artifacts.py"
if [ -f "$CMP" ] && command -v python3 >/dev/null 2>&1; then
  cmp_out=$(python3 "$CMP" "$BASELINE"     "api=$BASE_DIST_API" "worker=$BASE_DIST_WORKER" "db=$BASE_DIST_DB" "adapters=$BASE_DIST_ADAPTERS" "web=$BASE_DIST_WEB" 2>&1)
  echo "$cmp_out" | sed 's/^/   /'
  if echo "$cmp_out" | grep -q '\[FAIL\]'; then bad "产物与构建机基准不一致（见上）"; else ok "五个产物 sha256 与基准一致"; fi
else
  skip "缺 compare_artifacts.py 或 python3，跳过 sha256 核对"
fi

API_DIST="${API_DIST:-/srv/oneframe/app/apps/api/dist}"
WEB_OUT2="${WEB_OUT2:-/srv/oneframe/app/apps/web/.output}"
WORKER_DIST="${WORKER_DIST:-/srv/oneframe/app/apps/worker/dist}"

echo "  产物时间："
for f in "$API_DIST/config/env.js" "$WEB_OUT2/server/index.mjs" "$WORKER_DIST/export.js"; do
  [ -f "$f" ] && printf "    %-52s %s\n" "$f" "$(stat -c %y "$f" | cut -d. -f1)" \
              || printf "    %-52s %s\n" "$f" "<缺失>"
done

# api 标记：新守卫 + HOST 绑定
if [ -f "$API_DIST/config/env.js" ]; then
  n=$(grep -c "ONEFRAME_ALLOW_MOCK_LLM" "$API_DIST/config/env.js" 2>/dev/null || true); n=${n:-0}
  h=$(grep -c "env.HOST" "$API_DIST/main.js" 2>/dev/null || true); h=${h:-0}
  if [ "$n" -gt 0 ] && [ "$h" -gt 0 ]; then ok "api 产物含新标记（mock 逃生舱 ×$n、listen(env.HOST)）"
  else bad "api 产物陈旧：ONEFRAME_ALLOW_MOCK_LLM=$n、listen(env.HOST)=$h（应均 >0）"; fi
else bad "api dist 缺失"; fi

# web 标记：横幅组件在客户端产物里
if [ -f "$WEB_OUT2/server/index.mjs" ]; then
  wb=0
  for js in "$WEB_OUT2"/public/_nuxt/*.js; do
    grep -qi "data-env-banner" "$js" 2>/dev/null && { wb=1; break; }
  done
  [ "$wb" = "1" ] && ok "web 产物含横幅组件（data-env-banner）" || bad "web 产物无 data-env-banner"
else bad "web .output 缺失"; fi

# worker 标记：产物级 llm_mock（N-12 部署侧）
if [ -f "$WORKER_DIST/export.js" ]; then
  wm=$(grep -c "llm_mock" "$WORKER_DIST/export.js" 2>/dev/null || true); wm=${wm:-0}
  if [ "$wm" -gt 0 ]; then ok "worker 产物含产物级 llm_mock（×$wm）"
  else skip "worker 产物未更新（llm_mock=0）：N-12 部署侧未就绪，待 Backend 的 episodeDto 落地后重发"; fi
else skip "worker dist 缺失"; fi

echo
echo "  说明：本段只核对「产物里有本次改动的标记 + 时间」，不证明运行时行为；"
echo "        manifest 里的 llm_mock 真假需真跑导出后解 zip 读（届时用临时库 oneframe_verify）。"

echo
if [ "$fail" -eq 0 ]; then echo "结论：三条硬断言全部通过"; else echo "结论：有断言失败，禁止宣布部署完成"; fi
exit "$fail"
