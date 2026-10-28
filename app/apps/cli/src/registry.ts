import type { HttpMethod } from "./http";

/**
 * 命令注册表。
 *
 * 契约来源（**唯一**一手证据）：`_acceptance/_gap/cli-skill/reelmate-cli-skill/`
 * 下 38 篇 `commands/*.md` + `SKILL.md` + `manual/`。每条命令的 `evidence` 写明
 * 竞品文档与行号，便于逐组核对（ADR-013：有证据就照做）。
 *
 * 三态设计（避免「看起来像完成了」）：
 * - `ready: true` + `method` → 我方 API 已有对应端点，命令可直接用；
 * - `ready: true` + `impl`   → 纯客户端命令（登录/配置/深链/幂等账本/等待轮询）；
 * - `ready: false`           → 依赖批次未落地或我方无该端点，命令**只出现在 --help**，
 *   执行时返回 `kind=unsupported` 并明确说出缺什么，绝不伪造成功。
 *
 * 语法降维（已知偏离，登记在 README 与回报）：竞品是三级语法
 * （`canvas template publish` / `asset-lib dir create`），本实现把「子族」压平成
 * 连字符二级（`canvas template-publish` / `asset-lib dir-list`）。理由：解析器只有
 * 组 + 子命令两层，压平后 `--help` 仍能逐条对齐，且避免为 4 个三级命令引入递归解析。
 */

export type TransformName =
  | "none"
  | "credits"
  | "modelByName"
  | "modelSearch"
  | "episodesOfProject"
  | "storyboardsOfEpisode"
  | "nodeById"
  | "taskList";

export type BuiltinName =
  | "login"
  | "logout"
  | "account-info"
  | "account-use"
  | "env-info"
  | "cache-info"
  | "cache-clear"
  | "version"
  | "version-check"
  | "workspace-use"
  | "workspace-show"
  | "workflow-detect"
  | "workflow-status"
  | "workflow-resume"
  | "task-wait"
  | "task-download"
  | "ledger-list"
  | "ledger-show"
  | "ledger-resolve"
  | "skill-path"
  | "deeplink";

export interface Positional {
  /** 帮助里显示的占位名 */
  display: string;
  desc: string;
  required?: boolean;
}

/** 位置参数 → 请求体字段（写命令用；`array` 时把重复位置参数聚成数组） */
export interface BodyParam {
  key: string;
  index: number;
  as?: "string" | "number" | "array";
}

export interface CommandSpec {
  group: string;
  /** 子命令；空字符串表示「组即命令」（如 `login`、`export`、`upload`） */
  cmd: string;
  summary: string;
  /** 竞品证据 `文件:行` */
  evidence: string;
  ready: boolean;
  /** 未就绪原因（依赖批次 / 缺失端点），ready=true 时省略 */
  reason?: string;
  method?: HttpMethod;
  /** 相对 baseUrl 的路径模板，占位符形如 `{project_id}` */
  path?: string;
  positionals?: Positional[];
  /** 位置参数按顺序填充的占位符名（`null` 表示该位置不参与路径，如 `node generate NODE_TYPE NODE_ID`） */
  slots?: (string | null)[];
  /** GET 命令：把 `--set` 中这些键放进 query（白名单） */
  queryKeys?: string[];
  /** 写命令：`--set`/`--update` 全部进 body，并支持 --dry-run / --idempotency-key */
  write?: boolean;
  /** 写命令：位置参数映射进 body */
  bodyParams?: BodyParam[];
  /** 写命令：flag → body 字段名（如 `--left` → `src_node_id`） */
  flagBody?: Record<string, string>;
  /** 写命令：固定写入 body 的常量（如 resource confirm → `{status:2}`） */
  fixedBody?: Record<string, unknown>;
  /** 付费/批量写：dry-run 输出里给出 credits_estimate 口径 */
  paid?: boolean;
  transform?: TransformName;
  impl?: BuiltinName;
}

const http = (
  group: string,
  cmd: string,
  method: HttpMethod,
  path: string,
  summary: string,
  evidence: string,
  extra: Partial<CommandSpec> = {},
): CommandSpec => ({ group, cmd, method, path, summary, evidence, ready: true, ...extra });

const todo = (
  group: string,
  cmd: string,
  summary: string,
  evidence: string,
  reason: string,
): CommandSpec => ({ group, cmd, summary, evidence, ready: false, reason });

const local = (
  group: string,
  cmd: string,
  summary: string,
  evidence: string,
  impl: BuiltinName,
  extra: Partial<CommandSpec> = {},
): CommandSpec => ({ group, cmd, summary, evidence, ready: true, impl, ...extra });

// ── 会话与配置（commands/login.md … version.md）─────────────────────────
const sessionCommands: CommandSpec[] = [
  local("login", "", "登录并保存凭据（手机号验证码 / --token-file / stdin）", "commands/login.md:20", "login"),
  local("logout", "", "注销并删除本地凭据", "commands/logout.md:19", "logout"),
  local("account", "info", "查看当前账号与空间（不含 token）", "commands/account.md:19", "account-info"),
  local("account", "use", "切换本地当前账号（不发远端请求）", "commands/account.md:47", "account-use", {
    positionals: [{ display: "UID", desc: "已登录账号 uid", required: true }],
  }),
  local("env", "info", "查看 API/账号/作用域/缓存根（排障用）", "commands/env.md:17", "env-info"),
  local("cache", "info", "查看本地可重建缓存", "commands/cache.md:19", "cache-info"),
  local("cache", "clear", "清理缓存范围 --scope models|env|uploads", "commands/cache.md:39", "cache-clear"),
  local("version", "", "打印本机版本", "commands/version.md:19", "version"),
  local("version", "check", "检查是否有新版本", "commands/version.md:39", "version-check"),
  // 第 61 批：git 竞品 `INSTALL.md:17/44` + `SKILL.md:41` —— 分发 Skill 的唯一入口是
  // 「打印已安装包内的 Skill 目录，让宿主整目录拷贝」。竞品把这条放在 `skill-path`
  // 这个**一级命令**下（不是 `version skill-path`），所以这里照抄形状。
  local("skill", "path", "打印随包 Skill 目录（给宿主整目录拷贝/替换用）", "INSTALL.md:17", "skill-path"),
];

// ── workflow（commands/workflow.md）────────────────────────────────────
const workflowCommands: CommandSpec[] = [
  local("workflow", "detect", "只读探测当前阶段（服务端 GET /workflow/detect）", "commands/workflow.md:23", "workflow-detect"),
  local("workflow", "status", "同 detect，另附本地上次执行位置", "commands/workflow.md:45", "workflow-status"),
  local("workflow", "resume", "以 --from 阶段为起点重算待办并记录位置", "commands/workflow.md:61", "workflow-resume"),
];

