import { z } from "zod";

/**
 * 影视版 film（第 5 批）请求 / 响应 schema。
 *
 * 对照竞品 film 域（37 路径 / 48 操作）的四层结构：
 *   film_tables（表）→ film_fields（列）→ film_tasks（行）→ film_cells（单元格）
 * 外加审核版本链（version → comments → reads）与画布绑定。
 *
 * 形状来源：bundle 逆向（`_acceptance/_gap/contract-draft-cam-film.md` §2.3 / §7）。
 * 竞品对外**只暴露 `{field_id: value}` 映射**，落库才是 film_cells 行——
 * 本文件按"对外映射"的视角描述，不给 film_cells 行结构单独出 schema（内外有别）。
 */

// ── 字段类型系统（bundle 实证 9 种 + 我方 2 种扩展）──────────────────────

/**
 * 11 种 field_type。
 *
 * 竞品 bundle 实证 9 种：text / asset_ref / link / user / date / canvas_ref /
 * task_status / review_ref / points_ro。
 * 我方扩展 3 种：select / multi_select / number —— 竞品把选项塞进 text 的 config_json，
 * 拆成独立类型才能做服务端校验（否则"单选列"里能存任意字符串）。
 * 保留竞品的 task_status（行状态镜像列），但它与 review_ref 一样**不接受写入**。
 */
export const FILM_FIELD_TYPES = [
  "text",
  "date",
  "user",
  "select",
  "multi_select",
  "number",
  "link",
  "canvas_ref",
  "asset_ref",
  "review_ref",
  "points_ro",
] as const;
export type FilmFieldType = (typeof FILM_FIELD_TYPES)[number];
export const filmFieldTypeSchema = z.enum(FILM_FIELD_TYPES);

/**
 * 用户可创建的字段类型（8 + 3 扩展）。
 *
 * 排除 `review_ref`（由审核流生成，用户建了就是空列）、
 * `points_ro`（只读聚合，不能作为普通列）——竞品同样把它们当系统占位。
 */
export const FILM_USER_FIELD_TYPES = [
  "text",
  "date",
  "user",
  "select",
  "multi_select",
  "number",
  "link",
  "canvas_ref",
  "asset_ref",
] as const;
export type FilmUserFieldType = (typeof FILM_USER_FIELD_TYPES)[number];
export const filmUserFieldTypeSchema = z.enum(FILM_USER_FIELD_TYPES);

/** 只读字段类型：写入一律 400101（`field=<field_id>`） */
export const FILM_READONLY_FIELD_TYPES = ["review_ref", "points_ro", "task_status"] as const;

/** 系统字段 key（竞品实证 6 个；`fields` 不可删、`field_type` 不可改） */
export const FILM_SYSTEM_FIELD_KEYS = [
  "title",
  "assignees",
  "produce",
  "task_status",
  "review",
  "points",
] as const;
export type FilmSystemFieldKey = (typeof FILM_SYSTEM_FIELD_KEYS)[number];

/** 行状态：1 not_started / 2 in_progress / 3 pending_review / 4 rejected / 5 done */
export const FilmTaskStatus = {
  NOT_STARTED: 1,
  IN_PROGRESS: 2,
  PENDING_REVIEW: 3,
  REJECTED: 4,
  DONE: 5,
} as const;
export type FilmTaskStatus = (typeof FilmTaskStatus)[keyof typeof FilmTaskStatus];
export const filmTaskStatusSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

/** 对外暴露的英文名（前端/CLI 用；库内仍是 smallint） */
export const FILM_TASK_STATUS_NAMES = [
  "not_started",
  "in_progress",
  "pending_review",
  "rejected",
  "done",
] as const;
export type FilmTaskStatusName = (typeof FILM_TASK_STATUS_NAMES)[number];

