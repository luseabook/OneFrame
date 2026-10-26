import type {
  CanvasDetail,
  CanvasListItem,
  CanvasSnapshot,
  CommitPayload,
  CommitResult,
} from "~/types/canvas";

/**
 * canvas 域 API 客户端
 *
 * 与 `app/apps/api/src/modules/canvas/canvas.controller.ts` 一一对应。
 * 只包一层：把"整图提交 / 节点 / 连线 / 锁"这些语义命名清楚，
 * 不在这里做业务判断（冲突提示、脏标记都在编辑器里做）。
 */
export const useCanvasApi = () => {
  const api = useApi();
  const base = (canvasId: string) => `/canvas/canvases/${encodeURIComponent(canvasId)}`;

  return {
    // ── 画布本体 ──────────────────────────────────────────
    list: (page = 1, pageSize = 24) =>
      api.get<{ list: CanvasListItem[]; total: number; page: number; page_size: number }>(
        `/canvas/canvases?page=${page}&page_size=${pageSize}`,
      ),

    create: (input: { title?: string; creation_mode?: number; episode_id?: string } = {}) =>
      api.post<{ id: string; version: number }>("/canvas/canvases", input),

    detail: (canvasId: string) => api.get<CanvasDetail>(base(canvasId)),

    /** 改名走画布级乐观锁：version 不匹配 → 746002 */
    rename: (canvasId: string, input: { title: string; version?: number }) =>
      api.patch<{ ok: boolean; version: number }>(base(canvasId), input),

    remove: (canvasId: string) => api.delete<{ ok: boolean }>(base(canvasId)),

    /** 整图提交：乐观锁 + 整体替换 + 版本推进 + 写快照 */
    commit: (canvasId: string, payload: CommitPayload) =>
      api.post<CommitResult>(`${base(canvasId)}/commit`, payload),

    snapshots: (canvasId: string, limit = 20) =>
      api.get<{ list: CanvasSnapshot[] }>(`${base(canvasId)}/snapshots?limit=${limit}`),

    snapshot: (canvasId: string, version: number) =>
      api.get<{ version: number; payload: unknown; created_at: string }>(
        `${base(canvasId)}/snapshots/${version}`,
      ),

    // ── 节点锁（Redis TTL 30s；被他人持锁 → 746003）────────
    lock: (canvasId: string, nodeId: string) =>
      api.post<{ ok: boolean }>(`${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/lock`),

    unlock: (canvasId: string, nodeId: string) =>
      api.post<{ ok: boolean }>(`${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/unlock`),

    renew: (canvasId: string, nodeId: string) =>
      api.post<{ ok: boolean }>(`${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/renew`),

    /** 画布级心跳：续期画布占用 + 返回当前锁快照（用于渲染"他人编辑中"） */
    heartbeat: (canvasId: string) =>
      api.post<{ locked_nodes: Array<{ node_id: string; user_id: string }> }>(
        `${base(canvasId)}/heartbeat`,
      ),

    // ── 分组 ──────────────────────────────────────────────
    createGroup: (canvasId: string, input: { name?: string; parent_id?: string | null; sort?: number }) =>
      api.post<{ id: string }>(`${base(canvasId)}/groups`, input),

    deleteGroup: (canvasId: string, groupId: string) =>
      api.delete<{ ok: boolean }>(`${base(canvasId)}/groups/${encodeURIComponent(groupId)}`),

    /** 钉住节点（单选；node_id=null 取消） */
    pinNode: (canvasId: string, nodeId: string | null) =>
      api.put<{ ok: boolean }>(`${base(canvasId)}/pinned-node`, { node_id: nodeId }),
  };
};
