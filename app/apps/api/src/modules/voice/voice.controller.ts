import { Controller, Delete, Get, Inject, Post, Query, Req, Param, Body } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { VoiceService } from "./voice.service";

/**
 * 音色库（第 93 批）。
 *
 * 竞品这一族共 9 条，本控制器承接其中 **6 条**（另 3 条由别处承接）：
 *   - `GET/POST /ai/timbre-category/list`、`GET /ai/timbre/list`、`POST /ai/timbre/collect`；
 *   - `GET /ai/voice-clone-list`、`GET /ai/voice-clone/:task_id`、
 *     `DELETE /ai/voice-clone/:task_id`、`POST /ai/voice-clone/rename`；
 *   - `GET /ai/text-to-speech/voice/list`。
 * 提交侧（`POST /ai/voice-clone`）不在这里：它是一次生成请求，走 `POST /generations`
 * （`mode=voice_clone`，目录卡 `voice-clone`），与其它 27 个工具同一个入口（ADR-003）。
 *
 * 路由顺序：`voice-clone-list` / `timbre-category/list` 这类**字面量路径必须排在
 * `:task_id` 之前**声明 —— Nest 按声明顺序匹配，反过来会把 `list` 当成 task_id。
 */
@Controller("ai")
export class VoiceController {
  constructor(@Inject(VoiceService) private readonly voice: VoiceService) {}

  private auth(req: AuthedRequest): { userId: string; spaceId: string } {
    const userId = req.auth?.userId;
    const spaceId = req.auth?.spaceId;
    if (!userId || !spaceId) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { userId, spaceId };
  }

  /** 我的音色列表 */
  @Get("voice-clone-list")
  async listClones(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) {
    const a = this.auth(req);
    const q = parseOrThrow(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        page_size: z.coerce.number().int().min(1).max(100).optional(),
        status: z.coerce.number().int().min(1).max(6).optional(),
      }),
      query ?? {},
    );
    return this.voice.listClones(a.spaceId, a.userId, q);
  }

  /** 文生语音可选音色（只出内置 TTS 音色） */
  @Get("text-to-speech/voice/list")
  async ttsVoices(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) {
    this.auth(req);
    const q = parseOrThrow(
      z.object({
        lang_code: z.string().trim().min(1).max(16).optional(),
        platform_id: z.string().trim().max(64).optional(),
      }),
      query ?? {},
    );
    const result = await this.voice.ttsVoices({ lang_code: q.lang_code });
    return { ...result, platform_id: q.platform_id ?? null };
  }

  /** 音色分类 */
  @Get("timbre-category/list")
  async categories(@Req() req: AuthedRequest) {
    const a = this.auth(req);
    return this.voice.categories(a.spaceId, a.userId);
  }

  /** 音色目录（内置 + 我的克隆） */
  @Get("timbre/list")
  async listTimbres(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) {
    const a = this.auth(req);
    const q = parseOrThrow(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        page_size: z.coerce.number().int().min(1).max(100).optional(),
        category: z.string().trim().max(32).optional(),
        lang: z.string().trim().max(16).optional(),
        only_collected: z
          .union([z.boolean(), z.enum(["1", "0", "true", "false"])])
          .transform((value) => value === true || value === "1" || value === "true")
          .optional(),
      }),
      query ?? {},
    );
    return this.voice.listTimbres(a.spaceId, a.userId, q);
  }

  /** 收藏 / 取消收藏（`collect` 省略 = 取反） */
  @Post("timbre/collect")
  async collect(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(
      z.object({
        timbre_key: z.string().trim().min(1).max(80),
        collect: z.boolean().optional(),
      }),
      body ?? {},
    );
    return this.voice.collect(a.spaceId, a.userId, input);
  }

  /** 改名（竞品把 id 放 body，不放路径） */
  @Post("voice-clone/rename")
  async rename(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(
      z.object({
        task_id: z.string().trim().min(1).max(20),
        name: z.string().trim().min(1).max(40),
      }),
      body ?? {},
    );
    return this.voice.rename(a.spaceId, input.task_id, input.name);
  }

  /** 单个音色详情 */
  @Get("voice-clone/:task_id")
  async getClone(@Req() req: AuthedRequest, @Param("task_id") taskId: string) {
    const a = this.auth(req);
    return this.voice.getClone(a.spaceId, a.userId, taskId);
  }

  /** 删除（软删，与 `DELETE /tasks/:id` 同语义） */
  @Delete("voice-clone/:task_id")
  async removeClone(@Req() req: AuthedRequest, @Param("task_id") taskId: string) {
    const a = this.auth(req);
    return this.voice.removeClone(a.spaceId, taskId);
  }
}
