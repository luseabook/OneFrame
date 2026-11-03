import { computed, watch } from "vue";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  buildAlternates,
  isZhOnlyPath,
  normalizeLocale,
  pickFromAcceptLanguage,
  stripLocalePrefix,
  type Locale,
} from "~/i18n";
import { useI18nState } from "~/composables/useI18n";

/**
 * i18n 首次协商（服务端 + 客户端各跑一次，得到**同一个**结果，否则 hydration 会抖）。
 *
 * 优先级（与任务书一致，自高到低）：
 * 1. `?lang=` —— 分享/投放链接要能强制指定语言；
 * 2. cookie `of_lang` —— 用户上次选的（登录页、定价页都靠它保持）；
 * 3. `Accept-Language`（服务端）/ `navigator.language`（客户端）—— 首次访问的兜底；
 * 4. `zh-CN` 默认。
 *
 * 两个踩过的坑（E2E 实测，别再改回去）：
 * - **客户端读 `window.location.search` 而不是 `useRoute().query`**：`pages/**` 大多是
 *   `ssr:false`，插件执行时路由还没解析到目标页，`useRoute()` 仍是上一次的路由，
 *   于是 `?lang=ja` 会被 cookie 顶掉（表现为"URL 写了 ja、界面还是上次的语言"）。
 * - **要 `watch` query 变化**：站内 SPA 跳转不会重跑插件，`?lang=` 只有首次生效。
 *
 * 为什么服务端也要读 `Accept-Language` 而不是永远返回 zh：
 * 落地页 `/` 是 SSR 的（`definePageMeta({ layout: false })`）。若服务端固定渲染中文、
 * 客户端首帧却按浏览器语言渲染英文，用户会看到"先闪一下中文再变英文"，且 Vue 会报
 * hydration mismatch。因此两侧都按同一份输入顺序解析。
 */
export default defineNuxtPlugin(() => {
  const state = useI18nState();
  const route = useRoute();
  const cookie = useCookie<string | null>(LOCALE_COOKIE);

  /** 当前文档 URL 上的 `?lang=`（客户端用 window.location，SSR 用路由 query） */
  const readQueryLang = (): string | null => {
    if (import.meta.client) {
      try {
        return new URL(window.location.href).searchParams.get("lang");
      } catch {
        return null;
      }
    }
    const raw = route.query.lang;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" ? value : null;
  };

  const fromQuery = normalizeLocale(readQueryLang());
  const fromCookie = normalizeLocale(cookie.value);
  const fromBrowser = import.meta.server
    ? pickFromAcceptLanguage(useRequestHeaders(["accept-language"])["accept-language"])
    : normalizeLocale(import.meta.client ? navigator.language : null);

  const resolved: Locale = fromQuery ?? fromCookie ?? fromBrowser ?? DEFAULT_LOCALE;

  state.value = { locale: resolved, ready: true };

  /**
   * 账号级偏好：登录后 `/me` 会带 `user.preferred_locale`。
   * 优先级设计（避免"我明明在这台机器选了英文，却被账号里的日文顶掉"）：
   *   1. URL `?lang=`（投放/分享链接，最强）
   *   2. 本设备 cookie（用户最近一次显式选择）
   *   3. 账号偏好（跨设备，仅当本设备从没选过时生效）
   *   4. 浏览器语言 → 默认 zh-CN
   */
  if (import.meta.client) {
    void (async () => {
      if (fromQuery || fromCookie) return; // 本设备已有明确偏好，不覆盖
      try {
        const api = useApi();
        const me = await api.get<{ user?: { preferred_locale?: string } }>("/me");
        const account = normalizeLocale(me?.user?.preferred_locale);
        if (account && account !== state.value.locale) {
          state.value = { ...state.value, locale: account };
          document.documentElement.setAttribute("lang", account);
        }
      } catch {
        /* 未登录：保持按设备解析的语言 */
      }
    })();
  }
  // 带 `?lang=` 进来（投放/分享链接）时把它记住：之后站内跳转不再需要该参数
  if (fromQuery && fromQuery !== fromCookie) cookie.value = fromQuery;

  // 站内跳转带 `?lang=` 时同步（SPA 不重跑插件）；不写 cookie 的话用户手动改 URL 也能立即生效
  if (import.meta.client) {
    watch(
      () => route.query.lang,
      (raw) => {
        const value = Array.isArray(raw) ? raw[0] : raw;
        const next = normalizeLocale(typeof value === "string" ? value : null);
        if (!next) return;
        state.value = { ...state.value, locale: next };
        cookie.value = next;
      },
    );
  }

  /**
   * `html lang`：普通页跟随协商语言；**仅中文合规页固定 zh-CN**（conventions.md §8.1）。
   *
   * 为什么不能让它跟着 `Accept-Language` 漂：`/terms` `/privacy` `/report` 的正文是中文写死的
   * 法律文本，若声明成 `lang="en"`，搜索引擎会判定语言与内容不符，读屏软件会按英文音素念中文。
   * 这三页的"实际语言"是中文，声明就必须是中文 —— 语言声明描述内容，不描述用户偏好。
   */
  const isZhOnlyPage = computed(() => isZhOnlyPath(route.path));
  useHead({
    htmlAttrs: { lang: computed(() => (isZhOnlyPage.value ? "zh-CN" : state.value.locale)) },
  });

  /**
   * hreflang：5 条语言 alternate + 1 条 x-default（指向无前缀中文）。
   *
   * 放在插件里而不是每个页面各写一次：`useHead` 在插件里是**全局**的，
   * 新增页面自动获得 alternates，不会出现"新页面忘了加 hreflang"的漏配。
   * 输出的是**标准 URL 集合**（与 sitemap 同源 `buildAlternates`），与当前语言无关——
   * 这正是 hreflang 的语义："这页还有哪些语言版本"。
   */
  /**
   * SSR 请求头必须在插件 setup（= 请求上下文内）**立刻**取，不能放进 computed 里懒取。
   *
   * 踩过的坑：`useRequestHeaders()` 在 `computed` 体内调用时，computed 可能被延迟到
   * 请求上下文销毁之后才求值（head 解析/流式渲染），于是抛
   * `[nuxt] instance unavailable` → 整页 500（实测 `/admin/login` 就是这样挂的）。
   */
  const ssrRequestHeaders = import.meta.server
    ? useRequestHeaders(["host", "x-forwarded-proto"])
    : null;
  const origin = computed<string>(() => {
    if (import.meta.client) return window.location.origin;
    const headers = ssrRequestHeaders ?? {};
    const proto = headers["x-forwarded-proto"] ?? "https";
    const host = headers.host ?? "localhost:3000";
    return `${proto}://${host}`;
  });
  const canonicalPath = computed<string>(() => stripLocalePrefix(route.path));
  useHead({
    link: computed(() =>
      buildAlternates(canonicalPath.value, origin.value).map((item) => ({
        rel: "alternate",
        hreflang: item.hreflang,
        href: item.href,
      })),
    ),
  });
});