/** 审核版本状态：1 pending / 2 approved / 3 rejected */
export const FilmReviewStatus = { PENDING: 1, APPROVED: 2, REJECTED: 3 } as const;
export type FilmReviewStatus = (typeof FilmReviewStatus)[keyof typeof FilmReviewStatus];
export const filmReviewStatusSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

/** 版本号格式：V01 / V02 …（两位补零；>99 自然进位 V100，不截断） */
export const FILM_VERSION_NO_RE = /^V\d{2,}$/;
export const filmVersionNoSchema = z
  .string()
  .regex(FILM_VERSION_NO_RE, "version_no 形如 V01 / V02");

export const FILM_LIMITS = {
  TABLE_NAME_MAX: 100,
  FIELD_NAME_MAX: 50,
  FIELD_KEY_MAX: 64,
  /** 单表字段数上限（竞品未见；64 是前端横向渲染的可用边界） */
  FIELD_MAX: 64,
  TASK_TITLE_MAX: 200,
  /** 单行文本单元格上限 */
  CELL_TEXT_MAX: 10_000,
  COMMENT_MAX: 2_000,
  /** 批量操作上限（批量删除/恢复/改状态一次最多行数） */
  BATCH_MAX: 200,
  /** 单表行数上限（列表页分页之外的保护；超出应分表而不是硬撑） */
  TASK_MAX: 20_000,
  /** select/multi_select 选项上限 */
  OPTION_MAX: 200,
  /** 单次提交审核的产物数量上限 */
  SUBMIT_RESULT_MAX: 50,
} as const;

// ── config_json 的类型专属形状（服务端只做类型白名单 + 长度上限，未知键透传）──

/** select / multi_select 的选项 */
export const filmSelectOptionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(FILM_LIMITS.FIELD_NAME_MAX),
  color: z.string().max(32).optional(),
});
export type FilmSelectOption = z.infer<typeof filmSelectOptionSchema>;

/**
 * 字段配置（各类型只声明自己用到的键，其余透传）。
 *
 * `.passthrough()` 是**故意的**，与 novel.ts 的"strip 未知键"相反：
 * 竞品 config_json 的 schema 完全黑盒（A1），我们不认识的键必须原样存回去，
 * 否则前端下次读回时会少配置（选项消失/校验丢失）。"不认识就丢"在这里是 bug 不是安全。
 */
export const filmFieldConfigSchema = z
  .object({
    /** select / multi_select */
    options: z.array(filmSelectOptionSchema).max(FILM_LIMITS.OPTION_MAX).optional(),
    /** number */
    precision: z.number().int().min(0).max(6).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    /** text */
    max_length: z.number().int().min(1).max(FILM_LIMITS.CELL_TEXT_MAX).optional(),
    /** asset_ref / canvas_ref / review_ref 的目标域提示（asset|canvas|review） */
    ref_domain: z.string().max(32).optional(),
    /** 列宽默认值（px） */
    default_width: z.number().int().min(40).max(2_000).optional(),
  })
  .passthrough();
export type FilmFieldConfig = z.infer<typeof filmFieldConfigSchema>;

/**
 * 单元格值（按 field_type 判别）。
 *
 * 竞品有 `encodeCell/decodeCell` 的规范形，但具体 shape 我方只知大类，
 * 故这里用"九种可判别的联合"而不是 `z.any()`：至少能拦住"把对象塞进 date 列"。
 * `null` 一律表示"清空"（落库是 DELETE 行，不是写 null，见 film_cells 注释）。
 */
export const filmCellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.array(z.number()),
  z.record(z.string(), z.unknown()),
]);

// ══════════════════════════════════════════════════════════════════════
// 一、请求 schema
// ══════════════════════════════════════════════════════════════════════

/** 新建任务表（`POST /film/projects/:pid/task-tables`） */
export const filmTableCreateSchema = z.object({
  name: z.string().trim().min(1).max(FILM_LIMITS.TABLE_NAME_MAX),
  /** 是否预置表（仅在 ensure-presets 内部使用；外部建表强制 false） */
  is_preset: z.boolean().default(false),
  sort: z.number().int().min(0).optional(),
});
export type FilmTableCreateRequest = z.infer<typeof filmTableCreateSchema>;

