import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { assets, filmCanvasBindings, filmTables, filmTasks } from "@app/db";
import { AppError, ErrorCode, FilmTaskStatus, newId } from "@app/shared";
import { db } from "../../db/database";
import type { FilmTableRow, FilmTaskRow } from "./film.access";
import { FilmAccessService } from "./film.access";
import { FilmRealtimeService } from "./film.realtime";
import { FilmReviewService } from "./film.review.service";
import { FilmTasksService } from "./film.tasks.service";
import { CanvasService } from "../canvas/canvas.service";

/**
 * film ↔ canvas 服务 —— 契约 §3.5 的「行↔画布绑定 4」+「画布侧 5」。
 *
 * 关键语义（每条都有证据或明确标注假设）：
 *
 * 1. **film 只持有画布的不透明指针**：`canvas_id`/`node_id` 在 schema 里故意无 FK，
 *    所以所有"这个画布/节点属于本 space 吗"的校验都必须走 canvas 域的 service
 *    （`CanvasService.get`），不能直查 canvases 表——这是 `system-design.md` 的模块边界。
 * 2. **`DELETE /canvases/:canvas_id` 是解绑，不是删画布**（契约 §7 A8）：
 *    竞品同时有 canvas 域自己的删除端点，film 侧再删一次只会让"删了还是没删"说不清。
 *    故本方实现为"删除本 space 下该画布的所有 film 绑定"，响应里明确 `deleted_canvas:false`。
 * 3. **`submit-result` 是唯一自动化衔接点**（机制 #2）：
 *    画布节点产物 → 登记不可变审核版本 → 行状态推 `pending_review` → 广播通知。
 *    没有它，影视版就是外挂 Excel。
 */

/** 绑定整张画布（不带具体节点）时 node_id 的哨兵值：表的唯一键需要非空 node_id */
export const CANVAS_LEVEL_NODE_ID = 0n;

@Injectable()
export class FilmCanvasService {
  constructor(
    @Inject(FilmAccessService) private readonly access: FilmAccessService,
    @Inject(FilmTasksService) private readonly tasks: FilmTasksService,
    @Inject(FilmReviewService) private readonly review: FilmReviewService,
    @Inject(FilmRealtimeService) private readonly realtime: FilmRealtimeService,
    @Inject(CanvasService) private readonly canvas: CanvasService,
  ) {}

  // ── 1. 可绑定的画布列表（画布侧入口）────────────────────

  /**
   * `GET .../canvases/visible?tab=`
   *
   * `tab` 是竞品的分类页签（取值未取证，§7 A8），本期按"原样接受但只做全量返回"处理：
   * 编造页签语义比不实现更糟（前端会按错误分类显示）。
   */
  async visibleCanvases(spaceId: string, tab?: string) {
    const { list } = await this.canvas.list(spaceId, 1, 100);
    return {
      list: list.map((c) => ({
        canvas_id: c.id,
        id: c.id,
        name: c.title,
        cover: null,
        created_at: c.updated_at,
      })),
      tab: tab ?? null,
    };
  }

  // ── 2. 画布侧：这张画布绑了哪些行 ────────────────────────

  private async requireCanvas(spaceId: string, canvasId: string) {
    // 走 canvas 域 service 校验归属（跨 space → 404/403 由 canvas 域决定，不在这里重复造口径）
    return this.canvas.get(spaceId, canvasId);
  }

  async taskBindingsByCanvas(spaceId: string, canvasId: string) {
    await this.requireCanvas(spaceId, canvasId);
    const rows = (await db
      .select({
        taskId: filmCanvasBindings.taskId,
        nodeId: filmCanvasBindings.nodeId,
        title: filmTasks.title,
        status: filmTasks.status,
        tableId: filmTasks.tableId,
      })
      .from(filmCanvasBindings)
      .innerJoin(filmTasks, eq(filmCanvasBindings.taskId, filmTasks.id))
      .where(
        and(
          eq(filmCanvasBindings.canvasId, BigInt(canvasId)),
          eq(filmCanvasBindings.spaceId, BigInt(spaceId)),
          isNull(filmTasks.deletedAt),
        ),
      )
      .orderBy(desc(filmCanvasBindings.createdAt))) as Array<{
      taskId: bigint;
      nodeId: bigint;
      title: string;
      status: number;
      tableId: bigint;
    }>;
    const seen = new Set<string>();
    const list = [];
    for (const r of rows) {
      const key = String(r.taskId);
      if (seen.has(key)) continue; // 同一行绑多个节点时，画布侧只列一行
      seen.add(key);
      list.push({ task_id: key, title: r.title, status: r.status, table_id: String(r.tableId) });
    }
    return { list };
  }

