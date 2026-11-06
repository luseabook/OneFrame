# 部署与运维

> v1.2 · 2026-11-01 · nginx 在 compose 内独立终止 TLS（第 107 批）
> v1.2 变更：`listen 80` 只做 ACME + 308 跳转，业务入口改为 `listen 443 ssl`；HSTS 由注释改为启用；证书只读挂载、私钥不入库
> v1.1 · 2026-10-24 · MVP 双机起步，全容器化
> v1.1 变更：worker 内置 ffmpeg/中文字体与水印环境变量（RE-07）；补 exports-cleanup/shares-expire 定时任务（RE-11/08）；Sentry 境内口径

## 1. 环境矩阵

| 环境 | 用途 | 数据 | 供应商 | 部署方式 |
|---|---|---|---|---|
| local | 开发 | docker(PG/Redis/MinIO) | mock fixtures | pnpm dev |
| staging | 验收/E2E | 隔离库+种子 | 供应商**沙箱/小额Key** | main 自动部署 |
| prod | 生产 | 独立库 | 正式 Key | 手动批准蓝绿 |

域名：`www.`(落地页SSG, CDN) · `app.`(前端 SPA) · `api.`(后端) · `static.`(OSS+CDN)。全部 HTTPS(泛域名证书)。

## 2. 生产拓扑（MVP）

```
机器A 4C8G: nginx(入口/TLS) + api(×2容器) + web(node SSR 可选/静态托管)
机器B 2C4G: worker(×2容器, 内置 ffmpeg/中文字体，独立供应商出口) + 定时任务(对账/清理/看板)
托管:   PG 16(4C16G 起步, 主从 Ph2) · Redis 7(1G AOF) · OSS(私有桶×2: 源文件/生成结果) · CDN
```

扩容路径见 system-design §5。

## 3. docker-compose（prod 骨架）

> 实现参考：`app/docker-compose.prod.yml`（已落地并通过全栈冒烟：postgres/redis/minio/minio-init/migrate/api/worker/web/nginx；
> 镜像见 `app/apps/{api,worker,web}/Dockerfile`；nginx 同源反代见 `app/deploy/nginx.conf.template`
> （第 107 批起是 **envsubst 模板**，由 nginx 官方镜像 entrypoint 渲染；TLS 也在这里终止）；env 模板见 `app/.env.production.example`）。
>
> **PR-01（2026-10-30）**：compose 的 api/worker 必须带 `env_file: [./.env]`，且下列键在 `environment` 里用
> `${VAR:?message}` **强制必填**（`JWT_SECRET`、`ADMIN_JWT_SECRET`、`PHONE_HMAC_PEPPER`、`PHONE_ENC_KEY`、
> `STORAGE_SIGN_SECRET`、`PAYMENT_LIVE`，以及 `S3_ACCESS_KEY/S3_SECRET_KEY`）。原因：此前容器只拿到
> `environment` 里显式列出的键，`PHONE_*` 从未进容器 → `collectProductionProblems` 直接抛错 → api CrashLoop；
> 而 `JWT_SECRET`/`S3_*` 还带着 `dev-only-*`/`minioadmin` 默认值，会**通过**生产守卫。
> **这份 compose 至今未在干净机器上真跑过一次 —— PR-01 的关闭条件是「真跑一次 `docker compose up` 并留存日志」。**


```yaml
services:
  api:
    image: ghcr.io/<org>/api:${TAG}
    env_file: /etc/app/api.env
    deploy: { replicas: 2, resources: { limits: { cpus: "2", memory: 2G } } }
    healthcheck: [CMD, curl, -f, http://localhost:3000/healthz]
  worker:
    image: ghcr.io/<org>/worker:${TAG}
    env_file: /etc/app/worker.env
    deploy: { replicas: 2 }
  nginx:
    image: nginx:1.27-alpine
    ports: ["80:80", "443:443"]        # 80 只做 ACME 校验 + 308 跳转，业务全走 443
    environment: { TLS_SERVER_NAME: app.example.com }
    volumes:
      - ./deploy/nginx.conf.template:/etc/nginx/templates/default.conf.template:ro
      - ./deploy/certs:/etc/nginx/certs:ro   # fullchain.pem + privkey.pem，私钥不入库
      - ./deploy/acme-webroot:/var/www/certbot:ro
```

## 4. 环境变量：三组口径（fail-fast / 能起但坏 / 静默假成功）

> **权威来源**（不要用本节替代它们）：
> `apps/api/.env.example`（93 个名字，覆盖 `envSchema` 全部键）、`apps/worker/.env.example`（54 个）、
> `.env.production.example`（生产模板）。三者与代码的一致性由 `apps/api/test/env-example-coverage.spec.ts`（5 例）守着。
> 仓库根 `app/.env.example` 只有 `DATABASE_URL`/`REDIS_URL`，**不是**全集（GAP-03）。
>
> **本节按「缺了会怎样」分组**，因为运维真正要回答的是「我漏配这一行，上线后会怎样」：
> A = 进程起不来；B = 起得来但功能坏；C = **起得来、不报错、结果是假的**（最危险）。

### 4.1 A 组：fail-fast（生产守卫聚合报错，缺一项就拒绝启动）

api 侧守卫：`apps/api/src/config/env.ts` → `collectProductionProblems`（:551）、`collectSecretProblems`（:426）、
`collectPaymentModeProblems`（:468）、`collectPaymentProblems`（:497）、`collectLlmProblems`（:646），
聚合抛错在 `buildEnv`（:692）。报错**只含变量名与原因，不含值**（OPS-06）。

| 变量 | 格式 | 读取方 | 缺了会怎样 |
|---|---|---|---|
| `NODE_ENV` | 字面 `production` | api + worker | 不设则**整套守卫全部失效**，按开发态裸奔 |
| `DATABASE_URL` | `postgres://USER:PASS@127.0.0.1:55432/oneframe` | api + worker | 回落 `localhost:5432` → 连不上 |
| `REDIS_URL` | `redis://:PASS@127.0.0.1:6380` | api + worker | 回落 6379 |
| `JWT_SECRET` | `openssl rand -base64 32`（≥16 字符、≥3 类字符） | api | 拒绝启动 |
| `ADMIN_JWT_SECRET` | 同上，**必须与 `JWT_SECRET` 不同** | api | 拒绝启动；⚠️守卫只查强度**不比对两者是否相同**，须人工保证 |
| `PHONE_HMAC_PEPPER` | `openssl rand -base64 32`（≥8 字符） | api | 拒绝启动 |
| `PHONE_ENC_KEY` | 同上。**上线后不可改**（改了旧手机号解不开） | api | 拒绝启动 |
| `STORAGE_SIGN_SECRET` | `openssl rand -base64 32` | api + worker | 仓库默认 `dev-only-*` 被拒 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 口令 ≥8 字符、非 `change-me` 一类模板值 | api | 拒绝启动；首启自动建 `super` 管理员（`admin-auth.service.ts:78-96`） |
| `PAYMENT_LIVE` | 只能是 `true` / `false`，**必须显式写** | api | 拒绝启动（不允许用默认值替部署者决定收不收钱） |
| `COOKIE_SECURE` | 显式 `true`（nginx 443 终止 TLS） | api | 拒绝启动；写 `false` → 刷新即掉登录 |
| `METRICS_TOKEN` | `openssl rand -base64 32`，≥16 字符 | api | 拒绝启动（`/v1/metrics` 含任务与资金指标） |
| 支付渠道（仅 `PAYMENT_LIVE=true`） | 微信：`WECHAT_APP_ID` `WECHAT_MCH_ID` `WECHAT_MCH_SERIAL_NO` `WECHAT_API_V3_KEY` `WECHAT_NOTIFY_URL` + `WECHAT_MCH_PRIVATE_KEY(_PATH)` + `WECHAT_PLATFORM_PUBLIC_KEY(_PATH)`（或 `WECHAT_PLATFORM_PUBLIC_KEYS(_PATH)` 轮换映射）；支付宝：`ALIPAY_APP_ID` `ALIPAY_NOTIFY_URL` + `ALIPAY_APP_PRIVATE_KEY(_PATH)` + `ALIPAY_PUBLIC_KEY(_PATH)` | api | 两渠道都不全 → 拒绝启动；**只配一半的渠道也拒**（避免上线后回调验不过） |
| `ADAPTER_MODE` | 必须 `real` | worker | 拒绝启动（禁止 mock 假生成，OPS-08） |
| 真实供应商 Key | `ARK_API_KEY` / `DEEPSEEK_API_KEY` / `HTTP_VIDEO_BASE_URL` 至少一个 | worker | 拒绝启动 |
| `PROVIDER_ENCRYPTION_KEY` | ≥32 字符 | api + worker | `PROVIDER_DB_RESOLVE≠off` 时 worker 拒绝启动 |

