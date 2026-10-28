import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { OpRedeemService } from "./op.redeem.service";
import { OpService, type TeamCtx } from "./op.service";
import { OpSurveyService } from "./op.survey.service";

/**
 * 运营增长（op）控制器 —— 对照参照产品 `/web/v1/op/*` 31 条（`rt:829-859`）。
 *
 * 路径逐条照抄竞品（ADR-009：保留域划分，便于 1:1 核对覆盖）。
 * 每条路由第一件事都是 `requireMember`（非成员 403101），运营后台动作再叠
 * `requireOperator`（成员 + 管理特权）。跨 space 一律 404/400101，不泄露存在性。
 *
 * 命名注意（容易踩）：竞品 `invite-code-questionnaire/:activity_id` 与
 * `invite-code-questionnaire/filled` 同段，静态段在前声明可读性更好；
 * Fastify 的 find-my-way 本身优先匹配静态段，顺序不影响正确性。
 */

const codeBody = z.object({ code: z.string().min(2).max(64) });

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const pageBody = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const giveawayBody = z.object({
  user_ids: z.array(z.string().min(1)).min(1).max(50),
  credits: z.number().int().min(1).max(100_000),
  reason: z.string().max(200).optional(),
});

const variantSchema = z.object({
  name: z.string().min(1).max(40),
  weight: z.number().int().min(0).max(1000),
});

const experimentCreateBody = z.object({
  key: z.string().min(2).max(64),
  name: z.string().max(80).optional(),
  variants: z.array(variantSchema).min(1).max(10),
  status: z.number().int().min(1).max(3).optional(),
});

const experimentPatchBody = z.object({
  name: z.string().max(80).optional(),
  variants: z.array(variantSchema).min(1).max(10).optional(),
  status: z.number().int().min(1).max(3).optional(),
});

const questionnaireBody = z.object({
  questionnaire_id: z.string().min(2).max(40).optional(),
  answers: z.record(z.string(), z.unknown()),
  channel: z.string().max(40).optional(),
});

const reviewBody = z.object({
  status: z.union([z.literal("approved"), z.literal("rejected")]),
  note: z.string().max(300).optional(),
});

const redeemCreateBody = z.object({
  code: z.string().min(4).max(32).optional(),
  credits: z.number().int().min(1).max(100_000),
  max_uses: z.number().int().min(0).max(100_000).optional(),
  expires_at: z.string().datetime().nullish(),
});

const redeemPatchBody = z.object({
  status: z.number().int().min(1).max(2).optional(),
  max_uses: z.number().int().min(0).max(100_000).optional(),
  expires_at: z.string().datetime().nullish(),
});

const activityIdBody = z.object({ activity_id: z.string().min(1).max(64) });

@Controller("op")
export class OpController {
  constructor(
    @Inject(OpService) private readonly op: OpService,
    @Inject(OpRedeemService) private readonly redeem: OpRedeemService,
    @Inject(OpSurveyService) private readonly survey: OpSurveyService,
  ) {}

  private async ctx(req: AuthedRequest): Promise<TeamCtx> {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.op.requireMember(auth.spaceId, auth.userId);
  }

  // ── 邀请码（rt:840 / 847 / 848）────────────────────────────
  /** 我的邀请码（GET 只读；POST 生成/取回，幂等） */
  @Get("invite-code")
  async getInviteCode(@Req() req: AuthedRequest) {
    return this.op.myInviteCode(await this.ctx(req));
  }

  @Post("invite-code")
  async postInviteCode(@Req() req: AuthedRequest) {
    return this.op.ensureMyInviteCode(await this.ctx(req));
  }

  @Get("invite-code/check")
  async checkInviteCode(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(codeBody, query ?? {});
    return this.op.checkInviteCode(m, q.code);
  }

  @Post("invite-code/verify")
  async verifyInviteCode(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(codeBody, body ?? {});
    return this.op.verifyInviteCode(m, b.code);
  }

  @Post("referral-link")
  async referralLink(@Req() req: AuthedRequest) {
    return this.op.referralLink(await this.ctx(req));
  }

