import type { Envelope } from "~/types/api";

export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// 统一 API 客户端：信封解包、Bearer 注入、access 过期自动 refresh 重试一次
export const useApi = () => {
  const config = useRuntimeConfig();
  const base = (config.public.apiBase as string) || "";
  const auth = useAuth();

  async function request<T>(path: string, options: Record<string, unknown> = {}, retried = false): Promise<T> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };
    if (auth.state.value.accessToken) headers.Authorization = `Bearer ${auth.state.value.accessToken}`;
    // 团队空间切换（ADR-010）：团队场景的所有请求都带 X-Space-Id；
    // 服务端会校验成员身份（不是只信这个头），非成员返回 403。
    const activeSpace = useActiveSpaceId();
    if (activeSpace.value) headers["X-Space-Id"] = activeSpace.value;

    let envelope: Envelope<T> | undefined;
    try {
      envelope = await $fetch<Envelope<T>>(`${base}/v1${path}`, {
        credentials: "include",
        ...options,
        headers,
      });
    } catch (error) {
      const data = (error as { data?: Envelope<T> }).data;
      if (data && typeof data.code === "number") envelope = data;
      else throw new ApiError(500000, (error as Error).message || "网络错误");
    }

    if (!envelope) throw new ApiError(500000, "空响应");
    if (envelope.code === 401101 || envelope.code === 401102) {
      if (!retried && (await auth.refresh())) return request<T>(path, options, true);
      throw new ApiError(envelope.code, envelope.msg || "登录已过期");
    }
    if (envelope.code !== 0) throw new ApiError(envelope.code, envelope.msg || "请求失败");
    return envelope.data as T;
  }

  return {
    get: <T>(path: string, options: Record<string, unknown> = {}) => request<T>(path, { method: "GET", ...options }),
    post: <T>(path: string, body?: unknown, options: Record<string, unknown> = {}) =>
      request<T>(path, { method: "POST", body, ...options }),
    put: <T>(path: string, body?: unknown, options: Record<string, unknown> = {}) =>
      request<T>(path, { method: "PUT", body, ...options }),
    patch: <T>(path: string, body?: unknown, options: Record<string, unknown> = {}) =>
      request<T>(path, { method: "PATCH", body, ...options }),
    delete: <T>(path: string, options: Record<string, unknown> = {}) =>
      request<T>(path, { method: "DELETE", ...options }),
  };
};
