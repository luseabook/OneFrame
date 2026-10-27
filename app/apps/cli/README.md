# @app/cli —— OneFrame CLI

对标竞品 `reelmate` CLI 的外延层：**API 的薄壳**，不新增业务逻辑。
契约来源是解包后的竞品一手证据 `_acceptance/_gap/cli-skill/reelmate-cli-skill/`
（`SKILL.md` + `manual/` + 38 篇 `commands/*.md`），每个命令在源码 `src/registry.ts`
里都带 `evidence`（`文件:行`），逐条可核。

## 用法

```bash
oneframe --help                      # 全部命令组
oneframe <组> --help                 # 组内子命令（骨架会标 [骨架] + 未落地原因）
oneframe <组> <子命令> --help         # 单条：请求方法/路径、位置参数、证据行号

oneframe model list --json
oneframe workflow detect --scope studio --workspace <PROJECT_ID> --json
oneframe workspace create demo --dry-run --json          # 只打印将发送的请求
oneframe storyboard batch-generate <EP_ID> --set ai_model_mark=MODEL \
  --workspace <PROJECT_ID> --idempotency-key hlm-1 --json
```

本地开发（未编译时）：`npx tsx src/index.ts --help`；构建后 `node dist/index.js --help`。

## 三条硬契约

### 1. stdout 只出 envelope，进度走 stderr

```
{ "ok": true,  "data": <业务数据>, "links": { ... } }
{ "ok": false, "error": { "kind": "...", "message": "...", "raw": {...}, "retryable": false } }
```

- stdout 永远是**一个**可 `JSON.parse` 的文档（`--json` 单行、默认缩进两格）；
- 进度（`→ POST /tasks/1/cancel`）、人类可读表格、警告全部走 **stderr**；
- `--json` 时 stderr 静默，脚本可 `JSON.parse(stdout)` 一把吃干净。

证据：`SKILL.md:43`、`manual/error-codes.md:23`。

### 2. 退出码 0..10（`manual/error-codes.md:5-19`）

| 码 | 含义 | 我方典型触发 |
|---:|---|---|
| 0 | 成功 | 含 `--dry-run` 预演、detect 的缺项结果 |
| 1 | 一般失败 | 404、网络错、权限拒绝（**403 不是 3**）、未知码 |
| 2 | 参数错误 | 未知 flag/子命令、缺位置参数、`--set` 非法 |
| 3 | 鉴权失败 | `401101`/`401102`、本地无凭据 |
| 4 | 任务失败 | `400105`/`400106`/`745900`、任务终态 failed |
| 5 | 任务取消 | 任务终态 canceled、Ctrl-C |
| 6 | 等待超时 | `--timeout` 到期、`745901` |
| 7 | 积分不足 | `745701`/`745703` |
| 8 | 内容审核未通过 | `745801`/`745802`、任务终态 review_rejected |
| 9 | 画布版本冲突 | `746002` |
| 10 | 节点锁竞争 | `746003` |

映射是**一张显式表**（`src/exit-codes.ts` 的 `BUSINESS_CODE_MAP` + `KIND_EXIT`），
不散落 `if-else`；`test/exit-codes.spec.ts` 逐条断言。两条反直觉点已钉住：
权限拒绝 = 1 而非 3（`error-codes.md:21`）；未知码/未知 HTTP 状态绝不静默成功。

### 3. `--dry-run` / `--idempotency-key`

- `--dry-run` **不发任何请求**（连报价也不发），只输出
  `{dry_run:true, method, path, url, query, body, idempotency_key, credits_estimate}`，退出码 0
  （`manual/workflow/_stage-machine.md:101`、`commands/material.md:26`）；
- `--idempotency-key KEY` 把 `Idempotency-Key` 头透传给写请求，并在本地账本
  （`$ONEFRAME_CONFIG_DIR/state/idempotency.json`）做三态保护：
  `applied` 按重放短路返回上次结果、`pending`/`in_doubt` 拒绝
  （`commands/ledger.md:5-16`）。

## 命令组状态（196 条：可用 118 / 骨架 78，37 组）

可用（API 端点已在位）：

