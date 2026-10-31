import { describe, expect, it, vi } from "vitest";

/**
 * 支付链路守卫（PR-02）——**纯函数 + 轻量 mock** 单测，本机没有 PG/Redis 也能跑。
 *
 * 为什么单独抽一测：这次 P0 的两个洞（mock 端点 fail-open、省略 `amount_cents` 即跳过金额校验）
 * 都藏在"需要真库才能跑到"的 e2e 里，而 e2e 在本机跑不起来 → 门禁形同不存在。
 * 所以把安全判定从 SQL 里拆出来（`checkPaymentPayload` / `decidePaymentAction` /
 * `mockEndpointBlockReason`），在这里穷举边界；真库路径仍由 billing.spec.ts 覆盖。
 *
 * `db` 只被 mock 成"查询永远返回空行"，用来证明：**拒绝发生在写入之前**，
 * 且归属不符与"订单不存在"返回同一个错误码（不泄露订单是否存在）。
 */
vi.mock("../src/db/database", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => chain;
  chain.for = () => chain;
  chain.limit = async () => [];
  chain.update = () => chain;
  chain.set = () => chain;
  chain.execute = async () => [];
  return {
    db: {
      transaction: async (fn: (tx: unknown) => unknown) => fn(chain),
      select: () => chain,
      execute: async () => [],
    },
    pool: { end: async () => undefined },
  };
});

import type { ChannelService } from "../src/modules/billing/channels/channel.service";
import {
  BillingService,
  checkPaymentPayload,
  decidePaymentAction,
  type PayableOrderRow,
} from "../src/modules/billing/billing.service";
import { mockEndpointBlockReason } from "../src/modules/billing/billing.controller";

/** 下单快照行的最小夹具（雪花 id 用 bigint，与 drizzle 返回一致） */
const orderRow = (overrides: Partial<PayableOrderRow> = {}): PayableOrderRow => ({
  spaceId: 1001n,
  status: 1, // PENDING
  amountCents: 9900,
  credits: 1000,
  ...overrides,
});

describe("mock 支付端点的准入（PR-02：NODE_ENV 是唯一安全边界）", () => {
  it("生产一律硬拒，即使 PAYMENT_LIVE=false（旧实现只认业务开关 → 正是 fail-open 的成因）", () => {
    const notify = mockEndpointBlockReason("production", false, "mock notify");
    const pay = mockEndpointBlockReason("production", false, "mock pay");
    expect(notify).toContain("production");
    expect(pay).toContain("production");
    // 生产 + PAYMENT_LIVE=true 也拒（两条判定叠加，不是互斥）
    expect(mockEndpointBlockReason("production", true, "mock notify")).toContain("production");
  });

  it("非生产仍允许 mock 联调（否则本地/CI 无法走通支付链路）", () => {
    expect(mockEndpointBlockReason("test", false, "mock notify")).toBeNull();
    expect(mockEndpointBlockReason("development", false, "mock pay")).toBeNull();
    expect(mockEndpointBlockReason(undefined, false, "mock pay")).toBeNull();
  });

  it("PAYMENT_LIVE=true 在非生产也禁用 mock —— 这条只能更严，不能替代上面的生产判定", () => {
    expect(mockEndpointBlockReason("test", true, "mock notify")).toContain("PAYMENT_LIVE");
    expect(mockEndpointBlockReason("development", true, "mock pay")).toContain("PAYMENT_LIVE");
  });
});

describe("mock 渠道金额必填（省略字段不再等于跳过校验）", () => {
  it("缺 amount_cents 直接拒（400101）", () => {
    const result = checkPaymentPayload({ channel: "mock", channelOrderId: "mock-1" });
    expect(result).toMatchObject({ ok: false, code: 400101 });
    expect(result).not.toMatchObject({ ok: true });
  });

  it("非法 amount_cents 也拒（null / 字符串 / 小数 / 负数 / NaN / Infinity）", () => {
    const bad: unknown[] = [null, "100", 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY];
    for (const amountCents of bad) {
      const result = checkPaymentPayload({ channel: "mock", channelOrderId: "mock-1", amountCents });
      expect(result, `amountCents=${String(amountCents)} 应被拒`).toMatchObject({ ok: false, code: 400101 });
    }
  });

  it("金额齐全则通过", () => {
    expect(checkPaymentPayload({ channel: "mock", channelOrderId: "mock-1", amountCents: 0 })).toEqual({ ok: true });
    expect(checkPaymentPayload({ channel: "mock", channelOrderId: "mock-1", amountCents: 9900 })).toEqual({ ok: true });
  });

  it("真实渠道不受必填约束：金额来自渠道签名载荷，缺省时按签名载荷比对", () => {
    expect(checkPaymentPayload({ channel: "wechat", channelOrderId: "wx-1" })).toEqual({ ok: true });
    expect(checkPaymentPayload({ channel: "alipay", channelOrderId: "ali-1" })).toEqual({ ok: true });
  });

  it("channel_order_id 仍然是必填（渠道流水是幂等与对账的主键）", () => {
    expect(checkPaymentPayload({ channel: "mock", channelOrderId: "", amountCents: 1 })).toMatchObject({
      ok: false,
      code: 400101,
    });
    expect(checkPaymentPayload({ channel: "wechat", channelOrderId: undefined })).toMatchObject({
      ok: false,
      code: 400101,
    });
  });
});

