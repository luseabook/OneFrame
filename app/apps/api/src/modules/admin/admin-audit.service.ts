import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { adminAuditLogs } from "@app/db";
import { newId } from "@app/shared";
import { db } from "../../db/database";

export interface AdminAuditEntry {
  adminId?: string | null;
  adminUsername: string;
  method: string;
  path: string;
  action: string;
  statusCode: number;
  ok: boolean;
  ip?: string | null;
  requestId?: string | null;
  payload?: unknown;
}

/**
 * 过滤条件（列表与 CSV 共用）。分页不在其中：导出是"过滤后的全部（≤5000 行）"。
 */
export interface AdminAuditExportFilters {
  adminId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

export interface AdminAuditListFilters extends AdminAuditExportFilters {
  page?: number;
  pageSize?: number;
}

function bigintOrNull(value: string | null | undefined): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    // 审计写入是旁路：非法 id（理论上不会出现）退化成"匿名操作"，绝不因此丢整条日志
    return null;
  }
}

/**
 * 审计导出上限（契约 §2.6）。
 * 5000 行足以覆盖一次事故排查的上下文；再大就该用数据库导出，
 * 而不是让 API 事件循环去拼一个几十 MB 的字符串。
 */
export const ADMIN_AUDIT_CSV_LIMIT = 5000;

/** 契约 §2.6 固定表头：列顺序即合同，导出脚本按位置消费 */
export const ADMIN_AUDIT_CSV_HEADER =
  "id,admin_id,admin_username,method,path,action,status_code,ok,ip,request_id,created_at,payload";

/** RFC 4180 转义：含逗号/引号/换行的字段整体加引号，内部引号双写 */
function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * 管理端操作审计的读写（契约 §3.4）。
 *
 * 为什么 record 内部也吞异常：调用方是全局拦截器，审计落库失败**绝不能**让一次已经成功的
 * 运营操作变成 500（那会让"日志库抖动"升级成"后台不可用"）。这里 catch 掉并静默，
 * 但保留方法签名 async，便于将来换成"落本地文件/重试队列"而不改调用方。
 */
@Injectable()
export class AdminAuditService {
  async record(entry: AdminAuditEntry): Promise<void> {
    try {
      await db.insert(adminAuditLogs).values({
        id: newId(),
        adminId: bigintOrNull(entry.adminId),
        adminUsername: entry.adminUsername.slice(0, 64),
        method: entry.method.slice(0, 16),
        path: entry.path.slice(0, 512),
        action: entry.action.slice(0, 512),
        statusCode: entry.statusCode,
        ok: entry.ok,
        ip: entry.ip ? entry.ip.slice(0, 64) : null,
        requestId: entry.requestId ? entry.requestId.slice(0, 64) : null,
        payload: (entry.payload ?? null) as never,
      });
    } catch {
      // 审计是旁路：写失败即放弃本条，不影响业务响应
    }
  }

  async list(filters: AdminAuditListFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 20));
    const where = this.buildWhere(filters);

    const rows = await db
      .select()
      .from(adminAuditLogs)
      .where(where)
      .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db.select({ count: sql<number>`count(*)::int` }).from(adminAuditLogs).where(where);

    return {
      list: rows.map((row) => ({
        id: String(row.id),
        admin_id: row.adminId === null ? null : String(row.adminId),
        admin_username: row.adminUsername,
        method: row.method,
        path: row.path,
        action: row.action,
        status_code: row.statusCode,
        ok: row.ok,
        ip: row.ip,
        request_id: row.requestId,
        payload: row.payload,
        created_at: row.createdAt.toISOString(),
      })),
      total: agg?.count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /**
   * 审计日志 CSV（契约 §2.6）。
   *
   * 复用 `buildWhere`：导出与列表必须是**同一份过滤口径**，否则会出现
   * "列表里有这一条、导出文件里没有"这种最难排查的分叉。
   * `payload` 先 `JSON.stringify` 再按 CSV 规则转义——它是 jsonb，
   * 直接 `String()` 会得到 `[object Object]`，等于把最有价值的字段扔掉。
   */
  async exportCsv(filters: AdminAuditExportFilters = {}): Promise<string> {
    const where = this.buildWhere(filters);
    const rows = await db
      .select()
      .from(adminAuditLogs)
      .where(where)
      .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
      .limit(ADMIN_AUDIT_CSV_LIMIT);

    const lines = rows.map((row) =>
      [
        String(row.id),
        row.adminId === null ? "" : String(row.adminId),
        csvEscape(row.adminUsername),
        csvEscape(row.method),
        csvEscape(row.path),
        csvEscape(row.action),
        row.statusCode,
        row.ok,
        csvEscape(row.ip),
        csvEscape(row.requestId),
        row.createdAt.toISOString(),
        csvEscape(row.payload === null || row.payload === undefined ? "" : JSON.stringify(row.payload)),
      ].join(","),
    );
    return `${ADMIN_AUDIT_CSV_HEADER}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
  }

  /**
   * 唯一的 where 构造点（列表与导出共用）。
   *
   * 注意这里**不含分页**：分页是展示问题，过滤是数据口径问题，混在一起就会
   * 让导出不由自主地带上一页的偏移量。
   */
  private buildWhere(filters: AdminAuditExportFilters) {
    const conds = [];
    if (filters.adminId) conds.push(eq(adminAuditLogs.adminId, BigInt(filters.adminId)));
    // 模糊匹配而不是精确等值：运营在输入框里通常只记得"model-prices"这种片段，
    // 精确匹配会让人以为"没有日志"。action 列的索引仍能覆盖前缀查询的常见形态。
    if (filters.action && filters.action.trim()) {
      conds.push(ilike(adminAuditLogs.action, `%${filters.action.trim()}%`));
    }
    if (filters.from) conds.push(gte(adminAuditLogs.createdAt, filters.from));
    if (filters.to) conds.push(lte(adminAuditLogs.createdAt, filters.to));
    return conds.length > 0 ? and(...conds) : undefined;
  }
}