| 组 | 可用/总数 | 说明 |
|---|---|---|
| login / logout / account / env / cache / version | 9/9 | 纯客户端 |
| workflow | 3/3 | detect / status / resume（阶段判定在服务端 `GET /workflow/detect`） |
| model | 3/4 | list / search / params（`price` 无只读端点） |
| task | 6/8 | get/list/wait/cancel/retry/download |
| credits | 3/4 | balance / flows / estimate |
| workspace | 7/7 | 我方 = `script_projects`（create/list/info/edit/delete/use/show） |
| episode | 5/15 | list/create/get/edit/split |
| storyboard | 5/18 | list/batch-generate/batch-generate-video/edit/match-assets |
| upload | 1/1 | `POST /projects/parse-script` |
| resource | 7/16 | list / extract / extract-status / extract-redo / draft-list / draft-import / generate-list |
| subject | 7/10 | list / get / create / edit / delete / status / save-from-resource |
| asset-lib | 4/12 | list / dir-list / rename / delete |
| canvas | 10/10 | 含 template-* 与 snapshots |
| node | 10/10 | 含 table-import / table-confirm / edge |
| group / pin-group | 7/9 | 组模板与固定组 |
| material / script | 9/12 | 画布素材与脚本链路（storyboard/asset-extract/match/rematch/cancel/optimize） |
| export | 3/4 | start / get / merge |
| deeplink | 11/11 | 离线拼 URL，不发请求 |
| ledger | 3/3 | list / show / resolve（纯本地） |
| team | 2/2 | info / permission |
| agent | 3/5 | session create/list/delete |

骨架（执行时明确返回 `kind=unsupported` + 未落地原因，**绝不伪造成功**）：

| 组 | 未落地原因 |
|---|---|
| episode（10 条） | 无删除/批量建集/拆集列表/模板目录端点；`parse*` 是 episode 级解析，我方抽取链只有项目级 `POST /extraction/tasks` |
| storyboard（13 条） | 无单条增删/重排/草稿/ext/跨集全量/xlsx 模板端点 |
| resource（9 条）/ subject（3 条） | asset-core 的 generate/confirm 族与 `from-resource`/`reset`/`batch-details` 端点未落地 |
| novel / film 相关 | `packages/db` 有表，`apps/api` 无对应模块（本批不接入） |
| market(3) / ad(3) / redraw(2) / ai(2) / clip(2) / voice(1) / sync-fm(1) | 后续批次 / 外部集成 |
| model.price / credits.log / task.delete / task.regenerate / export.download / file.*(3) / asset-lib(8) | 我方确实没有这些只读/写端点（原因逐条写在 `registry.ts`） |

`oneframe <组> --help` 会把每条骨架的原因打出来；`test/help.spec.ts` 断言
「骨架必须有 reason，且不等于占位符」。

## 已知偏离（逐条登记）

1. **三级语法压平**：竞品 `canvas template publish` / `asset-lib dir create` 是三级，
   本实现压平为 `canvas template-publish` / `asset-lib dir-list`（解析器只有组 + 子命令两层）。
   证据：`commands/canvas.md:13-16`、`commands/asset-lib.md:41-57`。
2. **`missing[].key` 对应竞品 `missing[].field`**：竞品字段名见 `commands/workflow.md:125`，
   本批任务口径要求 `key`，故取 `key`（另带 `reason` / `goto_stage`）。
3. **阶段判定在服务端**：竞品说「阶段判定由 CLI 完成」（`commands/workflow.md:5`），
   我方下沉到 `GET /workflow/detect`，CLI 只渲染，避免各客户端实现两套口径。
4. **深链路由按我方 Web**：竞品 `/series-manage/<sp_id>?tab=...`、`/episode-list`、
   `/series-manage/asset-confirm`（`commands/deeplink.md:124-242`），我方实际是
   `/projects/[id]`、`/canvas/[id]`、`/assets`、`/tasks`、`/credits`、`/pricing`。
   query 语义保留（`tab`/`episode`/`resource_type`）。`asset-confirm`/`asset-extract`/
   `asset-result` 三个页面我方无对应专页，暂落到 `tab=assets|asset_result`。
5. **`--workspace` = 我方 `script_projects.id`**：竞品「工作区」是独立实体
   （`commands/workspace.md:29`），我方项目即工作区，故 1:1 映射到 `/v1/projects`。
6. **`workspace delete` 是归档**：我方 `DELETE /projects/:id` 是归档（`script.controller.ts:107`）。
7. **`--offline-models` 不适用**：我方模型目录只来自服务端 `GET /models`，无本地静态目录
   （竞品见 `commands/model.md:140`）；传了会在 stderr 提示已忽略。
8. **凭据文件 0600 语义**：POSIX 上 `chmod 0600`；Windows 上 mode 只是提示位，改用
   「临时文件 + 原子 rename」保证不出现半截文件。
