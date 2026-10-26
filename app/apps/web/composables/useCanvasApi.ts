import type {
  CanvasMaterialDto,
  CanvasCommentNodeDto,
  CanvasCommentDto,
  PinGroupDto,
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

    // ── 节点派生任务（C6，复用 tasks 体系）──────────────────
    /** 单节点投递：建任务 + 回写 node.task_id/status */
    generateNode: (canvasId: string, nodeId: string, payload: NodeGeneratePayload) =>
      api.post<NodeGenerateResult>(
        `${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/generate`,
        payload,
      ),

    /** 批量投递（≤50，逐条独立） */
    batchNodeTasks: (canvasId: string, items: Array<{ node_id: string } & NodeGeneratePayload>) =>
      api.post<{
        submitted: number;
        results: Array<{ node_id: string; task_id?: string; submitted: boolean; code?: number; msg?: string; credits_estimate?: number }>;
        total_credits: number;
      }>(`${base(canvasId)}/batch-node-tasks`, { items }),

    /** 节点任务状态（含结果） */
    nodeTaskStatus: (canvasId: string, nodeId: string, taskId: string) =>
      api.get<NodeTaskStatusResult>(
        `${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/task/${encodeURIComponent(taskId)}`,
      ),

    /** 校正一批节点的任务状态（打开画布时调一次，避免永远停在"生成中"） */
    syncNodeTasks: (canvasId: string, nodeIds: string[]) =>
      api.post<{ nodes: Array<{ id: string; status: number; task_id: string | null; task_status: number | null }> }>(
        `${base(canvasId)}/nodes/sync-tasks`,
        { node_ids: nodeIds },
      ),

    // ── 整画布模板（C2）────────────────────────────────────
    listTemplates: (opts: { tpl_type?: number; page?: number; page_size?: number; mine?: boolean } = {}) => {
      const q = new URLSearchParams();
      if (opts.tpl_type !== undefined) q.set("tpl_type", String(opts.tpl_type));
      q.set("page", String(opts.page ?? 1));
      q.set("page_size", String(opts.page_size ?? 20));
      if (opts.mine) q.set("mine", "1");
      return api.get<{ list: CanvasTemplateDto[]; total: number; page: number; page_size: number }>(
        `/canvas/templates?${q.toString()}`,
      );
    },

    searchPersonalTemplates: (query: string, page = 1, pageSize = 20) =>
      api.get<{ list: CanvasTemplateDto[]; total: number; page: number; page_size: number }>(
        `/canvas/templates/personal?query=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`,
      ),

    getTemplate: (templateId: string) =>
      api.get<{ template: CanvasTemplateDto }>(`/canvas/templates/${encodeURIComponent(templateId)}`),

    /** 套用模板：返回待插入的节点描述（前端合并进本地画布后走正常 commit） */
    instantiateTemplate: (templateId: string, offset?: { dx?: number; dy?: number }) =>
      api.get<{ nodes: TemplateNodeDraft[]; total: number; template: CanvasTemplateDto }>(
        `/canvas/templates/${encodeURIComponent(templateId)}/instantiate?dx=${offset?.dx ?? 0}&dy=${offset?.dy ?? 0}`,
      ),

    /** 把当前画布存成模板 */
    saveAsTemplate: (canvasId: string, input: { name: string; tpl_scope?: number; description?: string }) =>
      api.post<{ template_id: string }>(`${base(canvasId)}/tpls`, input),

    deleteTemplate: (templateId: string) =>
      api.delete<{ ok: boolean }>(`/canvas/templates/personal/${encodeURIComponent(templateId)}`),

    syncTemplateToTeam: (templateId: string, teamSpaceId: string) =>
      api.post<{ template_id: string }>(`/canvas/templates/${encodeURIComponent(templateId)}/sync-team`, {
        team_space_id: teamSpaceId,
      }),

    // ── 素材（C8）──────────────────────────────────────────
    listMaterials: (
      canvasId: string,
      opts: { material_type?: string; source?: number; node_id?: string; page?: number; page_size?: number } = {},
    ) => {
      const q = new URLSearchParams();
      if (opts.material_type) q.set("material_type", opts.material_type);
      if (opts.source !== undefined) q.set("source", String(opts.source));
      if (opts.node_id) q.set("node_id", opts.node_id);
      q.set("page", String(opts.page ?? 1));
      q.set("page_size", String(opts.page_size ?? 40));
      return api.get<{ list: CanvasMaterialDto[]; total: number; page: number; page_size: number }>(
        `${base(canvasId)}/materials?${q.toString()}`,
      );
    },

    createMaterial: (
      canvasId: string,
      input: { object_key: string; material_type: string; name?: string; node_id?: string; source?: number },
    ) => api.post<{ material_id: string }>(`${base(canvasId)}/materials`, input),

    batchDeleteMaterials: (canvasId: string, materialIds: string[]) =>
      api.post<{ deleted: number }>(`${base(canvasId)}/materials/batch-delete`, { material_ids: materialIds }),

    registerUpload: (canvasId: string, objectKey: string) =>
      api.post<{ file_id: string; uri: string }>(`${base(canvasId)}/upload-file`, { object_key: objectKey }),

    batchDownloadMaterials: (canvasId: string, materialIds: string[]) =>
      api.post<{
        list: Array<{ material_id: string; object_key: string | null; material_type: string; name: string }>;
        missing: string[];
      }>(`${base(canvasId)}/materials/batch-download`, { material_ids: materialIds }),

    // ── 批注（C9）──────────────────────────────────────────
    listCommentNodes: (canvasId: string, opts: { scope?: string; resolved?: boolean; page?: number; page_size?: number } = {}) => {
      const q = new URLSearchParams();
      if (opts.scope) q.set("scope", opts.scope);
      if (opts.resolved !== undefined) q.set("resolved", opts.resolved ? "1" : "0");
      q.set("page", String(opts.page ?? 1));
      q.set("page_size", String(opts.page_size ?? 100));
      return api.get<{ list: CanvasCommentNodeDto[]; total: number; page: number; page_size: number }>(
        `${base(canvasId)}/comment-nodes?${q.toString()}`,
      );
    },

    createCommentNode: (
      canvasId: string,
      input: { anchor: { x: number; y: number }; node_id?: string; scope?: string; content: string },
    ) => api.post<{ comment_node_id: string }>(`${base(canvasId)}/comment-nodes`, input),

    updateCommentNode: (canvasId: string, cnId: string, input: { anchor?: { x: number; y: number }; scope?: string }) =>
      api.put<{ ok: boolean }>(`${base(canvasId)}/comment-nodes/${encodeURIComponent(cnId)}`, input),

    deleteCommentNode: (canvasId: string, cnId: string) =>
      api.delete<{ ok: boolean }>(`${base(canvasId)}/comment-nodes/${encodeURIComponent(cnId)}`),

    listComments: (canvasId: string, cnId: string) =>
      api.get<{ list: CanvasCommentDto[] }>(`${base(canvasId)}/comment-nodes/${encodeURIComponent(cnId)}/comments`),

    addComment: (canvasId: string, cnId: string, content: string) =>
      api.post<{ comment_id: string }>(`${base(canvasId)}/comment-nodes/${encodeURIComponent(cnId)}/comments`, {
        content,
      }),

    resolveCommentNode: (canvasId: string, cnId: string, resolved: boolean) =>
      api.post<{ comment_node_id: string; resolved: boolean }>(
        `${base(canvasId)}/comment-nodes/${encodeURIComponent(cnId)}/resolve`,
        { resolved },
      ),

    // ── 固定组（C10）────────────────────────────────────────
    listPinGroups: (canvasId: string) =>
      api.get<{ list: PinGroupDto[]; max_slots: number }>(`${base(canvasId)}/pin-groups`),

    upsertPinGroup: (
      canvasId: string,
      slot: number,
      input: { name?: string; color?: string; node_ids: string[] },
    ) =>
      api.put<{ pin_group: PinGroupDto; replaced: boolean }>(`${base(canvasId)}/pin-groups/${slot}`, input),

    deletePinGroup: (canvasId: string, slot: number) =>
      api.delete<{ group_id: string; cleared: number }>(`${base(canvasId)}/pin-groups/${slot}`),

    clearPinGroupMembers: (canvasId: string, slot: number) =>
      api.delete<{ group_id: string; cleared: number }>(`${base(canvasId)}/pin-groups/${slot}/members`),

    setNodePinGroups: (canvasId: string, nodeId: string, groupIds: string[]) =>
      api.put<{ node_id: string; group_ids: string[] }>(
        `${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/pin-groups`,
        { group_ids: groupIds },
      ),
  };
};

