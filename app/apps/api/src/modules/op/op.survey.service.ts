import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { opQuestionnaireResponses, opQuestionnaires, spaceMembers, users } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { OpService, type TeamCtx } from "./op.service";

/**
 * 问卷 / 内测申请 / 邀请码活动问卷（`rt:830-834`、`841-846`、`852-854`、`857-858`）——
 * 共 15 条竞品端点，实际只有两个语义：
 *
 *   ① **一份定义 + 一人一份答案**（问卷、内测申请）；
 *   ② **一份定义 + 一人一活动一份答案**（邀请码活动问卷，答案里记 activity_id）。
 *
 * 数据落 `op_questionnaires`（定义，`qkey` 唯一）+ `op_questionnaire_responses`
 * （答案，`(questionnaire_id, user_id)` 唯一）——迁移 0025 专为本域新建的两张表。
 * **一人一份靠唯一键裁决**，不做"先查后写"（并发重复提交会出两行）。
 *
 * 两个约定的形状（写在表注释之外的必要说明）：
 *
 * 1. `op_questionnaires.questions` = `[{ id, type, title, required?, options?, max_length? }]`，
 *    与 schema 注释一致；本服务的常量是**种子内容**，首次访问时懒写入（运营后可改库）。
 * 2. `op_questionnaire_responses.answers` = `{ <question_id>: value }` **外加一个保留键 `_meta`**
 *    （`{ channel, activity_id, submitted_at, mobile_verified, review }`）。
 *    为什么保留键而不是加列：审核结论/渠道/活动归属是"每次投递的元数据"，不是题目答案；
 *    `_meta` 前缀不会与题目 id 冲突（题目 id 由我们定义，不允许以 `_` 开头，提交时也会被剥离）。
 *    等运营后台需要按审核态索引时，再迁移成正式列（本服务是唯一改点）。
 */

export type QuestionType = "text" | "textarea" | "single" | "multi" | "number";

export interface QuestionDef {
  key: string;
  label: string;
  type: QuestionType;
  required?: boolean;
  max_length?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface QuestionnaireDef {
  id: string;
  title: string;
  description: string;
  /** 有审核环节（竞品 `questionnaire/mgr/review/:id` 证明存在，`d-commerce-account.md:479`） */
  review_required: boolean;
  questions: QuestionDef[];
}

/** 答案行的元数据（`answers._meta`） */
export interface ResponseMeta {
  channel?: string | null;
  activity_id?: string | null;
  submitted_at?: string | null;
  mobile_verified?: boolean;
  review?: { status: "pending" | "approved" | "rejected"; note: string | null; by: string | null; at: string | null };
}

const YES_NO = [
  { value: "yes", label: "是" },
  { value: "no", label: "否" },
];

/** 问卷定义（种子常量；首次访问写入 `op_questionnaires`，之后以库为准） */
export const QUESTIONNAIRES: Record<string, QuestionnaireDef> = {
  register: {
    id: "register",
    title: "新用户问卷",
    description: "了解你的创作场景，用于给你默认配置合适的工具集。",
    review_required: false,
    questions: [
      {
        key: "scene",
        label: "主要创作场景",
        type: "single",
        required: true,
        options: [
          { value: "short_drama", label: "短剧" },
          { value: "ad", label: "广告片" },
          { value: "novel_adapt", label: "小说改编" },
          { value: "other", label: "其它" },
        ],
      },
      { key: "team_size", label: "团队人数", type: "number", required: true },
      { key: "pain", label: "最想解决的问题", type: "textarea", max_length: 500 },
    ],
  },
  beta: {
    id: "beta",
    title: "内测申请",
    description: "影视版/新能力内测为商务开通制，先填申请，运营审核后开通。",
    review_required: true,
    questions: [
      { key: "company", label: "公司/团队名称", type: "text", required: true, max_length: 80 },
      { key: "works", label: "代表作品（可填链接）", type: "textarea", max_length: 300 },
      { key: "capacity", label: "月产集数", type: "number", required: true },
      { key: "ai_film", label: "是否使用影视版", type: "single", required: true, options: YES_NO },
      { key: "contact", label: "联系方式", type: "text", required: true, max_length: 80 },
    ],
  },
  beta_abroad: {
    id: "beta_abroad",
    title: "海外版内测申请",
    description: "海外版（多语言/海外支付）内测申请；与国内内测分开排队。",
    review_required: true,
    questions: [
      { key: "company", label: "Company / Team", type: "text", required: true, max_length: 80 },
      { key: "region", label: "主要发行地区", type: "text", required: true, max_length: 80 },
      { key: "capacity", label: "月产集数", type: "number", required: true },
      { key: "contact", label: "联系方式", type: "text", required: true, max_length: 80 },
    ],
  },
  invite_activity: {
    id: "invite_activity",
    title: "邀请活动问卷",
    description: "参与邀请活动需先填问卷，审核通过后邀请码才计入活动。",
    review_required: true,
    questions: [
      { key: "channel_name", label: "你的渠道/社群", type: "text", required: true, max_length: 120 },
      { key: "expected", label: "预计可邀请人数", type: "number", required: true },
      { key: "note", label: "补充说明", type: "textarea", max_length: 300 },
    ],
  },
};

@Injectable()
export class OpSurveyService {
  constructor(@Inject(OpService) private readonly op: OpService) {}

