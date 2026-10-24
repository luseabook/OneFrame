import { createSign, createVerify } from "node:crypto";
import { stringify as stringifyQuery } from "node:querystring";
import { ChannelError, isChannelError } from "./errors";
import { defaultSleep, sendWithRetry, type FetchLike, type HttpResult } from "./http";
import {
  centsToYuan,
  yuanToCents,
  type ChannelQueryResult,
  type CreatePaymentInput,
  type CreatedPayment,
  type PaymentChannelAdapter,
  type PaymentMode,
  type RefundInput,
  type RefundResult,
} from "./types";

/**
 * 支付宝开放平台适配器（RSA2）。
 *
 * 请求签名规则：
 * 1) 公共参数 app_id / method / format=JSON / charset=utf-8 / sign_type=RSA2 /
 *    timestamp / version=1.0 / notify_url（可选）/ biz_content（JSON 字符串）；
 * 2) 按 key 升序、过滤空值与 sign、`k=v` 用 `&` 拼接（**sign_type 参与请求签名**）；
 * 3) 应用私钥 RSA-SHA256 签名，Base64 后作为 sign 随表单提交。
 *
 * 异步通知验签在 payment-signature.ts（排除 sign/sign_type，与官方一致）。
 * 响应验签（配置了支付宝公钥时）对响应节点原文做 RSA-SHA256 校验，防中间人篡改。
 */

export const ALIPAY_DEFAULT_GATEWAY = "https://openapi.alipay.com/gateway.do";

export interface AlipayConfig {
  appId: string;
  /** 应用私钥（PKCS#8 PEM），用于请求签名 */
  appPrivateKeyPem: string;
  /** 支付宝公钥（PEM），用于响应/回调验签；未配置则跳过响应验签 */
  publicKeyPem?: string;
  gateway?: string;
  notifyUrl?: string;
  signType?: "RSA2";
  fetchImpl?: FetchLike;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface AlipayPrecreateResult {
  mode: "precreate";
  qrCode: string;
  raw: unknown;
}

export interface AlipayPagePayResult {
  mode: "page";
  payUrl: string;
  params: Record<string, string>;
}

interface AlipayResponseNode {
  code?: string;
  msg?: string;
  sub_code?: string;
  sub_msg?: string;
  [key: string]: unknown;
}

const RETRYABLE_BIZ_CODES = new Set(["20000", "20001"]); // 服务不可用 / 授权不足（渠道侧兜底重试）

export class AlipayAdapter implements PaymentChannelAdapter {
  readonly id = "alipay" as const;
  readonly modes: PaymentMode[] = ["page", "precreate"];

  private readonly gateway: string;

  constructor(private readonly config: AlipayConfig) {
    this.gateway = config.gateway ?? ALIPAY_DEFAULT_GATEWAY;
  }

  // ── 签名 ────────────────────────────────────────────────────────────────

  /** 待签名字符串：key 升序，排除 sign 与空值，`k=v` 以 `&` 连接 */
  buildSignContent(params: Record<string, string | undefined>): string {
    return Object.keys(params)
      .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== "")
      .sort()
      .map((k) => `${k}=${params[k] as string}`)
      .join("&");
  }

  signContentWithAppKey(content: string): string {
    const signer = createSign("RSA-SHA256");
    signer.update(content, "utf8");
    signer.end();
    return signer.sign(this.config.appPrivateKeyPem, "base64");
  }

  /** 公共参数（未签名） */
  buildCommonParams(
    method: string,
    bizContent: Record<string, unknown>,
    opts: { notifyUrl?: string; returnUrl?: string } = {},
  ): Record<string, string> {
    const params: Record<string, string> = {
      app_id: this.config.appId,
      method,
      format: "JSON",
      charset: "utf-8",
      sign_type: this.config.signType ?? "RSA2",
      timestamp: this.formatTimestamp(this.config.now?.() ?? new Date()),
      version: "1.0",
      biz_content: JSON.stringify(bizContent),
    };
    const notifyUrl = opts.notifyUrl ?? this.config.notifyUrl;
    if (notifyUrl) params.notify_url = notifyUrl;
    if (opts.returnUrl) params.return_url = opts.returnUrl;
    return params;
  }

  formatTimestamp(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
  }

