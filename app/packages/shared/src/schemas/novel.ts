import { z } from "zod";

/**
 * 小说改编链（第 2 批）请求 / 响应 / LLM 输出 schema。
 *
 * 对照竞品 `df/novel` 域（86 端点），链序固定：
 *   分章解析 → 内容分析（世界观 + 角色卡）→ 章节大纲 → 分集大纲
 *   → 分集剧本 → 剧本编辑 Agent（会话式逐集 diff）→ 版本 finalize
 *
 * ⚠️ 本文件里 **LLM 输出 schema（`*ResultSchema`）与请求 schema 分两套**，绝不共用：
 * LLM 那条链要的是"结构不对就当场失败"（prompt 工程的锚，见 §0.2 任务 0.2），
 * 而请求那条链要的是"宽容收下用户/前端的半成品"（可空、可缺、可部分更新）。
 * 把两者合成一个 schema 的结果一定是：要么 LLM 幻觉字段静默入库，要么用户改半个字段被拒。
 *
 * 枚举常量在本文件内定义而不放 `constants.ts`：本批只服务于 novel 链，
 * 且 `source_type` 的 5 值域与 `script_projects.source_type` 的 4 值域**语义不同**（见下），
 * 放进公共 constants 迟早被误引用。
 */

// ── 枚举（与 db/schema.ts 的 smallint 注释逐条对齐）─────────────────────

/**
 * 剧本来本来源（对照竞品 NT.source_type）。
 *
 * ⚠️ 与 `ProjectSourceType`（1novel/2idea/3script/4fission，见 constants.ts）**不是同一套**：
 * 竞品在剧本工厂里多一个 `5 overseas`（海外改编）。两个域各自演进，不做归一。
 */
export const NovelSourceType = {
  NOVEL: 1, // 小说改编
  IDEA: 2, // 一句话想法
  SCRIPT: 3, // 导入剧本
  FISSION: 4, // 创意裂变
  OVERSEAS: 5, // 海外改编
} as const;
export type NovelSourceType = (typeof NovelSourceType)[keyof typeof NovelSourceType];
export const novelSourceTypeSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

/**
 * 剧本状态。**16 = 已定稿**是竞品原值，不要归一成 2。
 *
 * 定稿是 §3.3 衔接契约的唯一判据：只有 `status === NOVEL_FINALIZED` 的 NT 才允许作为
 * `POST /projects/:id/episodes/split` 的拆集来源，否则 400。
 */
export const NovelStatus = { DRAFT: 1, FINALIZED: 16 } as const;
export type NovelStatus = (typeof NovelStatus)[keyof typeof NovelStatus];
export const novelStatusSchema = z.union([z.literal(1), z.literal(16)]);

/** 角色类型：1 主角 / 2 配角 / 3 反派 */
export const NovelRoleType = { LEAD: 1, SUPPORTING: 2, VILLAIN: 3 } as const;
export type NovelRoleType = (typeof NovelRoleType)[keyof typeof NovelRoleType];
export const novelRoleTypeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** 分集剧本状态：1 草稿 / 2 已确认 */
export const NovelEpisodeStatus = { DRAFT: 1, CONFIRMED: 2 } as const;
export const novelEpisodeStatusSchema = z.union([z.literal(1), z.literal(2)]);

/** 编辑会话状态：1 active / 2 closed */
export const NovelEditSessionStatus = { ACTIVE: 1, CLOSED: 2 } as const;

/** 待确认 diff 状态：1 pending / 2 applied / 3 rejected */
export const NovelEditPendingStatus = { PENDING: 1, APPLIED: 2, REJECTED: 3 } as const;
export const novelEditPendingStatusSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

/** 会话消息角色：1 user / 2 assistant（沿用 agent_messages.role 编码） */
export const NovelEditMessageRole = { USER: 1, ASSISTANT: 2 } as const;

