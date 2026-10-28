import { Body, Controller, Get, Inject, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import { AdminGuard } from "../admin/admin.guard";
import { AgentSkillsService } from "./agent-skills.service";

/**
 * Skill 卡**运营编排**（`/ops/agent-skills/*`）—— 第 102 批新增。
 *
 * ## 为什么必须单独一个控制器
 *
 * `agent_skills.is_home_recommend` 这一列此前**没有任何写入路径**：
 * 全仓只在两处出现 —— `page()` 的读过滤与 `toDto()` 的投影。
 * 结果是 33 张平台卡的该列永远等于建表默认值 `false`，而
 * `GET /agent-skills/plaza?is_home_recommend=1` **永远返回空数组** ——
 * 竞品这个筛选项在我方是一条死分支。
 *
 * 而 C 端的 `PUT /agent-skills` 改不了它：那条路要求
 * `requireOwned(spaceId, userId, id)`，而平台卡的 `space_id` / `owner_user_id`
 * 都是 `NULL`（`seedCatalog()` 种入），**没有任何用户「拥有」平台卡**。
 *
 * 所以需要一个绕过「所有权」的入口，用一个不同的鉴权依据（管理员）：
 * 与 `/ops/market/*`、`/ops/admin/*` 同模式（`@Public()` + `AdminGuard`），
 * 不走全局 `AuthGuard`。
 *
 * ## 边界
 *
 * 1. **只动平台卡**（`space_id IS NULL`）。团队自建卡归创建者，运营不能推上首页。
 * 2. **只动 `is_home_recommend`**。不做「推荐位排序」—— 现在列表按
 *    `is_home_recommend desc, use_count desc` 排；真要做人工排序应加独立列，
 *    而不是复用 `use_count`（那是真实使用量，被当成权重会失真）。
 */
const listQuery = z.object({
  /** 只列已上/未上首页的卡（不传 = 全部） */
  is_home_recommend: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false"), z.boolean()])
    .transform((v) => v === true || v === "1" || v === "true")
    .optional(),
  category: z.string().min(1).max(32).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const recommendBody = z.object({
  is_home_recommend: z.boolean(),
});

@Public()
@UseGuards(AdminGuard)
@Controller("ops/agent-skills")
export class AgentSkillsAdminController {
  constructor(@Inject(AgentSkillsService) private readonly skills: AgentSkillsService) {}

  /** 1. 平台卡列表（含当前推荐位状态；推荐位优先、再按使用量） */
  @Get()
  list(@Query() query: unknown) {
    return this.skills.adminListPlatformSkills(parseOrThrow(listQuery, query ?? {}));
  }

  /**
   * 2. 设置/取消某张平台卡的首页推荐位（幂等）。
   *
   * 为什么用 PATCH 而不是 POST 动作端点：这是**局部更新一个资源字段**，
   * 与 `/ops/market/*` 的局部更新同风格；`{is_home_recommend: true|false}`
   * 显式表达意图，比 `POST .../recommend` + `POST .../unrecommend`
   * 少一条路由且不会有「两个动作端点各改一次」的漂移。
   */
  @Patch(":id")
  setRecommend(@Param("id") id: string, @Body() body: unknown) {
    return this.skills.adminSetHomeRecommend(id, parseOrThrow(recommendBody, body ?? {}));
  }
}
