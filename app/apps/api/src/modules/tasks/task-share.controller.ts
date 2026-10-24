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