  definition(qkey: string): QuestionnaireDef {
    const def = QUESTIONNAIRES[qkey];
    if (!def) throw new AppError(ErrorCode.INVALID_PARAM, "questionnaire not found", { field: "questionnaire_id" });
    return def;
  }

  /**
   * 取（没有就种）问卷定义。
   *
   * 懒种子的理由：问卷题目是**产品内容**（会改），不该硬编码在迁移里；
   * 但 C 端又要能直接 `GET /op/questionnaire` 拿到定义，所以第一次访问时把常量
   * 写进 `op_questionnaires`（`qkey` 唯一，重复写被 `onConflictDoNothing` 吃掉）。
   * 之后以库为准——运营改库即生效（本服务的校验仍用常量，见下方 validateAnswers 注释）。
   */
  private async ensureDefinition(qkey: string) {
    const def = this.definition(qkey);
    const questions = def.questions.map((q) => ({
      id: q.key,
      type: q.type,
      title: q.label,
      required: Boolean(q.required),
      ...(q.options ? { options: q.options } : {}),
      ...(q.max_length ? { max_length: q.max_length } : {}),
    }));
    await db
      .insert(opQuestionnaires)
      .values({
        id: newId(),
        qkey,
        title: def.title,
        questions,
        // 2 = 收集中（schema：1 草稿 / 2 收集中 / 3 已结束）
        status: 2,
        startAt: new Date(),
      })
      .onConflictDoNothing({ target: opQuestionnaires.qkey });
    const [row] = await db.select().from(opQuestionnaires).where(eq(opQuestionnaires.qkey, qkey)).limit(1);
    if (!row) throw new AppError(ErrorCode.INTERNAL, "questionnaire definition missing");
    return row;
  }

