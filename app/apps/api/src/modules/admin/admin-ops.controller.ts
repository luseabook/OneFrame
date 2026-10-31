import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { orders } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import { db } from "../../db/database";
import { AdminAccountsService } from "./admin-accounts.service";
import { AdminAuditService } from "./admin-audit.service";
import { AdminConfigService } from "./admin-config.service";
import type { AdminAuth } from "./admin-auth.service";
import { AdminGuard } from "./admin.guard";

/** `AdminGuard` 把管理员身份挂在请求上（`admin.guard.ts`） */
type AdminRequest = FastifyRequest & { adminAuth?: AdminAuth };

/**
 * 后台列表的筛选参数普遍来自输入框，空串（`?action=`）在语义上是"不筛这个字段"。
 * 统一把空串预处理成 undefined，避免 `z.coerce.number()` 把 `""` 变成 0 后报"非法分页"。
 */
export const emptyToUndefined = (value: unknown): unknown => (value === "" || value === null ? undefined : value);

/**
 * ISO 时间参数。
 *
 * 导出给 `admin-community.controller.ts` 复用：分页/时间参数的解析口径必须**只有一份**，
 * 否则 ai-labels 与 audit-logs 对同一个非法时间会给出不同的错误语义。
 */
export const isoTimeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "invalid ISO datetime");

const roleSchema = z.enum(["super", "ops", "viewer"]);
/** 密码下限 8 位：后台账号能改价/退款，弱口令等于把运营面直接暴露 */
const passwordSchema = z.string().min(8, "password must be at least 8 characters").max(128);

const createAdminSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: passwordSchema,
  role: roleSchema.default("ops"),
});

const patchAdminSchema = z.object({
  role: roleSchema.optional(),
  /** 1 启用 / 2 停用（物理删除会让审计外键悬空，见 service 注释） */
  status: z.union([z.literal(1), z.literal(2)]).optional(),
  password: passwordSchema.optional(),
});

/**
 * 审计过滤条件（列表与 CSV 共用一份 schema）。
 *
 * 为什么把过滤与分页拆开：`GET audit-logs.csv` 的合同里**没有**分页
 * （导出是"当前过滤条件下的全部，最多 5000 行"）。若两个端点共用带分页的 schema，
 * 前端传 `page=2` 到 CSV 也不会报错，但语义上是个假参数——导出会静默忽略它。
 */
const auditFiltersSchema = z.object({
  admin_id: z.preprocess(emptyToUndefined, z.string().trim().regex(/^\d{1,20}$/, "invalid admin_id").optional()),
  action: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  from: z.preprocess(emptyToUndefined, isoTimeSchema.optional()),
  to: z.preprocess(emptyToUndefined, isoTimeSchema.optional()),
});

const auditLogsQuerySchema = auditFiltersSchema.extend({
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  page_size: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).optional()),
});

/**
 * 配置列表的筛选/分页（契约 §2.5）。
 *
 * `module` 精确、`q` 对 `key` 模糊：运营排查时通常记得模块名和半个 key，
 * 两个维度拼起来才能把"几百条配置"缩到能看的一屏。
 */
const configsQuerySchema = z.object({
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  page_size: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).optional()),
  /**
   * `module` 与删除端点同口径：`?module=` 是"默认域（module=''）"，不传才是"不筛"。
   * 这里一旦套 `emptyToUndefined`，默认域的行就永远筛不出来（它们占配置表的大多数）。
   */
  module: z.string().trim().max(64).optional(),
  q: z.preprocess(emptyToUndefined, z.string().trim().max(64).optional()),
});

/** 配置 key：1..64 且不含空白（含空白会让 URL/前端引用出现歧义） */
const configKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !/\s/.test(value), "config key must not contain whitespace");

const MAX_CONFIG_VALUE_BYTES = 64 * 1024;

const configPutSchema = z
  .object({
    // value 可以是任意 JSON（对象/数组/字符串/数字/null），所以用 unknown + 手工校验
    value: z.unknown(),
    module: z.string().trim().max(64).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((input, ctx) => {
    /**
     * 拒绝 `undefined` 与 `null`：`app_configs.value` 是 `jsonb NOT NULL`，
     * 而 drizzle 会把 JS `null` 写成 SQL NULL（不是 JSON `null`），插入必然违反非空约束 → 500。
     * "清空一个配置"的正确语义是 DELETE，而不是写 null，所以这里直接 400101 并给出提示。
     */
    if (input.value === undefined || input.value === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "value is required (use DELETE to remove a config)",
        path: ["value"],
      });
      return;
    }
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(input.value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value must be JSON serializable", path: ["value"] });
      return;
    }
    if (serialized === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value must be JSON serializable", path: ["value"] });
      return;
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_CONFIG_VALUE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `value must be <=${MAX_CONFIG_VALUE_BYTES / 1024}KB JSON`,
        path: ["value"],
      });
    }
  });

