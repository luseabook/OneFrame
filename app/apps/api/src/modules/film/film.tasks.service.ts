import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  creditFlows,
  filmCanvasBindings,
  filmCells,
  filmFields,
  filmReviewVersions,
  filmTablePrefs,
  filmTables,
  filmTasks,
  spaceMembers,
  type Tx,
} from "@app/db";
import {
  AppError,
  ErrorCode,
  FILM_LIMITS,
  FILM_TASK_STATUS_NAMES,
  FilmTaskStatus,
  newId,
  type FilmCellsPutRequest,
  type FilmTaskCreateRequest,
  type FilmTaskQueryRequest,
} from "@app/shared";
import { db } from "../../db/database";
import type { FilmTableRow, FilmTaskRow } from "./film.access";
import { FilmAccessService } from "./film.access";
import type { FilmFieldRow } from "./film.fields.service";
import { FilmFieldsService } from "./film.fields.service";
import { buildFilterCondition, buildSortExpression, isClearValue, isReadonlyType, normalizeCellValue } from "./film.fields";
import { FilmRealtimeService } from "./film.realtime";
import { FilmReviewService } from "./film.review.service";

/**
 * film 行（任务）服务 —— 契约 §3.5 的「行（任务）12」+「统计 1」。
 *
 * 三个必须做对的点（本域最容易写歪的地方）：
 *
 * 1. **单元格是稀疏映射，不是稠密表**：对外 `{field_id: value}`，落库 `film_cells` 行；
 *    清空 = DELETE 行。按"每格一行"或"整行覆盖写"实现都会让空值语义崩掉。
 * 2. **行写入是整行版本 CAS**：`PUT cells` 必带 `version`，不匹配 → 746002。
 *    这与画布的悲观锁（按节点锁）是两套模型并存，竞品亦然（契约 §6.3）。
 * 3. **只读列不接受写入**：`task_status` / `review_ref` / `points_ro` 的值由服务端产生。
 */

const STATUS_NAME_BY_VALUE: Record<number, string> = {
  1: "not_started",
  2: "in_progress",
  3: "pending_review",
  4: "rejected",
  5: "done",
};

export interface LoadedCells {
  cellsByTask: Map<string, Record<string, unknown>>;
  canvasIdsByTask: Map<string, string[]>;
  latestVersionByTask: Map<string, { id: string; versionNo: string; thumbFileId: string | null }>;
}

@Injectable()
export class FilmTasksService {
  constructor(
    @Inject(FilmAccessService) private readonly access: FilmAccessService,
    @Inject(FilmFieldsService) private readonly fields: FilmFieldsService,
    @Inject(FilmReviewService) private readonly review: FilmReviewService,
    @Inject(FilmRealtimeService) private readonly realtime: FilmRealtimeService,
  ) {}

  // ── 视图映射 ────────────────────────────────────────────

