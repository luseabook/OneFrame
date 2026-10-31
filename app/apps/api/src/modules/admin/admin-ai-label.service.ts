import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { models, tasks } from "@app/db";
import { db } from "../../db/database";

/**
 * 一次取数上限（契约 §2.4）。
 *
 * 为什么不直接 SQL 分页：`ai_label` 在 `tasks.results` 这个 JSONB 数组的
 * 每个元素里（`results[n].meta.ai_label`），要不要过滤"缺标识"必须先解析 JSON，
 * 而 PG 侧对 `results -> 0 -> 'meta' -> 'ai_label'` 建表达式索引属于 schema 变更
 * （本批不做迁移）。所以口径是"按 finished_at 倒序取最近 5000 条，再在内存里
 * 解析 + 过滤 + 分页"，把成本限制在一次有界的读取上。
 */
export const AI_LABEL_SCAN_LIMIT = 5000;

/** CSV 导出上限与取数上限一致：同一口径才能保证"看到的表格"和"导出的文件"对得上 */
export const AI_LABEL_CSV_LIMIT = AI_LABEL_SCAN_LIMIT;

/** 契约 §2.4 固定表头：列顺序即合同，`model` 是**人可读**的模型名（不是 model_id） */
export const AI_LABEL_CSV_HEADER = [
  "task_id",
  "space_id",
  "model",
  "mode",
  "status",
  "has_ai_label",
  "enabled",
  "explicit",
  "implicit",
  "explicit_reason",
  "result_count",
  "finished_at",
].join(",");

export interface AiLabelRowDto {
  task_id: string;
  space_id: string;
  model_id: string;
  model_name: string | null;
  mode: string;
  status: number;
  has_ai_label: boolean;
  /** 没有标签时是 null（不是 false）——"没写"与"写了 false"必须能区分 */
  enabled: boolean | null;
  explicit: boolean | null;
  implicit: boolean | null;
  explicit_reason: string | null;
  result_count: number;
  finished_at: string | null;
  created_at: string;
}

