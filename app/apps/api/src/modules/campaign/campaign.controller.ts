import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CampaignService } from "./campaign.service";
import type { TeamCtx } from "../op/op.service";

/**
 * 激励活动（campaigns）控制器 —— 对照参照产品 `/web/v1/campaign/*` 6 条（`rt:267-272`）。
 *
 * 路由用复数 `campaigns` 是为了避开 `/campaign` 与「活动」概念在同一路径段上的歧义
 * （竞品用单数 `campaign`，ADR-009 允许我方按资源所有权命名，行为对齐即可）。
 * 每条第一件事都是 `requireMember`：活动列表虽是公开内容，但"我的报名态"
 * 只有登录成员才能算，所以统一要求登录（未登录 → 401101）。
 */

const listQuery = z.object({
  status: z.coerce.number().int().min(1).max(4).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const draftBody = z.object({
  work_id: z.string().min(1).nullish(),
  channel: z.string().max(40).nullish(),
  answers: z.record(z.string(), z.unknown()).optional(),
});

const signupBody = z.object({
  work_id: z.string().min(1).nullish(),
  channel: z.string().max(40).nullish(),
});

const signupStatusBody = z.object({ status: z.union([z.literal(2), z.literal(3)]) });

@Controller("campaigns")
export class CampaignController {
  constructor(@Inject(CampaignService) private readonly campaigns: CampaignService) {}

  private async ctx(req: AuthedRequest): Promise<TeamCtx> {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.campaigns.requireMember(auth.spaceId, auth.userId);
  }

  /** 1. 活动列表（= `campaign/list`） */
  @Get()
  async list(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(listQuery, query ?? {});
    return this.campaigns.list(m, { status: q.status, page: q.page, pageSize: q.page_size });
  }

  /** 2. 活动详情（= `campaign/detail`） */
  @Get(":id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    const m = await this.ctx(req);
    return this.campaigns.detail(m, id);
  }

  /** 3. 奖项/获奖名单（= `campaign/awards`） */
  @Get(":id/awards")
  async awards(@Req() req: AuthedRequest, @Param("id") id: string) {
    const m = await this.ctx(req);
    return this.campaigns.awards(m, id);
  }

  /** 4. 入围名单（= `campaign/shortlist`） */
  @Get(":id/shortlist")
  async shortlist(@Req() req: AuthedRequest, @Param("id") id: string, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(pageQuery, query ?? {});
    return this.campaigns.shortlist(m, id, q.page ?? 1, q.page_size ?? 20);
  }

  /** 5. 报名草稿读取（= `campaign/signup/draft` GET） */
  @Get(":id/signup")
  async getDraft(@Req() req: AuthedRequest, @Param("id") id: string) {
    const m = await this.ctx(req);
    return this.campaigns.getDraft(m, id);
  }

  /** 6. 保存报名草稿（= `campaign/signup/draft` POST，可续填） */
  @Put(":id/signup")
  async saveDraft(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.campaigns.saveDraft(m, id, parseOrThrow(draftBody, body ?? {}));
  }

  /** 7. 提交报名（= `campaign/signup/submit`；奖励发行走 creditIn） */
  @Post(":id/signup")
  async signup(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.campaigns.signup(m, id, parseOrThrow(signupBody, body ?? {}));
  }

  /** 8. 取消报名（竞品未见，任务要求"取消"；我方语义见 service 注释） */
  @Delete(":id/signup")
  async cancel(@Req() req: AuthedRequest, @Param("id") id: string) {
    const m = await this.ctx(req);
    return this.campaigns.cancelSignup(m, id);
  }

  /** 9. 运营置入围/获奖（无竞品证据，为让 shortlist/awards 有数据来源） */
  @Post(":id/signups/:signup_id/status")
  async setSignupStatus(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("signup_id") signupId: string,
    @Body() body: unknown,
  ) {
    const m = await this.ctx(req);
    const b = parseOrThrow(signupStatusBody, body ?? {});
    return this.campaigns.setSignupStatus(m, id, signupId, b.status);
  }
}