  /**
   * 画布侧任务面板：一行 = 一个任务，带节点、最新版本与产物。
   * 这是"在画布里干活的人"看的面板（与表格视图是同一批数据的两个视角）。
   */
  async taskPanel(spaceId: string, canvasId: string) {
    const canvas = await this.requireCanvas(spaceId, canvasId);
    const bindings = (await db
      .select({
        taskId: filmCanvasBindings.taskId,
        nodeId: filmCanvasBindings.nodeId,
        title: filmTasks.title,
        status: filmTasks.status,
        tableId: filmTasks.tableId,
        reviewVersionNo: filmTasks.reviewVersionNo,
        parentId: filmTasks.parentId,
      })
      .from(filmCanvasBindings)
      .innerJoin(filmTasks, eq(filmCanvasBindings.taskId, filmTasks.id))
      .where(
        and(
          eq(filmCanvasBindings.canvasId, BigInt(canvasId)),
          eq(filmCanvasBindings.spaceId, BigInt(spaceId)),
          isNull(filmTasks.deletedAt),
        ),
      )) as Array<{
      taskId: bigint;
      nodeId: bigint;
      title: string;
      status: number;
      tableId: bigint;
      reviewVersionNo: number;
      parentId: bigint | null;
    }>;
    const byTask = new Map<string, { row: (typeof bindings)[number]; nodeIds: string[] }>();
    for (const b of bindings) {
      const key = String(b.taskId);
      const entry = byTask.get(key) ?? { row: b, nodeIds: [] };
      entry.nodeIds.push(String(b.nodeId));
      byTask.set(key, entry);
    }
    const latest = await Promise.all([...byTask.keys()].map((id) => this.review.latestVersion(id)));
    const latestById = new Map([...byTask.keys()].map((id, i) => [id, latest[i]]));
    return {
      canvas_id: String(canvasId),
      canvas_name: (canvas as { title?: string }).title ?? "",
      tasks: [...byTask.entries()].map(([taskId, entry]) => ({
        task_id: taskId,
        title: entry.row.title,
        status: entry.row.status,
        table_id: String(entry.row.tableId),
        parent_id: entry.row.parentId ? String(entry.row.parentId) : null,
        node_ids: entry.nodeIds,
        review_version_no: entry.row.reviewVersionNo,
        latest_version: latestById.get(taskId)
          ? {
              version_id: String(latestById.get(taskId)?.id),
              version_no: latestById.get(taskId)?.versionNo ?? null,
              status: latestById.get(taskId)?.status ?? null,
            }
          : null,
      })),
    };
  }

  // ── 3. 行侧：这一行绑了哪些画布 ────────────────────────

  async listTaskBindings(table: FilmTableRow, task: FilmTaskRow) {
    const rows = (await db
      .select()
      .from(filmCanvasBindings)
      .where(eq(filmCanvasBindings.taskId, task.id))
      .orderBy(desc(filmCanvasBindings.createdAt))) as Array<{
      id: bigint;
      taskId: bigint;
      canvasId: bigint;
      nodeId: bigint;
      createdAt: Date;
    }>;
    return {
      canvas_ids: [...new Set(rows.map((r) => String(r.canvasId)))],
      list: rows.map((r) => ({
        id: String(r.id),
        binding_id: String(r.id),
        task_id: String(r.taskId),
        canvas_id: String(r.canvasId),
        node_id: String(r.nodeId),
        created_at: r.createdAt.toISOString(),
      })),
      table_id: String(table.id),
    };
  }

