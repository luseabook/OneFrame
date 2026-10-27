import { Body, Controller, Get, Inject, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import { CaptchaService, type CaptchaTicketView, type CaptchaVerifyResult } from "./captcha.service";
import { ModerationDetectService, type TextDetectResult } from "./moderation.service";
import { ModerationStatusService, type ModerationTaskStatus } from "./status.service";

/**
 * 内容安全（模块 #25 35%→85%）：验证码票据 / 文本检测 / 审核态只读。
 *
 * 路由**故意放在本模块**而不是 `modules/auth`：本批同轮有人在改 auth，
 * 且验证码属于内容安全能力（风控），与登录域的实现细节无关。
 */
const verifySchema = z.object({
  ticket: z.string().min(8).max(4096),
  answer: z.union([z.number(), z.string().max(16)]),
});

const detectSchema = z.object({
  text: z.string().min(0).max(20_000),
  /** 预留：不同场景可挂不同阈值；当前词库统一，仅回显 */
  scene: z.string().max(64).optional(),
});

@Controller("moderation")
export class ModerationController {
  constructor(
    @Inject(CaptchaService) private readonly captcha: CaptchaService,
    @Inject(ModerationDetectService) private readonly detect: ModerationDetectService,
    @Inject(ModerationStatusService) private readonly status: ModerationStatusService,
  ) {}

  /** 取票：无第三方 Key → available:false + 本地算术题（诚实口径见 captcha.service.ts） */
  @Public()
  @Post("captcha/ticket")
  async ticket(): Promise<CaptchaTicketView> {
    return this.captcha.issue();
  }

  /** 验票：签名 + 过期 + 一次性（答错也作废，避免同一张票被枚举） */
  @Public()
  @Post("captcha/verify")
  async verify(@Body() body: unknown): Promise<CaptchaVerifyResult> {
    const input = parseOrThrow(verifySchema, body);
    return this.captcha.verify(input.ticket, input.answer);
  }

  /** 文本检测：返回命中词与位置 + 建议动作（allow/review/block），不改既有拦截语义 */
  @Post("text-detect")
  async textDetect(@Body() body: unknown): Promise<TextDetectResult & { scene: string | null }> {
    const input = parseOrThrow(detectSchema, body);
    return { ...this.detect.detect(input.text), scene: input.scene ?? null };
  }

  /** 任务审核态只读（模型侧审核 6/7 两态 + 最近事件） */
  @Get("status")
  async taskStatus(@Req() req: AuthedRequest, @Query("task_id") taskId?: string): Promise<ModerationTaskStatus> {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    if (!taskId) throw new AppError(ErrorCode.INVALID_PARAM, "task_id is required", { field: "task_id" });
    return this.status.taskStatus(auth.spaceId, taskId);
  }
}
