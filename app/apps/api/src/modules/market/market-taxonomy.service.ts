import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { marketCategories, marketTags, marketWorks } from "@app/db";
import type { Tx } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";

export type MarketCategory = { id: string; name: string; sort: number; status: number };
export type MarketTag = { id: string; name: string; status: number };

/**
 * 集市分类 / 标签（迁移 0030 起为**真表** `market_categories` / `market_tags`）。
 *
 * ## 从"借用配置表"迁到真表的原因（历史，避免后人重蹈）
 * 迁移 0030 之前 `market_works` 没有 `category_id` / `tag_ids` 列，也没有分类/标签表，
 * 本模块曾把分类/标签与"作品↔分类"归属塞进通用的 `home_configs(scope='market.taxonomy')`
 * 一行 JSON 里——那只是"在没有列的情况下让筛选能真跑"的过渡形态：
 * 无法建索引/外键、筛选要在应用层求交、并发写要靠 advisory lock。
 * 现在真表落地，**过渡形态已清零**（那个 store 文件已删除）。
 *
 * ## 两个不可逆/防悬空的约定
 * 1. **分类删除 = 停用（`status=2`）**，不物理删：`market_works.category_id` 会变成悬空指针，
 *    历史作品按分类筛选直接漏数据（schema.ts:3052-3056 明确了这个取舍）。
 * 2. **标签删除 = 物理删 + 从所有作品 `tag_ids` 数组里摘除**（`array_remove`），
 *    否则列表筛选会命中"已经不存在的标签 id"，前端标签池也对不上。
 */
@Injectable()
export class MarketTaxonomyService {
  // ── 分类 ────────────────────────────────────────────────

  async listCategories(): Promise<MarketCategory[]> {
    const rows = await db
      .select()
      .from(marketCategories)
      .orderBy(asc(marketCategories.sort), asc(marketCategories.id));
    return rows.map((r) => ({ id: String(r.id), name: r.name, sort: r.sort, status: r.status }));
  }

  async createCategory(tx: Tx, input: { name: string; sort?: number }): Promise<MarketCategory> {
    const name = requireName(input.name, "category");
    await assertCategoryNameFree(tx, name);
    const [row] = await tx
      .insert(marketCategories)
      .values({ id: newId(), name, sort: input.sort ?? 0, status: 1 })
      .returning();
    return { id: String(row!.id), name: row!.name, sort: row!.sort, status: row!.status };
  }

