// 供应商错误统一映射（docs/02-architecture/system-design.md §4.1）
//
// 目标：Ark（视频/图像）与 DeepSeek 共用同一套「供应商错误体 → 归一化错误码」逻辑，
// 上层只看 kind / retryable，不再按供应商判断。错误文案保持既有前缀（`ark ... -> 400:` /
// `deepseek http 500:`），避免破坏已上线的日志与告警匹配。

export type VendorErrorKind =
  /** 鉴权失败（Key 无效/过期/权限不足）：401、403 */
  | "auth_error"
  /** 余额/配额不足（DeepSeek 402）：不重试，需运营充值 */
  | "quota_exceeded"
  /** 参数或模型/路径不存在：400、404、422 */
  | "invalid_param"
  /** 限流：429，可重试（指数退避） */
  | "rate_limited"
  /** 内容审核拒绝：任务置 REVIEW_REJECTED（745802），不重试、不结算 */
  | "output_rejected"
  /** 供应商执行失败 / 响应格式错误 / 成功但无产物：不重试 */
  | "vendor_error"
  /** 请求超时（AbortController）：可重试 */
  | "timeout"
  /** 网络层错误（DNS/连接重置等）：可重试 */
  | "network_error";

export interface VendorErrorDetails {
  vendor?: string;
  operation?: string;
  status?: number;
  /** 供应商原始业务码（如 OutputImageSensitiveContentDetected / InvalidParameter） */
  vendorCode?: string;
  retryable: boolean;
}

/** 归一化供应商错误基类：所有适配器对外抛出的错误都是它的实例 */
export class VendorError extends Error {
  readonly kind: VendorErrorKind;
  readonly vendor?: string;
  readonly operation?: string;
  readonly status?: number;
  readonly vendorCode?: string;
  readonly retryable: boolean;

  constructor(kind: VendorErrorKind, message: string, details: VendorErrorDetails) {
    super(message);
    this.name = "VendorError";
    this.kind = kind;
    this.vendor = details.vendor;
    this.operation = details.operation;
    this.status = details.status;
    this.vendorCode = details.vendorCode;
    this.retryable = details.retryable;
  }
}

/**
 * 可重试的供应商失败（429 / 5xx / 超时 / 网络）。
 * 保留独立类名：既有适配器与测试用 instanceof 判断重试语义。
 */
export class RetryableVendorError extends VendorError {
  constructor(
    message: string,
    status?: number,
    options: { kind?: VendorErrorKind; vendor?: string; operation?: string; vendorCode?: string } = {},
  ) {
    super(options.kind ?? kindForStatus(status), message, {
      vendor: options.vendor,
      operation: options.operation,
      vendorCode: options.vendorCode,
      status,
      retryable: true,
    });
    this.name = "RetryableVendorError";
  }
}

/** 重试判定统一入口：不要在适配器里散落 instanceof / status 判断 */
export function isRetryableVendorError(err: unknown): boolean {
  return err instanceof VendorError && err.retryable;
}

export function isVendorError(err: unknown): err is VendorError {
  return err instanceof VendorError;
}