// ── 模型（commands/model.md）───────────────────────────────────────────
const modelCommands: CommandSpec[] = [
  http("model", "list", "GET", "models", "列出可用模型目录", "commands/model.md:24", {
    queryKeys: ["capability", "mode", "visible"],
  }),
  http("model", "search", "GET", "models", "按关键词筛选模型（客户端过滤展示名/说明）", "commands/model.md:71", {
    queryKeys: ["capability", "mode", "visible"],
    transform: "modelSearch",
    positionals: [{ display: "KEYWORD", desc: "展示名或说明关键词", required: true }],
  }),
  http("model", "params", "GET", "models", "查看某模型的各生成模式参数规则", "commands/model.md:115", {
    transform: "modelByName",
    queryKeys: ["capability", "mode", "visible"],
    positionals: [
      { display: "TYPE", desc: "image|video|audio", required: true },
      { display: "MODEL_NAME", desc: "模型展示名", required: true },
    ],
  }),
  todo(
    "model",
    "price",
    "查看模型定价",
    "commands/model.md:92",
    "我方无模型定价只读端点（model_prices 仅运营侧 /v1/ops/admin/model-prices，admin.controller.ts:137）",
  ),
];

// ── 任务（commands/task.md）────────────────────────────────────────────
const taskCommands: CommandSpec[] = [
  http("task", "get", "GET", "tasks/{task_id}", "查询任务详情", "commands/task.md:31", {
    slots: ["task_id"],
    positionals: [{ display: "TASK_ID", desc: "任务 ID", required: true }],
  }),
  http("task", "list", "GET", "tasks", "列出当前空间任务", "commands/task.md:52", {
    queryKeys: ["page", "page_size", "status", "capability"],
    transform: "taskList",
  }),
  local("task", "wait", "阻塞等待任务终态（客户端轮询 GET /tasks/:id）", "commands/task.md:76", "task-wait", {
    positionals: [{ display: "TASK_ID", desc: "可重复传多个任务 ID", required: true }],
  }),
  http("task", "cancel", "POST", "tasks/{task_id}/cancel", "取消任务", "commands/task.md:99", {
    slots: ["task_id"],
    positionals: [{ display: "TASK_ID", desc: "任务 ID", required: true }],
    write: true,
  }),
  http("task", "retry", "POST", "tasks/{task_id}/retry", "重试失败任务（会重复下单扣费）", "commands/task.md:121", {
    slots: ["task_id"],
    positionals: [{ display: "TASK_ID", desc: "失败任务 ID", required: true }],
    write: true,
    paid: true,
  }),
  local("task", "download", "把任务产物下载到 ./outputs/<task_id>-<n>.<ext>（不输出签名 URL）", "commands/task.md:165", "task-download", {
    positionals: [{ display: "TASK_ID", desc: "任务 ID", required: true }],
  }),
  http("task", "regenerate", "POST", "tasks/{task_id}/regenerate", "用原任务信息重新提交生成（会再次扣费，先 --dry-run）", "commands/task.md:143", {
    slots: ["task_id"],
    positionals: [{ display: "TASK_ID", desc: "原任务 ID", required: true }],
    write: true,
    paid: true,
    }),
  todo("task", "delete", "删除任务记录", "commands/task.md:195", "我方无删除任务端点；结果按 tasks.expire_at（90 天）自动过期，需要“看不见”请在列表侧过滤"),
];

// ── 积分（commands/credits.md）─────────────────────────────────────────
const creditsCommands: CommandSpec[] = [
  http("credits", "balance", "GET", "me", "查询积分余额", "commands/credits.md:23", { transform: "credits" }),
  http("credits", "flows", "GET", "credits/flows", "查询积分流水（带符号 points）", "commands/credits.md:64", {
    queryKeys: ["page", "page_size", "task_id"],
  }),
  http("credits", "estimate", "POST", "credits/quote", "生成前试算消耗（不扣费）", "commands/credits.md:96", {
    write: true,
  }),
  todo(
    "credits",
    "log",
    "查询积分流水（旧接口语义：无符号 val + event_type）",
    "commands/credits.md:43",
    "我方只有一套带符号 points 的口径 GET /credits/flows，没有 log 的无符号口径；请用 credits flows",
  ),
];

// ── 工作区（commands/workspace.md；我方 = script_projects）────────────────
const workspaceCommands: CommandSpec[] = [
  http("workspace", "create", "POST", "projects", "创建工作区（我方 = 项目）", "commands/workspace.md:29", {
    write: true,
    positionals: [{ display: "NAME", desc: "工作区名称（也可 --name）" }],
    bodyParams: [{ key: "title", index: 0 }],
  }),
  http("workspace", "list", "GET", "projects", "列出当前空间工作区", "commands/workspace.md:58", {
    queryKeys: ["page", "page_size"],
  }),
  http("workspace", "info", "GET", "projects/{project_id}", "工作区详情", "commands/workspace.md:82", {
    slots: ["project_id"],
    positionals: [{ display: "WORKSPACE_ID", desc: "工作区 ID", required: true }],
  }),
  http("workspace", "edit", "PATCH", "projects/{project_id}", "修改工作区名称", "commands/workspace.md:106", {
    slots: ["project_id"],
    positionals: [
      { display: "WORKSPACE_ID", desc: "工作区 ID", required: true },
      { display: "NAME", desc: "新名称（也可 --name）" },
    ],
    bodyParams: [{ key: "title", index: 1 }],
    write: true,
  }),
  http("workspace", "delete", "DELETE", "projects/{project_id}", "删除工作区（我方为归档）", "commands/workspace.md:128", {
    slots: ["project_id"],
    positionals: [{ display: "WORKSPACE_ID", desc: "工作区 ID", required: true }],
    write: true,
  }),
  local("workspace", "use", "绑定当前工作区", "commands/workspace.md:149", "workspace-use", {
    positionals: [{ display: "WORKSPACE_ID", desc: "工作区 ID", required: true }],
  }),
  local("workspace", "show", "查看当前绑定", "commands/workspace.md:171", "workspace-show"),
];

