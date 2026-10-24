import { z } from "zod";
import {
  DramaType,
  LIMITS,
  ProjectSourceType,
  Ratio,
  STORYBOARD_DURATIONS,
} from "../constants";

// api-spec §8 projects（MVP 旗舰：剧本流水线）
export const createProjectSchema = z.object({
  title: z.string().min(1).max(100),
  drama_type: z.union([z.literal(DramaType.LIVE), z.literal(DramaType.ANIME)]).default(DramaType.LIVE),
  ratio: z.enum(Ratio).default("9:16"),
  source_type: z
    .union([z.literal(ProjectSourceType.NOVEL), z.literal(ProjectSourceType.IDEA)])
    .default(ProjectSourceType.NOVEL),
  source_text: z.string().max(LIMITS.NOVEL_MAX).default(""),
});
export type CreateProjectRequest = z.infer<typeof createProjectSchema>;

export const characterSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  description: z.string().max(500).default(""),
  prompt: z.string().max(1000).default(""),
  portrait_asset_id: z.string().nullable().default(null),
});
export type Character = z.infer<typeof characterSchema>;

export const storyboardSchema = z.object({
  id: z.string(),
  shot_no: z.number().int().min(1),
  shot_desc: z.string().max(500).default(""),
  video_prompt: z.string().max(LIMITS.PROMPT_MAX).default(""),
  // 分镜时长枚举档位（对齐 STORYBOARD_DURATIONS / 模型时长档位，生成下限 4s）
  duration_s: z
    .union([z.literal(4), z.literal(5), z.literal(6), z.literal(8), z.literal(10)])
    .default(5),
  character_ids: z.array(z.string()).max(5).default([]),
});
export type Storyboard = z.infer<typeof storyboardSchema>;

// 批量投递（api-spec §8 generate-videos）：预算上限+断点续跑语义（PRD F2-⑥）
export const generateVideosSchema = z.object({
  shot_ids: z.array(z.string()).min(1).max(LIMITS.SHOT_COUNT_MAX),
  budget_credits_max: z.number().int().min(1),
});
export type GenerateVideosRequest = z.infer<typeof generateVideosSchema>;