### 4.2 B 组：起得来但功能坏

- **存储**：`STORAGE_DRIVER=local|s3`。`local` 需 `STORAGE_DIR` + `STORAGE_PUBLIC_BASE`；`s3` 需 `STORAGE_S3_BUCKET/_REGION/_ENDPOINT/_ACCESS_KEY_ID/_SECRET_ACCESS_KEY/_PUBLIC_ENDPOINT/_FORCE_PATH_STYLE`。
- **真实供应商跑通的硬条件**：出站素材 URI 必须**公网可达**，loopback 会被 worker 拦成 `745900`（`apps/worker/src/outbound-uri.ts:15,63,114`）。单机部署用 `STORAGE_DRIVER=local` + `STORAGE_PUBLIC_BASE=https://<对外域名>/v1`（nginx 把 `/v1` 直代 `api:3000`），或直接上 OSS。
- `ADAPTER_URI_TTL_SECONDS=21600`；`ARK_MODEL_MAP` / `ARK_IMAGE_MODEL_MAP`（JSON：我方模型名 → Ark 接入点）、`ARK_IMAGE_REPLACE_CODES`。
- `PUBLISH_TRANSCODE_MODE=worker`（生产形态；`inline` 会让 ffmpeg 跑进 API 进程）。
- AI 标识：`AI_LABEL_ENABLED=true`、`AI_LABEL_TEXT`、**`AI_LABEL_FONT_PATH`（必须装中文字体，否则水印变豆腐块）**、`FFMPEG_PATH` / `FFPROBE_PATH`。
- 前端（web 进程/构建）：`NUXT_API_PROXY`（**构建期**常量，Nitro 编译进 `.output/server`，运行期改无效）、`NUXT_PUBLIC_ICP_BEIAN` / `NUXT_PUBLIC_ICP_POLICE`（备案号，见 4.3）、`NUXT_PUBLIC_SITE_URL`。
- 其余：`APP_VERSION`、`SMS_IP_HOURLY_LIMIT=20`、`WORKER_ID`（多实例必须各不同）、`LOG_LEVEL`、`WORKER_CONCURRENCY`、`HOME_UNREAD_TIMEOUT_MS=25000`（须低于反代 30s 读超时）。
- **API 不会自动建表**：`main.ts` 无迁移调用。必须先 `db:migrate`（54 个 migration）再 `db:seed`（模型与价目；不 seed 则报价无价可算）。

### 4.3 C 组：能启动、不报错、结果是假的（上线前逐条确认）

| 项 | 现状 | 后果 | 归口 |
|---|---|---|---|
| `LLM_MODE` 未设 / `mock` / `real` 缺 Key | **三者一律拒绝启动**（`env.ts` 的 `collectLlmProblems`，与 worker 的 `ADAPTER_MODE` 同口径） | 生产大纲/角色/剧本/分镜若走 mock 就是假文案；现在起不来而不是静默假 | Backend（已实现） |
| **验收机例外** `ONEFRAME_ALLOW_MOCK_LLM=1` | 只认字面 `1`，写错即响亮失败；每次启动 WARN；**且必须可被机器判定**（`/v1/healthz/ready` 返回 `llmMode/mockAllowed`，`/v1/metrics` 出 gauge） | 没有它这台机器今天发不出 N-09（`HOST=127.0.0.1`）；有它则“在跑假文案”是显式声明而非静默 | Backend 实现；对外机器禁止设置，`STRICT=1` 门禁判红 |
| 短信验证码 | `apps/api/src/modules/auth/sms.service.ts` 只把 6 位码写进 Redis，**无任何网关调用**；`SMS_PROVIDER/SMS_AK/SMS_SK/SMS_SIGN_NAME/SMS_TEMPLATE_CODE` 在代码里 **0 命中** | 上线后真实用户**永远收不到码，一个都登不进来**（登录唯一入口 `auth.controller.ts:113,121`） | Backend 接网关 或 改邀请制（Chief 定，P0） |
| `NUXT_PUBLIC_ICP_BEIAN` 空 | `components/SiteLegal.vue` 空串**整段不渲染**且不报错；已加启动守卫 `apps/web/server/plugins/icp-guard.ts`（`NODE_ENV=production` 且号为空 → 进程退出） | 忘配则起不来；**验收机可用 `ONEFRAME_ALLOW_MISSING_ICP=1` 放行，但每次启动必打 WARN，对外机器禁止设置** | Frontend（已实现，`PAGE-07` 守） |
| `PROVIDER_DB_RESOLVE≠off` 但 Key 轮换未做 | worker 启动即拒（这一条是**有意**的，不算漏配） | 明确失败，好过静默降级 | — |
| `SENTRY_DSN` | 代码 **0 命中**（未接 Sentry） | 误以为已上报；实际无错误采集（EXT-18 未完成） | Ops/后端 Ph2 |
| `CAPTCHA_PROVIDER` | 只有 `CAPTCHA_ENFORCE` / `CAPTCHA_REQUIRED` 被读，`CAPTCHA_SID/SECRET` **0 命中** | 以为接了验证码，实际只有开关没有实现 | 记入 EXT/P2 |

### 4.4 web 侧（Nuxt）配什么 —— 变量清单与「可读面」的例外

> ⚠️ `apps/web/.env.example` **位于工具层的凭据围栏内**（路径含 `.env`）：
> `ops_read_files` 返回 `CREDENTIAL_DENIED`，`ops_glob('.env*')` 直接跳过（`skipReasons.credential`）。
> 这不是权限问题，切更宽的权限模式也没用；**要读它只能用 shell**（`grep`/`cat`）。
> 因此本节保留一份等价清单，避免「围栏内的文件 = 运维看不见」。

验收机实际落在 `/etc/oneframe/web.env`（600），变量与用途：

