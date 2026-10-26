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

    // ── 表格节点 Excel 导入（两步式）────────────────────────
    /**
     * 第一步：只解析并列出工作表，**不写入节点**。
     * 参照站实测「不会自动选第一个 Sheet」——多 Sheet 排期表自动选第一个会静默导错。
     */
    importTable: (canvasId: string, nodeId: string, input: { file_name: string; file_base64: string }) =>
      api.post<TableImportResult>(
        `${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/table/import`,
        input,
      ),

    /** 第二步：显式确认工作表 → 写入节点参数（后端会把 sheet_selection_required 置 false） */
    confirmTableSheet: (
      canvasId: string,
      nodeId: string,
      input: { import_token: string; sheet_id: string },
    ) =>
      api.post<{
        node: { node_id: string; version: number };
        sheet: TableSheetMeta;
        sheets: TableSheetMeta[];
        table: Record<string, unknown>;
      }>(`${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/table/confirm-sheet`, input),

    // ── 节点产物批量下载（C13）──────────────────────────────
    /** 打包选中节点的产物 → 产生一张"下载单"（后续可反复现签链接） */
    batchDownloadNodes: (canvasId: string, nodeIds: string[]) =>
      api.post<DownloadListDto>(`${base(canvasId)}/nodes/batch-download`, { node_ids: nodeIds }),

    /** 下载记录：链接过期后仍能重新取（这也是下载单必须落库的原因） */
    listDownloadLists: (canvasId: string, page = 1, pageSize = 20) =>
      api.get<{ list: DownloadListDto[]; total: number; page: number; page_size: number }>(
        `${base(canvasId)}/download-lists?page=${page}&page_size=${pageSize}`,
      ),

    // ── 文本类派生（按次计价；价目由后台配置）──────────────
    /** 剧本优化：不传 source_text 就用节点自身原文 */
    scriptOptimization: (
      canvasId: string,
      nodeId: string,
      input: { source_text?: string; prompt?: string; model?: string } = {},
    ) =>
      api.post<DeriveResult>(
        `${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/script-optimization`,
        input,
      ),

    /** 拆解分镜（结果由 worker 回写到节点 params.result_text） */
    storyboardParse: (
      canvasId: string,
      nodeId: string,
      input: { source_text?: string; prompt?: string; model?: string } = {},
    ) =>
      api.post<DeriveResult>(
        `${base(canvasId)}/nodes/${encodeURIComponent(nodeId)}/storyboard-parse`,
        input,
      ),

    /** 现签 24h 链接 */
    downloadListUrl: (canvasId: string, listId: string) =>
      api.post<{ url: string; filename: string; file_count: number; expires_in: number }>(
        `${base(canvasId)}/download-lists/${encodeURIComponent(listId)}/url`,
      ),
  };
};

/** 下载单（打包产物 + 文件数 + 就绪状态） */
export interface DownloadListDto {
  download_list_id: string;
  canvas_id: string;
  node_count: number;
  file_count: number;
  filename: string;
  status: number;
  created_at: string;
}

/** 工作表的元信息（不含行数据：几十万行的表不能整表回给客户端） */
export interface TableSheetMeta {
  sheet_id: string;
  name: string;
  row_count: number;
  col_count: number;
  truncated: boolean;
}

export interface TableImportResult {
  import_token: string;
  file_name: string;
  sheets: TableSheetMeta[];
  preview: string[][];
  warnings: string[];
  limits: { max_sheets: number; max_rows_per_sheet: number; max_cols: number };
}

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




/** 文本类派生的返回（任务 id + 节点状态 + 报价） */
export interface DeriveResult {
  task_id: string;
  status: number;
  credits_estimate: number;
  node: { id: string; status: number; task_id: string };
}