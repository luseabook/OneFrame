import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode, reportResolveSchema } from "@app/shared";
import { Public } from "../../common/public.decorator";
import { clientIp } from "../../common/client-ip";
import { parseOrThrow } from "../../common/zod";
import { BillingService } from "../billing/billing.service";
import { AdminAuthService } from "./admin-auth.service";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

// 退款（api-spec §10.5）：本期仅全额退款；amount_cents 只用于声明/校验，不等于订单金额直接 400101
const refundOrderSchema = z.object({
  reason: z.string().trim().max(200).optional(),
  amount_cents: z.number().int().positive().optional(),
});

/**
 * 查询串里的空值归一。
 *
 * 为什么必须做：`?status=` 拿到的是空串，若直接 `z.coerce.number()` 会变成 0 并通过校验，
 * 于是"没筛"被静默当成"筛 status=0"（结果是空表）。统一按"没传"处理。
 */
const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

/** 雪花 id 入参（query 里是十进制字符串）：非数字直接 400101，别让 `BigInt()` 冒成 500 */
const numericIdQuery = z.preprocess(emptyToUndefined, z.string().regex(/^\d+$/, "must be numeric id").optional());

/** ISO 时间入参：非法直接 400101（契约 §2.7/§2.8），不要让它退化成"扫全表但结果为空" */
const isoDateTime = (field: string) =>
  z.string().min(1).refine((value) => Number.isFinite(Date.parse(value)), `${field} must be ISO datetime`);

/** 分页参数：`page_size ≤100`（后台表格一页 100 行足够，再大只会拖慢查询） */
const paginationQuery = {
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  page_size: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).optional()),
};

/**
 * 任务报表筛选（指标卡与失败 CSV 导出**共用同一组入参**）。
 *
 * 共用是为了让"指标卡上的数字"与"导出的 CSV 行"永远同口径——两处各写一份 schema
 * 是这类报表最常见的口径漂移来源。
 */
const taskFilterQuerySchema = z.object({
  model_id: numericIdQuery,
  from: z.preprocess(emptyToUndefined, isoDateTime("from").optional()),
  to: z.preprocess(emptyToUndefined, isoDateTime("to").optional()),
});

const modelModesMaxBytes = 32 * 1024;

/**
 * 单个 mode 的运营字段。
 *
 * `.passthrough()` 是**必须**的：别的键（`endpoint`/`counts`/`default_count`/`media_limits`…）
 * 由模型目录维护，后台只改枚举档位时不能把它们抹掉——zod 默认会裁掉未知键，那等于
 * "改一次分辨率就把 endpoint 删了"，任务投递会直接报"mode 不支持"。
 */
const modelModeConfigSchema = z
  .object({
    resolution_options: z
      .array(
        z
          .object({
            value: z.string().min(1).max(32),
            label: z.string().max(64).optional(),
          })
          .passthrough(),
      )
      .max(20)
      .optional(),
    // 按秒档的档位（1..600 秒）：超出这个范围前端滑块也选不出来，属于配错
    durations: z.array(z.number().int().min(1).max(600)).max(20).optional(),
    default_resolution: z.string().max(32).optional(),
  })
  .passthrough();

/**
 * `models.modes` 整体替换的校验（契约 §2.2）。
 *
 * 键数 1..20 / 键长 ≤64 / 体积 ≤32KB 三条是"防止后台把模型目录写坏"的底线：
 * modes 是 JSONB 且被计价链路直接读，塞进巨大对象会让每次报价都反序列化一遍。
 */
const modelModesSchema = z
  .record(z.string().min(1).max(64), modelModeConfigSchema)
  .refine((modes) => {
    const count = Object.keys(modes).length;
    return count >= 1 && count <= 20;
  }, "modes must have 1..20 keys")
  .refine(
    (modes) => Buffer.byteLength(JSON.stringify(modes), "utf8") <= modelModesMaxBytes,
    "modes payload must be <=32KB",
  );

const modelPatchSchema = z.object({
  visible: z.boolean().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  /**
   * 参数枚举热更：**整体替换** `models.modes`，不做深合并。
   *
   * 深合并只能加不能删，而运营真实动作里包含"下架某个分辨率档位"；删不掉的档位会变成
   * 永远报不出价的黑档（前端能选、后端找不到价目）。整体替换让"删档位"可表达。
   */
  modes: modelModesSchema.optional(),
});

