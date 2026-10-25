import { Injectable, Inject } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  canvasEdges,
  canvasGroups,
  canvasNodes,
  canvasSnapshots,
  canvases,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { RedisService } from "../../redis/redis.service";

/**
 * 画布（canvas）域服务 —— F1 契约 §12.1 / §14.4
 *
 * 三条硬语义（错了会静默腐化数据）：
 * 1. **版本冲突**：画布级与节点级都用乐观锁，客户端提交必须带 version；
 *    不匹配 → 746002（VERSION_CONFLICT），绝不静默覆盖别人的编辑。
 * 2. **节点锁**：走 Redis，TTL 30s，靠 heartbeat/renew 续期；被他人持锁 → 746003（NODE_LOCKED）。
 *    锁**不落库**（§7 既有决策）。
 * 3. **节点派生任务**：一律写 `canvas_nodes.task_id` 指向既有 `tasks`，
 *    **禁止另造任务表**（ADR-003）。
 */

/** 11 种节点类型（硬约束，§12.1.2；与 cli-skill/.../node.md:45 逐字一致） */
export const CANVAS_NODE_TYPES = [
  "text",
  "image",
  "video",
  "audio",
  "table",
  "script",
  "asset",
  "clip",
  "director",
  "threeDWorld",
  "group",
] as const;
export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number];

const LOCK_TTL_S = 30;
const HEARTBEAT_TTL_S = 60;