// ── 长度上限（集中一处，便于 prompt 与校验共用同一口径）────────────────
export const NOVEL_LIMITS = {
  TITLE_MAX: 200,
  CHAPTER_CONTENT_MAX: 200_000,
  /** 整本来源文本上限，与 createProjectSchema 的 NOVEL_MAX 同口径（5 万字） */
  SOURCE_TEXT_MAX: 50_000,
  WORLDVIEW_SUMMARY_MAX: 2_000,
  CHARACTER_NAME_MAX: 50,
  CHARACTER_DESC_MAX: 500,
  CHARACTER_APPEARANCE_MAX: 1_000,
  CHARACTER_PERSONALITY_MAX: 500,
  CHARACTER_PROMPT_MAX: 1_000,
  SYNOPSIS_MAX: 1_000,
  SCRIPT_TEXT_MAX: 100_000,
  /** 单本最多 200 章（竞品未见上限；200 是分章解析的内存与前端渲染边界，超出直接拒绝） */
  CHAPTER_MAX: 200,
  /** 单本最多 100 集（与 outlineSchema 的 20 集不同：这是整本累计，那是单次生成） */
  EPISODE_MAX: 100,
  /** 角色卡上限：竞品「≤10 张」（PRD F2），与 LIMITS.CHARACTER_MAX 同口径 */
  CHARACTER_MAX: 10,
  EDIT_MESSAGE_MAX: 4_000,
  EDIT_PENDING_CHANGE_SUMMARY_MAX: 500,
} as const;

// ══════════════════════════════════════════════════════════════════════
// 一、LLM 结构化输出 schema（prompt 工程的锚；**强约束**）
//
// 约定（三条，下游 prompt 依赖它们做校验与重试）：
// 1. 只用 `z.object`，**禁止 `z.record`**——record 会把"模型编的任意键"当合法输出放行，
//    等于放弃校验；每个字段都显式声明类型与长度，模型改结构时当场失败而不是静默入库。
// 2. 未声明的键被 **strip 丢弃而非合并**：模型多吐的字段永远不会进 DB。
// 3. 数组一律给 `.min(1)`——空数组是"这次生成没成功"的典型形态，必须让它变成可重试的失败，
//    而不是"成功但什么都不落库"（后者最难排查）。
// ══════════════════════════════════════════════════════════════════════

/** 人物关系边（世界观的结构化子结构）。`from`/`to` 必须是角色名，由应用层校验存在性 */
export const novelRelationSchema = z.object({
  from: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_NAME_MAX),
  to: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_NAME_MAX),
  /** 关系类别：师徒/父子/敌对/恋人/同盟…（开放词表，竞品未给枚举，故不做 enum 白名单） */
  kind: z.string().trim().min(1).max(50),
  note: z.string().max(500).default(""),
});
export type NovelRelation = z.infer<typeof novelRelationSchema>;

/**
 * 世界观 LLM 输出（`content-analysis` 的世界观产出）。
 *
 * 为什么字段是"必填"而不是"可选"：世界观是后续大纲/剧本的共同上下文，
 * 缺一块就等于后续所有集都缺这一块，而用户很难看出"是因为时代没定"。
 * 让它在生成时就失败、重试，比事后人工补更便宜。
 */
export const worldviewResultSchema = z
  .object({
    /** 时代背景（"民国上海""架空仙侠"…） */
    era: z.string().trim().min(1).max(500),
    /** 地理/场景基调 */
    geography: z.string().trim().min(1).max(1_000),
    /** 势力/门派/公司等组织 */
    factions: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_NAME_MAX),
          description: z.string().max(NOVEL_LIMITS.CHARACTER_DESC_MAX).default(""),
        }),
      )
      .max(50)
      .default([]),
    /** 世界规则/设定约束（禁术、法律、超能力边界…） */
    rules: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    /** 人物关系图（跨角色，是资产一致性的上游） */
    relations: z.array(novelRelationSchema).max(200).default([]),
    /** 总述（给人看的那段话） */
    summary: z.string().trim().min(1).max(NOVEL_LIMITS.WORLDVIEW_SUMMARY_MAX),
  })
  .refine(
    // 关系边不得自指（"甲→甲"是模型常见幻觉，落库后会让关系图渲染出环）
    (v) => v.relations.every((r) => r.from !== r.to),
    { message: "relations 不允许自指（from === to）", path: ["relations"] },
  );
export type WorldviewResult = z.infer<typeof worldviewResultSchema>;