describe("订单归属与状态判定（decidePaymentAction）", () => {
  it("service 侧给出的 spaceId 与订单不符即拒，且与「订单不存在」同码（不泄露存在性）", () => {
    const foreign = decidePaymentAction(orderRow({ spaceId: 2002n }), { spaceId: "1001", amountCents: 9900 });
    const missing = decidePaymentAction(undefined, { spaceId: "1001", amountCents: 9900 });
    expect(foreign).toMatchObject({ kind: "reject", code: 400102, message: "order not found" });
    expect(missing).toMatchObject({ kind: "reject", code: 400102, message: "order not found" });
  });

  it("本人 space + 金额一致 → 入账", () => {
    expect(decidePaymentAction(orderRow(), { spaceId: "1001", amountCents: 9900 })).toEqual({ kind: "credit" });
  });

  it("真实渠道回调没有 spaceId：不做归属约束（完整性由验签负责）", () => {
    expect(decidePaymentAction(orderRow({ spaceId: 2002n }), { amountCents: 9900 })).toEqual({ kind: "credit" });
  });

  it("金额与下单快照不一致 → 拒绝入账", () => {
    expect(decidePaymentAction(orderRow(), { spaceId: "1001", amountCents: 1 })).toMatchObject({
      kind: "reject",
      code: 400101,
      message: "amount mismatch",
    });
  });

  it("已支付订单重复回调 → 幂等返回（不重复发放）", () => {
    expect(decidePaymentAction(orderRow({ status: 2 }), { spaceId: "1001", amountCents: 9900 })).toEqual({
      kind: "already-paid",
    });
  });

  it("已关闭/已退款订单 → 不可支付", () => {
    for (const status of [3, 4]) {
      expect(decidePaymentAction(orderRow({ status }), { spaceId: "1001", amountCents: 9900 })).toMatchObject({
        kind: "reject",
        code: 400101,
      });
    }
  });
});

describe("markPaid 的拒绝发生在触库/写入之前（db 被 mock 成永远查不到行）", () => {
  const service = (): BillingService => new BillingService({} as ChannelService);

  it("传入他人 spaceId 被拒：NOT_FOUND，与「查不到订单」同码", async () => {
    await expect(
      service().markPaid({
        orderId: "1234567890",
        channel: "mock",
        channelOrderId: "mock-1",
        amountCents: 9900,
        spaceId: "999",
      }),
    ).rejects.toMatchObject({ code: 400102, message: "order not found" });
  });

  it("mock 渠道缺 amountCents 被拒（400101），且不需要先查到订单", async () => {
    await expect(
      service().markPaid({
        orderId: "1234567890",
        channel: "mock",
        channelOrderId: "mock-1",
        spaceId: "1001",
      }),
    ).rejects.toMatchObject({ code: 400101 });
  });

  it("order_id 非数字报 400101，不是 500（原来的 BigInt() 会抛 SyntaxError → 500）", async () => {
    await expect(
      service().markPaid({
        orderId: "not-a-snowflake",
        channel: "mock",
        channelOrderId: "mock-1",
        amountCents: 9900,
        spaceId: "1001",
      }),
    ).rejects.toMatchObject({ code: 400101 });
  });

  it("真实渠道（无 spaceId）在查不到订单时仍是 NOT_FOUND，不会因缺归属参数而 500", async () => {
    await expect(
      service().markPaid({ orderId: "1234567890", channel: "wechat", channelOrderId: "wx-1", amountCents: 9900 }),
    ).rejects.toMatchObject({ code: 400102 });
  });
});
