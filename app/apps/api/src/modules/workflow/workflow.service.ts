import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  canvasNodes,
  canvases,
  episodes,
  projectAssets,
  scriptProjects,
  storyboards,
} from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";
import { TeamService } from "../team/team.service";

/**
 * 工作流阶段机（CLI `workflow detect` 的服务端只读实现）。
 *
 * 契约来源（竞品一手证据，`_acceptance/_gap/cli-skill/reelmate-cli-skill/`）：
 * - 阶段顺序与「stage = 第一个未完成阶段」：`manual/workflow/_stage-machine.md:30`
 * - 双作用域与 studio 只认工坊侧（canvas_id 为空或 "0"）：`_stage-machine.md:32`
 * - 五阶段完成条件表：`_stage-machine.md:34-40`
 * - 探测只发只读请求、缺项不改状态：`_stage-machine.md:15`、`commands/workflow.md:96`
 * - 探测不是错误路径（缺项走 data.missing，退出码 0）：`commands/workflow.md:154`
 * - 输出字段 stage/completed/pending/missing[].goto_stage/next_command：`commands/workflow.md:118-131`
 * - 缺项回引表：`_stage-machine.md:62-68`
 *
 * 三条硬约束（写代码时守着）：
 * 1. **只读**。本服务不产生任何 INSERT/UPDATE/DELETE，探测不得推进远端状态
 *    （`_stage-machine.md:15`）。所以没有写方法，也不要往这里加写方法。
 * 2. **不判定 render 完成**。竞品明确「终态产物是否满意由用户确认，探测不替他判定」
 *    （`_stage-machine.md:40`、`commands/workflow.md:90`）。因此 render 永远计入
 *    pending，`stage=render` 的语义是「可以出片了」，不是「已出片」。
 * 3. **studio / canvas 不混算**。同一项目可同时承载工坊剧集与画布剧集，studio 阶段
 *    只认工坊侧；被画布引用的剧集不算 script/storyboard 完成（`_stage-machine.md:32`）。
 */

export const WORKFLOW_STAGES = ["project", "script", "asset", "storyboard", "render"] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
export type WorkflowScope = "studio" | "canvas";

/** 缺项：`key` 是我方字段名（竞品叫 `field`），`goto_stage` 是回引到的阶段 */
export interface WorkflowMissing {
  key: string;
  reason: string;
  goto_stage: WorkflowStage;
}

export interface WorkflowDetection {
  scope: WorkflowScope;
  project_id: string | null;
  canvas_id: string | null;
  stage: WorkflowStage;
  completed: WorkflowStage[];
  pending: WorkflowStage[];
  missing: WorkflowMissing[];
  next_command: string;
}

export interface DetectQuery {
  scope?: string;
  project_id?: string;
  canvas_id?: string;
}

/** 缺项 → 下一步命令（竞品 `commands/workflow.md:127` 的 next_command 是给调用方看的字符串） */
function nextCommand(stage: WorkflowStage, scope: WorkflowScope, id: string): string {
  if (scope === "canvas") {
    switch (stage) {
      case "project":
        return "oneframe canvas list --json";
      case "script":
        return `oneframe node create text --canvas ${id} --json`;
      case "asset":
        return `oneframe node generate asset --canvas ${id} --json`;
      case "storyboard":
        return `oneframe script storyboard --canvas ${id} --node <NODE_ID> --json`;
      case "render":
        return `oneframe node list --canvas ${id} --json`;
    }
  }
  switch (stage) {
    case "project":
      return "oneframe workspace create <NAME> --json";
    case "script":
      return `oneframe upload <SCRIPT_FILE> --workspace ${id} --json`;
    case "asset":
      return `oneframe resource extract ${id} --dry-run --json`;
    case "storyboard":
      return `oneframe storyboard batch-generate <EPISODE_ID> --dry-run --json`;
    case "render":
      return `oneframe storyboard batch-generate-video <EPISODE_ID> --dry-run --json`;
  }
}

