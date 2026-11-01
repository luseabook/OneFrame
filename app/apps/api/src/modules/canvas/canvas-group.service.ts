import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canvasGroupTemplates, canvasGroups, canvasNodes, canvasPinGroups, canvases } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { toBigId } from "../../common/bigid";

/**
 * 固定组（C10）+ 节点组模板（C11）
 *
 * 为什么合在一起：两者的载体都是"画布里的一个分组"（`canvas_groups`），
 * 共享同一套归属校验；拆开会让这段校验复制两遍。
 *
 * 与"整画布模板"（`canvas_templates`）**不是一回事**：
 * 前者是整张画布，这里是一组节点的复用片段。参照站明确不混用（canvas.md:150）。
 *
 * 固定组语义（契约 §14.4）：
 * - 每画布 **7 个槽位**，`UK(canvas_id, slot)` 保证不重复
 * - 成员是**整体替换**（不是增量 add/remove），因为前端交互是"勾选后一次保存"
 * - 与 `canvas_nodes.group_ids` 反向冗余，必须**同事务双写**，否则两边会不一致
 */

/** 每画布固定组槽位数（第 120 批导出：`canvas_nodes.group_ids` 的入站上限必须与之一致） */
export const MAX_PIN_SLOTS = 7;

@Injectable()
export class CanvasGroupService {
  private async mustGetCanvas(spaceId: string, canvasId: string) {
    const [canvas] = await db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, toBigId(canvasId, "canvas_id")), eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)));
    if (!canvas) throw new AppError(ErrorCode.NOT_FOUND, "canvas not found");
    return canvas;
  }

  // ── 固定组 ──────────────────────────────────────────────
  async listPinGroups(spaceId: string, canvasId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const rows = await db
      .select()
      .from(canvasPinGroups)
      .where(eq(canvasPinGroups.canvasId, canvas.id))
      .orderBy(asc(canvasPinGroups.slot));
    return {
      list: rows.map((r) => ({
        group_id: String(r.id),
        name: r.name,
        color: r.color,
        slot: r.slot,
        node_ids: r.nodeIds.map((n) => String(n)),
      })),
      // 显式给出槽位上限，前端据此禁用"再加一个"
      max_slots: MAX_PIN_SLOTS,
    };
  }

  /**
   * 创建/整体替换某个槽位的固定组。
   *
   * `replaced: true` 表示这个槽位原来有成员，被整体覆盖了——
   * 前端需要知道这件事（可能提示"已替换原分组"），不能静默覆盖。
   */
  async upsertPinGroup(
    spaceId: string,
    canvasId: string,
    input: { slot: number; group_id?: string; name?: string; color?: string; node_ids: string[] },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (input.slot < 1 || input.slot > MAX_PIN_SLOTS) {
      throw new AppError(ErrorCode.INVALID_PARAM, `slot must be 1..${MAX_PIN_SLOTS}`, { field: "slot" });
    }

    // 节点必须都属于本画布（否则会造出跨画布引用）
    const validNodeIds = input.node_ids.filter((id) => /^\d{1,20}$/.test(id)).map((id) => BigInt(id));
    if (validNodeIds.length > 0) {
      const found = await db
        .select({ id: canvasNodes.id })
        .from(canvasNodes)
        .where(
          and(
            eq(canvasNodes.canvasId, canvas.id),
            inArray(canvasNodes.id, validNodeIds),
            isNull(canvasNodes.deletedAt),
          ),
        );
      if (found.length !== validNodeIds.length) {
        throw new AppError(ErrorCode.INVALID_PARAM, "some nodes do not belong to this canvas", {
          field: "node_ids",
        });
      }
    }

    const [existing] = await db
      .select()
      .from(canvasPinGroups)
      .where(and(eq(canvasPinGroups.canvasId, canvas.id), eq(canvasPinGroups.slot, input.slot)));

    let groupId: bigint;
    const replaced = !!existing;

    await db.transaction(async (tx) => {
      if (existing) {
        groupId = existing.id;
        await tx
          .update(canvasPinGroups)
          .set({
            name: input.name ?? existing.name,
            color: input.color ?? existing.color,
            nodeIds: validNodeIds,
            updatedAt: new Date(),
          })
          .where(eq(canvasPinGroups.id, existing.id));
      } else {
        groupId = newId();
        await tx.insert(canvasPinGroups).values({
          id: groupId,
          spaceId: BigInt(spaceId),
          canvasId: canvas.id,
          name: input.name ?? null,
          color: input.color ?? null,
          slot: input.slot,
          nodeIds: validNodeIds,
        });
      }

      /**
       * 双写 `canvas_nodes.group_ids`：
       * 这张冗余数组是"节点侧反查自己属于哪些固定组"的唯一来源。
       * 只写 canvas_pin_groups 不写这里，节点侧就永远查不到归属；
       * 反过来只写这里不写 pin_groups，画布顶部固定栏就空着。
       * 必须同事务，任何一半失败都要一起回滚。
       */
      await tx
        .update(canvasNodes)
        .set({ updatedAt: new Date() })
        .where(eq(canvasNodes.canvasId, canvas.id));

      // 先把本槽位原有成员从这个槽位移除（整体替换语义）
      if (existing && existing.nodeIds.length > 0) {
        const oldIds = existing.nodeIds.filter((id) => !validNodeIds.includes(id));
        if (oldIds.length > 0) {
          await tx.execute(sql`
            UPDATE canvas_nodes
            SET group_ids = array_remove(group_ids, ${groupId}::bigint),
                updated_at = now()
            WHERE canvas_id = ${canvas.id}::bigint AND id = ANY(${sql.raw(`ARRAY[${oldIds.join(",")}]::bigint[]`)})
          `);
        }
      }
      // 再给新成员加上该组 id（array 去重）
      if (validNodeIds.length > 0) {
        await tx.execute(sql`
          UPDATE canvas_nodes
          SET group_ids = (
                SELECT array_agg(DISTINCT g) FROM unnest(group_ids || ${groupId}::bigint) AS g
              ),
              updated_at = now()
          WHERE canvas_id = ${canvas.id}::bigint AND id = ANY(${sql.raw(`ARRAY[${validNodeIds.join(",")}]::bigint[]`)})
        `);
      }
    });

    return {
      pin_group: {
        group_id: String(groupId!),
        name: input.name ?? existing?.name ?? null,
        color: input.color ?? existing?.color ?? null,
        slot: input.slot,
        node_ids: validNodeIds.map(String),
      },
      replaced,
    };
  }

  /** 删除固定组（同时把成员节点上的 group_ids 清掉） */
  async deletePinGroup(spaceId: string, canvasId: string, slot: number) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [row] = await db
      .select()
      .from(canvasPinGroups)
      .where(and(eq(canvasPinGroups.canvasId, canvas.id), eq(canvasPinGroups.slot, slot)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "pin group not found");

    await db.transaction(async (tx) => {
      await tx.delete(canvasPinGroups).where(eq(canvasPinGroups.id, row.id));
      if (row.nodeIds.length > 0) {
        await tx.execute(sql`
          UPDATE canvas_nodes
          SET group_ids = array_remove(group_ids, ${row.id}::bigint), updated_at = now()
          WHERE canvas_id = ${canvas.id}::bigint AND id = ANY(${sql.raw(`ARRAY[${row.nodeIds.join(",")}]::bigint[]`)})
        `);
      }
    });
    return { group_id: String(row.id), cleared: row.nodeIds.length };
  }

  /** 清空某固定组的成员（保留组本身） */
  async clearPinGroupMembers(spaceId: string, canvasId: string, slot: number) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [row] = await db
      .select()
      .from(canvasPinGroups)
      .where(and(eq(canvasPinGroups.canvasId, canvas.id), eq(canvasPinGroups.slot, slot)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "pin group not found");
    const cleared = row.nodeIds.length;
    await db.transaction(async (tx) => {
      await tx
        .update(canvasPinGroups)
        .set({ nodeIds: [], updatedAt: new Date() })
        .where(eq(canvasPinGroups.id, row.id));
      if (cleared > 0) {
        await tx.execute(sql`
          UPDATE canvas_nodes
          SET group_ids = array_remove(group_ids, ${row.id}::bigint), updated_at = now()
          WHERE canvas_id = ${canvas.id}::bigint AND id = ANY(${sql.raw(`ARRAY[${row.nodeIds.join(",")}]::bigint[]`)})
        `);
      }
    });
    return { group_id: String(row.id), cleared };
  }

  /** 直接设置某节点的固定组归属（节点侧入口） */
  async setNodePinGroups(spaceId: string, canvasId: string, nodeId: string, groupIds: string[]) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [node] = await db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.id, BigInt(nodeId)), eq(canvasNodes.canvasId, canvas.id), isNull(canvasNodes.deletedAt)));
    if (!node) throw new AppError(ErrorCode.NOT_FOUND, "node not found");

    const valid = groupIds.filter((id) => /^\d{1,20}$/.test(id)).map((id) => BigInt(id));
    if (valid.length > 0) {
      const found = await db
        .select({ id: canvasPinGroups.id })
        .from(canvasPinGroups)
        .where(and(eq(canvasPinGroups.canvasId, canvas.id), inArray(canvasPinGroups.id, valid)));
      if (found.length !== valid.length) {
        throw new AppError(ErrorCode.INVALID_PARAM, "some pin groups do not belong to this canvas", {
          field: "group_ids",
        });
      }
    }
    await db
      .update(canvasNodes)
      .set({ groupIds: valid, updatedAt: new Date() })
      .where(eq(canvasNodes.id, node.id));
    return { node_id: String(node.id), group_ids: valid.map(String) };
  }

  // ── 节点组模板 ──────────────────────────────────────────
  async listGroupTemplates(spaceId: string, canvasId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const rows = await db
      .select()
      .from(canvasGroupTemplates)
      .where(eq(canvasGroupTemplates.canvasId, canvas.id))
      .orderBy(desc(canvasGroupTemplates.createdAt));
    return {
      list: rows.map((r) => ({
        template_id: String(r.id),
        group_id: String(r.groupId),
        name: r.name,
        payload: r.payload,
        created_at: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * 把某个分组存成可复用的节点组模板。
   * payload 同样**自包含**（存节点描述，不存雪花 id），理由与整画布模板一致。
   */
  async createGroupTemplate(
    spaceId: string,
    userId: string,
    canvasId: string,
    groupId: string,
    input: { name: string },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [group] = await db
      .select()
      .from(canvasGroups)
      .where(and(eq(canvasGroups.id, BigInt(groupId)), eq(canvasGroups.canvasId, canvas.id)));
    if (!group) throw new AppError(ErrorCode.NOT_FOUND, "group not found");

    const members = await db
      .select()
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.canvasId, canvas.id),
          isNull(canvasNodes.deletedAt),
          sql`${BigInt(groupId)} = ANY(${canvasNodes.groupIds})`,
        ),
      );
    if (members.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "group has no members to save", { field: "group_id" });
    }

    const id = newId();
    await db.insert(canvasGroupTemplates).values({
      id,
      spaceId: BigInt(spaceId),
      canvasId: canvas.id,
      groupId: group.id,
      name: input.name.trim() || "未命名组模板",
      payload: {
        nodes: members.map((n) => ({
          node_type: n.nodeType,
          name: n.name,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          z_index: n.zIndex,
          params: n.params,
        })),
      } as Record<string, unknown>,
      createdBy: BigInt(userId),
    });
    return { template_id: String(id) };
  }

  async updateGroupTemplate(
    spaceId: string,
    canvasId: string,
    templateId: string,
    input: { name?: string },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [row] = await db
      .select()
      .from(canvasGroupTemplates)
      .where(and(eq(canvasGroupTemplates.id, BigInt(templateId)), eq(canvasGroupTemplates.canvasId, canvas.id)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "group template not found");
    await db
      .update(canvasGroupTemplates)
      .set({ ...(input.name ? { name: input.name } : {}), updatedAt: new Date() })
      .where(eq(canvasGroupTemplates.id, row.id));
    return { template_id: String(row.id), name: input.name ?? row.name };
  }
}

