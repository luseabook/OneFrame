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

### 4.1 质量门禁的适用范围（铁律 1「pnpm test && pnpm build」的例外条款）

**判据不是「改了哪类文件」，而是「是否可能改变可构建产物、运行时行为、契约或数据」**。
据此分两类：

| 变更类型 | 是否跑全量 `pnpm test && pnpm build` | 必须做的最小验证 |
|---|---|---|
| 任何 `.ts/.vue/.json`（含 `package.json`、`drizzle/*.sql`、i18n 语言包） | **必须**（CI 同口径 lint/typecheck/test/build 全绿） | — |
| `app/deploy/**` 下新增或修改的 `.sh` / `.template` / `README.md` | **可豁免**，但须同时满足 4 条豁免条件 | ① `bash -n` 或 `shellcheck` 通过；② 模板用真实参数渲染后与现有配置 diff（差异只能是格式）；③ 交付物含「现象→根因→处置」对照表；④ PR 描述贴出上述命令输出 |

**豁免四条件（缺一不可，任一不满足即回到全量门禁）**：

1. 不 import / 不 require 任何 workspace TS 包，不改 `package.json`、不改 `tsconfig`；
2. 不改 `drizzle/*.sql` 与 `schema.ts`（迁移只增不改，见铁律 3）；
3. 不改动运行期契约：端口、env 变量名、端点、错误码一律在文档侧先改再动脚本；
4. 脚本本身会被真实执行（部署/回滚/迁移），因此**必须**有 dry-run 或在无生产端口上重放过的证据。

**为什么给这个豁免**：纯 shell 部署脚本跑一遍全量测试与构建约 4 分钟，而它连一行 TS 都不碰——
这份时间买到的是零信息。但「不跑 CI」不等于「不验证」：脚本会以 root 动 systemd 与 nginx，
验证强度必须比单元测试更高，所以用「语法 + 渲染 diff + 重放证据」替代。

**`test` 脚本不许是桩（2026-11-03 新增）**：`echo … && exit 0` 这类恒真桩必须清零。
桩的害处不是“少测了”，而是**聚合数字变得不可信**：`@app/web` 长期以恒真桩参与 `turbo run test`，
于是「12/12 任务通过」里有一个任务什么都没验。`apps/web` 已改为真跑 `vitest run server/**/*.spec.ts`；
**新包若暂时无用例，`test` 必须显式失败或干脆不声明该脚本，不允许静默恒真**。

**反例（明确不免）**：改了 `apps/web/.env.example`（属 `.env*` 但影响部署可发现性）、
改了 `nuxt.config.ts`、改了 `_acceptance/*.cjs`（门禁脚本本身）—— 这些都要走全量。

### 4.2 判据缺陷的三种形态（2026-11-03 汇总，已出现 4 次）

这类缺陷的共同点：**代码正确、类型正确、单测全绿，只有拿真实/异常输入去撞才暴露**。
项目里已经撞到 4 次，形态只有三种，每种都有对应的硬约束：

| 形态 | 表现 | 实例 | 硬约束（写进代码，不靠记性） |
|---|---|---|---|
| **① 太宽** | 判据只校验“像”，坏值能通过 | `LOG-04` 只看响应头，陌生进程的 404 也 PASS；`PAGE-07` 空串不报错；`08` 的 `!= "000"` 放过 `000000` | 按**形状**整串锚定，并对每类坏值留一条反例测试 |
| **② 静默** | 判据不满足时既不报错也不阻断，只是“跳过/降级” | `icp-guard` 空串整段不渲染；`--runtime-only` 若无声降级就变成假绿 | 降级必须打印原因与范围；SKIP ≠ PASS，输出里分开计数 |
| **③ 语义反转** | 判据方向写反，**该失败的地方报成功** | `restore-env.sh` 首版把 `cur == after` 判成“已回滚”，回滚什么都不做却报成功 | 关键操作的**后置断言**：恢复后必须 `sha256 == before`，不等即 die |

**两种通用做法（比“想清楚”可靠）**：

1. **正反两面都拿真实值撞**：只撞坏值会矫枉过正（ICP 号曾因带空格被误拦——备案系统页面就是这么显示的），
   只撞好值会放过假号（`TEST-京ICP备…`）。两边都撞过，判据才算定下来。
3. **内部包的 `dist` 也是产物**（2026-11-03，第五个同族实例，唯一跨包边界）：`packages/db` 的 `dist` 陈旧时，
   `episodes.llm_mock` 在映射层被静默丢掉，manifest 恒为 `false`，而报错只说“期望 true 实得 false”，**完全不指向包**。
   规则：单跑子包 spec 前先 `pnpm --filter @app/db build`；部署清单必须包含内部包产物，判据用 sha256 双向核对，不用时间戳。

4. **断言红了先怀疑夹具，再怀疑被测对象**：2026-11-03 的实例——`_check-env-banner.cjs` 的 ⑤（登出后横幅消失）首轮红，
   根因是**桩** `/v1/auth/refresh` 不校验 Cookie、无条件发 token，于是“清 Cookie”后页面又登录成功。
   若直接去改前端，会把夹具的缺陷记到被测对象账上，还可能改坏本来正确的实现。
   判据：红的时候先确认夹具本身的行为是否与真实契约一致（本例真实契约是 HTTP 200 + `code:401101`）。

2. **状态机类脚本必须有后置断言**：回滚/迁移/部署这类“改变状态”的操作，唯一可信的判据是
   **操作后的状态与预期状态的哈希/行数/退出码相等**，而不是操作过程中的分支日志。

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
