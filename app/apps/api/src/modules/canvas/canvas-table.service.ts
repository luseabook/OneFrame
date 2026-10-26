import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { canvasNodes } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { RedisService } from "../../redis/redis.service";
import { decodeBase64Upload } from "../../common/base64";
import { parseWorkbook, TABLE_LIMITS, type SheetData } from "./canvas-table-parser";

/** 导入票据的存活时间：够用户看清 Sheet 列表再选，又不至于长期占 Redis */
const IMPORT_TTL_S = 1800;

interface CachedWorkbook {
  file_name: string;
  sheets: SheetData[];
  warnings: string[];
}

/**
 * 表格节点 Excel 导入（两步式）。
 *
 * 为什么必须两步：参照站实测「不会自动选第一个 Sheet」（`node.md:392`）。
 * 多 Sheet 的排期表如果自动选第一个，用户会以为导错了、或者把「角色表」
 * 当成「镜头表」提交——错得无声无息。所以先只回 Sheet 清单，由用户显式确认。
 *
 * 为什么不把解析结果直接写进节点：节点参数属于画布本地编辑态（本地改 → 整图
 * commit）。导入只是"把内容变成参数"，写完仍要用户点保存；这与模板套用同一套模型。
 */
@Injectable()
export class CanvasTableService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  /** 节点必须存在、属于本 space/画布，且确实是表格节点 */
  private async requireTableNode(
    spaceId: string,
    canvasId: string,
    nodeId: string,
  ): Promise<typeof canvasNodes.$inferSelect> {
    let id: bigint;
    let cid: bigint;
    try {
      id = BigInt(nodeId);
      cid = BigInt(canvasId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid node_id", { field: "node_id" });
    }
    const [row] = await db
      .select()
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.id, id),
          eq(canvasNodes.canvasId, cid),
          eq(canvasNodes.spaceId, BigInt(spaceId)),
          isNull(canvasNodes.deletedAt),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "node not found", { node_id: nodeId });
    if (row.nodeType !== "table") {
      throw new AppError(ErrorCode.INVALID_PARAM, "only table nodes accept excel import", {
        field: "node_type",
        node_type: row.nodeType,
      });
    }
    return row;
  }

  /**
   * 第一步：解析工作簿，只回 Sheet 清单与预览。
   * 完整行的解析结果暂存 Redis（带票据），confirm 时再取——避免把十几万单元格
   * 一次性塞进接口响应，也避免让客户端自己保管文件字节。
   */
  async importWorkbook(
    spaceId: string,
    canvasId: string,
    nodeId: string,
    input: { file_name: string; file_base64: string },
  ): Promise<{
    import_token: string;
    file_name: string;
    sheets: Array<Omit<SheetData, "rows">>;
    preview: string[][];
    warnings: string[];
    limits: typeof TABLE_LIMITS;
  }> {
    // 只做校验（节点存在/属本 space/是 table）：解析结果写 Redis，节点参数留到 confirm 才动
    await this.requireTableNode(spaceId, canvasId, nodeId);
    const name = input.file_name || "upload.xlsx";
    if (!/\.xlsx$/i.test(name)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "only .xlsx is supported", { field: "file_name" });
    }
    const buffer = decodeBase64Upload(input.file_base64);
    const parsed = await parseWorkbook(buffer);

    const token = String(newId());
    const payload: CachedWorkbook = { file_name: name, sheets: parsed.sheets, warnings: parsed.warnings };
    await this.redis.set(`canvas:table:import:${token}`, JSON.stringify(payload), IMPORT_TTL_S);

    return {
      import_token: token,
      file_name: name,
      // 行数据不随清单返回：20 万行的工作簿会让首响变成几 MB
      sheets: parsed.sheets.map(({ rows: _rows, ...meta }) => meta),
      preview: parsed.sheets[0]?.rows.slice(0, 5).map((row) => row.slice(0, 8)) ?? [],
      warnings: parsed.warnings,
      limits: TABLE_LIMITS,
    };
  }

  /**
   * 第二步：显式确认某个 Sheet，把内容写成节点参数。
   *
   * 写入时会 `version + 1`：这是一次服务端发起的内容变更，若客户端手上还是旧
   * version，后续单节点 PATCH 会被 746002 拦下，而不是静默覆盖。
   * 但**不动 `canvases.version`**：整图提交才是画布级变更，这里仍是"编辑态数据"。
   */
  async confirmSheet(
    spaceId: string,
    canvasId: string,
    nodeId: string,
    input: { import_token: string; sheet_id: string },
  ): Promise<{
    node: { node_id: string; version: number };
    sheet: Omit<SheetData, "rows">;
    sheets: Array<Omit<SheetData, "rows">>;
    table: Record<string, unknown>;
  }> {
    const node = await this.requireTableNode(spaceId, canvasId, nodeId);
    const cached = await this.redis.get(`canvas:table:import:${input.import_token}`);
    if (!cached) {
      // 票据过期要能被区分出来：用户重开面板再点"使用"时应该重新导入，而不是以为节点坏了
      throw new AppError(ErrorCode.NOT_FOUND, "import session expired, please import again", {
        field: "import_token",
      });
    }
    let parsed: CachedWorkbook;
    try {
      parsed = JSON.parse(cached) as CachedWorkbook;
    } catch {
      throw new AppError(ErrorCode.INTERNAL, "import session corrupted, please import again");
    }
    const sheet = parsed.sheets.find((item) => item.sheet_id === input.sheet_id);
    if (!sheet) {
      throw new AppError(ErrorCode.NOT_FOUND, "sheet not found in this workbook", {
        field: "sheet_id",
      });
    }

    const current = (node.params ?? {}) as Record<string, unknown>;
    const previousTable = (current.table ?? {}) as Record<string, unknown>;
    const table: Record<string, unknown> = {
      ...previousTable,
      active_sheet_id: sheet.sheet_id,
      // 用户已经显式选过了：再打开面板不该继续闪"请选择工作表"
      sheet_selection_required: false,
      source: { type: "excel_import", file_name: parsed.file_name },
      sheets: parsed.sheets.map((item) => ({
        sheet_id: item.sheet_id,
        name: item.name,
        rows: item.rows,
        row_count: item.row_count,
        col_count: item.col_count,
        truncated: item.truncated,
      })),
      import: {
        file_name: parsed.file_name,
        imported_at: new Date().toISOString(),
        warnings: parsed.warnings,
      },
    };

    const [updated] = await db
      .update(canvasNodes)
      .set({
        params: { ...current, table },
        version: sql`${canvasNodes.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(canvasNodes.id, node.id))
      .returning();

    const meta = (s: SheetData): Omit<SheetData, "rows"> => ({
      sheet_id: s.sheet_id,
      name: s.name,
      row_count: s.row_count,
      col_count: s.col_count,
      truncated: s.truncated,
    });

    return {
      node: { node_id: String(node.id), version: updated?.version ?? node.version + 1 },
      sheet: meta(sheet),
      sheets: parsed.sheets.map(meta),
      table,
    };
  }
}
