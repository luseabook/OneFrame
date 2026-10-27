import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  assets,
  episodes,
  projectAssets,
  projectTimelines,
  scriptProjects,
  storyboards,
  tasks,
  timelineExports,
  timelinePublications,
} from "@app/db";
import { AppError, ErrorCode, TaskStatus, newId } from "@app/shared";
import { db } from "../../db/database";
import { StorageService } from "../../storage/storage.service";

/**
 * ReelFlow 切片发布（`POST /projects/{id}/episodes/{eid}/timeline/publish` 等）。
 *
 * 竞品证据：
 * - `rea-reelmate/routes.txt:917` `/web/v1/wf/publish`（发布）、`:923` `/web/v1/wf/video-slicing`
 *   （切片）、`:906` `/web/v1/wf/clip-bind-asset`（片段绑资产）、`:911` `/web/v1/wf/del-video`；
 * - `_acceptance/_gap/fullsite-route-inventory.md:81` 明确记我方 ReelFlow 的差距就是
 *   「缺切片/发布/clip 资产绑定」——本服务正是补这三件；
 * - 表 `timeline_publications`（迁移 0024）：状态 1 排队 / 2 转码中 / 3 可播放 / 4 失败 / 5 已下架，
 *   `share_token` 有唯一索引兜底。
 *
 * ## 三条实现决定
 *
 * 1. **发布不是导出**：`timeline_exports` 是内部产物（可被清理/重导），发布是**对外作品**，
 *    所以复制一份到 `u/<space>/publications/<id>.mp4` 并单独维护状态，删除导出文件不会
 *    把已发布作品弄坏（与 schema 注释同因）。
 * 2. **必须已有可播放的成片**：发布前置是"本集有一次已成功的成片合成"（timelineExports
 *    status=3）。没有就 400105 并提示先导出——否则发布记录只能永远停在失败态。
 * 3. **转码状态机在 API 内同构实现**：worker 侧目前只有 `timeline.export` 处理器，
 *    没有 publication 处理器；本轮 worker 不在写权限内，所以这里按
 *    「1 排队 → 2 转码中 → 3 可播放 / 4 失败」原样实现（复制成片产物 = 切片的转码占位），
 *    **真正按 slice 区间用 ffmpeg 裁剪需要 worker 侧新增 handler（已在回报登记为 Lead TODO）**。
 *    契约（状态、error、shareToken）不会因此改变，下沉到 worker 时 API 无感。
 */

export interface PublishSliceInput {
  start_ms?: number;
  end_ms?: number;
  /** 只发布时间线里的这些片段（按 clip_id 子集） */
  clip_ids?: string[];
}

export interface PublishInput {
  title?: string;
  slice?: PublishSliceInput;
  /** 指定用哪一次成片合成产物；省略则取最近一次成功的 */
  export_id?: string;
  dry_run?: boolean;
}

export interface ClipAssetRef {
  /** asset = 空间资产 / project_asset = 项目资产 / shot_product = 镜头产物 */
  source: "asset" | "project_asset" | "shot_product";
  id: string;
  name: string;
  uri: string;
  task_id?: string | null;
}

const PUB_STATUS = {
  QUEUED: 1,
  TRANSCODING: 2,
  READY: 3,
  FAILED: 4,
  REMOVED: 5,
} as const;

const PUB_STATUS_LABEL: Record<number, string> = {
  1: "queued",
  2: "transcoding",
  3: "ready",
  4: "failed",
  5: "removed",
};

type TimelineClip = {
  clip_id: string;
  shot_id: string;
  task_id?: string | null;
  name?: string;
  duration?: number;
  assets?: ClipAssetRef[];
};

