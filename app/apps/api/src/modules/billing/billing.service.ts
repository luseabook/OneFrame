import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { orders, skus } from "@app/db";
import { creditIn } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { randomBytes } from "node:crypto";
import { env } from "../../config/env";
import { db } from "../../db/database";

const OrderStatus = {
  PENDING: 1,
  PAID: 2,
  CLOSED: 3,
  REFUNDED: 4,
} as const;

export interface CreateOrderInput {
  sku: string;
  channel: "wechat" | "alipay" | "mock";
}

@Injectable()
export class BillingService {
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

  /**
   * 下单：快照金额与积分，生成 payToken 供前端轮询。
   * 幂等：同一用户 60s 内对同一 sku 的未支付订单直接复用，避免重复下单。
   */
  async createOrder(spaceId: string, userId: string, input: CreateOrderInput) {
    const [sku] = await db.select().from(skus).where(eq(skus.sku, input.sku));
    if (!sku || !sku.active) {
      throw new AppError(ErrorCode.NOT_FOUND, "sku not found or inactive", { field: "sku" });
    }
    if (input.channel !== "mock" && !env.PAYMENT_LIVE) {
      // 未配置真实支付渠道时，明确拒绝非 mock 渠道，避免"假支付"
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "payment channel not configured (PAYMENT_LIVE=false)；当前仅支持 mock 渠道用于联调",
        { field: "channel" },
      );
    }

    // 60s 内同 sku 未支付订单复用（防止双击重复下单）
    const [recent] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.spaceId, BigInt(spaceId)),
          eq(orders.sku, input.sku),
          eq(orders.status, OrderStatus.PENDING),
          sql`${orders.createdAt} > now() - interval '60 seconds'`,
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    if (recent) {
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
      channel: input.channel,
      status: OrderStatus.PENDING,
      payToken,
    });
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    return this.toOrderDto(row);
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

  /** 关闭未支付订单（超时/用户取消） */
  async closeOrder(spaceId: string, orderId: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, BigInt(orderId)), eq(orders.spaceId, BigInt(spaceId))))
        .for("update");
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "order not found");
      if (row.status !== OrderStatus.PENDING) {
        return { id: String(row.id), status: row.status, closed: false };
      }
      await tx
        .update(orders)
        .set({ status: OrderStatus.CLOSED, closedAt: new Date(), updatedAt: new Date() })
        .where(eq(orders.id, row.id));
      return { id: String(row.id), status: OrderStatus.CLOSED, closed: true };
    });
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

  private toOrderDto(row: typeof orders.$inferSelect) {
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
      paid_at: row.paidAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      expires_at: new Date(row.createdAt.getTime() + env.ORDER_TTL_S * 1000).toISOString(),
    };
  }
}