| 变量 | 必填 | 说明 |
|---|---|---|
| `NUXT_API_PROXY` | 是 | **构建期**常量（Nitro 编译进 `.output/server`，运行期改无效） |
| `NUXT_PUBLIC_API_BASE` | 否 | 空 = 同源 `/v1` |
| `NUXT_PUBLIC_ICP_BEIAN` | **生产必填** | 形如 `京ICP备2024000000号-1`；缺失 → `server/plugins/icp-guard.ts` 抛错退出（PAGE-07） |
| `NUXT_PUBLIC_ICP_POLICE` | 否 | 形如 `京公网安备11010500000000号`；空则页脚不显示该项 |
| `ONEFRAME_ALLOW_MISSING_ICP` | **仅非对外验收机** | 设 `1` 放行「无备案号」启动，每次启动必打 WARN。**对外机器禁止设置** |
| `NUXT_PUBLIC_SITE_URL` | 建议 | sitemap 的 canonical 兜底（静态化时尤其需要） |

#### 备案号的合法形状（单一事实来源：`apps/web/server/plugins/icp-guard.ts`，`08-post-icp.sh` 必须共用）

| 类别 | 形态 | 处置 |
|---|---|---|
| 合法 · 经营性 | `京ICP证030173号` | 通过 |
| 合法 · 非经营性 | `京ICP备2024000000号` / `京ICP备2024000000号-1` | 通过（`-N` 可选） |
| **排版差异** | `京 ICP 备 2024000000 号-1`、`京ICP备2024000000号 -1` | **必须先归一化空白再匹配**——备案系统页面上就是这么显示的，按原文粘贴很常见，误杀等于“号下来了却起不来” |
| 占位值 | `pending` / `TODO` / `待备案` / `TEST-京ICP备…` / `…（上线前替换）` | 拒绝启动（INC-01 里写进线上的正是 `TEST-` 前缀这一种） |
| 另一种备案 | `京公网安备11010502030123号` | 属于 `NUXT_PUBLIC_ICP_POLICE`，**不是**本变量，填错会被拒 |

- 省简称整表（31 个，已核对无缺）：京 津 沪 渝 冀 豫 云 辽 黑 湘 皖 鲁 新 苏 浙 赣 鄂 桂 甘 晋 蒙 陕 吉 闽 贵 粤 青 藏 川 宁 琼
- **判据要紧在语义上（占位 vs 真号），不能紧在排版上（空格）**——INC-01 的教训是“判据太宽会放过假号”，但矫枉过正会变成“真号也起不来”。

**`08-post-icp.sh` 的前置要求**：写 `web.env` 之前用同一套形状判据校验，**不合法就不写盘**。
靠“写完 → 重启失败 → systemd failed”兜底会把线上推进「文件已写坏 + 服务 failed」的双故障态；
INC-01 之所以要两次恢复，正是因为它先写了坏值。

### 4.5 已从本节删除的"幽灵变量"（文档写过、代码从不读取）

2026-11-03 逐个 grep（`apps/` + `packages/`，排除 node_modules/.nuxt）**全部 0 命中**，故删除；
它们留在文档里会让运维「照清单配完，以为短信/监控/供应商都好了」：

```
APP_DOMAIN / REFRESH_SECRET / ADMIN_BOOTSTRAP_PASSWORD
SMS_PROVIDER / SMS_AK / SMS_SK / SMS_SIGN_NAME / SMS_TEMPLATE_CODE
CAPTCHA_SID / CAPTCHA_SECRET / SENTRY_DSN
PAY_WECHAT_MCH_ID / PAY_WECHAT_API_V3_KEY / PAY_WECHAT_SERIAL
VOLC_AK / VOLC_SK / VOLC_MODEL_ENDPOINT / KLING_AK / KLING_SK / VIDU_KEY
DEEPSEEK_KEY / ALIYUN_DASHSCOPE_KEY
```

真实对应关系：`ADMIN_BOOTSTRAP_PASSWORD` → **`ADMIN_PASSWORD`**；`DEEPSEEK_KEY` → **`DEEPSEEK_API_KEY`**；
`*_AK/_SK` 类 → worker 侧 **`ARK_API_KEY` / `HTTP_VIDEO_API_KEY`**（见 4.2）；
`SENTRY_DSN` / `SMS_*` / `CAPTCHA_SID/SECRET` 属**功能未实现**，不是「配了就会通」（见 4.3）。

## 5. 备份与灾备

| 项 | 策略 | 恢复目标 |
|---|---|---|
| PG | 每日全量 + WAL 连续归档(OSS, 保留 14 天) | RPO≤5min / RTO≤1h，季度演练 |
| Redis | AOF everysec（仅队列/缓存，可重建） | 丢 1s 内任务由 PG 对账补投 |
| OSS | 版本控制开启 + 跨区复制(Ph2) | 误删可恢复 30 天 |
| 配置 | 全部在 git（密钥除外，放 CI Secrets + 服务器 env 双份） | — |

### 5.1 可用脚本（`app/deploy/`）

| 脚本 | 用途 |
|---|---|
| `backup-db.sh` / `backup-db.ps1` | 全量备份（custom 格式 + 压缩 + `pg_restore --list` 校验 + 14 天保留清理） |
| `restore-db.sh` | 恢复（`--clean --if-exists`，需输入 `yes` 二次确认） |
| `verify-backup.ps1` | **备份可用性验证**：恢复到临时库、比对表数与关键数据、自动删临时库 |
| `rollback.sh` | 代码回滚到指定 tag（不改数据库，提示不可逆迁移需走恢复） |

> **运维铁律**：备份不等于可用。每次备份后跑 `verify-backup.ps1`，只有能恢复的备份才算备份。
> 已验证：27 张表全量恢复、关键表数据完整。

## 5.9 网关安全响应头与体积上限（P1-10，2026-10-30）

`app/deploy/nginx.conf.template` 的 443 `server` 块已启用下列头（`always`，错误响应也带）：

| 头 | 值 | 为什么不能更严 |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | — |
| `X-Frame-Options` | `SAMEORIGIN` | 画面预览/分享页要被同源 iframe 嵌入，`DENY` 会打断 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 分享链接里的 token 不能经 Referer 外泄 |
| `Permissions-Policy` | `camera=(), geolocation=(), payment=(), usb=()` | **未限制 microphone**：语音输入走浏览器 MediaRecorder，限了会挂 |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | 微信/Apple OAuth 走弹窗回跳，`same-origin` 会切断 window.opener |
| `Cross-Origin-Resource-Policy` | `same-site` | — |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | **第 107 批起启用**：TLS 已在本层终止，HSTS 才有意义。`includeSubDomains` 的前提是所有子域都走 HTTPS（§1 的 www/app/api/static 用通配符证书）；只覆盖本站时删掉该指令。一旦下发，浏览器会记住一年，改部署形态前先确认。 |

**仍为注释、不要急着打开的一条**：

- `Content-Security-Policy`：Nuxt hydration 需要内联脚本，未接 nonce 前启用会白屏。模板已写在 `nginx.conf.template` 末尾（含 `nonce-<INJECT>` 占位）。

### 5.10 TLS 终止（第 107 批）

- **拓扑**：`listen 443 ssl; http2 on;` 是唯一业务入口；`listen 80` 只保留两件事——`/.well-known/acme-challenge/`
  （certbot `--webroot` 写到宿主机 `deploy/acme-webroot`，容器只读挂到 `/var/www/certbot`）和
  `return 308 https://${TLS_SERVER_NAME}$request_uri`。
- **跳转目标不用 `$host`**：拿 Host 头拼跳转目标等于开放重定向；这里写死模板变量 `${TLS_SERVER_NAME}`，
  compose 用 `${TLS_SERVER_NAME:?}` 强制必填，缺了在解析阶段就报错，不会带着未渲染的模板起容器。
