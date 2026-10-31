import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import type { AdminAuth } from "./admin-auth.service";
import { AdminAiLabelService } from "./admin-ai-label.service";
import { AdminCommunityService } from "./admin-community.service";
import { AdminGuard } from "./admin.guard";
import { emptyToUndefined, isoTimeSchema } from "./admin-ops.controller";

/** `AdminGuard` 把管理员身份挂在请求上（`admin.guard.ts`） */
type AdminRequest = FastifyRequest & { adminAuth?: AdminAuth };

/** 用户状态：1 正常 / 2 封禁（`users.status`） */
const userStatusSchema = z.coerce.number().int().min(1).max(2);

const usersQuerySchema = z.object({
  /** 昵称 / 用户 id / 11 位手机号（三态，见 service 注释） */
  q: z.preprocess(emptyToUndefined, z.string().trim().max(64).optional()),
  status: z.preprocess(emptyToUndefined, userStatusSchema.optional()),
  /** 0 未注销 / 1 已注销，不传=全部 */
  deleted: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1).optional()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  page_size: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).optional()),
});

/** 用户状态是**必填**：PUT 语义的 PATCH 缺省值会让"漏字段"变成一次静默的解封/封禁 */
const userStatusPatchSchema = z.object({ status: userStatusSchema });

const userRestoreSchema = z.object({
  // 空串按"没传"处理（前端不填昵称时直接传 {}）：把昵称写成空串比保持匿名更难辨认
  nickname: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(64).optional()),
});

const waitlistQuerySchema = z.object({
  /** 1 已邀请 / 0 未邀请，不传=全部 */
  invited: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1).optional()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  page_size: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).optional()),
});

const inviteCodesQuerySchema = z.object({
  /** 1 有效 / 2 停用 / 3 耗尽（3 由 used_count>=max_uses 派生） */
  status: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(3).optional()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  page_size: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).optional()),
});

const createInviteCodesSchema = z.object({
  credits: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(100000).optional()),
  max_uses: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(1000).optional()),
  /** ISO 字符串；不传或 null 都是"永不过期" */
  expires_at: z.preprocess(emptyToUndefined, isoTimeSchema.optional()),
  /** 批量生成条数：上限 50，一次发码超过 50 条通常意味着该走别的分发方式 */
  count: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(50).optional()),
});

const inviteCodeStatusPatchSchema = z.object({ status: z.coerce.number().int().min(1).max(2) });

const aiLabelQuerySchema = z.object({
  from: z.preprocess(emptyToUndefined, isoTimeSchema.optional()),
  to: z.preprocess(emptyToUndefined, isoTimeSchema.optional()),
  /** 1 = 只看没有 ai_label 的任务（运营最常问的"谁漏标了"） */
  only_missing: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1).optional()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  page_size: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).optional()),
});

const aiLabelCsvQuerySchema = z.object({
  from: z.preprocess(emptyToUndefined, isoTimeSchema.optional()),
  to: z.preprocess(emptyToUndefined, isoTimeSchema.optional()),
  only_missing: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1).optional()),
});

/**
 * P2 社区/用户面运营端点（契约 §2.1–§2.3）：用户管理 / 等待名单 / 邀请码。
 *
 * 鉴权模型沿用 P0/P1：`@Public()` 跳过用户域全局 `AuthGuard`，再由 `AdminGuard`
 * 做管理员独立鉴权（无凭证 401101、非管理员 token 403101、viewer 写 403101）。
 * 因此这里**不再**自己判角色：读接口 viewer 可用，写接口 viewer 由 guard 拦掉，
 * 只有"仅 super"的动作才需要额外判断（本文件没有这类动作）。
 */
@Public()
@UseGuards(AdminGuard)
@Controller("ops/admin")
export class AdminCommunityController {
  constructor(@Inject(AdminCommunityService) private readonly community: AdminCommunityService) {}

  // ── 用户 ──────────────────────────────────────────────────

  @Get("users")
  listUsers(@Query() query: unknown) {
    const q = parseOrThrow(usersQuerySchema, query ?? {});
    return this.community.listUsers({
      q: q.q,
      status: q.status,
      deleted: q.deleted,
      page: q.page,
      pageSize: q.page_size,
    });
  }

  @Patch("users/:id")
  updateUser(@Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(userStatusPatchSchema, body ?? {});
    return this.community.updateUserStatus(id, input.status);
  }

  @Post("users/:id/restore")
  restoreUser(@Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(userRestoreSchema, body ?? {});
    return this.community.restoreUser(id, { nickname: input.nickname });
  }

  // ── 等待名单 ──────────────────────────────────────────────

  @Get("waitlist")
  listWaitlist(@Query() query: unknown) {
    const q = parseOrThrow(waitlistQuerySchema, query ?? {});
    return this.community.listWaitlist({ invited: q.invited, page: q.page, pageSize: q.page_size });
  }

  @Post("waitlist/:id/invite")
  inviteWaitlist(@Param("id") id: string) {
    return this.community.inviteWaitlistEntry(id);
  }

  // ── 邀请码 ────────────────────────────────────────────────

  @Get("invite-codes")
  listInviteCodes(@Query() query: unknown) {
    const q = parseOrThrow(inviteCodesQuerySchema, query ?? {});
    return this.community.listInviteCodes({ status: q.status, page: q.page, pageSize: q.page_size });
  }

  @Post("invite-codes")
  createInviteCodes(@Req() req: AdminRequest, @Body() body: unknown) {
    const input = parseOrThrow(createInviteCodesSchema, body ?? {});
    return this.community.createInviteCodes({
      // 默认值放在这里而不是 zod default：调用点一眼能看到"没填会变成什么"
      credits: input.credits ?? 0,
      maxUses: input.max_uses ?? 1,
      expiresAt: input.expires_at ? new Date(input.expires_at) : null,
      count: input.count ?? 1,
      adminId: req.adminAuth?.adminId,
    });
  }

  @Patch("invite-codes/:id")
  updateInviteCode(@Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(inviteCodeStatusPatchSchema, body ?? {});
    return this.community.updateInviteCodeStatus(id, input.status);
  }
}

/**
 * AI 标识审计（契约 §2.4）：只读 + CSV 导出。
 *
 * 为什么和上面放同一个文件：两者都是 P2 新增的"数据面"端点，共用同一套
 * 查询参数解析与鉴权声明；再拆一个文件只会多一份 import，收益为零。
 * 但服务是独立的（`AdminAiLabelService`），因为它读的是 `tasks/results`，
 * 与用户/邀请码那几张表没有任何共同过滤逻辑。
 */
@Public()
@UseGuards(AdminGuard)
@Controller("ops/admin")
export class AdminAiLabelController {
  constructor(@Inject(AdminAiLabelService) private readonly aiLabels: AdminAiLabelService) {}

  @Get("ai-labels")
  list(@Query() query: unknown) {
    const q = parseOrThrow(aiLabelQuerySchema, query ?? {});
    return this.aiLabels.list({
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      onlyMissing: q.only_missing === 1,
      page: q.page,
      pageSize: q.page_size,
    });
  }

  @Get("ai-labels.csv")
  async csv(@Query() query: unknown, @Res() res: FastifyReply): Promise<void> {
    const q = parseOrThrow(aiLabelCsvQuerySchema, query ?? {});
    const csv = await this.aiLabels.exportCsv({
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      onlyMissing: q.only_missing === 1,
    });
    res
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="ai-labels.csv"')
      .send(csv);
  }
}