const pricePatchSchema = z.object({
  credits: z.number().int().min(0).optional(),
  strikeCredits: z.number().int().min(0).optional(),
  memberCredits: z.number().int().min(0).nullable().optional(),
  timeLimitedCredits: z.number().int().min(0).nullable().optional(),
  /** 下架某档价目（不删行，保留可追溯性） */
  active: z.boolean().optional(),
});

/**
 * 新增价目。
 *
 * 为什么必须有写口：`PATCH` 只能改**已存在**的行。模型目录里加了新模式
 * （例如文本类 `script_optimization`）之后，如果控制台只能改不能建，
 * 运营就只能等发版/改 seed 才能上架定价——"价格后台可调、不写死"就成空话。
 * 这里只做**档位合法性**校验（mode 必须在模型目录里、resolution/duration 必须在该
 * mode 声明的档位内），金额本身完全由运营决定。
 */
const priceCreateSchema = z.object({
  model_id: z.string().min(1).max(32),
  mode: z.string().min(1).max(64),
  resolution: z.string().max(32).default(""),
  duration_s: z.number().int().min(1).max(600).nullable().optional(),
  credits: z.number().int().min(0),
  strikeCredits: z.number().int().min(0).optional(),
  memberCredits: z.number().int().min(0).nullable().optional(),
  timeLimitedCredits: z.number().int().min(0).nullable().optional(),
  /** 契约 §2.4：默认上架；"先建价、后放量"时传 false */
  active: z.boolean().optional(),
});

/**
 * 运营位四类（`promo_slots.slot`）：banner 首页横幅 / pop_up 弹窗 /
 * activity 活动入口 / creator 创作者首页卡。
 * 枚举钉在这里而不是只在 DB 里约束，是为了配错时立刻 400101 而不是"存进去但不生效"。
 */
const PROMO_SLOT_KINDS = ["banner", "pop_up", "activity", "creator"] as const;

const promoSlotBaseSchema = z.object({
  title: z.string().max(120).optional(),
  image_uri: z.string().max(1000).nullable().optional(),
  link_uri: z.string().max(1000).nullable().optional(),
  sort: z.number().int().min(-9999).max(9999).optional(),
  /** 1 启用 / 2 停用（软态，保留历史投放记录） */
  status: z.union([z.literal(1), z.literal(2)]).optional(),
  /** ISO 时间；null = 不限 */
  starts_at: z.string().max(40).nullable().optional(),
  ends_at: z.string().max(40).nullable().optional(),
});

const promoSlotCreateSchema = promoSlotBaseSchema.extend({
  slot: z.enum(PROMO_SLOT_KINDS),
});

@Controller("ops/admin")
export class AdminAuthController {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  @Public()
  @Post("login")
  async login(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(loginSchema, body);
    // 限流按真实客户端 IP：反向代理后 req.ip 是代理节点，会把所有运营算成同一个人
    return this.auth.login(input.username, input.password, clientIp(req));
  }
}