// ── 剧集（commands/episode.md）─────────────────────────────────────────
const episodeCommands: CommandSpec[] = [
  http("episode", "list", "GET", "projects/{project_id}/matrix", "列出项目剧集与分镜矩阵", "commands/episode.md:57", {
    transform: "episodesOfProject",
  }),
  http("episode", "create", "POST", "projects/{project_id}/episodes", "新增空集（我方按 count 批量）", "commands/episode.md:78", {
    write: true,
  }),
  http("episode", "get", "GET", "projects/{project_id}/episodes/{episode_id}", "剧集详情（含分镜）", "commands/episode.md:94", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
  }),
  http("episode", "edit", "PATCH", "projects/{project_id}/episodes/{episode_id}", "修改剧集", "commands/episode.md:110", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
    write: true,
  }),
  http("episode", "split", "POST", "projects/{project_id}/episodes/split", "按剧本文本拆集", "commands/episode.md:160", {
    write: true,
  }),
  todo("episode", "delete", "删除剧集", "commands/episode.md:126", "我方无 DELETE episodes；不要的集用 PATCH /projects/:id/episodes/:eid 清空内容，整项目用 workspace delete（归档）"),
  todo("episode", "batch-create", "批量建集", "commands/episode.md:142", "我方只支持按数量新增：`oneframe episode create --workspace <SP> --set count=N`（无逐集标题载荷端点）"),
  http("episode", "split-list", "GET", "projects/{project_id}/matrix", "查看拆集结果（= 项目剧集矩阵，拆集结果直接落 episodes）", "commands/episode.md:176", {
    transform: "episodesOfProject",
    }),
  todo("episode", "split-delete", "删除拆集结果", "commands/episode.md:195", "拆集结果直接落 episodes，没有独立的“拆集结果”实体（我方无该端点）；要删请 PATCH 单集，整项目用 workspace delete（归档）"),
  todo("episode", "prompt-templates", "提示词模板目录", "commands/episode.md:211", "我方无提示词模板目录端点（模板批次未落地）；当前用 `--set prompt_type=` / `--set prompt_ukid=` 直接传模板标识"),
  http("episode", "match-resources", "POST", "projects/{project_id}/episodes/{episode_id}/match-resources", "提交资产匹配组合任务（异步，返回 task_id）", "commands/episode.md:261", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
    write: true,
    paid: true,
    }),
  http("episode", "save-resource-matches", "POST", "projects/{project_id}/episodes/{episode_id}/save-resource-matches", "保存资产匹配结果", "commands/episode.md:368", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
    write: true,
    }),
  http("episode", "parse", "POST", "projects/{project_id}/episodes/parse", "逐集解析角色/场景/道具（项目级，异步）", "commands/episode.md:389", {
    write: true,
    paid: true,
    }),
  http("episode", "parse-retry", "POST", "projects/{project_id}/episodes/parse-retry", "重试解析", "commands/episode.md:407", {
    write: true,
    }),
  http("episode", "parse-result", "GET", "projects/{project_id}/episodes/{episode_id}/match-result", "查看解析/匹配结果", "commands/episode.md:429", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
    }),
];

// ── 分镜（commands/storyboard.md）──────────────────────────────────────
const storyboardCommands: CommandSpec[] = [
  http("storyboard", "list", "GET", "projects/{project_id}/episodes/{episode_id}", "列出剧集分镜", "commands/storyboard.md:61", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
    transform: "storyboardsOfEpisode",
  }),
  http("storyboard", "batch-generate", "POST", "projects/{project_id}/episodes/{episode_id}/storyboards/generate", "AI 拆分镜生成", "commands/storyboard.md:411", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
    write: true,
    paid: true,
  }),
  http("storyboard", "batch-generate-video", "POST", "projects/{project_id}/episodes/{episode_id}/storyboards/generate-videos", "批量生视频", "commands/storyboard.md:389", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
    write: true,
    paid: true,
  }),
  http("storyboard", "edit", "PATCH", "projects/{project_id}/episodes/{episode_id}/storyboards/{storyboard_id}", "修改分镜", "commands/storyboard.md:111", {
    slots: ["episode_id", "storyboard_id"],
    positionals: [
      { display: "EPISODE_ID", desc: "剧集 ID", required: true },
      { display: "STORYBOARD_ID", desc: "分镜 ID", required: true },
    ],
    write: true,
  }),
  http("storyboard", "match-assets", "PUT", "projects/{project_id}/episodes/{episode_id}/storyboards/{storyboard_id}/assets", "绑定分镜资产", "commands/storyboard.md:367", {
    slots: ["episode_id", "storyboard_id"],
    positionals: [
      { display: "EPISODE_ID", desc: "剧集 ID", required: true },
      { display: "STORYBOARD_ID", desc: "分镜 ID", required: true },
    ],
    write: true,
  }),
  todo("storyboard", "add", "新增分镜", "commands/storyboard.md:93", "我方无单条新增分镜；用 `storyboard batch-generate <EP_ID>`（AI 生成）或 `node table-import` 导表"),
  todo("storyboard", "delete", "删除分镜", "commands/storyboard.md:137", "我方无删除分镜端点（storyboard 目前只可改不可删）；要重来用 `storyboard batch-generate` 覆盖"),
  todo("storyboard", "batch-delete", "批量删除分镜", "commands/storyboard.md:153", "我方无批量删除分镜端点；同上，用重新生成覆盖"),
  todo("storyboard", "num-update", "重排分镜号", "commands/storyboard.md:170", "我方无分镜号重排端点；编号随 shot_no 生成，需改请 `storyboard edit` 逐条"),
  todo("storyboard", "link-draft", "关联草稿", "commands/storyboard.md:186", "我方无“分镜草稿”概念（草稿批次未落地、无端点）；分镜即正式数据，直接 `storyboard edit`"),
  todo("storyboard", "ext", "分镜扩展参数", "commands/storyboard.md:202", "我方无 ext 端点；扩展字段走 `storyboard edit --set key=value`（PATCH 既有 storyboards）"),
  todo("storyboard", "total-list", "跨集全量分镜", "commands/storyboard.md:220", "我方无跨集全量分镜端点；用 `episode list --workspace <SP>` 拿矩阵（含每集分镜数）再逐集 `storyboard list`"),
  todo("storyboard", "batch-add", "批量新增分镜", "commands/storyboard.md:236", "我方无批量新增端点；批量来源请走 `node table-import`（表格节点导入）"),
  todo("storyboard", "prompt-template", "生成官方分镜提示词空表", "commands/storyboard.md:263", "xlsx 模板导出端点未落地（待取证）；当前直接 `--set` 提交 JSON，或用 `node table-import` 导表"),
  todo("storyboard", "sheet-read", "回读分镜提示词表", "commands/storyboard.md:281", "xlsx 回读端点未落地（待取证）；表格数据请走 `node table-import` + `node table-confirm`"),
  todo("storyboard", "draft-import", "导入分镜草稿", "commands/storyboard.md:302", "分镜草稿批次未落地（我方无草稿表）；直接 `storyboard batch-add` 不适用，改用 AI 生成"),
  todo("storyboard", "draft-delete", "删除分镜草稿", "commands/storyboard.md:331", "分镜草稿批次未落地（我方无草稿表、无端点）；无对应操作，正式分镜不提供删除"),
  todo("storyboard", "draft-batch-update", "批量更新分镜草稿", "commands/storyboard.md:350", "分镜草稿批次未落地；正式分镜用 `storyboard edit` 逐条改"),
];

