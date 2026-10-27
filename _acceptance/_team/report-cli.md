# 第 7 批：CLI/MCP 外延 —— 交付回报

> 任务：`task-7`（权重 8）。工作区 `E:\wanxing`，代码 `E:\wanxing\app`。
> 契约来源：`_acceptance/_gap/cli-skill/reelmate-cli-skill/`（竞品 CLI + Skill 全部一手证据）。

## 交付

- **新包**：`app/apps/cli`（TS + tsc，零运行时依赖，Node 内置 fetch）
  - `src/registry.ts`：**196 条命令 / 37 组**声明式注册表，每条带竞品证据 `文件:行`
  - `src/cli.ts` 主流程 · `src/exit-codes.ts` 退出码映射表 · `src/http.ts` 信封解包 ·
    `src/resolve.ts` 输入→请求 · `src/builtins.ts` 纯客户端命令 · `src/ledger.ts` 幂等账本 ·
    `src/deeplinks.ts` · `src/redact.ts` · `src/render.ts` · `src/help.ts`
- **端点（服务端新增 1 个）**：`GET /v1/workflow/detect?scope=studio|canvas&project_id=&canvas_id=`
  - `app/apps/api/src/modules/workflow/{workflow.module,workflow.controller,workflow.service}.ts`
  - 只读（零 INSERT/UPDATE/DELETE），已按锚点 `KdsModule` 注册进 `app.module.ts`
- **测试**
  - `apps/cli` 10 个 spec / **83 例全绿**（要求 ≥15 例）
  - `apps/api/test/workflow.spec.ts` **12 例全绿**
- **文档**：`apps/cli/README.md`（含 10 条已知偏离 + 待取证清单）

### 实测输出（贴关键行）

```
$ pnpm --filter @app/cli build
> @app/cli@0.1.0 build E:\wanxing\app\apps\cli
> tsc -p tsconfig.json                              ← 0 错

$ cd apps/cli; npx vitest run
 Test Files  10 passed (10)
      Tests  83 passed (83)

$ cd apps/api; npx vitest run test/workflow.spec.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)

$ cd apps/api; npx tsc --noEmit | Select-String 'workflow'    ← 无输出（本模块 0 错）
```

手工冒烟（对本机真实 API，`http://127.0.0.1:3002/v1`；API 已在跑）：

```
$ node apps/cli/dist/index.js --help
oneframe 0.1.0 —— OneFrame CLI（API 的薄壳，不新增业务逻辑）
…
退出码（manual/error-codes.md:5-19）：
  0 成功 · 1 一般失败 · 2 参数错 · 3 鉴权 · 4 任务失败 · 5 任务取消
  6 等待超时 · 7 积分不足 · 8 审核未通过 · 9 画布版本冲突 · 10 节点锁竞争

$ node apps/cli/dist/index.js login --phone 139xxxxxxxx --json
{"ok":true,"data":{"step":"sms_sent","phone":"139****4373","debug_code":"740879","next":"…"},"links":{}}

$ node apps/cli/dist/index.js login --phone 139xxxxxxxx --code 740879 --json
{"ok":true,"data":{"uid":"108357176568709120","space_id":"108357176568709121","credential_store":"file"},"links":{}}
EXIT=0

$ node apps/cli/dist/index.js model list --json
{"ok":true,"data":[{"name":"seedance-2.5","display_name":"Seedance 2.5",…}]}     ← 61 个模型，stdout 纯 JSON
（stderr 同时给进度与人读表格：`→ GET /models` + NAME/DISPLAY_NAME/VENDOR/… 表）

$ node apps/cli/dist/index.js credits balance --json
{"ok":true,"data":{"balance":80,"frozen":0},"links":{}}

$ node apps/cli/dist/index.js task list --json            # 空 config 目录（未登录）
{"ok":false,"error":{"kind":"auth","message":"未登录：请先运行 `oneframe login`"}}
EXIT=3
```

