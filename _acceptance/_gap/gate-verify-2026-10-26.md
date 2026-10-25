# 门禁实测报告 — 裸跑（gate-verify-2026-10-26）

- **采样时间**：2026-10-26 00:31 – 00:38 (+08:00 / Asia/Shanghai)
- **HEAD**：`8e25f53` commit time `2026-10-25T22:21:22+08:00`，分支 `main`（`git log -1 --format=%h %cI`）
- **node**：v24.19.0 ／ **pnpm**：10.33.2 ／ **turbo**：2.11.10 ／ **vitest**：2.1.9
- **工作目录**：`E:\wanxing\app`
- **未改动任何源码/配置；未执行 pnpm install；未触碰 3000/3001 上已在运行的 dev 服务。**

---

## 1. 汇总表

| # | 命令 | 次数 | EXIT | Test Files / Tests 计数 | 结论 |
|---|---|---|---|---|---|
| 1 | `pnpm -w lint` | 1 | **0** | 6/6 tasks successful（**6 cached → FULL TURBO**） | 绿，但为 turbo 缓存回放 |
| 2 | `pnpm -w typecheck` | 1 | **0** | 10/10 tasks successful（**10 cached → FULL TURBO**） | 绿，但为 turbo 缓存回放 |
| 3 | `pnpm -w test`（裸跑，无 env） | **3** | **1 / 1 / 1** | 全仓 45 文件 = 30 passed / 14 failed / 1 skipped；384 用例 = 247 passed / 137 skipped / **0 failed(用例级)** | **裸跑红**，3/3 完全一致，**无抖动** |
| 3a | └ `@app/api` | 3 | 1/1/1 | `Test Files 14 failed \| 11 passed (25)`；`Tests 98 passed \| 136 skipped (234)`；`Errors 36 errors` | 红：14 个 suite 加载即崩 |
| 4 | `pnpm --filter @app/api exec vitest run test/billing.spec.ts` | 1 | **1** | `Test Files 1 failed (1)`；`Tests 8 skipped (8)` | 红，首行错误见 §4 |
| 5 | `env.ts` 默认值 grep | 1 | — | 见 §5 | 默认指向 5432/6379 |
| 6 | `Get-NetTCPConnection -State Listen` | 1 | — | 见 §6 | 实际监听 **55432/6380**，无 5432/6379 |

**根因一句话**：`apps/api` 的 14 个 e2e suite 在 `beforeAll` 里连 `localhost:5432`(PG) / `localhost:6379`(Redis)，而本机项目实例跑在 **55432 / 6380**，裸跑时连接被拒 → 14 个 suite 整体失败、136 个用例被 skip。**这不是断言失败，是环境不可达。**

### 三态判定（按验收口径显式区分）

| 判定项 | 实测结论 |
|---|---|
| **裸跑红？** | **是。** lint/typecheck 绿；`pnpm -w test` 3 次均 EXIT=1。 |
| **是否抖动？** | **否。** 同一命令连跑 3 次，EXIT、失败文件集合（14 个）、计数（25/14/11、234/98/136）逐次完全相同。 |
| **注入 env 后结果？** | **本次未做，不得判定为绿灯。** 未在任何一次运行中注入 `DATABASE_URL`/`REDIS_URL`；「注入后大概能过」无实测支持。 |

---

## 2. 原始输出关键片段 — `pnpm -w lint`（EXIT=0）

```
@app/storage:lint: cache hit, replaying logs 665a829f479e2d01
@app/shared:lint: cache hit, replaying logs d6c982e12e59a61e
@app/worker:lint: cache hit, replaying logs d528ea70e38abc98
@app/api:lint: cache hit, replaying logs 2c10e97ce814430e
@app/shared:lint: > eslint src
 Tasks:    6 successful, 6 total
Cached:    6 cached, 6 total
  Time:    33ms >>> FULL TURBO
EXIT=0
```

