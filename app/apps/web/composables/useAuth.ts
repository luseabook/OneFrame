import type { Envelope, MeResponse, AuthUser, Credits } from "~/types/api";

interface AuthState {
  accessToken: string;
  user: AuthUser | null;
  spaceId: string | null;
  credits: Credits | null;
  /** 新手引导是否已关闭（PRD 增补 §3） */
  onboarded: boolean;
}

// 访问 token 仅内存态；refresh 走 HttpOnly Cookie（ADR-008）
export const useAuth = () => {
  const state = useState<AuthState>("auth", () => ({
    accessToken: "",
    user: null,
    spaceId: null,
    credits: null,
    onboarded: true,
  }));
  // 认证状态是否已确定：SSR 与客户端首次渲染时均为 false，
  // 用于避免登录态分支在 hydrate 前后渲染不一致（hydration mismatch）
  const ready = useState<boolean>("auth-ready", () => false);
  const config = useRuntimeConfig();
  const base = (config.public.apiBase as string) || "";

  async function call<T>(path: string, options: Record<string, unknown> = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };
    if (state.value.accessToken) headers.Authorization = `Bearer ${state.value.accessToken}`;
    const res = await $fetch<Envelope<T>>(`${base}/v1${path}`, {
      credentials: "include",
      ...options,
      headers,
    });
    if (res.code !== 0) throw new Error(res.msg || `请求失败(${res.code})`);
    return res.data as T;
  }

  async function login(
    phone: string,
    code: string,
    inviteCode?: string,
    ageConfirmed = false,
  ): Promise<void> {
    const data = await call<{
      access_token: string;
      expires_in: number;
      user: AuthUser;
      space_id: string;
    }>("/auth/login", {
      method: "POST",
      body: {
        phone,
        code,
        ...(inviteCode ? { invite_code: inviteCode } : {}),
        age_confirmed: ageConfirmed,
      },
    });
    state.value = {
      accessToken: data.access_token,
      user: data.user,
      spaceId: data.space_id,
      credits: null,
    };
    await me();
    ready.value = true;
  }

  // refresh 单飞：同一页面的 bootstrap 与路由中间件会并发触发 refresh；
  // refresh token 是单次消费（服务端轮换），并发调用会有一次拿到旧 token 失败，
  // 导致「刚登录却被重定向回登录页」。这里共享同一个在途 Promise。
  let refreshPromise: Promise<boolean> | null = null;
  async function doRefresh(): Promise<boolean> {
    try {
      const data = await call<{ access_token: string; user: AuthUser; space_id: string }>("/auth/refresh", {
        method: "POST",
      });
      state.value = {
        ...state.value,
        accessToken: data.access_token,
        user: data.user,
        spaceId: data.space_id,
      };
      // 续期后立即回拉资料与积分，否则刷新页面后 credits 一直为 null（顶栏显示 0）
      await me();
      return true;
    } catch {
      return false;
    }
  }
  function refresh(): Promise<boolean> {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  async function me(): Promise<void> {
    const data = await call<MeResponse>("/me");
    state.value = {
      ...state.value,
      user: data.user,
      spaceId: data.space.id,
      credits: data.credits,
      onboarded: data.onboarded ?? true,
    };
  }

  /** 关闭新手引导条（持久化到服务端） */
  async function dismissOnboarding(): Promise<void> {
    state.value = { ...state.value, onboarded: true };
    try {
      await call("/me/onboarded", { method: "POST" });
    } catch {
      // 失败不阻断 UI；下次进入会再次提示
    }
  }

  async function logout(): Promise<void> {
    try {
      if (state.value.accessToken) await call("/auth/logout", { method: "POST" });
    } finally {
      state.value = { accessToken: "", user: null, spaceId: null, credits: null, onboarded: true };
      ready.value = true;
    }
  }

  async function bootstrap(): Promise<void> {
    try {
      if (state.value.accessToken) {
        await me();
        return;
      }
      await refresh();
    } finally {
      // 认证状态已确定（无论成功与否）：供 UI 决定是否渲染登录态分支
      ready.value = true;
    }
  }

  return { state, ready, login, refresh, me, logout, bootstrap, dismissOnboarding };
};
