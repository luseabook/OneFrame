import { createSign, randomBytes } from "node:crypto";
import { ChannelError } from "./errors";
import { parseErrorBody, sendWithRetry, type FetchLike, type HttpResult } from "./http";
import type {
  ChannelQueryResult,
  CreatePaymentInput,
  CreatedPayment,
  PaymentChannelAdapter,
  PaymentMode,
  RefundInput,
  RefundResult,
} from "./types";

/**
 * 微信支付 APIv3 适配器。
 *
 * 协议要点（官方文档「签名认证」）：
 * - 请求签名串：`METHOD\nURL(pathWithQuery)\nTIMESTAMP\nNONCE\nBODY\n`
 *   用商户 API 私钥做 SHA256-RSA2048（RSA-SHA256）签名，Base64 后放进
 *   `Authorization: WECHATPAY2-SHA256-RSA2048 mchid="...",nonce_str="...",signature="...",timestamp="...",serial_no="..."`
 * - Native/H5/JSAPI 下单、查单、关单、退款均走同一套签名；
 * - JSAPI 还要求对前端调起参数再做一次签名：`appId\ntimeStamp\nnonceStr\npackage\n`。
 *
 * 所有网络细节通过注入的 fetch 完成，便于契约测试（本地 RSA 密钥 + 假网关）。
 */

export const WECHAT_DEFAULT_API_BASE = "https://api.mch.weixin.qq.com";

export interface WechatPayConfig {
  appId: string;
  mchId: string;
  /** 商户 API 证书序列号 */
  serialNo: string;
  /** 商户 API 私钥（PKCS#8 PEM） */
  privateKeyPem: string;
  /** APIv3 密钥（回调解密，32 字节）。下单/查单不需要，但适配器保留以自检配置完整性 */
  apiV3Key?: string;
  /** 默认回调地址 */
  notifyUrl?: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 毫秒时间戳来源（测试注入） */
  now?: () => number;
  /** nonce 来源（测试注入，便于断言签名串） */
  nonceFactory?: () => string;
}

export interface WechatNativeResult {
  mode: "native";
  codeUrl: string;
  raw: unknown;
}

export interface WechatH5Result {
  mode: "h5";
  h5Url: string;
  raw: unknown;
}

export interface WechatJsapiResult {
  mode: "jsapi";
  prepayId: string;
  paySign: {
    appId: string;
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: "RSA";
    paySign: string;
  };
  raw: unknown;
}

interface WechatErrorBody {
  code?: string;
  message?: string;
  detail?: { field?: string; value?: string; issue?: string };
}

export class WechatPayV3Adapter implements PaymentChannelAdapter {
  readonly id = "wechat" as const;
  readonly modes: PaymentMode[] = ["native", "h5", "jsapi"];

  private readonly apiBase: string;

  constructor(private readonly config: WechatPayConfig) {
    this.apiBase = (config.apiBase ?? WECHAT_DEFAULT_API_BASE).replace(/\/+$/, "");
  }

  // ── 签名 ────────────────────────────────────────────────────────────────

  /** 请求签名串：METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n（BODY 为空时以空行收尾） */
  buildSignatureMessage(params: {
    method: string;
    pathWithQuery: string;
    timestamp: string;
    nonce: string;
    body: string;
  }): string {
    return `${params.method}\n${params.pathWithQuery}\n${params.timestamp}\n${params.nonce}\n${params.body}\n`;
  }

  private signWithMerchantKey(message: string): string {
    const signer = createSign("RSA-SHA256");
    signer.update(message, "utf8");
    signer.end();
    return signer.sign(this.config.privateKeyPem, "base64");
  }

  /** 生成 Authorization 头（导出便于契约测试断言） */
  buildAuthorizationHeader(method: string, pathWithQuery: string, body: string): string {
    const timestamp = String(Math.floor((this.config.now?.() ?? Date.now()) / 1000));
    const nonce = this.config.nonceFactory?.() ?? randomBytes(16).toString("hex");
    const message = this.buildSignatureMessage({ method, pathWithQuery, timestamp, nonce, body });
    const signature = this.signWithMerchantKey(message);
    return [
      "WECHATPAY2-SHA256-RSA2048",
      `mchid="${this.config.mchId}"`,
      `nonce_str="${nonce}"`,
      `signature="${signature}"`,
      `timestamp="${timestamp}"`,
      `serial_no="${this.config.serialNo}"`,
    ].join(" ");
  }

