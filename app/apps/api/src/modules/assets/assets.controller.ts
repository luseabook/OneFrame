import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
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
    @Query("folder_id") folderId?: string,
    @Query("tag") tag?: string,
  ) {
    return this.assets.list(
      req.auth?.spaceId ?? "",
      Number(page ?? 1),
      Number(pageSize ?? 20),
      deleted === "true",
      folderId,
      tag,
    );
  }

  @Get("assets/expiring-tasks")
  async expiring(@Req() req: AuthedRequest) {
    return this.assets.expiringTasks(req.auth?.spaceId ?? "");
  }

  @Get("asset-folders")
  async folders(@Req() req: AuthedRequest) {
    return this.assets.listFolders(req.auth?.spaceId ?? "");
  }

  @Post("asset-folders")
  async createFolder(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(
      z.object({ name: z.string().min(1).max(80), parent_id: z.string().optional() }),
      body,
    );
    return this.assets.createFolder(req.auth?.spaceId ?? "", input.name, input.parent_id);
  }

  /**
   * 单个素材详情（第 88 批）。
   *
   * 竞品是 `GET /web/v1/asset/resource/:category/:res_id`（category 只是前端分栏，不改变语义）。
   * 我方的 key 就是 asset id，所以只收一个 `:id`；`category` 那种「一个 id 两套分类」的分栏
   * 在我方由 `kind` + 文件夹表达，不额外编一个假参数。
   */
  @Get("assets/:id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.assets.detail(req.auth?.spaceId ?? "", id);
  }

  @Patch("assets/:id")
  async patchAsset(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(
      z.object({
        folder_id: z.string().nullable().optional(),
        tags: z.array(z.string().max(30)).max(20).optional(),
        name: z.string().min(1).max(200).optional(),
      }),
      body,
    );
    return this.assets.updateAsset(req.auth?.spaceId ?? "", id, input);
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