  toSummary(row: FilmTaskRow) {
    return {
      id: String(row.id),
      task_id: String(row.id),
      table_id: String(row.tableId),
      parent_id: row.parentId ? String(row.parentId) : null,
      sort: row.sort,
      version: row.version,
      status: row.status,
      status_name: STATUS_NAME_BY_VALUE[row.status] ?? "not_started",
      title: row.title,
      review_version_no: row.reviewVersionNo,
      assignee_user_id: row.assigneeUserId ? String(row.assigneeUserId) : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  tableView(table: FilmTableRow) {
    return {
      id: String(table.id),
      table_id: String(table.id),
      space_id: String(table.spaceId),
      project_id: String(table.projectId),
      name: table.name,
      is_preset: table.isPreset,
      sort: table.sort,
      version: table.version,
    };
  }

  /**
   * 一次把整页的行数据取齐（避免 N+1）：
   * 单元格 + 画布绑定（produce）+ 最新版本（review）+ 系统字段 id 反查。
   *
   * 系统列的只读派生值直接注入 cells 映射（title/assignees/task_status/produce/review），
   * 前端渲染一行不需要再发请求；`points` 按契约 A14 返回 `null`（未结算）而不是 0。
   */
  private async loadCells(spaceId: string, rows: FilmTaskRow[]): Promise<LoadedCells> {
    const cellsByTask = new Map<string, Record<string, unknown>>();
    const canvasIdsByTask = new Map<string, string[]>();
    const latestVersionByTask = new Map<string, { id: string; versionNo: string; thumbFileId: string | null }>();
    if (rows.length === 0) return { cellsByTask, canvasIdsByTask, latestVersionByTask };
    const taskIds = rows.map((r) => r.id);

    const cellRows = (await db
      .select({ taskId: filmCells.taskId, fieldId: filmCells.fieldId, value: filmCells.valueJson })
      .from(filmCells)
      .where(and(inArray(filmCells.taskId, taskIds), eq(filmCells.spaceId, BigInt(spaceId))))) as Array<{
      taskId: bigint;
      fieldId: bigint;
      value: unknown;
    }>;
    for (const c of cellRows) {
      const key = String(c.taskId);
      const bucket = cellsByTask.get(key) ?? {};
      bucket[String(c.fieldId)] = c.value;
      cellsByTask.set(key, bucket);
    }

    const bindings = (await db
      .select({ taskId: filmCanvasBindings.taskId, canvasId: filmCanvasBindings.canvasId })
      .from(filmCanvasBindings)
      .where(inArray(filmCanvasBindings.taskId, taskIds))) as Array<{ taskId: bigint; canvasId: bigint }>;
    for (const b of bindings) {
      const key = String(b.taskId);
      const list = canvasIdsByTask.get(key) ?? [];
      if (!list.includes(String(b.canvasId))) list.push(String(b.canvasId));
      canvasIdsByTask.set(key, list);
    }

    const versions = (await db
      .select({
        id: filmReviewVersions.id,
        taskId: filmReviewVersions.taskId,
        versionNo: filmReviewVersions.versionNo,
        thumbFileId: filmReviewVersions.thumbFileId,
      })
      .from(filmReviewVersions)
      .where(inArray(filmReviewVersions.taskId, taskIds))
      .orderBy(desc(filmReviewVersions.versionNo))) as Array<{
      id: bigint;
      taskId: bigint;
      versionNo: string;
      thumbFileId: string | null;
    }>;
    for (const v of versions) {
      const key = String(v.taskId);
      if (!latestVersionByTask.has(key)) {
        latestVersionByTask.set(key, { id: String(v.id), versionNo: v.versionNo, thumbFileId: v.thumbFileId ?? null });
      }
    }

    // 系统字段的 field_id 是雪花（每张表不同），必须按 key 反查后再注入 cells
    const systemFields = (await db
      .select({ id: filmFields.id, tableId: filmFields.tableId, key: filmFields.key })
      .from(filmFields)
      .where(and(inArray(filmFields.tableId, rows.map((r) => r.tableId)), isNull(filmFields.deletedAt)))) as Array<{
      id: bigint;
      tableId: bigint;
      key: string;
    }>;
    const systemIdByTableKey = new Map<string, string>();
    for (const f of systemFields) systemIdByTableKey.set(`${f.tableId}:${f.key}`, String(f.id));

    for (const row of rows) {
      const key = String(row.id);
      const bucket = cellsByTask.get(key) ?? {};
      const sid = (k: string) => systemIdByTableKey.get(`${row.tableId}:${k}`);
      const titleId = sid("title");
      const assigneesId = sid("assignees");
      const produceId = sid("produce");
      const statusId = sid("task_status");
      const reviewId = sid("review");
      const pointsId = sid("points");
      if (titleId) bucket[titleId] = row.title;
      if (assigneesId) bucket[assigneesId] = row.assigneeUserId ? String(row.assigneeUserId) : null;
      if (produceId) bucket[produceId] = canvasIdsByTask.get(key) ?? [];
      if (statusId) bucket[statusId] = row.status;
      if (reviewId) bucket[reviewId] = latestVersionByTask.get(key)?.versionNo ?? null;
      if (pointsId) bucket[pointsId] = null;
      cellsByTask.set(key, bucket);
    }
    return { cellsByTask, canvasIdsByTask, latestVersionByTask };
  }

  private async buildTaskItems(
    spaceId: string,
    table: FilmTableRow,
    rows: FilmTaskRow[],
    opts: { withChildren?: boolean } = {},
  ) {
    const loaded = await this.loadCells(spaceId, rows);
    const childRows = opts.withChildren && rows.length > 0
      ? ((await db
          .select()
          .from(filmTasks)
          .where(
            and(
              eq(filmTasks.tableId, table.id),
              isNull(filmTasks.deletedAt),
              inArray(filmTasks.parentId, rows.map((r) => r.id)),
            ),
          )
          .orderBy(asc(filmTasks.sort))) as FilmTaskRow[])
      : [];
    const childLoaded = childRows.length > 0 ? await this.loadCells(spaceId, childRows) : null;
    const childrenByParent = new Map<string, FilmTaskRow[]>();
    for (const c of childRows) {
      const key = String(c.parentId);
      const list = childrenByParent.get(key) ?? [];
      list.push(c);
      childrenByParent.set(key, list);
    }
    return rows.map((row) => {
      const key = String(row.id);
      const childList = childrenByParent.get(key) ?? [];
      const latest = loaded.latestVersionByTask.get(key);
      return {
        ...this.toSummary(row),
        cells: loaded.cellsByTask.get(key) ?? {},
        produce: { canvas_ids: loaded.canvasIdsByTask.get(key) ?? [] },
        review: {
          latest_version_no: row.reviewVersionNo,
          version_id: latest?.id ?? null,
          thumb_file_id: latest?.thumbFileId ?? null,
          version_no: latest?.versionNo ?? null,
        },
        children: childList.map((c) => ({
          ...this.toSummary(c),
          cells: childLoaded?.cellsByTask.get(String(c.id)) ?? {},
        })),
      };
    });
  }

  // ── 1. 查询（表格视图主接口）───────────────────────────

  async query(spaceId: string, table: FilmTableRow, userId: string, input: FilmTaskQueryRequest) {
    const fieldRows = await this.fields.requireFields(spaceId, String(table.id));
    const fieldById = new Map(fieldRows.map((f) => [String(f.id), f]));
    const conds = [eq(filmTasks.tableId, table.id), isNull(filmTasks.deletedAt)];
    if (input.roots_only) conds.push(isNull(filmTasks.parentId));

    for (const f of input.filters) {
      const field = fieldById.get(f.field_id);
      if (!field) {
        throw new AppError(ErrorCode.INVALID_PARAM, `unknown field_id ${f.field_id}`, {
          field: "filters",
          reason: "unknown_field",
        });
      }
      conds.push(buildFilterCondition(FilmFieldsService.asLike(field), f.op, f.value));
    }

    const orderBy: SQL[] = [];
    for (const s of input.sorts) {
      const field = fieldById.get(s.field_id);
      if (!field) {
        throw new AppError(ErrorCode.INVALID_PARAM, `unknown sort field_id ${s.field_id}`, {
          field: "sorts",
          reason: "unknown_field",
        });
      }
      orderBy.push(buildSortExpression(FilmFieldsService.asLike(field), s.order));
    }
    orderBy.push(sql`${filmTasks.sort} asc`, sql`${filmTasks.createdAt} asc`);

    const rows = (await db
      .select()
      .from(filmTasks)
      .where(and(...conds))
      .orderBy(...orderBy)
      .limit(input.page_size)
      .offset((input.page - 1) * input.page_size)) as FilmTaskRow[];
    const [countRow] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(filmTasks)
      .where(and(...conds))) as Array<{ n: number }>;

    const tasks = await this.buildTaskItems(spaceId, table, rows, { withChildren: true });
    return {
      table: this.tableView(table),
      fields: fieldRows.map((f) => this.fields.toView(f)),
      tasks,
      pref: await this.prefFor(table, userId),
      page: { page: input.page, page_size: input.page_size, total_main: Number(countRow?.n ?? 0) },
    };
  }

  /** 视图偏好（与表服务的 put/get 同表，只做只读合并） */
  private async prefFor(table: FilmTableRow, userId: string) {
    const [row] = (await db
      .select()
      .from(filmTablePrefs)
      .where(and(eq(filmTablePrefs.tableId, table.id), eq(filmTablePrefs.userId, BigInt(userId))))
      .limit(1)) as Array<{ hiddenFieldIds: unknown; filterJson: unknown; ui: unknown }>;
    return {
      hidden_field_ids: Array.isArray(row?.hiddenFieldIds) ? row?.hiddenFieldIds : [],
      filter: Array.isArray(row?.filterJson) ? row?.filterJson : [],
      ui: (row?.ui ?? {}) as Record<string, unknown>,
    };
  }

  // ── 2. 建行（支持 count 批量与 after_task_id 插入位）────

  async create(
    spaceId: string,
    table: FilmTableRow,
    userId: string,
    input: FilmTaskCreateRequest,
    opts: { count?: number; afterTaskId?: string } = {},
  ) {
    const fieldRows = await this.fields.requireFields(spaceId, String(table.id));
    const fieldById = new Map(fieldRows.map((f) => [String(f.id), f]));
    const parentId = input.parent_id ? input.parent_id : null;
    if (parentId) {
      // 只支持一层子行：竞品表格是父子两层（children[] 只有一层），深层嵌套会让
      // 行号/拖拽/导出全部失去可解释语义
      const parent = await this.access.requireTask(table, parentId);
      if (parent.parentId) {
        throw new AppError(ErrorCode.INVALID_PARAM, "only one level of child rows is supported", {
          field: "parent_id",
          reason: "nested_too_deep",
        });
      }
    }
    const count = Math.max(1, Math.min(100, Math.floor(opts.count ?? 1)));
    const [countRow] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(filmTasks)
      .where(and(eq(filmTasks.tableId, table.id), isNull(filmTasks.deletedAt)))) as Array<{ n: number }>;
    if (Number(countRow?.n ?? 0) + count > FILM_LIMITS.TASK_MAX) {
      throw new AppError(ErrorCode.INVALID_PARAM, `table rows exceed ${FILM_LIMITS.TASK_MAX}`, {
        field: "count",
        reason: "row_limit",
      });
    }

    let sortBase = input.sort ?? -1;
    if (sortBase < 0) {
      const [maxRow] = (await db
        .select({ m: sql<number>`coalesce(max(${filmTasks.sort}), -1)::int` })
        .from(filmTasks)
        .where(and(eq(filmTasks.tableId, table.id), isNull(filmTasks.parentId)))) as Array<{ m: number }>;
      sortBase = Number(maxRow?.m ?? -1) + 1;
    }
    if (opts.afterTaskId) {
      const anchor = await this.access.requireTask(table, opts.afterTaskId);
      sortBase = anchor.sort + 1;
      // "插在某行之后"必须真插在中间：把后面的行整体后移 count 位
      await db
        .update(filmTasks)
        .set({ sort: sql`${filmTasks.sort} + ${count}` })
        .where(
          and(eq(filmTasks.tableId, table.id), isNull(filmTasks.parentId), sql`${filmTasks.sort} >= ${sortBase}`),
        );
    }

    const created: FilmTaskRow[] = [];
    await db.transaction(async (tx) => {
      for (let i = 0; i < count; i += 1) {
        const id = newId();
        const title = (input.title ?? "").slice(0, FILM_LIMITS.TASK_TITLE_MAX);
        const [row] = (await tx
          .insert(filmTasks)
          .values({
            id,
            tableId: table.id,
            spaceId: table.spaceId,
            parentId: parentId ? BigInt(parentId) : null,
            sort: sortBase + i,
            version: 1,
            status: FilmTaskStatus.NOT_STARTED,
            title,
            reviewVersionNo: 0,
            assigneeUserId: input.assignee_user_id ? BigInt(input.assignee_user_id) : null,
            createdBy: BigInt(userId),
          })
          .returning()) as FilmTaskRow[];
        created.push(row);
        // 初始单元格与 PUT cells 走同一套校验：否则会出现"建行能写脏值、改格子不能"
        if (input.cells) await this.writeCells(tx, table, row, fieldById, input.cells, userId);
        if (title.length > 0) await this.syncTitleCell(tx, table, row, title, userId);
      }
    });
    const items = await this.buildTaskItems(spaceId, table, created);
    this.realtime.broadcast({
      spaceId,
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.created",
      payload: { task_ids: created.map((r) => String(r.id)), count },
      originUserId: userId,
    });
    return { list: items };
  }

