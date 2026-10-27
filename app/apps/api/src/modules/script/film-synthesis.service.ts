import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  episodes,
  exportJobs,
  projectTimelines,
  scriptProjects,
  storyboards,
  tasks,
  timelineExports,
} from "@app/db";
import { AppError, ErrorCode, TaskStatus, newId } from "@app/shared";
import { db } from "../../db/database";
import { QueueService } from "../../queue/queue.service";

/**
 * 分集合成导出（`POST /projects/{id}/episodes/{eid}/film-synthesis-export`）。
 *
 * 竞品证据：
 * - `target-spec.md:124`（PRD F2⑦）：导出**异步任务**、仅打包 SUCCEEDED 镜头 + manifest、
 *   成功镜 <80% **拒绝 400106**；成片拼接到 v1.1（我方已具备 `timeline.export` 的 ffmpeg 合成）；
 * - `target-spec.md:174`：400106 = 导出成功镜 <80%；400105 = 资产未定稿。
 *
 * ## 这一条为什么同时建两个 job
 *
 * - **zip 包（`exports` 表 / `export.zip` 队列 / worker `runExport`）**：竞品口径的"整集导出"
 *   是**逐镜 mp4 + manifest.json** 的压缩包，worker 侧已实现 80% 闸门与 AI 标识清单；
 *   任务要求"复用 exportJobs 四态"，指的就是这条既有通道（1 PENDING / 2 PACKAGING / 3 SUCCEEDED / 4 FAILED）。
 * - **成片 mp4（`timeline_exports` / `timeline.export` 队列 / worker `runTimelineExport`）**：
 *   任务要求"产出整集 mp4，含 watermark"，而 zip 通道产不出 mp4；既有 worker 的合成器
 *   已经做了「统一分辨率/30fps/h264/右下角 AI 生成水印」。所以合成走这条，**不新增表**
 *   （`timeline_exports` 是既有表，注释也写明它沿用 exports 的四态语义）。
 *
 * 两条通道都只 enqueue，不在这里跑 ffmpeg（转码是 worker 的活）。响应里两个 id 都给，
 * 前端分别轮询 `GET .../exports/:xid`（zip 四态）与 `GET .../timeline/export/:id`（mp4 四态）。
 *
 * ## 80% 闸门为什么在 API 侧预检
 *
 * worker 的 `runExport` 也会判（<80% → status=4 + error 400106），但那是**异步失败**：
 * 用户点了导出要等几秒才知道被拒。API 侧先算一遍可以**同步返回 400106**（含
 * `shots_total / shots_ready / missing_shots`），把"为什么不给导"一次说清；两处判定
 * 用同一口径（video 任务 status=3 的镜头数 / 分镜总数），不会出现"API 放行、worker 拒"。
 */

export interface FilmSynthesisResult {
  export_id: string;
  synthesis_export_id: string;
  status: number;
  status_label: string;
  success_ratio: number;
  shots_total: number;
  shots_ready: number;
  clips: number;
  duration_s: number;
  watermarked: boolean;
  poll: {
    package: string;
    synthesis: string;
  };
}

const MIN_SUCCESS_RATIO = 0.8;

@Injectable()
export class FilmSynthesisService {
  constructor(@Inject(QueueService) private readonly queue: QueueService) {}

