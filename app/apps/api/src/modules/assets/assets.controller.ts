import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { assetUploadSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { AssetsService } from "./assets.service";

@Controller()
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}

  @Get("assets")
  async list(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("deleted") deleted?: string,
  ) {
    return this.assets.list(
      req.auth?.spaceId ?? "",
      Number(page ?? 1),
      Number(pageSize ?? 20),
      deleted === "true",
    );
  }

  @Post("assets/from-task")
  async fromTask(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(
      z.object({ task_id: z.string().min(1), index: z.number().int().min(0).max(9).default(0) }),
      body,
    );
    return this.assets.fromTask(req.auth?.spaceId ?? "", input.task_id, input.index);
  }

  @Post("assets/:id/restore")
  async restore(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.assets.restore(req.auth?.spaceId ?? "", id);
  }

  @Post("assets/upload")
  async upload(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(assetUploadSchema, body);
    return this.assets.upload(req.auth?.spaceId ?? "", input);
  }

  @Delete("assets/:id")
  async remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.assets.remove(req.auth?.spaceId ?? "", id);
  }
}