  // ── 分销（rt:836-839 / 849）────────────────────────────────
  @Post("distributor/overview")
  async distributorOverview(@Req() req: AuthedRequest) {
    return this.op.distributorOverview(await this.ctx(req));
  }

  @Post("distributor/detail")
  async distributorDetail(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(
      pageBody.extend({ invitee_type: z.number().int().min(1).max(2).optional() }),
      body ?? {},
    );
    return this.op.distributorDetail(m, b.page ?? 1, b.page_size ?? 20, b.invitee_type);
  }

  @Post("distributor/income-detail")
  async distributorIncome(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody, body ?? {});
    return this.op.distributorIncomeDetail(m, b.page ?? 1, b.page_size ?? 20);
  }

  @Post("distributor/withdrawal-list")
  async distributorWithdrawal(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody, body ?? {});
    return this.op.distributorWithdrawalList(m, b.page ?? 1, b.page_size ?? 20);
  }

  @Post("invitee/order-records")
  async inviteeOrders(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody, body ?? {});
    return this.op.inviteeOrderRecords(m, b.page ?? 1, b.page_size ?? 20);
  }

  // ── 每日奖励 / 定向发分 / 通知 / 短信码（rt:835 / 851 / 859 / 850）──
  @Post("daily-reward")
  async dailyReward(@Req() req: AuthedRequest) {
    return this.op.dailyReward(await this.ctx(req));
  }

  @Post("points-giveaway")
  async pointsGiveaway(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.op.pointsGiveaway(m, parseOrThrow(giveawayBody, body ?? {}));
  }

  @Post("rewards-notification")
  async rewardsNotification(@Req() req: AuthedRequest) {
    return this.op.rewardsNotification(await this.ctx(req));
  }

  @Post("mobile-captcha")
  async mobileCaptcha(@Req() req: AuthedRequest, @Body() body: unknown) {
    await this.ctx(req);
    const b = parseOrThrow(z.object({ phone: z.string().regex(/^1\d{10}$/, "手机号格式错误") }), body ?? {});
    return this.op.sendMobileCaptcha(b.phone, req.ip);
  }

  // ── AB 实验（rt:829 + 我方 experiments CRUD）────────────────
  @Get("abtest/hit")
  async abtestHit(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(
      z.object({ experiment_keys: z.union([z.string(), z.array(z.string())]).optional() }),
      query ?? {},
    );
    const keys = q.experiment_keys
      ? Array.isArray(q.experiment_keys)
        ? q.experiment_keys
        : q.experiment_keys.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    return this.op.abtestHit(m, keys);
  }

  @Get("abtest/experiments")
  async listExperiments(@Req() req: AuthedRequest) {
    return this.op.listExperiments(await this.ctx(req));
  }

  @Post("abtest/experiments")
  async createExperiment(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.op.createExperiment(m, parseOrThrow(experimentCreateBody, body ?? {}));
  }

  @Patch("abtest/experiments/:id")
  async patchExperiment(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.op.updateExperiment(m, id, parseOrThrow(experimentPatchBody, body ?? {}));
  }

  // ── 问卷（rt:852-854 / 857-858）────────────────────────────
  @Get("questionnaire")
  async questionnaire(@Req() req: AuthedRequest) {
    return this.survey.view(await this.ctx(req), "register");
  }

  @Post("questionnaire")
  async submitQuestionnaire(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(questionnaireBody, body ?? {});
    return this.survey.submit(m, b.questionnaire_id ?? "register", b.answers, { channel: b.channel });
  }

  @Get("questionnaire/mgr/list")
  async questionnaireMgrList(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(
      z.object({
        questionnaire_id: z.string().min(2).max(40).optional(),
        page: z.coerce.number().int().min(1).optional(),
        page_size: z.coerce.number().int().min(1).max(100).optional(),
        uid: z.string().max(40).optional(),
      }),
      query ?? {},
    );
    return this.survey.mgrList(m, q.questionnaire_id ?? "beta", q.page ?? 1, q.page_size ?? 20, q.uid);
  }

  @Post("questionnaire/mgr/review/:id")
  async questionnaireReview(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.survey.review(m, decodeURIComponent(id), parseOrThrow(reviewBody, body ?? {}));
  }

  @Post("register-questionnaire")
  async registerQuestionnaire(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(questionnaireBody, body ?? {});
    return this.survey.submit(m, "register", b.answers, { channel: b.channel });
  }

  /**
   * rt:853 `GET /op/register-questionnaire` —— 取「注册问卷」的定义。
   *
   * 我方原本只有 `GET /op/questionnaire`（同一份 register 定义，路径是我方命名）。
   * 竞品路径是 `register-questionnaire`，两条都留下：老路径不动（已有调用方），
   * 新路径让「照竞品写的调用方」也能取到同一份定义。返回体完全一致。
   */
  @Get("register-questionnaire")
  async registerQuestionnaireView(@Req() req: AuthedRequest) {
    return this.survey.view(await this.ctx(req), "register");
  }

  @Get("register-questionnaire/check")
  async registerQuestionnaireCheck(@Req() req: AuthedRequest) {
    const m = await this.ctx(req);
    return this.survey.filled(m, "register");
  }

  // ── 内测申请（rt:830-834）──────────────────────────────────
  /**
   * rt:830 `GET /op/beta-questionnaire` —— 取「内测申请表」的字段定义。
   *
   * 这是本批审计出来的**真缺口**：竞品有这条读接口，我方只有提交（`POST beta-questionnaire`）
   * 与「是否已填」（`GET beta-questionnaire/check`），前端拿不到题目只能自己写死在页面里——
   * 题目一改就要发版。定义来自 `op.survey.service.ts` 的 `view(m, "beta")`，
   * 与 `questionnaire/mgr/list?questionnaire_id=beta` 用的是同一份定义，不会漂移。
   */
  @Get("beta-questionnaire")
  async betaQuestionnaireView(@Req() req: AuthedRequest) {
    return this.survey.view(await this.ctx(req), "beta");
  }

  @Post("beta-questionnaire")
  async betaQuestionnaire(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(questionnaireBody, body ?? {});
    return this.survey.betaSubmit(m, "beta", b.answers);
  }

  @Post("beta-questionnaire-abroad")
  async betaQuestionnaireAbroad(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(questionnaireBody, body ?? {});
    return this.survey.betaSubmit(m, "beta_abroad", b.answers);
  }

  @Get("beta-questionnaire/check")
  async betaQuestionnaireCheck(@Req() req: AuthedRequest) {
    const m = await this.ctx(req);
    const status = await this.survey.betaStatus(m);
    return { filled: status.submitted, is_complete: status.submitted ? 1 : 0, review_status: status.review_status };
  }

  @Post("beta-questionnaire/mobile-verify")
  async betaMobileVerify(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(
      z.object({ phone: z.string().regex(/^1\d{10}$/), code: z.string().min(4).max(8) }),
      body ?? {},
    );
    return this.survey.betaMobileVerify(m, b.phone, b.code);
  }

  @Get("beta-status")
  async betaStatus(@Req() req: AuthedRequest) {
    return this.survey.betaStatus(await this.ctx(req));
  }

  // ── 邀请码活动问卷（rt:841-846）─────────────────────────────
  @Get("invite-code-questionnaire/filled")
  async inviteQuestionnaireFilled(@Req() req: AuthedRequest) {
    return this.survey.filledList(await this.ctx(req), "invite_activity");
  }

  @Get("invite-code-questionnaire/invite-activity-check")
  async inviteActivityCheck(@Req() req: AuthedRequest) {
    return this.survey.inviteActivityCheck(await this.ctx(req));
  }

  @Get("invite-code-questionnaire/:activity_id")
  async inviteQuestionnaireDetail(@Req() req: AuthedRequest, @Param("activity_id") activityId: string) {
    const m = await this.ctx(req);
    const answer = await this.survey.answerForActivity(m, activityId);
    return {
      activity_id: activityId,
      questionnaire: this.survey.definition("invite_activity"),
      filled: answer !== null,
      answer,
    };
  }

  @Post("invite-code-questionnaire")
  async inviteQuestionnaireSubmit(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(questionnaireBody.extend(activityIdBody.shape), body ?? {});
    return this.survey.submit(m, "invite_activity", b.answers, {
      activity_id: b.activity_id,
      channel: b.channel,
    });
  }

  @Post("invite-code-questionnaire/check")
  async inviteQuestionnaireCheck(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(activityIdBody, body ?? {});
    return this.survey.filled(m, "invite_activity", b.activity_id);
  }

  /**
   * `invite-code-questionnaire/verify`：带邀请码提交活动问卷。
   * 先校验码（用 `check` 的只读口径），校验不过不写答案——避免"填完才发现码无效"。
   */
  @Post("invite-code-questionnaire/verify")
  async inviteQuestionnaireVerify(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(
      questionnaireBody.extend(activityIdBody.shape).extend({ invite_code: z.string().min(2).max(64) }),
      body ?? {},
    );
    const check = await this.op.checkInviteCode(m, b.invite_code);
    if (!check.valid) {
      throw new AppError(ErrorCode.INVALID_PARAM, `邀请码不可用：${check.reason}`, { field: "invite_code" });
    }
    const submitted = await this.survey.submit(m, "invite_activity", b.answers, {
      activity_id: b.activity_id,
      channel: b.channel,
    });
    return { verified: true, invite_code: b.invite_code, ...submitted };
  }

  // ── 兑换码（rt:855 查询 + 我方 CRUD）───────────────────────
  @Post("redeem-code/info")
  async redeemCodeInfo(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.op.redeemCodeInfo(m, parseOrThrow(codeBody, body ?? {}).code);
  }

  @Post("redeem-code")
  async createRedeemCode(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.redeem.create(m, parseOrThrow(redeemCreateBody, body ?? {}));
  }

  @Get("redeem-code/list")
  async listRedeemCodes(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(pageQuery, query ?? {});
    return this.redeem.list(m, q.page ?? 1, q.page_size ?? 20);
  }

  @Patch("redeem-code/:id")
  async patchRedeemCode(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.redeem.update(m, id, parseOrThrow(redeemPatchBody, body ?? {}));
  }

  @Delete("redeem-code/:id")
  async deleteRedeemCode(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.redeem.disable(await this.ctx(req), id);
  }

  // ── 运营位（rt:290 / 295 的前台读取在 crc）──────────────────
  /**
   * 空间管理员读运营位（含停用）。**写**在 `AdminPromoSlotController`（`/ops/admin/promo-slots`）：
   * `promo_slots.created_by` 指向 `admin_users`，写入口必须用运营账号鉴权，
   * 用空间 token 写会撞外键（schema.ts 该列注释即此意）。
   */
  @Get("promo-slots")
  async listPromoSlots(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(z.object({ slot: z.string().max(20).optional() }), query ?? {});
    return this.op.listPromoSlots(m, q.slot);
  }
}

/**
 * 兑换码核销的独立路径（竞品 `/web/v1/redeem-code/redeem`，`rt:860`）。
 *
 * 为什么单独一个控制器而不并入 `/op`：竞品刻意把"查询"和"核销"分属两个服务
 * （`d-commerce-account.md:468-471`），路径即边界。我方保留这个边界，
 * 后续接渠道卡券系统时可以整个控制器平移出去。
 */
@Controller("redeem-code")
export class RedeemCodeController {
  constructor(@Inject(OpRedeemService) private readonly redeem: OpRedeemService) {}

  @Post("redeem")
  async redeemCode(@Req() req: AuthedRequest, @Body() body: unknown) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    const m = await this.redeem.requireMember(auth.spaceId, auth.userId);
    return this.redeem.redeem(m, parseOrThrow(codeBody, body ?? {}).code);
  }
}