  /** 单个 task 的完整视图（写接口的响应体） */
  async detail(spaceId: string, table: FilmTableRow, task: FilmTaskRow) {
    const items = await this.buildTaskItems(spaceId, table, [task]);
    return items[0];
  }

  // ── 3. 写单元格（CAS + 稀疏增量）───────────────────────

  async putCells(params: {
    spaceId: string;
    table: FilmTableRow;
    task: FilmTaskRow;
    userId: string;
    input: FilmCellsPutRequest;
    clientId?: string | null;
  }) {
    const { table, task, userId, input } = params;
    if (input.version !== task.version) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, "row version conflict", {
        expected: input.version,
        current: task.version,
      });
    }
    const fieldRows = await this.fields.requireFields(params.spaceId, String(table.id));
    const fieldById = new Map(fieldRows.map((f) => [String(f.id), f]));
    const updated = await db.transaction(async (tx) => {
      await this.writeCells(tx, table, task, fieldById, input.cells, userId);
      const titleFieldId = fieldRows.find((f) => f.key === "title")?.id;
      if (titleFieldId && Object.prototype.hasOwnProperty.call(input.cells, String(titleFieldId))) {
        const raw = input.cells[String(titleFieldId)];
        const title = isClearValue(raw) ? "" : String(raw).slice(0, FILM_LIMITS.TASK_TITLE_MAX);
        await tx.update(filmTasks).set({ title, updatedAt: new Date() }).where(eq(filmTasks.id, task.id));
      }
      const [row] = (await tx
        .update(filmTasks)
        .set({
          version: sql`${filmTasks.version} + 1`,
          // 未开始 → 制作中：第一次写格子就是"开工了"（契约 _t 可编辑态含 not_started/in_progress）
          status: sql`case when ${filmTasks.status} = 1 then 2 else ${filmTasks.status} end`,
          updatedAt: new Date(),
        })
        .where(eq(filmTasks.id, task.id))
        .returning()) as FilmTaskRow[];
      return row;
    });
    const item = await this.detail(params.spaceId, table, updated);
    this.realtime.broadcast({
      spaceId: params.spaceId,
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.cells_updated",
      payload: { task_id: String(task.id), version: updated.version, field_ids: Object.keys(input.cells) },
      originUserId: userId,
      originClientId: params.clientId,
    });
    return item;
  }

  /** 单元格写入本体（事务内）：按 field_type 校验 + 稀疏写/删 */
  private async writeCells(
    tx: Tx,
    table: FilmTableRow,
    task: FilmTaskRow,
    fieldById: Map<string, FilmFieldRow>,
    cells: Record<string, unknown>,
    userId: string,
  ) {
    for (const [fieldId, raw] of Object.entries(cells)) {
      const field = fieldById.get(fieldId);
      if (!field) {
        throw new AppError(ErrorCode.INVALID_PARAM, `field ${fieldId} does not belong to this table`, {
          field: fieldId,
          reason: "unknown_field",
        });
      }
      if (isReadonlyType(field.fieldType)) {
        throw new AppError(ErrorCode.INVALID_PARAM, `field is read-only: ${field.fieldType}`, {
          field: fieldId,
          reason: "readonly_field",
        });
      }
      if (isClearValue(raw)) {
        await tx.delete(filmCells).where(and(eq(filmCells.taskId, task.id), eq(filmCells.fieldId, field.id)));
        continue;
      }
      const value = normalizeCellValue(FilmFieldsService.asLike(field), raw);
      await tx
        .insert(filmCells)
        .values({
          id: newId(),
          taskId: task.id,
          fieldId: field.id,
          spaceId: table.spaceId,
          valueJson: value,
          updatedBy: BigInt(userId),
        })
        .onConflictDoUpdate({
          target: [filmCells.taskId, filmCells.fieldId],
          set: { valueJson: value, updatedBy: BigInt(userId), updatedAt: new Date() },
        });
    }
  }

  /** 建行带 title 时补一条 title 单元格（保持 cells 与冗余列一致） */
  private async syncTitleCell(tx: Tx, table: FilmTableRow, task: FilmTaskRow, title: string, userId: string) {
    const [titleField] = (await tx
      .select({ id: filmFields.id })
      .from(filmFields)
      .where(and(eq(filmFields.tableId, table.id), eq(filmFields.key, "title"), isNull(filmFields.deletedAt)))
      .limit(1)) as Array<{ id: bigint }>;
    if (!titleField) return;
    await tx
      .insert(filmCells)
      .values({
        id: newId(),
        taskId: task.id,
        fieldId: titleField.id,
        spaceId: table.spaceId,
        valueJson: title,
        updatedBy: BigInt(userId),
      })
      .onConflictDoUpdate({
        target: [filmCells.taskId, filmCells.fieldId],
        set: { valueJson: title, updatedBy: BigInt(userId), updatedAt: new Date() },
      });
  }

  // ── 4. 行状态（承载审核决策）───────────────────────────

  /**
   * 行状态流转（双轨中的"行轨"）。
   *
   * 竞品没有 review/approve|reject 端点（契约 §7 A3），决策只能走这里，所以本方法
   * 同时负责把最新版本按决策落库：
   *   - 5(done)   → 最新版本必须存在且未驳回；若仍待审则就地批准
   *   - 4(rejected)→ 最新版本必须待审，就地驳回（已决策版本不可改判）
   *   - 3(pending_review) → 只改行状态（允许"无产物先送审"的人工操作）
   */
  async setStatus(params: {
    spaceId: string;
    table: FilmTableRow;
    task: FilmTaskRow;
    userId: string;
    status: number;
    comment?: string;
    clientId?: string | null;
  }) {
    const { table, task, userId, status } = params;
    if (!FILM_TASK_STATUS_NAMES[status - 1]) {
      throw new AppError(ErrorCode.INVALID_PARAM, `invalid status ${status}`, { field: "status" });
    }
    let decision: { version_id: string; version_no: string; status: number } | null = null;
    if (status === FilmTaskStatus.DONE) {
      const latest = await this.review.latestVersion(String(task.id));
      if (!latest) {
        throw new AppError(ErrorCode.INVALID_PARAM, "cannot finish a task without any review version", {
          field: "status",
          reason: "no_review_version",
        });
      }
      if (latest.status === 3) {
        throw new AppError(ErrorCode.INVALID_PARAM, "latest version is rejected; resubmit before finishing", {
          field: "status",
          reason: "latest_rejected",
          version_no: latest.versionNo,
        });
      }
      if (latest.status === 1) {
        decision = await this.review.decideLatest({ table, task, userId, decision: 2, comment: params.comment });
      }
    } else if (status === FilmTaskStatus.REJECTED) {
      decision = await this.review.decideLatest({ table, task, userId, decision: 3, comment: params.comment });
    }
    const [row] = (await db
      .update(filmTasks)
      .set({ status, version: sql`${filmTasks.version} + 1`, updatedAt: new Date() })
      .where(eq(filmTasks.id, task.id))
      .returning()) as FilmTaskRow[];
    const item = await this.detail(params.spaceId, table, row);
    this.realtime.broadcast({
      spaceId: params.spaceId,
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.status_changed",
      payload: { task_id: String(task.id), status, decision },
      originUserId: userId,
      originClientId: params.clientId,
    });
    return { ...item, decision };
  }

  // ── 5. 删除 / 恢复 / 子行 / 排序 ───────────────────────

  /** 软删（`deleted_at`）：审核/绑定/单元格都保留，恢复后一切如初 */
  async softDelete(table: FilmTableRow, taskId: string, originUserId: string) {
    const task = await this.access.requireTask(table, taskId);
    await db.update(filmTasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(filmTasks.id, task.id));
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.deleted",
      payload: { task_ids: [String(task.id)] },
      originUserId,
    });
    return { ok: true };
  }

  async batchDelete(table: FilmTableRow, taskIds: string[], originUserId: string) {
    const rows = (await db
      .select({ id: filmTasks.id })
      .from(filmTasks)
      .where(
        and(
          eq(filmTasks.tableId, table.id),
          isNull(filmTasks.deletedAt),
          inArray(filmTasks.id, taskIds.map((v) => BigInt(v))),
        ),
      )) as Array<{ id: bigint }>;
    if (rows.length !== taskIds.length) {
      throw new AppError(ErrorCode.INVALID_PARAM, "some task_ids are not in this table or already deleted", {
        field: "task_ids",
        reason: "foreign_id",
      });
    }
    const ids = rows.map((r) => r.id);
    await db.transaction(async (tx) => {
      await tx.update(filmTasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(filmTasks.id, ids));
      // 子行跟随父行进回收站：否则父行恢复后子行"凭空消失"
      await tx
        .update(filmTasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(filmTasks.tableId, table.id), isNull(filmTasks.deletedAt), inArray(filmTasks.parentId, ids)));
    });
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.batch_deleted",
      payload: { task_ids: ids.map((v) => String(v)) },
      originUserId,
    });
    return { deleted_task_ids: ids.map((v) => String(v)) };
  }

  async batchRestore(table: FilmTableRow, taskIds: string[], originUserId: string) {
    const rows = (await db
      .select({ id: filmTasks.id, deletedAt: filmTasks.deletedAt })
      .from(filmTasks)
      .where(and(eq(filmTasks.tableId, table.id), inArray(filmTasks.id, taskIds.map((v) => BigInt(v)))))) as Array<{
      id: bigint;
      deletedAt: Date | null;
    }>;
    if (rows.length !== taskIds.length) {
      throw new AppError(ErrorCode.INVALID_PARAM, "some task_ids do not belong to this table", {
        field: "task_ids",
        reason: "foreign_id",
      });
    }
    const restorable = rows.filter((r) => r.deletedAt !== null).map((r) => r.id);
    if (restorable.length > 0) {
      await db.update(filmTasks).set({ deletedAt: null, updatedAt: new Date() }).where(inArray(filmTasks.id, restorable));
    }
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.batch_restored",
      payload: { task_ids: restorable.map((v) => String(v)) },
      originUserId,
    });
    return { restored_task_ids: restorable.map((v) => String(v)) };
  }

  async createChild(spaceId: string, table: FilmTableRow, parent: FilmTaskRow, userId: string, title?: string) {
    // 与 create(parent_id) 同一约束：只允许一层父子（深层嵌套会让行号/拖拽/导出失去可解释语义）
    if (parent.parentId) {
      throw new AppError(ErrorCode.INVALID_PARAM, "only one level of child rows is supported", {
        field: "parent_id",
        reason: "nested_too_deep",
      });
    }
    const [maxRow] = (await db
      .select({ m: sql<number>`coalesce(max(${filmTasks.sort}), -1)::int` })
      .from(filmTasks)
      .where(and(eq(filmTasks.parentId, parent.id), isNull(filmTasks.deletedAt)))) as Array<{ m: number }>;
    const [row] = (await db
      .insert(filmTasks)
      .values({
        id: newId(),
        tableId: table.id,
        spaceId: table.spaceId,
        parentId: parent.id,
        sort: Number(maxRow?.m ?? -1) + 1,
        version: 1,
        status: FilmTaskStatus.NOT_STARTED,
        title: (title ?? "").slice(0, FILM_LIMITS.TASK_TITLE_MAX),
        reviewVersionNo: 0,
        assigneeUserId: null,
        createdBy: BigInt(userId),
      })
      .returning()) as FilmTaskRow[];
    this.realtime.broadcast({
      spaceId,
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.child_created",
      payload: { parent_id: String(parent.id), task_id: String(row.id) },
      originUserId: userId,
    });
    return this.detail(spaceId, table, row);
  }

  async reorder(table: FilmTableRow, taskIds: string[], parentId: string | null, originUserId: string) {
    const rows = (await db
      .select({ id: filmTasks.id, parentId: filmTasks.parentId })
      .from(filmTasks)
      .where(and(eq(filmTasks.tableId, table.id), inArray(filmTasks.id, taskIds.map((v) => BigInt(v)))))) as Array<{
      id: bigint;
      parentId: bigint | null;
    }>;
    if (rows.length !== taskIds.length) {
      throw new AppError(ErrorCode.INVALID_PARAM, "some task_ids do not belong to this table", {
        field: "task_ids",
        reason: "foreign_id",
      });
    }
    const expectParent = parentId ? parentId : null;
    for (const r of rows) {
      const actual = r.parentId ? String(r.parentId) : null;
      if (actual !== expectParent) {
        throw new AppError(ErrorCode.INVALID_PARAM, "reorder must stay within the same parent", {
          field: "parent_id",
          reason: "mixed_parent",
        });
      }
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < taskIds.length; i += 1) {
        await tx.update(filmTasks).set({ sort: i, updatedAt: new Date() }).where(eq(filmTasks.id, BigInt(taskIds[i])));
      }
    });
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.reordered",
      payload: { task_ids: taskIds },
      originUserId,
    });
    return { ok: true };
  }

  // ── 6. 标题查重 / 未绑定画布行 / 统计 ──────────────────

  /** 标题查重（"新建行前先查同名"链路；大小写不敏感） */
  async titleMatches(table: FilmTableRow, title: string, excludeTaskId?: string) {
    const conds = [eq(filmTasks.tableId, table.id), isNull(filmTasks.deletedAt), ilike(filmTasks.title, title)];
    if (excludeTaskId) conds.push(sql`${filmTasks.id} <> ${BigInt(excludeTaskId)}`);
    const rows = (await db
      .select({ id: filmTasks.id, title: filmTasks.title })
      .from(filmTasks)
      .where(and(...conds))
      .limit(20)) as Array<{ id: bigint; title: string }>;
    return { list: rows.map((r) => ({ task_id: String(r.id), title: r.title })) };
  }

  /** 未绑定任何画布的行（"还有哪些活没进画布"的工作台视图） */
  async unboundQuery(spaceId: string, table: FilmTableRow, input: { page: number; page_size: number }) {
    const baseConds = [eq(filmTasks.tableId, table.id), isNull(filmTasks.deletedAt), isNull(filmCanvasBindings.id)];
    const rows = (await db
      .select({ task: filmTasks })
      .from(filmTasks)
      .leftJoin(filmCanvasBindings, eq(filmCanvasBindings.taskId, filmTasks.id))
      .where(and(...baseConds))
      .orderBy(asc(filmTasks.sort))
      .limit(input.page_size)
      .offset((input.page - 1) * input.page_size)) as Array<{ task: FilmTaskRow }>;
    const [countRow] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(filmTasks)
      .leftJoin(filmCanvasBindings, eq(filmCanvasBindings.taskId, filmTasks.id))
      .where(and(...baseConds))) as Array<{ n: number }>;
    const fieldRows = await this.fields.requireFields(spaceId, String(table.id));
    const items = await this.buildTaskItems(spaceId, table, rows.map((r) => r.task));
    return {
      fields: fieldRows.map((f) => this.fields.toView(f)),
      rows: items,
      page: { page: input.page, page_size: input.page_size, total: Number(countRow?.n ?? 0) },
    };
  }

  /** 项目级状态统计（按状态 + 按负责人两维） */
  async stats(spaceId: string, projectId: string) {
    const scopeConds = and(
      eq(filmTables.spaceId, BigInt(spaceId)),
      eq(filmTables.projectId, BigInt(projectId)),
      isNull(filmTasks.deletedAt),
    );
    const byStatus = (await db
      .select({ status: filmTasks.status, n: sql<number>`count(*)::int` })
      .from(filmTasks)
      .innerJoin(filmTables, eq(filmTasks.tableId, filmTables.id))
      .where(scopeConds)
      .groupBy(filmTasks.status)) as Array<{ status: number; n: number }>;
    const counts: Record<string, number> = {};
    for (const name of FILM_TASK_STATUS_NAMES) counts[name] = 0;
    let total = 0;
    for (const row of byStatus) {
      const name = STATUS_NAME_BY_VALUE[row.status];
      if (name) counts[name] = Number(row.n ?? 0);
      total += Number(row.n ?? 0);
    }
    const byAssignee = (await db
      .select({
        userId: filmTasks.assigneeUserId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${filmTasks.status} = 5)::int`,
        pendingReview: sql<number>`count(*) filter (where ${filmTasks.status} = 3)::int`,
      })
      .from(filmTasks)
      .innerJoin(filmTables, eq(filmTasks.tableId, filmTables.id))
      .where(scopeConds)
      .groupBy(filmTasks.assigneeUserId)) as Array<{
      userId: bigint | null;
      total: number;
      done: number;
      pendingReview: number;
    }>;
    return {
      ...counts,
      total,
      by_status: counts,
      by_assignee: byAssignee.map((r) => ({
        user_id: r.userId ? String(r.userId) : null,
        total: Number(r.total ?? 0),
        done: Number(r.done ?? 0),
        pending_review: Number(r.pendingReview ?? 0),
      })),
    };
  }

  // ── 7. 通知 ────────────────────────────────────────────

  /**
   * 通知负责人（`notify-assignees`）。
   *
   * ⚠️ 数据层现状（诚实登记）：仓库**没有 notifications 表**，而 `task_events.task_id`
   * 有 FK 指向 `tasks`（生成任务表），影视版行 id 写进去必然违反外键。因此本期通知走
   * **广播面**（`FilmRealtimeService`，接上 WS 网关即真投递）+ 返回被通知用户清单；
   * 离线站内消息需要一张 `notifications` 表，已写进回报「需要 Lead 做」。
   * 不新造队列（对齐 Lead 指示）。
   */
  async notifyAssignees(params: {
    table: FilmTableRow;
    task: FilmTaskRow;
    userId: string;
    opUserIds?: string[];
  }) {
    const targets = new Set<string>();
    if (params.task.assigneeUserId) targets.add(String(params.task.assigneeUserId));
    const fieldRows = await this.fields.requireFields(String(params.table.spaceId), String(params.table.id));
    const assigneeField = fieldRows.find((f) => f.key === "assignees");
    if (assigneeField) {
      const [cell] = (await db
        .select({ value: filmCells.valueJson })
        .from(filmCells)
        .where(and(eq(filmCells.taskId, params.task.id), eq(filmCells.fieldId, assigneeField.id)))
        .limit(1)) as Array<{ value: unknown }>;
      const v = cell?.value;
      if (typeof v === "string") targets.add(v);
      if (Array.isArray(v)) for (const item of v) if (typeof item === "string") targets.add(item);
    }
    for (const id of params.opUserIds ?? []) targets.add(id);
    targets.delete(params.userId); // 不通知自己

    const ids = [...targets];
    if (ids.length > 0) {
      // 只有本 space 成员才可被通知，否则就是跨租户骚扰面
      const members = (await db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(
          and(eq(spaceMembers.spaceId, params.table.spaceId), inArray(spaceMembers.userId, ids.map((v) => BigInt(v)))),
        )) as Array<{ userId: bigint }>;
      const allowed = new Set(members.map((m) => String(m.userId)));
      const blocked = ids.filter((id) => !allowed.has(id));
      if (blocked.length > 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "some target users are not members of this space", {
          field: "op_user_ids",
          reason: "not_member",
          user_ids: blocked,
        });
      }
    }
    const event = this.realtime.broadcast({
      spaceId: String(params.table.spaceId),
      projectId: String(params.table.projectId),
      tableId: String(params.table.id),
      type: "task.notified",
      payload: { task_id: String(params.task.id), user_ids: ids },
      originUserId: params.userId,
    });
    return { ok: true, notified: ids.length, user_ids: ids, channel: event.channel, seq: event.seq };
  }

  /** `points_ro` 的只读聚合（契约 A14）：结算链路未接时返回 null，不返回假 0 */
  async pointsOf(spaceId: string, taskId: string): Promise<number | null> {
    // 预留：接上画布结算后改为「该行绑定画布下的 settle 流水之和」。
    // 现在返回 null 表示"未结算"，比返回 0 诚实（api-spec：不得静默返回假 0）
    void spaceId;
    void taskId;
    void creditFlows;
    return null;
  }
}
