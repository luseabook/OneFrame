import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  creditAccounts,
  episodes,
  modelPrices,
  models,
  projectAssets,
  scriptProjects,
  storyboardAssets,
  storyboards,
  tasks,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import type { GenerationRequest } from "@app/shared";
import { db } from "../../db/database";
import { TeamService } from "../team/team.service";
import { CreditsService } from "../credits/credits.service";
import { GenerationsService } from "../generations/generations.service";

/**
 * 视频转绘（video_redraw）—— 对照参照产品
 * `/web/v1/df/script_project/video_redraw/*` 8 端点（`rt:703-710`）与页面
 * `/video-redraw/create`、`/video-redraw/workspace`（`rt:121-122`）。
 * 产品语义：**已有视频 → 重新绘制成动漫**（`reelmate-feature-map.md:268`）。
 *
 * 六条设计约束（每条都有据可依，不是随手决定）：
 *
 * 1. **不新增表**：转绘就是 `script_projects.project_mode=3`（迁移 0031 的注释已论证
 *    "同一个 project + 模式"为什么优于三张项目表）。集/分镜/资产/绑定全部复用既有骨架。
 *
 * 2. **模式专属数据进 `mode_meta`**（`{source_uri, source_kind, style, redraw_strength,
 *    source_duration_s, episode_ranges, shot_duration_s}`）。schema 注释明确"服务端不解析
 *    语义、只做大小上限"——所以这里只做**形状校验**，不解释 style 的业务含义。
 *
 * 3. **生成必须走 `credits` 报价 + `tasks` 记账**：本模块不自己写 `credit_flows`，
 *    而是调 `GenerationsService.create`（它内部 `credits.price` → `freezeCredits` →
 *    入队 → worker 结算）。理由：账本只有一条通路，绕过它就会出现"余额没扣但任务跑了"。
 *
 * 4. **能力位复用而不是新造**：参考图走 `studio_asset_image`（2 积分档，与
 *    `script.service.generateProjectAssetImage` 同一套 mode），成片重绘走 `video_edit`
 *    （8 积分档，源视频作为 `reference_uris[0]`）。无 Key 时 `ADAPTER_MODE=mock`
 *    走 `MockAdapter`，**确定性**产出（便于 CI 与本地跑通）。
 *
 * 5. **`asset/bind` 用快照语义**：整集/整镜的绑定集合一次性替换（先删后按传入顺序插，
 *    `sort` 显式落列），与既有 `PUT .../storyboards/:sid/assets` 同口径；不改 `PUT timeline`。
 *
 * 6. **跨空间一律 404**：`findProject` 同时校验 `space_id` 与 `project_mode=3`，
 *    不泄露"存在但不是你的/不是转绘项目"。
 */

/** 转绘风格（我方自拟：竞品只暴露粗粒度端点，风格枚举未取证，见报告待取证项） */
export const REDRAW_STYLES = [
  { value: "anime", label: "日系动漫" },
  { value: "ghibli", label: "吉卜力" },
  { value: "ink", label: "国风水墨" },
  { value: "comic", label: "美漫" },
  { value: "cyberpunk", label: "赛博朋克" },
] as const;

export type RedrawStage = "episode" | "storyboard" | "redraw" | "bind" | "done";
/** 阶段状态：1 未开始 / 2 进行中 / 3 已完成（对照 CLI `video_redraw_stage_status`） */
export type StageStatus = 1 | 2 | 3;

export interface RedrawModeMeta {
  source_uri: string;
  source_kind: "upload" | "asset";
  source_asset_id?: string | null;
  style: string;
  /** 重绘强度 0..100（0=几乎不改变构图，100=完全风格化） */
  redraw_strength: number;
  /** 源视频时长（秒）；未知时 null，切集/分镜按默认 60s 估算 */
  source_duration_s: number | null;
  /** 集 id → [start_s, end_s]（切集时记录，分镜规划据此默认取时间轴区间） */
  episode_ranges: Record<string, [number, number]>;
  /** 默认单镜时长（秒） */
  shot_duration_s: number;
}

export interface TeamCtx {
  spaceId: string;
  userId: string;
  role: number;
  roleCode: string | null;
}

const DEFAULT_SHOT_S = 5;
const DEFAULT_EPISODE_S = 60;
const SOURCE_URI_MAX = 1000;

@Injectable()
export class RedrawService {
  constructor(
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(GenerationsService) private readonly generations: GenerationsService,
  ) {}

  async requireMember(spaceId: string, userId: string): Promise<TeamCtx> {
    return this.team.requireMember(spaceId, userId);
  }

