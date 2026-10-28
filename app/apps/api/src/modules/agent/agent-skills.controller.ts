import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { AgentSkillsService, type SkillListQuery } from "./agent-skills.service";
import { SKILL_CATEGORY_KEYS } from "./agent-skills.catalog";

/**
 * Skill 卡市场（竞品 `/df/canvas/agent-skills*`，`routes.txt:378-385`）。
 *
 * 路由顺序：`plaza` / `mine` / `favorites` / `details` 这些**字面量必须在 `:skill_id`
 * 之前声明**，否则会被参数路由吞掉（Nest 按声明顺序匹配，kds/agent 已有同款注释）。
 *
 * 第 64 批按 `competitor_endpoints.tsv` 补齐竞品的 9 条形状（原有 9 端点 + 新增 1）：
 *   1. GET    /agent-skills                      广场全集（分类/搜索/分页）
 *   2. GET    /agent-skills/plaza                广场（仅公开卡；`category`/`name`/`is_home_recommend`）
 *   3. GET    /agent-skills/mine                 本空间自建（`status`）
 *   4. GET    /agent-skills/favorites            我的收藏
 *   5. POST   /agent-skills/:id/favorite         收藏/取消（幂等）
 *   6. GET    /agent-skills/:id                  卡片详情
 *   7. POST   /agent-skills                      新建卡片（可带 `name_en`）
 *   8. DELETE /agent-skills/:id                  软删（仅创建人）
 *   9. GET    /agent-skills/details?skill_id=&owner_type=  竞品同名字面量别名
 *  10. PUT    /agent-skills                      更新卡片（仅创建人，平台卡不可改）
 */

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
  category: z.string().min(1).max(32).optional(),
  q: z.string().max(60).optional(),
  /** 竞品 `plaza` 的 `name`：只按显示名/英文名收敛（`q` 是全文检索） */
  name: z.string().max(64).optional(),
  /** 竞品 `plaza` 的 `is_home_recommend`：query 里只会是 "1"/"0"/"true"/"false" */
  is_home_recommend: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false"), z.boolean()])
    .transform((value) => value === true || value === "1" || value === "true")
    .optional(),
  /** 竞品 `mine` 的 `status`：1 正常 / 2 下架 */
  status: z.coerce.number().int().min(1).max(2).optional(),
  /** 竞品 `details` 的 `owner_type`：1 平台卡 / 2 团队卡 */
  owner_type: z.coerce.number().int().min(1).max(2).optional(),
});

/** 斜杠指令名：小写字母/数字/连字符（与目录里的 slug 同形） */
const nameEnSchema = z.string().max(64).regex(/^[a-z0-9-]*$/);

const createSchema = z.object({
  name: z.string().min(1).max(40),
  name_en: nameEnSchema.optional(),
  summary: z.string().max(200).optional(),
  category: z.enum(SKILL_CATEGORY_KEYS as [string, ...string[]]).optional(),
  prompt_template: z.string().max(4000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  // 1 私有 / 2 发布到广场
  visibility: z.union([z.literal(1), z.literal(2)]).optional(),
  cover_uri: z.string().max(2048).nullable().optional(),
});

/**
 * 更新（竞品 `PUT /df/canvas/agent-skills`）：该端点 `paramNames`/`queryNames`
 * 都是空的，目标卡只能从 body 带 —— 所以 `skill_id` 必填，其余"传了才改"。
 */
const updateSchema = createSchema.partial().extend({
  skill_id: z.string().min(1).max(20),
});

const favoriteSchema = z.object({
  /** 省略 = 取反；显式传值 = 幂等设置 */
  favorite: z.boolean().optional(),
});

@Controller("agent-skills")
export class AgentSkillsController {
  constructor(@Inject(AgentSkillsService) private readonly skills: AgentSkillsService) {}

  private auth(req: AuthedRequest): { userId: string; spaceId: string } {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { userId: auth.userId, spaceId: auth.spaceId };
  }

  /** 1. 全集：广场 ∪ 本空间（前端 Skill 抽屉默认列表） */
  @Get()
  async list(@Req() req: AuthedRequest, @Query() query: unknown) {
    const a = this.auth(req);
    return this.skills.list(a.spaceId, a.userId, parseOrThrow(listQuerySchema, query ?? {}) as SkillListQuery);
  }

  /** 2. 广场 */
  @Get("plaza")
  async plaza(@Req() req: AuthedRequest, @Query() query: unknown) {
    const a = this.auth(req);
    return this.skills.plaza(a.spaceId, a.userId, parseOrThrow(listQuerySchema, query ?? {}) as SkillListQuery);
  }

  /** 3. 我的（本空间自建） */
  @Get("mine")
  async mine(@Req() req: AuthedRequest, @Query() query: unknown) {
    const a = this.auth(req);
    return this.skills.mine(a.spaceId, a.userId, parseOrThrow(listQuerySchema, query ?? {}) as SkillListQuery);
  }

  /** 4. 我的收藏 */
  @Get("favorites")
  async favorites(@Req() req: AuthedRequest, @Query() query: unknown) {
    const a = this.auth(req);
    return this.skills.favorites(a.spaceId, a.userId, parseOrThrow(listQuerySchema, query ?? {}) as SkillListQuery);
  }

  /** 9. 竞品同名字面量别名（保留以便 1:1 覆盖核对） */
  @Get("details")
  async detailsByQuery(
    @Req() req: AuthedRequest,
    @Query("id") id?: string,
    @Query("skill_id") skillId?: string,
    @Query("owner_type") ownerType?: string,
  ) {
    const a = this.auth(req);
    const target = id ?? skillId;
    if (!target) throw new AppError(ErrorCode.INVALID_PARAM, "id is required", { field: "id" });
    return this.skills.detail(a.spaceId, a.userId, target, this.ownerType(ownerType));
  }

  /** 竞品 `owner_type` 只有 1(平台) / 2(团队)；其它值一律 400101，不静默忽略 */
  private ownerType(raw?: string): number | undefined {
    if (raw === undefined || raw === "") return undefined;
    const value = Number(raw);
    if (value !== 1 && value !== 2) {
      throw new AppError(ErrorCode.INVALID_PARAM, "owner_type must be 1 or 2", { field: "owner_type" });
    }
    return value;
  }

  /** 7. 新建卡片 */
  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    return this.skills.create(a.spaceId, a.userId, parseOrThrow(createSchema, body));
  }

  /** 10. 更新卡片（竞品 `PUT /df/canvas/agent-skills`，第 64 批） */
  @Put()
  async update(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    return this.skills.update(a.spaceId, a.userId, parseOrThrow(updateSchema, body));
  }

  /** 5. 收藏 / 取消收藏（幂等） */
  @Post(":skill_id/favorite")
  async favorite(@Req() req: AuthedRequest, @Param("skill_id") skillId: string, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(favoriteSchema, body ?? {});
    return this.skills.favorite(a.spaceId, a.userId, skillId, input.favorite);
  }

  /** 6. 详情 */
  @Get(":skill_id")
  async detail(@Req() req: AuthedRequest, @Param("skill_id") skillId: string) {
    const a = this.auth(req);
    return this.skills.detail(a.spaceId, a.userId, skillId);
  }

  /** 8. 软删（仅创建人；平台卡不可删） */
  @Delete(":skill_id")
  async remove(@Req() req: AuthedRequest, @Param("skill_id") skillId: string) {
    const a = this.auth(req);
    return this.skills.remove(a.spaceId, a.userId, skillId);
  }
}
