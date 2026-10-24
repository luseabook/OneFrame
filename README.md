# AI 漫剧工作台（Monorepo）

> 产品代号未定；目录名 `app` 为占位，定名后整体 rename 即可。
> 文档唯一事实来源：[`../docs/`](../docs/README.md)（当前版本 v1.1，路线 A：剧本流水线首发）

## 结构

```
apps/
  api/             NestJS API（信封/错误码/健康检查，P0）
  worker/          BullMQ Worker（三队列骨架，P0）
  web/             Nuxt3 前端（落地页+设计令牌+基础组件，P0）
packages/
  shared/          信封/错误码/雪花ID/领域枚举/Zod schema（前后端共享）
  model-adapters/  供应商适配器（火山/百炼/DeepSeek，P1 接入）
```

## 快速开始（WBS P0）

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # PG/Redis/MinIO
cp .env.example apps/api/.env                    # 本地默认值即可跑
pnpm dev                                         # api:3000 · web:3001 · worker
```

验证：

```bash
curl localhost:3000/v1/healthz    # {"code":0,...,"checks":{"db":"up","redis":"up"}}
curl localhost:3000/v1/ping
pnpm test && pnpm build           # CI 四件套本地预演
```

## 当前状态（对应 WBS）

- [x] P0.1 Monorepo + CI（.github/workflows/ci.yml：lint/typecheck/test/build）
- [x] P0.2 容器环境 + zod 配置层（启动即校验）
- [x] P0.3 packages/shared + 单测
- [x] P0.4 Nuxt 壳 + 设计令牌 + Button/Modal/TextField + 落地页静态稿
- [ ] P0.5 主体注册 / 域名 / ICP 与 AI 双备案提交 / 短信签名 / 火山+DeepSeek 开通（行政，阻塞 Alpha）
- [ ] git init + 首次提交（等 owner 确认仓库名/远端后执行）

P1 起的任务与验收见 [`../docs/07-plan/wbs.md`](../docs/07-plan/wbs.md)。