> 注：7 个包在 scope 内，但 `apps/web` 的 `package.json` **没有 lint 脚本**（scripts 仅 dev/build/generate/postinstall/test），故只有 6 个 lint task。33ms 全缓存，**本次未在新进程里真正重跑 eslint**。

## 3. 原始输出关键片段 — `pnpm -w test` 裸跑（RUN1，EXIT=1，33s）

```
@app/shared:test:   Test Files  2 passed (2)
@app/storage:test:  Test Files  2 passed | 1 skipped (3)
@app/model-adapters:test: Test Files  7 passed (7)
@app/db:test:       Test Files  1 passed (1)
@app/worker:test:   Test Files  7 passed (7)
@app/api:test:  Test Files  14 failed | 11 passed (25)
@app/api:test:       Tests  98 passed | 136 skipped (234)
@app/api:test:      Errors  36 errors
@app/api:test:    Duration  31.14s (transform 649ms, setup 0ms, collect 17.45s, tests 7.69s ...)
 Tasks:    10 successful, 11 total
Cached:    10 cached, 11 total
 Time:    32.31s
Failed:    @app/api#test
 ERROR  run failed: command  exited (1)
```

**失败文件全集（14，RUN2 去重后，3 次一致）**：

```
test/admin.spec.ts                    [ test/admin.spec.ts ]
test/assets.spec.ts                   [ test/assets.spec.ts ]
test/billing.spec.ts > billing (e2e)
test/files.spec.ts                    [ test/files.spec.ts ]
test/flow.spec.ts                     [ test/flow.spec.ts ]
test/observability.spec.ts            [ test/observability.spec.ts ]
test/pipeline.spec.ts                 [ test/pipeline.spec.ts ]
test/project-assets-extract.spec.ts   [ ... ]
test/project-assets-image.spec.ts     [ ... ]
test/project-assets.spec.ts           [ ... ]
test/refunds.spec.ts > refund flow (mock channel)
test/storyboard-frames.spec.ts        [ ... ]
test/storyboard-modes.spec.ts         [ ... ]
test/timeline.spec.ts                 [ test/timeline.spec.ts ]
```

**逐次运行对比（无抖动证据）**：

| 次数 | EXIT | 耗时 | api Test Files | api Tests | api Errors | Failed 文件数 |
|---|---|---|---|---|---|---|
| RUN1 | 1 | 33s | 14 failed / 11 passed (25) | 98 passed / 136 skipped (234) | 36 | 14 |
| RUN2 | 1 | 34s | 14 failed / 11 passed (25) | （同构，见 RUN3） | — | 14 |
| RUN3 | 1 | 33s | 14 failed / 11 passed (25) | 98 passed / 136 skipped (234) | — | 14 |

**报错关键行（3 次均出现，无变化）**：

```
stack: 'AggregateError: \n' +
    stack: 'Error: connect ECONNREFUSED ::1:5432\n' +
    message: 'connect ECONNREFUSED ::1:5432',
    code: 'ECONNREFUSED',
    stack: 'Error: connect ECONNREFUSED 127.0.0.1:5432\n' +
    message: 'connect ECONNREFUSED 127.0.0.1:5432',
Serialized Error: { errors: [ { message: 'connect ECONNREFUSED ::1:6379', address: '::1', port: 6379,
  ... { message: 'connect ECONNREFUSED 127.0.0.1:6379', address: '127.0.0.1', port: 6379 } ], code: 'ECONNREFUSED' }
This error originated in "test/files.spec.ts" test file.
```

11 个通过的 api 文件为纯单测（`client-ip` / `script-parser` / `env` / `env-production-guard` / `payment-signature` / `channels-*` / `billing-notify*` / `refunds-wechat`），不依赖 PG/Redis。

## 4. 原始输出关键片段 — 单文件复跑（EXIT=1，3s）

命令：`pnpm --filter @app/api exec vitest run test/billing.spec.ts`

