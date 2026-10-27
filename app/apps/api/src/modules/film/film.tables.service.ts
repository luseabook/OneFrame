import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  filmCanvasBindings,
  filmCells,
  filmFields,
  filmRecentOpens,
  filmReviewComments,
  filmReviewReads,
  filmReviewVersions,
  filmTablePrefs,
  filmTables,
  filmTaskTemplates,
  filmTasks,
} from "@app/db";
import {
  AppError,
  ErrorCode,
  FILM_LIMITS,
  newId,
  type FilmFieldCreateRequest,
  type FilmTableCreateRequest,
  type FilmTableImportRequest,
  type FilmTablePatchRequest,
  type FilmTablePrefPutRequest,
} from "@app/shared";
import { db } from "../../db/database";
import type { FilmTableRow } from "./film.access";
import { FilmAccessService } from "./film.access";
import { FilmFieldsService, SYSTEM_FIELD_DEFS } from "./film.fields.service";
import { FilmRealtimeService } from "./film.realtime";

/**
 * film 任务表 / 视图偏好 / 模板服务。
 *
 * 覆盖契约 §3.5 的「任务表本体 8」（含 ensure-presets / import / apply-template / reorder）、
 * 「表视图偏好 2」、「任务模板 3」。
 *
 * 表与字段的关系是"表是容器，字段是列，字段随表一起创建"：
 * 新表必须先有 6 个系统字段（title/assignees/produce/task_status/review/points），
 * 否则建行时无法写 title 单元格、也无法镜像行状态。所以 `create()` 与 `ensurePresets()`
 * 都在同一事务里调 `FilmFieldsService.ensureSystemFields()`。
 */

/** 预置表定义（对照竞品 `ensure-presets`；字段集为我方保守取值，见回报「待取证」） */
interface PresetFieldDef {
  name: string;
  fieldType: string;
  width?: number;
  config?: Record<string, unknown>;
}
interface PresetTableDef {
  name: string;
  fields: PresetFieldDef[];
}

const PRESET_TABLES: PresetTableDef[] = [
  {
    name: "分镜任务表",
    fields: [],
  },
  {
    // 第二张预置表刻意用齐 5 种用户类型，让新团队一开通就能看到"类型怎么用"，
    // 也顺带覆盖导出/滤镜对多类型的处理（纯系统字段表演示不了这些）
    name: "资产需求表",
    fields: [
      { name: "资产名称", fieldType: "text", width: 200 },
      { name: "资产类型", fieldType: "select", width: 140, config: { options: [
        { id: "character", name: "角色" },
        { id: "scene", name: "场景" },
        { id: "prop", name: "道具" },
      ] } },
      { name: "数量", fieldType: "number", width: 90, config: { precision: 0, min: 0 } },
      { name: "交付日期", fieldType: "date", width: 130 },
      { name: "参考链接", fieldType: "link", width: 220 },
      { name: "成品资产", fieldType: "asset_ref", width: 180 },
    ],
  },
] as const;

@Injectable()
export class FilmTablesService {
  constructor(
    @Inject(FilmAccessService) private readonly access: FilmAccessService,
    @Inject(FilmFieldsService) private readonly fields: FilmFieldsService,
    @Inject(FilmRealtimeService) private readonly realtime: FilmRealtimeService,
  ) {}

  toView(row: FilmTableRow) {
    return {
      id: String(row.id),
      space_id: String(row.spaceId),
      project_id: String(row.projectId),
      name: row.name,
      is_preset: row.isPreset,
      sort: row.sort,
      version: row.version,
    };
  }

  // ── 1. 列表 ─────────────────────────────────────────────

  /**
   * 项目下的表列表。
   *
   * 排序：`sort` 升序，预置表永远在最前（预置表是"骨架"，被用户拖到中间会让新成员找不到入口）。
   */
  async list(spaceId: string, projectId: string) {
    const rows = (await db
      .select()
      .from(filmTables)
      .where(and(eq(filmTables.spaceId, BigInt(spaceId)), eq(filmTables.projectId, BigInt(projectId))))
      .orderBy(desc(filmTables.isPreset), asc(filmTables.sort), asc(filmTables.createdAt))) as FilmTableRow[];
    return { list: rows.map((r) => this.toView(r)) };
  }

