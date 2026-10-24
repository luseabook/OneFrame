# AI 漫剧工作台（Monorepo）

> 产品代号未定；目录名 `app` 为占位，定名后整体 rename 即可。
> 远程仓库：<https://github.com/luseabook/OneFrame>（`main` 分支）
> 文档唯一事实来源：[`../docs/`](../docs/README.md)（当前版本 v1.3，路线 A：剧本流水线首发；`docs/` 已纳入本仓库根目录）

## 结构

```
apps/
  api/             NestJS API（auth/models/quote/generations/tasks + 冻结结算，P1）
  worker/          BullMQ Worker（mock 执行器跑通状态机/结算；P1.4 换真实供应商）
  web/             Nuxt3 前端（落地页+设计令牌+基础组件，P0）
packages/
  shared/          信封/错误码/雪花ID/领域枚举/Zod schema（前后端共享）
  db/              drizzle schema + 迁移 + 记账 ledger（api/worker 共用）
  model-adapters/  供应商适配器（火山/百炼/DeepSeek，P1 接入）
```

## 快速开始（WBS P0）

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # PG/Redis/MinIO
cp .env.example apps/api/.env                    # 本地默认值即可跑
pnpm --filter @app/shared build && pnpm --filter @app/db build
pnpm --filter @app/api db:migrate && pnpm --filter @app/api db:seed
pnpm dev                                         # api:3000 · web:3001 · worker
```

验证：

```bash
curl localhost:3000/v1/healthz    # {"code":0,...,"checks":{"db":"up","redis":"up"}}
curl localhost:3000/v1/ping
pnpm test && pnpm build           # CI 四件套本地预演
```

## 当前状态（对应 WBS）

- [x] P0.1 Monorepo + CI（仓库根 `.github/workflows/ci.yml`，工作目录 `app/`：lint/typecheck/test/build）
- [x] P0.2 容器环境 + zod 配置层（启动即校验）
- [x] P0.3 packages/shared + 单测
- [x] P0.4 Nuxt 壳 + 设计令牌 + Button/Modal/TextField + 落地页静态稿
- [x] P1.2 数据层：drizzle schema（16 表）+ 初始 migration + 首批 10 模型 seed（占位价，定价决策后热更）
- [x] P1.1 鉴权（mock 短信）：sms-code/login/refresh/logout/me + 邀请码/等待名单 + JWT/HttpOnly Cookie
- [x] P1.3 任务脊柱：models/quote(batch)/generations/tasks + 冻结-结算 ledger + BullMQ mock 执行器
- [x] P1.6/P1.7 Web 最小闭环：登录/模型选择/报价/生成/轮询/下载入口（生产构建已浏览器验证）
- [x] 适配器运行时：mock 适配器 + DeepSeek 文本适配器（OpenAI 兼容，含契约测试）
- [x] 结果转存/下载：worker 转存（local driver）+ 预签名 URL + `/files/local` 下载入口（OSS/S3 driver 待接）
- [ ] P1.4/P1.5 真实视频供应商适配器（火山/百炼/可灵/Vidu，待 Key 与企业认证）
- [ ] 工具页补齐图生视频/分享；剧本流水线前端（P1'/P2）
- [ ] P0.5 主体注册 / 域名 / ICP 与 AI 双备案提交 / 短信签名 / 火山+DeepSeek 开通（行政，阻塞 Alpha）
- [x] git init + 首次提交（remote: <https://github.com/luseabook/OneFrame>，branch `main`）

P1 起的任务与验收见 [`../docs/07-plan/wbs.md`](../docs/07-plan/wbs.md)。

## 远程仓库与协作

```bash
git clone https://github.com/luseabook/OneFrame.git
git remote -v          # 应显示 origin -> https://github.com/luseabook/OneFrame
git push origin main   # 提交前确保 pnpm test/build 通过（CI 同口径）
```

- 分支模型与 PR 规范：`docs/04-engineering/dev-workflow.md`（trunk-based，main 始终可发布）；
- 契约/表结构变更必须同 PR 更新 `docs/02-architecture/api-spec.md` / `database.md`；
- 密钥只走 CI Secrets/服务器 env，`.env.example` 仅占位（见 `docs/06-security-compliance/security.md` §6）。