- **证书**：宿主机 `deploy/certs/fullchain.pem`（站点证书 + 中间证书，缺中间证书部分安卓/旧客户端握手失败）
  与 `privkey.pem`（`chmod 600`），容器**只读**挂到 `/etc/nginx/certs`。私钥不入库、不进镜像（`.gitignore` 已忽略
  `app/deploy/certs/*`，只保留 `.gitkeep`）。
- **首次冒烟**：`./deploy/gen-selfsigned-cert.sh "$TLS_SERVER_NAME"` 生成 30 天自签证书（拒绝覆盖已有证书），
  浏览器会警告，只用于验证握手与跳转；生产换真证书。
- **走外层 LB/CDN 终止 TLS 的部署**：**不能**让 LB 反代到本容器的 80（80 会 308 回 https，形成
  `LB→80→https→LB` 循环）。要么删掉模板里的 80 跳转 server，要么让 LB 直连 443。
- **未验证项**：本机没有 Docker，`docker compose config` / `up` 未在这台机器上跑过；模板与 compose 的一致性由
  `apps/api/test/deploy-tls.spec.ts` 做静态断言，真实握手仍需在部署机执行一次并留存日志（PR-01 关闭条件）。

**体积上限**：`client_max_body_size` 已从 `12m` 对齐到 **48m**（= API 的 `bodyLimit`）。两者不一致时，大图 base64 上传会被网关先 413，而应用侧日志里**什么都看不到**（请求没到 api），是最难排查的一类"功能时好时坏"。

## 6. 健康检查与指标（`/v1`）

| 端点 | 语义 | 行为 |
|---|---|---|
| `GET /healthz/live` | **liveness** | 进程活着就 200，**不查依赖**（依赖抖动时不该重启容器） |
| `GET /healthz/ready` | **readiness** | db+redis 都可用才 200；否则 **503**；停机中返回 503（`shutting_down`） |
| `GET /healthz` | 聚合详情 | 依赖不可用时同样 503，供人工排查 |
| `GET /metrics` | Prometheus 文本 | 任务状态分布 / 15min 失败率 / 待支付超时 / **已支付未入账**（应恒为 0）/ 进程指标 |

> **`/metrics` 需要 Bearer 鉴权（P1-12，2026-10-30）**：`METRICS_TOKEN`（≥16 字符）生产必须显式设置（compose 用 `${METRICS_TOKEN:?…}` 强制，缺失即拒绝启动）。抓取时未带或带错 →`401` + `WWW-Authenticate: Bearer`（纯文本，不返回任何指标）；比较走 `timingSafeEqual`，避免按字节计时爆破。Prometheus 侧配置 `authorization: { credentials: <token> }`（或 `bearer_token_file`），token 只放 Secret、不进仓库；`/healthz/*` 保持匿名可探。

**探针配置建议**：
```yaml
livenessProbe:  { httpGet: { path: /v1/healthz/live,  port: 3000 }, periodSeconds: 10, failureThreshold: 3 }
readinessProbe: { httpGet: { path: /v1/healthz/ready, port: 3000 }, periodSeconds: 5,  failureThreshold: 2 }
```
**关键告警**（基于 `/metrics`）：
- `oneframe_orders_paid_without_credit > 0` → 资金链路异常，立即排查（用户付了钱没到账）
- `oneframe_failure_ratio_15m > 0.3` → 供应商异常，考虑熔断
- `oneframe_orders_stale_pending > 10` → 回调/轮询异常

## 6.1 优雅停机

`SIGTERM` 处理链路（api 与 worker 一致）：
1. 标记 `shutting_down` → **readiness 立即 503**（LB 摘流）；
2. 停止接收新请求/新 job，等待在途完成；
3. 超过 `SHUTDOWN_TIMEOUT_MS`（默认 25s）强制退出，避免容器停不下来；
4. worker 的未完成 job 由 BullMQ 重新投递，不丢失。

> 已验证：停机中 readiness 返回 503，进程退出码 0，日志含 `draining` / `closed cleanly`。

## 7. 发布与回滚

- 流程见 dev-workflow §4：staging 冒烟 → 手动批准 → 蓝绿切流（nginx upstream 切换）；
- 回滚：`./deploy/rollback.sh <上一tag>` ≤2min；DB 迁移必须向后兼容（先加后用），禁止发布依赖不可回滚迁移；
  脚本会提示：若含不可逆迁移（drop/rename），改用备份恢复而非代码回滚；
- 灰度：新版本先 10% 流量（nginx weight）观察错误率 10min。

## 7.1 定时任务（worker 机）

| 任务 | 频率 | 说明 |
|---|---|---|
| orders-reconcile | 5min | 未终态订单主动查单 |
| tasks-watchdog | 1min | RUNNING>10min 无心跳 → 重入队/告警 |
| assets-expire | 1h | 90 天结果清理 + 回收站物理删 |
| exports-cleanup | 1h | 导出 zip 7 天清理（database §10） |
| shares-expire | 1h | 过期/撤销分享 token 清理 |
| flows-audit | 每日 | balance/frozen 与流水对账，不平告警 |
| vendor-probe | 6h | 各 adapter 探针任务(沙箱)健康度 |
| backup-verify | 每周 | 恢复演练(拉最新备份到临时库跑校验) |
| accounts-purge | 6h | 已注销满 30 天账号物理清理（PRD F1，worker 内置 runMaintenance） |

> v1.0 实现现状：worker 内置 `runMaintenance`（启动 + 每 `MAINTENANCE_INTERVAL_MS`，默认 6h）已覆盖
> **90 天结果清理 / 回收站 7 天物理删 / 注销 30 天账号清理** 三项；
> 其余定时任务（对账、分享清理、备份校验、供应商探针）为运维侧待接入项。
>
> 说明：`orders-reconcile` / `tasks-watchdog` / `shares-expire` / `flows-audit` 已在 `apps/worker/src/main.ts` 用独立定时器接入
> （频率可用 `ORDERS_RECONCILE_INTERVAL_MS` 等环境变量覆盖）；`vendor-probe` / `backup-verify` 仍需运维侧接入。

## 7.2 退款 SOP（全额 · 运营审批后执行）

接口：`POST /ops/admin/orders/{id}/refund {reason}`（AdminGuard；api-spec §10.5）。仅全额、仅已支付订单。

**流程（E3 未成年人误充同一口径）**：

1. **受理**：客服建工单，记录申诉人、订单号（`orders.order_id`）、原因；核对 `orders.status=2`（已支付）。
2. **审批**：运营负责人审批（金额 + 事由），在工单写审批人/时间；未成年人误充需监护关系材料。
3. **执行**：管理端调用退款接口（`reason` 填工单号）。成功判据：响应 `status=4`、`refund_no=rf-{order_id}`；
   微信/支付宝渠道异步处理中时 `refund_status=processing`，按渠道退款结果后续转 `succeeded`。
4. **对账**：`GET /ops/admin/orders?status=4` 导出退款单，与渠道商户平台退款流水按 `refund_no`/`refund_amount_cents` 对账；
   `credit_flows` 中应存在且仅存在一条 `kind=refund, delta=-credits, ref_order_id=该订单`，且 `balance == Σdelta`。
5. **人工例外**：接口拒绝 `400101 insufficient credits to roll back (balance=…, credits=…)` 表示积分已被消耗，
   此时**不得**直接退款；按未消耗余额与用户协商，走线下/渠道人工退款并备注工单（本期不支持部分退款 API）。

