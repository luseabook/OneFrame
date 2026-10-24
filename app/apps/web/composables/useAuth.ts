import type { Envelope, MeResponse, AuthUser, Credits } from "~/types/api";

interface AuthState {
  accessToken: string;
  user: AuthUser | null;
  spaceId: string | null;
  credits: Credits | null;
}

// 访问 token 仅内存态；refresh 走 HttpOnly Cookie（ADR-008）
export const useAuth = () => {
  const state = useState<AuthState>("auth", () => ({
    accessToken: "",
    user: null,
    spaceId: null,
    credits: null,
  }));
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

  async function login(phone: string, code: string, inviteCode?: string): Promise<void> {
    const data = await call<{
      access_token: string;
      expires_in: number;
      user: AuthUser;
      space_id: string;
    }>("/auth/login", {
      method: "POST",
      body: { phone, code, ...(inviteCode ? { invite_code: inviteCode } : {}) },
    });
    state.value = {
      accessToken: data.access_token,
      user: data.user,
      spaceId: data.space_id,
      credits: null,
    };
    await me();
  }

  async function refresh(): Promise<boolean> {
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
      return true;
    } catch {
      return false;
    }
  }

  async function me(): Promise<void> {
    const data = await call<MeResponse>("/me");
    state.value = {
      ...state.value,
      user: data.user,
      spaceId: data.space.id,
      credits: data.credits,
    };
  }

  async function logout(): Promise<void> {
    try {
      if (state.value.accessToken) await call("/auth/logout", { method: "POST" });
    } finally {
      state.value = { accessToken: "", user: null, spaceId: null, credits: null };
    }
  }

  async function bootstrap(): Promise<void> {
    if (state.value.accessToken) return;
    await refresh();
  }

  return { state, login, refresh, me, logout, bootstrap };
};
