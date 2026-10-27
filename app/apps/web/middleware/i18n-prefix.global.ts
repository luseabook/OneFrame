import { DEFAULT_LOCALE, parseLocalePrefix } from "~/i18n";

/**
 * 语言路径前缀（`/en /ja /br /es`）—— 竞品 i18n 前缀的对齐（`routes.txt:50/52/60`、`报告:23`）。
 *
 * 设计（为什么不是真·嵌套路由）：
 * - 真做 `/en/**` 目录意味着每个页面复制一份（或给每页写 alias），而本仓有 20+ 页面、
 *   同一轮还有 5 个队友在改页面 —— 冲突面与维护成本都不可接受。
 * - 因此**前缀只是入口别名**：`/en/pricing` → 解析出 `en` → 设定语言 → 跳到 canonical
 *   `/pricing`。落地页面只有一份，`html lang`、语言包、SEO canonical 全部一致。
 *
 * 行为：
 * 1. 命中前缀 → `setLocale(prefix)`（写 cookie `of_lang`）+ 301（服务端）/ replace（客户端）跳到去前缀路径；
 * 2. 无前缀 → 什么都不做（语言由 `plugins/i18n.ts` 按 cookie/`?lang=`/Accept-Language 解析）；
 * 3. 中文（默认）**不带前缀**；用户访问 `/zh-cn/...` 也会被剥成无前缀路径；
 * 4. 多层前缀不会叠加：`/ja/en/pricing` 只剥一层 → `/en/pricing`，下一跳再剥，最终 `/pricing`
 *    （这样手工拼错的 URL 也能收敛，而不是 404）。
 *
 * 为什么不在这里读 cookie：插件已经处理过首帧语言；本中间件只负责"前缀是最高优先级覆盖"。
 */
export default defineNuxtRouteMiddleware((to) => {
  const { locale, path } = parseLocalePrefix(to.path);
  if (!locale) return;

  // 前缀优先级高于 cookie/?lang=：它是用户显式点进来（或分享链接带来）的语言
  const { setLocale } = useI18n();
  setLocale(locale);

  /**
   * 跳转目标带上 `?lang=`：
   * 服务端 301 时 cookie 的 Set-Cookie 与 Location 的先后顺序在部分代理下不可靠，
   * 带上 query 能保证落地页一定按这个语言渲染（插件读 query 优先，并会写回 cookie）。
   * 中文（默认语言）不需要该参数。
   */
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(to.query)) {
    if (typeof value === "string") query[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") query[key] = value[0];
  }
  if (locale !== DEFAULT_LOCALE) query.lang = locale;
  else delete query.lang;

  return navigateTo(
    { path: path || "/", query, hash: to.hash },
    // 服务端给 301（前缀 URL 是永久别名）；客户端用 replace，避免历史里留一堆重定向
    { redirectCode: 301, replace: true, external: false },
  );
});
