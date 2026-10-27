/**
 * 轻量 i18n 内核（不引 `@nuxtjs/i18n`）。
 *
 * 为什么自己写一层而不用现成库（ADR 决策，已在 `_acceptance/_team/report-i18n.md` 记录）：
 * 1. 本仓库只有一个 Nuxt 应用、5 个语言、7 个 namespace，库能提供的能力（路由前缀、
 *    hreflang、SEO 地图、多域）我们一个都不用；而它会改路由、注册中间件、引入约 1MB 依赖
 *    与一套自己的打包约定——为了 170 个 key 换一次构建链风险不划算。
 * 2. 竞品的语言协商是**请求头 `X-Lang`**（`reelmate-feature-map.md:152`、`:414`），
 *    不是路径前缀；`@nuxtjs/i18n` 的默认形态恰恰是路径前缀，接进来要一路关掉它的默认行为。
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
