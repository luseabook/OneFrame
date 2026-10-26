/**
 * 画布（canvas）域前端类型
 *
 * 唯一事实来源：`app/apps/api/src/modules/canvas/canvas.controller.ts` +
 * `canvas.service.ts` 的实际返回结构（不是文档推断）。
 * 字段命名保持 snake_case，与 API 原样一致——不做驼峰转换，
 * 避免"DTO 与后端漂移"这类静默错误。
 */

/** 11 种节点类型（硬约束，与 canvas.service.ts CANVAS_NODE_TYPES 逐字一致） */
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

/** 节点展示元数据（图标用内联 SVG path，避免引第三方图标库） */
export interface NodeTypeMeta {
  value: CanvasNodeType;
  label: string;
  /** 工具栏/空态 chip 用的短标签 */
  short: string;
  hint: string;
  /** 节点默认宽度（不同节点的内容密度差异大） */
  width: number;
  /** 主色（节点头部强调色） */
  color: string;
}

export const NODE_TYPE_META: Record<CanvasNodeType, NodeTypeMeta> = {
  text: { value: "text", label: "文本", short: "文本", hint: "提示词 / 剧本片段", width: 260, color: "#7aa2ff" },
  table: { value: "table", label: "表格", short: "表格", hint: "结构化数据 / Excel 导入", width: 320, color: "#5fd08a" },
  image: { value: "image", label: "图像", short: "图像", hint: "文生图 / 图生图 / 局部重绘", width: 280, color: "#c99bff" },
  video: { value: "video", label: "视频", short: "视频", hint: "文生视频 / 首帧 / 首尾帧", width: 300, color: "#ff9f6b" },
  audio: { value: "audio", label: "音频", short: "音频", hint: "配音 / 音乐 / 音效", width: 260, color: "#6bd5d0" },
  clip: { value: "clip", label: "视频合成", short: "合成", hint: "时间线成片 / 导出", width: 320, color: "#f5b544" },
  script: { value: "script", label: "剧本拆资产/分镜", short: "剧本", hint: "拆资产 / 拆分镜", width: 280, color: "#b8afff" },
  asset: { value: "asset", label: "资产", short: "资产", hint: "角色 / 场景 / 道具", width: 260, color: "#f56767" },
  director: { value: "director", label: "3D 导演台", short: "导演台", hint: "机位 / 定格", width: 300, color: "#63b3ff" },
  threeDWorld: { value: "threeDWorld", label: "3D 世界", short: "3D 世界", hint: "三维场景生成", width: 300, color: "#8f7bff" },
  group: { value: "group", label: "分组", short: "分组", hint: "把节点归到一组", width: 320, color: "#8b93a7" },
};

/** 参照站工具栏只露出这 8 个（director/threeDWorld/group 不在主工具栏） */
export const TOOLBAR_NODE_TYPES: CanvasNodeType[] = [
  "text",
  "table",
  "image",
  "video",
  "audio",
  "clip",
  "asset",
  "script",
];

export interface CanvasNodeDto {
  id: string;
  node_type: CanvasNodeType | string;
  name: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  z_index: number;
  params: Record<string, unknown>;
  task_id: string | null;
  status: number;
  group_ids: string[];
  version: number;
}

export interface CanvasEdgeDto {
  id: string;
  src_node_id: string;
  dst_node_id: string;
  semantic: "pipeline" | "reference" | "sequence" | string;
}

export interface CanvasGroupDto {
  id: string;
  parent_id: string | null;
  name: string | null;
  sort: number;
  status: number;
}

export interface CanvasSummary {
  id: string;
  title: string;
  version: number;
  creation_mode: number;
  episode_id: string | null;
  pinned_node_id: string | null;
}

export interface CanvasListItem extends CanvasSummary {
  last_edited_at: string | null;
  updated_at: string;
}

export interface CanvasDetail {
  canvas: CanvasSummary;
  nodes: CanvasNodeDto[];
  edges: CanvasEdgeDto[];
  groups: CanvasGroupDto[];
}

export interface CanvasSnapshot {
  id: string;
  version: number;
  kind: number;
  created_at: string;
}

/** 提交载荷（整图替换） */
export interface CommitPayload {
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
}

export interface CommitResult {
  version: number;
  nodes: number;
  edges: number;
  /**
   * 本地临时 id → 真实雪花 id。
   * 保存后**必须**用它把本地 id 换掉，否则下次提交会把同一批节点当新节点再建一遍。
   */
  id_map?: Record<string, string>;
}

/** 节点运行状态：1 空闲 2 生成中 3 完成（与后端 status 1..3 一致） */
export const NODE_STATUS = { IDLE: 1, RUNNING: 2, DONE: 3 } as const;

/** 错误码（与 packages/shared ErrorCode 一致） */
export const CANVAS_ERR = {
  VERSION_CONFLICT: 746002,
  NODE_LOCKED: 746003,
} as const;

// ── 素材 / 批注（C8/C9）────────────────────────────────────
// 放这里而不是 useCanvasApi.ts：类型是跨组件共享的契约，
// 让组件只依赖 types/canvas 一个入口，避免 import 互相缠绕。

export interface CanvasMaterialDto {
  id: string;
  material_type: string;
  /** 1 上传 2 节点产出 3 资产库引用 */
  source: number;
  node_id: string | null;
  name: string;
  /** 只存 object_key，不存 URL（直链会过期，换存储驱动还要洗库） */
  object_key: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface CanvasCommentNodeDto {
  id: string;
  anchor: { x: number; y: number };
  node_id: string | null;
  scope: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  comment_count?: number;
}

export interface CanvasCommentDto {
  id: string;
  comment_node_id: string;
  content: string;
  mentions: string[];
  created_by: string | null;
  created_at: string;
}

export interface PinGroupDto {
  group_id: string;
  name: string | null;
  color: string | null;
  /** 1..7 */
  slot: number;
  node_ids: string[];
}
