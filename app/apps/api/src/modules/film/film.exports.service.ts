import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import JSZip from "jszip";
import { filmCells, filmExports, filmFields, filmTables, filmTasks } from "@app/db";
import { AppError, ErrorCode, FILM_LIMITS, newId } from "@app/shared";
import { db } from "../../db/database";
import type { FilmTableRow } from "./film.access";
import { FilmAccessService } from "./film.access";
import { StorageService } from "../../storage/storage.service";
import { buildXlsx } from "./xlsx-writer";

/**
 * 影视版导出 —— 契约 §3.5 的 `exports` GET/POST。
 *
 * ## 格式
 * - `format="xlsx"` → **真 .xlsx**（多表 = 多 worksheet；单表 = 单 worksheet）。
 *   由本模块自带的 `xlsx-writer.ts` 生成（用已有 `jszip` 拼 OOXML，**不引第三方 xlsx 库**）。
 *   竞品也是 xlsx（契约 §7 A12 未取证具体库），此前我方只给 CSV/ZIP 并在 `delivered_format`
 *   里诚实标注"不假装 xlsx"；本轮补齐后 `delivered_format === "xlsx"` 名副其实。
 * - `format="csv"`（或未指定）→ 单表 `.csv`（UTF-8 BOM，Excel 双击不乱码）/ 多表 `.zip`
 *   （每表一个 csv）。这条路径**保持不变**，避免影响已对接的前端。
 *
 * ## 一致性
 * CSV 与 XLSX 共用同一份 `tableToMatrix()` 产物：两种格式的**列序、单元格值、公式注入防护**
 * 必须完全一致，否则同一份数据导出两次内容不同（对账会怀疑系统）。
 *
 * 生成是**同步**的（表量级是几十张、每表上限几千行）：异步 job 需要 worker 侧消费者，
 * 本期不新造队列；表数据过大时按 `EXPORT_ROW_CAP` 截断并在响应里 `truncated:true` 明示，
 * 绝不静默少行。
 */

const EXPORT_ROW_CAP = 5000;
const EXPORT_TTL_DAYS = 7;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (Array.isArray(value)) text = value.map((v) => String(v)).join(", ");
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  // CSV/Excel 公式注入防护：以 = + - @ 开头的值前置单引号（导出文件会被别人用 Excel 打开）
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

