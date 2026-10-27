import { Injectable } from "@nestjs/common";
import { and, arrayContains, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { assets, knowledgeAssets, knowledgeDirs, knowledgeTags, users } from "@app/db";
import type { Tx } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import type { AuthContext } from "../../common/auth.types";

type DirRow = typeof knowledgeDirs.$inferSelect;
type AssetRow = typeof knowledgeAssets.$inferSelect;

/**
 * 目录树最大深度（根目录 = 1）。
 *
 * 竞品证据：`user_knowledge` 只有 `dir` 端点（`routes.txt:741`、`:749-750`、`:755-756`），
 * **深度上限未在任何路由/产物中出现**（`d-commerce-account.md:359` 只说"目录树"）。
 * 5 层是 task 给定的我方口径 → 登记为「我方自定，待取证」。
 */
export const KNOWLEDGE_MAX_DIR_DEPTH = 5;

/**
 * 团队知识库（`user_knowledge`，29 端点）服务 —— 对照 `routes.txt:737-765`。
 *
 * ## 与竞品的一处结构性偏离（必须知道）
 * 竞品有 `user_knowledge/create|info|info/update|update|delete|list` 6 条**知识库实体**端点
 * （`routes.txt:739-740`、`:757-759`、`:765`）—— 说明"知识库"是独立实体（一个空间可建多个）。
 * 我方数据层只有 `knowledge_dirs` / `knowledge_tags` / `knowledge_assets` 三张表
 * （schema.ts:2238-2292），**没有知识库实体表**，本批不能改 schema。所以我方语义是
 * **「一 space 一知识库」**（实体即 space 本身）：
 * - `create` / `update` / `delete` / `info/update` 4 条**无法照做** → 不做（不造假端点）；
 * - `info` 用三表聚合的概览实现（`GET /knowledge/info`）；
 * - `list` 用跨目录的平铺资产列表实现（`GET /knowledge/list`）。
 * → 已登记给 Lead：要照做需要 `knowledge_bases` 表 + `knowledge_dirs.base_id`。
 *
 * ## 删除策略（task 要求二选一，我方选「级联软删」）
 * 删目录时**级联软删**整棵子树与该子树下的资产（`deleted_at` 打点，行保留可恢复），
 * 而不是拒绝删除非空目录。理由：竞品目录/资产都是软删语义（schema.ts:2235-2237
 * 明确记录"竞品是软删"），拒绝删除会让"整理目录"变成一个逐层清空的苦活。
 * 前端删除确认框会显示将被影响的数量（`DELETE` 响应里返回 `dirs`/`assets` 计数）。
 */
@Injectable()
export class KnowledgeService {
  // ══════════════════════════════════════════════════════════
  // 一、目录树
  // ══════════════════════════════════════════════════════════

  /** 目录树（rt:755 `GET /dir/list`）：返回扁平列表 + 带 children 的树两份视图 */
  async dirTree(auth: AuthContext) {
    const spaceId = BigInt(auth.spaceId);
    const rows = await this.dirRows(spaceId);
    /** 每个目录的直属资产数：一次 group by 拿完，避免前端逐节点请求 */
    const counts = await this.assetCountByDir(spaceId);
    // asset_count 必须在**建树之前**写进节点：树是从同一批节点 clone 出来的，
    // 事后再 map 一遍只会改到扁平列表，树里的节点依旧没有这个字段（页面上会一律显示 0）。
    const nodes = rows.map((r) => ({
      id: String(r.id),
      parent_id: r.parentId ? String(r.parentId) : null,
      name: r.name,
      sort: r.sort,
      depth: 0,
      asset_count: counts.get(String(r.id)) ?? 0,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    }));
    const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [] as unknown[] }]));
    const roots: unknown[] = [];
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        (byId.get(node.parent_id)!.children as unknown[]).push(node);
      } else {
        roots.push(node);
      }
    }
    // depth 由结构推出来，不存库：改父目录后 depth 会变，存库就得写扩散更新
    const assignDepth = (list: unknown[], depth: number) => {
      for (const raw of list) {
        const node = raw as { depth: number; children: unknown[] };
        node.depth = depth;
        assignDepth(node.children, depth + 1);
      }
    };
    assignDepth(roots, 1);
    return {
      list: nodes,
      tree: roots,
      max_depth: KNOWLEDGE_MAX_DIR_DEPTH,
      count: nodes.length,
      /** 未挂目录的条目数（前端"未分类"节点用） */
      unclassified_assets: counts.get("__root__") ?? 0,
    };
  }

  /** 建目录（rt:741 `POST /dir`）：深度 ≤ 5，父子必须同 space */
  async createDir(auth: AuthContext, input: { name: string; parent_id?: string; sort?: number }) {
    const spaceId = BigInt(auth.spaceId);
    const name = input.name.trim();
    if (name.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "dir name must not be empty", { field: "name" });
    }
    return db.transaction(async (tx) => {
      let depth = 1;
      if (input.parent_id) {
        const parent = await this.requireDir(tx, spaceId, input.parent_id);
        depth = (await this.depthOf(tx, spaceId, String(parent.id))) + 1;
      }
      if (depth > KNOWLEDGE_MAX_DIR_DEPTH) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `directory depth must not exceed ${KNOWLEDGE_MAX_DIR_DEPTH}`,
          { field: "parent_id", depth },
        );
      }
      await this.assertDirNameFree(tx, spaceId, input.parent_id ?? null, name);
      const [row] = await tx
        .insert(knowledgeDirs)
        .values({
          id: newId(),
          spaceId,
          parentId: input.parent_id ? BigInt(input.parent_id) : null,
          name,
          sort: input.sort ?? 0,
        })
        .returning();
      return { dir: this.toDirDto(row!), depth };
    });
  }

  /** 改名（rt:750 `POST /dir/:ukd_id/name`） */
  async renameDir(auth: AuthContext, dirId: string, input: { name: string; sort?: number }) {
    const spaceId = BigInt(auth.spaceId);
    const name = input.name.trim();
    return db.transaction(async (tx) => {
      const dir = await this.requireDir(tx, spaceId, dirId);
      if (name.length === 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "dir name must not be empty", { field: "name" });
      }
      await this.assertDirNameFree(
        tx,
        spaceId,
        dir.parentId ? String(dir.parentId) : null,
        name,
        String(dir.id),
      );
      const [row] = await tx
        .update(knowledgeDirs)
        .set({ name, sort: input.sort ?? dir.sort, updatedAt: new Date() })
        .where(eq(knowledgeDirs.id, dir.id))
        .returning();
      return { dir: this.toDirDto(row!) };
    });
  }

  /**
   * 移动目录（rt:756 `POST /dir/{ukd_id}/move`）。
   *
   * 两条硬校验（漏掉任意一条都会产生"看不见的孤儿"或环）：
   * 1. 不能移到自己或自己的子孙下（环）；2. 移动后整棵子树的**最深叶子**不能超过 5 层。
   */
  async moveDir(auth: AuthContext, dirId: string, input: { parent_id?: string | null; sort?: number }) {
    const spaceId = BigInt(auth.spaceId);
    return db.transaction(async (tx) => {
      const dir = await this.requireDir(tx, spaceId, dirId);
      const targetParentId = input.parent_id ?? null;
      if (targetParentId === String(dir.id)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "cannot move a directory into itself", { field: "parent_id" });
      }
      const all = await this.dirRows(spaceId, tx);
      const descendants = this.descendantIds(all, String(dir.id));
      if (targetParentId && descendants.has(targetParentId)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "cannot move a directory into its own descendant", {
          field: "parent_id",
        });
      }
      const newDepth = targetParentId
        ? (await this.depthOf(tx, spaceId, targetParentId)) + 1
        : 1;
      const subtreeHeight = this.subtreeHeight(all, String(dir.id));
      if (newDepth + subtreeHeight - 1 > KNOWLEDGE_MAX_DIR_DEPTH) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `move would exceed max depth ${KNOWLEDGE_MAX_DIR_DEPTH}`,
          { field: "parent_id", resulting_depth: newDepth + subtreeHeight - 1 },
        );
      }
      if (targetParentId) {
        await this.assertDirNameFree(tx, spaceId, targetParentId, dir.name, String(dir.id));
      }
      const [row] = await tx
        .update(knowledgeDirs)
        .set({
          parentId: targetParentId ? BigInt(targetParentId) : null,
          sort: input.sort ?? dir.sort,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeDirs.id, dir.id))
        .returning();
      return { dir: this.toDirDto(row!) };
    });
  }

  /**
   * 删目录（rt:749 `DELETE /dir/:ukd_id`）—— **级联软删子树 + 子树内资产**。
   *
   * 返回 `dirs` / `assets` 两个受影响计数：前端确认框要能提前告诉用户"会删掉多少"，
   * 否则用户只能盲删（竞品同样无实体删除提示，属我方改进）。
   */
  async deleteDir(auth: AuthContext, dirId: string) {
    const spaceId = BigInt(auth.spaceId);
    return db.transaction(async (tx) => {
      const dir = await this.requireDir(tx, spaceId, dirId);
      const all = await this.dirRows(spaceId, tx);
      const subtree = new Set<string>([String(dir.id), ...this.descendantIds(all, String(dir.id))]);
      const ids = [...subtree].map((id) => BigInt(id));
      const now = new Date();
      const dirs = await tx
        .update(knowledgeDirs)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(inArray(knowledgeDirs.id, ids), isNull(knowledgeDirs.deletedAt)))
        .returning({ id: knowledgeDirs.id });
      const softDeletedAssets = await tx
        .update(knowledgeAssets)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(inArray(knowledgeAssets.dirId, ids), isNull(knowledgeAssets.deletedAt)))
        .returning({ id: knowledgeAssets.id });
      return {
        deleted: true,
        dir_id: String(dir.id),
        dirs: dirs.length,
        assets: softDeletedAssets.length,
        /** 级联范围（前端可展示"已一并删除 N 个子目录"） */
        cascaded_dir_ids: dirs.map((d) => String(d.id)),
      };
    });
  }

  // ══════════════════════════════════════════════════════════
  // 二、标签
  // ══════════════════════════════════════════════════════════

  /** 标签列表（rt:762 `GET /tag/list`）：带使用计数 */
  async listTags(auth: AuthContext) {
    const spaceId = BigInt(auth.spaceId);
    const rows = await db
      .select()
      .from(knowledgeTags)
      .where(eq(knowledgeTags.spaceId, spaceId))
      .orderBy(asc(knowledgeTags.name));
    const counts = await this.tagCounts(spaceId);
    return {
      list: rows.map((t) => ({
        id: String(t.id),
        name: t.name,
        asset_count: counts.get(t.name) ?? 0,
        /** 是否已被资产使用：为 false 的是"僵尸标签"，运营可放心清理 */
        in_use: (counts.get(t.name) ?? 0) > 0,
        created_at: t.createdAt.toISOString(),
      })),
      count: rows.length,
    };
  }

  /** 建标签（rt:761 `POST /tag`） */
  async createTag(auth: AuthContext, input: { name: string }) {
    const spaceId = BigInt(auth.spaceId);
    const name = input.name.trim();
    if (name.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "tag name must not be empty", { field: "name" });
    }
    const [row] = await db
      .insert(knowledgeTags)
      .values({ id: newId(), spaceId, name })
      .onConflictDoNothing({ target: [knowledgeTags.spaceId, knowledgeTags.name] })
      .returning();
    if (!row) {
      // 同名已存在：幂等返回（前端"回车即建标签"重复触发不该报错）
      const [existing] = await db
        .select()
        .from(knowledgeTags)
        .where(and(eq(knowledgeTags.spaceId, spaceId), eq(knowledgeTags.name, name)));
      return { tag: { id: String(existing!.id), name: existing!.name }, idempotent: true };
    }
    return { tag: { id: String(row.id), name: row.name }, idempotent: false };
  }

  /**
   * 标签改名（rt:764 `POST /tag/{tag_id}/name`）。
   *
   * 必须**同步改资产上的标签文本**：`knowledge_assets.tags` 存的是标签名数组
   * （schema.ts:2280），只改登记表会让历史资产挂着"已经不存在的标签名"，
   * 而按标签筛选又用不到——两边逐渐对不上。用 PG `array_replace` 原地替换。
   */
  async renameTag(auth: AuthContext, tagId: string, input: { name: string }) {
    const spaceId = BigInt(auth.spaceId);
    const name = input.name.trim();
    if (name.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "tag name must not be empty", { field: "name" });
    }
    return db.transaction(async (tx) => {
      const tag = await this.requireTag(tx, spaceId, tagId);
      if (tag.name === name) return { tag: { id: String(tag.id), name }, renamed_assets: 0 };
      const [conflict] = await tx
        .select({ id: knowledgeTags.id })
        .from(knowledgeTags)
        .where(and(eq(knowledgeTags.spaceId, spaceId), eq(knowledgeTags.name, name)));
      if (conflict) {
        throw new AppError(ErrorCode.INVALID_PARAM, "tag name already exists", { field: "name" });
      }
      const [row] = await tx
        .update(knowledgeTags)
        .set({ name })
        .where(eq(knowledgeTags.id, tag.id))
        .returning();
      const updated = await tx
        .update(knowledgeAssets)
        .set({
          tags: sql`array_replace(${knowledgeAssets.tags}, ${tag.name}, ${name})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeAssets.spaceId, spaceId),
            isNull(knowledgeAssets.deletedAt),
            sql`${tag.name} = any(${knowledgeAssets.tags})`,
          ),
        )
        .returning({ id: knowledgeAssets.id });
      return { tag: { id: String(row!.id), name: row!.name }, renamed_assets: updated.length };
    });
  }

  /** 删标签（rt:763 `DELETE /tag/{tag_id}/delete`）：同时从资产标签数组里摘掉 */
  async deleteTag(auth: AuthContext, tagId: string) {
    const spaceId = BigInt(auth.spaceId);
    return db.transaction(async (tx) => {
      const tag = await this.requireTag(tx, spaceId, tagId);
      await tx.delete(knowledgeTags).where(eq(knowledgeTags.id, tag.id));
      const updated = await tx
        .update(knowledgeAssets)
        .set({
          tags: sql`array_remove(${knowledgeAssets.tags}, ${tag.name})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeAssets.spaceId, spaceId),
            isNull(knowledgeAssets.deletedAt),
            sql`${tag.name} = any(${knowledgeAssets.tags})`,
          ),
        )
        .returning({ id: knowledgeAssets.id });
      return { deleted: true, id: String(tag.id), affected_assets: updated.length };
    });
  }

  /** 按标签查资产（我方补充：竞品无独立路由，标签筛选藏在 list/search 的 query 里） */
  async assetsByTag(auth: AuthContext, tagId: string, query: { page?: number; page_size?: number }) {
    const tag = await this.requireTag(db, BigInt(auth.spaceId), tagId);
    return this.listAssets(auth, { tags: [tag.name], ...query });
  }

  // ══════════════════════════════════════════════════════════
  // 三、资产
  // ══════════════════════════════════════════════════════════

  /** 资产列表（rt:746 `GET /dir/:ukd_id/asset/list`）：按目录过滤（含/不含子目录）、分页 */
  async listAssets(
    auth: AuthContext,
    query: {
      dir_id?: string;
      include_children?: boolean;
      tags?: string[];
      source_type?: number;
      page?: number;
      page_size?: number;
    },
  ) {
    const spaceId = BigInt(auth.spaceId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const conds = [eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)];
    if (query.dir_id) {
      const dir = await this.requireDir(db, spaceId, query.dir_id);
      if (query.include_children) {
        const all = await this.dirRows(spaceId);
        const subtree = [String(dir.id), ...this.descendantIds(all, String(dir.id))];
        conds.push(inArray(knowledgeAssets.dirId, subtree.map((id) => BigInt(id))));
      } else {
        conds.push(eq(knowledgeAssets.dirId, dir.id));
      }
    }
    if (query.source_type !== undefined) conds.push(eq(knowledgeAssets.sourceType, query.source_type));
    if (query.tags && query.tags.length > 0) {
      // 标签"且"语义，与集市筛选同口径
      conds.push(arrayContains(knowledgeAssets.tags, query.tags));
    }
    const where = and(...conds);
    const rows = await db
      .select({ asset: knowledgeAssets, dirName: knowledgeDirs.name, authorName: users.nickname })
      .from(knowledgeAssets)
      .leftJoin(knowledgeDirs, eq(knowledgeDirs.id, knowledgeAssets.dirId))
      .leftJoin(users, eq(users.id, knowledgeAssets.createdBy))
      .where(where)
      .orderBy(desc(knowledgeAssets.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(knowledgeAssets).where(where);
    const assetRefs = await this.resolveAssetRefs(rows.map((r) => r.asset));
    return {
      list: rows.map((r) => this.toAssetDto(r.asset, r.dirName, r.authorName, assetRefs.get(String(r.asset.id)))),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /**
   * 搜索（rt:737 `GET /asset/search`）：关键词命中标题或正文，可与标签/目录叠加。
   *
   * 与 `list` 分开保留，是因为竞品是两个端点（`:737` 与 `:746`）——
   * `search` 是跨目录的、`list` 是目录内的。
   */
  async searchAssets(
    auth: AuthContext,
    query: {
      keyword?: string;
      tags?: string[];
      dir_id?: string;
      source_type?: number;
      page?: number;
      page_size?: number;
    },
  ) {
    const spaceId = BigInt(auth.spaceId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const conds = [eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)];
    if (query.keyword && query.keyword.trim() !== "") {
      const kw = `%${query.keyword.trim()}%`;
      conds.push(or(ilike(knowledgeAssets.title, kw), ilike(knowledgeAssets.content, kw))!);
    }
    if (query.tags && query.tags.length > 0) conds.push(arrayContains(knowledgeAssets.tags, query.tags));
    if (query.source_type !== undefined) conds.push(eq(knowledgeAssets.sourceType, query.source_type));
    if (query.dir_id) {
      const dir = await this.requireDir(db, spaceId, query.dir_id);
      const all = await this.dirRows(spaceId);
      const subtree = [String(dir.id), ...this.descendantIds(all, String(dir.id))];
      conds.push(inArray(knowledgeAssets.dirId, subtree.map((id) => BigInt(id))));
    }
    const where = and(...conds);
    const rows = await db
      .select({ asset: knowledgeAssets, dirName: knowledgeDirs.name, authorName: users.nickname })
      .from(knowledgeAssets)
      .leftJoin(knowledgeDirs, eq(knowledgeDirs.id, knowledgeAssets.dirId))
      .leftJoin(users, eq(users.id, knowledgeAssets.createdBy))
      .where(where)
      .orderBy(desc(knowledgeAssets.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(knowledgeAssets).where(where);
    const assetRefs = await this.resolveAssetRefs(rows.map((r) => r.asset));
    return {
      list: rows.map((r) => this.toAssetDto(r.asset, r.dirName, r.authorName, assetRefs.get(String(r.asset.id)))),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
      keyword: query.keyword ?? "",
    };
  }

  /** 单条资产（无竞品独立路由；列表/搜索结果里点开需要它，归入 list 家族） */
  async assetDetail(auth: AuthContext, assetId: string) {
    const spaceId = BigInt(auth.spaceId);
    const row = await this.requireAsset(db, spaceId, assetId);
    const [dir] = row.dirId
      ? await db.select({ name: knowledgeDirs.name }).from(knowledgeDirs).where(eq(knowledgeDirs.id, row.dirId))
      : [{ name: null as string | null }];
    const [author] = row.createdBy
      ? await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, row.createdBy))
      : [{ nickname: null as string | null }];
    const refs = await this.resolveAssetRefs([row]);
    return { asset: this.toAssetDto(row, dir?.name ?? null, author?.nickname ?? null, refs.get(String(row.id))) };
  }

  /** 新建知识条目（rt:745 `POST /dir/:ukd_id/asset/import`）—— 纯文本/链接条目 */
  async createAsset(
    auth: AuthContext,
    input: {
      title: string;
      content?: string;
      dir_id?: string;
      tags?: string[];
      /** 1 文本 / 3 链接（2 资产引用走 import-from-asset，不从这里建） */
      source_type?: number;
    },
  ) {
    const spaceId = BigInt(auth.spaceId);
    const title = input.title.trim();
    if (title.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "title must not be empty", { field: "title" });
    }
    const sourceType = input.source_type ?? 1;
    if (sourceType === 2) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "source_type=2 (asset reference) must be created via POST /knowledge/assets/import-from-asset",
        { field: "source_type" },
      );
    }
    if (sourceType !== 1 && sourceType !== 3) {
      throw new AppError(ErrorCode.INVALID_PARAM, "source_type must be 1 or 3", { field: "source_type" });
    }
    if (sourceType === 3 && (!input.content || input.content.trim() === "")) {
      throw new AppError(ErrorCode.INVALID_PARAM, "link entry requires content (the URL)", { field: "content" });
    }
    const tags = await this.validateTags(BigInt(auth.spaceId), input.tags ?? []);
    if (input.dir_id) await this.requireDir(db, spaceId, input.dir_id);
    const [row] = await db
      .insert(knowledgeAssets)
      .values({
        id: newId(),
        spaceId,
        dirId: input.dir_id ? BigInt(input.dir_id) : null,
        title,
        content: input.content ?? null,
        tags,
        sourceType,
        createdBy: BigInt(auth.userId),
      })
      .returning();
    return { asset: this.toAssetDto(row!, null, null, undefined) };
  }

  /** 编辑资产（rt:743 `POST /dir/:ukd_id/asset/:uk_id/name` 扩展为通用编辑） */
  async patchAsset(
    auth: AuthContext,
    assetId: string,
    input: { title?: string; content?: string; dir_id?: string | null; tags?: string[] },
  ) {
    const spaceId = BigInt(auth.spaceId);
    const existing = await this.requireAsset(db, spaceId, assetId);
    if (input.dir_id) await this.requireDir(db, spaceId, input.dir_id);
    const tags = input.tags === undefined ? existing.tags : await this.validateTags(spaceId, input.tags);
    const [row] = await db
      .update(knowledgeAssets)
      .set({
        title: input.title !== undefined ? input.title.trim() : existing.title,
        content: input.content !== undefined ? input.content : existing.content,
        dirId: input.dir_id === undefined ? existing.dirId : input.dir_id ? BigInt(input.dir_id) : null,
        tags,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeAssets.id, existing.id))
      .returning();
    return { asset: this.toAssetDto(row!, null, null, undefined) };
  }

  /** 设置标签（rt:738 `POST /asset/{uk_id}/tag`）：**整体替换**语义 */
  async setAssetTags(auth: AuthContext, assetId: string, input: { tags: string[] }) {
    const spaceId = BigInt(auth.spaceId);
    const existing = await this.requireAsset(db, spaceId, assetId);
    const tags = await this.validateTags(spaceId, input.tags);
    const [row] = await db
      .update(knowledgeAssets)
      .set({ tags, updatedAt: new Date() })
      .where(eq(knowledgeAssets.id, existing.id))
      .returning();
    return { asset: this.toAssetDto(row!, null, null, undefined) };
  }

  /** 单条移动（批量移动的单元素形态，保留独立路由便于前端拖拽） */
  async moveAsset(auth: AuthContext, assetId: string, input: { dir_id?: string | null }) {
    const spaceId = BigInt(auth.spaceId);
    const existing = await this.requireAsset(db, spaceId, assetId);
    if (input.dir_id) await this.requireDir(db, spaceId, input.dir_id);
    const [row] = await db
      .update(knowledgeAssets)
      .set({ dirId: input.dir_id ? BigInt(input.dir_id) : null, updatedAt: new Date() })
      .where(eq(knowledgeAssets.id, existing.id))
      .returning();
    return { asset: this.toAssetDto(row!, null, null, undefined) };
  }

  /** 删除资产（rt:742 `DELETE /dir/:ukd_id/asset/:uk_id/delete`）：软删 */
  async deleteAsset(auth: AuthContext, assetId: string) {
    const spaceId = BigInt(auth.spaceId);
    const existing = await this.requireAsset(db, spaceId, assetId);
    const now = new Date();
    await db
      .update(knowledgeAssets)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(knowledgeAssets.id, existing.id));
    return { deleted: true, id: String(existing.id) };
  }

  // ══════════════════════════════════════════════════════════
  // 四、与资产库双向导入（必须校验同 space）
  // ══════════════════════════════════════════════════════════

  /**
   * 从资产库导入（rt:744-745 `.../asset/resource/import`、`.../asset/import`）。
   *
   * **同 space 校验是红线**：`assets.space_id` 必须等于当前 space，否则 403
   * （不泄露"这个 asset 是否存在"，用 403 而不是 404）。跨团队偷素材是这套
   * "团队级素材复用池"最容易出的越权。
   */
  async importFromAsset(
    auth: AuthContext,
    input: { asset_id: string; dir_id?: string; title?: string; tags?: string[] },
  ) {
    const spaceId = BigInt(auth.spaceId);
    const asset = await this.requireOwnAsset(spaceId, input.asset_id);
    if (input.dir_id) await this.requireDir(db, spaceId, input.dir_id);
    const tags = await this.validateTags(spaceId, input.tags ?? asset.tags ?? []);
    const [row] = await db
      .insert(knowledgeAssets)
      .values({
        id: newId(),
        spaceId,
        dirId: input.dir_id ? BigInt(input.dir_id) : null,
        assetId: asset.id,
        title: (input.title ?? asset.name ?? "").trim() || `资产 ${String(asset.id)}`,
        content: null,
        tags,
        sourceType: 2,
        createdBy: BigInt(auth.userId),
      })
      .returning();
    const refs = await this.resolveAssetRefs([row!]);
    return {
      asset: this.toAssetDto(row!, null, null, refs.get(String(row!.id))),
      source_asset: {
        id: String(asset.id),
        kind: asset.kind,
        uri: asset.uri,
        preview_uri: asset.previewUri,
        name: asset.name,
      },
    };
  }

  /**
   * 导出到资产库（rt:748 `.../asset/resources`）。
   *
   * 语义：把知识条目里引用的资产**另存为一条独立的资产库条目**（复制行），
   * 这样它可以脱离知识库目录被项目直接使用。
   * - 只有 `source_type=2`（资产引用）能导出：文本/链接没有二进制，
   *   而 `assets.kind` 的取值域是 image|video|audio（schema.ts:396）——不臆造 `text` 类型。
   * - 引用的资产必须是**同 space**（否则 403）：跨团队导出等于偷素材。
   */
  async exportToAsset(auth: AuthContext, assetId: string) {
    const spaceId = BigInt(auth.spaceId);
    const row = await this.requireAsset(db, spaceId, assetId);
    if (row.sourceType !== 2 || !row.assetId) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "only asset-reference entries (source_type=2) can be exported to the asset library; text/link entries have no binary",
        { field: "source_type", source_type: row.sourceType },
      );
    }
    const source = await this.requireOwnAsset(spaceId, String(row.assetId));
    const [created] = await db
      .insert(assets)
      .values({
        id: newId(),
        spaceId,
        kind: source.kind,
        uri: source.uri,
        previewUri: source.previewUri,
        name: row.title || source.name,
        tags: row.tags,
        meta: { exported_from: "knowledge", knowledge_asset_id: String(row.id) },
      })
      .returning();
    return {
      asset: {
        id: String(created!.id),
        kind: created!.kind,
        uri: created!.uri,
        preview_uri: created!.previewUri,
        name: created!.name,
        tags: created!.tags,
      },
      knowledge_asset_id: String(row.id),
      source_asset_id: String(source.id),
    };
  }

  /** 给已有条目挂/换资产引用（rt:744）：等价于把一条文本条目升级成资产引用 */
  async attachResource(auth: AuthContext, assetId: string, input: { asset_id: string }) {
    const spaceId = BigInt(auth.spaceId);
    const row = await this.requireAsset(db, spaceId, assetId);
    const asset = await this.requireOwnAsset(spaceId, input.asset_id);
    const [updated] = await db
      .update(knowledgeAssets)
      .set({ assetId: asset.id, sourceType: 2, updatedAt: new Date() })
      .where(eq(knowledgeAssets.id, row.id))
      .returning();
    const refs = await this.resolveAssetRefs([updated!]);
    return { asset: this.toAssetDto(updated!, null, null, refs.get(String(updated!.id))) };
  }

  /** 解除资产引用（rt:747 `DELETE /dir/:ukd_id/asset/resource/delete`）：降级回文本条目 */
  async detachResource(auth: AuthContext, assetId: string) {
    const spaceId = BigInt(auth.spaceId);
    const row = await this.requireAsset(db, spaceId, assetId);
    if (row.sourceType !== 2) {
      throw new AppError(ErrorCode.INVALID_PARAM, "this entry has no asset reference", { field: "source_type" });
    }
    const [updated] = await db
      .update(knowledgeAssets)
      .set({ assetId: null, sourceType: 1, updatedAt: new Date() })
      .where(eq(knowledgeAssets.id, row.id))
      .returning();
    return { asset: this.toAssetDto(updated!, null, null, undefined) };
  }

  // ══════════════════════════════════════════════════════════
  // 五、批量动作（rt:751-754 四条）
  // ══════════════════════════════════════════════════════════

  /** 批量加标签（rt:751 `POST /dir/asset/batch-add-tags`） */
  async batchAddTags(auth: AuthContext, input: { ids: string[]; tags: string[] }) {
    const spaceId = BigInt(auth.spaceId);
    const rows = await this.loadAssetsForBatch(spaceId, input.ids);
    const add = await this.validateTags(spaceId, input.tags);
    let changed = 0;
    for (const row of rows) {
      const merged = [...new Set([...row.tags, ...add])];
      if (merged.length === row.tags.length) continue;
      await db
        .update(knowledgeAssets)
        .set({ tags: merged, updatedAt: new Date() })
        .where(eq(knowledgeAssets.id, row.id));
      changed += 1;
    }
    return { requested: input.ids.length, found: rows.length, updated: changed, tags: add };
  }

  /** 批量去标签（rt:754 `POST /dir/asset/batch-remove-tags`） */
  async batchRemoveTags(auth: AuthContext, input: { ids: string[]; tags: string[] }) {
    const spaceId = BigInt(auth.spaceId);
    const rows = await this.loadAssetsForBatch(spaceId, input.ids);
    const remove = new Set(input.tags);
    let changed = 0;
    for (const row of rows) {
      const next = row.tags.filter((t) => !remove.has(t));
      if (next.length === row.tags.length) continue;
      await db
        .update(knowledgeAssets)
        .set({ tags: next, updatedAt: new Date() })
        .where(eq(knowledgeAssets.id, row.id));
      changed += 1;
    }
    return { requested: input.ids.length, found: rows.length, updated: changed };
  }

  /** 批量移动（rt:753 `POST /dir/asset/batch-move`） */
  async batchMove(auth: AuthContext, input: { ids: string[]; dir_id?: string | null }) {
    const spaceId = BigInt(auth.spaceId);
    const rows = await this.loadAssetsForBatch(spaceId, input.ids);
    if (input.dir_id) await this.requireDir(db, spaceId, input.dir_id);
    if (rows.length === 0) return { requested: input.ids.length, found: 0, updated: 0 };
    const updated = await db
      .update(knowledgeAssets)
      .set({ dirId: input.dir_id ? BigInt(input.dir_id) : null, updatedAt: new Date() })
      .where(inArray(knowledgeAssets.id, rows.map((r) => r.id)))
      .returning({ id: knowledgeAssets.id });
    return { requested: input.ids.length, found: rows.length, updated: updated.length, dir_id: input.dir_id ?? null };
  }

  /** 批量删除（rt:752 `POST /dir/asset/batch-delete`）：软删 */
  async batchDelete(auth: AuthContext, input: { ids: string[] }) {
    const spaceId = BigInt(auth.spaceId);
    const rows = await this.loadAssetsForBatch(spaceId, input.ids);
    if (rows.length === 0) return { requested: input.ids.length, found: 0, deleted: 0 };
    const now = new Date();
    const updated = await db
      .update(knowledgeAssets)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(knowledgeAssets.id, rows.map((r) => r.id)))
      .returning({ id: knowledgeAssets.id });
    return { requested: input.ids.length, found: rows.length, deleted: updated.length };
  }

  // ══════════════════════════════════════════════════════════
  // 六、概览 / 平铺列表 / 创建人聚合
  // ══════════════════════════════════════════════════════════

  /** 知识库概览（rt:757 `GET /info`）—— 我方"一 space 一知识库"，故用聚合实现 */
  async info(auth: AuthContext) {
    const spaceId = BigInt(auth.spaceId);
    const [dirAgg] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeDirs)
      .where(and(eq(knowledgeDirs.spaceId, spaceId), isNull(knowledgeDirs.deletedAt)));
    const [assetAgg] = await db
      .select({
        count: sql<number>`count(*)::int`,
        text: sql<number>`(count(*) filter (where ${knowledgeAssets.sourceType} = 1))::int`,
        ref: sql<number>`(count(*) filter (where ${knowledgeAssets.sourceType} = 2))::int`,
        link: sql<number>`(count(*) filter (where ${knowledgeAssets.sourceType} = 3))::int`,
      })
      .from(knowledgeAssets)
      .where(and(eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)));
    const [tagAgg] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeTags)
      .where(eq(knowledgeTags.spaceId, spaceId));
    const byDir = await this.assetCountByDir(spaceId);
    return {
      scope: "space",
      note: "我方为「一 space 一知识库」；竞品的多知识库实体表尚未建（见 knowledge.service.ts 顶部说明）",
      dir_count: dirAgg?.count ?? 0,
      asset_count: assetAgg?.count ?? 0,
      tag_count: tagAgg?.count ?? 0,
      asset_by_source_type: {
        text: assetAgg?.text ?? 0,
        asset_reference: assetAgg?.ref ?? 0,
        link: assetAgg?.link ?? 0,
      },
      max_dir_depth: KNOWLEDGE_MAX_DIR_DEPTH,
      unclassified_assets: byDir.get("__root__") ?? 0,
    };
  }

  /** 平铺列表（rt:759 `GET /list`）：跨目录一次拉全，供"最近更新/全局搜索"用 */
  async flatList(auth: AuthContext, query: { page?: number; page_size?: number; sort?: "created" | "updated" }) {
    const spaceId = BigInt(auth.spaceId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const order = query.sort === "created" ? desc(knowledgeAssets.createdAt) : desc(knowledgeAssets.updatedAt);
    const rows = await db
      .select({ asset: knowledgeAssets, dirName: knowledgeDirs.name, authorName: users.nickname })
      .from(knowledgeAssets)
      .leftJoin(knowledgeDirs, eq(knowledgeDirs.id, knowledgeAssets.dirId))
      .leftJoin(users, eq(users.id, knowledgeAssets.createdBy))
      .where(and(eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)))
      .orderBy(order)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeAssets)
      .where(and(eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)));
    const refs = await this.resolveAssetRefs(rows.map((r) => r.asset));
    return {
      list: rows.map((r) => this.toAssetDto(r.asset, r.dirName, r.authorName, refs.get(String(r.asset.id)))),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /**
   * 编剧列表（rt:760 `GET /scriptwriter/list`）：按创建人聚合。
   *
   * 竞品该端点服务于知识库的"按编剧筛选"。我方没有"编剧"这个角色
   * （`space_members.role_code` 里有 `project_screenwriter`，但知识库资产只记
   * `created_by`），所以实现为**按创建人聚合**，字段名保留 `scriptwriter`
   * 以便前端 1:1 对照；语义差异登记在回报里。
   */
  async scriptwriterList(auth: AuthContext) {
    const spaceId = BigInt(auth.spaceId);
    const rows = await db
      .select({
        userId: knowledgeAssets.createdBy,
        nickname: users.nickname,
        count: sql<number>`count(*)::int`,
        lastAt: sql<Date>`max(${knowledgeAssets.updatedAt})`,
      })
      .from(knowledgeAssets)
      .leftJoin(users, eq(users.id, knowledgeAssets.createdBy))
      .where(and(eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)))
      .groupBy(knowledgeAssets.createdBy, users.nickname);
    return {
      list: rows
        .filter((r) => r.userId !== null)
        .map((r) => ({
          user_id: String(r.userId),
          nickname: r.nickname ?? "",
          asset_count: r.count,
          last_updated_at: r.lastAt ? new Date(r.lastAt).toISOString() : null,
        }))
        .sort((a, b) => b.asset_count - a.asset_count),
      count: rows.length,
      note: "按创建人聚合；竞品语义为「编剧」，我方无该角色枚举（见回报待取证）",
    };
  }

  // ══════════════════════════════════════════════════════════
  // 七、内部工具
  // ══════════════════════════════════════════════════════════

  private async dirRows(spaceId: bigint, tx?: Tx): Promise<DirRow[]> {
    const runner = tx ?? db;
    return runner
      .select()
      .from(knowledgeDirs)
      .where(and(eq(knowledgeDirs.spaceId, spaceId), isNull(knowledgeDirs.deletedAt)))
      .orderBy(asc(knowledgeDirs.sort), asc(knowledgeDirs.id));
  }

  private async requireDir(runner: Tx | typeof db, spaceId: bigint, dirId: string): Promise<DirRow> {
    let id: bigint;
    try {
      id = BigInt(dirId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid dir id", { field: "dir_id" });
    }
    const [row] = await runner
      .select()
      .from(knowledgeDirs)
      .where(and(eq(knowledgeDirs.id, id), eq(knowledgeDirs.spaceId, spaceId), isNull(knowledgeDirs.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "knowledge dir not found", { field: "dir_id" });
    return row;
  }

  /** 目录深度（根=1）。逐级向上走：目录树最多 5 层，最多 5 次查询，比递归 CTE 更好读 */
  private async depthOf(runner: Tx | typeof db, spaceId: bigint, dirId: string): Promise<number> {
    let current = await this.requireDir(runner, spaceId, dirId);
    let depth = 1;
    while (current.parentId && depth < 64) {
      const [parent] = await runner
        .select()
        .from(knowledgeDirs)
        .where(eq(knowledgeDirs.id, current.parentId));
      if (!parent) break;
      current = parent;
      depth += 1;
    }
    return depth;
  }

  private descendantIds(all: DirRow[], rootId: string): Set<string> {
    const childrenOf = new Map<string, string[]>();
    for (const row of all) {
      if (!row.parentId) continue;
      const key = String(row.parentId);
      const list = childrenOf.get(key) ?? [];
      list.push(String(row.id));
      childrenOf.set(key, list);
    }
    const out = new Set<string>();
    const queue = [...(childrenOf.get(rootId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (out.has(id)) continue;
      out.add(id);
      queue.push(...(childrenOf.get(id) ?? []));
    }
    return out;
  }

  /** 子树高度（自己算 1 层） */
  private subtreeHeight(all: DirRow[], rootId: string): number {
    const childrenOf = new Map<string, string[]>();
    for (const row of all) {
      if (!row.parentId) continue;
      const key = String(row.parentId);
      childrenOf.set(key, [...(childrenOf.get(key) ?? []), String(row.id)]);
    }
    const walk = (id: string): number => {
      const kids = childrenOf.get(id) ?? [];
      if (kids.length === 0) return 1;
      return 1 + Math.max(...kids.map(walk));
    };
    return walk(rootId);
  }

  /** 同父目录下不允许同名（否则前端树里两个一样的名字，用户无法区分） */
  private async assertDirNameFree(
    tx: Tx,
    spaceId: bigint,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ) {
    const parentCond = parentId ? eq(knowledgeDirs.parentId, BigInt(parentId)) : isNull(knowledgeDirs.parentId);
    const rows = await tx
      .select({ id: knowledgeDirs.id })
      .from(knowledgeDirs)
      .where(
        and(
          eq(knowledgeDirs.spaceId, spaceId),
          eq(knowledgeDirs.name, name),
          isNull(knowledgeDirs.deletedAt),
          parentCond,
        ),
      );
    const clash = rows.find((r) => String(r.id) !== excludeId);
    if (clash) {
      throw new AppError(ErrorCode.INVALID_PARAM, "a directory with the same name already exists here", {
        field: "name",
      });
    }
  }

  private async requireTag(runner: Tx | typeof db, spaceId: bigint, tagId: string) {
    let id: bigint;
    try {
      id = BigInt(tagId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid tag id", { field: "tag_id" });
    }
    const [row] = await runner
      .select()
      .from(knowledgeTags)
      .where(and(eq(knowledgeTags.id, id), eq(knowledgeTags.spaceId, spaceId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "knowledge tag not found", { field: "tag_id" });
    return row;
  }

  /**
   * 校验标签名都在本 space 的标签登记表里（未知标签 → 400101）。
   *
   * 为什么不在资产写入时**自动建标签**：标签登记表是"团队共享词表"，
   * 自动建会让错别字变成永久标签（"人设" vs "人设图"），且无法清理。
   * 前端交互是"输入框下拉选择已有标签 + 先去标签页建新标签"。
   */
  private async validateTags(spaceId: bigint, tags: string[]): Promise<string[]> {
    const names = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))];
    if (names.length === 0) return [];
    const rows = await db
      .select({ name: knowledgeTags.name })
      .from(knowledgeTags)
      .where(and(eq(knowledgeTags.spaceId, spaceId), inArray(knowledgeTags.name, names)));
    const known = new Set(rows.map((r) => r.name));
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length > 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, `unknown tags: ${unknown.join(", ")}`, {
        field: "tags",
        unknown_tags: unknown,
        hint: "create tags first via POST /knowledge/tags",
      });
    }
    return names;
  }

  private async requireAsset(runner: Tx | typeof db, spaceId: bigint, assetId: string): Promise<AssetRow> {
    let id: bigint;
    try {
      id = BigInt(assetId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid asset id", { field: "id" });
    }
    const [row] = await runner
      .select()
      .from(knowledgeAssets)
      .where(
        and(
          eq(knowledgeAssets.id, id),
          eq(knowledgeAssets.spaceId, spaceId),
          isNull(knowledgeAssets.deletedAt),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "knowledge asset not found", { field: "id" });
    return row;
  }

  /**
   * 资产库条目必须属于**当前 space**（跨 space → 403）。
   *
   * 用 403 而不是 404：这不是"不存在"，而是"存在但你不能用"，
   * 前端需要区分"素材已被删除"与"没权限"两种提示。
   */
  private async requireOwnAsset(spaceId: bigint, assetId: string) {
    let id: bigint;
    try {
      id = BigInt(assetId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid asset_id", { field: "asset_id" });
    }
    const [row] = await db.select().from(assets).where(eq(assets.id, id));
    if (!row || row.deletedAt) {
      throw new AppError(ErrorCode.NOT_FOUND, "asset not found", { field: "asset_id" });
    }
    if (row.spaceId !== spaceId) {
      throw new AppError(ErrorCode.FORBIDDEN, "asset belongs to another space", {
        field: "asset_id",
        reason: "cross_space_asset",
      });
    }
    return row;
  }

  private async loadAssetsForBatch(spaceId: bigint, ids: string[]): Promise<AssetRow[]> {
    if (ids.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "ids must not be empty", { field: "ids" });
    }
    if (ids.length > 200) {
      throw new AppError(ErrorCode.INVALID_PARAM, "at most 200 ids per batch", { field: "ids" });
    }
    let bigIds: bigint[];
    try {
      bigIds = ids.map((id) => BigInt(id));
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid id in ids", { field: "ids" });
    }
    return db
      .select()
      .from(knowledgeAssets)
      .where(
        and(
          eq(knowledgeAssets.spaceId, spaceId),
          isNull(knowledgeAssets.deletedAt),
          inArray(knowledgeAssets.id, bigIds),
        ),
      );
  }

  private async assetCountByDir(spaceId: bigint): Promise<Map<string, number>> {
    const rows = await db
      .select({ dirId: knowledgeAssets.dirId, count: sql<number>`count(*)::int` })
      .from(knowledgeAssets)
      .where(and(eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)))
      .groupBy(knowledgeAssets.dirId);
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.dirId ? String(row.dirId) : "__root__", row.count);
    }
    return map;
  }

  private async tagCounts(spaceId: bigint): Promise<Map<string, number>> {
    const rows = await db
      .select({ tags: knowledgeAssets.tags })
      .from(knowledgeAssets)
      .where(and(eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)));
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return counts;
  }

  /** 批量取 source_type=2 条目引用的资产（避免每条一次查询） */
  private async resolveAssetRefs(rows: AssetRow[]) {
    const ids = rows
      .map((r) => r.assetId)
      .filter((id): id is bigint => id !== null)
      .map((id) => id);
    if (ids.length === 0) return new Map<string, { id: string; kind: string; uri: string; preview_uri: string | null; name: string }>();
    const refs = await db
      .select({ id: assets.id, kind: assets.kind, uri: assets.uri, previewUri: assets.previewUri, name: assets.name })
      .from(assets)
      .where(inArray(assets.id, ids));
    const byAssetId = new Map(refs.map((r) => [String(r.id), r]));
    const out = new Map<string, { id: string; kind: string; uri: string; preview_uri: string | null; name: string }>();
    for (const row of rows) {
      if (!row.assetId) continue;
      const hit = byAssetId.get(String(row.assetId));
      if (!hit) continue;
      out.set(String(row.id), {
        id: String(hit.id),
        kind: hit.kind,
        uri: hit.uri,
        preview_uri: hit.previewUri,
        name: hit.name,
      });
    }
    return out;
  }

  private toDirDto(row: DirRow) {
    return {
      id: String(row.id),
      parent_id: row.parentId ? String(row.parentId) : null,
      name: row.name,
      sort: row.sort,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private toAssetDto(
    row: AssetRow,
    dirName?: string | null,
    authorName?: string | null,
    ref?: { id: string; kind: string; uri: string; preview_uri: string | null; name: string },
  ) {
    return {
      id: String(row.id),
      dir_id: row.dirId ? String(row.dirId) : null,
      dir_name: dirName ?? null,
      asset_id: row.assetId ? String(row.assetId) : null,
      title: row.title,
      content: row.content,
      tags: row.tags,
      source_type: row.sourceType,
      source_type_name: row.sourceType === 2 ? "资产引用" : row.sourceType === 3 ? "链接" : "文本",
      created_by: row.createdBy ? String(row.createdBy) : null,
      created_by_name: authorName ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      /** source_type=2 时给出资产库条目的展示信息（前端直接渲染缩略图/链接） */
      resource: ref ?? null,
    };
  }
}
