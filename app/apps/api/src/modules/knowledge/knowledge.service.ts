import { Inject, Injectable } from "@nestjs/common";
import { and, arrayContains, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { assets, knowledgeAssets, knowledgeBases, knowledgeDirs, knowledgeTags, users } from "@app/db";
import type { Tx } from "@app/db";
import {
  AppError,
  ErrorCode,
  isKnowledgeScene,
  isKnowledgeStatus,
  isKnowledgeUseType,
  KNOWLEDGE_SCENE_SLUG,
  KNOWLEDGE_STATUS,
  KNOWLEDGE_STATUS_VALUES,
  KNOWLEDGE_USE_TYPE,
  KNOWLEDGE_USE_TYPE_VALUES,
  knowledgeCoverAssetId,
  knowledgeSceneRule,
  newId,
  validateKnowledgeSceneFields,
} from "@app/shared";
import { db } from "../../db/database";
import { toBigId } from "../../common/bigid";
import type { AuthContext } from "../../common/auth.types";
import { StorageService } from "../../storage/storage.service";

type DirRow = typeof knowledgeDirs.$inferSelect;
type AssetRow = typeof knowledgeAssets.$inferSelect;
type BaseRow = typeof knowledgeBases.$inferSelect;

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
 * ## 第 59 批修正的一处误判（原注释写错了，留档）
 * 原注释说「竞品有 6 条知识库实体端点 → 说明一个空间可建多个库 → 我方不做」。
 * 复核 `routes.txt` 才发现：`create`(:739) / `delete`(:740) / `update`(:765) /
 * `info/update`(:758) **这 4 条全都没有路径 id**，而同一文件的目录端点都带
 * `dir/:ukd_id`、资产端点都带 `asset/{uk_id}`。要改/删"多个库中的某一个"必须有 id
 * → 没有 id 只能解释为**当前空间唯一的那个库**。所以竞品语义就是「一 team 一库」，
 * 我方缺的不是"产品定义"，而是**这一库的元数据压根没落库**（名称/简介/封面/说明）。
 *
 * 第 59 批据此补 `knowledge_bases` 表（schema.ts）与 4 条端点（实体读取走
 * `GET /knowledge/base`；`info` 仍是聚合口径，另在返回值里带上实体块）。
 * 目录/标签/资产**不加 `base_id`**：一空间一库时它恒等于 space_id，加了就有两个
 * 真相来源（删库重建后旧目录会静默挂到已软删的库上）。理由见 schema 该表注释。
 *
 * ## 删除策略（task 要求二选一，我方选「级联软删」）
 * 删目录时**级联软删**整棵子树与该子树下的资产（`deleted_at` 打点，行保留可恢复），
 * 而不是拒绝删除非空目录。理由：竞品目录/资产都是软删语义（schema.ts:2235-2237
 * 明确记录"竞品是软删"），拒绝删除会让"整理目录"变成一个逐层清空的苦活。
 * 前端删除确认框会显示将被影响的数量（`DELETE` 响应里返回 `dirs`/`assets` 计数）。
 */
@Injectable()
export class KnowledgeService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  // ══════════════════════════════════════════════════════════
  // 一、目录树
  // ══════════════════════════════════════════════════════════

  /**
   * 目录树（rt:755 `GET /dir/list`）：返回扁平列表 + 带 children 的树两份视图。
   *
   * 第 60 批：accepts `?scene=`（竞品该端点的 query 就是 `["scene","parent_ukd_id"]`）。
   * 不传就返回**全部场景**的目录 —— 这是为了不破坏本批之前的调用方；
   * 前端 tab 一定要传，否则"音色"tab 里会看到风格目录。
   */
  async dirTree(auth: AuthContext, query: { scene?: number } = {}) {
    const spaceId = BigInt(auth.spaceId);
    const scene = this.normalizeScene(query.scene);
    const rows = await this.dirRows(spaceId, undefined, scene);
    /** 每个目录的直属资产数：一次 group by 拿完，避免前端逐节点请求 */
    const counts = await this.assetCountByDir(spaceId, scene);
    // asset_count 必须在**建树之前**写进节点：树是从同一批节点 clone 出来的，
    // 事后再 map 一遍只会改到扁平列表，树里的节点依旧没有这个字段（页面上会一律显示 0）。
    const nodes = rows.map((r) => ({
      id: String(r.id),
      scene: r.scene,
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

  /** 建目录（rt:741 `POST /dir`）：深度 ≤ 5，父子必须同 space；场景从父目录继承 */
  async createDir(
    auth: AuthContext,
    input: { name: string; parent_id?: string; sort?: number; scene?: number },
  ) {
    const spaceId = BigInt(auth.spaceId);
    const name = input.name.trim();
    if (name.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "dir name must not be empty", { field: "name" });
    }
    return db.transaction(async (tx) => {
      let depth = 1;
      // 场景以父目录为准：子目录跳到别的场景会让"风格/音色"两棵树混在一起
      let scene = this.normalizeScene(input.scene) ?? 0;
      if (input.parent_id) {
        const parent = await this.requireDir(tx, spaceId, input.parent_id);
        depth = (await this.depthOf(tx, spaceId, String(parent.id))) + 1;
        scene = parent.scene;
      }
      if (depth > KNOWLEDGE_MAX_DIR_DEPTH) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `directory depth must not exceed ${KNOWLEDGE_MAX_DIR_DEPTH}`,
          { field: "parent_id", depth },
        );
      }
      await this.assertDirNameFree(tx, spaceId, input.parent_id ?? null, name, scene);
      const [row] = await tx
        .insert(knowledgeDirs)
        .values({
          id: newId(),
          spaceId,
          scene,
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
        dir.scene,
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
        // 移动不跨场景：换场景等于换一棵树，语义上应"重新建一条"而不是偷偷搬走
        await this.assertDirNameFree(tx, spaceId, targetParentId, dir.name, dir.scene, String(dir.id));
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

  /**
   * 标签列表（rt:762 `GET /tag/list`）：带使用计数。
   *
   * 第 60 批：竞品该端点 query 是 `["scene","query"]` —— 标签按场景隔离，
   * 所以 `?scene=` 同时过滤登记表与使用计数（否则"风格"tab 的计数会把音色资产的用量算进来）。
   */
  async listTags(auth: AuthContext, query: { scene?: number } = {}) {
    const spaceId = BigInt(auth.spaceId);
    const scene = this.normalizeScene(query.scene);
    const conds = [eq(knowledgeTags.spaceId, spaceId)];
    if (scene !== undefined) conds.push(eq(knowledgeTags.scene, scene));
    const rows = await db
      .select()
      .from(knowledgeTags)
      .where(and(...conds))
      .orderBy(asc(knowledgeTags.name));
    const counts = await this.tagCounts(spaceId, scene);
    return {
      list: rows.map((t) => ({
        id: String(t.id),
        name: t.name,
        scene: t.scene,
        asset_count: counts.get(t.name) ?? 0,
        /** 是否已被资产使用：为 false 的是"僵尸标签"，运营可放心清理 */
        in_use: (counts.get(t.name) ?? 0) > 0,
        created_at: t.createdAt.toISOString(),
      })),
      count: rows.length,
    };
  }

  /** 建标签（rt:761 `POST /tag`）：场景内唯一 */
  async createTag(auth: AuthContext, input: { name: string; scene?: number }) {
    const spaceId = BigInt(auth.spaceId);
    const name = input.name.trim();
    const scene = this.normalizeScene(input.scene) ?? 0;
    if (name.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "tag name must not be empty", { field: "name" });
    }
    const [row] = await db
      .insert(knowledgeTags)
      .values({ id: newId(), spaceId, scene, name })
      .onConflictDoNothing({ target: [knowledgeTags.spaceId, knowledgeTags.scene, knowledgeTags.name] })
      .returning();
    if (!row) {
      // 同场景同名已存在：幂等返回（前端"回车即建标签"重复触发不该报错）
      const [existing] = await db
        .select()
        .from(knowledgeTags)
        .where(
          and(eq(knowledgeTags.spaceId, spaceId), eq(knowledgeTags.scene, scene), eq(knowledgeTags.name, name)),
        );
      return { tag: { id: String(existing!.id), name: existing!.name, scene: existing!.scene }, idempotent: true };
    }
    return { tag: { id: String(row.id), name: row.name, scene: row.scene }, idempotent: false };
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
        .where(
          and(
            eq(knowledgeTags.spaceId, spaceId),
            eq(knowledgeTags.scene, tag.scene),
            eq(knowledgeTags.name, name),
          ),
        );
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
            eq(knowledgeAssets.scene, tag.scene),
            isNull(knowledgeAssets.deletedAt),
            sql`${tag.name} = any(${knowledgeAssets.tags})`,
          ),
        )
        .returning({ id: knowledgeAssets.id });
      return { tag: { id: String(row!.id), name: row!.name, scene: row!.scene }, renamed_assets: updated.length };
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
            eq(knowledgeAssets.scene, tag.scene),
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

  /** 资产列表（rt:746 `GET /dir/:ukd_id/asset/list`）：按目录过滤（含/不含子目录）、分页；可叠加场景 */
  async listAssets(
    auth: AuthContext,
    query: {
      dir_id?: string;
      include_children?: boolean;
      tags?: string[];
      source_type?: number;
      scene?: number;
      /** 第 75 批：竞品列表的 status 列可筛（1 启用 / 2 停用） */
      status?: number;
      /** 第 75 批：竞品 `use_type`（1 官方 / 2 团队） */
      use_type?: number;
      /** 第 75 批：竞品列表请求里的 `sp_type: [-1,1,2,3]`（多值） */
      sp_type?: number[];
      /** 第 75 批：竞品列表请求里的 `res_type`（单值） */
      res_type?: number;
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
    // 第 60 批：竞品 `asset/search` 的 query 里 scene 是必填维度，缺失就分不出"风格/音色"
    const listScene = this.normalizeScene(query.scene);
    if (listScene !== undefined) conds.push(eq(knowledgeAssets.scene, listScene));
    // 第 75 批：启停/归属/来源类型的筛选（与 search 共用同一段，见 entryFilters）
    conds.push(...this.entryFilters(query));
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
      // 第 75 批：先按竞品 `sort`（0 表示未排序，此时与旧行为一致按创建时间倒序）
      .orderBy(asc(knowledgeAssets.sort), desc(knowledgeAssets.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(knowledgeAssets).where(where);
    const assetRefs = await this.resolveAssetRefs(rows.map((r) => r.asset));
    const covers = await this.resolveCovers(rows.map((r) => r.asset), spaceId);
    return {
      list: rows.map((r) =>
        this.toAssetDto(r.asset, r.dirName, r.authorName, assetRefs.get(String(r.asset.id)), covers.get(String(r.asset.id))),
      ),
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
      scene?: number;
      /** 第 75 批：与 list 同口径的启停/归属/来源类型筛选 */
      status?: number;
      use_type?: number;
      sp_type?: number[];
      res_type?: number;
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
    const searchScene = this.normalizeScene(query.scene);
    if (searchScene !== undefined) conds.push(eq(knowledgeAssets.scene, searchScene));
    // 第 75 批：与 list 共用同一套条目级筛选
    conds.push(...this.entryFilters(query));
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
    const covers = await this.resolveCovers(rows.map((r) => r.asset), spaceId);
    return {
      list: rows.map((r) =>
        this.toAssetDto(r.asset, r.dirName, r.authorName, assetRefs.get(String(r.asset.id)), covers.get(String(r.asset.id))),
      ),
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
    const covers = await this.resolveCovers([row], spaceId);
    return {
      asset: this.toAssetDto(row, dir?.name ?? null, author?.nickname ?? null, refs.get(String(row.id)), covers.get(String(row.id))),
    };
  }

  /**
   * 新建知识条目（rt:745 `POST /dir/:ukd_id/asset/import`）—— 纯文本/链接条目。
   *
   * 第 60 批：加 `scene`（模板场景）与**按场景的字段规则校验**。
   * 竞品每条知识库记录就是"某类模板"（风格/音色/提示词…），每类的 name 上限、
   * prompt 是否必填与上限都不同（见 `KNOWLEDGE_SCENE_RULES`），
   * 所以 `title`/`content` 的合法性依赖 scene，不能只靠 zod 的固定上限。
   */
  async createAsset(
    auth: AuthContext,
    input: {
      title: string;
      content?: string;
      dir_id?: string;
      tags?: string[];
      /** 模板场景（竞品枚举值）；不传 = 0 未分类 */
      scene?: number;
      /** 1 文本 / 3 链接（2 资产引用走 import-from-asset，不从这里建） */
      source_type?: number;
      /** 第 75 批：竞品 `cover_file`；不传则读时回落 `image_asset_ids` 首图 */
      cover_asset_id?: string | null;
      /** 第 75 批：竞品 `image_files` */
      image_asset_ids?: string[];
      /** 第 75 批：竞品 `use_type`（1 官方 / 2 团队），默认 2 团队 */
      use_type?: number;
      /** 第 75 批：竞品 `status`（1 启用 / 2 停用），默认 1 启用 */
      status?: number;
      /** 第 75 批：竞品 `sp_type`，默认 0（语义未取证，仅透传） */
      sp_type?: number;
      /** 第 75 批：竞品 `res_type`，默认 0（语义未取证，仅透传 + 可筛） */
      res_type?: number;
      /** 第 75 批：竞品 `meta_data`（竞品发 JSON 字符串，我方收对象、落 jsonb） */
      meta_data?: Record<string, unknown> | null;
      /** 第 75 批：竞品 `sort`，默认 0 */
      sort?: number;
    },
  ) {
    const spaceId = BigInt(auth.spaceId);
    const title = input.title.trim();
    const scene = this.normalizeScene(input.scene) ?? 0;
    if (title.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "title must not be empty", { field: "title" });
    }
    // 第 75 批：先解析条目级资产引用（封面/配图）——封面是否必填依赖 scene 规则，
    // 所以必须在 validateKnowledgeSceneFields 之前拿到它们。
    const entryAssets = await this.resolveEntryAssets(spaceId, {
      cover_asset_id: input.cover_asset_id,
      image_asset_ids: input.image_asset_ids,
    });
    const sceneError = validateKnowledgeSceneFields(scene, {
      title,
      content: input.content ?? null,
      coverAssetId: entryAssets.coverAssetId ? String(entryAssets.coverAssetId) : null,
      imageAssetIds: entryAssets.imageAssetIds?.map((id) => String(id)),
    });
    if (sceneError) {
      throw new AppError(ErrorCode.INVALID_PARAM, sceneError.message, { field: sceneError.field, scene });
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
    const useType = input.use_type ?? KNOWLEDGE_USE_TYPE.TEAM;
    if (!isKnowledgeUseType(useType)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `use_type must be one of ${KNOWLEDGE_USE_TYPE_VALUES.join(",")}`, { field: "use_type" });
    }
    const status = input.status ?? KNOWLEDGE_STATUS.ENABLED;
    if (!isKnowledgeStatus(status)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `status must be one of ${KNOWLEDGE_STATUS_VALUES.join(",")}`, { field: "status" });
    }
    const tags = await this.validateTags(BigInt(auth.spaceId), input.tags ?? [], scene);
    if (input.dir_id) {
      const dir = await this.requireDir(db, spaceId, input.dir_id);
      // 目录与条目的场景必须一致，否则"风格"目录里会出现音色条目，tab 一筛就消失
      if (dir.scene !== scene) {
        throw new AppError(ErrorCode.INVALID_PARAM, "dir belongs to a different scene", {
          field: "dir_id",
          dir_scene: dir.scene,
          scene,
        });
      }
    }
    const [row] = await db
      .insert(knowledgeAssets)
      .values({
        id: newId(),
        spaceId,
        scene,
        dirId: input.dir_id ? BigInt(input.dir_id) : null,
        title,
        content: input.content ?? null,
        tags,
        sourceType,
        // 第 75 批：条目级字段（竞品 payload 的 cover_file / image_files / use_type /
        // status / sp_type / meta_data / sort）。默认值与竞品一致：团队归属、启用、不计排序。
        coverAssetId: entryAssets.coverAssetId ?? null,
        imageAssetIds: entryAssets.imageAssetIds ?? [],
        useType,
        status,
        spType: input.sp_type ?? 0,
        resType: input.res_type ?? 0,
        metaData: input.meta_data ?? null,
        sort: input.sort ?? 0,
        createdBy: BigInt(auth.userId),
      })
      .returning();
    // 第 75 批：新建后立刻解析封面 URL（否则调用方拿到 null 还要再查一次列表）
    const covers = await this.resolveCovers([row!], BigInt(auth.spaceId));
    return { asset: this.toAssetDto(row!, null, null, undefined, covers.get(String(row!.id))) };
  }

  /**
   * 编辑资产（rt:743 `POST /dir/:ukd_id/asset/:uk_id/name` 扩展为通用编辑）。
   *
   * 第 75 批：可改条目级字段（封面/配图/归属/启停/sp_type/meta_data/sort）。
   * 语义统一为「传了才改」：`undefined` 不动、`null` 清空（仅 cover_asset_id / meta_data /
   * dir_id 这类可空字段），数组字段传 `[]` 表示清空。校验器拿**合并后的值**判场景规则，
   * 否则「本来有封面、这次只改标题」会被误判成缺封面。
   */
  async patchAsset(
    auth: AuthContext,
    assetId: string,
    input: {
      title?: string;
      content?: string;
      dir_id?: string | null;
      tags?: string[];
      scene?: number;
      cover_asset_id?: string | null;
      image_asset_ids?: string[];
      use_type?: number;
      status?: number;
      sp_type?: number;
      res_type?: number;
      meta_data?: Record<string, unknown> | null;
      sort?: number;
    },
  ) {
    const spaceId = BigInt(auth.spaceId);
    const existing = await this.requireAsset(db, spaceId, assetId);
    const scene = input.scene === undefined ? existing.scene : (this.normalizeScene(input.scene) ?? existing.scene);
    const nextTitle = input.title !== undefined ? input.title.trim() : existing.title;
    const nextContent = input.content !== undefined ? input.content : existing.content;
    const entryAssets = await this.resolveEntryAssets(spaceId, {
      cover_asset_id: input.cover_asset_id,
      image_asset_ids: input.image_asset_ids,
    });
    const nextCover = entryAssets.coverAssetId === undefined ? existing.coverAssetId : entryAssets.coverAssetId;
    const nextImages = entryAssets.imageAssetIds === undefined ? existing.imageAssetIds : entryAssets.imageAssetIds;
    const sceneError = validateKnowledgeSceneFields(scene, {
      title: nextTitle,
      content: nextContent,
      coverAssetId: nextCover ? String(nextCover) : null,
      imageAssetIds: nextImages.map((id) => String(id)),
    });
    if (sceneError) {
      throw new AppError(ErrorCode.INVALID_PARAM, sceneError.message, { field: sceneError.field, scene });
    }
    if (input.use_type !== undefined && !isKnowledgeUseType(input.use_type)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `use_type must be one of ${KNOWLEDGE_USE_TYPE_VALUES.join(",")}`, {
        field: "use_type",
      });
    }
    if (input.status !== undefined && !isKnowledgeStatus(input.status)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `status must be one of ${KNOWLEDGE_STATUS_VALUES.join(",")}`, {
        field: "status",
      });
    }
    if (input.dir_id) {
      const dir = await this.requireDir(db, spaceId, input.dir_id);
      if (dir.scene !== scene) {
        throw new AppError(ErrorCode.INVALID_PARAM, "dir belongs to a different scene", {
          field: "dir_id",
          dir_scene: dir.scene,
          scene,
        });
      }
    }
    const tags = input.tags === undefined ? existing.tags : await this.validateTags(spaceId, input.tags, scene);
    const [row] = await db
      .update(knowledgeAssets)
      .set({
        title: nextTitle,
        content: nextContent,
        scene,
        dirId: input.dir_id === undefined ? existing.dirId : input.dir_id ? BigInt(input.dir_id) : null,
        tags,
        coverAssetId: nextCover,
        imageAssetIds: nextImages,
        useType: input.use_type ?? existing.useType,
        status: input.status ?? existing.status,
        spType: input.sp_type ?? existing.spType,
        resType: input.res_type ?? existing.resType,
        metaData: input.meta_data === undefined ? existing.metaData : input.meta_data,
        sort: input.sort ?? existing.sort,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeAssets.id, existing.id))
      .returning();
    const covers = await this.resolveCovers([row!], BigInt(auth.spaceId));
    return { asset: this.toAssetDto(row!, null, null, undefined, covers.get(String(row!.id))) };
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

  /**
   * 知识库概览（rt:757 `GET /info`）—— 三个聚合计数 + **第 59 批起带上库实体**。
   *
   * 竞品把 `info`（概览）与 `info/update`（改概览）分成两条；实体本身的名称/简介在
   * `update` 里。我方保持 1:1 形状：`info` 返回 counts + `base` 实体块，页面一次拿全。
   */
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
    // 第 60 批：按场景分布（竞品 tab 上会显示每类有多少条，前端不必为每个 tab 各请求一次 list）
    const sceneRows = await db
      .select({ scene: knowledgeAssets.scene, count: sql<number>`count(*)::int` })
      .from(knowledgeAssets)
      .where(and(eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)))
      .groupBy(knowledgeAssets.scene);
    const assetByScene: Record<string, number> = {};
    for (const row of sceneRows) assetByScene[String(row.scene)] = row.count;
    // 老空间（第 6 批就上线的）没有库行，这里懒初始化一行，否则页面拿不到名称
    const baseRow = await this.ensureBase(spaceId, BigInt(auth.userId));
    return {
      base: this.toBaseDto(baseRow),
      scope: "space",
      dir_count: dirAgg?.count ?? 0,
      asset_count: assetAgg?.count ?? 0,
      tag_count: tagAgg?.count ?? 0,
      asset_by_source_type: {
        text: assetAgg?.text ?? 0,
        asset_reference: assetAgg?.ref ?? 0,
        link: assetAgg?.link ?? 0,
      },
      /** 按模板场景的条目数，key 为 scene 值字符串（"0"=未分类） */
      asset_by_scene: assetByScene,
      max_dir_depth: KNOWLEDGE_MAX_DIR_DEPTH,
      unclassified_assets: byDir.get("__root__") ?? 0,
    };
  }

  /** 平铺列表（rt:759 `GET /list`）：跨目录一次拉全，供"最近更新/全局搜索"用；可叠加场景 */
  async flatList(
    auth: AuthContext,
    query: { page?: number; page_size?: number; sort?: "created" | "updated"; scene?: number },
  ) {
    const spaceId = BigInt(auth.spaceId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const order = query.sort === "created" ? desc(knowledgeAssets.createdAt) : desc(knowledgeAssets.updatedAt);
    const conds = [eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)];
    const scene = this.normalizeScene(query.scene);
    if (scene !== undefined) conds.push(eq(knowledgeAssets.scene, scene));
    const where = and(...conds);
    const rows = await db
      .select({ asset: knowledgeAssets, dirName: knowledgeDirs.name, authorName: users.nickname })
      .from(knowledgeAssets)
      .leftJoin(knowledgeDirs, eq(knowledgeDirs.id, knowledgeAssets.dirId))
      .leftJoin(users, eq(users.id, knowledgeAssets.createdBy))
      .where(where)
      .orderBy(order)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeAssets)
      .where(where);
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
  // 七、知识库实体（第 59 批）—— 竞品 4 条实体端点
  // ══════════════════════════════════════════════════════════

  /**
   * 当前空间的知识库实体（内部读，不存在则按需创建）。
   *
   * 为什么"读"也要能写：竞品 `create`(:739) 是显式创建端点，但**我方存量空间已经有
   * 目录/标签/资产数据**（第 6 批就上线了）。若 GET 在库不存在时报 404，这批老空间的
   * 知识库页面会立刻白屏 —— 唯一能自愈的做法是首次读时按默认值补一行（懒初始化）。
   * 所以 `create` 对老空间是幂等 no-op（返回已存在那行），只对"删过又重建"才有意义。
   */
  private async ensureBase(spaceId: bigint, userId?: bigint) {
    const existing = await this.findBase(db, spaceId);
    if (existing) return existing;
    const [created] = await db
      .insert(knowledgeBases)
      .values({ id: newId(), spaceId, createdBy: userId ?? null })
      /**
       * **不能**写 `onConflictDoNothing({ target: knowledgeBases.spaceId })`。
       *
       * 这里挡冲突的是**偏唯一索引** `uq_knowledge_bases_space ... where deleted_at is null`；
       * PostgreSQL 的 `ON CONFLICT (col)` 推断要求索引谓词完全一致且能被列集合推断，
       * 偏索引推不出来 → 会直接报 `42P10 there is no unique or exclusion constraint
       * matching the ON CONFLICT specification`（这条 SQL 是真的跑过才发现的，不是理论担忧）。
       * 不带 target 的 `ON CONFLICT DO NOTHING` 对任意唯一约束生效，才等价于"并发撞了就回读"。
       */
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    // 并发下另一个请求刚插进去（偏唯一索引只挡活行）：回读那一行
    const raced = await this.findBase(db, spaceId);
    if (!raced) throw new AppError(ErrorCode.INTERNAL, "knowledge base init failed");
    return raced;
  }

  private async findBase(runner: Tx | typeof db, spaceId: bigint): Promise<BaseRow | undefined> {
    const [row] = await runner
      .select()
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.spaceId, spaceId), isNull(knowledgeBases.deletedAt)));
    return row;
  }

  /** 知识库实体（rt:757 `GET /info` 的实体部分；我方 `GET /knowledge/base`） */
  async baseInfo(auth: AuthContext) {
    const spaceId = BigInt(auth.spaceId);
    const row = await this.ensureBase(spaceId, BigInt(auth.userId));
    return { base: this.toBaseDto(row) };
  }

  /**
   * 建库（rt:739 `POST /create`）—— 一 space 一库，已存在则幂等返回。
   *
   * 语义提醒：竞品该端点大概率为"首次建档"，我方把"已存在"处理成 0 而非 400102：
   * 前端页头"新建知识库"按钮在老空间上应是"打开知识库"，不该弹错误。
   */
  async createBase(auth: AuthContext, input: { name?: string; description?: string; cover_uri?: string }) {
    const spaceId = BigInt(auth.spaceId);
    const existing = await this.findBase(db, spaceId);
    if (existing) {
      return { base: this.toBaseDto(existing), created: false };
    }
    const [created] = await db
      .insert(knowledgeBases)
      .values({
        id: newId(),
        spaceId,
        name: input.name?.trim() || "团队知识库",
        description: input.description?.trim() ?? "",
        coverUri: input.cover_uri?.trim() ?? "",
        createdBy: BigInt(auth.userId),
      })
      .onConflictDoNothing()
      .returning();
    if (created) return { base: this.toBaseDto(created), created: true };
    const raced = await this.findBase(db, spaceId);
    if (!raced) throw new AppError(ErrorCode.INTERNAL, "knowledge base create failed");
    return { base: this.toBaseDto(raced), created: false };
  }

  /**
   * 改名（rt:765 `POST /update`）—— 只管**库名**。
   *
   * 与 `info/update` 的分工：这条对应竞品的"改名"动作（与 `dir/:ukd_id/name`、
   * `tag/{tag_id}/name` 同族）；简介/封面/提示文案全归 `info/update`。
   * 这样拆的好处是改名可以做成页头双击就地编辑（只提交一个字段），
   * 不会因为表单里其他字段是空串而把简介清掉。
   */
  async updateBase(auth: AuthContext, input: { name: string }) {
    const spaceId = BigInt(auth.spaceId);
    const row = await this.ensureBase(spaceId, BigInt(auth.userId));
    const name = input.name.trim();
    if (name.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "base name must not be empty", { field: "name" });
    }
    const [updated] = await db
      .update(knowledgeBases)
      .set({ name, updatedAt: new Date() })
      .where(eq(knowledgeBases.id, row.id))
      .returning();
    return { base: this.toBaseDto(updated!) };
  }

  /**
   * 改概览信息（rt:758 `POST /info/update`）—— 简介 / 封面 / 给成员的操作提示。
   *
   * 三个字段都是"传了才改"：不传表示不动，避免整段覆盖（前端表单一提交就把没编辑的
   * 字段清空是这类接口最常见的线上事故）。
   */
  async updateInfo(auth: AuthContext, input: { description?: string; cover_uri?: string; note?: string }) {
    const spaceId = BigInt(auth.spaceId);
    const row = await this.ensureBase(spaceId, BigInt(auth.userId));
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.description !== undefined) patch.description = input.description;
    if (input.cover_uri !== undefined) patch.coverUri = input.cover_uri;
    if (input.note !== undefined) patch.note = input.note;
    const [updated] = await db
      .update(knowledgeBases)
      .set(patch)
      .where(eq(knowledgeBases.id, row.id))
      .returning();
    return { base: this.toBaseDto(updated!) };
  }

  /**
   * 删库（rt:740 `POST /delete`）—— **软删库本身，不动目录/标签/资产**（`purge` 才级联）。
   *
   * 为什么默认不级联：竞品把 `delete` 与 `dir/:ukd_id/delete` 分成两条端点，
   * 说明"删库"与"删目录"是两种意图；把删库做成级联，用户点一下就没了几百条资产
   * （且软删行仍占空间）。所以默认只软删库行；要清内容必须显式 `purge=true`。
   * 删后目录/标签/资产**原地保留**：重建库时它们自动重新可见（都是按 space_id 归组的
   * ——这也是一 space 一库的时候不给 dir 加 base_id 的好处）。
   */
  async deleteBase(auth: AuthContext, input: { purge?: boolean }) {
    const spaceId = BigInt(auth.spaceId);
    const row = await this.findBase(db, spaceId);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "knowledge base not found");
    return db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(knowledgeBases)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(knowledgeBases.id, row.id));
      if (!input.purge) {
        return { deleted: true, base_id: String(row.id), purged: false, dirs: 0, assets: 0 };
      }
      /**
       * purge：软删全部目录/资产 + 物理删标签。
       *
       * 标签为什么物理删：`knowledge_tags` 上有 `uq_knowledge_tags(space_id, name)`，
       * 软删会让"重建库后建同名标签"撞唯一索引（而不像目录/资产那样有 `deleted_at`
       * 参与查询条件）。它们的唯一消费者就是本空间的库，库都不要了，行没有留存价值。
       */
      const dirs = await tx
        .update(knowledgeDirs)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(knowledgeDirs.spaceId, spaceId), isNull(knowledgeDirs.deletedAt)))
        .returning({ id: knowledgeDirs.id });
      const assetRows = await tx
        .update(knowledgeAssets)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)))
        .returning({ id: knowledgeAssets.id });
      const tags = await tx
        .delete(knowledgeTags)
        .where(eq(knowledgeTags.spaceId, spaceId))
        .returning({ id: knowledgeTags.id });
      return {
        deleted: true,
        base_id: String(row.id),
        purged: true,
        dirs: dirs.length,
        assets: assetRows.length,
        tags: tags.length,
      };
    });
  }

  private toBaseDto(row: BaseRow) {
    return {
      id: String(row.id),
      space_id: String(row.spaceId),
      name: row.name,
      description: row.description,
      cover_uri: row.coverUri,
      note: row.note,
      created_by: row.createdBy ? String(row.createdBy) : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  // ══════════════════════════════════════════════════════════
  // 八、内部工具
  // ══════════════════════════════════════════════════════════

  private async dirRows(spaceId: bigint, tx?: Tx, scene?: number): Promise<DirRow[]> {
    const runner = tx ?? db;
    const conds = [eq(knowledgeDirs.spaceId, spaceId), isNull(knowledgeDirs.deletedAt)];
    if (scene !== undefined) conds.push(eq(knowledgeDirs.scene, scene));
    return runner
      .select()
      .from(knowledgeDirs)
      .where(and(...conds))
      .orderBy(asc(knowledgeDirs.sort), asc(knowledgeDirs.id));
  }

  /**
   * 第 75 批：条目级筛选（`status` / `use_type` / `sp_type` / `res_type`）。
   *
   * `listAssets` 与 `searchAssets` **共用这一段**：竞品这两个端点的筛选参数是同一套
   * （`C-jRJshu.js` @10127 的列表请求 `{scene, sp_type:[-1,1,2,3], use_type, status, res_type}`），
   * 各自内联一份迟早漂移（第 71 批就吃过「两个 spec 各写一份断言」的苦）。
   *
   * `sp_type` / `res_type` 我们只验证「是非负整数」，不枚举合法值 —— 竞品自身的取值集合
   * 只在知识库列表请求里出现过 `[-1,1,2,3]`（`sp_type`），`res_type` 连这层都没有；
   * 硬编码枚举会把竞品新增的类型直接打成 400。
   */
  private entryFilters(query: { status?: number; use_type?: number; sp_type?: number[]; res_type?: number }): SQL[] {
    const conds: SQL[] = [];
    if (query.status !== undefined) {
      if (!isKnowledgeStatus(query.status)) {
        throw new AppError(ErrorCode.INVALID_PARAM, `status must be one of ${KNOWLEDGE_STATUS_VALUES.join("/")}`, {
          field: "status",
        });
      }
      conds.push(eq(knowledgeAssets.status, query.status));
    }
    if (query.use_type !== undefined) {
      if (!isKnowledgeUseType(query.use_type)) {
        throw new AppError(ErrorCode.INVALID_PARAM, `use_type must be one of ${KNOWLEDGE_USE_TYPE_VALUES.join("/")}`, {
          field: "use_type",
        });
      }
      conds.push(eq(knowledgeAssets.useType, query.use_type));
    }
    if (query.sp_type && query.sp_type.length > 0) {
      for (const value of query.sp_type) {
        if (!Number.isInteger(value) || value < -1 || value > 32767) {
          throw new AppError(ErrorCode.INVALID_PARAM, "sp_type must be integers between -1 and 32767", {
            field: "sp_type",
          });
        }
      }
      conds.push(inArray(knowledgeAssets.spType, query.sp_type));
    }
    if (query.res_type !== undefined) {
      if (!Number.isInteger(query.res_type) || query.res_type < 0 || query.res_type > 32767) {
        throw new AppError(ErrorCode.INVALID_PARAM, "res_type must be an integer between 0 and 32767", {
          field: "res_type",
        });
      }
      conds.push(eq(knowledgeAssets.resType, query.res_type));
    }
    return conds;
  }

  /** 场景入参归一：缺省 → undefined（=不按场景过滤），非法值 → 400101 */
  private normalizeScene(scene: number | undefined): number | undefined {
    if (scene === undefined || scene === null) return undefined;
    if (!isKnowledgeScene(scene)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "unknown knowledge scene", { field: "scene" });
    }
    return scene;
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

  /**
   * 同场景 + 同父目录下不允许同名（否则前端树里两个一样的名字，用户无法区分）。
   *
   * 第 60 批：错误码改 `KNOWLEDGE_NAME_EXISTS(747007)`，文案对齐竞品原文
   * `"knowledge name already exists"`（竞品前端就是靠这个码 + 这句文案识别重名的，
   * 换成 400101 会让按竞品写的客户端拿不到可判定的分支）。
   * 同名判定加 `scene` 维度：不同场景的两棵目录树互不干扰。
   */
  private async assertDirNameFree(
    tx: Tx,
    spaceId: bigint,
    parentId: string | null,
    name: string,
    scene: number,
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
          eq(knowledgeDirs.scene, scene),
          isNull(knowledgeDirs.deletedAt),
          parentCond,
        ),
      );
    const clash = rows.find((r) => String(r.id) !== excludeId);
    if (clash) {
      throw new AppError(ErrorCode.KNOWLEDGE_NAME_EXISTS, "knowledge name already exists", {
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
  private async validateTags(spaceId: bigint, tags: string[], scene?: number): Promise<string[]> {
    const names = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))];
    if (names.length === 0) return [];
    const conds = [eq(knowledgeTags.spaceId, spaceId), inArray(knowledgeTags.name, names)];
    // 标签按场景隔离后，别的场景的同名标签不算"本场景已知标签"
    if (scene !== undefined) conds.push(eq(knowledgeTags.scene, scene));
    const rows = await db
      .select({ name: knowledgeTags.name })
      .from(knowledgeTags)
      .where(and(...conds));
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

  /**
   * 解析条目级资产引用（第 75 批：竞品 `cover_file` / `image_files`）。
   *
   * 三态语义（与 patch 的「传了才改」一致）：
   * - `undefined` → 返回 undefined，表示**不动**这个字段；
   * - `null`（仅封面）→ 返回 null，表示**清空**；
   * - 字符串/数组 → 校验后返回 bigint。
   *
   * 校验两条：① id 形状（`toBigId`，非法 400101，字段名报给调用方）；
   * ② **必须属于当前 space 且未删**（跨空间引用等于把别人的素材挂到自己知识库，
   * 用 400102 而不是 400101 —— 不告诉调用方"这个 id 在别处存在"）。
   * 配图上限 20 张（竞品无上限证据，取与其它素材数组同量级）。
   */
  private async resolveEntryAssets(
    spaceId: bigint,
    input: { cover_asset_id?: string | null; image_asset_ids?: string[] },
  ): Promise<{ coverAssetId?: bigint | null; imageAssetIds?: bigint[] }> {
    const out: { coverAssetId?: bigint | null; imageAssetIds?: bigint[] } = {};
    if (input.image_asset_ids !== undefined) {
      if (input.image_asset_ids.length > 20) {
        throw new AppError(ErrorCode.INVALID_PARAM, "image_asset_ids must contain at most 20 ids", {
          field: "image_asset_ids",
        });
      }
      out.imageAssetIds = input.image_asset_ids.map((raw) => toBigId(raw, "image_asset_ids"));
    }
    if (input.cover_asset_id !== undefined) {
      out.coverAssetId = input.cover_asset_id === null ? null : toBigId(input.cover_asset_id, "cover_asset_id");
    }
    const wanted = [
      ...(out.coverAssetId ? [out.coverAssetId] : []),
      ...(out.imageAssetIds ?? []),
    ];
    if (wanted.length > 0) {
      const unique = [...new Set(wanted.map((id) => String(id)))].map((id) => BigInt(id));
      const found = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(inArray(assets.id, unique), eq(assets.spaceId, spaceId), isNull(assets.deletedAt)));
      const foundIds = new Set(found.map((r) => String(r.id)));
      const missing = wanted.map((id) => String(id)).filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new AppError(ErrorCode.NOT_FOUND, `assets not found in this space: ${missing.join(",")}`, {
          field: input.cover_asset_id !== undefined && out.coverAssetId ? "cover_asset_id" : "image_asset_ids",
        });
      }
    }
    return out;
  }

  /**
   * 批量解析封面 URL（第 75 批）。取 `cover_asset_id`，为空时回落 `image_asset_ids[0]`
   * —— 与竞品 `cover_file: k || y[0] || ""` 同口径（见 `knowledgeCoverAssetId()`）。
   * 图片资源在私有桶里，所以统一签名 1 小时；签名失败就留空（前端退回占位图），
   * 不让一条资源的存储异常把整页列表打成 500。
   */
  private async resolveCovers(
    rows: AssetRow[],
    spaceId: bigint,
  ): Promise<Map<string, string>> {
    const wanted = rows
      .map((r) => ({ key: String(r.id), assetId: knowledgeCoverAssetId(r) }))
      .filter((x): x is { key: string; assetId: bigint } => x.assetId !== null);
    if (wanted.length === 0) return new Map();
    const ids = [...new Set(wanted.map((x) => String(x.assetId)))].map((id) => BigInt(id));
    const refs = await db
      .select({ id: assets.id, uri: assets.uri })
      .from(assets)
      .where(
        and(
          inArray(assets.id, ids),
          eq(assets.spaceId, spaceId),
          isNull(assets.deletedAt),
        ),
      );
    const uriById = new Map(refs.map((r) => [String(r.id), r.uri]));
    const out = new Map<string, string>();
    for (const item of wanted) {
      const uri = uriById.get(String(item.assetId));
      if (!uri) continue;
      const signed = await this.storage
        .signDownload(String(spaceId), uri, 3600)
        .catch(() => null);
      if (signed) out.set(item.key, signed);
    }
    return out;
  }

  private async assetCountByDir(spaceId: bigint, scene?: number): Promise<Map<string, number>> {
    const conds = [eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)];
    if (scene !== undefined) conds.push(eq(knowledgeAssets.scene, scene));
    const rows = await db
      .select({ dirId: knowledgeAssets.dirId, count: sql<number>`count(*)::int` })
      .from(knowledgeAssets)
      .where(and(...conds))
      .groupBy(knowledgeAssets.dirId);
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.dirId ? String(row.dirId) : "__root__", row.count);
    }
    return map;
  }

  private async tagCounts(spaceId: bigint, scene?: number): Promise<Map<string, number>> {
    const conds = [eq(knowledgeAssets.spaceId, spaceId), isNull(knowledgeAssets.deletedAt)];
    if (scene !== undefined) conds.push(eq(knowledgeAssets.scene, scene));
    const rows = await db
      .select({ tags: knowledgeAssets.tags })
      .from(knowledgeAssets)
      .where(and(...conds));
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
      scene: row.scene,
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
    coverUrl?: string,
  ) {
    const rule = knowledgeSceneRule(row.scene);
    /** 封面实际来源（0/1 交由前端判断是否显示「自动取首图」提示） */
    const effectiveCoverId = knowledgeCoverAssetId(row);
    return {
      id: String(row.id),
      /** 模板场景（竞品枚举值，见 shared 的 KNOWLEDGE_SCENE） */
      scene: row.scene,
      scene_slug: row.scene === 0 ? "" : (KNOWLEDGE_SCENE_SLUG[row.scene] ?? ""),
      /** 该场景的字段规则，前端据此决定是否必填/显示哪些列（竞品也是每类不同的表头） */
      scene_name_max_length: rule.nameMaxLength,
      scene_prompt_required: rule.promptRequired,
      scene_prompt_max_length: rule.promptMaxLength,
      scene_prompt_column: rule.promptColumn,
      scene_cover_required: rule.coverRequired,
      dir_id: row.dirId ? String(row.dirId) : null,
      dir_name: dirName ?? null,
      asset_id: row.assetId ? String(row.assetId) : null,
      title: row.title,
      content: row.content,
      tags: row.tags,
      source_type: row.sourceType,
      source_type_name: row.sourceType === 2 ? "资产引用" : row.sourceType === 3 ? "链接" : "文本",
      // ── 第 75 批：竞品条目级字段 ──────────────────────────────────
      /** 人工指定的封面（竞品 `cover_file`）；为空不代表没封面，见 `cover_uri` */
      cover_asset_id: row.coverAssetId ? String(row.coverAssetId) : null,
      /** 实际渲染用的封面 URL：人工封面优先，否则回落 `image_asset_ids[0]`（竞品同口径） */
      cover_uri: coverUrl ?? null,
      /** 封面是否为"自动取首图"（供前端显示提示，省得前端自己再判一次） */
      cover_is_fallback: !row.coverAssetId && Boolean(effectiveCoverId),
      /** 配图组（竞品 `image_files`）；元素无外键，若素材被删前端会拿不到图 */
      image_asset_ids: row.imageAssetIds.map((id) => String(id)),
      /** 归属：1 官方 / 2 团队（竞品 `use_type`） */
      use_type: row.useType,
      use_type_name: row.useType === KNOWLEDGE_USE_TYPE.OFFICIAL ? "官方" : "团队",
      /** 启停：1 启用 / 2 停用（竞品 `status`） */
      status: row.status,
      status_name: row.status === KNOWLEDGE_STATUS.DISABLED ? "停用" : "启用",
      /** 竞品 `sp_type` 透传（语义未取证，不在业务里解释） */
      sp_type: row.spType,
      /** 竞品 `res_type` 透传（列表请求里当筛选用，语义未取证） */
      res_type: row.resType,
      /** 竞品 `meta_data` 在网络上是 JSON 字符串，我方落 jsonb、出对象（刻意偏离，见 schema 注释） */
      meta_data: row.metaData ?? null,
      /** 竞品 `sort` */
      sort: row.sort,
      created_by: row.createdBy ? String(row.createdBy) : null,
      created_by_name: authorName ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      /** source_type=2 时给出资产库条目的展示信息（前端直接渲染缩略图/链接） */
      resource: ref ?? null,
    };
  }
}
