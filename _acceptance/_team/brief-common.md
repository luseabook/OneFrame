# 团队协作共同约定（Lead 维护，所有 teammate 必读）

> 目标：按 `docs/07-plan/completion-plan-to-100.md` 的批次，把 OneFrame 对 ReelMate 的实现进度从 35.4%（首发口径 54.4%）推向 100%。
> 执行标准：ADR-013「竞品怎么做我们就怎么做」——**有证据就照做，无证据不臆造并登记待取证**。

## 1. 仓库与命令

- 工作区根：`E:\wanxing`；代码在 `E:\wanxing\app`（pnpm + turbo 模块化单体）。
- 包：`apps/api`(NestJS) · `apps/worker`(BullMQ) · `apps/web`(Nuxt3) · `packages/{shared,db,storage,model-adapters}`。
- 本机 dev 依赖已就绪：Postgres `postgres://app:app@127.0.0.1:55432/app`（`DATABASE_URL` 已可用）。
- 常用命令（在 `E:\wanxing\app`）：
  - 单包 typecheck：`pnpm --filter @app/api typecheck`（web：`@app/web`）
  - 单包 lint：`pnpm --filter @app/api lint`
  - 跑指定测试：`cd apps/api; npx vitest run test/<your>.spec.ts`
  - **不要**跑全仓 `pnpm test`（多人并行会互相干扰；最终由 Lead 统一跑）
  - **不要**跑 `db:generate` / `db:migrate`（迁移由 Lead 独占；你需要新表就在回报里提）

## 2. 后端模块写法（照 `apps/api/src/modules/kds/` 抄）

- 结构：`<域>.controller.ts`（路由 + 参数校验 + 权限前置）/ `<域>.service.ts`（业务 + SQL）/ `<域>.module.ts`（`@Module({controllers, providers, exports})`）。
- 路由前缀：`@Controller("<域>")`，最终路径是 `/v1/<域>/...`（ADR-009 保留竞品域名划分，便于 1:1 核对）。
- 响应：**不要手写信封**，返回裸 data 即可；`EnvelopeInterceptor` 包成 `{code:0,data}`。
- 错误：抛 `new AppError(ErrorCode.XXX, "msg")`（`@app/shared`），由 `AllExceptionsFilter` 转成 HTTP 200 + `code≠0`（或 401/403）。
- 参数：`parseOrThrow(zodSchema, input)`（`src/common/zod`）；解析器要宽容（可空/可缺），LLM 输出 schema 另写一套强约束。
- 鉴权：`req.auth`（`AuthedRequest`）+ 业务内 `requireMember(spaceId, userId)`；跨 space 一律 403。
- DB：`import { db } from "../../db/database"`（测试里用 `createDb`），drizzle schema 在 `@app/db`；写库走 service，事务用 `db.transaction`。
- 新表**已由 Lead 建好**（`packages/db/src/schema.ts` + `drizzle/00xx_*.sql`）；不要自己改 schema.ts。

## 3. 测试写法（照 `apps/api/test/kds.spec.ts` 抄）

- e2e 风格：`NestFactory.create(AppModule, new FastifyAdapter())` + `app.inject({url:'/v1/...'})`，断言 `code===0` 与 `data`。
- 每个新端点至少覆盖：**成功路径 / 权限拒绝(403) / 参数校验 / 幂等或重放**（按端点语义取 3~4 条）。
- 造数据用随机后缀（`Date.now()`）避免与其它测试冲突；`afterAll` 清理自己造的行。
- 用例注释要写清**为什么这么断言**（不是复述代码）。

## 4. 前端页面写法（照 `apps/web/pages/reelflow/list.vue`、`pages/team/dashboard.vue` 抄）

- Nuxt3 文件路由；登录后才可用的页面必须三件套齐全：
  1. `definePageMeta({ layout: "app", middleware: ..., ssr: false })`（看同类页）
  2. `nuxt.config.ts` 的 `routeRules` 里加 `"/<path>": { ssr: false }`（**Lead 统一加**，你在回报里写清需要的路由）
  3. `layouts/app.vue` 侧栏入口（**Lead 统一改**，不要动 `layouts/app.vue`）
- 请求统一走 `useApi()`；金额/积分用现有格式化工具；不新造设计令牌，用 `assets/css/tokens.css` 的层二令牌。
- 空态/加载态/错误态三态都要有；不允许把按钮做成「点了没反应」。

## 5. 文件所有权（硬约束）

- **只改你任务里写明的路径**。公共文件（`app.module.ts`、`layouts/app.vue`、`nuxt.config.ts`、`packages/db/src/schema.ts`、`packages/shared/src/index.ts`、`docs/**`、`packages/shared/src/constants.ts`）**默认不动**：
  - `app.module.ts` 例外：你的模块要在 e2e 里能跑，**允许你加两行**（import + imports 数组），锚点用 `KdsModule` 那两行，读完再改，碰撞（FS_STALE_VERSION）就重读重试。
  - 其余公共文件改动写进回报，由 Lead 做。
- 你**拥有**的文件要写干净：不留 `console.log`、不留 TODO 空实现、不留被注释掉的死代码。
- 不修改别人的 spec/页面；发现别人代码有 bug，写进回报，不要顺手改。

## 6. 证据与诚实

- 每个交付项在回报里给出**竞品证据引用**：`docs/01-product/reelmate-feature-map.md:行` / `_parts/d-*.md:行` / `reelmate-routes`（`rea-reelmate/routes.txt` 行号）/ `_acceptance/_gap/*.md:行`。
- 竞品行为**未取证**的：实现「我方合理语义 + 在回报里登记待取证」，不要编造参数名。
- 不允许"看起来像完成了"：端点必须有 spec，页面必须能真实点击（至少 E2E 脚本或人工 URL 验证记录）。
- 若发现竞品无此能力/我方不适用：明确写「不适用 + 理由」，不要为凑覆盖造假。

## 7. 回报格式（send_message 给 lead，末尾必须完整）

```
## 交付
- 端点：<方法 路径>…（数量）
- 页面：<路由>…
- 测试：<spec 文件> N 例；实测结果（贴关键输出行）
## 证据
- <竞品行为> ← <文件:行>
## 已知偏离 / 待取证
- …
## 需要 Lead 做
- 路由/侧栏/迁移/共享文件改动
## 未完成
- 本批还剩什么（诚实列出）
```