// 全局用户 AuthGuard 跳过；本控制器由 AdminGuard 独立鉴权
@Public()
@UseGuards(AdminGuard)
@Controller("ops/admin")
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /**
   * 解析任务报表筛选（指标卡 / CSV 导出共用）。
   *
   * 放在一起的原因：这两处必须**同口径**——运营从指标卡看到"某模型 37 条失败"、
   * 点导出却拿到 900 行，是最典型的报表信任崩塌。所以入参 schema 与 Date/bigint
   * 转换都只写一份（schema 见 `taskFilterQuerySchema`）。
   */
  private taskFilters(query: unknown) {
    const q = parseOrThrow(taskFilterQuerySchema, query ?? {});
    return {
      modelId: q.model_id === undefined ? undefined : BigInt(q.model_id),
      from: q.from === undefined ? undefined : new Date(q.from),
      to: q.to === undefined ? undefined : new Date(q.to),
    };
  }

  /**
   * 平台运营的创作者审核队列（模块 #10 收尾）。
   * 路径刻意放在 `ops/admin/creator-audits` 而不是复用 `/crc/*`：后者是**用户 token** 域，
   * 混用会让"谁审的"变成一笔糊涂账（两个身份域的外键不同，schema 有注释）。
   */
  @Get("creator-audits")
  creatorAudits(@Query() query: unknown) {
    const q = parseOrThrow(
      z.object({
        status: z.coerce.number().int().min(1).max(5).optional(),
        q: z.string().max(80).optional(),
        page: z.coerce.number().int().min(1).optional(),
        page_size: z.coerce.number().int().min(1).max(100).optional(),
      }),
      query ?? {},
    );
    return this.admin.creatorAudits({ status: q.status, q: q.q, page: q.page, pageSize: q.page_size });
  }

  /** 运营处置：通过 / 驳回（带理由）/ 下架；状态机与创作者域一致，不允许跳步 */
  @Post("creator-audits/:id/review")
  async reviewCreatorAudit(
    @Req() req: FastifyRequest & { adminAuth?: { adminId: string } },
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(
      z.object({
        action: z.enum(["approve", "reject", "offline"]),
        note: z.string().max(500).optional(),
      }),
      body ?? {},
    );
    // AdminAuth 的字段是 `adminId`（不是 `id`）——写错会静默变成"无管理员身份"
    const adminId = req.adminAuth?.adminId;
    if (!adminId) throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    return this.admin.reviewCreatorAudit(adminId, id, input);
  }

  /** 首页板块配置（global 层）：读当前生效配置 */
  @Get("home-config")
  homeConfig() {
    return this.admin.homeConfig();
  }

  /**
   * 首页板块配置：全量覆盖写入（乐观锁 version）。
   * 只写 global 层；space 覆盖属于团队空间运营，不在平台后台。
   */
  @Post("home-config")
  async saveHomeConfig(
    @Req() req: FastifyRequest & { adminAuth?: { adminId: string } },
    @Body() body: unknown,
  ) {
    const adminId = req.adminAuth?.adminId;
    if (!adminId) throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    const input = parseOrThrow(
      z.object({
        version: z.coerce.number().int().min(1).optional(),
        sections: z
          .array(
            z.object({
              key: z.string().min(1).max(32),
              visible: z.boolean(),
              sort: z.coerce.number().int().min(0).max(9999),
            }),
          )
          .min(1)
          .max(20),
      }),
      body ?? {},
    );
    return this.admin.saveHomeConfig(adminId, input);
  }

  @Get("dashboard")
  dashboard() {
    return this.admin.dashboard();
  }

  @Get("queues")
  queues() {
    return this.admin.queues();
  }

  /**
   * 任务指标：支持 `model_id` / `from` / `to` 筛选（契约 §2.7）。
   * 返回体结构不变，只新增 `filters` 回显，页面才能标出"当前看的是哪个口径"。
   */
  @Get("task-metrics")
  taskMetrics(@Query() query: unknown) {
    return this.admin.taskMetrics(this.taskFilters(query));
  }

  /**
   * 失败任务 CSV：与指标卡共用同一组筛选（契约 §2.8）。
   * 表头保留 `task_id,space_id,model,mode,status` 前缀，新列追加在末尾。
   */
  @Get("failed-tasks.csv")
  async failedTasksCsv(@Query() query: unknown, @Res() res: FastifyReply): Promise<void> {
    const csv = await this.admin.failedTasksCsv(this.taskFilters(query));
    res
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="failed-tasks.csv"')
      .send(csv);
  }

  @Get("funnel")
  funnel() {
    return this.admin.funnel();
  }

  @Get("reports")
  reports(@Query() query: unknown) {
    const q = parseOrThrow(
      z.object({
        // 举报状态：1 待处理 / 2 已下线 / 3 已驳回；非法值不再退化成 NaN 下传 SQL
        status: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(3).optional()),
        ...paginationQuery,
      }),
      query ?? {},
    );
    return this.admin.listReports(q.page ?? 1, q.page_size ?? 20, q.status);
  }

  @Post("reports/:id/resolve")
  resolveReport(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest & { adminAuth?: { adminId: string } },
  ) {
    const input = parseOrThrow(reportResolveSchema, body);
    return this.admin.resolveReport(id, req.adminAuth?.adminId ?? "", input.action, input.note);
  }

  @Get("models")
  models() {
    return this.admin.listModels();
  }

  @Patch("models/:id")
  updateModel(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateModel(id, parseOrThrow(modelPatchSchema, body));
  }

  /**
   * 价目列表（契约 §2.3）：新增 `active` 过滤与 `model_name`/`active`/`updated_at` 回显。
   *
   * `active` 必须能单独筛：下架的档位不删行（保留对账追溯），不筛就只能翻页找。
   */
  @Get("model-prices")
  prices(@Query() query: unknown) {
    const q = parseOrThrow(
      z.object({
        model_id: numericIdQuery,
        // 契约只允许 1/0：`?active=true` 之类写法不猜，直接 400101
        active: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1).optional()),
        ...paginationQuery,
      }),
      query ?? {},
    );
    return this.admin.listPrices({
      modelId: q.model_id,
      active: q.active === undefined ? undefined : q.active === 1,
      page: q.page,
      pageSize: q.page_size,
    });
  }

  @Patch("model-prices/:id")
  updatePrice(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updatePrice(id, parseOrThrow(pricePatchSchema, body));
  }

  /** 新增价目（模型目录里必须已有该 mode；金额由运营定） */
  @Post("model-prices")
  createPrice(@Body() body: unknown) {
    return this.admin.createPrice(parseOrThrow(priceCreateSchema, body));
  }

  /** 删除价目（用于误配档位；只想下架请用 PATCH active=false 保留追溯） */
  @Delete("model-prices/:id")
  deletePrice(@Param("id") id: string) {
    return this.admin.deletePrice(id);
  }

  /**
   * 任务列表（契约 §2.6）：`status` / `model_id` / `mode` + 分页。
   *
   * 三个筛选缺一不可：只按状态筛，运营看到的是全平台失败任务（几十页）；
   * 只按模型筛，又分不清"模型普遍慢"还是"某个 mode 的提示词有问题"。
   */
  @Get("tasks")
  tasks(@Query() query: unknown) {
    const q = parseOrThrow(
      z.object({
        status: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(7).optional()),
        model_id: numericIdQuery,
        mode: z.preprocess(emptyToUndefined, z.string().min(1).max(64).optional()),
        ...paginationQuery,
      }),
      query ?? {},
    );
    return this.admin.listTasks({
      page: q.page,
      pageSize: q.page_size,
      status: q.status,
      modelId: q.model_id,
      mode: q.mode,
    });
  }

  @Get("exports")
  exports(@Query() query: unknown) {
    // 旧实现用 Number() 直接转：`?page=abc` → NaN → SQL 报错 500；这里统一走分页 schema
    const q = parseOrThrow(z.object({ ...paginationQuery }), query ?? {});
    return this.admin.listExports(q.page ?? 1, q.page_size ?? 20);
  }

  @Get("shares")
  shares(@Query() query: unknown) {
    const q = parseOrThrow(z.object({ ...paginationQuery }), query ?? {});
    return this.admin.listShares(q.page ?? 1, q.page_size ?? 20);
  }

  @Post("shares/:id/revoke")
  revokeShare(@Param("id") id: string) {
    return this.admin.revokeShare(id);
  }

  // ── 运营位 CRUD（模块 #27 收尾）──────────────────────────────────────
  // 列表带 `active_now`（status 启用且当前时间在窗口内），运营不必自己比时间戳。

  @Get("promo-slots")
  promoSlots(@Query("slot") slot?: string, @Query("status") status?: string) {
    return this.admin.listPromoSlots({
      slot,
      status: status === undefined || status === "" ? undefined : Number(status),
    });
  }

  @Post("promo-slots")
  createPromoSlot(
    @Body() body: unknown,
    @Req() req: FastifyRequest & { adminAuth?: { adminId: string } },
  ) {
    return this.admin.createPromoSlot(
      req.adminAuth?.adminId ?? "",
      parseOrThrow(promoSlotCreateSchema, body),
    );
  }

  @Put("promo-slots/:id")
  updatePromoSlot(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updatePromoSlot(id, parseOrThrow(promoSlotBaseSchema, body));
  }

  @Delete("promo-slots/:id")
  deletePromoSlot(@Param("id") id: string) {
    return this.admin.deletePromoSlot(id);
  }

  // ── 订单 / 退款（api-spec §10.5；运营审核后操作，工单与退款记录留痕） ──

  @Get("orders")
  orders(@Query() query: unknown) {
    const q = parseOrThrow(
      z.object({
        // 订单状态：1 待支付 / 2 已支付 / 3 已关闭 / 4 已退款
        status: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(4).optional()),
        ...paginationQuery,
      }),
      query ?? {},
    );
    return this.admin.listOrders(q.page ?? 1, q.page_size ?? 20, q.status);
  }

  @Post("orders/:id/refund")
  refundOrder(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest & { adminAuth?: { adminId: string; username?: string } },
  ) {
    const input = parseOrThrow(refundOrderSchema, body ?? {});
    return this.billing.refundOrder({
      orderId: id,
      reason: input.reason,
      amountCents: input.amount_cents,
      operator: req.adminAuth?.username ?? req.adminAuth?.adminId,
    });
  }
}
