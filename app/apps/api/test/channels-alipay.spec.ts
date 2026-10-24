import { describe, expect, it } from "vitest";
import {
  createFakeFetch,
  generateRsaKeyPair,
  noSleep,
  parseForm,
  rsaSign,
  rsaVerify,
} from "./channels-test-utils";
import { AlipayAdapter, ALIPAY_DEFAULT_GATEWAY } from "../src/modules/billing/channels/alipay.adapter";
import { isChannelError } from "../src/modules/billing/channels/errors";

/**
 * 支付宝渠道契约测试（本地 RSA 密钥 + 假网关，不触网）。
 * 重点：RSA2 排序拼串签名可被公钥验证、precreate/page.pay/query/close/refund 字段、
 * 响应验签、错误映射与重试边界。
 */
describe("alipay adapter", () => {
  const merchant = generateRsaKeyPair();
  const platform = generateRsaKeyPair();
  const fixedNow = new Date(1_700_000_000_000); // 2023-11-15T06:13:20Z

  const baseConfig = {
    appId: "2016102300012345",
    appPrivateKeyPem: merchant.privateKeyPem,
    notifyUrl: "https://api.example.com/v1/billing/notify/alipay",
    sleep: noSleep,
  };

  const makeAdapter = (fetchImpl: ReturnType<typeof createFakeFetch>["fetchImpl"], overrides = {}) =>
    new AlipayAdapter({ ...baseConfig, fetchImpl, now: () => fixedNow, ...overrides });

  /** 按支付宝规则重建待验签串（请求：排除 sign，保留 sign_type/notify_url） */
  const requestSignContent = (params: Record<string, string>): string =>
    Object.keys(params)
      .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== "")
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");

  it("precreates a QR order with signed RSA2 form params", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({
        alipay_trade_precreate_response: {
          code: "10000",
          msg: "Success",
          qr_code: "https://qr.alipay.com/bax0123456789",
        },
      }),
    }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    const result = await adapter.precreate({
      outTradeNo: "700000000000000001",
      amountCents: 5000,
      description: "一帧 500 积分",
    });
    expect(result.mode).toBe("precreate");
    expect(result.qrCode).toBe("https://qr.alipay.com/bax0123456789");

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe(ALIPAY_DEFAULT_GATEWAY);
    expect(call.headers["Content-Type"]).toContain("application/x-www-form-urlencoded");

    const form = parseForm(call.body ?? "");
    expect(form.app_id).toBe("2016102300012345");
    expect(form.method).toBe("alipay.trade.precreate");
    expect(form.format).toBe("JSON");
    expect(form.charset).toBe("utf-8");
    expect(form.sign_type).toBe("RSA2");
    expect(form.version).toBe("1.0");
    expect(form.notify_url).toBe("https://api.example.com/v1/billing/notify/alipay");
    expect(form.timestamp).toBe(adapter.formatTimestamp(fixedNow));
    expect(JSON.parse(form.biz_content)).toEqual({
      out_trade_no: "700000000000000001",
      total_amount: "50.00",
      subject: "一帧 500 积分",
    });
    // 出站签名可被应用公钥验证（排序拼串，排除 sign）
    expect(rsaVerify(merchant.publicKeyPem, requestSignContent(form), form.sign)).toBe(true);
  });

  it("builds a signed page.pay redirect URL without network call", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: "{}" }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    const result = adapter.pagePay({
      outTradeNo: "order-page-1",
      amountCents: 10000,
      description: "一帧 1000 积分",
      returnUrl: "https://app.example.com/pricing?paid=1",
    });

    expect(fake.calls).toHaveLength(0);
    expect(result.payUrl.startsWith(`${ALIPAY_DEFAULT_GATEWAY}?`)).toBe(true);
    const query = new URL(result.payUrl).searchParams;
    expect(query.get("method")).toBe("alipay.trade.page.pay");
    expect(query.get("app_id")).toBe("2016102300012345");
    expect(query.get("return_url")).toBe("https://app.example.com/pricing?paid=1");
    const biz = JSON.parse(query.get("biz_content") ?? "{}");
    expect(biz).toMatchObject({
      out_trade_no: "order-page-1",
      total_amount: "100.00",
      subject: "一帧 1000 积分",
      product_code: "FAST_INSTANT_TRADE_PAY",
    });

    const params: Record<string, string> = {};
    for (const [k, v] of query.entries()) params[k] = v;
    expect(rsaVerify(merchant.publicKeyPem, requestSignContent(params), params.sign)).toBe(true);
  });

  it("queries order and parses paid state / amount in cents", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({
        alipay_trade_query_response: {
          code: "10000",
          msg: "Success",
          trade_status: "TRADE_SUCCESS",
          trade_no: "2023111522001400000000000001",
          total_amount: "50.00",
        },
      }),
    }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    const result = await adapter.query("order-1");
    expect(result).toMatchObject({
      paid: true,
      status: "TRADE_SUCCESS",
      channelOrderId: "2023111522001400000000000001",
      amountCents: 5000,
    });
    const form = parseForm(fake.calls[0].body ?? "");
    expect(form.method).toBe("alipay.trade.query");
    expect(JSON.parse(form.biz_content)).toEqual({ out_trade_no: "order-1" });
  });

  it("closes order with alipay.trade.close", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({ alipay_trade_close_response: { code: "10000", msg: "Success" } }),
    }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    await adapter.close("order-1");
    const form = parseForm(fake.calls[0].body ?? "");
    expect(form.method).toBe("alipay.trade.close");
    expect(JSON.parse(form.biz_content)).toEqual({ out_trade_no: "order-1" });
  });

  it("refunds with yuan amount and idempotent out_request_no", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({
        alipay_trade_refund_response: { code: "10000", msg: "Success", trade_no: "T1", fund_change: "Y" },
      }),
    }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    const result = await adapter.refund({
      outTradeNo: "order-1",
      outRefundNo: "refund-1",
      totalCents: 10000,
      refundCents: 4000,
      reason: "用户申请退款",
    });
    expect(result).toMatchObject({ refundId: "T1", status: "Y" });
    const form = parseForm(fake.calls[0].body ?? "");
    expect(form.method).toBe("alipay.trade.refund");
    expect(JSON.parse(form.biz_content)).toMatchObject({
      out_trade_no: "order-1",
      refund_amount: "40.00",
      out_request_no: "refund-1",
      refund_reason: "用户申请退款",
    });
  });

  describe("response signature verification", () => {
    const signedResponse = (node: Record<string, unknown>): string => {
      const rawNode = JSON.stringify(node);
      const sign = rsaSign(platform.privateKeyPem, rawNode);
      return `{"alipay_trade_precreate_response":${rawNode},"sign":${JSON.stringify(sign)}}`;
    };

    it("accepts a correctly signed response when public key configured", async () => {
      const body = signedResponse({ code: "10000", msg: "Success", qr_code: "https://qr.alipay.com/x" });
      const fake = createFakeFetch(() => ({ status: 200, body }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 0, publicKeyPem: platform.publicKeyPem });
      const result = await adapter.precreate({ outTradeNo: "o-1", amountCents: 100, description: "d" });
      expect(result.qrCode).toBe("https://qr.alipay.com/x");
    });

    it("rejects a tampered response signature", async () => {
      const body = signedResponse({ code: "10000", msg: "Success", qr_code: "https://qr.alipay.com/x" });
      const tampered = body.replace("https://qr.alipay.com/x", "https://qr.alipay.com/evil");
      const fake = createFakeFetch(() => ({ status: 200, body: tampered }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 0, publicKeyPem: platform.publicKeyPem });
      await expect(
        adapter.precreate({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_SIGNATURE_INVALID" });
    });
  });

  describe("error mapping and retry boundary", () => {
    it("maps business error code + sub_code without retry", async () => {
      const fake = createFakeFetch(() => ({
        status: 200,
        body: JSON.stringify({
          alipay_trade_precreate_response: {
            code: "40004",
            msg: "Business Failed",
            sub_code: "ACQ.INVALID_PARAMETER",
            sub_msg: "参数无效",
          },
        }),
      }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 2 });
      try {
        await adapter.precreate({ outTradeNo: "o-1", amountCents: 100, description: "d" });
        throw new Error("should have thrown");
      } catch (err) {
        expect(isChannelError(err)).toBe(true);
        if (isChannelError(err)) {
          expect(err.code).toBe("CHANNEL_BUSINESS_ERROR");
          expect(err.vendorCode).toBe("ACQ.INVALID_PARAMETER");
        }
      }
      expect(fake.calls).toHaveLength(1);
    });

    it("treats service-unavailable biz code 20000 as retryable server error", async () => {
      const fake = createFakeFetch(() => ({
        status: 200,
        body: JSON.stringify({
          alipay_trade_precreate_response: { code: "20000", msg: "Service Currently Unavailable" },
        }),
      }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 1 });
      await expect(
        adapter.precreate({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_SERVER_ERROR", retryable: true });
      expect(fake.calls).toHaveLength(2);
    });

    it("retries HTTP 5xx then succeeds", async () => {
      const fake = createFakeFetch((_call, index) =>
        index === 0
          ? { status: 503, body: "busy" }
          : {
              status: 200,
              body: JSON.stringify({ alipay_trade_precreate_response: { code: "10000", qr_code: "https://qr/x" } }),
            },
      );
      const adapter = makeAdapter(fake.fetchImpl, { retries: 1 });
      const result = await adapter.precreate({ outTradeNo: "o-1", amountCents: 100, description: "d" });
      expect(result.qrCode).toBe("https://qr/x");
      expect(fake.calls).toHaveLength(2);
    });

    it("retries network failure then throws CHANNEL_NETWORK", async () => {
      const fake = createFakeFetch(() => new Error("socket hang up"));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 1 });
      await expect(
        adapter.precreate({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_NETWORK", retryable: true });
      expect(fake.calls).toHaveLength(2);
    });

    it("rejects non-JSON gateway response", async () => {
      const fake = createFakeFetch(() => ({ status: 200, body: "<html>gateway</html>" }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
      await expect(
        adapter.precreate({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_INVALID_RESPONSE" });
    });

    it("rejects precreate without qr_code", async () => {
      const fake = createFakeFetch(() => ({
        status: 200,
        body: JSON.stringify({ alipay_trade_precreate_response: { code: "10000", msg: "Success" } }),
      }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
      await expect(
        adapter.precreate({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_INVALID_RESPONSE" });
    });
  });
});
