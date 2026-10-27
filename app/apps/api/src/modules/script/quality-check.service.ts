import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { episodes, projectAssets, projectTimelines, scriptProjects, storyboardAssets, storyboards, tasks } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";

/**
 * 分集质量检查（`POST /projects/{id}/episodes/{eid}/quality-check`）——**只读**。
 *
 * 竞品证据：`rea-reelmate/routes.txt:445` 存在 `/web/v1/df/episode/:ep_id/quality-check`，
 * 但字段/评分口径**未文档化**（全部 CLI 文档无该子命令）→ 本方按已取证的产品判据自建：
 * - `target-spec.md:124`（PRD F2 验收）：同角色各镜 reference 均含已定稿定妆图、
 *   未定稿返回 400105、时长/画幅由模型目录驱动、参数越界 400101；
 * - `cmd/storyboard.md:308-310`：提示词里的资产名要能映射到「已定稿且有 file_id」的资产；
 * - `cmd/resource.md:207`：清单不全时不报错、表现为"某几个资产没被处理" → 必须**逐镜**判，
 *   而不是只看总数（这是"看着都绿、投递才发现缺料"的根因）。
 *
 * ## 评分口径（权重 + 为什么）
 *
 * | 维度 | 权重 | 判什么 | 为什么给这个权重 |
 * |---|---:|---|---|
 * | `shots` 分镜完整性 | 30 | 有无分镜、镜号是否唯一/连续、`shot_desc` 是否为空 | 没有分镜就没有片子；镜号重复会让"第 3 镜"指代不明，是硬伤，权重最高 |
 * | `prompt` 提示词质量 | 25 | `video_prompt` 非空、长度 ∈ [10, 2000] | 提示词为空直接出空镜；上限 2000 与 `storyboardDraftSchema` 一致（越界会 400101） |
 * | `assets` 资产引用 | 25 | 绑定资产是否定稿且有参考图、提示词点名的资产是否已绑定 | 一致性靠资产注入（`400105` 闸门）；未定稿资产投递必被拒，故与提示词同等权重 |
 * | `duration` 时长参数 | 10 | `duration_s` ∈ [1,30]、ratio/resolution 非空 | 越界会被模型目录就近取档（记 `duration_adjusted`），可自动纠正，故权重低 |
 * | `timeline` 成片就绪 | 10 | 是否有时间线、片段数是否与分镜数一致 | 只影响"能不能一键导出成片"，不影响单镜出片，权重最低 |
 *
 * 每个维度内部 `score = 通过项 / 总项 × 100`，总 `score = Σ(score×weight/100)`（四舍五入）。
 * 状态：有 `error` → `fail`；只有 `warn` → `warn`；否则 `pass`。
 *
 * **不写库**：本服务只做 select（`storyboards` / `storyboard_assets` / `project_assets` /
 * `project_timelines` / `tasks`），任何评分都不落库、不改分镜与资产——它是"投递前预检"，
 * 有副作用就会让"检查一次"变成"改一次数据"。
 */

export interface QualityIssue {
  code: string;
  severity: "error" | "warn";
  category: "shots" | "prompt" | "assets" | "duration" | "timeline";
  message: string;
  shot_id?: string;
  shot_no?: number;
  /** 可执行的下一步提示（前端直接展示） */
  hint?: string;
}

export interface QualityDimension {
  key: QualityIssue["category"];
  label: string;
  weight: number;
  /** 0..100 */
  score: number;
  /** score × weight / 100 */
  weighted: number;
  ok_items: number;
  total_items: number;
}

const WEIGHTS: Record<QualityIssue["category"], number> = {
  shots: 30,
  prompt: 25,
  assets: 25,
  duration: 10,
  timeline: 10,
};

const LABELS: Record<QualityIssue["category"], string> = {
  shots: "分镜完整性",
  prompt: "提示词质量",
  assets: "资产引用",
  duration: "时长参数",
  timeline: "成片就绪",
};

const PROMPT_MIN = 10;
const PROMPT_MAX = 2000;
const DURATION_MIN = 1;
const DURATION_MAX = 30;

