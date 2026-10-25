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

/** 对外 DTO（clip_id 必填、task_id 归一为 string|null） */
export interface TimelineClipDto {
  clip_id: string;
  shot_id: string;
  task_id: string | null;
  name: string;
  duration: number;
}