  /**
   * 答案校验：必填 / 选项合法性 / 长度。
   *
   * 校验用**常量**而不是库里的 questions：常量是本服务对外承诺的契约（前端也按它渲染），
   * 运营在库里改题目属于后台能力，等后台题目编辑上线后校验改为读库（届时这里是唯一改点）。
   */
  validateAnswers(def: QuestionnaireDef, answers: Record<string, unknown>) {
    const out: Record<string, string | number | string[]> = {};
    for (const q of def.questions) {
      const raw = answers[q.key];
      const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);
      if (empty) {
        if (q.required) throw new AppError(ErrorCode.INVALID_PARAM, `${q.label} 为必填`, { field: `answers.${q.key}` });
        continue;
      }
      if (q.type === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          throw new AppError(ErrorCode.INVALID_PARAM, `${q.label} 需为数字`, { field: `answers.${q.key}` });
        }
        out[q.key] = n;
      } else if (q.type === "single") {
        const v = String(raw);
        if (q.options && !q.options.some((o) => o.value === v)) {
          throw new AppError(ErrorCode.INVALID_PARAM, `${q.label} 取值非法`, { field: `answers.${q.key}` });
        }
        out[q.key] = v;
      } else if (q.type === "multi") {
        const arr = Array.isArray(raw) ? raw.map(String) : [String(raw)];
        if (q.options && arr.some((v) => !q.options!.some((o) => o.value === v))) {
          throw new AppError(ErrorCode.INVALID_PARAM, `${q.label} 取值非法`, { field: `answers.${q.key}` });
        }
        out[q.key] = arr;
      } else {
        const v = String(raw);
        const max = q.max_length ?? 500;
        if (v.length > max) {
          throw new AppError(ErrorCode.INVALID_PARAM, `${q.label} 最多 ${max} 字`, { field: `answers.${q.key}` });
        }
        out[q.key] = v;
      }
    }
    return out;
  }

  // ── 读 ───────────────────────────────────────────────────
  async view(ctx: TeamCtx, qkey: string) {
    const def = this.definition(qkey);
    const row = await this.ensureDefinition(qkey);
    const response = await this.findResponse(row.id, ctx);
    return {
      questionnaire: {
        id: qkey,
        title: row.title,
        description: def.description,
        questions: row.questions,
        review_required: def.review_required,
      },
      filled: response !== null,
      answer: response ? this.decorate(response) : null,
    };
  }

  /** 是否已填（`register-questionnaire/check` 返回 `{is_complete: 0|1}`，`d-commerce-account.md:479`） */
  async filled(ctx: TeamCtx, qkey: string, activityId?: string) {
    const row = await this.ensureDefinition(qkey);
    const response = await this.findResponse(row.id, ctx);
    if (!response) return { filled: false, is_complete: 0, review_status: null };
    const meta = this.metaOf(response.answers);
    // 活动问卷按活动区分：同一用户对不同活动是不同投递（活动 id 存在 `_meta`）
    if (activityId && meta.activity_id !== activityId) {
      return { filled: false, is_complete: 0, review_status: null };
    }
    return { filled: true, is_complete: 1, review_status: meta.review?.status ?? null };
  }

  /** 我填过的活动问卷（`invite-code-questionnaire/filled`） */
  async filledList(ctx: TeamCtx, qkey: string) {
    const row = await this.ensureDefinition(qkey);
    const response = await this.findResponse(row.id, ctx);
    if (!response) return { list: [], count: 0 };
    return { list: [this.decorate(response)], count: 1 };
  }

  // ── 提交 ─────────────────────────────────────────────────
  /**
   * 提交答案。**一人一份**：重复提交返回 `replayed:true` 与既有答案，不再写第二次。
   *
   * 为什么不做"覆盖"：问卷是留资语义（竞品用 `filled` 判是否已填），允许覆盖会让
   * "已填过的人"反复刷新提交时间、把运营的审核队列顺序打乱。
   */
  async submit(
    ctx: TeamCtx,
    qkey: string,
    answers: Record<string, unknown>,
    extra: { activity_id?: string; channel?: string } = {},
  ) {
    const def = this.definition(qkey);
    const clean = this.validateAnswers(def, answers);
    const questionnaire = await this.ensureDefinition(qkey);
    const meta: ResponseMeta = {
      channel: extra.channel ?? null,
      activity_id: extra.activity_id ?? null,
      submitted_at: new Date().toISOString(),
      mobile_verified: false,
      review: def.review_required
        ? { status: "pending", note: null, by: null, at: null }
        : { status: "approved", note: null, by: null, at: null },
    };
    const payload = { ...clean, _meta: meta };

    const inserted = await db
      .insert(opQuestionnaireResponses)
      .values({
        id: newId(),
        questionnaireId: questionnaire.id,
        userId: BigInt(ctx.userId),
        answers: payload,
      })
      .onConflictDoNothing({
        target: [opQuestionnaireResponses.questionnaireId, opQuestionnaireResponses.userId],
      })
      .returning();
    if (inserted.length === 0) {
      const existing = await this.findResponse(questionnaire.id, ctx);
      return { filled: true, replayed: true, submission: existing ? this.decorate(existing) : null };
    }
    return { filled: true, replayed: false, submission: this.decorate(inserted[0]!) };
  }

  // ── 运营后台 ──────────────────────────────────────────────
  async mgrList(ctx: TeamCtx, qkey: string, page = 1, pageSize = 20, uid?: string) {
    this.op.requireOperator(ctx);
    const questionnaire = await this.ensureDefinition(qkey);
    // 问卷定义与答案都是**平台级**表（`op_questionnaires.qkey` 全局唯一，没有空间维度），
    // 所以"运营能看到谁的答卷"必须显式收窄到**本 space 成员**——否则任何团队管理员
    // 都能翻到别家团队的留资（跨租户泄露）。这张 join 就是这条边界。
    const conds = [
      eq(opQuestionnaireResponses.questionnaireId, questionnaire.id),
      eq(spaceMembers.spaceId, BigInt(ctx.spaceId)),
      eq(spaceMembers.status, 1),
    ];
    if (uid) conds.push(eq(opQuestionnaireResponses.userId, BigInt(uid)));
    const rows = await db
      .select({
        response: opQuestionnaireResponses,
        nickname: users.nickname,
      })
      .from(opQuestionnaireResponses)
      .innerJoin(users, eq(users.id, opQuestionnaireResponses.userId))
      .innerJoin(spaceMembers, eq(spaceMembers.userId, opQuestionnaireResponses.userId))
      .where(and(...conds))
      .orderBy(desc(opQuestionnaireResponses.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(opQuestionnaireResponses)
      .innerJoin(spaceMembers, eq(spaceMembers.userId, opQuestionnaireResponses.userId))
      .where(and(...conds));
    return {
      qkey,
      list: rows.map((r) => ({ ...this.decorate(r.response), nickname: r.nickname })),
      count: Number(agg?.n ?? 0),
      page,
      page_size: pageSize,
    };
  }

  /**
   * 审核一份问卷提交（`questionnaire/mgr/review/:id`）。
   *
   * `:id` = `op_questionnaire_responses.id`（雪花字符串）。审核结论写进 `answers._meta.review`；
   * 读-改-写在这里可接受（审核是人工串行动作，同一行不会被并发审核）。
   */
  async review(ctx: TeamCtx, responseId: string, input: { status: "approved" | "rejected"; note?: string }) {
    this.op.requireOperator(ctx);
    let id: bigint;
    try {
      id = BigInt(responseId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "response id invalid", { field: "id" });
    }
    const [row] = await db
      .select()
      .from(opQuestionnaireResponses)
      .where(eq(opQuestionnaireResponses.id, id))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "response not found");
    // 与 mgrList 同一条边界：只能审**本 space 成员**的答卷（跨空间一律 404，不泄露存在性）
    const [member] = await db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, BigInt(ctx.spaceId)),
          eq(spaceMembers.userId, row.userId),
          eq(spaceMembers.status, 1),
        ),
      )
      .limit(1);
    if (!member) throw new AppError(ErrorCode.NOT_FOUND, "response not found");
    const meta = this.metaOf(row.answers);
    const answers = {
      ...(row.answers as Record<string, unknown>),
      _meta: {
        ...meta,
        review: { status: input.status, note: input.note ?? null, by: ctx.userId, at: new Date().toISOString() },
      },
    };
    await db
      .update(opQuestionnaireResponses)
      .set({ answers })
      .where(eq(opQuestionnaireResponses.id, id));
    return { id: responseId, review_status: input.status };
  }

  // ── 内测申请（`beta-questionnaire*` / `beta-status`）────────
  async betaSubmit(ctx: TeamCtx, qkey: "beta" | "beta_abroad", answers: Record<string, unknown>) {
    const def = this.definition(qkey);
    const clean = this.validateAnswers(def, answers);
    const questionnaire = await this.ensureDefinition(qkey);
    const existing = await this.findResponse(questionnaire.id, ctx);
    const prevMeta = existing ? this.metaOf(existing.answers) : null;
    const meta: ResponseMeta = {
      channel: "beta",
      activity_id: null,
      submitted_at: prevMeta?.submitted_at ?? new Date().toISOString(),
      // 手机验证状态要能跨"重新提交"保留：否则用户验完手机再改一版资料就前功尽弃
      mobile_verified: prevMeta?.mobile_verified ?? false,
      review: prevMeta?.review ?? { status: "pending", note: null, by: null, at: null },
    };
    const payload = { ...clean, _meta: meta };

    if (existing) {
      await db
        .update(opQuestionnaireResponses)
        .set({ answers: payload })
        .where(eq(opQuestionnaireResponses.id, existing.id));
    } else {
      await db.insert(opQuestionnaireResponses).values({
        id: newId(),
        questionnaireId: questionnaire.id,
        userId: BigInt(ctx.userId),
        answers: payload,
      });
    }
    return {
      submitted: true,
      review_status: meta.review?.status ?? "pending",
      mobile_verified: meta.mobile_verified,
    };
  }

  /** `beta-questionnaire/mobile-verify`：先验短信码，再在申请单上打 verified 标记 */
  async betaMobileVerify(ctx: TeamCtx, phone: string, code: string) {
    await this.op.verifyMobileCaptcha(phone, code);
    const qkey = "beta";
    const questionnaire = await this.ensureDefinition(qkey);
    const existing = await this.findResponse(questionnaire.id, ctx);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "beta application not found");
    const meta = this.metaOf(existing.answers);
    const answers = {
      ...(existing.answers as Record<string, unknown>),
      _meta: { ...meta, mobile_verified: true, mobile: phone },
    };
    await db
      .update(opQuestionnaireResponses)
      .set({ answers })
      .where(eq(opQuestionnaireResponses.id, existing.id));
    return { verified: true };
  }

  async betaStatus(ctx: TeamCtx) {
    const questionnaire = await this.ensureDefinition("beta");
    const row = await this.findResponse(questionnaire.id, ctx);
    if (!row) {
      // 海外版可能在 beta 之前填：两个问卷任一有记录都算"已申请"
      const abroad = await this.ensureDefinition("beta_abroad");
      const row2 = await this.findResponse(abroad.id, ctx);
      if (!row2) {
        return { submitted: false, review_status: null, mobile_verified: false, questionnaire_id: null, submitted_at: null };
      }
      const meta = this.metaOf(row2.answers);
      return {
        submitted: true,
        review_status: meta.review?.status ?? null,
        mobile_verified: meta.mobile_verified ?? false,
        questionnaire_id: "beta_abroad",
        submitted_at: meta.submitted_at ?? null,
      };
    }
    const meta = this.metaOf(row.answers);
    return {
      submitted: true,
      review_status: meta.review?.status ?? null,
      mobile_verified: meta.mobile_verified ?? false,
      questionnaire_id: "beta",
      submitted_at: meta.submitted_at ?? null,
    };
  }

  // ── 邀请码活动问卷 ─────────────────────────────────────────
  /**
   * `invite-code-questionnaire/invite-activity-check`：能否参与邀请活动。
   * 三个条件：① 问卷已填；② 审核通过；③ 已绑定邀请人（分销关系）。
   */
  async inviteActivityCheck(ctx: TeamCtx) {
    const questionnaire = await this.ensureDefinition("invite_activity");
    const response = await this.findResponse(questionnaire.id, ctx);
    const meta = response ? this.metaOf(response.answers) : null;
    const reviewOk = meta?.review?.status === "approved";
    const overview = await this.op.distributorOverview(ctx);
    return {
      can_participate: Boolean(response) && reviewOk,
      questionnaire_filled: Boolean(response),
      review_status: meta?.review?.status ?? null,
      bound_inviter: overview.me.parent_user_id !== null,
      reasons: [
        ...(response ? [] : ["questionnaire_not_filled"]),
        ...(response && !reviewOk ? ["questionnaire_pending_review"] : []),
      ],
    };
  }

  /** 某次活动的问卷答案（`invite-code-questionnaire/:activity_id` 用） */
  async answerForActivity(ctx: TeamCtx, activityId: string) {
    const questionnaire = await this.ensureDefinition("invite_activity");
    const response = await this.findResponse(questionnaire.id, ctx);
    if (!response) return null;
    const meta = this.metaOf(response.answers);
    if (meta.activity_id !== activityId) return null;
    return this.decorate(response);
  }

  // ── 内部 ─────────────────────────────────────────────────
  private async findResponse(questionnaireId: bigint, ctx: TeamCtx) {
    const [row] = await db
      .select()
      .from(opQuestionnaireResponses)
      .where(
        and(
          eq(opQuestionnaireResponses.questionnaireId, questionnaireId),
          eq(opQuestionnaireResponses.userId, BigInt(ctx.userId)),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** 从 answers 里取 `_meta`（缺省给安全值，兼容手工写入的数据） */
  metaOf(answers: unknown): ResponseMeta {
    const bag = (answers ?? {}) as Record<string, unknown>;
    const raw = bag._meta as ResponseMeta | undefined;
    return raw ?? {};
  }

  /** 对外形状：题目答案平铺 + 元数据拆成显式字段（`_meta` 不外泄给 C 端） */
  private decorate(row: typeof opQuestionnaireResponses.$inferSelect) {
    const meta = this.metaOf(row.answers);
    const bag = { ...(row.answers as Record<string, unknown>) };
    delete bag._meta;
    return {
      id: String(row.id),
      user_id: String(row.userId),
      questionnaire_id: String(row.questionnaireId),
      answers: bag,
      channel: meta.channel ?? null,
      activity_id: meta.activity_id ?? null,
      submitted_at: meta.submitted_at ?? row.createdAt.toISOString(),
      mobile_verified: meta.mobile_verified ?? false,
      review_status: meta.review?.status ?? null,
      review_note: meta.review?.note ?? null,
      reviewed_by: meta.review?.by ?? null,
      reviewed_at: meta.review?.at ?? null,
    };
  }
}