  /** 组装并签名完整请求参数（含 sign） */
  buildSignedParams(
    method: string,
    bizContent: Record<string, unknown>,
    opts: { notifyUrl?: string; returnUrl?: string } = {},
  ): Record<string, string> {
    const params = this.buildCommonParams(method, bizContent, opts);
    params.sign = this.signContentWithAppKey(this.buildSignContent(params));
    return params;
  }

  // ── 请求 ────────────────────────────────────────────────────────────────

  /** 找响应节点原文（响应验签必须对原文而不是重新序列化后的字符串） */
  private extractRawNode(text: string, nodeKey: string): string | null {
    const marker = `"${nodeKey}"`;
    const markerIndex = text.indexOf(marker);
    if (markerIndex < 0) return null;
    const colonIndex = text.indexOf(":", markerIndex + marker.length);
    if (colonIndex < 0) return null;
    let start = colonIndex + 1;
    while (start < text.length && /\s/.test(text[start])) start += 1;
    if (text[start] !== "{") return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  private verifyResponseSignature(rawText: string, nodeKey: string): void {
    if (!this.config.publicKeyPem) return;
    let parsed: { sign?: string };
    try {
      parsed = JSON.parse(rawText) as { sign?: string };
    } catch {
      return;
    }
    if (!parsed.sign) return;
    const rawNode = this.extractRawNode(rawText, nodeKey);
    if (!rawNode) {
      throw new ChannelError("CHANNEL_SIGNATURE_INVALID", "alipay response node not found for verification");
    }
    const verifier = createVerify("RSA-SHA256");
    verifier.update(rawNode, "utf8");
    verifier.end();
    const ok = verifier.verify(this.config.publicKeyPem, Buffer.from(parsed.sign, "base64"));
    if (!ok) {
      throw new ChannelError("CHANNEL_SIGNATURE_INVALID", "alipay response signature verification failed");
    }
  }

  private mapAlipayError(node: AlipayResponseNode, httpStatus: number): ChannelError {
    const vendorCode = node.sub_code ?? node.code ?? "UNKNOWN";
    const message = node.sub_msg ?? node.msg ?? "alipay business error";
    if (RETRYABLE_BIZ_CODES.has(String(node.code))) {
      return new ChannelError("CHANNEL_SERVER_ERROR", message, {
        retryable: true,
        httpStatus,
        vendorCode,
        details: { channel: "alipay", code: node.code, sub_code: node.sub_code },
      });
    }
    return new ChannelError("CHANNEL_BUSINESS_ERROR", message, {
      retryable: false,
      httpStatus,
      vendorCode,
      details: { channel: "alipay", code: node.code, sub_code: node.sub_code, sub_msg: node.sub_msg },
    });
  }

  private async callApi(
    method: string,
    bizContent: Record<string, unknown>,
    opts: { notifyUrl?: string; returnUrl?: string; retries?: number } = {},
  ): Promise<AlipayResponseNode> {
    const retries = Math.max(0, opts.retries ?? this.config.retries ?? 2);
    const sleep = this.config.sleep ?? defaultSleep;
    const baseDelayMs = this.config.baseDelayMs ?? 300;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));
      try {
        return await this.callApiOnce(method, bizContent, opts);
      } catch (err) {
        lastError = err;
        // HTTP 层重试已在 sendWithRetry 内完成；这里补渠道业务码级重试（如支付宝 20000 服务不可用）
        const retryableBiz = isChannelError(err) && err.retryable && err.httpStatus === 200;
        if (!retryableBiz || attempt === retries) throw err;
      }
    }
    throw lastError;
  }

  private async callApiOnce(
    method: string,
    bizContent: Record<string, unknown>,
    opts: { notifyUrl?: string; returnUrl?: string; retries?: number } = {},
  ): Promise<AlipayResponseNode> {
    const params = this.buildSignedParams(method, bizContent, opts);
    const body = stringifyQuery(params);
    let httpResult: HttpResult;
    try {
      httpResult = await sendWithRetry(
        this.config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike),
        {
          method: "POST",
          url: this.gateway,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            Accept: "application/json",
          },
          body,
        },
        {
          retries: opts.retries ?? this.config.retries,
          baseDelayMs: this.config.baseDelayMs,
          timeoutMs: this.config.timeoutMs,
          sleep: this.config.sleep,
        },
      );
    } catch (err) {
      throw err instanceof ChannelError ? err : new ChannelError("CHANNEL_NETWORK", String(err));
    }

    const nodeKey = `${method.replace(/\./g, "_")}_response`;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(httpResult.text) as Record<string, unknown>;
    } catch {
      throw new ChannelError("CHANNEL_INVALID_RESPONSE", "alipay response is not valid JSON", {
        details: { body: httpResult.text.slice(0, 512) },
      });
    }

    const rawNode = parsed[nodeKey] ?? parsed.error_response;
    if (!rawNode || typeof rawNode !== "object") {
      throw new ChannelError("CHANNEL_INVALID_RESPONSE", `alipay response missing ${nodeKey}`, {
        details: { fields: Object.keys(parsed) },
      });
    }
    this.verifyResponseSignature(httpResult.text, parsed[nodeKey] ? nodeKey : "error_response");

    const node = rawNode as AlipayResponseNode;
    if (node.code !== "10000") throw this.mapAlipayError(node, httpResult.status);
    return node;
  }

  // ── 下单 ────────────────────────────────────────────────────────────────

  async precreate(input: CreatePaymentInput): Promise<AlipayPrecreateResult> {
    const node = await this.callApi(
      "alipay.trade.precreate",
      {
        out_trade_no: input.outTradeNo,
        total_amount: centsToYuan(input.amountCents),
        subject: input.description,
      },
      { notifyUrl: input.notifyUrl },
    );
    const qrCode = node.qr_code;
    if (typeof qrCode !== "string" || qrCode === "") {
      throw new ChannelError("CHANNEL_INVALID_RESPONSE", "alipay precreate response missing qr_code", {
        details: { fields: Object.keys(node) },
      });
    }
    return { mode: "precreate", qrCode, raw: node };
  }

  /** 电脑网站支付：返回收银台跳转 URL（表单参数签名后拼 query） */
  pagePay(input: CreatePaymentInput): AlipayPagePayResult {
    const params = this.buildSignedParams(
      "alipay.trade.page.pay",
      {
        out_trade_no: input.outTradeNo,
        total_amount: centsToYuan(input.amountCents),
        subject: input.description,
        product_code: "FAST_INSTANT_TRADE_PAY",
      },
      { notifyUrl: input.notifyUrl, returnUrl: input.returnUrl },
    );
    const payUrl = `${this.gateway}${this.gateway.includes("?") ? "&" : "?"}${stringifyQuery(params)}`;
    return { mode: "page", payUrl, params };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const mode = input.mode ?? "page";
    const common = {
      channel: this.id,
      out_trade_no: input.outTradeNo,
      amount_cents: input.amountCents,
    };
    if (mode === "page") {
      const res = this.pagePay(input);
      return { channel: this.id, mode: "page", payParams: { ...common, mode: "page", pay_url: res.payUrl } };
    }
    if (mode === "precreate") {
      const res = await this.precreate(input);
      return { channel: this.id, mode: "precreate", payParams: { ...common, mode: "precreate", qr_code: res.qrCode } };
    }
    throw new ChannelError("CHANNEL_INVALID_REQUEST", `alipay does not support payment mode ${mode}`);
  }

  // ── 查单 / 关单 / 退款 ──────────────────────────────────────────────────

  async query(outTradeNo: string): Promise<ChannelQueryResult> {
    const node = await this.callApi("alipay.trade.query", { out_trade_no: outTradeNo });
    const status = typeof node.trade_status === "string" ? node.trade_status : "UNKNOWN";
    return {
      paid: status === "TRADE_SUCCESS" || status === "TRADE_FINISHED",
      status,
      channelOrderId: typeof node.trade_no === "string" ? node.trade_no : undefined,
      amountCents: yuanToCents(typeof node.total_amount === "string" ? node.total_amount : undefined),
      raw: node,
    };
  }

  async close(outTradeNo: string): Promise<void> {
    await this.callApi("alipay.trade.close", { out_trade_no: outTradeNo });
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const node = await this.callApi("alipay.trade.refund", {
      out_trade_no: input.outTradeNo,
      refund_amount: centsToYuan(input.refundCents),
      out_request_no: input.outRefundNo,
      ...(input.reason ? { refund_reason: input.reason } : {}),
    });
    return {
      refundId: typeof node.trade_no === "string" ? node.trade_no : undefined,
      status: typeof node.fund_change === "string" ? node.fund_change : undefined,
      raw: node,
    };
  }
}