function parseId(raw: string, field: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new AppError(ErrorCode.INVALID_PARAM, `${field} must be a numeric id`, { field });
  }
}

@Injectable()
export class WorkflowService {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  async detect(spaceId: string, userId: string, query: DetectQuery): Promise<WorkflowDetection> {
    // 非成员一律 403（多租户隔离红线，ADR-009）
    await this.team.requireMember(spaceId, userId);

    const scope = query.scope ?? "studio";
    if (scope !== "studio" && scope !== "canvas") {
      throw new AppError(ErrorCode.INVALID_PARAM, "scope must be studio|canvas", { field: "scope" });
    }
    return scope === "canvas"
      ? this.detectCanvas(spaceId, query.canvas_id)
      : this.detectStudio(spaceId, query.project_id);
  }

  // ── studio：工坊侧四环节 ───────────────────────────────────

  private async detectStudio(spaceId: string, rawProjectId?: string): Promise<WorkflowDetection> {
    // 「未确认项目前的首次探测可以不加 --workspace」（`_stage-machine.md:15`）：
    // 没有项目 ID 时不能 500，也不能猜一个项目——直接报告 stage=project 让调用方去建/绑。
    if (!rawProjectId) {
      return this.build("studio", null, null, {
        completed: [],
        missing: [
          { key: "sp_id", reason: "未绑定制片工坊项目", goto_stage: "project" },
        ],
      });
    }

    const projectId = parseId(rawProjectId, "project_id");
    const [project] = await db
      .select()
      .from(scriptProjects)
      .where(eq(scriptProjects.id, projectId));
    if (!project) throw new AppError(ErrorCode.NOT_FOUND, "project not found");
    if (String(project.spaceId) !== spaceId) {
      throw new AppError(ErrorCode.FORBIDDEN, "not a member of this space", { reason: "not_member" });
    }

    const allEpisodes = await db
      .select({ id: episodes.id, epNo: episodes.epNo })
      .from(episodes)
      .where(eq(episodes.projectId, project.id))
      .orderBy(episodes.epNo);

    // 双作用域：被画布引用的剧集属于「画布那一集」，不算 studio 的 script/storyboard
    // （`_stage-machine.md:32`）。我方等价物是 canvases.episode_id 指向的剧集。
    const canvasEpisodeIds = await this.canvasEpisodeIds(spaceId);
    const studioEpisodes = allEpisodes.filter((ep) => !canvasEpisodeIds.has(String(ep.id)));

    const finalizedAssets = await db
      .select({ id: projectAssets.id })
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.status, 2)));

    // 分镜完成条件：**每个**正式剧集都非空（`_stage-machine.md:39`），不是「有任意一集」
    const shotCounts = studioEpisodes.length
      ? await db
          .select({ episodeId: storyboards.episodeId, id: storyboards.id })
          .from(storyboards)
          .where(
            inArray(
              storyboards.episodeId,
              studioEpisodes.map((ep) => ep.id),
            ),
          )
      : [];
    const episodesWithShots = new Set(shotCounts.map((row) => String(row.episodeId)));

    const missing: WorkflowMissing[] = [];
    if (studioEpisodes.length === 0) {
      missing.push({
        key: "episode",
        reason: "项目下没有工坊剧集（画布剧集不算）",
        goto_stage: "script",
      });
    }
    if (finalizedAssets.length === 0) {
      missing.push({ key: "resource", reason: "项目下没有已定稿资产", goto_stage: "asset" });
    }
    const episodesMissingShots = studioEpisodes.filter((ep) => !episodesWithShots.has(String(ep.id)));
    if (studioEpisodes.length > 0 && episodesMissingShots.length > 0) {
      missing.push({
        key: "storyboard",
        reason: `${episodesMissingShots.length}/${studioEpisodes.length} 集没有分镜`,
        goto_stage: "storyboard",
      });
    }

    return this.build("studio", String(project.id), null, {
      completed: [
        ...(studioEpisodes.length > 0 ? (["script"] as const) : []),
        ...(finalizedAssets.length > 0 ? (["asset"] as const) : []),
        ...(studioEpisodes.length > 0 && episodesMissingShots.length === 0
          ? (["storyboard"] as const)
          : []),
      ],
      missing,
    });
  }

  // ── canvas：无限画布节点 ───────────────────────────────────

  private async detectCanvas(spaceId: string, rawCanvasId?: string): Promise<WorkflowDetection> {
    if (!rawCanvasId) {
      return this.build("canvas", null, null, {
        completed: [],
        missing: [{ key: "canvas_id", reason: "未绑定画布", goto_stage: "project" }],
      });
    }
    const canvasId = parseId(rawCanvasId, "canvas_id");
    const [canvas] = await db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, canvasId), isNull(canvases.deletedAt)));
    if (!canvas) throw new AppError(ErrorCode.NOT_FOUND, "canvas not found");
    if (String(canvas.spaceId) !== spaceId) {
      throw new AppError(ErrorCode.FORBIDDEN, "not a member of this space", { reason: "not_member" });
    }

    // 画布阶段从 node_list 判断：text=剧本、asset|image=资产、script|table=分镜
    // （`_stage-machine.md:56`）。这里直接按 node_type 分组存在性判断。
    const nodes = await db
      .select({ nodeType: canvasNodes.nodeType })
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvas.id), isNull(canvasNodes.deletedAt)));
    const types = new Set(nodes.map((n) => n.nodeType));

    const hasScript = types.has("text");
    const hasAsset = types.has("asset") || types.has("image");
    const hasStoryboard = types.has("script") || types.has("table");

    const missing: WorkflowMissing[] = [];
    if (!hasScript) missing.push({ key: "text_node", reason: "画布上没有文本节点", goto_stage: "script" });
    if (!hasAsset) missing.push({ key: "asset_node", reason: "画布上没有拆资产或图片节点", goto_stage: "asset" });
    if (!hasStoryboard) {
      missing.push({ key: "storyboard_node", reason: "画布上没有拆分镜或表格节点", goto_stage: "storyboard" });
    }

    return this.build("canvas", null, String(canvas.id), {
      completed: [
        ...(hasScript ? (["script"] as const) : []),
        ...(hasAsset ? (["asset"] as const) : []),
        ...(hasStoryboard ? (["storyboard"] as const) : []),
      ],
      missing,
    });
  }

  // ── 公共装配 ──────────────────────────────────────────────

  /**
   * project 一档的完成条件 = 「已绑定项目/画布」，因此只要解析到资源就必完成；
   * render 永不自动完成（`_stage-machine.md:40`），永远落在 pending 里。
   */
  private build(
    scope: WorkflowScope,
    projectId: string | null,
    canvasId: string | null,
    input: { completed: readonly WorkflowStage[]; missing: WorkflowMissing[] },
  ): WorkflowDetection {
    const bound = projectId !== null || canvasId !== null;
    const completed: WorkflowStage[] = bound ? ["project", ...input.completed] : [];
    const firstPending = WORKFLOW_STAGES.find((stage) => !completed.includes(stage)) ?? "render";
    const pending = WORKFLOW_STAGES.filter((stage) => !completed.includes(stage));
    const id = projectId ?? canvasId ?? "";
    return {
      scope,
      project_id: projectId,
      canvas_id: canvasId,
      stage: firstPending,
      completed,
      pending: [...pending],
      missing: input.missing,
      next_command: nextCommand(firstPending, scope, id),
    };
  }

  /** 被画布引用的剧集 ID 集合（等价竞品「canvas_id 为空或 "0" 才算工坊侧」） */
  private async canvasEpisodeIds(spaceId: string): Promise<Set<string>> {
    const rows = await db
      .select({ episodeId: canvases.episodeId })
      .from(canvases)
      .where(
        and(
          eq(canvases.spaceId, BigInt(spaceId)),
          isNotNull(canvases.episodeId),
          isNull(canvases.deletedAt),
        ),
      );
    return new Set(
      rows.map((row) => (row.episodeId === null ? "" : String(row.episodeId))).filter(Boolean),
    );
  }
}