/**
 * 删除配置的可选寻址。
 *
 * 这里**不能**用 `emptyToUndefined`：`?module=` 表示"默认域（module=''）那一行"，
 * `?module=home@en` 表示该语言行，完全不传才是"删这个 key 的所有行"。
 * 把空串折叠成 undefined 会让"只删默认值"变成"把所有语言版本一起删"——正是要防的误删。
 */
const configDeleteQuerySchema = z.object({
  module: z.string().trim().max(64).optional(),
});

const publicConfigQuerySchema = z.object({
  module: z.preprocess(emptyToUndefined, z.string().trim().max(64).optional()),
  lang: z.preprocess(emptyToUndefined, z.string().trim().max(16).optional()),
});

const ordersQuerySchema = z.object({
  /** 1 待支付 / 2 已支付 / 3 已关闭 / 4 已退款（`orders.status`） */
  status: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(4).optional()),
  from: z.preprocess(emptyToUndefined, isoTimeSchema.optional()),
  to: z.preprocess(emptyToUndefined, isoTimeSchema.optional()),
});

/** 对账单导出行数上限：一次导出 5 万行会让 CSV 变成大对象并拖慢 API 事件循环 */
const ORDER_CSV_LIMIT = 5000;

/**
 * 订单对账 CSV（契约 §3.6）。
 *
 * 为什么把查询放在控制器而不是 service：财务口径（列顺序/列名）本身就是这个端点的合同，
 * 与页面一一对应；放进 admin-accounts/config 这类语义无关的 service 反而更难追踪。
 * 列顺序不能改：退款对账脚本按位置消费，改顺序等于静默产错账。
 */
