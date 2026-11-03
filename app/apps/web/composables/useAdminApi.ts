/**
 * 运营后台专用 API 客户端。
 *
 * 为什么不复用 `useApi`：后台是**独立身份域**——token 只存在
 * `localStorage.admin_token`，不参与用户端 refresh，也不带 `X-Space-Id` / `X-Lang`。
 * 两套身份混用会让"这条操作是谁做的"变成糊涂账（admin_users 与 users 的 id 空间不同，
 * 见 `packages/db/src/schema.ts` 的 admin 相关注释）。
 *
 * 只在客户端调用（后台页全部 `ssr:false`），所以这里直接用 localStorage。
 */

import { filenameFromDisposition, isEnvelopeContentType, readEnvelopeError } from "~/utils/download-response";

export interface AdminEnvelope<T> {
  code: number;
  msg: string;
  data: T | null;
}

/** 后台 API 错误：保留业务码，调用方据此区分"回登录页"与"就地报错" */
export class AdminApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export function adminToken(): string {
  if (import.meta.server) return "";
  return localStorage.getItem("admin_token") ?? "";
}

export function adminErrorCode(error: unknown): number | undefined {
  return error instanceof AdminApiError ? error.code : undefined;
}

/**
 * 只有**认证态**错误才应回登录页（token 过期 / 账号被停用 / 改密后旧 token 失效）。
 *
 * 为什么不把 403101 也当认证错误：403101 是"角色不够"（例如 viewer 点了写操作），
 * 重新登录还是同一个角色，清 token 跳登录只会形成"登录→再被拒"的死循环。
 * 403 应当就地提示权限不足（各面板自己处理），不踢人。
 */
export function isAdminAuthError(error: unknown): boolean {
  return adminErrorCode(error) === 401101;
}

/** 角色不足（403101）：就地提示，不要清 token */
export function isAdminRoleError(error: unknown): boolean {
  return adminErrorCode(error) === 403101;
}

export interface AdminRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * 后台请求：自动加 `/v1` 前缀、Bearer token，并解包 `{code,msg,data}` 信封。
 * 非 0 code 一律抛 `AdminApiError`（保留 msg，页面直接展示）。
 */
export async function adminApi<T>(path: string, options: AdminRequestOptions = {}): Promise<T> {
  const token = adminToken();
  let envelope: AdminEnvelope<T> | undefined;
  try {
    envelope = await $fetch<AdminEnvelope<T>>(`/v1${path}`, {
      method: options.method ?? "GET",
      ...(options.body === undefined ? {} : { body: options.body as never }),
      headers: {
        ...(options.headers ?? {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (error) {
    // 后端错误信封在 `error.data` 里（$fetch 对非 2xx 会抛）；能解出 code 就按业务错误处理
    const data = (error as { data?: AdminEnvelope<T> }).data;
    if (data && typeof data.code === "number") envelope = data;
    else throw new AdminApiError(500000, (error as Error).message || "网络错误");
  }
  if (!envelope) throw new AdminApiError(500000, "空响应");
  if (envelope.code !== 0) throw new AdminApiError(envelope.code, envelope.msg || "请求失败");
  return envelope.data as T;
}

/**
 * 下载 CSV（后台导出）。不用 `$fetch`：要拿原始响应体与 `content-disposition` 文件名。
 * 401/403 同样走 AdminApiError，调用方可决定是否回登录。
 *
 * **分流判据是 `content-type`，不是 `response.ok`**（N-13）：后端全局异常过滤器把
 * `AppError` 一律输出成 **HTTP 200 + `{code,msg}`**（`exception.filter.ts:19-22`），
 * 所以「未登录/无权限」在 HTTP 层也是 200。旧实现只在 `!response.ok` 里判 code，
 * 结果把错误 JSON 当 CSV 返回给用户下载。判据抽在 `~/utils/download-response`。
 */
export async function adminApiBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = adminToken();
  const response = await fetch(`/v1${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  if (isEnvelopeContentType(response.headers.get("content-type"))) {
    const envelope = await response.json().catch(() => null);
    const { code, message } = readEnvelopeError(envelope, response.status);
    throw new AdminApiError(code, message);
  }
  if (!response.ok) throw new AdminApiError(response.status, `下载失败(${response.status})`);

  const filename = filenameFromDisposition(response.headers.get("content-disposition"));
  return { blob: await response.blob(), filename: filename || "download.csv" };
}

/** 下载并触发浏览器保存（页面只调这一个函数即可） */
export async function downloadAdminCsv(path: string, fallbackName = "download.csv"): Promise<void> {
  const { blob, filename } = await adminApiBlob(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || fallbackName;
  link.click();
  URL.revokeObjectURL(url);
}
