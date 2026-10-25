import { z } from "zod";
import {
  DramaType,
  LIMITS,
  PROJECT_RATIOS,
  ProjectAssetStatus,
  ProjectSourceType,
  STORYBOARD_DURATION_DEFAULT,
  STORYBOARD_DURATION_MAX,
  STORYBOARD_DURATION_MIN,
} from "../constants";

// api-spec §8 projects（MVP 旗舰：剧本流水线）
export const createProjectSchema = z.object({
  title: z.string().min(1).max(50),
  // 1 国内仿真人剧 / 2 海外仿真人剧 / 3 2D/3D 动漫（参照产品「新建项目」）
  drama_type: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(DramaType.LIVE),
  // 画面比例：参照产品新建项目只提供 9:16 / 16:9
  ratio: z.enum(PROJECT_RATIOS).default("9:16"),
  source_type: z
    .union([
      z.literal(ProjectSourceType.NOVEL),
      z.literal(ProjectSourceType.IDEA),
      z.literal(ProjectSourceType.SCRIPT), // 导入剧本 → /episodes/split
    ])
    .default(ProjectSourceType.NOVEL),
  source_text: z.string().max(LIMITS.NOVEL_MAX).default(""),
  /** 上传剧本的原始文件名（仅留痕展示，内容已解析进 source_text） */
  source_file_name: z.string().max(200).optional(),
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

// ── P2：项目资产（场景/道具/其他）与分镜资产绑定 ───────────────────────
// project_assets.kind 支持 character|scene|prop|other；本组接口只写非角色资产，
// 角色走 POST /projects/{id}/characters/generate（同一张表，kind=character）。
export const PROJECT_ASSET_KINDS = ["character", "scene", "prop", "other"] as const;
export type ProjectAssetKind = (typeof PROJECT_ASSET_KINDS)[number];

/** 单个分镜可绑定的项目资产上限（0..20） */
export const STORYBOARD_ASSET_BIND_MAX = 20;

export const projectAssetKindSchema = z.enum(PROJECT_ASSET_KINDS);

export const projectAssetCreateSchema = z.object({
  // kind=character 在服务端拒绝并提示走 characters/generate（400101）
  kind: projectAssetKindSchema,
  name: z.string().trim().min(1).max(50),
  description: z.string().max(500).optional(),
  prompt: z.string().max(1000).optional(),
  ref_image_uri: z.string().max(500).optional(),
});
export type ProjectAssetCreateRequest = z.infer<typeof projectAssetCreateSchema>;

export const projectAssetPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    description: z.string().max(500).nullish(),
    prompt: z.string().max(1000).nullish(),
    ref_image_uri: z.string().max(500).nullish(),
    // 1 草稿 / 2 定稿；status=2 写 finalized_at，status=1 清空
    status: z
      .union([z.literal(ProjectAssetStatus.DRAFT), z.literal(ProjectAssetStatus.FINALIZED)])
      .optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "至少需要一个可更新字段",
  });
export type ProjectAssetPatchRequest = z.infer<typeof projectAssetPatchSchema>;

// PUT /projects/{id}/episodes/{eid}/storyboards/{sid}/assets：整体替换绑定
// 入参含角色与场景/道具，同一分镜最多 20 个；返回顺序与入参一致
export const storyboardAssetsPutSchema = z.object({
  asset_ids: z.array(z.string().trim().min(1)).max(STORYBOARD_ASSET_BIND_MAX),
});
export type StoryboardAssetsPutRequest = z.infer<typeof storyboardAssetsPutSchema>;

// ── P3：AI 提取资产（剧本/分集 → 场景/道具/角色草稿资产）────────────────
/** 单次提取最多落库条数（超出截断，响应 truncated=true） */
export const PROJECT_ASSETS_EXTRACT_MAX = 20;

/** LLM 提取结果中的单个资产条目（name trim 后 1..50） */
export const assetExtractItemSchema = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().max(500).default(""),
  prompt: z.string().max(1000).default(""),
});
export type AssetExtractItem = z.infer<typeof assetExtractItemSchema>;

/** LLM 提取结果（DeepSeek/mock 双路共用；characters 可选） */
export const assetExtractResultSchema = z.object({
  scenes: z.array(assetExtractItemSchema).max(50).default([]),
  props: z.array(assetExtractItemSchema).max(50).default([]),
  characters: z.array(assetExtractItemSchema).max(50).default([]),
});
export type AssetExtractResult = z.infer<typeof assetExtractResultSchema>;

// POST /projects/{id}/assets/extract
export const projectAssetsExtractSchema = z.object({
  /** 指定分集：用该集 title/synopsis/script_text 作为提取内容；省略则用项目 source_text */
  episode_id: z.string().min(1).max(32).optional(),
  /** 是否同时提取并落库角色（kind=character 草稿；与已有同名角色去重） */
  include_characters: z.boolean().default(false),
  /** 同 kind+name 已存在时是否更新 description/prompt（绝不改 status/finalized_at/ref_image_uri） */
  overwrite: z.boolean().default(false),
});
export type ProjectAssetsExtractRequest = z.infer<typeof projectAssetsExtractSchema>;

// ── P3.5：项目资产参考图（generate-image → candidates → select）──────────
// 与角色定妆图（characters/:cid/portrait*）同构，只是作用对象为非角色资产。
export const projectAssetImageGenerateSchema = z.object({
  /** 覆盖资产自带 prompt；省略则按 asset.prompt > description > name 取 */
  prompt: z.string().max(1000).optional(),
  count: z.number().int().min(1).max(4).default(1),
});
export type ProjectAssetImageGenerateRequest = z.infer<typeof projectAssetImageGenerateSchema>;

export const projectAssetImageSelectSchema = z.object({
  task_id: z.string().min(1),
  // 候选下标（count ≤ 4）
  index: z.number().int().min(0).max(3),
});
export type ProjectAssetImageSelectRequest = z.infer<typeof projectAssetImageSelectSchema>;

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
  // P9：3D 导演台定格图（storage key）；*_url 为 API 派生字段（预签名 1h，便于前端直接显示）
  first_frame_uri: z.string().nullish().default(null),
  last_frame_uri: z.string().nullish().default(null),
  first_frame_url: z.string().nullish().default(null),
  last_frame_url: z.string().nullish().default(null),
});
export type Storyboard = z.infer<typeof storyboardSchema>;

// ── P5-1：分镜生成模式（文生视频/首帧/首尾帧）──────────────────────────
// universal_reference 为默认（参考生视频，scene=storyboard_reference_video）；
// video_edit（AI 改视频）仅出现在枚举里以便服务端返回明确 400101，不在本期实现。
export const STORYBOARD_VIDEO_MODES = [
  "universal_reference",
  "first_frame",
  "first_last_frame",
  "text2video",
  "video_edit",
] as const;
export type StoryboardVideoMode = (typeof STORYBOARD_VIDEO_MODES)[number];
export const storyboardVideoModeSchema = z.enum(STORYBOARD_VIDEO_MODES);

// 批量投递（api-spec §8 generate-videos）：批量报价预算 + 模型枚举校验 + 断点续跑（PRD F2-⑥）
export const generateVideosSchema = z.object({
  shot_ids: z.array(z.string()).min(1).max(LIMITS.SHOT_COUNT_MAX),
  budget_credits_max: z.number().int().min(1),
  model: z.string().min(1),
  // P5-1：生成模式（默认参考生视频）
  mode: storyboardVideoModeSchema.default("universal_reference"),
  ratio: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
});
export type GenerateVideosRequest = z.infer<typeof generateVideosSchema>;
