import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { ENFORCED_PERMISSIONS, isEnforcedPermission } from "./enforced-permissions";
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
const batchMembersBody = z.object({
  members: z
    .array(
      z.object({
        phone: z.string().regex(/^1\d{10}$/).optional(),
        user_id: z.string().min(1).optional(),
        role_code: z.string().min(1).optional(),
        group_id: z.string().optional(),
        nickname: z.string().max(40).optional(),
      }),
    )
    .min(1)
    .max(50),
});
const batchStatusBody = z.object({
  user_ids: z.array(z.string().min(1)).min(1).max(200),
  status: z.number().int().min(1).max(3),
});
const changeGroupBody = z.object({
  user_ids: z.array(z.string().min(1)).min(1).max(200),
  group_id: z.string().nullable(),
});
const teamEditBody = z.object({
  name: z.string().min(1).max(40).optional(),
  max_seats: z.number().int().min(1).max(200).optional(),
  film_enabled: z.boolean().optional(),
  agent_whitelist: z.boolean().optional(),
});
const nicknameBody = z.object({ nickname: z.string().min(1).max(40) });
const batchAllocateBody = z.object({
  items: z
    .array(
      z.object({
        user_id: z.string().min(1),
        amount: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(50),
  memo: z.string().max(200).optional(),
});
const rolePermissionsBody = z.object({
  /**
   * 权限码集合（`domain.action` 或粗码）。上限 200 是防御：目录只有 70 个，
   * 超量请求一定是客户端把脏数据拼进来了。
   */
  permissions: z.array(z.string().min(1).max(64)).max(200),
  /** 可选：模块可见范围（原样存 team_roles.module_id_list，不解析语义） */
  module_id_list: z.unknown().optional(),
});

/**
 * BYOK 第三方 Key（对齐参照 `cam/user/third/key/*`）。
 *
 * 参照的 `requestDataJsonSchema` 是空对象 —— 只有路由、没有字段形状，
 * 所以字段名与上限由我方自定（已登记 api-spec §17.36）。`api_key` 上限 400
 * 是因为主流供应商的 key 都在 200 以内，400 足够且能挡住误贴整段 JSON。
 */
const thirdKeyAdd = z.object({
  provider: z.string().min(1).max(40),
  label: z.string().max(60).optional(),
  api_key: z.string().min(1).max(400),
  status: z.number().int().min(1).max(2).optional(),
});
const thirdKeyUpdate = thirdKeyAdd.partial().extend({
  // 编辑时允许显式清空备注（`null`），新增时不必写
  label: z.string().max(60).nullable().optional(),
});
/** 项目维度积分排行入参（参照是 POST + body，不是 query） */
const projectPointsRankingBody = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  create_time_start: z.string().max(40).optional(),
  create_time_end: z.string().max(40).optional(),
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

  /**
   * 改团队设置（对齐参照 team/edit）。
   *
   * 只有团队空间能改；席位不能低于现有成员数（两条约束都在 service 里，
   * 控制器只做"是不是管理员"这一层）。
   */
  @Patch("team/info")
  async updateInfo(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "edit team");
    // 渐进式拦截（默认放行）：只有角色被显式配置过、且缺 team.edit 时才 403
    await this.team.requirePermission(c.spaceId, c.userId, "team.edit");
    return this.team.updateTeam(c.spaceId, parseOrThrow(teamEditBody, body ?? {}));
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

  /** 分组统计：成员数 / 任务数 / 已消耗 / 已分配（对齐参照 group/stats） */
  @Get("team/group/:group_id/stats")
  async groupStats(@Req() req: AuthedRequest, @Param("group_id") groupId: string) {
    const c = await this.ctx(req);
    return this.team.groupStats(c.spaceId, groupId);
  }

  // ── 角色 ────────────────────────────────────────────────
  @Get("role/list")
  async roles(@Req() req: AuthedRequest) {
    return this.team.listRoles((await this.ctx(req)).spaceId);
  }

  /**
   * 权限码目录（`domain.action` 分组）。
   *
   * 只读、对**所有成员**开放：矩阵编辑器需要先拿到目录才能渲染勾选框，
   * 而"有哪些权限码"本身不是敏感信息（真正敏感的是谁能改谁的权限）。
   */
  @Get("permissions")
  async permissions(@Req() req: AuthedRequest) {
    await this.ctx(req);
    const catalog = this.team.permissionCatalog();
    // `enforced` 有两种读法，这里都给（都廉价）：
    // - 每个码上的布尔位：前端矩阵逐行标「生效中」；
    // - 顶层清单：运维/报告直接看"当前到底拦了哪几个端点"。
    // 只读快照，不是权威判权入口——真正判权在 TeamService.requirePermission。
    return {
      ...catalog,
      list: catalog.list.map((entry) => ({ ...entry, enforced: isEnforcedPermission(entry.code) })),
      enforced: ENFORCED_PERMISSIONS,
      enforced_count: ENFORCED_PERMISSIONS.length,
    };
  }

  /** 某角色的权限（含 power_list 原样、未知码单列，便于发现历史脏数据） */
  @Get("roles/:role_id/permissions")
  async rolePermissions(@Req() req: AuthedRequest, @Param("role_id") roleId: string) {
    return this.team.getRolePermissions((await this.ctx(req)).spaceId, roleId);
  }

  /**
   * 覆盖写角色权限（幂等）。
   *
   * 需要团队管理特权（与"改团队设置/成员"同级）：能改权限的人等于能改整个团队的边界。
   * 本批**不做**入口拦截（见 `permission-catalog.ts` 注释），这里只存储。
   */
  @Put("roles/:role_id/permissions")
  async setRolePermissions(@Req() req: AuthedRequest, @Param("role_id") roleId: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "edit role permissions");
    // 改权限矩阵 = 改整个团队的边界，必须是显式授予 team.permission 的角色才能动
    await this.team.requirePermission(c.spaceId, c.userId, "team.permission");
    const input = parseOrThrow(rolePermissionsBody, body ?? {});
    return this.team.setRolePermissions(c.spaceId, roleId, input.permissions, input.module_id_list);
  }

  /**
   * 团队模型开关矩阵（对齐参照 `cam/team/temp-info`）。
   *
   * 契约里那 8 个开关有 4 个是折扣/白名单语义（未取证），本方法只返回**可推导**的真值，
   * 推不出来的给 `null` 并列进 `unverified`（见 service 注释），不用假 false 冒充。
   */
  @Get("temp-info")
  async tempInfo(@Req() req: AuthedRequest) {
    return this.team.tempInfo((await this.ctx(req)).spaceId);
  }

  // ── 成员 ────────────────────────────────────────────────
  /**
   * 成员列表。
   *
   * 第 95 批：竞品 QUERY 有 11 个参数，我方此前只收 5 个 —— 补 `nick`/`remark`/`role_ids`/
   * `has_group`/`include_descendants`；`account`/`sp_ids` 有意不接（见 service 注释）。
   */
  @Get("team/members")
  async members(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("group_id") groupId?: string,
    @Query("role_code") roleCode?: string,
    @Query("status") status?: string,
    @Query("nick") nick?: string,
    @Query("remark") remark?: string,
    @Query("role_ids") roleIds?: string | string[],
    @Query("has_group") hasGroup?: string,
    @Query("include_descendants") includeDescendants?: string,
  ) {
    const c = await this.ctx(req);
    return this.team.listMembers(
      c.spaceId,
      Number(page ?? 1),
      Number(pageSize ?? 20),
      groupId,
      roleCode,
      status === undefined ? undefined : Number(status),
      { nick, remark, role_ids: roleIds, has_group: hasGroup, include_descendants: includeDescendants },
    );
  }

  @Patch("team/member/:user_id")
  async updateMember(@Req() req: AuthedRequest, @Param("user_id") userId: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    await this.team.requirePermission(c.spaceId, c.userId, "member.edit");
    this.team.requirePrivilege(c, "update member");
    return this.team.updateMember(c.spaceId, userId, parseOrThrow(memberUpdate, body));
  }

  /** 单成员详情（对齐参照 member/:id） */
  @Get("team/member/:user_id")
  async memberDetail(@Req() req: AuthedRequest, @Param("user_id") userId: string) {
    const c = await this.ctx(req);
    return this.team.memberDetail(c.spaceId, userId);
  }

  /** 改成员昵称：本人可改自己，管理员可改任一成员 */
  @Patch("team/member/:user_id/name")
  async updateMemberName(@Req() req: AuthedRequest, @Param("user_id") userId: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    if (c.userId !== userId) this.team.requirePrivilege(c, "rename member");
    const input = parseOrThrow(nicknameBody, body);
    return this.team.updateMemberNickname(c.spaceId, userId, input.nickname);
  }

  @Delete("team/member/:user_id")
  async removeMember(@Req() req: AuthedRequest, @Param("user_id") userId: string) {
    const c = await this.ctx(req);
    await this.team.requirePermission(c.spaceId, c.userId, "member.remove");
    this.team.requirePrivilege(c, "remove member");
    return this.team.removeMember(c.spaceId, userId);
  }

  // ── 成员批量 ────────────────────────────────────────────
  /** 批量添加成员（只接受已注册用户；未注册手机号逐条拒绝，不代建账号） */
  @Post("team/member/batch")
  async addMembers(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "add members");
    // 邀请入口：目录里没有 `team.member`，语义对应的真实码是 `member.create`
    await this.team.requirePermission(c.spaceId, c.userId, "member.create");
    return this.team.addMembers(c.spaceId, c.userId, parseOrThrow(batchMembersBody, body));
  }

  @Post("team/member/batch/status")
  async batchStatus(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "change member status");
    return this.team.batchMemberStatus(c.spaceId, parseOrThrow(batchStatusBody, body));
  }

  @Post("team/member/change-group")
  async changeGroup(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "change member group");
    return this.team.changeGroup(c.spaceId, parseOrThrow(changeGroupBody, body));
  }

  /**
   * 成员 CSV 导出（对齐参照 member/export）。
   *
   * 第 95 批：筛参与 `/cam/team/members` 完全一致（竞品这两条端点的 QUERY 也是同一组）。
   * 此前写死导 100 行且忽略所有筛选 —— 运营"筛完导出"会拿到一份和屏幕上不一样的文件。
   */
  @Get("team/member/export")
  async exportMembers(
    @Req() req: AuthedRequest,
    @Res() res: FastifyReply,
    @Query("group_id") groupId?: string,
    @Query("role_code") roleCode?: string,
    @Query("status") status?: string,
    @Query("nick") nick?: string,
    @Query("remark") remark?: string,
    @Query("role_ids") roleIds?: string | string[],
    @Query("has_group") hasGroup?: string,
    @Query("include_descendants") includeDescendants?: string,
  ) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "export members");
    const csv = await this.team.membersCsv(c.spaceId, {
      group_id: groupId,
      role_code: roleCode,
      status,
      nick,
      remark,
      role_ids: roleIds,
      has_group: hasGroup,
      include_descendants: includeDescendants,
    });
    res
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="team-members.csv"')
      .send(csv);
  }

  // ── 团队积分（成对记账）────────────────────────────────
  @Post("team/points-allocation")
  async allocate(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    await this.team.requirePermission(c.spaceId, c.userId, "member.points");
    this.team.requirePrivilege(c, "allocate points");
    return this.team.allocate(c.spaceId, c.userId, parseOrThrow(allocateBody, body));
  }

  @Post("team/points-recovery")
  async recover(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    this.team.requirePrivilege(c, "recover points");
    return this.team.recover(c.spaceId, c.userId, parseOrThrow(recoverBody, body));
  }

  /** 批量分配（≤50，逐条独立；一条余额不足不连累其它） */
  @Post("team/batch-points-allocation")
  async batchAllocate(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    await this.team.requirePermission(c.spaceId, c.userId, "member.points");
    this.team.requirePrivilege(c, "allocate points");
    return this.team.batchAllocate(c.spaceId, c.userId, parseOrThrow(batchAllocateBody, body));
  }

  /**
   * 团队积分流水。
   *
   * 第 95 批：竞品该端点 QUERY 有 10 个参数，我方此前只收 6 个 —— 被丢弃的
   * `create_time_start/end`、`op_type`、`op_user_name`、`target_user_name`
   * 会让「按时间/按人筛流水」整个失效（返回未过滤全集，200 + code 0）。
   * `op_user_account` / `target_user_account` **有意不接**：见 service 注释。
   */
  @Get("team/points-flow/list")
  async pointsFlows(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("kind") kind?: string,
    @Query("target_user_id") targetUserId?: string,
    @Query("group_id") groupId?: string,
    @Query("op_user_id") opUserId?: string,
    @Query("op_type") opType?: string,
    @Query("create_time_start") createTimeStart?: string,
    @Query("create_time_end") createTimeEnd?: string,
    @Query("op_user_name") opUserName?: string,
    @Query("target_user_name") targetUserName?: string,
  ) {
    const c = await this.ctx(req);
    return this.team.listPointsFlows(c.spaceId, {
      page: Number(page ?? 1),
      page_size: Number(pageSize ?? 20),
      kind,
      target_user_id: targetUserId,
      group_id: groupId,
      op_user_id: opUserId,
      op_type: opType,
      create_time_start: createTimeStart,
      create_time_end: createTimeEnd,
      op_user_name: opUserName,
      target_user_name: targetUserName,
    });
  }

  @Get("team/account-points-ranking")
  async ranking(@Req() req: AuthedRequest, @Query("limit") limit?: string) {
    const c = await this.ctx(req);
    return this.team.pointsRanking(c.spaceId, Number(limit ?? 20));
  }

  /**
   * 流水导出（CSV，对齐参照 points-flow/export）：返回现签链接，1h 有效。
   * 筛选参数与 list 完全一致（第 95 批起共 10 个，含时间范围与人名模糊）。
   */
  @Get("team/points-flow/export")
  async exportPointsFlows(
    @Req() req: AuthedRequest,
    @Query("kind") kind?: string,
    @Query("target_user_id") targetUserId?: string,
    @Query("group_id") groupId?: string,
    @Query("op_user_id") opUserId?: string,
    @Query("op_type") opType?: string,
    @Query("create_time_start") createTimeStart?: string,
    @Query("create_time_end") createTimeEnd?: string,
    @Query("op_user_name") opUserName?: string,
    @Query("target_user_name") targetUserName?: string,
  ) {
    const c = await this.ctx(req);
    return this.team.exportPointsFlows(c.spaceId, {
      kind,
      target_user_id: targetUserId,
      group_id: groupId,
      op_user_id: opUserId,
      op_type: opType,
      create_time_start: createTimeStart,
      create_time_end: createTimeEnd,
      op_user_name: opUserName,
      target_user_name: targetUserName,
    });
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

  // ── 成员登录凭据（对齐参照 `GET cam/team/member/:member_id/credential`）──
  /**
   * 成员用哪个号登录。我方没有子账号密码，所以显式回 `has_password:false` /
   * `can_reset_password:false`（不编假字段），账号只回打码值。
   */
  @Get("team/member/:user_id/credential")
  async memberCredential(@Req() req: AuthedRequest, @Param("user_id") userId: string) {
    const c = await this.ctx(req);
    return this.team.memberCredential(c.spaceId, userId);
  }

  // ── 项目关联用户（对齐参照 `GET /cam/linked-users`）──────────
  /**
   * 「这个项目上有哪些人」。数据源是成员↔项目绑定表，不是在线名单；
   * 权限只要求"是本 space 成员"（读的是编制表，不含任何凭据）。
   */
  @Get("linked-users")
  async linkedUsers(@Req() req: AuthedRequest, @Query("sp_id") spId?: string) {
    const c = await this.ctx(req);
    return this.team.linkedUsers(c.spaceId, spId);
  }

  // ── 项目维度积分（对齐参照 cam/team/project-points-*）────────
  @Get("team/project-points-flow/list")
  async projectPointsFlows(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("create_time_start") start?: string,
    @Query("create_time_end") end?: string,
    @Query("op_user_name") opUserName?: string,
  ) {
    const c = await this.ctx(req);
    return this.team.listProjectPointsFlows(c.spaceId, {
      page: page === undefined ? undefined : Number(page),
      page_size: pageSize === undefined ? undefined : Number(pageSize),
      create_time_start: start,
      create_time_end: end,
      op_user_name: opUserName,
    });
  }

  /**
   * 项目消耗流水导出（CSV，返回现签链接，1h 有效）。
   *
   * 第 95 批补 `page` / `page_size`：竞品该端点带这两个参数，此前被静默丢弃 ——
   * 按竞品写 `?page=2` 会拿到第 1 页的数据却当成第 2 页。
   */
  @Get("team/project-points-flow/export")
  async exportProjectPointsFlows(
    @Req() req: AuthedRequest,
    @Query("create_time_start") start?: string,
    @Query("create_time_end") end?: string,
    @Query("op_user_name") opUserName?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const c = await this.ctx(req);
    return this.team.exportProjectPointsFlows(c.spaceId, {
      create_time_start: start,
      create_time_end: end,
      op_user_name: opUserName,
      page: page === undefined ? undefined : Number(page),
      page_size: pageSize === undefined ? undefined : Number(pageSize),
    });
  }

  @Post("team/project-points-ranking")
  async projectPointsRanking(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    return this.team.projectPointsRanking(c.spaceId, parseOrThrow(projectPointsRankingBody, body));
  }

  // ── BYOK 第三方 Key（对齐参照 cam/user/third/key/*）──────────
  /** 列表：**只含自己的** Key（团队管理员也看不到别人的，见 service 注释） */  @Get("user/third/key/list")
  async thirdKeys(@Req() req: AuthedRequest) {
    const c = await this.ctx(req);
    return this.team.listThirdKeys(c.spaceId, c.userId);
  }

  @Post("user/third/key/add")
  async addThirdKey(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    return this.team.addThirdKey(c.spaceId, c.userId, parseOrThrow(thirdKeyAdd, body));
  }

  @Get("user/third/key/:id/info")
  async thirdKeyInfo(@Req() req: AuthedRequest, @Param("id") id: string) {
    const c = await this.ctx(req);
    return this.team.thirdKeyInfo(c.spaceId, c.userId, id);
  }

  @Put("user/third/key/:id/update")
  async updateThirdKey(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    const input = parseOrThrow(thirdKeyUpdate, body);
    return this.team.updateThirdKey(c.spaceId, c.userId, id, {
      ...input,
      label: input.label === null ? "" : input.label,
    });
  }

  @Delete("user/third/key/:id/delete")
  async deleteThirdKey(@Req() req: AuthedRequest, @Param("id") id: string) {
    const c = await this.ctx(req);
    return this.team.deleteThirdKey(c.spaceId, c.userId, id);
  }
}