/** 角色卡 LLM 输出中的单条（**全部字段必填**，prompt 里逐字段点名要求） */
export const novelCharacterResultItemSchema = z.object({
  name: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_NAME_MAX),
  role_type: novelRoleTypeSchema,
  description: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_DESC_MAX),
  appearance: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_APPEARANCE_MAX),
  personality: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_PERSONALITY_MAX),
  prompt: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_PROMPT_MAX),
  is_core: z.boolean(),
});
export type NovelCharacterResultItem = z.infer<typeof novelCharacterResultItemSchema>;

/**
 * 角色卡 LLM 输出（`content-analysis` + `core_character` 子链共用）。
 *
 * `refine` 去重是**故意让重复直接失败**而不是"自动去重"：自动去重会掩盖模型行为退化
 * （它开始吐重复名字往往意味着提示词或上下文窗口出了问题），而 CI 里应当看见失败。
 */
export const novelCharactersResultSchema = z
  .object({
    characters: z
      .array(novelCharacterResultItemSchema)
      .min(1)
      .max(NOVEL_LIMITS.CHARACTER_MAX),
  })
  .refine(
    (v) => new Set(v.characters.map((c) => c.name)).size === v.characters.length,
    { message: "characters 内 name 不允许重复", path: ["characters"] },
  );
/**
 * 命名带 `Novel` 前缀是**必须**的：`pipeline.ts` 已导出 `CharactersResult`
 * （制片工坊的单集角色提取），两者结构相近但上限/上下文不同，同名会被 barrel
 * 导出判为歧义（TS2308）——更糟的是调用方会以为可以混用。
 */
export type NovelCharactersResult = z.infer<typeof novelCharactersResultSchema>;

/** 有序序号数组必须严格递增且不重复（章节/分集大纲共用校验） */
const strictlyAscending = (nos: number[]): boolean =>
  nos.every((n, i) => (i === 0 ? true : n > nos[i - 1]));

/** 章节大纲 LLM 输出（`chapter_outline` 子链） */
export const chapterOutlineResultSchema = z
  .object({
    chapters: z
      .array(
        z.object({
          chapter_no: z.number().int().min(1).max(NOVEL_LIMITS.CHAPTER_MAX),
          title: z.string().trim().min(1).max(NOVEL_LIMITS.TITLE_MAX),
          synopsis: z.string().trim().min(1).max(NOVEL_LIMITS.SYNOPSIS_MAX),
        }),
      )
      .min(1)
      .max(NOVEL_LIMITS.CHAPTER_MAX),
  })
  .refine((v) => strictlyAscending(v.chapters.map((c) => c.chapter_no)), {
    message: "chapters[].chapter_no 必须严格递增且不重复",
    path: ["chapters"],
  })
  .refine((v) => v.chapters[0]?.chapter_no === 1, {
    // 章号从 1 起（不是 0）：后续按 chapter_no 与原文分章对齐，起点错位会整本错位
    message: "chapters 必须从 chapter_no=1 开始",
    path: ["chapters", 0, "chapter_no"],
  });
export type ChapterOutlineResult = z.infer<typeof chapterOutlineResultSchema>;

/** 分集大纲 LLM 输出（`episode_outline` 子链） */
export const episodeOutlineResultSchema = z
  .object({
    episodes: z
      .array(
        z.object({
          episode_no: z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX),
          title: z.string().trim().min(1).max(NOVEL_LIMITS.TITLE_MAX),
          synopsis: z.string().trim().min(1).max(NOVEL_LIMITS.SYNOPSIS_MAX),
        }),
      )
      .min(1)
      .max(NOVEL_LIMITS.EPISODE_MAX),
  })
  .refine((v) => strictlyAscending(v.episodes.map((e) => e.episode_no)), {
    message: "episodes[].episode_no 必须严格递增且不重复",
    path: ["episodes"],
  })
  .refine((v) => v.episodes[0]?.episode_no === 1, {
    message: "episodes 必须从 episode_no=1 开始",
    path: ["episodes", 0, "episode_no"],
  });
export type EpisodeOutlineResult = z.infer<typeof episodeOutlineResultSchema>;

