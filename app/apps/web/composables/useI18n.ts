import { computed, type ComputedRef } from "vue";
import {
  DEFAULT_LOCALE,
  LANGUAGES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  MESSAGES,
  SUPPORTED_LOCALES,
  createTranslator,
  normalizeLocale,
  type Locale,
  type TranslateFn,
} from "~/i18n";

/**
 * `useI18n()` —— 全站唯一的语言入口（不引 `@nuxtjs/i18n`，理由见 `i18n/index.ts` 顶部）。
 *
 * 状态放在 `useState` 而不是模块级 `ref`：SSR 请求之间必须隔离，
 * 模块级变量在服务端会被多个请求共享，A 用户切到日语会把 B 用户的首帧也变成日语。
 *
 * 用法：
 * ```ts
 * const { t, locale, setLocale, languages } = useI18n();
 * t("landing.heroTitle")                    // 取文案
 * t("tasks.expiring", { count: 3 })         // 带占位符
 * setLocale("ja")                           // 切换（不刷新页面，写 cookie）
 * ```
 */

interface I18nState {
  locale: Locale;
  /** 是否已由插件完成首次协商（未完成时页面不该渲染"已翻译"的静态文案） */
  ready: boolean;
}

const stateFactory = (): I18nState => ({ locale: DEFAULT_LOCALE, ready: false });

/**
 * 语言状态的唯一来源（`plugins/i18n.ts` 与 `useI18n()` 都从这里取）。
 * 导出它是为了让插件能写 `state.value`，同时保证两边拿到的是同一个 `useState` 键。
 */
export const useI18nState = () => useState<I18nState>("i18n", stateFactory);

export interface I18n {
  t: TranslateFn;
  locale: ComputedRef<Locale>;
  /** 当前语言的 BCP-47 值（给 `htmlAttrs.lang` 与 `X-Lang` 用，与 locale 同值） */
  htmlLang: ComputedRef<string>;
  setLocale: (next: string) => Locale | null;
  /** 语言切换器用的列表（nativeName 固定取语言自身写法） */
  languages: ReadonlyArray<{ code: Locale; nativeName: string }>;
  supported: ReadonlyArray<Locale>;
}

const isDev = (): boolean => import.meta.dev === true;

export const useI18n = (): I18n => {
  const state = useI18nState();
  /** 语言偏好落在 cookie（`of_lang`）：服务端首帧与客户端首帧读到同一值，避免 hydration 不一致 */
  const cookie = useCookie<string | null>(LOCALE_COOKIE, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    path: "/",
  });

  const locale = computed<Locale>(() => state.value.locale);
  const htmlLang = computed<string>(() => state.value.locale);

  /**
   * 缺 key 的处理：返回 key 本身（见 `lookup` 注释），并在 dev 下告警。
   * 生产环境不 warn：真正缺 key 会在验收脚本里被逐语言查出来，线上刷 warn 只会淹没真错误。
   */
  const translator = computed<TranslateFn>(() =>
    createTranslator(MESSAGES[locale.value] ?? MESSAGES[DEFAULT_LOCALE], (key) => {
      if (isDev()) console.warn(`[i18n] missing key "${key}" in locale "${locale.value}"`);
    }),
  );

  const t: TranslateFn = (key, vars) => translator.value(key, vars);

  /**
   * 切换语言：只改本地状态 + cookie，**不刷新页面**（Vue 响应式会让所有 `t()` 重新求值）。
   * 这里不做 `navigateTo`：页面本身没有语言前缀，刷新只会丢掉用户当前输入与滚动位置。
   */
  const setLocale = (next: string): Locale | null => {
    const resolved = normalizeLocale(next);
    if (!resolved) return null;
    if (resolved === state.value.locale && state.value.ready) return resolved;
    state.value = { ...state.value, locale: resolved };
    // 用 Nuxt 的 useCookie 写偏好（而不是手写 document.cookie）：服务端渲染时它落到
    // Set-Cookie，客户端时它落到 document.cookie，两条路径同一份语义
    cookie.value = resolved;
    if (import.meta.client) document.documentElement.setAttribute("lang", resolved);
    // 账号级偏好（跨设备跟随账号）：尽力而为，失败不影响本地切换。
    // 未登录调 /me/locale 会 401，这里静默吞掉——语言切换本身不能因为网络失败而回滚。
    if (import.meta.client) {
      void (async () => {
        try {
          const api = useApi();
          await api.post("/me/locale", { locale: resolved });
        } catch {
          /* 未登录或网络失败：仅本设备生效（cookie 已写） */
        }
      })();
    }
    return resolved;
  };

  return {
    t,
    locale,
    htmlLang,
    setLocale,
    languages: LANGUAGES,
    supported: SUPPORTED_LOCALES,
  };
};
