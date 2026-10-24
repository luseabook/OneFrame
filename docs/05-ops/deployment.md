# 部署与运维

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
> 镜像见 `app/apps/{api,worker,web}/Dockerfile`；nginx 同源反代见 `app/deploy/nginx.conf`；env 模板见 `app/.env.production.example`）。

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
  nginx: { ports: ["443:443"], volumes: [./nginx.conf] }
```

## 4. 环境变量清单（`.env.example` 权威版，此处摘要）

```
# 通用
NODE_ENV / APP_DOMAIN / DATABASE_URL / REDIS_URL
JWT_SECRET / REFRESH_SECRET
# 存储（S3 兼容：OSS / MinIO；ADR-005）
STORAGE_DRIVER=local|s3
STORAGE_DIR / STORAGE_PUBLIC_BASE / STORAGE_SIGN_SECRET
STORAGE_S3_BUCKET / STORAGE_S3_REGION / STORAGE_S3_ENDPOINT
STORAGE_S3_PUBLIC_ENDPOINT   # 预签名 URL 的对外地址（内网 SDK 与公网下载分离）
STORAGE_S3_ACCESS_KEY_ID / STORAGE_S3_SECRET_ACCESS_KEY / STORAGE_S3_FORCE_PATH_STYLE
# 供应商（仅 worker.env）
VOLC_AK / VOLC_SK / VOLC_MODEL_ENDPOINT
ARK_API_KEY / ARK_BASE_URL / ARK_MODEL_MAP     # 火山方舟专用适配器（volcengine:* 任务）
HTTP_VIDEO_BASE_URL / HTTP_VIDEO_API_KEY / HTTP_VIDEO_MODEL_MAP  # 通用 HTTP 视频网关
ALIYUN_DASHSCOPE_KEY / KLING_AK / KLING_SK / VIDU_KEY / DEEPSEEK_KEY
# 三方
SMS_PROVIDER=aliyun / SMS_AK / SMS_SK / SMS_SIGN_NAME / SMS_TEMPLATE_CODE
CAPTCHA_PROVIDER=tencent / CAPTCHA_SID / CAPTCHA_SECRET
SENTRY_DSN                      # 境内/自建，禁境外 SaaS（compliance D4）
PAY_WECHAT_MCH_ID / PAY_WECHAT_API_V3_KEY / PAY_WECHAT_SERIAL
# AI 标识后处理（worker 镜像内置 ffmpeg + fonts-noto-cjk）
FFMPEG_PATH=/usr/bin/ffmpeg
AI_LABEL_FONT_PATH=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
AI_LABEL_ENABLED=true / AI_LABEL_TEXT=AI生成
# 内容审核（PRD F7）
MODERATION_ENABLED=true / MODERATION_WORDS=词1,词2
# 维护任务（worker 内置，PR 周期）
MAINTENANCE_INTERVAL_MS=21600000
ADMIN_BOOTSTRAP_PASSWORD   # 首次启动建号后改密并移除
```

## 5. 备份与灾备

| 项 | 策略 | 恢复目标 |
|---|---|---|
| PG | 每日全量 + WAL 连续归档(OSS, 保留 14 天) | RPO≤5min / RTO≤1h，季度演练 |
| Redis | AOF everysec（仅队列/缓存，可重建） | 丢 1s 内任务由 PG 对账补投 |
| OSS | 版本控制开启 + 跨区复制(Ph2) | 误删可恢复 30 天 |
| 配置 | 全部在 git（密钥除外，放 CI Secrets + 服务器 env 双份） | — |

## 6. 发布与回滚

- 流程见 dev-workflow §4：staging 冒烟 → 手动批准 → 蓝绿切流（nginx upstream 切换）；
- 回滚：`./deploy rollback <上一tag>` ≤2min；DB 迁移必须向后兼容（先加后用），禁止发布依赖不可回滚迁移；
- 灰度：新版本先 10% 流量（nginx weight）观察错误率 10min。

## 7. 定时任务（worker 机）

| 任务 | 频率 | 说明 |
|---|---|---|
| orders-reconcile | 5min | 未终态订单主动查单 |
| tasks-watchdog | 1min | RUNNING>10min 无心跳 → 重入队/告警 |
| assets-expire | 1h | 90 天结果清理 + 回收站物理删 || exports-cleanup | 1h | 导出 zip 7 天清理（database §10） |
| shares-expire | 1h | 过期/撤销分享 token 清理 |
| flows-audit | 每日 | balance/frozen 与流水对账，不平告警 |
| vendor-probe | 6h | 各 adapter 探针任务(沙箱)健康度 |
| backup-verify | 每周 | 恢复演练(拉最新备份到临时库跑校验) |
| accounts-purge | 6h | 已注销满 30 天账号物理清理（PRD F1，worker 内置 runMaintenance） |

> v1.0 实现现状：worker 内置 `runMaintenance`（启动 + 每 `MAINTENANCE_INTERVAL_MS`，默认 6h）已覆盖
> **90 天结果清理 / 回收站 7 天物理删 / 注销 30 天账号清理** 三项；
> 其余定时任务（对账、分享清理、备份校验、供应商探针）为运维侧待接入项。
