---
name: oneframe-cli-skill
description: 调用 oneframe 写入 OneFrame 项目或无限画布，或询问 OneFrame / oneframe CLI 怎么用、有哪些功能、使用教程、能做什么、新手引导时使用：绑定或建项、导入剧本、拆分镜、生成与重跑图视频、查积分流水、导出成片。只要文案或方案、不跑 CLI、也不是使用咨询时不使用。
---

# OneFrame CLI Skill

发布态只依赖三样东西：当前二进制的 `--help`、本文件、以及随包文档（`manual/`、`commands/`）。不要引用任何外部文档站或截图。

本包版本 **0.1.0**（`VERSION`），命令 202 条、可用 156 条。

## <HARD-GATE>

1. **纯咨询不要执行命令**：只读 `manual/user-guide.md` 并原样转述，不要跑 CLI、不要伪造输出。
2. **执行前先定一个场景文档**：按下面「路由」表选定**恰好一个**，读它，再读它引用的 `commands/*.md`。
3. **执行契约只读 `manual/error-codes.md` 与 `--help` 的实际输出**，不要凭记忆补参数名。
4. **进度分母来自 `commands/*.md` 里写死的命令，不要临场发明步数**；`<HARD-GATE>` 里没写的步骤不要加。
5. **骨架命令不是失败**：`kind=unsupported` 表示我方还没有该端点。如实说明缺口，不要换个写法硬凑。
6. **Agent 的本地中间文件只写 `./outputs/`**，不要污染仓库工作区。
7. **积分不足/超预算只报「余额不足」**：不要把 `workspace_id`/`canvas_id`/`node_id`/`task_id` 这类内部常量贴给用户。
8. **付费写操作先 `--dry-run`**：dry-run 不发请求；确认无误后去掉再执行。

## 路由（选一个，不要全读）

| 用户想要 | 读这个 |
| --- | --- |
| 「怎么用 / 能做什么」纯咨询 | `manual/user-guide.md` |
| 建项目、导剧本、拆集 | `commands/workspace.md` → `commands/upload.md` → `commands/episode.md` |
| AI 拆分镜 / 改分镜 | `commands/storyboard.md` |
| 资产提取、资产匹配、主体 | `commands/resource.md`、`commands/subject.md` |
| 生成图片 / 视频 | `commands/node.md`、`commands/task.md` |
| 画布与节点编排 | `commands/canvas.md`、`commands/node.md`、`commands/edge.md` |
| 查积分与流水 | `commands/credits.md` |
| 导出成片 | `commands/export.md` |
| 报错排障 | `manual/error-codes.md` |
| 安装 / 升级 / 让某个 Agent 用上本 Skill | `INSTALL.md` |

## 命令组总览（自动生成）

| 命令组 | 命令数 | 可用 | 骨架 | 读这条 |
| --- | --- | --- | --- | --- |
| `login` | 1 | 1 | 0 | `commands/login.md` |
| `logout` | 1 | 1 | 0 | `commands/logout.md` |
| `account` | 2 | 2 | 0 | `commands/account.md` |
| `env` | 1 | 1 | 0 | `commands/env.md` |
| `cache` | 2 | 2 | 0 | `commands/cache.md` |
| `version` | 2 | 2 | 0 | `commands/version.md` |
| `skill` | 1 | 1 | 0 | `commands/skill.md` |
| `workflow` | 3 | 3 | 0 | `commands/workflow.md` |
| `model` | 4 | 3 | 1 | `commands/model.md` |
| `task` | 8 | 7 | 1 | `commands/task.md` |
| `credits` | 4 | 3 | 1 | `commands/credits.md` |
| `workspace` | 7 | 7 | 0 | `commands/workspace.md` |
| `episode` | 15 | 13 | 2 | `commands/episode.md` |
| `storyboard` | 18 | 9 | 9 | `commands/storyboard.md` |
| `upload` | 1 | 1 | 0 | `commands/upload.md` |
| `resource` | 16 | 11 | 5 | `commands/resource.md` |
| `subject` | 10 | 7 | 3 | `commands/subject.md` |
| `asset-lib` | 12 | 6 | 6 | `commands/asset-lib.md` |
| `file` | 3 | 0 | 3 | `commands/file.md` |
| `canvas` | 10 | 10 | 0 | `commands/canvas.md` |
| `node` | 10 | 10 | 0 | `commands/node.md` |
| `group` | 6 | 4 | 2 | `commands/group.md` |
| `pin-group` | 3 | 3 | 0 | `commands/pin-group.md` |
| `material` | 6 | 3 | 3 | `commands/material.md` |
| `script` | 6 | 6 | 0 | `commands/script.md` |
| `export` | 4 | 3 | 1 | `commands/export.md` |
| `deeplink` | 11 | 11 | 0 | `commands/deeplink.md` |
| `ledger` | 3 | 3 | 0 | `commands/ledger.md` |
| `team` | 2 | 2 | 0 | `commands/team.md` |
| `agent` | 5 | 3 | 2 | `commands/agent.md` |
| `novel` | 6 | 5 | 1 | `commands/novel.md` |
| `market` | 3 | 3 | 0 | `commands/market.md` |
| `ad` | 8 | 8 | 0 | `commands/ad.md` |
| `redraw` | 2 | 2 | 0 | `commands/redraw.md` |
| `ai` | 2 | 0 | 2 | `commands/ai.md` |
| `clip` | 2 | 0 | 2 | `commands/clip.md` |
| `voice` | 1 | 0 | 1 | `commands/voice.md` |
| `sync-fm` | 1 | 0 | 1 | `commands/sync-fm.md` |

## stdout / stderr 契约

- 一律加 `--json`：stdout 只有**一个** envelope，`{ok:true,data,links}` 或 `{ok:false,error}`。
- 进度、人类可读摘要、`[warn]` 全部走 stderr。
- 退出码见 `manual/error-codes.md`：脚本分支只看退出码，不要再解析文案。

## 升级

发现新版本时：先完成本轮付费写操作，再按 `INSTALL.md` 钉死版本重装，然后执行 `oneframe skill-path` 得到新目录，**整目录替换**宿主里的 `oneframe-cli-skill`（先删后拷，不要与旧文件合并）。