/** 表更新（`PATCH .../task-tables/:table_id`）；version 必带（表级乐观锁） */
export const filmTablePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(FILM_LIMITS.TABLE_NAME_MAX).optional(),
    sort: z.number().int().min(0).optional(),
    /** 表级乐观锁：不匹配 → 746002 */
    version: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.values(v).some((item) => item !== undefined), {
    message: "至少需要一个可更新字段",
  });
export type FilmTablePatchRequest = z.infer<typeof filmTablePatchSchema>;

/** 表排序（`POST .../task-tables/reorder`）：整体替换顺序 */
export const filmTableReorderSchema = z.object({
  /** 有序 table_id 列表；未列出的表排在末尾（保持原相对顺序） */
  table_ids: z.array(z.string().min(1)).min(1).max(100),
});
export type FilmTableReorderRequest = z.infer<typeof filmTableReorderSchema>;

/**
 * 新建字段（`POST .../task-tables/:table_id/fields`）。
 *
 * `key` 服务端派生（按 name 转 slug），**不接受客户端指定**：客户端指定会让
 * 唯一性冲突（400101）的分工变得含糊，且改了 name 之后 key 该不该跟着变无法回答。
 * `is_unique_type` 在此**是列唯一性**（该 type 每表至多一个），见下。
 */
export const filmFieldCreateSchema = z.object({
  name: z.string().trim().min(1).max(FILM_LIMITS.FIELD_NAME_MAX),
  field_type: filmUserFieldTypeSchema,
  /**
   * ⚠️ 语义 = 「**该 field_type 每表至多一个**」，**不是"值唯一"**（bundle `_e(t,e)` 实证）。
   * 传 true 时服务端扫本表是否已有同 field_type 且 is_unique_type=1 的字段，有则 400101。
   * 与单元格里存什么值完全无关——按"值唯一"实现会直接错。
   */
  is_unique_type: z.boolean().default(false),
  sort: z.number().int().min(0).optional(),
  config_json: filmFieldConfigSchema.optional(),
  width: z.number().int().min(40).max(2_000).optional(),
});
export type FilmFieldCreateRequest = z.infer<typeof filmFieldCreateSchema>;

/**
 * 更新字段（`PATCH .../fields/:field_id`）。
 *
 * `field_type` 变更会让已有单元格语义失效（date 列改成 number，旧值就是垃圾），
 * 故要求显式 `confirm_clear=true`；未带且该列已有数据 → 400101。
 */
export const filmFieldPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(FILM_LIMITS.FIELD_NAME_MAX).optional(),
    field_type: filmUserFieldTypeSchema.optional(),
    is_unique_type: z.boolean().optional(),
    sort: z.number().int().min(0).optional(),
    config_json: filmFieldConfigSchema.optional(),
    hidden: z.boolean().optional(),
    width: z.number().int().min(40).max(2_000).nullish(),
    /** 改类型时确认清空已有单元格（不传则拒绝改类型） */
    confirm_clear: z.boolean().default(false),
  })
  .refine((v) => Object.values(v).some((item) => item !== undefined), {
    message: "至少需要一个可更新字段",
  });
export type FilmFieldPatchRequest = z.infer<typeof filmFieldPatchSchema>;

/** 字段排序（`POST .../fields/reorder`） */
export const filmFieldReorderSchema = z.object({
  field_ids: z.array(z.string().min(1)).min(1).max(FILM_LIMITS.FIELD_MAX),
});
export type FilmFieldReorderRequest = z.infer<typeof filmFieldReorderSchema>;