9. **dry-run 的 `credits_estimate` 恒为 `unavailable`**：竞品 dry-run 会顺带询价
   （`commands/credits.md:107`），我方明确「dry-run 不发任何请求」，把精确试算留给
   `oneframe credits estimate`（`POST /v1/credits/quote`）。
10. **`ledger` 拒绝用退出码 1 而非 11**：竞品 `commands/ledger.md:11` 写「退出码 11」，
    但 `manual/error-codes.md:5-19` 只定义 0..10——两份文档自相矛盾。我方按本批口径
    取 1，并把真实状态放进 `error.raw.state`（`pending`/`in_doubt`）。
11. **`resource extract-status` 的任务 ID 用位置参数/`--task-id`**：竞品用
    `--set et_id=ET_ID`（`commands/resource.md:570`）。我方路径占位符只接受位置参数或
    同名 flag，故写作 `resource extract-status <ET_ID>`（等价 `--task-id <ET_ID>`）。
12. **`resource extract` 落到 `POST /extraction/tasks`**：竞品是「项目级资产提取任务」
    （`commands/resource.md:536`），我方对应 `extraction` 域；项目资产同步提取那条
    （`POST /projects/:id/assets/extract`）本批未接 CLI。

## 待取证 / 未做

- **MCP**：竞品只有宣传口径、**没有工具清单**（`SKILL.md` 全文无工具定义，`manual/` 无 MCP 页）。
  按 ADR-013「无证据不臆造」，本批**不做** MCP server；待拿到竞品工具清单再实现。
- **`version check`**：竞品读官网 Skill zip 的 `INSTALL.md` 钉死版本（`commands/version.md:43`）；
  我方无发布源清单端点，命令返回 `{latest:null, update_available:null, source:"unavailable", reason}`，
  不假装「已是最新」。
- **`credits log`**：我方只有带符号 `points` 的一套流水（`/v1/credits/flows`），
  没有竞品 `log` 的无符号 `val`+`event_type` 口径（`commands/credits.md:68`）。
- **`model price`**：我方 `model_prices` 只有运营侧端点（`admin.controller.ts:137`）。
- **`ledger` 的 `--force-replay` 与 `--no-idempotency-guard`**：`--force-replay` 已实现；
  `--no-idempotency-guard` 未实现（竞品见 `commands/ledger.md:114`）。
- **`task download` 不落盘**：只返回下载信息（我方产物签名 URL 内嵌在任务响应里，
  `tasks.service downloadUrl`）；本地写文件未做。
- **`upload` 不建项目**：只调 `POST /projects/parse-script` 解析；把解析结果写进项目
  （`source_text`）需要串联 `workspace create` + `PATCH /projects/:id`，本批未做。
- **浏览器 handoff 登录**：竞品默认开浏览器（`commands/login.md:20`），我方只做
  `--phone/--code` 与 `--token-file` 两条无浏览器路径。
- **服务端幂等重放中间件**：`idempotency_records` 表已在 `packages/db/src/schema.ts:342`，
  但 `apps/api` 里**没有任何代码读取它**——CLI 只负责透传 `Idempotency-Key` 头。
  服务端去重/重放需要另派单（不在本批写权限内）。

## 配置与凭据

- 配置目录：`$ONEFRAME_CONFIG_DIR` > `~/.oneframe`；
- `config.json`（0600 语义）存 `current_uid` / `profiles[uid].access_token` /
  工作区绑定 / workflow 本地记录；`state/idempotency.json` 存幂等账本；
  `cache/{models,env,uploads}` 存可重建缓存（`cache clear --scope` 清理）；
- **任何输出都不含 token/refresh_token/cookie**：`env info`、`account info`、`error.raw`
  全部先过 `src/redact.ts`（键名命中 token/cookie/password/secret 即替换为 `***`，
  预签名 URL 的签名参数也抹掉）。证据：`manual/error-codes.md:23`、`commands/account.md:38`。

## 开发

```bash
pnpm --filter @app/cli build          # tsc → dist/
pnpm --filter @app/cli typecheck
cd apps/cli && npx vitest run         # 83 例（envelope/退出码/参数/dry-run/幂等/help/transform/深链/workflow）
```

`src/` 结构：`cli.ts`（主流程）· `registry.ts`（196 条命令声明）· `resolve.ts`
（输入→请求）· `http.ts`（信封解包 + 错误映射）· `exit-codes.ts`（业务码↔退出码表）·
`builtins.ts`（纯客户端命令）· `ledger.ts`（幂等账本）· `deeplinks.ts` · `redact.ts` ·
`render.ts` · `help.ts`。
