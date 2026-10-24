import { ErrorCode } from "@app/shared";

/**
 * request_id 结构化请求日志的公共契约（docs/05-ops/observability.md §1）。
 *
 * 设计要点：
 * 1) 只记录**白名单字段**，绝不落请求体/查询串/Authorization/token/手机号全量；
 * 2) 单行 JSON（`JSON.stringify` 转义换行），可直接被 Loki/阿里云 SLS/Vector 采集；
 * 3) request_id 优先沿用上游传入的合法值（网关/前端串联），否则用 Fastify 的 genReqId，
 *    两者都写回响应头 `x-request-id`，保证"用户报障 → 日志定位"闭环。
 */

/** 响应头名：request_id 回传（与日志字段同值） */
export const REQUEST_ID_HEADER = "x-request-id";

/** 慢请求阈值：> 此值即 WARN（observability.md §1 告警规则） */
export const SLOW_REQUEST_MS = 2_000;

/** 日志级别：仅 info/warn（error 由 exception.filter 与 Sentry 承担，避免重复刷屏） */
export type RequestLogLevel = "info" | "warn";

/** 单条请求日志的固定字段集（顺序即输出顺序，便于 grep/采集侧做列裁剪） */
export interface RequestLogRecord {
  time: string;
  level: RequestLogLevel;
  msg: "http_request";
  request_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  space_id?: string;
  user_id?: string;
  error_code?: number;
  aborted?: true;
}

/** 请求级上下文：middleware 建 → interceptor 补鉴权/错误码 → finish 时出日志 */
export interface RequestLogContext {
  requestId: string;
  startedAt: number;
  spaceId?: string;
  userId?: string;
  errorCode?: number;
}

/**
 * 健康检查/指标探针不写请求日志：
 * k8s 每 5-10s 探一次，写日志只会把真正有信息量的业务请求挤出保留窗口。
 * 响应头仍然照常回写（排障需要）。
 */
const SKIP_LOG_PATHS: readonly string[] = [
  "/v1/healthz/live",
  "/v1/healthz/ready",
  "/v1/healthz",
  "/v1/metrics",
];

/** 只接受可安全写入日志与响应头的字符集，拒绝换行/空格/控制字符（防日志注入） */
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** 32+ 位无分隔符串视为不透明凭证（分享 token / 签名），落日志前脱敏 */
const OPAQUE_SEGMENT_RE = /^[A-Za-z0-9_-]{32,}$/;
/** 手机号（大陆 11 位）：即使误入 path 也必须掩码 */
const PHONE_RE = /(?<!\d)(1[3-9]\d{9})(?!\d)/g;

const CONTEXT_KEY = Symbol.for("oneframe.request-log");

/** 会话内取请求日志上下文（middleware 写入，interceptor 补字段） */
export function getLogContext(carrier: unknown): RequestLogContext | undefined {
  if (!carrier || typeof carrier !== "object") return undefined;
  return (carrier as Record<symbol, RequestLogContext | undefined>)[CONTEXT_KEY];
}

/** 绑定请求日志上下文到请求对象（同一对象引用，后续 enrich 直接生效） */
export function setLogContext(carrier: unknown, context: RequestLogContext): void {
  if (!carrier || typeof carrier !== "object") return;
  (carrier as Record<symbol, RequestLogContext>)[CONTEXT_KEY] = context;
}

/**
 * 解析 request_id：上游传入且合法则沿用，否则回退到 Fastify 生成值。
 * 非法值（含换行/超长/空白）一律丢弃，避免日志注入与响应头污染。
 */
export function resolveRequestId(
  incoming: string | string[] | undefined,
  fallback: string,
): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  if (typeof candidate === "string" && REQUEST_ID_RE.test(candidate)) return candidate;
  return fallback;
}

/** 手机号掩码：13800138000 → 138****8000 */
export function maskPhoneLike(value: string): string {
  return value.replace(PHONE_RE, (phone) => `${phone.slice(0, 3)}****${phone.slice(7)}`);
}

/**
 * 路径脱敏：
 * - 去掉查询串与 hash（查询串里可能是手机号/token/签名，禁记）；
 * - 32+ 位不透明串（分享 token、签名）替换为 `:redacted`；
 * - 保留 UUID（任务/空间 id 排障必需，且本身非凭证）；
 * - 兜底掩码手机号。
 */
export function sanitizePath(url: string | undefined): string {
  const raw = typeof url === "string" && url.length > 0 ? url : "/";
  const pathOnly = raw.split("?")[0]!.split("#")[0]!;
  const masked = pathOnly
    .split("/")
    .map((segment) =>
      OPAQUE_SEGMENT_RE.test(segment) && !UUID_RE.test(segment) ? ":redacted" : segment,
    )
    .join("/");
  return maskPhoneLike(masked || "/");
}

/** 是否跳过请求日志（探针类端点） */
export function shouldSkipRequestLog(path: string): boolean {
  return SKIP_LOG_PATHS.includes(path);
}

/**
 * HTTP 状态 → 错误码（与 api-spec §1 信封 code 同源，便于日志与响应码对照）。
 * 业务错误（HTTP 200 + 信封非 0）由 interceptor 从 AppError/HttpException 取真实 code。
 */
export function statusToErrorCode(status: number): number | undefined {
  if (status === 401) return ErrorCode.UNAUTHORIZED;
  if (status === 403) return ErrorCode.FORBIDDEN;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status === 429) return ErrorCode.RATE_LIMITED;
  if (status >= 500) return ErrorCode.INTERNAL;
  if (status >= 400) return ErrorCode.BAD_REQUEST;
  return undefined;
}

/** 5xx 与慢请求 WARN，其余 info */
export function resolveLevel(status: number, durationMs: number): RequestLogLevel {
  return status >= 500 || durationMs > SLOW_REQUEST_MS ? "warn" : "info";
}

/** 组装单行日志记录：字段顺序固定、undefined 字段不输出（避免空值污染采集侧） */
export function buildRequestLogRecord(
  context: RequestLogContext,
  params: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    aborted?: boolean;
  },
): RequestLogRecord {
  const durationMs = Math.max(0, Math.round(params.durationMs));
  const record: RequestLogRecord = {
    time: new Date().toISOString(),
    level: resolveLevel(params.status, durationMs),
    msg: "http_request",
    request_id: context.requestId,
    method: params.method.toUpperCase(),
    path: params.path,
    status: params.status,
    duration_ms: durationMs,
  };
  if (context.spaceId) record.space_id = context.spaceId;
  if (context.userId) record.user_id = context.userId;
  const errorCode = context.errorCode ?? statusToErrorCode(params.status);
  if (typeof errorCode === "number") record.error_code = errorCode;
  if (params.aborted) record.aborted = true;
  return record;
}