  /** POST：追加绑定（幂等：同一 (task,canvas,node) 重复调用返回既有绑定） */
  async bind(table: FilmTableRow, task: FilmTaskRow, input: { canvas_id: string; node_id?: string }, userId: string) {
    await this.requireCanvas(String(table.spaceId), input.canvas_id);
    const nodeId = input.node_id ? BigInt(input.node_id) : CANVAS_LEVEL_NODE_ID;
    await db
      .insert(filmCanvasBindings)
      .values({
        id: newId(),
        taskId: task.id,
        canvasId: BigInt(input.canvas_id),
        nodeId,
        spaceId: table.spaceId,
        createdBy: BigInt(userId),
      })
      .onConflictDoNothing();
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.canvas_bound",
      payload: { task_id: String(task.id), canvas_id: input.canvas_id, node_id: String(nodeId) },
      originUserId: userId,
    });
    return this.listTaskBindings(table, task);
  }

  /**
   * PUT：全量替换（契约请求体 `{canvas_ids:[]}`）。
   *
   * 语义是"这一行的画布就是这些"：多余的全删。**节点级绑定会被压平为画布级**
   * （node_id=0 哨兵），因为替换请求只给了 canvas_ids——保留旧节点会造成
   * "响应说这些画布、实际还多绑了节点"的不一致。
   */
  async replaceBindings(table: FilmTableRow, task: FilmTaskRow, canvasIds: string[], userId: string) {
    for (const id of canvasIds) await this.requireCanvas(String(table.spaceId), id);
    await db.transaction(async (tx) => {
      await tx.delete(filmCanvasBindings).where(eq(filmCanvasBindings.taskId, task.id));
      for (const canvasId of [...new Set(canvasIds)]) {
        await tx.insert(filmCanvasBindings).values({
          id: newId(),
          taskId: task.id,
          canvasId: BigInt(canvasId),
          nodeId: CANVAS_LEVEL_NODE_ID,
          spaceId: table.spaceId,
          createdBy: BigInt(userId),
        });
      }
    });
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.canvas_bindings_replaced",
      payload: { task_id: String(task.id), canvas_ids: canvasIds },
      originUserId: userId,
    });
    return this.listTaskBindings(table, task);
  }

  /** DELETE：解绑指定画布；不传 = 解绑全部 */
  async unbind(table: FilmTableRow, task: FilmTaskRow, canvasIds: string[], userId: string) {
    const conds = [eq(filmCanvasBindings.taskId, task.id)];
    if (canvasIds.length > 0) conds.push(inArray(filmCanvasBindings.canvasId, canvasIds.map((v) => BigInt(v))));
    const removed = (await db.delete(filmCanvasBindings).where(and(...conds)).returning()) as Array<{ id: bigint }>;
    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.canvas_unbound",
      payload: { task_id: String(task.id), canvas_ids: canvasIds, removed: removed.length },
      originUserId: userId,
    });
    return { ...(await this.listTaskBindings(table, task)), removed: removed.length };
  }

  // ── 4. submit-result（机制 #2：唯一自动化衔接点）─────────

  /**
   * 画布节点把产物提交给某一行。
   *
   * 完整链路（这是本批最关键的自动化语义）：
   *   1) 校验画布属于本 space（走 canvas 域）
   *   2) 校验产物 asset 属于本 space（跨租户引用一律拒）
   *   3) 没有绑定则**自动补绑**（提交动作本身就是绑定关系的证据）
   *   4) 登记不可变审核版本（V0x）+ 行状态推 pending_review
   *   5) 广播通知（负责人/协作者）
   *
   * 为什么允许自动补绑：画布侧提交时往往只有 task_id（用户从任务面板直接提交），
   * 强制先绑会多一步无意义操作；而"提交了产物"本身就说明这行在画布上干活。
   */
  async submitResult(params: {
    spaceId: string;
    canvasId: string;
    userId: string;
    input: { task_id: string; node_id: string; asset_ids: string[]; thumb_file_id?: string; comment?: string };
    clientId?: string | null;
  }) {
    const { spaceId, canvasId, userId, input } = params;
    await this.requireCanvas(spaceId, canvasId);
    const [task] = (await db
      .select()
      .from(filmTasks)
      .where(and(eq(filmTasks.id, BigInt(input.task_id)), eq(filmTasks.spaceId, BigInt(spaceId)), isNull(filmTasks.deletedAt)))
      .limit(1)) as FilmTaskRow[];
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, "film task not found");
    const table = await this.access.requireTable(spaceId, task.tableId);

    if (input.asset_ids.length > 0) {
      const found = (await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.spaceId, BigInt(spaceId)),
            isNull(assets.deletedAt),
            inArray(assets.id, input.asset_ids.map((v) => BigInt(v))),
          ),
        )) as Array<{ id: bigint }>;
      if (found.length !== new Set(input.asset_ids).size) {
        throw new AppError(ErrorCode.INVALID_PARAM, "some asset_ids do not belong to this space", {
          field: "asset_ids",
          reason: "unknown_asset",
        });
      }
    }

    // 3) 自动补绑（幂等：unique(task,canvas,node)）
    await db
      .insert(filmCanvasBindings)
      .values({
        id: newId(),
        taskId: task.id,
        canvasId: BigInt(canvasId),
        nodeId: BigInt(input.node_id),
        spaceId: table.spaceId,
        createdBy: BigInt(userId),
      })
      .onConflictDoNothing();

    // 4) 不可变版本 + 行状态推 pending_review
    const version = await this.review.submitVersion({
      table,
      task,
      userId,
      assetIds: [...new Set(input.asset_ids)],
      thumbFileId: input.thumb_file_id,
      comment: input.comment,
      source: "canvas",
      nodeId: input.node_id,
    });

    // 5) 通知（广播面；离线站内消息待 notifications 表，见回报）
    const notify = await this.tasks.notifyAssignees({ table, task, userId, opUserIds: [] });

    this.realtime.broadcast({
      spaceId,
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "canvas.submit_result",
      payload: {
        task_id: String(task.id),
        canvas_id: canvasId,
        node_id: input.node_id,
        version_id: version.version_id,
        version_no: version.version_no,
        task_status: FilmTaskStatus.PENDING_REVIEW,
      },
      originUserId: userId,
      originClientId: params.clientId,
    });

    return {
      ok: true,
      task_id: String(task.id),
      canvas_id: canvasId,
      node_id: input.node_id,
      version_id: version.version_id,
      version_no: version.version_no,
      task_status: FilmTaskStatus.PENDING_REVIEW,
      notified: notify.notified,
      user_ids: notify.user_ids,
    };
  }

  // ── 5. DELETE /canvases/:canvas_id（解绑，不删画布）─────

  async unbindCanvas(spaceId: string, canvasId: string, userId: string) {
    await this.requireCanvas(spaceId, canvasId);
    const removed = (await db
      .delete(filmCanvasBindings)
      .where(and(eq(filmCanvasBindings.canvasId, BigInt(canvasId)), eq(filmCanvasBindings.spaceId, BigInt(spaceId))))
      .returning()) as Array<{ id: bigint; taskId: bigint }>;
    const taskIds = [...new Set(removed.map((r) => String(r.taskId)))];
    this.realtime.broadcast({
      spaceId,
      projectId: "",
      tableId: "",
      type: "canvas.unbound",
      payload: { canvas_id: canvasId, task_ids: taskIds },
      originUserId: userId,
    });
    return { ok: true, unbound_task_ids: taskIds, unbound_bindings: removed.length, deleted_canvas: false };
  }

  /** 供统计/导出复用：某项目下被绑定的画布数 */
  async boundCanvasCount(spaceId: string, projectId: string) {
    const [row] = (await db
      .select({ n: sql<number>`count(distinct ${filmCanvasBindings.canvasId})::int` })
      .from(filmCanvasBindings)
      .innerJoin(filmTasks, eq(filmCanvasBindings.taskId, filmTasks.id))
      .innerJoin(filmTables, eq(filmTasks.tableId, filmTables.id))
      .where(
        and(
          eq(filmCanvasBindings.spaceId, BigInt(spaceId)),
          eq(filmTables.projectId, BigInt(projectId)),
          isNull(filmTasks.deletedAt),
        ),
      )) as Array<{ n: number }>;
    return Number(row?.n ?? 0);
  }
}
