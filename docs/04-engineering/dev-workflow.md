# 开发流程与规范

> v1.1 · 2026-10-24 · 假设 1~2 人小团队，流程以"轻量但防事故"为准
> v1.1 变更：PR 自检补模型目录/scene schema 契约快照（RE-05）

## 1. Git 规范

**分支模型：Trunk-based**

```
main            始终可发布(保护: PR+CI 绿+1 approve; 单人期 approve 自批但需自检清单)
feat/xxx        功能分支, 存活 ≤3 天
fix/xxx · chore/xxx
发布: main 打 tag vX.Y.Z; staging 自动部署 main
```

**提交信息：Conventional Commits**

```
feat(generations): 两阶段积分冻结结算
fix(web): 轮询页面隐藏时降频
docs(api-spec): 补充 745802 错误语义      ← 契约变更必须带 docs! 前缀并在同一 PR 改文档
refactor / test / ci / chore
BREAKING CHANGE: 脚注声明
```

## 2. PR 自检清单（合并前逐项勾）

- [ ] 类型检查/lint/测试全绿（CI）
- [ ] 改了 API/表结构 → 同 PR 已更新 api-spec.md / database.md 并 @ 对方
- [ ] 新端点带限流注解 + 鉴权测试
- [ ] 改 models 目录/`modes`/`scene_modes` 结构 → 同 PR 更新目录快照 fixtures 与契约测试（导入 46 模型子集）
- [ ] 涉及计费路径 → 附本地对账脚本输出（冻结/结算/解冻三态余额一致）
- [ ] 无密钥/内网地址/调试日志残留
- [ ] 错误文案走映射表（不硬编码中文在组件里）

## 3. 代码规范（自动强制）

| 工具 | 范围 |
|---|---|
| ESLint(flat) + @typescript-eslint + vue/eslint | 全部 TS/Vue |
| Prettier | 格式（CI 校验 `--check`） |
| knip | 未用导出检测 |
| husky + lint-staged | 提交前跑 lint/format/typecheck |

命名：TS camelCase / Vue PascalCase / 文件 kebab-case(页面)·PascalCase(组件)；API 路径 kebab-case。
注释：只写"为什么"与约束，不复述代码（与团队既有习惯一致）。

## 4. CI/CD（GitHub Actions）

```
PR:  lint → typecheck → unit → integration(含契约测试) → build → bundle-size 检查(超预算+5% 报警)
main: 同上 + 部署 staging → 冒烟(核心 5 接口) → 手动批准 → 部署 prod(蓝绿: 双容器切流)
```

镜像版本 = git sha；生产回滚 = 切回上一镜像（≤2min）。

## 5. 环境与配置

- 环境变量集中 `apps/*/src/config.ts` + `zod` 校验启动失败即报错；
- `.env.example` 全量登记（见 deployment.md §4）；密钥只进 CI Secrets/服务器 env，**永不入库**；
- 本地开发：docker-compose 起 PG/Redis/OSS(MinIO)；供应商适配器默认 mock 模式（fixtures 回放）。

## 6. 发布节奏

- 每日 main 可发布；每周四固定发布窗（变更日志自动从 conventional commits 生成 CHANGELOG.md）；
- 数据库迁移先于代码部署（向后兼容写法：先加列后用列，两段式 PR）；
- 热修：fix 分支 cherry-pick → tag patch → 同流程。

## 7. on-call 与事故（MVP 极简）

- Sentry + 告警通道（企业微信机器人）→ 值班手机；
- 事故响应：止血(回滚/降级开关) > 修复 > 复盘（≥P1 事故 48h 内补文档到 05-ops/）。