/**
 * 剧本 LLM 输出（`script-generate`，多集批量）。
 *
 * 与 `pipeline.ts` 的 `scriptDraftSchema` 不同：那是单集单篇，这是**多集一次生成**。
 * `refine` 要求 episode_no 集合与请求的集号集合一致——模型少吐一集是高频故障，
 * 必须变成失败（可重试/可补生成），否则会出现"第 7 集永远空着"的静默缺口。
 */
export const novelScriptResultSchema = z
  .object({
    episodes: z
      .array(
        z.object({
          episode_no: z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX),
          title: z.string().trim().min(1).max(NOVEL_LIMITS.TITLE_MAX),
          script_text: z.string().trim().min(1).max(NOVEL_LIMITS.SCRIPT_TEXT_MAX),
        }),
      )
      .min(1)
      .max(NOVEL_LIMITS.EPISODE_MAX),
  })
  .refine((v) => strictlyAscending(v.episodes.map((e) => e.episode_no)), {
    message: "episodes[].episode_no 必须严格递增且不重复",
    path: ["episodes"],
  });
export type NovelScriptResult = z.infer<typeof novelScriptResultSchema>;

/**
 * 剧本编辑 Agent 单轮输出的**变更计划**（不是剧本正文）。
 *
 * 这是竞品最精妙的设计点：模型输出的是"要改哪几集、怎么改"，
 * 正文由服务端做 diff 落到 `novel_edit_pendings`；模型**不得**直接返回整篇剧本
 * （否则用户无法逐集确认，"驳回第 3 集"就无从实现）。
 * 故这里的 `episodes[].new_text` 是"建议的该集全文"，仍然只进 pending 不进 novel_episodes。
 */
export const editChatResultSchema = z
  .object({
    /** 给用户看的一句话说明 */
    reply: z.string().trim().min(1).max(NOVEL_LIMITS.EDIT_MESSAGE_MAX),
    /** 本次要改的集（空数组合法：用户在闲聊，没有变更） */
    episodes: z
      .array(
        z.object({
          episode_no: z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX),
          new_text: z.string().trim().min(1).max(NOVEL_LIMITS.SCRIPT_TEXT_MAX),
          change_summary: z.string().trim().min(1).max(NOVEL_LIMITS.EDIT_PENDING_CHANGE_SUMMARY_MAX),
        }),
      )
      .max(NOVEL_LIMITS.EPISODE_MAX)
      .default([]),
  })
  .refine((v) => new Set(v.episodes.map((e) => e.episode_no)).size === v.episodes.length, {
    message: "episodes[].episode_no 不允许重复（一集一条 diff）",
    path: ["episodes"],
  });
export type EditChatResult = z.infer<typeof editChatResultSchema>;

// ══════════════════════════════════════════════════════════════════════
// 二、请求 schema（create / patch / 动作）
// ══════════════════════════════════════════════════════════════════════

/** 新建剧本项目（`POST /novels`） */
export const createNovelSchema = z.object({
  title: z.string().trim().min(1).max(NOVEL_LIMITS.TITLE_MAX),
  source_type: novelSourceTypeSchema.default(NovelSourceType.NOVEL),
  /** 画面比例：与制片工坊一致，只提供 9:16 / 16:9 */
  ratio: z.enum(["9:16", "16:9"]).default("9:16"),
  /** 来源文本（小说正文 / 一句话想法 / 剧本原文），按 source_type 语义不同 */
  source_text: z.string().max(NOVEL_LIMITS.SOURCE_TEXT_MAX).default(""),
  /** 上传文件的原始文件名（仅留痕；内容已进 source_text 或经分章解析进 novel_chapters） */
  source_file_name: z.string().max(200).optional(),
  /** 预计集数；不传则由分集大纲生成后回写 */
  episode_count: z.number().int().min(0).max(NOVEL_LIMITS.EPISODE_MAX).optional(),
});
export type CreateNovelRequest = z.infer<typeof createNovelSchema>;

/** 更新剧本项目（`PATCH /novels/:id`）——至少一个可更新字段 */
export const novelPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(NOVEL_LIMITS.TITLE_MAX).optional(),
    ratio: z.enum(["9:16", "16:9"]).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    /** 归档（传时间戳）/ 取消归档（传 null） */
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((item) => item !== undefined), {
    message: "至少需要一个可更新字段",
  });