  // ── 1. 创建转绘项目（`project/create`，rt:706）────────────────
  async createProject(
    ctx: TeamCtx,
    input: {
      title: string;
      source_uri: string;
      source_kind?: "upload" | "asset";
      style?: string;
      redraw_strength?: number;
      ratio?: string;
      source_duration_s?: number | null;
      source_asset_id?: string | null;
    },
  ) {
    const style = input.style ?? "anime";
    if (!REDRAW_STYLES.some((s) => s.value === style)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `style 取值非法（可选：${REDRAW_STYLES.map((s) => s.value).join("/")}）`, {
        field: "style",
      });
    }
    if (input.source_uri.length > SOURCE_URI_MAX) {
      throw new AppError(ErrorCode.INVALID_PARAM, "source_uri 过长", { field: "source_uri" });
    }
    const strength = input.redraw_strength ?? 70;
    if (!Number.isInteger(strength) || strength < 0 || strength > 100) {
      throw new AppError(ErrorCode.INVALID_PARAM, "redraw_strength 需为 0..100 的整数", { field: "redraw_strength" });
    }

    const meta: RedrawModeMeta = {
      source_uri: input.source_uri,
      source_kind: input.source_kind ?? "upload",
      source_asset_id: input.source_asset_id ?? null,
      style,
      redraw_strength: strength,
      source_duration_s: input.source_duration_s ?? null,
      episode_ranges: {},
      shot_duration_s: DEFAULT_SHOT_S,
    };

