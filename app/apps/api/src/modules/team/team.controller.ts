import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { TeamService } from "./team.service";

/**
 * 团队（cam）域端点 —— F1 契约 §14.5
 * 路径前缀沿用参照产品的 `/cam/*`（ADR-009：保留域名划分，便于 1:1 覆盖核对）。
 * 所有端点要求：登录（L1）+ 是该 space 成员（L2）；管理类额外要求特权（L3）。
 */

const groupCreate = z.object({
  name: z.string().min(1).max(40),
  parent_id: z.string().optional(),
  leader_user_id: z.string().optional(),
  sort: z.number().int().optional(),
});
const groupUpdate = z.object({
  name: z.string().min(1).max(40).optional(),
  leader_user_id: z.string().nullable().optional(),
  sort: z.number().int().optional(),
  status: z.number().int().min(1).max(2).optional(),
});
const memberUpdate = z.object({
  role_code: z.string().min(1).optional(),
  role_id: z.string().optional(),
  group_id: z.string().nullable().optional(),
  nickname: z.string().max(40).optional(),
  remark: z.string().max(200).optional(),
  status: z.number().int().min(1).max(3).optional(),
});
const allocateBody = z.object({
  user_id: z.string().min(1),
  amount: z.number().int().positive(),
  group_id: z.string().optional(),
  memo: z.string().max(200).optional(),
});
const recoverBody = z.object({
  user_id: z.string().min(1),
  amount: z.number().int().positive(),
  memo: z.string().max(200).optional(),
});
const bindProjectBody = z.object({
  user_id: z.string().min(1),
  project_kind: z.number().int().min(1).max(2),
  project_id: z.string().min(1),
  participation_type: z.number().int().min(1).max(3).optional(),
});
const createTeamBody = z.object({
  name: z.string().min(1).max(40),
  max_seats: z.number().int().min(1).max(200).optional(),
});

@Controller("cam")
export class TeamController {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  /** 解析上下文：必须登录且是该 space 成员 */
  private async ctx(req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.team.requireMember(auth.spaceId, auth.userId);
  }

  // ── 团队本体 ─────────────────────────────────────────────
  /** 创建团队（对齐参照「去开通」）；创建者即 owner/master */
  @Post("team")
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.team.createTeam(auth.userId, parseOrThrow(createTeamBody, body));
  }

  /** 我所属的团队列表（前端空间切换用） */
  @Get("teams/mine")
  async mine(@Req() req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.team.myTeams(auth.userId);
  }

  @Get("team/info")
  async info(@Req() req: AuthedRequest) {
    return this.team.info((await this.ctx(req)).spaceId);
  }

  /** 权限探测（对齐参照 cam/permission/user）：返回当前用户的角色与特权 */
  @Get("permission/user")
  async permission(@Req() req: AuthedRequest) {
    const c = await this.ctx(req);
    return {
      space_id: c.spaceId,
      user_id: c.userId,
      role: c.role,
      role_code: c.roleCode,
      privileged: TeamService.hasPrivilege(c),
    };
  }

  // ── 分组 ────────────────────────────────────────────────
  @Get("team/groups")
  async groups(@Req() req: AuthedRequest) {
    return this.team.listGroups((await this.ctx(req)).spaceId);
  }

  @Post("team/group")
  async createGroup(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "create group");
    return this.team.createGroup(c.spaceId, parseOrThrow(groupCreate, body));
  }

  @Patch("team/group/:group_id")
  async updateGroup(@Req() req: AuthedRequest, @Param("group_id") groupId: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "update group");
    return this.team.updateGroup(c.spaceId, groupId, parseOrThrow(groupUpdate, body));
  }

  @Delete("team/group/:group_id")
  async deleteGroup(@Req() req: AuthedRequest, @Param("group_id") groupId: string) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "delete group");
    return this.team.deleteGroup(c.spaceId, groupId);
  }

  // ── 角色 ────────────────────────────────────────────────
  @Get("role/list")
  async roles(@Req() req: AuthedRequest) {
    return this.team.listRoles((await this.ctx(req)).spaceId);
  }

  // ── 成员 ────────────────────────────────────────────────
  @Get("team/members")
  async members(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("group_id") groupId?: string,
    @Query("role_code") roleCode?: string,
    @Query("status") status?: string,
  ) {
    const c = await this.ctx(req);
    return this.team.listMembers(
      c.spaceId,
      Number(page ?? 1),
      Number(pageSize ?? 20),
      groupId,
      roleCode,
      status === undefined ? undefined : Number(status),
    );
  }

  @Patch("team/member/:user_id")
  async updateMember(@Req() req: AuthedRequest, @Param("user_id") userId: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "update member");
    return this.team.updateMember(c.spaceId, userId, parseOrThrow(memberUpdate, body));
  }

  @Delete("team/member/:user_id")
  async removeMember(@Req() req: AuthedRequest, @Param("user_id") userId: string) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "remove member");
    return this.team.removeMember(c.spaceId, userId);
  }

  // ── 团队积分（成对记账）────────────────────────────────
  @Post("team/points-allocation")
  async allocate(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "allocate points");
    return this.team.allocate(c.spaceId, c.userId, parseOrThrow(allocateBody, body));
  }

  @Post("team/points-recovery")
  async recover(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "recover points");
    return this.team.recover(c.spaceId, c.userId, parseOrThrow(recoverBody, body));
  }

  @Get("team/points-flow/list")
  async pointsFlows(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("kind") kind?: string,
    @Query("target_user_id") targetUserId?: string,
    @Query("group_id") groupId?: string,
    @Query("op_user_id") opUserId?: string,
  ) {
    const c = await this.ctx(req);
    return this.team.listPointsFlows(c.spaceId, {
      page: Number(page ?? 1),
      page_size: Number(pageSize ?? 20),
      kind,
      target_user_id: targetUserId,
      group_id: groupId,
      op_user_id: opUserId,
    });
  }

  @Get("team/account-points-ranking")
  async ranking(@Req() req: AuthedRequest, @Query("limit") limit?: string) {
    const c = await this.ctx(req);
    return this.team.pointsRanking(c.spaceId, Number(limit ?? 20));
  }

  // ── 成员↔项目 ───────────────────────────────────────────
  @Get("project/:project_id/members")
  async projectMembers(@Req() req: AuthedRequest, @Param("project_id") projectId: string) {
    const c = await this.ctx(req);
    // project_id 不透明；此处按 space 全量返回由前端按 project_id 过滤（cam 不依赖 script/film 表）
    void projectId;
    return this.team.listMemberProjects(c.spaceId);
  }

  @Post("project/:project_id/members/bind")
  async bindProject(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "bind project member");
    const input = parseOrThrow(bindProjectBody, body);
    return this.team.bindMemberProject(c.spaceId, c.userId, { ...input, project_id: input.project_id ?? projectId });
  }

  @Post("project/:project_id/members/delete")
  async unbindProject(@Req() req: AuthedRequest, @Param("project_id") projectId: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "unbind project member");
    const input = parseOrThrow(bindProjectBody.pick({ user_id: true, project_kind: true }), body);
    return this.team.unbindMemberProject(c.spaceId, { ...input, project_id: projectId });
  }
}