  /** JSAPI 前端调起参数签名串：appId\ntimeStamp\nnonceStr\npackage\n */
  buildJsapiPaySign(prepayId: string, timestamp: string, nonceStr: string): string {
    const message = `${this.config.appId}\n${timestamp}\n${nonceStr}\nprepay_id=${prepayId}\n`;
    return this.signWithMerchantKey(message);
  }

  // ── 请求 ────────────────────────────────────────────────────────────────

  private async callApi(
    method: "GET" | "POST",
    pathWithQuery: string,
    body?: Record<string, unknown>,
  ): Promise<{ result: HttpResult; json: Record<string, unknown> }> {
    const bodyText = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: this.buildAuthorizationHeader(method, pathWithQuery, bodyText),
      "User-Agent": "onframe-pay/1.0 (node)",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let httpResult: HttpResult;
    try {
      httpResult = await sendWithRetry(
        this.config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike),
        { method, url: `${this.apiBase}${pathWithQuery}`, headers, body: body === undefined ? undefined : bodyText },
        {
          retries: this.config.retries,
          baseDelayMs: this.config.baseDelayMs,
          timeoutMs: this.config.timeoutMs,
          sleep: this.config.sleep,
        },
      );
    } catch (err) {
      throw this.mapHttpError(err);
    }

