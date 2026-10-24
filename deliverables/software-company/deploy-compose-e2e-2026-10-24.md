# 生产部署编排 + Compose 冒烟验证（2026-10-24）

> 目标：用 Docker 产出可部署的完整栈，并跑通 nginx 同源入口下的真实用户链路。

## 交付物

| 文件 | 内容 |
|---|---|
| `apps/api/Dockerfile` | 多阶段构建（pnpm workspace → node:22-bookworm-slim），运行 `dist/main.js` |
| `apps/worker/Dockerfile` | 同上 + `ffmpeg`/`fonts-noto-cjk`，供 AI 显式水印 |
| `apps/web/Dockerfile` | Nuxt 构建 → 仅复制 `.output` 运行 |
| `docker-compose.prod.yml` | postgres/redis/minio/minio-init/migrate/api/worker/web/nginx；健康检查、依赖顺序、S3 环境 |
| `deploy/nginx.conf` | `/v1/`→api:3000，其余→web:3001，`client_max_body_size 12m` |
| `.env.production.example` | 生产 env 模板（含 S3 公网 endpoint） |
| `.dockerignore` | 排除 node_modules/dist/.output/本地数据 |

## 冒烟结果

```
docker compose -f docker-compose.prod.yml up -d --build
services: postgres/redis/minio/minio-init/migrate/api/worker/web/nginx 全部运行
DB tables = 26（迁移成功）
GET http://localhost:8080/v1/healthz → {"status":"ok","checks":{"db":"up","redis":"up"}}
GET http://localhost:8080/ → 200
```

用户链路（经 nginx 8080，生产 NODE_ENV 下短信不回显验证码，改从 Redis 读取测试码）：

```
login space_id=107374235906740225
GET /models?capability=video → 7
quote → generation → worker mock → task SUCCEEDED
result key u/<space>/tasks/<id>/r0.mp4
download-url host=localhost path=/app-results/...（S3 预签名）
下载 43B（mock 文本结果）；balance 72
```

## 本轮修复的部署问题

1. **预签名 host 不可达**：S3 SDK 使用内网 `minio:9000`，签名 URL 也变成 `minio`。新增 `STORAGE_S3_PUBLIC_ENDPOINT`（签名客户端独立），compose 设 `http://localhost:9000`，生产应设 CDN/OSS 公网域名。
2. **migrate 未 seed**：compose migrate 命令补 `tsx src/db/seed.ts`（幂等），首次部署即有 10 模型/74 价格。
3. **生产不回显短信码**：compose 冒烟通过 Redis 读取测试码，验证了生产行为正确（不泄露验证码）。

## 已知限制

- 镜像包含 devDependencies（体积 849MB/1.67GB/330MB），后续可做 pnpm deploy/prune 优化；
- Compose 内 MinIO 仅用于自托管演示，生产建议 OSS；
- nginx 未配 TLS/域名，上线需加 certbot/证书与安全头；
- API/worker 多副本需显式 `WORKER_ID`（雪花 ID）。
