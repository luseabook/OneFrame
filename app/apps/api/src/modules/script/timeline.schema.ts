import { z } from "zod";

// P7 时间线（per-episode 持久化）：请求校验 + 共享类型。
// 元素契约（与前端/worker 对齐）：{ clip_id, shot_id, task_id, name, duration }
export const TIMELINE_CLIP_MAX = 100;

export const timelineClipSchema = z.object({
  /** 客户端可省略；服务端生成并回填（同一集内唯一） */
  clip_id: z.string().trim().min(1).max(64).optional(),
  shot_id: z.string().min(1).max(32),
  /** 源任务（视频任务）；可空表示尚未生成，导出时按跳过/mock 色板处理 */
  task_id: z.string().min(1).max(32).nullish(),
  name: z.string().trim().min(1).max(100),
  /** 片段时长（秒，整数 1..30） */
  duration: z.number().int().min(1).max(30),
});
export type TimelineClipInput = z.infer<typeof timelineClipSchema>;

export const timelinePutSchema = z.object({
  clips: z.array(timelineClipSchema).max(TIMELINE_CLIP_MAX),
});
export type TimelinePutRequest = z.infer<typeof timelinePutSchema>;

/**
 * 片段资产绑定（`POST .../timeline/clips/:clipId/assets`，竞品 `wf/clip-bind-asset`）。
 *
 * - `asset`：空间资产（`assets.id`）
 * - `project_asset`：项目资产（`project_assets.id`）
 * - `shot_product`：镜头产物（由 `task_id` 解析出 `tasks.results[0].uri`）
 */
export interface TimelineClipAssetDto {
  source: "asset" | "project_asset" | "shot_product";
  id: string;
  name: string;
  uri: string;
  task_id?: string | null;
}

/** 对外 DTO（clip_id 必填、task_id 归一为 string|null） */
export interface TimelineClipDto {
  clip_id: string;
  shot_id: string;
  task_id: string | null;
  name: string;
  duration: number;
  /**
   * 片段绑定的资产（可选字段）：**只在有绑定时出现**。
   * 为什么不做成恒有字段：既有 `timeline.spec` 断言了 clip 的键集合
   * （`clip_id/duration/name/shot_id/task_id`），恒有会直接破坏既有契约；
   * 空数组也没有信息量。绑定走专门端点维护，PUT 整体覆盖时按 clip_id 保留。
   */
  assets?: TimelineClipAssetDto[];
}
