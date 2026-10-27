import { Controller, Get, Inject, Param, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { KdsService } from "./kds.service";

/**
 * 团队数据看板（kds/da）端点 —— 对照参照产品 `/web/v1/kds/da/*` 13 条。
 *
 * 路径沿用 `/kds/da/*`（ADR-009：保留域名划分便于 1:1 覆盖核对）。
 * 权限：登录（AuthGuard 全局）+ 是该 space 成员（本控制器每个方法先 `requireMember`）。
 * 全部只读；导出返回 text/csv（不包业务信封，与 admin 的 failed-tasks.csv 一致）。
 */

const rangeQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const rangePageQuery = rangeQuery.merge(pageQuery);

@Controller("kds/da")
export class KdsController {
  constructor(@Inject(KdsService) private readonly kds: KdsService) {}

  private async ctx(req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.kds.requireMember(auth.spaceId, auth.userId);
  }

  /** 1. 画布总积分消耗 */
  @Get("canvas/total-point-consume")
  async canvasTotal(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(rangeQuery, query ?? {});
    return this.kds.canvasTotalPointConsume(m.spaceId, q);
  }

  /** 2. 团队基本信息 */
  @Get("team/:team_id/basic-info")
  async teamBasic(@Req() req: AuthedRequest, @Param("team_id") teamId: string) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    return this.kds.teamBasicInfo(m.spaceId);
  }

  /** 3. 积分消耗排名 */
  @Get("team/:team_id/point-consume-rank")
  async pointConsumeRank(@Req() req: AuthedRequest, @Param("team_id") teamId: string, @Query() query: unknown) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    const q = parseOrThrow(rangeQuery.extend({ limit: z.coerce.number().int().min(1).max(100).optional() }), query ?? {});
    return this.kds.pointConsumeRank(m.spaceId, q);
  }

  /** 4. 成员参与明细 */
  @Get("team/:team_id/member-participate-detail")
  async memberParticipate(@Req() req: AuthedRequest, @Param("team_id") teamId: string, @Query() query: unknown) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    return this.kds.memberParticipateDetail(m.spaceId, parseOrThrow(rangePageQuery, query ?? {}));
  }

  /** 5. 积分管理流水 */
  @Get("team/:team_id/point-manage-flow")
  async pointManageFlow(@Req() req: AuthedRequest, @Param("team_id") teamId: string, @Query() query: unknown) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    return this.kds.pointManageFlow(m.spaceId, parseOrThrow(pageQuery, query ?? {}));
  }

  /** 6. 项目数据概览 */
  @Get("team/:team_id/project-data/basic-info")
  async projectDataBasic(@Req() req: AuthedRequest, @Param("team_id") teamId: string, @Query() query: unknown) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    return this.kds.projectDataBasicInfo(m.spaceId, parseOrThrow(pageQuery, query ?? {}));
  }

  /** 7. 项目数据查询（带筛选，语义同 basic-info，保留独立路径以便对齐覆盖） */
  @Get("team/:team_id/project-data/query")
  async projectDataQuery(@Req() req: AuthedRequest, @Param("team_id") teamId: string, @Query() query: unknown) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    return this.kds.projectDataBasicInfo(m.spaceId, parseOrThrow(pageQuery, query ?? {}));
  }

  /** 8. 项目成员积分明细 */
  @Get("team/:team_id/project-member-point-detail")
  async projectMemberPoint(@Req() req: AuthedRequest, @Param("team_id") teamId: string, @Query() query: unknown) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    const q = parseOrThrow(z.object({ episode_id: z.string().min(1) }), query ?? {});
    return this.kds.projectMemberPointDetail(m.spaceId, q.episode_id);
  }

  /** 9. 团队查询（看板首屏聚合） */
  @Get("team/:team_id/query")
  async teamQuery(@Req() req: AuthedRequest, @Param("team_id") teamId: string, @Query() query: unknown) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    return this.kds.teamQuery(m.spaceId, parseOrThrow(rangeQuery, query ?? {}));
  }

  /** 10. 团队查询导出 */
  @Get("team/:team_id/query/export")
  async teamQueryExport(@Req() req: AuthedRequest, @Param("team_id") teamId: string, @Res() reply: FastifyReply) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    const { filename, csv } = await this.kds.exportTeamQuery(m.spaceId);
    return this.sendCsv(reply, filename, csv);
  }

  /** 11. 项目数据导出 */
  @Get("team/:team_id/project-data/export")
  async projectDataExport(@Req() req: AuthedRequest, @Param("team_id") teamId: string, @Res() reply: FastifyReply) {
    const m = await this.ctx(req);
    this.assertSameSpace(m.spaceId, teamId);
    const { filename, csv } = await this.kds.exportProjectData(m.spaceId);
    return this.sendCsv(reply, filename, csv);
  }

  /** 12. 成员积分消耗明细 */
  @Get("team/member/:op_user_id/point-consume-detail")
  async memberConsumeDetail(@Req() req: AuthedRequest, @Param("op_user_id") opUserId: string, @Query() query: unknown) {
    const m = await this.ctx(req);
    return this.kds.memberPointConsumeDetail(m.spaceId, opUserId, parseOrThrow(pageQuery, query ?? {}));
  }

  /** 13. 成员积分配额明细 */
  @Get("team/member/:op_user_id/point-quota-detail")
  async memberQuotaDetail(@Req() req: AuthedRequest, @Param("op_user_id") opUserId: string) {
    const m = await this.ctx(req);
    return this.kds.memberPointQuotaDetail(m.spaceId, opUserId);
  }

  // ── 内部 ────────────────────────────────────────────────
  /**
   * 路径里的 team_id 必须等于调用者所在 space。
   *
   * 为什么要有这道检查：参照产品的 team_id 是路径参数，我方 space 来自 token。
   * 只信 token 会让 `/team/:任意id/...` 变成"忽略参数"的假端点；只信路径则越权。
   * 两者必须一致，不一致一律 403（不泄露该 space 是否存在）。
   */
  private assertSameSpace(tokenSpaceId: string, pathTeamId: string) {
    if (tokenSpaceId !== pathTeamId) {
      throw new AppError(ErrorCode.FORBIDDEN, "team_id does not match current space", {
        reason: "space_mismatch",
      });
    }
  }

  private sendCsv(reply: FastifyReply, filename: string, csv: string) {
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    return reply.send(`\uFEFF${csv}`);
  }
}
