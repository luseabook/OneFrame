import { Injectable } from "@nestjs/common";
import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { appConfigs } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";

export interface AppConfigDto {
  id: string;
  key: string;
  module: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppConfigResolved {
  key: string;
  module: string;
  value: unknown;
  exists: boolean;
  updated_at: string | null;
}

export interface AppConfigListFilters {
  page?: number;
  pageSize?: number;
  /** 精确匹配 `module`（`""` 是"默认域"，也是一个合法取值） */
  module?: string;
  /** 对 `key` 模糊匹配 */
  q?: string;
}

function toDto(row: typeof appConfigs.$inferSelect): AppConfigDto {
  return {
    id: String(row.id),
    key: row.key,
    module: row.module,
    value: row.value,
    description: row.description,
    updated_by: row.updatedBy === null ? null : String(row.updatedBy),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * 多语言配置的隔离方式：`module` 维度拼接语言后缀。
 *
 * 为什么不做成 `(key, module, lang)` 三列：契约里 `app_configs` 只有 `key/module/value`，
 * 而"同一个 key 按语言各存一份"完全可以用 module 表达（`home@en` / `home@ja`）。
 * 好处是读取时一次精确命中唯一索引，不需要额外加列与迁移；代价是查询方要知道这条约定，
 * 所以 `resolve()` 做了"先带语言、再回落无语言"的两级查找。
 */
function moduleWithLang(module: string, lang: string): string {
  return module ? `${module}@${lang}` : `@${lang}`;
}

/**
 * 运营配置中心（契约 §3.5）。
 *
 * 写入语义是 **upsert**：运营在后台改一个开关不该关心"这个 key 存在没有"。
 * 删除是物理删除（配置没有审计/追溯价值，历史改动由 `admin_audit_logs` 那条 PUT/DELETE 记录承担）。
 */
@Injectable()
export class AdminConfigService {
  /**
   * 配置列表（契约 §2.5：服务端分页 + module/q 过滤）。
   *
   * 为什么要服务端分页：配置表会随业务不断长胖（每个功能开关/文案都在里面），
   * 一次全量返回既有响应体风险，也让前端"按 key 搜索"变成纯前端过滤——
   * 那样只能搜到当前这一页，运营会以为"这个 key 不存在"。
   *
   * 越界 `page` 归一到最后一页：前端直接把返回值当分页器状态，不归一就会出现
   * "删掉最后一页的最后一条后停在一个空页"。
   */
  async list(filters: AppConfigListFilters = {}): Promise<{
    list: AppConfigDto[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const page = Math.max(1, filters.page ?? 1);
    const conds = [];
    // module 是精确值：`""`（默认域）也必须能被显式筛出来，所以判的是 undefined 而不是真值。
    // 配套：控制器里这个字段**不能**走 `emptyToUndefined`，否则 `?module=` 会变成"不筛"，
    // 而默认域的行恰恰是 module='' —— 运营会看到"筛了默认域却还是全表"。
    if (filters.module !== undefined) {
      conds.push(eq(appConfigs.module, filters.module));
    }
    if (filters.q && filters.q.trim()) {
      conds.push(ilike(appConfigs.key, `%${filters.q.trim()}%`));
    }
    const where = conds.length > 0 ? and(...conds) : undefined;

    const [agg] = await db.select({ count: sql<number>`count(*)::int` }).from(appConfigs).where(where);
    const total = agg?.count ?? 0;
    if (total === 0) return { list: [], total: 0, page, page_size: pageSize };

    const effectivePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const rows = await db
      .select()
      .from(appConfigs)
      .where(where)
      .orderBy(asc(appConfigs.module), asc(appConfigs.key))
      .limit(pageSize)
      .offset((effectivePage - 1) * pageSize);

    return { list: rows.map(toDto), total, page: effectivePage, page_size: pageSize };
  }

  async upsert(
    key: string,
    input: { value: unknown; module?: string; description?: string | null },
    adminId?: string,
  ): Promise<AppConfigDto> {
    const module = input.module ?? "";
    // value 的合法性（非 null / ≤64KB / 可序列化）在控制器 zod 里已校验：
    // 这里不再兜底，避免"静默改写成 {} "掩盖调用方错误。
    const value = input.value as never;
    const [row] = await db
      .insert(appConfigs)
      .values({
        id: newId(),
        key,
        module,
        value,
        description: input.description ?? null,
        updatedBy: adminId ? BigInt(adminId) : null,
      })
      .onConflictDoUpdate({
        // 唯一键是 (key, module)：同一 key 的默认值与 `@lang` 覆盖可以并存
        target: [appConfigs.key, appConfigs.module],
        set: {
          module,
          value,
          description: input.description ?? null,
          updatedBy: adminId ? BigInt(adminId) : null,
          // 必须显式刷新：本表没有数据库触发器，漏写会让"最后修改时间"永远停在首次创建
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "failed to save config");
    return toDto(row);
  }

  /**
   * 删除配置。
   *
   * 寻址必须能精确到 `(key, module)`：列表是按行展示的，运营在某一行点删除时只期望删这一行。
   * 旧实现只按 key 删，会把同 key 的全部语言变体一起清掉（删 `home.title@en` 连带
   * `@ja/@es/@pt-BR` 和默认值），而且界面上看不出发生了什么 —— 这是静默跨语言丢配置。
   *
   * `module` 缺省时保留"按键删全部"的旧语义（供批量清理），单行删除由调用方显式传 module。
   * 注意 `module=""` 是**默认域**那一行的合法地址，与"未传"不是一回事。
   */
  async remove(key: string, module?: string): Promise<{ key: string; deleted: boolean; deleted_count: number }> {
    const where =
      module === undefined
        ? eq(appConfigs.key, key)
        : and(eq(appConfigs.key, key), eq(appConfigs.module, module));
    const rows = await db.delete(appConfigs).where(where).returning({ id: appConfigs.id });
    if (rows.length === 0) throw new AppError(ErrorCode.NOT_FOUND, "config not found");
    return { key, deleted: true, deleted_count: rows.length };
  }

  /**
   * 公开读取（`GET /ops/config/:key`）。
   * 不存在返回 `exists:false, value:null` 而不是 404：前端拿配置缺省值继续渲染是常态，
   * 404 会逼每个调用方写一遍"没配就算了"的分支，还容易在监控里制造假的错误率。
   */
  async resolve(key: string, opts: { module?: string; lang?: string } = {}): Promise<AppConfigResolved> {
    const module = opts.module ?? "";
    const candidates = opts.lang ? [moduleWithLang(module, opts.lang), module] : [module];
    for (const candidate of candidates) {
      const [row] = await db
        .select()
        .from(appConfigs)
        .where(and(eq(appConfigs.key, key), eq(appConfigs.module, candidate)))
        .limit(1);
      if (row) {
        return {
          key: row.key,
          module: row.module,
          value: row.value,
          exists: true,
          updated_at: row.updatedAt.toISOString(),
        };
      }
    }
    return { key, module, value: null, exists: false, updated_at: null };
  }
}
