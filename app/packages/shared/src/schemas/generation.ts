import { z } from "zod";
import { GenerationMode, LIMITS, SceneKey } from "../constants";

// api-spec §5 POST /generations 请求体（服务端校验顺序：幂等→身份→枚举→内容→计费→入队）
export const generationInputSchema = z.object({
  prompt: z.string().max(LIMITS.PROMPT_MAX).default(""),
  reference_uris: z.array(z.string()).max(LIMITS.REFERENCE_URIS_MAX).default([]),
  first_frame_uri: z.string().nullish(),
  last_frame_uri: z.string().nullish(),
});

export const generationOptionsSchema = z.object({
  // 仅兜底默认；合法枚举由模型目录 modes/scene 决定（不得假设模型共享同一组）
  ratio: z.string().min(1).default("9:16"),
  resolution: z.string().min(1).default("720p"),
  duration: z.number().int().min(LIMITS.DURATION_MIN).max(LIMITS.DURATION_MAX).default(5),
  count: z.number().int().min(1).max(LIMITS.COUNT_MAX).default(1),
  enable_audio: z.boolean().default(true),
  mouth_drive: z.boolean().default(false),
  seed: z.number().int().nullish(),
});

export const generationRequestSchema = z.object({
  mode: z.enum(GenerationMode),
  model: z.string().min(1),
  // 流水线分镜任务用 scene；资产生图不填 scene（用 mode=studio_asset_image）
  scene: z.enum(SceneKey).nullish(),
  input: generationInputSchema,
  // 整个 options 缺省时走全默认值，与前端"选完模型即报价"交互对齐
  options: generationOptionsSchema.default({}),
  quote_id: z.string().min(1).nullish(), // 提交时校验报价未变（745702）
});

export type GenerationInput = z.infer<typeof generationInputSchema>;
export type GenerationOptions = z.infer<typeof generationOptionsSchema>;
export type GenerationRequest = z.infer<typeof generationRequestSchema>;
