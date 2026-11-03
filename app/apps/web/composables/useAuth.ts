import type { Envelope, MeResponse, AuthUser, Credits } from "~/types/api";

interface AuthState {
  accessToken: string;
  user: AuthUser | null;
  spaceId: string | null;
  credits: Credits | null;
  /** 新手引导是否已关闭（PRD 增补 §3） */
  onboarded: boolean;
  /**
   * LLM 运行形态，来自 `/v1/me` 的**根部字段** `llm_mode`（不在 `user` 里，部署实测确认）。
   * null = 尚未取到（未登录 / 还没调过 me）→ 横幅一律不渲染，避免谎报。
   */
  llmMode: "real" | "mock" | null;
}

// 访问 token 仅内存态；refresh 走 HttpOnly Cookie（ADR-008）
export const useAuth = () => {
  const state = useState<AuthState>("auth", () => ({
    accessToken: "",
    user: null,
    spaceId: null,
    credits: null,
    onboarded: true,
    llmMode: null,
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
    keepLogin = true,
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
        // 语义由后端定（auth-spec §17.35）：false → 会话 Cookie（关浏览器即失效），
        // 缺省 true → Max-Age=REFRESH_TTL_S。此前这个复选框是装饰品，现在真正生效。
        keep_login: keepLogin,
      },
    });
    state.value = {
      accessToken: data.access_token,
      user: data.user,
      spaceId: data.space_id,
      credits: null,
      onboarded: state.value.onboarded,
      // 登录/注册响应不带部署形态；紧随其后的 me() 会用 /v1/me 的根部 llm_mode 填上
      llmMode: null,
    };
    await me();
    ready.value = true;
  }

  /**
   * 密码登录（`identifier` = 手机号或邮箱）。
   *
   * 契约（Backend 已定）：`POST /v1/auth/login/password {identifier, password}`，
   * 返回体与 `/auth/login` 同形，refresh 走同一个 HttpOnly Cookie。
   *
   * 收尾逻辑与 `login()` 逐字一致；**刻意不复制「首次建号 / 发礼包 / 邀请码核销」**——
   * 那些属于服务端建号路径（`createAccountWithIdentity`），前端照抄只会制造第二份真相。
   */
  async function loginWithPassword(identifier: string, password: string, keepLogin = true): Promise<void> {
    const data = await call<{
      access_token: string;
      expires_in: number;
      user: AuthUser;
      space_id: string;
    }>("/auth/login/password", {
      method: "POST",
      body: { identifier, password, keep_login: keepLogin },
    });
    state.value = {
      accessToken: data.access_token,
      user: data.user,
      spaceId: data.space_id,
      credits: null,
      onboarded: state.value.onboarded,
      llmMode: null,
    };
    await me();
    ready.value = true;
  }

  /** OAuth 回调落地页：拿服务端下发的一次性 access 建前端会话（refresh 仍走 Cookie）。 */
  async function completeOauth(
    provider: string,
    code: string,
    oauthState: string,
    ageConfirmed = true,
  ): Promise<{ bound: boolean }> {
    const data = await call<
      | { access_token: string; expires_in: number; user: AuthUser; space_id: string }
      | { bound: true; provider: string }
    >(`/auth/oauth/${provider}/callback`, {
      method: "POST",
      body: { code, state: oauthState, age_confirmed: ageConfirmed },
    });
    if ("bound" in data && data.bound) return { bound: true };
    if (!("access_token" in data)) throw new Error("OAuth 回调响应缺少 access_token");
    state.value = {
      accessToken: data.access_token,
      user: data.user,
      spaceId: data.space_id,
      credits: null,
      onboarded: state.value.onboarded,
      // 登录/注册响应不带部署形态；紧随其后的 me() 会用 /v1/me 的根部 llm_mode 填上
      llmMode: null,
    };
    await me();
    ready.value = true;
    return { bound: false };
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
      // /me 返回的服务端字段是 avatar_uri，前端类型用 avatar（两处都保留，避免各处再映射）
      user: { ...data.user, avatar: data.user.avatar_uri },
      spaceId: data.space.id,
      credits: data.credits,
      onboarded: data.onboarded ?? true,
      // 部署形态：根部字段，不是 user 的成员。错读成 `data.user.llm_mode` 会让横幅永远不亮。
      llmMode: data.llm_mode ?? null,
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
      state.value = { accessToken: "", user: null, spaceId: null, credits: null, onboarded: true, llmMode: null };
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

  /**
   * 邮箱注册（注册即登录）。契约：`POST /v1/auth/email/register`
   * `{email, password, invite_code?, age_confirmed, keep_login?}`，
   * 返回体与 `/auth/login` 同形，refresh 走同一个 HttpOnly Cookie。
   *
   * **建号副作用全部在服务端 `provisionAccount()` 里**（users/spaces/space_members/
   * credit_accounts/identities/user_credentials/新人礼包/邀请码核销），前端只负责传参，
   * 不在客户端复制任何"建号"逻辑 —— 复制出来的第二份迟早与后端分叉。
   */
  async function registerWithEmail(
    email: string,
    password: string,
    keepLogin = true,
    ageConfirmed = true,
    inviteCode?: string,
  ): Promise<void> {
    const data = await call<{
      access_token: string;
      expires_in: number;
      user: AuthUser;
      space_id: string;
    }>("/auth/email/register", {
      method: "POST",
      body: {
        email,
        password,
        age_confirmed: ageConfirmed,
        keep_login: keepLogin,
        ...(inviteCode ? { invite_code: inviteCode } : {}),
      },
    });
    state.value = {
      accessToken: data.access_token,
      user: data.user,
      spaceId: data.space_id,
      credits: null,
      onboarded: state.value.onboarded,
      llmMode: null,
    };
    await me();
    ready.value = true;
  }

  return {
    state,
    ready,
    login,
    loginWithPassword,
    registerWithEmail,
    completeOauth,
    refresh,
    me,
    logout,
    bootstrap,
    dismissOnboarding,
  };
};