@Injectable()
export class PublishService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  // ── 发布 ─────────────────────────────────────────────────────────────

  async publish(
    spaceId: string,
    userId: string,
    projectId: string,
    episodeId: string,
    input: PublishInput,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const timeline = await this.loadTimeline(episode.id);
    const clips: TimelineClip[] = Array.isArray(timeline?.clips) ? (timeline!.clips as TimelineClip[]) : [];
    if (clips.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "timeline is empty: add clips before publishing", {
        field: "clips",
      });
    }

    const slice = this.normalizeSlice(clips, input.slice);
    const exportRow = input.export_id
      ? await this.findSynthesisExport(spaceId, episode.id, input.export_id)
      : await this.latestSucceededExport(spaceId, episode.id);
    if (!exportRow || exportRow.status !== 3 || !exportRow.fileUri) {
      throw new AppError(
        ErrorCode.ASSET_NOT_READY,
        "no rendered episode video yet: run POST .../timeline/export and wait for status=3",
        {
          field: "export_id",
          reason: "rendered_product_missing",
          hint: "先合成成片（timeline/export），成功后再发布切片",
        },
      );
    }

    const title = (input.title ?? "").trim() || `${episode.title ?? `第${episode.epNo}集`} · 切片`;
    if (input.dry_run === true) {
      return {
        dry_run: true,
        ep_id: String(episode.id),
        title,
        slice,
        source_export_id: String(exportRow.id),
        would_status: PUB_STATUS.QUEUED,
      };
    }

    const id = newId();
    await db.insert(timelinePublications).values({
      id,
      spaceId: BigInt(spaceId),
      projectId: project.id,
      episodeId: episode.id,
      title,
      // slice 里带上产源，便于审计"这条发布来自哪次合成"
      slice: { unit: "ms", ...slice, source_export_id: String(exportRow.id) },
      status: PUB_STATUS.QUEUED,
      createdBy: userId ? BigInt(userId) : null,
    });

    // 异步转码（不阻塞请求）：1 → 2 → 3/4
    void this.transcode(spaceId, String(id), exportRow.fileUri);

    return {
      publication_id: String(id),
      ep_id: String(episode.id),
      title,
      status: PUB_STATUS.QUEUED,
      status_label: PUB_STATUS_LABEL[PUB_STATUS.QUEUED],
      share_token: null,
      slice,
      source_export_id: String(exportRow.id),
      poll: "GET /projects/{id}/episodes/{eid}/timeline/publications",
    };
  }

  /** `GET .../timeline/publications`：切片发布列表（含签名下载地址） */
  async listPublications(
    spaceId: string,
    projectId: string,
    episodeId: string,
    opts: { status?: number; page?: number; page_size?: number } = {},
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.page_size ?? 20));
    const where = and(
      eq(timelinePublications.spaceId, BigInt(spaceId)),
      eq(timelinePublications.episodeId, episode.id),
      opts.status ? eq(timelinePublications.status, opts.status) : undefined,
    );
    const rows = await db
      .select()
      .from(timelinePublications)
      .where(where)
      .orderBy(desc(timelinePublications.createdAt), desc(timelinePublications.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timelinePublications)
      .where(where);
    const total = countRow?.count ?? 0;
    return {
      list: await Promise.all(rows.map((row) => this.pubDto(row))),
      total,
      page,
      page_size: pageSize,
      has_more: total > page * pageSize,
    };
  }

  /** `DELETE .../publications/:id`：下架（status=5，保留记录便于审计） */
  async unpublish(spaceId: string, projectId: string, episodeId: string, publicationId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const id = this.parseId(publicationId, "publication_id");
    const [row] = await db
      .select()
      .from(timelinePublications)
      .where(
        and(
          eq(timelinePublications.id, id),
          eq(timelinePublications.episodeId, episode.id),
          eq(timelinePublications.spaceId, BigInt(spaceId)),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "publication not found");
    if (row.status === PUB_STATUS.REMOVED) {
      throw new AppError(ErrorCode.NOT_FOUND, "publication already removed", {
        field: "publication_id",
      });
    }
    await db
      .update(timelinePublications)
      .set({ status: PUB_STATUS.REMOVED, updatedAt: new Date() })
      .where(eq(timelinePublications.id, id));
    return { ok: true, publication_id: String(id), status: PUB_STATUS.REMOVED };
  }

  // ── 片段资产绑定 ─────────────────────────────────────────────────────

  /**
   * `POST .../timeline/clips/:clipId/assets`（竞品 `wf/clip-bind-asset`）。
   *
   * 快照语义：传入的 `asset_ids` + `task_id` 整体替换该片段的绑定（`clear=true` 清空）。
   * 资产可以是空间资产（`assets.id`）、项目资产（`project_assets.id`），
   * 或镜头产物（`task_id` → 取 `tasks.results[0].uri`）。
   */
  async bindClipAssets(
    spaceId: string,
    projectId: string,
    episodeId: string,
    clipId: string,
    input: { asset_ids?: string[]; task_id?: string; clear?: boolean },
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const [timeline] = await db
      .select()
      .from(projectTimelines)
      .where(eq(projectTimelines.episodeId, episode.id));
    if (!timeline) throw new AppError(ErrorCode.NOT_FOUND, "timeline not found");
    const clips: TimelineClip[] = Array.isArray(timeline.clips) ? (timeline.clips as TimelineClip[]) : [];
    const clip = clips.find((item) => item.clip_id === clipId);
    if (!clip) {
      throw new AppError(ErrorCode.NOT_FOUND, "clip not found in this episode timeline", {
        field: "clipId",
      });
    }

    const resolved: ClipAssetRef[] = [];
    if (input.clear !== true) {
      for (const rawId of input.asset_ids ?? []) {
        resolved.push(await this.resolveClipAsset(spaceId, project.id, rawId));
      }
      if (input.task_id) {
        resolved.push(await this.resolveShotProduct(spaceId, episode.id, input.task_id));
      }
    }
    // 去重（同 source+id），保持入参顺序
    const seen = new Set<string>();
    const deduped = resolved.filter((item) => {
      const key = `${item.source}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const nextClips = clips.map((item) =>
      item.clip_id === clipId ? { ...item, assets: deduped } : item,
    );
    await db
      .update(projectTimelines)
      .set({ clips: nextClips, updatedAt: new Date() })
      .where(eq(projectTimelines.id, timeline.id));
    return { clip_id: clipId, assets: deduped };
  }

  // ── 内部：转码状态机 ──────────────────────────────────────────────────

  /**
   * 转码：1（排队，已由 publish 落库）→ 2 转码中 → 3 可播放（写 fileUri + shareToken）/ 4 失败（落 error）。
   * 幂等：已是 3/4/5 直接返回，重复触发不会覆盖终态。
   */
  private async transcode(spaceId: string, publicationId: string, sourceKey: string): Promise<void> {
    let id: bigint;
    try {
      id = BigInt(publicationId);
    } catch {
      return;
    }
    try {
      const [row] = await db.select().from(timelinePublications).where(eq(timelinePublications.id, id));
      if (!row) return;
      if (row.status === PUB_STATUS.READY || row.status === PUB_STATUS.FAILED || row.status === PUB_STATUS.REMOVED) {
        return;
      }
      await db
        .update(timelinePublications)
        .set({ status: PUB_STATUS.TRANSCODING, error: null, updatedAt: new Date() })
        .where(eq(timelinePublications.id, id));

      const buffer = await this.storage.read(sourceKey);
      if (!buffer || buffer.byteLength === 0) throw new Error("rendered product is empty");
      const key = `u/${spaceId}/publications/${publicationId}.mp4`;
      await this.storage.put(key, buffer, "video/mp4");

      const token = await this.uniqueShareToken();
      await db
        .update(timelinePublications)
        .set({
          status: PUB_STATUS.READY,
          fileUri: key,
          shareToken: token,
          publishedAt: new Date(),
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(timelinePublications.id, id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(timelinePublications)
        .set({
          status: PUB_STATUS.FAILED,
          error: { code: ErrorCode.VENDOR_ERROR, message: `publication transcode failed: ${message.slice(0, 500)}` },
          updatedAt: new Date(),
        })
        .where(eq(timelinePublications.id, id))
        .catch(() => undefined);
    }
  }

  /** shareToken 唯一键兜底：冲突就换一个（最多 3 次，超出即抛） */
  private async uniqueShareToken(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(16).toString("hex");
      const [existing] = await db
        .select({ id: timelinePublications.id })
        .from(timelinePublications)
        .where(eq(timelinePublications.shareToken, token))
        .limit(1);
      if (!existing) return token;
    }
    throw new Error("failed to allocate unique share token");
  }

  private async pubDto(row: typeof timelinePublications.$inferSelect) {
    const downloadUrl =
      row.status === PUB_STATUS.READY && row.fileUri
        ? await this.storage.signDownload(row.fileUri, 3600).catch(() => null)
        : null;
    return {
      publication_id: String(row.id),
      title: row.title,
      status: row.status,
      status_label: PUB_STATUS_LABEL[row.status] ?? "unknown",
      slice: row.slice,
      share_token: row.status === PUB_STATUS.REMOVED ? null : row.shareToken,
      download_url: downloadUrl,
      error: row.error,
      published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  // ── 内部：校验与读取 ──────────────────────────────────────────────────

  /** 切片区间校验：clip 子集必须属于本集时间线；区间必须在总时长内 */
  private normalizeSlice(clips: TimelineClip[], input?: PublishSliceInput) {
    const totalMs = clips.reduce((sum, clip) => sum + Math.max(1, Math.round(Number(clip.duration) || 1)) * 1000, 0);
    const clipIds = input?.clip_ids?.length ? [...new Set(input.clip_ids)] : undefined;
    if (clipIds) {
      const known = new Set(clips.map((clip) => clip.clip_id));
      const unknown = clipIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "slice.clip_ids contains unknown clips", {
          field: "slice.clip_ids",
          unknown,
        });
      }
    }
    const startMs = Math.max(0, Math.round(Number(input?.start_ms ?? 0)));
    const endMs =
      input?.end_ms === undefined ? totalMs : Math.round(Number(input?.end_ms ?? totalMs));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "slice start_ms/end_ms must be numbers", {
        field: "slice",
      });
    }
    if (endMs <= startMs) {
      throw new AppError(ErrorCode.INVALID_PARAM, "slice.end_ms must be greater than start_ms", {
        field: "slice.end_ms",
      });
    }
    if (startMs > totalMs || endMs > totalMs) {
      throw new AppError(ErrorCode.INVALID_PARAM, `slice exceeds timeline duration (${totalMs}ms)`, {
        field: "slice",
        timeline_ms: totalMs,
      });
    }
    return {
      start_ms: startMs,
      end_ms: endMs,
      duration_ms: endMs - startMs,
      clip_ids: clipIds ?? null,
    };
  }

  private async resolveClipAsset(spaceId: string, projectId: bigint, rawId: string): Promise<ClipAssetRef> {
    const id = this.parseId(rawId, "asset_ids");
    const [spaceAsset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.spaceId, BigInt(spaceId))));
    if (spaceAsset && !spaceAsset.deletedAt) {
      return {
        source: "asset",
        id: String(spaceAsset.id),
        name: spaceAsset.name,
        uri: spaceAsset.uri,
      };
    }
    const [projectAsset] = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.id, id), eq(projectAssets.projectId, projectId)));
    if (projectAsset) {
      return {
        source: "project_asset",
        id: String(projectAsset.id),
        name: projectAsset.name,
        uri: projectAsset.refImageUri ?? "",
      };
    }
    throw new AppError(ErrorCode.INVALID_PARAM, `asset not found in this space/project: ${rawId}`, {
      field: "asset_ids",
    });
  }

  private async resolveShotProduct(spaceId: string, episodeId: bigint, rawTaskId: string): Promise<ClipAssetRef> {
    const id = this.parseId(rawTaskId, "task_id");
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.spaceId, BigInt(spaceId))));
    if (!task) throw new AppError(ErrorCode.INVALID_PARAM, "task not found", { field: "task_id" });
    // 任务必须属于本集（或挂在本集的分镜上），否则等于把别的集的产物挂进来
    const belongsToEpisode = task.episodeId === episodeId || (await this.taskShotInEpisode(task.shotId, episodeId));
    if (!belongsToEpisode) {
      throw new AppError(ErrorCode.INVALID_PARAM, "task does not belong to this episode", {
        field: "task_id",
      });
    }
    if (task.status !== TaskStatus.SUCCEEDED) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "task not succeeded yet", {
        field: "task_id",
        task_status: task.status,
      });
    }
    const results = Array.isArray(task.results) ? (task.results as Array<{ uri?: string }>) : [];
    const uri = results[0]?.uri;
    if (!uri) throw new AppError(ErrorCode.NOT_FOUND, "task has no result file", { field: "task_id" });
    return {
      source: "shot_product",
      id: `task:${String(task.id)}`,
      name: `镜头产物 ${String(task.id).slice(-6)}`,
      uri,
      task_id: String(task.id),
    };
  }

  private async taskShotInEpisode(shotId: bigint | null, episodeId: bigint): Promise<boolean> {
    if (!shotId) return false;
    const [row] = await db
      .select({ id: storyboards.id })
      .from(storyboards)
      .where(and(eq(storyboards.id, shotId), eq(storyboards.episodeId, episodeId)));
    return Boolean(row);
  }

  private async loadTimeline(episodeId: bigint) {
    const [row] = await db
      .select()
      .from(projectTimelines)
      .where(eq(projectTimelines.episodeId, episodeId));
    return row ?? null;
  }

  private async findSynthesisExport(spaceId: string, episodeId: bigint, exportId: string) {
    const id = this.parseId(exportId, "export_id");
    const [row] = await db
      .select()
      .from(timelineExports)
      .where(
        and(
          eq(timelineExports.id, id),
          eq(timelineExports.episodeId, episodeId),
          eq(timelineExports.spaceId, BigInt(spaceId)),
        ),
      );
    return row ?? null;
  }

  private async latestSucceededExport(spaceId: string, episodeId: bigint) {
    const rows = await db
      .select()
      .from(timelineExports)
      .where(
        and(
          eq(timelineExports.spaceId, BigInt(spaceId)),
          eq(timelineExports.episodeId, episodeId),
          eq(timelineExports.status, 3),
        ),
      )
      .orderBy(desc(timelineExports.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  private parseId(raw: string, field: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
    }
  }

  private async findProject(spaceId: string, projectId: string) {
    const id = this.parseId(projectId, "id");
    const [row] = await db
      .select()
      .from(scriptProjects)
      .where(and(eq(scriptProjects.id, id), eq(scriptProjects.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "project not found");
    return row;
  }

  private async findEpisode(projectId: bigint, episodeId: string) {
    const id = this.parseId(episodeId, "eid");
    const [row] = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    return row;
  }

  /** 只读：供 /works 聚合用到发布数时预留（当前 works 不统计发布，保持最小依赖） */
  async countByEpisode(spaceId: string, episodeIds: bigint[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (episodeIds.length === 0) return map;
    const rows = await db
      .select({ episodeId: timelinePublications.episodeId, count: sql<number>`count(*)::int` })
      .from(timelinePublications)
      .where(
        and(
          eq(timelinePublications.spaceId, BigInt(spaceId)),
          inArray(timelinePublications.episodeId, episodeIds),
          eq(timelinePublications.status, PUB_STATUS.READY),
        ),
      )
      .groupBy(timelinePublications.episodeId);
    for (const row of rows) map.set(String(row.episodeId), row.count);
    return map;
  }
}
