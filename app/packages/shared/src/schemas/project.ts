import { z } from "zod";
import {
  DramaType,
  LIMITS,
  ProjectAssetStatus,
  ProjectSourceType,
  STORYBOARD_DURATION_DEFAULT,
  STORYBOARD_DURATION_MAX,
  STORYBOARD_DURATION_MIN,
} from "../constants";

// api-spec §8 projects（MVP 旗舰：剧本流水线）
export const createProjectSchema = z.object({
  title: z.string().min(1).max(100),
  drama_type: z.union([z.literal(DramaType.LIVE), z.literal(DramaType.ANIME)]).default(DramaType.LIVE),
  // 画幅/分辨率合法性以模型目录为准；这里只做非空约束
  ratio: z.string().min(1).default("9:16"),
  source_type: z
    .union([
      z.literal(ProjectSourceType.NOVEL),
      z.literal(ProjectSourceType.IDEA),
      z.literal(ProjectSourceType.SCRIPT), // 导入剧本 → /episodes/split
    ])
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
  // 1 草稿 / 2 已定稿；未定稿角色不得被分镜引用（400105）
  status: z
    .union([z.literal(ProjectAssetStatus.DRAFT), z.literal(ProjectAssetStatus.FINALIZED)])
    .default(ProjectAssetStatus.DRAFT),
});
export type Character = z.infer<typeof characterSchema>;

export const storyboardSchema = z.object({
  id: z.string(),
  shot_no: z.number().int().min(1),
  shot_desc: z.string().max(500).default(""),
  video_prompt: z.string().max(LIMITS.PROMPT_MAX).default(""),
  // 仅存储：默认 5、输入 1~30；投递时按模型 scene.storyboard_reference_video 就近取低并回写
  duration_s: z
    .number()
    .int()
    .min(STORYBOARD_DURATION_MIN)
    .max(STORYBOARD_DURATION_MAX)
    .default(STORYBOARD_DURATION_DEFAULT),
  ratio: z.string().nullish(),
  resolution: z.string().nullish(),
  character_ids: z.array(z.string()).max(LIMITS.CHARACTER_MAX).default([]),
});
export type Storyboard = z.infer<typeof storyboardSchema>;

// 批量投递（api-spec §8 generate-videos）：批量报价预算 + 模型枚举校验 + 断点续跑（PRD F2-⑥）
export const generateVideosSchema = z.object({
  shot_ids: z.array(z.string()).min(1).max(LIMITS.SHOT_COUNT_MAX),
  budget_credits_max: z.number().int().min(1),
  model: z.string().min(1),
  ratio: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
});
export type GenerateVideosRequest = z.infer<typeof generateVideosSchema>;