// ── 上传（commands/upload.md）──────────────────────────────────────────
const uploadCommands: CommandSpec[] = [
  http("upload", "", "POST", "projects/parse-script", "上传并解析剧本文件（txt/md/csv/docx/xlsx）", "commands/upload.md:17", {
    write: true,
    positionals: [{ display: "PATH", desc: "本地剧本文件路径", required: true }],
  }),
];

// ── 资产库 / 文件（commands/asset-lib.md、file.md）──────────────────────
const assetLibCommands: CommandSpec[] = [
  http("asset-lib", "list", "GET", "assets", "列出空间资产", "commands/asset-lib.md:105", {
    queryKeys: ["page", "page_size", "kind"],
  }),
  http("asset-lib", "dir-list", "GET", "asset-folders", "列出资产目录", "commands/asset-lib.md:57"),
  http("asset-lib", "rename", "PATCH", "assets/{asset_id}", "重命名资产", "commands/asset-lib.md:153", {
    slots: ["asset_id"],
    positionals: [
      { display: "ASSET_ID", desc: "资产 ID", required: true },
      { display: "NAME", desc: "新名称（也可 --name）" },
    ],
    bodyParams: [{ key: "name", index: 1 }],
    write: true,
  }),
  http("asset-lib", "delete", "DELETE", "assets/{asset_id}", "删除资产", "commands/asset-lib.md:169", {
    slots: ["asset_id"],
    positionals: [{ display: "ASSET_ID", desc: "资产 ID", required: true }],
    write: true,
  }),
  http("asset-lib", "dir-create", "POST", "asset-folders", "创建资产目录", "commands/asset-lib.md:41", {
    write: true,
    positionals: [{ display: "NAME", desc: "目录名（也可 --name）" }],
    bodyParams: [{ key: "name", index: 0 }],
    }),
  todo("asset-lib", "get", "查看资产详情", "commands/asset-lib.md:121", "我方无 GET /assets/:id；用 `asset-lib list --set page=1` 过滤，或从 `task get` 的 results 取"),
  http("asset-lib", "import", "POST", "assets/from-task", "从生成任务导入资产（= 素材入库）", "commands/asset-lib.md:137", {
    write: true,
    positionals: [{ display: "TASK_ID", desc: "任务 ID", required: true }],
    bodyParams: [{ key: "task_id", index: 0 }],
    }),
  todo("asset-lib", "search", "搜索资产", "commands/asset-lib.md:185", "我方素材列表无 q 参数；知识库侧有搜索：`GET /v1/knowledge/assets/search`（CLI 尚未建组，见回报）"),
  todo("asset-lib", "resource-list", "asset-lib resource list", "commands/asset-lib.md:201", "“资源”语义在我方分两处：项目资产用 `resource list --workspace <SP>`，素材用 `asset-lib list`"),
  todo("asset-lib", "tag-add", "资产打标签", "commands/asset-lib.md:249", "素材(PATCH /assets/:id)支持 tags 字段：`asset-lib rename <ID> --set tags=[a]` 可达；独立 tag 端点无"),
  todo("asset-lib", "move", "移动资产到目录", "commands/asset-lib.md:281", "用 `asset-lib rename <ID> --set folder_id=<DIR>`（PATCH /assets/:id 支持 folder_id）"),
  todo("asset-lib", "batch-delete", "批量删除资产", "commands/asset-lib.md:297", "我方无批量删除；逐条 `asset-lib delete <ID>`（DELETE /assets/:id 是软删，可用 `POST /assets/:id/restore` 找回）"),
  todo("file", "metadata", "查看文件元数据", "commands/file.md:21", "我方无独立文件端点；产物元数据在 `task get <ID>` 的 results 里（含 size/content_type）"),
  todo("file", "object", "查看对象", "commands/file.md:43", "我方无对象存储浏览端点（key 由服务端生成，不对外枚举）"),
  todo("file", "sign-url", "获取文件签名 URL", "commands/file.md:65", "签名 URL 内嵌在 `GET /tasks/:id/results/:n/download-url`；用 `task download <ID>` 一步落盘"),
];