> 渠道退款失败时接口返回 `745900/745901`，事务已回滚（订单仍为已支付、积分未冲正）；
> 用同一订单重试即可，渠道按幂等号 `rf-{order_id}` 去重，不会重复退钱。

## 7.3 微信支付平台证书轮换

1. 商户平台下载新平台证书 → 导出公钥 PEM；
2. 更新 `WECHAT_PLATFORM_PUBLIC_KEYS`（JSON `{"<serial_no>":"<PEM>"}`）或 `*_KEYS_PATH` 文件，**保留旧证书**（轮换期双证书并存）；
3. 滚动重启 api（回调按 `Wechatpay-Serial` 精确选公钥；未知 serial → 401 拒绝，不会误放行）；
4. 观察 24h 回调 401 比例，确认新 serial 命中后移除旧证书，再次滚动重启；
5. 未带 serial 的兼容场景回退 `WECHAT_PLATFORM_PUBLIC_KEY`（仅单证书部署）；生产建议配置 `*_KEYS` 映射。

## 7.4 生产启动守卫（fail fast）

- api：`NODE_ENV=production` 时启动即校验（`apps/api/src/config/env.ts::buildEnv`）：默认弱密钥、
  未显式 `COOKIE_SECURE`、`PAYMENT_LIVE=true` 但渠道凭据不全/半配 → **拒绝启动** 并聚合列出缺失变量名（不打印值）。
- worker：`NODE_ENV=production` 时 `ADAPTER_MODE` 必须 `real` 且至少一种真实供应商 Key，否则拒绝启动。
- 部署自检：`docker compose logs api | grep "配置校验失败"` 为空；容器启动即崩溃时优先按错误里列出的变量名补齐 Secrets。

### 7.4.1 部署顺序与部署后自检（2026-11-03 实测教训）

**顺序不能反。** 新构建的 web 带 ICP 启动守卫，所以：

```
1) 先写 env（/etc/oneframe/web.env：NUXT_PUBLIC_ICP_BEIAN，或验收机显式 ONEFRAME_ALLOW_MISSING_ICP=1）
2) 再传产物（.output）
3) 再 systemctl restart oneframe-web
4) 最后跑自检（见下）
```

**只传产物不配 env = 站点直接下线**（进程退出，systemd failed）；这是有意的 fail-fast，不是故障。

**打包规则**：只排除**根** `node_modules`，**不要**排除 `.output/server/node_modules`。
实测踩过：`tar --exclude='node_modules'` 把它一起排掉 → web 报 `Cannot find package 'vue-bundle-renderer'` 500。
`.output` 本身是自包含的（16 个包 / 4.2M，均为真实目录而非符号链接），整个传上去即可运行。

**部署后自检三件套**（缺一不可，且要留输出）：

| # | 检查 | 判据 |
|---|---|---|
| 1 | **跑的是新构建** | `curl -s -H "Host: <域名>" http://<ip>/terms | wc -c` ≈ 48K 且 `<title>` 为「用户协议 · 一帧」；若与 `/pricing` 字节数完全相同 = 还是 SPA 壳（旧构建） |
| 2 | **版本一致** | 健康检查/响应头里的 `APP_VERSION` 与本次构建 tag 一致（避免「传了却没重启」） |
| 3 | **合规可复跑** | `API_URL=http://127.0.0.1:3000 node _acceptance/compliance-check.cjs --runtime-only` → **0 FAIL**、`LOG-04` 为 PASS。部署机只有产物、没有 `docs/`，用 `--runtime-only` 让文档类判据诚实 SKIP（缺文件 ≠ 系统坏了；内容不符仍 FAIL） |

**7 条断言（`app/deploy/verify-deploy.sh` 固化，缺一不可）**

| # | 断言 | 判据 | 为什么是这条 |
|---|---|---|---|
| 1 | 新构建生效 | `/terms` 字节 ≥45000 且 `<title>` 含「用户协议」；`/pricing` 字节与之不同 | 旧构建三路由同字节（39951B） |
| 2 | **依赖清单** | 逐条比对 `.output/server/package.json` 的 dependencies：缺失或版本不符即 fail（本机 `PASS 24`） | 阈值型（`tar 条目 ≥200`）拦不住“少一个 `vue-bundle-renderer`”，那正是踩过的 500 |
| 3 | `APP_VERSION` | `api.env` 与 `.release` 一致 | 防“传了产物但没重启” |
| 4 | 语言钉死 | `/terms` 用 `Accept-Language: en-US` 与 `ja-JP` 均返回 `lang="zh-CN"` | 不带头的默认中文会被误判成“被钉死” |
| 5 | 语言跟随 | `/report` 随 `Accept-Language` 变化（en/ja/zh） | 已 i18n 的表单页被误钉会制造新错误 |
| 6 | `<loc>` 条数 | sitemap 中 `/terms` 恰好 1 条 | 旧逻辑是 5 语 5 条 |
| 7 | 合规复跑 | `--runtime-only` → 0 FAIL 且 `LOG-04` = PASS | 见 §7.4.1 上文 |

**两条纪律（都是踩过才知道的）**

1. **sitemap 字节数只做一次性取证，不进日常门禁**：14069B 与 `Host: oneframe.zltik.top` 精确对应（本机同产物 `Host: 127.0.0.1:3093` 是 13493B，差 576B = 5 字符 × 114 处 URL），它能证明“跑的是这份代码”，但**域名一换就红**。日常门禁用第 2/4/5/6 条（与 Host 无关）。
2. **部署机上 `PAGE-07` 会是 SKIP，属预期而非通过**：产物里没有 `apps/web/.env.example`（源文件不进构建），`--runtime-only` 据“本机无该文件”降级。真正的备案守卫在运行时（`server/plugins/icp-guard.ts` 抛错即进程退出），静态那条只在仓库侧成立。

> 教训来源：2026-11-03 线上跑的是**改动前旧构建**，`/terms` `/home` `/pricing` 三路由字节数完全相同（39951B），
> 而当时本地门禁全绿 —— **门禁验的是仓库，不是线上**。部署后自检必须单独做。

### 7.4.2 会写 env / 改配置的脚本：默认 dry-run，负向用例只准打副本

**起因（2026-11-03 真实事故 INC-01）**：`08-post-icp.sh` 的负向用例本该只证明「该拒绝」，
结果**真的改写了线上 `/etc/oneframe/web.env`**（写入 TEST 备案号、删掉逃生舱、`COOKIE_SECURE=true`）。
根因是 TLS 探测返回 `000000`，而判据写成 `!= "000"`，被误判成「TLS 可用」，于是跳过了本应中止的分支。

**三条硬规则（写进脚本，不靠人记）**

1. **默认 dry-run**：任何会写 `env` / `nginx` / `systemd` 的脚本，不带显式 `--apply` 时只打印将要做的改动，
   带 `--apply` 才落地。`07-verify.sh` 这类只读脚本不受限。
2. **负向用例只准打副本**：把待改文件 `cp` 到临时目录，在副本上验证「应该失败」，**绝不指向 `/etc/oneframe/*.env`**。
   判据是「脚本对坏输入返回非 0 且给出具体原因」，不是「真的把坏值写进去再观察」。