**诚实说明**：`workflow detect` 对这台机器上**已在跑的 3002 进程**返回 `404`——
该进程是本批改动之前启动的旧实例，没有 `WorkflowModule`（未重启）。
服务端判定已由 `test/workflow.spec.ts` 用**完整 AppModule**（12 例）验证通过，
重启 dev API 后即可用；这不是代码缺陷，但没有在旧进程上「跑通即报绿」。

## 证据（逐组）

退出码 / envelope / 流分工（**核心契约**）

- 0..10 退出码全套、未知错误与 Ctrl-C 规则 ← `manual/error-codes.md:5-19`
- 权限 `kind=permission` 属退出码 **1**（不是 3）← `manual/error-codes.md:21`
- 日志/JSON 不得出现 token/cookie/密码 ← `manual/error-codes.md:23`
- stdout `{ok:true,data,links}` / `{ok:false,error}`、进度走 stderr ← `SKILL.md:43`
- envelope 失败形状 + `--dry-run` + 唯一 `--idempotency-key` ← `manual/workflow/_stage-machine.md:99-105`

命令组（可用组逐条）

| 组 | 证据 |
|---|---|
| login / logout | `commands/login.md:20,56-63,70`；`commands/logout.md:19,43` |
| account | `commands/account.md:19,38,47` |
| env / cache / version | `commands/env.md:17`；`commands/cache.md:19,39,44`；`commands/version.md:19,39,43` |
| workflow | `commands/workflow.md:23,45,61,82,94,96,116-131,154,157`；`manual/workflow/_stage-machine.md:15,30,32,34-40,56,62-68,97` |
| model | `commands/model.md:24,33,71,92,115,140,146-148` |
| task | `commands/task.md:31,52,58,76,85,99,121,143,165,195,217-221` |
| credits | `commands/credits.md:23,43,64,68,96,107,153-157` |
| workspace | `commands/workspace.md:29,58,82,106,128,149,171,193-194` |
| episode | `commands/episode.md:57,78,94,110,126,142,160,176,195,211,261,368,389,407,429` |
| storyboard | `commands/storyboard.md:61,77,93,111,137,153,170,186,202,220,236,263,281,302,331,350,367,389,411` |
| upload | `commands/upload.md:17` |
| resource | `commands/resource.md:190,341,536`（骨架条目 :145,163,223,255,317,359,406,422,570,586,602） |
| asset-lib / file | `commands/asset-lib.md:57,105,153,169`（骨架 :41,121,137,185,201,249,281,297,313）；`commands/file.md:21,43,65` |
| canvas | `commands/canvas.md:33,56,78,100,122,144,165,185,202` |
| node / edge | `commands/node.md:35,161,188,210,233,264,287,386,408`；`commands/edge.md:8` |
| group / pin-group | `commands/group.md:27,53,86,110,136,157`；`commands/pin-group.md:19,42` |
| material / script | `commands/material.md:26,39,86,113,131,149,167`；`commands/script.md:41,64,80,96,112,128` |
| export | `commands/export.md:23,45,70,86` |
| deeplink | `commands/deeplink.md:4,37,62,84,105,107,124,132,148,170,188,208,225,242,246` |
| ledger | `commands/ledger.md:5-16,34,58,76,85-87,106-114` |
| team | `commands/team.md:19,41` |
| agent | `commands/agent.md:27,50,71,93,135` |

阶段机（服务端 `GET /workflow/detect`）

- 5 阶段顺序、`stage`=第一个未完成 ← `manual/workflow/_stage-machine.md:30`
- studio 只认工坊侧（`canvas_id` 空/"0"），画布剧集不算 script/storyboard ← `_stage-machine.md:32`
- 五阶段完成条件（每集非空 / 定稿资产 status=2 / render 不判定）← `_stage-machine.md:34-40`
- 缺项回引 `missing[].goto_stage` ← `_stage-machine.md:62-68`、`commands/workflow.md:131-139`
- 画布从 `node_list` 判：text / asset·image / script·table ← `_stage-machine.md:56`
- 探测只发只读请求、缺项不是错误路径（退出码 0）← `_stage-machine.md:15`、`commands/workflow.md:96,154`

