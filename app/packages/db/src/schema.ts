import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// 数据模型与 docs/02-architecture/database.md 同步（P1 核心域）
// 约定：主键雪花 ID（应用层生成，JS 侧用 string 防精度丢失）；枚举 smallint + 应用常量。

const pk = () => bigint("id", { mode: "bigint" }).primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ── 账号与空间 ─────────────────────────────────────────────
export const users = pgTable("users", {
  id: pk(),
  nickname: text("nickname").notNull().default(""),
  avatarUri: text("avatar_uri"),
  region: text("region").notNull().default("CN"),
  dataCenter: text("data_center").notNull().default("sz"), // sz|eus|eop|sgp（RE domainMap）
  status: smallint("status").notNull().default(1), // 1 正常 2 封禁
  ageDeclaredAt: timestamp("age_declared_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /** 注销时间；保留 30 天后由维护任务物理清理（PRD F1） */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  /** 新手引导是否已看过（PRD 增补 §3，用于回流引导条与激活口径） */
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const identities = pgTable(
  "identities",
  {
    id: pk(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(), // phone|wechat|apple
    phoneHash: text("phone_hash"), // HMAC-SHA256(phone)，等值查询/唯一
    phoneCipher: text("phone_cipher"), // AES-GCM(phone)，展示/发码
    externalId: text("external_id"), // 开放平台 unionid；provider=phone 时 NULL
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_identities_phone").on(t.provider, t.phoneHash),
    uniqueIndex("uq_identities_external").on(t.provider, t.externalId),
    index("idx_identities_user").on(t.userId),
  ],
);

export const spaces = pgTable("spaces", {
  id: pk(),
  ownerUserId: bigint("owner_user_id", { mode: "bigint" })
    .notNull()
    .references(() => users.id),
  type: smallint("type").notNull().default(1), // 1 个人 2 团队(Ph3)
  name: text("name").notNull().default("我的空间"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const spaceMembers = pgTable(
  "space_members",
  {
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    role: smallint("role").notNull().default(3), // 1 owner 2 admin 3 member
    creditsQuota: integer("credits_quota").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] })],
);

// ── 运营（Alpha 邀请/等待名单；admin 独立鉴权）──────────────
export const adminUsers = pgTable("admin_users", {
  id: pk(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("ops"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const inviteCodes = pgTable(
  "invite_codes",
  {
    id: pk(),
    code: text("code").notNull().unique(),
    credits: integer("credits").notNull().default(0),
    maxUses: integer("max_uses").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: smallint("status").notNull().default(1), // 1 有效 2 停用 3 耗尽
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => adminUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_invite_codes_status").on(t.status, t.expiresAt)],
);

// ── 积分账户与流水（database §4；对账不变式见 docs）────────
export const creditAccounts = pgTable(
  "credit_accounts",
  {
    spaceId: bigint("space_id", { mode: "bigint" })
      .primaryKey()
      .references(() => spaces.id),
    balance: integer("balance").notNull().default(0),
    frozen: integer("frozen").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("ck_credit_accounts_balance", sql`${t.balance} >= 0`),
    check("ck_credit_accounts_frozen", sql`${t.frozen} >= 0`),
  ],
);

export const creditFlows = pgTable(
  "credit_flows",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    // delta=可用余额变动；frozen_delta=冻结额变动；不写 expire（Alpha/Beta 无有效期）
    delta: integer("delta").notNull(),
    frozenDelta: integer("frozen_delta").notNull().default(0),
    kind: text("kind").notNull(), // recharge|gift|freeze|settle|unfreeze|adjust|refund
    refTaskId: bigint("ref_task_id", { mode: "bigint" }),
    refOrderId: bigint("ref_order_id", { mode: "bigint" }),
    refCodeId: bigint("ref_code_id", { mode: "bigint" }),
    balanceAfter: integer("balance_after").notNull(),
    memo: text("memo"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_flows_space").on(t.spaceId, t.createdAt.desc())],
);

export const inviteRedemptions = pgTable(
  "invite_redemptions",
  {
    id: pk(),
    codeId: bigint("code_id", { mode: "bigint" })
      .notNull()
      .references(() => inviteCodes.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    flowId: bigint("flow_id", { mode: "bigint" }).references(() => creditFlows.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_invite_redemptions").on(t.codeId, t.spaceId)],
);

export const waitlistEntries = pgTable("waitlist_entries", {
  id: pk(),
  phoneHash: text("phone_hash").notNull().unique(), // HMAC-SHA256，与 identities 同口径
  source: text("source").notNull().default("landing"),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ── 模型目录与计价（database §2；字段对齐 RE 46 模型目录）───
export const models = pgTable(
  "models",
  {
    id: pk(),
    vendor: text("vendor").notNull(), // volcengine|aliyun|kling|vidu|minimax|deepseek|tomoviee|self
    name: text("name").notNull().unique(), // 协议层标识
    displayName: text("display_name").notNull(),
    description: text("description").notNull().default(""),
    logo: text("logo").notNull().default(""),
    capability: text("capability").notNull(), // video|image|text|speech|music
    types: text("types").array().notNull().default(sql`'{}'::text[]`),
    tags: jsonb("tags").notNull().default([]),
    promotions: jsonb("promotions").notNull().default([]),
    adapterCode: text("adapter_code").notNull(),
    visible: boolean("visible").notNull().default(true),
    needVip: boolean("need_vip").notNull().default(false),
    audioVideoSupport: boolean("audio_video_support").notNull().default(false),
    sort: integer("sort").notNull().default(100),
    modeOrder: jsonb("mode_order").notNull().default({}),
    modes: jsonb("modes").notNull().default({}),
    sceneModes: jsonb("scene_modes").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_models_visible_sort").on(t.visible, t.sort)],
);

export const modelPrices = pgTable(
  "model_prices",
  {
    id: pk(),
    modelId: bigint("model_id", { mode: "bigint" })
      .notNull()
      .references(() => models.id),
    mode: text("mode").notNull(),
    resolution: text("resolution").notNull().default(""),
    durationS: integer("duration_s"), // NULL=按次；非空=按秒档
    credits: integer("credits").notNull(),
    strikeCredits: integer("strike_credits"),
    memberCredits: integer("member_credits"), // Beta VIP 启用
    timeLimitedCredits: integer("time_limited_credits"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_model_prices").on(t.modelId, t.mode, t.resolution, t.durationS),
    index("idx_model_prices_model").on(t.modelId, t.mode),
  ],
);

// ── 任务脊柱（database §3）────────────────────────────────
export const tasks = pgTable(
  "tasks",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    episodeId: bigint("episode_id", { mode: "bigint" }), // P1' 建 episodes 后加 FK
    shotId: bigint("shot_id", { mode: "bigint" }), // P1' 建 storyboards 后加 FK
    attemptNo: integer("attempt_no").notNull().default(1),
    originTaskId: bigint("origin_task_id", { mode: "bigint" }), // 重试链；P1' 加自引用 FK
    capability: text("capability").notNull(),
    mode: text("mode").notNull(),
    scene: text("scene"), // script_to_scene_refer|storyboard_reference_video
    modelId: bigint("model_id", { mode: "bigint" })
      .notNull()
      .references(() => models.id),
    input: jsonb("input").notNull(),
    options: jsonb("options").notNull(),
    status: smallint("status").notNull().default(1), // 1 PENDING … 7 REVIEW_REJECTED
    progress: smallint("progress").notNull().default(0),
    error: jsonb("error"),
    vendorTaskId: text("vendor_task_id"),
    results: jsonb("results"),
    creditsFrozen: integer("credits_frozen").notNull().default(0),
    creditsSettled: integer("credits_settled").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    dedupeKey: text("dedupe_key"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    expireAt: timestamp("expire_at", { withTimezone: true }), // 结果保留 90 天
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_tasks_dedupe")
      .on(t.dedupeKey, t.spaceId)
      .where(sql`${t.dedupeKey} is not null`),
    index("idx_tasks_shot").on(t.shotId, t.attemptNo.desc()),
    index("idx_tasks_space_status").on(t.spaceId, t.status, t.createdAt.desc()),
    index("idx_tasks_polling")
      .on(t.id, t.status)
      .where(sql`${t.status} in (1, 2, 6)`),
    index("idx_tasks_expire").on(t.expireAt),
  ],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: pk(),
    taskId: bigint("task_id", { mode: "bigint" })
      .notNull()
      .references(() => tasks.id),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_task_events_task").on(t.taskId, t.createdAt.desc())],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: pk(),
    key: text("key").notNull(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    requestHash: text("request_hash").notNull(),
    responseBody: jsonb("response_body"),
    expireAt: timestamp("expire_at", { withTimezone: true }).notNull(), // 创建后 5min
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_idempotency_key_space").on(t.key, t.spaceId),
    index("idx_idem_expire").on(t.expireAt),
  ],
);

// ── 资产（database §5；P1' 剧本流水线先用到 image/portrait）───
export const assetFolders = pgTable(
  "asset_folders",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    parentId: bigint("parent_id", { mode: "bigint" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_asset_folders_space").on(t.spaceId)],
);

export const assets = pgTable(
  "assets",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    kind: text("kind").notNull(), // image|video|audio
    uri: text("uri").notNull(),
    previewUri: text("preview_uri"),
    sourceTaskId: bigint("source_task_id", { mode: "bigint" }).references(() => tasks.id),
    folderId: bigint("folder_id", { mode: "bigint" }).references(() => assetFolders.id),
    name: text("name").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    meta: jsonb("meta").notNull().default({}),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_assets_space").on(t.spaceId, t.kind, t.createdAt.desc()),
    index("idx_assets_tags").using("gin", t.tags),
  ],
);

// ── 剧本流水线（database §6；MVP 旗舰，PRD F2）─────────────
export const scriptProjects = pgTable(
  "script_projects",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    title: text("title").notNull(),
    genre: text("genre"),
    dramaType: smallint("drama_type").notNull().default(1), // 1 国内仿真人剧 2 海外仿真人剧 3 2D/3D动漫
    ratio: text("ratio").notNull().default("9:16"),
    sourceType: smallint("source_type").notNull().default(1), // 1novel 2idea 3script 4fission
    sourceText: text("source_text"),
    /** 上传剧本的原始文件名（内容已解析进 source_text；仅留痕展示） */
    sourceFileName: text("source_file_name"),
    status: smallint("status").notNull().default(1),
    /** 作品归档时间（PRD 增补 §1.2：作品=项目，归档为软标记） */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** 是否为示例作品（只读模板，可复制为我的项目） */
    isSample: smallint("is_sample").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_script_projects_space").on(t.spaceId, t.createdAt.desc())],
);

export const episodes = pgTable(
  "episodes",
  {
    id: pk(),
    projectId: bigint("project_id", { mode: "bigint" })
      .notNull()
      .references(() => scriptProjects.id),
    epNo: integer("ep_no").notNull(),
    title: text("title"),
    synopsis: text("synopsis"), // 大纲梗概（PRD F2②）
    scriptText: text("script_text"),
    status: smallint("status").notNull().default(1), // 1草稿 2确认
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_episodes_project_no").on(t.projectId, t.epNo)],
);

export const projectAssets = pgTable(
  "project_assets",
  {
    id: pk(),
    projectId: bigint("project_id", { mode: "bigint" })
      .notNull()
      .references(() => scriptProjects.id),
    kind: text("kind").notNull(), // character|scene|prop
    name: text("name").notNull(),
    description: text("description"),
    prompt: text("prompt"),
    refImageUri: text("ref_image_uri"),
    sourceTaskId: bigint("source_task_id", { mode: "bigint" }).references(() => tasks.id),
    portraitAssetId: bigint("portrait_asset_id", { mode: "bigint" }).references(() => assets.id),
    status: smallint("status").notNull().default(1), // 1草稿 2已定稿
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_project_assets_project").on(t.projectId, t.kind, t.status)],
);

export const storyboards = pgTable(
  "storyboards",
  {
    id: pk(),
    episodeId: bigint("episode_id", { mode: "bigint" })
      .notNull()
      .references(() => episodes.id),
    shotNo: integer("shot_no").notNull(),
    shotDesc: text("shot_desc"),
    videoPrompt: text("video_prompt"),
    durationS: integer("duration_s"),
    ratio: text("ratio"),
    resolution: text("resolution"),
    status: smallint("status").notNull().default(1), // 1草稿 2确认 3已投递 4出图 5出片
    imageTaskId: bigint("image_task_id", { mode: "bigint" }),
    videoTaskId: bigint("video_task_id", { mode: "bigint" }),
    /** P9：分镜首帧/尾帧（3D 导演台定格图上传后的 storage key，非签名 URL） */
    firstFrameUri: text("first_frame_uri"),
    lastFrameUri: text("last_frame_uri"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_storyboards_episode_shot").on(t.episodeId, t.shotNo)],
);

export const storyboardAssets = pgTable(
  "storyboard_assets",
  {
    storyboardId: bigint("storyboard_id", { mode: "bigint" })
      .notNull()
      .references(() => storyboards.id),
    projectAssetId: bigint("project_asset_id", { mode: "bigint" })
      .notNull()
      .references(() => projectAssets.id),
  },
  (t) => [primaryKey({ columns: [t.storyboardId, t.projectAssetId] })],
);

// ── 结果分享（PRD F3；database §7）─────────────────────────
export const taskShares = pgTable(
  "task_shares",
  {
    id: pk(),
    taskId: bigint("task_id", { mode: "bigint" })
      .notNull()
      .references(() => tasks.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("idx_task_shares_task").on(t.taskId), uniqueIndex("uq_task_shares_token").on(t.token)],
);

// ── 内容举报（合规 C2；公开分享页入口 + 运营处置）──────────
export const contentReports = pgTable(
  "content_reports",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    taskId: bigint("task_id", { mode: "bigint" })
      .notNull()
      .references(() => tasks.id),
    shareId: bigint("share_id", { mode: "bigint" }).references(() => taskShares.id),
    reason: text("reason").notNull(), // porn|violence|illegal|infringement|spam|other
    detail: text("detail"),
    contact: text("contact"),
    status: smallint("status").notNull().default(1), // 1 PENDING 2 TAKEDOWN 3 DISMISSED
    handledBy: bigint("handled_by", { mode: "bigint" }).references(() => adminUsers.id),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    resolution: text("resolution"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_content_reports_status").on(t.status, t.createdAt.desc()),
    index("idx_content_reports_task").on(t.taskId),
  ],
);

// ── 导出（P1'：整集 zip 异步打包；database §7）────────────
export const exportJobs = pgTable(
  "exports",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    episodeId: bigint("episode_id", { mode: "bigint" })
      .notNull()
      .references(() => episodes.id),
    status: smallint("status").notNull().default(1), // 1PENDING 2PACKAGING 3SUCCEEDED 4FAILED
    fileUri: text("file_uri"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    error: jsonb("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_exports_space").on(t.spaceId, t.createdAt.desc())],
);

// ── P7：时间线（per-episode 持久化）+ 成片合成导出 ─────────
export const projectTimelines = pgTable(
  "project_timelines",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    projectId: bigint("project_id", { mode: "bigint" })
      .notNull()
      .references(() => scriptProjects.id),
    episodeId: bigint("episode_id", { mode: "bigint" })
      .notNull()
      .references(() => episodes.id),
    /** 有序片段数组：[{ clip_id, shot_id, task_id|null, name, duration }]（顺序即成片顺序） */
    clips: jsonb("clips").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 一个分集只有一条时间线（PUT 覆盖写）
    uniqueIndex("uq_project_timelines_episode").on(t.episodeId),
    index("idx_project_timelines_project").on(t.projectId, t.episodeId),
  ],
);

// 时间线合成导出（与旧「整集 zip 导出」exports 表分离，保证旧语义零回归）
export const timelineExports = pgTable(
  "timeline_exports",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    projectId: bigint("project_id", { mode: "bigint" })
      .notNull()
      .references(() => scriptProjects.id),
    episodeId: bigint("episode_id", { mode: "bigint" })
      .notNull()
      .references(() => episodes.id),
    status: smallint("status").notNull().default(1), // 1排队 2处理中 3完成 4失败（沿用 exports 语义）
    /** 产物 storage key（API 读取时签 1h URL；不落签名 URL，避免过期失效） */
    fileUri: text("file_uri"),
    clipCount: integer("clip_count").notNull().default(0),
    /** 因无 task/结果不可解码而被跳过的片段数（mock 模式回退色板时不计入） */
    skipped: integer("skipped").notNull().default(0),
    durationS: integer("duration_s").notNull().default(0),
    /** 是否已叠加「AI 生成」显式水印（合规留痕） */
    watermarked: boolean("watermarked").notNull().default(false),
    error: jsonb("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_timeline_exports_space").on(t.spaceId, t.createdAt.desc()),
    index("idx_timeline_exports_episode").on(t.episodeId, t.createdAt.desc()),
  ],
);

// ── 商业化（Beta 支付；P2' 使用，先建表保持契约）───────────
export const skus = pgTable("skus", {
  id: pk(),
  kind: text("kind").notNull(), // credits|vip
  sku: text("sku").notNull().unique(),
  label: text("label").notNull(),
  priceCents: integer("price_cents").notNull(),
  credits: integer("credits").notNull(),
  period: text("period"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * 支付订单（PRD §10 / api-spec §10）。
 * 状态机：1 待支付 → 2 已支付（已入账） / 3 已关闭 / 4 已退款
 * 幂等键：channel + channelOrderId 唯一，回调重复到达不会重复入账。
 */
export const orders = pgTable(
  "orders",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    skuId: bigint("sku_id", { mode: "bigint" })
      .notNull()
      .references(() => skus.id),
    sku: text("sku").notNull(),
    /** 金额（分）：下单时快照，不随 sku 调价变化 */
    amountCents: integer("amount_cents").notNull(),
    /** 应到账积分：下单时快照 */
    credits: integer("credits").notNull(),
    channel: text("channel").notNull(), // wechat|alipay|mock
    /** 渠道侧订单号（回调对账用） */
    channelOrderId: text("channel_order_id"),
    status: smallint("status").notNull().default(1), // 1待支付 2已支付 3已关闭 4已退款
    paidAt: timestamp("paid_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** 前端轮询用的一次性凭证（不暴露内部 id 规则） */
    payToken: text("pay_token"),
    /**
     * 渠道下单返回的支付参数（jsonb）：微信 code_url/h5_url/prepay_id+paySign、
     * 支付宝 qr_code/pay_url。仅含可下发给前端的字段，绝不含私钥/证书。
     * 重复下单复用未支付订单时直接回放，避免每次重复打渠道。
     */
    payParams: jsonb("pay_params"),
    /**
     * 退款（api-spec §10.5）：
     * - refundNo：我方幂等退款单号（固定 `rf-{orderId}`），同时用于渠道路由幂等；
     * - refundStatus：processing（渠道异步处理中）|succeeded|failed；
     * - refundAmountCents：本期仅支持全额退款，恒等于 amount_cents（保留显式列便于对账）。
     */
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundNo: text("refund_no"),
    refundStatus: text("refund_status"),
    refundAmountCents: integer("refund_amount_cents"),
    refundReason: text("refund_reason"),
    refundOperator: text("refund_operator"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_orders_space").on(t.spaceId, t.createdAt.desc()),
    uniqueIndex("uq_orders_channel_order").on(t.channel, t.channelOrderId),
    index("idx_orders_status").on(t.status),
  ],
);