  async filmSynthesisExport(
    spaceId: string,
    projectId: string,
    episodeId: string,
  ): Promise<FilmSynthesisResult> {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const shots = await db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, episode.id))
      .orderBy(storyboards.shotNo);
    if (shots.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "episode has no storyboards to export", {
        field: "eid",
        hint: "先生成分镜（或分镜表解析）再导出",
      });
    }

    const taskIds = shots.map((shot) => shot.videoTaskId).filter((id): id is bigint => Boolean(id));
    const readyTaskIds = new Set<string>();
    if (taskIds.length > 0) {
      const rows = await db
        .select({ id: tasks.id, status: tasks.status, results: tasks.results, shotId: tasks.shotId })
        .from(tasks)
        .where(and(inArray(tasks.id, taskIds), eq(tasks.status, TaskStatus.SUCCEEDED)));
      for (const row of rows) {
        const results = Array.isArray(row.results) ? (row.results as Array<{ uri?: string }>) : [];
        if (results[0]?.uri) readyTaskIds.add(String(row.id));
      }
    }
    const readyShots = shots.filter(
      (shot) => shot.videoTaskId !== null && readyTaskIds.has(String(shot.videoTaskId)),
    );
    const successRatio = readyShots.length / shots.length;
    if (successRatio < MIN_SUCCESS_RATIO) {
      throw new AppError(
        ErrorCode.EXPORT_INCOMPLETE,
        `only ${Math.round(successRatio * 100)}% shots succeeded (min ${Math.round(MIN_SUCCESS_RATIO * 100)}%)`,
        {
          reason: "shots_incomplete",
          shots_total: shots.length,
          shots_ready: readyShots.length,
          required_ratio: MIN_SUCCESS_RATIO,
          missing_shots: shots
            .filter((shot) => !readyShots.includes(shot))
            .slice(0, 20)
            .map((shot) => ({ shot_id: String(shot.id), shot_no: shot.shotNo })),
        },
      );
    }

    // 合成读的是服务端时间线：没有时间线就用「已出片镜头」自动摊一条
    // （与竞品"一键成片"同义；不覆盖用户已有剪辑结果）
    const [existingTimeline] = await db
      .select()
      .from(projectTimelines)
      .where(eq(projectTimelines.episodeId, episode.id));
    const existingClips: Array<{ duration?: number }> = Array.isArray(existingTimeline?.clips)
      ? (existingTimeline!.clips as Array<{ duration?: number }>)
      : [];
    let clips = existingClips.length;
    let durationS: number = existingClips.reduce((sum, raw) => {
      return sum + Math.max(0, Math.round(Number(raw.duration) || 0));
    }, 0);
    if (clips === 0) {
      const autoClips = readyShots.map((shot) => ({
        clip_id: String(newId()),
        shot_id: String(shot.id),
        task_id: shot.videoTaskId ? String(shot.videoTaskId) : null,
        name: `分镜 ${shot.shotNo}`,
        duration: Math.min(30, Math.max(1, Math.round(shot.durationS ?? 5))),
      }));
      durationS = autoClips.reduce((sum, clip) => sum + clip.duration, 0);
      clips = autoClips.length;
      await db
        .insert(projectTimelines)
        .values({
          id: newId(),
          spaceId: BigInt(spaceId),
          projectId: project.id,
          episodeId: episode.id,
          clips: autoClips,
        })
        .onConflictDoUpdate({
          target: projectTimelines.episodeId,
          set: {
            spaceId: BigInt(spaceId),
            projectId: project.id,
            clips: autoClips,
            updatedAt: new Date(),
          },
        });
    }

    // ① zip 包通道（复用 exports 四态 + worker 既有 exporter）
    const exportId = newId();
    await db.insert(exportJobs).values({
      id: exportId,
      spaceId: BigInt(spaceId),
      episodeId: episode.id,
      status: 1,
    });
    await this.queue.enqueueExport(String(exportId));

    // ② 成片 mp4 通道（复用 timeline_exports + worker 合成器，含 AI 水印）
    const synthesisId = newId();
    await db.insert(timelineExports).values({
      id: synthesisId,
      spaceId: BigInt(spaceId),
      projectId: project.id,
      episodeId: episode.id,
      status: 1,
      clipCount: clips,
      durationS,
    });
    await this.queue.enqueueTimelineExport(String(synthesisId));

    return {
      export_id: String(exportId),
      synthesis_export_id: String(synthesisId),
      status: 1,
      status_label: "queued",
      success_ratio: Number(successRatio.toFixed(4)),
      shots_total: shots.length,
      shots_ready: readyShots.length,
      clips,
      duration_s: durationS,
      // 合成器默认叠「AI生成」显式水印（AI_LABEL_ENABLED 默认 true）
      watermarked: true,
      poll: {
        package: `GET /projects/${projectId}/episodes/${episodeId}/exports/${exportId}`,
        synthesis: `GET /projects/${projectId}/episodes/${episodeId}/timeline/export/${synthesisId}`,
      },
    };
  }

  /** 只读：最近一次成功成片（供发布前置检查/前端展示，不写库） */
  async latestSynthesis(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const [row] = await db
      .select()
      .from(timelineExports)
      .where(
        and(
          eq(timelineExports.spaceId, BigInt(spaceId)),
          eq(timelineExports.episodeId, episode.id),
        ),
      )
      .orderBy(desc(timelineExports.createdAt))
      .limit(1);
    if (!row) return null;
    return {
      export_id: String(row.id),
      status: row.status,
      clip_count: row.clipCount,
      duration_s: row.durationS,
      watermarked: row.watermarked,
      skipped: row.skipped,
      error: row.error,
    };
  }

  private async findProject(spaceId: string, projectId: string) {
    let id: bigint;
    try {
      id = BigInt(projectId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid project id", { field: "id" });
    }
    const [row] = await db
      .select()
      .from(scriptProjects)
      .where(and(eq(scriptProjects.id, id), eq(scriptProjects.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "project not found");
    return row;
  }

  private async findEpisode(projectId: bigint, episodeId: string) {
    let id: bigint;
    try {
      id = BigInt(episodeId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid episode id", { field: "eid" });
    }
    const [row] = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    return row;
  }
}