/** 字段批量恢复（`.../fields/batch-restore`）：从软删中恢复 */
export const filmFieldBatchRestoreSchema = z.object({
  field_ids: z.array(z.string().min(1)).min(1).max(FILM_LIMITS.FIELD_MAX),
});
export type FilmFieldBatchRestoreRequest = z.infer<typeof filmFieldBatchRestoreSchema>;

/** 新建行（`POST .../task-tables/:table_id/tasks`）：可带初始单元格 */
export const filmTaskCreateSchema = z.object({
  title: z.string().trim().max(FILM_LIMITS.TASK_TITLE_MAX).optional(),
  parent_id: z.string().min(1).nullable().default(null),
  sort: z.number().int().min(0).optional(),
  assignee_user_id: z.string().min(1).nullable().optional(),
  /** 初始单元格：{field_id: value}；未知 field_id / 只读类型 → 400101 */
  cells: z.record(z.string(), filmCellValueSchema).optional(),
});
export type FilmTaskCreateRequest = z.infer<typeof filmTaskCreateSchema>;

/** 更新单元格（`PUT .../tasks/:task_id/cells`）：**稀疏增量**，只传要改的 */
export const filmCellsPutSchema = z.object({
  /** 行级乐观锁：必带，不匹配 → 746002 */
  version: z.number().int().min(1),
  /**
   * {field_id: value}。值 `null` = 清空该单元格（落库 DELETE）；
   * 未出现的 field_id = 不改（**不是**"置空"——这是稀疏语义，别按整体替换理解）。
   */
  cells: z.record(z.string(), filmCellValueSchema),
});
export type FilmCellsPutRequest = z.infer<typeof filmCellsPutSchema>;

/** 行状态变更（`POST .../tasks/:task_id/status`；竞品缺 review/approve，决策也走这里） */
export const filmTaskStatusUpdateSchema = z.object({
  status: filmTaskStatusSchema,
  /** 决策说明（驳回时写进版本 decision 记录） */
  comment: z.string().max(FILM_LIMITS.COMMENT_MAX).optional(),
});
export type FilmTaskStatusUpdateRequest = z.infer<typeof filmTaskStatusUpdateSchema>;

/** 行排序（`POST .../tasks/reorder`）：同一父级下整体重排 */
export const filmTaskReorderSchema = z.object({
  task_ids: z.array(z.string().min(1)).min(1).max(FILM_LIMITS.BATCH_MAX),
  parent_id: z.string().min(1).nullable().default(null),
});
export type FilmTaskReorderRequest = z.infer<typeof filmTaskReorderSchema>;

/** 行批量操作（`batch-delete` / `batch-restore`） */
export const filmTaskBatchSchema = z.object({
  task_ids: z.array(z.string().min(1)).min(1).max(FILM_LIMITS.BATCH_MAX),
});
export type FilmTaskBatchRequest = z.infer<typeof filmTaskBatchSchema>;

/** 行查询（`POST .../tasks/query`）：筛选/排序/分页 */
export const filmTaskQuerySchema = z.object({
  /** 按 field_id 的筛选条件（op 词表由字段类型决定，见 filterOps） */
  filters: z
    .array(
      z.object({
        field_id: z.string().min(1),
        op: z.string().min(1).max(32),
        value: filmCellValueSchema,
      }),
    )
    .max(20)
    .default([]),
  sorts: z
    .array(
      z.object({
        field_id: z.string().min(1),
        order: z.enum(["asc", "desc"]),
      }),
    )
    .max(5)
    .default([]),
  /** 只返回根行（默认 true；子行按需展开） */
  roots_only: z.boolean().default(true),
  page: z.number().int().min(1).default(1),
  page_size: z.number().int().min(1).max(200).default(50),
});
export type FilmTaskQueryRequest = z.infer<typeof filmTaskQuerySchema>;

