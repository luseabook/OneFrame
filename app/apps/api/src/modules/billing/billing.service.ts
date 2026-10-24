import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  CreditAccountMissingError,
  InsufficientBalanceError,
  creditIn,
  creditOut,
  lockCreditAccount,
  orders,
  skus,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { randomBytes } from "node:crypto";
import { env } from "../../config/env";
import { db } from "../../db/database";
import { ChannelService } from "./channels/channel.service";
import { isChannelError } from "./channels/errors";
import type { PaymentChannelId, PaymentMode } from "./channels/types";

const OrderStatus = {
  PENDING: 1,
  PAID: 2,
  CLOSED: 3,
  REFUNDED: 4,
} as const;

/**
 * 渠道退款状态 → 本地 refund_status（processing|succeeded）。
 * 微信退款返回 SUCCESS/PROCESSING/ABNORMAL，支付宝返回 fund_change=Y/N；
 * 渠道未给出状态时保守记为 processing，等对账任务/人工确认后置为 succeeded。
 */
export function mapChannelRefundStatus(status: string | undefined): "processing" | "succeeded" {
  if (!status) return "processing";
  const normalized = status.trim().toUpperCase();
  if (normalized === "SUCCESS" || normalized === "SUCCEEDED" || normalized === "Y") return "succeeded";
  return "processing";
}

export interface CreateOrderInput {
  sku: string;
  channel: "wechat" | "alipay" | "mock";
  /** 可选支付形态（微信 native/h5/jsapi，支付宝 page/precreate），不传用渠道默认 */
  mode?: PaymentMode;
  /** H5 支付需要的用户端 IP（由 controller 从请求取） */
  clientIp?: string;
  /** 微信 JSAPI 支付需要的 openid（小程序/公众号内打开时由前端传入） */
  openid?: string;
}

/** 订单 DTO（前端契约，api-spec §10） */
export interface OrderDto {
  order_id: string;
  sku: string;
  amount_cents: number;
  credits: number;
  channel: string;
  status: number;
  status_label: string;
  pay_token: string | null;
  pay_params: Record<string, unknown> | null;
  paid_at: string | null;
  created_at: string;
  expires_at: string;
  /** 退款（api-spec §10.5）：仅 status=4 时有值 */
  refund_no: string | null;
  refund_status: string | null;
  refund_amount_cents: number | null;
  refunded_at: string | null;
  refund_reason: string | null;
}

export interface RefundOrderInput {
  orderId: string;
  /** 操作原因（工单号/申诉说明）；写入订单与流水 memo 供审计 */
  reason?: string;
  /** 操作人（管理端 username） */
  operator?: string;
  /** 可选：仅允许全额，传入且不等于订单金额时 400101（部分退款本期不支持） */
  amountCents?: number;
}

export interface RefundOrderResult {
  order_id: string;
  status: number;
  status_label: string;
  refund_no: string | null;
  refund_status: string | null;
  refund_amount_cents: number | null;
  refunded_at: string | null;
  /** 幂等：重复退款直接返回（未重复调渠道、未重复冲正） */
  idempotent: boolean;
  /** 渠道侧退款单号（微信 refund_id / 支付宝 trade_no），仅本次调用返回 */
  channel_refund_id?: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger("billing");

  // 显式 @Inject：esbuild/vitest 不做 emitDecoratorMetadata，纯类型注入会拿到 undefined
  constructor(@Inject(ChannelService) private readonly channels: ChannelService) {}

  /** SKU 目录（PRD §10）：只返回上架且有货的 */
  async listSkus() {
    const rows = await db
      .select()
      .from(skus)
      .where(eq(skus.active, true))
      .orderBy(skus.priceCents);
    return rows.map((r) => ({
      id: String(r.id),
      sku: r.sku,
      kind: r.kind,
      label: r.label,
      price_cents: r.priceCents,
      credits: r.credits,
      period: r.period,
      /** 单位积分价格（分），便于前端展示"每积分多少钱" */
      cents_per_credit: r.credits > 0 ? Math.round((r.priceCents / r.credits) * 100) / 100 : null,
    }));
  }

  /** 前端可用渠道（PAYMENT_LIVE + 凭据是否齐全），公开端点 */
  listChannels() {
    return { live: env.PAYMENT_LIVE, channels: this.channels.available() };
  }

