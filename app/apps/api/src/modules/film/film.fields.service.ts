import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { filmCells, filmFields, type Tx } from "@app/db";
import { AppError, ErrorCode, FILM_LIMITS, newId, type FilmFieldPatchRequest, type FilmFieldCreateRequest } from "@app/shared";
import { db } from "../../db/database";
import type { FilmTableRow } from "./film.access";
import { FilmAccessService } from "./film.access";
import { FilmRealtimeService } from "./film.realtime";
import type { FilmFieldLike } from "./film.fields";

/** 字段服务在事务内/外都要用到的 DB client 最小面（tx 与 db 都满足） */
export type FilmDbClient = Pick<typeof db, "insert" | "select" | "update" | "delete">;

/**
 * film 字段（列）服务 —— 契约 §3.5 的 6 个端点（fields CRUD + reorder + batch-restore）。
 *
 * 三条容易做错的语义，逐条写死在这里：
 *
 * 1. **`is_unique_type` 是"该 field_type 每表至多一个"，不是值唯一**
 *    （schema.ts film_fields 注释 + 契约 §7 A1，竞品 bundle `_e(t,e)` 实证）。
 *    所以校验是"扫本表是否已有同 type 且 is_unique_type=1 的字段"，与 cell 值无关。
 * 2. **系统字段不可删、field_type 不可改**。系统字段是 6 个固定 key
 *    （title/assignees/produce/task_status/review/points），它们承载行状态镜像与审核/积分只读列。
 * 3. **删除是软删**（`deleted_at`）：`batch-restore` 要能把列连值一起恢复，物理删会连带丢
 *    film_cells；且回收站的 key 必须继续占位，否则恢复时会出现两条同 key 列、单元格归属二义。
 */

export interface FilmFieldRow {
  id: bigint;
  tableId: bigint;
  spaceId: bigint;
  key: string;
  name: string;
  fieldType: string;
  isSystem: boolean;
  isUniqueType: boolean;
  sort: number;
  configJson: unknown;
  hidden: boolean;
  width: number | null;
  deletedAt: Date | null;
}

/** 6 个系统字段（竞品实证；宽度取该类型的合理默认，用户可改） */
export const SYSTEM_FIELD_DEFS = [
  { key: "title", name: "标题", fieldType: "text", width: 280 },
  { key: "assignees", name: "负责人", fieldType: "user", width: 160 },
  { key: "produce", name: "产物画布", fieldType: "canvas_ref", width: 200 },
  { key: "task_status", name: "任务状态", fieldType: "task_status", width: 120 },
  { key: "review", name: "审核", fieldType: "review_ref", width: 160 },
  { key: "points", name: "积分消耗", fieldType: "points_ro", width: 110 },
] as const;

const FIELD_KEY_MAX = FILM_LIMITS.FIELD_KEY_MAX;

/**
 * 由显示名派生稳定 key（对照竞品：key 是"稳定键"，改名不换 key）。
 *
 * 中文名 slug 后为空时退化为 `field_<n>`：key 只做前端筛选/导出的列标识，
 * 不做展示，因此不需要"好看"，但**必须唯一且稳定**（unique(table_id,key)）。
 */
export function slugifyFieldKey(name: string, fallbackSeq: number): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = ascii.length > 0 ? ascii : `field_${fallbackSeq}`;
  return base.slice(0, FIELD_KEY_MAX);
}

@Injectable()
export class FilmFieldsService {
  constructor(
    @Inject(FilmAccessService) private readonly access: FilmAccessService,
    @Inject(FilmRealtimeService) private readonly realtime: FilmRealtimeService,
  ) {}

  toView(row: FilmFieldRow) {
    return {
      id: String(row.id),
      table_id: String(row.tableId),
      key: row.key,
      name: row.name,
      field_type: row.fieldType,
      is_system: row.isSystem,
      is_unique_type: row.isUniqueType,
      sort: row.sort,
      config_json: (row.configJson ?? {}) as Record<string, unknown>,
      hidden: row.hidden,
      width: row.width ?? null,
    };
  }