/** 供应商错误体解析结果（兼容 {error:{code,message}} / {code,message} / {error:"..."}） */
export interface ParsedVendorErrorBody {
  code?: string;
  message?: string;
  type?: string;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

export function parseVendorErrorBody(bodyText: string): ParsedVendorErrorBody {
  const text = bodyText.trim();
  if (!text.startsWith("{")) return {};
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  if (!json || typeof json !== "object") return {};
  const record = json as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : undefined;

  const code = asString(nested?.code) ?? asString(record.code);
  const message =
    asString(nested?.message) ??
    asString(record.message) ??
    asString(record.msg) ??
    // {error: "some message"}
    asString(record.error);
  const type = asString(nested?.type) ?? asString(record.type);
  const out: ParsedVendorErrorBody = {};
  if (code) out.code = code;
  if (message) out.message = message;
  if (type) out.type = type;
  return out;
}

// 内容审核信号：不同供应商用不同码/文案，统一在此识别。
// 命中即 output_rejected（任务码 745802）：不重试、解冻积分、前端给可改提示词的失败原因。
const CONTENT_REJECTION_PATTERNS: RegExp[] = [
  /sensitive/i,
  /audit/i,
  /content[_ -]?policy/i,
  /content[_ -]?review/i,
  /review[_ -]?(rejected|failed|denied)/i,
  /moderation/i,
  /nsfw/i,
  /(^|[^a-z])rejected([^a-z]|$)/i,
  /审核/,
  /敏感/,
  /违规/,
  /不合规/,
];

export function looksLikeContentRejection(signals: string): boolean {
  if (!signals) return false;
  return CONTENT_REJECTION_PATTERNS.some((pattern) => pattern.test(signals));
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function kindForStatus(status: number | undefined): VendorErrorKind {
  if (status === 401 || status === 403) return "auth_error";
  if (status === 402) return "quota_exceeded";
  if (status === 429) return "rate_limited";
  if (typeof status === "number" && status >= 500) return "vendor_error";
  if (status === 400 || status === 404 || status === 422) return "invalid_param";
  return "vendor_error";
}

export interface VendorHttpErrorContext {
  /** 供应商标签，用于默认文案前缀（ark / deepseek） */
  vendor: string;
  /** 操作描述，如 `POST /api/v3/images/generations` */
  operation: string;
  /**
   * 覆盖报错前缀（保持既有对外文案兼容）。
   * 默认 `${vendor} ${operation} -> `，DeepSeek 传 `deepseek http `。
   */
  messagePrefix?: string;
  /** 覆盖重试判定（默认：429/5xx 可重试）；显式 false 用于轮询等不宜重试的场景 */
  retryable?: boolean;
}

/**
 * 把 HTTP 非 2xx（以及 200 + error 体）映射为统一的 VendorError。
 *
 * | 状态 | kind | 重试 |
 * |---|---|---|
 * | 401 / 403 | auth_error | 否 |
 * | 402 | quota_exceeded | 否 |
 * | 429 | rate_limited | 是 |
 * | 400 / 404 / 422 | invalid_param | 否 |
 * | 5xx | vendor_error | 是 |
 * | 其他 4xx | vendor_error | 否 |
 * | 错误体命中内容审核信号（任意状态） | output_rejected | 否 |
 */
export function classifyVendorHttpError(
  status: number,
  bodyText: string,
  context: VendorHttpErrorContext,
): VendorError {
  const parsed = parseVendorErrorBody(bodyText);
  // 只保留截断后的供应商文案：绝不把完整响应体写进错误信息/日志
  const snippet = truncate(parsed.message ?? bodyText, 300) || "(empty body)";
  const prefix = context.messagePrefix ?? `${context.vendor} ${context.operation} -> `;
  const message = `${prefix}${status}: ${snippet}`;
  const base = { vendor: context.vendor, operation: context.operation, vendorCode: parsed.code };

  // 审核信号优先级最高：即便返回 400/403，也必须是 output_rejected（可改提示词重试）
  const signals = `${parsed.code ?? ""} ${parsed.message ?? ""} ${parsed.type ?? ""} ${bodyText.slice(0, 500)}`;
  if (looksLikeContentRejection(signals)) {
    return new VendorError("output_rejected", message, { ...base, status, retryable: false });
  }

  const retryable = context.retryable ?? (status === 429 || status >= 500);
  const kind = kindForStatus(status);
  if (retryable) return new RetryableVendorError(message, status, { ...base, kind });
  return new VendorError(kind, message, { ...base, status, retryable: false });
}

/** 网络层/超时错误统一归一化：一律可重试 */
export function classifyVendorNetworkError(
  err: unknown,
  context: { vendor: string; operation?: string },
): RetryableVendorError {
  const name = err instanceof Error ? err.name : "";
  const kind: VendorErrorKind = name === "AbortError" || name === "TimeoutError" ? "timeout" : "network_error";
  const reason = err instanceof Error ? err.message : String(err);
  const label = kind === "timeout" ? "timeout" : "network error";
  const operation = context.operation ? ` ${context.operation}` : "";
  return new RetryableVendorError(`${context.vendor}${operation} ${label}: ${truncate(reason, 200)}`, undefined, {
    kind,
    vendor: context.vendor,
    operation: context.operation,
  });
}

/** 供应商 2xx 但响应体不可用（非 JSON / 结构错误）：不可重试的 vendor_error */
export function vendorProtocolError(
  message: string,
  context: { vendor: string; operation?: string; status?: number },
): VendorError {
  return new VendorError("vendor_error", message, {
    vendor: context.vendor,
    operation: context.operation,
    status: context.status,
    retryable: false,
  });
}

/**
 * 读取供应商 2xx JSON 响应：优先 res.json()，失败时退化到 text() 解析；
 * 两者都不可解析 → vendorProtocolError（不可重试）。
 */
export async function readVendorJson(
  res: Response,
  context: { vendor: string; operation: string },
): Promise<Record<string, unknown>> {
  const asObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  try {
    return asObject(await res.json());
  } catch {
    // 部分网关/测试替身只实现 text()：退化为文本解析
  }
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    raw = "";
  }
  if (!raw.trim()) return {};
  try {
    return asObject(JSON.parse(raw));
  } catch {
    throw vendorProtocolError(`${context.vendor} ${context.operation} invalid json response`, {
      vendor: context.vendor,
      operation: context.operation,
      status: res.status,
    });
  }
}

/** 提交前参数校验失败：不可重试 */
export function vendorParamError(
  message: string,
  context: { vendor: string; operation?: string },
): VendorError {
  return new VendorError("invalid_param", message, {
    vendor: context.vendor,
    operation: context.operation,
    retryable: false,
  });
}