// ── 资源/主体（commands/resource.md、subject.md）────────────────────────
// 端点来源：`subjects.controller.ts`（7 端点，注释逐条标注竞品 subject 子命令）与
// `extraction.controller.ts`（抽取流水线，注释标注 `resource.md:536-727`）。
const resourceCommands: CommandSpec[] = [
  http("resource", "list", "GET", "projects/{project_id}/assets", "列出项目资产（角色/场景/道具）", "commands/resource.md:190", {
    queryKeys: ["kind"],
  }),
  http("resource", "extract", "POST", "extraction/tasks", "创建资产提取任务（异步，返回 et_id）", "commands/resource.md:536", {
    write: true,
    paid: true,
    positionals: [{ display: "SP_ID", desc: "项目 ID（也可 --workspace）" }],
    bodyParams: [{ key: "project_id", index: 0 }],
  }),
  http("resource", "extract-status", "GET", "extraction/tasks/{task_id}", "查询提取任务状态（1 进行中/2 成功/3 失败/4 失效）", "commands/resource.md:570", {
    slots: ["task_id"],
    positionals: [{ display: "ET_ID", desc: "提取任务 ID（也可 --task-id）", required: true }],
  }),
  http("resource", "extract-redo", "POST", "extraction/tasks/redo", "重做失败/失效的提取任务", "commands/resource.md:602", {
    write: true,
  }),
  http("resource", "draft-list", "GET", "extraction/drafts", "列出提取草稿", "commands/resource.md:704", {
    queryKeys: ["task_id", "eed_id", "kind", "state", "is_all", "episode_id", "project_id", "page", "page_size"],
  }),
  http("resource", "draft-import", "POST", "extraction/drafts/import", "导入/更新提取草稿（返回 eed_id）", "commands/resource.md:619", {
    write: true,
  }),
  http("resource", "generate-list", "GET", "projects/{project_id}/assets/{asset_id}/candidates", "查看资产生成候选", "commands/resource.md:341", {
    slots: ["asset_id"],
    positionals: [{ display: "RESOURCE_ID", desc: "资产 ID", required: true }],
  }),
  http("subject", "list", "GET", "subjects", "主体列表", "commands/subject.md:38", {
    queryKeys: ["kind", "review_status", "project_id", "q", "page", "page_size"],
  }),
  http("subject", "get", "GET", "subjects/{subject_id}", "主体详情", "commands/subject.md:108", {
    slots: ["subject_id"],
    positionals: [{ display: "SUBJECT_ID", desc: "主体 ID", required: true }],
  }),
  http("subject", "create", "POST", "subjects", "创建主体（必填 name）", "commands/subject.md:54", {
    write: true,
    positionals: [{ display: "NAME", desc: "主体名（也可 --name）" }],
    bodyParams: [{ key: "name", index: 0 }],
  }),
  http("subject", "edit", "PATCH", "subjects/{subject_id}", "修改主体（审核态也走这里）", "commands/subject.md:124", {
    slots: ["subject_id"],
    positionals: [{ display: "SUBJECT_ID", desc: "主体 ID", required: true }],
    write: true,
  }),
  http("subject", "delete", "DELETE", "subjects/{subject_id}", "删除主体（软删）", "commands/subject.md:140", {
    slots: ["subject_id"],
    positionals: [{ display: "SUBJECT_ID", desc: "主体 ID", required: true }],
    write: true,
  }),
  http("subject", "status", "POST", "subjects/status", "批量查询审核状态（三态，未知不默认通过）", "commands/subject.md:200", {
    write: true,
  }),
  http("subject", "save-from-resource", "POST", "subjects/from-asset", "从项目资产保存为主体（同资产幂等）", "commands/subject.md:73", {
    write: true,
    positionals: [
      { display: "SP_ID", desc: "项目 ID（也可 --workspace）" },
      { display: "RESOURCE_ID", desc: "项目资产 ID" },
    ],
    bodyParams: [
      { key: "project_id", index: 0 },
      { key: "asset_id", index: 1 },
    ],
  }),
  todo("subject", "batch-details", "批量主体详情", "commands/subject.md:156", "我方无批量详情端点；用 `subject status --set 'subject_ids=[…]'` 拿逐条审核态，或 `subject get` 逐条"),
  todo("subject", "from-resource", "从资源创建主体（含 confirm 流程）", "commands/subject.md:172", "我方只有 `subject save-from-resource`（POST /subjects/from-asset，从项目资产保存、同资产幂等）；无 type+confirm 二次流程"),
  todo("subject", "reset", "重置解析/匹配状态", "commands/subject.md:228", "我方无 reset 端点（ep_id+kind 维度状态重置未实现）；重跑解析用 `episode parse-retry`"),
  todo("resource", "get", "查看单个资源", "commands/resource.md:223", "我方无单资源详情端点；用 `resource generate-list <SP> <RES>`（候选）或 `resource list --workspace <SP> --set kind=scene`"),
  http("resource", "add", "POST", "projects/{project_id}/assets", "新增项目资产（kind=scene|prop|other，角色走 characters）", "commands/resource.md:255", {
    write: true,
    }),
  http("resource", "generate", "POST", "projects/{project_id}/assets/{asset_id}/generate-image", "生成资产参考图（异步，返回 task_id）", "commands/resource.md:317", {
    slots: ["asset_id"],
    positionals: [{ display: "RESOURCE_ID", desc: "项目资产 ID", required: true }],
    write: true,
    paid: true,
    }),
  http("resource", "confirm", "PATCH", "projects/{project_id}/assets/{asset_id}", "确认资产（status=2 定稿）", "commands/resource.md:359", {
    slots: ["asset_id"],
    positionals: [{ display: "RESOURCE_ID", desc: "项目资产 ID", required: true }],
    write: true,
    fixedBody: { status: 2 },
    }),
  http("resource", "unconfirm", "PATCH", "projects/{project_id}/assets/{asset_id}", "取消确认（status=1 退回草稿）", "commands/resource.md:406", {
    slots: ["asset_id"],
    positionals: [{ display: "RESOURCE_ID", desc: "项目资产 ID", required: true }],
    write: true,
    fixedBody: { status: 1 },
    }),
  todo("resource", "batch-confirm", "批量确认", "commands/resource.md:422", "我方无批量确认端点；逐条 `resource confirm <SP> <RES>`（PATCH status=2）"),
  todo("resource", "extract-wait", "阻塞等待提取任务", "commands/resource.md:586", "组合即可：`resource extract-status <ET_ID>` 轮询，或 `task wait <TASK_ID>`（提取任务也落 tasks）"),
  todo("resource", "prompt-template", "生成官方资产提示词空表", "commands/resource.md:145", "xlsx 模板导出端点未落地（待取证）；当前 `--set` 直接提交 JSON"),
  todo("resource", "prompt-sheet-read", "回读资产提示词表", "commands/resource.md:163", "xlsx 回读端点未落地（待取证）；批量导入用 `resource draft-import --set @assets.json`"),
];

// ── 画布（commands/canvas.md）──────────────────────────────────────────
const canvasCommands: CommandSpec[] = [
  http("canvas", "create", "POST", "canvases", "创建画布", "commands/canvas.md:33", {
    write: true,
    positionals: [{ display: "NAME", desc: "画布名称（也可 --name）" }],
    bodyParams: [{ key: "title", index: 0 }],
  }),
  http("canvas", "list", "GET", "canvases", "列出画布", "commands/canvas.md:56", {
    queryKeys: ["page", "page_size"],
  }),
  http("canvas", "get", "GET", "canvases/{canvas_id}", "画布详情（含 node_list）", "commands/canvas.md:78", {
    slots: ["canvas_id"],
    positionals: [{ display: "CANVAS_ID", desc: "画布 ID", required: true }],
  }),
  http("canvas", "edit", "PATCH", "canvases/{canvas_id}", "修改画布", "commands/canvas.md:100", {
    slots: ["canvas_id"],
    positionals: [
      { display: "CANVAS_ID", desc: "画布 ID", required: true },
      { display: "NAME", desc: "新名称（也可 --name）" },
    ],
    bodyParams: [{ key: "title", index: 1 }],
    write: true,
  }),
  http("canvas", "delete", "DELETE", "canvases/{canvas_id}", "删除画布", "commands/canvas.md:122", {
    slots: ["canvas_id"],
    positionals: [{ display: "CANVAS_ID", desc: "画布 ID", required: true }],
    write: true,
  }),
  http("canvas", "template-publish", "POST", "canvases/{canvas_id}/tpls", "把画布发布成模板", "commands/canvas.md:144", {
    slots: ["canvas_id"],
    write: true,
  }),
  http("canvas", "template-list", "GET", "templates", "列出模板", "commands/canvas.md:165", {
    queryKeys: ["page", "page_size"],
  }),
  http("canvas", "template-get", "GET", "templates/{template_id}", "模板详情", "commands/canvas.md:185", {
    slots: ["template_id"],
    positionals: [{ display: "TEMPLATE_ID", desc: "模板 ID", required: true }],
  }),
  http("canvas", "template-apply", "GET", "templates/{template_id}/instantiate", "实例化模板到画布", "commands/canvas.md:202", {
    slots: ["template_id"],
    positionals: [{ display: "TEMPLATE_ID", desc: "模板 ID", required: true }],
    queryKeys: ["canvas_id"],
    write: true,
  }),
  http("canvas", "snapshots", "GET", "canvases/{canvas_id}/snapshots", "列出画布快照（我方端点，竞品无对应子命令）", "commands/canvas.md:220", {
    slots: ["canvas_id"],
    queryKeys: ["page", "page_size"],
  }),
];