    const inserted = await db
      .insert(scriptProjects)
      .values({
        id: newId(),
        spaceId: BigInt(ctx.spaceId),
        title: input.title,
        // 转绘项目的"来源"是视频，不是小说/创意（source_type：1novel 2idea 3script 4fission）
        sourceType: 3,
        projectMode: 3,
        modeMeta: meta as unknown as Record<string, unknown>,
        ratio: input.ratio ?? "9:16",
      })
      .returning();
    return this.projectDto(inserted[0]!);
  }

  /** 我/本 space 的转绘项目列表（**我方补充**：竞品 8 端点无列表，但 workspace 页需要入口） */
  async listProjects(spaceId: string, page = 1, pageSize = 20) {
    const conds = [
      eq(scriptProjects.spaceId, BigInt(spaceId)),
      eq(scriptProjects.projectMode, 3),
      sql`${scriptProjects.archivedAt} is null`,
    ];
    const rows = await db
      .select()
      .from(scriptProjects)
      .where(and(...conds))
      .orderBy(desc(scriptProjects.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(scriptProjects)
      .where(and(...conds));
    return {
      list: rows.map((r) => this.projectDto(r)),
      count: Number(agg?.n ?? 0),
      page,
      page_size: pageSize,
    };
  }

  // ── 2. 项目详情 + 四段进度（`project/info`，rt:707）────────────────
  /**
   * 四段（对照 CLI `redraw info` 的 `video_redraw_stage` / `video_redraw_stage_status`）：
   *   episode    切集      —— 没有集就没有后续
   *   storyboard 分镜计划  —— 按源视频时间轴切镜
   *   redraw     重绘      —— 每镜生成重绘参考图/成片
   *   bind       绑定      —— 把重绘产物绑到分镜（`storyboard_assets`）
   * 全部绑完 → `done`。
   */
  async projectInfo(spaceId: string, id: string) {
    const project = await this.findProject(spaceId, id);
    const meta = this.metaOf(project.modeMeta);

    const [epAgg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(episodes)
      .where(eq(episodes.projectId, project.id));
    const episodeIds = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.projectId, project.id));

    const ids = episodeIds.map((e) => e.id);
    let shotCount = 0;
    let submittedShots = 0;
    let boundShots = 0;
    if (ids.length > 0) {
      const [shotAgg] = await db
        .select({
          total: sql<number>`count(*)::int`,
          submitted: sql<number>`count(*) filter (where ${storyboards.imageTaskId} is not null or ${storyboards.videoTaskId} is not null)::int`,
        })
        .from(storyboards)
        .where(inArray(storyboards.episodeId, ids));
      shotCount = Number(shotAgg?.total ?? 0);
      submittedShots = Number(shotAgg?.submitted ?? 0);
      const [boundAgg] = await db
        .select({ n: sql<number>`count(distinct ${storyboardAssets.storyboardId})::int` })
        .from(storyboardAssets)
        .innerJoin(storyboards, eq(storyboards.id, storyboardAssets.storyboardId))
        .where(inArray(storyboards.episodeId, ids));
      boundShots = Number(boundAgg?.n ?? 0);
    }

    const [assetAgg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, REDRAW_ASSET_KIND)));

    // 重绘任务数/最近一次：经 `project_assets.source_task_id` 关联（任务 input 里不塞项目 id，
    // 避免把业务字段污染进生成任务契约）
    const [taskAgg] = await db
      .select({
        n: sql<number>`count(${tasks.id})::int`,
        latest: sql<string | null>`max(${tasks.createdAt})::text`,
      })
      .from(projectAssets)
      .innerJoin(tasks, eq(tasks.id, projectAssets.sourceTaskId))
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, REDRAW_ASSET_KIND)));

    const stage = this.stageOf({
      episodes: Number(epAgg?.n ?? 0),
      shots: shotCount,
      assets: Number(assetAgg?.n ?? 0),
      bound: boundShots,
    });

    return {
      ...this.projectDto(project),
      source: {
        uri: meta.source_uri,
        kind: meta.source_kind,
        duration_s: meta.source_duration_s,
        asset_id: meta.source_asset_id ?? null,
      },
      style: meta.style,
      redraw_strength: meta.redraw_strength,
      // 竞品 CLI 暴露的三个字段名（`commands/redraw.md`）逐一对应，便于 1:1 核对
      video_redraw_stage: stage.stage,
      video_redraw_stage_status: stage.status,
      latest_flow: Number(taskAgg?.n ?? 0) > 0 ? { task_count: Number(taskAgg?.n ?? 0), latest_at: taskAgg?.latest ?? null } : null,
      progress: {
        episodes: Number(epAgg?.n ?? 0),
        storyboards: shotCount,
        storyboards_submitted: submittedShots,
        redraw_assets: Number(assetAgg?.n ?? 0),
        bound_storyboards: boundShots,
        // 百分比口径：绑定数是"最后一公里"，用它算完成度不会虚高
        percent: shotCount === 0 ? 0 : Math.round((boundShots / shotCount) * 100),
      },
    };
  }

  private stageOf(c: { episodes: number; shots: number; assets: number; bound: number }): {
    stage: RedrawStage;
    status: StageStatus;
  } {
    if (c.episodes === 0) return { stage: "episode", status: 1 };
    if (c.shots === 0) return { stage: "storyboard", status: 2 };
    if (c.assets === 0) return { stage: "storyboard", status: 3 };
    if (c.bound < c.shots) return { stage: "bind", status: 2 };
    return { stage: "done", status: 3 };
  }

  // ── 3. 积分预估（`project/point`，rt:708）────────────────────────
  /**
   * 只做**预估**，不冻结、不落任务（与竞品 `point-calculate` 纯试算同口径，
   * `d-commerce-account.md:121` 的 `total:0/credit:0` 即"试算不写账户"）。
   * 真实扣费发生在 `resources/generate` → `generations.create` → `freezeCredits`。
   */
  async estimatePoint(spaceId: string, id: string, input: { target?: "image" | "video"; shots?: number }) {
    const project = await this.findProject(spaceId, id);
    const target = input.target ?? "image";
    const [shotAgg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(storyboards)
      .innerJoin(episodes, eq(episodes.id, storyboards.episodeId))
      .where(eq(episodes.projectId, project.id));
    const shots = input.shots ?? Math.max(1, Number(shotAgg?.n ?? 0));
    if (!Number.isInteger(shots) || shots < 1 || shots > 200) {
      throw new AppError(ErrorCode.INVALID_PARAM, "shots 需为 1..200 的整数", { field: "shots" });
    }

    const request = await this.buildRequest(project, target, { prompt: "redraw estimate", storyboardId: null });
    const priced = await this.credits.price(request, spaceId);
    const total = priced.credits * shots;
    return {
      project_id: String(project.id),
      target,
      mode: priced.mode,
      model: priced.model.name,
      shots,
      unit_credits: priced.credits,
      total_credits: total,
      balance: priced.balance,
      sufficient: priced.balance >= total,
      points_code: priced.pointsCode,
      // 预估不锁价：真正提交时按当时价目再算一次（价格变动会显式报 745701/745702）
      price_locked: false,
    };
  }

  // ── 4. 切集（`episode/create`，rt:705）──────────────────────────
  async createEpisode(
    spaceId: string,
    id: string,
    input: { title?: string; start_s?: number; end_s?: number },
  ) {
    const project = await this.findProject(spaceId, id);
    const meta = this.metaOf(project.modeMeta);
    const [maxRow] = await db
      .select({ max: sql<number>`coalesce(max(${episodes.epNo}), 0)::int` })
      .from(episodes)
      .where(eq(episodes.projectId, project.id));
    const epNo = Number(maxRow?.max ?? 0) + 1;
    const start = input.start_s ?? 0;
    const end = input.end_s ?? (meta.source_duration_s ?? DEFAULT_EPISODE_S);
    if (end <= start) {
      throw new AppError(ErrorCode.INVALID_PARAM, "end_s 必须大于 start_s", { field: "end_s" });
    }

    const inserted = await db
      .insert(episodes)
      .values({
        id: newId(),
        projectId: project.id,
        epNo,
        title: input.title ?? `转绘第 ${epNo} 集`,
        // 梗概里存机器可读的源时间区间：下游分镜规划据此默认取区间（不新加列）
        synopsis: `source ${start.toFixed(1)}s-${end.toFixed(1)}s`,
      })
      .returning();
    const ranges = { ...meta.episode_ranges, [String(inserted[0]!.id)]: [start, end] as [number, number] };
    await this.patchMeta(project.id, { ...meta, episode_ranges: ranges });
    return { ...this.episodeDto(inserted[0]!), source_range: [start, end] };
  }

  // ── 5. 批量切集（`episode/batch_create`，rt:704）──────────────────
  /**
   * 按源视频时长等分成 N 集（`count`）或按每集时长切（`episode_duration_s`）。
   * 竞品的真实实现大概率是对接视频分析，我方没有该能力 → **确定性等分**并登记待取证。
   */
  async batchCreateEpisodes(
    spaceId: string,
    id: string,
    input: { count?: number; episode_duration_s?: number },
  ) {
    const project = await this.findProject(spaceId, id);
    const meta = this.metaOf(project.modeMeta);
    const duration = meta.source_duration_s ?? DEFAULT_EPISODE_S;
    let count = input.count;
    if (!count) {
      const per = input.episode_duration_s ?? DEFAULT_EPISODE_S;
      if (!Number.isFinite(per) || per <= 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "episode_duration_s 需大于 0", { field: "episode_duration_s" });
      }
      count = Math.max(1, Math.ceil(duration / per));
    }
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new AppError(ErrorCode.INVALID_PARAM, "count 需为 1..50 的整数", { field: "count" });
    }

    const [maxRow] = await db
      .select({ max: sql<number>`coalesce(max(${episodes.epNo}), 0)::int` })
      .from(episodes)
      .where(eq(episodes.projectId, project.id));
    const base = Number(maxRow?.max ?? 0);
    const step = duration / count;
    const values = Array.from({ length: count }, (_, i) => {
      const epNo = base + i + 1;
      const start = step * i;
      const end = i === count - 1 ? duration : step * (i + 1);
      return {
        id: newId(),
        projectId: project.id,
        epNo,
        title: `转绘第 ${epNo} 集`,
        synopsis: `source ${start.toFixed(1)}s-${end.toFixed(1)}s`,
      };
    });
    const inserted = await db.insert(episodes).values(values).returning();
    const ranges = { ...meta.episode_ranges };
    for (const row of inserted) {
      const m = /source ([\d.]+)s-([\d.]+)s/.exec(row.synopsis ?? "");
      if (m) ranges[String(row.id)] = [Number(m[1]), Number(m[2])];
    }
    await this.patchMeta(project.id, { ...meta, episode_ranges: ranges });
    return { created: inserted.length, episodes: inserted.map((r) => this.episodeDto(r)) };
  }

  // ── 6. 分镜计划（`storyboard/plan`，rt:710）──────────────────────
  /**
   * 按源视频时间轴切镜：`[start_s, end_s]` 内每 `shot_duration_s` 一秒切一镜，
   * 末镜取余。`video_prompt` 由「风格 + 强度 + 时间区间」确定性拼出（重绘时作为提示词），
   * 无随机成分——同一输入两次 plan 结果一致（便于 CI 与人工核对）。
   *
   * 幂等：同一集重复 plan 会**覆盖**该集已有分镜的提示词/时长，而不是无限追加
   * （否则每次点"生成分镜"都多出一倍镜头，是这类端点最常见的线上事故）。
   */
  async planStoryboards(
    spaceId: string,
    id: string,
    input: { episode_id: string; shot_duration_s?: number; start_s?: number; end_s?: number },
  ) {
    const project = await this.findProject(spaceId, id);
    const meta = this.metaOf(project.modeMeta);
    const episode = await this.findEpisode(project.id, input.episode_id);
    const shotS = input.shot_duration_s ?? meta.shot_duration_s ?? DEFAULT_SHOT_S;
    if (!Number.isInteger(shotS) || shotS < 1 || shotS > 60) {
      throw new AppError(ErrorCode.INVALID_PARAM, "shot_duration_s 需为 1..60 的整数", { field: "shot_duration_s" });
    }
    const range = meta.episode_ranges[String(episode.id)] ?? null;
    const start = input.start_s ?? range?.[0] ?? 0;
    const end = input.end_s ?? range?.[1] ?? (meta.source_duration_s ?? DEFAULT_EPISODE_S);
    if (end <= start) {
      throw new AppError(ErrorCode.INVALID_PARAM, "end_s 必须大于 start_s", { field: "end_s" });
    }
    const shots = Math.max(1, Math.ceil((end - start) / shotS));
    if (shots > 200) {
      throw new AppError(ErrorCode.INVALID_PARAM, "单集分镜数超过 200，请调大 shot_duration_s", {
        field: "shot_duration_s",
      });
    }

    const rows = Array.from({ length: shots }, (_, i) => {
      const shotStart = start + i * shotS;
      const shotEnd = Math.min(end, shotStart + shotS);
      return {
        id: newId(),
        episodeId: episode.id,
        shotNo: i + 1,
        shotDesc: `源 ${shotStart.toFixed(1)}s-${shotEnd.toFixed(1)}s`,
        videoPrompt: this.redrawPrompt(meta, i + 1),
        durationS: Math.max(1, Math.round(shotEnd - shotStart)),
        ratio: project.ratio,
        resolution: "1080p",
        status: 1,
      };
    });

    // 覆盖式：先按 shot_no 覆盖已存在的镜，再插入新增的（保持幂等且不丢已绑定的资产）
    const existing = await db
      .select({ id: storyboards.id, shotNo: storyboards.shotNo })
      .from(storyboards)
      .where(eq(storyboards.episodeId, episode.id));
    const existMap = new Map(existing.map((e) => [e.shotNo, e.id]));
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const existId = existMap.get(row.shotNo);
        if (existId) {
          await tx
            .update(storyboards)
            .set({
              shotDesc: row.shotDesc,
              videoPrompt: row.videoPrompt,
              durationS: row.durationS,
              ratio: row.ratio,
              updatedAt: new Date(),
            })
            .where(eq(storyboards.id, existId));
        } else {
          await tx.insert(storyboards).values(row);
        }
      }
      // 镜头数变少时：多出来的镜必须删（但已有绑定的保留，避免牵连产物）
      const keep = new Set(rows.map((r) => r.shotNo));
      const extra = existing.filter((e) => !keep.has(e.shotNo));
      if (extra.length > 0) {
        const bound = await tx
          .select({ storyboardId: storyboardAssets.storyboardId })
          .from(storyboardAssets)
          .where(inArray(storyboardAssets.storyboardId, extra.map((e) => e.id)));
        const boundSet = new Set(bound.map((b) => String(b.storyboardId)));
        const removable = extra.filter((e) => !boundSet.has(String(e.id))).map((e) => e.id);
        if (removable.length > 0) {
          await tx.delete(storyboards).where(inArray(storyboards.id, removable));
        }
      }
    });

    await this.patchMeta(project.id, { ...meta, shot_duration_s: shotS });

    const list = await db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, episode.id))
      .orderBy(asc(storyboards.shotNo));
    return {
      episode_id: String(episode.id),
      source_range: [start, end],
      shot_duration_s: shotS,
      shots: list.length,
      created: rows.length,
      list: list.map((r) => this.storyboardDto(r)),
    };
  }

  // ── 7. 生成重绘产物（`resources/generate`，rt:709）─────────────────
  /**
   * 对指定分镜生成重绘产物：
   *   - `target=image`（默认）→ `studio_asset_image`：每镜一张重绘参考图（2 积分档）
   *   - `target=video`         → `video_edit`：源视频整体重绘成片（8 积分档）
   * 产物落 `project_assets`（`kind='redraw'`，name 与镜头一一对应），
   * 任务走 `GenerationsService.create`（报价 → 冻结 → 入队 → worker 结算）。
   *
   * 幂等：`idempotency_key` 缺省用 `redraw:<storyboardId>:<target>`，
   * 5 分钟内同键重放返回同一任务（客户端双击/网络重试不会重复扣分）；
   * 要"再画一次"必须显式传新的 key（前端按钮每次生成新 key）。
   */
  async generateResources(
    auth: { spaceId: string; userId: string; jti: string },
    id: string,
    input: {
      episode_id?: string;
      storyboard_ids?: string[];
      target?: "image" | "video";
      count?: number;
      prompt?: string;
      idempotency_key?: string;
      quote_id?: string;
    },
  ) {
    const project = await this.findProject(auth.spaceId, id);
    const meta = this.metaOf(project.modeMeta);
    const target = input.target ?? "image";
    const count = input.count ?? 1;
    /**
     * `count`（每镜候选数）：schema 保留了竞品参数位，但**当前只支持 1**——
     * 一个分镜产一个重绘资产是既有绑定/时间线契约的前提（`storyboard_assets` 快照按镜聚合）。
     * 多候选需要先定"哪一个是主用产物"的语义，未定之前**明确拒绝**而不是静默按 1 处理
     * （静默忽略参数会让调用方以为生成了 N 个，实际只有 1 个）。
     */
    if (count !== 1) {
      throw new AppError(ErrorCode.INVALID_PARAM, "count>1 is not supported yet (one redraw asset per shot)", {
        field: "count",
        supported: [1],
      });
    }

    const shots = await this.pickShots(project.id, input.episode_id, input.storyboard_ids);
    if (shots.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "没有可重绘的分镜，请先生成分镜计划", { field: "storyboard_ids" });
    }

    const out: Array<{ storyboard_id: string; project_asset_id: string; task_id: string; replayed?: boolean }> = [];
    // 集号映射：产物命名包含"集号-镜号"，否则多集同镜号会撞名（资产互相覆盖）
    const epNos = await this.episodeNoMap(project.id);
    let usedModel: string | null = null;
    for (const shot of shots) {
      const prompt = input.prompt ?? shot.videoPrompt ?? this.redrawPrompt(meta, shot.shotNo);
      const request = await this.buildRequest(project, target, { prompt, storyboardId: String(shot.id) });
      usedModel = request.model;
      const idemKey = input.idempotency_key
        ? `${input.idempotency_key}:${shot.id}`
        : `redraw:${shot.id}:${target}`;

      const created = await this.generations.create(
        { userId: auth.userId, spaceId: auth.spaceId, jti: auth.jti },
        { ...request, ...(input.quote_id ? { quote_id: input.quote_id } : {}) },
        idemKey,
      );

      const epNo = epNos.get(String(shot.episodeId)) ?? 1;
      const asset = await this.upsertRedrawAsset(project.id, shot, epNo, prompt, created.task_id, target);
      await db
        .update(storyboards)
        .set({
          [target === "video" ? "videoTaskId" : "imageTaskId"]: BigInt(created.task_id),
          status: 3,
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(storyboards.id, shot.id));

      out.push({
        storyboard_id: String(shot.id),
        project_asset_id: String(asset.id),
        task_id: created.task_id,
      });
    }

    return {
      project_id: String(project.id),
      target,
      model: usedModel,
      count: out.length,
      tasks: out,
    };
  }

  // ── 8. 绑定（`asset/bind`，rt:703）──────────────────────────────
  /**
   * 把重绘产物绑到分镜（`storyboard_assets` **快照语义**：整镜的绑定集合一次性替换）。
   *
   * 两种用法：
   *   - 显式：`binds: [{storyboard_id, project_asset_ids: [...]}]`
   *   - 自动：不传 `binds` 时，按"该镜已生成的重绘资产"自动绑定（1:1）
   * 先删后插 + `sort` 显式落列（与 `PUT .../storyboards/:sid/assets` 同口径，
   * 顺序影响提示词里 `[[@img1]]` 的编号，不能靠堆序）。
   */
  async bindAssets(
    spaceId: string,
    id: string,
    input: {
      episode_id?: string;
      binds?: Array<{ storyboard_id: string; project_asset_ids: string[] }>;
    },
  ) {
    const project = await this.findProject(spaceId, id);
    const shots = await this.pickShots(project.id, input.episode_id, undefined);

    const plan: Array<{ storyboardId: bigint; assetIds: bigint[] }> = [];
    if (input.binds && input.binds.length > 0) {
      const shotIds = new Set(shots.map((s) => String(s.id)));
      for (const b of input.binds) {
        if (!shotIds.has(b.storyboard_id)) {
          throw new AppError(ErrorCode.INVALID_PARAM, "storyboard 不属于该项目/该集", { field: "binds.storyboard_id" });
        }
        plan.push({ storyboardId: BigInt(b.storyboard_id), assetIds: b.project_asset_ids.map((x) => BigInt(x)) });
      }
    } else {
      // 自动：按 name 约定（转绘·<集号>-<镜号>）把已生成的 redraw 资产绑回对应镜
      const assets = await db
        .select({ id: projectAssets.id, name: projectAssets.name })
        .from(projectAssets)
        .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, REDRAW_ASSET_KIND)));
      const byName = new Map(assets.map((a) => [a.name, a.id]));
      const epNos = await this.episodeNoMap(project.id);
      for (const shot of shots) {
        const epNo = epNos.get(String(shot.episodeId)) ?? 1;
        const assetId = byName.get(this.redrawAssetName(epNo, shot.shotNo));
        if (assetId) plan.push({ storyboardId: shot.id, assetIds: [assetId] });
      }
      if (plan.length === 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "没有可自动绑定的重绘产物，请先 generate 或显式传 binds", {
          field: "binds",
        });
      }
    }

    // 校验资产归属（不能把别的项目的资产绑进来）
    const allAssetIds = [...new Set(plan.flatMap((p) => p.assetIds.map(String)))].map((x) => BigInt(x));
    if (allAssetIds.length > 0) {
      const owned = await db
        .select({ id: projectAssets.id })
        .from(projectAssets)
        .where(and(eq(projectAssets.projectId, project.id), inArray(projectAssets.id, allAssetIds)));
      const ownedSet = new Set(owned.map((o) => String(o.id)));
      for (const p of plan) {
        for (const a of p.assetIds) {
          if (!ownedSet.has(String(a))) {
            throw new AppError(ErrorCode.NOT_FOUND, "project asset not found in this project", { field: "project_asset_ids" });
          }
        }
      }
    }

    await db.transaction(async (tx) => {
      for (const p of plan) {
        // 快照语义：先清空该镜的绑定，再按传入顺序插入（sort 落列）
        await tx.delete(storyboardAssets).where(eq(storyboardAssets.storyboardId, p.storyboardId));
        if (p.assetIds.length > 0) {
          await tx.insert(storyboardAssets).values(
            p.assetIds.map((assetId, idx) => ({
              storyboardId: p.storyboardId,
              projectAssetId: assetId,
              sort: idx,
            })),
          );
        }
        await tx
          .update(storyboards)
          .set({ status: 4, updatedAt: new Date() })
          .where(eq(storyboards.id, p.storyboardId));
      }
    });

    return {
      project_id: String(project.id),
      bound: plan.length,
      binds: plan.map((p) => ({ storyboard_id: String(p.storyboardId), project_asset_ids: p.assetIds.map(String) })),
    };
  }

  // ── 内部 ───────────────────────────────────────────────────
  private async findProject(spaceId: string, id: string) {
    let pid: bigint;
    try {
      pid = BigInt(id);
    } catch {
      throw new AppError(ErrorCode.NOT_FOUND, "project not found");
    }
    const [row] = await db
      .select()
      .from(scriptProjects)
      .where(and(eq(scriptProjects.id, pid), eq(scriptProjects.spaceId, BigInt(spaceId))))
      .limit(1);
    // 跨 space / 非转绘项目一律 404：不泄露"存在但不是你的/模式不对"
    if (!row || row.projectMode !== 3) throw new AppError(ErrorCode.NOT_FOUND, "project not found");
    return row;
  }

  private async findEpisode(projectId: bigint, episodeId: string) {
    let eid: bigint;
    try {
      eid = BigInt(episodeId);
    } catch {
      throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    }
    const [row] = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, eid), eq(episodes.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    return row;
  }

  private async pickShots(projectId: bigint, episodeId?: string, storyboardIds?: string[]) {
    if (storyboardIds && storyboardIds.length > 0) {
      const ids = storyboardIds.map((x) => {
        try {
          return BigInt(x);
        } catch {
          throw new AppError(ErrorCode.INVALID_PARAM, "storyboard_ids 含非法 id", { field: "storyboard_ids" });
        }
      });
      const rows = await db
        .select({ sb: storyboards })
        .from(storyboards)
        .innerJoin(episodes, eq(episodes.id, storyboards.episodeId))
        .where(and(eq(episodes.projectId, projectId), inArray(storyboards.id, ids)))
        .orderBy(asc(storyboards.shotNo));
      const list = rows.map((r) => r.sb);
      if (list.length !== ids.length) {
        throw new AppError(ErrorCode.NOT_FOUND, "storyboard not found in this project", { field: "storyboard_ids" });
      }
      return list;
    }
    if (episodeId) {
      const episode = await this.findEpisode(projectId, episodeId);
      return db
        .select()
        .from(storyboards)
        .where(eq(storyboards.episodeId, episode.id))
        .orderBy(asc(storyboards.shotNo));
    }
    // 未指定集：取项目下全部分镜（多集按集号 + 镜号排序）
    const rows = await db
      .select({ sb: storyboards })
      .from(storyboards)
      .innerJoin(episodes, eq(episodes.id, storyboards.episodeId))
      .where(eq(episodes.projectId, projectId))
      .orderBy(asc(episodes.epNo), asc(storyboards.shotNo));
    return rows.map((r) => r.sb);
  }

  /**
   * 构造生成请求（能力位复用）：
   * - image → `studio_asset_image`（参考图）；video → `video_edit`（源视频重绘）
   *
   * 模型与分辨率**从有效价目反查**（`model_prices` + `models.modes ? mode`）：
   * 只按目录挑模型会出现"挑中了没有价目的模型 → 报价直接报错"，从价目反查则保证
   * `credits.price` 一定能落到一行价格。优先选"无时长档"的价目（请求就不需要传 duration），
   * 只有分档价目时才取最小档并把 duration 一起传。
   */
  private async buildRequest(
    project: typeof scriptProjects.$inferSelect,
    target: "image" | "video",
    opts: { prompt: string; storyboardId: string | null },
  ): Promise<GenerationRequest> {
    const meta = this.metaOf(project.modeMeta);
    const mode = target === "video" ? "video_edit" : "studio_asset_image";
    const priced = await this.pickPricedModel(mode);
    if (!priced) throw new AppError(ErrorCode.INVALID_PARAM, `没有支持 ${mode} 且带价目的模型`);

    const styleLabel = REDRAW_STYLES.find((s) => s.value === meta.style)?.label ?? meta.style;
    const options: GenerationRequest["options"] = {
      ratio: project.ratio ?? "16:9",
      resolution: priced.resolution,
      duration: priced.durationS ?? 5,
      count: 1,
      enable_audio: false,
      mouth_drive: false,
    };
    // 无时长档的价目必须让 `price()` 走 `duration IS NULL` 分支：它对 options.duration
    // 的存在与否敏感（有 durations 的 mode 配置才带 duration 查价）
    if (priced.durationS === null) delete (options as { duration?: number }).duration;

    return {
      mode,
      model: priced.modelName,
      scene: null,
      input: {
        // 提示词把风格/强度显式写进去：mock 适配器也据此产出可区分的结果
        prompt: `${opts.prompt}｜风格=${styleLabel}｜强度=${meta.redraw_strength}`.slice(0, 2000),
        reference_uris: target === "video" && meta.source_uri ? [meta.source_uri] : [],
      },
      options,
    };
  }

  /** 反查"支持该 mode 且有 active 价目"的模型 + 分辨率档（确定性：按 model.sort + 价目升序） */
  private async pickPricedModel(mode: string) {
    const rows = await db
      .select({
        modelName: models.name,
        resolution: modelPrices.resolution,
        durationS: modelPrices.durationS,
        credits: modelPrices.credits,
      })
      .from(modelPrices)
      .innerJoin(models, eq(models.id, modelPrices.modelId))
      .where(
        and(
          eq(modelPrices.mode, mode),
          eq(modelPrices.active, true),
          eq(models.visible, true),
          sql`${models.modes} ? ${mode}`,
        ),
      )
      .orderBy(asc(models.sort), asc(modelPrices.credits), asc(modelPrices.resolution));
    if (rows.length === 0) return null;
    // 同模型内优先"无时长档"，其次最小时长档
    const flat = rows.find((r) => r.durationS === null);
    return flat ?? rows[0]!;
  }

  private redrawPrompt(meta: RedrawModeMeta, shotNo: number): string {
    const styleLabel = REDRAW_STYLES.find((s) => s.value === meta.style)?.label ?? meta.style;
    return `视频转绘第 ${shotNo} 镜：按源视频构图重绘为${styleLabel}，保持动作与镜头运动，强度 ${meta.redraw_strength}`;
  }

  private redrawAssetName(epNo: number, shotNo: number) {
    return `转绘·${epNo}-${shotNo}`;
  }

  /** 集 id → 集号（产物命名与自动绑定都靠它保持一致） */
  private async episodeNoMap(projectId: bigint) {
    const rows = await db
      .select({ id: episodes.id, epNo: episodes.epNo })
      .from(episodes)
      .where(eq(episodes.projectId, projectId));
    return new Map(rows.map((r) => [String(r.id), r.epNo]));
  }

  /** 每镜一个 project_asset（kind='redraw'），重复生成复用同一行（避免资产表被刷爆） */
  private async upsertRedrawAsset(
    projectId: bigint,
    shot: typeof storyboards.$inferSelect,
    epNo: number,
    prompt: string,
    taskId: string,
    target: "image" | "video",
  ) {
    const name = this.redrawAssetName(epNo, shot.shotNo);
    const [existing] = await db
      .select()
      .from(projectAssets)
      .where(
        and(
          eq(projectAssets.projectId, projectId),
          eq(projectAssets.kind, REDRAW_ASSET_KIND),
          eq(projectAssets.name, name),
        ),
      )
      .limit(1);
    if (existing) {
      const [updated] = await db
        .update(projectAssets)
        .set({
          prompt,
          description: target === "video" ? "重绘成片（video_edit）" : "重绘参考图（studio_asset_image）",
          sourceTaskId: BigInt(taskId),
          promptStatus: 1,
          status: 1,
          updatedAt: new Date(),
        })
        .where(eq(projectAssets.id, existing.id))
        .returning();
      return updated!;
    }
    const [created] = await db
      .insert(projectAssets)
      .values({
        id: newId(),
        projectId,
        kind: REDRAW_ASSET_KIND,
        name,
        prompt,
        description: target === "video" ? "重绘成片（video_edit）" : "重绘参考图（studio_asset_image）",
        sourceTaskId: BigInt(taskId),
        promptStatus: 1,
        status: 1,
      })
      .returning();
    return created!;
  }

  private async patchMeta(projectId: bigint, meta: RedrawModeMeta) {
    await db
      .update(scriptProjects)
      .set({ modeMeta: meta as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(scriptProjects.id, projectId));
  }

  /** `mode_meta` 读取 + 兜底（老行可能是 `{}`，不能让下游 NaN） */
  private metaOf(raw: unknown): RedrawModeMeta {
    const bag = (raw ?? {}) as Partial<RedrawModeMeta>;
    return {
      source_uri: bag.source_uri ?? "",
      source_kind: bag.source_kind ?? "upload",
      source_asset_id: bag.source_asset_id ?? null,
      style: bag.style ?? "anime",
      redraw_strength: typeof bag.redraw_strength === "number" ? bag.redraw_strength : 70,
      source_duration_s: typeof bag.source_duration_s === "number" ? bag.source_duration_s : null,
      episode_ranges: bag.episode_ranges ?? {},
      shot_duration_s: typeof bag.shot_duration_s === "number" ? bag.shot_duration_s : DEFAULT_SHOT_S,
    };
  }

  private projectDto(r: typeof scriptProjects.$inferSelect) {
    return {
      id: String(r.id),
      title: r.title,
      project_mode: r.projectMode,
      ratio: r.ratio,
      status: r.status,
      mode_meta: this.metaOf(r.modeMeta),
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  private episodeDto(r: typeof episodes.$inferSelect) {
    return {
      id: String(r.id),
      project_id: String(r.projectId),
      ep_no: r.epNo,
      title: r.title,
      synopsis: r.synopsis,
      status: r.status,
    };
  }

  private storyboardDto(r: typeof storyboards.$inferSelect) {
    return {
      id: String(r.id),
      episode_id: String(r.episodeId),
      shot_no: r.shotNo,
      shot_desc: r.shotDesc,
      video_prompt: r.videoPrompt,
      duration_s: r.durationS,
      ratio: r.ratio,
      status: r.status,
      image_task_id: r.imageTaskId ? String(r.imageTaskId) : null,
      video_task_id: r.videoTaskId ? String(r.videoTaskId) : null,
    };
  }

  /** 余额直查（`estimatePoint` 之外的旁路，测/排障用；不参与计费） */
  async balanceOf(spaceId: string) {
    const [row] = await db
      .select({ balance: creditAccounts.balance })
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(spaceId)))
      .limit(1);
    return row?.balance ?? 0;
  }
}

/**
 * 转绘产物在 `project_assets.kind` 里的取值。
 *
 * 为什么不是 `character|scene|prop`：那三个是**素材库**语义（被分镜引用作为参考图）；
 * 转绘产物是"每镜一张成品/参考"，混进 scene 会让素材库列表出现一堆"转绘·3"，
 * 也会让 `assets/extract` 之类的素材统计失真。`kind` 列是 text（无枚举约束），
 * 用独立取值并集中在此常量，便于将来到处检索。
 */
export const REDRAW_ASSET_KIND = "redraw";