@Injectable()
export class FilmExportsService {
  constructor(
    @Inject(FilmAccessService) private readonly access: FilmAccessService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async list(spaceId: string, projectId: string, limit = 20) {
    const rows = (await db
      .select()
      .from(filmExports)
      .where(and(eq(filmExports.spaceId, BigInt(spaceId)), eq(filmExports.projectId, BigInt(projectId))))
      .orderBy(desc(filmExports.createdAt))
      .limit(Math.min(50, Math.max(1, limit)))) as Array<{
      id: bigint;
      status: number;
      format: string;
      fileUri: string | null;
      expiresAt: Date | null;
      createdAt: Date;
    }>;
    const list = await Promise.all(
      rows.map(async (r) => ({
        export_id: String(r.id),
        id: String(r.id),
        status: r.status,
        format: r.format,
        file_uri: r.fileUri,
        // 现签 URL 而不是存签名 URL（存下来会随过期时间腐烂，见 schema 注释）
        download_url: r.fileUri ? await this.storage.signDownload(r.fileUri, 3600) : null,
        expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
        created_at: r.createdAt.toISOString(),
      })),
    );
    return { list };
  }

  /**
   * 把一张表读成**二维矩阵**（第一行表头）。CSV 与 XLSX 共用这一次读取：
   * 两条导出路径若各读一次，会出现"同一次导出的两种格式内容不一致"的诡异 bug。
   */
  private async tableToMatrix(table: FilmTableRow): Promise<{ matrix: unknown[][]; rows: number; truncated: boolean }> {
    const fieldRows = (await db
      .select()
      .from(filmFields)
      .where(and(eq(filmFields.tableId, table.id), isNull(filmFields.deletedAt)))
      .orderBy(asc(filmFields.sort))) as Array<{ id: bigint; name: string; key: string }>;
    const taskRows = (await db
      .select()
      .from(filmTasks)
      .where(and(eq(filmTasks.tableId, table.id), isNull(filmTasks.deletedAt), isNull(filmTasks.parentId)))
      .orderBy(asc(filmTasks.sort))
      .limit(EXPORT_ROW_CAP + 1)) as Array<{ id: bigint; title: string; status: number }>;
    const truncated = taskRows.length > EXPORT_ROW_CAP;
    const rows = taskRows.slice(0, EXPORT_ROW_CAP);
    const cells = rows.length
      ? ((await db
          .select({ taskId: filmCells.taskId, fieldId: filmCells.fieldId, value: filmCells.valueJson })
          .from(filmCells)
          .where(inArray(filmCells.taskId, rows.map((r) => r.id)))) as Array<{
          taskId: bigint;
          fieldId: bigint;
          value: unknown;
        }>)
      : [];
    const byTask = new Map<string, Map<string, unknown>>();
    for (const c of cells) {
      const bucket = byTask.get(String(c.taskId)) ?? new Map<string, unknown>();
      bucket.set(String(c.fieldId), c.value);
      byTask.set(String(c.taskId), bucket);
    }
    const matrix: unknown[][] = [fieldRows.map((f) => f.name)];
    for (const task of rows) {
      const bucket = byTask.get(String(task.id)) ?? new Map<string, unknown>();
      matrix.push(
        fieldRows.map((f) => {
          const v = bucket.get(String(f.id));
          if (v !== undefined) return v;
          // 稀疏列没有 cell 行时回落系统列的派生值（title/task_status 一定有值）
          if (f.key === "title") return task.title;
          if (f.key === "task_status") return task.status;
          return "";
        }),
      );
    }
    return { matrix, rows: rows.length, truncated };
  }

  /** 矩阵 → CSV 文本（走 csvEscape：公式注入防护 + 引号/换行转义） */
  private matrixToCsv(matrix: unknown[][]): string {
    const lines = matrix.map((row) => row.map((value) => csvEscape(value)).join(","));
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  /**
   * 建导出（同步生成 + 落 storage + 记 `film_exports`）。
   *
   * 表归属校验：table_ids 必须全部属于本 space **且** 属于本 project ——
   * 否则一个导出接口就成了跨项目数据外带的口子。
   */
  async create(
    spaceId: string,
    projectId: string,
    userId: string,
    input: { table_ids: string[]; format: "xlsx" | "csv" },
  ) {
    const tables = (await db
      .select()
      .from(filmTables)
      .where(
        and(
          eq(filmTables.spaceId, BigInt(spaceId)),
          eq(filmTables.projectId, BigInt(projectId)),
          inArray(filmTables.id, input.table_ids.map((v) => BigInt(v))),
        ),
      )) as FilmTableRow[];
    if (tables.length !== new Set(input.table_ids).size) {
      throw new AppError(ErrorCode.INVALID_PARAM, "some table_ids do not belong to this project", {
        field: "table_ids",
        reason: "foreign_id",
      });
    }
    if (tables.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "table_ids is empty", { field: "table_ids" });
    }
    // 稳定顺序：按 sort，导出顺序可复现（否则两次导出的 sheet 序不一致）
    tables.sort((a, b) => a.sort - b.sort);
    const exportId = newId();
    let buffer: Buffer;
    let delivered: "csv" | "zip" | "xlsx";
    let contentType: string;
    let key: string;
    let totalRows = 0;
    let truncated = false;

    const matrices = await Promise.all(tables.map((t) => this.tableToMatrix(t)));
    for (const m of matrices) {
      totalRows += m.rows;
      truncated = truncated || m.truncated;
    }

    /**
     * 格式分支：
     * - `xlsx` → 真 OOXML（每表一个 worksheet，表名即表名）—— 竞品同格式
     * - `csv`  → 单表 csv / 多表 zip（历史行为，保持不变）
     */
    if (input.format === "xlsx") {
      delivered = "xlsx";
      buffer = await buildXlsx(
        tables.map((t, i) => ({
          name: t.name,
          rows: matrices[i]!.matrix,
        })),
      );
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      key = `film/exports/${String(exportId)}/tables.xlsx`;
    } else if (tables.length === 1) {
      delivered = "csv";
      buffer = Buffer.from(this.matrixToCsv(matrices[0]!.matrix), "utf8");
      contentType = "text/csv; charset=utf-8";
      key = `film/exports/${String(exportId)}/${tables[0].name}.csv`;
    } else {
      delivered = "zip";
      const zip = new JSZip();
      tables.forEach((t, i) => {
        zip.file(`${String(i + 1).padStart(2, "0")}-${t.name}.csv`, this.matrixToCsv(matrices[i]!.matrix));
      });
      buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      contentType = "application/zip";
      key = `film/exports/${String(exportId)}/tables.zip`;
    }
    await this.storage.put(key, buffer, contentType);
    const expiresAt = new Date(Date.now() + EXPORT_TTL_DAYS * 24 * 3600 * 1000);
    const [row] = (await db
      .insert(filmExports)
      .values({
        id: exportId,
        spaceId: BigInt(spaceId),
        projectId: BigInt(projectId),
        tableIds: input.table_ids,
        // 落库记录的是**用户请求的格式**；实际交付格式在响应里另给（见文件头偏离说明）
        format: input.format,
        status: 3,
        fileUri: key,
        expiresAt,
        createdBy: BigInt(userId),
      })
      .returning()) as Array<{ id: bigint; status: number; format: string; createdAt: Date }>;
    return {
      export_id: String(row.id),
      id: String(row.id),
      status: row.status,
      format_requested: row.format,
      delivered_format: delivered,
      file_uri: key,
      download_url: await this.storage.signDownload(key, 3600),
      expires_at: expiresAt.toISOString(),
      table_count: tables.length,
      row_count: totalRows,
      truncated,
      note:
        delivered === "xlsx"
          ? `xlsx（${tables.length} 个 sheet）`
          : delivered === "csv"
            ? "单表导出为 CSV"
            : "多表导出为 ZIP（内含每表一个 CSV）",
      max_rows_per_table: EXPORT_ROW_CAP,
      max_batch: FILM_LIMITS.BATCH_MAX,
      created_at: row.createdAt.toISOString(),
    };
  }
}