/** 表视图偏好（`PUT .../pref`）：per (table, user) 覆盖写 */
export const filmTablePrefPutSchema = z.object({
  hidden_field_ids: z.array(z.string().min(1)).max(FILM_LIMITS.FIELD_MAX).default([]),
  filter: z.array(z.unknown()).max(20).default([]),
  ui: z.record(z.string(), z.unknown()).default({}),
});
export type FilmTablePrefPutRequest = z.infer<typeof filmTablePrefPutSchema>;

/** 提交审核（`POST .../tasks/:task_id/review`）：产生不可变 V0x */
export const filmReviewSubmitSchema = z.object({
  /** 本版产物的 asset_id 列表（画布节点产物 / 上传文件） */
  asset_ids: z.array(z.string().min(1)).max(FILM_LIMITS.SUBMIT_RESULT_MAX).default([]),
  /** 缩略图 storage key（列表页免签 URL 直显） */
  thumb_file_id: z.string().max(500).optional(),
  comment: z.string().max(FILM_LIMITS.COMMENT_MAX).optional(),
});
export type FilmReviewSubmitRequest = z.infer<typeof filmReviewSubmitSchema>;

/** 审核决策（`POST .../review/:version_id/status`；竞品缺 approve 端点，我方以此承载） */
export const filmReviewDecideSchema = z.object({
  status: z.union([z.literal(2), z.literal(3)]), // 2 通过 / 3 驳回（不允许直接置 pending）
  comment: z.string().max(FILM_LIMITS.COMMENT_MAX).optional(),
});
export type FilmReviewDecideRequest = z.infer<typeof filmReviewDecideSchema>;

/** 审核评论（`POST .../review/comments`） */
export const filmReviewCommentCreateSchema = z.object({
  version_id: z.string().min(1),
  content: z.string().trim().min(1).max(FILM_LIMITS.COMMENT_MAX),
});
export type FilmReviewCommentCreateRequest = z.infer<typeof filmReviewCommentCreateSchema>;

/** 已读回执（`POST .../review/read`）：按版本记（批量，一次可标记多版已读） */
export const filmReviewReadMarkSchema = z.object({
  version_ids: z.array(z.string().min(1)).min(1).max(FILM_LIMITS.BATCH_MAX),
});
export type FilmReviewReadMarkRequest = z.infer<typeof filmReviewReadMarkSchema>;

/** 行↔画布绑定（`POST .../tasks/:task_id/canvas-bindings`） */
export const filmCanvasBindingCreateSchema = z.object({
  canvas_id: z.string().min(1),
  /** 节点 ID；省略 = 只绑画布（"在画布上打开这行"），不带具体节点 */
  node_id: z.string().min(1).optional(),
});
export type FilmCanvasBindingCreateRequest = z.infer<typeof filmCanvasBindingCreateSchema>;

/** 画布侧提交结果（`POST .../canvases/:canvas_id/submit-result`）：唯一的自动化衔接点 */
export const filmSubmitResultSchema = z.object({
  /** 归属的行（必填：提交必须落到某条工单上，否则产物无处可审） */
  task_id: z.string().min(1),
  node_id: z.string().min(1),
  /** 产物 asset_id（画布节点产出） */
  asset_ids: z.array(z.string().min(1)).max(FILM_LIMITS.SUBMIT_RESULT_MAX).default([]),
  thumb_file_id: z.string().max(500).optional(),
  comment: z.string().max(FILM_LIMITS.COMMENT_MAX).optional(),
});
export type FilmSubmitResultRequest = z.infer<typeof filmSubmitResultSchema>;

/** 表导入（`POST .../task-tables/import`）：从 xlsx/csv 建表建行 */
export const filmTableImportSchema = z.object({
  name: z.string().trim().min(1).max(FILM_LIMITS.TABLE_NAME_MAX),
  /** 表头 → 字段类型的映射；未列出的表头按 text 建 */
  field_types: z.record(z.string(), filmFieldTypeSchema).default({}),
  /** 行数据：每行是 {表头: 单元格文本} */
  rows: z.array(z.record(z.string(), z.string())).min(1).max(FILM_LIMITS.BATCH_MAX),
});
export type FilmTableImportRequest = z.infer<typeof filmTableImportSchema>;

