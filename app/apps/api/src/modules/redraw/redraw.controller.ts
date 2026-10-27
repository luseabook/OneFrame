import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { REDRAW_STYLES, RedrawService, type TeamCtx } from "./redraw.service";

/**
 * 视频转绘（video_redraw）控制器 —— 对照参照产品
 * `/web/v1/df/script_project/video_redraw/*` 8 端点（`rt:703-710`）。
 *
 * 路径取舍：竞品挂在 `df/script_project/video_redraw/*`（因为它是 script_project 的
 * 一个模式）；我方按域切分用 `/video-redraw/*`（ADR-009：域边界按资源所有权划，
 * 行为对齐即可，见 `modules/redraw/redraw.module.ts` 的说明）。前端页面路径与竞品一致：
 * `/video-redraw/create`、`/video-redraw/workspace`（`rt:121-122`）。
 *
 * 权限：每条先 `requireMember`（非成员 403101）；项目归属在 service 内判，
 * 跨 space/非转绘项目一律 404（不泄露存在性）。
 */

const createBody = z.object({
  title: z.string().min(1).max(120),
  source_uri: z.string().min(1).max(1000),
  source_kind: z.enum(["upload", "asset"]).optional(),
  style: z.enum(REDRAW_STYLES.map((s) => s.value) as [string, ...string[]]).optional(),
  redraw_strength: z.number().int().min(0).max(100).optional(),
  ratio: z.string().min(2).max(20).optional(),
  source_duration_s: z.number().min(0).max(36_000).nullish(),
  source_asset_id: z.string().min(1).nullish(),
});

const pointBody = z.object({
  target: z.enum(["image", "video"]).optional(),
  shots: z.number().int().min(1).max(200).optional(),
});

const episodeBody = z.object({
  title: z.string().max(120).optional(),
  start_s: z.number().min(0).max(36_000).optional(),
  end_s: z.number().min(0).max(36_000).optional(),
});

const batchEpisodeBody = z.object({
  count: z.number().int().min(1).max(50).optional(),
  episode_duration_s: z.number().min(1).max(3_600).optional(),
});

const planBody = z.object({
  episode_id: z.string().min(1),
  shot_duration_s: z.number().int().min(1).max(60).optional(),
  start_s: z.number().min(0).max(36_000).optional(),
  end_s: z.number().min(0).max(36_000).optional(),
});

const generateBody = z.object({
  episode_id: z.string().min(1).optional(),
  storyboard_ids: z.array(z.string().min(1)).min(1).max(200).optional(),
  target: z.enum(["image", "video"]).optional(),
  count: z.number().int().min(1).max(4).optional(),
  prompt: z.string().max(2000).optional(),
  idempotency_key: z.string().min(1).max(120).optional(),
  quote_id: z.string().min(1).optional(),
});

const bindBody = z.object({
  episode_id: z.string().min(1).optional(),
  binds: z
    .array(
      z.object({
        storyboard_id: z.string().min(1),
        project_asset_ids: z.array(z.string().min(1)).max(20),
      }),
    )
    .max(200)
    .optional(),
});

@Controller("video-redraw")
export class RedrawController {
  constructor(@Inject(RedrawService) private readonly redraw: RedrawService) {}

  private async ctx(req: AuthedRequest): Promise<TeamCtx> {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.redraw.requireMember(auth.spaceId, auth.userId);
  }

  /** 1. `project/create`（rt:706）：源视频 + 风格 + 强度 → 转绘项目 */
  @Post("projects")
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.redraw.createProject(m, parseOrThrow(createBody, body ?? {}));
  }

  /** 我方补充：转绘项目列表（workspace 页入口；竞品 8 端点里没有列表） */
  @Get("projects")
  async list(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(
      z.object({
        page: z.coerce.number().int().min(1).optional(),
        page_size: z.coerce.number().int().min(1).max(100).optional(),
      }),
      query ?? {},
    );
    return this.redraw.listProjects(m.spaceId, q.page ?? 1, q.page_size ?? 20);
  }

  /** 2. `project/info`（rt:707）：四段进度 + 源视频信息 */
  @Get("projects/:id")
  async info(@Req() req: AuthedRequest, @Param("id") id: string) {
    const m = await this.ctx(req);
    return this.redraw.projectInfo(m.spaceId, id);
  }

  /** 3. `project/point`（rt:708）：积分预估（只试算，不冻结） */
  @Post("projects/:id/point")
  async point(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.redraw.estimatePoint(m.spaceId, id, parseOrThrow(pointBody, body ?? {}));
  }

  /** 4. `episode/create`（rt:705）：按源视频切一集 */
  @Post("projects/:id/episodes")
  async createEpisode(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.redraw.createEpisode(m.spaceId, id, parseOrThrow(episodeBody, body ?? {}));
  }

  /** 5. `episode/batch_create`（rt:704）：按源时长等分切 N 集 */
  @Post("projects/:id/episodes/batch")
  async batchEpisodes(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.redraw.batchCreateEpisodes(m.spaceId, id, parseOrThrow(batchEpisodeBody, body ?? {}));
  }

  /** 6. `storyboard/plan`（rt:710）：按源视频时间轴切镜（覆盖式，幂等） */
  @Post("projects/:id/storyboard/plan")
  async plan(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.redraw.planStoryboards(m.spaceId, id, parseOrThrow(planBody, body ?? {}));
  }

  /** 7. `resources/generate`（rt:709）：按分镜生成重绘产物（报价 + 任务记账） */
  @Post("projects/:id/resources/generate")
  async generate(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    await this.ctx(req);
    return this.redraw.generateResources(
      { spaceId: auth.spaceId, userId: auth.userId, jti: auth.jti },
      id,
      parseOrThrow(generateBody, body ?? {}),
    );
  }

  /** 8. `asset/bind`（rt:703）：把重绘产物绑到分镜（快照语义） */
  @Post("projects/:id/asset/bind")
  async bind(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.redraw.bindAssets(m.spaceId, id, parseOrThrow(bindBody, body ?? {}));
  }
}
