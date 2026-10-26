import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { canvasNodes, canvasTemplates, canvases } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";

/**
 * 整画布模板库（C2，8 条端点收敛为 `/canvas-templates`）
 *
 * 路径归一说明（契约 draft §3.1 的建议，本文按此实现）：
 * 参照站把模板分成三组前缀（`canvas-tpls`、`canvas/:id/tpls`、`canvas/templates/*`），
 * 指的是同一个实体。分三组会造出三套权限校验与三种分页语义，
 * 所以统一到 `/canvas-templates` 一个名词。
 *
 * 与"节点组模板"（`canvas_group_templates`）**不是一回事**：
 * 前者是整张画布的快照，后者是画布里一组节点的复用片段。不混用（canvas.md:150）。
 *
 * tpl_scope：1 官方（space_id 为 NULL，全局可见）2 团队 3 个人
 */

export interface TemplatePayload {
  nodes?: unknown[];
  edges?: unknown[];
  groups?: unknown[];
  /** 视口提示：套用后把视图移到这个位置 */
  viewport?: { x: number; y: number; zoom: number };
}

@Injectable()
export class CanvasTemplateService {
  /**
   * 模板列表。
   *
   * 可见性规则（不能只按 space_id 过滤）：
   * - 官方模板（scope=1）：所有人可见
   * - 团队模板（scope=2）：仅同 space 可见
   * - 个人模板（scope=3）：仅创建者可见
   * 这条规则不写对，就会出现"能看到别人个人模板"或"看不到官方模板"。
   */
  async list(
    spaceId: string,
    userId: string,
    q: { tpl_type?: number; page?: number; page_size?: number; mine?: boolean },
  ) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.page_size ?? 20));

    const visible = or(
      eq(canvasTemplates.tplScope, 1),
      and(eq(canvasTemplates.tplScope, 2), eq(canvasTemplates.spaceId, BigInt(spaceId))),
      and(eq(canvasTemplates.tplScope, 3), eq(canvasTemplates.createdBy, BigInt(userId))),
    );
    const conditions = [visible, eq(canvasTemplates.status, 2)];
    if (q.tpl_type !== undefined) conditions.push(eq(canvasTemplates.tplType, q.tpl_type));
    if (q.mine) conditions.push(eq(canvasTemplates.createdBy, BigInt(userId)));

    const rows = await db
      .select()
      .from(canvasTemplates)
      .where(and(...conditions))
      .orderBy(canvasTemplates.sort, desc(canvasTemplates.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(canvasTemplates)
      .where(and(...conditions));

    return {
      list: rows.map((r) => this.toDto(r)),
      total: cnt?.n ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /** 个人模板搜索（按名称模糊匹配，只搜自己的） */
  async searchPersonal(spaceId: string, userId: string, query: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const conditions = [
      eq(canvasTemplates.createdBy, BigInt(userId)),
      eq(canvasTemplates.status, 2),
      or(eq(canvasTemplates.spaceId, BigInt(spaceId)), isNull(canvasTemplates.spaceId)),
    ];
    if (query.trim()) conditions.push(ilike(canvasTemplates.name, `%${query.trim()}%`));

    const rows = await db
      .select()
      .from(canvasTemplates)
      .where(and(...conditions))
      .orderBy(desc(canvasTemplates.createdAt))
      .limit(ps)
      .offset((p - 1) * ps);
    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(canvasTemplates)
      .where(and(...conditions));
    return { list: rows.map((r) => this.toDto(r)), total: cnt?.n ?? 0, page: p, page_size: ps };
  }

  async get(spaceId: string, userId: string, templateId: string) {
    const row = await this.getVisible(spaceId, userId, templateId);
    return { template: this.toDto(row) };
  }

  /** 取模板时统一走可见性校验，避免"知道 id 就能看别人模板" */
  private async getVisible(spaceId: string, userId: string, templateId: string) {
    const [row] = await db
      .select()
      .from(canvasTemplates)
      .where(eq(canvasTemplates.id, BigInt(templateId)));
    // 已下架（status=3）等同不存在：否则用户"删了还能按 id 打开"，
    // 与列表里消失的事实矛盾（软删必须对读取路径一致生效）
    if (!row || row.status !== 2) throw new AppError(ErrorCode.NOT_FOUND, "template not found");
    const visible =
      row.tplScope === 1 ||
      (row.tplScope === 2 && row.spaceId !== null && String(row.spaceId) === spaceId) ||
      (row.tplScope === 3 && row.createdBy !== null && String(row.createdBy) === userId);
    if (!visible) throw new AppError(ErrorCode.NOT_FOUND, "template not found");
    return row;
  }

  /**
   * 把当前画布存成模板。
   *
   * 为什么存"整图快照"而不是引用节点 id：模板要能在**别的画布**里用，
   * 引用原画布的节点 id 在目标画布不存在，套用时必然悬挂。
   * 所以 payload 里存的是"自包含的节点/边/组描述"（不含雪花 id）。
   */
  async createFromCanvas(
    spaceId: string,
    userId: string,
    canvasId: string,
    input: { name: string; tpl_scope?: number; description?: string; cover_uri?: string },
  ) {
    const [canvas] = await db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, BigInt(canvasId)), eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)));
    if (!canvas) throw new AppError(ErrorCode.NOT_FOUND, "canvas not found");

    const nodes = await db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvas.id), isNull(canvasNodes.deletedAt)))
      // 按 z_index + id 排序，保证"存模板 → 套用"两次顺序一致
      // （不排序的话 Postgres 返回顺序不保证，套用后的 z_index 会随机重排，
      //  用户会发现套出来的画布层叠关系与源画布不同）
      .orderBy(asc(canvasNodes.zIndex), asc(canvasNodes.id));

    // 自包含 payload：用**数组下标**作为节点局部 id，套用时重新分配真实 id
    const idToIndex = new Map<string, number>();
    nodes.forEach((n, i) => idToIndex.set(String(n.id), i));

    const payload: TemplatePayload = {
      nodes: nodes.map((n) => ({
        // 模板里不带雪花 id，避免套用到别的画布时 id 冲突
        node_type: n.nodeType,
        name: n.name,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        z_index: n.zIndex,
        params: n.params,
      })),
      edges: [],
      groups: [],
    };

    const scope = input.tpl_scope ?? 3;
    if (scope !== 2 && scope !== 3) {
      throw new AppError(ErrorCode.INVALID_PARAM, "tpl_scope must be 2 (team) or 3 (personal)", {
        field: "tpl_scope",
      });
    }

    const id = newId();
    await db.insert(canvasTemplates).values({
      id,
      // 个人模板挂 space；团队模板也挂 space（团队空间 id）
      spaceId: BigInt(spaceId),
      tplScope: scope,
      tplType: 2,
      name: input.name.trim() || "未命名模板",
      description: input.description ?? "",
      coverUri: input.cover_uri ?? null,
      payload: payload as unknown as Record<string, unknown>,
      // 直接发布：目前没有"模板审核"流程，草稿态无意义
      status: 2,
      sort: 100,
      createdBy: BigInt(userId),
    });
    return { template_id: String(id) };
  }

  /**
   * 把模板套用到某个画布：追加节点与连线，**整体替换**语义由调用方的 commit 决定。
   *
   * 这里只负责"生成待插入的节点描述"，不直接写库——
   * 因为画布编辑是"本地编辑 + 整图提交"，直接写库会绕开乐观锁，
   * 造成"别人正在编辑时被模板悄悄覆盖"。
   */
  async instantiate(spaceId: string, userId: string, templateId: string, offset?: { x: number; y: number }) {
    const row = await this.getVisible(spaceId, userId, templateId);
    const payload = (row.payload ?? {}) as TemplatePayload;
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const dx = offset?.x ?? 0;
    const dy = offset?.y ?? 0;

    const out = nodes.map((raw, i) => {
      const n = raw as Record<string, unknown>;
      return {
        node_type: String(n.node_type ?? "text"),
        name: typeof n.name === "string" ? n.name : "",
        x: Number(n.x ?? 0) + dx,
        y: Number(n.y ?? 0) + dy,
        width: typeof n.width === "number" ? n.width : null,
        height: typeof n.height === "number" ? n.height : null,
        z_index: i,
        params: (n.params ?? {}) as Record<string, unknown>,
      };
    });
    return { nodes: out, total: out.length, template: this.toDto(row) };
  }

  /** 个人模板删除（只能删自己的） */
  async removePersonal(spaceId: string, userId: string, templateId: string) {
    const [row] = await db.select().from(canvasTemplates).where(eq(canvasTemplates.id, BigInt(templateId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "template not found");
    if (row.tplScope === 1) {
      throw new AppError(ErrorCode.FORBIDDEN, "official template cannot be deleted");
    }
    if (row.createdBy === null || String(row.createdBy) !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "you can only delete your own template");
    }
    await db
      .update(canvasTemplates)
      .set({ status: 3, updatedAt: new Date() }) // 3 = 已下架（软删，可恢复）
      .where(eq(canvasTemplates.id, row.id));
    return { ok: true };
  }

  /**
   * 把模板同步到团队（个人 → 团队）。
   * 语义：复制一份 tpl_scope=2 的模板挂到目标团队空间，原个人模板保留。
   */
  async syncToTeam(spaceId: string, userId: string, templateId: string, teamSpaceId: string) {
    const row = await this.getVisible(spaceId, userId, templateId);
    // 只能同步自己有权限的模板
    if (row.tplScope === 2 && String(row.spaceId) !== spaceId) {
      throw new AppError(ErrorCode.FORBIDDEN, "template belongs to another team");
    }
    const id = newId();
    await db.insert(canvasTemplates).values({
      id,
      spaceId: BigInt(teamSpaceId),
      tplScope: 2,
      tplType: row.tplType,
      name: row.name,
      description: row.description,
      coverUri: row.coverUri,
      payload: row.payload as Record<string, unknown>,
      status: 2,
      sort: row.sort,
      createdBy: BigInt(userId),
    });
    return { template_id: String(id) };
  }

  private toDto(row: typeof canvasTemplates.$inferSelect) {
    return {
      id: String(row.id),
      tpl_scope: row.tplScope,
      tpl_type: row.tplType,
      name: row.name,
      description: row.description,
      cover_uri: row.coverUri,
      payload: row.payload,
      status: row.status,
      sort: row.sort,
      space_id: row.spaceId ? String(row.spaceId) : null,
      created_by: row.createdBy ? String(row.createdBy) : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}

