import { Body, Controller, Get, Param, Post, Query, Req, Res, ParseIntPipe, Inject } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../../common/zod";
import type { AuthedRequest } from "../../common/auth.types";
import { TasksService } from "./tasks.service";

@Controller()
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get("tasks")
  async list(
    @Req() req: AuthedRequest,
    @Query("ids") ids?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("status") status?: string,
    @Query("capability") capability?: string,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const spaceId = req.auth?.spaceId ?? "";
    if (ids) {
      const data = await this.tasks.getMany(
        spaceId,
        ids.split(",").map((id) => id.trim()).filter(Boolean),
      );
      const etag = `"${createHash("sha1").update(JSON.stringify(data)).digest("hex")}"`;
      if (req.headers["if-none-match"] === etag) {
        reply?.code(304).send();
        return;
      }
      reply?.header("ETag", etag);
      return data;
    }
    return this.tasks.list(spaceId, {
      page: page ? Number(page) : undefined,
      page_size: pageSize ? Number(pageSize) : undefined,
      status: status ? Number(status) : undefined,
      capability,
    });
  }

  @Post("tasks/batch-download")
  async batchDownload(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(
      z.object({ task_ids: z.array(z.string().min(1)).min(1).max(50) }),
      body,
    );
    return this.tasks.batchDownload(req.auth?.spaceId ?? "", input.task_ids);
  }

  @Get("tasks/:id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.detail(req.auth?.spaceId ?? "", id);
  }

  @Post("tasks/:id/cancel")
  async cancel(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.cancel(req.auth?.spaceId ?? "", id);
  }

  @Post("tasks/:id/retry")
  async retry(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.retry(req.auth?.spaceId ?? "", id);
  }

  @Get("tasks/:id/results/:n/download-url")
  async downloadUrl(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("n", ParseIntPipe) n: number,
  ) {
    return this.tasks.downloadUrl(req.auth?.spaceId ?? "", id, n);
  }
}