@Injectable()
export class CanvasService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  // ── 画布本体 ─────────────────────────────────────────────
  async create(spaceId: string, userId: string, input: { title?: string; creation_mode?: number; episode_id?: string }) {
    const id = newId();
    await db.insert(canvases).values({
      id,
      spaceId: BigInt(spaceId),
      title: input.title?.trim() || "未命名画布",
      creationMode: input.creation_mode ?? 2,
      episodeId: input.episode_id ? BigInt(input.episode_id) : null,
      ownerUserId: BigInt(userId),
      lastEditedAt: new Date(),
    });
    return { id: String(id), version: 1 };
  }

  async list(spaceId: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const rows = await db
      .select()
      .from(canvases)
      .where(and(eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)))
      .orderBy(desc(canvases.updatedAt))
      .limit(ps)
      .offset((p - 1) * ps);
    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(canvases)
      .where(and(eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)));
    return {
      list: rows.map((c) => ({
        id: String(c.id),
        title: c.title,
        version: c.version,
        creation_mode: c.creationMode,
        episode_id: c.episodeId ? String(c.episodeId) : null,
        pinned_node_id: c.pinnedNodeId ? String(c.pinnedNodeId) : null,
        last_edited_at: c.lastEditedAt?.toISOString() ?? null,
        updated_at: c.updatedAt.toISOString(),
      })),
      total: cnt?.n ?? 0,
      page: p,
      page_size: ps,
    };
  }

  /** 取画布详情（含节点/边/分组，供前端一次性渲染） */
  async get(spaceId: string, canvasId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [nodes, edges, groups] = await Promise.all([
      db
        .select()
        .from(canvasNodes)
        .where(and(eq(canvasNodes.canvasId, canvas.id), isNull(canvasNodes.deletedAt)))
        .orderBy(asc(canvasNodes.zIndex), asc(canvasNodes.id)),
      db.select().from(canvasEdges).where(eq(canvasEdges.canvasId, canvas.id)),
      db.select().from(canvasGroups).where(eq(canvasGroups.canvasId, canvas.id)).orderBy(asc(canvasGroups.sort)),
    ]);
    return {
      canvas: {
        id: String(canvas.id),
        title: canvas.title,
        version: canvas.version,
        creation_mode: canvas.creationMode,
        episode_id: canvas.episodeId ? String(canvas.episodeId) : null,
        pinned_node_id: canvas.pinnedNodeId ? String(canvas.pinnedNodeId) : null,
      },
      nodes: nodes.map(this.toNodeDto),
      edges: edges.map((e) => ({
        id: String(e.id),
        src_node_id: String(e.srcNodeId),
        dst_node_id: String(e.dstNodeId),
        semantic: e.semantic,
      })),
      groups: groups.map((g) => ({
        id: String(g.id),
        parent_id: g.parentId ? String(g.parentId) : null,
        name: g.name,
        sort: g.sort,
        status: g.status,
      })),
    };
  }

  async rename(spaceId: string, canvasId: string, input: { title: string; version?: number }) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (input.version !== undefined && input.version !== canvas.version) {
      throw this.versionConflict(`canvas version mismatch (current ${canvas.version})`);
    }
    await db
      .update(canvases)
      .set({ title: input.title.trim() || canvas.title, version: canvas.version + 1, lastEditedAt: new Date(), updatedAt: new Date() })
      .where(eq(canvases.id, canvas.id));
    return { ok: true, version: canvas.version + 1 };
  }

  /** 软删（可恢复；删画布 ≠ 删剧集） */
  async remove(spaceId: string, canvasId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    await db.update(canvases).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(canvases.id, canvas.id));
    return { ok: true };
  }

  // ── 节点 ────────────────────────────────────────────────
  async createNode(
    spaceId: string,
    canvasId: string,
    input: {
      node_type: string;
      name?: string;
      x?: number;
      y?: number;
      width?: number | null;
      height?: number | null;
      params?: unknown;
      z_index?: number;
    },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    this.assertNodeType(input.node_type);
    const id = newId();
    await db.insert(canvasNodes).values({
      id,
      spaceId: BigInt(spaceId),
      canvasId: canvas.id,
      nodeType: input.node_type,
      name: input.name ?? "",
      x: input.x ?? 0,
      y: input.y ?? 0,
      width: input.width ?? null,
      height: input.height ?? null,
      zIndex: input.z_index ?? 0,
      params: (input.params ?? {}) as Record<string, unknown>,
    });
    await this.touch(canvas.id);
    return { id: String(id), version: 1 };
  }

  /** 批量建节点（一次提交多个，返回创建顺序） */
  async batchCreateNodes(
    spaceId: string,
    canvasId: string,
    items: Array<{
      node_type: string;
      name?: string;
      x?: number;
      y?: number;
      width?: number | null;
      height?: number | null;
      params?: unknown;
      z_index?: number;
    }>,
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    for (const it of items) this.assertNodeType(it.node_type);
    const created: string[] = [];
    await db.transaction(async (tx) => {
      for (const it of items) {
        const id = newId();
        await tx.insert(canvasNodes).values({
          id,
          spaceId: BigInt(spaceId),
          canvasId: canvas.id,
          nodeType: it.node_type,
          name: it.name ?? "",
          x: it.x ?? 0,
          y: it.y ?? 0,
          width: it.width ?? null,
          height: it.height ?? null,
          zIndex: it.z_index ?? 0,
          params: (it.params ?? {}) as Record<string, unknown>,
        });
        created.push(String(id));
      }
    });
    await this.touch(canvas.id);
    return { ids: created };
  }

  async updateNode(
    spaceId: string,
    canvasId: string,
    nodeId: string,
    input: {
      version?: number;
      name?: string;
      x?: number;
      y?: number;
      width?: number | null;
      height?: number | null;
      z_index?: number;
      params?: unknown;
      status?: number;
    },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const node = await this.mustGetNode(canvas.id, nodeId);
    // 节点级乐观锁：带了 version 就必须匹配（不匹配 → 746002）
    if (input.version !== undefined && input.version !== node.version) {
      throw this.versionConflict(`node version mismatch (current ${node.version})`);
    }
    await db
      .update(canvasNodes)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
        ...(input.z_index !== undefined ? { zIndex: input.z_index } : {}),
        ...(input.params !== undefined ? { params: input.params as Record<string, unknown> } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        version: node.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(canvasNodes.id, node.id));
    await this.touch(canvas.id);
    return { ok: true, version: node.version + 1 };
  }

  /** 批量编辑节点（每个节点独立做版本校验；结果逐条返回） */
  async batchEditNodes(
    spaceId: string,
    canvasId: string,
    items: Array<{ id: string; version?: number; x?: number; y?: number; name?: string; params?: unknown; z_index?: number }>,
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const results: Array<{ id: string; ok: boolean; code?: number; version?: number }> = [];
    for (const it of items) {
      try {
        const r = await this.updateNode(spaceId, canvasId, it.id, it);
        results.push({ id: it.id, ok: true, version: r.version });
      } catch (e) {
        const err = e as AppError;
        results.push({ id: it.id, ok: false, code: err.code });
      }
    }
    void canvas;
    return { items: results };
  }

  /** 软删节点（可恢复：nodes-recover） */
  async removeNode(spaceId: string, canvasId: string, nodeId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const node = await this.mustGetNode(canvas.id, nodeId);
    await db.transaction(async (tx) => {
      await tx.update(canvasNodes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(canvasNodes.id, node.id));
      // 删除节点同时清掉相关连线（否则留下悬挂边）
      await tx.delete(canvasEdges).where(and(eq(canvasEdges.canvasId, canvas.id), eq(canvasEdges.srcNodeId, node.id)));
      await tx.delete(canvasEdges).where(and(eq(canvasEdges.canvasId, canvas.id), eq(canvasEdges.dstNodeId, node.id)));
    });
    await this.touch(canvas.id);
    return { ok: true };
  }

  async batchDeleteNodes(spaceId: string, canvasId: string, nodeIds: string[]) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (nodeIds.length === 0) return { deleted: 0 };
    const ids = nodeIds.map((id) => BigInt(id));
    await db.transaction(async (tx) => {
      await tx
        .update(canvasNodes)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(canvasNodes.canvasId, canvas.id), inArray(canvasNodes.id, ids)));
      await tx.delete(canvasEdges).where(and(eq(canvasEdges.canvasId, canvas.id), inArray(canvasEdges.srcNodeId, ids)));
      await tx.delete(canvasEdges).where(and(eq(canvasEdges.canvasId, canvas.id), inArray(canvasEdges.dstNodeId, ids)));
    });
    await this.touch(canvas.id);
    return { deleted: nodeIds.length };
  }

  /** 恢复被软删的节点（routes.txt:359 nodes-recover） */
  async recoverNodes(spaceId: string, canvasId: string, nodeIds: string[]) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (nodeIds.length === 0) return { recovered: 0 };
    await db
      .update(canvasNodes)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(canvasNodes.canvasId, canvas.id),
          inArray(canvasNodes.id, nodeIds.map((id) => BigInt(id))),
        ),
      );
    await this.touch(canvas.id);
    return { recovered: nodeIds.length };
  }

  /** 按类型取节点（供"素材/资产"面板按类型过滤） */
  async nodesByType(spaceId: string, canvasId: string, nodeType?: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (nodeType) this.assertNodeType(nodeType);
    const cond = [eq(canvasNodes.canvasId, canvas.id), isNull(canvasNodes.deletedAt)];
    if (nodeType) cond.push(eq(canvasNodes.nodeType, nodeType));
    const rows = await db.select().from(canvasNodes).where(and(...cond)).orderBy(asc(canvasNodes.id));
    return { list: rows.map(this.toNodeDto) };
  }

  // ── 连线 ────────────────────────────────────────────────
  async createEdge(
    spaceId: string,
    canvasId: string,
    input: { src_node_id: string; dst_node_id: string; semantic?: string },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const src = await this.mustGetNode(canvas.id, input.src_node_id);
    const dst = await this.mustGetNode(canvas.id, input.dst_node_id);
    if (src.id === dst.id) {
      throw new AppError(ErrorCode.INVALID_PARAM, "self-loop edge not allowed", { field: "dst_node_id" });
    }
    const semantic = input.semantic ?? "pipeline";
    const id = newId();
    // 幂等：唯一约束冲突时返回已存在的边（对齐 CLI "确保连线存在"）
    const inserted = await db
      .insert(canvasEdges)
      .values({
        id,
        spaceId: BigInt(spaceId),
        canvasId: canvas.id,
        srcNodeId: src.id,
        dstNodeId: dst.id,
        semantic,
      })
      .onConflictDoNothing({
        target: [canvasEdges.canvasId, canvasEdges.srcNodeId, canvasEdges.dstNodeId, canvasEdges.semantic],
      })
      .returning({ id: canvasEdges.id });
    await this.touch(canvas.id);
    if (inserted[0]) return { id: String(inserted[0].id), created: true };
    const [existing] = await db
      .select({ id: canvasEdges.id })
      .from(canvasEdges)
      .where(
        and(
          eq(canvasEdges.canvasId, canvas.id),
          eq(canvasEdges.srcNodeId, src.id),
          eq(canvasEdges.dstNodeId, dst.id),
          eq(canvasEdges.semantic, semantic),
        ),
      );
    return { id: String(existing!.id), created: false };
  }

  async batchCreateEdges(
    spaceId: string,
    canvasId: string,
    items: Array<{ src_node_id: string; dst_node_id: string; semantic?: string }>,
  ) {
    const results: Array<{ id?: string; created?: boolean; code?: number }> = [];
    for (const it of items) {
      try {
        results.push(await this.createEdge(spaceId, canvasId, it));
      } catch (e) {
        results.push({ code: (e as AppError).code });
      }
    }
    return { items: results };
  }

  async deleteEdge(spaceId: string, canvasId: string, edgeId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    await db.delete(canvasEdges).where(and(eq(canvasEdges.canvasId, canvas.id), eq(canvasEdges.id, BigInt(edgeId))));
    await this.touch(canvas.id);
    return { ok: true };
  }

  async batchDeleteEdges(spaceId: string, canvasId: string, edgeIds: string[]) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (edgeIds.length === 0) return { deleted: 0 };
    await db
      .delete(canvasEdges)
      .where(and(eq(canvasEdges.canvasId, canvas.id), inArray(canvasEdges.id, edgeIds.map((id) => BigInt(id)))));
    await this.touch(canvas.id);
    return { deleted: edgeIds.length };
  }

  // ── 锁与心跳（Redis，不落库）──────────────────────────
  private lockKey(canvasId: bigint, nodeId: string): string {
    return `canvas:lock:${canvasId}:${nodeId}`;
  }

  /** 抢锁：成功返回真；被他人持锁 → 746003（自己重复抢是续期） */
  async lockNode(spaceId: string, canvasId: string, nodeId: string, userId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    await this.mustGetNode(canvas.id, nodeId);
    const key = this.lockKey(canvas.id, nodeId);
    const holder = await this.redis.get(key);
    if (holder && holder !== userId) {
      throw new AppError(ErrorCode.NODE_LOCKED, "node is locked by another user", { reason: "locked" });
    }
    await this.redis.set(key, userId, LOCK_TTL_S);
    return { locked: true, ttl: LOCK_TTL_S, holder: userId };
  }

  async unlockNode(spaceId: string, canvasId: string, nodeId: string, userId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const key = this.lockKey(canvas.id, nodeId);
    const holder = await this.redis.get(key);
    if (holder && holder !== userId) {
      // 不能解别人的锁
      throw new AppError(ErrorCode.NODE_LOCKED, "node is locked by another user", { reason: "locked" });
    }
    await this.redis.del(key);
    return { unlocked: true };
  }

  /** 续期（心跳逐节点 renew，与 canvas 级 heartbeat 并存） */
  async renewNode(spaceId: string, canvasId: string, nodeId: string, userId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const key = this.lockKey(canvas.id, nodeId);
    const holder = await this.redis.get(key);
    if (holder !== userId) {
      throw new AppError(ErrorCode.NODE_LOCKED, "lock lost", { reason: "not_holder" });
    }
    await this.redis.set(key, userId, LOCK_TTL_S);
    return { renewed: true, ttl: LOCK_TTL_S };
  }

  /** 画布级心跳：标记"我正在编辑这个画布"（多人协作时用于显示在线） */
  async heartbeat(spaceId: string, canvasId: string, userId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    await this.redis.set(`canvas:hb:${canvas.id}:${userId}`, String(Date.now()), HEARTBEAT_TTL_S);
    const holders = await this.nodeLocks(canvas.id);
    return { ok: true, ttl: HEARTBEAT_TTL_S, locked_nodes: holders };
  }

  /** 当前画布的节点锁快照（前端显示"谁在编辑"） */
  async nodeLocks(canvasId: bigint): Promise<Array<{ node_id: string; user_id: string }>> {
    // 锁 key 无固定前缀扫描能力，这里按已知节点逐个查（画布节点数量可控）
    const nodes = await db
      .select({ id: canvasNodes.id })
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvasId), isNull(canvasNodes.deletedAt)));
    const out: Array<{ node_id: string; user_id: string }> = [];
    for (const n of nodes) {
      const holder = await this.redis.get(this.lockKey(canvasId, String(n.id)));
      if (holder) out.push({ node_id: String(n.id), user_id: holder });
    }
    return out;
  }

  // ── 提交（整体保存 + 快照）────────────────────────────
  /**
   * 提交整张画布：客户端带 version 与全量 payload。
   * - version 不匹配 → 746002（不静默覆盖）
   * - 同一事务内整体替换节点/边/分组 + version+1 + 写快照
   *
   * 为什么是"整体替换"：画布编辑天然是整图操作（拖拽/批量/撤销），
   * 逐条 diff 的边界情况远多于收益。节点数量级（单画布百级）下代价可接受。
   */
  async commit(
    spaceId: string,
    canvasId: string,
    userId: string,
    input: {
      version: number;
      nodes: Array<{
        id?: string;
        node_type: string;
        name?: string;
        x: number;
        y: number;
        width?: number | null;
        height?: number | null;
        z_index?: number;
        params?: unknown;
        task_id?: string | null;
        status?: number;
        group_ids?: string[];
      }>;
      edges: Array<{ src_node_id: string; dst_node_id: string; semantic?: string }>;
      groups?: Array<{ id?: string; parent_id?: string | null; name?: string; sort?: number; status?: number }>;
      kind?: number;
    },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (canvas.version !== input.version) {
      throw this.versionConflict(`canvas version mismatch (current ${canvas.version})`);
    }
    for (const n of input.nodes) this.assertNodeType(n.node_type);

    const nextVersion = canvas.version + 1;
    const canvasIdBig = canvas.id;

    await db.transaction(async (tx) => {
      // 1) 分组整体替换
      await tx.delete(canvasGroups).where(eq(canvasGroups.canvasId, canvasIdBig));
      const groupIdMap = new Map<string, bigint>();
      for (const g of input.groups ?? []) {
        const gid = g.id ? BigInt(g.id) : newId();
        if (g.id) groupIdMap.set(g.id, gid);
        await tx.insert(canvasGroups).values({
          id: gid,
          spaceId: BigInt(spaceId),
          canvasId: canvasIdBig,
          parentId: null, // 先建后补 parent，避免顺序依赖
          name: g.name ?? null,
          sort: g.sort ?? 0,
          status: g.status ?? 1,
        });
      }
      // 补 parent（第二轮，父节点一定已存在）
      for (const g of input.groups ?? []) {
        if (g.id && g.parent_id) {
          const childId = groupIdMap.get(g.id);
          const parentId = groupIdMap.get(g.parent_id);
          if (childId && parentId) {
            await tx.update(canvasGroups).set({ parentId }).where(eq(canvasGroups.id, childId));
          }
        }
      }

      // 2) 边先删（引用了节点），再节点，再重建
      await tx.delete(canvasEdges).where(eq(canvasEdges.canvasId, canvasIdBig));
      await tx.delete(canvasNodes).where(eq(canvasNodes.canvasId, canvasIdBig));

      const nodeIdMap = new Map<string, bigint>();
      for (const n of input.nodes) {
        const nid = n.id ? BigInt(n.id) : newId();
        if (n.id) nodeIdMap.set(n.id, nid);
        await tx.insert(canvasNodes).values({
          id: nid,
          spaceId: BigInt(spaceId),
          canvasId: canvasIdBig,
          nodeType: n.node_type,
          name: n.name ?? "",
          x: n.x,
          y: n.y,
          width: n.width ?? null,
          height: n.height ?? null,
          zIndex: n.z_index ?? 0,
          params: (n.params ?? {}) as Record<string, unknown>,
          taskId: n.task_id ? BigInt(n.task_id) : null,
          status: n.status ?? 1,
          groupIds: (n.group_ids ?? []).map((g) => BigInt(g)),
        });
      }

      for (const e of input.edges) {
        const src = nodeIdMap.get(e.src_node_id);
        const dst = nodeIdMap.get(e.dst_node_id);
        if (!src || !dst) {
          throw new AppError(ErrorCode.INVALID_PARAM, "edge references unknown node", {
            field: "edges",
            src: e.src_node_id,
            dst: e.dst_node_id,
          });
        }
        await tx.insert(canvasEdges).values({
          id: newId(),
          spaceId: BigInt(spaceId),
          canvasId: canvasIdBig,
          srcNodeId: src,
          dstNodeId: dst,
          semantic: e.semantic ?? "pipeline",
        });
      }

      // 3) 版本 + 快照
      await tx
        .update(canvases)
        .set({ version: nextVersion, lastEditedAt: new Date(), updatedAt: new Date() })
        .where(eq(canvases.id, canvasIdBig));
      await tx.insert(canvasSnapshots).values({
        id: newId(),
        spaceId: BigInt(spaceId),
        canvasId: canvasIdBig,
        version: nextVersion,
        kind: input.kind ?? 1,
        payload: { nodes: input.nodes, edges: input.edges, groups: input.groups ?? [] } as Record<string, unknown>,
        createdBy: BigInt(userId),
      });
    });

    return { version: nextVersion, nodes: input.nodes.length, edges: input.edges.length };
  }

  /** 快照列表（用于"历史版本"） */
  async listSnapshots(spaceId: string, canvasId: string, limit = 20) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const rows = await db
      .select({ id: canvasSnapshots.id, version: canvasSnapshots.version, kind: canvasSnapshots.kind, createdAt: canvasSnapshots.createdAt })
      .from(canvasSnapshots)
      .where(eq(canvasSnapshots.canvasId, canvas.id))
      .orderBy(desc(canvasSnapshots.version))
      .limit(Math.min(100, Math.max(1, limit)));
    return {
      list: rows.map((r) => ({ id: String(r.id), version: r.version, kind: r.kind, created_at: r.createdAt.toISOString() })),
    };
  }

  /** 取某版本快照（恢复用） */
  async getSnapshot(spaceId: string, canvasId: string, version: number) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [row] = await db
      .select()
      .from(canvasSnapshots)
      .where(and(eq(canvasSnapshots.canvasId, canvas.id), eq(canvasSnapshots.version, version)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "snapshot not found");
    return { version: row.version, payload: row.payload, created_at: row.createdAt.toISOString() };
  }

  // ── 分组 ────────────────────────────────────────────────
  async createGroup(spaceId: string, canvasId: string, input: { name?: string; parent_id?: string | null; sort?: number }) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    let parentId: bigint | null = null;
    if (input.parent_id) {
      const [parent] = await db
        .select()
        .from(canvasGroups)
        .where(and(eq(canvasGroups.canvasId, canvas.id), eq(canvasGroups.id, BigInt(input.parent_id))));
      if (!parent) throw new AppError(ErrorCode.INVALID_PARAM, "parent group not in this canvas", { field: "parent_id" });
      parentId = parent.id;
    }
    const id = newId();
    await db.insert(canvasGroups).values({
      id,
      spaceId: BigInt(spaceId),
      canvasId: canvas.id,
      parentId,
      name: input.name ?? null,
      sort: input.sort ?? 0,
    });
    await this.touch(canvas.id);
    return { id: String(id) };
  }

  async deleteGroup(spaceId: string, canvasId: string, groupId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [group] = await db
      .select()
      .from(canvasGroups)
      .where(and(eq(canvasGroups.canvasId, canvas.id), eq(canvasGroups.id, BigInt(groupId))));
    if (!group) throw new AppError(ErrorCode.NOT_FOUND, "group not found");
    const [child] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(canvasGroups)
      .where(and(eq(canvasGroups.canvasId, canvas.id), eq(canvasGroups.parentId, group.id)));
    if ((child?.n ?? 0) > 0) throw new AppError(ErrorCode.INVALID_PARAM, "group has children", { field: "group_id" });
    await db.delete(canvasGroups).where(eq(canvasGroups.id, group.id));
    return { ok: true };
  }

  /** 钉住节点（单选；node_id=null 取消） */
  async setPinnedNode(spaceId: string, canvasId: string, input: { node_id: string | null }) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    let pinned: bigint | null = null;
    if (input.node_id) {
      const node = await this.mustGetNode(canvas.id, input.node_id);
      pinned = node.id;
    }
    await db
      .update(canvases)
      .set({ pinnedNodeId: pinned, lastEditedAt: new Date(), updatedAt: new Date() })
      .where(eq(canvases.id, canvas.id));
    return { ok: true, pinned_node_id: pinned ? String(pinned) : null };
  }

  // ── 内部 ────────────────────────────────────────────────
  private async mustGetCanvas(spaceId: string, canvasId: string) {
    let id: bigint;
    try {
      id = BigInt(canvasId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid canvas id", { field: "canvas_id" });
    }
    const [canvas] = await db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, id), eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)));
    if (!canvas) throw new AppError(ErrorCode.NOT_FOUND, "canvas not found");
    return canvas;
  }

  private async mustGetNode(canvasId: bigint, nodeId: string) {
    let id: bigint;
    try {
      id = BigInt(nodeId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid node id", { field: "node_id" });
    }
    const [node] = await db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.id, id), eq(canvasNodes.canvasId, canvasId), isNull(canvasNodes.deletedAt)));
    if (!node) throw new AppError(ErrorCode.NOT_FOUND, "node not found");
    return node;
  }

  private assertNodeType(t: string): void {
    if (!(CANVAS_NODE_TYPES as readonly string[]).includes(t)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `unsupported node_type: ${t}`, {
        field: "node_type",
        allowed: CANVAS_NODE_TYPES,
      });
    }
  }

  private versionConflict(message: string): AppError {
    return new AppError(ErrorCode.VERSION_CONFLICT, message, { reason: "version_conflict" });
  }

  private async touch(canvasId: bigint): Promise<void> {
    await db.update(canvases).set({ lastEditedAt: new Date(), updatedAt: new Date() }).where(eq(canvases.id, canvasId));
  }

  private toNodeDto = (n: typeof canvasNodes.$inferSelect) => ({
    id: String(n.id),
    node_type: n.nodeType,
    name: n.name,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    z_index: n.zIndex,
    params: n.params,
    task_id: n.taskId ? String(n.taskId) : null,
    status: n.status,
    group_ids: (n.groupIds ?? []).map((g) => String(g)),
    version: n.version,
  });
}
