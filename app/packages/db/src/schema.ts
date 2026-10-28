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
  /**
   * 账号级语言偏好（zh-CN|en|ja|pt-BR|es）。
   * 空串表示"从未显式选择过"，此时前端按 cookie（of_lang）→ 浏览器语言 → 默认 zh-CN 解析。
   * 与 cookie 的分工：cookie 是本设备的即时偏好，本字段是跨设备跟随账号的偏好。
   */
  preferredLocale: text("preferred_locale").notNull().default(""),
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
  type: smallint("type").notNull().default(1), // 1 个人 2 团队
  name: text("name").notNull().default("我的空间"),
  // ── cam 团队域扩展（F1 §12.3）──
  maxSeats: integer("max_seats").notNull().default(5), // 席位上限（订阅档位，A13 待取证）
  status: smallint("status").notNull().default(1), // 1 正常 2 停用 3 欠费冻结
  agentWhitelist: smallint("agent_whitelist").notNull().default(0), // 对齐 RE team_info.agent_whitelist
  filmEnabled: smallint("film_enabled").notNull().default(0), // 影视版功能准入（L0 闸门）
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
    role: smallint("role").notNull().default(3), // 1 owner 2 admin 3 member（空间归属；团队岗位走 roleCode）
    creditsQuota: integer("credits_quota").notNull().default(0), // 团队域激活：未回收的已分配额上限，**不是余额**
    // ── cam 团队域扩展（F1 §12.3）──
    roleId: bigint("role_id", { mode: "bigint" }), // → team_roles.id（自定义角色）
    roleCode: text("role_code"), // master|admin|group_admin|producer|maker|film_producer|film_maker|…
    roleLevel: smallint("role_level"), // 1..11，**仅展示/排序，不作特权判据**
    groupId: bigint("group_id", { mode: "bigint" }), // → team_groups.id
    status: smallint("status").notNull().default(1), // 1 正常 2 停用 3 待激活
    nickname: text("nickname"),
    account: text("account"),
    remark: text("remark"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.userId] }),
    index("idx_space_members_group").on(t.spaceId, t.groupId),
    index("idx_space_members_role").on(t.spaceId, t.roleCode),
  ],
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
    /**
     * 邀请码归属用户（用户自助生成的分销/邀请码；运营码为 null）。
     *
     * 为什么不复用 `createdBy`：`created_by` 指向 `admin_users`（运营），
     * 而用户邀请码的归属是普通 `users`——两张表 id 空间不同，混用会把"谁的码"
     * 判成运营账号，返佣/归属统计直接错。
     */
    ownerUserId: bigint("owner_user_id", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_invite_codes_status").on(t.status, t.expiresAt),
    index("idx_invite_codes_owner").on(t.ownerUserId),
  ],
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
    // ── cam 团队积分池扩展（F1 §12.3 / ADR-011）──
    // 分配/回收必须成对写入，并靠这 4 列回答"从哪个 space 转到哪、谁操作、当时在哪个组"
    refSpaceId: bigint("ref_space_id", { mode: "bigint" }), // 对手方 space
    refUserId: bigint("ref_user_id", { mode: "bigint" }), // 目标成员 user
    opUserId: bigint("op_user_id", { mode: "bigint" }), // 操作者（审计）
    groupId: bigint("group_id", { mode: "bigint" }), // 快照当时分组
    balanceAfter: integer("balance_after").notNull(),
    memo: text("memo"),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_flows_space").on(t.spaceId, t.createdAt.desc()),
    index("idx_flows_space_kind").on(t.spaceId, t.kind, t.createdAt.desc()),
    index("idx_flows_ref_space").on(t.refSpaceId, t.createdAt.desc()),
  ],
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
    /**
     * 按次计价的档位单独约束。
     *
     * 为什么必须补这一条：`uq_model_prices` 含 `duration_s`，而 **PostgreSQL 把 NULL
     * 视为互不相同**，所以 `duration_s IS NULL`（按次计价，如文本类）的同一档位可以被
     * 重复插入任意多行；`credits.price()` 用 `limit` 之外没有排序，取到哪一条是随机的
     * ——等于扣费金额不确定。部分索引才真正锁住"同一档位只有一条价"。
     */
    uniqueIndex("uq_model_prices_per_call")
      .on(t.modelId, t.mode, t.resolution)
      .where(sql`${t.durationS} is null`),
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
    /** 任务标题：用户改名的落点（agent 域 PUT /agent/task/:id），空则前端按 mode 派生显示 */
    title: text("title"),
    /** 用户反馈 {reaction:"like"|"dislike", comment?}；曾列 PRD 非目标，但 agent 域已提供该写口，
     *  落库才能读回，否则就是"接口收下就丢"的空壳 */
    feedback: jsonb("feedback"),
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
    /**
     * 三态账本（对照竞品 CLI `ledger` 的 applied/pending/in_doubt）：
     *   1 = 处理中（已在执行，重放请求应稍后重试而不是再执行一次）
     *   2 = 已完成（response_body / error_body 可原样重放）
     *   3 = 状态不明（进程崩溃/超时导致无法判定；**自动重放危险**，需 `x-force-replay` 人工确认）
     * 没有这三态时，"超时没拿到响应"与"请求还没开始"无法区分，重放就会变成重复扣费。
     */
    status: smallint("status").notNull().default(1),
    /** 确定性业务失败的重放体（AppError 是确定结果，重放应返回同样的错误而不是再执行） */
    errorBody: jsonb("error_body"),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_idempotency_key_space").on(t.key, t.spaceId),
    index("idx_idem_expire").on(t.expireAt),
    index("idx_idem_status").on(t.status, t.expireAt),
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
    /**
     * 项目编排模式（1 普通剧本 / 2 广告剧 / 3 视频转绘）。
     *
     * 为什么用"同一个 project + 模式"而不是三张项目表：竞品就是
     * `/df/script_project/{drama_ad,video_redraw}/project/*`（rt:680-710）——
     * 广告剧与转绘都复用剧本项目的集/分镜/资产骨架，只是前面多一段「卖点/brief」
     * 或「源视频/风格」的专属流程。分成三张表会让集/分镜/资产三套 FK 各写一遍。
     */
    projectMode: smallint("project_mode").notNull().default(1),
    /**
     * 模式专属数据（服务端**不解析语义**，只做大小上限）：
     * - 广告剧：`{ briefs:[{title,text}], selected_brief, selling_points:[], image_tips:[] }`
     * - 视频转绘：`{ source_uri, source_kind, style, redraw_strength }`
     * 用 jsonb 而不是逐字段建列：这两个模式的字段还没取证稳定（竞品只暴露粗粒度端点），
     * 每加一个参数就迁移一次不划算；等证据稳定再物化成列。
     */
    modeMeta: jsonb("mode_meta").notNull().default(sql`'{}'::jsonb`),
    /**
     * 来源本子（`novels.id`，可空）：`source_type=1` 且由「已定稿本子拆集」创建时写入。
     *
     * 为什么需要这一列：`POST /novel/:nt/reopen` 必须回答"这个本子有没有被拆成项目"。
     * 之前只能比对正文快照（项目正文被人工改写后就识别不到，会误允许撤回定稿，
     * 从而让已出片的项目失去来源）。精确外键让判据可靠，并让"某本子被哪些项目引用"
     * 变成一次可索引查询（快照比对在项目多时是 O(n) 全表扫）。
     */
    sourceNovelId: bigint("source_novel_id", { mode: "bigint" }).references(() => novels.id, {
      // 删本子时把引用置空而不是拒绝：本子删除（归档后物理清理）不应被历史项目卡死；
      // 置空后 reopen 判据会自动回落到正文快照比对（novel.service 已实现两级判据）。
      onDelete: "set null",
    }),
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
  (t) => [
    index("idx_script_projects_space").on(t.spaceId, t.createdAt.desc()),
    // reopen 的"被引用"判断按来源本子查，必须有索引（否则每次撤回定稿都全表扫）
    index("idx_script_projects_source_novel").on(t.sourceNovelId),
  ],
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
    /**
     * 提示词完备状态（智能补充的 7 条件里"prompt 是否被拦/是否在生成"需要可存状态）：
     * 0 未处理 / 1 生成中 / 2 已完备 / 3 被拦截（内容安全）。
     * 之前这条只能用 `source_task_id → tasks.status` 近似，判不出"被拦截"与"生成中"的差别。
     */
    promptStatus: smallint("prompt_status").notNull().default(0),
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
    /**
     * 绑定顺序（0 = 未显式排序）。
     *
     * 为什么需要显式列：`PUT .../storyboards/:sid/assets` 的契约是**保留调用方传入顺序**
     * （前端按"角色/场景/道具"顺序渲染，并由 `images[]` 注入到提示词，顺序会影响
     * `[[@img1]]` 的编号）。原实现靠"删除后按数组顺序 insert"隐式表达顺序，
     * 而 PostgreSQL 无 `ORDER BY` 的 SELECT 不保证堆序（DELETE 后的空槽会被复用），
     * 实测出现过同一份数据两次读取顺序不同 —— 属于真缺陷，不是测试洁癖。
     */
    sort: integer("sort").notNull().default(0),
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

// ── cam 团队域（F1 契约 §12.3，2026-10-26）────────────────────
// ADR-010：团队不另建表，spaces(type=2) 是唯一载体；team_id 映射为 space_id。
// ADR-011：团队积分池是 space 级 credit_accounts，分配/回收成对写 credit_flows。

/** 团队分组（树形；禁跨 space 的 parent，应用层校验→400101） */
export const teamGroups = pgTable(
  "team_groups",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    parentId: bigint("parent_id", { mode: "bigint" }),
    name: text("name").notNull(),
    leaderUserId: bigint("leader_user_id", { mode: "bigint" }).references(() => users.id),
    sort: integer("sort").notNull().default(0),
    status: smallint("status").notNull().default(1), // 1 正常 2 停用
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_team_groups_space").on(t.spaceId, t.parentId, t.sort)],
);

/** 团队角色（内置 11 级 + 自定义）。role_level 仅展示/排序，不作特权判据（见 §12.3.1） */
export const teamRoles = pgTable(
  "team_roles",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    roleCode: text("role_code").notNull(),
    roleName: text("role_name").notNull(),
    roleLevel: smallint("role_level").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    description: text("description"),
    powerList: jsonb("power_list").notNull().default(sql`'[]'::jsonb`),
    moduleIdList: jsonb("module_id_list").notNull().default(sql`'{}'::jsonb`),
    status: smallint("status").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_team_roles_code").on(t.spaceId, t.roleCode)],
);

/** 成员↔项目作用域（project_id 为不透明 ID，故意无 FK：cam 不得依赖 film/script 表） */
export const teamMemberProjects = pgTable(
  "team_member_projects",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    projectKind: smallint("project_kind").notNull().default(1), // 1 脚本 2 影视版
    projectId: bigint("project_id", { mode: "bigint" }).notNull(),
    /** 参与项目形式（2026-10-26 登录态实测：团队表格有该列）1全流程 2仅制作 3仅审核 */
    participationType: smallint("participation_type").notNull().default(1),
    grantedBy: bigint("granted_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_tmp_scope").on(t.spaceId, t.userId, t.projectKind, t.projectId),
    index("idx_tmp_space_project").on(t.spaceId, t.projectKind, t.projectId),
  ],
);