interface AiLabelView {
  has: boolean;
  enabled: boolean | null;
  explicit: boolean | null;
  implicit: boolean | null;
  explicitReason: string | null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析一条任务的 AI 标识。
 *
 * 只读**第一条** result 的 `meta.ai_label`（契约 §2.4）：`label.ts` 是逐 result 写同一份
 * 标签的（同一任务的所有产出共用一次水印/旁车写入），取第一条即代表该任务；
 * 逐条聚合会造出一个"部分标了/部分没标"的中间态，反而没有运营动作可做。
 */
export function readAiLabel(results: unknown): AiLabelView {
  const empty: AiLabelView = { has: false, enabled: null, explicit: null, implicit: null, explicitReason: null };
  if (!Array.isArray(results) || results.length === 0) return empty;
  const first = results[0];
  if (!isRecord(first)) return empty;
  const meta = first.meta;
  if (!isRecord(meta)) return empty;
  const label = meta.ai_label;
  if (!isRecord(label)) return empty;
  return {
    has: true,
    enabled: boolOrNull(label.enabled),
    explicit: boolOrNull(label.explicit),
    implicit: boolOrNull(label.implicit),
    // label.ts 在显式水印失败时写 explicit_reason（如 media_too_large / ffmpeg 报错）
    explicitReason: stringOrNull(label.explicit_reason),
  };
}

/** RFC 4180 CSV 转义：逗号/引号/换行都必须整体加引号，内部引号双写 */
export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * AI 标识审计（契约 §2.4）。
 *
 * 数据源是 `tasks.results[].meta.ai_label`（worker `label.ts` 写入），**不新建表**：
 * 标识在生成时就写进了产出物，另建一张审计表只会立刻与真相分叉
 * （"表里说有、成品上没有"是审计最不该出现的状态）。
 * 因此这个服务是纯读 + 内存解析，不提供任何"回填/修正"写入口。
 */
@Injectable()
export class AdminAiLabelService {
  /**
   * 取基集并解析成行（列表与 CSV 共用，避免两份过滤口径）。
   *
   * `only_missing` 在这里而不是在 SQL：`results -> 0 -> 'meta' -> 'ai_label'`
   * 是否存在，PG 侧要写表达式（本批不加索引/迁移），内存里判断等价且更直白。
   */
  private async collectRows(filters: { from?: Date; to?: Date; onlyMissing?: boolean }): Promise<AiLabelRowDto[]> {
    const conds = [eq(tasks.status, 3), isNotNull(tasks.results)];
    if (filters.from) conds.push(gte(tasks.finishedAt, filters.from));
    if (filters.to) conds.push(lte(tasks.finishedAt, filters.to));

    const rows = await db
      .select({
        id: tasks.id,
        spaceId: tasks.spaceId,
        modelId: tasks.modelId,
        modelName: models.displayName,
        mode: tasks.mode,
        status: tasks.status,
        results: tasks.results,
        finishedAt: tasks.finishedAt,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      // model_id 是 NOT NULL + 外键，inner join 不会丢行；join 只为拿到可读的模型名
      .innerJoin(models, eq(models.id, tasks.modelId))
      .where(and(...conds))
      // finished_at 可能为 null（理论上 status=3 必有，但历史数据不保证）；
      // 再按 id 倒序兜底，保证"同一时刻完成的一批任务"顺序稳定。
      //
      // ⚠️ 必须显式 `NULLS LAST`：PostgreSQL 的 `DESC` 默认是 **NULLS FIRST**，
      // 于是历史脏数据（status=3 但 finished_at 为空）会排在最前面、把最近完成的任务挤出
      // 首屏——审计页看到的是"最老的一批空行"，且 5000 行扫描上限一满，新行永远查不到。
      .orderBy(sql`${tasks.finishedAt} desc nulls last`, desc(tasks.id))
      .limit(AI_LABEL_SCAN_LIMIT);

    const mapped: AiLabelRowDto[] = rows.map((row) => {
      const label = readAiLabel(row.results);
      return {
        task_id: String(row.id),
        space_id: String(row.spaceId),
        model_id: String(row.modelId),
        model_name: row.modelName ?? null,
        mode: row.mode,
        status: row.status,
        has_ai_label: label.has,
        enabled: label.enabled,
        explicit: label.explicit,
        implicit: label.implicit,
        explicit_reason: label.explicitReason,
        result_count: Array.isArray(row.results) ? row.results.length : 0,
        finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
        created_at: row.createdAt.toISOString(),
      };
    });

    return filters.onlyMissing ? mapped.filter((row) => !row.has_ai_label) : mapped;
  }

  /** 列表：`total` 是**过滤后**的总数（≥5000 时要意识到它是被截断的上限） */
  async list(filters: { from?: Date; to?: Date; onlyMissing?: boolean; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const rows = await this.collectRows(filters);
    const total = rows.length;
    const effectivePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize) || 1));
    const offset = (effectivePage - 1) * pageSize;
    return {
      list: rows.slice(offset, offset + pageSize),
      total,
      page: effectivePage,
      page_size: pageSize,
    };
  }

  /** CSV：同口径，≤5000 行，表头固定（契约 §2.4） */
  async exportCsv(filters: { from?: Date; to?: Date; onlyMissing?: boolean } = {}): Promise<string> {
    const rows = await this.collectRows(filters);
    const lines = rows.slice(0, AI_LABEL_CSV_LIMIT).map((row) =>
      [
        row.task_id,
        csvEscape(row.space_id),
        csvEscape(row.model_name ?? row.model_id),
        csvEscape(row.mode),
        row.status,
        row.has_ai_label,
        // null 导出为空串而不是 "false"：把"没写标签"导成 false 会让下游统计凭空多出一堆误判
        row.enabled === null ? "" : row.enabled,
        row.explicit === null ? "" : row.explicit,
        row.implicit === null ? "" : row.implicit,
        csvEscape(row.explicit_reason),
        row.result_count,
        row.finished_at ?? "",
      ].join(","),
    );
    return `${AI_LABEL_CSV_HEADER}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
  }
}
