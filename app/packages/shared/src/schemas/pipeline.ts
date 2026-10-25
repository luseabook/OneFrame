import { z } from "zod";
import { storyboardVideoModeSchema } from "./project";

// 剧本流水线（PRD F2 / api-spec §8）请求与 LLM 输出 schema。
// LLM 输出必须先过这里校验，再落库（WBS 2.2：解析失败零容忍）。

export const outlineEpisodeSchema = z.object({
  ep_no: z.number().int().min(1).max(100),
  title: z.string().min(1).max(100),
  synopsis: z.string().min(1).max(1000),
});
export const outlineSchema = z.object({
  episodes: z.array(outlineEpisodeSchema).min(1).max(20),
});
export type OutlineResult = z.infer<typeof outlineSchema>;

export const characterDraftSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().min(1).max(500),
  prompt: z.string().min(1).max(1000),
});
export const charactersSchema = z.object({
  characters: z.array(characterDraftSchema).min(1).max(10),
});
export type CharactersResult = z.infer<typeof charactersSchema>;

export const scriptDraftSchema = z.object({
  script_text: z.string().min(1).max(100_000),
});
export type ScriptDraftResult = z.infer<typeof scriptDraftSchema>;

export const storyboardDraftSchema = z.object({
  shot_no: z.number().int().min(1),
  shot_desc: z.string().min(1).max(500),
  video_prompt: z.string().min(1).max(2000),
  duration_s: z.number().int().min(1).max(30).optional(),
  ratio: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
  character_names: z.array(z.string().min(1)).max(10).optional(),
});
export const storyboardsSchema = z.object({
  storyboards: z.array(storyboardDraftSchema).min(1).max(30),
});
export type StoryboardsResult = z.infer<typeof storyboardsSchema>;

export const splitEpisodesRequestSchema = z.object({
  source_text: z.string().max(50_000).optional(),
  ep_count: z.number().int().min(1).max(20).optional(),
});
export type SplitEpisodesRequest = z.infer<typeof splitEpisodesRequestSchema>;

export const episodePatchSchema = z.object({
  title: z.string().max(100).optional(),
  synopsis: z.string().max(1000).optional(),
  script_text: z.string().max(100_000).optional(),
});
export type EpisodePatchRequest = z.infer<typeof episodePatchSchema>;

export const outlineConfirmSchema = z.object({
  episodes: z.array(outlineEpisodeSchema).min(1).max(20),
});
export type OutlineConfirmRequest = z.infer<typeof outlineConfirmSchema>;

export const charactersGenerateSchema = z.object({
  count: z.number().int().min(1).max(10).default(5),
});
export type CharactersGenerateRequest = z.infer<typeof charactersGenerateSchema>;

export const scriptDraftGenerateSchema = z.object({
  instructions: z.string().max(1000).optional(),
});
export type ScriptDraftGenerateRequest = z.infer<typeof scriptDraftGenerateSchema>;

export const storyboardsGenerateSchema = z.object({
  shot_count: z.number().int().min(4).max(30).default(10),
});
export type StoryboardsGenerateRequest = z.infer<typeof storyboardsGenerateSchema>;

export const storyboardPatchSchema = z.object({
  shot_desc: z.string().max(500).optional(),
  video_prompt: z.string().max(2000).optional(),
  duration_s: z.number().int().min(1).max(30).optional(),
  ratio: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
  character_ids: z.array(z.string()).max(10).optional(),
});
export type StoryboardPatchRequest = z.infer<typeof storyboardPatchSchema>;

export const generateVideosBatchSchema = z.object({
  shot_ids: z.array(z.string().min(1)).min(1).max(30),
  budget_credits_max: z.number().int().min(1),
  model: z.string().min(1),
  // P5-1：生成模式（默认参考生视频）；video_edit 由服务端显式 400101
  mode: storyboardVideoModeSchema.default("universal_reference"),
  ratio: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
});
export type GenerateVideosBatchRequest = z.infer<typeof generateVideosBatchSchema>;

export const portraitGenerateSchema = z.object({
  count: z.number().int().min(1).max(4).default(1),
  prompt: z.string().max(1000).optional(),
});
export type PortraitGenerateRequest = z.infer<typeof portraitGenerateSchema>;

export const portraitRebindSchema = z.object({
  asset_id: z.string().min(1),
});
export type PortraitRebindRequest = z.infer<typeof portraitRebindSchema>;

export const portraitSelectSchema = z.object({
  task_id: z.string().min(1),
  index: z.number().int().min(0).max(3),
});
export type PortraitSelectRequest = z.infer<typeof portraitSelectSchema>;

export const assetUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  // MVP 走 base64（前端压缩到 ≤1600px/1MB）；后续换 multipart 直传 OSS
  data_base64: z.string().min(16).max(12_000_000),
});
export type AssetUploadRequest = z.infer<typeof assetUploadSchema>;

export const reportCreateSchema = z.object({
  reason: z.enum(["porn", "violence", "illegal", "infringement", "spam", "other"]),
  detail: z.string().max(500).optional(),
  contact: z.string().max(100).optional(),
});
export type ReportCreateRequest = z.infer<typeof reportCreateSchema>;

export const reportResolveSchema = z.object({
  action: z.enum(["takedown", "dismiss"]),
  note: z.string().max(500).optional(),
});
export type ReportResolveRequest = z.infer<typeof reportResolveSchema>;

export const shareCreateSchema = z.object({
  expires_in_days: z.number().int().min(1).max(30).default(7),
});
export type ShareCreateRequest = z.infer<typeof shareCreateSchema>;

export const projectPatchSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  genre: z.string().max(50).optional(),
});
export type ProjectPatchRequest = z.infer<typeof projectPatchSchema>;