/** BYOK 第三方 Key（A6 待取证，最小面；密钥只存密文+哈希，对齐 identities 双列口径） */
export const userThirdKeys = pgTable(
  "user_third_keys",
  {
    id: pk(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" }).references(() => spaces.id),
    provider: text("provider").notNull(),
    label: text("label").notNull().default(""),
    keyCipher: text("key_cipher").notNull(),
    keyHash: text("key_hash"),
    status: smallint("status").notNull().default(1),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_user_third_keys_user").on(t.userId, t.provider)],
);

// ── canvas 画布域（F1 契约 §12.1，迁移 0014）──────────────
// 内容型数据（节点/边/分组）全部 space_id 隔离；节点锁走 Redis 不落库；
// 生成任务一律复用 tasks（canvas_nodes.task_id），禁止另造任务表。

/** 画布（§7 占位补齐：所有权/软删/剧集映射/钉住/时间戳） */
export const canvases = pgTable(
  "canvases",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    title: text("title").notNull().default("未命名画布"),
    /** 乐观锁版本；提交时必带，不匹配 → 746002 */
    version: integer("version").notNull().default(1),
    /** 1 制片工坊 2 无限画布（RE canvas.md:222） */
    creationMode: smallint("creation_mode").notNull().default(2),
    /** 剧集映射；前向外键（episodes 后建域），迁移末尾 ALTER 补加 */
    episodeId: bigint("episode_id", { mode: "bigint" }),
    ownerUserId: bigint("owner_user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    /** 「钉住节点」单选（routes.txt:402 为单值语义） */
    pinnedNodeId: bigint("pinned_node_id", { mode: "bigint" }),
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_canvases_space").on(t.spaceId, t.updatedAt.desc())],
);

/** 画布节点（11 种 node_type 是硬约束，见 §12.1.10） */
export const canvasNodes = pgTable(
  "canvas_nodes",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    canvasId: bigint("canvas_id", { mode: "bigint" })
      .notNull()
      .references(() => canvases.id),
    /** text|image|video|audio|table|script|asset|clip|director|threeDWorld|group */
    nodeType: text("node_type").notNull(),
    name: text("name").notNull().default(""),
    x: integer("x").notNull().default(0),
    y: integer("y").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    zIndex: integer("z_index").notNull().default(0),
    /** 类型专属参数（image/video 的 mode + settings 等，见 §12.1.10） */
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    /** 该节点派生的生成任务（复用 tasks，禁止另造任务表） */
    taskId: bigint("task_id", { mode: "bigint" }).references(() => tasks.id),
    /** 1 就绪 2 生成中 3 失败 */
    status: smallint("status").notNull().default(1),
    /** 固定组成员（与 canvas_pin_groups.node_ids 反向冗余，须同事务双写） */
    groupIds: bigint("group_ids", { mode: "bigint" }).array().notNull().default(sql`'{}'::bigint[]`),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_canvas_nodes_canvas").on(t.canvasId, t.zIndex),
    index("idx_canvas_nodes_type").on(t.canvasId, t.nodeType),
    index("idx_canvas_nodes_task").on(t.taskId),
  ],
);

/** 画布连线（唯一约束 = "确保连线存在"的幂等语义） */
export const canvasEdges = pgTable(
  "canvas_edges",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    canvasId: bigint("canvas_id", { mode: "bigint" })
      .notNull()
      .references(() => canvases.id),
    srcNodeId: bigint("src_node_id", { mode: "bigint" })
      .notNull()
      .references(() => canvasNodes.id),
    dstNodeId: bigint("dst_node_id", { mode: "bigint" })
      .notNull()
      .references(() => canvasNodes.id),
    /** pipeline|reference|sequence（node.md:366，默认 pipeline） */
    semantic: text("semantic").notNull().default("pipeline"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_canvas_edges").on(t.canvasId, t.srcNodeId, t.dstNodeId, t.semantic),
    index("idx_canvas_edges_src").on(t.srcNodeId),
    index("idx_canvas_edges_dst").on(t.dstNodeId),
  ],
);

/** 画布快照（按版本存 JSONB，用于恢复/自动保存） */
export const canvasSnapshots = pgTable(
  "canvas_snapshots",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    canvasId: bigint("canvas_id", { mode: "bigint" })
      .notNull()
      .references(() => canvases.id),
    version: integer("version").notNull(),
    /** 1 自动 2 手动 */
    kind: smallint("kind").notNull().default(1),
    payload: jsonb("payload").notNull(),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_canvas_snapshots").on(t.canvasId, t.version)],
);

/** 节点分组（树形） */
export const canvasGroups = pgTable(
  "canvas_groups",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    canvasId: bigint("canvas_id", { mode: "bigint" })
      .notNull()
      .references(() => canvases.id),
    parentId: bigint("parent_id", { mode: "bigint" }),
    name: text("name"),
    sort: integer("sort").notNull().default(0),
    status: smallint("status").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_canvas_groups").on(t.canvasId, t.parentId, t.sort)],
);

/** 整画布模板库（与节点组模板不同物，勿混用） */
export const canvasTemplates = pgTable(
  "canvas_templates",
  {
    id: pk(),
    /** 官方模板为 NULL（全局可见） */
    spaceId: bigint("space_id", { mode: "bigint" }).references(() => spaces.id),
    /** 1 官方 2 团队 3 个人 */
    tplScope: smallint("tpl_scope").notNull(),
    /** 1 新手引导 2 官方画布模块 3 从剧本到成片 */
    tplType: smallint("tpl_type").notNull().default(2),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    coverUri: text("cover_uri"),
    /** 画布元素集合（结构待取证 A-02） */
    payload: jsonb("payload").notNull(),
    /** 1 草稿 2 已发布 3 已下架 */
    status: smallint("status").notNull().default(1),
    sort: integer("sort").notNull().default(100),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_canvas_templates_list").on(t.tplScope, t.tplType, t.status, t.sort)],
);

/** 节点组模板 */
export const canvasGroupTemplates = pgTable(
  "canvas_group_templates",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    canvasId: bigint("canvas_id", { mode: "bigint" })
      .notNull()
      .references(() => canvases.id),
    groupId: bigint("group_id", { mode: "bigint" })
      .notNull()
      .references(() => canvasGroups.id),
    name: text("name").notNull(),
    payload: jsonb("payload").notNull(),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_canvas_group_templates").on(t.canvasId, t.groupId)],
);

/** 画布素材（上传/节点产出/资产库引用 三来源） */
export const canvasMaterials = pgTable(
  "canvas_materials",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    canvasId: bigint("canvas_id", { mode: "bigint" })
      .notNull()
      .references(() => canvases.id),
    /** image|video|audio|file */
    materialType: text("material_type").notNull(),
    /** 1 上传 2 节点产出 3 资产库引用 */
    source: smallint("source").notNull().default(1),
    nodeId: bigint("node_id", { mode: "bigint" }).references(() => canvasNodes.id),
    name: text("name").notNull().default(""),
    objectKey: text("object_key"),
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_canvas_materials").on(t.canvasId, t.materialType, t.createdAt.desc())],
);

/** 固定组（每画布 7 个槽位，成员整体替换） */
export const canvasPinGroups = pgTable(
  "canvas_pin_groups",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    canvasId: bigint("canvas_id", { mode: "bigint" })
      .notNull()
      .references(() => canvases.id),
    name: text("name"),
    color: text("color"),
    /** 1..7 */
    slot: smallint("slot").notNull(),
    nodeIds: bigint("node_ids", { mode: "bigint" }).array().notNull().default(sql`'{}'::bigint[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_canvas_pin_groups").on(t.canvasId, t.slot)],
);

/** 批注锚点（画布坐标） */
export const canvasCommentNodes = pgTable(
  "canvas_comment_nodes",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    canvasId: bigint("canvas_id", { mode: "bigint" })
      .notNull()
      .references(() => canvases.id),
    anchorX: integer("anchor_x").notNull(),
    anchorY: integer("anchor_y").notNull(),
    nodeId: bigint("node_id", { mode: "bigint" }).references(() => canvasNodes.id),
    /** canvas|node */
    scope: text("scope").notNull().default("canvas"),
    resolved: boolean("resolved").notNull().default(false),
    resolvedBy: bigint("resolved_by", { mode: "bigint" }).references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_canvas_comment_nodes").on(t.canvasId, t.resolved, t.createdAt.desc())],
);

/** 批注内容（不复用 content_reports：后者是公开举报） */
export const canvasComments = pgTable(
  "canvas_comments",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    commentNodeId: bigint("comment_node_id", { mode: "bigint" })
      .notNull()
      .references(() => canvasCommentNodes.id),
    content: text("content").notNull(),
    mentions: bigint("mentions", { mode: "bigint" }).array().notNull().default(sql`'{}'::bigint[]`),
    createdBy: bigint("created_by", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_canvas_comments").on(t.commentNodeId, t.createdAt)],
);

/**
 * 画布节点批量下载记录（迁移 0016）。
 *
 * 为什么要落库而不是"打包完直接返 URL"：参照站的批量下载是**两段式**——
 * 先产生一个"下载单"（可反复取链接、可在列表里追溯），再由 `…/url` 现签一个
 * 短时效链接。只返 URL 的话，链接过期后用户就再也拿不到同一批文件了。
 */
export const canvasDownloadLists = pgTable(
  "canvas_download_lists",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    canvasId: bigint("canvas_id", { mode: "bigint" })
      .notNull()
      .references(() => canvases.id),
    /** 参与打包的节点数（可能大于"有产物的节点数"） */
    nodeCount: integer("node_count").notNull().default(0),
    fileCount: integer("file_count").notNull().default(0),
    /** 打包产物的存储 key（取下载链接时现签，不存 URL） */
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    /** 1 打包中 2 就绪 3 失败 */
    status: smallint("status").notNull().default(2),
    error: jsonb("error"),
    createdBy: bigint("created_by", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_canvas_download_lists_canvas").on(t.canvasId, t.createdAt.desc()),
    index("idx_canvas_download_lists_space").on(t.spaceId, t.createdAt.desc()),
  ],
);

// ── agent 对话域（F1 契约 §13，迁移 0015）────────────────────
// 关键取舍（contract-draft-canvas-agent.md §2.3.0）：
// 独立的创作 Agent（/agent/task/*）与画布内对话（/canvas/:id/chat/sessions/*）
// 是**同一台对话引擎的两种作用域**，故合一张 agent_sessions 用 scope 区分，
// 消息/事件/绑定三张子表完全共享——否则要维护两套并行实现，且流式协议会分叉。

/** 对话会话（scope 1 独立创作 / 2 画布内） */
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** 1 独立创作 Agent 2 画布内对话（scope=2 时 canvas_id 必填，应用层校验） */
    scope: smallint("scope").notNull().default(1),
    canvasId: bigint("canvas_id", { mode: "bigint" }).references(() => canvases.id),
    title: text("title").notNull().default(""),
    /** 1 活跃 2 已结束 3 已归档 */
    status: smallint("status").notNull().default(1),
    /** 未读数游标：用户最后读到的消息 seq（→ /chat/sessions/:id/read） */
    lastReadSeq: integer("last_read_seq").notNull().default(0),
    createdBy: bigint("created_by", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_agent_sessions_space").on(t.spaceId, t.scope, t.lastActiveAt.desc()),
    index("idx_agent_sessions_canvas").on(t.canvasId, t.lastActiveAt.desc()),
  ],
);

/** 对话消息（seq 为会话内单调展示序，独立于 agent_events 的续传序） */
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => agentSessions.id),
    /** 1 user 2 assistant 3 system */
    role: smallint("role").notNull(),
    content: text("content").notNull().default(""),
    /** 1 text 2 card 3 plan 4 hitl（卡片/计划/HITL 的结构放 payload） */
    contentType: smallint("content_type").notNull().default(1),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    /** 该消息触发的生成任务（复用 tasks，禁止另造 agent_tasks 表） */
    taskId: bigint("task_id", { mode: "bigint" }).references(() => tasks.id),
    /** 会话内单调序号；与 session_id 组成唯一键，分页游标按它走 */
    seq: integer("seq").notNull(),
    /** 0 无 1 赞 2 踩 3 已取消（reaction 端点写这里） */
    reaction: smallint("reaction").notNull().default(0),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_agent_messages_seq").on(t.sessionId, t.seq),
    index("idx_agent_messages_session").on(t.sessionId, t.seq),
  ],
);

/** SSE 事件日志：断线续传的唯一依据（没有它就无法实现 last_stream_id 重放） */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => agentSessions.id),
    /** SSE 帧 id: 的值，客户端回传 last_stream_id 时按它定位游标 */
    streamId: text("stream_id").notNull(),
    /** 会话内单调递增；重放条件是 seq > cursor.seq */
    seq: bigint("seq", { mode: "bigint" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    taskId: bigint("task_id", { mode: "bigint" }).references(() => tasks.id),
    /** 与 database.md §10 数据生命周期对齐（7 天，同分享 token 级），过期后游标失效 → 746004 */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_agent_events_stream").on(t.sessionId, t.streamId),
    index("idx_agent_events_replay").on(t.sessionId, t.seq),
    index("idx_agent_events_expire").on(t.expiresAt),
  ],
);

/** 消息 ↔ 画布节点绑定（区分产出/引用/修改，且要能按节点反查"谁给我做的"） */
export const agentMessageBindings = pgTable(
  // 表名以 database.md §12.2 为准（草案里曾简写为 agent_message_bindings）
  "agent_message_node_bindings",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    messageId: bigint("message_id", { mode: "bigint" })
      .notNull()
      .references(() => agentMessages.id),
    nodeId: bigint("node_id", { mode: "bigint" })
      .notNull()
      .references(() => canvasNodes.id),
    /** 1 产出 2 引用 3 修改 */
    bindingKind: smallint("binding_kind").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_agent_msg_binding").on(t.messageId, t.nodeId),
    index("idx_agent_bindings_node").on(t.nodeId),
  ],
);

// ── 小说改编链（第 2 批地基；对照竞品 df/novel 域，NT_ID = novels.id）────────
// 竞品 `df/novel` 共 86 端点，链序固定为：
//   分章解析 split → 内容分析（世界观 + 角色卡）→ 章节大纲 → 分集大纲
//   → 分集剧本 → 剧本编辑 Agent（会话式逐集 diff）→ 版本 finalize（status=16）
// 多租户隔离口径与 film 域**故意不同**：novel 是唯一聚合根，只有 novels 带 space_id，
// 子表一律通过 novel_id 追溯空间——因为 novel 下的章节/大纲/剧本不存在跨 space 的合法组合，
// 每张子表再冗余一份 space_id 只会多出一致性风险（写错的 space_id 就是越权面）。
// film 域相反：它的行/单元格/审核会被"按空间"直接列表查询，故冗余 space_id（见下方 film 段）。

/** 剧本项目本体（对照竞品 NT_ID；`df/novel` 的聚合根） */
export const novels = pgTable(
  "novels",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    title: text("title").notNull().default("未命名剧本"),
    /**
     * 来源类型（对照竞品 NT.source_type）：
     * 1 小说改编 / 2 一句话想法 / 3 导入剧本 / 4 创意裂变 / 5 海外改编。
     * ⚠️ 与 `script_projects.source_type`（1..4，无 overseas）**不是同一套枚举**，勿混用：
     * 那张表是"制片工坊的项目"，这张表是"剧本工厂的本子"，竞品的 5 值域只在这个域成立。
     */
    sourceType: smallint("source_type").notNull().default(1),
    /**
     * 1 草稿 / **16 已定稿**（对照竞品 NT.status）。
     * 16 是竞品原值，不要"归一成 2"：§3.3 衔接契约以 status=16 作为"可被拆集引用"的判据，
     * 归一化会让联调两端对不上（我方 API 出参同样原样透出 16）。
     */
    status: smallint("status").notNull().default(1),
    /**
     * 空间分区码（对照竞品 sp_type；`reelmate-feature-map.md:168`：建成不可改，决定模型目录分区）。
     * 取值域竞品未取证（只观测到 `DC(sp_type)` 的展示格式化），故只落库、不参与任何判权或筛选；
     * 取证后补枚举常量，**不回填历史行**（缺省 0 = 未设置）。
     */
    spType: smallint("sp_type").notNull().default(0),
    /** 画面比例，建项时定；与 `script_projects.ratio` 同口径（9:16 / 16:9） */
    ratio: text("ratio").notNull().default("9:16"),
    /** 预计集数（分集大纲生成后回写，便于列表页展示进度分母） */
    episodeCount: integer("episode_count").notNull().default(0),
    /**
     * 域内自由字段：{ genre, style, theme, adaptation, cover_uri, overseas:{lang,region}, ... }
     * 竞品 NT 的 extras 是开放结构，故用 jsonb 承接；**服务端不解析语义**（只做长度上限），
     * 避免我方 schema 变成对方私有字段的第二份真相。
     */
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    /** 归档时间（软标记；归档后不出现在默认列表，但版本/会话仍可回溯） */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_novels_space").on(t.spaceId, t.status, t.createdAt.desc())],
);

/** 分章解析结果（对照竞品 `split` 子链；`POST /projects/parse-script` 的落点） */
export const novelChapters = pgTable(
  "novel_chapters",
  {
    id: pk(),
    novelId: bigint("novel_id", { mode: "bigint" })
      .notNull()
      .references(() => novels.id),
    /** 章序号，从 1 起；重新解析时整体替换（应用层 DELETE + 批量 INSERT） */
    chapterNo: integer("chapter_no").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    /** 字数（解析时按去空白口径统计；列表页展示用，不参与计费） */
    wordCount: integer("word_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_novel_chapters_no").on(t.novelId, t.chapterNo),
    index("idx_novel_chapters_novel").on(t.novelId, t.chapterNo),
  ],
);

/** 世界观（对照竞品 `content-analysis` 的世界观产出；每本小说一份，重新分析走覆盖写） */
export const novelWorldviews = pgTable(
  "novel_worldviews",
  {
    id: pk(),
    novelId: bigint("novel_id", { mode: "bigint" })
      .notNull()
      .references(() => novels.id),
    /** 世界观总述（LLM 输出版本，纯文本；结构化部分进 settings） */
    summary: text("summary").notNull().default(""),
    /**
     * 结构化世界观（LLM 输出 schema 见 `shared/schemas/novel.ts` 的 worldviewSchema）：
     * { era, geography, factions[], rules[], relations:[{from,to,kind,note}] }
     * 人物关系/地理/时代三类齐备才允许进入下一步大纲生成（应用层校验）。
     */
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 每本小说只有一条世界观；重新分析 = 覆盖（upsert），不堆历史行（历史靠 novel_script_versions 留痕）
    uniqueIndex("uq_novel_worldviews_novel").on(t.novelId),
  ],
);

/** 角色卡（对照竞品 `novel_character_cards` / ncc_id；资产一致性的上游锚点） */
export const novelCharacters = pgTable(
  "novel_characters",
  {
    id: pk(),
    novelId: bigint("novel_id", { mode: "bigint" })
      .notNull()
      .references(() => novels.id),
    name: text("name").notNull(),
    /** 1 主角 / 2 配角 / 3 反派（对照竞品的角色类型；仅分层展示与提示词排序，不作判权） */
    roleType: smallint("role_type").notNull().default(2),
    description: text("description").notNull().default(""),
    /** 外貌（生图提示词的稳定片段） */
    appearance: text("appearance").notNull().default(""),
    /** 性格（剧本创作提示词的稳定片段） */
    personality: text("personality").notNull().default(""),
    /** 生成用提示词；为空时按 appearance > description > name 兜底（与 project_assets 同口径） */
    prompt: text("prompt").notNull().default(""),
    /** 是否核心角色（竞品 `core_character` 子链单独生成/编辑的就是这批） */
    isCore: boolean("is_core").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // 不建 name 唯一索引：LLM 重复生成同名卡时应当可落库再由用户合并，
  // 唯一约束会把"生成成功但保存失败"变成不可恢复的 500。
  (t) => [index("idx_novel_characters_novel").on(t.novelId, t.isCore, t.roleType)],
);

/** 章节大纲（对照竞品 `chapter_outline` 子链 / nco_id） */
export const novelChapterOutlines = pgTable(
  "novel_chapter_outlines",
  {
    id: pk(),
    novelId: bigint("novel_id", { mode: "bigint" })
      .notNull()
      .references(() => novels.id),
    chapterNo: integer("chapter_no").notNull(),
    title: text("title").notNull().default(""),
    synopsis: text("synopsis").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_novel_chapter_outlines_no").on(t.novelId, t.chapterNo)],
);

/** 分集大纲（对照竞品 `episode_outline` 子链 / neo_id；人工可编辑） */
export const novelEpisodeOutlines = pgTable(
  "novel_episode_outlines",
  {
    id: pk(),
    novelId: bigint("novel_id", { mode: "bigint" })
      .notNull()
      .references(() => novels.id),
    episodeNo: integer("episode_no").notNull(),
    title: text("title").notNull().default(""),
    synopsis: text("synopsis").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_novel_episode_outlines_no").on(t.novelId, t.episodeNo)],
);

/**
 * 分集剧本（对照竞品 `script-generate` 产出；编辑 Agent 的 apply 目标）。
 *
 * ⚠️ 与 `episodes` 表**不是同一物**：`episodes` 是制片工坊的剧集（有分镜/出片），
 * 这张表是剧本工厂里的"文字稿"。衔接点只有一个：`novels.status=16` 定稿后，
 * 由 `POST /projects/:id/episodes/split` 把这里的内容搬进 `episodes`（§3.3 契约）。
 */
export const novelEpisodes = pgTable(
  "novel_episodes",
  {
    id: pk(),
    novelId: bigint("novel_id", { mode: "bigint" })
      .notNull()
      .references(() => novels.id),
    episodeNo: integer("episode_no").notNull(),
    title: text("title").notNull().default(""),
    scriptText: text("script_text").notNull().default(""),
    /** 1 草稿 / 2 已确认（人工点过"这集可以"；apply 后置 2，再被改动回落 1） */
    status: smallint("status").notNull().default(1),
    /** 该集当前文本的版本号（= novel_script_versions 里最大的 version_no） */
    version: integer("version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_novel_episodes_no").on(t.novelId, t.episodeNo),
    index("idx_novel_episodes_novel").on(t.novelId, t.episodeNo),
  ],
);

/**
 * 剧本版本（编辑 Agent `finalize` 与每次 apply 的留痕；对照竞品 `version/*` 端点）。
 *
 * 两级版本共用一张表：`episode_id` 非空 = 单集版本，为空 = 整本（NT 级）定稿快照。
 * 为什么不做两张表：竞品的 `version/:vid/finalize|delete|restore` 用同一个 vid 空间，
 * 拆表会让 vID 语义分叉，前端还要按类型分别请求。
 */
export const novelScriptVersions = pgTable(
  "novel_script_versions",
  {
    id: pk(),
    novelId: bigint("novel_id", { mode: "bigint" })
      .notNull()
      .references(() => novels.id),
    /** NULL = 整本快照；非空 = 该集版本 */
    episodeId: bigint("episode_id", { mode: "bigint" }).references(() => novelEpisodes.id),
    versionNo: integer("version_no").notNull(),
    scriptText: text("script_text").notNull().default(""),
    /** 定稿时间；NULL = 未定稿（可被 restore/覆盖） */
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * 版本唯一性必须拆两条**部分索引**，原因同 `model_prices` 那段注释：
     * PostgreSQL 认为 NULL 互不相等，`(novel_id, episode_id, version_no)` 的普通唯一键
     * 对 `episode_id IS NULL`（整本快照）**完全不生效**——整本版本号可以被重复插入，
     * `ORDER BY version_no DESC LIMIT 1` 取到哪条不确定。故 NULL 侧单独用部分索引锁住。
     */
    uniqueIndex("uq_novel_script_versions_episode")
      .on(t.episodeId, t.versionNo)
      .where(sql`${t.episodeId} is not null`),
    uniqueIndex("uq_novel_script_versions_novel")
      .on(t.novelId, t.versionNo)
      .where(sql`${t.episodeId} is null`),
    index("idx_novel_script_versions_novel").on(t.novelId, t.versionNo.desc()),
  ],
);

/**
 * 剧本编辑 Agent 会话（对照竞品 `script_edit_agent/*` 13 端点）。
 *
 * 竞品这套的差异点是**会话式逐集 diff**：用户说"把第 3 集改成悲剧结局"，
 * 返回的不是整篇重写，而是若干集的 pending 变更，用户逐集 apply/reject。
 * 故会话/消息/待确认变更必须是三张表——把 pending 塞进消息 jsonb 会导致
 * "apply 某集"无法用一条 UPDATE 带条件实现（也无法做唯一性约束）。
 */
export const novelEditSessions = pgTable(
  "novel_edit_sessions",
  {
    id: pk(),
    novelId: bigint("novel_id", { mode: "bigint" })
      .notNull()
      .references(() => novels.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    /** 1 active / 2 closed（进入编辑态 enter → 退出 exit；closed 后只读） */
    status: smallint("status").notNull().default(1),
    /**
     * 心跳（`.../heartbeat`）。竞品用它判断"编辑态是否仍有活人"，
     * 超时由维护任务置 closed——**不靠连接存活**，因为 SSE 断线不等于用户走了。
     */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    /** 会话上下文：{ base_version_no, instructions, scope:{episode_nos[]}, model } */
    context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_novel_edit_sessions_novel").on(t.novelId, t.status, t.createdAt.desc()),
    index("idx_novel_edit_sessions_user").on(t.userId, t.heartbeatAt.desc()),
  ],
);

/** 编辑会话消息（对照竞品 `sessions/:sid/chat`） */
export const novelEditMessages = pgTable(
  "novel_edit_messages",
  {
    id: pk(),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => novelEditSessions.id),
    /** 1 user / 2 assistant（沿用 agent_messages.role 编码，不另立枚举） */
    role: smallint("role").notNull(),
    content: text("content").notNull().default(""),
    /** 该条 assistant 消息产出的待确认变更摘要（真正的 diff 落 novel_edit_pendings） */
    pendingChanges: jsonb("pending_changes").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_novel_edit_messages_session").on(t.sessionId, t.createdAt)],
);

/**
 * 待确认的逐集 diff（对照竞品 `.../episodes/:eid/pending|apply|reject|apply_all|reject_all`）。
 *
 * `original_text` / `proposed_text` 都**整段存**而不是存 patch：竞品的 diff 是给人看的
 * （前端双栏对照），存 patch 反而要自己实现渲染；整段存也让"驳回后原文不变"成为
 * 天然事实（驳回 = 改 status，不碰 novel_episodes）。
 */
export const novelEditPendings = pgTable(
  "novel_edit_pendings",
  {
    id: pk(),
    sessionId: bigint("session_id", { mode: "bigint" })
      .notNull()
      .references(() => novelEditSessions.id),
    episodeId: bigint("episode_id", { mode: "bigint" })
      .notNull()
      .references(() => novelEpisodes.id),
    originalText: text("original_text").notNull().default(""),
    proposedText: text("proposed_text").notNull().default(""),
    /** 变更说明（"把结局改成悲剧"，回显给用户逐条确认） */
    changeSummary: text("change_summary").notNull().default(""),
    /** 1 pending / 2 applied / 3 rejected */
    status: smallint("status").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 同一会话同一集**只允许一条待确认 diff**（apply/reject 即终结，再改再生成新的），
    // 否则 `GET .../pending` 返回"一集多条"会让前端 diff 视图无法对应。
    uniqueIndex("uq_novel_edit_pendings_pending")
      .on(t.sessionId, t.episodeId)
      .where(sql`${t.status} = 1`),
    index("idx_novel_edit_pendings_session").on(t.sessionId, t.status, t.createdAt),
  ],
);

// ── 影视版 film（第 5 批地基；对照竞品 film 域：table → fields → tasks → cells 四层）──
// 四层结构 + 审核版本链，语义全部来自 bundle 逆向（contract-draft-cam-film.md §2.3）。
// 多租户口径：**每张 film 表都冗余 space_id**（database.md §12.4 的既有决定），因为行/单元格/
// 审核都会被"按空间"直接列表与统计（`tasks/stats`），若只靠 join 追溯，租户过滤会散在每个查询里。
// 跨域指针故意不加 FK：`project_id` / `canvas_id` / `node_id` 见各自注释（沿用 schema.ts:752 的做法）。

/**
 * 任务表（对照竞品 film `task_tables`；`ensure-presets` 生成的是 `is_preset=1` 的系统预置列）。
 *
 * 表名用 `film_tables`（database.md §12.4 草案里曾叫 `film_task_tables`）：落库名统一后
 * 索引/迁移里不会再出现一对同义词。列语义对照竞品 `p(e)`：table_id/project_id/name/is_preset/sort/version。
 */
export const filmTables = pgTable(
  "film_tables",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /**
     * 所属项目（不透明 ID，**故意无 FK**）：film 项目本体表随第 5 批端点一起建，
     * 且同一"项目"既可能来自 film 自有项目、也可能来自剧本项目派生——跨域指针一加 FK
     * 就把两个域的表结构绑死了（同 schema.ts:752 的既有做法）。
     */
    projectId: bigint("project_id", { mode: "bigint" }).notNull(),
    name: text("name").notNull().default("任务表"),
    /** 是否系统预置表（`ensure-presets` 一次生成；预置表不可删除，只可改名/隐藏列） */
    isPreset: boolean("is_preset").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    /** 表级乐观锁（结构变更必带；不匹配 → 746002，与 canvas version 同码） */
    version: integer("version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_film_tables_project").on(t.projectId, t.sort),
    index("idx_film_tables_space").on(t.spaceId, t.createdAt.desc()),
  ],
);

/**
 * 字段（列）定义（对照竞品 film `fields`；列语义对照 `b(e)`）。
 *
 * `field_type` 11 种（竞品 bundle 实证 9 种 + 我方 2 种扩展）：
 * text / date / user / select / multi_select / number / link / canvas_ref / asset_ref /
 * review_ref / points_ro。`select` / `multi_select` / `number` 是竞品 9 种之外的
 * 我方扩展（竞品把选项塞进 text 的 config_json，拆成独立类型才能做服务端校验）。
 */
export const filmFields = pgTable(
  "film_fields",
  {
    id: pk(),
    tableId: bigint("table_id", { mode: "bigint" })
      .notNull()
      .references(() => filmTables.id),
    /** 冗余租户列（见 film 段注释） */
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /**
     * 稳定键（对照竞品 `key`）：系统字段固定为 title / assignees / produce /
     * task_status / review / points，用户字段由服务端按 name 派生 slug。
     * 前端筛选/排序/唯一标题校验都按 key 走，**不按 field_id**（field_id 重建会变）。
     */
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** text|date|user|select|multi_select|number|link|canvas_ref|asset_ref|review_ref|points_ro */
    fieldType: text("field_type").notNull().default("text"),
    /** 系统字段（title/assignees/produce/task_status/review/points）：不可删除、不可改类型 */
    isSystem: boolean("is_system").notNull().default(false),
    /**
     * ⚠️⚠️ 反直觉点，必须写清（竞品 bundle `_e(t,e)` 逆向实证，contract-draft-cam-film.md §7 A1）：
     * 语义是「**该 field_type 每表至多一个**」，**不是"该列的值唯一"**。
     *
     * 判定实现是"扫本表其它字段，看是否已有同 type 且 is_unique_type=1 的字段"——
     * 即它约束的是**列的存在性**（例如"一张表最多一个 canvas_ref 列"），
     * 与单元格里存什么值毫无关系。按"值唯一"去实现（加唯一索引校验 cell.value）会直接做错，
     * 而且会让用户无法建第二个同类型列。
     * 注意：它**也不是**"title 列的值唯一"那个语义——标题唯一是另一条独立链路
     * （竞品在行层面按 key='title' 查重），两者互不影响，不要合并实现。
     */
    isUniqueType: boolean("is_unique_type").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    /**
     * 类型专属配置：文本校验规则、select 选项、number 精度、ref 目标域等。
     * 【假设】竞品 config_json 的 schema 完全黑盒（A1），我方**只做类型白名单 + 长度上限**，
     * 未知字段原样透传——不能因为不认识就把前端配置丢掉（前端会崩）。
     */
    configJson: jsonb("config_json").notNull().default(sql`'{}'::jsonb`),
    hidden: boolean("hidden").notNull().default(false),
    /** 列宽（px）；NULL = 用该类型的 defaultWidth */
    width: integer("width"),
    /** 软删（`fields/batch-restore` 要能恢复，故不能物理删——物理删会连带丢 film_cells） */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 回收站字段的 key 仍占位（恢复时按原 key 复原），故唯一键不排除 deleted_at；
    // 若允许重复 key，"恢复"时会出现两条同 key 列，单元格归属立刻二义。
    uniqueIndex("uq_film_fields_key").on(t.tableId, t.key),
    index("idx_film_fields_table").on(t.tableId, t.sort),
  ],
);

/**
 * 任务行（对照竞品 film `tasks`；**不是** `tasks` 生成任务表，故加 `film_` 前缀）。
 * 行 = 工单：一集/一镜/一个外包交付物都可能是行，取决于表的字段配置。
 */
export const filmTasks = pgTable(
  "film_tasks",
  {
    id: pk(),
    tableId: bigint("table_id", { mode: "bigint" })
      .notNull()
      .references(() => filmTables.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /**
     * 父子行（NULL = 根行；竞品用 "0" 表示根，落库归一为 NULL，出参再转回 0）。
     * 自引用表不加自 FK：与 `team_groups` / `canvas_groups` / `asset_folders` 的既有做法一致
     * ——自 FK 会让"删父行"必须先递归清子行，软删场景下反而是负担；悬空 parent 由查询侧归一为根行。
     */
    parentId: bigint("parent_id", { mode: "bigint" }),
    sort: integer("sort").notNull().default(0),
    /** 行级乐观锁（PUT cells 必带；冲突 → 746002） */
    version: integer("version").notNull().default(1),
    /**
     * 1 not_started / 2 in_progress / 3 pending_review / 4 rejected / 5 done。
     * 与 `film_review_versions.status` 是**双轨**：行状态是"这活到哪一步"，
     * 版本状态是"这一版过没过审"。一次通过后行=5 但旧版本行仍是 approved（不可变）。
     */
    status: smallint("status").notNull().default(1),
    /**
     * title 是系统字段的**冗余快照**：用于排序/搜索/"标题唯一"校验，
     * 真值仍在 film_cells 里（field.key='title'）。冗余是竞品的设计（它按 title 建索引），
     * 双写由应用层同事务保证；不一致时以 cells 为真相并记录告警。
     */
    title: text("title").notNull().default(""),
    /** 最近一次提交的版本号（= 本行 film_review_versions 里最大的 version_no），列表页免 join */
    reviewVersionNo: integer("review_version_no").notNull().default(0),
    /** 指派人（对照竞品 assignees 系统字段；竞品允许多个，我方本期单值，多值留到第 5 批端点） */
    assigneeUserId: bigint("assignee_user_id", { mode: "bigint" }).references(() => users.id),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    /** 软删（`batch-delete` / `batch-restore`） */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_film_tasks_table").on(t.tableId, t.parentId, t.sort),
    index("idx_film_tasks_status").on(t.tableId, t.status),
    index("idx_film_tasks_assignee").on(t.spaceId, t.assigneeUserId, t.status),
  ],
);

/**
 * 单元格（对照竞品 film `cells`；**稀疏**：无值 = 无行）。
 *
 * 竞品 API 以 `{field_id: value}` 映射返回，落库归一为行——不要按表结构暴露 API
 * （contract-draft-cam-film.md §3.3：内外有别）。
 * "清空单元格" = DELETE 行，**不是写 NULL**：写 NULL 会让稀疏表退化成稠密表（每行 N 列）。
 */
export const filmCells = pgTable(
  "film_cells",
  {
    id: pk(),
    taskId: bigint("task_id", { mode: "bigint" })
      .notNull()
      .references(() => filmTasks.id),
    fieldId: bigint("field_id", { mode: "bigint" })
      .notNull()
      .references(() => filmFields.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** 该类型 encodeCell 后的规范形（各类型 shape 见 field_type 注释；points_ro 只读聚合，不写账本） */
    valueJson: jsonb("value_json"),
    updatedBy: bigint("updated_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_film_cells").on(t.taskId, t.fieldId),
    index("idx_film_cells_field").on(t.fieldId),
  ],
);

/**
 * 审核版本链（对照竞品 film `review` / `submit-result`）。
 *
 * 每次提交产生**不可变**版本号（V01/V02…，文本而非 int：竞品按原样展示 V 前缀，
 * 落库成 int 再拼前缀会让"V01"与"V1"在导出/筛选里对不上）。
 * 评论挂版本、已读回执按版本记——这是"一人看的是 V02、另一人还停在 V01"能被正确表达的前提。
 */
export const filmReviewVersions = pgTable(
  "film_review_versions",
  {
    id: pk(),
    taskId: bigint("task_id", { mode: "bigint" })
      .notNull()
      .references(() => filmTasks.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** V01 起（两位补零；>99 后自然进位为 V100，不截断） */
    versionNo: text("version_no").notNull(),
    /** 1 pending / 2 approved / 3 rejected（竞品缺 review/approve 端点，我方用 status 承载决策） */
    status: smallint("status").notNull().default(1),
    submittedBy: bigint("submitted_by", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: bigint("decided_by", { mode: "bigint" }).references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /**
     * 本版本提交的画布产物（`submit-result` 写入口，jsonb 数组存 asset id/uri）。
     * 为什么放在版本行而不单开一张表：版本是不可变快照，产物集合随版本一起冻结；
     * 单开表会让「产物加了一条」变成对已冻结版本的原地修改，审核依据就不可追溯了。
     */
    assetIds: jsonb("asset_ids").notNull().default(sql`'[]'::jsonb`),
    /** 审核抽屉用的缩略图文件 id（可空：没有缩略图时前端回落到第一张产物） */
    thumbFileId: text("thumb_file_id"),
    /** 决策意见（approve/reject 时必填理由；写在版本上而不是评论里，便于「按决策筛选」） */
    decisionComment: text("decision_comment"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 同一行同一版本号只能提交一次（同版本号重复提交 = 幂等键，返回既有版本而不是新建 V0x）
    uniqueIndex("uq_film_review_versions_no").on(t.taskId, t.versionNo),
    index("idx_film_review_versions_task").on(t.taskId, t.versionNo.desc()),
    index("idx_film_review_versions_space").on(t.spaceId, t.status, t.submittedAt.desc()),
  ],
);

/** 审核评论（挂版本；对照竞品 `review/comments` POST） */
export const filmReviewComments = pgTable(
  "film_review_comments",
  {
    id: pk(),
    versionId: bigint("version_id", { mode: "bigint" })
      .notNull()
      .references(() => filmReviewVersions.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    authorId: bigint("author_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    content: text("content").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_film_review_comments_version").on(t.versionId, t.createdAt)],
);

/** 已读回执（按版本；对照竞品 `review/read` POST） */
export const filmReviewReads = pgTable(
  "film_review_reads",
  {
    id: pk(),
    versionId: bigint("version_id", { mode: "bigint" })
      .notNull()
      .references(() => filmReviewVersions.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_film_review_reads").on(t.versionId, t.userId)],
);

/**
 * 行 ↔ 画布绑定（film 与 canvas 的唯一连接点；对照竞品 `canvas-bindings` 与
 * `canvases/:id/task-bindings`、`canvases/:id/submit-result`）。
 *
 * `canvas_id` / `node_id` **故意不加 FK**：画布属于 canvas 域，film 只持有不透明指针
 * ——加 FK 会让"删画布"变成"必须先删 film 绑定"，把两个域的删除顺序绑死
 * （同 schema.ts:752 的既有做法：cam 不得依赖 film/script 表）。
 * `submit-result` 是唯一的自动化衔接点：画布节点产物 → 登记 film_review_versions
 * → 行状态推 3(pending_review)；没有它影视版就是外挂 Excel。
 */
export const filmCanvasBindings = pgTable(
  "film_canvas_bindings",
  {
    id: pk(),
    taskId: bigint("task_id", { mode: "bigint" })
      .notNull()
      .references(() => filmTasks.id),
    /** 画布 ID（不透明，无 FK：跨域指针） */
    canvasId: bigint("canvas_id", { mode: "bigint" }).notNull(),
    /** 画布节点 ID（不透明，无 FK；同一行同一画布可绑多个节点，故进唯一键） */
    nodeId: bigint("node_id", { mode: "bigint" }).notNull(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 同一行的同一画布节点只绑一次（绑定是幂等操作；解绑走 DELETE）
    uniqueIndex("uq_film_canvas_bindings").on(t.taskId, t.canvasId, t.nodeId),
    index("idx_film_canvas_bindings_canvas").on(t.canvasId),
    index("idx_film_canvas_bindings_task").on(t.taskId, t.createdAt.desc()),
  ],
);

// ── 影视版（film）二等表（迁移 0020）：视图偏好 / 任务模板 / 导出 / 最近打开 ──
/**
 * 契约依据：`_acceptance/_gap/contract-draft-cam-film.md` §7（pref GET/PUT、
 * task-templates 3、exports 2、recent-open 2）。这四张表在 0018 建 film 主表时被漏掉，
 * 导致 48 个操作里 9 个无处落库 —— 补齐后 `submit-result` 的产物、审核抽屉缩略图、
 * 导出 xlsx 才有真实载体。
 */

/** 表视图偏好（每人每表一行；隐藏列/筛选/UI 排序都是"看的人"的私有状态） */
export const filmTablePrefs = pgTable(
  "film_table_prefs",
  {
    id: pk(),
    tableId: bigint("table_id", { mode: "bigint" })
      .notNull()
      .references(() => filmTables.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    /** 隐藏的列 id 数组（不做布尔列：列的增删要跟着字段一起演进） */
    hiddenFieldIds: jsonb("hidden_field_ids").notNull().default(sql`'[]'::jsonb`),
    /** 筛选条件数组 [{field_id, op, value}]，服务端不解释语义，只回传 */
    filterJson: jsonb("filter_json").notNull().default(sql`'[]'::jsonb`),
    /** 列宽/排序等 UI 态 */
    ui: jsonb("ui").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_film_table_prefs").on(t.tableId, t.userId)],
);

/** 任务模板（把"一组字段 + 一组行"存成可复用模板；apply-template 用它） */
export const filmTaskTemplates = pgTable(
  "film_task_templates",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** 项目 id 是不透明指针（film 项目本体没有端点证据，见 task-3 说明） */
    projectId: bigint("project_id", { mode: "bigint" }).notNull(),
    name: text("name").notNull(),
    /** 1 个人 / 2 团队（团队模板全 space 可见，个人模板只本人可见） */
    scope: smallint("scope").notNull().default(1),
    ownerId: bigint("owner_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    /** { fields: [...], tasks: [...] }：模板是快照，应用时深拷贝 */
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_film_templates_project").on(t.projectId, t.scope)],
);

/** 影视版导出（xlsx）；复用 export_jobs 的"排队→完成→过期"四态语义但独立成表 */
export const filmExports = pgTable(
  "film_exports",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    projectId: bigint("project_id", { mode: "bigint" }).notNull(),
    /** 导出的表 id 数组（可一次导多表：每表一个 sheet） */
    tableIds: jsonb("table_ids").notNull().default(sql`'[]'::jsonb`),
    format: text("format").notNull().default("xlsx"),
    /** 1 排队 / 2 处理中 / 3 完成 / 4 失败 */
    status: smallint("status").notNull().default(1),
    fileUri: text("file_uri"),
    /** 现签链接过期时间（与 export_jobs 同口径，避免长期可下载的越权面） */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    error: jsonb("error"),
    createdBy: bigint("created_by", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_film_exports_project").on(t.projectId, t.createdAt.desc())],
);

/** 最近打开（每人每项目一行；列表页首屏"继续上次"用它） */
export const filmRecentOpens = pgTable(
  "film_recent_opens",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    projectId: bigint("project_id", { mode: "bigint" }).notNull(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    /** 上次打开的表（可空：只打开了项目没进表） */
    tableId: bigint("table_id", { mode: "bigint" }).references(() => filmTables.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // 每人每项目只保留一行：最近打开是"覆盖"语义，不是历史流水
  (t) => [uniqueIndex("uq_film_recent_opens").on(t.projectId, t.userId)],
);

// ═══════════════════════════════════════════════════════════════════════════
// 第 0 批地基（续，迁移 0019）：主体库 / 抽取流水线 / Agent Skill / 知识库 /
// 创作者生态 / 集市 / 运营增长。
//
// 建表顺序即依赖顺序：主体库与抽取是「出片一致性」的载体（第 1 批），
// agent_skills 是 Agent 收口（第 4 批），knowledge/market/creator/campaign/op
// 是生态（第 6 批）。**一次建全**的理由：每张表都要走一次迁移，分几次建会让
// 并行开发的批次互相卡在「等迁移」；空表在 Postgres 里零成本。
// ═══════════════════════════════════════════════════════════════════════════

// ── 主体库（subject）：角色/场景/道具的一致性载体 ──────────────────
/**
 * 竞品证据：`cmd/subject.md:3`（生成模型按 subject_id 保持同一角色）、
 * `business_list=[3]` 为 Seedance 主体线。**这是「角色一致性」真正的载体**——
 * 角色卡（novel_characters）只是剧本侧的文字描述，主体库才是图像/视频侧的同一实体。
 *
 * 为什么审核态要落库：竞品对未过审主体投递直接拒（不排队、不扣费），
 * 若只在服务层算，重启/多副本下判定会漂移。
 */
export const subjects = pgTable(
  "subjects",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    name: text("name").notNull(),
    /** 1 角色 / 2 场景 / 3 道具（竞品 subject 的三个业务维度） */
    kind: smallint("kind").notNull().default(1),
    desc: text("desc"),
    coverUri: text("cover_uri"),
    /** 1 审核中 / 2 已通过 / 3 已驳回；**只有 2 可用于生成** */
    reviewStatus: smallint("review_status").notNull().default(1),
    rejectReason: text("reject_reason"),
    /**
     * 供应商业务线白名单（jsonb 数组，例：[3]）。竞品把「这个主体能喂给哪些模型」
     * 做成数组而不是单值——同一主体在 Seedance 与其它线上可用性不同，单值会丢信息。
     */
    businessList: jsonb("business_list").notNull().default(sql`'[]'::jsonb`),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** 星标主体（竞品主体库可置顶常用角色/场景；列表按 starred 优先） */
    isStarred: boolean("is_starred").notNull().default(false),
    /**
     * IP/模板主体标识（同 IP 系列的主体可归到同一模板，例 `ip:my-hero`）。
     * 只做归类与筛选，不做模板渲染——竞品的 IP 模板语义未取证，故不臆造字段。
     */
    templateKey: text("template_key"),
    /** 归属项目（可空：主体库默认跨项目复用；指定后列表页可按项目筛） */
    projectId: bigint("project_id", { mode: "bigint" }).references(() => scriptProjects.id),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_subjects_space").on(t.spaceId, t.kind, t.createdAt.desc()),
    // 生成前的「可选主体」查询走这条：space + 审核态
    index("idx_subjects_review").on(t.spaceId, t.reviewStatus),
    index("idx_subjects_project").on(t.projectId),
  ],
);

/** 主体参考图（一个主体多张：正面/侧面/全身/细节） */
export const subjectFiles = pgTable(
  "subject_files",
  {
    id: pk(),
    subjectId: bigint("subject_id", { mode: "bigint" })
      .notNull()
      .references(() => subjects.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** 来源资产（可空：可能是直接上传或从生成结果保存） */
    assetId: bigint("asset_id", { mode: "bigint" }).references(() => assets.id),
    uri: text("uri").notNull(),
    /** 1 参考图 / 2 正面 / 3 侧面 / 4 背面 / 5 细节（竞品按 role 分组的语义） */
    role: smallint("role").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_subject_files_subject").on(t.subjectId, t.sort),
    // 同一主体同一张图不重复挂（幂等保存）
    uniqueIndex("uq_subject_files_subject_uri").on(t.subjectId, t.uri),
  ],
);

// ── 抽取流水线（extraction）：从成片/资产里抽出角色、场景、道具 ──────────
/**
 * 竞品证据：`cmd/resource.md:552-556`（`task_type=1..5`）、`rt:489-514`（26 端点）。
 * 四态 1 进行中 / 2 成功 / 3 失败 / 4 失效（源资产被删 → 失效而非失败：
 * 失败可以重试，失效不能，重试只会一直失败）。
 */
export const extractionTasks = pgTable(
  "extraction_tasks",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    projectId: bigint("project_id", { mode: "bigint" }).references(() => scriptProjects.id),
    episodeId: bigint("episode_id", { mode: "bigint" }).references(() => episodes.id),
    /** 源资产（可空：也支持直接从生成任务产物抽） */
    sourceAssetId: bigint("source_asset_id", { mode: "bigint" }).references(() => assets.id),
    sourceUri: text("source_uri"),
    /** 1 角色 / 2 场景 / 3 道具 / 4 全部 / 5 自定义（竞品 task_type 五值） */
    taskType: smallint("task_type").notNull().default(4),
    /** 1 进行中 / 2 成功 / 3 失败 / 4 失效 */
    status: smallint("status").notNull().default(1),
    /** 抽取结果摘要（角色/场景/道具条数 + 草稿批次 id） */
    result: jsonb("result").notNull().default(sql`'{}'::jsonb`),
    error: jsonb("error"),
    /** 草稿批次 id（与 extraction_drafts.eed_id 对应；竞品 eed_id 语义） */
    eedId: text("eed_id"),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_extraction_tasks_space").on(t.spaceId, t.status, t.createdAt.desc()),
    index("idx_extraction_tasks_project").on(t.projectId, t.createdAt.desc()),
    index("idx_extraction_tasks_eed").on(t.eedId),
  ],
);

/** 抽取草稿（人工确认前不落到主体库；保证「抽错了不污染主体库」） */
export const extractionDrafts = pgTable(
  "extraction_drafts",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    taskId: bigint("task_id", { mode: "bigint" })
      .notNull()
      .references(() => extractionTasks.id),
    /** 草稿批次（一次抽取可产出多个批次：先出角色、再出场景） */
    eedId: text("eed_id").notNull(),
    /** 1 角色 / 2 场景 / 3 道具 */
    kind: smallint("kind").notNull().default(1),
    name: text("name").notNull(),
    /** 抽取出的完整字段（描述/参考图 URI/候选主体 id 等），服务端不解析语义 */
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    /** 1 草稿 / 2 已导入主体库 / 3 已丢弃 */
    state: smallint("state").notNull().default(1),
    /** 主子形态：同一被抽对象的多形态（正/侧/背）归属同一 parent */
    parentStateId: text("parent_state_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_extraction_drafts_task").on(t.taskId, t.kind, t.state),
    index("idx_extraction_drafts_eed").on(t.eedId),
  ],
);

// ── Agent Skill 卡（第 4 批）：可收藏、可复用的提示词/工作流模板 ──────────
/**
 * 竞品证据：`rt:378-385`（`agent-skills` 8 端点：list/mine/plaza/favorites/favorite/
 * details/create/delete），实测 33 张卡。我方存「提示词模板 + 配置」，
 * 卡片只读表；运行记录落 tasks/agent_sessions，不在这张表里堆历史。
 */
export const agentSkills = pgTable(
  "agent_skills",
  {
    id: pk(),
    /** 平台公共卡 space_id 为空；用户自建卡归属空间 */
    spaceId: bigint("space_id", { mode: "bigint" }).references(() => spaces.id),
    ownerUserId: bigint("owner_user_id", { mode: "bigint" }).references(() => users.id),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    coverUri: text("cover_uri"),
    category: text("category").notNull().default("general"),
    promptTemplate: text("prompt_template").notNull().default(""),
    /** 卡片参数定义 + 默认值（前端按它渲染表单） */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    /** 1 私有 / 2 广场可见（广场卡才能被收藏与复用） */
    visibility: smallint("visibility").notNull().default(1),
    useCount: integer("use_count").notNull().default(0),
    favoriteCount: integer("favorite_count").notNull().default(0),
    /** 1 正常 / 2 下架（运营处置；删除走 deleted_at 软删，保留被引用关系） */
    status: smallint("status").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_agent_skills_plaza").on(t.visibility, t.useCount.desc()),
    index("idx_agent_skills_owner").on(t.ownerUserId, t.createdAt.desc()),
  ],
);

export const agentSkillFavorites = pgTable(
  "agent_skill_favorites",
  {
    id: pk(),
    skillId: bigint("skill_id", { mode: "bigint" })
      .notNull()
      .references(() => agentSkills.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_agent_skill_favorites").on(t.skillId, t.userId)],
);

// ── 团队知识库（第 6 批）：知识库实体 / 目录 / 标签 / 资产 ────────────
/**
 * 知识库实体（第 59 批）—— 对照竞品 `user_knowledge/create`(:739)、`delete`(:740)、
 * `update`(:765)、`info/update`(:758)。
 *
 * ## 为什么最终判定"一 space 一知识库"（而不是"竞品支持多库、我方不做"）
 * 这 4 条实体端点**全都没有路径 id**（对比 `dir/:ukd_id/*`、`asset/{uk_id}/*` 都带 id）。
 * 若一个空间可建多个知识库，`delete`/`update` 必须带 `uk_id` 才能定位到改哪一个；
 * 没有 id 只能解释为"当前空间唯一的那个库"。→ 路由形状本身就是"一 team 一库"的证据。
 *
 * ## 为什么不加 `knowledge_dirs.base_id`
 * 一空间一库时 `base_id` 恒等于 `space_id` 对应的那行，属可推导的冗余列；
 * 加了就有两个真相来源，删库重建后旧目录会指向已软删的 base（静默错挂）。
 * 目录/标签/资产继续只用 `space_id` 归组。
 *
 * `uq_knowledge_bases_space` 是**偏唯一索引**（`deleted_at is null`）：一个空间同时
 * 只能有一个**活的**库，但允许软删后重建（删掉的那行留着做审计，不挡新行）。
 */
export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    name: text("name").notNull().default("团队知识库"),
    description: text("description").notNull().default(""),
    /** 封面图 uri；空串表示用前端默认样式（我方自定字段，竞品无证据） */
    coverUri: text("cover_uri").notNull().default(""),
    /** 概览面板的自定义说明（`info/update` 的落点；与 description 分开：description 是简介，note 是给成员的操作提示） */
    note: text("note").notNull().default(""),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_knowledge_bases_space")
      .on(t.spaceId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * 竞品证据：`rt`（`user_knowledge` 29 端点）。三层结构与资产库**双向导入**：
 * 知识库资产可引用资产库 uri，资产库条目也可挂进知识库目录。
 *
 * `parent_id` 不加自引用外键：目录树深度由服务层校验（最多 5 层），
 * 数据库加自引用 FK 会让「删父目录」必须先递归删子目录（竞品是软删）。
 *
 * 第 60 批：三张表都加 `scene`（知识库模板场景，见 `@app/shared` 的 `KNOWLEDGE_SCENE`）。
 * 依据是竞品 `GET /user_knowledge/dir/list` 的 query 是 `["scene","parent_ukd_id"]`、
 * `GET /user_knowledge/tag/list` 是 `["scene","query"]` —— 目录树与标签都是**按场景隔离**的，
 * 不是同一棵全局树；`scene=0` 只是兼容本批之前的历史数据（竞品没有 0）。
 * 三张表同时加而不是只加在资产上，是因为只加资产会让"风格"目录下混进音色标签。
 */
export const knowledgeDirs = pgTable(
  "knowledge_dirs",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** 模板场景（竞品枚举值）；0 = 未分类（仅历史数据） */
    scene: smallint("scene").notNull().default(0),
    parentId: bigint("parent_id", { mode: "bigint" }),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_knowledge_dirs_space").on(t.spaceId, t.parentId, t.sort),
    index("idx_knowledge_dirs_scene").on(t.spaceId, t.scene, t.parentId, t.sort),
  ],
);

export const knowledgeTags = pgTable(
  "knowledge_tags",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** 模板场景（竞品枚举值）；0 = 未分类（仅历史数据） */
    scene: smallint("scene").notNull().default(0),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  // 唯一性从 (space, name) 改为 (space, scene, name)：不同场景允许同名标签
  // （"复古"既可以是一个风格标签、也可以是一个题材标签，竞品按场景隔离 tag/list）。
  (t) => [uniqueIndex("uq_knowledge_tags").on(t.spaceId, t.scene, t.name)],
);

export const knowledgeAssets = pgTable(
  "knowledge_assets",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    dirId: bigint("dir_id", { mode: "bigint" }).references(() => knowledgeDirs.id),
    /** 模板场景（竞品枚举值）；0 = 未分类（仅本批之前的历史数据） */
    scene: smallint("scene").notNull().default(0),
    /** 指向资产库条目（可空：知识库也支持纯文本条目，如「设定集」「世界观」） */
    assetId: bigint("asset_id", { mode: "bigint" }).references(() => assets.id),
    title: text("title").notNull(),
    /** 对应竞品 `prompt_template`；每类场景的必填与上限不同（见 shared 的 KNOWLEDGE_SCENE_RULES） */
    content: text("content"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** 1 文本 / 2 资产引用 / 3 链接 */
    sourceType: smallint("source_type").notNull().default(1),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_knowledge_assets_space").on(t.spaceId, t.dirId, t.createdAt.desc()),
    index("idx_knowledge_assets_scene").on(t.spaceId, t.scene, t.createdAt.desc()),
    index("idx_knowledge_assets_tags").using("gin", t.tags),
  ],
);

// ── 创作者中心（第 6 批）：资料 / 关注粉丝 / 作品 ─────────────────────
/**
 * 竞品证据：`rt:275-304`（`crc` 30 端点）。**注意**：这一域的「作品」与「项目」不是同一实体
 * ——作品是投稿到生态里的公开条目，项目是私有生产单元；合并会让「下架作品」误删项目。
 */
export const creatorProfiles = pgTable(
  "creator_profiles",
  {
    id: pk(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    nickname: text("nickname").notNull().default(""),
    bio: text("bio").notNull().default(""),
    avatarUri: text("avatar_uri"),
    /** 1 正常 / 2 冻结（违规处置；冻结后作品保留但不可被关注） */
    status: smallint("status").notNull().default(1),
    followerCount: integer("follower_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_creator_profiles_user").on(t.userId)],
);

export const creatorFollows = pgTable(
  "creator_follows",
  {
    id: pk(),
    followerUserId: bigint("follower_user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    creatorUserId: bigint("creator_user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_creator_follows").on(t.followerUserId, t.creatorUserId),
    index("idx_creator_follows_creator").on(t.creatorUserId, t.createdAt.desc()),
  ],
);

export const creatorAssets = pgTable(
  "creator_assets",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    creatorUserId: bigint("creator_user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    /** 1 视频 / 2 图片 / 3 剧本 */
    kind: smallint("kind").notNull().default(1),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    coverUri: text("cover_uri"),
    uri: text("uri"),
    /** 1 草稿 / 2 待审 / 3 已通过 / 4 已驳回 / 5 已下架 */
    status: smallint("status").notNull().default(1),
    reviewNote: text("review_note"),
    /** 分类（运营/集市用；默认 general，后台可改，前端按它做筛选项） */
    category: text("category").notNull().default("general"),
    /**
     * 效果标签（对照竞品 `crc/resource/list` 的 `effect` 筛选与 `crc/effect/tree` 目录）。
     *
     * 取值来自 `creator.service.ts` 的 `EFFECT_TREE` 叶子：`anime`/`realistic`/`ink`（风格）、
     * `push`/`pan`/`handheld`（运镜）。此前表里没有列，接口只能"透传但不过滤"（`effect_applied:false`），
     * 用户选筛选项却看不到结果变化——这类"假筛选"比没有筛选项更糟。
     * 可空：老数据与未设置效果的作品不参与效果筛选（不出现在任何 effect 过滤结果里）。
     */
    effect: text("effect"),
    /** 审核人（空间管理员审核留痕；未审为空） */
    reviewedBy: bigint("reviewed_by", { mode: "bigint" }).references(() => users.id),
    /**
     * 平台运营审核人（迁移 0034）。
     *
     * 为什么与 `reviewed_by` 分开：两者是**不同身份域**（`users` vs `admin_users`），
     * 竞品侧创作者作品既有空间管理员审、也有平台运营审。共用一个列会让外键只能指向其中一张表，
     * 导致另一条路径无法留痕（"谁审的"查不到 = 审核不可追溯）。
     */
    reviewedByAdmin: bigint("reviewed_by_admin", { mode: "bigint" }).references(() => adminUsers.id),
    /** 审核来源：1 空间管理员 / 2 平台运营（便于运营报表按来源统计） */
    reviewedByKind: smallint("reviewed_by_kind"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_creator_assets_creator").on(t.creatorUserId, t.status, t.createdAt.desc()),
    index("idx_creator_assets_feed").on(t.status, t.publishedAt.desc()),
    index("idx_creator_assets_category").on(t.status, t.category, t.publishedAt.desc()),
    index("idx_creator_assets_effect").on(t.status, t.effect, t.publishedAt.desc()),
  ],
);

// ── 活动/激励 campaign（第 6 批）────────────────────────────────────
export const campaigns = pgTable(
  "campaigns",
  {
    id: pk(),
    /** 平台级活动 space_id 为空；团队内活动归属空间 */
    spaceId: bigint("space_id", { mode: "bigint" }).references(() => spaces.id),
    /**
     * 活动短标识（slug，运营侧稳定引用：深链 `/activities/:key`、埋点、AB 实验键）。
     * 用 slug 而不是 id：活动 id 是雪花数字，运营文档/海报里没法写；而 slug 一旦发布不可改
     * （改了所有外部链接与埋点都失效），所以只允许后台创建时设定。
     */
    campaignKey: text("campaign_key"),
    title: text("title").notNull(),
    /** 1 征集 / 2 命题创作 / 3 拉新 / 4 每日奖励 */
    kind: smallint("kind").notNull().default(1),
    brief: text("brief").notNull().default(""),
    coverUri: text("cover_uri"),
    /** 报名奖励积分（0 = 无积分奖励；发分走 credit_flows 记账，不绕过账本） */
    rewardCredits: integer("reward_credits").notNull().default(0),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    /** 1 草稿 / 2 进行中 / 3 已结束 / 4 已下线 */
    status: smallint("status").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_campaigns_status").on(t.status, t.startAt),
    // slug 全局唯一（平台活动与团队活动共用命名空间，避免"同名活动两条深链"）
    uniqueIndex("uq_campaigns_key")
      .on(t.campaignKey)
      .where(sql`${t.campaignKey} is not null`),
  ],
);

export const campaignSignups = pgTable(
  "campaign_signups",
  {
    id: pk(),
    campaignId: bigint("campaign_id", { mode: "bigint" })
      .notNull()
      .references(() => campaigns.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** 投稿作品（可空：先报名后投稿） */
    workId: bigint("work_id", { mode: "bigint" }).references(() => creatorAssets.id),
    /** 1 已报名 / 2 已入围 / 3 已获奖 / 4 已取消 */
    status: smallint("status").notNull().default(1),
    nominatedAt: timestamp("nominated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_campaign_signups").on(t.campaignId, t.userId),
    index("idx_campaign_signups_status").on(t.campaignId, t.status),
  ],
);

// ── 剧本集市 novel_market（第 6 批）：上架 / 预售 / 协议 / 收益 / 提现 ──────
/**
 * 竞品证据：`rt:601-629`（`novel_market` 29 端点）。**收益不进 credit_accounts**：
 * 集市收益是可提现的「收入」，与消耗型积分是两种钱（混在一起会让充值积分能被提现）。
 * 故 market_works.revenue_credits 只记累计，结算走 market_agreements → 提现申请。
 */
export const marketWorks = pgTable(
  "market_works",
  {
    id: pk(),
    /** 关联本子（可空：外部投稿的本子不一定在我方 novel 域） */
    novelId: bigint("novel_id", { mode: "bigint" }).references(() => novels.id),
    ownerUserId: bigint("owner_user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    coverUri: text("cover_uri"),
    /** 1 小说 / 2 剧本 / 3 分镜包 */
    kind: smallint("kind").notNull().default(1),
    /** 售价（积分）。预售与正式价分开存：预售结束后正式价不覆盖历史成交价 */
    priceCredits: integer("price_credits").notNull().default(0),
    preorderPriceCredits: integer("preorder_price_credits"),
    /** 1 草稿 / 2 待审 / 3 在售 / 4 已驳回 / 5 已下架 / 6 预售中 */
    status: smallint("status").notNull().default(1),
    auditNote: text("audit_note"),
    /** 分类（集市列表筛选用；分类目录见 `market_categories`） */
    categoryId: bigint("category_id", { mode: "bigint" }),
    /** 标签 id 数组（多选；标签目录见 `market_tags`）。用数组而不是关联表：
     *  标签是**展示用多值**、不做反查分页，关联表会多一次 JOIN 与一张表的写放大。 */
    tagIds: bigint("tag_ids", { mode: "bigint" }).array().notNull().default(sql`'{}'::bigint[]`),
    salesCount: integer("sales_count").notNull().default(0),
    revenueCredits: integer("revenue_credits").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_market_works_feed").on(t.status, t.publishedAt.desc()),
    index("idx_market_works_owner").on(t.ownerUserId, t.createdAt.desc()),
    index("idx_market_works_category").on(t.status, t.categoryId, t.publishedAt.desc()),
  ],
);

/** 交易/授权协议（一次成交一行；退款加一行反向记录，不改原行） */
export const marketAgreements = pgTable(
  "market_agreements",
  {
    id: pk(),
    workId: bigint("work_id", { mode: "bigint" })
      .notNull()
      .references(() => marketWorks.id),
    buyerUserId: bigint("buyer_user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** 关联订单（现金支付时走 orders；积分购买时为空） */
    orderId: bigint("order_id", { mode: "bigint" }).references(() => orders.id),
    /** 1 购买 / 2 预售 / 3 授权（分成） / 4 退款（反向记录） */
    kind: smallint("kind").notNull().default(1),
    priceCredits: integer("price_credits").notNull().default(0),
    /** 1 待支付 / 2 已生效 / 3 已退款 */
    status: smallint("status").notNull().default(1),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_market_agreements_work").on(t.workId, t.createdAt.desc())],
);

/** 提现申请（集市收益 → 提现；人工审核 + 渠道打款，状态机不可跳步） */
export const marketWithdrawals = pgTable(
  "market_withdrawals",
  {
    id: pk(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    amountCredits: integer("amount_credits").notNull(),
    /**
     * 归属作品（可空）：收益按作品累计，提现按"账户"发起。
     * 空 = 账户级提现（跨作品汇总）；非空 = 运营按作品结算的单笔提现。
     * `account_info.work_id` 只能存字符串，无法建索引与外键，故提升为列。
     */
    workId: bigint("work_id", { mode: "bigint" }).references(() => marketWorks.id),
    /** 1 待审 / 2 已通过 / 3 已打款 / 4 已驳回 / 5 已撤销 */
    status: smallint("status").notNull().default(1),
    channel: text("channel").notNull().default("alipay"),
    accountInfo: jsonb("account_info").notNull().default(sql`'{}'::jsonb`),
    reviewNote: text("review_note"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_market_withdrawals_user").on(t.userId, t.status, t.createdAt.desc())],
);

// ── 运营增长 op（第 6 批）：兑换码 / 分销关系 / AB 实验 ────────────────
export const redeemCodes = pgTable(
  "redeem_codes",
  {
    id: pk(),
    code: text("code").notNull(),
    /** 平台码 space_id 为空；团队定向码归属空间 */
    spaceId: bigint("space_id", { mode: "bigint" }).references(() => spaces.id),
    credits: integer("credits").notNull().default(0),
    /** 0 = 不限次数（运营活动码）；>0 = 硬上限 */
    maxUses: integer("max_uses").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** 1 有效 / 2 停用 */
    status: smallint("status").notNull().default(1),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_redeem_codes_code").on(t.code)],
);

export const redeemCodeRedemptions = pgTable(
  "redeem_code_redemptions",
  {
    id: pk(),
    codeId: bigint("code_id", { mode: "bigint" })
      .notNull()
      .references(() => redeemCodes.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    credits: integer("credits").notNull().default(0),
    createdAt: createdAt(),
  },
  // 同一用户同一码只能兑一次（并发下靠唯一键兜底，不靠先查后写）
  (t) => [uniqueIndex("uq_redeem_code_redemptions").on(t.codeId, t.userId)],
);

/** 分销关系（父级唯一：单层分销，避免多级分佣的合规风险） */
export const distributorRelations = pgTable(
  "distributor_relations",
  {
    id: pk(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    parentUserId: bigint("parent_user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    /** 分佣比例（万分比，例：500 = 5%） */
    commissionBps: integer("commission_bps").notNull().default(0),
    /** 1 有效 / 2 已解绑 */
    status: smallint("status").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_distributor_relations_user").on(t.userId)],
);

/** AB 实验定义（变体与权重存 jsonb：实验配置是运营数据，不是结构） */
export const abExperiments = pgTable(
  "ab_experiments",
  {
    id: pk(),
    key: text("key").notNull(),
    name: text("name").notNull().default(""),
    /** [{ name:"control", weight:50 }, ...] */
    variants: jsonb("variants").notNull().default(sql`'[]'::jsonb`),
    /** 1 草稿 / 2 运行中 / 3 已结束 */
    status: smallint("status").notNull().default(1),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_ab_experiments_key").on(t.key)],
);

export const abHits = pgTable(
  "ab_hits",
  {
    id: pk(),
    experimentId: bigint("experiment_id", { mode: "bigint" })
      .notNull()
      .references(() => abExperiments.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    variant: text("variant").notNull(),
    createdAt: createdAt(),
  },
  // 一个用户在一次实验里只命中一个变体（否则统计口径无法收敛）
  (t) => [uniqueIndex("uq_ab_hits").on(t.experimentId, t.userId)],
);

// ── 订阅制（第 23 项计费 75% → 补齐 VIP/订阅，迁移 0021）────────────────
/**
 * 订阅实体（对照竞品 VIP/DF-VIP 13 档，`d-commerce-account.md`）。
 *
 * 为什么订阅单独成表而不是复用 `skus.kind='vip'` 一个字段：
 *   - `skus` 是**商品**（价目），订阅是**关系**（谁在什么区间享有什么）；
 *   - 同一商品可以被同一空间反复购买（续期），需要一个随时间演进的区间行；
 *   - "是否 VIP"这个判权每天要查几百次，必须有一条带索引的当前态行，
 *     不能靠 orders 里翻最近一次支付。
 *
 * 为什么 `uq_subscriptions_active_space` 是**部分唯一索引**：
 *   同一 space 同时只能有一份生效中的订阅，否则等级/权益会变成"看查询顺序"；
 *   但历史订阅（已过期/已取消）必须能共存，所以约束只作用于 status=1。
 */
export const subscriptions = pgTable(
  "subscriptions",
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
    /** 冗余 sku 字符串：判权时只读这一行，不用回表 skus */
    sku: text("sku").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull().defaultNow(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /** 1 生效 / 2 已过期 / 3 已取消（取消=到期不续，仍可在 endAt 前继续用） */
    status: smallint("status").notNull().default(1),
    /** 自动续费（竞品订阅默认开；取消订阅只关这个开关，不立即失效） */
    autoRenew: boolean("auto_renew").notNull().default(false),
    orderId: bigint("order_id", { mode: "bigint" }).references(() => orders.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_subscriptions_space").on(t.spaceId, t.status, t.endAt.desc()),
    uniqueIndex("uq_subscriptions_active_space")
      .on(t.spaceId)
      .where(sql`status = 1`),
  ],
);

/**
 * SKU 动态价格（对照竞品 `sku-price` 端点：同一 SKU 在不同渠道/活动/首购下价格不同）。
 *
 * 为什么不做成 `skus.price_cents` 上的一次性折扣字段：
 *   活动有区间与叠加规则（限时特价 / 首购 / 立减），三者的可叠加性由服务层判定；
 *   落成独立的行才能"回放某个时间点为什么是这个价"（对账/客诉都需要）。
 */
export const skuPromotions = pgTable(
  "sku_promotions",
  {
    id: pk(),
    sku: text("sku").notNull(),
    /** 1 限时特价 / 2 首购优惠 / 3 立减（叠加规则在 billing 服务里显式写死） */
    kind: smallint("kind").notNull().default(1),
    /** 活动价（分）；立减类此值为"减多少" */
    priceCents: integer("price_cents").notNull(),
    label: text("label").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_sku_promotions_sku").on(t.sku, t.active, t.startsAt)],
);

// ═══════════════════════════════════════════════════════════════════════════
// 第 2 轮地基（迁移 0024）：生态/收尾批次需要但在 0019 未建的表。
//
// 建表原则同 0019：**一次建全，避免各批次互相卡在"等迁移"**。这些表都只在
// 对应批次的端点里读写，空表零成本；而漏建一张表会让整个批次停摆。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 运营位（对照竞品 `crc/banner`、`crc/pop_up` 与运营后台的"运营位配置"）。
 *
 * 为什么用一行一槽位而不是一张 key-value 配置表：
 *   运营位有**时间窗口**与**排序**（同一 banner 位在活动期换素材，且需要按权重轮播），
 *   这些是行级属性；塞进 jsonb 后"现在该显示哪一张"就必须由应用层遍历解析，
 *   既无法建索引也无法在 SQL 里按时间过滤（运营后台一看就要排序与生效筛选）。
 */
export const promoSlots = pgTable(
  "promo_slots",
  {
    id: pk(),
    /** banner（首页横幅）/ pop_up（弹窗）/ activity（活动入口）/ creator（创作者首页卡） */
    slot: text("slot").notNull(),
    title: text("title").notNull().default(""),
    imageUri: text("image_uri"),
    /** 点击去向：站内路由（/pricing）或深链；服务端不解析，只透传 */
    linkUri: text("link_uri"),
    sort: integer("sort").notNull().default(0),
    /** 1 启用 / 2 停用（软态，保留历史素材与投放记录） */
    status: smallint("status").notNull().default(1),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** 曝光/点击计数（运营看效果用；写放大很低，直接列存） */
    viewCount: integer("view_count").notNull().default(0),
    clickCount: integer("click_count").notNull().default(0),
    /**
     * 创建人 —— **指向 `admin_users`（运营），不是 `users`**。
     *
     * 运营位只能由运营后台创建（AdminGuard 保护），若外键指向 `users`，
     * 运营 token 里的 admin id 写进来会撞 FK（cli-build 实测 500）。
     * 既有的 `content_reports.handled_by` 同样指向 admin_users，保持一致。
     */
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => adminUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_promo_slots_slot").on(t.slot, t.status, t.sort)],
);

/**
 * 首页配置（对照竞品 `/home/config` 配置驱动：模块顺序/显隐/AB 实验位）。
 *
 * 一行 = 一份配置快照；`version` 递增，客户端带 `version` 轮询即可做"配置已更新"提示，
 * 不必对比整份 jsonb。scope='global' 时 spaceId 为空（平台默认），space 级可覆盖。
 */
export const homeConfigs = pgTable(
  "home_configs",
  {
    id: pk(),
    scope: text("scope").notNull().default("global"),
    spaceId: bigint("space_id", { mode: "bigint" }).references(() => spaces.id),
    /** { sections:[{key,visible,sort}], ab_slots:[{key,experiment}], unread:{...} } */
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_home_configs_scope").on(t.scope, t.spaceId)],
);

/** 创作者作品点赞（对照竞品 `crc/asset/like`；一人一作品一次） */
export const creatorLikes = pgTable(
  "creator_likes",
  {
    id: pk(),
    assetId: bigint("asset_id", { mode: "bigint" })
      .notNull()
      .references(() => creatorAssets.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_creator_likes").on(t.assetId, t.userId),
    index("idx_creator_likes_asset").on(t.assetId, t.createdAt.desc()),
  ],
);

/**
 * 3D 导演台场景（对比竞品 `director/save`、`director/info`、`director/list` 8 端点）。
 *
 * `payload` 是**整份场景快照**（相机/灯光/角色位姿/道具摆放）：导演台是纯前端
 * 实时编辑的 3D 场景，逐字段建列会让"加一个道具类型就要迁移一次"；
 * 用 jsonb 快照 + `version` 递增（乐观锁）才是与前端编辑器匹配的粒度。
 */
export const directorScenes = pgTable(
  "director_scenes",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    projectId: bigint("project_id", { mode: "bigint" }).references(() => scriptProjects.id),
    episodeId: bigint("episode_id", { mode: "bigint" }).references(() => episodes.id),
    name: text("name").notNull().default("未命名场景"),
    /** 整份场景快照（含相机/灯光/角色/道具） */
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    thumbnailUri: text("thumbnail_uri"),
    /** 乐观锁版本：客户端提交带 version，不一致返回 746002 */
    version: integer("version").notNull().default(1),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_director_scenes_space").on(t.spaceId, t.projectId, t.createdAt.desc())],
);

/** 3D 导演台姿态预设（心跳与快速摆位；`payload` 同场景快照的子集） */
export const directorPosePresets = pgTable(
  "director_pose_presets",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    name: text("name").notNull(),
    /** { bones:[...], camera:{...} } */
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    /** 1 个人 / 2 团队共享 */
    scope: smallint("scope").notNull().default(1),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_director_pose_presets_space").on(t.spaceId, t.scope)],
);

/**
 * ReelFlow 成片发布记录（对照竞品 `reelflow` 的切片/发布：一条时间线可发多个切片）。
 *
 * `slice` 保存起止时间与可选片段子集；`status` 走"排队→转码中→可播放/失败"，
 * 与 `timeline_exports`（合并导出）分开：发布是**对外的作品**，导出是**内部的产物**，
 * 合并会让"删除导出文件"误伤已发布作品。
 */
export const timelinePublications = pgTable(
  "timeline_publications",
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
    title: text("title").notNull().default(""),
    /** 切片区间（毫秒）+ 可选的 clip 子集：[{clip_id,start_ms,end_ms}] */
    slice: jsonb("slice").notNull().default(sql`'[]'::jsonb`),
    /** 1 排队 / 2 转码中 / 3 可播放 / 4 失败 / 5 已下架 */
    status: smallint("status").notNull().default(1),
    fileUri: text("file_uri"),
    shareToken: text("share_token"),
    /**
     * 播放量（公开播放页 `/watch/:token` 的权威计数）。
     * 为什么落列而不是只存 Redis：Redis 重启/淘汰会丢数，而"这部片子被看了多少次"
     * 是创作者/运营要看的历史指标，必须持久；Redis 只做 5 分钟去重（防刷）。
     */
    viewCount: integer("view_count").notNull().default(0),
    /**
     * 本次发布是怎么来的：`ffmpeg` = 按 slice 真裁剪；`copy` = 复制成片（未裁剪）。
     * 空串 = 历史数据 / 尚未转码。**必须留痕**：不能"悄悄复制"却对外说裁剪过。
     */
    transcodeMode: text("transcode_mode").notNull().default(""),
    /** 未裁剪时的可读原因（没 ffmpeg / 区间覆盖全片 / 裁剪失败）；成功裁剪时为 null */
    transcodeReason: text("transcode_reason"),
    error: jsonb("error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_timeline_publications_episode").on(t.episodeId, t.createdAt.desc()),
    uniqueIndex("uq_timeline_publications_token").on(t.shareToken),
  ],
);

// ── 运营增长（迁移 0025）：每日奖励 / 问卷 ─────────────────────────────
/**
 * 每日奖励领取记录（对照竞品 `op` 域的每日奖励）。
 *
 * 为什么用 (user_id, reward_date) 唯一键而不是"先查后写"：
 *   领奖是**并发高发**动作（用户连点、客户端重试），先查后写在并发下必然重复发放。
 *   `reward_date` 用 text 'YYYY-MM-DD'（业务日，按 space 时区取）而不是 date 类型：
 *   与前端/运营报表的口径一致，也避免 drizzle 的 date 时区转换歧义。
 */
export const opDailyRewards = pgTable(
  "op_daily_rewards",
  {
    id: pk(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    rewardDate: text("reward_date").notNull(),
    credits: integer("credits").notNull().default(0),
    /** 关联的账本流水（发奖励必须走 credit_flows，便于对账） */
    flowRef: bigint("flow_ref", { mode: "bigint" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_op_daily_rewards").on(t.userId, t.rewardDate)],
);

/** 问卷（竞品 op 域问卷：运营配置问题，用户提交一次） */
export const opQuestionnaires = pgTable(
  "op_questionnaires",
  {
    id: pk(),
    spaceId: bigint("space_id", { mode: "bigint" }).references(() => spaces.id),
    /** 稳定标识（深链 `/activities?q=<key>`、埋点） */
    qkey: text("qkey").notNull(),
    title: text("title").notNull().default(""),
    /** [{ id, type: 'single'|'multi'|'text', title, options?: string[] }] */
    questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`),
    /** 1 草稿 / 2 收集中 / 3 已结束 */
    status: smallint("status").notNull().default(1),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "bigint" }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_op_questionnaires_key").on(t.qkey)],
);

export const opQuestionnaireResponses = pgTable(
  "op_questionnaire_responses",
  {
    id: pk(),
    questionnaireId: bigint("questionnaire_id", { mode: "bigint" })
      .notNull()
      .references(() => opQuestionnaires.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    /** { <question_id>: value } */
    answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  // 同一用户同一问卷只提交一次（重复提交覆盖由服务层决定，唯一键保证不重复计数）
  (t) => [uniqueIndex("uq_op_questionnaire_responses").on(t.questionnaireId, t.userId)],
);

/** 活动报名草稿（对照竞品 `campaign/signup/draft` GET+POST，rt:271；一人一活动一份，可反复覆盖） */
export const campaignSignupDrafts = pgTable(
  "campaign_signup_drafts",
  {
    id: pk(),
    campaignId: bigint("campaign_id", { mode: "bigint" })
      .notNull()
      .references(() => campaigns.id),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    workId: bigint("work_id", { mode: "bigint" }).references(() => creatorAssets.id),
    channel: text("channel"),
    /** 表单答案 { <field>: value }（活动表单字段由运营配置） */
    answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // 一人一活动一份草稿：覆盖写而不是追加（追加会让"我上次填到哪"取决于读取顺序）
  (t) => [uniqueIndex("uq_campaign_signup_drafts").on(t.campaignId, t.userId)],
);

/**
 * 作品举报（对照竞品 `crc/assets/report`，rt:287）。
 *
 * 为什么不能复用 `content_reports`：那张表的 `task_id` 是业务必需（分享/任务举报），
 * 而创作者作品不是任务；硬塞会让"举报处理"列表混入两类对象、且 FK 无法表达。
 */
export const assetReports = pgTable(
  "asset_reports",
  {
    id: pk(),
    assetId: bigint("asset_id", { mode: "bigint" })
      .notNull()
      .references(() => creatorAssets.id),
    reporterUserId: bigint("reporter_user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    reason: text("reason").notNull(),
    detail: text("detail"),
    contact: text("contact"),
    /** 1 待处理 / 2 已处置 / 3 已驳回 */
    status: smallint("status").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // 同一人对同一作品只报一次（防刷；重复举报由前端提示"已收到"）
  (t) => [
    uniqueIndex("uq_asset_reports").on(t.assetId, t.reporterUserId),
    index("idx_asset_reports_status").on(t.status, t.createdAt.desc()),
  ],
);

// ── 集市分类/标签 + 审核留痕（迁移 0030）──────────────────────────────
/**
 * 集市分类（平台级目录，运营维护；作品通过 `market_works.category_id` 引用）。
 * 不建 FK 到 works 的反向关系：分类删除一律停用（status=2）而不是物理删，
 * 否则历史作品的分类会变成悬空指针，列表筛选直接漏数据。
 */
export const marketCategories = pgTable(
  "market_categories",
  {
    id: pk(),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    /** 1 启用 / 2 停用 */
    status: smallint("status").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_market_categories_name").on(t.name),
    index("idx_market_categories_sort").on(t.status, t.sort),
  ],
);

export const marketTags = pgTable(
  "market_tags",
  {
    id: pk(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_market_tags_name").on(t.name)],
);

/**
 * 集市审核留痕（提交/通过/驳回/下架 四类动作各一行）。
 * 为什么独立成表而不是只留 `market_works.audit_note`：那只是"最后一次"，
 * 而客诉/申诉要看完整审核轨迹（谁在什么时候因为什么把作品打回）。
 */
export const marketReviewLogs = pgTable(
  "market_review_logs",
  {
    id: pk(),
    workId: bigint("work_id", { mode: "bigint" })
      .notNull()
      .references(() => marketWorks.id),
    /** 1 提交 / 2 通过 / 3 驳回 / 4 下架（与作品 status 变更一一对应） */
    action: smallint("action").notNull(),
    /** 操作人（运营在 admin_users；作品作者自助下架时为空） */
    operatorAdminId: bigint("operator_admin_id", { mode: "bigint" }).references(() => adminUsers.id),
    operatorUserId: bigint("operator_user_id", { mode: "bigint" }).references(() => users.id),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_market_review_logs_work").on(t.workId, t.createdAt.desc())],
);

// ── 分集资源清单（迁移 0031）：一致性匹配的"快照载体" ──────────────────
/**
 * 分集资源清单 —— 每集每类（角色/场景/道具）的**完整快照**。
 *
 * 为什么需要这张表（上一轮的真实偏离）：竞品 `episode.md:368-388` 的
 * `save-resource-matches` 是"整类快照"语义，而上一轮没有表可存，只能用
 * 「分镜绑定 ∪ 提示词提及」做投影，无法表达"某资产属于本集但没有任何镜头提到"。
 * 有了这张表，快照就是一等公民：一次 PUT 把某类清空重写，读取就是本集权威清单。
 *
 * 唯一键 `(episode_id, kind, name)`：同一集同一类下同名资源只能有一条
 * （同名不同 id 会让前端列表出现两行"同一角色"）。
 */
export const episodeResources = pgTable(
  "episode_resources",
  {
    id: pk(),
    episodeId: bigint("episode_id", { mode: "bigint" })
      .notNull()
      .references(() => episodes.id),
    spaceId: bigint("space_id", { mode: "bigint" })
      .notNull()
      .references(() => spaces.id),
    /** 1 角色 / 2 场景 / 3 道具（与 project_assets.kind 的语义一致，但用 smallint 便于索引/枚举） */
    kind: smallint("kind").notNull().default(1),
    /** 指向项目资产（可空：清单里允许"待补"的占位条目，此时只有 name+prompt） */
    projectAssetId: bigint("project_asset_id", { mode: "bigint" }).references(() => projectAssets.id),
    name: text("name").notNull(),
    prompt: text("prompt"),
    /** 顺序即前端展示顺序（与资产绑定顺序同口径，避免两套排序） */
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_episode_resources").on(t.episodeId, t.kind, t.name),
    index("idx_episode_resources_episode").on(t.episodeId, t.kind, t.sort),
  ],
);
