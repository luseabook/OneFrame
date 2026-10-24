import { describe, expect, it } from "vitest";
import {
  createFakeFetch,
  generateRsaKeyPair,
  noSleep,
  parseAuthorizationFields,
  rsaVerify,
} from "./channels-test-utils";
import { WechatPayV3Adapter } from "../src/modules/billing/channels/wechat-pay.adapter";
import { isChannelError } from "../src/modules/billing/channels/errors";

/**
 * 微信支付 APIv3 渠道契约测试（本地 RSA 密钥 + 假网关，不触网）。
 * 重点：出站签名串可被公钥验证、各接口请求字段正确、错误码映射与重试边界。
 */
describe("wechat pay api v3 adapter", () => {
  const merchant = generateRsaKeyPair();
  const fixedNow = 1_700_000_000_000; // 2023-11-15T06:13:20Z
  const fixedTimestamp = String(Math.floor(fixedNow / 1000));

  const baseConfig = {
    appId: "wxtestappid0001",
    mchId: "1900000001",
    serialNo: "TESTSERIAL0001",
    privateKeyPem: merchant.privateKeyPem,
    apiV3Key: "0123456789abcdef0123456789abcdef",
    notifyUrl: "https://api.example.com/v1/billing/notify/wechat",
    sleep: noSleep,
  };

  const makeAdapter = (fetchImpl: ReturnType<typeof createFakeFetch>["fetchImpl"], overrides = {}) =>
    new WechatPayV3Adapter({
      ...baseConfig,
      fetchImpl,
      now: () => fixedNow,
      nonceFactory: () => "fixednonce123456",
      ...overrides,
    });

  it("signs native order with the APIv3 signature string and verifiable Authorization header", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({ code_url: "weixin://wxpay/bizpayurl?pr=abc123" }),
    }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });

    const result = await adapter.createNative({
      outTradeNo: "700000000000000001",
      amountCents: 5000,
      description: "一帧 500 积分",
    });
    expect(result.mode).toBe("native");
    expect(result.codeUrl).toBe("weixin://wxpay/bizpayurl?pr=abc123");

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/native");
    expect(call.headers["Content-Type"]).toBe("application/json");

    const auth = call.headers.Authorization;
    expect(auth.startsWith("WECHATPAY2-SHA256-RSA2048 ")).toBe(true);
    const fields = parseAuthorizationFields(auth);
    expect(fields.mchid).toBe("1900000001");
    expect(fields.serial_no).toBe("TESTSERIAL0001");
    expect(fields.nonce_str).toBe("fixednonce123456");
    expect(fields.timestamp).toBe(fixedTimestamp);

    // 签名串必须严格是 METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n
    const expectedMessage = `POST\n/v3/pay/transactions/native\n${fixedTimestamp}\nfixednonce123456\n${call.body}\n`;
    expect(rsaVerify(merchant.publicKeyPem, expectedMessage, fields.signature)).toBe(true);

    const body = JSON.parse(call.body ?? "{}");
    expect(body).toMatchObject({
      appid: "wxtestappid0001",
      mchid: "1900000001",
      description: "一帧 500 积分",
      out_trade_no: "700000000000000001",
      notify_url: "https://api.example.com/v1/billing/notify/wechat",
      amount: { total: 5000, currency: "CNY" },
    });
  });

  it("creates H5 order with scene_info.payer_client_ip and returns h5_url", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({ h5_url: "https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=wx123" }),
    }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    const result = await adapter.createH5({
      outTradeNo: "order-h5-1",
      amountCents: 10000,
      description: "一帧 1000 积分",
      clientIp: "203.0.113.9",
    });
    expect(result.h5Url).toContain("prepay_id=wx123");
    const body = JSON.parse(fake.calls[0].body ?? "{}");
    expect(body.scene_info).toEqual({ payer_client_ip: "203.0.113.9", h5_info: { type: "Wap" } });
    expect(fake.calls[0].url).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/h5");
  });

  it("rejects H5 order without clientIp (channel invalid request, no HTTP call)", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: "{}" }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    await expect(
      adapter.createH5({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
    ).rejects.toMatchObject({ code: "CHANNEL_INVALID_REQUEST" });
    expect(fake.calls).toHaveLength(0);
  });

  it("creates JSAPI order returning prepay_id and a paySign verifiable with the merchant public key", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({ prepay_id: "wx201410272009395522657a690389285100" }),
    }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    const result = await adapter.createJsapi({
      outTradeNo: "order-jsapi-1",
      amountCents: 5000,
      description: "一帧 500 积分",
      openid: "oOpenId123",
    });

    expect(result.prepayId).toBe("wx201410272009395522657a690389285100");
    const body = JSON.parse(fake.calls[0].body ?? "{}");
    expect(body.payer).toEqual({ openid: "oOpenId123" });
    expect(fake.calls[0].url).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi");

    const paySign = result.paySign;
    expect(paySign.appId).toBe("wxtestappid0001");
    expect(paySign.package).toBe("prepay_id=wx201410272009395522657a690389285100");
    expect(paySign.signType).toBe("RSA");
    // 前端调起签名串：appId\ntimeStamp\nnonceStr\npackage\n
    const signMessage = `${paySign.appId}\n${paySign.timeStamp}\n${paySign.nonceStr}\n${paySign.package}\n`;
    expect(rsaVerify(merchant.publicKeyPem, signMessage, paySign.paySign)).toBe(true);
  });

  it("queries order by out_trade_no with mchid in query and signs the full path", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({
        trade_state: "SUCCESS",
        transaction_id: "4200000000202311150000000001",
        amount: { total: 5000 },
      }),
    }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    const result = await adapter.query("order-1");

    expect(result).toMatchObject({
      paid: true,
      status: "SUCCESS",
      channelOrderId: "4200000000202311150000000001",
      amountCents: 5000,
    });
    const call = fake.calls[0];
    expect(call.method).toBe("GET");
    expect(call.url).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/order-1?mchid=1900000001");
    expect(call.body).toBeUndefined();
    const fields = parseAuthorizationFields(call.headers.Authorization);
    const expectedMessage = `GET\n/v3/pay/transactions/out-trade-no/order-1?mchid=1900000001\n${fixedTimestamp}\nfixednonce123456\n\n`;
    expect(rsaVerify(merchant.publicKeyPem, expectedMessage, fields.signature)).toBe(true);
  });

  it("closes order with mchid body (204 empty response tolerated)", async () => {
    const fake = createFakeFetch(() => ({ status: 204, body: "" }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    await expect(adapter.close("order-1")).resolves.toBeUndefined();
    const call = fake.calls[0];
    expect(call.url).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/order-1/close");
    expect(JSON.parse(call.body ?? "{}")).toEqual({ mchid: "1900000001" });
  });

  it("refunds with refund/total amount split and returns refund_id", async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({ refund_id: "5030000000202311150000000001", status: "PROCESSING" }),
    }));
    const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
    const result = await adapter.refund({
      outTradeNo: "order-1",
      outRefundNo: "refund-1",
      totalCents: 10000,
      refundCents: 4000,
      reason: "用户申请退款",
    });
    expect(result).toMatchObject({ refundId: "5030000000202311150000000001", status: "PROCESSING" });
    const call = fake.calls[0];
    expect(call.url).toBe("https://api.mch.weixin.qq.com/v3/refund/domestic/refunds");
    expect(JSON.parse(call.body ?? "{}")).toMatchObject({
      out_trade_no: "order-1",
      out_refund_no: "refund-1",
      amount: { refund: 4000, total: 10000, currency: "CNY" },
      reason: "用户申请退款",
    });
  });

  describe("error mapping and retry boundary", () => {
    it("retries 5xx then succeeds", async () => {
      const fake = createFakeFetch((_call, index) =>
        index < 2
          ? { status: 500, body: JSON.stringify({ code: "SYSTEM_ERROR", message: "系统错误" }) }
          : { status: 200, body: JSON.stringify({ code_url: "weixin://x" }) },
      );
      const adapter = makeAdapter(fake.fetchImpl, { retries: 2 });
      const result = await adapter.createNative({ outTradeNo: "o-1", amountCents: 100, description: "d" });
      expect(result.codeUrl).toBe("weixin://x");
      expect(fake.calls).toHaveLength(3);
    });

    it("retries 429 then throws CHANNEL_RATE_LIMITED", async () => {
      const fake = createFakeFetch(() => ({ status: 429, body: JSON.stringify({ code: "FREQUENCY_LIMITED" }) }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 1 });
      await expect(
        adapter.createNative({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_RATE_LIMITED", retryable: true });
      expect(fake.calls).toHaveLength(2);
    });

    it("does not retry 4xx business errors and maps vendor code", async () => {
      const fake = createFakeFetch(() => ({
        status: 400,
        body: JSON.stringify({ code: "PARAM_ERROR", message: "参数错误：description 不能为空" }),
      }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 2 });
      try {
        await adapter.createNative({ outTradeNo: "o-1", amountCents: 100, description: "" });
        throw new Error("should have thrown");
      } catch (err) {
        expect(isChannelError(err)).toBe(true);
        if (isChannelError(err)) {
          expect(err.code).toBe("CHANNEL_BUSINESS_ERROR");
          expect(err.vendorCode).toBe("PARAM_ERROR");
          expect(err.retryable).toBe(false);
        }
      }
      expect(fake.calls).toHaveLength(1);
    });

    it("maps 401 to CHANNEL_AUTH_ERROR without retry", async () => {
      const fake = createFakeFetch(() => ({
        status: 401,
        body: JSON.stringify({ code: "SIGN_ERROR", message: "签名错误" }),
      }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 2 });
      await expect(
        adapter.createNative({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_AUTH_ERROR", vendorCode: "SIGN_ERROR" });
      expect(fake.calls).toHaveLength(1);
    });

    it("retries network failures then throws CHANNEL_NETWORK", async () => {
      const fake = createFakeFetch(() => new Error("ECONNRESET"));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 1 });
      await expect(
        adapter.createNative({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_NETWORK", retryable: true });
      expect(fake.calls).toHaveLength(2);
    });

    it("maps timeout abort to CHANNEL_TIMEOUT", async () => {
      const abortError = new Error("aborted");
      abortError.name = "AbortError";
      const fake = createFakeFetch(() => abortError);
      const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
      await expect(
        adapter.createNative({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_TIMEOUT", retryable: true });
    });

    it("rejects non-JSON 2xx response", async () => {
      const fake = createFakeFetch(() => ({ status: 200, body: "<html>oops</html>" }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
      await expect(
        adapter.createNative({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_INVALID_RESPONSE" });
    });

    it("rejects native response without code_url", async () => {
      const fake = createFakeFetch(() => ({ status: 200, body: JSON.stringify({ prepay_id: "x" }) }));
      const adapter = makeAdapter(fake.fetchImpl, { retries: 0 });
      await expect(
        adapter.createNative({ outTradeNo: "o-1", amountCents: 100, description: "d" }),
      ).rejects.toMatchObject({ code: "CHANNEL_INVALID_RESPONSE" });
    });
  });
});