export type NovelPatchRequest = z.infer<typeof novelPatchSchema>;

/** 分章解析（`POST /novels/:id/split`）：把 source_text 切成 novel_chapters */
export const novelSplitSchema = z.object({
  /** 覆盖项目里的 source_text（省略则用已存的） */
  source_text: z.string().max(NOVEL_LIMITS.SOURCE_TEXT_MAX).optional(),
  /** 期望章数；省略则按标题正则（第N章/Chapter N）自动切分 */
  chapter_count: z.number().int().min(1).max(NOVEL_LIMITS.CHAPTER_MAX).optional(),
});
export type NovelSplitRequest = z.infer<typeof novelSplitSchema>;

/** 世界观覆盖写（`PUT /novels/:id/worldview`）：LLM 结果与人工编辑共用同一形状 */
export const worldviewPutSchema = worldviewResultSchema;
export type WorldviewPutRequest = z.infer<typeof worldviewPutSchema>;

/** 新建/覆盖单张角色卡（`POST /novels/:id/characters`） */
export const novelCharacterCreateSchema = z.object({
  name: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_NAME_MAX),
  role_type: novelRoleTypeSchema.default(NovelRoleType.SUPPORTING),
  description: z.string().max(NOVEL_LIMITS.CHARACTER_DESC_MAX).default(""),
  appearance: z.string().max(NOVEL_LIMITS.CHARACTER_APPEARANCE_MAX).default(""),
  personality: z.string().max(NOVEL_LIMITS.CHARACTER_PERSONALITY_MAX).default(""),
  prompt: z.string().max(NOVEL_LIMITS.CHARACTER_PROMPT_MAX).default(""),
  is_core: z.boolean().default(false),
});
export type NovelCharacterCreateRequest = z.infer<typeof novelCharacterCreateSchema>;

/** 角色卡部分更新（`PATCH /novels/:id/characters/:cid`） */
export const novelCharacterPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(NOVEL_LIMITS.CHARACTER_NAME_MAX).optional(),
    role_type: novelRoleTypeSchema.optional(),
    description: z.string().max(NOVEL_LIMITS.CHARACTER_DESC_MAX).nullish(),
    appearance: z.string().max(NOVEL_LIMITS.CHARACTER_APPEARANCE_MAX).nullish(),
    personality: z.string().max(NOVEL_LIMITS.CHARACTER_PERSONALITY_MAX).nullish(),
    prompt: z.string().max(NOVEL_LIMITS.CHARACTER_PROMPT_MAX).nullish(),
    is_core: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((item) => item !== undefined), {
    message: "至少需要一个可更新字段",
  });
export type NovelCharacterPatchRequest = z.infer<typeof novelCharacterPatchSchema>;

/** 角色卡整体确认（`POST /novels/:id/characters/confirm`：把 LLM 草稿批量落库） */
export const novelCharactersConfirmSchema = z.object({
  characters: z
    .array(novelCharacterResultItemSchema)
    .min(1)
    .max(NOVEL_LIMITS.CHARACTER_MAX),
  /** 同名已存在时是否覆盖（默认跳过，避免把用户手改过的卡冲掉） */
  overwrite: z.boolean().default(false),
});
export type NovelCharactersConfirmRequest = z.infer<typeof novelCharactersConfirmSchema>;

/** 章节大纲确认（`POST /novels/:id/chapter-outlines`：整体替换） */
export const chapterOutlinesPutSchema = chapterOutlineResultSchema;
export type ChapterOutlinesPutRequest = z.infer<typeof chapterOutlinesPutSchema>;

/** 分集大纲确认（`POST /novels/:id/episode-outlines`：整体替换） */
export const episodeOutlinesPutSchema = episodeOutlineResultSchema;
export type EpisodeOutlinesPutRequest = z.infer<typeof episodeOutlinesPutSchema>;