export interface NodeGeneratePayload {
  mode: string;
  model: string;
  input?: { prompt?: string; reference_uris?: string[]; first_frame_uri?: string | null; last_frame_uri?: string | null };
  options?: Record<string, unknown>;
  quote_id?: string;
}

export interface NodeGenerateResult {
  task_id: string;
  status: number;
  credits_estimate: number;
  node: { id: string; status: number; task_id: string | null };
}

export interface NodeTaskStatusResult {
  task: {
    task_id: string;
    status: number;
    progress: number;
    results: Array<{ uri?: string; preview_uri?: string; [k: string]: unknown }>;
    error: { code?: number; kind?: string; message?: string } | null;
  };
  node: { id: string; status: number; task_id: string | null };
}

export interface CanvasTemplateDto {
  id: string;
  /** 1 官方 2 团队 3 个人 */
  tpl_scope: number;
  tpl_type: number;
  name: string;
  description: string;
  cover_uri: string | null;
  payload: { nodes?: unknown[]; edges?: unknown[]; groups?: unknown[] } | null;
  status: number;
  sort: number;
  space_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** 模板套用返回的"待插入节点描述"（无 id，前端自己生成本地 id） */
export interface TemplateNodeDraft {
  node_type: string;
  name: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  z_index: number;
  params: Record<string, unknown>;
}