3. **HTTP 状态码这类取值禁止用不等号判断**：`!= "000"` 放过了 `000000`。一律用精确集合匹配或长度校验。
4. **改完脚本必须核对远端内容**：只上传一部分、或改了本地没上传，判据都会替你发现（`selftest` 那次就是这样红的），
   但更省时的做法是上传后立刻比 `sha256` / CR 计数，并在部署输出里打印这份清单。
   “我上传过了”不是证据，“远端内容是这份 sha256”才是。
5. **备份必须证明“拍在改动之前”**：INC-01 的第二伤害就是回滚到了一份**在坏状态之后生成的备份**。
   规则：改动前先生成备份，并在备份同目录写一份 `*.manifest`（时间戳 + 目标文件 sha256 + 生成该备份的脚本与参数）；
   回滚时先校验目标文件当前 sha256 与 manifest 中的“改动前值”不同、且与“改动后值”相同，否则拒绝回滚并提示换用更早的备份。
   **没有 manifest 的备份只能算“某个时刻的副本”，不能算可回滚点。**
6. **迁移“已应用”的判据在目标库，不在执行端**：脚本退出码 0 只能证明“脚本没报错”，
   不能证明“目标库有这个变更”。必须查：① `__drizzle_migrations` 的 journal 计数（与 `apps/api/drizzle/*.sql` 数量对齐）；
   ② 该迁移引入的**列/表存在性**（`information_schema.columns` / `\d table`）。
   实例（2026-11-03）：`0054` 在本地库 apply 成功，服务器仍是 `journal=54` 且无 `episodes.llm_mock` ——
7. **产物新鲜度必须被断言，不能靠“我改完了”**：产物清单是 **`api` / `web` / `worker` / `packages/db`（内部包也算）**，
   每个都要 ①**内容 sha256 与本地 `pnpm build` 产物双向核对** ②**本次改动的可辨识标记**。
   **时间戳只作提示，不作判据** —— 部署树只有 `dist` 没有 `src`，且 rsync 会重置 mtime，比时间永远比不出来。
   三个实例（2026-11-03 同一天发生）：部署树的 `drizzle/` 缺 `0054` 与 `meta/_journal.json` 条目 →
   `drizzle-kit` 报 applied 但库没变；`worker/dist` 是 05:05 的旧构建 → 导出 manifest 静默缺 `llm_mock`；
   `web` 产物余留 `NUXT_API_PROXY` 测试值 → `/v1` 代理到不存在的端口。
   **基准（`.artifacts.json`）的生成协议**（2026-11-03 裁定，防止“拿现状当正确”）：

   1. **由部署脚本在“构建完成后、上传之前”自动生成**，不由 `⑩` 或上传后生成 —— 后者等于把线上现状写成基准；
   2. 基准文件必须内嵌 **commit sha（`git rev-parse --short HEAD`）+ 生成时间 + 每个产物的 `{files, sha256}`**；
   3. **`⑩` 必须先校验基准里的 commit sha 与当前 HEAD 一致**，不一致直接判红并提示“基准过期，请重新构建并生成基准”。
      否则会出现最难发现的一种假绿：**旧基准比对旧产物，全绿**。
   **基准来源的校验强度（2026-11-03 写死，不得拔高）**

   - 服务器上**没有 `.git`**（共享机不保留完整版本库），因此 `⑩` 无法 `git rev-parse`。
     替代做法：部署时写入 `.deploy-commit`，`⑩` 比对「基准内嵌 commit」vs「`.deploy-commit`」。
   - **这一层的强度弱于真实 HEAD 校验**：若有人同时手工写入「错基准 + 错 `.deploy-commit`」，两者会自洽。
   - 因此本机制**这里防的是误用，不防恶意**。它能拦住的场景是：忘了重新生成基准、拿旧基准比旧产物、
     手工生成一份“当时正确”的基准——这三类正是实际发生过或最容易发生的。
   - 需要更强保证时的做法（当前不做）：用 `git archive` 带 `HEAD` 文件部署，或在校验端持有独立来源的 commit 记录。

   4. 摘要算法固定为「按路径排序后逐文件 sha256，再对整串取一次 sha256」，**不跳过 `node_modules`**
      （`.output/server/node_modules` 正是当初导致 500 的那一层，跳过它摘要就失去意义）。

   **失败形态都是“静默缺失”，不是报错** —— 所以必须有断言。
   **部署树里的工具脚本也是产物**：`artifact_digest.py` / `compare_artifacts.py` 陈旧会让 `⑩` 误报
   （实例 2026-11-03：旧版 `artifact_digest.py` 不支持 `--commit`，把 `--commit 5835575` 解析成两个空条目，
   校验端读不到 `commit` 字段 → `[FAIL] 基准未记录 commit`）。它们同样要按 sha256 与仓库逐字节核对。
   **“我在临时目录验过”不覆盖部署树** —— 这是规则 4 在工具自身上的重演。

   **跨包边界尤其危险**：`packages/db/dist` 陈旧 → `episodes.llm_mock` 映射缺失 → 字段被静默丢掉，
   而报错信息（`expected false to be true`）**完全指向调用方，不指向包**。只盯三个 app 产物会漏掉这一层。
   两侧都“没报错”，但目标环境并没有这个变更。与规则 4 同源：**执行成功不是证据，目标状态才是。**

**事故后的验收口径**：恢复后三项须同时成立——`web.env` 里有 `ONEFRAME_ALLOW_MISSING_ICP=1` 且无 ICP 号、
`COOKIE_SECURE=false`、`systemctl is-active oneframe-web` = active；再跑 `07-verify.sh` 保持 `EXIT=0`。

### 7.4.5 发布顺序与「登录能用」的假象（2026-11-03 实测）

**顺序：内部包 → `db` → `api` → `web` → `worker`。** 违反顺序会得到一种特别坏的半坏状态：

| 现象 | 真实原因 |
|---|---|
| `POST /v1/auth/email/register` → **500** | `packages/db/dist` 陈旧，未导出新表 → `insert(...).values({...userCredentials.id})` 里列对象是 `undefined`，报 `Cannot read properties of undefined (reading 'Symbol(drizzle:Columns)')` |
| `POST /v1/auth/login/password` → **401101（正常）** | 登录路径只读 `identities`，**不碰新表**，所以新表没就位照样工作 |

**由此得出两条验收纪律**：

1. **「登录能用」不能当作「这批已上线」的证据**：任何新增表/新增列的功能，验收必须走**写入路径**（注册、下单、导出），
   因为读路径可能根本不经过新结构。本例中注册 500 而登录正常，只看登录会误判整批成功。
2. **内部包（`packages/*`）与 api 同批发布**，各自 sha256 双向核对（见规则 7）；`db` 包先于 `api`。

**迁移判据的 schema 限定（修正我自己写错过的一条）**：`__drizzle_migrations` 在 **`drizzle` schema** 里，不在 `public`。
写成 `select count(*) from __drizzle_migrations` 在只查 `public` 的连接上会报“表不存在”，从而误判“迁移没跑”。正确的是：

```sql
select count(*) from drizzle.__drizzle_migrations;
```

## 7.5 账本对账与修复 SOP（ledger repair）

**不变式**（database.md §4，PRD F6）：
`credit_accounts.balance == Σ credit_flows.delta` 且 `credit_accounts.frozen == Σ credit_flows.frozen_delta`。

### 何时跑
- `flows-audit` 定时任务/worker 启动日志出现 `LEDGER MISMATCH`（指标 P1：余额对账不平）；
- 大版本发布、手工数据修复、DB 恢复/迁移之后；
- 客服反馈「充值到账金额不对」「退款后余额异常」时先跑一次只读对账。

