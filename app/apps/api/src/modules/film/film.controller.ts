import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  AppError,
  ErrorCode,
  filmApplyTemplateSchema,
  filmCanvasBindingCreateSchema,
  filmCellsPutSchema,
  filmExportCreateSchema,
  filmFieldBatchRestoreSchema,
  filmFieldCreateSchema,
  filmFieldPatchSchema,
  filmFieldReorderSchema,
  filmReviewCommentCreateSchema,
  filmReviewReadMarkSchema,
  filmReviewSubmitSchema,
  filmTableCreateSchema,
  filmTableImportSchema,
  filmTablePatchSchema,
  filmTablePrefPutSchema,
  filmTableReorderSchema,
  filmTaskBatchSchema,
  filmTaskCreateSchema,
  filmTaskQuerySchema,
  filmTaskReorderSchema,
  filmTaskStatusUpdateSchema,
  filmVersionNoSchema,
  type FilmTaskQueryRequest,
} from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { TeamService } from "../team/team.service";
import { FilmAccessService } from "./film.access";
import { FilmCanvasService } from "./film.canvas.service";
import { FilmExportsService } from "./film.exports.service";
import { FilmFieldsService } from "./film.fields.service";
import { FilmReviewService } from "./film.review.service";
import { FilmTablesService } from "./film.tables.service";
import { FilmTasksService } from "./film.tasks.service";

/**
 * 影视版（film）域端点 —— 对照参照产品 `/web/v1/film/projects/:project_id/*`
 * 37 路径 / 48 操作（`_acceptance/_gap/contract-draft-cam-film.md` §1.3 / §3.5）。
 *
 * 路径保留竞品命名（ADR-009），便于逐条核对覆盖；项目 id 是不透明指针（见 access 注释）。
 *
 * 权限口径（契约 §3.2 四层）：
 *   L0 `spaces.film_enabled`（商务开通制）→ 403 reason=film_not_enabled
 *   L2 space 成员 → 403 reason=not_member
 *   L3 写管理类动作（删表/删画布/导出/删模板）→ 403 reason=role_insufficient
 *   L4 表/行归属本 space → 400102（不泄露跨租户存在性）
 *
 * 协同（机制 #3）：所有写接口都接受可选的 `client_id`（竞品惯例），
 * 原样带进广播事件用于回声抑制；服务端不解释它的语义。
 */

/** GET 版 tasks/query 的查询参数（filters/sorts 用 JSON 字符串传入，保持与 POST 同构） */
const queryGetSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  roots_only: z.enum(["true", "false"]).default("true"),
  filters: z.string().optional(),
  sorts: z.string().optional(),
});

const pageOnly = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

const tableImportWrap = filmTableImportSchema;