## 已实现

1. **envelope 与流分工**：stdout 永远单个 envelope（`--json` 单行 / 默认缩进），
   进度、表格、warn 全走 stderr；`--json` 时 stderr 静默。单测 + 真机双验证。
2. **退出码 0..10**：`BUSINESS_CODE_MAP`（业务码→kind→exit）+ `KIND_EXIT` + `mapHttpStatus`
   一张表；`test/exit-codes.spec.ts` 18 组逐条断言 + 权限=1 + 未知码不静默成功。
3. **`--dry-run`**：写命令只输出 `{dry_run,method,path,url,query,body,idempotency_key,credits_estimate}`，
   退出 0，**零请求**（单测用「被调用即记录」的 transport 证明）。
4. **`--idempotency-key`**：透传 `Idempotency-Key` 头 + 本地三态账本
   （applied 重放短路 / pending·in_doubt 拒绝 / `--force-replay` 放行一次）。
5. **`workflow detect/status/resume`**：服务端只读判定 + 客户端本地记录（`--name`）、
   `--from` 早校验（非法不发请求）、远端前进时给 warning 不回退。
6. **配置与会话**：login（手机号验证码两步 / `--token-file` 文件或 stdin）、logout、
   account info/use、env info、cache info/clear、version/version check。
7. **与现有 API 1:1 的组**：model / task（含客户端 wait 轮询）/ credits / workspace /
   episode / storyboard / upload / resource（7 条，含抽取链）/ subject（7 条）/ asset-lib（4 条）/ canvas（10 条）/
   node（10 条）/ group·pin-group（7 条）/ material·script（9 条）/ export / deeplink（11 条）/
   ledger（3 条）/ team / agent（3 条）。
8. **凭据不外泄**：`~/.oneframe/config.json` 0600 语义 + 原子写；`redact.ts` 递归脱敏
   （token/cookie/password/secret + 预签名 URL 参数）；`env info`/`account info`/`error.raw` 全部过脱敏。
9. **`--help` 三级**（顶层/组/单条），骨架标 `[骨架]` + 未落地原因。

## 骨架（依赖批次未落地 / 我方无端点）

共 **78 条**，执行时返回 `kind=unsupported`（退出 1）+ 明确原因，**不伪造成功**；
`test/help.spec.ts` 断言「每条骨架必须有非占位 reason」。

| 组 | 条数 | 阻塞点 |
|---|---:|---|
| episode | 10 | 删除/批量建集/拆集列表·删除/模板目录/`match-resources`/`parse` 全家（asset-core 并行中） |
| storyboard | 13 | 单条增删/重排/草稿/ext/跨集全量/xlsx 模板·回读（草稿与模板批次） |
| resource | 9 | asset-core 的 generate/confirm 族与 xlsx 模板 |
| subject | 3 | `from-resource`（type+confirm 流程）与 `reset`/`batch-details` |
| novel | 6 | novel 批次（`packages/db` 有表，`apps/api` 无模块） |
| market / ad / redraw / ai / clip / voice / sync-fm | 14 | 后续批次 / 外部集成 |
| asset-lib | 8 | 目录改删、`GET /assets/:id`、搜索、标签、移动、批量删、官方库 |
| file | 3 | 元数据/对象/独立 sign-url 端点不存在 |
| model.price / credits.log / task.delete / task.regenerate / export.download / group.execute / material 3 条 / agent 2 条 | 12 | 我方确实没有对应端点（逐条原因见 `registry.ts`） |

## 未做（诚实列出）

1. **MCP server：0 行代码**。竞品只有宣传口径、**没有工具清单**（`SKILL.md` 与 `manual/` 无 MCP 页），
   按 ADR-013「无证据不臆造」本批不实现，已在 CLI `--help` 末尾与 README 登记「待取证」。
