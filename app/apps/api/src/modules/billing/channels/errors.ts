/**
 * 渠道错误统一模型。
 *
 * 与 AppError 的分工：
 * - ChannelError 只在 billing/channels 内使用，带渠道协议细节（vendorCode / httpStatus / retryable）；
 * - BillingService 负责把它映射成对外的 AppError（VENDOR_ERROR / VENDOR_TIMEOUT），
 *   绝不把渠道原始报文或凭据透给前端。
 */
export type ChannelErrorCode =
  /** 渠道凭据未配置（默认拒绝，绝不静默 mock） */
  | "CHANNEL_NOT_CONFIGURED"
  /** 传输层失败（DNS/连接重置/socket hang up） */
  | "CHANNEL_NETWORK"
  /** 请求超时 */
  | "CHANNEL_TIMEOUT"
  /** 渠道限流（HTTP 429 或渠道频控错误码） */
  | "CHANNEL_RATE_LIMITED"
  /** 渠道 5xx（重试后仍失败） */
  | "CHANNEL_SERVER_ERROR"
  /** 渠道 4xx 业务错误 / 渠道业务错误码（重试无意义） */
  | "CHANNEL_BUSINESS_ERROR"
  /** 商户签名/证书问题（401/403，或渠道返回签名相关错误码） */
  | "CHANNEL_AUTH_ERROR"
  /** 调用方入参不满足渠道要求（例如 H5 缺 clientIp、JSAPI 缺 openid） */
  | "CHANNEL_INVALID_REQUEST"
  /** 渠道响应不是合法 JSON / 缺必需字段 */
  | "CHANNEL_INVALID_RESPONSE"
  /** 渠道响应验签失败（防中间人篡改） */
  | "CHANNEL_SIGNATURE_INVALID";

export interface ChannelErrorOptions {
  /** 是否值得重试（service 层用于决定是否上抛 retryable 给前端提示） */
  retryable?: boolean;
  httpStatus?: number;
  /** 渠道业务错误码，例如微信 SYSTEM_ERROR / 支付宝 ACQ.TRADE_NOT_EXIST */
  vendorCode?: string;
  /** 附加排查信息（只放渠道返回的 code/message，绝不放密钥） */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class ChannelError extends Error {
  readonly code: ChannelErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly vendorCode?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ChannelErrorCode, message: string, options: ChannelErrorOptions = {}) {
    super(message);
    this.name = "ChannelError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus;
    this.vendorCode = options.vendorCode;
    this.details = options.details;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export function isChannelError(e: unknown): e is ChannelError {
  return e instanceof ChannelError;
}

export function notConfigured(channel: string, missing: string[]): ChannelError {
  return new ChannelError(
    "CHANNEL_NOT_CONFIGURED",
    `${channel} channel not configured (missing: ${missing.join(", ")})`,
    { details: { channel, missing } },
  );
}
