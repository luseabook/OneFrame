/**
 * 轻量 i18n 内核（不引 `@nuxtjs/i18n`）。
 *
 * 为什么自己写一层而不用现成库（ADR 决策，记录在 `_acceptance/_team/report-i18n.md` /
 * `report-i18n2.md`）：
 * 1. 本仓库只有一个 Nuxt 应用；库会改路由（给每个页面套语言前缀路由）、注册自己的中间件、
 *    引入依赖与打包约定——为了 300+ key 换一次构建链风险不划算。
 * 2. 我们要的前缀语义很窄：**竞品那种 `/en /ja /br /es` 只是入口别名**，落地仍是同一份页面；
 *    用一层中间件解析前缀 → 设语言 → 跳到无前缀 canonical 即可（见 `middleware/i18n-prefix.global.ts`），
 *    不需要真的复制一套 `/en/**` 路由目录（那会与同轮队友的页面改动全面冲突）。
 *
 * 本文件只做纯函数（无 Vue 依赖），便于被 Node 脚本与单测直接引用；
 * 响应式与副作用在 `composables/useI18n.ts` 与 `plugins/i18n.ts`。
 */

import zhCN from "./locales/zh-CN.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ptBR from "./locales/pt-BR.json";
import es from "./locales/es.json";

/** 5 个语言，顺序即语言切换器里的展示顺序（zh 在前，与"默认语言"一致） */
export const SUPPORTED_LOCALES = ["zh-CN", "en", "ja", "pt-BR", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * 语言元信息。
 *
 * `nativeName` **不进语言包**：语言名是专有名词，应当永远显示成它自己的写法
 * （在日语界面里 "English" 仍是 English）。放进语言包的话，en/ja/es/pt 包里就得出现
 * 「简体中文」这种中文字符串，既违反"外语包无中文残留"的验收口径，也会让语言切换器
 * 在本语言界面里显示被翻译过的名字（用户反而认不出来）。
 */
export const LANGUAGES: ReadonlyArray<{ code: Locale; nativeName: string }> = [
  { code: "zh-CN", nativeName: "简体中文" },
  { code: "en", nativeName: "English" },
  { code: "ja", nativeName: "日本語" },
  { code: "pt-BR", nativeName: "Português (Brasil)" },
  { code: "es", nativeName: "Español" },
];

export const DEFAULT_LOCALE: Locale = "zh-CN";

/** 语言 cookie：竞品的语言偏好是账号级，我方先用本地 cookie（登录后服务端不存语言） */
export const LOCALE_COOKIE = "of_lang";
/** 语言 cookie 有效期 1 年 */
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** 语言包：namespace → key → 文案（叶子必须是字符串） */
export type MessageNode = string | { [key: string]: MessageNode };
export type MessageTree = { [key: string]: MessageNode };

export const MESSAGES: Record<Locale, MessageTree> = {
  "zh-CN": zhCN as MessageTree,
  en: en as MessageTree,
  ja: ja as MessageTree,
  "pt-BR": ptBR as MessageTree,
  es: es as MessageTree,
};

/**
 * 把外部输入（cookie / query / Accept-Language / navigator.language）归一成受支持的语言。
 *
 * 兼容写法（都是真实会出现的）：`zh`、`zh-CN`、`zh-cn`、`zh-Hans-CN`、`en-US`、`ja-JP`、
 * `pt`、`pt-br`、`br`（竞品路径前缀就是 `br`）、`es-419`。
 * 不认识的返回 null，由调用方决定下一优先级。
 */
export function normalizeLocale(raw: string | null | undefined): Locale | null {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase().replace(/_/g, "-");
  if (!value) return null;
  // 精确匹配优先（pt-BR 与 es 的子标签歧义最小）
  for (const locale of SUPPORTED_LOCALES) {
    if (locale.toLowerCase() === value) return locale;
  }
  const primary = value.split("-")[0] ?? "";
  if (primary === "zh") return "zh-CN";
  if (primary === "en") return "en";
  if (primary === "ja" || primary === "jp") return "ja";
  if (primary === "pt" || primary === "br") return "pt-BR";
  if (primary === "es") return "es";
  return null;
}

/**
 * 从 `Accept-Language` 头里挑第一个受支持的语言（按 q 值降序，q 相同保持声明顺序）。
 * 为什么不直接取第一段：`en-US,en;q=0.9,zh-CN;q=0.8` 这种头很常见，用户真正的首选
 * 可能被不支持的 `en-US`（其实支持 en）挡住——归一化后再按 q 排序才是用户意图。
 */
export function pickFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const entries = String(header)
    .split(",")
    .map((part, index) => {
      const [tagRaw, ...params] = part.trim().split(";");
      const qParam = params.find((item) => item.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return {
        tag: (tagRaw ?? "").trim(),
        q: Number.isFinite(q) ? q : 0,
        index,
      };
    })
    .filter((item) => item.tag && item.q > 0)
    .sort((a, b) => (b.q === a.q ? a.index - b.index : b.q - a.q));
  for (const entry of entries) {
    const locale = normalizeLocale(entry.tag);
    if (locale) return locale;
  }
  return null;
}

/**
 * 按点路径取值。返回 `undefined` 表示缺失（调用方决定回退策略）：
 * 缺 key 时**返回 key 本身**，这样界面上会直接暴露 `pricing.buy` 这种串，
 * 比渲染空白更容易在验收时被发现（静默空白是最难查的一类 i18n 事故）。
 */
export function lookup(tree: MessageTree, key: string): string | undefined {
  const parts = key.split(".");
  let node: MessageNode | undefined = tree;
  for (const part of parts) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** `{name}` 占位符插值；缺变量时保留原占位符（让问题可见，而不是渲染 undefined） */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** 生成一个翻译函数；`onMissing` 只在缺 key 时调用（生产环境做空操作） */
export function createTranslator(tree: MessageTree, onMissing?: (key: string) => void): TranslateFn {
  return (key: string, vars?: Record<string, string | number>): string => {
    const template = lookup(tree, key);
    if (template === undefined) {
      onMissing?.(key);
      return key;
    }
    return interpolate(template, vars);
  };
}

/** 扁平化 key 列表（供 `_acceptance/i18n-check.cjs` 同口径比对；脚本本身独立读 JSON） */
export function flattenKeys(tree: MessageTree, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.push(path);
    else out.push(...flattenKeys(value, path));
  }
  return out;
}

// ── 路径前缀 ───────────────────────────────────────────────
/**
 * 语言的 URL 前缀。竞品的 i18n 前缀是 `/en /ja /br /es`（`rea-reelmate/routes.txt:50/52/60`、
 * `报告:23`）；**中文（默认语言）不带前缀**，与竞品「zh 默认无前缀」一致。
 *
 * 注意 pt-BR 的前缀是 `br`（竞品如此），不是 `pt`/`pt-BR`。
 */
export const LOCALE_PREFIX: Record<Locale, string> = {
  "zh-CN": "",
  en: "en",
  ja: "ja",
  "pt-BR": "br",
  es: "es",
};

/** 前缀 → 语言（含 `pt-br` 这种完整写法，便于人工输入/外链） */
export const PREFIX_TO_LOCALE: Record<string, Locale> = {
  en: "en",
  ja: "ja",
  br: "pt-BR",
  es: "es",
  "pt-br": "pt-BR",
  "zh-cn": "zh-CN",
};

/**
 * 公开可索引页面（sitemap / hreflang / robots 的口径）。
 *
 * **只列未登录也能看的页**：`/admin`、`/canvas`、`/tasks`、`/projects` 这类进去就跳登录，
 * 列进 sitemap 等于给爬虫一批 302 → 收录质量差，也把私有路径暴露在外。
 * 新增公开页时改这一处即可（sitemap 与 hreflang 同源）。
 */
export const PUBLIC_PATHS = ["/", "/pricing", "/login", "/terms", "/privacy", "/report"] as const;

/**
 * **仅中文版具有法律效力**的页面（`docs/03-frontend/conventions.md` §8.1）。
 *
 * 背景：这三页已改为服务端渲染（§8），首帧就要下发给爬虫。但它们的正文是中文写死的历史文案，
 * 没有进入语言包 —— 一旦随 `Accept-Language` 漂成 `lang="en"`，就变成「声明英文、内容是中文」，
 * 对搜索引擎是错误声明，对读屏软件是错误发音。
 *
 * 裁定口径（不是技术妥协，是法律事实）：法律文本只有中文版经法务审定，
 * 因此这三页 **语言固定 zh-CN、hreflang 只列 zh-CN**，非中文界面进入时页首给一行提示。
 *
 * 与 `PUBLIC_PATHS` 的关系：仍在 sitemap 里（它们必须可抓取），只是不再宣称有 5 个语言版本。
 *
 * **为什么不含 `/report`**（裁定 §8.1 原写的是三页，实测后按证据收窄）：
 * `pages/report.vue` 模板里 `t()` 调用 20 处、硬编码中文 0 行 —— 它是**已完整 i18n 化的表单**，
 * 英文界面下正文确实是英文。把它也钉成 `lang="zh-CN"` 会制造一个新的错误声明，
 * 并从 sitemap 里删掉 4 个真实存在的语言版本。只有 `terms` / `privacy` 是中文写死的法律正文
 * （模板里各 29 / 31 行硬编码中文，`t()` 只用于标题）。
 */
export const ZH_ONLY_PATHS = ["/terms", "/privacy"] as const;

/** 该路径是否属于"仅中文版"的合规页（内部先剥语言前缀，`/en/terms` 也算命中） */
export function isZhOnlyPath(path: string): boolean {
  const canonical = stripLocalePrefix(path);
  return (ZH_ONLY_PATHS as readonly string[]).includes(canonical);
}

/** 去掉路径上的语言前缀；不认识的段原样保留 */
export function stripLocalePrefix(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const segments = clean.split("/");
  const first = segments[1] ?? "";
  if (!PREFIX_TO_LOCALE[first.toLowerCase()]) return clean === "" ? "/" : clean;
  const rest = "/" + segments.slice(2).join("/");
  return rest === "/" ? "/" : rest.replace(/\/$/, "");
}

/** 解析路径前缀：返回命中的语言（没有则 null）与剥离后的路径 */
export function parseLocalePrefix(path: string): { locale: Locale | null; path: string } {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const first = (clean.split("/")[1] ?? "").toLowerCase();
  const locale = PREFIX_TO_LOCALE[first] ?? null;
  return { locale, path: locale ? stripLocalePrefix(clean) : clean };
}

/**
 * 生成某语言下的路径。**替换**而非叠加前缀：
 * `localizedPath("/en/pricing", "ja")` → `/ja/pricing`（不是 `/ja/en/pricing`）；
 * 中文 → `/pricing`（去前缀）；根路径 → `/`、`/en`。
 */
export function localizedPath(path: string, locale: Locale): string {
  const canonical = stripLocalePrefix(path);
  const prefix = LOCALE_PREFIX[locale];
  if (!prefix) return canonical;
  return canonical === "/" ? `/${prefix}` : `/${prefix}${canonical}`;
}

/** hreflang 用的 alternate 列表（默认 5 语 + x-default，指向无前缀中文） */
export function buildAlternates(path: string, origin: string): Array<{ hreflang: string; href: string }> {
  const canonical = stripLocalePrefix(path);
  const base = origin.replace(/\/+$/, "");
  // 仅中文合规页：只声明 zh-CN 一条，且**不加 x-default**。
  // 加 x-default 等于告诉搜索引擎"还有一个默认语言版本"，对这三页是多余的；
  // 其余 4 语的 URL 根本不存在对应内容（进去也是中文正文），声明它们就是虚假 hreflang。
  if (isZhOnlyPath(canonical)) {
    return [{ hreflang: "zh-CN", href: `${base}${canonical}` }];
  }
  // 显式标注为 `string`：下面要 push `x-default`，而 `Locale` 联合里没有它
  // （x-default 是 Google 的"默认语言"约定，不是我们的 Locale 之一）。
  const alternates: Array<{ hreflang: string; href: string }> = SUPPORTED_LOCALES.map((locale) => ({
    hreflang: locale,
    href: `${base}${localizedPath(canonical, locale)}`,
  }));
  alternates.push({ hreflang: "x-default", href: `${base}${canonical}` });
  return alternates;
}
