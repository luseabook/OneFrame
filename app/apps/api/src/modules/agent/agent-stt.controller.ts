import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import { AgentSttService } from "./agent-stt.service";

/**
 * STT 语音输入（竞品 `GET /web/v1/agent/stt-token`，`routes.txt:126`）。
 *
 * 两条路由：
 * - `GET /agent/stt-token`（需登录）：能力位 + 短期中继令牌；**无 Key 时 200 + available:false**；
 * - `POST /agent/stt/transcribe`（凭中继令牌，`@Public` 后自行验票）：服务端替前端调 ASR。
 *   为什么要 `@Public`：浏览器录音组件拿的是短令牌（不是 access token），
 *   走全局 guard 会被当成"缺 Bearer"。这里把票据校验显式收在本控制器内，
 *   令牌 audience 与 access token 不通用（`aud=agent-stt`）。
 */

const transcribeSchema = z.object({
  audio_base64: z.string().min(16).max(12 * 1024 * 1024),
  format: z.string().max(12).optional(),
  language: z.string().max(12).optional(),
  stt_token: z.string().min(16).optional(),
});

@Controller("agent")
export class AgentSttController {
  constructor(@Inject(AgentSttService) private readonly stt: AgentSttService) {}

  private auth(req: AuthedRequest): { userId: string; spaceId: string } {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { userId: auth.userId, spaceId: auth.spaceId };
  }

  /** 语音输入能力位 + 短期令牌（120s）。不可用时给 fallback 建议，前端据此降级 */
  @Get("stt-token")
  async token(@Req() req: AuthedRequest) {
    const a = this.auth(req);
    return this.stt.token(a);
  }
}

@Controller("agent/stt")
export class AgentSttRelayController {
  constructor(@Inject(AgentSttService) private readonly stt: AgentSttService) {}

  @Public()
  @Post("transcribe")
  async transcribe(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(transcribeSchema, body ?? {});
    // 票据可放 body，也接受 Authorization 头（中继端点两种调用方式都自洽）
    const header = req.headers.authorization;
    const fromHeader = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const auth = this.stt.verifyToken(input.stt_token ?? fromHeader);
    return this.stt.transcribe(auth, {
      audioBase64: input.audio_base64,
      format: input.format,
      language: input.language,
    });
  }
}
