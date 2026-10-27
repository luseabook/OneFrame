import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { shareCreateSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { Public } from "../../common/public.decorator";
import { SkipEnvelope } from "../../common/http/skip-envelope.decorator";
import { ShareStreamService } from "./share-stream.service";
import { parseOrThrow } from "../../common/zod";
import { TasksService } from "./tasks.service";

@Controller()
export class PublicShareController {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(ShareStreamService) private readonly stream: ShareStreamService,
  ) {}

  @Public()
  @Get("share/:token")
  async get(@Param("token") token: string) {
    return this.tasks.publicShare(token);
  }

  /**
   * 分享页**只读实时流**（SSE）：让观看者不用手动刷新就能看到任务进度。
   *
   * 只认 token；只推该 share 绑定的那个 task 的 `status/progress/task_event`，
   * **不推**产物 key、积分、space/user。撤销或过期会立刻 `event: revoked` 断开；
   * 任务进入终态推 `event: done` 后关闭。`timeout_ms` 用于把连接寿命限在一个上限内
   * （默认 10min，便于客户端定期重连与测试）。
   */
  @Public()
  @Get("share/:token/stream")
  @SkipEnvelope()
  async liveStream(
    @Param("token") token: string,
    @Res() reply: FastifyReply,
    @Query("timeout_ms") timeoutMs?: string,
  ): Promise<void> {
    await this.stream.pipe(reply, token, timeoutMs ? Number(timeoutMs) : undefined);
  }

  /**
   * 分享页「打包下载」：公开可访问（只认 token），打包范围只由 share 行决定，
   * 不接受任何 task_ids 入参（越权读取=事故，见 tasks.service.publicShareDownload 注释）。
   */
  @Public()
  @Post("share/:token/batch-download")
  async batchDownload(@Param("token") token: string) {
    return this.tasks.publicShareDownload(token);
  }
}

@Controller()
export class TaskShareController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Post("tasks/:id/share")
  async create(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(shareCreateSchema, body ?? {});
    return this.tasks.createShare(req.auth?.spaceId ?? "", id, input.expires_in_days);
  }

  @Delete("tasks/:id/share")
  async revoke(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.revokeShare(req.auth?.spaceId ?? "", id);
  }
}
