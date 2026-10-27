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
  | "ledger-list"
  | "ledger-show"
  | "ledger-resolve"
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
  http("task", "download", "POST", "tasks/batch-download", "获取任务产物下载信息（不落盘）", "commands/task.md:165", {
    write: true,
    positionals: [{ display: "TASK_ID", desc: "任务 ID（可重复）", required: true }],
    bodyParams: [{ key: "task_ids", index: 0, as: "array" }],
  }),
  todo("task", "regenerate", "用原任务信息重新提交生成", "commands/task.md:143", "我方无重新生成端点（tasks.controller.ts 只有 cancel/retry）"),
  todo("task", "delete", "删除任务记录", "commands/task.md:195", "我方无删除任务端点（tasks.controller.ts:9-77）"),
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
  todo("episode", "delete", "删除剧集", "commands/episode.md:126", "我方无删除剧集端点（script.controller.ts 无 DELETE episodes）"),
  todo("episode", "batch-create", "批量建集", "commands/episode.md:142", "我方只有按 count 新增（POST /projects/:id/episodes），无批量载荷端点"),
  todo("episode", "split-list", "查看拆集结果列表", "commands/episode.md:176", "我方无独立拆集结果端点（拆集结果直接落 episodes）"),
  todo("episode", "split-delete", "删除拆集结果", "commands/episode.md:195", "我方无拆集结果端点"),
  todo("episode", "prompt-templates", "提示词模板目录", "commands/episode.md:211", "依赖「提示词模板」批次未落地（无模板目录端点）"),
  todo("episode", "match-resources", "提交批量资产匹配组合任务", "commands/episode.md:261", "依赖 asset-core 批次未落地（无 match-resources 端点）"),
  todo("episode", "save-resource-matches", "保存资产匹配结果", "commands/episode.md:368", "依赖 asset-core 批次未落地"),
  todo("episode", "parse", "逐集解析角色/场景/道具", "commands/episode.md:389", "我方抽取链是项目级 POST /extraction/tasks（resource 族口径），无 episode 级 parse 端点"),
  todo("episode", "parse-retry", "重试解析", "commands/episode.md:407", "同上：无 episode 级解析任务端点（可对项目级任务用 resource extract-redo）"),
  todo("episode", "parse-result", "查看解析结果", "commands/episode.md:429", "同上：解析结果落在 /extraction/drafts，用 resource draft-list 查"),
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
  todo("storyboard", "add", "新增分镜", "commands/storyboard.md:93", "我方无单条新增分镜端点（只有 AI 生成 POST .../storyboards/generate）"),
  todo("storyboard", "delete", "删除分镜", "commands/storyboard.md:137", "我方无删除分镜端点"),
  todo("storyboard", "batch-delete", "批量删除分镜", "commands/storyboard.md:153", "我方无删除分镜端点"),
  todo("storyboard", "num-update", "重排分镜号", "commands/storyboard.md:170", "我方无分镜号重排端点"),
  todo("storyboard", "link-draft", "关联草稿", "commands/storyboard.md:186", "依赖分镜草稿批次未落地"),
  todo("storyboard", "ext", "分镜扩展参数", "commands/storyboard.md:202", "我方无 ext 端点"),
  todo("storyboard", "total-list", "跨集全量分镜", "commands/storyboard.md:220", "我方无跨集全量分镜端点"),
  todo("storyboard", "batch-add", "批量新增分镜", "commands/storyboard.md:236", "我方无批量新增端点"),
  todo("storyboard", "prompt-template", "生成官方分镜提示词空表", "commands/storyboard.md:263", "依赖 xlsx 模板批次未落地"),
  todo("storyboard", "sheet-read", "回读分镜提示词表", "commands/storyboard.md:281", "依赖 xlsx 模板批次未落地"),
  todo("storyboard", "draft-import", "导入分镜草稿", "commands/storyboard.md:302", "依赖分镜草稿批次未落地"),
  todo("storyboard", "draft-delete", "删除分镜草稿", "commands/storyboard.md:331", "依赖分镜草稿批次未落地"),
  todo("storyboard", "draft-batch-update", "批量更新分镜草稿", "commands/storyboard.md:350", "依赖分镜草稿批次未落地"),
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
  todo("asset-lib", "dir-create", "创建资产目录", "commands/asset-lib.md:41", "我方 POST /asset-folders 存在，但目录改名/删除端点缺失，三合一命令族暂不开放"),
  todo("asset-lib", "get", "查看资产详情", "commands/asset-lib.md:121", "我方无 GET /assets/:id（只有列表 + PATCH/DELETE）"),
  todo("asset-lib", "import", "导入资产", "commands/asset-lib.md:137", "依赖资产库批次未落地"),
  todo("asset-lib", "search", "搜索资产", "commands/asset-lib.md:185", "我方无资产搜索端点（列表无 q 参数）"),
  todo("asset-lib", "resource-list", "asset-lib resource list", "commands/asset-lib.md:201", "依赖 asset-core 批次未落地"),
  todo("asset-lib", "tag-add", "资产打标签", "commands/asset-lib.md:249", "我方无资产标签端点"),
  todo("asset-lib", "move", "移动资产到目录", "commands/asset-lib.md:281", "我方无资产移动端点"),
  todo("asset-lib", "batch-delete", "批量删除资产", "commands/asset-lib.md:297", "我方无批量删除资产端点（canvas 素材有，asset 没有）"),
  todo("file", "metadata", "查看文件元数据", "commands/file.md:21", "我方无文件元数据端点"),
  todo("file", "object", "查看对象", "commands/file.md:43", "我方无对象端点"),
  todo("file", "sign-url", "获取文件签名 URL", "commands/file.md:65", "签名 URL 内嵌在任务/资源响应里（tasks.service downloadUrl），无独立端点"),
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
  todo("subject", "batch-details", "批量主体详情", "commands/subject.md:156", "我方无批量详情端点（只有 POST /subjects/status 返回逐条审核态）；可用 subject get 逐条取"),
  todo("subject", "from-resource", "从资源创建主体（含 confirm 流程）", "commands/subject.md:172", "我方只有 POST /subjects/from-asset（从项目资产保存），无竞品 from-resource 的 type+confirm 流程"),
  todo("subject", "reset", "重置解析/匹配状态", "commands/subject.md:228", "我方无 reset 端点（ep_id+kind 维度的状态重置未实现）"),
  todo("resource", "get", "查看单个资源", "commands/resource.md:223", "依赖 asset-core 批次的单资源读取端点未落地"),
  todo("resource", "add", "新增资源", "commands/resource.md:255", "依赖 asset-core 批次未落地"),
  todo("resource", "generate", "生成资产图", "commands/resource.md:317", "依赖 asset-core 批次未落地"),
  todo("resource", "confirm", "确认资产", "commands/resource.md:359", "依赖 asset-core 批次未落地"),
  todo("resource", "unconfirm", "取消确认", "commands/resource.md:406", "依赖 asset-core 批次未落地"),
  todo("resource", "batch-confirm", "批量确认", "commands/resource.md:422", "依赖 asset-core 批次未落地"),
  todo("resource", "extract-wait", "阻塞等待提取任务", "commands/resource.md:586", "用 `task wait`/轮询 extract-status 组合即可，本批不单独实现"),
  todo("resource", "prompt-template", "生成官方资产提示词空表", "commands/resource.md:145", "依赖 xlsx 模板批次未落地"),
  todo("resource", "prompt-sheet-read", "回读资产提示词表", "commands/resource.md:163", "依赖 xlsx 模板批次未落地"),
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
  todo("group", "execute", "组执行（整组跑生成）", "commands/group.md:53", "依赖组执行批次未落地（canvas 无 group execute 端点）"),
  todo("group", "template-get", "查看单个组模板", "commands/group.md:157", "我方无 GET 单个组模板端点"),
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
  todo("material", "batch-add", "批量添加素材", "commands/material.md:86", "我方无批量添加素材端点"),
  todo("material", "get", "查看素材信息", "commands/material.md:131", "我方无 GET 单条素材端点"),
  todo("material", "confirm", "确认素材", "commands/material.md:167", "我方无素材确认端点"),
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
  todo("export", "download", "下载导出产物", "commands/export.md:86", "我方合并产物走 timeline export 轮询返回 storage key，无独立下载端点"),
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
  todo("agent", "enter", "进入交互式会话", "commands/agent.md:93", "交互式 REPL 未实现（本批只做非交互命令）"),
  todo("agent", "run", "运行一轮对话", "commands/agent.md:135", "依赖 agent 批次未落地（POST /agent/task/chat 为 SSE 流，未接入）"),
  // 小说（我方只有表，无 controller）
  todo("novel", "config", "小说改写配置", "commands/novel.md:59", "依赖 novel 批次未落地（packages/db 有 novels 表，apps/api 无 novel 模块）"),
  todo("novel", "create", "创建小说改写任务", "commands/novel.md:84", "依赖 novel 批次未落地"),
  todo("novel", "analyze", "分析文本", "commands/novel.md:240", "依赖 novel 批次未落地"),
  todo("novel", "list", "小说任务列表", "commands/novel.md:391", "依赖 novel 批次未落地"),
  todo("novel", "get", "小说任务详情", "commands/novel.md:414", "依赖 novel 批次未落地"),
  todo("novel", "finalize", "定稿", "commands/novel.md:663", "依赖 novel 批次未落地"),
  // 市场 / 广告 / 重绘 / AI 工具（后续批次）
  todo("market", "list", "市场作品列表", "commands/market.md:27", "依赖 market 批次未落地（只有 market_works 表）"),
  todo("market", "get", "市场作品详情", "commands/market.md:51", "依赖 market 批次未落地"),
  todo("market", "mine", "我的上架作品", "commands/market.md:99", "依赖 market 批次未落地"),
  todo("ad", "info", "广告信息", "commands/ad.md:33", "依赖 ad 批次未落地（只有 campaigns 表）"),
  todo("ad", "save", "保存广告素材", "commands/ad.md:49", "依赖 ad 批次未落地"),
  todo("ad", "plan", "广告方案", "commands/ad.md:141", "依赖 ad 批次未落地"),
  todo("redraw", "info", "重绘信息", "commands/redraw.md:27", "依赖 redraw 批次未落地"),
  todo("redraw", "create", "创建重绘", "commands/redraw.md:68", "依赖 redraw 批次未落地"),
  todo("ai", "upscale", "AI 放大", "commands/ai.md:29", "依赖 ai 工具批次未落地"),
  todo("ai", "subtitle-erase", "去字幕", "commands/ai.md:45", "依赖 ai 工具批次未落地"),
  todo("clip", "create", "创建剪辑", "commands/clip.md:23", "依赖 clip 批次未落地"),
  todo("clip", "crop", "裁剪", "commands/clip.md:45", "依赖 clip 批次未落地"),
  todo("voice", "list", "音色列表", "commands/voice.md:17", "依赖 voice 批次未落地（我方无 voice 端点）"),
  todo("sync-fm", "", "同步到 Filmora", "commands/sync-fm.md:17", "依赖外部集成批次未落地"),
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