  /**
   * 下单：快照金额与积分，真实渠道走适配器下单并把支付参数持久化（pay_params）。
   * 幂等：同一用户 60s 内对同一 sku + 同一渠道的未支付订单直接复用，避免重复下单。
   */
  async createOrder(spaceId: string, userId: string, input: CreateOrderInput) {
    const [sku] = await db.select().from(skus).where(eq(skus.sku, input.sku));
    if (!sku || !sku.active) {
      throw new AppError(ErrorCode.NOT_FOUND, "sku not found or inactive", { field: "sku" });
    }

    const channel = input.channel;
    if (channel !== "mock") {
      // 未开启真实支付 or 渠道凭据不全 → 明确拒绝，绝不静默降级成 mock
      if (!env.PAYMENT_LIVE) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          "payment channel not configured (PAYMENT_LIVE=false)；当前仅支持 mock 渠道用于联调",
          { field: "channel" },
        );
      }
      if (!this.channels.isConfigured(channel)) {
        throw new AppError(ErrorCode.INVALID_PARAM, `payment channel "${channel}" not configured`, {
          field: "channel",
          channel,
        });
      }
      const allowed = this.channels.get(channel).modes;
      if (input.mode && !allowed.includes(input.mode)) {
        throw new AppError(ErrorCode.INVALID_PARAM, `payment mode "${input.mode}" is not supported by ${channel}`, {
          field: "mode",
          allowed,
        });
      }
    } else if (env.PAYMENT_LIVE) {
      throw new AppError(ErrorCode.INVALID_PARAM, "mock channel disabled when PAYMENT_LIVE=true", {
        field: "channel",
      });
    }

    // 60s 内同 sku + 同渠道未支付订单复用（防止双击重复下单）
    const [recent] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.spaceId, BigInt(spaceId)),
          eq(orders.sku, input.sku),
          eq(orders.channel, channel),
          eq(orders.status, OrderStatus.PENDING),
          sql`${orders.createdAt} > now() - interval '60 seconds'`,
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    if (recent) {
      // 真实渠道订单若尚未拿到支付参数（上次下单失败/旧数据），补齐后再返回
      if (channel !== "mock" && !recent.payParams) {
        return this.attachPayParams(recent, input);
      }
      return this.toOrderDto(recent);
    }

    const orderId = newId();
    const payToken = randomBytes(18).toString("base64url");
    await db.insert(orders).values({
      id: orderId,
      spaceId: BigInt(spaceId),
      userId: BigInt(userId),
      skuId: sku.id,
      sku: sku.sku,
      amountCents: sku.priceCents,
      credits: sku.credits,
      channel,
      status: OrderStatus.PENDING,
      payToken,
    });

    if (channel === "mock") {
      const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
      return this.toOrderDto(row);
    }

    // 真实渠道下单：失败时订单不得停留在可支付状态（置为已关闭并抛明确错误）
    try {
      const created = await this.channels.get(channel).createPayment({
        outTradeNo: String(orderId),
        amountCents: sku.priceCents,
        description: `一帧 ${sku.label}`,
        clientIp: input.clientIp,
        openid: input.openid,
        mode: input.mode,
        expireSeconds: env.ORDER_TTL_S,
      });
      await db
        .update(orders)
        .set({ payParams: created.payParams, updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
      return this.toOrderDto(row);
    } catch (err) {
      await db
        .update(orders)
        .set({ status: OrderStatus.CLOSED, closedAt: new Date(), updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      this.logger.warn(`channel ${channel} create payment failed for order ${orderId}: ${String(err)}`);
      throw this.toChannelAppError(err, channel);
    }
  }

  /** 给复用的未支付订单补支付参数（渠道幂等：同一 out_trade_no 重复下单是安全的） */
  private async attachPayParams(row: typeof orders.$inferSelect, input: CreateOrderInput): Promise<OrderDto> {
    const channel = row.channel as PaymentChannelId;
    try {
      const created = await this.channels.get(channel).createPayment({
        outTradeNo: String(row.id),
        amountCents: row.amountCents,
        description: `一帧 ${row.sku}`,
        clientIp: input.clientIp,
        openid: input.openid,
        mode: input.mode,
        expireSeconds: env.ORDER_TTL_S,
      });
      await db
        .update(orders)
        .set({ payParams: created.payParams, updatedAt: new Date() })
        .where(eq(orders.id, row.id));
      return this.toOrderDto({ ...row, payParams: created.payParams });
    } catch (err) {
      throw this.toChannelAppError(err, channel);
    }
  }

  private toChannelAppError(err: unknown, channel: string, action: "下单" | "退款" = "下单"): AppError {
    if (isChannelError(err)) {
      const code =
        err.code === "CHANNEL_TIMEOUT"
          ? ErrorCode.VENDOR_TIMEOUT
          : err.code === "CHANNEL_INVALID_REQUEST" || err.code === "CHANNEL_NOT_CONFIGURED"
            ? ErrorCode.INVALID_PARAM
            : ErrorCode.VENDOR_ERROR;
      // 只透出渠道 code/message，绝不透出报文原文或凭据
      return new AppError(code, `${channel} 渠道${action}失败：${err.message}`, {
        channel,
        channel_code: err.code,
        vendor_code: err.vendorCode ?? null,
        retryable: err.retryable,
      });
    }
    return new AppError(ErrorCode.VENDOR_ERROR, `${channel} 渠道${action}失败`, { channel });
  }

  /** 前端轮询订单状态（≤3min 由前端控制） */
  async getOrder(spaceId: string, orderId: string) {
    const [row] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, BigInt(orderId)), eq(orders.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "order not found");
    return this.toOrderDto(row);
  }

  /**
   * 支付成功入账（渠道回调 / mock 确认共用）。
   *
   * 幂等三重保证：
   * 1) 只有 status=1（待支付）才会流转到 2，重复回调直接返回当前状态；
   * 2) 行级锁 SELECT ... FOR UPDATE 防并发双写；
   * 3) credit_flows.refOrderId 唯一性由业务保证（同一订单只入账一次）。
   */
  async markPaid(params: {
    orderId?: string;
    channel: string;
    channelOrderId: string;
    amountCents?: number;
  }): Promise<{ orderId: string; credited: boolean; credits: number }> {
    return db.transaction(async (tx) => {
      const where = params.orderId
        ? and(eq(orders.id, BigInt(params.orderId)), eq(orders.channel, params.channel))
        : and(eq(orders.channel, params.channel), eq(orders.channelOrderId, params.channelOrderId));
      const [row] = await tx.select().from(orders).where(where).for("update").limit(1);
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "order not found");

      // 金额校验：渠道回调金额必须与下单快照一致，否则拒绝入账（防篡改）
      if (params.amountCents !== undefined && params.amountCents !== row.amountCents) {
        throw new AppError(ErrorCode.INVALID_PARAM, "amount mismatch", {
          expected: row.amountCents,
          got: params.amountCents,
        });
      }
      if (row.status === OrderStatus.PAID) {
        return { orderId: String(row.id), credited: false, credits: row.credits };
      }
      if (row.status !== OrderStatus.PENDING) {
        throw new AppError(ErrorCode.INVALID_PARAM, `order not payable (status=${row.status})`);
      }

      await tx
        .update(orders)
        .set({
          status: OrderStatus.PAID,
          paidAt: new Date(),
          channelOrderId: params.channelOrderId,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, row.id));

      await creditIn(tx, {
        spaceId: row.spaceId,
        amount: row.credits,
        kind: "recharge",
        orderId: row.id,
        memo: `recharge ${row.sku}`,
      });

      return { orderId: String(row.id), credited: true, credits: row.credits };
    });
  }

  /**
   * 关闭未支付订单（超时/用户取消）。
   * 真实渠道订单本地关闭后，异步关单渠道侧（best-effort：渠道侧关单失败不能让用户关不掉单）。
   */
  async closeOrder(spaceId: string, orderId: string) {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, BigInt(orderId)), eq(orders.spaceId, BigInt(spaceId))))
        .for("update");
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "order not found");
      if (row.status !== OrderStatus.PENDING) {
        return { id: String(row.id), status: row.status, closed: false, channel: row.channel };
      }
      await tx
        .update(orders)
        .set({ status: OrderStatus.CLOSED, closedAt: new Date(), updatedAt: new Date() })
        .where(eq(orders.id, row.id));
      return { id: String(row.id), status: OrderStatus.CLOSED, closed: true, channel: row.channel };
    });

    if (result.closed && result.channel !== "mock" && this.channels.isConfigured(result.channel as PaymentChannelId)) {
      try {
        await this.channels.get(result.channel as PaymentChannelId).close(result.id);
      } catch (err) {
        this.logger.warn(`channel ${result.channel} close order ${result.id} failed (ignored): ${String(err)}`);
      }
    }
    return { id: result.id, status: result.status, closed: result.closed };
  }

  /**
   * 全额退款（api-spec §10.5 / E3 未成年人误充口径）。
   *
   * 安全与一致性约束：
   * 1) 事务 + `SELECT ... FOR UPDATE`：同一订单的并发退款被行锁串行化；
   * 2) 仅 status=2（已支付）可退；status=4 直接幂等返回（不重复冲正、不重复调渠道）；
   * 3) 本期只支持全额退款；传入金额不等于订单金额 → 400101；
   * 4) **先锁积分账户并校验余额**，余额不足直接拒绝（避免负余额破坏 `balance == Σdelta`）；
   * 5) 渠道退款在事务内调用：失败则整事务回滚 → 订单保持已支付、积分不动（不允许"本地已退、钱没退"）；
   * 6) 幂等退款单号固定 `rf-{orderId}`，渠道侧可据此去重。
   *
   * 说明：退款由管理端低频率触发，事务内跨渠道 HTTP 调用换取的是"失败即回滚"的强一致，
   * 代价是持有订单/账户行锁数秒（退款单量小，可接受）；渠道异步处理中（PROCESSING）订单落 status=4 + refund_status=processing。
   */
  async refundOrder(input: RefundOrderInput): Promise<RefundOrderResult> {
    let orderBigId: bigint;
    try {
      orderBigId = BigInt(input.orderId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid order id", { field: "order_id" });
    }

    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(orders).where(eq(orders.id, orderBigId)).for("update");
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "order not found");

      // 已退款：幂等返回当前退款状态（不重复扣积分、不重复调渠道）
      if (row.status === OrderStatus.REFUNDED) {
        return { row, idempotent: true as const, channelRefundId: undefined };
      }
      if (row.status !== OrderStatus.PAID) {
        throw new AppError(ErrorCode.INVALID_PARAM, `order not refundable (status=${row.status})`, {
          order_id: String(row.id),
          status: row.status,
        });
      }
      if (input.amountCents !== undefined && input.amountCents !== row.amountCents) {
        throw new AppError(ErrorCode.INVALID_PARAM, "partial refund is not supported; amount must equal order amount", {
          field: "amount_cents",
          order_amount_cents: row.amountCents,
          requested_amount_cents: input.amountCents,
        });
      }

      // 先锁账户并校验余额：余额不足必须"在调渠道之前"拒绝，否则会出现退款成功但积分扣不动的不可逆不一致
      let accountBalance: number;
      try {
        const account = await lockCreditAccount(tx, row.spaceId);
        accountBalance = account.balance;
      } catch (err) {
        if (err instanceof CreditAccountMissingError) {
          throw new AppError(ErrorCode.INVALID_PARAM, "credit account missing; manual handling required", {
            order_id: String(row.id),
            space_id: String(row.spaceId),
          });
        }
        throw err;
      }
      if (accountBalance < row.credits) {
        // 错误 message 里显式给出 balance/credits：信封响应不带 details，运营需要一眼看到差多少
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `insufficient credits to roll back (balance=${accountBalance}, credits=${row.credits})；` +
            "请按未消耗余额人工处理（E3 未成年人误充口径），本期不支持部分退款",
          {
            order_id: String(row.id),
            balance: accountBalance,
            credits: row.credits,
            hint: "请按未消耗余额人工处理（E3 未成年人误充口径），本期不支持部分退款",
          },
        );
      }

      const refundNo = `rf-${String(row.id)}`;
      let refundStatus = "succeeded";
      let channelRefundId: string | undefined;

      if (row.channel !== "mock") {
        const channel = row.channel as PaymentChannelId;
        if (!this.channels.isConfigured(channel)) {
          throw new AppError(ErrorCode.INVALID_PARAM, `payment channel "${row.channel}" not configured`, {
            field: "channel",
            channel: row.channel,
          });
        }
        try {
          const refund = await this.channels.get(channel).refund({
            outTradeNo: String(row.id),
            outRefundNo: refundNo,
            totalCents: row.amountCents,
            refundCents: row.amountCents,
            reason: input.reason,
          });
          refundStatus = mapChannelRefundStatus(refund.status);
          channelRefundId = refund.refundId;
        } catch (err) {
          // 关键：抛错 → 事务回滚（订单保持已支付、积分不冲正），由上层映射成 VENDOR_ERROR/VENDOR_TIMEOUT
          throw this.toChannelAppError(err, row.channel, "退款");
        }
      }

      // 负向流水（kind=refund）：余额已在调用渠道前锁定校验，creditOut 内再次校验兜底
      try {
        await creditOut(tx, {
          spaceId: row.spaceId,
          amount: row.credits,
          kind: "refund",
          orderId: row.id,
          memo: `refund ${row.sku} ${refundNo}${channelRefundId ? ` channel_refund_id=${channelRefundId}` : ""}${
            input.reason ? ` reason=${input.reason}` : ""
          }`,
        });
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          throw new AppError(ErrorCode.INVALID_PARAM, "insufficient credits to roll back", {
            order_id: String(row.id),
            credits: row.credits,
          });
        }
        throw err;
      }

      const refundedAt = new Date();
      await tx
        .update(orders)
        .set({
          status: OrderStatus.REFUNDED,
          refundedAt,
          refundNo,
          refundStatus,
          refundAmountCents: row.amountCents,
          refundReason: input.reason ?? null,
          refundOperator: input.operator ?? null,
          updatedAt: refundedAt,
        })
        .where(eq(orders.id, row.id));

      return {
        row: {
          ...row,
          status: OrderStatus.REFUNDED,
          refundedAt,
          refundNo,
          refundStatus,
          refundAmountCents: row.amountCents,
          refundReason: input.reason ?? null,
          refundOperator: input.operator ?? null,
        },
        idempotent: false as const,
        channelRefundId,
      };
    });

    return {
      order_id: String(result.row.id),
      status: result.row.status,
      status_label: result.row.status === 4 ? "已退款" : "已支付",
      refund_no: result.row.refundNo ?? null,
      refund_status: result.row.refundStatus ?? null,
      refund_amount_cents: result.row.refundAmountCents ?? null,
      refunded_at: result.row.refundedAt ? result.row.refundedAt.toISOString() : null,
      idempotent: result.idempotent,
      ...(result.channelRefundId ? { channel_refund_id: result.channelRefundId } : {}),
    };
  }

  /** 用户订单历史 */
  async listOrders(spaceId: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(50, Math.max(1, pageSize));
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.spaceId, BigInt(spaceId)))
      .orderBy(desc(orders.createdAt))
      .limit(ps)
      .offset((p - 1) * ps);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.spaceId, BigInt(spaceId)));
    return { list: rows.map((r) => this.toOrderDto(r)), total: countRow?.count ?? 0, page: p, page_size: ps };
  }

  private toOrderDto(row: typeof orders.$inferSelect): OrderDto {
    return {
      order_id: String(row.id),
      sku: row.sku,
      amount_cents: row.amountCents,
      credits: row.credits,
      channel: row.channel,
      status: row.status,
      status_label:
        row.status === 1 ? "待支付" : row.status === 2 ? "已支付" : row.status === 3 ? "已关闭" : "已退款",
      pay_token: row.payToken,
      /** 渠道支付参数：前端按 pay_params.mode 渲染二维码/跳转/JSAPI */
      pay_params: (row.payParams as Record<string, unknown> | null) ?? null,
      paid_at: row.paidAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      expires_at: new Date(row.createdAt.getTime() + env.ORDER_TTL_S * 1000).toISOString(),
      refund_no: row.refundNo,
      refund_status: row.refundStatus,
      refund_amount_cents: row.refundAmountCents,
      refunded_at: row.refundedAt?.toISOString() ?? null,
      refund_reason: row.refundReason,
    };
  }
}