  /**
   * 项目列表（我方扩展：竞品 film 项目本体端点未观测，见契约 §7 A2）。
   *
   * 因为 `film_projects` 表尚未建（Lead 0020 只补了四张二等表），项目在本期是
   * "任务表的容器"：它的存在性与标题都从其表反推。所以这里的 title 取"最早建的表名"，
   * 这样前端新建项目时把项目名当第一张表名传入，列表页就自然显示项目名。
   */
  async listProjects(spaceId: string, userId: string) {
    const rows = (await db
      .select({
        projectId: filmTables.projectId,
        tableCount: sql<number>`count(*)::int`,
        // 项目标题取"最早创建的那张表的名字"（新建项目时把项目名当第一张表名传入）。
        // 不能用 min(name)：那是字典序，会把 presets 的「分镜任务表」当成项目名。
        firstTableName: sql<string>`(array_agg(${filmTables.name} order by ${filmTables.createdAt} asc))[1]`,
        updatedAt: sql<string>`max(${filmTables.updatedAt})::text`,
      })
      .from(filmTables)
      .where(eq(filmTables.spaceId, BigInt(spaceId)))
      .groupBy(filmTables.projectId)
      .orderBy(desc(sql`max(${filmTables.updatedAt})`))) as Array<{
      projectId: bigint;
      tableCount: number;
      firstTableName: string;
      updatedAt: string;
    }>;

    // 任务总数一次聚合（避免 N+1：项目数 × 表数 会把列表页打成全表扫描）
    const taskAgg = (await db
      .select({ projectId: filmTables.projectId, n: sql<number>`count(${filmTasks.id})::int` })
      .from(filmTables)
      .leftJoin(filmTasks, and(eq(filmTasks.tableId, filmTables.id), isNull(filmTasks.deletedAt)))
      .where(eq(filmTables.spaceId, BigInt(spaceId)))
      .groupBy(filmTables.projectId)) as Array<{ projectId: bigint; n: number }>;
    const taskMap = new Map(taskAgg.map((r) => [String(r.projectId), Number(r.n ?? 0)]));
    const recent = await this.lastOpened(spaceId, userId);
    const recentList = await this.listRecentOpens(spaceId, userId);

    return {
      list: rows.map((r) => ({
        project_id: String(r.projectId),
        title: r.firstTableName,
        table_count: Number(r.tableCount ?? 0),
        task_count: taskMap.get(String(r.projectId)) ?? 0,
        updated_at: r.updatedAt,
        last_opened_at: recent.get(String(r.projectId)) ?? null,
      })),
      // 列表页首屏的"最近打开"直接随项目列表一起返回，避免前端为了拿最近项目
      // 去请求一个不存在的项目作用域端点（recent-open 是 project 级路径）
      recent: recentList.list,
    };
  }

  // ── 2. 创建 ─────────────────────────────────────────────

  async create(spaceId: string, projectId: string, input: FilmTableCreateRequest) {
    await this.access.assertProjectScope(spaceId, projectId);
    const [maxRow] = (await db
      .select({ m: sql<number>`coalesce(max(${filmTables.sort}), -1)::int` })
      .from(filmTables)
      .where(and(eq(filmTables.spaceId, BigInt(spaceId)), eq(filmTables.projectId, BigInt(projectId)))) as Array<{
      m: number;
    }>);
    const id = newId();
    const row = await db.transaction(async (tx) => {
      const [inserted] = (await tx
        .insert(filmTables)
        .values({
          id,
          spaceId: BigInt(spaceId),
          projectId: BigInt(projectId),
          name: input.name,
          // 外部建表**不接受** is_preset（只有 ensure-presets 能造预置表）：
          // 允许客户端置位会让"预置表不可删"的约束被绕过
          isPreset: false,
          sort: input.sort ?? Number(maxRow?.m ?? -1) + 1,
          version: 0,
        })
        .returning()) as FilmTableRow[];
      await this.fields.ensureSystemFields(inserted, tx);
      return inserted;
    });
    return this.toView(row);
  }

  // ── 3. 更新（表级乐观锁）───────────────────────────────

