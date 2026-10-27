import { z } from "zod";
import { NOVEL_LIMITS } from "@app/shared";

/**
 * novel 域**仅用于本模块**的请求参数 schema。
 *
 * 为什么这些不在 `packages/shared/src/schemas/novel.ts` 里：
 * 共享文件里放的是"跨批次的稳定契约"（创建/更新/定稿/编辑会话）。
 * 这里的几条是"生成动作的旋钮"（生成几张卡、生成几集、给模型的一句话指令），
 * 只被本模块的 controller 消费，放进共享包只会让共享契约漂移。
 *
 * ⚠️ 与 LLM 输出 schema 的边界不变：这些是**请求**（宽容），
 * 模型输出仍由 `novel-llm.service.ts` 用共享的 `*ResultSchema` 强约束校验。
 */

/** 生成类动作都允许一句补充指令（拼进 prompt，不改变输出结构） */
const instructions = z.string().max(1_000).optional();

/** 内容分析（世界观 + 角色卡一次性生成） */
export const contentAnalysisSchema = z.object({
  instructions,
  /** 角色卡张数；省略 = 6（竞品角色卡上限 10，见 NOVEL_LIMITS.CHARACTER_MAX） */
  character_count: z.number().int().min(1).max(NOVEL_LIMITS.CHARACTER_MAX).optional(),
});
export type ContentAnalysisRequest = z.infer<typeof contentAnalysisSchema>;

/** 角色卡生成（单独触发的重生成） */
export const charactersGenerateSchema = z.object({
  count: z.number().int().min(1).max(NOVEL_LIMITS.CHARACTER_MAX).default(6),
  instructions,
});
export type CharactersGenerateRequest = z.infer<typeof charactersGenerateSchema>;

/** 核心角色生成 */
export const coreCharacterGenerateSchema = z.object({
  count: z.number().int().min(1).max(3).default(3),
  instructions,
});
export type CoreCharacterGenerateRequest = z.infer<typeof coreCharacterGenerateSchema>;

/** 章节大纲生成 */
export const chapterOutlineGenerateSchema = z.object({ instructions });
export type ChapterOutlineGenerateRequest = z.infer<typeof chapterOutlineGenerateSchema>;

/** 分集大纲生成 */
export const episodeOutlineGenerateSchema = z.object({
  /** 目标集数；省略 = 沿用 novel.episode_count，再省略按章数推算 */
  episode_count: z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX).optional(),
  instructions,
});
export type EpisodeOutlineGenerateRequest = z.infer<typeof episodeOutlineGenerateSchema>;

/** 列表查询（novel 列表 / 章节 / 版本 共用同一页参数口径） */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.coerce.number().int().min(0).max(99).optional(),
  source_type: z.coerce.number().int().min(1).max(5).optional(),
  /** "1" 只看归档；"0"/缺省 只看未归档；"all" 全部 */
  archived: z.enum(["0", "1", "all"]).optional(),
  /** 标题模糊搜索（用户输入按字面量匹配，不做正则解释） */
  q: z.string().max(100).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** 章节分页（一本书最多 200 章，仍分页以防前端一次性渲染） */
export const chapterListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(200),
});
export type ChapterListQuery = z.infer<typeof chapterListQuerySchema>;

/** 海外改编（对标竞品 `ai_noval_overseas_adaptation` 的入口动作） */
export const overseasSchema = z.object({
  /** 新本子标题；省略 = 「原标题 · 海外版」 */
  name: z.string().trim().min(1).max(NOVEL_LIMITS.TITLE_MAX).optional(),
  /** 目标语言（BCP-47 粗粒度）；竞品是配置项对象，我方只落语义值 */
  lang: z.string().trim().min(2).max(20).default("en"),
  /** 目标区域（如 US / EU / SEA）；竞品配置项未取证，故为自由文本 */
  region: z.string().trim().max(50).optional(),
  episode_count: z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX).optional(),
});
export type OverseasRequest = z.infer<typeof overseasSchema>;

/** 创意裂变：从已定稿本子派生新本子 */
export const fissionCreateSchema = z.object({
  name: z.string().trim().min(1).max(NOVEL_LIMITS.TITLE_MAX).optional(),
  episode_count: z.number().int().min(1).max(NOVEL_LIMITS.EPISODE_MAX).default(12),
  /** 裂变方向（"换成女性视角""把反派做成主角"） */
  direction: z.string().max(1_000).optional(),
});
export type FissionCreateRequest = z.infer<typeof fissionCreateSchema>;

/** 切换编辑会话 */
export const sessionSwitchSchema = z.object({
  session_id: z.string().min(1).max(40),
});
export type SessionSwitchRequest = z.infer<typeof sessionSwitchSchema>;

/** 章节大纲 / 分集大纲的单条编辑（nco_id / neo_id） */
export const outlinePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(NOVEL_LIMITS.TITLE_MAX).optional(),
    synopsis: z.string().max(NOVEL_LIMITS.SYNOPSIS_MAX).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "至少需要一个可更新字段",
  });
export type OutlinePatch = z.infer<typeof outlinePatchSchema>;
