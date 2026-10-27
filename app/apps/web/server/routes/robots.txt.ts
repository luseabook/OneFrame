/**
 * `/robots.txt` —— 放开公开页、挡住登录后才可用的私有路径，并指向 `/sitemap.xml`。
 *
 * 为什么 Disallow 列表写"工作台族"而不是逐个页面：这些路径（`/home`、`/projects`、`/tasks`、
 * `/canvas`…）对未登录用户一律跳 `/login`，爬虫抓到的只是重定向；挡掉能省爬虫预算，
 * 也避免把私有路径结构铺到索引里。**不要**在这里 Disallow `/`（首页要能抓）。
 */
export default defineEventHandler((event) => {
  const requestUrl = getRequestURL(event);
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;
  const disallow = [
    "/api",
    "/admin",
    "/agent",
    "/assets",
    "/canvas",
    "/create",
    "/film",
    "/home",
    "/login", // 登录页是弹窗形态、无独立内容价值；仍可从 sitemap 访问，只是不让它抢索引位
    "/novel",
    "/projects",
    "/reelflow",
    "/settings",
    "/tasks",
    "/team",
    "/watch",
    "/works",
  ];

  setHeader(event, "content-type", "text/plain; charset=utf-8");
  setHeader(event, "cache-control", "public, max-age=3600");
  return [
    "User-agent: *",
    "Allow: /",
    ...disallow.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
});