/** 剧本生成请求（`script-generate`；多集批量） */
export const novelScriptGenerateSchema = z.object({
  /** 指定要生成的集号；省略 = 全部未确认的集 */
  episode_nos: z.array(z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX)).min(1).max(50).optional(),
  /** 追加创作指令（"更紧张一些"），会拼进 prompt 但不改变输出结构 */
  instructions: z.string().max(1_000).optional(),
});
export type NovelScriptGenerateRequest = z.infer<typeof novelScriptGenerateSchema>;

/** 分集剧本部分更新（`PATCH /novels/:id/episodes/:eid`） */
export const novelEpisodePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(NOVEL_LIMITS.TITLE_MAX).optional(),
    script_text: z.string().max(NOVEL_LIMITS.SCRIPT_TEXT_MAX).optional(),
    status: novelEpisodeStatusSchema.optional(),
  })
  .refine((v) => Object.values(v).some((item) => item !== undefined), {
    message: "至少需要一个可更新字段",
  });
export type NovelEpisodePatchRequest = z.infer<typeof novelEpisodePatchSchema>;

/** 版本定稿（`POST /novels/:id/version/:vid/finalize`）；整本定稿另见 novelFinalizeSchema */
export const scriptVersionFinalizeSchema = z.object({
  /** 定稿说明（可选，写入审计） */
  memo: z.string().max(500).optional(),
});
export type ScriptVersionFinalizeRequest = z.infer<typeof scriptVersionFinalizeSchema>;

/**
 * 整本定稿（§3.3 衔接契约的入口）。
 * 成功后 `novels.status` 置 16，该 NT 才允许被 `episodes/split` 引用。
 */
export const novelFinalizeSchema = z.object({
  /** 是否先为每集生成一份版本快照（默认 true；false 表示只改状态，用于"内容早已确认"的场景） */
  snapshot_episodes: z.boolean().default(true),
  memo: z.string().max(500).optional(),
});
export type NovelFinalizeRequest = z.infer<typeof novelFinalizeSchema>;

// ── 剧本编辑 Agent（13 端点的请求面）────────────────────────────────

/** 进入编辑态 / 新建会话（`enter` + `POST /sessions` 共用；enter 可省略 body） */
export const novelEditSessionCreateSchema = z.object({
  /** 会话标题（列表展示）；省略则由首条消息截断派生 */
  title: z.string().max(100).optional(),
  /** 拟编辑的集号范围；省略 = 全书可改 */
  episode_nos: z.array(z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX)).max(50).optional(),
  /** 追加创作指令（进入会话时的前置约束，如"保持第一人称"） */
  instructions: z.string().max(1_000).optional(),
});
export type NovelEditSessionCreateRequest = z.infer<typeof novelEditSessionCreateSchema>;

/** 会话心跳（`POST .../heartbeat`）；写入 novel_edit_sessions.heartbeat_at */
export const novelEditHeartbeatSchema = z.object({
  /** 客户端本地是否有未提交改动（仅回显给其它端，不落库为真相） */
  dirty: z.boolean().default(false),
});
export type NovelEditHeartbeatRequest = z.infer<typeof novelEditHeartbeatSchema>;

/** 对话（`POST .../sessions/:sid/chat`）：产出一批 pending diff，**不改正文** */
export const novelEditChatSchema = z.object({
  content: z.string().trim().min(1).max(NOVEL_LIMITS.EDIT_MESSAGE_MAX),
  /** 限定本次改动只在某几集（省略 = 沿用会话范围） */
  episode_nos: z.array(z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX)).max(50).optional(),
});
export type NovelEditChatRequest = z.infer<typeof novelEditChatSchema>;

/** 应用/驳回单集变更（`apply` / `reject`） */
export const novelEditDecideSchema = z.object({
  /** 驳回原因（reject 时可填；apply 忽略） */
  reason: z.string().max(500).optional(),
});
export type NovelEditDecideRequest = z.infer<typeof novelEditDecideSchema>;

/** 批量应用/驳回（`apply_all` / `reject_all`） */
export const novelEditDecideAllSchema = z.object({
  /** 限定集号；省略 = 本会话全部 pending */
  episode_nos: z.array(z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX)).max(50).optional(),
  reason: z.string().max(500).optional(),
});
export type NovelEditDecideAllRequest = z.infer<typeof novelEditDecideAllSchema>;

