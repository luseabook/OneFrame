import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { TeamService } from "../team/team.service";
import { ExtractionService } from "./extraction.service";

/**
 * 抽取流水线（extraction）端点 —— 对照竞品 `resource extract*` / `draft-*` 族
 * （`cmd/resource.md:536-727`，后端路径 `df/extraction/task`、`df/extraction/asset`）。
 *
 * 路径：`/extraction/tasks`（创建/查询/重做）与 `/extraction/drafts`（列表/导入/提升）。
 */

const boolLike = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");

const createTaskSchema = z.object({
  project_id: z.string().min(1).optional(),
  episode_id: z.string().min(1).optional(),
  source_asset_id: z.string().min(1).optional(),
  source_uri: z.string().max(500).optional(),
  /** 1 清单 / 2 角色提示词 / 3 场景提示词 / 4 道具提示词 / 5 三合一（resource.md:552-568） */
  task_type: z.number().int().min(1).max(5).optional(),
  /** 只在 task_type=1 生效：1 专业 / 2 快速 */
  generate_mode: z.number().int().min(1).max(2).optional(),
  /** 只在 task_type=5 生效：1 需要音色 / 2 不需要 */
  need_voice: z.number().int().min(1).max(2).optional(),
});

const redoSchema = z.object({ task_id: z.string().min(1) });

/** 任务列表筛选：状态/类型/项目/分集（全部可选，默认最近 20 条） */
const listTasksQuery = z.object({
  status: z.coerce.number().int().min(1).max(4).optional(),
  task_type: z.coerce.number().int().min(1).max(5).optional(),
  project_id: z.string().min(1).optional(),
  episode_id: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const listDraftsQuery = z.object({
  task_id: z.string().min(1).optional(),
  eed_id: z.string().min(1).optional(),
  kind: z.coerce.number().int().min(1).max(3).optional(),
  state: z.coerce.number().int().min(1).max(3).optional(),
  is_all: boolLike.optional(),
  episode_id: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(500).optional(),
});

const draftItemSchema = z.object({
  type: z.enum(["character", "scene", "prop"]).optional(),
  kind: z.number().int().min(1).max(3).optional(),
  name: z.string().min(1).max(80),
  prompt: z.string().max(2000).optional(),
  description: z.string().max(1000).optional(),
  group_id: z.string().max(80).optional(),
  state_id: z.string().max(80).optional(),
  parent_state_id: z.string().max(80).optional(),
  /** 出现则更新该草稿，否则创建（resource.md:619-702） */
  eed_id: z.string().min(1).optional(),
});

const importSchema = z.object({
  task_id: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  episode_id: z.string().min(1).optional(),
  items: z.array(draftItemSchema).min(1).max(200),
});

const promoteSchema = z.object({
  project_id: z.string().min(1),
  eed_ids: z.array(z.string().min(1)).min(1).max(100),
});

@Controller("extraction")
export class ExtractionController {
  constructor(
    @Inject(ExtractionService) private readonly extraction: ExtractionService,
    @Inject(TeamService) private readonly team: TeamService,
  ) {}

  private async ctx(req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.team.requireMember(auth.spaceId, auth.userId);
  }

  /** 1. 创建抽取任务（竞品 `resource extract`，`et_id` 即本返回的 id） */
  @Post("tasks")
  async createTask(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const input = parseOrThrow(createTaskSchema, body ?? {});
    return this.extraction.createTask(m.spaceId, m.userId, input);
  }

  /** 1.5 任务列表：分页 + 状态/类型/项目/分集筛选（竞品无独立 list 端点，为其 task/progress + versions 的聚合） */
  @Get("tasks")
  async listTasks(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(listTasksQuery, query ?? {});
    return this.extraction.listTasks(m.spaceId, q);
  }

  /** 1.6 取消进行中的任务（四态无"已取消"，落地为失效 4 = 竞品 task/delete 语义） */
  @Post("tasks/:id/cancel")
  async cancelTask(@Req() req: AuthedRequest, @Param("id") id: string) {
    const m = await this.ctx(req);
    return this.extraction.cancelTask(m.spaceId, id);
  }

  /** 2. 查询任务状态（四态 1 进行中 / 2 成功 / 3 失败 / 4 失效） */
  @Get("tasks/:id")
  async getTask(@Req() req: AuthedRequest, @Param("id") id: string) {
    const m = await this.ctx(req);
    return this.extraction.getTask(m.spaceId, id);
  }

  /** 3. 重做失败/失效任务（竞品 `resource extract-redo`） */
  @Post("tasks/redo")
  async redo(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const input = parseOrThrow(redoSchema, body);
    return this.extraction.redoTask(m.spaceId, input.task_id);
  }

  /** 3.5 按 task_type 的成功/失败率（竞品只有单任务 progress，此处为服务端聚合） */
  @Get("stats")
  async stats(@Req() req: AuthedRequest) {
    const m = await this.ctx(req);
    return this.extraction.stats(m.spaceId);
  }

  /** 4. 草稿列表（默认只主形态；`is_all=true` 主/子平铺） */
  @Get("drafts")
  async listDrafts(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(listDraftsQuery, query ?? {});
    return this.extraction.listDrafts(m.spaceId, q);
  }

  /** 5. 草稿导入（竞品 `resource draft-import`）：返回 `eed_id`，主子形态一次性写入 */
  @Post("drafts/import")
  async importDrafts(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const input = parseOrThrow(importSchema, body);
    return this.extraction.importDrafts(m.spaceId, m.userId, input);
  }

  /** 6. 草稿提升为项目资产（草稿 → 未定稿正式资产；定稿仍走资产 PATCH status=2） */
  @Post("drafts/promote")
  async promoteDrafts(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const input = parseOrThrow(promoteSchema, body);
    return this.extraction.promoteDrafts(m.spaceId, input);
  }
}

