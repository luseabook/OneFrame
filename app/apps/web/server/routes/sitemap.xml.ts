import { PUBLIC_PATHS, SUPPORTED_LOCALES, buildAlternates, isZhOnlyPath, localizedPath, type Locale } from "~/i18n";

/**
 * `/sitemap.xml` —— 5 语言 × 公开页（`i18n/PUBLIC_PATHS`）。
 *
 * 三个刻意的取舍：
 * 1. **只列公开页**：`/admin`、`/canvas`、`/tasks`、`/projects` 这些进去就跳登录，
 *    列进 sitemap 只会让爬虫批量吃 302，也等于对外公布私有路径。口径与 hreflang 同源
 *    （`i18n/index.ts` 的 `PUBLIC_PATHS`），新增公开页改一处即可。
 * 2. **每条 url 带 5 条 `xhtml:link` alternate**：这是 i18n 站点的标准形态，
 *    与页面 `<head>` 里的 hreflang 用同一个 `buildAlternates`，避免两处漂移。
 * 3. **不加 `lastmod`**：本仓没有构建时间戳注入，写 `new Date()` 会让每次抓取都变，
 *    反而让爬虫认为页面天天变（说谎的 lastmod 比没有更糟）。
 *
 * 限制（已登记在 report-i18n2.md）：前缀 URL 目前是入口别名（服务端 301 到无前缀 canonical），
 * 爬虫最终收敛到 canonical；要做到"前缀即 canonical 且 200"需要真·前缀路由，本轮不做。
 */
export default defineEventHandler((event) => {
  const requestUrl = getRequestURL(event);
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;

  const entries: string[] = [];
  for (const path of PUBLIC_PATHS) {
    // 仅中文合规页（§8.1）：只出 1 条 zh-CN，不再按 5 语各列一遍。
    // 列 5 语等于对外声明"这页有 5 个语言版本"，而实际进去只有中文正文 —— 虚假 hreflang。
    const locales: readonly Locale[] = isZhOnlyPath(path) ? ["zh-CN"] : SUPPORTED_LOCALES;
    for (const locale of locales) {
      const loc = `${origin}${localizedPath(path, locale)}`;
      const alternates = buildAlternates(path, origin)
        .map((item) => `    <xhtml:link rel="alternate" hreflang="${item.hreflang}" href="${escapeXml(item.href)}"/>`)
        .join("\n");
      entries.push(
        [
          "  <url>",
          `    <loc>${escapeXml(loc)}</loc>`,
          alternates,
          `    <changefreq>weekly</changefreq>`,
          `    <priority>${path === "/" ? "1.0" : "0.8"}</priority>`,
          "  </url>",
        ].join("\n"),
      );
    }
  }

  setHeader(event, "content-type", "application/xml; charset=utf-8");
  // 站点内容按天更新；给游标缓存一天，避免每次抓取都打 SSR
  setHeader(event, "cache-control", "public, max-age=3600");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
});

/** XML 转义：URL 里出现 `&`（带 query 的 canonical）会直接让 sitemap 解析失败 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