// ── 节点 / 连线（commands/node.md、edge.md）──────────────────────────────
const nodeCommands: CommandSpec[] = [
  http("node", "create", "POST", "canvases/{canvas_id}/nodes", "创建节点", "commands/node.md:35", {
    write: true,
    positionals: [
      {
        display: "NODE_TYPE",
        desc: "text|image|video|audio|table|script|asset|clip|director|threeDWorld|group",
        required: true,
      },
    ],
    bodyParams: [{ key: "node_type", index: 0 }],
  }),
  http("node", "batch-create", "POST", "canvases/{canvas_id}/nodes/batch", "批量创建节点", "commands/node.md:161", {
    write: true,
  }),
  http("node", "list", "GET", "canvases/{canvas_id}/nodes", "列出画布节点", "commands/node.md:188", {
    queryKeys: ["page", "page_size"],
  }),
  http("node", "get", "GET", "canvases/{canvas_id}/nodes", "查看单个节点（客户端按 --node/位置参数过滤）", "commands/node.md:210", {
    transform: "nodeById",
    positionals: [{ display: "NODE_ID", desc: "节点 ID（也可 --node）", required: true }],
  }),
  http("node", "edit", "PATCH", "canvases/{canvas_id}/nodes/{node_id}", "修改节点", "commands/node.md:233", {
    slots: ["node_id"],
    positionals: [{ display: "NODE_ID", desc: "节点 ID", required: true }],
    write: true,
  }),
  http("node", "delete", "DELETE", "canvases/{canvas_id}/nodes/{node_id}", "删除节点", "commands/node.md:264", {
    slots: ["node_id"],
    positionals: [{ display: "NODE_ID", desc: "节点 ID", required: true }],
    write: true,
  }),
  http("node", "generate", "POST", "canvases/{canvas_id}/nodes/{node_id}/generate", "节点生成（图/视频/文本，付费）", "commands/node.md:287", {
    slots: [null, "node_id"],
    positionals: [
      { display: "NODE_TYPE", desc: "生成类型", required: true },
      { display: "NODE_ID", desc: "节点 ID（也可 --node）" },
    ],
    write: true,
    paid: true,
  }),
  http("node", "table-import", "POST", "canvases/{canvas_id}/nodes/{node_id}/table/import", "表格节点导入文件", "commands/node.md:386", {
    slots: ["node_id"],
    positionals: [{ display: "NODE_ID", desc: "表格节点 ID", required: true }],
    write: true,
  }),
  http("node", "table-confirm", "POST", "canvases/{canvas_id}/nodes/{node_id}/table/confirm-sheet", "表格节点确认工作表", "commands/node.md:408", {
    slots: ["node_id"],
    positionals: [{ display: "NODE_ID", desc: "表格节点 ID", required: true }],
    write: true,
  }),
  http("node", "edge", "POST", "canvases/{canvas_id}/edges", "建立连线（--left / --right）", "commands/edge.md:8", {
    write: true,
    flagBody: { left: "src_node_id", right: "dst_node_id" },
  }),
];

// ── 组 / 固定组（commands/group.md、pin-group.md）────────────────────────
const groupCommands: CommandSpec[] = [
  http("group", "create", "POST", "canvases/{canvas_id}/groups", "创建组", "commands/group.md:27", {
    write: true,
    positionals: [{ display: "NAME", desc: "组名（也可 --name）" }],
    bodyParams: [{ key: "name", index: 0 }],
  }),
  http("group", "delete", "DELETE", "canvases/{canvas_id}/groups/{group_id}", "删除组", "commands/group.md:86", {
    slots: ["group_id"],
    positionals: [{ display: "GROUP_ID", desc: "组 ID", required: true }],
    write: true,
  }),
  http("group", "template-save", "POST", "canvases/{canvas_id}/groups/{group_id}/templates", "把组存成模板", "commands/group.md:110", {
    slots: ["group_id"],
    positionals: [{ display: "GROUP_ID", desc: "组 ID", required: true }],
    write: true,
  }),
  http("group", "template-list", "GET", "canvases/{canvas_id}/group-templates", "列出组模板", "commands/group.md:136"),
  http("pin-group", "create", "PUT", "canvases/{canvas_id}/pin-groups/{slot}", "创建/替换固定组成员（按 slot）", "commands/pin-group.md:19", {
    slots: ["slot"],
    positionals: [{ display: "SLOT", desc: "固定组槽位", required: true }],
    write: true,
  }),
  http("pin-group", "delete", "DELETE", "canvases/{canvas_id}/pin-groups/{slot}", "删除固定组", "commands/pin-group.md:42", {
    slots: ["slot"],
    positionals: [{ display: "PIN_GROUP_ID", desc: "固定组槽位", required: true }],
    write: true,
  }),
  http("pin-group", "list", "GET", "canvases/{canvas_id}/pin-groups", "列出固定组（我方端点，竞品无对应子命令）", "commands/pin-group.md:63"),
  todo("group", "execute", "组执行（整组跑生成）", "commands/group.md:53", "canvas 域无 group execute 端点；逐节点 `node generate <TYPE> <NODE_ID>` 提交"),
  todo("group", "template-get", "查看单个组模板", "commands/group.md:157", "我方只有 `group template-list`（GET /canvas/canvases/:id/group-templates 列表），无单模板端点"),
];