/** 模板创建（shared 里没有 schema：payload 结构未取证，只做大小与形状下限校验） */
const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.union([z.literal(1), z.literal(2)]).default(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const templateQuerySchema = z.object({
  scope: z.coerce.number().int().min(1).max(2).optional(),
});

const titleMatchesSchema = z.object({
  title: z.string().min(1).max(200),
  exclude_task_id: z.string().min(1).optional(),
});

const notifySchema = z.object({
  op_user_ids: z.array(z.string().min(1)).max(200).default([]),
});

const recentOpenPutSchema = z.object({
  table_id: z.string().min(1).nullish(),
});

const childrenCreateSchema = z.object({
  title: z.string().max(200).optional(),
});

const bindingCanvasIdsSchema = z.object({
  canvas_ids: z.array(z.string().min(1)).max(50).default([]),
});

const reviewSubmitExtraSchema = filmReviewSubmitSchema.extend({
  version_no: filmVersionNoSchema.optional(),
});

@Controller("film")
export class FilmController {
  constructor(
    @Inject(FilmAccessService) private readonly access: FilmAccessService,
    @Inject(FilmTablesService) private readonly tables: FilmTablesService,
    @Inject(FilmFieldsService) private readonly fields: FilmFieldsService,
    @Inject(FilmTasksService) private readonly tasks: FilmTasksService,
    @Inject(FilmReviewService) private readonly review: FilmReviewService,
    @Inject(FilmCanvasService) private readonly canvas: FilmCanvasService,
    @Inject(FilmExportsService) private readonly exports: FilmExportsService,
    @Inject(TeamService) private readonly team: TeamService,
  ) {}

  // ── 上下文工具 ──────────────────────────────────────────

  private ctx(req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { spaceId: auth.spaceId, userId: auth.userId };
  }

  /** L0+L2(+L3) */
  private async gate(req: AuthedRequest, need: "read" | "write" | "manage" = "read") {
    const { spaceId, userId } = this.ctx(req);
    const ctx = await this.access.gate(spaceId, userId, need);
    return { spaceId, userId, ctx };
  }

  /** 表 + 项目作用域（L4）；所有 `:table_id` 路由共用 */
  private async tableCtx(req: AuthedRequest, projectId: string, tableId: string, need: "read" | "write" | "manage") {
    const base = await this.gate(req, need);
    await this.access.assertProjectScope(base.spaceId, projectId);
    const table = await this.access.requireTable(base.spaceId, tableId);
    if (String(table.projectId) !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "task table not found in this project");
    }
    return { ...base, table };
  }

  private async taskCtx(req: AuthedRequest, projectId: string, tableId: string, taskId: string, need: "read" | "write" | "manage") {
    const base = await this.tableCtx(req, projectId, tableId, need);
    const task = await this.access.requireTask(base.table, taskId);
    return { ...base, task };
  }

  /** 竞品写请求统一带 `client_id`（回声抑制）；服务端不解释语义，只透传进广播 */
  private clientIdOf(body: unknown): string | null {
    if (typeof body !== "object" || body === null) return null;
    const v = (body as Record<string, unknown>).client_id;
    return typeof v === "string" && v.length > 0 ? v.slice(0, 128) : null;
  }

  // ══ 项目（我方扩展：竞品 film 项目本体端点未观测，§7 A2）══

  /** 项目列表 = 有任务表的项目（项目本体表尚未建，见 tables service 注释） */
  @Get("projects")
  async listProjects(@Req() req: AuthedRequest) {
    const { spaceId } = await this.gate(req, "read");
    const { userId } = this.ctx(req);
    return this.tables.listProjects(spaceId, userId);
  }

  // ══ 任务表本体 8 ═══════════════════════════════════════

  @Get("projects/:project_id/task-tables")
  async listTables(@Req() req: AuthedRequest, @Param("project_id") projectId: string) {
    const { spaceId } = await this.gate(req, "read");
    await this.access.assertProjectScope(spaceId, projectId);
    return this.tables.list(spaceId, projectId);
  }

  @Post("projects/:project_id/task-tables")
  async createTable(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Body() body: unknown) {
    const { spaceId } = await this.gate(req, "write");
    const input = parseOrThrow(filmTableCreateSchema, body ?? {});
    return this.tables.create(spaceId, projectId, input);
  }

  @Patch("projects/:project_id/task-tables/:table_id")
  async patchTable(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, userId, table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmTablePatchSchema, body ?? {});
    return this.tables.patch(spaceId, String(table.id), input, userId);
  }

  @Delete("projects/:project_id/task-tables/:table_id")
  async deleteTable(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
  ) {
    const { spaceId, userId } = await this.tableCtx(req, projectId, tableId, "manage");
    return this.tables.remove(spaceId, tableId, userId);
  }

  @Post("projects/:project_id/task-tables/:table_id/apply-template")
  async applyTemplate(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { userId, table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmApplyTemplateSchema, body ?? {});
    return this.tables.applyTemplate(table, input.template_id, userId, input.name);
  }

  /** 表排序：`table_ids` 是项目内有序列表（未列出的保持原相对顺序） */
  @Post("projects/:project_id/task-tables/reorder")
  async reorderTables(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Body() body: unknown) {
    const { spaceId, userId } = await this.gate(req, "write");
    const input = parseOrThrow(filmTableReorderSchema, body ?? {});
    return this.tables.reorder(spaceId, projectId, input.table_ids, userId);
  }

  @Post("projects/:project_id/task-tables/ensure-presets")
  async ensurePresets(@Req() req: AuthedRequest, @Param("project_id") projectId: string) {
    const { spaceId, userId } = await this.gate(req, "write");
    return this.tables.ensurePresets(spaceId, projectId, userId);
  }

  @Post("projects/:project_id/task-tables/import")
  async importTable(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Body() body: unknown) {
    const { spaceId, userId } = await this.gate(req, "write");
    const input = parseOrThrow(tableImportWrap, body ?? {});
    return this.tables.importTable(spaceId, projectId, userId, input);
  }

  // ══ 字段 6 ═════════════════════════════════════════════

  @Get("projects/:project_id/task-tables/:table_id/fields")
  async listFields(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Query() query: unknown,
  ) {
    const { spaceId } = await this.tableCtx(req, projectId, tableId, "read");
    const q = parseOrThrow(z.object({ include_deleted: z.enum(["true", "false"]).default("false") }), query ?? {});
    return this.fields.list(spaceId, tableId, { includeDeleted: q.include_deleted === "true" });
  }

  @Post("projects/:project_id/task-tables/:table_id/fields")
  async createField(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmFieldCreateSchema, body ?? {});
    return this.fields.create(table, input);
  }

  @Patch("projects/:project_id/task-tables/:table_id/fields/:field_id")
  async patchField(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("field_id") fieldId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmFieldPatchSchema, body ?? {});
    return this.fields.patch(spaceId, table, fieldId, input);
  }

  @Delete("projects/:project_id/task-tables/:table_id/fields/:field_id")
  async deleteField(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("field_id") fieldId: string,
  ) {
    const { userId, table } = await this.tableCtx(req, projectId, tableId, "write");
    return this.fields.remove(table, fieldId, userId);
  }

  @Post("projects/:project_id/task-tables/:table_id/fields/reorder")
  async reorderFields(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { userId, table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmFieldReorderSchema, body ?? {});
    return this.fields.reorder(table, input.field_ids, userId);
  }

  @Post("projects/:project_id/task-tables/:table_id/fields/batch-restore")
  async restoreFields(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { userId, table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmFieldBatchRestoreSchema, body ?? {});
    return this.fields.batchRestore(table, input.field_ids, userId);
  }

  // ══ 表视图偏好 2 ═══════════════════════════════════════

  @Get("projects/:project_id/task-tables/:table_id/pref")
  async getPref(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Param("table_id") tableId: string) {
    const { spaceId, userId } = await this.tableCtx(req, projectId, tableId, "read");
    return this.tables.getPref(spaceId, tableId, userId);
  }

  @Put("projects/:project_id/task-tables/:table_id/pref")
  async putPref(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, userId } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmTablePrefPutSchema, body ?? {});
    return this.tables.putPref(spaceId, tableId, userId, input);
  }

  // ══ 行（任务）12 + 统计 1 ══════════════════════════════

  /** 表格主查询；GET 版支持 `filters`/`sorts` 两个 JSON 字符串参数（与 POST 同构） */
  @Get("projects/:project_id/task-tables/:table_id/tasks/query")
  async queryTasks(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Query() query: unknown,
  ) {
    const { spaceId, userId, table } = await this.tableCtx(req, projectId, tableId, "read");
    const q = parseOrThrow(queryGetSchema, query ?? {});
    const input: FilmTaskQueryRequest = parseOrThrow(filmTaskQuerySchema, {
      filters: q.filters ? safeJsonArray(q.filters, "filters") : [],
      sorts: q.sorts ? safeJsonArray(q.sorts, "sorts") : [],
      roots_only: q.roots_only === "true",
      page: q.page,
      page_size: q.page_size,
    });
    return this.tasks.query(spaceId, table, userId, input);
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks")
  async createTask(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, userId, table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmTaskCreateSchema, body ?? {});
    // count / after_task_id 是契约里的额外字段（schema 只描述单行），单独取值而不是塞进共享 schema
    const extra = parseOrThrow(
      z.object({
        count: z.number().int().min(1).max(100).optional(),
        after_task_id: z.string().min(1).optional(),
      }),
      stripKnown(body ?? {}),
    );
    return this.tasks.create(spaceId, table, userId, input, {
      count: extra.count,
      afterTaskId: extra.after_task_id,
    });
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/unbound-query")
  async unboundQuery(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, table } = await this.tableCtx(req, projectId, tableId, "read");
    return this.tasks.unboundQuery(spaceId, table, parseOrThrow(pageOnly, body ?? {}));
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/title-matches")
  async titleMatches(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { table } = await this.tableCtx(req, projectId, tableId, "read");
    const input = parseOrThrow(titleMatchesSchema, body ?? {});
    return this.tasks.titleMatches(table, input.title, input.exclude_task_id);
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/reorder")
  async reorderTasks(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { userId, table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmTaskReorderSchema, body ?? {});
    return this.tasks.reorder(table, input.task_ids, input.parent_id, userId);
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/batch-delete")
  async batchDeleteTasks(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { userId, table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmTaskBatchSchema, body ?? {});
    return this.tasks.batchDelete(table, input.task_ids, userId);
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/batch-restore")
  async batchRestoreTasks(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Body() body: unknown,
  ) {
    const { userId, table } = await this.tableCtx(req, projectId, tableId, "write");
    const input = parseOrThrow(filmTaskBatchSchema, body ?? {});
    return this.tasks.batchRestore(table, input.task_ids, userId);
  }

  @Delete("projects/:project_id/task-tables/:table_id/tasks/:task_id")
  async deleteTask(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
  ) {
    const { userId, table } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    return this.tasks.softDelete(table, taskId, userId);
  }

  @Put("projects/:project_id/task-tables/:table_id/tasks/:task_id/cells")
  async putCells(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const input = parseOrThrow(filmCellsPutSchema, body ?? {});
    return this.tasks.putCells({ spaceId, table, task, userId, input, clientId: this.clientIdOf(body) });
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/:task_id/children")
  async createChild(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const input = parseOrThrow(childrenCreateSchema, body ?? {});
    return this.tasks.createChild(spaceId, table, task, userId, input.title);
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/:task_id/status")
  async setStatus(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const input = parseOrThrow(filmTaskStatusUpdateSchema, body ?? {});
    return this.tasks.setStatus({
      spaceId,
      table,
      task,
      userId,
      status: input.status,
      comment: input.comment,
      clientId: this.clientIdOf(body),
    });
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/:task_id/notify-assignees")
  async notifyAssignees(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const input = parseOrThrow(notifySchema, body ?? {});
    return this.tasks.notifyAssignees({ table, task, userId, opUserIds: input.op_user_ids });
  }

  @Get("projects/:project_id/tasks/stats")
  async stats(@Req() req: AuthedRequest, @Param("project_id") projectId: string) {
    const { spaceId } = await this.gate(req, "read");
    await this.access.assertProjectScope(spaceId, projectId);
    return this.tasks.stats(spaceId, projectId);
  }

  // ══ 行↔画布绑定 4 ══════════════════════════════════════

  @Get("projects/:project_id/task-tables/:table_id/tasks/:task_id/canvas-bindings")
  async listBindings(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
  ) {
    const { table, task } = await this.taskCtx(req, projectId, tableId, taskId, "read");
    return this.canvas.listTaskBindings(table, task);
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/:task_id/canvas-bindings")
  async bindCanvas(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const input = parseOrThrow(filmCanvasBindingCreateSchema, body ?? {});
    return this.canvas.bind(table, task, input, userId);
  }

  /** PUT：`{canvas_ids}` 全量替换（契约）；也接受 `{canvas_id,node_id}` 单条形式 */
  @Put("projects/:project_id/task-tables/:table_id/tasks/:task_id/canvas-bindings")
  async replaceBindings(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const single = parseOrThrow(filmCanvasBindingCreateSchema.partial(), body ?? {});
    if (single.canvas_id) {
      return this.canvas.replaceBindings(table, task, [single.canvas_id], userId);
    }
    const input = parseOrThrow(bindingCanvasIdsSchema, body ?? {});
    return this.canvas.replaceBindings(table, task, input.canvas_ids, userId);
  }

  @Delete("projects/:project_id/task-tables/:table_id/tasks/:task_id/canvas-bindings")
  async unbindCanvas(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const input = parseOrThrow(bindingCanvasIdsSchema, body ?? {});
    return this.canvas.unbind(table, task, input.canvas_ids, userId);
  }

  // ══ 审核 3（+1 提交扩展）═══════════════════════════════

  @Get("projects/:project_id/task-tables/:table_id/tasks/:task_id/review")
  async reviewDetail(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
  ) {
    const { spaceId, userId, task } = await this.taskCtx(req, projectId, tableId, taskId, "read");
    return this.review.getReview(spaceId, String(task.id), userId);
  }

  /**
   * 提交审核（**我方扩展**：竞品无此端点，其提交由画布侧 `submit-result` 触发）。
   * 表格视图里"直接提交这一行"必须有入口，否则纯手工上传的行没法进审核链。
   */
  @Post("projects/:project_id/task-tables/:table_id/tasks/:task_id/review")
  async submitReview(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const input = parseOrThrow(reviewSubmitExtraSchema, body ?? {});
    // version_no 只由服务端分配：客户端传了就校验格式（拒绝脏值），但不影响分配
    return this.review.submitVersion({
      table,
      task,
      userId,
      assetIds: input.asset_ids,
      thumbFileId: input.thumb_file_id,
      comment: input.comment,
      source: "manual",
    });
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/:task_id/review/comments")
  async addComment(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const input = parseOrThrow(filmReviewCommentCreateSchema, body ?? {});
    return this.review.addComment({
      table,
      task,
      userId,
      versionId: input.version_id,
      content: input.content,
    });
  }

  @Post("projects/:project_id/task-tables/:table_id/tasks/:task_id/review/read")
  async markRead(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("table_id") tableId: string,
    @Param("task_id") taskId: string,
    @Body() body: unknown,
  ) {
    const { userId, table, task } = await this.taskCtx(req, projectId, tableId, taskId, "write");
    const input = parseOrThrow(filmReviewReadMarkSchema, body ?? {});
    return this.review.markRead({ table, task, userId, versionIds: input.version_ids });
  }

  // ══ 画布侧 5 ═══════════════════════════════════════════

  @Get("projects/:project_id/canvases/visible")
  async visibleCanvases(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Query() query: unknown) {
    const { spaceId } = await this.gate(req, "read");
    await this.access.assertProjectScope(spaceId, projectId);
    const q = parseOrThrow(z.object({ tab: z.string().max(32).optional() }), query ?? {});
    return this.canvas.visibleCanvases(spaceId, q.tab);
  }

  @Get("projects/:project_id/canvases/:canvas_id/task-bindings")
  async canvasTaskBindings(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("canvas_id") canvasId: string,
  ) {
    const { spaceId } = await this.gate(req, "read");
    await this.access.assertProjectScope(spaceId, projectId);
    return this.canvas.taskBindingsByCanvas(spaceId, canvasId);
  }

  @Get("projects/:project_id/canvases/:canvas_id/task-panel")
  async canvasTaskPanel(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("canvas_id") canvasId: string,
  ) {
    const { spaceId } = await this.gate(req, "read");
    await this.access.assertProjectScope(spaceId, projectId);
    return this.canvas.taskPanel(spaceId, canvasId);
  }

  /** 机制 #2：画布节点产物 → 版本 → 行状态 pending_review → 通知 */
  @Post("projects/:project_id/canvases/:canvas_id/submit-result")
  async submitResult(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("canvas_id") canvasId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, userId } = await this.gate(req, "write");
    await this.access.assertProjectScope(spaceId, projectId);
    // shared 的 filmSubmitResultSchema 要求 node_id；契约 §7 A8 的 body 里没有 node_id，
    // 故这里补一个统一入口：缺 node_id 时按画布级哨兵 0 处理（画布整张提交）
    const raw = (body ?? {}) as Record<string, unknown>;
    const input = parseOrThrow(
      z.object({
        task_id: z.string().min(1),
        node_id: z.string().min(1).default("0"),
        asset_ids: z.array(z.string().min(1)).max(50).default([]),
        thumb_file_id: z.string().max(500).optional(),
        comment: z.string().max(2000).optional(),
      }),
      raw,
    );
    return this.canvas.submitResult({
      spaceId,
      canvasId,
      userId,
      input,
      clientId: this.clientIdOf(body),
    });
  }

  @Delete("projects/:project_id/canvases/:canvas_id")
  async deleteCanvas(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("canvas_id") canvasId: string,
  ) {
    const { spaceId, userId } = await this.gate(req, "manage");
    await this.access.assertProjectScope(spaceId, projectId);
    return this.canvas.unbindCanvas(spaceId, canvasId, userId);
  }

  // ══ 任务模板 3 ═════════════════════════════════════════

  @Get("projects/:project_id/task-templates")
  async listTemplates(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Query() query: unknown) {
    const { spaceId, userId } = await this.gate(req, "read");
    await this.access.assertProjectScope(spaceId, projectId);
    const q = parseOrThrow(templateQuerySchema, query ?? {});
    return this.tables.listTemplates(spaceId, projectId, userId, q.scope);
  }

  @Post("projects/:project_id/task-templates")
  async createTemplate(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Body() body: unknown) {
    const { spaceId, userId } = await this.gate(req, "write");
    const input = parseOrThrow(templateCreateSchema, body ?? {});
    return this.tables.createTemplate(spaceId, projectId, userId, input);
  }

  @Delete("projects/:project_id/task-templates/:template_id")
  async deleteTemplate(
    @Req() req: AuthedRequest,
    @Param("project_id") projectId: string,
    @Param("template_id") templateId: string,
  ) {
    const { spaceId, userId, ctx } = await this.gate(req, "write");
    await this.access.assertProjectScope(spaceId, projectId);
    return this.tables.removeTemplate(spaceId, templateId, userId, TeamService.hasPrivilege(ctx));
  }

  // ══ 导出 2 ═════════════════════════════════════════════

  @Get("projects/:project_id/exports")
  async listExports(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Query() query: unknown) {
    const { spaceId } = await this.gate(req, "read");
    await this.access.assertProjectScope(spaceId, projectId);
    const q = parseOrThrow(z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }), query ?? {});
    return this.exports.list(spaceId, projectId, q.limit);
  }

  @Post("projects/:project_id/exports")
  async createExport(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Body() body: unknown) {
    const { spaceId, userId } = await this.gate(req, "manage");
    await this.access.assertProjectScope(spaceId, projectId);
    const input = parseOrThrow(filmExportCreateSchema, body ?? {});
    return this.exports.create(spaceId, projectId, userId, input);
  }

  // ══ 最近打开 2 ═════════════════════════════════════════

  @Get("projects/:project_id/recent-open")
  async listRecentOpen(@Req() req: AuthedRequest, @Param("project_id") projectId: string) {
    const { spaceId, userId } = await this.gate(req, "read");
    await this.access.assertProjectScope(spaceId, projectId);
    const recent = await this.tables.listRecentOpens(spaceId, userId);
    return {
      list: recent.list,
      current: recent.list.find((r) => r.project_id === projectId) ?? null,
    };
  }

  @Post("projects/:project_id/recent-open")
  async markRecentOpen(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Body() body: unknown) {
    const { spaceId, userId } = await this.gate(req, "read");
    const input = parseOrThrow(recentOpenPutSchema, body ?? {});
    return this.tables.markRecentOpen(spaceId, projectId, userId, input.table_id ?? null);
  }
}

/** 安全解析 JSON 数组参数（GET 版 filters/sorts）；坏 JSON 一律 400101 而不是 500 */
function safeJsonArray(raw: string, field: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `${field} must be a JSON array`, { field });
    }
    return parsed;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(ErrorCode.INVALID_PARAM, `${field} is not valid JSON`, { field });
  }
}

/** 从请求体里去掉共享 schema 已消费的键，避免 zod strict 误判（只用于取扩展字段） */
function stripKnown(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) return {};
  const { title, parent_id, sort, assignee_user_id, cells, count, after_task_id } = body as Record<string, unknown>;
  void title;
  void parent_id;
  void sort;
  void assignee_user_id;
  void cells;
  const out: Record<string, unknown> = {};
  if (count !== undefined) out.count = count;
  if (after_task_id !== undefined) out.after_task_id = after_task_id;
  return out;
}