### 标准流程（先只读，再定向修复）
1. **只读扫描（默认 dry-run，不写库）**
   ```bash
   DATABASE_URL=postgres://app@127.0.0.1:55432/app node _acceptance/ledger-repair.cjs --dry-run
   ```
   输出每个不一致 space 的 `balance / Σdelta / Δbal / frozen / Σfrozen / Δfrozen` 及修复方式；
   另有「有流水无账户」的 orphan space 列表（脚本不自动修，需人工建账户/追查）。
2. **人工判定类型**（决定是否需要业务侧处理）：
   - `Δbal < 0` 且 `Δfrozen > 0`（`Σfrozen` 为负）：历史上出现过凭空/重复解冻——钱包被多发，脚本会**扣回**；
   - `Δbal < 0` 且 `Σfrozen` 正常：账户少于流水（如历史上直接改了账户）——脚本按流水补齐；
   - `Δbal > 0`：账户多于流水——脚本按流水扣减（如确属误发，先与财务确认）。
3. **定向试修**（先挑 1~2 个 space，避免一次性大范围改动）：
   ```bash
   node _acceptance/ledger-repair.cjs --fix --space 107517947000438785,107584284706127873
   ```
4. **验证**：再次 `--dry-run`，对应 space 应消失；脚本 `--fix` 结束也会自检「修复后仍未一致的 space」，
   非 0 即退出码 1（需排查 CHECK 失败/并发写入）。
5. **全量修复**（确认试修结果后）：`node _acceptance/ledger-repair.cjs --fix`；
   结束后 `--dry-run` 应为「账本一致，无需修复」。
6. **留痕**：每次修复都会追加一条 `credit_flows.kind='adjust'`，`memo` 记录
   `account before -> after, flows sum ... (reason)`；工单需附：执行人、时间、space 列表、adjust 流水 id、修复前后汇总。

### 修复口径（只追加，不改历史流水）
- 以流水为事实来源重算账户；`Σfrozen < 0`（凭空/重复解冻）时把多发的余额一并扣回，`frozen` 归 0；
- `adjust` 流水的 `delta/frozen_delta` = 使重算后 Σ 与账户一致所需的差额（纯账户重置时可为 0），
  脚本不会 UPDATE/DELETE 任何历史 `credit_flows`；
- 账户列有 `CHECK (balance >= 0 AND frozen >= 0)`，目标值若被钳到 0，脚本会报告剩余不一致并以非 0 退出。

### 防止再次发生
- **所有资金变动必须走 `packages/db/src/ledger.ts`**（同一事务内锁账户 + 写流水）。禁止用直连 SQL
  `UPDATE credit_accounts` 或手工插 `credit_flows`（历史脏数据即来自测试直接改账户，见下）。
- 看门狗解冻已改为**以流水为准**（`apps/worker/src/maintenance.ts::reviveStuckTasks`）：
  只有 `Σfrozen_delta > 0` 才解冻恰好该额度，且 UPDATE 带 `status in (1,2)` 抢占状态、检查 affected rows，
  避免「没冻结过也解冻」与「settle 后重复解冻」。
- 对账脚本/看门狗的 `kind=adjust`、`kind=unfreeze` 流水均写 `balance_after`，便于链式核对。

### 历史脏数据备注（2026-10-25 排查结论）
- 43 个 space 的「frozen 不平」（`Σfrozen=-10`）= 旧版 watchdog 凭空解冻（Bug A，已修）；
- 22+ 个 space 的「balance 比流水少 1000」= `apps/api/test/refunds.spec.ts` 里为验证退款守卫
  **直接用 SQL 扣减账户余额但不写流水**的测试数据（非生产代码路径；生产代码无绕过 ledger 的写入口）。
  修复后这些测试 space 会按流水补回；如需避免再次污染，建议该用例改为使用独立的 freeze/settle 流水模拟消耗。



## 8. 上线前 72 小时运维演练清单

与 `docs/06-security-compliance/launch-checklist.md` 的 D1–D9 一一对应；**任一项不通过不得发布**，
演练结论（通过/不通过 + 实际耗时 + 执行人）回填发布单。

| 编号 | 演练 | 操作步骤 | 通过判据 |
|---|---|---|---|
| D1 | 备份可恢复性 | `pwsh -File deploy/verify-backup.ps1`（拉最新备份 → 临时库恢复 → 比对表数与关键数据 → 删临时库） | 全表恢复成功、关键表行数一致、临时库已清理 |
| D2 | 回滚 | `./deploy/rollback.sh <上一tag>` | ≤2min 完成；`curl -fsk https://127.0.0.1/v1/healthz/ready` 返回 200（**必须走 443**：`curl -f` 把 80 的 308 当成功，用旧地址会假通过）；核心接口冒烟通过 |
| D3 | 支付回调失败 | 临时清空 `WECHAT_PLATFORM_PUBLIC_KEY` 后重启 api，构造一条回调 | 回调被拒（验签不过不入账）；`oneframe_orders_paid_without_credit` 不增长；告警触发 |
| D4 | 对账补账 | `PAYMENT_LIVE=false` 时用 `POST /v1/billing/notify/mock` 制造"已支付未入账" | 5min 内 `orders-reconcile` 补账，指标归零 |
| D5 | 优雅停机 | 向 api 进程发 `SIGTERM` | readiness 立刻 503 → 在途请求完成 → 退出码 0；日志含 `draining` / `closed cleanly` |
| D6 | 告警链路 | 人为制造 5xx 与 >2s 慢请求 | 请求日志 `level=warn`（observability §1.3）且命中告警通道（P0 电话 + IM） |
| D7 | 容量与限流 | 压测下单/任务查询 30min | api P95 ≤500ms；队列 age ≤5min；CPU/磁盘水位 <70% |
| D8 | 值班与升级 | 排班表 + P0 15min 响应演练 | 值班到人、电话可达、升级路径明确 |
| D9 | 未成年人误充退款 | 模拟监护人申诉 → 审批 → 按未消耗余额退款（流程见 §7.2） | 工单、审批、退款记录三件留痕；`status=4`、`refund_no`、refund 流水齐全且 ledger 平 |

**排障串联**：每个 HTTP 响应都带 `x-request-id`，请求日志 `request_id` 与之同值（observability §1.1）——
用户报障时先要响应头，即可在日志系统一次捞全该请求的鉴权身份、状态码、耗时与错误码。

### 7.6 测试确定性与账本现状（2026-10-25）

- **api 测试改为串行文件执行**：`apps/api/package.json` 的 test 脚本加 `--no-file-parallelism`。原因：多个测试文件并行时共用同一 Postgres/Redis，`project-assets.spec.ts` 的「绑定顺序 / 删除解绑」两条断言会偶发失败（单独跑该文件 13/13 全绿，并行全量跑时 2 例失败）。串行后 `pnpm --filter @app/api test` 稳定 **23 files / 215 passed**（约 30s）。
- **本机 dev 库账本已修复**：按 §7.5 SOP 执行 `node _acceptance/ledger-repair.cjs --fix`，`repaired=61`，复跑 `--dry-run` 为 **不一致 0**（此前 40 个 watchdog 凭空解冻类 + 21 个测试脏数据类）。
- **仍需注意**：`apps/api/test/refunds.spec.ts` 的退款守卫用例仍用直连 `update credit_accounts` 模拟「积分已消耗」，每跑一次全量测试会给 dev 库留下 1 个「有 recharge 流水但余额少 1000」的脏 space —— 生产代码无此问题，但会让账本告警长期有噪音。建议后续把该用例改成用真实 freeze/settle 流水模拟消耗（未做）。

