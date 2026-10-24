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
    kind: text("kind").notNull(), // recharge|gift|freeze|settle|unfreeze|adjust
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