2. **服务端幂等重放中间件**：`idempotency_records` 表在 `packages/db/src/schema.ts:342`，
   但 `apps/api` 里**没有任何代码读写它**（grep `idempotency` 无命中）。CLI 只透传头，
   服务端「同键去重/返回上次结果」需要另派单——**不在本批写权限内**（`src/common/**` 非我所有）。
3. **`task download` 不落盘**：只返回下载信息（`POST /tasks/batch-download`），本地写文件未做。
4. **浏览器 handoff 登录**未做（只做 `--phone/--code`、`--token-file`）。
5. **`upload` 不把解析结果写回项目**（只调 `POST /projects/parse-script`）。
6. **`version check` 无法真实探测**（我方无发布源清单端点），输出 `source:"unavailable"`。
7. **`ledger --no-idempotency-guard`** 未实现（`--force-replay` 已实现）。
8. **真机 API 上 `workflow detect` 未跑通**：3002 是旧进程（见上文「诚实说明」），需重启后验证。

## 过程中变化（诚实记录）

任务描述说 `subject` / `resource` 抽取链「并行中，先放骨架」。但在本批收尾时，
队友的 `SubjectsModule`（`subjects.controller.ts`，7 端点，注释逐条标注竞品 subject 子命令）
与 `ExtractionModule`（`extraction.controller.ts`，注释标注 `resource.md:536-727`）已经注册进
`app.module.ts`。按「有端点就接」，我把它们接进了 CLI：

- `subject`：list / get / create / edit / delete / status / save-from-resource（7 条）；
- `resource`：extract / extract-status / extract-redo / draft-list / draft-import（+ 原 list / generate-list）。

于是骨架 81 → **78 条**、可用 107 → **118 条**。两条新偏离已写进 README：
`resource extract-status` 的任务 ID 用位置参数/`--task-id`（竞品是 `--set et_id`）、
`resource extract` 落到 `POST /extraction/tasks`。
**风险提示**：这两个模块是队友在途产出，若后续路径/入参改名，这 12 条映射需同步。

## 需要 Lead 做

1. **`pnpm-lock.yaml` 变更**：`apps/cli` 是新 workspace 包，我执行了
   `pnpm install --filter @app/cli`（只链接该包 devDeps：@types/node / typescript / tsx / vitest），
   结果 `app/pnpm-lock.yaml` 多了一段 `apps/cli` 的 importer。**workspace glob 无需改**
   （`apps/*` 已覆盖）。请复核该 lockfile diff 是否并入。
2. **重启本机 dev API**（3002），让 `WorkflowModule` 生效，然后复跑：
   `node apps/cli/dist/index.js workflow detect --json`
3. **服务端幂等重放**（若要落地）：需要 `src/common/http` 里的拦截器读 `Idempotency-Key`
   并落 `idempotency_records`——属公共文件，请派单给能改 `common/**` 的人。
4. 若要上 `pnpm test`/turbo：`apps/cli` 的 `test` 脚本是 `vitest run`（不连库不连网），
   已可并入 turbo 流水线；`build` 产出 `dist/`。

## 附：本批改动文件清单

```
新增  app/apps/cli/{package.json,tsconfig.json,vitest.config.ts,README.md}
新增  app/apps/cli/src/{index,cli,args,config,http,resolve,registry,transforms,builtins,ledger,deeplinks,redact,render,help,exit-codes,envelope,errors,runtime,version}.ts
新增  app/apps/cli/test/{helpers.ts,envelope,exit-codes,args,dry-run,idempotency,help,config,deeplink,transforms,workflow}.spec.ts
新增  app/apps/api/src/modules/workflow/{workflow.module,workflow.controller,workflow.service}.ts
新增  app/apps/api/test/workflow.spec.ts
改动  app/apps/api/src/app.module.ts（+2 行：import WorkflowModule、imports 数组，锚点 KdsModule）
改动  app/pnpm-lock.yaml（pnpm install 自动生成）
```

未执行 `git commit`。未改 schema.ts / 迁移 / docs / layouts / nuxt.config / 其它模块与 spec。
