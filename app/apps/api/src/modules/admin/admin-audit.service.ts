import { Injectable, Logger } from "@nestjs/common";
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
 * 审计写入的重试策略。
 *
 * 只重试"可能瞬时恢复"的写库失败（连接抖动、主备切换、deadlock）。业务错误不重试：
 * 审计这一层见不到业务错误，它唯一的输入是"一条已经成功的运营操作"。
 */
export interface AdminAuditRetryPolicy {
  /** 额外重试次数（默认 2，即最多 3 次尝试） */
  retries?: number;
  /** 指数退避基数（毫秒）：第 n 次重试等待 base * 2^(n-1) */
  baseDelayMs?: number;
  /** 供测试/CLI 注入的 sleep（避免真实等待） */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_AUDIT_RETRIES = 2;
const DEFAULT_AUDIT_BASE_DELAY_MS = 50;
/** Postgres 唯一键冲突：同一条审计（同 id）其实已落库，重试时应按成功处理 */
const PG_UNIQUE_VIOLATION = "23505";

/** 退化字段的日志上限：action/requestId 来自请求，进日志前截断并压平换行 */
const LOG_FIELD_LIMIT = 200;

const defaultAuditSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // 旁路退避定时器不该阻止进程退出（与 billing 渠道重试同一约定）
    (timer as { unref?: () => void }).unref?.();
  });

/** 从驱动/drizzle 包装过的错误里取 Postgres SQLSTATE（两层形状都认） */
function sqlState(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const direct = (err as { code?: unknown }).code;
    if (typeof direct === "string") return direct;
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
      const nested = (cause as { code?: unknown }).code;
      if (typeof nested === "string") return nested;
    }
  }
  return undefined;
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** 日志字段一行化：审计日志里出现换行会伪造出第二条日志 */
function logField(value: string | null | undefined): string {
  if (!value) return "-";
  return value.replace(/[\r\n]+/g, " ").slice(0, LOG_FIELD_LIMIT);
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
 * `record` 绝不抛错：调用方是全局拦截器，审计落库失败**绝不能**让一次已经成功的
 * 运营操作变成 500（那会让"日志库抖动"升级成"后台不可用"）。
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger("admin-audit");

  /**
   * 写一条审计（有界重试）。
   *
   * 为什么重试：审计是旁路，但"旁路"不等于"可以丢"。单次写库失败（连接抖动、主备切换）
   * 就永久丢掉一条运营操作记录，事故复盘时会出现"操作发生了、审计里没有"的黑洞。
   * 所以失败后按 50/100ms 指数退避再做至多 2 次尝试，全程仍在 `setImmediate` 之后的
   * 旁路上，不进入本次响应的关键路径。
   *
   * 幂等：id 只生成一次并在重试间复用。若上一次其实已提交、只是确认丢失，
   * 重试会撞唯一键（23505）——说明记录已在库里，直接按成功处理，不重复插入。
   *
   * 可观测：重试后成功留 `admin_audit_write_recovered` warn；重试用尽才放弃，
   * 留 `admin_audit_write_failed` error（带 request_id，可回连请求日志定位"丢了哪一条"）。
   */
  async record(entry: AdminAuditEntry, policy: AdminAuditRetryPolicy = {}): Promise<void> {
    const retries = Math.max(0, policy.retries ?? DEFAULT_AUDIT_RETRIES);
    const baseDelayMs = Math.max(1, policy.baseDelayMs ?? DEFAULT_AUDIT_BASE_DELAY_MS);
    const sleep = policy.sleep ?? defaultAuditSleep;

    // 行在循环外构造一次：重试写的是同一条记录（同 id），而不是"每次尝试一条新记录"
    const row = {
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
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        // 注入的 sleep 理论上不会 reject；即便抛错也不能让审计把业务变成异常
        await sleep(baseDelayMs * 2 ** (attempt - 1)).catch(() => undefined);
      }
      try {
        await db.insert(adminAuditLogs).values(row);
        if (attempt > 0) {
          this.logger.warn(
            `admin_audit_write_recovered attempts=${attempt + 1} request_id=${logField(entry.requestId)} action="${logField(entry.action)}"`,
          );
        }
        return;
      } catch (err) {
        // 上一次尝试其实已提交（确认丢失）：记录已在库里，按成功处理
        if (sqlState(err) === PG_UNIQUE_VIOLATION) return;
        lastError = err;
      }
    }
    this.logger.error(
      `admin_audit_write_failed attempts=${retries + 1} request_id=${logField(entry.requestId)} action="${logField(entry.action)}" err=${logField(errorText(lastError))}`,
    );
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