  async patch(spaceId: string, tableId: string, input: FilmTablePatchRequest, originUserId: string) {
    const table = await this.access.requireTable(spaceId, tableId);
    if (input.version !== undefined && input.version !== table.version) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, "table version conflict", {
        expected: input.version,
        current: table.version,
      });
    }
    const patch: Record<string, unknown> = { version: sql`${filmTables.version} + 1`, updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.sort !== undefined) patch.sort = input.sort;
    const [row] = (await db.update(filmTables).set(patch).where(eq(filmTables.id, table.id)).returning()) as FilmTableRow[];
    this.realtime.broadcast({
      spaceId,
      projectId: String(table.projectId),
      tableId,
      type: "table.updated",
      payload: { name: row.name, version: row.version },
      originUserId,
    });
    return this.toView(row);
  }

  // ── 4. 删除 ─────────────────────────────────────────────

  /**
   * 物理删除任务表（`film_tables` 没有 deleted_at，契约里也只有 DELETE 没有恢复）。
   *
   * 必须按 FK 依赖顺序级联清子表：Postgres 的 FK 是 `no action`，直接删主表会报外键错。
   * 顺序：审核已读 → 审核评论 → 审核版本 → 画布绑定 → 单元格 → 行 → 偏好 → 最近打开 → 字段 → 表。
   * 预置表不可删（`is_preset`），否则 ensure-presets 的幂等语义会被用户手动破坏。
   */
  async remove(spaceId: string, tableId: string, originUserId: string) {
    const table = await this.access.requireTable(spaceId, tableId);
    if (table.isPreset) {
      throw new AppError(ErrorCode.INVALID_PARAM, "preset table cannot be deleted", {
        field: "table_id",
        reason: "preset_table",
      });
    }
    const taskIds = (await db
      .select({ id: filmTasks.id })
      .from(filmTasks)
      .where(eq(filmTasks.tableId, table.id))) as Array<{ id: bigint }>;
    const ids = taskIds.map((r) => r.id);
    if (ids.length > 0) {
      const versionIds = (await db
        .select({ id: filmReviewVersions.id })
        .from(filmReviewVersions)
        .where(inArray(filmReviewVersions.taskId, ids))) as Array<{ id: bigint }>;
      const vids = versionIds.map((r) => r.id);
      await db.transaction(async (tx) => {
        if (vids.length > 0) {
          await tx.delete(filmReviewReads).where(inArray(filmReviewReads.versionId, vids));
          await tx.delete(filmReviewComments).where(inArray(filmReviewComments.versionId, vids));
          await tx.delete(filmReviewVersions).where(inArray(filmReviewVersions.id, vids));
        }
        await tx.delete(filmCanvasBindings).where(inArray(filmCanvasBindings.taskId, ids));
        await tx.delete(filmCells).where(inArray(filmCells.taskId, ids));
        await tx.delete(filmTasks).where(inArray(filmTasks.id, ids));
      });
    }
    await db.transaction(async (tx) => {
      await tx.delete(filmTablePrefs).where(eq(filmTablePrefs.tableId, table.id));
      await tx.delete(filmRecentOpens).where(eq(filmRecentOpens.tableId, table.id));
      await tx.delete(filmFields).where(eq(filmFields.tableId, table.id));
      await tx.delete(filmTables).where(eq(filmTables.id, table.id));
    });
    this.realtime.broadcast({
      spaceId,
      projectId: String(table.projectId),
      tableId,
      type: "table.deleted",
      payload: { table_id: tableId },
      originUserId,
    });
    return { ok: true };
  }

  // ── 5. 排序 ─────────────────────────────────────────────

  async reorder(spaceId: string, projectId: string, tableIds: string[], originUserId: string) {
    const rows = (await db
      .select({ id: filmTables.id })
      .from(filmTables)
      .where(
        and(
          eq(filmTables.spaceId, BigInt(spaceId)),
          eq(filmTables.projectId, BigInt(projectId)),
          inArray(filmTables.id, tableIds.map((v) => BigInt(v))),
        ),
      )) as Array<{ id: bigint }>;
    if (rows.length !== tableIds.length) {
      throw new AppError(ErrorCode.INVALID_PARAM, "some table_ids do not belong to this project", {
        field: "table_ids",
        reason: "foreign_id",
      });
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < tableIds.length; i += 1) {
        await tx
          .update(filmTables)
          .set({ sort: i, updatedAt: new Date() })
          .where(eq(filmTables.id, BigInt(tableIds[i])));
      }
    });
    this.realtime.broadcast({
      spaceId,
      projectId,
      tableId: tableIds[0] ?? "",
      type: "table.reordered",
      payload: { table_ids: tableIds },
      originUserId,
    });
    return { ok: true };
  }

  // ── 6. 预置表（幂等）───────────────────────────────────

  /**
   * `ensure-presets`：给项目补齐预置任务表。
   *
   * 幂等键是 **(project_id, name, is_preset)**：重复调用只补缺的，不重复建。
   * 这样前端可以在每次打开项目时无脑调一次，不需要自己记状态。
   */
  async ensurePresets(spaceId: string, projectId: string, originUserId: string) {
    await this.access.assertProjectScope(spaceId, projectId);
    const existing = (await db
      .select({ name: filmTables.name, isPreset: filmTables.isPreset })
      .from(filmTables)
      .where(and(eq(filmTables.spaceId, BigInt(spaceId)), eq(filmTables.projectId, BigInt(projectId))))) as Array<{
      name: string;
      isPreset: boolean;
    }>;
    const existingNames = new Set(existing.filter((e) => e.isPreset).map((e) => e.name));
    const created: string[] = [];
    const ids: string[] = [];
    for (const preset of PRESET_TABLES) {
      const [already] = (await db
        .select({ id: filmTables.id })
        .from(filmTables)
        .where(
          and(
            eq(filmTables.spaceId, BigInt(spaceId)),
            eq(filmTables.projectId, BigInt(projectId)),
            eq(filmTables.name, preset.name),
            eq(filmTables.isPreset, true),
          ),
        )
        .limit(1)) as Array<{ id: bigint }>;
      if (already) {
        ids.push(String(already.id));
        continue;
      }
      const id = newId();
      await db.transaction(async (tx) => {
        const [inserted] = (await tx
          .insert(filmTables)
          .values({
            id,
            spaceId: BigInt(spaceId),
            projectId: BigInt(projectId),
            name: preset.name,
            isPreset: true,
            sort: existing.length + created.length,
            version: 0,
          })
          .returning()) as FilmTableRow[];
        await this.fields.ensureSystemFields(inserted, tx);
        if (preset.fields.length > 0) {
          await tx.insert(filmFields).values(
            preset.fields.map((f, idx) => ({
              id: newId(),
              tableId: id,
              spaceId: BigInt(spaceId),
              key: `p_${idx + 1}_${f.fieldType}`,
              name: f.name,
              fieldType: f.fieldType,
              isSystem: false,
              isUniqueType: false,
              sort: SYSTEM_FIELD_DEFS.length + idx,
              configJson: f.config ?? {},
              hidden: false,
              width: f.width ?? null,
            })),
          );
        }
      });
      created.push(preset.name);
      ids.push(String(id));
    }
    this.realtime.broadcast({
      spaceId,
      projectId,
      tableId: ids[0] ?? "",
      type: "table.presets_ensured",
      payload: { created, table_ids: ids },
      originUserId,
    });
    return { ok: true, created, table_ids: ids, existing_names: [...existingNames] };
  }

  // ── 7. 导入 ─────────────────────────────────────────────

  /**
   * 从表格数据导入成新任务表（同步实现，非竞品的 job 异步形态 —— 见回报「待取证 A11」）。
   *
   * 契约里竞品响应是 `{job_id,status,table_ids}`；我方本期是同步建表（上限 200 行），
   * 因此直接返回建好的 `table_ids`，同时保留 `job_id` 字段以兼容前端既有分支（值为导出 id）。
   * 转换策略：按表头文本**尽力**转换为目标类型，转不了的留空（稀疏表允许空单元格），
   * 绝不为了"看起来完整"塞垃圾值。
   */
  async importTable(spaceId: string, projectId: string, userId: string, input: FilmTableImportRequest) {
    await this.access.assertProjectScope(spaceId, projectId);
    if (input.rows.length > FILM_LIMITS.BATCH_MAX) {
      throw new AppError(ErrorCode.INVALID_PARAM, `import rows must be <= ${FILM_LIMITS.BATCH_MAX}`, {
        field: "rows",
        reason: "too_many_rows",
      });
    }
    const headers = new Set<string>();
    for (const row of input.rows) for (const k of Object.keys(row)) headers.add(k);
    const headerList = [...headers];
    if (headerList.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "import rows are empty", { field: "rows" });
    }
    if (headerList.length > FILM_LIMITS.FIELD_MAX) {
      throw new AppError(ErrorCode.INVALID_PARAM, `too many columns (${headerList.length})`, {
        field: "field_types",
        reason: "field_limit",
      });
    }
    // 「标题/title/名称」这一列不建用户字段：它对应系统字段 title（行冗余列 + title 单元格），
    // 再建一个同名用户字段会让表格里出现两个"标题"，前端无法判断哪个是唯一标题校验用的
    const titleHeader = headerList.find((h) => /^(标题|title|名称|name)$/i.test(h));
    const dataHeaders = headerList.filter((h) => h !== titleHeader);
    const tableId = newId();
    const fieldRows: Array<{ id: bigint; key: string; name: string }> = [];
    await db.transaction(async (tx) => {
      const [inserted] = (await tx
        .insert(filmTables)
        .values({ id: tableId, spaceId: BigInt(spaceId), projectId: BigInt(projectId), name: input.name, isPreset: false, sort: 0, version: 0 })
        .returning()) as FilmTableRow[];
      await this.fields.ensureSystemFields(inserted, tx);
      for (let i = 0; i < dataHeaders.length; i += 1) {
        const header = dataHeaders[i];
        const fieldId = newId();
        fieldRows.push({ id: fieldId, key: `i_${i + 1}`, name: header.slice(0, FILM_LIMITS.FIELD_NAME_MAX) });
        await tx.insert(filmFields).values({
          id: fieldId,
          tableId,
          spaceId: BigInt(spaceId),
          key: `i_${i + 1}`,
          name: header.slice(0, FILM_LIMITS.FIELD_NAME_MAX),
          fieldType: input.field_types[header] ?? "text",
          isSystem: false,
          isUniqueType: false,
          sort: SYSTEM_FIELD_DEFS.length + i,
          configJson: {},
          hidden: false,
          width: null,
        });
      }
      // 行：每行一个 task，标题列写进 title 冗余列 + title 单元格
      let sort = 0;
      for (const row of input.rows) {
        const taskId = newId();
        const title = titleHeader ? String(row[titleHeader] ?? "") : "";
        await tx.insert(filmTasks).values({
          id: taskId,
          tableId,
          spaceId: BigInt(spaceId),
          parentId: null,
          sort,
          version: 1,
          status: 1,
          title: title.slice(0, FILM_LIMITS.TASK_TITLE_MAX),
          reviewVersionNo: 0,
          assigneeUserId: null,
          createdBy: BigInt(userId),
        });
        if (title.length > 0) await this.fields.writeTitleCell(tx, tableId, BigInt(spaceId), taskId, title, userId);
        for (const f of fieldRows) {
          const raw = row[f.name];
          if (raw === undefined || raw === "") continue; // 稀疏：空单元格不落行
          const coerced = coerceImportValue(input.field_types[f.name] ?? "text", raw);
          if (coerced === undefined) continue;
          await tx.insert(filmCells).values({
            id: newId(),
            taskId,
            fieldId: f.id,
            spaceId: BigInt(spaceId),
            valueJson: coerced,
            updatedBy: BigInt(userId),
          });
        }
        sort += 1;
      }
    });
    this.realtime.broadcast({
      spaceId,
      projectId,
      tableId: String(tableId),
      type: "table.imported",
      payload: { table_id: String(tableId), rows: input.rows.length },
      originUserId: userId,
    });
    return {
      job_id: String(tableId),
      status: 3,
      table_ids: [String(tableId)],
      rows_imported: input.rows.length,
      fields_created: fieldRows.length,
    };
  }

  // ── 8. 应用模板 ─────────────────────────────────────────

  /**
   * 把模板的 `{fields, tasks}` 快照深拷贝进目标表。
   *
   * 语义是**追加**（契约请求体只有 template_id/name，没有 replace 标志）：
   * 已存在的字段按 key 跳过，行则全部追加。重复点击不会产生重复列（列按 key 幂等），
   * 但会产生重复行 —— 这是"应用两次模板"的合理结果，前端要给出确认提示。
   */
  async applyTemplate(table: FilmTableRow, templateId: string, originUserId: string, rename?: string) {
    const [tpl] = (await db
      .select()
      .from(filmTaskTemplates)
      .where(and(eq(filmTaskTemplates.id, BigInt(templateId)), eq(filmTaskTemplates.spaceId, table.spaceId)))
      .limit(1)) as Array<{ id: bigint; name: string; payload: unknown; ownerId: bigint; scope: number }>;
    if (!tpl) throw new AppError(ErrorCode.NOT_FOUND, "template not found");
    const payload = (tpl.payload ?? {}) as { fields?: unknown; tasks?: unknown };
    const tplFields = Array.isArray(payload.fields) ? payload.fields : [];
    const tplTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    if (tplFields.length === 0 && tplTasks.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "template payload is empty", {
        field: "template_id",
        reason: "empty_payload",
      });
    }
    const existing = await this.fields.requireFields(String(table.spaceId), String(table.id));
    const usedKeys = new Set(existing.map((f) => f.key));
    const fieldsCreated: string[] = [];
    await db.transaction(async (tx) => {
      if (rename) {
        await tx.update(filmTables).set({ name: rename, updatedAt: new Date() }).where(eq(filmTables.id, table.id));
      }
      // 1) 列：按 key 幂等
      let sortBase = existing.reduce((m, f) => Math.max(m, f.sort), -1) + 1;
      for (const raw of tplFields) {
        if (typeof raw !== "object" || raw === null) continue;
        const f = raw as Record<string, unknown>;
        const key = typeof f.key === "string" && f.key.length > 0 ? f.key.slice(0, FILM_LIMITS.FIELD_KEY_MAX) : null;
        if (!key || usedKeys.has(key)) continue;
        const fieldType = typeof f.field_type === "string" ? f.field_type : "text";
        const [row] = (await tx
          .insert(filmFields)
          .values({
            id: newId(),
            tableId: table.id,
            spaceId: table.spaceId,
            key,
            name: typeof f.name === "string" ? f.name.slice(0, FILM_LIMITS.FIELD_NAME_MAX) : key,
            fieldType,
            isSystem: false,
            isUniqueType: false,
            sort: sortBase,
            configJson: (f.config_json ?? {}) as Record<string, unknown>,
            hidden: false,
            width: typeof f.width === "number" ? f.width : null,
          })
          .returning()) as Array<{ id: bigint }>;
        usedKeys.add(key);
        fieldsCreated.push(String(row.id));
        sortBase += 1;
      }
      // 2) 行：全部追加
      for (const raw of tplTasks) {
        if (typeof raw !== "object" || raw === null) continue;
        const t = raw as Record<string, unknown>;
        const taskId = newId();
        await tx.insert(filmTasks).values({
          id: taskId,
          tableId: table.id,
          spaceId: table.spaceId,
          parentId: null,
          sort: Number(t.sort ?? 0),
          version: 1,
          status: 1,
          title: typeof t.title === "string" ? t.title.slice(0, FILM_LIMITS.TASK_TITLE_MAX) : "",
          reviewVersionNo: 0,
          assigneeUserId: null,
          createdBy: BigInt(originUserId),
        });
      }
    });
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "table.template_applied",
      payload: { template_id: templateId, fields_created: fieldsCreated.length },
      originUserId,
    });
    return { table_id: String(table.id), template_id: templateId, fields_created: fieldsCreated.length };
  }

  // ── 9. 视图偏好（per table + user）─────────────────────

  async getPref(spaceId: string, tableId: string, userId: string) {
    const table = await this.access.requireTable(spaceId, tableId);
    const [row] = (await db
      .select()
      .from(filmTablePrefs)
      .where(and(eq(filmTablePrefs.tableId, table.id), eq(filmTablePrefs.userId, BigInt(userId))))
      .limit(1)) as Array<{ hiddenFieldIds: unknown; filterJson: unknown; ui: unknown }>;
    return {
      table_id: String(table.id),
      hidden_field_ids: Array.isArray(row?.hiddenFieldIds) ? row?.hiddenFieldIds : [],
      filter: Array.isArray(row?.filterJson) ? row?.filterJson : [],
      ui: (row?.ui ?? {}) as Record<string, unknown>,
    };
  }

  /** 覆盖写（per table+user 一行）；`ui`/`filter` 原样透传不做语义校验（契约 A10 同口径） */
  async putPref(spaceId: string, tableId: string, userId: string, input: FilmTablePrefPutRequest) {
    const table = await this.access.requireTable(spaceId, tableId);
    const [row] = (await db
      .insert(filmTablePrefs)
      .values({
        id: newId(),
        tableId: table.id,
        spaceId: table.spaceId,
        userId: BigInt(userId),
        hiddenFieldIds: input.hidden_field_ids,
        filterJson: input.filter,
        ui: input.ui,
      })
      .onConflictDoUpdate({
        target: [filmTablePrefs.tableId, filmTablePrefs.userId],
        set: {
          hiddenFieldIds: input.hidden_field_ids,
          filterJson: input.filter,
          ui: input.ui,
          updatedAt: new Date(),
        },
      })
      .returning()) as Array<{ hiddenFieldIds: unknown; filterJson: unknown; ui: unknown }>;
    return {
      table_id: String(table.id),
      hidden_field_ids: Array.isArray(row?.hiddenFieldIds) ? row?.hiddenFieldIds : [],
      filter: Array.isArray(row?.filterJson) ? row?.filterJson : [],
      ui: (row?.ui ?? {}) as Record<string, unknown>,
    };
  }

  // ── 10. 模板 CRUD ──────────────────────────────────────

  async listTemplates(spaceId: string, projectId: string, userId: string, scope?: number) {
    const conds = [eq(filmTaskTemplates.spaceId, BigInt(spaceId)), eq(filmTaskTemplates.projectId, BigInt(projectId))];
    if (scope !== undefined) conds.push(eq(filmTaskTemplates.scope, scope));
    const rows = (await db
      .select()
      .from(filmTaskTemplates)
      .where(and(...conds))
      .orderBy(desc(filmTaskTemplates.createdAt))) as Array<{
      id: bigint;
      name: string;
      scope: number;
      ownerId: bigint;
      payload: unknown;
      createdAt: Date;
    }>;
    // 个人模板只对本人可见，团队模板全 space 可见（scope=1/2 语义）
    const visible = rows.filter((r) => r.scope === 2 || String(r.ownerId) === userId);
    return {
      list: visible.map((r) => ({
        template_id: String(r.id),
        id: String(r.id),
        name: r.name,
        scope: r.scope,
        owner_id: String(r.ownerId),
        payload: r.payload ?? {},
        created_at: r.createdAt.toISOString(),
      })),
    };
  }

  async createTemplate(
    spaceId: string,
    projectId: string,
    userId: string,
    input: { name: string; scope: number; payload: unknown },
  ) {
    await this.access.assertProjectScope(spaceId, projectId);
    const payload = (input.payload ?? {}) as { fields?: unknown; tasks?: unknown };
    if (!Array.isArray(payload.fields) && !Array.isArray(payload.tasks)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "template payload needs fields[] or tasks[]", {
        field: "payload",
        reason: "invalid_payload",
      });
    }
    const [row] = (await db
      .insert(filmTaskTemplates)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        projectId: BigInt(projectId),
        name: input.name,
        scope: input.scope,
        ownerId: BigInt(userId),
        payload: input.payload as Record<string, unknown>,
      })
      .returning()) as Array<{ id: bigint }>;
    return { template_id: String(row.id), id: String(row.id) };
  }

  /** 删除模板：仅本人或管理特权（controller 传 isManager） */
  async removeTemplate(spaceId: string, templateId: string, userId: string, isManager: boolean) {
    const [row] = (await db
      .select()
      .from(filmTaskTemplates)
      .where(and(eq(filmTaskTemplates.id, BigInt(templateId)), eq(filmTaskTemplates.spaceId, BigInt(spaceId))))
      .limit(1)) as Array<{ id: bigint; ownerId: bigint }>;
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "template not found");
    if (String(row.ownerId) !== userId && !isManager) {
      throw new AppError(ErrorCode.FORBIDDEN, "only owner or manager can delete this template", {
        reason: "role_insufficient",
      });
    }
    await db.delete(filmTaskTemplates).where(eq(filmTaskTemplates.id, row.id));
    return { ok: true };
  }

  // ── 11. 最近打开 ────────────────────────────────────────

  private async lastOpened(spaceId: string, userId: string): Promise<Map<string, string>> {
    const rows = (await db
      .select({ projectId: filmRecentOpens.projectId, openedAt: filmRecentOpens.openedAt })
      .from(filmRecentOpens)
      .where(and(eq(filmRecentOpens.spaceId, BigInt(spaceId)), eq(filmRecentOpens.userId, BigInt(userId))))
      .orderBy(desc(filmRecentOpens.openedAt))
      .limit(50)) as Array<{ projectId: bigint; openedAt: Date }>;
    return new Map(rows.map((r) => [String(r.projectId), r.openedAt.toISOString()]));
  }

  async listRecentOpens(spaceId: string, userId: string, limit = 20) {
    const rows = (await db
      .select()
      .from(filmRecentOpens)
      .where(and(eq(filmRecentOpens.spaceId, BigInt(spaceId)), eq(filmRecentOpens.userId, BigInt(userId))))
      .orderBy(desc(filmRecentOpens.openedAt))
      .limit(Math.min(50, Math.max(1, limit)))) as Array<{
      projectId: bigint;
      tableId: bigint | null;
      openedAt: Date;
    }>;
    return {
      list: rows.map((r) => ({
        project_id: String(r.projectId),
        table_id: r.tableId ? String(r.tableId) : null,
        opened_at: r.openedAt.toISOString(),
      })),
    };
  }

  /**
   * 记录"我打开了这个项目/这张表"。
   *
   * 每人每项目一行（唯一键 project_id+user_id）：最近打开是**覆盖**语义，
   * 不是历史流水——历史流水会让这个接口变成一张无限增长的表且没人会去查。
   */
  async markRecentOpen(spaceId: string, projectId: string, userId: string, tableId?: string | null) {
    await this.access.assertProjectScope(spaceId, projectId);
    if (tableId) await this.access.requireTable(spaceId, tableId);
    await db
      .insert(filmRecentOpens)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        projectId: BigInt(projectId),
        userId: BigInt(userId),
        tableId: tableId ? BigInt(tableId) : null,
        openedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [filmRecentOpens.projectId, filmRecentOpens.userId],
        set: { tableId: tableId ? BigInt(tableId) : null, openedAt: new Date(), updatedAt: new Date() },
      });
    return { ok: true };
  }

  /** 供 controller 复用的字段服务取字段入口（避免 controller 直接依赖两个 service 的内部细节） */
  async fieldsOf(spaceId: string, tableId: string) {
    return this.fields.requireFields(spaceId, tableId);
  }

  /** 供 controller 复用：按 id 取字段定义 */
  async fieldOf(spaceId: string, tableId: string, fieldId: string) {
    return this.fields.requireField(spaceId, tableId, fieldId);
  }

  /** 供 controller 复用：建字段（走字段服务，保证 key/唯一类型规则只有一处实现） */
  async createField(table: FilmTableRow, input: FilmFieldCreateRequest) {
    return this.fields.create(table, input);
  }
}

/**
 * 导入时按目标类型尽力转换文本。
 *
 * 返回 `undefined` = 放弃该格（保留稀疏），**不是**写空串：写空串会让
 * `empty` 过滤器失效（有值但为空 vs 没有值，在稀疏表里是两种状态）。
 */
export function coerceImportValue(fieldType: string, raw: string): unknown {
  const text = raw.trim();
  if (fieldType === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }
  if (fieldType === "date") {
    if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(text) && !Number.isNaN(Date.parse(text))) return text;
    return undefined;
  }
  if (fieldType === "user" || fieldType === "canvas_ref" || fieldType === "asset_ref") {
    const parts = text
      .split(/[,;|、\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
    if (parts.length === 0) return undefined;
    return parts.length === 1 ? parts[0] : parts;
  }
  if (fieldType === "multi_select") {
    const parts = text
      .split(/[,;|、]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return parts.length > 0 ? parts : undefined;
  }
  if (fieldType === "link") {
    return /^https?:\/\/\S+$/i.test(text) ? text : undefined;
  }
  // text / select / 未知类型：原样存字符串
  return text;
}
