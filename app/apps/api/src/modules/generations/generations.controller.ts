import { Body, Controller, Get, Headers, Post, Req, Inject } from "@nestjs/common";
import { z } from "zod";
import { generationOptionsSchema, generationRequestSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { GenerationsService } from "./generations.service";
import { ensureToolCatalog, publicToolCatalog } from "./tool-catalog";

/**
 * 工具箱参数（第 3 批）。
 *
 * 为什么在 controller 里扩展而不是改 `packages/shared` 的 `generationOptionsSchema`：
 * 那是**公共契约**（api-spec §5），canvas/agent/流水线都吃它。工具箱的 voice/speed/
 * region/strategy/target_fps 这类参数只有工具页会发，把它们塞进公共 schema 会让
 * 每条生成请求都多出一堆与它无关的字段（并且以后再改又要动公共契约）。
 *
 * 扩展是**纯增量**：沿用 `generationOptionsSchema` 的全部既有字段与默认值，
 * 只追加工具专有键并且全部 optional（缺省 = 适配器用内置默认值）。
 * 因此 `POST /generations` 对既有调用方的语义完全不变。
 */
const toolOptionsSchema = generationOptionsSchema.extend({
  // 语音 / 音乐
  voice: z.string().optional(),
  /**
   * 声音克隆（第 93 批）的产物名字。
   * 为什么放在 options 而不是 input：它是**元数据**（保存到「我的音色」时显示什么），
   * 不参与输入素材校验；放 input 会让 `assertToolInput` 把它当成必填槽位。
   */
  voice_name: z.string().optional(),
  speed: z.number().optional(),
  format: z.string().optional(),
  instrumental: z.boolean().optional(),
  // 视频特效
  effect: z.string().optional(),
  intensity: z.number().optional(),
  with_transition: z.boolean().optional(),
  // 对口型 / 去字幕
  mode: z.string().optional(),
  sync_strength: z.number().optional(),
  inpaint: z.boolean().optional(),
  inpaint_mode: z.string().optional(),
  region: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .optional(),
  region_x: z.number().optional(),
  region_y: z.number().optional(),
  region_w: z.number().optional(),
  region_h: z.number().optional(),
  // 切片 / 帧率规整
  strategy: z.string().optional(),
  slice_duration: z.number().optional(),
  ranges: z.array(z.object({ start: z.number(), end: z.number() })).optional(),
  target_fps: z.number().optional(),
  target_duration: z.number().optional(),
  pad_mode: z.string().optional(),
  fps: z.union([z.string(), z.number()]).optional(),
  // 拆轨 / 音色
  keep_video: z.boolean().optional(),
  timbre: z.string().optional(),
  pitch: z.number().optional(),
  strength: z.number().optional(),
  // 自动配乐
  style: z.string().optional(),
  volume: z.number().optional(),
  ducking: z.boolean().optional(),
  beat_sync: z.boolean().optional(),
  // 涂抹 / 文字重绘
  text: z.string().optional(),
  font: z.string().optional(),
  color: z.string().optional(),
  mask_uri: z.string().optional(),
  // 画布后处理子模式（既有字段，此前由 canvas 侧在解析后手动补回；这里显式声明以便统一）
  sub_mode: z.string().optional(),
});

/**
 * 工具箱请求体：公共契约 + 工具参数（超集，对既有 mode 完全兼容）。
 *
 * ⚠️ `.default({})` 必须显式保留：`generationRequestSchema` 的 `options` 是
 * `generationOptionsSchema.default({})`，而 `.extend()` 会**整段替换**该字段——
 * 漏掉 default 会让所有"不传 options"的既有调用方（老客户端/CLI/flow.spec）直接 400101 Required。
 */
export const toolGenerationRequestSchema = generationRequestSchema.extend({
  options: toolOptionsSchema.default({}),
});

export type ToolGenerationRequest = z.infer<typeof toolGenerationRequestSchema>;

@Controller()
export class GenerationsController {
  constructor(@Inject(GenerationsService) private readonly generations: GenerationsService) {}

  /**
   * 工具箱目录（卡 + 工具 mode + 参数面板声明）。
   *
   * 这是 `/tools` 页 20 张卡的**唯一数据源**：前端不硬编码卡清单，
   * 后端也不另写一份 mode→模型映射（同一张表见 `tool-catalog.ts`）。
   * 顺带惰性 ensure 目录行，保证「新库/线上库都能报出价」。
   */
  @Get("generations/tools")
  async tools() {
    await ensureToolCatalog();
    return publicToolCatalog();
  }

  @Post("generations")
  async create(
    @Req() req: AuthedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey) {
      const { AppError, ErrorCode } = await import("@app/shared");
      throw new AppError(ErrorCode.BAD_REQUEST, "Idempotency-Key header required");
    }
    const input = parseOrThrow(toolGenerationRequestSchema, body);
    const auth = req.auth;
    if (!auth) throw new Error("auth missing");
    return this.generations.create(auth, input, idempotencyKey);
  }
}
