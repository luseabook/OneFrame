import { z } from "zod";
import {
  GenerationMode,
  LIMITS,
  Ratio,
  Resolution,
} from "../constants";

// api-spec §5 POST /generations 请求体（服务端校验顺序：幂等→身份→枚举→内容→计费→入队）
export const generationInputSchema = z.object({
  prompt: z.string().max(LIMITS.PROMPT_MAX).default(""),
  reference_uris: z.array(z.string()).max(LIMITS.REFERENCE_URIS_MAX).default([]),
  first_frame_uri: z.string().nullish(),
  last_frame_uri: z.string().nullish(),
});

export const generationOptionsSchema = z.object({
  ratio: z.enum(Ratio).default("9:16"),
  resolution: z.enum(Resolution).default("720p"),
  duration: z
    .number()
    .int()
    .min(LIMITS.DURATION_MIN)
    .max(LIMITS.DURATION_MAX)
    .default(5),
  count: z.number().int().min(1).max(LIMITS.COUNT_MAX).default(1),
  enable_audio: z.boolean().default(true),
  mouth_drive: z.boolean().default(false),
  seed: z.number().int().nullish(),
});

export const generationRequestSchema = z.object({
  mode: z.enum(GenerationMode),
  model: z.string().min(1),
  input: generationInputSchema,
  // 整个 options 缺省时走全默认值（720p/5s/16:9…），与前端"选完模型即报价"交互对齐
  options: generationOptionsSchema.default({}),
});

export type GenerationInput = z.infer<typeof generationInputSchema>;
export type GenerationOptions = z.infer<typeof generationOptionsSchema>;
export type GenerationRequest = z.infer<typeof generationRequestSchema>;
