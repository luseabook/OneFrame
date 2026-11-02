/**
 * 分镜状态的唯一口径。权威来源：
 * - packages/db/src/schema.ts：storyboards.status「1 草稿 2 确认 3 已投递 4 出图 5 出片」
 * - apps/worker/src/executor.ts：视频成功→5；出图成功→4；视频失败/审核拒绝→2（不清空 video_task_id）
 *
 * 注意：video_task_id 只表示「投递过一次」，失败回滚时不会被清空。
 * 「已出片 / 已定稿 / 可进时间线」必须看 status === 5；
 * 「在途」必须看 status === 3；不能只看 video_task_id。
 */
export const SHOT_STATUS = {
  DRAFT: 1,
  CONFIRMED: 2,
  SUBMITTED: 3,
  IMAGE: 4,
  RENDERED: 5,
} as const;

export type ShotStage = "draft" | "confirmed" | "submitted" | "image" | "rendered";

export interface ShotStatusLike {
  status: number;
}

export interface ShotTaskLike extends ShotStatusLike {
  video_task_id?: string | null;
}

export function shotStage(shot: ShotStatusLike): ShotStage {
  switch (shot.status) {
    case SHOT_STATUS.CONFIRMED:
      return "confirmed";
    case SHOT_STATUS.SUBMITTED:
      return "submitted";
    case SHOT_STATUS.IMAGE:
      return "image";
    case SHOT_STATUS.RENDERED:
      return "rendered";
    default:
      return "draft";
  }
}

/** 在途：已投递、等结果 */
export function isShotInFlight(shot: ShotStatusLike): boolean {
  return shot.status === SHOT_STATUS.SUBMITTED;
}

/** 已出片：状态为 5（仅表示渲染完成这个状态） */
export function isShotRendered(shot: ShotStatusLike): boolean {
  return shot.status === SHOT_STATUS.RENDERED;
}

/** 已定稿：有出片状态且确实有可播放的视频任务，才允许进时间线 */
export function isShotFinalized(shot: ShotTaskLike): boolean {
  return isShotRendered(shot) && Boolean(shot.video_task_id);
}

/** 已提交过且未回滚：用于预算「已消耗」与幂等提示（3 或 5） */
export function isShotCommitted(shot: ShotStatusLike): boolean {
  return shot.status === SHOT_STATUS.SUBMITTED || shot.status === SHOT_STATUS.RENDERED;
}