// ══════════════════════════════════════════════════════════════════════
// 三、响应 schema（对外的稳定形状；id 一律 string，防 JS 精度丢失）
// ══════════════════════════════════════════════════════════════════════

export const novelSchema = z.object({
  id: z.string(),
  space_id: z.string(),
  title: z.string(),
  source_type: novelSourceTypeSchema,
  status: novelStatusSchema,
  sp_type: z.number().int(),
  ratio: z.string(),
  episode_count: z.number().int(),
  meta: z.record(z.string(), z.unknown()).default({}),
  archived_at: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Novel = z.infer<typeof novelSchema>;

export const novelChapterSchema = z.object({
  id: z.string(),
  novel_id: z.string(),
  chapter_no: z.number().int(),
  title: z.string(),
  content: z.string(),
  word_count: z.number().int(),
});
export type NovelChapter = z.infer<typeof novelChapterSchema>;

/** 分章列表项（不含正文，避免列表页拉全书） */
export const novelChapterSummarySchema = novelChapterSchema.omit({ content: true });
export type NovelChapterSummary = z.infer<typeof novelChapterSummarySchema>;

export const novelWorldviewSchema = z.object({
  id: z.string(),
  novel_id: z.string(),
  summary: z.string(),
  settings: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
});
export type NovelWorldview = z.infer<typeof novelWorldviewSchema>;

export const novelCharacterSchema = z.object({
  id: z.string(),
  novel_id: z.string(),
  name: z.string(),
  role_type: novelRoleTypeSchema,
  description: z.string(),
  appearance: z.string(),
  personality: z.string(),
  prompt: z.string(),
  is_core: z.boolean(),
});
export type NovelCharacter = z.infer<typeof novelCharacterSchema>;

export const novelChapterOutlineSchema = z.object({
  id: z.string(),
  novel_id: z.string(),
  chapter_no: z.number().int(),
  title: z.string(),
  synopsis: z.string(),
  sort: z.number().int(),
});
export type NovelChapterOutline = z.infer<typeof novelChapterOutlineSchema>;

export const novelEpisodeOutlineSchema = z.object({
  id: z.string(),
  novel_id: z.string(),
  episode_no: z.number().int(),
  title: z.string(),
  synopsis: z.string(),
  sort: z.number().int(),
});
export type NovelEpisodeOutline = z.infer<typeof novelEpisodeOutlineSchema>;

export const novelEpisodeSchema = z.object({
  id: z.string(),
  novel_id: z.string(),
  episode_no: z.number().int(),
  title: z.string(),
  script_text: z.string(),
  status: novelEpisodeStatusSchema,
  version: z.number().int(),
});
export type NovelEpisode = z.infer<typeof novelEpisodeSchema>;

export const novelScriptVersionSchema = z.object({
  id: z.string(),
  novel_id: z.string(),
  /** NULL = 整本快照 */
  episode_id: z.string().nullable().default(null),
  version_no: z.number().int(),
  finalized_at: z.string().nullable().default(null),
  created_by: z.string().nullable().default(null),
  created_at: z.string(),
});
export type NovelScriptVersion = z.infer<typeof novelScriptVersionSchema>;

export const novelEditSessionSchema = z.object({
  id: z.string(),
  novel_id: z.string(),
  user_id: z.string(),
  status: z.union([z.literal(1), z.literal(2)]),
  heartbeat_at: z.string().nullable().default(null),
  created_at: z.string(),
});
export type NovelEditSession = z.infer<typeof novelEditSessionSchema>;

export const novelEditMessageSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  role: z.union([z.literal(1), z.literal(2)]),
  content: z.string(),
  pending_changes: z.array(z.unknown()).default([]),
  created_at: z.string(),
});
export type NovelEditMessage = z.infer<typeof novelEditMessageSchema>;

/** 逐集 diff（apply/reject 的对象；前端双栏对照直接用这两个字段） */
export const novelEditPendingSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  episode_id: z.string(),
  episode_no: z.number().int(),
  original_text: z.string(),
  proposed_text: z.string(),
  change_summary: z.string(),
  status: novelEditPendingStatusSchema,
});
export type NovelEditPending = z.infer<typeof novelEditPendingSchema>;