```
 RUN  v2.1.9 E:/wanxing/app/apps/api
 ❯ test/billing.spec.ts (8 tests | 8 skipped) 14ms

⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯
 FAIL  test/billing.spec.ts > billing (e2e)
{
  stack: 'AggregateError: \n' +
    '    at E:\wanxing\app\node_modules\.pnpm\pg-pool@3.14.0_pg@8.23.1\node_modules\pg-pool\index.js:45:11\n' +
    '    at E:\wanxing\app\apps\api\test\billing.spec.ts:45:22\n' +
  errors: [
    { stack: 'Error: connect ECONNREFUSED ::1:5432\n' + ...
      message: 'connect ECONNREFUSED ::1:5432',
      errno: -4078, code: 'ECONNREFUSED', syscall: 'connect', address: '::1',
 Test Files  1 failed (1)
      Tests  8 skipped (8)
```

- **EXIT = 1**
- **错误首行**：`Error: connect ECONNREFUSED ::1:5432`（PG，非 Redis；Redis 6379 在同批 errors 中亦被拒）
- 抛出点：`apps/api/test/billing.spec.ts:45:22`（suite 级 hook），8 个用例全部 skip

## 5. `apps/api/src/config/env.ts` 默认值（实测原文）

> 文件：`app/apps/api/src/config/env.ts`

| 行号 | 原文 |
|---|---|
| **23** | `  DATABASE_URL: z.string().default("postgres://app:app@localhost:5432/app"),` |
| **24** | `  REDIS_URL: z.string().default("redis://localhost:6379"),` |

上下文（第 20–25 行）：`const envSchema = z.object({ ... })`，第 19 行注释「配置层：启动即校验，缺失/非法直接崩」——**无 env 注入时默认值必然生效**，即裸跑测试指向 5432/6379。

## 6. 实际监听端口（`Get-NetTCPConnection -State Listen`）

```
LocalAddress LocalPort OwningProcess
0.0.0.0           3000          7692
127.0.0.1         3001         25352
::                6380         30544
0.0.0.0           6380         30544
127.0.0.1        55432         32656
```

| 服务 | 代码默认值（env.ts） | 实际监听 | 是否一致 |
|---|---|---|---|
| PostgreSQL | `localhost:5432` | `127.0.0.1:55432` | **❌ 不一致** |
| Redis | `localhost:6379` | `0.0.0.0/::  :6380` | **❌ 不一致** |
| dev 服务 | `PORT` 默认 3000 | `3000`（pid 7692）、`3001`（pid 25352） | 一致/未触碰 |

**5432 与 6379 无任何监听项** —— 与 §3/§4 的 `ECONNREFUSED ::1:5432` / `::1:6379` 互为闭环证据。

---

## 7. 本次无法验证的

1. **注入 env 后的结果未测**：未用 `DATABASE_URL=postgres://...:55432/...`、`REDIS_URL=redis://localhost:6380` 复跑 api 测试。因此「14 个失败 suite 是否全绿」**在本报告中无结论**，不得记为通过。
2. **CI 上的结果无法验证**：无 CI 配置读取/触发，本报告只覆盖本机 HEAD 裸跑。
3. **lint / typecheck 未做无缓存复跑**：两次都是 `>>> FULL TURBO`，全部 `cache hit, replaying logs`（lint 33ms / typecheck 99ms）。只能证明 turbo 缓存条目与当前 HEAD 的 hash 匹配，**未在新进程里真正执行 eslint / tsc**；`--force` 复跑本次未做。
4. **`@app/web` 无门禁覆盖**：`apps/web/package.json` 无 `lint`/`typecheck` 脚本，其 `test` 是 `echo 'web e2e lands in P2' && exit 0`（恒真占位）。故「7 packages in scope」实际只有 6 个 lint、6 个 typecheck、6 个真实 test。
5. **PG/Redis 是否本应由 docker compose 另起、以及容器是否在跑**：未检查 compose 文件与容器状态。
6. **未验证 `_acceptance/_gap/` 其他文件的既有结论**：本报告只陈述本次实测。
7. **超时情况**：无。全部命令均在 20 分钟内结束（最长 34s）。