/** 应用任务模板（`POST .../task-tables/apply-template`） */
export const filmApplyTemplateSchema = z.object({
  template_id: z.string().min(1),
  name: z.string().trim().min(1).max(FILM_LIMITS.TABLE_NAME_MAX).optional(),
});
export type FilmApplyTemplateRequest = z.infer<typeof filmApplyTemplateSchema>;

/** 导出（`POST .../exports`）：异步打包 xlsx */
export const filmExportCreateSchema = z.object({
  table_ids: z.array(z.string().min(1)).min(1).max(50),
  format: z.enum(["xlsx", "csv"]).default("xlsx"),
});
export type FilmExportCreateRequest = z.infer<typeof filmExportCreateSchema>;

// ══════════════════════════════════════════════════════════════════════
// 二、响应 schema
// ══════════════════════════════════════════════════════════════════════

export const filmTableSchema = z.object({
  id: z.string(),
  space_id: z.string(),
  project_id: z.string(),
  name: z.string(),
  is_preset: z.boolean(),
  sort: z.number().int(),
  version: z.number().int(),
});
export type FilmTable = z.infer<typeof filmTableSchema>;

export const filmFieldSchema = z.object({
  id: z.string(),
  table_id: z.string(),
  key: z.string(),
  name: z.string(),
  field_type: filmFieldTypeSchema,
  is_system: z.boolean(),
  /**
   * ⚠️ 「该 field_type 每表至多一个」，**不是值唯一**。
   * 响应里原样透出，前端不要拿它做"值不可重复"的判断。
   */
  is_unique_type: z.boolean(),
  sort: z.number().int(),
  config_json: z.record(z.string(), z.unknown()).default({}),
  hidden: z.boolean(),
  width: z.number().int().nullable().default(null),
});
export type FilmField = z.infer<typeof filmFieldSchema>;

export const filmTaskSchema = z.object({
  id: z.string(),
  table_id: z.string(),
  parent_id: z.string().nullable().default(null),
  sort: z.number().int(),
  version: z.number().int(),
  status: filmTaskStatusSchema,
  title: z.string(),
  review_version_no: z.number().int(),
  assignee_user_id: z.string().nullable().default(null),
  /** {field_id: value} 映射（**不是** film_cells 行；内外有别） */
  cells: z.record(z.string(), filmCellValueSchema).default({}),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FilmTask = z.infer<typeof filmTaskSchema>;

/** 行列表项（不含 cells，避免一页 50 行 × 64 列全量拉取） */
export const filmTaskSummarySchema = filmTaskSchema.omit({ cells: true });
export type FilmTaskSummary = z.infer<typeof filmTaskSummarySchema>;

export const filmReviewVersionSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  version_no: filmVersionNoSchema,
  status: filmReviewStatusSchema,
  submitted_by: z.string(),
  submitted_at: z.string(),
  decided_by: z.string().nullable().default(null),
  decided_at: z.string().nullable().default(null),
});
export type FilmReviewVersion = z.infer<typeof filmReviewVersionSchema>;

export const filmReviewCommentSchema = z.object({
  id: z.string(),
  version_id: z.string(),
  author_id: z.string(),
  content: z.string(),
  created_at: z.string(),
});
export type FilmReviewComment = z.infer<typeof filmReviewCommentSchema>;

export const filmReviewReadSchema = z.object({
  version_id: z.string(),
  user_id: z.string(),
  read_at: z.string(),
});
export type FilmReviewReadView = z.infer<typeof filmReviewReadSchema>;

export const filmCanvasBindingSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  canvas_id: z.string(),
  node_id: z.string(),
  created_at: z.string(),
});
export type FilmCanvasBinding = z.infer<typeof filmCanvasBindingSchema>;