// ── 素材 / 脚本（commands/material.md、script.md）────────────────────────
const materialCommands: CommandSpec[] = [
  http("material", "add", "POST", "canvases/{canvas_id}/materials", "添加画布素材", "commands/material.md:39", {
    write: true,
    positionals: [{ display: "FILE_ID", desc: "文件 ID", required: true }],
    bodyParams: [{ key: "file_id", index: 0 }],
  }),
  http("material", "list", "GET", "canvases/{canvas_id}/materials", "列出画布素材", "commands/material.md:113", {
    queryKeys: ["page", "page_size"],
  }),
  http("material", "delete", "POST", "canvases/{canvas_id}/materials/batch-delete", "批量删除素材", "commands/material.md:149", {
    write: true,
  }),
  http("script", "storyboard", "POST", "canvases/{canvas_id}/nodes/{node_id}/storyboard-parse", "从文本节点拆分镜", "commands/script.md:41", {
    slots: ["node_id"],
    write: true,
    paid: true,
  }),
  http("script", "asset-extract", "POST", "canvases/{canvas_id}/nodes/{node_id}/asset-extraction", "从文本节点提取资产", "commands/script.md:64", {
    slots: ["node_id"],
    write: true,
    paid: true,
  }),
  http("script", "asset-match", "POST", "canvases/{canvas_id}/nodes/{node_id}/storyboard-asset-match", "分镜资产匹配", "commands/script.md:80", {
    slots: ["node_id"],
    write: true,
    paid: true,
  }),
  http("script", "rematch", "POST", "canvases/{canvas_id}/nodes/{node_id}/storyboard-asset-rematch", "重新匹配", "commands/script.md:96", {
    slots: ["node_id"],
    write: true,
    paid: true,
  }),
  http("script", "cancel", "POST", "canvases/{canvas_id}/nodes/{node_id}/storyboard-asset-match/cancel", "取消匹配", "commands/script.md:112", {
    slots: ["node_id"],
    write: true,
  }),
  http("script", "optimize", "POST", "canvases/{canvas_id}/nodes/{node_id}/script-optimization", "脚本优化", "commands/script.md:128", {
    slots: ["node_id"],
    write: true,
    paid: true,
  }),
  todo("material", "batch-add", "批量添加素材", "commands/material.md:86", "我方无批量加素材端点；用 `node batch-create` 或循环 `material add`"),
  todo("material", "get", "查看素材信息", "commands/material.md:131", "我方无单条素材端点；用 `material list --canvas <ID> --set page=1` 过滤"),
  todo("material", "confirm", "确认素材", "commands/material.md:167", "我方素材无确认态（POST /canvas/.../materials 落库即用）"),
];

// ── 导出（commands/export.md）──────────────────────────────────────────
const exportCommands: CommandSpec[] = [
  http("export", "", "POST", "projects/{project_id}/episodes/{episode_id}/exports", "导出单集", "commands/export.md:23", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
    write: true,
  }),
  http("export", "get", "GET", "projects/{project_id}/episodes/{episode_id}/exports/{export_id}", "查看导出任务", "commands/export.md:70", {
    slots: ["episode_id", "export_id"],
    positionals: [
      { display: "EPISODE_ID", desc: "剧集 ID", required: true },
      { display: "EXPORT_ID", desc: "导出 ID", required: true },
    ],
  }),
  http("export", "merge", "POST", "projects/{project_id}/episodes/{episode_id}/timeline/export", "合并导出整集", "commands/export.md:45", {
    slots: ["episode_id"],
    positionals: [{ display: "EPISODE_ID", desc: "剧集 ID", required: true }],
    write: true,
  }),
  todo("export", "download", "下载导出产物", "commands/export.md:86", "先 `export merge <EP> --workspace <SP>` 提交，再 `export get <EP> <XID>` 轮询拿产物；无独立下载端点"),
];

// ── 团队（commands/team.md）────────────────────────────────────────────
const teamCommands: CommandSpec[] = [
  http("team", "info", "GET", "cam/team/info", "团队信息", "commands/team.md:19"),
  http("team", "permission", "GET", "cam/permission/user", "当前成员权限上下文", "commands/team.md:41"),
];

// ── 深链（commands/deeplink.md；纯客户端，不读凭据不发请求）────────────────
const deeplinkCommands: CommandSpec[] = (
  [
    ["canvas", "画布深链", ":37"],
    ["task", "任务中心深链", ":62"],
    ["pricing", "充值弹窗深链", ":84"],
    ["credits", "积分明细入口深链", ":107"],
    ["project", "项目总览深链", ":124"],
    ["episode", "剧集列表/单集分镜深链", ":148"],
    ["asset", "项目资产页深链", ":170"],
    ["asset-confirm", "资产确认页深链", ":188"],
    ["asset-extract", "资产确认页深链（兼容名）", ":208"],
    ["asset-result", "资产主形态结果页深链", ":225"],
    ["asset-lib", "我的资产库深链", ":242"],
  ] as const
).map(([cmd, summary, line]) =>
  local("deeplink", cmd, summary, `commands/deeplink.md${line}`, "deeplink"),
);

// ── 幂等账本（commands/ledger.md；纯本地，离线可用）──────────────────────
const ledgerCommands: CommandSpec[] = [
  local("ledger", "list", "列出本地幂等账本条目", "commands/ledger.md:34", "ledger-list"),
  local("ledger", "show", "查看单条账本与成因", "commands/ledger.md:58", "ledger-show", {
    positionals: [{ display: "KEY", desc: "幂等键", required: true }],
  }),
  local("ledger", "resolve", "解除一条 in_doubt（人工复核确认未生效后）", "commands/ledger.md:76", "ledger-resolve", {
    positionals: [{ display: "KEY", desc: "幂等键", required: true }],
  }),
];