async function buildOrdersCsv(filters: { status?: number; from?: Date; to?: Date }): Promise<string> {
  const conds = [];
  if (filters.status !== undefined) conds.push(eq(orders.status, filters.status));
  if (filters.from) conds.push(gte(orders.createdAt, filters.from));
  if (filters.to) conds.push(lte(orders.createdAt, filters.to));

  const rows = await db
    .select()
    .from(orders)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(ORDER_CSV_LIMIT);

  // CSV 转义：含逗号/引号/换行的字段必须整体加引号，内部引号双写（RFC 4180）
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = [
    "order_id",
    "space_id",
    "user_id",
    "sku",
    "amount_cents",
    "credits",
    "channel",
    "status",
    "paid_at",
    "refund_no",
    "refund_status",
    "refund_amount_cents",
    "refunded_at",
    "refund_reason",
    "refund_operator",
    "created_at",
  ].join(",");

  const lines = rows.map((row) =>
    [
      String(row.id),
      String(row.spaceId),
      String(row.userId),
      escape(row.sku),
      row.amountCents,
      row.credits,
      escape(row.channel),
      row.status,
      row.paidAt ? row.paidAt.toISOString() : "",
      escape(row.refundNo),
      escape(row.refundStatus),
      row.refundAmountCents ?? "",
      row.refundedAt ? row.refundedAt.toISOString() : "",
      escape(row.refundReason),
      escape(row.refundOperator),
      row.createdAt.toISOString(),
    ].join(","),
  );

  return `${header}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

/** 管理员 CRUD 只允许 super：账号权限本身是最高危操作，ops 能自建 super 就等于没有权限模型 */
function requireSuper(req: AdminRequest): AdminAuth {
  const admin = req.adminAuth;
  if (!admin) throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
  if (admin.role !== "super") throw new AppError(ErrorCode.FORBIDDEN, "super admin only");
  return admin;
}

/**
 * P1 运营后台：管理员账号 / 操作审计 / 配置中心 / 订单对账导出（契约 §3）。
 *
 * 与 `AdminController`（api-core 维护）同一前缀 `/ops/admin`，但**不同控制器**：
 * 两边并行施工，物理分文件避免互相覆盖。路由本身不冲突（这里只有 admins/audit-logs/configs/orders.csv）。
 *
 * 鉴权模型与既有 ops 控制器一致：`@Public()` 跳过用户域全局 `AuthGuard`，
 * 再由 `AdminGuard` 做管理员独立鉴权（无凭证 401101、普通用户 token 403101、viewer 写 403101）。
 */
@Public()
@UseGuards(AdminGuard)
@Controller("ops/admin")
export class AdminOpsController {
  constructor(
    @Inject(AdminAccountsService) private readonly accounts: AdminAccountsService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
    @Inject(AdminConfigService) private readonly configs: AdminConfigService,
  ) {}

  // ── 管理员账号（仅 super）────────────────────────────────────────

  @Get("admins")
  listAdmins(@Req() req: AdminRequest) {
    requireSuper(req);
    return this.accounts.list();
  }

  @Post("admins")
  createAdmin(@Req() req: AdminRequest, @Body() body: unknown) {
    requireSuper(req);
    return this.accounts.create(parseOrThrow(createAdminSchema, body));
  }

  @Patch("admins/:id")
  updateAdmin(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: unknown) {
    const admin = requireSuper(req);
    return this.accounts.update(admin.adminId, id, parseOrThrow(patchAdminSchema, body));
  }

  // ── 操作审计（所有管理员可读；写入口是全局拦截器）──────────────────

  @Get("audit-logs")
  auditLogs(@Query() query: unknown) {
    const q = parseOrThrow(auditLogsQuerySchema, query ?? {});
    return this.audit.list({
      page: q.page,
      pageSize: q.page_size,
      adminId: q.admin_id,
      action: q.action,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
  }

  /**
   * 审计日志 CSV（契约 §2.6）。
   *
   * 与 `GET audit-logs` 同过滤口径（调的是同一个 `exportCsv`，内部复用 where 构造），
   * 这样"看到 3 条、导出 5 条"这种口径分叉不可能发生。行数上限 5000：
   * 审计导出是给合规/排查留证的，不是全量备份；再大就应该走数据库导出。
   */
  @Get("audit-logs.csv")
  async auditLogsCsv(@Query() query: unknown, @Res() res: FastifyReply): Promise<void> {
    const q = parseOrThrow(auditFiltersSchema, query ?? {});
    const csv = await this.audit.exportCsv({
      adminId: q.admin_id,
      action: q.action,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
    res
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="audit-logs.csv"')
      .send(csv);
  }

  // ── 配置中心（viewer 只读由 guard 兜住）──────────────────────────

  @Get("configs")
  listConfigs(@Query() query: unknown) {
    const q = parseOrThrow(configsQuerySchema, query ?? {});
    return this.configs.list({
      page: q.page,
      pageSize: q.page_size,
      module: q.module,
      q: q.q,
    });
  }

  @Put("config/:key")
  putConfig(@Req() req: AdminRequest, @Param("key") key: string, @Body() body: unknown) {
    const parsedKey = parseOrThrow(configKeySchema, key);
    const input = parseOrThrow(configPutSchema, body ?? {});
    // z.unknown() 在类型推导上会让 value 变成可选（它接受 undefined），
    // 这里显式取值：superRefine 已保证 value 一定存在，展开写也让"存了什么"一眼可见。
    return this.configs.upsert(
      parsedKey,
      { value: input.value, module: input.module, description: input.description },
      req.adminAuth?.adminId,
    );
  }

  /**
   * 删除一行配置：`?module=home@en` 只删该语言行，`?module=` 只删默认域，
   * 不带查询参数才删整个 key（批量清理）。
   */
  @Delete("config/:key")
  deleteConfig(@Param("key") key: string, @Query() query: unknown) {
    const parsedKey = parseOrThrow(configKeySchema, key);
    const q = parseOrThrow(configDeleteQuerySchema, query ?? {});
    return this.configs.remove(parsedKey, q.module);
  }

  // ── 订单对账导出 ────────────────────────────────────────────────

  @Get("orders.csv")
  async ordersCsv(@Query() query: unknown, @Res() res: FastifyReply): Promise<void> {
    const q = parseOrThrow(ordersQuerySchema, query ?? {});
    const csv = await buildOrdersCsv({
      status: q.status,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
    res
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="orders.csv"')
      .send(csv);
  }
}

/**
 * 公开配置读取（契约 §3.5）：`GET /ops/config/:key?module=&lang=`。
 *
 * 为什么公开：这些配置是**前端渲染要用的**（首页文案、功能开关），调用方是未登录用户，
 * 不能要求管理员凭证。因此这里只暴露"按键读一个值"，绝不提供列表/通配，
 * 避免把整个配置中心变成公开可枚举的接口。
 */
@Public()
@Controller("ops")
export class OpsConfigController {
  constructor(@Inject(AdminConfigService) private readonly configs: AdminConfigService) {}

  @Get("config/:key")
  readConfig(@Param("key") key: string, @Query() query: unknown) {
    const parsedKey = parseOrThrow(configKeySchema, key);
    const q = parseOrThrow(publicConfigQuerySchema, query ?? {});
    return this.configs.resolve(parsedKey, { module: q.module, lang: q.lang });
  }
}
