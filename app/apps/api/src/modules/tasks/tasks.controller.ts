import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, ParseIntPipe, Inject } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import { parseOrThrow } from "../../common/zod";
import { MAX_ID_ITEMS, parseListParam } from "../../common/list-param";
import type { AuthedRequest } from "../../common/auth.types";
import { TasksService } from "./tasks.service";

const folderBody = z.object({ name: z.string().trim().min(1).max(80) });
const assignFolderBody = z.object({ folder_id: z.string().regex(/^\d+$/).nullable() });

@Controller()
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get("tasks")
  async list(
    @Req() req: AuthedRequest,
    @Query("ids") ids?: string | string[],
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("status") status?: string,
    @Query("capability") capability?: string,
    @Query("folder_id") folderId?: string,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const spaceId = req.auth?.spaceId ?? "";
    // 第 120 批：`?ids=` 项数上限与列表 `page_size` 一致（一次批量取不应超过一页）；
    // 空串 / 只有逗号 → 不过滤，落到普通列表（与改造前 `?ids=` 的行为一致）。
    const wanted = parseListParam(ids, "ids", MAX_ID_ITEMS);
    if (wanted && wanted.length > 0) {
      const data = await this.tasks.getMany(spaceId, wanted);
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
      folder_id:
        folderId === "" || folderId === undefined
          ? undefined
          : folderId === "none" || folderId === "unfiled"
            ? null
            : folderId,
    });
  }

  @Get("tasks/folders")
  listFolders(@Req() req: AuthedRequest) {
    return this.tasks.listFolders(req.auth?.spaceId ?? "");
  }

  @Post("tasks/folders")
  createFolder(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(folderBody, body ?? {});
    return this.tasks.createFolder(req.auth?.spaceId ?? "", input.name);
  }

  @Patch("tasks/folders/:id")
  renameFolder(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(folderBody, body ?? {});
    return this.tasks.renameFolder(req.auth?.spaceId ?? "", id, input.name);
  }

  @Delete("tasks/folders/:id")
  deleteFolder(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.deleteFolder(req.auth?.spaceId ?? "", id);
  }

  @Patch("tasks/:id/folder")
  assignFolder(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(assignFolderBody, body ?? {});
    return this.tasks.assignFolder(req.auth?.spaceId ?? "", id, input.folder_id);
  }

  @Post("tasks/batch-download")
  async batchDownload(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(
      z.object({ task_ids: z.array(z.string().min(1)).min(1).max(50) }),
      body,
    );
    return this.tasks.batchDownload(req.auth?.spaceId ?? "", input.task_ids);
  }

  /**
   * 批量任务结果（对照竞品 `POST /task/result`）。
   * 用 POST 而不是 GET：id 列表可能到 100 条，放 query 会撞 URL 长度上限；
   * 它是**只读快照**（不写库、不做 304），CLI/脚本用它一次拿全量状态。
   */
  @Post("task/result")
  async resultMany(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(
      z.object({ task_ids: z.array(z.string().min(1)).min(1).max(100) }),
      body,
    );
    return this.tasks.resultMany(req.auth?.spaceId ?? "", input.task_ids);
  }

  /** 重新生成（成功态也允许；与失败重试 retry 分开，语义见 tasks.service.regenerate） */
  @Post("tasks/:id/regenerate")
  async regenerate(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(
      z.object({ idempotency_key: z.string().min(1).max(128).optional() }).default({}),
      body ?? {},
    );
    return this.tasks.regenerate(req.auth?.spaceId ?? "", id, input.idempotency_key);
  }

  /** 结果反馈（1..5 星 + 标签 + 备注；同一用户重复提交覆盖，不叠加） */
  @Post("tasks/:id/feedback")
  async feedback(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(
      z.object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(2000).optional(),
        tags: z.array(z.string().max(32)).max(10).optional(),
      }),
      body,
    );
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.tasks.feedback(auth.spaceId, auth.userId, id, input);
  }

  @Get("tasks/:id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.detail(req.auth?.spaceId ?? "", id);
  }

  @Post("tasks/:id/cancel")
  async cancel(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.cancel(req.auth?.spaceId ?? "", id);
  }

  /**
   * 删除任务记录（第 72 批；对照竞品 `DELETE /web/v1/task/{task_id}`）。
   *
   * 竞品把路径写成单数 `task`，我方沿用既有复数风格 `tasks/:id`（与 `tasks/:id/cancel|retry|regenerate` 一致）——
   * 契约差异登记在 docs/02-architecture/api-spec.md §17.30，不为了对齐字符串把同一资源的单复数混着用。
   * 语义是**软删**：只允许终态、删后列表/详情/下载/公开分享都读不到，账本与外键不动（详见 `TasksService.remove`）。
   */
  @Delete("tasks/:id")
  async remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.remove(req.auth?.spaceId ?? "", id);
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

  /**
   * 一次取回该任务全部结果的下载地址（**新增能力**，不是别名）。
   *
   * 竞品对应的是 `POST /task/{task_id}/download`：`method: POST`、`paramNames:["task_id"]`、
   * `requestBodyType: json`、`requestDataOptional: !1`、`responseBodyType: json`，但两个 json schema
   * 都是 `{}` —— body 放什么、响应长什么样没有证据。我方按自己的资源风格落在 `tasks/:id/download`
   * （单复数差异与其余 11 条一起登记在 `competitor-route-parity.spec.ts` 的 DEVIATIONS），
   * 响应口径 `{task_id, count, skipped, items[], expires_in}` 写进 api-spec §17.39。
   */
  @Post("tasks/:id/download")
  async downloadAll(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.downloadUrls(req.auth?.spaceId ?? "", id);
  }
}