  /** 列表（默认排除回收站；`include_deleted` 仅供前端"已删除字段"面板使用） */
  async list(spaceId: string, tableId: string, opts: { includeDeleted?: boolean } = {}) {
    const conds = [eq(filmFields.tableId, BigInt(tableId)), eq(filmFields.spaceId, BigInt(spaceId))];
    if (!opts.includeDeleted) conds.push(isNull(filmFields.deletedAt));
    const rows = (await db
      .select()
      .from(filmFields)
      .where(and(...conds))
      .orderBy(filmFields.sort, filmFields.createdAt)) as FilmFieldRow[];
    return { list: rows.map((r) => this.toView(r)) };
  }

  /** 供单元格/查询/导出复用的"按 id 取字段定义"（同时做归属校验） */
  async requireFields(spaceId: string, tableId: string): Promise<FilmFieldRow[]> {
    const rows = (await db
      .select()
      .from(filmFields)
      .where(
        and(
          eq(filmFields.tableId, BigInt(tableId)),
          eq(filmFields.spaceId, BigInt(spaceId)),
          isNull(filmFields.deletedAt),
        ),
      )
      .orderBy(filmFields.sort, filmFields.createdAt)) as FilmFieldRow[];
    return rows;
  }

  async requireField(spaceId: string, tableId: string, fieldId: string): Promise<FilmFieldRow> {
    const [row] = (await db
      .select()
      .from(filmFields)
      .where(
        and(
          eq(filmFields.id, BigInt(fieldId)),
          eq(filmFields.tableId, BigInt(tableId)),
          eq(filmFields.spaceId, BigInt(spaceId)),
        ),
      )
      .limit(1)) as FilmFieldRow[];
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "field not found");
    return row;
  }

  static asLike(field: FilmFieldRow): FilmFieldLike {
    return {
      id: field.id,
      key: field.key,
      fieldType: field.fieldType,
      configJson: field.configJson,
      isSystem: field.isSystem,
    };
  }

  /**
   * 新建表后立即补齐 6 个系统字段（幂等：on conflict do nothing）。
   *
   * ⚠️ 必须传**同一个事务的 client**：`film_fields.table_id` 有 FK 指向 `film_tables`，
   * 而父行在事务里还没提交——用全局 `db` 插入会因"父行不可见"直接违反外键
   * （错误信息是 `film_fields_table_id_film_tables_id_fk`，不看这里很容易以为是 schema 问题）。
   */
  async ensureSystemFields(table: FilmTableRow, client: FilmDbClient = db): Promise<void> {
    const values = SYSTEM_FIELD_DEFS.map((def, idx) => ({
      id: newId(),
      tableId: table.id,
      spaceId: table.spaceId,
      key: def.key,
      name: def.name,
      fieldType: def.fieldType,
      isSystem: true,
      // 系统列各自独占一种类型，天然满足"该 type 每表至多一个"
      isUniqueType: true,
      sort: idx,
      configJson: {},
      hidden: false,
      width: def.width,
    }));
    await client.insert(filmFields).values(values).onConflictDoNothing();
  }

  /** 6 个系统字段里当前表缺哪些（presets/import 复用） */
  async missingSystemKeys(table: FilmTableRow): Promise<string[]> {
    const rows = (await db
      .select({ key: filmFields.key })
      .from(filmFields)
      .where(and(eq(filmFields.tableId, table.id), isNull(filmFields.deletedAt)))) as Array<{ key: string }>;
    const have = new Set(rows.map((r) => r.key));
    return SYSTEM_FIELD_DEFS.filter((d) => !have.has(d.key)).map((d) => d.key);
  }

  /**
   * 在事务里补一条 title 单元格（导入/批量建行用）。
   *
   * 为什么需要：`film_tasks.title` 只是冗余快照，真值在 `field.key='title'` 的单元格里。
   * 只写冗余列而不写单元格，会让"表格里标题一列是空的、列表/搜索却有值"——两个视图打架。
   */
  async writeTitleCell(
    tx: Tx,
    tableId: bigint,
    spaceId: bigint,
    taskId: bigint,
    title: string,
    userId: string,
  ): Promise<void> {
    const [titleField] = (await tx
      .select({ id: filmFields.id })
      .from(filmFields)
      .where(and(eq(filmFields.tableId, tableId), eq(filmFields.key, "title"), isNull(filmFields.deletedAt)))
      .limit(1)) as Array<{ id: bigint }>;
    if (!titleField) return;
    await tx
      .insert(filmCells)
      .values({
        id: newId(),
        taskId,
        fieldId: titleField.id,
        spaceId,
        valueJson: title,
        updatedBy: BigInt(userId),
      })
      .onConflictDoUpdate({
        target: [filmCells.taskId, filmCells.fieldId],
        set: { valueJson: title, updatedBy: BigInt(userId), updatedAt: new Date() },
      });
  }

  // ── 1. 新建字段 ─────────────────────────────────────────

  async create(table: FilmTableRow, input: FilmFieldCreateRequest) {
    const existing = (await db
      .select()
      .from(filmFields)
      .where(and(eq(filmFields.tableId, table.id), isNull(filmFields.deletedAt)))) as FilmFieldRow[];
    if (existing.length >= FILM_LIMITS.FIELD_MAX) {
      throw new AppError(ErrorCode.INVALID_PARAM, `table already has ${FILM_LIMITS.FIELD_MAX} fields`, {
        field: "name",
        reason: "field_limit",
      });
    }
    if (input.is_unique_type) {
      // 语义 = 「该 field_type 每表至多一个」，**不是值唯一**（见文件头注释）
      const conflict = existing.find((f) => f.fieldType === input.field_type && f.isUniqueType);
      if (conflict) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `table already has a unique ${input.field_type} field: ${conflict.name}`,
          { field: "is_unique_type", reason: "unique_type_conflict", conflict_field_id: String(conflict.id) },
        );
      }
    }
    // key 必须连回收站一起唯一（软删字段仍占 key），故取全表 key
    const allKeys = (await db
      .select({ key: filmFields.key })
      .from(filmFields)
      .where(eq(filmFields.tableId, table.id))) as Array<{ key: string }>;
    const used = new Set(allKeys.map((r) => r.key));
    let key = slugifyFieldKey(input.name, existing.length + 1);
    let n = 2;
    while (used.has(key)) {
      key = `${slugifyFieldKey(input.name, existing.length + 1).slice(0, FIELD_KEY_MAX - 4)}_${n}`;
      n += 1;
    }
    const maxSort = existing.reduce((m, f) => Math.max(m, f.sort), -1);
    const [row] = (await db
      .insert(filmFields)
      .values({
        id: newId(),
        tableId: table.id,
        spaceId: table.spaceId,
        key,
        name: input.name,
        fieldType: input.field_type,
        isSystem: false,
        isUniqueType: input.is_unique_type,
        sort: input.sort ?? maxSort + 1,
        configJson: input.config_json ?? {},
        hidden: false,
        width: input.width ?? null,
      })
      .returning()) as FilmFieldRow[];
    return this.toView(row);
  }

  // ── 2. 更新字段 ─────────────────────────────────────────

  async patch(spaceId: string, table: FilmTableRow, fieldId: string, input: FilmFieldPatchRequest) {
    const field = await this.requireField(spaceId, String(table.id), fieldId);
    if (field.deletedAt) throw new AppError(ErrorCode.NOT_FOUND, "field not found");

    const changingType = input.field_type !== undefined && input.field_type !== field.fieldType;
    if (changingType && field.isSystem) {
      throw new AppError(ErrorCode.INVALID_PARAM, "system field type cannot be changed", {
        field: "field_type",
        reason: "system_field",
      });
    }
    if (changingType) {
      // 改类型会让已有单元格语义失效（date→number 后旧值就是垃圾）。
      // 不做"自动清洗"是故意的：静默丢数据比报错更难排查。
      const [{ n }] = (await db
        .select({ n: sql<number>`count(*)::int` })
        .from(filmCells)
        .where(eq(filmCells.fieldId, field.id))) as Array<{ n: number }>;
      if (n > 0 && !input.confirm_clear) {
        throw new AppError(ErrorCode.INVALID_PARAM, `field has ${n} cells; pass confirm_clear to convert`, {
          field: "confirm_clear",
          reason: "cells_exist",
          cells: n,
        });
      }
      if (n > 0 && input.confirm_clear) {
        await db.delete(filmCells).where(eq(filmCells.fieldId, field.id));
      }
    }
    if (input.is_unique_type === true && !field.isUniqueType) {
      const [conflict] = (await db
        .select()
        .from(filmFields)
        .where(
          and(
            eq(filmFields.tableId, table.id),
            eq(filmFields.fieldType, input.field_type ?? field.fieldType),
            eq(filmFields.isUniqueType, true),
            isNull(filmFields.deletedAt),
          ),
        )
        .limit(1)) as FilmFieldRow[];
      if (conflict && conflict.id !== field.id) {
        throw new AppError(ErrorCode.INVALID_PARAM, `table already has a unique ${conflict.fieldType} field`, {
          field: "is_unique_type",
          reason: "unique_type_conflict",
          conflict_field_id: String(conflict.id),
        });
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.field_type !== undefined) patch.fieldType = input.field_type;
    if (input.is_unique_type !== undefined) patch.isUniqueType = input.is_unique_type;
    if (input.sort !== undefined) patch.sort = input.sort;
    if (input.config_json !== undefined) patch.configJson = input.config_json;
    if (input.hidden !== undefined) patch.hidden = input.hidden;
    if (input.width !== undefined) patch.width = input.width;
    const [row] = (await db.update(filmFields).set(patch).where(eq(filmFields.id, field.id)).returning()) as FilmFieldRow[];
    this.realtime.broadcast({
      spaceId,
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "field.updated",
      payload: { field_id: String(field.id) },
      originUserId: "",
    });
    return this.toView(row);
  }

  // ── 3. 删除字段（软删）─────────────────────────────────

  async remove(table: FilmTableRow, fieldId: string, originUserId: string) {
    const field = await this.requireField(String(table.spaceId), String(table.id), fieldId);
    if (field.isSystem) {
      throw new AppError(ErrorCode.INVALID_PARAM, "system field cannot be deleted", {
        field: "field_id",
        reason: "system_field",
      });
    }
    if (field.deletedAt) return { ok: true, already_deleted: true };
    await db.update(filmFields).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(filmFields.id, field.id));
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "field.deleted",
      payload: { field_id: String(field.id) },
      originUserId,
    });
    return { ok: true, already_deleted: false };
  }

  // ── 4. 排序 ─────────────────────────────────────────────

  async reorder(table: FilmTableRow, fieldIds: string[], originUserId: string) {
    const rows = (await db
      .select({ id: filmFields.id })
      .from(filmFields)
      .where(and(eq(filmFields.tableId, table.id), inArray(filmFields.id, fieldIds.map((v) => BigInt(v)))))) as Array<{
      id: bigint;
    }>;
    if (rows.length !== fieldIds.length) {
      throw new AppError(ErrorCode.INVALID_PARAM, "some field_ids do not belong to this table", {
        field: "field_ids",
        reason: "foreign_id",
      });
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < fieldIds.length; i += 1) {
        await tx
          .update(filmFields)
          .set({ sort: i, updatedAt: new Date() })
          .where(eq(filmFields.id, BigInt(fieldIds[i])));
      }
    });
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "field.reordered",
      payload: { field_ids: fieldIds },
      originUserId,
    });
    return { ok: true };
  }

  // ── 5. 批量恢复（回收站）───────────────────────────────

  async batchRestore(table: FilmTableRow, fieldIds: string[], originUserId: string) {
    const rows = (await db
      .select({ id: filmFields.id, deletedAt: filmFields.deletedAt })
      .from(filmFields)
      .where(and(eq(filmFields.tableId, table.id), inArray(filmFields.id, fieldIds.map((v) => BigInt(v)))))) as Array<{
      id: bigint;
      deletedAt: Date | null;
    }>;
    if (rows.length !== fieldIds.length) {
      throw new AppError(ErrorCode.INVALID_PARAM, "some field_ids do not belong to this table", {
        field: "field_ids",
        reason: "foreign_id",
      });
    }
    const restorable = rows.filter((r) => r.deletedAt !== null).map((r) => r.id);
    if (restorable.length > 0) {
      await db
        .update(filmFields)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(inArray(filmFields.id, restorable));
    }
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "field.restored",
      payload: { field_ids: restorable.map((v) => String(v)) },
      originUserId,
    });
    return { restored_field_ids: restorable.map((v) => String(v)) };
  }
}