### 7.7 成片合成（ffmpeg）与时间线

**依赖**：worker 机器需有 `ffmpeg`/`ffprobe`（本机验证版本 8.1.1-full_build，PATH 可达）。
可用 `FFMPEG_PATH` / `FFPROBE_PATH` 指定绝对路径（默认 `ffmpeg`/`ffprobe` 走 PATH）。
worker 启动**不强制**校验 ffmpeg（避免 dev 无 ffmpeg 起不来）；缺失时导出任务失败为
`status=4` + `error.message`（如 `spawn ffmpeg ENOENT`），worker 进程不崩溃。

**链路**：
1. api `POST /v1/projects/{id}/episodes/{eid}/timeline/export` → 写 `timeline_exports(status=1)` → Redis 队列 `timeline.export`；
2. worker `runTimelineExport`：读 `project_timelines.clips` → 逐段取 `tasks.results[0].uri`（`storage.read`）→
   `ffmpeg -vf scale/pad/setsar/format=yuv420p -r 30 -c:v libx264 -an -t <clip.duration>` 归一化
   （9:16→720x1280 / 16:9→1280x720 / 1:1→720x720）→ concat demuxer → 叠加「AI 生成」水印（drawtext 右下角）
   → 上传 `u/<space>/timelines/<exportId>.mp4` → `status=3`、`file_uri`、`watermarked=true`、`clip_count/skipped/duration_s`；
3. api `GET .../timeline/export/{exportId}` 读取并签名 1h `download_url`。

**mock 模式（dev/CI）**：`ADAPTER_MODE=mock` 的任务结果是占位字节，ffmpeg 无法解码 →
该段回退 `lavfi color` 深色色板 + clip 名称文字（时长 = clip.duration），日志 warn 级可查
`timeline mock segment generated (lavfi color plate)`，最终仍产出可播放 mp4（验收用）。
real 模式下若某段无源视频/不可解码 → 跳过并计入 `skipped`（接口返回可见）。

**并发与临时目录**：
- 每个导出任务在系统临时目录 `timeline-export-*` 内独立工作（`mkdtemp`），成功/失败均在 `finally` 中删除；
- 不同导出之间无共享文件名；同一 `exportId` 重复投递时任务开始时读状态，已 3/4 直接返回（幂等）；
- worker 并发由 `WORKER_CONCURRENCY` 控制（默认 5）；合成是 CPU 密集操作，生产建议给 worker 单独限流/资源配额。

**失败排查**：
- `status=4` + `error.message` 含 `spawn ffmpeg ENOENT` / `spawn ffprobe ENOENT` → 安装 ffmpeg 或修 `FFMPEG_PATH`；
- 含 `timeline is empty` → 该分集没有时间线（或 clips 为空）；含 `no usable clips to export` → real 模式所有片段都没有可解码源视频；
- 日志检索：worker 日志 `timeline export failed`（含 `export_id`/`err`），成功为 `timeline export succeeded (mock segments synthesized)`；
- 手动重试：重新 `POST .../timeline/export` 生成新 export（旧记录保留审计）；本地可只读复现：
  `ffmpeg -f lavfi -i color=c=0x14161d:s=720x1280:d=2 -c:v libx264 -pix_fmt yuv420p -r 30 -t 2 out.mp4`。
- **对象存储清理**：成片存 `u/<space>/timelines/`，当前无自动过期（与旧 zip 导出一致，依赖运维按容量策略清理）；
  临时目录由 worker 自动清理，无需人工。

### 7.8 真实适配器的存储前置条件（P10）

**问题**：`ADAPTER_MODE=real` 时，出站给 Ark/Kling/Vidu 的素材必须**公网可访问**。`tasks.input` 里存的是
storage key（如 `u/<space>/assets/<id>/orig.png`，无 scheme），直接发供应商必然 404 → 参考图/首帧全废（mock 下无感）。

**实现**：worker 在调用适配器前统一解析（`apps/worker/src/outbound-uri.ts`）：
- `ADAPTER_MODE=mock`：**完全保持现状**（raw key 透传，本地/CI 不依赖公网）；
- `ADAPTER_MODE=real`：
  - 无 scheme 的值视为 storage key → `storage.signDownload(key, ADAPTER_URI_TTL_SECONDS ?? 21600)`；
  - 已是 http(s) 的透传（兼容历史数据/外部 URL）；
  - 其它 scheme（mock://、ftp://）→ 任务失败（VENDOR_ERROR），不会静默发给供应商；
  - 签名/透传后的 URL host 若是 loopback（`127.0.0.1`/`localhost`/`0.0.0.0`/`::1`）→ **不调用供应商**；
- 覆盖**所有生成类任务**：视频 `reference_uris` / `first_frame_uri` / `last_frame_uri`，以及
  `studio_asset_image`（角色定妆图/资产图）的参考图；`timeline export` 为本地合成，不涉及。
- **只改出站 payload**：`tasks.input` 落库仍是 raw key（DB 不改写），结果回写仍是 storage key。

**前置条件（real 模式必须满足其一）**：
1. `STORAGE_DRIVER=s3`（推荐）：`STORAGE_S3_*` 齐全，且 `STORAGE_S3_PUBLIC_ENDPOINT` 为**公网可访问**的对外域名
   （预签名 URL 的 host 取自该地址；不要指向 VPC 内网 endpoint，否则供应商访问不到）；
2. `STORAGE_DRIVER=local` + `STORAGE_PUBLIC_BASE` 指向公网反代/内网穿透地址（如 `https://files.example.com/v1`），
   且该地址对供应商可达；`STORAGE_SIGN_SECRET` 必须与 API 一致（本地驱动下载由 API `/v1/files/local` 校验 HMAC）。

**失败表现与排查**：
- 任务 `status=4` + `error.code=745900`，错误信息原文：
  `real 适配器需要公网可访问的存储：请配置 STORAGE_DRIVER=s3 或把 STORAGE_PUBLIC_BASE 设为公网地址（当前 http://127.0.0.1:3000/v1）`
- worker 日志：`outbound uri is not publicly reachable for real adapter`（含 `hint`、字段名、URL origin）；
- 自检：在 worker 机器上 `curl -I '<签名 URL>'` 应 200 且公网可访问；检查 `STORAGE_PUBLIC_BASE`/`STORAGE_S3_PUBLIC_ENDPOINT`、
  反代是否白名单限制、供应商出口是否可达；**不要**把 `ADAPTER_URI_TTL_SECONDS` 设得小于供应商最长任务时长（默认 6h）。


### 7.4.3 验收脚本的归属（2026-11-03 裁定）

**`_acceptance/` 是验收资产目录，不属任何单个 app**，浏览器 e2e / 合规脚本 / 桩服务一律放这里：
`compliance-check.cjs`、`b-type-acceptance.ps1`、`_check-env-banner.cjs`、`_stub-api.cjs` 同源。
理由：这些脚本跨 app（web + api + 部署），放任何一个 app 目录都会让另一个 app 的 CI 依赖它。

**两条纪律**：
1. **桩必须自证是桩**：桩模式下输出必须带 `STUB` 标记，报告里不得与真栈结果混写（`OPS-14b` 即按此记录）。
2. **桩跑通 ≠ 真后端联调**：备案/Key 到位后必须对真实栈复跑同一份脚本（`OPS-14c`），断言不改。
