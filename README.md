# OneFrame · 万星 AI 漫剧/短剧生产 SaaS

[![ci](https://github.com/luseabook/OneFrame/actions/workflows/ci.yml/badge.svg)](https://github.com/luseabook/OneFrame/actions/workflows/ci.yml)

> 远程仓库：<https://github.com/luseabook/OneFrame>（`main`）
> 文档体系 **v1.3**（2026-10-24，路线 A：剧本流水线首发）
> 本仓库为**工作区根**：`app/` 是 P0 代码脚手架，`docs/` 是唯一事实来源，`deliverables/` 是审查交付物，`rea-reelmate/` 是竞品逆向证据（仅收录报告/模型目录/CLI 契约/截图，原始抓包与 Chrome profile 不入库，见 `.gitignore`）。

## 目录结构

```
.
├─ app/                     # monorepo（pnpm + turbo）：api / worker / web / shared / db / storage / model-adapters
│  └─ README.md             # 代码结构、快速开始、P0 状态
├─ docs/                    # 文档体系（唯一事实来源）
│  ├─ README.md             # 文档地图与变更登记（v1.3）
│  ├─ 01-product/           # PRD / 用户旅程 / 指标
│  ├─ 02-architecture/      # system-design / ADR / database / api-spec
│  ├─ 03-frontend/          # 前端规范
│  ├─ 04-engineering/       # 开发流程 / 测试
│  ├─ 05-ops/               # 部署 / 可观测
│  ├─ 06-security-compliance/  # 安全 / 合规
│  └─ 07-plan/              # WBS
├─ deliverables/
│  └─ software-company/     # 文档审查报告（含逆向一致性审查 RE-01~RE-25）
└─ rea-reelmate/            # 竞品逆向证据（curated）
   ├─ REELMATE-逆向分析报告.md
   ├─ model-catalog-summary.json · routes.txt
   ├─ cli-skill/ · cli-out/ · *.png
```

## 快速开始

```bash
cd app
pnpm install
docker compose -f docker-compose.dev.yml up -d
cp .env.example apps/api/.env
pnpm --filter @app/shared build && pnpm --filter @app/db build  # 共享包（seed/dev 依赖 dist）
pnpm --filter @app/api db:migrate   # 初始 schema（16 表）
pnpm --filter @app/api db:seed      # 首批 10 个模型（占位价）
pnpm dev                            # api:3000 · web:3001 · worker
pnpm test && pnpm build
```

## 关键文档

- 产品范围与验收：[PRD v1.3](docs/01-product/PRD.md)
- 契约唯一来源：[api-spec v1.2](docs/02-architecture/api-spec.md)
- 数据模型：[database v1.2](docs/02-architecture/database.md)
- 计划与里程碑：[WBS v1.3](docs/07-plan/wbs.md)
- 文档地图/变更登记：[docs/README.md](docs/README.md)
- 合规上线清单（外部/代码分离，可执行）：[launch-checklist](docs/06-security-compliance/launch-checklist.md)
- 逆向一致性审查（RE-01~RE-25）：[审查报告](deliverables/software-company/wanxing-reverse-consistency-review-2026-10-24.md)
- 竞品逆向基线：[REELMATE-逆向分析报告](rea-reelmate/REELMATE-逆向分析报告.md)

## 商业化就绪（B 型）验收

```powershell
# 项目专用 PG 55432 / Redis 6380 运行中；不依赖真实商户号或供应商 Key
pwsh _acceptance/b-type-acceptance.ps1        # 全量可复跑验收（当前 25/25 项通过）
```

覆盖：支付渠道适配层（微信 APIv3/支付宝）+ 回调验签/解密/ack/平台证书轮换 + 退款闭环 + 供应商 Ark/DeepSeek 契约测试 + 生产启动守卫 + request_id 可观测性 + 合规清单检查。各轮证据见 `deliverables/software-company/`（payment-channel-adapter、vendor-ark-image、compliance-launch-and-observability、refund-and-production-guard、commercial-readiness-2026-10-25）。

## 协作约定

- Trunk-based：`main` 始终可发布；PR 必须 CI 绿（lint/typecheck/test/build）；
- **契约/表结构/模型目录变更必须同 PR 更新 `docs/02-architecture/`**（见 [dev-workflow](docs/04-engineering/dev-workflow.md)）；
- 密钥只走 CI Secrets/服务器 env；`.env.example` 仅占位（见 [security](docs/06-security-compliance/security.md) §6）；
- 原始抓包、Chrome profile、`node_modules`、agent hook 状态不入库。