// ── 依赖其它批次的命令组：只登记骨架 ─────────────────────────────────────
const pendingCommands: CommandSpec[] = [
  // 智能体画布会话（agent.controller 已有 sessions 端点 → 前三条 ready）
  http("agent", "session-create", "POST", "canvas/canvases/{canvas_id}/chat/sessions", "创建智能体会话", "commands/agent.md:27", {
    write: true,
    positionals: [{ display: "NAME", desc: "会话名（也可 --name）" }],
    bodyParams: [{ key: "title", index: 0 }],
  }),
  http("agent", "session-list", "GET", "canvas/canvases/{canvas_id}/chat/sessions", "列出智能体会话", "commands/agent.md:50", {
    queryKeys: ["page", "page_size"],
  }),
  http("agent", "session-delete", "DELETE", "canvas/canvases/{canvas_id}/chat/sessions/{session_id}", "删除智能体会话", "commands/agent.md:71", {
    slots: ["session_id"],
    positionals: [{ display: "SESSION_ID", desc: "会话 ID", required: true }],
    write: true,
  }),
  todo("agent", "enter", "进入交互式会话", "commands/agent.md:93", "交互式 REPL 未实现；用 `agent session-create --canvas <ID>` + `POST /v1/canvas/canvases/:id/chat/sessions/:sid/messages`"),
  todo("agent", "run", "运行一轮对话", "commands/agent.md:135", "`POST /agent/task/chat` 是 SSE 流（CLI 未接流式）；非交互场景用 canvas chat 的 REST 消息端点"),
  // 小说（我方只有表，无 controller）
  todo("novel", "config", "小说改写配置", "commands/novel.md:59", "我方无 novel/config 端点；可配置项直接走 `novel create --set key=value`，现有任务用 `novel get <NT_ID>` 查看"),
  http("novel", "create", "POST", "novel", "创建小说改写任务（--set title=… / source_text=…）", "commands/novel.md:84", {
    write: true,
    }),
  http("novel", "analyze", "POST", "novel/{nt_id}/content-analysis", "触发内容分析（世界/角色/章节）", "commands/novel.md:240", {
    slots: ["nt_id"],
    positionals: [{ display: "NT_ID", desc: "小说任务 ID（先 novel create）", required: true }],
    write: true,
    paid: true,
    }),
  http("novel", "list", "GET", "novel/list", "小说任务列表", "commands/novel.md:391", {
    queryKeys: ["page", "page_size", "status", "keyword"],
    }),
  http("novel", "get", "GET", "novel/{nt_id}", "小说任务详情", "commands/novel.md:414", {
    slots: ["nt_id"],
    positionals: [{ display: "NT_ID", desc: "小说任务 ID", required: true }],
    }),
  http("novel", "finalize", "POST", "novel/{nt_id}/finalize", "小说定稿（定稿后才能作为制片工坊拆集源）", "commands/novel.md:663", {
    slots: ["nt_id"],
    positionals: [{ display: "NT_ID", desc: "小说任务 ID", required: true }],
    write: true,
    }),
  // 市场 / 广告 / 重绘 / AI 工具（后续批次）
  http("market", "list", "GET", "market/scripts", "市场剧本列表", "commands/market.md:27", {
    queryKeys: ["page", "page_size", "keyword", "category_id", "sort"],
    }),
  http("market", "get", "GET", "market/scripts/{nm_id}/detail", "市场剧本详情", "commands/market.md:51", {
    slots: ["nm_id"],
    positionals: [{ display: "NM_ID", desc: "市场剧本 ID", required: true }],
    }),
  http("market", "mine", "GET", "market/creator/works", "我的上架作品", "commands/market.md:99", {
    queryKeys: ["page", "page_size", "status"],
    }),
  todo("ad", "info", "广告信息", "commands/ad.md:33", "ad 域本轮由队友落地（modules/ad）；CLI 接线放下一轮，当前无端点"),
  todo("ad", "save", "保存广告素材", "commands/ad.md:49", "同上：modules/ad 落地后接；当前无端点"),
  todo("ad", "plan", "广告方案", "commands/ad.md:141", "同上：modules/ad 落地后接；当前无端点"),
  todo("redraw", "info", "重绘信息", "commands/redraw.md:27", "redraw 域本轮由队友落地（modules/redraw）；CLI 接线放下一轮，当前无端点"),
  todo("redraw", "create", "创建重绘", "commands/redraw.md:68", "同上：modules/redraw 落地后接；当前无端点"),
  todo("ai", "upscale", "AI 放大", "commands/ai.md:29", "我方无 ai 工具独立端点；后处理能力在工具箱：`POST /generations`（mode 取自 GET /generations/tools）"),
  todo("ai", "subtitle-erase", "去字幕", "commands/ai.md:45", "用工具箱入口：mode=de_subtitle_auto|de_subtitle_region（`GET /generations/tools` 目录；Web 侧 /create/video-upscale）"),
  todo("clip", "create", "创建剪辑", "commands/clip.md:23", "clip 无独立端点（画布有 clip 节点与 timeline clips）；用 `node create clip` + `PUT .../timeline`"),
  todo("clip", "crop", "裁剪", "commands/clip.md:45", "同上：无独立裁剪端点，走画布节点/timeline"),
  todo("voice", "list", "音色列表", "commands/voice.md:17", "voice 端点未落地；音色相关在 /op 与 resource voice-*（两者均未落地），待取证"),
  todo("sync-fm", "", "同步到 Filmora", "commands/sync-fm.md:17", "Filmora 外部集成未落地（无端点、无凭据契约）；待取证"),
];

/** 全部命令（顺序即 --help 的分组顺序） */
export const COMMANDS: readonly CommandSpec[] = [
  ...sessionCommands,
  ...workflowCommands,
  ...modelCommands,
  ...taskCommands,
  ...creditsCommands,
  ...workspaceCommands,
  ...episodeCommands,
  ...storyboardCommands,
  ...uploadCommands,
  ...resourceCommands,
  ...assetLibCommands,
  ...canvasCommands,
  ...nodeCommands,
  ...groupCommands,
  ...materialCommands,
  ...exportCommands,
  ...deeplinkCommands,
  ...ledgerCommands,
  ...teamCommands,
  ...pendingCommands,
];

/** 组的展示顺序与一句话说明（`--help` 顶层用） */
export const GROUP_ORDER: readonly string[] = [
  "login",
  "logout",
  "account",
  "env",
  "cache",
  "version",
  "skill",
  "workflow",
  "model",
  "task",
  "credits",
  "workspace",
  "episode",
  "storyboard",
  "upload",
  "resource",
  "subject",
  "asset-lib",
  "file",
  "canvas",
  "node",
  "group",
  "pin-group",
  "material",
  "script",
  "export",
  "deeplink",
  "ledger",
  "team",
  "agent",
  "novel",
  "market",
  "ad",
  "redraw",
  "ai",
  "clip",
  "voice",
  "sync-fm",
];

export function findCommand(group: string, cmd: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.group === group && c.cmd === cmd);
}

export function commandsOfGroup(group: string): readonly CommandSpec[] {
  return COMMANDS.filter((c) => c.group === group);
}

export function isKnownGroup(group: string): boolean {
  return GROUP_ORDER.includes(group) || COMMANDS.some((c) => c.group === group);
}

/** 命令是否需要写语义（写命令才接受 --dry-run / --idempotency-key） */
export function isWriteCommand(spec: CommandSpec): boolean {
  return spec.write === true || spec.method === "POST" || spec.method === "PUT" || spec.method === "PATCH" || spec.method === "DELETE";
}