    if (httpResult.text.trim() === "") return { result: httpResult, json: {} };
    try {
      return { result: httpResult, json: JSON.parse(httpResult.text) as Record<string, unknown> };
    } catch {
      throw new ChannelError("CHANNEL_INVALID_RESPONSE", "wechat response is not valid JSON", {
        details: { body: httpResult.text.slice(0, 512) },
      });
    }
  }

  private mapHttpError(err: unknown): unknown {
    if (!(err instanceof ChannelError)) return err;
    const bodyText = typeof err.details?.body === "string" ? err.details.body : "";
    const parsed = parseErrorBody(bodyText) as WechatErrorBody;
    if (err.code === "CHANNEL_BUSINESS_ERROR") {
      const isAuth = err.httpStatus === 401 || err.httpStatus === 403;
      return new ChannelError(isAuth ? "CHANNEL_AUTH_ERROR" : "CHANNEL_BUSINESS_ERROR", parsed.message ?? err.message, {
        httpStatus: err.httpStatus,
        vendorCode: parsed.code,
        retryable: false,
        details: { channel: "wechat", code: parsed.code, message: parsed.message, httpStatus: err.httpStatus },
      });
    }
    if (err.code === "CHANNEL_SERVER_ERROR" || err.code === "CHANNEL_RATE_LIMITED") {
      return new ChannelError(err.code, parsed.message ?? err.message, {
        httpStatus: err.httpStatus,
        vendorCode: parsed.code,
        retryable: err.retryable,
        details: { channel: "wechat", code: parsed.code, message: parsed.message, httpStatus: err.httpStatus },
      });
    }
    return err;
  }

  // ── 下单 ────────────────────────────────────────────────────────────────

  private baseOrderBody(input: CreatePaymentInput): Record<string, unknown> {
    const order: Record<string, unknown> = {
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: input.description,
      out_trade_no: input.outTradeNo,
      notify_url: input.notifyUrl ?? this.config.notifyUrl,
      amount: { total: input.amountCents, currency: "CNY" },
    };
    if (input.attach) order.attach = input.attach;
    if (input.expireSeconds) order.time_expire = this.formatWechatTime(new Date(Date.now() + input.expireSeconds * 1000));
    return order;
  }

  private formatWechatTime(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, "0");
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
    );
  }

  async createNative(input: CreatePaymentInput): Promise<WechatNativeResult> {
    const { json } = await this.callApi("POST", "/v3/pay/transactions/native", this.baseOrderBody(input));
    const codeUrl = json.code_url;
    if (typeof codeUrl !== "string" || codeUrl === "") {
      throw new ChannelError("CHANNEL_INVALID_RESPONSE", "wechat native response missing code_url", {
        details: { fields: Object.keys(json) },
      });
    }
    return { mode: "native", codeUrl, raw: json };
  }

  async createH5(input: CreatePaymentInput): Promise<WechatH5Result> {
    if (!input.clientIp) {
      throw new ChannelError("CHANNEL_INVALID_REQUEST", "wechat h5 payment requires clientIp");
    }
    const body = {
      ...this.baseOrderBody(input),
      scene_info: {
        payer_client_ip: input.clientIp,
        h5_info: { type: "Wap" },
      },
    };
    const { json } = await this.callApi("POST", "/v3/pay/transactions/h5", body);
    const h5Url = json.h5_url;
    if (typeof h5Url !== "string" || h5Url === "") {
      throw new ChannelError("CHANNEL_INVALID_RESPONSE", "wechat h5 response missing h5_url", {
        details: { fields: Object.keys(json) },
      });
    }
    return { mode: "h5", h5Url, raw: json };
  }

  async createJsapi(input: CreatePaymentInput): Promise<WechatJsapiResult> {
    if (!input.openid) {
      throw new ChannelError("CHANNEL_INVALID_REQUEST", "wechat jsapi payment requires openid");
    }
    const body = { ...this.baseOrderBody(input), payer: { openid: input.openid } };
    const { json } = await this.callApi("POST", "/v3/pay/transactions/jsapi", body);
    const prepayId = json.prepay_id;
    if (typeof prepayId !== "string" || prepayId === "") {
      throw new ChannelError("CHANNEL_INVALID_RESPONSE", "wechat jsapi response missing prepay_id", {
        details: { fields: Object.keys(json) },
      });
    }
    const timeStamp = String(Math.floor((this.config.now?.() ?? Date.now()) / 1000));
    const nonceStr = this.config.nonceFactory?.() ?? randomBytes(16).toString("hex");
    const paySign = this.buildJsapiPaySign(prepayId, timeStamp, nonceStr);
    return {
      mode: "jsapi",
      prepayId,
      paySign: {
        appId: this.config.appId,
        timeStamp,
        nonceStr,
        package: `prepay_id=${prepayId}`,
        signType: "RSA",
        paySign,
      },
      raw: json,
    };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const mode = input.mode ?? "native";
    const common = {
      channel: this.id,
      out_trade_no: input.outTradeNo,
      amount_cents: input.amountCents,
    };
    if (mode === "native") {
      const res = await this.createNative(input);
      return { channel: this.id, mode: "native", payParams: { ...common, mode: "native", code_url: res.codeUrl } };
    }
    if (mode === "h5") {
      const res = await this.createH5(input);
      return { channel: this.id, mode: "h5", payParams: { ...common, mode: "h5", h5_url: res.h5Url } };
    }
    if (mode === "jsapi") {
      const res = await this.createJsapi(input);
      return {
        channel: this.id,
        mode: "jsapi",
        payParams: { ...common, mode: "jsapi", prepay_id: res.prepayId, pay_sign: res.paySign },
      };
    }
    throw new ChannelError("CHANNEL_INVALID_REQUEST", `wechat does not support payment mode ${mode}`);
  }

  // ── 查单 / 关单 / 退款 ──────────────────────────────────────────────────

  async query(outTradeNo: string): Promise<ChannelQueryResult> {
    const path =
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}` +
      `?mchid=${encodeURIComponent(this.config.mchId)}`;
    const { json } = await this.callApi("GET", path);
    const tradeState = typeof json.trade_state === "string" ? json.trade_state : "UNKNOWN";
    const amount = json.amount as { total?: number } | undefined;
    return {
      paid: tradeState === "SUCCESS",
      status: tradeState,
      channelOrderId: typeof json.transaction_id === "string" ? json.transaction_id : undefined,
      amountCents: typeof amount?.total === "number" ? amount.total : undefined,
      raw: json,
    };
  }

  async close(outTradeNo: string): Promise<void> {
    await this.callApi("POST", `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`, {
      mchid: this.config.mchId,
    });
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const body: Record<string, unknown> = {
      out_trade_no: input.outTradeNo,
      out_refund_no: input.outRefundNo,
      amount: { refund: input.refundCents, total: input.totalCents, currency: "CNY" },
    };
    if (input.reason) body.reason = input.reason;
    if (input.notifyUrl ?? this.config.notifyUrl) body.notify_url = input.notifyUrl ?? this.config.notifyUrl;
    const { json } = await this.callApi("POST", "/v3/refund/domestic/refunds", body);
    return {
      refundId: typeof json.refund_id === "string" ? json.refund_id : undefined,
      status: typeof json.status === "string" ? json.status : undefined,
      raw: json,
    };
  }
}
