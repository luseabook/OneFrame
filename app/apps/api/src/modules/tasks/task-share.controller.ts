import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from "@nestjs/common";
import { shareCreateSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import { TasksService } from "./tasks.service";

@Controller()
export class PublicShareController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Public()
  @Get("share/:token")
  async get(@Param("token") token: string) {
    return this.tasks.publicShare(token);
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