@Injectable()
export class QualityCheckService {
  async check(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);

    const shots = await db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, episode.id))
      .orderBy(storyboards.shotNo);
    const shotIds = shots.map((shot) => shot.id);
    const links = shotIds.length
      ? await db.select().from(storyboardAssets).where(inArray(storyboardAssets.storyboardId, shotIds))
      : [];
    const episodeAssets = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id));
    const assetById = new Map(episodeAssets.map((row) => [String(row.id), row]));
    const boundByShot = new Map<string, bigint[]>();
    for (const link of links) {
      const key = String(link.storyboardId);
      const list = boundByShot.get(key) ?? [];
      list.push(link.projectAssetId);
      boundByShot.set(key, list);
    }
    const [timeline] = await db
      .select()
      .from(projectTimelines)
      .where(eq(projectTimelines.episodeId, episode.id));
    const timelineClips = Array.isArray(timeline?.clips)
      ? (timeline!.clips as Array<{ clip_id?: string; shot_id?: string; duration?: number }>)
      : [];

    const issues: QualityIssue[] = [];
    const okCount = { shots: 0, prompt: 0, assets: 0, duration: 0, timeline: 0 };
    const totalCount = { shots: 0, prompt: 0, assets: 0, duration: 0, timeline: 0 };

    // ── 1. 分镜完整性（30）────────────────────────────────────────────
    totalCount.shots = Math.max(1, shots.length);
    if (shots.length === 0) {
      issues.push({
        code: "shots_empty",
        severity: "error",
        category: "shots",
        message: "本集还没有分镜",
        hint: "先执行分镜生成或分镜表解析（POST /episodes/parse）",
      });
    } else {
      const seen = new Set<number>();
      for (const shot of shots) {
        let ok = true;
        if (seen.has(shot.shotNo)) {
          ok = false;
          issues.push({
            code: "shot_no_duplicated",
            severity: "error",
            category: "shots",
            shot_id: String(shot.id),
            shot_no: shot.shotNo,
            message: `镜号 ${shot.shotNo} 重复`,
            hint: "镜号必须唯一，否则时间线与导出无法对上镜头",
          });
        }
        seen.add(shot.shotNo);
        if (!(shot.shotDesc ?? "").trim()) {
          ok = false;
          issues.push({
            code: "shot_desc_empty",
            severity: "warn",
            category: "shots",
            shot_id: String(shot.id),
            shot_no: shot.shotNo,
            message: `分镜 ${shot.shotNo} 没有画面描述`,
            hint: "补一句镜头描述，便于人工复核与再生成",
          });
        }
        if (ok) okCount.shots += 1;
      }
      // 镜号连续性：断层只提示（用户可能故意删了某镜）
      const numbers = [...seen].sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i <= (numbers[numbers.length - 1] ?? 0); i += 1) {
        if (!seen.has(i)) gaps.push(i);
      }
      if (gaps.length > 0) {
        issues.push({
          code: "shot_no_gap",
          severity: "warn",
          category: "shots",
          message: `镜号不连续，缺 ${gaps.slice(0, 10).join("、")}${gaps.length > 10 ? "…" : ""}`,
          hint: "若是刻意删除可忽略；否则用分镜表解析补齐",
        });
      }
    }

    // ── 2. 提示词质量（25）────────────────────────────────────────────
    totalCount.prompt = Math.max(1, shots.length);
    for (const shot of shots) {
      const prompt = (shot.videoPrompt ?? "").trim();
      if (!prompt) {
        issues.push({
          code: "prompt_empty",
          severity: "error",
          category: "prompt",
          shot_id: String(shot.id),
          shot_no: shot.shotNo,
          message: `分镜 ${shot.shotNo} 没有视频提示词`,
          hint: "为空时无法投递（参考生视频必须有提示词）",
        });
        continue;
      }
      if (prompt.length < PROMPT_MIN) {
        issues.push({
          code: "prompt_too_short",
          severity: "error",
          category: "prompt",
          shot_id: String(shot.id),
          shot_no: shot.shotNo,
          message: `分镜 ${shot.shotNo} 提示词过短（${prompt.length} < ${PROMPT_MIN} 字）`,
          hint: "补足主体/动作/镜头/光线，否则同一角色跨镜容易跑形",
        });
        continue;
      }
      if (prompt.length > PROMPT_MAX) {
        issues.push({
          code: "prompt_too_long",
          severity: "error",
          category: "prompt",
          shot_id: String(shot.id),
          shot_no: shot.shotNo,
          message: `分镜 ${shot.shotNo} 提示词超长（${prompt.length} > ${PROMPT_MAX} 字）`,
          hint: "超长会被参数校验拒绝（400101），删到 2000 字以内",
        });
        continue;
      }
      okCount.prompt += 1;
    }

    // ── 3. 资产引用（25）──────────────────────────────────────────────
    // 逐镜判：绑定资产必须 status=2 且有参考图（与生成侧 400105 同口径）
    totalCount.assets = Math.max(1, shots.length);
    for (const shot of shots) {
      const bound = (boundByShot.get(String(shot.id)) ?? [])
        .map((id) => assetById.get(String(id)))
        .filter((row): row is typeof projectAssets.$inferSelect => Boolean(row));
      let ok = true;
      if (bound.length === 0) {
        ok = false;
        issues.push({
          code: "shot_no_assets",
          severity: "warn",
          category: "assets",
          shot_id: String(shot.id),
          shot_no: shot.shotNo,
          message: `分镜 ${shot.shotNo} 没有绑定任何资产`,
          hint: "参考生视频至少需要一个已定稿资产（400105 会拦）",
        });
      }
      for (const asset of bound) {
        if (asset.status !== 2 || !asset.refImageUri) {
          ok = false;
          issues.push({
            code: "asset_not_finalized",
            severity: "error",
            category: "assets",
            shot_id: String(shot.id),
            shot_no: shot.shotNo,
            message: `分镜 ${shot.shotNo} 绑定的资产「${asset.name}」未定稿或缺参考图`,
            hint: "到资产面板定稿（status=2）并生成参考图后再投递",
          });
        }
      }
      // 提示词点名了某个资产但没绑到该镜 → 一致性风险（只提示，不阻断）
      const promptText = `${shot.videoPrompt ?? ""}\n${shot.shotDesc ?? ""}`;
      const boundNames = new Set(bound.map((row) => row.name));
      for (const asset of episodeAssets) {
        if (!asset.name.trim() || boundNames.has(asset.name)) continue;
        if (!promptText.includes(asset.name)) continue;
        ok = false;
        issues.push({
          code: "asset_mentioned_not_bound",
          severity: "warn",
          category: "assets",
          shot_id: String(shot.id),
          shot_no: shot.shotNo,
          message: `分镜 ${shot.shotNo} 提示词提到「${asset.name}」但未绑定该资产`,
          hint: "未绑定的资产不会注入参考图，同角色跨镜会不一致",
        });
      }
      if (ok) okCount.assets += 1;
    }

    // ── 4. 时长参数（10）──────────────────────────────────────────────
    totalCount.duration = Math.max(1, shots.length);
    for (const shot of shots) {
      let ok = true;
      const duration = shot.durationS ?? 5;
      if (duration < DURATION_MIN || duration > DURATION_MAX) {
        ok = false;
        issues.push({
          code: "duration_out_of_range",
          severity: "error",
          category: "duration",
          shot_id: String(shot.id),
          shot_no: shot.shotNo,
          message: `分镜 ${shot.shotNo} 时长 ${duration}s 超出 ${DURATION_MIN}~${DURATION_MAX}s`,
          hint: "投递时会被参数校验拒绝（400101）",
        });
      }
      if (!(shot.ratio ?? "").trim()) {
        ok = false;
        issues.push({
          code: "ratio_missing",
          severity: "warn",
          category: "duration",
          shot_id: String(shot.id),
          shot_no: shot.shotNo,
          message: `分镜 ${shot.shotNo} 没有画幅，将回退项目画幅`,
        });
      }
      if (!(shot.resolution ?? "").trim()) {
        ok = false;
        issues.push({
          code: "resolution_missing",
          severity: "warn",
          category: "duration",
          shot_id: String(shot.id),
          shot_no: shot.shotNo,
          message: `分镜 ${shot.shotNo} 没有分辨率，将回退 720p`,
        });
      }
      if (ok) okCount.duration += 1;
    }

    // ── 5. 成片就绪（10）──────────────────────────────────────────────
    totalCount.timeline = 1;
    if (timelineClips.length === 0) {
      issues.push({
        code: "timeline_empty",
        severity: "warn",
        category: "timeline",
        message: "本集还没有时间线，无法一键合成成片",
        hint: "到时间线编辑页把已出片镜头加进轨道",
      });
    } else {
      okCount.timeline = 1;
      if (timelineClips.length !== shots.length) {
        issues.push({
          code: "timeline_clip_count_mismatch",
          severity: "warn",
          category: "timeline",
          message: `时间线 ${timelineClips.length} 段 vs 分镜 ${shots.length} 个，数量不一致`,
          hint: "若刻意只剪部分镜头可忽略；否则点「更新分镜」同步",
        });
      }
      const validShotIds = new Set(shots.map((shot) => String(shot.id)));
      const orphan = timelineClips.filter((clip) => clip.shot_id && !validShotIds.has(String(clip.shot_id)));
      if (orphan.length > 0) {
        issues.push({
          code: "timeline_orphan_clip",
          severity: "error",
          category: "timeline",
          message: `时间线有 ${orphan.length} 段指向已不存在的分镜`,
          hint: "先删掉这些片段，否则导出会跳过或失败",
        });
      }
    }

    // ── 汇总评分 ─────────────────────────────────────────────────────
    const dimensions: QualityDimension[] = (Object.keys(WEIGHTS) as Array<QualityIssue["category"]>).map(
      (key) => {
        const total = totalCount[key];
        const ok = okCount[key];
        const score = total > 0 ? Math.round((ok / total) * 100) : 0;
        return {
          key,
          label: LABELS[key],
          weight: WEIGHTS[key],
          score,
          weighted: Math.round((score * WEIGHTS[key]) / 100),
          ok_items: ok,
          total_items: total,
        };
      },
    );
    const score = dimensions.reduce((sum, item) => sum + item.weighted, 0);
    const hasError = issues.some((issue) => issue.severity === "error");
    const hasWarn = issues.some((issue) => issue.severity === "warn");
    const status = hasError ? "fail" : hasWarn ? "warn" : "pass";

    // 只读：这里绝不写库/写存储。返回里带 read_only 便于调用方与文档对齐。
    return {
      project_id: String(project.id),
      ep_id: String(episode.id),
      ep_no: episode.epNo,
      status,
      score,
      blocking: hasError,
      read_only: true,
      dimensions,
      issues,
      stats: {
        shot_count: shots.length,
        prompt_avg_len:
          shots.length > 0
            ? Math.round(
                shots.reduce((sum, shot) => sum + (shot.videoPrompt ?? "").trim().length, 0) / shots.length,
              )
            : 0,
        bound_asset_count: links.length,
        finalized_asset_count: episodeAssets.filter((row) => row.status === 2 && row.refImageUri).length,
        timeline_clip_count: timelineClips.length,
        timeline_duration_s: timelineClips.reduce(
          (sum, clip) => sum + Math.max(0, Math.round(Number(clip.duration) || 0)),
          0,
        ),
        shot_duration_s: shots.reduce((sum, shot) => sum + (shot.durationS ?? 5), 0),
        succeeded_video_tasks: await this.countSucceededVideoTasks(shots.map((shot) => shot.videoTaskId)),
      },
      checked_at: new Date().toISOString(),
    };
  }

  private async countSucceededVideoTasks(taskIds: Array<bigint | null>): Promise<number> {
    const ids = taskIds.filter((id): id is bigint => Boolean(id));
    if (ids.length === 0) return 0;
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(inArray(tasks.id, ids), eq(tasks.status, 3)));
    return rows.length;
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