  async patchCategory(
    tx: Tx,
    id: string,
    input: { name?: string; sort?: number; status?: number },
  ): Promise<MarketCategory> {
    const categoryId = requireId(id, "category");
    const [existing] = await tx.select().from(marketCategories).where(eq(marketCategories.id, categoryId));
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "market category not found");
    if (input.name !== undefined) await assertCategoryNameFree(tx, requireName(input.name, "category"), categoryId);
    const [row] = await tx
      .update(marketCategories)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(marketCategories.id, categoryId))
      .returning();
    return { id: String(row!.id), name: row!.name, sort: row!.sort, status: row!.status };
  }

  /**
   * 删分类 = **停用**（`status=2`）。不物理删的理由见类注释。
   * 前端"删除"按钮实际调用它，返回 `disabled: true` 语义明确。
   */
  async disableCategory(tx: Tx, id: string): Promise<MarketCategory> {
    const categoryId = requireId(id, "category");
    const [row] = await tx
      .update(marketCategories)
      .set({ status: 2, updatedAt: new Date() })
      .where(eq(marketCategories.id, categoryId))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "market category not found");
    return { id: String(row.id), name: row.name, sort: row.sort, status: row.status };
  }

  // ── 标签 ────────────────────────────────────────────────

  async listTags(): Promise<MarketTag[]> {
    const rows = await db.select().from(marketTags).orderBy(asc(marketTags.name));
    return rows.map((r) => ({ id: String(r.id), name: r.name, status: 1 }));
  }

  /** 建标签：同名幂等（前端"回车即建"重复触发不该报错） */
  async createTag(tx: Tx, input: { name: string }): Promise<{ tag: MarketTag; idempotent: boolean }> {
    const name = requireName(input.name, "tag");
    const [inserted] = await tx
      .insert(marketTags)
      .values({ id: newId(), name })
      .onConflictDoNothing({ target: marketTags.name })
      .returning();
    if (inserted) return { tag: { id: String(inserted.id), name: inserted.name, status: 1 }, idempotent: false };
    const [existing] = await tx.select().from(marketTags).where(eq(marketTags.name, name));
    if (!existing) throw new AppError(ErrorCode.INTERNAL, "tag insert raced and vanished");
    return { tag: { id: String(existing.id), name: existing.name, status: 1 }, idempotent: true };
  }

  /** 删标签：物理删 + 从所有作品的 `tag_ids` 里摘除（返回受影响的按品数） */
  async deleteTag(tx: Tx, id: string): Promise<{ id: string; affected_works: number }> {
    const tagId = requireId(id, "tag");
    const [existing] = await tx.select().from(marketTags).where(eq(marketTags.id, tagId));
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "market tag not found");
    await tx.delete(marketTags).where(eq(marketTags.id, tagId));
    const affected = await tx
      .update(marketWorks)
      // `<bigint[]>` 元素摘除用原生 array_remove：drizzle 没有 arrayRemove helper
      // （只有 arrayContains/arrayContained/arrayOverlaps），这里必须落到 SQL 层。
      .set({ tagIds: sql`array_remove(${marketWorks.tagIds}, ${tagId}::bigint)`, updatedAt: new Date() })
      .where(sql`${tagId}::bigint = any(${marketWorks.tagIds})`)
      .returning({ id: marketWorks.id });
    return { id: String(tagId), affected_works: affected.length };
  }

  // ── 作品引用校验 ─────────────────────────────────────────
  /**
   * 校验作品要挂的分类/标签都存在（分类必须是启用态）。
   *
   * 为什么必须校验：`market_works.category_id` / `tag_ids` 是普通列（`tag_ids` 是数组，
   * 无法加外键），乱传 id 会让列表筛选与前端标签池出现"指向不存在实体的悬空值"。
   */
  async resolveRefs(
    tx: Tx,
    input: { category_id?: string | null; tag_ids?: string[] },
  ): Promise<{ categoryId?: bigint | null; tagIds?: bigint[] }> {
    const out: { categoryId?: bigint | null; tagIds?: bigint[] } = {};
    if (input.category_id !== undefined) {
      if (input.category_id === null) {
        out.categoryId = null;
      } else {
        const categoryId = requireId(input.category_id, "category_id");
        const [category] = await tx
          .select({ id: marketCategories.id })
          .from(marketCategories)
          .where(and(eq(marketCategories.id, categoryId), eq(marketCategories.status, 1)));
        if (!category) {
          throw new AppError(ErrorCode.INVALID_PARAM, "unknown or disabled category_id", {
            field: "category_id",
          });
        }
        out.categoryId = categoryId;
      }
    }
    if (input.tag_ids !== undefined) {
      const tagIds = [...new Set(input.tag_ids)].map((id) => requireId(id, "tag_id"));
      if (tagIds.length > 0) {
        const found = await tx
          .select({ id: marketTags.id })
          .from(marketTags)
          .where(inArray(marketTags.id, tagIds));
        const known = new Set(found.map((r) => String(r.id)));
        const unknown = input.tag_ids.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          throw new AppError(ErrorCode.INVALID_PARAM, `unknown tag_id ${unknown.join(", ")}`, {
            field: "tag_ids",
          });
        }
      }
      out.tagIds = tagIds;
    }
    return out;
  }
}

function requireName(raw: string, what: string): string {
  const name = raw.trim();
  if (name.length === 0) {
    throw new AppError(ErrorCode.INVALID_PARAM, `${what} name must not be empty`, { field: "name" });
  }
  return name;
}

function requireId(raw: string, field: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
  }
}

async function assertCategoryNameFree(tx: Tx, name: string, excludeId?: bigint): Promise<void> {
  const rows = await tx
    .select({ id: marketCategories.id })
    .from(marketCategories)
    .where(eq(marketCategories.name, name));
  if (rows.some((r) => String(r.id) !== (excludeId ? String(excludeId) : ""))) {
    throw new AppError(ErrorCode.INVALID_PARAM, "category name already exists", { field: "name" });
  }
}
